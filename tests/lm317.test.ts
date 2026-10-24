import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';
import { analyze } from '../src/instruments/measure';
import { lm317Vout } from '../src/model/catalog';
import { emptyWork, type CircuitDoc, type Part } from '../src/model/types';
import { checkLesson } from '../src/lessons/checks';

/**
 * แหล่งจ่ายปรับค่าได้ LM317 (แลป 35): 15 V → IN · R1 240 Ω จาก OUT ไป ADJ · R2 = ทริมพอต 2 kΩ (ขา 1 → ADJ, แกนกลาง → กราวด์) · โหลด RL 1 kΩ
 * LM317 ที่ c20 (ADJ c20, OUT c21, IN c22) · กราวด์ = คอลัมน์ 5
 */
export function lm317Rig(o: { v?: number; r1?: number; pos?: number; rl?: number | null; pot?: number } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.v ?? 15, currentLimit: 1 })
    .part('lm317', onBoard('c20'), 'U1')
    .part('resistor', onBoard('a16'), 'R1', { resistance: o.r1 ?? 240, span: 4 })
    .part('potentiometer', onBoard('a7'), 'VR1', { resistance: o.pot ?? 2000, position: o.pos ?? 0.5 })
    .wire(P('PS1', 'pos'), H('e22'), 'wp')
    .wire(P('PS1', 'neg'), H('a5'), 'wn', '#212121')
    .wire(H('b16'), H('d21'), 'w1')
    .wire(H('b7'), H('d20'), 'w2')
    .wire(H('b8'), H('b5'), 'w3');
  if (o.rl !== null) b.part('resistor', onBoard('g21'), 'RL', { resistance: o.rl ?? 1000, span: 6 }).wire(H('e21'), H('f21'), 'w4').wire(H('h27'), H('c5'), 'w5', '#212121');
  return b;
}

export const set = (doc: CircuitDoc, id: string, params: Record<string, unknown>): CircuitDoc => ({ ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, params: { ...p.params, ...params } } as Part : p)) });
const run = (doc: CircuitDoc) => { const built = buildNetlist(doc); const result = solveDC(built.netlist); return analyze(doc, built, result); };

const vo = (doc: CircuitDoc) => run(doc).parts.U1.extra!;

