import { describe, expect, it } from 'vitest';
import { VT, mosfetParamsFor } from '../src/model/catalog';
import { evalMOS, mosChannel } from '../src/sim/solver';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);
function bisect(f: (x: number) => number, lo: number, hi: number) {
  let flo = f(lo);
  for (let k = 0; k < 300; k++) { const m = (lo + hi) / 2, fm = f(m); if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
  return (lo + hi) / 2;
}
/** สูตรอ้างอิงเขียนแยกจาก solver (ระดับ 1 + Vov แบบนุ่ม ns = 1.5) */
function idRef(vgs: number, vds: number, vth: number, kp: number, lambda: number) {
  const a = 2 * 1.5 * VT;
  const veff = a * Math.log1p(Math.exp((vgs - vth) / a));
  return vds < veff ? kp * (veff * vds - vds * vds / 2) * (1 + lambda * vds) : (kp / 2) * veff * veff * (1 + lambda * vds);
}

describe('แบบจำลอง MOSFET ระดับ 1', () => {
  it('ต่อเนื่องที่รอยต่อย่านเชิงเส้น/อิ่มตัว และอนุพันธ์ตรงกับผลต่างจำกัด', () => {
    for (const vgs of [0.5, 1.9, 2.5, 4.5]) for (const vds of [0.01, 0.4, 1.2, 3, 10]) {
      const f = mosChannel(vgs, vds, 2.1, 0.08, 0.02);
      expect(rel(f.id, idRef(vgs, vds, 2.1, 0.08, 0.02))).toBeLessThan(1e-9);
      const h = 1e-6;
      const gm = (mosChannel(vgs + h, vds, 2.1, 0.08, 0.02).id - mosChannel(vgs - h, vds, 2.1, 0.08, 0.02).id) / (2 * h);
      const gds = (mosChannel(vgs, vds + h, 2.1, 0.08, 0.02).id - mosChannel(vgs, vds - h, 2.1, 0.08, 0.02).id) / (2 * h);
      expect(Math.abs(f.gm - gm)).toBeLessThan(1e-6 + 1e-5 * Math.abs(gm));
      expect(Math.abs(f.gds - gds)).toBeLessThan(1e-6 + 1e-5 * Math.abs(gds));
    }
    const at = mosChannel(4, 1.9 - 1e-9 + 0.0, 2.1, 0.08, 0.02).veff;
    expect(rel(mosChannel(4, at - 1e-9, 2.1, 0.08, 0.02).id, mosChannel(4, at + 1e-9, 2.1, 0.08, 0.02).id)).toBeLessThan(1e-6);
  });

  it('Jacobian ของ evalMOS ตรงกับผลต่างจำกัดทั้งทิศปกติและกลับทิศ ทั้งช่อง N และ P', () => {
    for (const pol of [1, -1] as const) {
      const e = { type: 'MOS' as const, id: 'M', d: 0, g: 1, s: 2, pol, vth: 2, kp: 0.5, lambda: 0.02 };
      for (const [Vd, Vg, Vs] of [[3, 4, 0], [-1, 3.5, 0.5], [0.3, 4, 0], [2, 2.1, 0]].map((v) => v.map((x) => x * pol))) {
        const r = evalMOS(e, Vd, Vg, Vs);
        const V = [Vd, Vg, Vs];
        for (let j = 0; j < 3; j++) {
          const p = V.slice(), m = V.slice(); p[j] += 1e-6; m[j] -= 1e-6;
          const d = (evalMOS(e, p[0], p[1], p[2]).Id - evalMOS(e, m[0], m[1], m[2]).Id) / 2e-6;
          expect(Math.abs(r.J[0][j] - d)).toBeLessThan(1e-6 + 1e-5 * Math.abs(d));
        }
        // ค่าคงที่ของการประมาณเชิงเส้น: I = C + J·V ที่จุดเดียวกัน
        expect(Math.abs(r.C[0] + r.J[0][0] * Vd + r.J[0][1] * Vg + r.J[0][2] * Vs - r.Id)).toBeLessThan(1e-12 + 1e-9 * Math.abs(r.Id));
      }
    }
  });
});

/** IRLZ44N ที่ e10 (G e10, D e11, S e12): โหลด 100 Ω จาก +5 V เข้า D, S ลงกราวด์, Rpd 100 kΩ จาก G ลงกราวด์, (ON) Rg 10 kΩ จาก +5 V เข้า G */
function lowSide(on: boolean, model: '2N7000' | 'IRLZ44N' = 'IRLZ44N', Rload = 100) {
  const pins = model === '2N7000' ? { g: 11, d: 12, s: 10 } : { g: 10, d: 11, s: 12 };
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 2 })
    .part('mosfet', onBoard('e10'), 'Q1', mosfetParamsFor(model))
    .part('resistor', onBoard('tp16', 90), 'RL', { resistance: Rload, span: 3 }) // tp16 → a16
    .part('resistor', onBoard('tn20', 90), 'Rpd', { resistance: 100e3, span: 2 }) // tn20 → a20
    .wire(H('b16'), H(`b${pins.d}`)).wire(H(`c${pins.s}`), H('tn11')).wire(H('b20'), H(`b${pins.g}`))
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
  if (on) b.part('resistor', onBoard('tp24', 90), 'Rg', { resistance: 10e3, span: 3 }).wire(H('b24'), H(`c${pins.g}`));
  return b;
}

