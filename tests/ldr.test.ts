import { beforeAll, describe, expect, it } from 'vitest';
import { ldrResistance } from '../src/model/catalog';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { buildNetlist } from '../src/sim/netlist';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const base = { r10: 15000, gamma: 0.6, rdark: 1e6 };
/** 47 kΩ (g5–g9) จากรางบวก → X (คอลัมน์ 9 แถว f–j) · LDR h9–h11 → รางลบ · (night) X → ขา B ของ 2N3904 ที่ f20 + LED */
function circuit(lux: number, night = false, probe = true) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
    .part('resistor', onBoard('g5'), 'R1', { resistance: 47000, span: 4 })
    .part('ldr', onBoard('h9'), 'LDR1', { lux, ...base, maxPower: 0.1, span: 2 })
    .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('j5'), H('bp5')).wire(H('j11'), H('bn11'));
  if (probe) b.probe(H('j9'), H('bn14'));
  if (night) b.part('bjt', onBoard('f20'), 'Q1').part('led', onBoard('h25'), 'LED1').part('resistor', onBoard('b25'), 'Rc', { resistance: 220, span: 4 })
    .wire(H('i9'), H('j21')).wire(H('j20'), H('bn20')).wire(H('bp29'), H('a29')).wire(H('a25'), H('g25')).wire(H('g26'), H('i22'));
  return b;
}

describe('LDR GL5528', () => {
  it('R(lux): 10 lx ≈ 15 kΩ ∥ 1 MΩ, มืดสนิท = 1 MΩ, แสงเพิ่ม 10 เท่า R ลด ≈ 10^0.6 เท่า', () => {
    expect(ldrResistance({ ...base, lux: 10 })).toBeCloseTo(1 / (1 / 15000 + 1 / 1e6), 6);
    expect(ldrResistance({ ...base, lux: 0 })).toBe(1e6);
    const r100 = 15000 * 10 ** -0.6, r1000 = 15000 * 100 ** -0.6;
    expect(Math.abs(r100 / r1000 - 10 ** 0.6)).toBeLessThan(1e-9);
  });
  it('วงแบ่ง 47 kΩ + LDR: แรงดัน X ตรงสูตรทุกระดับแสง และลดลงเมื่อสว่างขึ้น', () => {
    let prev = Infinity;
    for (const lux of [0, 1, 10, 100, 300, 1000, 10000]) {
      const { analysis } = simulate(circuit(lux).doc);
      const v = analysis.probe.value!;
      const R = ldrResistance({ ...base, lux });
      const vs = analysis.parts['PS1'].voltage;
      expect(Math.abs(v - vs * R / (R + 47000))).toBeLessThan(1e-6);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });
  it('ไฟอัตโนมัติ: 10 lx LED ติด (> 5 mA), 300 lx LED ดับ (< 0.1 mA)', () => {
    expect(simulate(circuit(10, true).doc).analysis.parts['LED1'].current).toBeGreaterThan(5e-3);
    expect(simulate(circuit(300, true).doc).analysis.parts['LED1'].current).toBeLessThan(1e-4);
  });
  it('LDR ต่อตรงคร่อม 5 V ที่แสงจ้า → เกินพิกัด 100 mW', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
      .part('ldr', onBoard('h9'), 'LDR1', { lux: 100000, ...base, maxPower: 0.1, span: 2 })
      .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2')).wire(H('j9'), H('bp9')).wire(H('j11'), H('bn11'));
    const { analysis } = simulate(b.doc);
    expect(analysis.parts['LDR1'].overRated).toBe(true);
  });
  it('บันทึก/เปิดไฟล์ + ไฟล์ schema 13', () => {
    const doc = circuit(300).doc;
    const v = parseProject(serializeProject('ldr', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 13;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});

describe('แลป 17: LDR', () => {
  const run = (b: Builder, ach: Record<string, boolean>) => {
    const { analysis, result } = simulate(b.doc);
    const work = emptyWork(); work.achieved = { ldr: ach };
    const st = checkLesson('ldr', { doc: b.doc, built: buildNetlist(b.doc), result, analysis, work });
    for (const [k, v] of Object.entries(st)) if (v.pass) ach[k] = true;
    return st;
  };
  it('บทเรียนมีอยู่และเป้าหมายครบ', () => {
    const l = LESSONS.find((x) => x.id === 'ldr')!;
    expect(l.number).toBe(17);
    expect(l.goals.map((g) => g.id)).toEqual(['divider', 'response', 'night']);
  });
  it('วัดตอนมืดและสว่าง → response ผ่าน; ไฟอัตโนมัติมืดติด/สว่างดับ → night ผ่าน', () => {
    const ach: Record<string, boolean> = {};
    expect(run(circuit(10), ach).divider.pass).toBe(true);
    run(circuit(300), ach);
    expect(ach.response).toBe(true);
    run(circuit(10, true), ach);
    run(circuit(300, true), ach);
    expect(ach.night).toBe(true);
  });
  it('ไม่มีตัวต้านทานคู่ → divider ไม่ผ่าน', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ldr', onBoard('h9'), 'LDR1').wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2')).wire(H('j11'), H('bn11'));
    expect(run(b, {}).divider.pass).toBe(false);
  });
});
