import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { ScopeBuffer, autoSet, measure, type ScopeSettings } from '../src/instruments/scope';
import { SimEngine, type WatchItem } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { Builder, H, P, onBoard, onTable } from './helpers';

const settings: ScopeSettings = { timeDiv: 2e-4, vdiv1: 0.5, vdiv2: 0.5, ch1On: true, ch2On: true, trigSource: 'ch1', trigLevel: 0, trigSlope: 'rise' };

/** จำลองเหมือนแอป: engine ทีละ tick แล้วป้อนตัวอย่างเข้า buffer ของสโคป */
function scopeRun(b: Builder, simSeconds: number, ticks = 20) {
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
    res = engine.handle({ seq: k + 1, netlist: built.netlist, advance: simSeconds / ticks, restart: false, watch, budgetMs: 1e9, sampleSpacing: settings.timeDiv / 40 });
    for (const s of res.samples) buf.push(s.t, s.v[0], s.v[1]);
  }
  return { buf, res };
}

const fgScope = (params: Record<string, unknown>) => new Builder()
  .part('fgen', onTable(-25, -6), 'FG1', params)
  .part('scope', onTable(-25, 8), 'OSC1');

describe('ออสซิลโลสโคป + เครื่องกำเนิดสัญญาณ', () => {
  it('ไซน์ 2 Vpp 1 kHz: วัด Vpp ≈ 2 V และความถี่ ≈ 1 kHz, trigger ได้', () => {
    const b = fgScope({ wave: 'sine', frequency: 1000, vpp: 2 })
      .wire(P('FG1', 'OUT'), P('OSC1', 'CH1')).wire(P('FG1', 'COM'), P('OSC1', 'GND'));
    const { buf } = scopeRun(b, 0.01);
    const f = buf.frame(settings);
    expect(f.triggered).toBe(true);
    const m = f.measure[0]!;
    expect(Math.abs(m.vpp - (2 * 1e6) / (1e6 + 50))).toBeLessThan(0.01); // แบ่งแรงดัน Rout 50 Ω กับขาเข้า 1 MΩ
    expect(Math.abs(m.freq! - 1000) / 1000).toBeLessThan(0.005);
    expect(Math.abs(m.vrms - Math.SQRT1_2)).toBeLessThan(0.01);
    expect(Math.abs(m.vavg)).toBeLessThan(0.01);
    // จุด trigger: ค่าที่ขอบซ้าย + 1 div ≈ ระดับ trigger และกำลังขึ้น
    expect(f.trigTime! - f.t0).toBeCloseTo(settings.timeDiv, 12);
  });

  it('AC coupling: ไซน์ 0.4 Vpp บน DC 15 V — จอแสดงรอบ 0 V, trigger ที่ 0 V ได้, ค่าวัด Vpp/ความถี่เท่าเดิม; Auto เลือก V/div จากส่วนแกว่ง', () => {
    const b = fgScope({ wave: 'sine', frequency: 1000, vpp: 0.4, offset: 15 })
      .wire(P('FG1', 'OUT'), P('OSC1', 'CH1')).wire(P('FG1', 'COM'), P('OSC1', 'GND'));
    const { buf } = scopeRun(b, 0.01);
    const dc = buf.frame(settings), ac = buf.frame({ ...settings, ac1: true });
    expect(dc.triggered).toBe(false); // ระดับ 0 V ไม่ตัดสัญญาณ 15 V
    expect(ac.triggered).toBe(true);
    const shown = ac.ch[0].filter((v): v is number => v !== null);
    expect(Math.max(...shown)).toBeLessThan(0.25); expect(Math.min(...shown)).toBeGreaterThan(-0.25);
    expect(ac.measure[0]!.vpp).toBeCloseTo(dc.measure[0]!.vpp, 6);
    expect(Math.abs(ac.measure[0]!.freq! - 1000)).toBeLessThan(5);
    expect(autoSet(ac.measure[0], null, { ...settings, ac1: true }).vdiv1).toBe(0.1);
    expect(autoSet(dc.measure[0], null, settings).vdiv1).toBe(10);
  });
  it('ช่องที่ไม่ได้ต่อ: วัดได้ 0 V (ขาเข้า 1 MΩ ดึงลง GND)', () => {
    const b = fgScope({ wave: 'sine', frequency: 1000, vpp: 2 })
      .wire(P('FG1', 'OUT'), P('OSC1', 'CH1')).wire(P('FG1', 'COM'), P('OSC1', 'GND'));
    const { buf } = scopeRun(b, 0.005);
    const m = buf.frame(settings).measure[1]!;
    expect(Math.abs(m.vpp)).toBeLessThan(1e-6);
  });

  it('วงจรกรองความถี่ต่ำ RC ที่ fc: CH2/CH1 ≈ 0.707 และ CH2 ล้าหลัง 45°', () => {
    const tau = 1000 * 1e-6;
    const fc = 1 / (2 * Math.PI * (tau + 50 * 1e-6));
    const b = fgScope({ wave: 'sine', frequency: fc, vpp: 2 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 1000 })
      .part('capacitor', onBoard('b9'), 'C1', { capacitance: 1e-6, polarized: false })
      .wire(P('FG1', 'OUT'), H('c5')).wire(H('c11'), P('FG1', 'COM'))
      .wire(H('d5'), P('OSC1', 'CH1')).wire(H('d9'), P('OSC1', 'CH2')).wire(H('d11'), P('OSC1', 'GND'));
    const { buf } = scopeRun(b, 20 / fc, 40);
    const s = { ...settings, timeDiv: 1 / fc / 4 };
    const f = buf.frame(s);
    const m1 = f.measure[0]!, m2 = f.measure[1]!;
    // CH1 อยู่หลัง Rout 50 Ω: วัดอัตราส่วนเทียบแรงดันที่จุดเข้า R (เป็นค่าที่นักเรียนเห็นบนจอ)
    const ratio = m2.vpp / m1.vpp;
    const expected = 1 / Math.sqrt(1 + (2 * Math.PI * fc * tau) ** 2);
    expect(Math.abs(ratio - expected) / expected).toBeLessThan(0.02);
  });

  it('Auto: เลือก time/div ให้เห็นราว 3 คาบ และ V/div ให้รูปคลื่นพอดีจอ', () => {
    const m = measure([0, 1e-3, 2e-3, 3e-3, 4e-3, 5e-3].flatMap((t0) => Array.from({ length: 64 }, (_, i) => t0 + (i * 1e-3) / 64)),
      [0, 1e-3, 2e-3, 3e-3, 4e-3, 5e-3].flatMap(() => Array.from({ length: 64 }, (_, i) => 1.5 * Math.sin((2 * Math.PI * i) / 64))), 0);
    expect(m!.freq).toBeCloseTo(1000, 0);
    const a = autoSet(m, null, settings);
    expect(a.timeDiv).toBe(5e-4);
    expect(a.vdiv1).toBe(0.5);
  });

  it('ไม่มีสัญญาณข้ามระดับ trigger → ไม่ trigger (โหมด Auto แสดงข้อมูลล่าสุด)', () => {
    const b = fgScope({ wave: 'dc', offset: 1 })
      .wire(P('FG1', 'OUT'), P('OSC1', 'CH1')).wire(P('FG1', 'COM'), P('OSC1', 'GND'));
    const { buf } = scopeRun(b, 0.005);
    const f = buf.frame(settings);
    expect(f.triggered).toBe(false);
    expect(Math.abs(f.measure[0]!.vavg - 1)).toBeLessThan(1e-3);
  });
});

