import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

const HEAD = 'from machine import Pin\nimport time\npins = [Pin(p, Pin.OUT) for p in (10, 11, 12, 13)]\nHALF = [(1,0,0,0), (1,1,0,0), (0,1,0,0), (0,1,1,0), (0,0,1,0), (0,0,1,1), (0,0,0,1), (1,0,0,1)]\n\ndef step(n, d=1, us=2000, seq=HALF):\n    global k\n    for _ in range(n):\n        k = (k + d) % len(seq)\n        for p, v in zip(pins, seq[k]):\n            p.value(v)\n        time.sleep_us(us)\n\ndef off():\n    for p in pins:\n        p.value(0)\n\nk = 0\n';
/** หมุนไป 90° (1024 ฮาล์ฟสเต็ป) หยุด แล้วถอยกลับ 45° */
export const STEP_CODE = HEAD + 'step(1024, 1, 2000)\noff()\nprint("ไป 90 องศา")\ntime.sleep_ms(300)\nstep(512, -1, 2000)\noff()\nprint("กลับ 45 องศา")\n';
export const stepCode = (body: string) => HEAD + body;
const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/** Pico ที่ h1 · ชุดสเต็ปเปอร์บนโต๊ะด้านหน้า · GP10–GP13 → IN1–IN4, VBUS → +, GND → − */
export function stepRig(o: { code?: string; vcc?: 'VBUS' | '3V3'; noGnd?: boolean; swap?: boolean } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? STEP_CODE, autorun: true }).part('stepper', onTable(36, 0), 'M1');
  const gp = [10, 11, 12, 13];
  const ins = o.swap ? ['IN1', 'IN3', 'IN2', 'IN4'] : ['IN1', 'IN2', 'IN3', 'IN4'];
  gp.forEach((g, k) => b.wire(H(`j${col(b, `GP${g}`)}`), P('M1', ins[k]), undefined, ['#1e63c6', '#f48fb1', '#f4d03f', '#f28c28'][k]));
  b.wire(H(`a${col(b, o.vcc ?? 'VBUS')}`), P('M1', 'V'), undefined, '#e53935');
  if (!o.noGnd) b.wire(H(`j${col(b, 'GND.18')}`), P('M1', 'G'), undefined, '#212121');
  return b;
}

