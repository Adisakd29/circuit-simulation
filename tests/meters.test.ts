import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';
import { dmmDisplay, dmmFormat } from '../src/instruments/meters';
import { emptyWork, type DmmPart, type VomPart } from '../src/model/types';
import { checkLesson } from '../src/lessons/checks';
import { buildNetlist } from '../src/sim/netlist';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { ToneMeter } from '../src/sim/tone';
import { analyze } from '../src/instruments/measure';

/** แหล่งจ่าย 10 V → วงแบ่งแรงดัน 2 × R (ต่อบนบอร์ด) → มิเตอร์วัดคร่อม R ล่าง */
function divider(R: number, meter: 'dmm' | 'vom', params: Record<string, unknown>) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10, currentLimit: 1 })
    .part('resistor', onBoard('a5'), 'R1', { resistance: R, span: 4 })
    .part('resistor', onBoard('b9'), 'R2', { resistance: R, span: 4 })
    .part(meter, onTable(60, 0), 'M1', params)
    .wire(P('PS1', 'pos'), H('c5'))
    .wire(P('PS1', 'neg'), H('c13'))
    .wire(P('M1', meter === 'dmm' ? 'V' : 'P'), H('d9'))
    .wire(P('M1', 'COM'), H('d13'));
  return simulate(b.doc);
}

describe('มัลติมิเตอร์ดิจิทัล', () => {
  it('ย่าน V⎓: ขาเข้า 10 MΩ — วงแบ่ง 1 kΩ อ่านได้ 5.000 V, วงแบ่ง 1 MΩ อ่านต่ำลงจากผลโหลด (4.762 V)', () => {
    const a = divider(1e3, 'dmm', { mode: 'dcv' });
    expect(a.analysis.parts.M1.extra!.value).toBeCloseTo(5, 3);
    expect(a.analysis.parts.M1.extra!.range).toBe(40);
    const b = divider(1e6, 'dmm', { mode: 'dcv' });
    // 1 MΩ ∥ 10 MΩ = 0.909 MΩ → 10 × 0.909/1.909 = 4.762 V
    expect(b.analysis.parts.M1.extra!.value).toBeCloseTo(4.762, 3);
  });

  it('จอ 4000 count: ย่านอัตโนมัติและจำนวนทศนิยม', () => {
    expect(dmmFormat(4.9998, 40, 'V')).toEqual({ text: '5.00', unit: 'V' });
    expect(dmmFormat(1.234, 4, 'V')).toEqual({ text: '1.234', unit: 'V' });
    expect(dmmFormat(0.1234, 0.4, 'V')).toEqual({ text: '123.4', unit: 'mV' });
    expect(dmmFormat(4700, 40e3, 'Ω')).toEqual({ text: '4.70', unit: 'kΩ' });
    expect(dmmFormat(0.0123, 0.04, 'A')).toEqual({ text: '12.30', unit: 'mA' });
    expect(dmmFormat(250e-6, 400e-6, 'A')).toEqual({ text: '250.0', unit: 'µA' });
  });

  it('ย่าน Ω: วัดตัวต้านทานที่ถอดไฟ (ไม่มีแหล่งจ่าย) ได้ค่าจริง, ปลายเปิด = OL', () => {
    const b = new Builder()
      .part('resistor', onBoard('a5'), 'R1', { resistance: 4700, span: 4 })
      .part('dmm', onTable(60, 0), 'M1', { mode: 'ohm' })
      .wire(P('M1', 'V'), H('c5')).wire(P('M1', 'COM'), H('c9'));
    const r = simulate(b.doc).analysis.parts.M1;
    expect(r.extra!.value).toBeCloseTo(4700, 0);
    expect(dmmDisplay(b.doc.parts.find((p) => p.id === 'M1') as DmmPart, r, true).text).toBe('4.70'); // 4700 > 4000 count → ย่าน 40 kΩ
    const open = new Builder().part('dmm', onTable(60, 0), 'M1', { mode: 'ohm' }).wire(P('M1', 'V'), H('c5')).wire(P('M1', 'COM'), H('c9'));
    expect(simulate(open.doc).analysis.parts.M1.extra!.ol).toBe(1);
  });

  it('ย่าน mA⎓ ต่ออนุกรม: อ่านกระแสจริง (10 V / 2 kΩ + shunt 1 Ω)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10, currentLimit: 1 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 2000, span: 4 })
      .part('dmm', onTable(60, 0), 'M1', { mode: 'dcma' })
      .wire(P('PS1', 'pos'), H('c5'))
      .wire(P('M1', 'mA'), H('c9'))
      .wire(P('M1', 'COM'), P('PS1', 'neg'));
    const r = simulate(b.doc).analysis.parts.M1;
    expect(r.extra!.value).toBeCloseTo(10 / 2001, 6);
    expect(r.extra!.range).toBe(0.04);
  });

  it('เสียบสายแดงขั้ว mA แล้วแตะคร่อมแหล่งจ่าย → ฟิวส์ 440 mA ขาด (ค้างอยู่) และเตือน', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 2 })
      .part('dmm', onTable(60, 0), 'M1', { mode: 'dcv' })
      .wire(P('M1', 'mA'), P('PS1', 'pos'))
      .wire(P('M1', 'COM'), P('PS1', 'neg'));
    const s = simulate(b.doc);
    expect(s.result.relayStates?.['M1#ma#blown']).toBe(true);
    expect(s.analysis.parts.M1.extra!.blownMa).toBe(1);
    expect(s.analysis.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ฟิวส์'))).toBe(true);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('มีสายเสียบขั้ว mA'))).toBe(true);
  });
});

