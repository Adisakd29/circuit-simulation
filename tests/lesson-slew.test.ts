import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { toBode } from '../src/instruments/bode';
import { analyze } from '../src/instruments/measure';
import { ScopeBuffer, type ScopeSettings } from '../src/instruments/scope';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { emptyWork } from '../src/model/types';
import { logSweep, solveAC } from '../src/sim/ac';
import { SimEngine, type WatchItem } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** แลป 14: LM741 ±12 V — follower (ส่วน ก) หรือไม่กลับเฟส ×11 (ส่วน ข); CH1 = ขาเข้า, CH2 = OUT */
function circuit(fg: Record<string, unknown>, mode: 'follower' | 'x11') {
  const b = new Builder()
    .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
    .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
    .part('opamp', onBoard('f10'), 'U1')
    .part('fgen', onTable(-25, 6), 'FG1', fg)
    .part('scope', onTable(-25, 14), 'OSC1')
    .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
    .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
    .wire(P('FG1', 'OUT'), H('j12')).wire(P('FG1', 'COM'), H('bn4'))
    .wire(H('i12'), P('OSC1', 'CH1')).wire(H('b12'), P('OSC1', 'CH2')).wire(H('bn6'), P('OSC1', 'GND'));
  if (mode === 'follower') b.wire(H('c12'), H('h11'));
  else b.part('resistor', onBoard('i5'), 'Rg', { resistance: 1000, span: 6 }).part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 })
    .wire(H('h18'), H('d12')).wire(H('h5'), H('bn5'));
  return b;
}

function run(b: Builder, simSeconds: number, timeDiv: number, withBode = false, ticks = 40) {
  const built = buildNetlist(b.doc);
  const c = computeConnectivity(b.doc);
  const g = netOfPin(c, 'OSC1', 'GND');
  const watch: WatchItem[] = [{ key: 's1', kind: 'v', a: netOfPin(c, 'OSC1', 'CH1'), b: g }, { key: 's2', kind: 'v', a: netOfPin(c, 'OSC1', 'CH2'), b: g }];
  const engine = new SimEngine();
  const buf = new ScopeBuffer();
  let res = engine.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch, budgetMs: 1e9 });
  for (let k = 0; k < ticks; k++) {
    res = engine.handle({ seq: k + 1, netlist: built.netlist, advance: simSeconds / ticks, restart: false, watch, budgetMs: 1e9, sampleSpacing: timeDiv / 40 });
    for (const s of res.samples) buf.push(s.t, s.v[0], s.v[1]);
  }
  expect(res.result.ok).toBe(true);
  const settings: ScopeSettings = { timeDiv, vdiv1: 2, vdiv2: 2, ch1On: true, ch2On: true, trigSource: 'ch1', trigLevel: 0, trigSlope: 'rise' };
  const frame = buf.frame(settings);
  const bode = withBode ? toBode(solveAC({ netlist: built.netlist, freqs: logSweep(100, 1e6, 20), probes: [
    { key: 'ch1', a: netOfPin(c, 'OSC1', 'CH1'), b: g }, { key: 'ch2', a: netOfPin(c, 'OSC1', 'CH2'), b: g }] }), 'ch1') : null;
  const analysis = analyze(b.doc, built, res.result);
  return { st: checkLesson('slew', { doc: b.doc, built, result: res.result, analysis, work: emptyWork(), scopeMeasure: frame.measure, time: res.t, bode }), m: frame.measure, bode };
}

describe('แลป 14: slew rate และแบนด์วิดท์', () => {
  it('บทเรียนมีอยู่ เป้าหมายครบ', () => {
    const l = LESSONS.find((x) => x.id === 'slew')!;
    expect(l.number).toBe(14);
    expect(l.goals.map((g) => g.id)).toEqual(['power', 'circuit', 'scope', 'slew', 'bandwidth', 'gbw']);
  });
  it('ส่วน ก: ตามแรงดัน สี่เหลี่ยม 10 Vpp 5 kHz → ความชันขาออก ≈ 0.5 V/µs ผ่านข้อ slew', () => {
    const { st, m } = run(circuit({ wave: 'square', frequency: 5000, vpp: 10 }, 'follower'), 2e-3, 1e-5);
    for (const k of ['power', 'circuit', 'scope', 'slew']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
    expect(Math.abs(m[1]!.slew! / 0.5e6 - 1)).toBeLessThan(0.05);
    expect(Math.abs(m[1]!.rise! / 16e-6 - 1)).toBeLessThan(0.05); // 8 V / 0.5 V/µs
    expect(m[0]!.slew!).toBeGreaterThan(10 * m[1]!.slew!); // ขาเข้าเปลี่ยนทันที
  });
  it('สัญญาณเล็ก 0.2 Vpp: ไม่ผ่านข้อ slew และบอกเหตุผล (ถูกจำกัดด้วยแบนด์วิดท์)', () => {
    const { st } = run(circuit({ wave: 'square', frequency: 5000, vpp: 0.2 }, 'follower'), 2e-3, 1e-5);
    expect(st.slew.pass).toBe(false);
    expect(st.slew.detail).toMatch(/แบนด์วิดท์/);
  });
  it('ส่วน ข: ×11 กราฟโบด f(−3 dB) ≈ 91 kHz และ GBW ≈ 1 MHz ผ่าน', () => {
    const { st, bode } = run(circuit({ wave: 'sine', frequency: 1000, vpp: 0.2 }, 'x11'), 3e-3, 2e-4, true);
    expect(bode!.ok).toBe(true);
    for (const k of ['power', 'circuit', 'scope', 'bandwidth', 'gbw']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
  });
  it('ตามแรงดัน + กราฟโบดถึง 1 MHz: ข้อ gbw ขอให้ใช้อัตราขยาย ≥ 5', () => {
    const { st } = run(circuit({ wave: 'sine', frequency: 1000, vpp: 0.2 }, 'follower'), 3e-3, 2e-4, true);
    expect(st.gbw.pass).toBe(false);
  });
});
