import { catalogEntry, defaultPart } from '../model/catalog';
import { boardSpec, holeOnBoard, type BoardModel } from '../model/breadboard';
import { benchSlot } from '../model/bench';
import { TABLE_BOUNDS, boardRect, checkPlacement, checkWireEnd, footprint, isBenchKind, overlaps } from '../model/geometry';
import type { CircuitDoc, Part, PartKind, Placement, TerminalRef, Wire } from '../model/types';

/**
 * คำสั่งแก้ไขวงจรแบบ pure function: (doc) → doc ใหม่ หรือข้อผิดพลาด
 * ทุกคำสั่งไม่แก้ doc เดิม ทำให้ Undo/Redo ทำงานได้ด้วยการเก็บ snapshot
 */

export type OpResult = { ok: true; doc: CircuitDoc; warnings: string[]; createdId?: string } | { ok: false; errors: string[] };

const clone = <T>(v: T): T => structuredClone(v);

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter++;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function nextLabel(doc: CircuitDoc, prefix: string): string {
  let n = 1;
  const used = new Set(doc.parts.map((p) => p.label));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function addPart(doc: CircuitDoc, kind: PartKind, placement: Placement, id?: string): OpResult {
  const entry = catalogEntry(kind);
  if (!entry || !entry.supported) return { ok: false, errors: ['อุปกรณ์นี้ยังไม่รองรับ'] };
  const part = defaultPart(kind, id ?? newId(kind), nextLabel(doc, entry.labelPrefix), placement);
  return insertPart(doc, part);
}

export function insertPart(doc: CircuitDoc, part: Part): OpResult {
  const next = clone(doc);
  next.parts.push(clone(part));
  const chk = checkPlacement(next, part);
  if (!chk.ok) return { ok: false, errors: chk.errors };
  return { ok: true, doc: next, warnings: chk.warnings, createdId: part.id };
}

export function movePart(doc: CircuitDoc, partId: string, placement: Placement): OpResult {
  const next = clone(doc);
  const part = next.parts.find((p) => p.id === partId);
  if (!part) return { ok: false, errors: ['ไม่พบอุปกรณ์'] };
  part.placement = clone(placement);
  const chk = checkPlacement(next, part);
  if (!chk.ok) return { ok: false, errors: chk.errors };
  return { ok: true, doc: next, warnings: chk.warnings };
}

/**
 * ย้ายเบรดบอร์ดทั้งแผ่น: อุปกรณ์ที่เสียบอยู่และสายที่เสียบรูเคลื่อนตามไปด้วย (อ้างอิงรูไม่เปลี่ยน)
 * การเชื่อมต่อไม่เปลี่ยนเพราะคิดจากรู/ขา/สายเท่านั้น ไม่ใช่ตำแหน่ง
 */
export function moveBoard(doc: CircuitDoc, boardId: string, x: number, z: number): OpResult {
  const next = clone(doc);
  const b = next.breadboards.find((bb) => bb.id === boardId);
  if (!b) return { ok: false, errors: ['ไม่พบเบรดบอร์ด'] };
  b.x = Math.round(x * 2) / 2;
  b.z = Math.round(z * 2) / 2;
  const errors: string[] = [];
  const S = boardSpec(b.model).size;
  if (Math.abs(b.x) + S.w / 2 > TABLE_BOUNDS.x || Math.abs(b.z) + S.h / 2 > TABLE_BOUNDS.z) errors.push('เบรดบอร์ดจะออกนอกพื้นที่โต๊ะ');
  const r = boardRect(b);
  for (const p of next.parts) {
    const fp = footprint(p);
    if (fp && overlaps(fp, r)) errors.push(`เบรดบอร์ดจะทับ ${p.label} ที่วางบนโต๊ะ`);
  }
  for (const other of next.breadboards) if (other.id !== b.id && overlaps(boardRect(other), r)) errors.push('ทับเบรดบอร์ดอีกแผ่น');
  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: next, warnings: [] };
}

export function deletePart(doc: CircuitDoc, partId: string): OpResult {
  const next = clone(doc);
  const before = next.parts.length;
  next.parts = next.parts.filter((p) => p.id !== partId);
  if (next.parts.length === before) return { ok: false, errors: ['ไม่พบอุปกรณ์'] };
  // ลบสายและโพรบที่เกาะขั้วของอุปกรณ์นี้ (เฉพาะอุปกรณ์นอกบอร์ด)
  const removedWires = next.wires.filter((w) => refersTo(w.a, partId) || refersTo(w.b, partId)).length;
  next.wires = next.wires.filter((w) => !refersTo(w.a, partId) && !refersTo(w.b, partId));
  if (refersTo(next.probes.red, partId)) next.probes.red = null;
  if (refersTo(next.probes.black, partId)) next.probes.black = null;
  return { ok: true, doc: next, warnings: removedWires ? [`ลบสายที่ต่อกับอุปกรณ์นี้ ${removedWires} เส้นด้วย`] : [] };
}

