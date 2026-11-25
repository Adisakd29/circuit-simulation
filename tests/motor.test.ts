import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { diodeParamsFor, mosfetParamsFor } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';

/** มอเตอร์ต่อแหล่งจ่ายตรง (ทดสอบแบบจำลองมอเตอร์) */
export function direct(v: number, o: { load?: number; reverse?: boolean } = {}) {
  return new Builder()
    .part('dcsupply', onTable(-30, 0), 'PS1', { voltage: v, currentLimit: 3 })
    .part('motor', onTable(10, -28), 'M1', o.load ? { loadTorque: o.load } : undefined)
    .wire(P('PS1', 'pos'), P('M1', o.reverse ? 'B' : 'A')).wire(P('PS1', 'neg'), P('M1', o.reverse ? 'A' : 'B'));
}

export const pwmCode = (seq: Array<[number, number]>, loop = false, f = 1000) =>
  `from machine import Pin, PWM\nimport time\nm=PWM(Pin(15))\nm.freq(${f})\n${loop ? 'while True:\n' : ''}${seq.map(([d, w]) => `${loop ? '  ' : ''}m.duty_u16(${Math.round(d * 65535)})\n${loop ? '  ' : ''}time.sleep(${w})\n`).join('')}`;

/**
 * Pico (h5) GP15 → เกต IRLZ44N (b26 G, b27 D, b28 S) + 10 kΩ ดึงลง (tn26–a26), S → ราง −,
 * PS1 6 V: + → ราง tp (สายแดงมอเตอร์), − → ราง tn; สายดำมอเตอร์ → D; 1N4007 แอโนด a27 แคโทด tp27; GND Pico → tn8
 */
export function pwmRig(code: string, o: { noDiode?: boolean; direct?: boolean } = {}) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code, autorun: true })
    .part('dcsupply', onTable(-30, -22), 'PS1', { voltage: 6, currentLimit: 3 })
    .part('motor', onTable(18, -28), 'M1')
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(H('a7'), H('tn8'));
  const gp = pinHolesFor(b.doc.parts[0]).find((x) => x.pin === 'GP15')!.hole!.slice(1);
  if (o.direct) return b.wire(P('M1', 'A'), H(`j${gp}`)).wire(P('M1', 'B'), H('tn30'));
  b.part('mosfet', onBoard('b26'), 'Q1', mosfetParamsFor('IRLZ44N'))
    .part('resistor', onBoard('tn26', 90), 'RG', { resistance: 10000, span: 2 })
    .wire(H(`j${gp}`), H('c26')).wire(H('a28'), H('tn28'))
    .wire(P('M1', 'A'), H('tp30')).wire(P('M1', 'B'), H('e27'));
  if (!o.noDiode) b.part('diode', onBoard('a27', 270), 'D1', { ...diodeParamsFor('1N4007'), span: 3 });
  return b;
}

export function runMotor(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(b.doc);
  let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  const trace: Array<{ t: number; rpm: number; i: number; an: ReturnType<typeof analyze> }> = [];
  for (let k = 0; k < seconds / dt; k++) {
    r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    const an = analyze(b.doc, built, r.result, r.tones);
    trace.push({ t: r.t, rpm: an.parts.M1.extra!.rpm, i: an.parts.M1.current, an });
  }
  return { trace, built, last: r };
}

