import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC, type SimResult } from '../src/sim/solver';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork, type CircuitDoc, type Part } from '../src/model/types';

/**
 * เทอร์โมสตัท (แลป 37): LM393 ที่ f20 (ขา 1 OUTA f20, 2 INA− f21, 3 INA+ f22, 4 GND f23 · ขา 8 VCC e20, 7 OUTB e21, 6 INB− e22, 5 INB+ e23)
 * ราง: PS+ → tp2, PS− → tn2, สะพาน tp3 → bp3, tn4 → bn4
 * INA+ = VT จากวงแบ่ง R1 10 kΩ (i18–i22, ขา 18 → B+) กับ NTC (h22–h23 = GND)
 * INA− = VREF จากทริมพอต 10 kΩ ที่ h12 (ขา 1 → B+, ขา 3 → B−, แกนกลาง g13 → g21)
 * ขาออก: LED (A h19, K h20) + 470 Ω (g15–g19, ขา 15 → B+) · ช่อง B ไม่ใช้: INB± ต่อ GND
 */
export function thermoRig(o: { t?: number; pos?: number; rh?: number | null } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
    .part('comparator', onBoard('f20'), 'U1')
    .part('resistor', onBoard('i18'), 'R1', { resistance: 10000, span: 4 })
    .part('ntc', onBoard('h22'), 'TH1', { temperature: o.t ?? 25, span: 1 })
    .part('potentiometer', onBoard('h12'), 'VR1', { resistance: 10000, position: o.pos ?? 0.654 })
    .part('led', onBoard('h19'), 'LED1', { color: 'red' })
    .part('resistor', onBoard('g15'), 'R2', { resistance: 470, span: 4 })
    .wire(P('PS1', 'pos'), H('tp2'), 'wp')
    .wire(P('PS1', 'neg'), H('tn2'), 'wn', '#212121')
    .wire(H('tp3'), H('bp3'), 'w1')
    .wire(H('tn4'), H('bn4'), 'w2', '#212121')
    .wire(H('tp20'), H('a20'), 'w3')
    .wire(H('j23'), H('bn23'), 'w4', '#212121')
    .wire(H('j18'), H('bp18'), 'w5')
    .wire(H('j12'), H('bp12'), 'w6')
    .wire(H('j14'), H('bn14'), 'w7', '#212121')
    .wire(H('g13'), H('g21'), 'w8', '#1e88e5')
    .wire(H('j15'), H('bp15'), 'w9')
    .wire(H('d22'), H('tn22'), 'w10', '#212121')
    .wire(H('d23'), H('tn23'), 'w11', '#212121');
  if (o.rh) b.part('resistor', onBoard('g20'), 'RH', { resistance: o.rh, span: 2 });
  return b;
}
export const set = (doc: CircuitDoc, id: string, params: Record<string, unknown>): CircuitDoc => ({ ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, params: { ...p.params, ...params } } as Part : p)) });
function step(doc: CircuitDoc, prev?: SimResult) {
  const built = buildNetlist(doc);
  const result = solveDC(built.netlist, { relayStates: prev?.relayStates });
  return { built, result, analysis: analyze(doc, built, result) };
}

const at = (t: number, o: { rh?: number | null; pos?: number } = {}, prev?: SimResult) => step(thermoRig({ ...o, t }).doc, prev);
/** กวาดอุณหภูมิทีละ 0.25 °C (ส่งสถานะค้างต่อ) → อุณหภูมิแรกที่ LED ติด/ดับ */
function sweep(rh: number | null) {
  let prev: SimResult | undefined, tOn = NaN, tOff = NaN;
  for (let t = 30; t <= 50; t += 0.25) { const s = at(t, { rh }, prev); prev = s.result; if (Number.isNaN(tOn) && s.analysis.parts.U1.extra!.onA) tOn = t; }
  for (let t = 50; t >= 30; t -= 0.25) { const s = at(t, { rh }, prev); prev = s.result; if (Number.isNaN(tOff) && !s.analysis.parts.U1.extra!.onA) tOff = t; }
  return { tOn, tOff };
}

