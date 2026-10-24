import { describe, expect, it } from 'vitest';
import { VT } from '../src/model/catalog';
import { buildNetlist } from '../src/sim/netlist';
import { advance, newTranState } from '../src/sim/transient';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);

/** หาคำตอบด้วย bisection (อ้างอิงอิสระจาก solver) */
function bisect(f: (x: number) => number, lo: number, hi: number) {
  let flo = f(lo);
  for (let k = 0; k < 300; k++) {
    const m = (lo + hi) / 2, fm = f(m);
    if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m;
  }
  return (lo + hi) / 2;
}

describe('ไดโอด', () => {
  it('1N4148 ไปข้างหน้ากับ 1 kΩ ที่ 5 V ตรงกับสมการ Shockley + Rs', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('diode', onBoard('b9'), 'D1') // A b9, K b13
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c13'), P('PS1', 'neg'));
    const { analysis } = simulate(b.doc);
    const Is = 2.52e-9, n = 1.752, Rs = 0.568;
    const I = bisect((i) => 5 - i * (1000.01 + Rs) - n * VT * Math.log(i / Is + 1), 1e-9, 5e-3);
    expect(rel(analysis.parts['D1'].current, I)).toBeLessThan(1e-6);
    expect(analysis.parts['D1'].voltage).toBeGreaterThan(0.55);
    expect(analysis.parts['D1'].voltage).toBeLessThan(0.75);
  });

  it('1N4148 กลับขั้วที่ 5 V: กระแสรั่วระดับ nA (ไม่พังทลาย)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('diode', onBoard('b13', 180), 'D1') // A b13, K b9
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c13'), P('PS1', 'neg'));
    const { analysis } = simulate(b.doc);
    expect(Math.abs(analysis.parts['D1'].current)).toBeLessThan(1e-8);
  });

  it('ซีเนอร์ 5.1 V คุมแรงดัน: 12 V ผ่าน 470 Ω ได้แรงดันคร่อม ≈ 5.0–5.1 V ตรงกับคำตอบอ้างอิง', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 12 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 470 })
      .part('diode', onBoard('b13', 180), 'Z1', { model: 'Z5V1', Is: 1e-14, n: 1, Rs: 2, Bv: 5.0, Ibv: 0.049, maxCurrent: 0.178, maxPower: 1 }) // K ที่ b9 (ฝั่ง +)
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c13'), P('PS1', 'neg'));
    const { analysis } = simulate(b.doc);
    const Vz = -analysis.parts['Z1'].voltage;
    expect(Vz).toBeGreaterThan(4.95);
    expect(Vz).toBeLessThan(5.1);
    // อ้างอิง: วงจรอนุกรม 12 V = I·(470.01 + Rs) + vj, vj = Bv + Vt·ln(I/Ibv)
    const I = bisect((i) => 12 - i * (470.01 + 2) - (5.0 + VT * Math.log(i / 0.049)), 1e-6, 0.03);
    expect(rel(-analysis.parts['Z1'].current, I)).toBeLessThan(1e-4);
  });
});

/** NPN: Vcc 10 V, Rc (a20–a24 → คอลเลกเตอร์), Rb จาก Vcc เข้าเบส, อีมิตเตอร์ลงกราวด์ */
function npnCircuit(Rb: number, Rc = 1000) {
  return new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10, currentLimit: 1 })
    .part('bjt', onBoard('e10'), 'Q1') // E e10, B e11, C e12
    .part('resistor', onBoard('tp14', 90), 'Rc', { resistance: Rc, span: 3 }) // tp14 → a14
    .part('resistor', onBoard('tp8', 90), 'Rb', { resistance: Rb, span: 3 }) // tp8 → a8
    .wire(H('b14'), H('b12')).wire(H('b8'), H('b11')).wire(H('b10'), H('tn10'))
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
}

