import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { setPartParams } from '../src/editor/ops';
import { parseProject, serializeProject } from '../src/storage/storage';
import { sonarEchoWidth, soundSpeed } from '../src/model/catalog';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

export const SONAR_CODE = 'from machine import Pin, time_pulse_us\nimport time\ntrig = Pin(14, Pin.OUT)\necho = Pin(15, Pin.IN)\ntrig.value(0)\nwhile True:\n    trig.value(1)\n    time.sleep_us(10)\n    trig.value(0)\n    t = time_pulse_us(echo, 1, 30000)\n    if t > 0:\n        print("D =", round(t / 58, 1))\n    else:\n        print("ไม่มีวัตถุ", t)\n    time.sleep_ms(60)\n';
const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * Pico ที่ h1 · HC-SR04 ที่ j21 ริมหน้าบอร์ด ลำโพงหันออกหน้า (VCC j21, TRIG j22, ECHO j23, GND j24)
 * VCC → VBUS, GND → GND.38, TRIG → GP14 · ECHO —R1 1 kΩ (h23–h27)— คอลัมน์ 27 → GP15 · R2 2 kΩ (g27–g30) คอลัมน์ 30 → GND ของโมดูล
 */
export function sonarRig(o: { dist?: number; vcc?: 'VBUS' | '3V3'; code?: string; direct?: boolean; r2?: number } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? SONAR_CODE, autorun: true })
    .part('sonar', onBoard('j21'), 'US1', { distance: o.dist ?? 20 });
  b.wire(H('i21'), H(`a${col(b, o.vcc ?? 'VBUS')}`)).wire(H('i24'), H(`a${col(b, 'GND.38')}`)).wire(H('i22'), H(`j${col(b, 'GP14')}`));
  if (o.direct) b.wire(H('h23'), H(`j${col(b, 'GP15')}`));
  else b.part('resistor', onBoard('h23'), 'R1', { resistance: 1000, span: 4 }).wire(H('i27'), H(`j${col(b, 'GP15')}`))
    .part('resistor', onBoard('g27'), 'R2', { resistance: o.r2 ?? 2000, span: 3 }).wire(H('i30'), H('g24'));
  return b;
}

const withDist = (d: CircuitDoc, v: number) => { const r = setPartParams(d, 'US1', { distance: v }); if (!r.ok) throw new Error(r.errors.join('; ')); return r.doc; };

