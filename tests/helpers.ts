import { addPart, addWire, insertPart } from '../src/editor/ops';
import { defaultPart } from '../src/model/catalog';
import { analyze } from '../src/instruments/measure';
import { benchSlot, relayoutBench } from '../src/model/bench';
import { isBenchKind } from '../src/model/geometry';
import { emptyCircuit, type CircuitDoc, type Part, type PartKind, type Placement, type TerminalRef } from '../src/model/types';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC } from '../src/sim/solver';

export const H = (hole: string): TerminalRef => ({ kind: 'hole', boardId: 'bb1', hole });
export const P = (partId: string, pin: string): TerminalRef => ({ kind: 'pin', partId, pin });
export const onBoard = (anchor: string, rotation: 0 | 90 | 180 | 270 = 0): Placement => ({ kind: 'board', boardId: 'bb1', anchor, rotation });
export const onTable = (x: number, z: number): Placement => ({ kind: 'table', x, z, rotation: 0 });

/** ตัวช่วยสร้างวงจรในเทสต์ — ทุกขั้นผ่านคำสั่งของ editor จริง (ตรวจการวางเหมือนผู้ใช้) */
export class Builder {
  doc: CircuitDoc = emptyCircuit();
  part(kind: PartKind, placement: Placement, id: string, params?: Record<string, unknown>): this {
    // เครื่องมือขนาดจริง: ตำแหน่งในเทสต์เดิมจะทับบอร์ด → วางในช่องว่างของโต๊ะแล้วจัดแถวเครื่องมือใหม่ (เหมือนวางจากคลังในแอป)
    if (isBenchKind(kind) && placement.kind === 'table') {
      const s = benchSlot(this.doc, defaultPart(kind, id, id, placement) as Part);
      if (s) placement = { ...placement, x: s.x, z: s.z, rotation: 0 };
    }
    const r = params
      ? insertPart(this.doc, { ...defaultPart(kind, id, id, placement), params: { ...defaultPart(kind, id, id, placement).params, ...params } } as Part)
      : addPart(this.doc, kind, placement, id);
    if (!r.ok) throw new Error(`วาง ${id} ไม่ได้: ${r.errors.join('; ')}`);
    this.doc = isBenchKind(kind) ? relayoutBench(r.doc) : r.doc;
    return this;
  }
  wire(a: TerminalRef, b: TerminalRef, id?: string, color = '#e53935'): this {
    const r = addWire(this.doc, a, b, color, id);
    if (!r.ok) throw new Error(`ต่อสายไม่ได้: ${r.errors.join('; ')}`);
    this.doc = r.doc;
    return this;
  }
  probe(red: TerminalRef, black: TerminalRef): this {
    this.doc = { ...this.doc, probes: { red, black } };
    return this;
  }
}

export function simulate(doc: CircuitDoc) {
  const built = buildNetlist(doc);
  const result = solveDC(built.netlist);
  const analysis = analyze(doc, built, result);
  return { built, result, analysis };
}
