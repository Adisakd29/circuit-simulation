import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { solveDC } from '../src/sim/solver';
import { vregParamsFor } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc, type VregModel } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * 7805 ที่ f10 (มองด้านหน้า ขาลง): IN f10, GND f11, OUT f12 · PS1 (+) → j10, (−) → ราง bn, j11 → bn11
 * โหลด RL i12–i16 → j16 → bn16 · (เลือกได้) C 0.33 µF ที่ขาเข้า (g10–g? ผ่าน a-side) และ 0.1 µF ที่ขาออก, LED + 330 Ω
 */
export function regCircuit(o: { vin?: number; rl?: number; model?: VregModel; heatsink?: boolean; caps?: boolean; bigCap?: boolean; led?: boolean; ilim?: number; noLoad?: boolean } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.vin ?? 9, currentLimit: o.ilim ?? 3 })
    .part('vreg', onBoard('f10'), 'U1', vregParamsFor(o.model ?? 'L7805', o.heatsink ?? false))
    .wire(P('PS1', 'pos'), H('j10')).wire(P('PS1', 'neg'), H('bn2')).wire(H('j11'), H('bn11'));
  if (!o.noLoad) b.part('resistor', onBoard('i12'), 'RL', { resistance: o.rl ?? 100, span: 4, powerRating: 10 }).wire(H('j16'), H('bn16'));
  if (o.caps) {
    b.part('capacitor', onBoard('h10'), 'CI', { capacitance: 0.33e-6, polarized: false, ratedVoltage: 50, initialVoltage: 0, span: 1 })
      .part('capacitor', onBoard('h12', 0), 'CO', { capacitance: 0.1e-6, polarized: false, ratedVoltage: 50, initialVoltage: 0, span: 3 })
      .wire(H('g15'), H('bn15'));
  }
  if (o.bigCap) b.part('capacitor', onBoard('g12'), 'CB', { capacitance: 1000e-6, polarized: true, ratedVoltage: 16, initialVoltage: 0, span: 2 }).wire(H('j14'), H('bn14'));
  if (o.led) b.part('resistor', onBoard('i18'), 'R2', { resistance: 330, span: 3 }).part('led', onBoard('g21'), 'LED1').wire(H('j12'), H('j18')).wire(H('j22'), H('bn22'));
  return b;
}

const dc = (b: Builder) => { const d = b.doc; const built = buildNetlist(d); const r = solveDC(built.netlist); expect(r.ok).toBe(true); return analyze(d, built, r); };