function refersTo(t: TerminalRef | null, partId: string) {
  return !!t && t.kind === 'pin' && t.partId === partId;
}

export function setPartParams(doc: CircuitDoc, partId: string, patch: Record<string, unknown>): OpResult {
  const next = clone(doc);
  const part = next.parts.find((p) => p.id === partId);
  if (!part) return { ok: false, errors: ['ไม่พบอุปกรณ์'] };
  Object.assign(part.params, patch);
  const chk = checkPlacement(next, part); // เช่น เปลี่ยนระยะขาตัวต้านทาน
  if (!chk.ok) return { ok: false, errors: chk.errors };
  return { ok: true, doc: next, warnings: chk.warnings };
}

export function setPartLabel(doc: CircuitDoc, partId: string, label: string): OpResult {
  const next = clone(doc);
  const part = next.parts.find((p) => p.id === partId);
  if (!part) return { ok: false, errors: ['ไม่พบอุปกรณ์'] };
  const t = label.trim();
  if (!t) return { ok: false, errors: ['ชื่อห้ามว่าง'] };
  if (next.parts.some((p) => p.id !== partId && p.label === t)) return { ok: false, errors: ['ชื่อซ้ำกับอุปกรณ์อื่น'] };
  part.label = t;
  return { ok: true, doc: next, warnings: [] };
}

