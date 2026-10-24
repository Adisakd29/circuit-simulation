import { describe, expect, it } from 'vitest';
import { netOfPin } from '../src/connectivity/connectivity';
import { analyze } from '../src/instruments/measure';
import { bodeAt, measureBode, slopeDbPerDecade, toBode } from '../src/instruments/bode';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork } from '../src/model/types';
import { logSweep, solveAC } from '../src/sim/ac';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';
import { validateProjectFile } from '../src/model/schema';
import { Builder, H, P, onBoard, onTable } from './helpers';

const fc = 1 / (2 * Math.PI * 1000 * 100e-9);

/** วงจรกรอง + สโคป: low = R ก่อน C, high = C ก่อน R; CH1 ที่ OUT, CH2 ที่จุดกลาง, GND ที่ COM */
function filter(kind: 'low' | 'high', ch2Mid = true) {
  const b = new Builder()
    .part('fgen', onTable(-25, -6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 2 })
    .part('scope', onTable(-25, 8), 'OSC1');
  if (kind === 'low') b.part('resistor', onBoard('j5'), 'R1', { resistance: 1000, span: 4 }).part('capacitor', onBoard('i9'), 'C1', { capacitance: 100e-9, polarized: false, span: 2 });
  else b.part('capacitor', onBoard('j5'), 'C1', { capacitance: 100e-9, polarized: false, span: 4 }).part('resistor', onBoard('i9'), 'R1', { resistance: 1000, span: 2 });
  return b.wire(P('FG1', 'OUT'), H('h5')).wire(H('h11'), P('FG1', 'COM'))
    .wire(H('g5'), P('OSC1', 'CH1')).wire(H(ch2Mid ? 'g9' : 'g11'), P('OSC1', 'CH2')).wire(H('f11'), P('OSC1', 'GND'));
}

function bodeOf(b: Builder, ref: 'ch1' | 'source' = 'ch1', f0 = 10, f1 = 1e5, ppd = 20) {
  const built = buildNetlist(b.doc);
  const c = built.connectivity, g = netOfPin(c, 'OSC1', 'GND');
  const r = solveAC({ netlist: built.netlist, freqs: logSweep(f0, f1, ppd), probes: [
    { key: 'ch1', a: netOfPin(c, 'OSC1', 'CH1'), b: g }, { key: 'ch2', a: netOfPin(c, 'OSC1', 'CH2'), b: g }] });
  return { d: toBode(r, ref), built };
}

describe('กราฟโบด', () => {
  it('low-pass: −3 dB ที่ fc (±0.2% — รวมโหลด 1 MΩ ของ CH2), −20 dB/ทศวรรษ, −45° ที่ fc', () => {
    const { d } = bodeOf(filter('low'));
    expect(d.ok).toBe(true);
    const m = measureBode(d)!;
    expect(Math.abs(m.peakDb)).toBeLessThan(0.01);
    expect(Math.abs(m.fHigh! / fc - 1)).toBeLessThan(2e-3);
    expect(m.fLow).toBeNull();
    expect(Math.abs(slopeDbPerDecade(d, fc * 10, fc * 50)! + 20)).toBeLessThan(0.1);
    expect(Math.abs(bodeAt(d, fc).phase! + 45)).toBeLessThan(0.5);
  });
  it('high-pass: +20 dB/ทศวรรษ ต่ำกว่า fc และ +45° ที่ fc', () => {
    const { d } = bodeOf(filter('high'));
    const m = measureBode(d)!;
    expect(Math.abs(m.fLow! / fc - 1)).toBeLessThan(5e-3);
    expect(Math.abs(slopeDbPerDecade(d, fc / 50, fc / 10)! - 20)).toBeLessThan(0.1);
    expect(Math.abs(bodeAt(d, fc).phase! - 45)).toBeLessThan(0.5);
  });
  it('อ้างอิงแหล่ง: fc ลดลงเพราะรวม Rout 50 Ω → 1/(2π·1050·C)', () => {
    const { d } = bodeOf(filter('low'), 'source');
    const f3 = measureBode(d)!.fHigh!;
    expect(Math.abs(f3 / (1 / (2 * Math.PI * 1050 * 100e-9)) - 1)).toBeLessThan(3e-3);
  });
  it('วงขยายกลับเฟส ×10: 20 dB เฟส −180° ที่ 1 kHz และแบนด์วิดท์ ≈ GBW/(1 + Rf/Rin) = 90.9 kHz', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
      .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
      .part('opamp', onBoard('f10'), 'U1')
      .part('fgen', onTable(-25, 6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 1 })
      .part('scope', onTable(-25, 14), 'OSC1')
      .part('resistor', onBoard('i5'), 'Rin', { resistance: 1000, span: 6 })
      .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 })
      .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
      .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
      .wire(H('h18'), H('d12')).wire(H('j12'), H('bn12'))
      .wire(P('FG1', 'OUT'), H('h5')).wire(P('FG1', 'COM'), H('bn4'))
      .wire(H('g5'), P('OSC1', 'CH1')).wire(H('c12'), P('OSC1', 'CH2')).wire(H('bn6'), P('OSC1', 'GND'));
    const { d } = bodeOf(b, 'ch1', 10, 1e6);
    const v = bodeAt(d, 1000);
    const f3 = 1e6 / 11;
    expect(Math.abs(v.mag! - 20)).toBeLessThan(0.01);
    // เฟส = −180° − atan(f/f3) (ขั้วเดียวของวงปิด)
    const ph = ((v.phase! % 360) + 360) % 360; // 0..360 → กลับเฟส ≈ 180 − 0.63
    expect(Math.abs(ph - (180 - (Math.atan(1000 / f3) * 180) / Math.PI))).toBeLessThan(0.05);
    const m = measureBode(d)!;
    expect(Math.abs(m.fHigh! / f3 - 1)).toBeLessThan(0.02);
  });
  it('CH2 ไม่ได้ต่อ → ข้อความอธิบาย ไม่แสดงกราฟที่ไม่มีความหมาย', () => {
    const b = new Builder().part('fgen', onTable(-25, -6), 'FG1').part('scope', onTable(-25, 8), 'OSC1')
      .wire(P('FG1', 'OUT'), P('OSC1', 'CH1')).wire(P('FG1', 'COM'), P('OSC1', 'GND'));
    const { d } = bodeOf(b);
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/CH2/);
  });
});