describe('ไอซีคงแรงดัน 78xx (L7805/L7809/L7812)', () => {
  it('ขา TO-220: IN f10, GND f11, OUT f12', () => {
    const ph = pinHolesFor(regCircuit().doc.parts.find((p) => p.id === 'U1')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ IN: 'f10', GND: 'f11', OUT: 'f12' });
  });
  it('line regulation: VIN 7…25 V → VOUT 5 V ±20 mV, กระแสเข้า = กระแสออก + กระแสนิ่ง ≈ 3–8 mA', () => {
    const vs = [7.2, 9, 12, 25].map((v) => dc(regCircuit({ vin: v })).parts.U1.extra!);
    for (const x of vs) {
      expect(Math.abs(x.vout - 5)).toBeLessThan(0.02);
      expect(x.regulating).toBe(1);
      expect(x.iq).toBeGreaterThan(3e-3); expect(x.iq).toBeLessThan(8e-3);
      expect(Math.abs(x.iin - x.iout - x.iq)).toBeLessThan(1e-6);
    }
    expect(Math.max(...vs.map((x) => x.vout)) - Math.min(...vs.map((x) => x.vout))).toBeLessThan(0.01);
  });
  it('dropout: VIN 6 V → VOUT ≈ 4 V (IN − 2 V) และเตือน; VIN 0 / IN ไม่ต่อ → 0 V', () => {
    const a = dc(regCircuit({ vin: 6 }));
    expect(a.parts.U1.extra!.vout).toBeGreaterThan(3.85); expect(a.parts.U1.extra!.vout).toBeLessThan(4.05);
    expect(a.parts.U1.extra!.regulating).toBe(0);
    expect(a.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('dropout'))).toBe(true);
    const z = dc(regCircuit({ vin: 0.0 })).parts.U1.extra!;
    expect(Math.abs(z.vout)).toBeLessThan(0.05);
  });
  it('load regulation 5 mA → 1 A: VOUT ลดไม่เกิน 100 mV (เอกสาร: ≤ 100 mV ที่ 5 mA–1.5 A); 1 A ที่ 9 V ไม่ติดแผ่นระบายความร้อน → ร้อนเกิน, ติดแล้ว → เตือนร้อน', () => {
    const light = dc(regCircuit({ rl: 1000 })).parts.U1.extra!, heavy = dc(regCircuit({ rl: 5 }));
    const h = heavy.parts.U1.extra!;
    expect(h.iout).toBeGreaterThan(0.95);
    expect(light.vout - h.vout).toBeGreaterThan(0); expect(light.vout - h.vout).toBeLessThan(0.1);
    expect(h.pd).toBeGreaterThan(3.9); expect(h.pd).toBeLessThan(4.2);
    expect(h.tj).toBeGreaterThan(125);
    expect(heavy.parts.U1.overRated).toBe(true);
    const hs = dc(regCircuit({ rl: 5, heatsink: true }));
    expect(hs.parts.U1.extra!.tj).toBeGreaterThan(85); expect(hs.parts.U1.extra!.tj).toBeLessThan(125);
    expect(hs.parts.U1.overRated).toBeFalsy();
    expect(hs.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('°C'))).toBe(true);
  });
  it('L7809 และ L7812: 15 V → 9 V / 12 V; L7812 ที่ 12 V ขาเข้า → dropout', () => {
    expect(dc(regCircuit({ model: 'L7809', vin: 15 })).parts.U1.extra!.vout).toBeCloseTo(9, 1);
    expect(dc(regCircuit({ model: 'L7812', vin: 15 })).parts.U1.extra!.vout).toBeCloseTo(12, 1);
    expect(dc(regCircuit({ model: 'L7812', vin: 12 })).parts.U1.extra!.regulating).toBe(0);
  });
  it('จำลองตามเวลา: C 0.33 µF / 0.1 µF / 1000 µF ที่ขาออก และแหล่งจ่ายจำกัดกระแส 0.1–1 A ตอนเริ่ม — ขาออกขึ้นถึง 5 V แบบไม่แกว่ง (ไม่เกิน 5.05 V)', () => {
    for (const opt of [{ caps: true }, { caps: true, bigCap: true }, { caps: true, led: true, ilim: 0.1 }, { caps: true, led: true, ilim: 1 }]) {
      const d: CircuitDoc = regCircuit(opt).doc;
      const nl = buildNetlist(d).netlist;
      const e = new SimEngine();
      let vmax = 0, last = 0;
      e.handle({ seq: 0, netlist: nl, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
      for (let k = 0; k < 40; k++) {
        const r = e.handle({ seq: k + 1, netlist: nl, advance: 0.01, restart: false, watch: [], budgetMs: 1e9 });
        expect(r.result.ok).toBe(true);
        last = analyze(d, buildNetlist(d), r.result).parts.U1.extra!.vout;
        vmax = Math.max(vmax, last);
      }
      expect(vmax).toBeLessThan(5.05);
      expect(Math.abs(last - 5)).toBeLessThan(0.02);
    }
  });
  it('บันทึก/เปิดไฟล์ + schema 17 เปิดได้', () => {
    const doc = regCircuit({ heatsink: true }).doc;
    const v = parseProject(serializeProject('r', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 17;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
  it('แลป 21: ผ่าน wiring/caps/regulate/line/dropout และ heat (22 Ω + แผ่นระบายความร้อน)', () => {
    expect(LESSONS.find((l) => l.id === 'vreg')?.number).toBe(21);
    const work = emptyWork(); work.achieved.vreg = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    const steps = [regCircuit({ caps: true, led: true }), regCircuit({ caps: true, led: true, vin: 12 }), regCircuit({ caps: true, led: true, vin: 6 }), regCircuit({ caps: true, rl: 22, heatsink: true, vin: 12 })];
    for (const b of steps) {
      const d = b.doc; const built = buildNetlist(d); const r = solveDC(built.netlist);
      st = checkLesson('vreg', { doc: d, built, result: r, analysis: analyze(d, built, r), work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.vreg[g] = true;
    }
    const a = work.achieved.vreg;
    expect({ ...a, last: st }).toMatchObject({ wiring: true, caps: true, regulate: true, line: true, dropout: true, heat: true });
    // ไม่มีตัวเก็บประจุ → ข้อ caps ไม่ผ่าน; ไม่มี heatsink ที่ 22 Ω → heat ไม่ผ่าน
    const d = regCircuit({ rl: 22 }).doc; const built = buildNetlist(d); const r = solveDC(built.netlist);
    const s2 = checkLesson('vreg', { doc: d, built, result: r, analysis: analyze(d, built, r), work: emptyWork() });
    expect(s2.caps.pass).toBe(false); expect(s2.heat.pass).toBe(false); expect(s2.regulate.pass).toBe(true);
  });
});