describe('มัลติมิเตอร์แบบเข็ม', () => {
  const vom = (r: ReturnType<typeof divider>) => r.analysis.parts.M1.extra!;
  it('ย่าน DCV 10 V: 20 kΩ/V = 200 kΩ — วงแบ่ง 100 kΩ อ่านได้ต่ำกว่าจริงชัดเจน (ผลโหลด)', () => {
    const a = vom(divider(1e3, 'vom', { sel: 'dcv10' }));
    expect(a.frac).toBeCloseTo(0.5, 2);
    // 100 kΩ ∥ 200 kΩ = 66.7 kΩ → 10 × 66.7/166.7 = 4.0 V
    const b = vom(divider(100e3, 'vom', { sel: 'dcv10' }));
    expect(b.value).toBeCloseTo(4.0, 2);
    expect(b.frac).toBeCloseTo(0.4, 2);
  });

  it('ย่านต่ำเกินไป → เข็มตีเกินสเกล + เตือน · สลับสาย → เข็มตีกลับ', () => {
    const over = divider(1e3, 'vom', { sel: 'dcv2.5' });
    expect(vom(over).frac).toBeGreaterThan(1.5);
    expect(over.analysis.diagnostics.some((d) => d.message.includes('เกินสเกล'))).toBe(true);
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
      .part('vom', onTable(60, 0), 'M1', { sel: 'dcv10' })
      .wire(P('M1', 'P'), P('PS1', 'neg')).wire(P('M1', 'COM'), P('PS1', 'pos'));
    const s = simulate(b.doc);
    expect(s.analysis.parts.M1.extra!.frac).toBeCloseTo(-0.5, 2);
    expect(s.analysis.diagnostics.some((d) => d.message.includes('ตีกลับ'))).toBe(true);
  });

  it('ย่าน Ω ×100: ตัวต้านทาน 2 kΩ = ค่ากลางสเกล (20 × 100) → เข็มครึ่งสเกล', () => {
    const b = new Builder()
      .part('resistor', onBoard('a5'), 'R1', { resistance: 2000, span: 4 })
      .part('vom', onTable(60, 0), 'M1', { sel: 'ohm100' })
      .wire(P('M1', 'P'), H('c5')).wire(P('M1', 'COM'), H('c9'));
    const x = simulate(b.doc).analysis.parts.M1.extra!;
    expect(x.frac).toBeCloseTo(0.5, 3);
    expect(x.ohm).toBeCloseTo(2000, 0);
  });

  it('ย่าน Ω: ขั้ว COM (สายดำ) เป็นบวก — LED ติดเมื่อสายดำอยู่ขา A', () => {
    const led = (blackOnAnode: boolean) => {
      const b = new Builder()
        .part('led', onBoard('a5'), 'D1', { color: 'red' })
        .part('vom', onTable(60, 0), 'M1', { sel: 'ohm1' })
        .wire(P('M1', blackOnAnode ? 'COM' : 'P'), H('c5'))
        .wire(P('M1', blackOnAnode ? 'P' : 'COM'), H('c6'));
      return simulate(b.doc).analysis.parts.D1.current;
    };
    expect(led(true)).toBeGreaterThan(5e-3);
    expect(led(false)).toBeLessThan(1e-6);
  });

  it('ย่าน DCA ต่อขนานแหล่งจ่าย (ผิด) → ฟิวส์ 0.5 A ขาด', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 2 })
      .part('vom', onTable(60, 0), 'M1', { sel: 'dca0.25' })
      .wire(P('M1', 'P'), P('PS1', 'pos')).wire(P('M1', 'COM'), P('PS1', 'neg'));
    const s = simulate(b.doc);
    expect(s.analysis.parts.M1.extra!.blown).toBe(1);
    expect((b.doc.parts.find((p) => p.id === 'M1') as VomPart).params.sel).toBe('dca0.25');
  });
});

