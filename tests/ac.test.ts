import { describe, expect, it } from 'vitest';
import { netOfPin } from '../src/connectivity/connectivity';
import { cabs, cdiv, logSweep, phaseDeg, solveAC, solveComplex, type AcProbe } from '../src/sim/ac';
import { SimEngine, type WatchItem } from '../src/sim/engine';
import { buildNetlist, type Netlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';
import { Builder, H, P, onBoard, onTable } from './helpers';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);

/** probe ระหว่างขาอุปกรณ์สองขา */
function probeOf(b: Builder, key: string, a: [string, string], ref: [string, string]): AcProbe {
  const c = buildNetlist(b.doc).connectivity;
  return { key, a: netOfPin(c, a[0], a[1]), b: netOfPin(c, ref[0], ref[1]) };
}

/** อัตราขยาย DC จากผลต่างจำกัด: แก้ DC ที่ offset ± h (อ้างอิงอิสระจากการทำเป็นเชิงเส้นใน ac.ts) */
function fdGain(nl: Netlist, p: AcProbe, h = 1e-4): number {
  const at = (d: number) => {
    const r = solveDC({ ...nl, elements: nl.elements.map((e) => (e.type === 'FGEN' ? { ...e, wave: 'dc' as const, offset: e.offset + d } : e)) });
    expect(r.ok).toBe(true);
    return (r.nodeVoltage[p.a!] as number) - (r.nodeVoltage[p.b!] as number);
  };
  return (at(h) - at(-h)) / (2 * h);
}

describe('ตัวแก้สมการเชิงซ้อน', () => {
  it('เทียบคำตอบที่รู้ (3×3 เชิงซ้อน)', () => {
    // A = [[2+i, 1, 0], [1, 3, -i], [0, i, 4]], x = [1, 1+i, -2i] → b = A·x
    const Are = Float64Array.from([2, 1, 0, 1, 3, 0, 0, 0, 4]);
    const Aim = Float64Array.from([1, 0, 0, 0, 0, -1, 0, 1, 0]);
    const x = [{ re: 1, im: 0 }, { re: 1, im: 1 }, { re: 0, im: -2 }];
    const bre = new Float64Array(3), bim = new Float64Array(3);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const ar = Are[i * 3 + j], ai = Aim[i * 3 + j];
      bre[i] += ar * x[j].re - ai * x[j].im; bim[i] += ar * x[j].im + ai * x[j].re;
    }
    const s = solveComplex(Are, Aim, bre, bim, 3)!;
    for (let i = 0; i < 3; i++) { expect(Math.abs(s.re[i] - x[i].re)).toBeLessThan(1e-12); expect(Math.abs(s.im[i] - x[i].im)).toBeLessThan(1e-12); }
  });
  it('logSweep: 10 Hz – 100 kHz, 10 จุด/ทศวรรษ = 41 จุด ปลายตรง', () => {
    const f = logSweep(10, 1e5, 10);
    expect(f.length).toBe(41);
    expect(rel(f[0], 10)).toBeLessThan(1e-12);
    expect(rel(f[40], 1e5)).toBeLessThan(1e-12);
    expect(rel(f[10], 100)).toBeLessThan(1e-12);
  });
});

/** RC: OUT → R (a5–a9) → C (b9–b11) → COM */
const rcLowPass = (R = 1000, C = 100e-9) => new Builder()
  .part('fgen', onTable(-25, -6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 2 })
  .part('resistor', onBoard('j5'), 'R1', { resistance: R, span: 4 })
  .part('capacitor', onBoard('i9'), 'C1', { capacitance: C, polarized: false, span: 2 })
  .wire(P('FG1', 'OUT'), H('h5')).wire(H('h11'), P('FG1', 'COM'));

