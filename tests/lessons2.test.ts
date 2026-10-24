import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { analyze } from '../src/instruments/measure';
import { ScopeBuffer, type ScopeSettings } from '../src/instruments/scope';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { diodeParamsFor, mosfetParamsFor } from '../src/model/catalog';
import { emptyWork } from '../src/model/types';
import { SimEngine, type WatchItem } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

/** จำลองเหมือนแอป (engine ทีละ tick → buffer ของสโคป) แล้วตรวจแลป */
function runLesson(lesson: string, b: Builder, simSeconds: number, timeDiv: number, ticks = 50) {
  const built = buildNetlist(b.doc);
  const c = computeConnectivity(b.doc);
  const g = netOfPin(c, 'OSC1', 'GND');
  const watch: WatchItem[] = [
    { key: 's1', kind: 'v', a: netOfPin(c, 'OSC1', 'CH1'), b: g },
    { key: 's2', kind: 'v', a: netOfPin(c, 'OSC1', 'CH2'), b: g },
  ];
  const engine = new SimEngine();
  const buf = new ScopeBuffer();
  let res = engine.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch, budgetMs: 1e9 });
  for (let k = 0; k < ticks; k++) {
    res = engine.handle({ seq: k + 1, netlist: built.netlist, advance: simSeconds / ticks, restart: false, watch, budgetMs: 1e9, sampleSpacing: timeDiv / 40 });
    for (const s of res.samples) buf.push(s.t, s.v[0], s.v[1]);
  }
  expect(res.result.ok).toBe(true);
  const settings: ScopeSettings = { timeDiv, vdiv1: 1, vdiv2: 1, ch1On: true, ch2On: true, trigSource: 'ch1', trigLevel: 0, trigSlope: 'rise' };
  const frame = buf.frame(settings);
  const analysis = analyze(b.doc, built, res.result);
  return { status: checkLesson(lesson, { doc: b.doc, built, result: res.result, analysis, work: emptyWork(), scopeMeasure: frame.measure, time: res.t }), m: frame.measure, analysis };
}

const fgScope = (params: Record<string, unknown>) => new Builder()
  .part('fgen', onTable(-25, -6), 'FG1', params)
  .part('scope', onTable(-25, 8), 'OSC1');

describe('มีแลปอย่างน้อย 10 บท ทุกบทมีส่วนประกอบครบ', () => {
  it('โครงสร้างแลป', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(10);
    for (const l of LESSONS) {
      for (const k of ['objectives', 'background', 'predictions', 'equipment', 'steps', 'table', 'hints', 'summary', 'goals'] as const) expect(l[k].length, `${l.id}.${k}`).toBeGreaterThan(0);
      const st = checkLesson(l.id, null);
      expect(Object.keys(st).sort()).toEqual(l.goals.map((g) => g.id).sort());
    }
  });
});

describe('แลป 8: เรียงกระแสครึ่งคลื่น', () => {
  const build = (reversed = false, cap = false) => {
    const b = fgScope({ wave: 'sine', frequency: 100, vpp: 10 })
      .part('diode', onBoard(reversed ? 'i13' : 'i9', reversed ? 180 : 0), 'D1', { ...diodeParamsFor('1N4007'), span: 4 })
      .part('resistor', onBoard('j13'), 'R1', { resistance: 1000, span: 4 })
      .wire(P('FG1', 'OUT'), H('h9')).wire(H('g17'), P('FG1', 'COM'))
      .wire(H('g9'), P('OSC1', 'CH1')).wire(H('g13'), P('OSC1', 'CH2')).wire(H('h17'), P('OSC1', 'GND'));
    if (cap) b.part('capacitor', onBoard('f13'), 'C1', { capacitance: 100e-6, polarized: true, span: 4 });
    return b;
  };
  it('ต่อถูก: ครึ่งคลื่นบวก ยอดต่ำกว่าขาเข้าราว Vf', () => {
    const { status, m } = runLesson('rectifier', build(), 0.1, 5e-3);
    expect(status.connect.pass).toBe(true);
    expect(status.circuit.pass).toBe(true);
    expect(status.halfwave.pass, status.halfwave.detail).toBe(true);
    const drop = m[0]!.vmax - m[1]!.vmax;
    expect(drop).toBeGreaterThan(0.5);
    expect(drop).toBeLessThan(0.9);
    expect(m[1]!.vmin).toBeGreaterThan(-1e-3);
    expect(status.filter.pass).toBe(false);
  });
  it('ไดโอดกลับทิศ → ไม่ผ่าน พร้อมคำอธิบาย', () => {
    const { status } = runLesson('rectifier', build(true), 0.1, 5e-3);
    expect(status.circuit.pass).toBe(true);
    expect(status.halfwave.pass).toBe(false);
    expect(status.halfwave.detail).toMatch(/กลับทิศ/);
  });
  it('มีตัวเก็บประจุ 100 µF: ripple ตรงกับประมาณ Vp/(fRC) และผ่านข้อกรอง', () => {
    const { status, m } = runLesson('rectifier', build(false, true), 1.0, 5e-3, 100);
    expect(status.filter.pass, status.filter.detail).toBe(true);
    const vp = m[1]!.vmax;
    const est = vp / (100 * 1000 * 100e-6);
    expect(m[1]!.vpp).toBeGreaterThan(est * 0.7);
    expect(m[1]!.vpp).toBeLessThan(est * 1.1);
  });
});

