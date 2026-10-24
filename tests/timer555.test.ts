import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { astable555 } from '../src/model/catalog';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { solveDC } from '../src/sim/solver';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { pinHolesFor } from '../src/model/geometry';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * วงจร astable มาตรฐานบนบอร์ด: 555 ที่ f10 (1 GND f10, 2 TRIG f11, 3 OUT f12, 4 RESET f13 · 5 CTRL e13, 6 THR e12, 7 DIS e11, 8 VCC e10)
 * RA tp11–a11 (VCC → DIS), RB c11–c15 + สาย b15–b12 (DIS → THR), สาย d12–g11 (THR = TRIG), C j11(+)–bn11, OUT → 330 Ω (i12–i16) → LED g16/g17 → bn17
 */
export function astable(opts: { ra?: number; rb?: number; c?: number; vcc?: number; reset?: 'vcc' | 'gnd' | 'open'; noCap?: boolean } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: opts.vcc ?? 5, currentLimit: 0.5 })
    .part('timer555', onBoard('f10'), 'U1')
    .part('resistor', onBoard('tp11', 90), 'RA', { resistance: opts.ra ?? 1000, span: 3 })
    .part('resistor', onBoard('c11'), 'RB', { resistance: opts.rb ?? 10000, span: 4 })
    .part('resistor', onBoard('i12'), 'R1', { resistance: 330, span: 4 })
    .part('led', onBoard('g16'), 'LED1')
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('a10'), H('tp10')).wire(H('j10'), H('bn10'))
    .wire(H('b15'), H('b12')).wire(H('d12'), H('g11')).wire(H('j17'), H('bn17'));
  if (!opts.noCap) b.part('capacitor', onBoard('j11', 90), 'C1', { capacitance: opts.c ?? 10e-6, ratedVoltage: 16, polarized: true, initialVoltage: 0, span: 2 });
  const reset = opts.reset ?? 'vcc';
  if (reset !== 'open') b.wire(H('j13'), H(reset === 'vcc' ? 'bp14' : 'bn14'));
  return b;
}

