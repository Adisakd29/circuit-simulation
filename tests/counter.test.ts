import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { astable555 } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** ขาออก Q0..Q9 → รูที่ใช้ต่อสายไปแอโนด LED (คอลัมน์ของขาไอซี) และรูแอโนด LED */
const Q_FROM = ['g14', 'g13', 'g15', 'g18', 'a18', 'g12', 'g16', 'g17', 'a19', 'a17'];
const Q_TO = ['g21', 'g23', 'g26', 'g28', 'g29', 'a21', 'a23', 'a26', 'a28', 'a29'];

/**
 * ไฟวิ่ง 10 ดวง: แหล่งจ่าย 9 V · 555 astable ที่ f3 (RA 1 k, RB 10 k, C) → ขา 3 OUT (คอลัมน์ 5) → สาย i5–a14 → CLK ของ CD4017 (U2 ที่ f12)
 * CD4017: ขา 1 Q5 f12, 2 Q1 f13, 3 Q0 f14, 4 Q2 f15, 5 Q6 f16, 6 Q7 f17, 7 Q3 f18, 8 VSS f19 / 9 Q8 e19, 10 Q4 e18, 11 Q9 e17, 12 CO e16, 13 INH e15, 14 CLK e14, 15 RST e13, 16 VDD e12
 * LED 10 ดวงที่คอลัมน์ 21–30 (บน/ล่าง สองดวงใช้คอลัมน์แคโทดร่วม คนละแถว) แคโทด → 1 kΩ → ราง − · ขาออกแต่ละขา → สายไปแอโนด
 */
export function chaser(o: { c?: number; vdd?: number; rst?: 'gnd' | 'q4' | 'open'; inh?: 'gnd' | 'vdd' | 'open'; leds?: number; rLed?: number; noLedR?: boolean } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.vdd ?? 9, currentLimit: 0.5 })
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    // 555 astable
    .part('timer555', onBoard('f3'), 'U1')
    .part('resistor', onBoard('tp4', 90), 'RA', { resistance: 1000, span: 3 })
    .part('resistor', onBoard('c4'), 'RB', { resistance: 10000, span: 4 })
    .part('capacitor', onBoard('j4', 90), 'C1', { capacitance: o.c ?? 10e-6, ratedVoltage: 16, polarized: true, initialVoltage: 0, span: 2 })
    .wire(H('a3'), H('tp3')).wire(H('j3'), H('bn3')).wire(H('b8'), H('b5')).wire(H('d5'), H('g4')).wire(H('j6'), H('bp8'))
    // CD4017
    .part('counter', onBoard('f12'), 'U2')
    .wire(H('i5'), H('a14')).wire(H('a12'), H('tp12')).wire(H('j19'), H('bn20'));
  const rst = o.rst ?? 'gnd', inh = o.inh ?? 'gnd';
  if (rst === 'gnd') b.wire(H('b13'), H('tn14'));
  if (rst === 'q4') b.wire(H('b13'), H('c18'));
  if (inh === 'gnd') b.wire(H('c15'), H('tn15'));
  if (inh === 'vdd') b.wire(H('c15'), H('tp15'));
  const n = o.leds ?? 10;
  // คู่ที่ใช้คอลัมน์แคโทดร่วมกันอยู่คนละแถว (หนึ่งรูรับได้หนึ่งขา)
  const LEDS: Array<[string, 0 | 180]> = [['h21', 0], ['i23', 180], ['h26', 0], ['i28', 180], ['h29', 0], ['c21', 0], ['b23', 180], ['c26', 0], ['b28', 180], ['c29', 0]];
  for (let k = 0; k < n; k++) b.part('led', onBoard(LEDS[k][0], LEDS[k][1]), `L${k}`).wire(H(Q_FROM[k]), H(Q_TO[k]));
  const R = o.rLed ?? 1000;
  if (o.noLedR) for (const [c, top] of [[22, 0], [27, 0], [30, 0], [22, 1], [27, 1], [30, 1]] as const) b.wire(H(`${top ? 'a' : 'j'}${c}`), H(`${top ? 'tn' : 'bn'}${c}`));
  else for (const [c, top] of [[22, 0], [27, 0], [30, 0], [22, 1], [27, 1], [30, 1]] as const) b.part('resistor', onBoard(`${top ? 'a' : 'j'}${c}`, top ? 270 : 90), `RL${c}${top ? 't' : 'b'}`, { resistance: R, span: 2 });
  // สายแนบบอร์ด (โค้งต่ำ) และสีตามหน้าที่: แดง = ไฟบวก, ดำ = กราวด์, เหลือง = สัญญาณนาฬิกา, เขียว/น้ำเงิน = ขาออก Q
  const hole = (t: { kind: string; hole?: string }) => (t.kind === 'hole' ? t.hole! : '');
  b.doc = { ...b.doc, wires: b.doc.wires.map((w, k) => {
    const hs = [hole(w.a), hole(w.b)];
    const color = hs.some((x) => /^(tp|bp)/.test(x)) || (w.a.kind === 'pin' && w.a.pin === 'pos') ? '#e53935'
      : hs.some((x) => /^(tn|bn)/.test(x)) || (w.a.kind === 'pin' && w.a.pin === 'neg') ? '#212121'
      : hs.includes('a14') ? '#fdd835' : k % 2 ? '#1e88e5' : '#43a047';
    return { ...w, color, arc: 0 };
  }) };
  return b;
}

