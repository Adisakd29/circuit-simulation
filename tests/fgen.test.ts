import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../src/sim/netlist';
import { advance, newTranState } from '../src/sim/transient';
import { nextBreakpoint, waveValue } from '../src/sim/waveform';
import { Builder, H, P, onBoard, onTable } from './helpers';

const fg = (params: Record<string, unknown>) => new Builder().part('fgen', onTable(-25, 0), 'FG1', params);

describe('รูปคลื่น', () => {
  const w = { wave: 'square' as const, freq: 100, vpp: 4, offset: 1 };
  it('สี่เหลี่ยม/สามเหลี่ยม/ไซน์ ให้ค่าตามนิยาม', () => {
    expect(waveValue(w, 0.001)).toBe(3);
    expect(waveValue(w, 0.006)).toBe(-1);
    expect(waveValue({ ...w, wave: 'triangle' }, 0.0025)).toBeCloseTo(3, 12);
    expect(waveValue({ ...w, wave: 'triangle' }, 0.0075)).toBeCloseTo(-1, 12);
    expect(waveValue({ ...w, wave: 'sine' }, 0.0025)).toBeCloseTo(3, 12);
    expect(waveValue({ ...w, wave: 'dc' }, 0.3)).toBe(1);
  });
  it('จุดหักถัดไป: ขอบสี่เหลี่ยมที่ครึ่งคาบ', () => {
    expect(nextBreakpoint(w, 0)).toBeCloseTo(0.005, 12);
    expect(nextBreakpoint(w, 0.005)).toBeCloseTo(0.01, 12);
    expect(nextBreakpoint({ ...w, wave: 'sine' }, 0)).toBe(Infinity);
  });
});

describe('เครื่องกำเนิดสัญญาณ + โหลดตัวต้านทาน', () => {
  it('ไซน์ 2 Vpp 1 kHz บน 1 kΩ: v = sin(2πft)·1000/1050 (Rout 50 Ω)', () => {
    const b = fg({ wave: 'sine', frequency: 1000, vpp: 2 })
      .part('resistor', onBoard('a5'), 'R1')
      .wire(P('FG1', 'OUT'), H('b5')).wire(H('b9'), P('FG1', 'COM'));
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    for (const t of [0.00013, 0.00025, 0.0006, 0.0011, 0.00375]) {
      const out = advance(netlist, st, t);
      expect(out.ok).toBe(true);
      const ref = Math.sin(2 * Math.PI * 1000 * t) * (1000 / 1050);
      expect(Math.abs(out.result.elements['R1'].voltage - ref)).toBeLessThan(0.002);
    }
  });

  it('ก้าวเวลาลงตรงขอบคลื่นสี่เหลี่ยมพอดี', () => {
    const b = fg({ wave: 'square', frequency: 50, vpp: 2 })
      .part('resistor', onBoard('a5'), 'R1')
      .wire(P('FG1', 'OUT'), H('b5')).wire(H('b9'), P('FG1', 'COM'));
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    const times: number[] = [];
    advance(netlist, st, 0.05, { onSample: (t) => times.push(t) });
    for (const edge of [0.01, 0.02, 0.03, 0.04]) expect(times.some((t) => Math.abs(t - edge) < 1e-12)).toBe(true);
  });
});

describe('เครื่องกำเนิดสัญญาณ + วงจร RC', () => {
  const rcLow = (params: Record<string, unknown>) => fg(params)
    .part('resistor', onBoard('a5'), 'R1', { resistance: 1000 })      // a5–a9
    .part('capacitor', onBoard('b9'), 'C1', { capacitance: 1e-6, polarized: false }) // b9–b11
    .wire(P('FG1', 'OUT'), H('c5')).wire(H('c11'), P('FG1', 'COM'));
  const tau = 1050 * 1e-6;

  it('คลื่นสี่เหลี่ยม: ครึ่งคาบแรกตัวเก็บประจุอัดประจุแบบ RC (±1% ของ A)', () => {
    const b = rcLow({ wave: 'square', frequency: 50, vpp: 2 }); // ครึ่งคาบ 10 ms ≫ τ
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    for (const t of [0.5e-3, 1e-3, 2e-3, 4e-3]) {
      const out = advance(netlist, st, t);
      expect(Math.abs(out.result.elements['C1'].voltage - (1 - Math.exp(-t / tau)))).toBeLessThan(0.01);
    }
    // ขอบลงที่ 10 ms: หลังจากนั้นคายประจุไปสู่ −1 V
    const out = advance(netlist, st, 0.011);
    const v10 = 1 - Math.exp(-0.01 / tau);
    const ref = -1 + (v10 + 1) * Math.exp(-0.001 / tau);
    expect(Math.abs(out.result.elements['C1'].voltage - ref)).toBeLessThan(0.01);
  });

  it('ไซน์ที่ความถี่ตัด fc = 1/(2πRC): แอมพลิจูดคร่อม C ≈ 0.707 ของขาเข้า (±1%)', () => {
    const fc = 1 / (2 * Math.PI * tau);
    const b = rcLow({ wave: 'sine', frequency: fc, vpp: 2 });
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    advance(netlist, st, 12 * tau); // ผ่านช่วงเริ่มต้น
    let peak = 0;
    advance(netlist, st, 12 * tau + 2 / fc, { onSample: (_t, r) => { peak = Math.max(peak, Math.abs(r.elements['C1'].voltage)); } });
    expect(Math.abs(peak - Math.SQRT1_2) / Math.SQRT1_2).toBeLessThan(0.01);
  });
});
