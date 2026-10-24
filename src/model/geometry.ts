import { GRID_ROWS, boardSpec, holeAt, holeInfo, holeLabel, groupLabel, type BoardModel } from './breadboard';
import { catalogEntry, pinDefs, rotateOffset } from './catalog';
import type { Breadboard, CircuitDoc, Part, Rotation, TerminalRef } from './types';

/**
 * เรขาคณิตเชิงตรรกะของการวาง (ไม่เกี่ยวกับ 3D renderer)
 * - คำนวณว่าขาแต่ละขาของอุปกรณ์บนบอร์ดเสียบอยู่ในรูใด
 * - ตรวจการวางทับ / รูซ้ำ / ขาหลุดนอกบอร์ด
 */

export interface PinHole {
  pin: string;
  boardId: string;
  hole: string;
}

/** ขาของอุปกรณ์บนบอร์ด → รู (null ถ้าขาตกนอกรู) */
export function pinHolesFor(part: Part, model?: BoardModel): Array<{ pin: string; boardId: string; hole: string | null }> {
  // ไม่ระบุรุ่น: ใช้ตารางรูของรุ่นใหญ่สุด (เอกสารที่ผ่าน checkPlacement แล้วไม่มีขาหลุดขอบบอร์ดรุ่นเล็ก)
  if (part.placement.kind !== 'board') return [];
  const { boardId, anchor, rotation } = part.placement;
  const a = holeInfo(anchor, model);
  return pinDefs(part).map((p) => {
    if (!a) return { pin: p.name, boardId, hole: null };
    const [dx, dy] = rotateOffset(p.dx, p.dy, rotation);
    return { pin: p.name, boardId, hole: holeAt(a.x + dx, a.y + dy, model) ?? null };
  });
}
/** รุ่นของบอร์ดที่อุปกรณ์เสียบอยู่ */
export function boardModelOf(doc: CircuitDoc, boardId: string): BoardModel {
  return doc.breadboards.find((b) => b.id === boardId)?.model ?? 'CL-400';
}

/** รูที่ถูกตัวบอร์ดปิดทับ (เช่น PCB ของ Pico คลุมแถวระหว่างขาสองแถว) — เสียบอุปกรณ์หรือสายไม่ได้ */
export function coveredHoles(part: Part): string[] {
  if (part.kind !== 'pico' || part.placement.kind !== 'board') return [];
  const a = holeInfo(part.placement.anchor);
  if (!a) return [];
  const out: string[] = [];
  for (let dx = 0; dx < 20; dx++) for (let dy = -6; dy <= -1; dy++) {
    const [rx, ry] = rotateOffset(dx, dy, part.placement.rotation);
    const h = holeAt(a.x + rx, a.y + ry);
    if (h) out.push(h);
  }
  return out;
}

/** แผนที่ รู → เจ้าของ (ขาอุปกรณ์หรือปลายสาย) */
export function holeOccupancy(doc: CircuitDoc, ignorePartId?: string, ignoreWireId?: string): Map<string, string> {
  const occ = new Map<string, string>();
  for (const part of doc.parts) {
    if (part.id === ignorePartId) continue;
    for (const ph of pinHolesFor(part)) if (ph.hole) occ.set(`${ph.boardId}/${ph.hole}`, `${part.label} ขา ${ph.pin}`);
    if (part.placement.kind === 'board') for (const h of coveredHoles(part)) occ.set(`${part.placement.boardId}/${h}`, `ตัวบอร์ด ${part.label} (ปิดทับรู)`);
  }
  for (const w of doc.wires) {
    if (w.id === ignoreWireId) continue;
    for (const t of [w.a, w.b]) if (t.kind === 'hole') occ.set(`${t.boardId}/${t.hole}`, `สาย ${w.id}`);
  }
  return occ;
}