describe('MOSFET ในวงจร', () => {
  it('IRLZ44N สวิตช์ฝั่งกราวด์ ON: Vds ตรงกับคำตอบอ้างอิง (ย่านเชิงเส้น) และ Rds(on) ≈ 22 mΩ', () => {
    const { analysis } = simulate(lowSide(true).doc);
    const q = analysis.parts['Q1'];
    const p = mosfetParamsFor('IRLZ44N');
    expect(rel(q.extra!.vgs, 5 * 100e3 / 110e3)).toBeLessThan(1e-3); // แหล่งจ่ายตกคร่อม Rint เล็กน้อย
    const vgs = q.extra!.vgs;
    const vds = bisect((v) => idRef(vgs, v, p.vth, p.kp, p.lambda) - (5 - v) / 100.01, 0, 5);
    expect(Math.abs(q.voltage - vds)).toBeLessThan(1e-6);
    expect(q.extra!.region).toBe(1);
    expect(q.voltage / q.current).toBeGreaterThan(0.015);
    expect(q.voltage / q.current).toBeLessThan(0.03);
    expect(analysis.diagnostics.filter((d) => d.partId === 'Q1' && d.severity !== 'info')).toEqual([]);
  });

  it('IRLZ44N OFF (เกตถูกดึงลงกราวด์): กระแสเดรนน้อยมาก', () => {
    const { analysis } = simulate(lowSide(false).doc);
    expect(Math.abs(analysis.parts['Q1'].current)).toBeLessThan(1e-6);
    expect(analysis.parts['Q1'].extra!.region).toBe(0);
  });

  it('2N7000 ขับเกตด้วย 4.5 V กับโหลด 10 Ω: เปิดไม่สุด (ย่านอิ่มตัว) → มีคำเตือน และ Id ตรงสูตรอิ่มตัว', () => {
    const { analysis } = simulate(lowSide(true, '2N7000', 10).doc);
    const q = analysis.parts['Q1'];
    const p = mosfetParamsFor('2N7000');
    expect(q.extra!.region).toBe(2);
    expect(rel(q.current, idRef(q.extra!.vgs, q.voltage, p.vth, p.kp, p.lambda))).toBeLessThan(1e-6);
    expect(rel(q.current, (5 - q.voltage) / 10.01)).toBeLessThan(1e-4);
    expect(analysis.diagnostics.some((d) => d.partId === 'Q1' && d.message.includes('เปิดไม่สุด'))).toBe(true);
  });

  it('IRF9540N ช่อง P สวิตช์ฝั่งไฟบวก: เกตลงกราวด์ = ON, เกตถูกดึงขึ้น = OFF', () => {
    const build = (on: boolean) => {
      const b = new Builder()
        .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 2 })
        .part('mosfet', onBoard('e10'), 'Q1', mosfetParamsFor('IRF9540N')) // G e10, D e11, S e12
        .part('resistor', onBoard('tn16', 90), 'RL', { resistance: 100, span: 2 }) // tn16 → a16
        .part('resistor', onBoard('tp20', 90), 'Rpu', { resistance: 100e3, span: 3 }) // tp20 → a20
        .wire(H('b16'), H('b11')).wire(H('c12'), H('tp12')).wire(H('b20'), H('b10'))
        .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
      if (on) b.wire(H('c10'), H('tn9'));
      return simulate(b.doc).analysis;
    };
    const on = build(true).parts['Q1'];
    expect(on.current).toBeLessThan(-0.045); // กระแสไหลออกทางขา D (ทิศช่อง P)
    expect(on.extra!.region).toBe(1);
    const off = build(false).parts['Q1'];
    expect(Math.abs(off.current)).toBeLessThan(1e-6);
  });

  it('ต่อ D/S กลับด้าน: ไดโอดในตัวนำกระแสและมีคำเตือน', () => {
    // IRLZ44N กลับด้าน: D ลงกราวด์, S ต่อโหลดขึ้น +5 V (S สูงกว่า D) → ไดโอดในตัวนำ
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 2 })
      .part('mosfet', onBoard('e10'), 'Q1', mosfetParamsFor('IRLZ44N'))
      .part('resistor', onBoard('tp16', 90), 'RL', { resistance: 100, span: 3 })
      .wire(H('b16'), H('b12')).wire(H('c11'), H('tn11')).wire(H('c10'), H('tn10'))
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
    const { analysis } = simulate(b.doc);
    expect(analysis.parts['Q1'].extra!.ibody).toBeGreaterThan(0.03);
    expect(analysis.diagnostics.some((d) => d.partId === 'Q1' && d.message.includes('ไดโอดในตัว'))).toBe(true);
  });

  it('เกตลอย: แจ้งให้ใส่ตัวต้านทาน pull-down', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('mosfet', onBoard('e10'), 'Q1', mosfetParamsFor('IRLZ44N'))
      .part('resistor', onBoard('tp16', 90), 'RL', { resistance: 100, span: 3 })
      .wire(H('b16'), H('b11')).wire(H('c12'), H('tn12'))
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'));
    const { analysis } = simulate(b.doc);
    expect(analysis.diagnostics.some((d) => d.message.includes('ขาเกตลอย'))).toBe(true);
  });

  it('บันทึก/เปิดไฟล์ที่มี MOSFET ได้ครบ และไฟล์ schema 8 เดิมยังเปิดได้', () => {
    const doc = lowSide(true).doc;
    const v = parseProject(serializeProject('m', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 8;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});
