import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';
import { analyze } from '../src/instruments/measure';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { diodeParamsFor } from '../src/model/catalog';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { checkLesson } from '../src/lessons/checks';

/**
 * ขับมอเตอร์ด้วย TIP120 (แลป 38): 6 V (+ tp2, − tn2) · TIP120 ที่ c20 (B c20, C c21, E c22) · E: a22 → tn22
 * มอเตอร์ A → tp5, B → a21 (C) · ไดโอด 1N4007 A e21 K e25 (สาย b25 → tp24) · S1 a10–a12 (สาย c10 → tp10, c12 → c14) · RB b14–b20
 */
export function tipRig(o: { rb?: number; s1?: boolean; diode?: boolean; v?: number; q?: 'darlington' | 'bjt'; load?: number } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.v ?? 6, currentLimit: 3 })
    .part(o.q ?? 'darlington', onBoard('c20'), 'Q1', o.q === 'bjt' ? { model: '2N3904' } : undefined)
    .part('motor', onTable(18, -28), 'M1', o.load ? { loadTorque: o.load } : undefined)
    .part('resistor', onBoard('b14'), 'RB', { resistance: o.rb ?? 10000, span: 6 })
    .part('switch', onBoard('a10'), 'S1', { closed: o.s1 ?? true })
    .wire(P('PS1', 'pos'), H('tp2'), 'wp')
    .wire(P('PS1', 'neg'), H('tn2'), 'wn', '#212121')
    .wire(H('a22'), H('tn22'), 'w1', '#212121')
    .wire(P('M1', 'A'), H('tp5'), 'wma')
    .wire(P('M1', 'B'), H('a21'), 'wmb', '#212121')
    .wire(H('c10'), H('tp10'), 'w2')
    .wire(H('c12'), H('c14'), 'w3');
  if (o.diode !== false) b.part('diode', onBoard('e21'), 'D1', { ...diodeParamsFor('1N4007') }).wire(H('b25'), H('tp24'), 'w4');
  return b;
}
export function runFor(doc: CircuitDoc, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(doc);
  let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  for (let k = 0; k < seconds / dt; k++) r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
  return { r, built, an: analyze(doc, built, r.result, r.tones) };
}

/** วงจร DC สำหรับวัดค่าในเอกสาร: แหล่งจ่าย VC → RC → C, แหล่งจ่ายเบส VB → RB → B */
function dcPoint(o: { vc: number; rc: number; vb: number; rb: number }) {
  const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.vc, currentLimit: 10 }).part('dcsupply', onTable(-45, 0), 'PB', { voltage: o.vb, currentLimit: 1 })
    .part('darlington', onBoard('c20'), 'Q1').part('resistor', onBoard('a14'), 'RB', { resistance: o.rb, span: 6 })
    .wire(P('PB', 'pos'), H('b14'), 'c').wire(P('PB', 'neg'), H('tn3'), 'd').wire(H('e22'), H('tn22'), 'e').wire(P('PS1', 'neg'), H('tn2'), 'b');
  if (o.rc > 0) b.part('resistor', onBoard('h21'), 'RC', { resistance: o.rc, span: 6, powerRating: 100 }).wire(P('PS1', 'pos'), H('j27'), 'a').wire(H('d21'), H('f21'), 'f');
  else b.wire(P('PS1', 'pos'), H('d21'), 'a');
  const built = buildNetlist(b.doc); const res = solveDC(built.netlist);
  return analyze(b.doc, built, res).parts.Q1.extra!;
}

