import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { ALARM_CODE, PULLDOWN_CODE, dht11Bytes, irDetected } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { setPartParams } from '../src/editor/ops';
import { emptyWork, type StudentWork } from '../src/model/types';
import type { Builder } from './helpers';
import { alarmRig, pulldownRig } from './sensor-rig';
import { dhtRig } from './dht-rig';

type Cmd = (t: number, b: Builder) => boolean | void;
const setP = (b: Builder, id: string, p: Record<string, unknown>) => { const x = setPartParams(b.doc, id, p as never); if (x.ok) b.doc = x.doc; return true; };
function runChecked(lab: string, b: Builder, seconds: number, dt: number, cmd?: Cmd) {
  const work: StudentWork = emptyWork(); work.achieved[lab] = {};
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '';
  let an!: ReturnType<typeof analyze>;
  const trace: Array<{ t: number; leds: Record<string, number>; pir?: { high: number; triggers: number; powered: number } }> = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson(lab, { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved[lab][g] = true;
    trace.push({ t, leds: Object.fromEntries(b.doc.parts.filter((p) => p.kind === 'led').map((p) => [p.id, Math.abs(an.parts[p.id]?.current ?? 0)])), pir: r.result.pirs?.PIR1 });
  }
  return { st, ach: work.achieved[lab], con, an, trace };
}
const at = (tr: ReturnType<typeof runChecked>['trace'], t: number) => tr.find((s) => Math.abs(s.t - t) < 1e-6)!;

describe('เซนเซอร์ชุด 2: DHT11 / PIR HC-SR501 / FC-51 และขาเข้าลอย', () => {
  it('DHT11: ข้อมูลจำนวนเต็ม + ทศนิยมอุณหภูมิ + checksum · FC-51 ระยะตามสีผิว · ระดับการรองรับ · รูปวงจร · บันทึกไฟล์', () => {
    expect(dht11Bytes(28, 60)).toEqual([60, 0, 28, 0, 88]);
    expect(dht11Bytes(25.6, 95)).toEqual([90, 0, 25, 6, 121]);
    expect(irDetected({ distance: 8, surface: 'white', threshold: 10 })).toBe(true);
    expect(irDetected({ distance: 8, surface: 'black', threshold: 10 })).toBe(false);
    expect(irDetected({ distance: 2.5, surface: 'black', threshold: 10 })).toBe(true);
    // DHT11 ครบตั้งแต่รอบ 75 (ผลการวัดครั้งก่อน, ความหน่วง, ช่วงหลังจ่ายไฟ — tests/dht11-behavior.test.ts) · PIR/FC-51 ยังบางส่วน
    expect(supportSummary(SUPPORT.dht11).text).toBe('จำลองครบ');
    expect(supportSummary(SUPPORT.pir).text).toBe('จำลองครบ');
    expect(supportSummary(SUPPORT.irobstacle).text).toBe('จำลองบางส่วน');
    for (const [id, n] of [['pulldown', 52], ['alarm', 53]] as const) { expect(LESSONS.find((l) => l.id === id)!.number).toBe(n); expect(SCHEMATICS[id]).toBeDefined(); }
    for (const r of [pulldownRig(), alarmRig()]) { const errs: string[] = []; expect(validateCircuit(JSON.parse(JSON.stringify(r.doc)), errs, []), errs.join()).not.toBeNull(); }
  });

  it('แลป 52: กด SW1 (ดึงลงภายนอก) → LED1 · กด SW2 (PULL_UP ภายใน) → LED2 · ปล่อยแล้วดับ · ผ่านครบ 3 ข้อ', { timeout: 300000 }, () => {
    const r = runChecked('pulldown', pulldownRig(), 4, 0.1, (t, b) => {
      if (Math.abs(t - 2) < 1e-6) return setP(b, 'SW1', { pressed: true });
      if (Math.abs(t - 2.5) < 1e-6) return setP(b, 'SW1', { pressed: false });
      if (Math.abs(t - 3) < 1e-6) return setP(b, 'SW2', { pressed: true });
      if (Math.abs(t - 3.5) < 1e-6) return setP(b, 'SW2', { pressed: false });
    });
    expect(r.con).toContain('SW1 = 1  SW2 = 1  presses: 1 0');
    expect(r.con).toContain('SW1 = 0  SW2 = 0  presses: 1 1');
    expect(at(r.trace, 2.4).leds.LED1).toBeGreaterThan(2e-3);
    expect(at(r.trace, 2.9).leds.LED1).toBeLessThan(1e-4);
    expect(at(r.trace, 3.4).leds.LED2).toBeGreaterThan(2e-3);
    for (const g of ['wire', 'pulldown', 'pullup']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('แลป 52 ไม่มีตัวต้านทานดึงลง: ปล่อย SW1 แล้ว GP14 ลอย → ค่าค้าง 1 (LED1 ติดค้าง) + คำเตือนขาลอย · pulldown ไม่ผ่าน', { timeout: 300000 }, () => {
    const r = runChecked('pulldown', pulldownRig({ noPulldown: true }), 3, 0.1, (t, b) => {
      if (Math.abs(t - 2) < 1e-6) return setP(b, 'SW1', { pressed: true });
      if (Math.abs(t - 2.5) < 1e-6) return setP(b, 'SW1', { pressed: false });
    });
    expect(at(r.trace, 2.9).leds.LED1).toBeGreaterThan(2e-3);
    expect(r.an.diagnostics.some((d) => d.severity === 'warn' && d.partId === 'PICO1' && d.message.includes('GP14') && d.message.includes('ลอย'))).toBe(true);
    expect(r.ach.pulldown ?? false).toBe(false);
  });

  it('แลป 53: PIR (H) เดินผ่าน 1 s → LED แดงติดค้าง 5 s แล้วดับ · ช่วงไม่รับสัญญาณ 2.5 s · FC-51 → LED เหลือง · DHT11 28 °C 60 % · ผ่านครบ 5 ข้อ', { timeout: 600000 }, () => {
    const r = runChecked('alarm', alarmRig(), 13, 0.1, (t, b) => {
      if (Math.abs(t - 3) < 1e-6) return setP(b, 'PIR1', { motion: true });
      if (Math.abs(t - 4) < 1e-6) return setP(b, 'PIR1', { motion: false });
      if (Math.abs(t - 9.5) < 1e-6) return setP(b, 'PIR1', { motion: true });   // ยังอยู่ในช่วงไม่รับสัญญาณ (ดับที่ 9.0 + 2.5 s)
      if (Math.abs(t - 10) < 1e-6) return setP(b, 'PIR1', { motion: false });
      if (Math.abs(t - 11) < 1e-6) return setP(b, 'IR1', { distance: 5 });
      if (Math.abs(t - 12) < 1e-6) return setP(b, 'IR1', { distance: 100 });
    });
    expect(at(r.trace, 3.5).leds.LEDA).toBeGreaterThan(2e-3);
    expect(at(r.trace, 8.8).leds.LEDA).toBeGreaterThan(2e-3);   // หน่วง 5 s นับจากการเคลื่อนไหวครั้งสุดท้าย (4.0 s)
    expect(at(r.trace, 9.3).leds.LEDA).toBeLessThan(1e-4);
    expect(at(r.trace, 9.8).leds.LEDA).toBeLessThan(1e-4);      // ไม่รับสัญญาณ
    expect(at(r.trace, 13).pir?.triggers).toBe(1);
    expect(at(r.trace, 11.5).leds.LEDD).toBeGreaterThan(2e-3);
    expect(at(r.trace, 12.5).leds.LEDD).toBeLessThan(1e-4);
    expect(r.con).toContain('MOTION!');
    expect(r.con).toContain('T=28 C  H=60 %');
    expect(r.con).not.toContain('OSError');
    for (const g of ['wire', 'motion', 'hold', 'obstacle', 'climate']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('บัสสายเดียว: หลังโฮสต์ปล่อยสาย (เอาต์พุต → ขาเข้า) ขาเข้าเห็นระดับใหม่ทันที — การอ่าน DHT22 ครั้งแรกไม่เลื่อนบิต (ก้าว 0.1 s)', { timeout: 300000 }, () => {
    const b = dhtRig();
    const e = new SimEngine();
    const built = buildNetlist(b.doc);
    let con = '';
    for (let k = 0; k < 15; k++) con += e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.1, restart: k === 0, watch: [], budgetMs: 1e9 }).mcu?.[0]?.console ?? '';
    // เดิม (ก่อนแก้): ขาเข้าค้างระดับต่ำหลังปล่อยสายจนจบช่วง 50 µs → อ่านช่วงสูงก่อนตอบเป็นบิตแรก → "T = 15.0 C  RH = 3309.3 %"
    expect(con).toMatch(/>>> T = 30\.0 C  RH = 65\.0 %/);
  });

  it('PIR ระยะ/มุม (กรวย 110°, ระยะปรับ 3–7 m): 8 m หรือมุม 70° ไม่ตรวจพบ · 5 m ที่ Sx = 4 m ไม่พบ · 5 m มุม 40° ที่ 7 m พบ · โค้ด Pico อ่าน OUT ได้ตาม', { timeout: 600000 }, () => {
    const code = 'from machine import Pin\nimport time\np = Pin(14, Pin.IN)\nwhile True:\n    print("R", p.value()); time.sleep_ms(200)\n';
    for (const [prm, exp] of [[{ distance: 8 }, 0], [{ distance: 2, angle: 70 }, 0], [{ distance: 5, senseRange: 4 }, 0], [{ distance: 5, angle: 40 }, 1]] as const) {
      const b = alarmRig({ code });
      setP(b, 'PIR1', { motion: true, holdTime: 5, ...prm });
      const r = runChecked('alarm', b, 1.5, 0.1);
      expect(at(r.trace, 1.5).pir?.high, JSON.stringify(prm)).toBe(exp);
      expect([...r.con.matchAll(/R (\d)/g)].at(-1)?.[1], JSON.stringify(prm)).toBe(String(exp));
      if (!exp) expect(r.an.diagnostics.some((d) => d.partId === 'PIR1' && /นอกระยะ/.test(d.message))).toBe(true);
    }
  });

  it('PIR ช่วงเริ่มต้นหลังจ่ายไฟ (จำลอง ≈ 60 s): การเคลื่อนไหวจริงยังไม่ตรวจพบ · มีสัญญาณหลอกที่ 20 s และ 40 s · หลัง 60 s ตรวจพบตามปกติ', { timeout: 900000 }, () => {
    const b = alarmRig({ code: '' });
    setP(b, 'PIR1', { warmup: true, holdTime: 5, mode: 'L' });
    const r = runChecked('alarm', b, 66, 0.5, (t, bb) => (Math.abs(t - 5) < 1e-6 ? setP(bb, 'PIR1', { motion: true }) : Math.abs(t - 6) < 1e-6 ? setP(bb, 'PIR1', { motion: false }) : Math.abs(t - 62) < 1e-6 ? setP(bb, 'PIR1', { motion: true }) : false));
    const hi = (t: number) => at(r.trace, t).pir?.high;
    expect(hi(5.5)).toBe(0);                       // เคลื่อนไหวจริงช่วงเริ่มต้น: ไม่พบ
    expect([hi(19.5), hi(21), hi(24.5), hi(26)]).toEqual([0, 1, 1, 0]); // สัญญาณหลอก 20 s (สูง 5 s)
    expect(hi(41)).toBe(1);
    expect(hi(58)).toBe(0);
    expect(hi(63)).toBe(1);                         // หลังช่วงเริ่มต้น
    expect(at(r.trace, 66).pir?.triggers).toBe(3);
  });

  it('PIR โหมด L: เคลื่อนไหวต่อเนื่อง → สูง 5 s → ต่ำ 2.5 s → ทริกเกอร์ใหม่ · PIR ใช้ 3V3 → ไม่ทำงาน + คำเตือน · FC-51 ใช้ 5 V → อันตราย', { timeout: 600000 }, () => {
    const b = alarmRig({ code: '' });
    setP(b, 'PIR1', { mode: 'L', motion: true });
    const r = runChecked('alarm', b, 11, 0.1);
    const hi = (t: number) => at(r.trace, t).pir?.high;
    // ทริกเกอร์ตั้งแต่จ่ายไฟ (t ≈ 0) → สูงถึง 5 s → ไม่รับสัญญาณถึง 7.5 s → ทริกเกอร์ใหม่
    expect([hi(1), hi(4.8), hi(5.5), hi(7.3), hi(7.8)]).toEqual([1, 1, 0, 0, 1]);
    const lo = runChecked('alarm', (() => { const x = alarmRig({ code: '', pirVcc: '3V3' }); setP(x, 'PIR1', { motion: true }); return x; })(), 1, 0.1);
    expect(at(lo.trace, 1).pir?.powered).toBe(0);
    expect(lo.an.diagnostics.some((d) => d.partId === 'PIR1' && d.message.includes('4.5 V'))).toBe(true);
    const hv = runChecked('alarm', alarmRig({ code: '', obsVcc: 'VBUS' }), 0.5, 0.1);
    expect(hv.an.diagnostics.some((d) => d.severity === 'danger' && d.partId === 'IR1')).toBe(true);
    void ALARM_CODE; void PULLDOWN_CODE;
  });
});