describe('AC sweep: วงจรเชิงเส้นเทียบสูตร', () => {
  it('RC low-pass: Vc/Vin = 1/(1 + jωRC) ทั้งขนาดและเฟส (< 1e-8) ทุกความถี่', () => {
    const b = rcLowPass();
    const nl = buildNetlist(b.doc).netlist;
    const freqs = logSweep(10, 1e6, 10);
    const r = solveAC({ netlist: nl, freqs, probes: [probeOf(b, 'in', ['FG1', 'OUT'], ['FG1', 'COM']), probeOf(b, 'out', ['C1', 'P'], ['FG1', 'COM'])] });
    expect(r.ok, r.error).toBe(true);
    freqs.forEach((f, i) => {
      const H = cdiv(r.values.out[i]!, r.values.in[i]!);
      const w = 2 * Math.PI * f * 1000 * 100e-9;
      const theory = cdiv({ re: 1, im: 0 }, { re: 1, im: w });
      expect(Math.abs(H.re - theory.re) + Math.abs(H.im - theory.im)).toBeLessThan(1e-8);
    });
    // แรงดันที่ขั้ว OUT = 1 V ลดลงตาม Rout 50 Ω: ที่ความถี่ต่ำ |Vin| ≈ 1
    expect(rel(cabs(r.values.in[0]!), 1)).toBeLessThan(1e-4);
  });

  it('RLC อนุกรม (แบนด์พาส คร่อม R): ยอดที่ f0 = 1/(2π√LC), ที่ f0 เฟส 0°, แบนด์วิดท์ −3 dB = R/(2πL)', () => {
    // OUT → L (a5–a7) → C (b7–b9) → R 100 Ω (c9–c13) → COM; DCR ของ L = 0
    const b = new Builder()
      .part('fgen', onTable(-25, -6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 2, outputImpedance: 50 })
      .part('inductor', onBoard('j5'), 'L1', { inductance: 10e-3, resistance: 0, span: 2 })
      .part('capacitor', onBoard('i7'), 'C1', { capacitance: 1e-6, polarized: false, span: 2 })
      .part('resistor', onBoard('h9'), 'R1', { resistance: 100, span: 4 })
      .wire(P('FG1', 'OUT'), H('g5')).wire(H('g13'), P('FG1', 'COM'));
    const nl = buildNetlist(b.doc).netlist;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-3 * 1e-6));
    const Rt = 150; // R + Rout
    const theory = (f: number) => {
      const w = 2 * Math.PI * f;
      return cdiv({ re: 100, im: 0 }, { re: Rt, im: w * 10e-3 - 1 / (w * 1e-6) }); // V_R / EMF
    };
    const freqs = [f0 / 3, f0 / 1.1, f0, f0 * 1.1, f0 * 3];
    const r = solveAC({ netlist: nl, freqs, probes: [probeOf(b, 'vr', ['R1', '1'], ['R1', '2'])] });
    expect(r.ok).toBe(true);
    freqs.forEach((f, i) => {
      const t = theory(f), v = r.values.vr[i]!;
      // ทิศของ probe: R1 ขา 1 ฝั่ง C, ขา 2 ฝั่ง COM → เฟสเดียวกับกระแส
      expect(cabs({ re: Math.abs(v.re) - Math.abs(t.re), im: Math.abs(v.im) - Math.abs(t.im) })).toBeLessThan(1e-9);
    });
    expect(Math.abs(phaseDeg(r.values.vr[2]!))).toBeLessThan(1e-6);
    expect(rel(cabs(r.values.vr[2]!), 100 / 150)).toBeLessThan(1e-9);
  });
});