describe('มอเตอร์ DC เกียร์ TT', () => {
  it('ต่อ 6 V ตรง: เร่งถึง ≈ 250 rpm (±8%) กระแสไม่มีโหลด ≈ 0.16 A; 3 V ≈ 120 rpm 0.15 A (ค่าวัดของ Adafruit)', () => {
    const a = runMotor(direct(6), 1.0).trace.at(-1)!, b = runMotor(direct(3), 1.0).trace.at(-1)!;
    expect(Math.abs(a.rpm / 250 - 1)).toBeLessThan(0.08); expect(Math.abs(a.i - 0.16)).toBeLessThan(0.02);
    expect(Math.abs(b.rpm / 120 - 1)).toBeLessThan(0.1); expect(Math.abs(b.i - 0.15)).toBeLessThan(0.02);
  }, 60000);
  it('กระแสตอนเริ่มหมุนสูง (ใกล้กระแสหยุดค้าง 6/3.5 A) แล้วลดลงเมื่อแรงเคลื่อนไฟฟ้าย้อนกลับเพิ่ม', () => {
    const { trace } = runMotor(direct(6), 0.4, 0.002);
    expect(Math.max(...trace.map((t) => t.i))).toBeGreaterThan(1.2);
    expect(trace.at(-1)!.i).toBeLessThan(0.2);
    const t63 = trace.find((t) => t.rpm > 0.63 * trace.at(-1)!.rpm)!.t;
    expect(t63).toBeGreaterThan(0.01); expect(t63).toBeLessThan(0.12);
  }, 60000);
  it('กลับขั้ว → หมุนกลับทิศ; โหลดเกินแรงบิดหยุดค้าง → หยุดค้าง กระแส ≈ 1.7 A + คำเตือน', () => {
    expect(runMotor(direct(6, { reverse: true }), 1.0).trace.at(-1)!.rpm).toBeLessThan(-200);
    const s = runMotor(direct(6, { load: 0.2 }), 0.6).trace.at(-1)!;
    expect(Math.abs(s.rpm)).toBeLessThan(1);
    expect(s.i).toBeGreaterThan(1.6); expect(s.i).toBeLessThan(1.8);
    expect(s.an.diagnostics.some((d) => d.partId === 'M1' && d.message.includes('หยุดค้าง'))).toBe(true);
  }, 60000);
  it('Pico PWM 1 kHz → IRLZ44N: duty 100% ≈ เต็มความเร็ว, 50% และ 25% ช้าลงตามลำดับ, 0% หยุด; ไดโอดกันย้อนจำกัดแรงดันเดรน', () => {
    const { trace } = runMotor(pwmRig(pwmCode([[1, 1.2], [0.5, 1.2], [0.25, 1.2], [0, 1.2]])), 5.4, 0.05);
    const at = (t: number) => trace.find((x) => x.t >= t)!;
    // บูต MicroPython ≈ 0.3–0.5 s ก่อนเริ่มโค้ด → อ่านค่าท้ายแต่ละช่วง
    const boot = trace.find((x) => x.rpm > 5)!.t - 0.05;
    const r100 = at(boot + 1.1).rpm, r50 = at(boot + 2.3).rpm, r25 = at(boot + 3.5).rpm, r0 = at(boot + 4.7).rpm;
    expect(r100).toBeGreaterThan(200); expect(r100).toBeLessThan(270);
    // ไม่มีโหลด: กระแสขาดช่วงระหว่างช่วงปิด (discontinuous) แรงดันขั้วจึงเท่ากับ E ทำให้ความเร็วสูงกว่าสัดส่วน duty — เหมือนมอเตอร์จริง
    expect(r50).toBeGreaterThan(0.4 * r100); expect(r50).toBeLessThan(0.9 * r100);
    expect(r25).toBeGreaterThan(5); expect(r25).toBeLessThan(r50 * 0.9);
    expect(Math.abs(r0)).toBeLessThan(1);
    const vd = Math.max(...trace.map((x) => x.an.parts.Q1.voltage));
    expect(vd).toBeLessThan(7.5);
    expect(trace.at(-1)!.an.diagnostics.filter((d) => d.partId === 'M1' && d.severity !== 'info')).toEqual([]);
  }, 300000);
  it('ไม่มีไดโอด → เตือน; ต่อขา GPIO ตรงกับมอเตอร์ → อันตราย', () => {
    const a = runMotor(pwmRig(pwmCode([[0.5, 1]]), { noDiode: true }), 0.8).trace.at(-1)!;
    expect(a.an.diagnostics.some((d) => d.partId === 'M1' && d.message.includes('ไดโอดกันย้อน'))).toBe(true);
    const b = runMotor(pwmRig(pwmCode([[1, 1]]), { direct: true }), 0.6).trace.at(-1)!;
    expect(b.an.diagnostics.some((d) => d.partId === 'M1' && d.severity === 'danger' && d.message.includes('GPIO'))).toBe(true);
  }, 300000);
  it('แลป 24: driver/flyback/power/speed ผ่าน และ stop (ไม่บังคับ); บันทึก/เปิดไฟล์ + schema 20', () => {
    expect(LESSONS.find((l) => l.id === 'motor')?.number).toBe(24);
    const b = pwmRig(pwmCode([[1, 1], [0.4, 1], [0, 0.6]]));
    const { trace, built } = runMotor(b, 3.4, 0.05);
    const work = emptyWork(); work.achieved.motor = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    for (const t of trace) {
      st = checkLesson('motor', { doc: b.doc, built, result: t.an as never, analysis: t.an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.motor[g] = true;
    }
    expect({ ...work.achieved.motor, st }).toMatchObject({ driver: true, flyback: true, power: true, speed: true, stop: true });
    const v = parseProject(serializeProject('m', b.doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(b.doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 20;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 300000);
});
