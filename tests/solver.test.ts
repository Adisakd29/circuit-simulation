import { describe, expect, it } from 'vitest';
import { deleteWire, setPartParams } from '../src/editor/ops';
import { solveLinear } from '../src/sim/solver';
import { VT } from '../src/model/catalog';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

const REL = 1e-6; // ความคลาดเคลื่อนสัมพัทธ์ที่ประกาศของ solver เทียบคำตอบอ้างอิง
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);

/** วงจรพื้นฐาน: แหล่งจ่าย → (แอมมิเตอร์) → R1 (b10–b14 ⇒ ขา a10, a14) → กลับ */
function basic(withAmmeter: boolean, R = 1000, V = 5) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: V })
    .part('resistor', onBoard('a10'), 'R1', { resistance: R });
  if (withAmmeter) {
    b.part('ammeter', onTable(-25, 12), 'A1')
      .wire(P('PS1', 'pos'), P('A1', 'A'), 'w0')
      .wire(P('A1', 'COM'), H('b10'), 'w1');
  } else b.wire(P('PS1', 'pos'), H('b10'), 'w1');
  b.wire(H('b14'), P('PS1', 'neg'), 'w2');
  return b;
}

describe('เกณฑ์ตรวจรับ: 5 V กับ 1 kΩ', () => {
  it('กระแส ≈ 5 mA (±0.5% เทียบอุดมคติ) และตรงสูตรแบบจำลอง V/(R+Rint) ภายใน 1e-6', () => {
    const { analysis, result } = simulate(basic(false).doc);
    expect(result.ok).toBe(true);
    const I = analysis.parts['R1'].current;
    expect(rel(I, 0.005)).toBeLessThan(0.005);
    expect(rel(I, 5 / (1000 + 0.01))).toBeLessThan(REL);
    expect(analysis.parts['PS1'].mode).toBe('CV');
  });

  it('วัดด้วยแอมมิเตอร์อนุกรม (shunt 1 Ω): อ่านได้ 5/(1000+1+0.01) A', () => {
    const { analysis } = simulate(basic(true).doc);
    const I = analysis.parts['A1'].current;
    expect(rel(I, 5 / 1001.01)).toBeLessThan(REL);
    expect(rel(I, 0.005)).toBeLessThan(0.005);
    expect(rel(analysis.parts['R1'].current, I)).toBeLessThan(REL);
  });
});

describe('เกณฑ์ตรวจรับ: วงจรแบ่งแรงดัน', () => {
  it('R เท่ากันสองตัว วัดแบบไม่มีโหลดได้ครึ่งหนึ่งของแรงดันจ่าย', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 9 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 10000 })  // a5–a9
      .part('resistor', onBoard('b9'), 'R2', { resistance: 10000 })  // b9–b13
      .wire(P('PS1', 'pos'), H('c5'), 'w1')
      .wire(H('c13'), P('PS1', 'neg'), 'w2')
      .probe(H('d9'), H('d13'));
    const { analysis } = simulate(b.doc);
    expect(analysis.probe.value).not.toBeNull();
    expect(rel(analysis.probe.value!, 4.5)).toBeLessThan(1e-5);
    expect(rel(analysis.probe.value!, (9 * 10000) / (20000 + 0.01))).toBeLessThan(REL);
  });
});