describe('คอมพาราเตอร์ LM393 (เทอร์โมสตัท)', () => {
  it('25 °C: VT > VREF ขาออกลอย LED ดับ · 45 °C: ขาออกดึงลง VOL ≈ 0.37 V LED ≈ 6 mA · กลับ 25 °C ดับ', () => {
    let s = at(25);
    let x = s.analysis.parts.U1.extra!;
    expect(x.onA).toBe(0); expect(x.vpA).toBeGreaterThan(x.vnA);
    expect(s.analysis.parts.LED1.current).toBeLessThan(1e-4);
    s = at(45, {}, s.result); x = s.analysis.parts.U1.extra!;
    expect(x.onA).toBe(1); expect(x.voA).toBeGreaterThan(0.3); expect(x.voA).toBeLessThan(0.45); // VOL ≈ 62.5 Ω × 6 mA
    expect(s.analysis.parts.LED1.current).toBeGreaterThan(5e-3); expect(s.analysis.parts.LED1.current).toBeLessThan(7e-3);
    s = at(25, {}, s.result);
    expect(s.analysis.parts.U1.extra!.onA).toBe(0);
    expect(s.analysis.diagnostics.filter((d) => d.partId === 'U1')).toEqual([]);
  });
  it('ไม่มี RH: ติด/ดับที่อุณหภูมิเดียวกัน (≈ 40 °C) · RH 100 kΩ: จุดติดสูงกว่าจุดดับ 1.5–4 °C (hysteresis)', () => {
    const a = sweep(null), b = sweep(100000);
    expect(Math.abs(a.tOn - 40.5)).toBeLessThan(1); expect(Math.abs(a.tOn - a.tOff)).toBeLessThanOrEqual(0.25);
    expect(b.tOn - b.tOff).toBeGreaterThan(1.5); expect(b.tOn - b.tOff).toBeLessThan(4);
  });
  it('ขาออกป้อนกลับเข้า IN− (ป้อนกลับลบ) → แจ้งว่าคอมพาราเตอร์สลับสถานะไม่หยุด', () => {
    const d0 = thermoRig().doc;
    const b = new Builder(); b.doc = { ...d0, wires: d0.wires.filter((w) => w.id !== 'w8') };
    b.wire(H('i20'), H('g21'), 'fb');
    const r = solveDC(buildNetlist(b.doc).netlist);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('คอมพาราเตอร์สลับสถานะไม่หยุด');
  });
  it('คำเตือน: ไม่มี pull-up ที่ขาออก · ขาเข้าเกินช่วง common mode (−20 °C → VT ≈ 4.6 V > VCC − 1.5)', () => {
    const d0 = thermoRig().doc;
    const noLed = { ...d0, parts: d0.parts.filter((p) => p.id !== 'LED1') };
    expect(step(noLed).analysis.diagnostics.some((d) => d.message.includes('pull-up'))).toBe(true);
    const cold = at(-20).analysis;
    expect(cold.diagnostics.some((d) => d.message.includes('common mode'))).toBe(true);
  });
  it('แลป 37: power/inputs/output/setpoint ทันที · ร้อน → เย็น = alarm · RH แล้วร้อน → เย็น = hyst', () => {
    const work = { ...emptyWork(), lessonId: 'comparator' };
    let prev: SimResult | undefined;
    const go = (d: CircuitDoc) => {
      const s = step(d, prev); prev = s.result;
      const st = checkLesson('comparator', { doc: d, ...s, work });
      work.achieved.comparator ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.comparator[k] = true;
      return st;
    };
    let st = go(thermoRig().doc);
    expect([st.power.pass, st.inputs.pass, st.output.pass, st.setpoint.pass]).toEqual([true, true, true, true]);
    expect(st.alarm.pass).toBe(false);
    go(thermoRig({ t: 45 }).doc); st = go(thermoRig({ t: 25 }).doc);
    expect(st.alarm.pass).toBe(true);
    expect(st.hyst.pass).toBe(false);
    go(thermoRig({ t: 45, rh: 100000 }).doc); st = go(thermoRig({ t: 25, rh: 100000 }).doc);
    expect(st.hyst.pass).toBe(true);
    const off = go(set(thermoRig().doc, 'VR1', { position: 0.3 }));
    expect(off.setpoint.pass).toBe(true); // จำไว้แล้ว
    const w2 = { ...emptyWork(), lessonId: 'comparator' };
    const d = set(thermoRig().doc, 'VR1', { position: 0.3 });
    const s2 = step(d);
    const st2 = checkLesson('comparator', { doc: d, ...s2, work: w2 });
    expect(st2.setpoint.detail).toContain('จุดตัดตอนนี้');
  });
});