describe('ทรานซิสเตอร์ดาร์ลิงตัน TIP120', () => {
  it('ค่าตามเอกสาร: hFE ≥ 1000 ที่ IC 0.5 A และ 3 A (VCE 3 V) · VCE(sat) ≤ 2 V ที่ 3 A/12 mA · VBE ≤ 2.5 V ที่ 3 A', () => {
    // VCE คงที่ 3 V (ต่อ C เข้าแหล่งจ่าย 3 V ตรง) แล้วหากระแสเบสที่ให้ IC ≈ 0.5 A และ 3 A
    const at = (ib: number) => dcPoint({ vc: 3, rc: 0, vb: 10, rb: (10 - 1.5) / ib });
    const a = at(0.4e-3), b = at(1.3e-3);
    expect(a.ic).toBeGreaterThan(0.3); expect(a.ic / a.ib).toBeGreaterThan(1000);
    expect(b.ic).toBeGreaterThan(2.5); expect(b.ic / b.ib).toBeGreaterThan(1000);
    expect(b.vbe).toBeLessThan(2.5); expect(b.vbe).toBeGreaterThan(1.3);
    const s = dcPoint({ vc: 10, rc: 10 / 3, vb: 10, rb: (10 - 1.7) / 0.012 });
    expect(s.ic).toBeGreaterThan(2.5); expect(s.vce).toBeLessThan(2); expect(s.vce).toBeGreaterThan(0.8); expect(s.region).toBe(2);
  });
  it('ขับมอเตอร์ 6 V ผ่าน RB 10 kΩ: IB ≈ 0.45 mA, IC ≈ 0.16 A, VBE 1.2–1.6 V, VCE(sat) < 1.2 V อิ่มตัว มอเตอร์ ≈ 210 rpm ไม่มีคำเตือน', () => {
    const { an } = runFor(tipRig().doc, 1.0);
    const x = an.parts.Q1.extra!;
    expect(x.ib).toBeGreaterThan(0.4e-3); expect(x.ib).toBeLessThan(0.5e-3);
    expect(x.ic).toBeGreaterThan(0.14); expect(x.ic).toBeLessThan(0.18);
    expect(x.vbe).toBeGreaterThan(1.2); expect(x.vbe).toBeLessThan(1.6);
    expect(x.vce).toBeLessThan(1.2); expect(x.region).toBe(2);
    expect(an.parts.M1.extra!.rpm).toBeGreaterThan(190); expect(an.parts.M1.extra!.rpm).toBeLessThan(230);
    expect(an.diagnostics.filter((d) => d.partId === 'Q1' || d.partId === 'M1')).toEqual([]);
  });
  it('S1 เปิด → ไม่นำ มอเตอร์หยุด · RB 100 kΩ → กระแสเบสไหลผ่าน R ภายในหมด ไม่นำ', () => {
    for (const o of [{ s1: false }, { rb: 100000 }]) {
      const { an } = runFor(tipRig(o).doc, 0.5);
      expect(an.parts.Q1.extra!.ic).toBeLessThan(1e-3);
      expect(Math.abs(an.parts.M1.extra!.rpm)).toBeLessThan(1);
    }
  });
  it('ไม่มีไดโอดกันย้อน → เตือนที่มอเตอร์ · มอเตอร์ติดขัด (หยุดค้าง) กระแสเบสไม่พอ → ย่านขยาย VCE > 2 V ร้อน > 85 °C', () => {
    const a = runFor(tipRig({ diode: false }).doc, 0.5).an;
    expect(a.diagnostics.some((d) => d.partId === 'M1' && d.message.includes('ไดโอดกันย้อน'))).toBe(true);
    const b = runFor(tipRig({ load: 0.05 }).doc, 0.5).an; // มอเตอร์หยุดค้าง ต้องการ ≈ 1.7 A แต่ IB 0.45 mA ขับได้ ≈ 0.7 A
    const x = b.parts.Q1.extra!;
    expect(x.region).toBe(1); expect(x.vce).toBeGreaterThan(2);
    expect(b.diagnostics.some((d) => d.partId === 'Q1' && (d.message.includes('ย่านขยาย') || d.message.includes('°C')))).toBe(true);
  });
  it('แลป 38: wiring/flyback → run + measure → off · RB 100 kΩ → minib', () => {
    const work = { ...emptyWork(), lessonId: 'darlington' };
    const go = (d: CircuitDoc, sec = 1.0) => {
      const { r, built, an } = runFor(d, sec);
      const st = checkLesson('darlington', { doc: d, built, result: r.result, analysis: an, work });
      work.achieved.darlington ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.darlington[k] = true;
      return st;
    };
    let st = go(tipRig({ s1: false }).doc, 0.2);
    expect(st.wiring.pass && st.flyback.pass).toBe(true);
    expect(st.run.pass).toBe(false);
    st = go(tipRig().doc);
    expect(st.run.pass && st.measure.pass).toBe(true);
    expect(st.off.pass).toBe(false);
    st = go(tipRig({ s1: false }).doc, 0.5);
    expect(st.off.pass).toBe(true);
    st = go(tipRig({ rb: 100000 }).doc, 0.5);
    expect(st.minib.pass).toBe(true);
  });
});
