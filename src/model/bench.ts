import { BENCH_FLAT_KINDS, BENCH_FRONT_Z, BENCH_ROW_KINDS, TABLE_BOUNDS, TABLE_FOOTPRINT, boardRect, footprint, isBenchKind, overlaps, type Rect } from './geometry';
import type { CircuitDoc, Part } from './types';

/**
 * จัดวางเครื่องมือขนาดจริงบนโต๊ะ (ตรรกะล้วน ไม่เกี่ยวกับ 3D)
 * - แหล่งจ่าย / เครื่องกำเนิดสัญญาณ / ออสซิลโลสโคป: เรียงแถวหลังบอร์ด ขอบหน้าอยู่ที่ z = BENCH_FRONT_Z แผงหน้าหันเข้าหาผู้ใช้
 * - มัลติมิเตอร์/แอมมิเตอร์ (วางหงาย): ข้างพื้นที่ทำงาน ซ้าย/ขวาของบอร์ด
 * ใช้ตอนวางจากคลัง (ปล่อยตรงไหนก็เข้าช่องที่ใกล้ที่สุด), ตอนเปิดไฟล์รุ่นเก่า (schema < 30, เครื่องมือเดิมย่อขนาด) และในเทสต์
 */

/** ตำแหน่ง x ที่อยากได้ของแต่ละชนิด (ขั้วต่อของแหล่งจ่ายอยู่หลังบอร์ดด้านซ้าย เครื่องกำเนิดสัญญาณด้านขวา สโคปถัดออกไป) */
const PREF_X: Record<string, number> = { dcsupply: -40, fgen: 45, scope: 0, ammeter: -42, dmm: 42, vom: -50 };
const ORDER = ['dcsupply', 'fgen', 'scope', 'ammeter', 'dmm', 'vom'];
/** ช่องว่างระหว่างเครื่อง (หน่วยรู) */
const GAP = 1.5;

function obstacles(doc: CircuitDoc, ignoreId: string): Rect[] {
  const out: Rect[] = doc.breadboards.map((b) => boardRect(b));
  for (const p of doc.parts) {
    if (p.id === ignoreId) continue;
    const f = footprint(p);
    if (f) out.push(f);
  }
  return out;
}

const grow = (r: Rect, g: number): Rect => ({ x0: r.x0 - g, x1: r.x1 + g, z0: r.z0 - g, z1: r.z1 + g });
const inside = (r: Rect) => r.x0 >= -TABLE_BOUNDS.x && r.x1 <= TABLE_BOUNDS.x && r.z0 >= -TABLE_BOUNDS.z && r.z1 <= TABLE_BOUNDS.z;

/**
 * ช่องว่างบนโต๊ะสำหรับเครื่องมือชิ้นนี้ (หมุน 0°) ที่ใกล้ตำแหน่ง near.x ที่สุด — null ถ้าไม่มีที่ว่าง
 * (ไม่ใช่เครื่องมือขนาดจริง → null)
 */
export function benchSlot(doc: CircuitDoc, part: Part, near?: { x: number; z: number }): { x: number; z: number } | null {
  if (!isBenchKind(part.kind)) return null;
  const f = TABLE_FOOTPRINT[part.kind];
  const obs = obstacles(doc, part.id);
  const free = (x: number, z: number) => {
    const r: Rect = { x0: x - f.w / 2, x1: x + f.w / 2, z0: z - f.d / 2, z1: z + f.d / 2 };
    return inside(r) && !obs.some((o) => overlaps(grow(r, GAP), o));
  };
  const px = near?.x ?? PREF_X[part.kind] ?? 0;
  const xs: number[] = [];
  for (let x = -TABLE_BOUNDS.x + f.w / 2; x <= TABLE_BOUNDS.x - f.w / 2; x += 0.5) xs.push(Math.round(x * 2) / 2);
  xs.sort((a, b) => Math.abs(a - px) - Math.abs(b - px) || a - b);
  if (BENCH_ROW_KINDS.includes(part.kind)) {
    // แถวหลัง: ขอบหน้าตรงแนวเดียวกัน (ถ้าเต็ม ลองแถวที่สองถัดไปด้านหลัง)
    for (const z of [BENCH_FRONT_Z - f.d / 2, BENCH_FRONT_Z - 46 - f.d / 2]) {
      const zz = Math.round(z * 2) / 2;
      for (const x of xs) if (free(x, zz)) return { x, z: zz };
    }
  }
  // วางหงาย (หรือแถวหลังเต็ม): ข้างพื้นที่ทำงาน ใกล้ z = near.z (ค่าเริ่ม 0)
  const pz = BENCH_FLAT_KINDS.includes(part.kind) ? near?.z ?? 0 : 60;
  const zMin = BENCH_FRONT_Z + f.d / 2 + GAP, zMax = TABLE_BOUNDS.z - f.d / 2;
  const cand: Array<{ x: number; z: number; s: number }> = [];
  for (let z = zMin; z <= zMax; z += 2) for (let x = -TABLE_BOUNDS.x + f.w / 2; x <= TABLE_BOUNDS.x - f.w / 2; x += 2) {
    cand.push({ x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2, s: Math.abs(x - px) + 1.5 * Math.abs(z - pz) });
  }
  cand.sort((a, b) => a.s - b.s);
  for (const c of cand) if (free(c.x, c.z)) return { x: c.x, z: c.z };
  return null;
}

/** จัดเครื่องมือขนาดจริงทุกชิ้นลงช่องใหม่ตามลำดับมาตรฐาน (อุปกรณ์อื่นอยู่ที่เดิม) — คืนเอกสารใหม่ */
export function relayoutBench(doc: CircuitDoc): CircuitDoc {
  const bench = doc.parts.filter((p) => p.placement.kind === 'table' && isBenchKind(p.kind));
  if (!bench.length) return doc;
  const order = [...bench].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
    || (a.placement.kind === 'table' && b.placement.kind === 'table' ? a.placement.x - b.placement.x : 0));
  const benchIds = new Set(bench.map((p) => p.id));
  // เริ่มจากโต๊ะที่ไม่มีเครื่องมือ แล้วเติมทีละชิ้น
  let work: CircuitDoc = { ...doc, parts: doc.parts.filter((p) => !benchIds.has(p.id)) };
  const placed = new Map<string, Part>();
  for (const p of order) {
    const probe = { ...p, placement: { kind: 'table' as const, x: 0, z: 0, rotation: 0 as const } } as Part;
    const s = benchSlot(work, probe);
    const np = (s ? { ...p, placement: { kind: 'table', x: s.x, z: s.z, rotation: 0 } } : p) as Part;
    placed.set(p.id, np);
    work = { ...work, parts: [...work.parts, np] };
  }
  return { ...doc, parts: doc.parts.map((p) => placed.get(p.id) ?? p) };
}