export interface PlacementCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * เครื่องมือบนโต๊ะขนาดจริง (mm): w กว้าง × h สูง × d ลึกของตัวเครื่อง + front = ส่วนที่ยื่นจากแผงหน้า (ขั้วต่อ/ปุ่มหมุน/BNC)
 * อ้างอิงขนาดของเครื่องรุ่นที่ใช้ในห้องแลปทั่วไป (ไม่อิงยี่ห้อในโมเดล):
 *   แหล่งจ่าย 0–30 V 3 A แบบตั้งโต๊ะ 128 × 145 × 285 mm · เครื่องกำเนิดสัญญาณ 251 × 91 × 291 mm
 *   ออสซิลโลสโคปดิจิทัล 4 ช่องรุ่นเล็ก 313 × 161 × 122 mm · มัลติมิเตอร์ดิจิทัลพร้อมซองยาง 91 × 49.5 × 183 mm (วางหงาย)
 *   มัลติมิเตอร์แบบเข็ม 129 × 41.5 × 159.5 mm (วางหงาย)
 */
export const BENCH_DIMS: Record<string, { w: number; h: number; d: number; front: number }> = {
  dcsupply: { w: 128, h: 145, d: 285, front: 30 },
  fgen: { w: 251, h: 91, d: 291, front: 30 },
  scope: { w: 313, h: 161, d: 122, front: 30 },
  ammeter: { w: 91, h: 49.5, d: 183, front: 0 },
  dmm: { w: 91, h: 49.5, d: 183, front: 0 },
  vom: { w: 129, h: 41.5, d: 159.5, front: 0 },
};
const MM = 1 / 2.54;
const benchFp = (k: string) => ({ w: BENCH_DIMS[k].w * MM, d: (BENCH_DIMS[k].d + BENCH_DIMS[k].front) * MM });

export const TABLE_FOOTPRINT: Record<string, { w: number; d: number }> = {
  dcsupply: benchFp('dcsupply'),
  ammeter: benchFp('ammeter'),
  fgen: benchFp('fgen'),
  scope: benchFp('scope'),
  dmm: benchFp('dmm'),
  vom: benchFp('vom'),
  relay: { w: 13.4, d: 10.3 }, // โมดูลรีเลย์ 34 × 26 mm (ขนาดจริง)
  speaker: { w: 24, d: 30 }, // ลำโพง Ø 57 mm + สายและขาตัวผู้ด้านหน้า
  motor: { w: 30, d: 14 }, // มอเตอร์ TT 70 × 22 mm + แผ่นจานบอกการหมุน + สาย
  servo: { w: 13, d: 15 }, // SG90 32.5 × 12 mm + สายและหัวต่อด้านหน้า
  stepper: { w: 17, d: 28 }, // 28BYJ-48 หูยึด 42 mm + บอร์ด ULN2003 35 × 32 mm วางต่อกัน (≈ 42 × 70 mm)
  transformer: { w: 26, d: 24 }, // หม้อแปลง EI-57 รวมขาเหล็กและบล็อกขั้ว ≈ 66 × 61 mm
};

/** เครื่องมือวางแถวหลังโต๊ะ (แผงหน้าหันเข้าหาผู้ใช้) / มิเตอร์วางหงายข้างบอร์ด */
export const BENCH_ROW_KINDS = ['dcsupply', 'fgen', 'scope'];
export const BENCH_FLAT_KINDS = ['ammeter', 'dmm', 'vom'];
export const isBenchKind = (k: string) => BENCH_ROW_KINDS.includes(k) || BENCH_FLAT_KINDS.includes(k);
/** ขอบหน้าของแถวเครื่องมือด้านหลัง (z ของ footprint ด้านหน้า) — พื้นที่ทำงานรอบบอร์ดอยู่ในช่วง |z| ≤ 40 */
export const BENCH_FRONT_Z = -40;

export type Rect = { x0: number; x1: number; z0: number; z1: number };

/** อุปกรณ์ชนิดที่ปกติเสียบบนเบรดบอร์ด (มีขาเป็นลวด/ขา header) — วางบนโต๊ะได้ด้วย */
export function isBoardKind(part: Part): boolean {
  return catalogEntry(part.kind)?.mount === 'board';
}

/**
 * ตำแหน่งขา (x,z ในพิกัดโลก) ของอุปกรณ์ชนิดเสียบบอร์ดที่วางอยู่บนโต๊ะ
 * placement.x/z คือตำแหน่งขาอ้างอิง (pin index 0) เหมือน anchor บนบอร์ด
 */