/** จำลองต่อเนื่อง เปลี่ยนระยะตามลำดับ (ช่วงละ dur วินาที) เก็บค่าที่ Pico พิมพ์ล่าสุดและผลแผงของโมดูล */
export function runDists(b: Builder, dists: number[], dur = 0.5) {
  const e = new SimEngine();
  const work = emptyWork(); work.achieved.sonar = {};
  const res: Array<{ dist: number; printed: number | null; none: boolean; width: number; count: number; diags: string[] }> = [];
  let k = 0;
  for (const dv of dists) {
    const doc = withDist(b.doc, dv); const built = buildNetlist(doc);
    let con = '';
    let an = null as ReturnType<typeof analyze> | null;
    for (let i = 0; i < dur / 0.05; i++) {
      const r = e.handle({ seq: k, netlist: built.netlist, advance: k ? 0.05 : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
      k++;
      con += r.mcu?.[0]?.console ?? '';
      an = analyze(doc, built, r.result, r.tones);
      const st = checkLesson('sonar', { doc, built, result: r.result, analysis: an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.sonar[g] = true;
    }
    // ข้อความของช่วงนี้เท่านั้น (ตัดบรรทัดแรกที่อาจวัดก่อนเปลี่ยนระยะ)
    const lines = con.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    const m = last.match(/D = (-?[\d.]+)/);
    const x = an!.parts.US1.extra!;
    res.push({ dist: dv, printed: m ? Number(m[1]) : null, none: last.includes('ไม่มีวัตถุ'), width: x.width, count: x.count, diags: an!.diagnostics.filter((d) => d.partId === 'US1').map((d) => `${d.severity}:${d.message}`) });
  }
  return { res, work };
}

describe('โมดูลวัดระยะอัลตราโซนิก HC-SR04', () => {
  it('ความกว้าง ECHO = 2d / c: 20 cm ≈ 1155 µs, 1 m ≈ 5773 µs (25 °C), ไม่มีวัตถุ 38 ms', () => {
    expect(soundSpeed(25)).toBeCloseTo(346.45, 1);
    expect(sonarEchoWidth(20, 25) * 1e6).toBeCloseTo(1154.6, 0);
    expect(sonarEchoWidth(100, 25) * 1e6).toBeCloseTo(5773, -1);
    expect(sonarEchoWidth(500, 25)).toBe(0.038);
    expect(sonarEchoWidth(100, 35)).toBeLessThan(sonarEchoWidth(100, 25));
  });
  it('หัวเข็ม 4 ขาเรียง Vcc Trig Echo Gnd ที่ j21–j24', () => {
    const ph = pinHolesFor(sonarRig().doc.parts.find((p) => p.id === 'US1')!);
    expect(ph.map((x) => [x.pin, x.hole])).toEqual([['VCC', 'j21'], ['TRIG', 'j22'], ['ECHO', 'j23'], ['GND', 'j24']]);
  });
  it('แหล่งจ่าย 5 V + พัลส์ TRIG 20 µs จากเครื่องกำเนิดสัญญาณ → พัลส์ ECHO ตามระยะ (±0.5%)', () => {
    for (const dv of [10, 50, 150]) {
      const doc = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
        .part('fgen', onTable(-25, 12), 'FG1', { wave: 'square', frequency: 20, vpp: 3.3, offset: 1.65 })
        .part('sonar', onBoard('j21'), 'US1', { distance: dv })
        .wire(P('PS1', 'pos'), H('i21')).wire(P('PS1', 'neg'), H('i24')).wire(P('FG1', 'OUT'), H('i22')).wire(P('FG1', 'COM'), H('h24')).doc;
      const built = buildNetlist(doc);
      const e = new SimEngine();
      let r = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
      for (let i = 1; i <= 4; i++) r = e.handle({ seq: i, netlist: built.netlist, advance: 0.05, restart: false, watch: [], budgetMs: 1e9 });
      const x = analyze(doc, built, r.result, r.tones).parts.US1.extra!;
      expect(x.count).toBeGreaterThanOrEqual(1);
      expect(Math.abs(x.width - sonarEchoWidth(dv, 25)) / sonarEchoWidth(dv, 25)).toBeLessThan(0.005);
      expect(Math.abs(x.dist - dv)).toBeLessThan(0.5);
    }
  }, 60000);
  it('Pico (time_pulse_us) พิมพ์ระยะตรง ±1.5% ที่ 10/50/100/250 cm และ "ไม่มีวัตถุ" เมื่อไกลเกิน 4 m', () => {
    const { res } = runDists(sonarRig(), [10, 50, 100, 250, 500], 0.6);
    for (const r of res) {
      if (r.dist > 400) { expect(r.none).toBe(true); continue; }
      expect(r.printed).not.toBeNull();
      expect(Math.abs(r.printed! - r.dist)).toBeLessThan(Math.max(0.3, 0.015 * r.dist));
    }
  }, 180000);
  it('ไฟเลี้ยงจาก 3V3 → ไม่มีพัลส์ ECHO + เตือนให้ใช้ VBUS; ECHO ต่อตรงเข้า GP → อันตราย; ตัวแบ่ง 1k/10k → อันตราย', () => {
    const lo = runDists(sonarRig({ vcc: '3V3' }), [20], 0.4).res[0];
    expect(lo.count).toBe(0);
    expect(lo.diags.some((d) => d.startsWith('warn') && d.includes('VBUS'))).toBe(true);
    const dir = runDists(sonarRig({ direct: true }), [20], 0.3).res[0];
    expect(dir.diags.some((d) => d.startsWith('danger') && d.includes('ตัวแบ่งแรงดัน'))).toBe(true);
    const hi = runDists(sonarRig({ r2: 10000 }), [20], 0.3).res[0];
    expect(hi.diags.some((d) => d.startsWith('danger') && d.includes('เกิน 3.3 V'))).toBe(true);
  }, 120000);
  it('แลป 29 ผ่านครบ 5 ข้อ; ECHO ต่อตรงไม่ผ่านข้อตัวแบ่งแรงดัน; บันทึก/เปิดไฟล์ + schema 25', () => {
    expect(LESSONS.find((l) => l.id === 'sonar')?.number).toBe(29);
    const { work } = runDists(sonarRig(), [20, 60, 150], 0.4);
    expect(work.achieved.sonar).toMatchObject({ power: true, trigger: true, divider: true, echo: true, sweep: true });
    const bad = runDists(sonarRig({ direct: true }), [20], 0.3).work;
    expect(bad.achieved.sonar.divider).toBeFalsy();
    const d = sonarRig().doc;
    const v = parseProject(serializeProject('t', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 25;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 180000);
});
