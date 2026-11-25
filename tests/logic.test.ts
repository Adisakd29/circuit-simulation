import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { solveDC } from '../src/sim/solver';
import { LOGIC_FUNC, LOGIC_PINOUT, pinDefs } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc, type LogicModel } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * U1 (74HC..) ที่ f10: 1A f10, 1B f11, 1Y f12, … GND f16 · VCC e10 → ราง tp · GND → ราง bn
 * ขาเข้า A (คอลัมน์ 10) และ B (คอลัมน์ 11): 10 kΩ ดึงลงราง bn + สวิตช์เลื่อนจากราง bp (SA h20–h22, SB h24–h26)
 * ขาออก 1Y → 470 Ω (i12–i17) → LED (g17/g18) → bn
 */
export function gateRig(o: { model?: LogicModel; a?: boolean; b?: boolean; noPulldownB?: boolean; vcc?: number } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: o.vcc ?? 5 })
    .part('logic', onBoard('f10'), 'U1', { model: o.model ?? '74HC08' })
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('a10'), H('tp10')).wire(H('j16'), H('bn16'))
    .part('resistor', onBoard('j10', 90), 'RA', { resistance: 10000, span: 2 })
    .part('switch', onBoard('h20'), 'SA', { closed: !!o.a }).wire(H('j20'), H('bp20')).wire(H('j22'), H('i10'))
    .part('switch', onBoard('h24'), 'SB', { closed: !!o.b }).wire(H('j24'), H('bp24')).wire(H('j26'), H('i11'))
    .part('resistor', onBoard('i12'), 'RL', { resistance: 470, span: 5 })
    .part('led', onBoard('g17'), 'LED1').wire(H('j18'), H('bn18'));
  if (!o.noPulldownB) b.part('resistor', onBoard('j11', 90), 'RB', { resistance: 10000, span: 2 });
  return b;
}
const dc = (b: Builder) => { const d = b.doc; const built = buildNetlist(d); const r = solveDC(built.netlist); expect(r.ok).toBe(true); return { an: analyze(d, built, r), r, built, d }; };