export function runChaser(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(b.doc);
  let r: EngineResponse = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  const trace: Array<{ t: number; n: number; lit: number[]; i: number; co: number }> = [];
  for (let k = 0; k < seconds / dt; k++) {
    r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    const an = analyze(b.doc, built, r.result, r.tones);
    const x = an.parts.U2.extra!;
    const lit = Array.from({ length: 10 }, (_, q) => q).filter((q) => (an.parts[`L${q}`]?.current ?? 0) > 1e-3);
    trace.push({ t: r.t, n: x.count, lit, i: Math.max(...lit.map((q) => an.parts[`L${q}`].current), 0), co: x.vCO });
  }
  return { r, trace, built, an: analyze(b.doc, built, r.result, r.tones) };
}

/** วงจรทดสอบ DC: CLK จากสวิตช์ (ต่อไฟบวก) + 10 kΩ ดึงลง */
function manual(clk: boolean, o: { rst?: boolean; inh?: boolean; floatClk?: boolean; short?: boolean } = {}) {
  const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .part('counter', onBoard('f12'), 'U2')
    .wire(H('a12'), H('tp12')).wire(H('j19'), H('bn20'))
    .wire(H('b13'), o.rst ? H('tp16') : H('tn16')).wire(H('c15'), o.inh ? H('tp17') : H('tn15'));
  if (o.short) b.wire(H('h14'), H('bn14'));
  if (!o.floatClk) b.part('resistor', onBoard('a14', 270), 'RC', { resistance: 10000, span: 2 }).part('switch', onBoard('h24'), 'SW', { closed: clk }).wire(H('j24'), H('bp24')).wire(H('j26'), H('b14'));
  return b.doc;
}