describe('แลป 9: ทรานซิสเตอร์เป็นสวิตช์', () => {
  const build = (closed: boolean, rb = 10000) => new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
    .part('bjt', onBoard('f20'), 'Q1') // E e20, B e21, C e22
    .part('switch', onBoard('d5'), 'S1', { closed })
    .part('resistor', onBoard('c7'), 'Rb', { resistance: rb, span: 6 })
    .part('led', onBoard('h25'), 'LED1')
    .part('resistor', onBoard('b25'), 'Rc', { resistance: 220, span: 4 })
    .part('ammeter', onTable(-25, 10), 'AM1')
    .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('j20'), H('bn20'))
    .wire(H('bp5'), H('a5')).wire(H('a13'), H('j21'))
    .wire(H('bp29'), H('a29')).wire(H('a25'), H('g25'))
    .wire(H('g26'), P('AM1', 'A')).wire(P('AM1', 'COM'), H('i22'));
  it('สวิตช์ OFF → คัตออฟ', () => {
    const { analysis, result } = simulate(build(false).doc);
    const built = buildNetlist(build(false).doc);
    const st = checkLesson('transistor', { doc: build(false).doc, built, result, analysis, work: emptyWork() });
    expect(st.wiring.pass, st.wiring.detail).toBe(true);
    expect(st.off.pass).toBe(true);
    expect(st.on.pass).toBe(false);
  });
  it('สวิตช์ ON → อิ่มตัว Vce < 0.3 V, Ic ≈ (5 − Vled − Vce)/220, Ib ตามทฤษฎี', () => {
    const doc = build(true).doc;
    const { analysis, result } = simulate(doc);
    const st = checkLesson('transistor', { doc, built: buildNetlist(doc), result, analysis, work: emptyWork() });
    expect(st.on.pass, st.on.detail).toBe(true);
    expect(st.ib.pass, st.ib.detail).toBe(true);
    const q = analysis.parts['Q1'];
    const vled = analysis.parts['LED1'].voltage;
    expect(Math.abs(q.current - (5 - vled - q.voltage) / 220.01) / q.current).toBeLessThan(0.01);
    expect(Math.abs(analysis.parts['AM1'].current - q.current) / q.current).toBeLessThan(1e-3);
  });
  it('Rb 1 MΩ → ยังไม่อิ่มตัว (ย่านแอกทีฟ)', () => {
    const doc = build(true, 1e6).doc;
    const { analysis, result } = simulate(doc);
    const st = checkLesson('transistor', { doc, built: buildNetlist(doc), result, analysis, work: emptyWork() });
    expect(st.on.pass).toBe(false);
    expect(analysis.parts['Q1'].extra!.region).toBe(1);
  });
});

