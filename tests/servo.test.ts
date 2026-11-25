import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
/** pw (ms) → duty_u16 ที่ 50 Hz */
const du = (ms: number) => Math.round((65535 * ms) / 20);
export const servoCode = (seq: Array<[number, number]>, loop = false) =>
  `from machine import Pin, PWM\nimport time\ns=PWM(Pin(15))\ns.freq(50)\n${loop ? 'while True:\n' : ''}${seq.map(([ms, wait]) => `${loop ? '  ' : ''}s.duty_u16(${du(ms)})\n${loop ? '  ' : ''}time.sleep(${wait})\n`).join('')}`;

/** Pico ที่ h5 + เซอร์โวบนโต๊ะ: สายแดง → VBUS (หรือ 3V3), น้ำตาล → GND, ส้ม → GP15 */
export function servoRig(code: string, o: { vcc?: 'VBUS' | '3V3'; load?: number } = {}) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code, autorun: true });
  b.part('servo', onTable(0, -24), 'M1', o.load !== undefined ? { loadTorque: o.load } : undefined)
    .wire(P('M1', 'V'), H(`a${col(b, o.vcc ?? 'VBUS')}`))
    .wire(P('M1', 'GND'), H(`j${col(b, 'GND.18')}`))
    .wire(P('M1', 'SIG'), H(`j${col(b, 'GP15')}`));
  return b;
}

export function runServo(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(b.doc);
  const trace: Array<{ t: number; angle: number; pw: number; period: number; an: ReturnType<typeof analyze> }> = [];
  let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  for (let k = 0; k < seconds / dt; k++) {
    r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    const an = analyze(b.doc, built, r.result, r.tones);
    const x = an.parts.M1.extra!;
    trace.push({ t: r.t, angle: x.angle, pw: x.pw, period: x.period, an });
  }
  return { trace, built, last: r };
}