export function run(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(b.doc);
  const nl = built.netlist;
  let r: EngineResponse = e.handle({ seq: 0, netlist: nl, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  const trace: Array<{ t: number; q: boolean; led: number }> = [];
  for (let k = 0; k < seconds / dt; k++) {
    r = e.handle({ seq: k + 1, netlist: nl, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    trace.push({ t: r.t, q: !!r.result.relayStates?.U1, led: r.result.elements['LED1']?.current ?? 0 });
  }
  const an = analyze(b.doc, built, r.result, r.tones);
  return { r, trace, an };
}

describe('ไอซีไทเมอร์ NE555', () => {
  it('astable RA 1 k, RB 10 k, C 10 µF: ความถี่และ duty ตรงสูตร 1.44/((RA+2RB)C) ภายใน 3%', () => {
    const { r } = run(astable(), 1.5);
    const tn = r.tones!.U1;
    const th = astable555(1000, 10000, 10e-6);
    expect(tn.freq).not.toBeNull();
    expect(Math.abs(tn.freq! / th.f - 1)).toBeLessThan(0.03);
    expect(Math.abs(tn.duty! - th.duty)).toBeLessThan(0.02);
  }, 60000);

  it('ตำแหน่งขา DIP-8 คร่อมร่อง: 1–4 แถว f, 5–8 แถว e (ขา 8 ตรงข้ามขา 1)', () => {
    const ph = pinHolesFor(astable().doc.parts.find((p) => p.id === 'U1')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ GND: 'f10', TRIG: 'f11', OUT: 'f12', RESET: 'f13', CTRL: 'e13', THR: 'e12', DIS: 'e11', VCC: 'e10' });
  });
  it('ความถี่ไม่ขึ้นกับ VCC (5 V กับ 12 V ต่างกัน < 1%), แรงดัน C แกว่ง ⅓–⅔ VCC, ค่าทฤษฎีในแผงผลจากวงจรจริง', () => {
    const a = run(astable({ vcc: 5 }), 1.0), b = run(astable({ vcc: 12 }), 1.0);
    expect(Math.abs(a.r.tones!.U1.freq! / b.r.tones!.U1.freq! - 1)).toBeLessThan(0.01);
    const x = a.an.parts.U1.extra!;
    expect(x.ra).toBe(1000); expect(x.rb).toBe(10000); expect(x.ct).toBeCloseTo(10e-6);
    expect(x.fth).toBeCloseTo(astable555(1000, 10000, 10e-6).f, 6);
    expect(x.freq).toBeGreaterThan(0);
    expect(x.vctl).toBeGreaterThan(3.2); expect(x.vctl).toBeLessThan(3.45);
    // LED กะพริบตามขาออก: HIGH → ติด (> 5 mA), LOW → ดับ
    const on = a.trace.filter((t) => t.q), off = a.trace.filter((t) => !t.q);
    expect(on.length).toBeGreaterThan(3); expect(off.length).toBeGreaterThan(3);
    expect(Math.min(...on.map((t) => t.led))).toBeGreaterThan(5e-3);
    expect(Math.max(...off.map((t) => t.led))).toBeLessThan(1e-5);
    expect(a.an.diagnostics.filter((d) => d.partId === 'U1')).toEqual([]);
  }, 60000);
  it('ขาออก HIGH โหลดเบา ≈ VCC − 1…1.4 V และขับ 100 mA ได้ ≈ VCC − 1.7 V (ตามเอกสาร)', () => {
    // TRIG ต่อกราวด์ตลอด → ขาออก HIGH คงที่ · โหลด 33 Ω ที่ 5 V ≈ 100 mA
    const mk = (rl: number) => new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
      .part('timer555', onBoard('f10'), 'U1')
      .part('resistor', onBoard('i12'), 'RL', { resistance: rl, span: 4 })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
      .wire(H('a10'), H('tp10')).wire(H('j10'), H('bn10')).wire(H('j13'), H('bp14')).wire(H('j11'), H('bn11')).wire(H('j16'), H('bn16'));
    const v = (rl: number) => { const d = mk(rl).doc; const built = buildNetlist(d); const res = solveDC(built.netlist); expect(res.ok).toBe(true); return analyze(d, built, res).parts.U1.extra!; };
    const light = v(100000), heavy = v(33);
    expect(light.q).toBe(1);
    expect(5 - light.vout).toBeGreaterThan(0.9); expect(5 - light.vout).toBeLessThan(1.45);
    expect(heavy.iout).toBeGreaterThan(0.085);
    expect(5 - heavy.vout).toBeGreaterThan(1.55); expect(5 - heavy.vout).toBeLessThan(1.85);
  });
  it('RESET ต่อกราวด์ → ขาออก LOW ตลอด + ข้อความ; RESET ลอย → เตือน', () => {
    const a = run(astable({ reset: 'gnd' }), 0.4);
    expect(a.trace.every((t) => !t.q)).toBe(true);
    expect(a.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('RESET'))).toBe(true);
    const o = run(astable({ reset: 'open' }), 0.3);
    expect(o.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('ลอย'))).toBe(true);
  }, 60000);
  it('ไฟเลี้ยง 3 V: ไม่ทำงาน + เตือน; 18 V: เกินพิกัด', () => {
    const lo = run(astable({ vcc: 2.8 }), 0.3);
    expect(lo.trace.every((t) => !t.q)).toBe(true);
    expect(lo.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('ไม่ทำงาน'))).toBe(true);
    const hi = run(astable({ vcc: 18 }), 0.2);
    expect(hi.an.parts.U1.overRated).toBe(true);
  }, 60000);
  it('ไม่มีตัวเก็บประจุ (DC): แจ้ง "555 สลับสถานะไม่หยุด" พร้อมคำอธิบาย', () => {
    const d = astable({ noCap: true }).doc;
    const res = solveDC(buildNetlist(d).netlist);
    expect(res.ok).toBe(false);
    expect(res.error!.message).toContain('555');
  });
  it('แลป 20: ผ่าน power/network/oscillate/blink และ change หลังเปลี่ยน C; บันทึก/เปิดไฟล์ + schema 16', () => {
    expect(LESSONS.find((l) => l.id === 'timer555')?.number).toBe(20);
    const work = emptyWork(); work.achieved.timer555 = {};
    const e = new SimEngine();
    let first = true;
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    for (const c of [47e-6, 10e-6]) {
      const doc: CircuitDoc = astable({ c }).doc;
      const built = buildNetlist(doc);
      first = true; // แก้ค่า C = เริ่มเวลาใหม่ (เหมือนผู้ใช้กด Restart)
      for (let k = 0; k < (c > 20e-6 ? 40 : 12); k++) {
        const r = e.handle({ seq: k, netlist: built.netlist, advance: 0.1, restart: first, watch: [], budgetMs: 1e9 });
        first = false;
        st = checkLesson('timer555', { doc, built, result: r.result, analysis: analyze(doc, built, r.result, r.tones), work });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.timer555[g] = true;
      }
    }
    const a = work.achieved.timer555;
    expect(a.power && a.network && a.oscillate && a.blink && a.change).toBe(true);
    const doc = astable().doc;
    const v = parseProject(serializeProject('t', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 16;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 120000);
  it('monostable: กดทริกเกอร์ 20 ms → ขาออก HIGH นาน 1.1·R·C (±3%) แล้วกลับ LOW', () => {
    // R 10 k (VCC → ขา 7 = ขา 6), C 10 µF จากขา 6 ลงกราวด์, TRIG ดึงขึ้นด้วย 10 k — กด = ต่อสาย TRIG ลงกราวด์ชั่วคราว
    const mk = (pressed: boolean) => {
      const b = new Builder()
        .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 0.5 })
        .part('timer555', onBoard('f10'), 'U1')
        .part('resistor', onBoard('tp11', 90), 'R1', { resistance: 10000, span: 3 })
        .part('capacitor', onBoard('j20', 90), 'C1', { capacitance: 10e-6, polarized: true, ratedVoltage: 16, initialVoltage: 0, span: 2 })
        .part('resistor', onTable(-10, 20), 'RT', { resistance: 10000 })
        .part('led', onBoard('g16'), 'LED1').part('resistor', onBoard('i12'), 'RL', { resistance: 330, span: 4 })
        .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
        .wire(H('a10'), H('tp10')).wire(H('j10'), H('bn10')).wire(H('j13'), H('bp14')).wire(H('b11'), H('b12')).wire(H('c12'), H('h20')).wire(H('j17'), H('bn17'))
        .wire(P('RT', '1'), H('h11')).wire(P('RT', '2'), H('bp16'));
      if (pressed) b.wire(H('i11'), H('bn11'));
      return b.doc;
    };
    const e = new SimEngine();
    const idle = buildNetlist(mk(false)).netlist, press = buildNetlist(mk(true)).netlist;
    let r = e.handle({ seq: 0, netlist: idle, advance: 0.3, restart: true, watch: [], budgetMs: 1e9 });
    expect(r.result.relayStates!.U1).toBe(false); // ไม่มีทริกเกอร์ → คงที่ LOW
    r = e.handle({ seq: 1, netlist: press, advance: 0.02, restart: false, watch: [], budgetMs: 1e9 });
    expect(r.result.relayStates!.U1).toBe(true);
    let tFall = -1;
    for (let k = 0; k < 400 && tFall < 0; k++) {
      r = e.handle({ seq: 2 + k, netlist: idle, advance: 0.001, restart: false, watch: [], budgetMs: 1e9 });
      if (!r.result.relayStates!.U1) tFall = r.t;
    }
    const width = tFall - 0.3;
    expect(Math.abs(width / (1.1 * 10000 * 10e-6) - 1)).toBeLessThan(0.03);
  }, 60000);
});