describe('เกณฑ์ตรวจรับ: เปิดวงจร', () => {
  it('ถอดสายแล้วกระแสในแขนงเป็นศูนย์ และมีข้อความวงจรเปิด', () => {
    const b = basic(false);
    expect(simulate(b.doc).analysis.parts['R1'].current).toBeGreaterThan(0.004);
    const r = deleteWire(b.doc, 'w2');
    if (!r.ok) throw new Error();
    const { analysis } = simulate(r.doc);
    expect(Math.abs(analysis.parts['R1'].current)).toBeLessThan(1e-9);
    expect(analysis.diagnostics.some((d) => d.message.includes('วงจรเปิด'))).toBe(true);
  });

  it('สวิตช์เปิด → กระแสเป็นศูนย์, ปิด → มีกระแส', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('switch', onBoard('a3'), 'SW1') // a3–a5
      .part('resistor', onBoard('b5'), 'R1') // b5–b9
      .wire(P('PS1', 'pos'), H('b3'), 'w1')
      .wire(H('c9'), P('PS1', 'neg'), 'w2');
    expect(rel(simulate(b.doc).analysis.parts['R1'].current, 5 / 1000.06)).toBeLessThan(REL);
    const r = setPartParams(b.doc, 'SW1', { closed: false });
    if (!r.ok) throw new Error();
    expect(Math.abs(simulate(r.doc).analysis.parts['R1'].current)).toBeLessThan(1e-9);
  });
});

/** หาคำตอบ LED+R อนุกรมแบบอิสระด้วย bisection (อ้างอิง) */
function ledReference(V: number, R: number, Is: number, n: number, Rs: number) {
  const f = (I: number) => V - I * R - I * Rs - n * VT * Math.log(I / Is + 1);
  let lo = 0, hi = V / R;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

describe('เกณฑ์ตรวจรับ: LED ตามแบบจำลอง', () => {
  const ledCircuit = (reversed: boolean, V = 5, R = 220) =>
    new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: V })
      .part('resistor', onBoard('a5'), 'R1', { resistance: R }) // a5–a9
      .part('led', onBoard(reversed ? 'b10' : 'b9', reversed ? 180 : 0), 'LED1') // ถูกขั้ว: A=b9 K=b10 | กลับขั้ว: A=b10 K=b9
      .wire(P('PS1', 'pos'), H('c5'), 'w1')
      .wire(H('c10'), P('PS1', 'neg'), 'w2');

  it('ต่อถูกขั้ว: กระแสตรงกับคำตอบอ้างอิงของสมการ Shockley + Rs', () => {
    const { analysis, built } = simulate(ledCircuit(false).doc);
    const led = built.netlist.elements.find((e) => e.id === 'LED1')!;
    if (led.type !== 'LED') throw new Error();
    const Iref = ledReference(5, 220 + 0.01, led.Is, led.n, led.Rs);
    const I = analysis.parts['LED1'].current;
    expect(rel(I, Iref)).toBeLessThan(1e-6);
    expect(I).toBeGreaterThan(0.012);
    expect(I).toBeLessThan(0.015);
    expect(analysis.parts['LED1'].brightness!).toBeGreaterThan(0.5);
  });

  it('กลับขั้ว: กระแสแทบเป็นศูนย์ และความสว่างเป็น 0 (ไม่ได้ใช้ animation ตายตัว)', () => {
    const { analysis } = simulate(ledCircuit(true).doc);
    expect(Math.abs(analysis.parts['LED1'].current)).toBeLessThan(1e-9);
    expect(analysis.parts['LED1'].brightness).toBe(0);
    expect(analysis.parts['LED1'].voltage).toBeLessThan(-4.9);
  });

  it('กลับขั้วที่ 9 V: แจ้งเกินพิกัดแรงดันย้อน (แบบจำลองการสอน)', () => {
    const { analysis } = simulate(ledCircuit(true, 9).doc);
    expect(analysis.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('แรงดันย้อน'))).toBe(true);
  });

  it('LED ไม่มีตัวต้านทาน: แหล่งจ่ายเข้าโหมด CC และแจ้ง LED เกินพิกัด', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 0.1 })
      .part('led', onBoard('a9'), 'LED1')
      .wire(P('PS1', 'pos'), H('c9'), 'w1')
      .wire(H('c10'), P('PS1', 'neg'), 'w2');
    const { analysis } = simulate(b.doc);
    expect(analysis.parts['PS1'].mode).toBe('CC');
    expect(rel(analysis.parts['LED1'].current, 0.1)).toBeLessThan(1e-6);
    expect(analysis.parts['LED1'].overRated).toBe(true);
  });
});