describe('เซอร์โว SG90 + PWM จาก Pico', () => {
  it('PWM 50 Hz พัลส์ 1.45 ms → วัดคาบ 20 ms, พัลส์ 1.45 ms (±10 µs), แขนอยู่ที่ 90°', () => {
    const { trace } = runServo(servoRig(servoCode([[1.45, 0]])), 1.2);
    const l = trace[trace.length - 1];
    expect(Math.abs(l.period - 0.02)).toBeLessThan(2e-5);
    expect(Math.abs(l.pw - 1.45e-3)).toBeLessThan(1e-5);
    expect(Math.abs(l.angle - 90)).toBeLessThan(1);
    expect(l.an.diagnostics.filter((d) => d.partId === 'M1' && d.severity !== 'info')).toEqual([]);
  }, 60000);
  it('เปลี่ยนเป็น 0.5 ms → หมุนไป 0° ด้วยความเร็ว ≈ 0.1 s/60° (ที่ 5 V ≈ 625 °/s) แล้ว 2.4 ms → 180°', () => {
    const { trace } = runServo(servoRig(servoCode([[1.45, 1.0], [0.5, 1.0], [2.4, 1.0]])), 4.5, 0.02);
    const boot = trace.find((t) => t.pw > 0.4e-3 && t.pw < 0.6e-3)!; // เวลาที่เริ่มเห็นพัลส์ 0.5 ms
    expect(boot).toBeTruthy();
    // ภายใน 0.06 s หลังเห็นพัลส์ใหม่ แขนยังไม่ถึง 0° (กำลังหมุน)
    const mid = trace.find((t) => t.t >= boot.t + 0.04)!;
    expect(mid.angle).toBeGreaterThan(20); expect(mid.angle).toBeLessThan(85);
    const at0 = trace.find((t) => t.t >= boot.t + 0.3)!;
    expect(at0.angle).toBeLessThan(0.5);
    expect(Math.abs(trace[trace.length - 1].angle - 180)).toBeLessThan(0.5);
    // เวลาที่ใช้จาก 90° ถึง 0° ≈ 90/625 s
    const reach = trace.find((t) => t.t > boot.t && t.angle < 1)!;
    expect(reach.t - boot.t).toBeGreaterThan(0.1); expect(reach.t - boot.t).toBeLessThan(0.22);
  }, 120000);
  it('แรงบิดโหลด 0.9 kgf·cm (ที่ 5 V แรงบิดหยุดหมุน ≈ 1.875): หมุนช้าลงเหลือ ≈ 52 % (90° ใช้ ≈ 0.28 s) และกระแสมอเตอร์ ≈ 0.36 A', () => {
    const { trace } = runServo(servoRig(servoCode([[1.45, 1.0], [0.5, 1.5]]), { load: 0.9 }), 3.0, 0.02);
    const boot = trace.find((t) => t.pw > 0.4e-3 && t.pw < 0.6e-3)!;
    const reach = trace.find((t) => t.t > boot.t && t.angle < 1)!;
    const vcc = boot.an.parts.M1.extra!.vcc, k = 0.9 / (1.8 * Math.min(vcc, 6) / 4.8);
    const exp = 90 / (625 * (vcc / 5) * (1 - k));
    expect(Math.abs(reach.t - boot.t - exp)).toBeLessThan(0.05);
    const run = trace.find((t) => t.t > boot.t + 0.08 && t.t < reach.t - 0.02)!;
    const im = run.an.parts.M1.extra!.imotor, iexp = (0.2 + 0.3 * k) * vcc / 4.8;
    expect(Math.abs(im - iexp) / iexp).toBeLessThan(0.05);
    expect(trace.at(-1)!.an.parts.M1.extra!.imotor).toBe(0);
  }, 120000);
  it('แรงบิดโหลด 2.5 kgf·cm เกินแรงบิดหยุดหมุน: แขนค้างที่ 90° กินกระแสหยุดหมุน ≈ 0.5 A ค้าง + คำเตือน', () => {
    const { trace } = runServo(servoRig(servoCode([[0.5, 2.0]]), { load: 2.5 }), 1.5, 0.05);
    const l = trace.at(-1)!;
    expect(Math.abs(l.angle - 90)).toBeLessThan(0.5);
    expect(l.an.parts.M1.extra!.stalled).toBe(1);
    expect(Math.abs(l.an.parts.M1.extra!.imotor - 0.5 * l.an.parts.M1.extra!.vcc / 4.8)).toBeLessThan(0.03);
    expect(l.an.diagnostics.some((d) => d.partId === 'M1' && d.severity === 'warn' && /แรงบิดหยุดหมุน/.test(d.message))).toBe(true);
  }, 120000);
  it('ไฟเลี้ยงจาก 3V3: ไม่หมุน + คำเตือน VBUS', () => {
    const { trace } = runServo(servoRig(servoCode([[0.5, 0]]), { vcc: '3V3' }), 1.2);
    const l = trace[trace.length - 1];
    expect(Math.abs(l.angle - 90)).toBeLessThan(0.1);
    expect(l.an.diagnostics.some((d) => d.partId === 'M1' && d.message.includes('VBUS'))).toBe(true);
  }, 60000);
  it('แลป 23: กวาด 0° → 90° → 180° → ผ่าน power/signal/pwm50/angles; บันทึก/เปิดไฟล์ + schema 19', () => {
    expect(LESSONS.find((l) => l.id === 'servo')?.number).toBe(23);
    const b = servoRig(servoCode([[0.5, 0.5], [1.45, 0.5], [2.4, 0.5]], true));
    const { trace, built } = runServo(b, 3.0);
    const work = emptyWork(); work.achieved.servo = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    for (const t of trace) {
      st = checkLesson('servo', { doc: b.doc, built, result: t.an as never, analysis: t.an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.servo[g] = true;
    }
    expect({ ...work.achieved.servo, st }).toMatchObject({ power: true, signal: true, pwm50: true, angles: true });
    const doc = b.doc;
    const v = parseProject(serializeProject('s', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 19;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 120000);
});