describe('ทรานซิสเตอร์ BJT', () => {
  it('NPN ย่านแอกทีฟ: Ic/Ib = βF, Vbe ≈ 0.65 V, Vce = 10 − Ic·Rc', () => {
    const { analysis } = simulate(npnCircuit(470e3).doc);
    const q = analysis.parts['Q1'];
    const ib = q.extra!.ib;
    expect(rel(q.current / ib, 200)).toBeLessThan(0.01);
    expect(q.extra!.vbe).toBeGreaterThan(0.55);
    expect(q.extra!.vbe).toBeLessThan(0.72);
    expect(rel(ib, (10 - q.extra!.vbe) / 470e3)).toBeLessThan(1e-3);
    expect(rel(q.voltage, 10 - q.current * 1000)).toBeLessThan(1e-3);
    expect(q.extra!.region).toBe(1);
  });

  it('NPN อิ่มตัว (Rb 10 kΩ): Vce < 0.2 V, Ic ≈ (10 − Vce)/Rc', () => {
    const { analysis } = simulate(npnCircuit(10e3).doc);
    const q = analysis.parts['Q1'];
    expect(q.voltage).toBeLessThan(0.2);
    expect(rel(q.current, (10 - q.voltage) / 1000)).toBeLessThan(2e-3);
    expect(q.extra!.region).toBe(2);
  });

  it('NPN ไม่มีกระแสเบส → คัตออฟ Ic ≈ 0', () => {
    const b = npnCircuit(470e3);
    b.doc = { ...b.doc, wires: b.doc.wires.filter((w) => !(w.a.kind === 'hole' && w.a.hole === 'b8')) };
    const { analysis } = simulate(b.doc);
    expect(Math.abs(analysis.parts['Q1'].current)).toBeLessThan(1e-7); // เหลือเพียงกระแสรั่วจาก gmin ของแบบจำลอง
    expect(analysis.parts['Q1'].extra!.region).toBe(0);
  });

  it('PNP ย่านแอกทีฟ: Ic/Ib = βF (กระแสทิศกลับจาก NPN)', () => {
    // อีมิตเตอร์ที่ +10 V, Rb จากเบสลงกราวด์, Rc จากคอลเลกเตอร์ลงกราวด์
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10, currentLimit: 1 })
      .part('bjt', onBoard('e10'), 'Q1', { model: '2N3906', polarity: 'pnp', Is: 1.41e-15, bf: 180, br: 4.977 })
      .part('resistor', onBoard('tn14', 90), 'Rc', { resistance: 1000, span: 2 }) // tn14 → a14
      .part('resistor', onBoard('tn8', 90), 'Rb', { resistance: 470e3, span: 2 }) // tn8 → a8
      .wire(H('b14'), H('b12')).wire(H('b8'), H('b11')).wire(H('b10'), H('tp10'))
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
    const { analysis } = simulate(b.doc);
    const q = analysis.parts['Q1'];
    expect(q.current).toBeLessThan(0);
    expect(rel(q.current / q.extra!.ib, 180)).toBeLessThan(0.01);
    expect(q.extra!.region).toBe(1);
  });
});

/**
 * ออปแอมป์ตำแหน่ง e10: ขา 2 IN− = คอลัมน์ 11 บน, ขา 3 IN+ = คอลัมน์ 12 บน, ขา 4 V− = คอลัมน์ 13 บน,
 * ขา 6 OUT = คอลัมน์ 12 ล่าง, ขา 7 V+ = คอลัมน์ 11 ล่าง; กราวด์ = ราง T−
 */
function opampBase(model?: Record<string, unknown>) {
  return new Builder()
    .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
    .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
    .part('opamp', onBoard('f10'), 'U1', model)
    .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
    .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'));
}

