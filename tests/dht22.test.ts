import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { setPartParams } from '../src/editor/ops';
import { LESSONS } from '../src/lessons/lessons';
import { dht22Bytes } from '../src/model/catalog';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { DHT_CODE, dhtRig, runDht } from './dht-rig';

const lastRead = (con: string) => { const m = [...con.matchAll(/T = (-?[\d.]+) C {2}RH = ([\d.]+) %/g)]; return m.length ? [Number(m[m.length - 1][1]), Number(m[m.length - 1][2])] : null; };

/** จำลองต่อเนื่อง เปลี่ยนสภาพอากาศตามลำดับ (ช่วงละ dur วินาที) — เก็บค่าที่ Pico พิมพ์ และเป้าหมายแลป 41 */
function session(doc0: CircuitDoc, steps: Array<{ t: number; h: number; dur: number }>) {
  const e = new SimEngine();
  const work = emptyWork(); work.achieved.dht22 = {};
  const out: Array<{ read: number[] | null; led: number; diags: string[] }> = [];
  let k = 0;
  let st: Record<string, { pass: boolean; detail?: string }> = {};
  for (const s of steps) {
    const r0 = setPartParams(doc0, 'U1', { temperature: s.t, humidity: s.h });
    if (!r0.ok) throw new Error(r0.errors.join());
    const doc = r0.doc, built = buildNetlist(doc);
    let con = '', an: ReturnType<typeof analyze> | null = null;
    for (let i = 0; i < s.dur / 0.25; i++) {
      const r = e.handle({ seq: ++k, netlist: built.netlist, advance: 0.25, restart: k === 1, watch: [], budgetMs: 1e9 });
      con += r.mcu?.[0]?.console ?? '';
      an = analyze(doc, built, r.result, r.tones);
      st = checkLesson('dht22', { doc, built, result: r.result, analysis: an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.dht22[g] = true;
    }
    out.push({ read: lastRead(con), led: an!.parts.LED1.current ?? 0, diags: an!.diagnostics.filter((d) => d.partId === 'U1').map((d) => `${d.severity}:${d.message}`) });
  }
  return { out, ach: work.achieved.dht22, st };
}

describe('DHT22 (AM2302) บัสสายเดียว + โมดูล dht ของ MicroPython', () => {
  it('รูปแบบข้อมูล: 65.2 %RH 35.1 °C → 0x028C 0x015F + checksum · อุณหภูมิติดลบตั้งบิตบนสุด', () => {
    expect(dht22Bytes(35.1, 65.2)).toEqual([0x02, 0x8c, 0x01, 0x5f, (0x02 + 0x8c + 0x01 + 0x5f) & 0xff]);
    expect(dht22Bytes(-10.1, 0)).toEqual([0, 0, 0x80, 0x65, (0x80 + 0x65) & 0xff]);
  });
  it('Pico อ่านค่าได้ตรงที่ตั้ง (ทุก 2 s): 31.4 °C 58.2 %RH และ −5.3 °C 20.0 %RH · ไม่มีคำเตือน · กระแสพัก ≈ 50 µA', { timeout: 120000 }, () => {
    const a = runDht(dhtRig({ t: 31.4, h: 58.2 }), 5);
    expect(lastRead(a.con)).toEqual([31.4, 58.2]);
    const x = a.an.parts.U1.extra!;
    expect(x.count).toBeGreaterThanOrEqual(2); expect(x.interval).toBeGreaterThan(1.95);
    expect(x.pull).toBe(10000);
    expect(a.an.parts.U1.current).toBeGreaterThan(4e-5); expect(a.an.parts.U1.current).toBeLessThan(6e-5);
    expect(a.an.diagnostics.filter((d) => d.partId === 'U1')).toEqual([]);
    expect(lastRead(runDht(dhtRig({ t: -5.3, h: 20 }), 3).con)).toEqual([-5.3, 20]);
  });
  it('ไม่มีตัวต้านทานดึงขึ้น → อ่านไม่ได้ (OSError) และเตือน · ดึงขึ้นไป VBUS 5 V → เตือนขา Pico', { timeout: 120000 }, () => {
    const a = runDht(dhtRig({ pullup: null }), 3);
    expect(a.con).toContain('read error');
    expect(lastRead(a.con)).toBeNull();
    expect(a.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('ดึงขึ้น'))).toBe(true);
    const b = runDht(dhtRig({ pullTo: 'VBUS' }), 0.5);
    expect(b.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('3.3 V'))).toBe(true);
  });
  it('อ่านถี่ทุก 0.5 s → แจ้งรอบการวัด ≥ 2 s · VDD จาก VBUS 5 V อ่านได้', { timeout: 120000 }, () => {
    const a = runDht(dhtRig({ code: DHT_CODE.replace('time.sleep(2)', 'time.sleep(0.5)') }), 2.5);
    expect(a.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('2 วินาที'))).toBe(true);
    expect(lastRead(runDht(dhtRig({ vdd: 'VBUS', t: 22.5, h: 45 }), 3).con)).toEqual([22.5, 45]);
  });
  it('แลป 41: เย็นแห้ง → ปกติ → ร้อนชื้น → ปกติ: ค่าที่อ่านตาม · LED เตือนติด/ดับ · ผ่านครบ 7 ข้อ', { timeout: 200000 }, () => {
    expect(LESSONS.find((l) => l.id === 'dht22')?.number).toBe(41);
    const { out, ach } = session(dhtRig().doc, [{ t: 20, h: 40, dur: 3 }, { t: 28, h: 60, dur: 2.5 }, { t: 37, h: 90, dur: 2.5 }, { t: 28, h: 60, dur: 2.5 }]);
    expect(out[0].read).toEqual([20, 40]); expect(out[2].read).toEqual([37, 90]);
    expect(out[2].led).toBeGreaterThan(1e-3); expect(out[3].led).toBeLessThan(1e-5);
    for (const g of ['power', 'data', 'pullup', 'read', 'sweep', 'slow', 'alarm']) expect(ach[g], g).toBe(true);
  });
});
