import { describe, expect, it } from 'vitest';
import motorHex from './fixtures/uno/unoq-motor.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { buildMotor, MOTOR_CODE } from '../src/projects/final-projects';
import type { CircuitDoc } from '../src/model/types';

/**
 * ตัวแก้สมการตามเวลาเมื่อ PWM ขับมอเตอร์ผ่าน L293D (แม่แบบโปรเจกต์จบ 5 — รอบ 86)
 * เดิม: ทุกขอบ PWM (≈ 980 ครั้ง/วินาที) ก้าวถูกแบ่งลงจนถึง H_MIN (ขา EN ข้ามเกณฑ์ตั้งแต่ต้นก้าว) และก้าวหดสะสมเพราะกระแสมอเตอร์เปลี่ยนตลอด
 * + Newton เดินลงจากไบแอสตรงสูงของไดโอดรอบละ nVt → จำลองช้ากว่าเวลาจริง ≈ 43 เท่า (Node)
 * ตรวจด้วยจำนวนก้าวของตัวแก้สมการ (คงที่ทุกเครื่อง ไม่ขึ้นกับความเร็วเครื่อง) และค่าทางกายภาพเทียบกับตัวแก้เดิม
 * ค่าอ้างอิงจากตัวแก้เดิม (VR 75%, t = 0.8 s): 79.73 rpm, กระแสมอเตอร์ 0.2259 A, แรงดันเฉลี่ย 2.5485 V · จำนวนก้าวใน 0.3 s แรก = 12,314
 */
function runMotor(seconds: number) {
  const d0 = buildMotor();
  const doc = { ...d0, parts: d0.parts.map((p) => (p.id === 'UNOQ1' ? { ...p, params: { ...p.params, hex: motorHex, hexSrc: MOTOR_CODE } } : p)) } as CircuitDoc;
  const built = buildNetlist(doc);
  const e = new SimEngine();
  let steps = 0;
  let last: ReturnType<SimEngine['handle']> | null = null;
  const stepsAt: number[] = [];
  for (let k = 0; k < Math.round(seconds / 0.05); k++) {
    last = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
    steps += last.steps;
    stepsAt.push(steps);
  }
  return { steps, stepsAt, an: analyze(doc, built, last!.result, last!.tones) };
}

describe('ตัวแก้สมการ: PWM ขับมอเตอร์ผ่าน L293D', () => {
  it('จำนวนก้าวลดลงจากเดิมเกินครึ่ง (0.3 s แรก ≤ 7,500 ก้าว · เดิม 12,314) และค่าทางกายภาพที่ 0.8 s ตรงกับตัวแก้เดิม ±1%', { timeout: 300000 }, () => {
    const { stepsAt, an } = runMotor(0.8);
    expect(stepsAt[5]).toBeLessThan(7500);
    const m = an.parts.M1;
    expect(Math.abs(m.extra!.rpm / 79.73 - 1)).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(m.current) / 0.2259 - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.voltage / 2.5485 - 1)).toBeLessThan(0.01);
    expect(an.diagnostics.filter((d) => d.severity === 'danger')).toEqual([]);
  });
});
