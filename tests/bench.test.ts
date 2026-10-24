import { describe, expect, it } from 'vitest';
import { Builder, H, P, onTable } from './helpers';
import { benchSlot, relayoutBench } from '../src/model/bench';
import { BENCH_DIMS, BENCH_FRONT_Z, TABLE_FOOTPRINT, checkPlacement, footprint, isBenchKind } from '../src/model/geometry';
import { validateProjectFile } from '../src/model/schema';
import { defaultPart } from '../src/model/catalog';
import { SCHEMA_VERSION, type CircuitDoc, type Part } from '../src/model/types';

const MM = 1 / 2.54;

describe('เครื่องมือขนาดจริง', () => {
  it('footprint = ขนาดจริงของตัวเครื่อง (+ ส่วนที่ยื่นจากแผงหน้า) — ใหญ่กว่ารุ่นย่อเดิม 3–5 เท่า', () => {
    expect(TABLE_FOOTPRINT.dcsupply.w).toBeCloseTo(128 * MM, 3);
    expect(TABLE_FOOTPRINT.scope.w).toBeCloseTo(313 * MM, 3);
    expect(TABLE_FOOTPRINT.fgen.d).toBeCloseTo((291 + BENCH_DIMS.fgen.front) * MM, 3);
    expect(TABLE_FOOTPRINT.dmm.d).toBeCloseTo(183 * MM, 3);
    expect(TABLE_FOOTPRINT.vom.w).toBeCloseTo(129 * MM, 3);
    // เดิม (ย่อ) แหล่งจ่าย 10 × 7 หน่วย, สโคป 12 × 8
    expect(TABLE_FOOTPRINT.scope.w / 12).toBeGreaterThan(10);
  });

  it('จัดแถว: แหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคปเรียงหลังบอร์ด ขอบหน้าตรงกันที่ z = −40 ไม่ทับกันและไม่ทับบอร์ด', () => {
    const b = new Builder()
      .part('scope', onTable(0, 0), 'OSC1').part('dcsupply', onTable(0, 0), 'PS1').part('fgen', onTable(0, 0), 'FG1')
      .part('dmm', onTable(0, 0), 'DMM1').part('vom', onTable(0, 0), 'VOM1').part('ammeter', onTable(0, 0), 'A1');
    for (const p of b.doc.parts) {
      expect(checkPlacement(b.doc, p).errors).toEqual([]);
      const f = footprint(p)!;
      if (['dcsupply', 'fgen', 'scope'].includes(p.kind)) expect(f.z1).toBeCloseTo(BENCH_FRONT_Z, 0);
      else expect(f.z0).toBeGreaterThan(BENCH_FRONT_Z);
    }
    const x = (id: string) => (b.doc.parts.find((p) => p.id === id)!.placement as { x: number }).x;
    // ลำดับมาตรฐาน: สโคปซ้ายสุด → แหล่งจ่าย → เครื่องกำเนิดสัญญาณ
    expect(x('OSC1')).toBeLessThan(x('PS1'));
    expect(x('PS1')).toBeLessThan(x('FG1'));
  });

  it('วางจากคลังตรงไหนก็ได้ → ช่องว่างที่ใกล้ตำแหน่งนั้น (แหล่งจ่ายตัวที่สองไปข้างตัวแรก)', () => {
    const b = new Builder().part('dcsupply', onTable(0, 0), 'PS1');
    const ps2 = defaultPart('dcsupply', 'PS2', 'PS2', onTable(0, 0)) as Part;
    const s = benchSlot(b.doc, ps2, { x: -40, z: 0 })!;
    const p1 = b.doc.parts[0].placement as { x: number; z: number };
    expect(s.z).toBe(p1.z);
    expect(Math.abs(s.x - p1.x)).toBeGreaterThanOrEqual(TABLE_FOOTPRINT.dcsupply.w);
  });

  it('สายยังต่อขั้วเดิมหลังจัดใหม่ (relayout ไม่แตะสาย/ขั้ว)', () => {
    const b = new Builder().part('dcsupply', onTable(0, 0), 'PS1').part('resistor', { kind: 'board', boardId: 'bb1', anchor: 'a5', rotation: 0 }, 'R1')
      .wire(P('PS1', 'pos'), H('c5')).wire(P('PS1', 'neg'), H('c9'));
    const moved: CircuitDoc = { ...b.doc, parts: b.doc.parts.map((p) => (p.id === 'PS1' ? { ...p, placement: { kind: 'table', x: 150, z: 120, rotation: 0 } } as Part : p)) };
    const r = relayoutBench(moved);
    expect(r.wires).toEqual(b.doc.wires);
    expect(r.parts.find((p) => p.id === 'PS1')!.placement).toEqual(b.doc.parts.find((p) => p.id === 'PS1')!.placement);
  });
});

describe('ไฟล์รุ่นก่อน 30 (เครื่องมือย่อขนาด, tests/legacy) และไฟล์ตัวอย่างแลป (tests/e2e/fixtures)', () => {
  const files = { ...import.meta.glob('./legacy/*.json', { eager: true, import: 'default' }), ...import.meta.glob('./e2e/fixtures/*.json', { eager: true, import: 'default' }) } as Record<string, { schemaVersion: number; circuit: CircuitDoc }>;
  for (const [path, raw0] of Object.entries(files)) {
    const f = path.split('/').slice(-2).join('/');
    it(`${f}: เปิดได้ เครื่องมือย้ายไปช่องใหม่ สายครบ`, () => {
      const raw = JSON.parse(JSON.stringify(raw0));
      const r = validateProjectFile(raw);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      const doc = r.file!.circuit;
      expect(r.file!.schemaVersion).toBe(SCHEMA_VERSION);
      expect(doc.wires.length).toBe(raw.circuit.wires.length);
      const hadBench = raw.circuit.parts.some((p: Part) => p.placement.kind === 'table' && isBenchKind(p.kind));
      if (raw.schemaVersion < 30 && hadBench) expect(r.warnings.join()).toMatch(/ขนาดจริง/);
      for (const p of doc.parts) expect(checkPlacement(doc, p).errors).toEqual([]);
    });
  }
});