describe('ความทนทานของ solver', () => {
  it('LED ที่ขาหนึ่งลอย (ไม่ได้ต่อ) ยังลู่เข้า และกระแสเป็นศูนย์', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('led', onBoard('b10', 180), 'LED1') // A=b10 (ลอย) K=b9
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c9'), P('PS1', 'neg'));
    const { result, analysis } = simulate(b.doc);
    expect(result.ok).toBe(true);
    expect(Math.abs(analysis.parts['LED1'].current)).toBeLessThan(1e-9);
  });

  it('LED หลายดวงหลายแขนง (ไปข้างหน้า/กลับขั้ว/ลอย) ลู่เข้า', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 9 })
      .part('resistor', onBoard('a3'), 'R1', { resistance: 330 })
      .part('led', onBoard('b7'), 'LED1')
      .part('led', onBoard('c8', 180), 'LED2', { color: 'blue', ...{} })
      .part('resistor', onBoard('f3'), 'R2', { resistance: 100 })
      .part('led', onBoard('g7'), 'LED3')
      .part('led', onBoard('h20'), 'LED4')
      .wire(P('PS1', 'pos'), H('c3')).wire(H('d8'), P('PS1', 'neg'))
      .wire(H('d3'), H('j3')).wire(H('i8'), H('e8'));
    const { result, analysis } = simulate(b.doc);
    expect(result.ok).toBe(true);
    expect(analysis.parts['LED1'].current).toBeGreaterThan(0.005);
    expect(analysis.parts['LED3'].current).toBeGreaterThan(0.005);
  });
});

describe('เกณฑ์ตรวจรับ: ลัดวงจร', () => {
  it('ต่อขั้ว + กับ − โดยตรง: จำกัดกระแสที่ Ilim ไม่เป็นอนันต์', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { currentLimit: 0.2 }).wire(P('PS1', 'pos'), P('PS1', 'neg'));
    const { analysis, result } = simulate(b.doc);
    expect(result.ok).toBe(true);
    expect(isFinite(analysis.parts['PS1'].current)).toBe(true);
    expect(rel(analysis.parts['PS1'].current, 0.2)).toBeLessThan(1e-9);
    expect(analysis.parts['PS1'].mode).toBe('CC');
    expect(analysis.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ลัดวงจร'))).toBe(true);
  });

  it('ลัดผ่านแอมมิเตอร์ (1 Ω): CC 100 mA, แรงดันขั้วตกเหลือ I·R', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ammeter', onTable(-25, 12), 'A1')
      .wire(P('PS1', 'pos'), P('A1', 'A'))
      .wire(P('A1', 'COM'), P('PS1', 'neg'));
    const { analysis } = simulate(b.doc);
    expect(rel(analysis.parts['A1'].current, 0.1)).toBeLessThan(1e-9);
    expect(rel(analysis.parts['PS1'].voltage, 0.1)).toBeLessThan(1e-6);
  });

  it('R ต่ำทำให้เกินพิกัดกำลังตัวต้านทาน → แจ้งเตือน', () => {
    const { analysis } = simulate(basic(false, 47, 5).doc); // 5V/47Ω ≈ 106 mA > Ilim 100 mA
    expect(analysis.parts['PS1'].mode).toBe('CC');
    expect(analysis.parts['R1'].power).toBeGreaterThan(0.25 * 1.5);
    expect(analysis.parts['R1'].overRated).toBe(true);
  });
});

