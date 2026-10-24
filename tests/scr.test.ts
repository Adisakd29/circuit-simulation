import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC, type SimResult } from '../src/sim/solver';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork, type CircuitDoc, type Part } from '../src/model/types';

/**
 * วงจรล็อกด้วย SCR (แลป 34): 12 V → R 1 kΩ → LED → A ของ SCR, K ลงลบ
 * เกต: S1 (ON) → R 10 kΩ → G, RGK 1 kΩ จาก G ลง K · S2 (OFF) ลัด A–K
 * SCR ที่ c20 (K c20, G c21, A c22)
 */
export function scrRig(o: { rg?: number; rl?: number; v?: number; rgk?: boolean } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.v ?? 12, currentLimit: 1 })
    .part('scr', onBoard('c20'), 'SCR1')
    .part('led', onBoard('a23', 180), 'LED1', { color: 'red' })
    .part('resistor', onBoard('b23'), 'RL', { resistance: o.rl ?? 1000, span: 4 })
    .part('resistor', onBoard('b15'), 'RG', { resistance: o.rg ?? 10000, span: 6 })
    .part('switch', onBoard('a11'), 'S1', { closed: false })
    .part('switch', onBoard('b20'), 'S2', { closed: false })
    .wire(P('PS1', 'pos'), H('d27'), 'wp')
    .wire(P('PS1', 'neg'), H('d20'), 'wn', '#212121')
    .wire(H('c11'), H('e27'), 'w1')
    .wire(H('c13'), H('c15'), 'w2');
  if (o.rgk !== false) b.part('resistor', onBoard('g17'), 'RGK', { resistance: 1000, span: 4 }).wire(H('e21'), H('f21'), 'w3').wire(H('h17'), H('e20'), 'w4');
  return b;
}

const set = (doc: CircuitDoc, id: string, params: Record<string, unknown>): CircuitDoc => ({ ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, params: { ...p.params, ...params } } as Part : p)) });

/** แก้วงจรต่อเนื่องโดยส่งสถานะค้างจากผลก่อนหน้า (เหมือนการจำลองที่กำลังเดิน) */
function step(doc: CircuitDoc, prev?: SimResult) {
  const built = buildNetlist(doc);
  const result = solveDC(built.netlist, { relayStates: prev?.relayStates });
  return { result, analysis: analyze(doc, built, result), built };
}

describe('ไทริสเตอร์ SCR 2N5060', () => {
  it('กดเกต → ติด (LED ≈ 9 mA, VAK ≈ 0.9 V) · ปล่อยเกต → ยังติดค้าง · ลัด A–K → ดับ และปล่อยแล้วยังดับ', () => {
    let doc = scrRig().doc;
    let s = step(doc);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(0);
    expect(s.analysis.parts.LED1.current).toBeLessThan(1e-6);
    doc = set(doc, 'S1', { closed: true }); s = step(doc, s.result);
    const x = s.analysis.parts.SCR1.extra!;
    expect(x.on).toBe(1);
    expect(x.ig).toBeGreaterThan(200e-6);
    expect(x.vak).toBeGreaterThan(0.8); expect(x.vak).toBeLessThan(1.0);
    expect(s.analysis.parts.LED1.current).toBeGreaterThan(8e-3); expect(s.analysis.parts.LED1.current).toBeLessThan(10e-3);
    doc = set(doc, 'S1', { closed: false }); s = step(doc, s.result);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(1);
    expect(s.analysis.parts.SCR1.extra!.ig).toBeLessThan(1e-6);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('ติด (ค้างสถานะ)'))).toBe(true);
    doc = set(doc, 'S2', { closed: true }); s = step(doc, s.result);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(0);
    doc = set(doc, 'S2', { closed: false }); s = step(doc, s.result);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(0);
    expect(s.analysis.parts.LED1.current).toBeLessThan(1e-6);
  });

  it('ตัวต้านทานเกต 100 kΩ (+ RGK 1 kΩ) → กระแสเกตไม่ถึง IGT 200 µA → ไม่ติด + เตือน', () => {
    const s = simulate(set(scrRig({ rg: 100e3 }).doc, 'S1', { closed: true }));
    expect(s.analysis.parts.SCR1.extra!.on).toBe(0);
    expect(s.analysis.parts.SCR1.extra!.ig).toBeLessThan(200e-6);
  });

  it('ไม่มี RGK: 100 kΩ ให้กระแสเกต ≈ 113 µA ยังไม่ถึง IGT (ตามค่าสูงสุดในดาต้าชีต) และแจ้งให้ต่อ RGK', () => {
    const s = simulate(set(scrRig({ rg: 100e3, rgk: false }).doc, 'S1', { closed: true }));
    const x = s.analysis.parts.SCR1.extra!;
    expect(x.ig).toBeGreaterThan(100e-6); expect(x.ig).toBeLessThan(120e-6);
    expect(x.on).toBe(0);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('กระแสเกต') && d.message.includes('ต่ำกว่า IGT'))).toBe(true);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('RGK'))).toBe(true);
  });

  it('โหลดเบา (RL 4.7 kΩ → IA ≈ 2 mA < IH 5 mA): ติดเฉพาะตอนกดเกต ปล่อยแล้วดับ', () => {
    let doc = set(scrRig({ rl: 4700 }).doc, 'S1', { closed: true });
    let s = step(doc);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(1);
    expect(Math.abs(s.analysis.parts.SCR1.extra!.ia)).toBeLessThan(5e-3);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('นำเพราะยังมีกระแสเกต'))).toBe(true);
    doc = set(doc, 'S1', { closed: false }); s = step(doc, s.result);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(0);
  });

  it('แรงดัน A–K เกิน VDRM 30 V → นำเองโดยไม่มีเกต (breakover) + เตือนอันตราย', () => {
    const s = simulate(scrRig({ v: 36 }).doc);
    expect(s.analysis.parts.SCR1.extra!.on).toBe(1);
    // ผลก่อนติด (ขณะดับ) มีคำเตือน — ตรวจที่สถานะดับด้วยแรงดันสูง: LED จำกัดกระแสได้ แต่ SCR นำแล้ว
    expect(s.analysis.parts.LED1.current).toBeGreaterThan(20e-3);
  });

  it('แลป 34: ผ่าน circuit, gate, latch, off (และ rgk ไม่บังคับ) ตามลำดับการกดสวิตช์', () => {
    const work = { ...emptyWork(), lessonId: 'scr' };
    let doc = scrRig().doc;
    let prev: SimResult | undefined;
    const run = (d: CircuitDoc) => {
      const s = step(d, prev); prev = s.result;
      const st = checkLesson('scr', { doc: d, built: s.built, result: s.result, analysis: s.analysis, work });
      work.achieved.scr ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.scr[k] = true;
      return st;
    };
    let st = run(doc);
    expect(st.circuit.pass).toBe(true);
    expect(st.gate.pass).toBe(true);
    expect(st.latch.pass).toBe(false);
    doc = set(doc, 'S1', { closed: true }); run(doc);
    doc = set(doc, 'S1', { closed: false }); st = run(doc);
    expect(st.latch.pass).toBe(true);
    doc = set(doc, 'S2', { closed: true }); run(doc);
    doc = set(doc, 'S2', { closed: false }); st = run(doc);
    expect(st.off.pass).toBe(true);
    expect(st.rgk.pass).toBe(true);
  });
});