describe('แลป 33 มัลติมิเตอร์', () => {
  const check = (doc: import('../src/model/types').CircuitDoc) => {
    const s = simulate(doc);
    return { st: checkLesson('meters', { doc, built: s.built, result: s.result, analysis: s.analysis, work: emptyWork() }), s };
  };
  const base = () => new Builder()
    .part('resistor', onBoard('a5'), 'R1', { resistance: 100e3, span: 4 })
    .part('resistor', onBoard('b9'), 'R2', { resistance: 100e3, span: 4 });

  it('ขั้น 2: DMM ย่าน Ω คร่อม R1 ที่ยังไม่ต่อไฟ → ผ่าน ohm', () => {
    const b = base().part('dmm', onTable(60, 0), 'DMM1', { mode: 'ohm' }).wire(P('DMM1', 'V'), H('c5')).wire(P('DMM1', 'COM'), H('c9'));
    const { st, s } = check(b.doc);
    expect(s.analysis.parts.DMM1.extra!.value).toBeCloseTo(100e3, -1);
    expect(st.ohm.pass).toBe(true);
    expect(st.dmmV.pass).toBe(false);
  });

  it('ขั้น 3–4: DMM อ่าน ≈ 4.975 V แต่ VOM ย่าน 10 V อ่าน ≈ 4.0 V (ผลการโหลด) → ผ่าน dmmV, vomV, loading', () => {
    const pw = (b: Builder) => b.part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10 }).wire(P('PS1', 'pos'), H('d5')).wire(P('PS1', 'neg'), H('d13'));
    const d = check(pw(base()).part('dmm', onTable(60, 0), 'DMM1', { mode: 'dcv' }).wire(P('DMM1', 'V'), H('c9')).wire(P('DMM1', 'COM'), H('c13')).doc);
    expect(d.s.analysis.parts.DMM1.extra!.value).toBeCloseTo(10 * (1 / (1 / 100e3 + 1 / 10e6)) / (100e3 + 1 / (1 / 100e3 + 1 / 10e6)), 3);
    expect(d.st.dmmV.pass).toBe(true);
    const v = check(pw(base()).part('vom', onTable(60, 0), 'VOM1', { sel: 'dcv10' }).wire(P('VOM1', 'P'), H('c9')).wire(P('VOM1', 'COM'), H('c13')).doc);
    expect(v.s.analysis.parts.VOM1.extra!.value).toBeCloseTo(4.0, 2);
    expect(v.st.vomV.pass).toBe(true);
    expect(v.st.loading.pass).toBe(true);
    // ย่าน 50 V (1 MΩ) ผลการโหลดน้อยลง แต่เข็มขยับน้อย (10% ของสเกล)
    const v50 = check(pw(base()).part('vom', onTable(60, 0), 'VOM1', { sel: 'dcv50' }).wire(P('VOM1', 'P'), H('c9')).wire(P('VOM1', 'COM'), H('c13')).doc);
    expect(v50.s.analysis.parts.VOM1.extra!.value).toBeCloseTo(10 * (1 / (1 / 100e3 + 1 / 1e6)) / (100e3 + 1 / (1 / 100e3 + 1 / 1e6)), 3);
  });

  it('ขั้น 5: DMM ย่าน mA ต่ออนุกรม อ่าน ≈ 50 µA → ผ่าน current · บันทึกค่าในหน่วย µA ได้', () => {
    const b = base().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10 })
      .part('dmm', onTable(60, 0), 'DMM1', { mode: 'dcma' })
      .wire(P('PS1', 'pos'), P('DMM1', 'mA')).wire(P('DMM1', 'COM'), H('d5')).wire(P('PS1', 'neg'), H('d13'));
    const { st, s } = check(b.doc);
    expect(s.analysis.parts.DMM1.extra!.value).toBeCloseTo(10 / 200001, 8);
    expect(s.analysis.parts.DMM1.extra!.range).toBe(400e-6);
    expect(st.current.pass).toBe(true);
  });

  it('ทางเลือก: VOM ย่าน Ω ×1k วัด 100 kΩ (เข็ม ≈ 17% ของสเกล) → ผ่าน vomOhm · วัดขณะมีไฟ → ไม่ผ่าน ohm', () => {
    const b = base().part('vom', onTable(60, 0), 'VOM1', { sel: 'ohm1k' }).wire(P('VOM1', 'P'), H('c5')).wire(P('VOM1', 'COM'), H('c9'));
    const { st, s } = check(b.doc);
    expect(s.analysis.parts.VOM1.extra!.frac).toBeCloseTo(20 / 120, 3);
    expect(st.vomOhm.pass).toBe(true);
    const live = base().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 10 }).wire(P('PS1', 'pos'), H('d5')).wire(P('PS1', 'neg'), H('d13'))
      .part('dmm', onTable(60, 0), 'DMM1', { mode: 'ohm' }).wire(P('DMM1', 'V'), H('c5')).wire(P('DMM1', 'COM'), H('c9'));
    const r = check(live.doc);
    expect(r.st.ohm.pass).toBe(false);
    expect(r.s.analysis.diagnostics.some((d) => d.message.includes('วัดความต้านทานขณะวงจรมีไฟ'))).toBe(true);
  });
});