describe('จุดอ้างอิงและโหนดลอย', () => {
  it('สองวงจรแยกกัน (ขั้วลบไม่ต่อกัน) คำนวณได้ทั้งคู่ แต่วัดข้ามวงจรไม่ได้', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, -6), 'PS1', { voltage: 5 })
      .part('dcsupply', onTable(-25, 6), 'PS2', { voltage: 3 })
      .part('resistor', onBoard('a3'), 'R1')
      .part('resistor', onBoard('a20'), 'R2', { resistance: 2000 })
      .wire(P('PS1', 'pos'), H('b3')).wire(H('b7'), P('PS1', 'neg'))
      .wire(P('PS2', 'pos'), H('b20')).wire(H('b24'), P('PS2', 'neg'))
      .probe(H('c3'), H('c24'));
    const { analysis } = simulate(b.doc);
    expect(rel(analysis.parts['R1'].current, 5 / 1000.01)).toBeLessThan(REL);
    expect(rel(analysis.parts['R2'].current, 3 / 2000.01)).toBeLessThan(REL);
    expect(analysis.probe.value).toBeNull();
    expect(analysis.probe.reason).toContain('คนละวงจร');
  });

  it('โพรบที่รูว่าง → floating ไม่แสดงค่า', () => {
    const b = basic(false).probe(H('c10'), H('j30'));
    const { analysis } = simulate(b.doc);
    expect(analysis.probe.value).toBeNull();
    expect(analysis.probe.reason).toContain('floating');
  });

  it('แหล่งจ่ายต่ออนุกรมกัน (ขั้วลบของ PS2 ไม่ใช่กราวด์ร่วม): 5V+5V = 10V', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, -6), 'PS1')
      .part('dcsupply', onTable(-25, 6), 'PS2')
      .part('resistor', onBoard('a3'), 'R1')
      .wire(P('PS1', 'neg'), P('PS2', 'pos'))
      .wire(P('PS1', 'pos'), H('b3')).wire(H('b7'), P('PS2', 'neg'))
      .probe(H('c3'), H('c7'));
    const { analysis } = simulate(b.doc);
    expect(rel(analysis.parts['R1'].current, 10 / 1000.02)).toBeLessThan(REL);
    expect(rel(analysis.probe.value!, (10 * 1000) / 1000.02)).toBeLessThan(REL);
  });
});

describe('โครงข่ายอ้างอิง: ตัวต้านทานขนาน และวงจรบริดจ์', () => {
  it('1 kΩ ขนาน 1 kΩ ที่ 5 V → 10 mA', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('resistor', onBoard('b5'), 'R2')
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c9'), P('PS1', 'neg'));
    const { analysis } = simulate(b.doc);
    expect(rel(analysis.parts['PS1'].current, 5 / 500.01)).toBeLessThan(REL);
  });

  it('วงจรบริดจ์ 5 ตัวต้านทาน ตรงกับการแก้สมการอิสระ', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10 })
      .part('resistor', onBoard('tp3', 90), 'R1', { resistance: 1000, span: 3 })   // A → C(col3)
      .part('resistor', onBoard('c3', 270), 'R2', { resistance: 2000, span: 4 })   // C → G
      .part('resistor', onBoard('tp8', 90), 'R3', { resistance: 3000, span: 3 })   // A → D(col8)
      .part('resistor', onBoard('c8', 270), 'R4', { resistance: 4000, span: 4 })   // D → G
      .part('resistor', onBoard('d3'), 'R5', { resistance: 5000, span: 5 })        // C → D
      .wire(P('PS1', 'pos'), H('tp20')).wire(P('PS1', 'neg'), H('tn20'));
    const { analysis } = simulate(b.doc);
    // อ้างอิง: nodal ด้วยกราวด์ที่ขั้วลบ ตัวแปร A, C, D
    const g = (r: number) => 1 / r, Gs = g(0.01);
    const M = new Float64Array([
      Gs + g(1000) + g(3000), -g(1000), -g(3000),
      -g(1000), g(1000) + g(2000) + g(5000), -g(5000),
      -g(3000), -g(5000), g(3000) + g(4000) + g(5000),
    ]);
    const rhs = new Float64Array([10 * Gs, 0, 0]);
    const x = solveLinear(M, rhs, 3)!;
    const [, Vc, Vd] = x;
    expect(rel(analysis.parts['R5'].current, (Vc - Vd) / 5000)).toBeLessThan(1e-6);
    expect(rel(analysis.parts['R2'].voltage, Vc)).toBeLessThan(1e-6);
    expect(rel(analysis.parts['R4'].voltage, Vd)).toBeLessThan(1e-6);
  });
});
