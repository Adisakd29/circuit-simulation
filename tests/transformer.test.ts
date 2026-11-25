import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { advance, newTranState } from '../src/sim/transient';
import { analyze } from '../src/instruments/measure';
import { diodeParamsFor, transformerModel, vregParamsFor } from '../src/model/catalog';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { ScopeBuffer, type ScopeSettings } from '../src/instruments/scope';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import type { ScopePart } from '../src/model/types';

const D7 = diodeParamsFor('1N4007');
/**
 * แหล่งจ่าย DC ครบชุด: T1 (โต๊ะ) → บริดจ์ 1N4007 × 4 → C 1000 µF → (L7805) → โหลด
 * AC1 = คอลัมน์ 5 ล่าง, AC2 = คอลัมน์ 13 ล่าง, + = คอลัมน์ 9 ล่าง, − = ราง bn (และ tn ผ่านสาย)
 * mode: 'bridge' (A–CT เข้าบริดจ์), 'ct' (A, B เข้าไดโอด 2 ตัว CT ลงกราวด์), 'half' (A–CT ไดโอดตัวเดียว)
 */
export function psu(o: { mode?: 'bridge' | 'ct' | 'half'; c?: number; rl?: number; on?: boolean; noCap?: boolean; scope?: boolean } = {}) {
  const mode = o.mode ?? 'bridge';
  const b = new Builder()
    .part('transformer', onTable(-36, 0), 'T1', { on: o.on ?? true })
    .part('diode', onBoard('g5'), 'D1', D7)
    .wire(H('tn3'), H('bn3'));
  if (mode !== 'half') b.part('diode', onBoard('h13', 180), 'D2', D7);
  if (mode === 'bridge') {
    b.part('diode', onBoard('i1'), 'D3', D7).part('diode', onBoard('j17', 180), 'D4', D7)
      .wire(H('j1'), H('bn2')).wire(H('f17'), H('bn17'))
      .wire(P('T1', 'A'), H('f5')).wire(P('T1', 'CT'), H('f13'));
  } else if (mode === 'ct') {
    b.wire(P('T1', 'A'), H('f5')).wire(P('T1', 'B'), H('f13')).wire(P('T1', 'CT'), H('bn5'));
  } else b.wire(P('T1', 'A'), H('f5')).wire(P('T1', 'CT'), H('bn5'));
  if (!o.noCap) b.part('capacitor', onBoard('j9', 90), 'C1', { capacitance: o.c ?? 1000e-6, ratedVoltage: 25, polarized: true, initialVoltage: 0, span: 2 });
  b.part('vreg', onBoard('c20'), 'U1', vregParamsFor('L7805'))
    .part('resistor', onBoard('b22'), 'RL', { resistance: o.rl ?? 100, span: 4, powerRating: 1 })
    .wire(H('i9'), H('a20')).wire(H('a21'), H('tn21')).wire(H('a26'), H('tn26'));
  if (o.scope) b.part('scope', onTable(30, -24), 'OSC1', { timeDiv: 0.005, vdiv1: 0.2, ac1: true, trigLevel: 0 })
    .wire(P('OSC1', 'CH1'), H('f9')).wire(P('OSC1', 'GND'), H('bn10'));
  return b;
}

/** เดินเวลาแล้วคืนค่าที่เก็บทุกก้าวในช่วงสุดท้าย */
export function runPsu(b: Builder, seconds = 0.6, last = 0.1) {
  const d: CircuitDoc = b.doc;
  const built = buildNetlist(d);
  const e = new SimEngine();
  const vc: number[] = [], vo: number[] = [];
  let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  for (let k = 0; k * 0.02 < seconds; k++) {
    r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.02, restart: false, watch: [{ kind: 'v', a: netOf(built, 'C1', 'P'), b: netOf(built, 'C1', 'N') } as never], budgetMs: 1e9, sampleSpacing: 1e-4 } as never);
    if (r.t > seconds - last) for (const s of r.samples) { if (s.v[0] !== null) vc.push(s.v[0] as number); }
    const an = analyze(d, built, r.result, r.tones);
    if (r.t > seconds - last && an.parts.U1) vo.push(an.parts.U1.extra!.vout);
  }
  return { r, an: analyze(d, built, r.result, r.tones), vc, vo };
}
function netOf(built: ReturnType<typeof buildNetlist>, part: string, pin: string) {
  const pp = built.connectivity.nets.find((n) => n.partPins.some((x) => x.partId === part && x.pin === pin));
  return pp ? pp.index : -1;
}