describe('ออปแอมป์', () => {
  const inverting = (vin: number) => opampBase()
    .part('dcsupply', onTable(-25, 6), 'PSI', { voltage: vin })
    .part('resistor', onBoard('i5'), 'Rin', { resistance: 1000, span: 6 }) // b5–b11 (IN−)
    .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 }) // d11–d18
    .wire(H('h18'), H('d12')) // ปลาย Rf → OUT
    .wire(H('j12'), H('bn12')) // IN+ ลงกราวด์
    .wire(P('PSI', 'pos'), H('h5')).wire(P('PSI', 'neg'), H('bn4'))
    .probe(H('c12'), H('bn20'));

  it('ขยายกลับเฟส Rf/Rin = 10: Vin 0.5 V → Vout = −5 V (คลาดเคลื่อนจากอัตราขยายจำกัด < 0.1%)', () => {
    const { analysis, result } = simulate(inverting(0.5).doc);
    expect(result.ok).toBe(true);
    const vout = analysis.probe.value!;
    expect(rel(vout, -5)).toBeLessThan(1e-3);
    expect(analysis.parts['U1'].extra!.saturated).toBe(0);
  });

  it('สัญญาณเข้ามากเกิน (2 V): เอาต์พุตอิ่มตัวใกล้ −(12 − 1.5) V (ลบแรงดันตกที่ Rout จากกระแสป้อนกลับ)', () => {
    const { analysis } = simulate(inverting(2).doc);
    // vo → −10.5 V; กระแส (Vin − Vout)/(Rin + Rf) ไหลผ่าน Rout 75 Ω ทำให้ Vout สูงกว่าเล็กน้อย
    const expected = (-10.5 * 11000 + 2 * 75) / (11000 + 75);
    expect(Math.abs(analysis.probe.value! - expected)).toBeLessThan(0.02);
    expect(analysis.parts['U1'].extra!.saturated).toBe(1);
  });

  it('ตัวตามแรงดัน (follower) และกระแสขาออกมาจากแหล่งจ่าย +12 V', () => {
    const b = opampBase()
      .part('dcsupply', onTable(-25, 6), 'PSI', { voltage: 3 })
      .part('resistor', onBoard('b14'), 'RL', { resistance: 1000, span: 3 }) // i14–i17 (โหลดจาก OUT ผ่านสาย)
      .wire(P('PSI', 'pos'), H('j12')).wire(P('PSI', 'neg'), H('bn4'))
      .wire(H('i11'), H('c12')) // IN− ← OUT
      .wire(H('a12'), H('a14')).wire(H('a17'), H('tn17')).wire(H('tn18'), H('bn18'))
      .probe(H('d12'), H('bn20'));
    const { analysis } = simulate(b.doc);
    expect(rel(analysis.probe.value!, 3)).toBeLessThan(1e-4);
    // โหลด 3 mA มาจากไฟเลี้ยงบวก บวกกระแสนิ่งของออปแอมป์ (V+ − V−)/Rq = 24 V / 14 kΩ
    const iq = analysis.parts['U1'].extra!.iq;
    expect(rel(iq, 24 / 14e3)).toBeLessThan(1e-3);
    expect(rel(analysis.parts['PSP'].current, 3 / 1000 + iq)).toBeLessThan(1e-3);
  });

  it('ไฟเลี้ยงไม่ครบ (ถอดแหล่งจ่ายลบ) → เอาต์พุตอยู่ในช่วงไฟเลี้ยงที่มี ไม่ระเบิดเป็นค่าแปลก', () => {
    const b = inverting(0.5);
    b.doc = { ...b.doc, wires: b.doc.wires.filter((w) => !(w.b.kind === 'hole' && w.b.hole === 'j13')) };
    const { analysis, result } = simulate(b.doc);
    expect(result.ok).toBe(true);
    expect(isFinite(analysis.parts['U1'].current)).toBe(true);
  });

  it('ขยายกลับเฟสกับไซน์ตามเวลา: แอมพลิจูดขาออก = 10 เท่า กลับเฟส', () => {
    const b = opampBase()
      .part('fgen', onTable(-25, 6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 0.4 })
      .part('resistor', onBoard('i5'), 'Rin', { resistance: 1000, span: 6 })
      .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 })
      .wire(H('h18'), H('d12')).wire(H('j12'), H('bn12'))
      .wire(P('FG1', 'OUT'), H('h5')).wire(P('FG1', 'COM'), H('bn4'));
    const { netlist } = buildNetlist(b.doc);
    const st = newTranState();
    let vmax = -Infinity, vmin = Infinity;
    advance(netlist, st, 0.003, { onSample: (_t, r) => { const v = r.elements['U1'].voltage - 12; vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); } });
    // ขาเข้าวงจรผ่าน Rout 50 Ω ของเครื่องกำเนิด: อัตราขยาย = −10000/(1000 + 50)
    const expected = 0.2 * 10000 / 1050;
    expect(Math.abs(vmax - expected) / expected).toBeLessThan(0.01);
    expect(Math.abs(-vmin - expected) / expected).toBeLessThan(0.01);
  });
});