describe('AC sweep: อุปกรณ์ไม่เชิงเส้น (อัตราขยายที่ความถี่ต่ำ = ผลต่างจำกัดของคำตอบ DC)', () => {
  const check = (b: Builder, probe: [string, string], ref: [string, string]) => {
    const nl = buildNetlist(b.doc).netlist;
    const p = probeOf(b, 'v', probe, ref);
    const r = solveAC({ netlist: nl, freqs: [1e-6, 1e3], probes: [p] }); // 1 µHz: ต่ำกว่าขั้ววงเปิดของออปแอมป์ (GBW/A ≈ 5 Hz) มาก จึงเทียบกับผล DC ได้
    expect(r.ok, r.error).toBe(true);
    const fd = fdGain(nl, p);
    const ac = r.values.v[0]!;
    expect(Math.abs(ac.im)).toBeLessThan(1e-9 * Math.max(1, Math.abs(ac.re)));
    expect(rel(ac.re, fd)).toBeLessThan(2e-5);
    return { ac: ac.re, fd, r };
  };

  it('ไดโอด 1N4148 ไบแอสตรง: rd = nVt/Id + Rs', () => {
    const b = new Builder()
      .part('fgen', onTable(-25, -6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 0.1, offset: 3 })
      .part('resistor', onBoard('j5'), 'R1', { resistance: 1000, span: 4 })
      .part('diode', onBoard('i9'), 'D1') // A b9, K b13
      .wire(P('FG1', 'OUT'), H('h5')).wire(H('h13'), P('FG1', 'COM'));
    const { ac } = check(b, ['D1', 'A'], ['D1', 'K']);
    expect(ac).toBeGreaterThan(0.005);
    expect(ac).toBeLessThan(0.05);
  });

  it('BJT อีมิตเตอร์ร่วม: อัตราขยาย ≈ −gm·Rc·(สัดส่วนจากวงแบ่งเบส) และตรงกับผลต่างจำกัด', () => {
    // fgen offset 1.2 V → Rb 22 kΩ → B; Rc 1 kΩ จาก +5 V ถึง C; E ลงกราวด์
    const b = new Builder()
      .part('dcsupply', onTable(-25, 4), 'PS1', { voltage: 5 })
      .part('fgen', onTable(-25, -6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 0.01, offset: 1.2 })
      .part('bjt', onBoard('f20'), 'Q1')
      .part('resistor', onBoard('j14'), 'Rb', { resistance: 22000, span: 7 }) // a14–a21 (B)
      .part('resistor', onBoard('i22'), 'Rc', { resistance: 1000, span: 4 }) // b22 (C) – b26
      .wire(P('FG1', 'OUT'), H('h14')).wire(P('FG1', 'COM'), H('bn2'))
      .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn3'))
      .wire(H('j20'), H('bn20')).wire(H('h26'), H('bp26'));
    const { ac, r } = check(b, ['Q1', 'C'], ['FG1', 'COM']);
    expect(ac).toBeLessThan(-5); // กลับเฟส ขยายหลายเท่า
    expect(r.op!.elements['Q1'].extra!.region).toBe(1);
  });

  it('ออปแอมป์ไม่กลับเฟส 1 + 10k/1k = 11 (คลาดจากอัตราขยายจำกัดเท่านั้น)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
      .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
      .part('opamp', onBoard('f10'), 'U1')
      .part('fgen', onTable(-25, 6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 0.2 })
      .part('resistor', onBoard('i5'), 'Rg', { resistance: 1000, span: 6 }) // b5–b11 (IN−)
      .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 }) // d11–d18
      .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
      .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
      .wire(H('h18'), H('d12')).wire(H('h5'), H('bn5'))
      .wire(P('FG1', 'OUT'), H('j12')).wire(P('FG1', 'COM'), H('bn4'));
    const { ac } = check(b, ['U1', 'OUT'], ['FG1', 'COM']);
    expect(rel(ac, 11)).toBeLessThan(1e-3);
  });
  it('ออปแอมป์ขั้วเดียว: วงไม่กลับเฟส ×11 มี −3 dB ที่ ≈ GBW/11 และเฟส −45° ที่นั่น', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: 12 })
      .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: 12 })
      .part('opamp', onBoard('f10'), 'U1')
      .part('fgen', onTable(-25, 6), 'FG1', { wave: 'sine', frequency: 1000, vpp: 0.2 })
      .part('resistor', onBoard('i5'), 'Rg', { resistance: 1000, span: 6 })
      .part('resistor', onBoard('g11'), 'Rf', { resistance: 10000, span: 7 })
      .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
      .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
      .wire(H('h18'), H('d12')).wire(H('h5'), H('bn5'))
      .wire(P('FG1', 'OUT'), H('j12')).wire(P('FG1', 'COM'), H('bn4'));
    const nl = buildNetlist(b.doc).netlist;
    const p = probeOf(b, 'v', ['U1', 'OUT'], ['FG1', 'COM']);
    // คำตอบอ้างอิงแบบปิด: A(jf) = A/(1 + jf/fp), fp = GBW/A, β = Rg/(Rg+Rf) → G = A(jf)/(1 + β·A(jf))
    const A = 2e5, fp = 1e6 / A, beta = 1000 / 11000;
    const ref = (f: number) => { const x = f / fp, den = (1 + beta * A) ** 2 + x * x; return { re: (A * (1 + beta * A)) / den, im: (-A * x) / den }; };
    const f3 = fp * (1 + beta * A);
    expect(Math.abs(f3 / 90.9e3 - 1)).toBeLessThan(2e-3);
    const r = solveAC({ netlist: nl, freqs: [100, f3, 1e6], probes: [p] });
    expect(r.ok, r.error).toBe(true);
    const mag = (z: { re: number; im: number }) => Math.hypot(z.re, z.im);
    const v = r.values.v.map((z) => z!);
    // Rout 75 Ω/Rin ของแบบจำลองทำให้ต่างจากสูตรอุดมคติเล็กน้อย (มากขึ้นที่ 1 MHz ซึ่งอัตราขยายวงเปิดเหลือ ≈ 1)
    [5e-3, 5e-3, 0.02].forEach((tol, k) => expect(rel(mag(v[k]), mag(ref([100, f3, 1e6][k])))).toBeLessThan(tol));
    expect(Math.abs(mag(v[1]) / mag(v[0]) - Math.SQRT1_2)).toBeLessThan(5e-3);
    expect(Math.abs((Math.atan2(v[1].im, v[1].re) * 180) / Math.PI + 45)).toBeLessThan(0.5);
  });
});

