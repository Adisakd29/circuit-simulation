import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { setPartParams } from '../src/editor/ops';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

export const TEMP_CODE = 'from machine import ADC, Pin\nimport time\ns = ADC(26)\nled = Pin(15, Pin.OUT)\nwhile True:\n    t = s.read_u16() * 3.3 / 65535 * 100\n    print("T =", round(t, 1))\n    led.value(1 if t > 30 else 0)\n    time.sleep(0.2)\n';
const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * Pico ที่ h5 · LM35 ที่ c26 (VS c26, OUT c27, GND c28) · VS → VBUS, OUT → GP26, GND → GND.38 (ฝั่งบน)
 * LED เตือน: GP15 → สาย j26 → 330 Ω (h26–h29) → LED (g29/g30) → สาย j30 → GND.18 · โพรบแดงที่ d27 (VOUT) ดำที่ GND
 */
export function tempRig(o: { temp?: number; vs?: 'VBUS' | '3V3'; code?: string; noLed?: boolean } = {}) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code: o.code ?? TEMP_CODE, autorun: true })
    .part('lm35', onBoard('c26'), 'TS1', { temperature: o.temp ?? 25 });
  b.wire(H('a26'), H(`a${col(b, o.vs ?? 'VBUS')}`)).wire(H('a27'), H(`b${col(b, 'GP26')}`)).wire(H('a28'), H(`b${col(b, 'GND.38')}`));
  if (!o.noLed) b.wire(H(`j${col(b, 'GP15')}`), H('j26')).part('resistor', onBoard('h26'), 'R1', { resistance: 330, span: 3 }).part('led', onBoard('g29'), 'LED1').wire(H('j30'), H(`j${col(b, 'GND.18')}`));
  return b.probe(H('d27'), H(`c${col(b, 'GND.38')}`));
}

const withTemp = (d: CircuitDoc, t: number) => { const r = setPartParams(d, 'TS1', { temperature: t }); if (!r.ok) throw new Error(r.errors.join('; ')); return r.doc; };

/** จำลองต่อเนื่อง เปลี่ยนอุณหภูมิตามลำดับ (ช่วงละ dur วินาที) เก็บข้อความ console และสถานะ LED ตอนท้ายช่วง */
export function runTemps(b: Builder, temps: number[], dur = 1.2) {
  const e = new SimEngine();
  const work = emptyWork(); work.achieved.lm35 = {};
  const res: Array<{ temp: number; printed: number | null; led: number; vout: number }> = [];
  let k = 0, st: Record<string, { pass: boolean; detail?: string }> = {};
  for (const t of temps) {
    const doc = withTemp(b.doc, t); const built = buildNetlist(doc);
    let con = '';
    let an = null as ReturnType<typeof analyze> | null;
    for (let i = 0; i < dur / 0.05; i++) {
      const r = e.handle({ seq: k, netlist: built.netlist, advance: k ? 0.05 : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
      k++;
      con += r.mcu?.[0]?.console ?? '';
      an = analyze(doc, built, r.result, r.tones);
      st = checkLesson('lm35', { doc, built, result: r.result, analysis: an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.lm35[g] = true;
    }
    const nums = [...con.matchAll(/T = (-?[\d.]+)/g)].map((m) => Number(m[1]));
    res.push({ temp: t, printed: nums.length ? nums[nums.length - 1] : null, led: an!.parts.LED1?.current ?? 0, vout: an!.parts.TS1.extra!.vout });
  }
  return { res, work, st };
}

describe('เซนเซอร์อุณหภูมิ LM35DZ', () => {
  it('ขา TO-92 เรียง +VS, VOUT, GND (มองหน้าแบน) ที่ c26–c28', () => {
    const ph = pinHolesFor(tempRig().doc.parts.find((p) => p.id === 'TS1')!);
    expect(ph.map((x) => [x.pin, x.hole])).toEqual([['VS', 'c26'], ['OUT', 'c27'], ['GND', 'c28']]);
  });
  it('แหล่งจ่าย 5 V: VOUT = 10 mV/°C (25 °C 0.250 V, 100 °C 1.000 V), ต่ำกว่า 0 °C ไม่ลงลบ, กระแสนิ่ง 56 µA', () => {
    const rig = (t: number, v = 5) => new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: v }).part('lm35', onBoard('c26'), 'TS1', { temperature: t })
      .wire(P('PS1', 'pos'), H('a26')).wire(P('PS1', 'neg'), H('a28')).doc;
    for (const [t, v] of [[25, 0.25], [37, 0.37], [100, 1.0], [150, 1.5]]) {
      const x = simulate(rig(t)).analysis.parts.TS1.extra!;
      expect(Math.abs(x.vout - v)).toBeLessThan(5e-4);
      expect(Math.abs(x.iq - 56e-6)).toBeLessThan(2e-6);
    }
    const cold = simulate(rig(-10)).analysis;
    expect(cold.parts.TS1.extra!.vout).toBeGreaterThanOrEqual(0); expect(cold.parts.TS1.extra!.vout).toBeLessThan(0.01);
    expect(cold.diagnostics.some((d) => d.partId === 'TS1' && d.message.includes('2–150'))).toBe(true);
    expect(simulate(rig(25, 3.3)).analysis.diagnostics.some((d) => d.partId === 'TS1' && d.severity === 'warn' && d.message.includes('4 V'))).toBe(true);
    const rev = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 }).part('lm35', onBoard('c26'), 'TS1').wire(P('PS1', 'pos'), H('a28')).wire(P('PS1', 'neg'), H('a26')).doc;
    expect(simulate(rev).analysis.diagnostics.some((d) => d.partId === 'TS1' && d.severity === 'danger' && d.message.includes('กลับขั้ว'))).toBe(true);
  });
  it('Pico อ่าน ADC (GP26): ค่าที่พิมพ์ตรงอุณหภูมิ ±0.2 °C ที่ 25/37/60 °C, LED เตือนติดเฉพาะเมื่อ > 30 °C', () => {
    const { res } = runTemps(tempRig(), [25, 37, 60, 25]);
    for (const r of res) {
      expect(r.printed).not.toBeNull();
      expect(Math.abs(r.printed! - r.temp)).toBeLessThan(0.2);
      if (r.temp > 30) expect(r.led).toBeGreaterThan(3e-3); else expect(r.led).toBeLessThan(1e-5);
    }
  }, 120000);
  it('+VS จาก 3V3 → เตือนให้ใช้ VBUS และเป้าหมายไฟเลี้ยงไม่ผ่าน', () => {
    const { work } = runTemps(tempRig({ vs: '3V3' }), [25], 0.6);
    expect(work.achieved.lm35.power).toBeFalsy();
  }, 60000);
  it('แลป 27 ผ่านครบ 5 ข้อ; บันทึก/เปิดไฟล์ + schema 23', () => {
    expect(LESSONS.find((l) => l.id === 'lm35')?.number).toBe(27);
    const { work } = runTemps(tempRig(), [25, 37, 60, 20], 0.8);
    expect(work.achieved.lm35).toMatchObject({ power: true, signal: true, measure: true, sweep: true, alarm: true });
    const d = tempRig().doc;
    const v = parseProject(serializeProject('t', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 23;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 120000);
});