export const WIRE_COLORS = ['#e53935', '#212121', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#f5f5f5'];

export function addWire(doc: CircuitDoc, a: TerminalRef, b: TerminalRef, color = WIRE_COLORS[0], id?: string): OpResult {
  if (JSON.stringify(a) === JSON.stringify(b)) return { ok: false, errors: ['ปลายทั้งสองเป็นจุดเดียวกัน'] };
  const errA = checkWireEnd(doc, a);
  if (errA) return { ok: false, errors: [`ต้นทาง: ${errA}`] };
  const errB = checkWireEnd(doc, b);
  if (errB) return { ok: false, errors: [`ปลายทาง: ${errB}`] };
  if (a.kind === 'hole' && b.kind === 'hole' && a.boardId === b.boardId && a.hole === b.hole) return { ok: false, errors: ['รูเดียวกัน'] };
  const next = clone(doc);
  const wire: Wire = { id: id ?? newId('w'), a: clone(a), b: clone(b), color, arc: 2, bend: 0 };
  next.wires.push(wire);
  return { ok: true, doc: next, warnings: [], createdId: wire.id };
}

export function deleteWire(doc: CircuitDoc, wireId: string): OpResult {
  const next = clone(doc);
  const before = next.wires.length;
  next.wires = next.wires.filter((w) => w.id !== wireId);
  if (next.wires.length === before) return { ok: false, errors: ['ไม่พบสาย'] };
  return { ok: true, doc: next, warnings: [] };
}

export function updateWire(doc: CircuitDoc, wireId: string, patch: Partial<Pick<Wire, 'color' | 'arc' | 'bend'>>): OpResult {
  const next = clone(doc);
  const w = next.wires.find((x) => x.id === wireId);
  if (!w) return { ok: false, errors: ['ไม่พบสาย'] };
  Object.assign(w, patch);
  return { ok: true, doc: next, warnings: [] };
}

/** ย้ายปลายสายข้างหนึ่งไปจุดใหม่ */
export function moveWireEnd(doc: CircuitDoc, wireId: string, end: 'a' | 'b', to: TerminalRef): OpResult {
  const w = doc.wires.find((x) => x.id === wireId);
  if (!w) return { ok: false, errors: ['ไม่พบสาย'] };
  const err = checkWireEnd(doc, to, wireId);
  if (err) return { ok: false, errors: [err] };
  const next = clone(doc);
  next.wires.find((x) => x.id === wireId)![end] = clone(to);
  return { ok: true, doc: next, warnings: [] };
}

export function setProbe(doc: CircuitDoc, which: 'red' | 'black', t: TerminalRef | null): OpResult {
  const next = clone(doc);
  next.probes[which] = t ? clone(t) : null;
  return { ok: true, doc: next, warnings: [] };
}

/** หาตำแหน่งว่างใกล้เดิมสำหรับคัดลอกอุปกรณ์ */
export function duplicatePart(doc: CircuitDoc, partId: string, candidates: Placement[]): OpResult {
  const src = doc.parts.find((p) => p.id === partId);
  if (!src) return { ok: false, errors: ['ไม่พบอุปกรณ์'] };
  const entry = catalogEntry(src.kind)!;
  for (const pl of candidates) {
    const copy: Part = { ...clone(src), id: newId(src.kind), label: nextLabel(doc, entry.labelPrefix), placement: clone(pl) };
    const r = insertPart(doc, copy);
    if (r.ok) return r;
  }
  return { ok: false, errors: ['ไม่พบตำแหน่งว่างสำหรับวางสำเนา'] };
}

export function clearProbes(doc: CircuitDoc): OpResult {
  const next = clone(doc);
  next.probes = { red: null, black: null };
  return { ok: true, doc: next, warnings: [] };
}

/**
 * เปลี่ยนรุ่นเบรดบอร์ด (CL-400 ↔ MB-102) โดยคงจุดกึ่งกลางเดิม — อ้างอิงรูเดิมยังใช้ได้ทั้งหมด (ชื่อรู MB-102 ครอบคลุม CL-400)
 * เครื่องมือบนโต๊ะที่จะถูกบอร์ดที่ยาวขึ้นทับ ย้ายไปช่องว่างที่ใกล้ที่สุด · อุปกรณ์อื่นบนโต๊ะที่ทับ → ไม่ยอม (บอกให้ย้ายก่อน)
 * เปลี่ยนเป็นรุ่นเล็กได้เมื่อไม่มีขา/สาย/โพรบอยู่นอกคอลัมน์ 1–30
 */
export function setBoardModel(doc: CircuitDoc, boardId: string, model: BoardModel): OpResult {
  const b0 = doc.breadboards.find((bb) => bb.id === boardId);
  if (!b0) return { ok: false, errors: ['ไม่พบเบรดบอร์ด'] };
  if (b0.model === model) return { ok: true, doc, warnings: [] };
  let next = clone(doc);
  const b = next.breadboards.find((bb) => bb.id === boardId)!;
  b.model = model;
  const errors: string[] = [], warnings: string[] = [];
  const S = boardSpec(model).size;
  if (Math.abs(b.x) + S.w / 2 > TABLE_BOUNDS.x || Math.abs(b.z) + S.h / 2 > TABLE_BOUNDS.z) errors.push('เบรดบอร์ดรุ่นนี้จะยื่นออกนอกพื้นที่โต๊ะ — ย้ายบอร์ดเข้ากลางโต๊ะก่อน');
  const off = new Set<string>();
  for (const p of next.parts) if (p.placement.kind === 'board' && p.placement.boardId === boardId && !checkPlacement(next, p).ok) off.add(p.label);
  for (const w of next.wires) for (const t of [w.a, w.b]) if (t.kind === 'hole' && t.boardId === boardId && !holeOnBoard(t.hole, model)) off.add(`สาย ${w.id}`);
  for (const t of [next.probes.red, next.probes.black]) if (t && t.kind === 'hole' && t.boardId === boardId && !holeOnBoard(t.hole, model)) off.add('โพรบ');
  if (off.size) errors.push(`${[...off].slice(0, 4).join(', ')}${off.size > 4 ? ' …' : ''} อยู่นอกพื้นที่ของบอร์ด ${model} — ย้ายเข้าคอลัมน์ 1–${boardSpec(model).cols} ก่อน`);
  const r = boardRect(b);
  for (const other of next.breadboards) if (other.id !== b.id && overlaps(boardRect(other), r)) errors.push('บอร์ดที่ใหญ่ขึ้นจะทับเบรดบอร์ดอีกแผ่น');
  // เครื่องมือขนาดจริงที่ถูกทับ: หาที่ใหม่ทีละชิ้น
  for (const p of next.parts) {
    const fp = footprint(p);
    if (!fp || !overlaps(fp, r)) continue;
    if (!isBenchKind(p.kind) || p.placement.kind !== 'table') { errors.push(`บอร์ดที่ใหญ่ขึ้นจะทับ ${p.label} ที่วางบนโต๊ะ — ย้ายออกก่อน`); continue; }
    const slot = benchSlot(next, p, { x: p.placement.x, z: p.placement.z });
    if (!slot) { errors.push(`ไม่มีที่ว่างให้ย้าย ${p.label}`); continue; }
    next = { ...next, parts: next.parts.map((q) => (q.id === p.id ? { ...q, placement: { ...q.placement, x: slot.x, z: slot.z } } as Part : q)) };
    warnings.push(`ย้าย ${p.label} ออกข้างบอร์ด`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: next, warnings };
}