describe('มัลติมิเตอร์ในการจำลองตามเวลา (ค่าเฉลี่ย DC / ค่า AC)', () => {
  /** เครื่องกำเนิดสัญญาณ → R 1 kΩ → มิเตอร์คร่อม R (โหลด 10 MΩ / 200 kΩ แทบไม่มีผลเพราะ Rout 50 Ω) */
  const run = (meter: 'dmm' | 'vom', params: Record<string, unknown>, fg: Record<string, unknown>, seconds = 0.3) => {
    const b = new Builder()
      .part('fgen', onTable(-25, 0), 'FG1', { outputImpedance: 50, outputOn: true, ...fg })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 1000, span: 4 })
      .part(meter, onTable(60, 0), 'M1', params)
      .wire(P('FG1', 'OUT'), H('c5')).wire(P('FG1', 'COM'), H('c9'))
      .wire(P('M1', meter === 'dmm' ? 'V' : 'P'), H('d5')).wire(P('M1', 'COM'), H('d9'));
    const built = buildNetlist(b.doc);
    const e = new SimEngine();
    let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    for (let k = 0; k * 0.02 < seconds; k++) r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.02, restart: false, watch: [], budgetMs: 1e9 });
    return analyze(b.doc, built, r.result, r.tones).parts.M1.extra!;
  };
  const k = 1000 / 1050; // วงแบ่งจาก Rout 50 Ω

  it('DMM V~ วัดไซน์ 2 Vpp 1 kHz = 0.707 V rms × วงแบ่ง (ตัด DC offset 1 V ออก)', () => {
    const x = run('dmm', { mode: 'acv' }, { wave: 'sine', frequency: 1000, vpp: 2, offset: 1 });
    expect(x.value).toBeCloseTo(Math.SQRT1_2 * k, 2);
  });

  it('DMM V⎓ วัดไซน์ที่มี offset 1 V = ค่าเฉลี่ย 1 V × วงแบ่ง', () => {
    const x = run('dmm', { mode: 'dcv' }, { wave: 'sine', frequency: 1000, vpp: 2, offset: 1 });
    expect(x.value).toBeCloseTo(k, 2);
  });

  it('ย่าน AC ตอบสนองค่าเฉลี่ย: คลื่นสี่เหลี่ยม ±1 V อ่านได้ 1.11 V (rms จริง 1 V)', () => {
    const x = run('dmm', { mode: 'acv' }, { wave: 'square', frequency: 1000, vpp: 2, offset: 0 });
    expect(x.value).toBeCloseTo(1.1107 * k, 1);
  });

  it('VOM ACV 10 V: ไซน์ 10 Vpp → เข็มที่ 3.54 V (35% ของสเกล)', () => {
    const x = run('vom', { sel: 'acv10' }, { wave: 'sine', frequency: 50, vpp: 10, offset: 0 }, 0.4);
    expect(x.value).toBeCloseTo(5 * Math.SQRT1_2 * k, 1);
    expect(x.frac).toBeCloseTo((5 * Math.SQRT1_2 * k) / 10, 2);
  });

  it('เปลี่ยนย่านแล้วเริ่มเฉลี่ยใหม่ (ไม่ใช้ตัวอย่างของย่านเดิม) — ToneMeter', () => {
    const t = new ToneMeter();
    t.setMeters([{ id: 'M', el: 'M#m', q: 'v', mode: 'dcv' }]);
    t.feed(0, { ok: true, elements: { 'M#m': { voltage: 5, current: 0, power: 0 } } } as never);
    t.feed(0.01, { ok: true, elements: { 'M#m': { voltage: 5, current: 0, power: 0 } } } as never);
    expect(t.read().M.mavg).toBeCloseTo(5, 9);
    t.setMeters([{ id: 'M', el: 'M#m', q: 'v', mode: 'ohm' }]);
    expect(t.read().M).toBeUndefined();
  });
});