describe('ไอซีนับทศวรรษ CD4017B (DIP-16)', () => {
  it('ผังขา DIP-16 คร่อมร่อง: ขา 1–8 แถว f คอลัมน์ 12–19, ขา 9–16 แถว e คอลัมน์ 19–12', () => {
    const ph = pinHolesFor(chaser().doc.parts.find((p) => p.id === 'U2')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ Q5: 'f12', Q1: 'f13', Q0: 'f14', Q2: 'f15', Q6: 'f16', Q7: 'f17', Q3: 'f18', VSS: 'f19', Q8: 'e19', Q4: 'e18', Q9: 'e17', CO: 'e16', INH: 'e15', CLK: 'e14', RST: 'e13', VDD: 'e12' });
  });
  it('กดสวิตช์ (DC): นับเฉพาะขอบขาขึ้น 1 ครั้งต่อการกด · INH สูงหยุดนับ · RESET กลับ Q0', () => {
    const e = new SimEngine();
    const counts: number[] = [];
    const step = (d: CircuitDoc, k: number) => { const built = buildNetlist(d); const r = e.handle({ seq: k, netlist: built.netlist, advance: 0, restart: k === 0, watch: [], budgetMs: 1e9 }); expect(r.result.ok).toBe(true); return analyze(d, built, r.result).parts.U2.extra!; };
    const seq: Array<[boolean, { rst?: boolean; inh?: boolean }]> = [[false, {}], [true, {}], [true, {}], [false, {}], [true, {}], [false, {}], [true, {}], [false, { inh: true }], [true, { inh: true }], [false, {}], [false, { rst: true }], [true, {}]];
    seq.forEach(([c, o], k) => counts.push(step(manual(c, o), k).count));
    expect(counts).toEqual([0, 1, 1, 1, 2, 2, 3, 3, 3, 3, 0, 1]);
  });
  it('ขาออก 5 V ลัดลง VSS: กระแสอิ่มตัว ≈ 3.2 mA (ดาต้าชีตทั่วไป 3.2 mA ที่ VO 2.5 V); ขา CLK ลอย → เตือน', () => {
    const d = manual(false, { short: true });
    const built = buildNetlist(d);
    const e = new SimEngine();
    const r = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    const x = analyze(d, built, r.result).parts.U2.extra!;
    expect(x.iQ0).toBeGreaterThan(2.8e-3); expect(x.iQ0).toBeLessThan(3.6e-3);
    const f = manual(false, { floatClk: true }); const bf = buildNetlist(f);
    const an = analyze(f, bf, new SimEngine().handle({ seq: 0, netlist: bf.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 }).result);
    expect(an.diagnostics.some((dg) => dg.partId === 'U2' && dg.message.includes('CLOCK') && dg.message.includes('ลอย'))).toBe(true);
  });
  it('ไฟวิ่ง 555 + CD4017 (9 V): นับ 0→9 วนตามลำดับ ทีละ 1 ทุกคาบของ 555, LED ติดทีละดวงตรงกับขาที่นับ ≈ 6 mA, CO สูงเมื่อ 0–4', () => {
    const { trace, an } = runChaser(chaser(), 4);
    const th = astable555(1000, 10000, 10e-6).f;
    const changes = trace.filter((x, k) => k > 0 && x.n !== trace[k - 1].n);
    for (let k = 1; k < trace.length; k++) if (trace[k].n !== trace[k - 1].n) expect(trace[k].n).toBe((trace[k - 1].n + 1) % 10);
    // ครั้งแรกตัวเก็บประจุเริ่มที่ 0 V คาบแรกยาวกว่า — นับเฉพาะช่วงหลัง 1 s
    const late = changes.filter((x) => x.t > 1);
    const f = (late.length - 1) / (late[late.length - 1].t - late[0].t);
    expect(Math.abs(f / th - 1)).toBeLessThan(0.08);
    expect(new Set(trace.map((x) => x.n)).size).toBe(10);
    for (const x of trace.slice(2)) { expect(x.lit).toEqual([x.n]); expect(x.i).toBeGreaterThan(4e-3); expect(x.i).toBeLessThan(9e-3); expect(x.co > 4.5).toBe(x.n <= 4); }
    expect(an.diagnostics.filter((d) => d.partId === 'U2' && d.severity !== 'info')).toEqual([]);
  }, 60000);
  it('ต่อ Q4 เข้า RESET → นับแค่ 0–3 แล้ววน', () => {
    const { trace } = runChaser(chaser({ rst: 'q4' }), 3);
    expect(Math.max(...trace.map((x) => x.n))).toBe(3);
    expect(new Set(trace.map((x) => x.n))).toEqual(new Set([0, 1, 2, 3]));
  }, 60000);
  it('CLK INH ต่อ VDD → หยุดนับที่ Q0; LED ไม่มีตัวต้านทานที่ 15 V → กระแสเกิน 10 mA (อันตราย)', () => {
    const { trace } = runChaser(chaser({ inh: 'vdd' }), 1);
    expect(trace.every((x) => x.n === 0)).toBe(true);
    const { an } = runChaser(chaser({ vdd: 15, noLedR: true, leds: 2, inh: 'vdd' }), 0.2);
    expect(an.diagnostics.some((d) => d.partId === 'U2' && d.severity === 'danger' && d.message.includes('Q0'))).toBe(true);
  }, 60000);
  it('แลป 26 ผ่านครบ; บันทึก/เปิดไฟล์ + schema 22', () => {
    expect(LESSONS.find((l) => l.id === 'counter')?.number).toBe(26);
    const b = chaser();
    const e = new SimEngine(); const built = buildNetlist(b.doc);
    const work = emptyWork(); work.achieved.counter = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    for (let k = 0; k < 70; k++) {
      const r = e.handle({ seq: k, netlist: built.netlist, advance: k ? 0.05 : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
      const an = analyze(b.doc, built, r.result, r.tones);
      st = checkLesson('counter', { doc: b.doc, built, result: r.result, analysis: an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.counter[g] = true;
    }
    expect({ ...work.achieved.counter, st }).toMatchObject({ power: true, inputs: true, clock: true, leds: true, sequence: true });
    // RESET → Q4: ข้อไม่บังคับ "short" ผ่าน (เห็นครบ 0–3)
    const b4 = chaser({ rst: 'q4' }); const built4 = buildNetlist(b4.doc); const e4 = new SimEngine();
    for (let k = 0; k < 30; k++) {
      const r = e4.handle({ seq: k, netlist: built4.netlist, advance: k ? 0.05 : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
      st = checkLesson('counter', { doc: b4.doc, built: built4, result: r.result, analysis: analyze(b4.doc, built4, r.result, r.tones), work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.counter[g] = true;
    }
    expect(work.achieved.counter.short).toBe(true);
    const v = parseProject(serializeProject('c', b.doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(b.doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 22;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 60000);
});