describe('แลป 13: มอสเฟตเป็นสวิตช์', () => {
  // 2N7000 ที่ f20: S 20, G 21, D 22 (แถว f–j)
  const build = (closed: boolean, opts: { pd?: boolean; model?: '2N7000' | 'IRLZ44N'; swapDS?: boolean } = {}) => {
    const model = opts.model ?? '2N7000';
    const pin = model === '2N7000' ? { s: 20, g: 21, d: 22 } : { g: 20, d: 21, s: 22 };
    if (opts.swapDS) [pin.s, pin.d] = [pin.d, pin.s];
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
      .part('mosfet', onBoard('f20'), 'Q1', mosfetParamsFor(model))
      .part('switch', onBoard('d5'), 'S1', { closed })
      .part('led', onBoard('h25'), 'LED1')
      .part('resistor', onBoard('b25'), 'Rd', { resistance: 220, span: 4 })
      .part('ammeter', onTable(-25, 10), 'AM1')
      .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
      .wire(H(`j${pin.s}`), H(`bn${pin.s}`))
      .wire(H('bp5'), H('a5')).wire(H('a7'), H(`j${pin.g}`))
      .wire(H('bp29'), H('a29')).wire(H('a25'), H('g25'))
      .wire(H('g26'), P('AM1', 'A')).wire(P('AM1', 'COM'), H(`i${pin.d}`));
    if (opts.pd !== false) b.part('resistor', onBoard('b10'), 'Rpd', { resistance: 100e3, span: 4 }).wire(H(`h${pin.g}`), H('a10')).wire(H('a14'), H('bn14'));
    return b;
  };
  const run = (doc: ReturnType<typeof build>['doc']) => {
    const { analysis, result } = simulate(doc);
    return { analysis, st: checkLesson('mosfet', { doc, built: buildNetlist(doc), result, analysis, work: emptyWork() }) };
  };
  it('บทเรียนมีอยู่และมีเป้าหมายครบ', () => {
    const l = LESSONS.find((x) => x.id === 'mosfet')!;
    expect(l.number).toBe(13);
    expect(l.goals.map((g) => g.id)).toEqual(['wiring', 'pulldown', 'off', 'on', 'vgs']);
  });
  it('สวิตช์ OFF + pull-down → คัตออฟ', () => {
    const { st, analysis } = run(build(false).doc);
    expect(st.wiring.pass, st.wiring.detail).toBe(true);
    expect(st.pulldown.pass).toBe(true);
    expect(st.off.pass, st.off.detail).toBe(true);
    expect(st.on.pass).toBe(false);
    expect(Math.abs(analysis.parts['LED1'].current)).toBeLessThan(1e-6);
  });
  it('สวิตช์ ON → เปิดสุด Vds < 0.2 V, Id ≈ (5 − Vled − Vds)/220, ตรงกับแอมมิเตอร์', () => {
    const { st, analysis } = run(build(true).doc);
    for (const k of ['wiring', 'pulldown', 'on', 'vgs']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
    const q = analysis.parts['Q1'];
    const vled = analysis.parts['LED1'].voltage;
    expect(Math.abs(q.current - (5 - vled - q.voltage) / 220.01) / q.current).toBeLessThan(0.01);
    expect(Math.abs(analysis.parts['AM1'].current - q.current) / q.current).toBeLessThan(1e-3);
    expect(q.voltage / q.current).toBeLessThan(6); // Rds(on) 2N7000 ที่ 5 V
  });
  it('IRLZ44N (ลำดับขา G–D–S) ก็ผ่าน และ Vds ต่ำกว่า 2N7000 มาก', () => {
    const a = run(build(true).doc).analysis.parts['Q1'].voltage;
    const { st, analysis } = run(build(true, { model: 'IRLZ44N' }).doc);
    expect(st.on.pass, st.on.detail).toBe(true);
    expect(analysis.parts['Q1'].voltage).toBeLessThan(a / 20);
  });
  it('ไม่มี pull-down: ข้อ pulldown ไม่ผ่าน และสวิตช์ OFF มีคำเตือนเกตลอย', () => {
    const { st, analysis } = run(build(false, { pd: false }).doc);
    expect(st.pulldown.pass).toBe(false);
    expect(st.off.pass).toBe(false);
    expect(analysis.diagnostics.some((d) => d.message.includes('ขาเกตลอย'))).toBe(true);
  });
  it('สลับ D กับ S: wiring แจ้งให้สลับขา', () => {
    const { st } = run(build(true, { swapDS: true }).doc);
    expect(st.wiring.pass).toBe(false);
    expect(st.wiring.detail).toMatch(/สลับขา/);
  });
});

describe('แลป 10: ขยายกลับเฟส', () => {
  const build = (vpp: number) => new Builder()
    .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
    .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
    .part('opamp', onBoard('f10'), 'U1')
    .part('fgen', onTable(-25, 6), 'FG1', { wave: 'sine', frequency: 1000, vpp })
    .part('scope', onTable(-25, 14), 'OSC1')
    .part('resistor', onBoard('i5'), 'Rin', { resistance: 1000, span: 6 })
    .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 })
    .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
    .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
    .wire(H('h18'), H('d12')).wire(H('j12'), H('bn12'))
    .wire(P('FG1', 'OUT'), H('h5')).wire(P('FG1', 'COM'), H('bn4'))
    .wire(H('g5'), P('OSC1', 'CH1')).wire(H('c12'), P('OSC1', 'CH2')).wire(H('bn6'), P('OSC1', 'GND'));
  it('1 Vpp: อัตราขยาย 10 กลับเฟส ผ่านทุกข้อบังคับ', () => {
    const { status, m } = runLesson('opamp', build(1), 0.01025, 2e-4);
    for (const k of ['power', 'circuit', 'scope', 'gain', 'invert']) expect(status[k].pass, `${k}: ${status[k].detail}`).toBe(true);
    expect(Math.abs(m[1]!.vpp / m[0]!.vpp - 10)).toBeLessThan(0.05);
    expect(status.clip.pass).toBe(false);
  });
  it('3 Vpp: ขาออกตัดยอดที่ราว ±10.5 V', () => {
    const { status, m } = runLesson('opamp', build(3), 0.01025, 2e-4);
    expect(status.gain.pass).toBe(false);
    expect(status.gain.detail).toMatch(/ตัดยอด/);
    expect(m[1]!.vmax).toBeGreaterThan(10);
    expect(m[1]!.vmax).toBeLessThan(10.6);
    expect(m[1]!.vmin).toBeLessThan(-10);
  });
});