describe('AC sweep สอดคล้องกับการจำลองตามเวลา', () => {
  it('RC ที่ 3 kHz: แอมพลิจูดคร่อม C จากการจำลองตามเวลา = |H|·แอมพลิจูดขาเข้า (±0.5%)', () => {
    const b = rcLowPass();
    b.doc = { ...b.doc, parts: b.doc.parts.map((p) => (p.kind === 'fgen' ? { ...p, params: { ...p.params, frequency: 3000 } } : p)) };
    const built = buildNetlist(b.doc);
    const pin = probeOf(b, 'in', ['FG1', 'OUT'], ['FG1', 'COM']), pout = probeOf(b, 'out', ['C1', 'P'], ['FG1', 'COM']);
    const r = solveAC({ netlist: built.netlist, freqs: [3000], probes: [pin, pout] });
    const ratio = cabs(r.values.out[0]!) / cabs(r.values.in[0]!);
    const engine = new SimEngine();
    const watch: WatchItem[] = [{ key: 'i', kind: 'v', a: pin.a, b: pin.b }, { key: 'o', kind: 'v', a: pout.a, b: pout.b }];
    engine.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch, budgetMs: 1e9 });
    let maxIn = 0, maxOut = 0;
    for (let k = 0; k < 40; k++) {
      const res = engine.handle({ seq: k + 1, netlist: built.netlist, advance: 20 / 3000 / 40, restart: false, watch, budgetMs: 1e9, sampleSpacing: 1e-7 });
      if (k >= 20) for (const s of res.samples) { maxIn = Math.max(maxIn, s.v[0]!); maxOut = Math.max(maxOut, s.v[1]!); }
    }
    expect(rel(maxOut / maxIn, ratio)).toBeLessThan(5e-3);
  });
});

describe('AC sweep: ข้อผิดพลาดที่อธิบายได้', () => {
  it('ไม่มีเครื่องกำเนิดสัญญาณ → แจ้งเหตุ', () => {
    const b = new Builder().part('resistor', onBoard('j5'), 'R1');
    const r = solveAC({ netlist: buildNetlist(b.doc).netlist, freqs: [100], probes: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/เครื่องกำเนิดสัญญาณ/);
  });
  it('probe คนละส่วนวงจร → null (ไม่แสดงค่าที่ไม่มีความหมาย)', () => {
    const b = rcLowPass().part('resistor', onBoard('e20'), 'Rx');
    const r = solveAC({ netlist: buildNetlist(b.doc).netlist, freqs: [100], probes: [probeOf(b, 'x', ['Rx', '1'], ['FG1', 'COM'])] });
    expect(r.ok).toBe(true);
    expect(r.values.x[0]).toBeNull();
  });
});