describe('หม้อแปลง 12-0-12 V + วงจรเรียงกระแส', () => {
  it('ไม่มีโหลด: A–CT ≈ 13.9 V rms (regulation 16%); โหลดพิกัด 12 Ω → 12.0 V rms 1 A; A–B สองเท่า', () => {
    const mk = (rl: number | null) => {
      const b = new Builder().part('transformer', onTable(-36, 0), 'T1');
      if (rl) b.part('resistor', onTable(0, -20), 'R1', { resistance: rl, powerRating: 50 }).wire(P('T1', 'A'), P('R1', '1')).wire(P('T1', 'CT'), P('R1', '2'));
      else b.part('resistor', onTable(0, -20), 'R1', { resistance: 1e6 }).wire(P('T1', 'A'), P('R1', '1')).wire(P('T1', 'B'), P('R1', '2'));
      return b;
    };
    const m = transformerModel({ vRated: 12, iRated: 1, regulation: 0.16 });
    const nl = runPsu(mk(null), 0.2).an.parts.T1.extra!;
    expect(nl.vrmsA).toBeCloseTo(m.vnl, 1); expect(nl.vrmsB).toBeCloseTo(m.vnl, 1);
    const fl = runPsu(mk(12), 0.2).an.parts.T1.extra!;
    expect(fl.vrmsA).toBeGreaterThan(11.9); expect(fl.vrmsA).toBeLessThan(12.1);
    expect(fl.irmsA).toBeGreaterThan(0.99); expect(fl.irmsA).toBeLessThan(1.01);
    expect(fl.va).toBeGreaterThan(11.8);
  });
  it('บริดจ์ + 1000 µF + 7805 + 100 Ω: แรงดัน C ≈ 15–17 V, ripple 100 Hz ≈ I/(2fC) (±35%), ขาออก 5 V คงที่ (ripple < 5 mV)', () => {
    const { an, vc, vo } = runPsu(psu(), 0.8, 0.1);
    const vmax = Math.max(...vc), vmin = Math.min(...vc);
    expect(vmax).toBeGreaterThan(15); expect(vmax).toBeLessThan(17.5);
    const iload = 5 / 100 + 0.005;
    const th = iload / (2 * 50 * 1000e-6);
    expect(Math.abs((vmax - vmin) / th - 1)).toBeLessThan(0.35);
    expect(Math.max(...vo) - Math.min(...vo)).toBeLessThan(0.005);
    expect(Math.abs(an.parts.U1.extra!.vout - 5)).toBeLessThan(0.02);
    // กระแสยอดของหม้อแปลงสูงกว่ากระแส DC หลายเท่า (ตัวเก็บประจุชาร์จช่วงสั้น ๆ ใกล้ยอดคลื่น)
    expect(an.parts.T1.extra!.ipk).toBeGreaterThan(3 * iload);
  }, 60000);
  it('ครึ่งคลื่น ripple ≈ 2 เท่าของเต็มคลื่น; แท็ปกลาง 2 ไดโอดใกล้เคียงบริดจ์ (ตกคร่อมไดโอดตัวเดียว → แรงดันสูงกว่า ≈ 0.7 V)', () => {
    const full = runPsu(psu(), 0.8, 0.1), half = runPsu(psu({ mode: 'half' }), 0.8, 0.1), ct = runPsu(psu({ mode: 'ct' }), 0.8, 0.1);
    const rip = (x: { vc: number[] }) => Math.max(...x.vc) - Math.min(...x.vc);
    expect(rip(half) / rip(full)).toBeGreaterThan(1.6); expect(rip(half) / rip(full)).toBeLessThan(2.4);
    const dv = Math.max(...ct.vc) - Math.max(...full.vc);
    expect(dv).toBeGreaterThan(0.4); expect(dv).toBeLessThan(1.1);
    expect(Math.abs(ct.an.parts.U1.extra!.vout - 5)).toBeLessThan(0.02);
  }, 120000);
  it('ขดทุติยภูมิลอย (บริดจ์) ยึดกับกราวด์วงจรด้วย 100 MΩ: จำลอง 0.2 s ไม่มีก้าวถูกปฏิเสธจำนวนมาก', () => {
    const nl = buildNetlist(psu().doc).netlist;
    expect(nl.elements.some((e) => e.id === 'T1#leak' && e.type === 'R' && e.R === 1e8)).toBe(true);
    const st = newTranState();
    const o = advance(nl, st, 0.2);
    expect(o.ok).toBe(true);
    expect(o.rejected).toBeLessThan(20);
  });
  it('ถอดปลั๊ก → ไม่มีไฟ; บันทึก/เปิดไฟล์ + schema 18 เปิดได้', () => {
    const off = runPsu(psu({ on: false }), 0.1, 0.05);
    expect(Math.abs(off.an.parts.U1?.extra?.vout ?? 0)).toBeLessThan(0.05);
    const doc = psu().doc;
    const v = parseProject(serializeProject('p', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 18;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 60000);
  it('แลป 22: บริดจ์ + สโคป AC → ผ่านทุกข้อหลัก; สลับเป็นครึ่งคลื่นแล้วกลับ → ผ่าน compare', () => {
    expect(LESSONS.find((l) => l.id === 'psu')?.number).toBe(22);
    const work = emptyWork(); work.achieved.psu = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    const measures: number[] = [];
    for (const mode of ['bridge', 'half', 'bridge'] as const) {
      const d = psu({ mode, scope: true }).doc;
      const built = buildNetlist(d);
      const sc = d.parts.find((p): p is ScopePart => p.kind === 'scope')!;
      const watch = [{ key: 's1', kind: 'v' as const, a: netOf(built, 'OSC1', 'CH1'), b: netOf(built, 'OSC1', 'GND') }, { key: 's2', kind: 'v' as const, a: netOf(built, 'OSC1', 'CH2'), b: netOf(built, 'OSC1', 'GND') }];
      const e = new SimEngine(); const buf = new ScopeBuffer();
      let r = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch, budgetMs: 1e9 });
      for (let k = 0; k < 40; k++) {
        r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.02, restart: false, watch, budgetMs: 1e9, sampleSpacing: sc.params.timeDiv / 40 });
        for (const s of r.samples) buf.push(s.t, s.v[0], s.v[1]);
      }
      const f = buf.frame(sc.params as ScopeSettings);
      measures.push(f.measure[0]!.freq!);
      st = checkLesson('psu', { doc: d, built, result: r.result, analysis: analyze(d, built, r.result, r.tones), work, scopeMeasure: f.measure });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.psu[g] = true;
    }
    expect(Math.abs(measures[0] - 100)).toBeLessThan(5);
    expect(Math.abs(measures[1] - 50)).toBeLessThan(3);
    expect({ ...work.achieved.psu, st }).toMatchObject({ transformer: true, filter: true, regulate: true, scope: true, fullwave: true, ripple: true, compare: true });
  }, 120000);
});
