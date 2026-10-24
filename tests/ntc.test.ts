import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { ntcResistance, ntcTemperature } from '../src/model/catalog';
import { emptyWork, type CircuitDoc, type Part } from '../src/model/types';

/**
 * วงแบ่งแรงดันวัดอุณหภูมิ (แลป 36): 5 V (+ c10) → R1 10 kΩ (a10–a14) → จุดกลาง → NTC (b14–b16) → ลบ (d16)
 * โพรบแดง c14 ดำ e16
 */
export function ntcRig(o: { t?: number; r?: number; v?: number; probe?: boolean } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.v ?? 5, currentLimit: 1 })
    .part('resistor', onBoard('a10'), 'R1', { resistance: o.r ?? 10000, span: 4 })
    .part('ntc', onBoard('b14'), 'TH1', { temperature: o.t ?? 25 })
    .wire(P('PS1', 'pos'), H('c10'), 'wp')
    .wire(P('PS1', 'neg'), H('d16'), 'wn', '#212121');
  if (o.probe !== false) b.probe(H('c14'), H('e16'));
  return b;
}
const set = (doc: CircuitDoc, id: string, params: Record<string, unknown>): CircuitDoc => ({ ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, params: { ...p.params, ...params } } as Part : p)) });
const run = (doc: CircuitDoc) => { const built = buildNetlist(doc); const result = solveDC(built.netlist); return { built, result, analysis: analyze(doc, built, result) }; };
const vdiv = (t: number, r = 10000, v = 5) => { const rn = ntcResistance({ temperature: t, r25: 10000, beta: 3950 }); return (v * rn) / (rn + r); };

describe('เทอร์มิสเตอร์ NTC 10 kΩ B3950', () => {
  it('สมการค่า B: 25 °C = 10 kΩ, 0 °C ≈ 33.6 kΩ, 60 °C ≈ 2.49 kΩ, 100 °C ≈ 0.70 kΩ และย้อนกลับได้อุณหภูมิเดิม', () => {
    const R = (t: number) => ntcResistance({ temperature: t, r25: 10000, beta: 3950 });
    expect(R(25)).toBeCloseTo(10000, 6);
    expect(R(0) / 1000).toBeCloseTo(33.6, 0);
    expect(R(60) / 1000).toBeCloseTo(2.49, 1);
    expect(R(100) / 1000).toBeCloseTo(0.70, 1);
    for (const t of [-20, 0, 37, 100]) expect(ntcTemperature(R(t))).toBeCloseTo(t, 6);
  });
  it('วงแบ่ง 5 V: โพรบอ่านได้ตามสูตรทุกอุณหภูมิ — 25 °C = 2.5 V ร้อนขึ้นแรงดันลด', () => {
    let prev = Infinity;
    for (const t of [0, 25, 37, 60, 100]) {
      const { analysis } = run(ntcRig({ t }).doc);
      const v = analysis.probe.value!;
      expect(Math.abs(v - vdiv(t))).toBeLessThan(1e-4);
      expect(v).toBeLessThan(prev); prev = v;
      expect(analysis.parts.TH1.extra!.temp).toBe(t);
    }
    expect(run(ntcRig({ t: 25 }).doc).analysis.probe.value!).toBeCloseTo(2.5, 4);
  });
  it('ความร้อนในตัว: 10 kΩ ที่ 5 V ไม่เตือน (≤ 0.32 °C) · 1 kΩ ที่ 100 °C ≈ 3 °C มีคำเตือน · ต่อตรง 10 V ที่ 100 °C เกิน 50 mW', () => {
    const a = run(ntcRig({ t: 25 }).doc).analysis;
    expect(a.parts.TH1.extra!.dT).toBeLessThan(0.33);
    expect(a.diagnostics.some((d) => d.partId === 'TH1')).toBe(false);
    const b = run(ntcRig({ t: 100, r: 1000 }).doc).analysis;
    expect(b.parts.TH1.extra!.dT).toBeGreaterThan(2.5); expect(b.parts.TH1.extra!.dT).toBeLessThan(3.5);
    expect(b.diagnostics.some((d) => d.partId === 'TH1' && d.message.includes('ความร้อนในตัว'))).toBe(true);
    const c = run(ntcRig({ t: 100, r: 1, v: 10 }).doc).analysis; // 10 V คร่อม ≈ 0.7 kΩ ≈ 140 mW
    expect(c.diagnostics.some((d) => d.partId === 'TH1' && d.severity === 'danger')).toBe(true);
  });
  it('แลป 36: wiring/probe/v25 ทันที · วัด 4 อุณหภูมิ → sweep · R 1 kΩ ที่ 100 °C → selfheat', () => {
    const work = { ...emptyWork(), lessonId: 'ntc' };
    const go = (d: CircuitDoc) => {
      const s = run(d);
      const st = checkLesson('ntc', { doc: d, ...s, work });
      work.achieved.ntc ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.ntc[k] = true;
      return st;
    };
    let doc = ntcRig().doc;
    let st = go(doc);
    expect(st.wiring.pass && st.probe.pass && st.v25.pass).toBe(true);
    expect(st.sweep.pass).toBe(false);
    for (const t of [0, 60]) { doc = set(doc, 'TH1', { temperature: t }); st = go(doc); }
    expect(st.sweep.pass).toBe(false);
    doc = set(doc, 'TH1', { temperature: 100 }); st = go(doc);
    expect(st.sweep.pass).toBe(true);
    expect(st.selfheat.pass).toBe(false);
    st = go(set(doc, 'R1', { resistance: 1000 }));
    expect(st.selfheat.pass).toBe(true);
  });
  it('แลป 36: ไม่มีโพรบ → probe บอกวิธี · ไม่มีตัวต้านทานคงที่ → wiring บอก', () => {
    const work = { ...emptyWork(), lessonId: 'ntc' };
    let d = ntcRig({ probe: false }).doc;
    let st = checkLesson('ntc', { doc: d, ...run(d), work });
    expect(st.wiring.pass).toBe(true);
    expect(st.probe.detail).toContain('โพรบแดง');
    d = { ...ntcRig().doc, parts: ntcRig().doc.parts.filter((p) => p.id !== 'R1') };
    st = checkLesson('ntc', { doc: d, ...run(d), work });
    expect(st.wiring.detail).toContain('ตัวต้านทานคงที่');
  });
});