export function tablePinXZ(part: Part, pin: string): { x: number; z: number } | null {
  if (part.placement.kind !== 'table' || !isBoardKind(part)) return null;
  const d = pinDefs(part).find((p) => p.name === pin);
  if (!d) return null;
  const [dx, dy] = rotateOffset(d.dx, d.dy, part.placement.rotation);
  return { x: part.placement.x + dx, z: part.placement.z + dy };
}

/** ศูนย์กลางของกลุ่มขา (ก่อนบวกตำแหน่ง) หลังหมุน — ใช้ให้ตัวชี้อยู่กลางอุปกรณ์ขณะลากจากคลัง */
export function pinCenterOffset(part: Part, rotation: Rotation): { dx: number; dz: number } {
  if (!isBoardKind(part)) return { dx: 0, dz: 0 };
  const defs = pinDefs(part);
  let sx = 0, sz = 0;
  for (const d of defs) { const [x, y] = rotateOffset(d.dx, d.dy, rotation); sx += x; sz += y; }
  return { dx: sx / Math.max(1, defs.length), dz: sz / Math.max(1, defs.length) };
}

/** พื้นที่ที่อุปกรณ์บนโต๊ะครอบครอง (ใช้ตรวจการวางทับเท่านั้น — ไม่เคยใช้ตัดสินการเชื่อมต่อ) */
export function footprint(part: Part): Rect | null {
  if (part.placement.kind !== 'table') return null;
  if (isBoardKind(part)) {
    const m = part.kind === 'pico' ? 0.6 : 0.8;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const d of pinDefs(part)) {
      const [dx, dy] = rotateOffset(d.dx, d.dy, part.placement.rotation);
      x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); z0 = Math.min(z0, dy); z1 = Math.max(z1, dy);
    }
    const { x, z } = part.placement;
    return { x0: x + x0 - m, x1: x + x1 + m, z0: z + z0 - m, z1: z + z1 + m };
  }
  const f = TABLE_FOOTPRINT[part.kind];
  if (!f) return null;
  const rot = part.placement.rotation % 180 !== 0;
  const w = rot ? f.d : f.w, d = rot ? f.w : f.d;
  return { x0: part.placement.x - w / 2, x1: part.placement.x + w / 2, z0: part.placement.z - d / 2, z1: part.placement.z + d / 2 };
}

/** ขอบเขตพื้นโต๊ะที่วางของได้ */
export const TABLE_BOUNDS = { x: 200, z: 180 };

export function overlaps(a: Rect, b: Rect) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

export function boardRect(b: Pick<Breadboard, 'x' | 'z'> & { model?: BoardModel }): Rect {
  const S = boardSpec(b.model).size;
  return { x0: b.x - S.w / 2, x1: b.x + S.w / 2, z0: b.z - S.h / 2, z1: b.z + S.h / 2 };
}