describe('แลป 11: ตรวจผลจากกราฟโบด', () => {
  const run = (b: Builder, f1 = 1e5, ref: 'ch1' | 'source' = 'ch1') => {
    const { d, built } = bodeOf(b, ref, 10, f1);
    const result = solveDC(built.netlist);
    return checkLesson('bode', { doc: b.doc, built, result, analysis: analyze(b.doc, built, result), work: emptyWork(), bode: d });
  };
  it('low-pass ครบ → ผ่านทุกข้อบังคับ', () => {
    const st = run(filter('low'));
    for (const k of ['connect', 'lowpass', 'fc', 'slope']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
    expect(st.highpass.pass).toBe(false);
  });
  it('high-pass → ผ่านข้อไม่บังคับ', () => {
    expect(run(filter('high')).highpass.pass).toBe(true);
  });
  it('ช่วง sweep แคบเกิน → บอกช่วงที่ต้องตั้ง', () => {
    const st = run(filter('low'), 1e4);
    expect(st.lowpass.pass).toBe(false);
    expect(st.lowpass.detail).toMatch(/ครอบคลุม/);
  });
  it('อ้างอิงแหล่ง → fc คลาด 5% และบอกให้ใช้ CH2/CH1', () => {
    const st = run(filter('low'), 1e5, 'source');
    expect(st.fc.pass).toBe(false);
    expect(st.fc.detail).toMatch(/CH2\/CH1/);
  });
  it('CH2 ไม่ได้อยู่ที่จุดกลาง → ข้อ lowpass ไม่ผ่าน', () => {
    expect(run(filter('low', false)).lowpass.pass).toBe(false);
  });
});

describe('schema 5', () => {
  it('ไฟล์รุ่น 4 ที่มีออสซิลโลสโคป → เติมค่าตั้งกราฟโบด', () => {
    const b = filter('low');
    const doc = JSON.parse(JSON.stringify(b.doc));
    for (const p of doc.parts) if (p.kind === 'scope') { delete p.params.bodeStart; delete p.params.bodeStop; delete p.params.bodePpd; delete p.params.bodeRef; }
    const r = validateProjectFile({ format: 'circuitlab3d', schemaVersion: 4, app: 't', savedAt: '', title: 't', circuit: doc, studentWork: emptyWork() });
    expect(r.ok, r.errors?.join()).toBe(true);
    const sc = r.file!.circuit.parts.find((p) => p.kind === 'scope')!;
    expect(sc.params).toMatchObject({ bodeStart: 10, bodeStop: 100e3, bodePpd: 20, bodeRef: 'ch1' });
  });
});
