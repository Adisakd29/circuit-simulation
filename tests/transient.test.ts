import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../src/sim/netlist';
import { advance, newTranState, restart } from '../src/sim/transient';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** เดินเวลาไปทีละจุดแล้วคืนค่าที่ต้องการ ณ เวลาที่กำหนด (เทียบคำตอบเชิงวิเคราะห์) */
function runAt(doc: Builder['doc'], times: number[], read: (r: ReturnType<typeof advance>['result']) => number) {
  const { netlist } = buildNetlist(doc);
  const st = newTranState();
  return times.map((t) => {
    const out = advance(netlist, st, t);
    expect(out.ok).toBe(true);
    expect(out.reached).toBe(true);
    return read(out.result);
  });
}

describe('RC: อัดประจุ (ตัวเก็บประจุเริ่มว่าง)', () => {
  // 5 V → R 1 kΩ (a5–a9) → C 100 µF (b9–b11) → กลับขั้วลบ
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1')
    .part('resistor', onBoard('a5'), 'R1')
    .part('capacitor', onBoard('b9'), 'C1', { capacitance: 100e-6 })
    .wire(P('PS1', 'pos'), H('c5')).wire(H('c11'), P('PS1', 'neg'));
  const tau = (1000 + 0.01) * 100e-6;

  it('v_C(t) = 5(1 − e^(−t/τ)) ภายใน 0.1% ของ 5 V ที่ t = 0.1τ … 5τ', () => {
    const ts = [0.1, 0.5, 1, 2, 3, 5].map((k) => k * tau);
    const vs = runAt(b.doc, ts, (r) => r.elements['C1'].voltage);
    ts.forEach((t, i) => expect(Math.abs(vs[i] - 5 * (1 - Math.exp(-t / tau)))).toBeLessThan(0.005));
  });

  it('ที่ t = τ ได้ 63.2% ของแรงดันจ่าย', () => {
    const [v] = runAt(b.doc, [tau], (r) => r.elements['C1'].voltage);
    expect(Math.abs(v / 5 - 0.632)).toBeLessThan(0.002);
  });

  it('กระแสเริ่มต้น ≈ V/R แล้วลดเป็น 0 เมื่ออัดเต็ม', () => {
    const [i0, iEnd] = runAt(b.doc, [1e-6, 10 * tau], (r) => r.elements['R1'].current);
    expect(Math.abs(i0 - 0.005) / 0.005).toBeLessThan(0.01);
    expect(Math.abs(iEnd)).toBeLessThan(5e-6);
  });

  it('เริ่มเวลาใหม่ → ตัวเก็บประจุกลับมาว่าง', () => {
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    advance(netlist, st, 5 * tau);
    restart(st);
    const out = advance(netlist, st, 0);
    expect(Math.abs(out.result.elements['C1'].voltage)).toBeLessThan(1e-6);
  });
});

describe('RC: คายประจุ (แรงดันเริ่มต้น 5 V)', () => {
  it('v_C(t) = 5e^(−t/RC)', () => {
    const b = new Builder()
      .part('capacitor', onBoard('a5'), 'C1', { capacitance: 10e-6, initialVoltage: 5 }) // a5–a7
      .part('resistor', onBoard('b7'), 'R1', { resistance: 10000 }) // b7–b11
      .wire(H('c11'), H('c5'));
    const tau = 10000 * 10e-6;
    const ts = [0.5, 1, 2, 4].map((k) => k * tau);
    const vs = runAt(b.doc, ts, (r) => r.elements['C1'].voltage);
    ts.forEach((t, i) => expect(Math.abs(vs[i] - 5 * Math.exp(-t / tau))).toBeLessThan(0.005));
  });
});

describe('RL: กระแสเพิ่มขึ้นแบบเอกซ์โพเนนเชียล', () => {
  it('i(t) = (V/R)(1 − e^(−tR/L)) รวม DCR และ Rint', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1', { resistance: 100 })
      .part('inductor', onBoard('b9'), 'L1', { inductance: 0.1, resistance: 1 }) // b9–b12
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c12'), P('PS1', 'neg'));
    const R = 100 + 1 + 0.01, L = 0.1, tau = L / R, Iinf = 5 / R;
    const ts = [0.2, 1, 3, 6].map((k) => k * tau);
    const is = runAt(b.doc, ts, (r) => r.elements['L1'].current);
    ts.forEach((t, i) => expect(Math.abs(is[i] - Iinf * (1 - Math.exp(-t / tau))) / Iinf).toBeLessThan(0.002));
  });
});

describe('RLC อนุกรม: การแกว่งแบบหน่วง (underdamped)', () => {
  it('v_C(t) ตรงกับคำตอบเชิงวิเคราะห์ภายใน 1% ของ V0 ตลอด 3 รอบ', () => {
    const b = new Builder()
      .part('capacitor', onBoard('a5'), 'C1', { capacitance: 10e-6, initialVoltage: 5, polarized: false }) // a5–a7
      .part('inductor', onBoard('b7'), 'L1', { inductance: 10e-3, resistance: 1 }) // b7–b10
      .part('resistor', onBoard('c10'), 'R1', { resistance: 10 }) // c10–c14
      .wire(H('d14'), H('d5'));
    const R = 11, L = 10e-3, C = 10e-6, V0 = 5;
    const a = R / (2 * L), w0 = 1 / Math.sqrt(L * C), wd = Math.sqrt(w0 * w0 - a * a);
    const period = (2 * Math.PI) / wd;
    const ts = Array.from({ length: 30 }, (_, k) => ((k + 1) * 3 * period) / 30);
    const vs = runAt(b.doc, ts, (r) => r.elements['C1'].voltage);
    ts.forEach((t, i) => {
      const ref = V0 * Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
      expect(Math.abs(vs[i] - ref)).toBeLessThan(0.05);
    });
  });
});

describe('RC กับ LED: LED หรี่ลงตามแรงดันตัวเก็บประจุ', () => {
  it('ตัวเก็บประจุ 1000 µF คายผ่าน R + LED: กระแส LED ลดลงตามเวลา', () => {
    const b = new Builder()
      .part('capacitor', onBoard('a5'), 'C1', { capacitance: 1000e-6, initialVoltage: 5 }) // a5–a7
      .part('resistor', onBoard('b5'), 'R1', { resistance: 220, span: 5 }) // b5–b10
      .part('led', onBoard('c10'), 'LED1') // A c10, K c11
      .wire(H('d11'), H('c7'));
    const [i1, i2, i3] = runAt(b.doc, [0.01, 0.2, 1.0], (r) => r.elements['LED1'].current);
    expect(i1).toBeGreaterThan(0.01);
    expect(i2).toBeLessThan(i1);
    expect(i3).toBeLessThan(i2);
  });
});

describe('แก้ไขวงจรระหว่างจำลอง: ตัวเก็บประจุจำแรงดันไว้', () => {
  it('อัดประจุแล้วถอดสายแหล่งจ่าย → แรงดันค้าง (ไม่มีทางคายประจุ)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('capacitor', onBoard('b9'), 'C1', { capacitance: 100e-6 })
      .wire(P('PS1', 'pos'), H('c5'), 'wp').wire(H('c11'), P('PS1', 'neg'), 'wn');
    const st = newTranState();
    advance(buildNetlist(b.doc).netlist, st, 1.0);
    const open = { ...b.doc, wires: b.doc.wires.filter((w) => w.id !== 'wp') };
    const out = advance(buildNetlist(open).netlist, st, 2.0);
    expect(out.ok).toBe(true);
    expect(Math.abs(out.result.elements['C1'].voltage - 5)).toBeLessThan(0.01);
  });
});