describe('ไอซีคงแรงดันปรับค่าได้ LM317', () => {
  it('VOUT ตามสูตร 1.25·(1 + R2/R1) + IADJ·R2 ตลอดช่วงหมุนพอต (ต่างไม่เกิน 10 mV) และ OUT − ADJ = 1.25 V', () => {
    for (const pos of [0, 0.355, 0.5, 0.8, 1]) {
      const e = vo(lm317Rig({ pos }).doc);
      expect(Math.abs(e.vout - lm317Vout(240, 2000 * pos + 3))).toBeLessThan(0.01);
      expect(e.vref).toBeCloseTo(1.25, 2);
      expect(e.regulating).toBe(1);
    }
  });
  it('คงแรงดันเมื่อขาเข้าเปลี่ยน 12 → 25 V (line regulation) และกระแส ADJ ≈ 50 µA', () => {
    const a = vo(lm317Rig({ v: 12, pos: 0.355 }).doc), b = vo(lm317Rig({ v: 25, pos: 0.355 }).doc);
    expect(Math.abs(a.vout - 5)).toBeLessThan(0.01);
    expect(Math.abs(b.vout - a.vout)).toBeLessThan(0.01);
    expect(a.iadj).toBeGreaterThan(45e-6); expect(a.iadj).toBeLessThan(55e-6);
  });
  it('ขาเข้าต่ำกว่า VOUT + dropout → ขาออกตกตาม (≈ IN − 1.6 V) และมีคำเตือน dropout', () => {
    const a = run(lm317Rig({ v: 8, pos: 0.8 }).doc), e = a.parts.U1.extra!;
    expect(e.regulating).toBe(0);
    expect(e.vout).toBeGreaterThan(6.2); expect(e.vout).toBeLessThan(6.6);
    expect(a.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('dropout'))).toBe(true);
  });
  it('R1 2.2 kΩ ไม่มีโหลด → กระแสต่ำกว่ากระแสโหลดต่ำสุด ขาออกสูงเกินสูตร พร้อมคำเตือนให้ใช้ R1 ≤ 240 Ω · เพิ่มโหลดแล้วกลับมาตรงสูตร', () => {
    const a = run(lm317Rig({ r1: 2200, rl: null, pos: 0.5 }).doc), e = a.parts.U1.extra!;
    expect(e.lowLoad).toBe(1);
    expect(e.vout).toBeGreaterThan(lm317Vout(2200, 1003) + 1);
    expect(a.diagnostics.some((d) => d.message.includes('240 Ω'))).toBe(true);
    const b = vo(lm317Rig({ r1: 2200, rl: 470, pos: 0.5 }).doc);
    expect(b.lowLoad).toBe(0);
    expect(Math.abs(b.vout - lm317Vout(2200, 1003))).toBeLessThan(0.01);
  });
  it('โหลด 10 Ω ที่ 5 V → 0.5 A กำลังสูญเสีย ≈ 5 W ร้อนเกิน 125 °C ต้องติดแผ่นระบายความร้อน', () => {
    const a = run(lm317Rig({ pos: 0.355, rl: 10 }).doc), e = a.parts.U1.extra!;
    expect(e.iout).toBeGreaterThan(0.49);
    expect(e.pd).toBeGreaterThan(4.5); expect(e.pd).toBeLessThan(5.5);
    expect(a.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('125 °C'))).toBe(true);
  });
  it('ไม่ต่อ ADJ → แจ้งว่าขา ADJ ลอย', () => {
    const doc = lm317Rig().doc;
    const d2 = { ...doc, wires: doc.wires.filter((w) => w.id !== 'w2'), parts: doc.parts.filter((p) => p.id !== 'R1') };
    const a = run(d2);
    expect(a.diagnostics.some((d) => d.message.includes('ADJ ลอย'))).toBe(true);
  });
  it('แลป 35: wiring/formula ผ่านทันที · ปรับพอต 5 V แล้ว 9 V · R1 2.2 kΩ ไม่มีโหลด → minload', () => {
    const work = { ...emptyWork(), lessonId: 'lm317' };
    const go = (d: CircuitDoc) => {
      const built = buildNetlist(d); const result = solveDC(built.netlist); const analysis = analyze(d, built, result);
      const st = checkLesson('lm317', { doc: d, built, result, analysis, work });
      work.achieved.lm317 ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.lm317[k] = true;
      return st;
    };
    let doc = lm317Rig().doc;
    let st = go(doc);
    expect(st.wiring.pass).toBe(true);
    expect(st.formula.pass).toBe(true);
    expect(st.set5.pass).toBe(false);
    doc = set(doc, 'VR1', { position: 0.355 }); st = go(doc);
    expect(st.set5.pass).toBe(true);
    doc = set(doc, 'VR1', { position: 0.735 }); st = go(doc);
    expect(st.set9.pass).toBe(true);
    expect(st.minload.pass).toBe(false);
    const d2 = set(doc, 'R1', { resistance: 2200 });
    st = go({ ...d2, parts: d2.parts.filter((p) => p.id !== 'RL') });
    expect(st.formula.pass).toBe(true); // ผ่านแล้วจำไว้ (เหมือนเป้าหมายอื่น)
    expect(st.minload.pass).toBe(true);
    expect(st.set5.pass && st.set9.pass).toBe(true);
  });
  it('แลป 35: IN ไม่ได้ต่อไฟบวก / ไม่มี R2 → wiring บอกสิ่งที่ขาด', () => {
    const doc = lm317Rig().doc;
    const noR2 = { ...doc, wires: doc.wires.filter((w) => w.id !== 'w3') };
    const built = buildNetlist(noR2); const result = solveDC(built.netlist);
    const st = checkLesson('lm317', { doc: noR2, built, result, analysis: analyze(noR2, built, result), work: { ...emptyWork(), lessonId: 'lm317' } });
    expect(st.wiring.pass).toBe(false);
    expect(st.wiring.detail).toContain('R2');
  });
});