export function runStep(b: Builder, dur: number, step = 0.05) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  const work = emptyWork(); work.achieved.stepper = {};
  const snaps: Array<{ t: number; x: Record<string, number>; con: string; diags: string[] }> = [];
  let con = '';
  for (let i = 0; i <= dur / step; i++) {
    const r = e.handle({ seq: i, netlist: built.netlist, advance: i ? step : 0, restart: i === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    const an = analyze(doc, built, r.result, r.tones);
    const st = checkLesson('stepper', { doc, built, result: r.result, analysis: an, work });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.stepper[g] = true;
    snaps.push({ t: i * step, x: an.parts.M1.extra!, con, diags: an.diagnostics.filter((d) => d.partId === 'M1').map((d) => `${d.severity}:${d.message}`) });
  }
  return { snaps, work };
}

describe('สเต็ปเปอร์มอเตอร์ 28BYJ-48 + ULN2003', () => {
  it('ULN2003 (DC): ขาเข้า 3.3 V → ขดลวดมีไฟ ≈ 82 mA, VCE(sat) ≈ 0.8–1.0 V; ขาเข้า 0 V → ดับ; LED บนบอร์ดติดตามเฟส', () => {
    const rig = (vin: number) => new Builder().part('dcsupply', onTable(-30, 0), 'PS1', { voltage: 5 }).part('dcsupply', onTable(-30, 14), 'PS2', { voltage: vin })
      .part('stepper', onTable(36, 0), 'M1').wire(P('PS1', 'pos'), P('M1', 'V')).wire(P('PS1', 'neg'), P('M1', 'G'))
      .wire(P('PS2', 'pos'), P('M1', 'IN1')).wire(P('PS2', 'neg'), P('M1', 'G')).doc;
    const on = simulate(rig(3.3)).analysis.parts.M1.extra!;
    expect(on.ic1).toBeGreaterThan(0.075); expect(on.ic1).toBeLessThan(0.09);
    expect(on.vsat).toBeGreaterThan(0.75); expect(on.vsat).toBeLessThan(1.05);
    expect(on.iled1).toBeGreaterThan(1.5e-3); expect(on.ic2).toBeLessThan(1e-6); expect(on.mask).toBe(1);
    const off = simulate(rig(0)).analysis.parts.M1.extra!;
    expect(off.ic1).toBeLessThan(1e-6); expect(off.iled1).toBeLessThan(1e-6);
  });
  it('Pico ฮาล์ฟสเต็ป 1024 สเต็ป (2 ms/สเต็ป) → แกนออก 90.0°; ถอยกลับ 512 → 45.0°; ไม่หลุดสเต็ป; rpm = ความถี่สเต็ป × 60 / 4096', () => {
    const { snaps } = runStep(stepRig(), 4.6);
    const fwd = snaps.find((s) => s.con.includes('ไป 90'))!, end = snaps[snaps.length - 1];
    expect(fwd.x.angle).toBeCloseTo(90, 6);
    expect(end.con).toContain('กลับ 45');
    expect(end.x.angle).toBeCloseTo(45, 6);
    expect(end.x.missed).toBe(0);
    const mid = snaps.filter((s) => s.x.stepRate > 0 && !s.con.includes('ไป 90'));
    const m = mid[Math.floor(mid.length / 2)].x;
    // ดีเลย์ 2 ms + เวลารันโค้ด Python ต่อสเต็ป → ราว 400–500 สเต็ป/วินาที
    expect(m.stepRate).toBeGreaterThan(380); expect(m.stepRate).toBeLessThan(500);
    expect(Math.abs(m.rpm - (m.stepRate * 60) / 4096)).toBeLessThan(0.05);
  }, 180000);
  it('ฟูลสเต็ป 2 เฟส (ทอร์กสูง) 256 สเต็ป (4 ms) ≈ 45°; สเต็ปถี่ 0.5 ms (2000 Hz) → หลุดสเต็ป ไม่หมุน + แจ้ง', () => {
    const full = runStep(stepRig({ code: stepCode('FULL = [(1,1,0,0), (0,1,1,0), (0,0,1,1), (1,0,0,1)]\nk = 0\nstep(256, 1, 4000, FULL)\noff()\nprint("ok")\n') }), 1.8).snaps.at(-1)!;
    // โรเตอร์เริ่มที่เฟส A (ตำแหน่ง 0): ฟูลสเต็ปแรกคือ BC (ตำแหน่ง 3) ดึงไป 3 ฮาล์ฟสเต็ป แล้วอีก 255 × 2 → 513 ฮาล์ฟสเต็ป
    expect(full.x.pos).toBe(513);
    expect(full.x.angle).toBeCloseTo((513 * 360) / 4096, 6);
    expect(full.x.missed).toBe(0);
    const fast = runStep(stepRig({ code: stepCode('step(400, 1, 500)\nprint("ok")\n') }), 0.6).snaps.at(-1)!;
    expect(fast.x.missed).toBeGreaterThan(50);
    expect(Math.abs(fast.x.angle)).toBeLessThan(2);
    expect(fast.diags.some((d) => d.includes('หลุดสเต็ป'))).toBe(true);
  }, 180000);
  it('ไฟ 3V3 → กระแสขดลวดไม่พอ ไม่หมุน + เตือน; สลับสาย IN2/IN3 → ลำดับผิด หมุนไม่ได้/หลุด', () => {
    const lo = runStep(stepRig({ vcc: '3V3', code: stepCode('step(200, 1, 2000)\nprint("ok")\n') }), 0.6).snaps.at(-1)!;
    expect(Math.abs(lo.x.angle)).toBeLessThan(0.5);
    expect(lo.diags.some((d) => d.startsWith('warn') && d.includes('VBUS'))).toBe(true);
    const sw = runStep(stepRig({ swap: true, code: stepCode('step(400, 1, 2000)\nprint("ok")\n') }), 1.0).snaps.at(-1)!;
    expect(Math.abs(sw.x.angle)).toBeLessThan(10);
    expect(sw.x.missed).toBeGreaterThan(50);
  }, 180000);
  it('แลป 32 ผ่านครบ; ไม่ต่อกราวด์ร่วม → ไม่ผ่านไฟเลี้ยง; บันทึก/เปิดไฟล์ + schema 28', () => {
    expect(LESSONS.find((l) => l.id === 'stepper')?.number).toBe(32);
    const { work } = runStep(stepRig({ code: STEP_CODE + 'step(400, 1, 500)\n' }), 5.0);
    expect(work.achieved.stepper).toMatchObject({ power: true, inputs: true, turn: true, reverse: true, speed: true });
    const bad = runStep(stepRig({ noGnd: true, code: stepCode('step(100, 1, 2000)\n') }), 0.4).work;
    expect(bad.achieved.stepper.power).toBeFalsy();
    const d = stepRig().doc;
    const v = parseProject(serializeProject('t', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 28;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 180000);
});