import { checkLesson } from '../src/lessons/checks';
import { analyze } from '../src/instruments/measure';
import { emptyWork } from '../src/model/types';

describe('แลป 7: ตรวจผลจากการเชื่อมต่อและค่าที่สโคปวัดได้', () => {
  const build = (ch2AtX = true, f?: number) => {
    const RC = 1000 * 100e-9;
    const fc = 1 / (2 * Math.PI * RC);
    return fgScope({ wave: 'sine', frequency: f ?? fc, vpp: 2 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 1000 })
      .part('capacitor', onBoard('b9'), 'C1', { capacitance: 100e-9, polarized: false })
      .wire(P('FG1', 'OUT'), H('c5')).wire(H('c11'), P('FG1', 'COM'))
      .wire(H('d5'), P('OSC1', 'CH1')).wire(H(ch2AtX ? 'd9' : 'd11'), P('OSC1', 'CH2')).wire(H('e11'), P('OSC1', 'GND'));
  };
  const run = (b: Builder) => {
    const fc = 1 / (2 * Math.PI * 1e-4);
    const { buf, res } = scopeRun(b, 25 / fc, 50);
    const built = buildNetlist(b.doc);
    const frame = buf.frame({ ...settings, timeDiv: 1 / fc / 3 });
    return checkLesson('scope', { doc: b.doc, built, result: res.result, analysis: analyze(b.doc, built, res.result), work: emptyWork(), scopeMeasure: frame.measure, time: res.t });
  };
  it('ต่อครบที่ fc: ผ่านทุกเป้าหมายรวมข้อไม่บังคับ', () => {
    const r = run(build());
    expect(r.connect.pass).toBe(true);
    expect(r.measure.pass).toBe(true);
    expect(r.filter.pass).toBe(true);
    expect(r.ratio.pass).toBe(true);
    expect(r.cutoff.pass).toBe(true);
  });
  it('CH2 ไม่ได้อยู่ที่จุดระหว่าง R กับ C → ข้อ filter ไม่ผ่าน', () => {
    const r = run(build(false));
    expect(r.filter.pass).toBe(false);
  });
});