describe('ไอซีเกตตรรกะ 74HC (DIP-14)', () => {
  it('ผังขา DIP-14 คร่อมร่อง: ขา 1–7 แถว f คอลัมน์ 10–16, ขา 8–14 แถว e คอลัมน์ 16–10 (ขา 14 ตรงข้ามขา 1)', () => {
    const ph = pinHolesFor(gateRig().doc.parts.find((p) => p.id === 'U1')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ '1A': 'f10', '1B': 'f11', '1Y': 'f12', '2A': 'f13', '2B': 'f14', '2Y': 'f15', GND: 'f16', '3Y': 'e16', '3A': 'e15', '3B': 'e14', '4Y': 'e13', '4A': 'e12', '4B': 'e11', VCC: 'e10' });
    expect(LOGIC_PINOUT['74HC02'][0]).toBe('1Y');
    expect(pinDefs({ ...gateRig().doc.parts.find((p) => p.id === 'U1')!, params: { ...(gateRig().doc.parts.find((p) => p.id === 'U1')!.params as object), model: '74HC04' } } as never).length).toBe(14);
  });
  for (const model of ['74HC00', '74HC08', '74HC32', '74HC86'] as LogicModel[]) {
    it(`${model} ${LOGIC_FUNC[model].name}: ตารางความจริงครบ 4 แถว, ขาออก ≈ 0 / 5 V, LED ตามขาออก`, () => {
      for (const [a, bb] of [[false, false], [false, true], [true, false], [true, true]]) {
        const { an } = dc(gateRig({ model, a, b: bb }));
        const y = LOGIC_FUNC[model].f(a, bb);
        const x = an.parts.U1.extra!;
        expect([x.b1A, x.b1B, x.q1]).toEqual([a ? 1 : 0, bb ? 1 : 0, y ? 1 : 0]);
        if (y) { expect(x.vo1).toBeGreaterThan(4.6); expect(an.parts.LED1.current).toBeGreaterThan(4e-3); }
        else { expect(x.vo1).toBeLessThan(0.05); expect(an.parts.LED1.current).toBeLessThan(1e-6); }
        expect(an.diagnostics.filter((d) => d.partId === 'U1' && d.severity !== 'info')).toEqual([]);
      }
    });
  }
  it('ขาเข้า B ลอย (ไม่มีตัวต้านทานดึงลง สวิตช์เปิด) → เตือน "ลอย"; ไม่มีไฟเลี้ยง → เตือน', () => {
    const { an } = dc(gateRig({ a: true, noPulldownB: true }));
    expect(an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('1B') && d.message.includes('ลอย'))).toBe(true);
    const { an: a2 } = dc(gateRig({ a: true, vcc: 0.5 }));
    expect(a2.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('ไฟเลี้ยง'))).toBe(true);
    const { an: a3 } = dc(gateRig({ a: true, b: true }).wire(H('j12'), H('bn12')));
    expect(a3.diagnostics.some((d) => d.partId === 'U1' && d.severity === 'danger' && d.message.includes('1Y'))).toBe(true);
  });
  it('SR latch จาก NAND 2 ตัว (74HC00): S̄ = 0 → Q = 1 และค้างไว้เมื่อ S̄ กลับเป็น 1; R̄ = 0 → Q = 0 และค้าง', () => {
    // 1A = S̄ (คอลัมน์ 10), 2A = R̄ (คอลัมน์ 13 → สายไปคอลัมน์ 28), 1B ← 2Y (g11–g15), 2B ← 1Y (h14–h12) · ดึงขึ้น 10 kΩ + สวิตช์ลงกราวด์
    const latch = (s: boolean, r: boolean): CircuitDoc => new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
      .part('logic', onBoard('f10'), 'U1', { model: '74HC00' })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
      .wire(H('a10'), H('tp10')).wire(H('j16'), H('bn16')).wire(H('g11'), H('g15')).wire(H('h14'), H('h12'))
      .part('resistor', onBoard('j10', 90), 'RS', { resistance: 10000, span: 3 })
      .wire(H('j13'), H('i28')).part('resistor', onBoard('j28', 90), 'RR', { resistance: 10000, span: 3 })
      .part('switch', onBoard('h20'), 'SS', { closed: s }).wire(H('j20'), H('bn20')).wire(H('j22'), H('i10'))
      .part('switch', onBoard('h24'), 'SR', { closed: r }).wire(H('j24'), H('bn24')).wire(H('j26'), H('i13'))
      .doc;
    const e = new SimEngine();
    const q: number[] = [];
    [[true, false], [false, false], [false, true], [false, false]].forEach(([s, r], k) => {
      const d = latch(s, r);
      const res = e.handle({ seq: k, netlist: buildNetlist(d).netlist, advance: 0, restart: k === 0, watch: [], budgetMs: 1e9 });
      expect(res.result.ok).toBe(true);
      q.push(analyze(d, buildNetlist(d), res.result).parts.U1.extra!.q1);
    });
    expect(q).toEqual([1, 1, 0, 0]);
  });
  it('NOT ต่อวนตัวเอง (74HC04 1Y → 1A) → แจ้ง "วงจรเกตตรรกะสั่นไม่หยุด"', () => {
    const d = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
      .part('logic', onBoard('f10'), 'U1', { model: '74HC04' })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'neg'), H('bn2'))
      .wire(H('a10'), H('tp10')).wire(H('j16'), H('bn16')).wire(H('g10'), H('g11')).doc;
    const r = solveDC(buildNetlist(d).netlist);
    expect(r.ok).toBe(false);
    expect(r.error!.message).toContain('เกต');
  });
  it('แลป 25: AND ครบ 4 แถว + OR ครบ 4 แถว (เปลี่ยนรุ่น) → ผ่านทุกข้อ; บันทึก/เปิดไฟล์ + schema 21', () => {
    expect(LESSONS.find((l) => l.id === 'logic')?.number).toBe(25);
    const work = emptyWork(); work.achieved.logic = {};
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    for (const model of ['74HC08', '74HC32'] as LogicModel[]) for (const [a, bb] of [[false, false], [false, true], [true, false], [true, true]]) {
      const { an, r, built, d } = dc(gateRig({ model, a, b: bb }));
      st = checkLesson('logic', { doc: d, built, result: r, analysis: an, work });
      for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.logic[g] = true;
    }
    expect({ ...work.achieved.logic, st }).toMatchObject({ power: true, inputs: true, output: true, truth: true, second: true });
    const doc = gateRig().doc;
    const v = parseProject(serializeProject('g', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 21;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});