export function checkPlacement(doc: CircuitDoc, part: Part): PlacementCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entry = catalogEntry(part.kind);
  // อุปกรณ์ชนิดเสียบบอร์ดวางบนโต๊ะได้ (ขายังไม่ต่อกับอะไรจนกว่าจะต่อสาย) แต่เครื่องมือ/แหล่งจ่ายเสียบลงรูไม่ได้
  if (entry && entry.mount === 'table' && part.placement.kind !== 'table') errors.push('เครื่องมือนี้วางบนโต๊ะเท่านั้น เสียบลงเบรดบอร์ดไม่ได้');

  if (part.placement.kind === 'board') {
    const occ = holeOccupancy(doc, part.id);
    const phs = pinHolesFor(part, boardModelOf(doc, part.placement.boardId));
    const groups = new Map<string, string[]>();
    for (const ph of phs) {
      if (!ph.hole) {
        errors.push(`ขา ${ph.pin} ไม่ตรงกับรูบนบอร์ด (หลุดขอบหรือตกร่องกลาง)`);
        continue;
      }
      const owner = occ.get(`${ph.boardId}/${ph.hole}`);
      if (owner) errors.push(owner.startsWith('ตัวบอร์ด') ? `รู ${holeLabel(ph.hole)} อยู่ใต้${owner}` : `รู ${holeLabel(ph.hole)} มี ${owner} เสียบอยู่แล้ว (หนึ่งรูรับได้หนึ่งขา)`);
      const g = holeInfo(ph.hole)!.group;
      groups.set(g, [...(groups.get(g) ?? []), ph.pin]);
    }
    // ตัวบอร์ดที่ปิดทับรู ต้องไม่ทับขาหรือสายที่มีอยู่
    for (const h of coveredHoles(part)) {
      const owner = occ.get(`${part.placement.boardId}/${h}`);
      if (owner && !owner.startsWith('ตัวบอร์ด')) errors.push(`ตัวบอร์ดจะปิดทับรู ${holeLabel(h)} ที่มี ${owner} อยู่`);
    }
    for (const [g, pins] of groups) {
      if (pins.length > 1) warnings.push(`ขา ${pins.join(' และ ')} อยู่ในกลุ่มเดียวกัน (${groupLabel(g)}) — อุปกรณ์ถูกลัดวงจร ไม่มีกระแสผ่าน`);
    }
  } else {
    const fp = footprint(part)!;
    for (const b of doc.breadboards) {
      if (overlaps(fp, boardRect(b))) errors.push(isBoardKind(part) ? 'อยู่บนเบรดบอร์ดแต่ขาไม่ตรงรู — เลื่อนให้ขาตรงรู หรือวางบนพื้นโต๊ะนอกบอร์ด' : 'วางทับเบรดบอร์ด — เครื่องมือต้องวางบนพื้นโต๊ะนอกบอร์ด');
    }
    for (const other of doc.parts) {
      if (other.id === part.id) continue;
      const ofp = footprint(other);
      if (ofp && overlaps(fp, ofp)) errors.push(`วางทับ ${other.label}`);
    }
    if (fp.x0 < -TABLE_BOUNDS.x || fp.x1 > TABLE_BOUNDS.x || fp.z0 < -TABLE_BOUNDS.z || fp.z1 > TABLE_BOUNDS.z) errors.push('อยู่นอกพื้นที่โต๊ะ');
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** ตรวจว่าปลายสายเสียบรูได้ไหม */
export function checkWireEnd(doc: CircuitDoc, t: TerminalRef, ignoreWireId?: string): string | null {
  if (t.kind === 'hole') {
    if (!holeInfo(t.hole, boardModelOf(doc, t.boardId))) return 'ไม่มีรูนี้บนบอร์ด';
    const owner = holeOccupancy(doc, undefined, ignoreWireId).get(`${t.boardId}/${t.hole}`);
    if (owner) return `รู ${holeLabel(t.hole)} มี ${owner} อยู่แล้ว ให้ใช้รูอื่นในกลุ่มเดียวกัน`;
    return null;
  }
  const part = doc.parts.find((p) => p.id === t.partId);
  if (!part) return 'ไม่พบอุปกรณ์';
  if (!pinDefs(part).some((p) => p.name === t.pin)) return 'ไม่พบขั้วนี้';
  // สายใหม่ที่ต่อเข้าขาอุปกรณ์บนบอร์ด: ให้เสียบรูอื่นในกลุ่มเดียวกันแทน (แบบบอร์ดจริง)
  // แต่สายที่ต่อขาไว้ตั้งแต่อุปกรณ์อยู่บนโต๊ะ แล้วย้ายอุปกรณ์ลงบอร์ด ยังคงต่อที่ขาเดิม (ดู schema)
  if (part.placement.kind === 'board') return 'ขาอุปกรณ์เสียบอยู่ในรูแล้ว ให้ต่อสายเข้ารูอื่นในกลุ่มเดียวกัน';
  return null; // ขั้ว/ขาบนโต๊ะรับสายได้หลายเส้น (เหมือนคีบปากจระเข้)
}

/** พิกัดโลกของรู (หน่วยรู, ระนาบ x-z) */
export function holeWorld(board: Breadboard, hole: string): { x: number; z: number } | null {
  const h = holeInfo(hole);
  if (!h) return null;
  return { x: board.x + (h.x - (boardSpec(board.model).cols + 1) / 2), z: board.z + (h.y - (GRID_ROWS - 1) / 2) };
}

/** หา (x,y) กริดที่ใกล้ที่สุดจากพิกัดโลก */
export function worldToGrid(board: Breadboard, x: number, z: number): { gx: number; gy: number } {
  return { gx: Math.round(x - board.x + (boardSpec(board.model).cols + 1) / 2), gy: Math.round(z - board.z + (GRID_ROWS - 1) / 2) };
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}
