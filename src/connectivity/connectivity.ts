import { allGroups, groupHoles, groupLabel, holeInfo, holeLabel } from '../model/breadboard';
import { internalLinks, pinDefs } from '../model/catalog';
import { pinHolesFor } from '../model/geometry';
import { terminalKey, type CircuitDoc, type TerminalRef } from '../model/types';

/**
 * ระบบคำนวณการเชื่อมต่อทางไฟฟ้า (electrical connectivity)
 *
 * แหล่งข้อมูลการเชื่อมต่อมีสามอย่างเท่านั้น:
 *   1) การเชื่อมภายในเบรดบอร์ด (กลุ่มรู)
 *   2) ขาอุปกรณ์ที่เสียบในรู
 *   3) สาย jumper (ปลาย a ↔ ปลาย b, ความต้านทาน 0 ในแบบจำลองนี้)
 * ไม่มีการใช้ตำแหน่ง/ระยะทางของโมเดล 3 มิติ
 */

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  keys() { return [...this.parent.keys()]; }
}

export interface NetInfo {
  index: number;
  name: string;
  /** terminal keys (รู / ขั้ว) ในเน็ตนี้ */
  terminals: string[];
  /** ขาอุปกรณ์ทั้งหมดในเน็ตนี้ เช่น "R1 ขา 1" */
  partPins: Array<{ partId: string; pin: string }>;
  /** กลุ่มรูบนบอร์ดที่อยู่ในเน็ต */
  groups: string[];
}

export interface Connectivity {
  nets: NetInfo[];
  /** terminal key หรือ `${partId}:${pin}` → index ของเน็ต */
  netOf: Map<string, number>;
}

const pinKey = (partId: string, pin: string) => `${partId}:${pin}`;

/** เน็ตนี้มีอุปกรณ์อื่นหรือสายต่ออยู่ (ไม่ใช่แค่ขาเดียวเสียบอยู่ในรู) */
export function netLinked(c: Connectivity, doc: CircuitDoc, net: number): boolean {
  if (c.nets[net].partPins.length > 1) return true;
  return doc.wires.some((w) => c.netOf.get(terminalKey(w.a)) === net || c.netOf.get(terminalKey(w.b)) === net);
}

export function computeConnectivity(doc: CircuitDoc): Connectivity {
  const uf = new UnionFind();
  // 1) กลุ่มภายในบอร์ด
  for (const b of doc.breadboards) {
    for (const g of allGroups(b.model)) {
      const gk = `${b.id}#${g}`;
      uf.find(gk);
      for (const h of groupHoles(g, b.model)) uf.union(gk, `${b.id}/${h}`);
    }
  }
  // 2) ขาอุปกรณ์
  for (const part of doc.parts) {
    if (part.placement.kind === 'board') {
      for (const ph of pinHolesFor(part)) {
        uf.find(pinKey(part.id, ph.pin));
        if (ph.hole) uf.union(pinKey(part.id, ph.pin), `${ph.boardId}/${ph.hole}`);
      }
    } else {
      for (const p of pinDefs(part)) uf.find(pinKey(part.id, p.name));
    }
  }
  // 2b) ขาที่ต่อกันภายในอุปกรณ์ (เช่น GND หลายขาของบอร์ด Pico)
  for (const part of doc.parts) for (const group of internalLinks(part)) for (const pin of group.slice(1)) uf.union(pinKey(part.id, group[0]), pinKey(part.id, pin));
  // 3) สาย
  for (const w of doc.wires) uf.union(terminalKey(w.a), terminalKey(w.b));

  const rootIndex = new Map<string, number>();
  const nets: NetInfo[] = [];
  const netOf = new Map<string, number>();
  const sorted = uf.keys().sort();
  for (const k of sorted) {
    const r = uf.find(k);
    let idx = rootIndex.get(r);
    if (idx === undefined) {
      idx = nets.length;
      rootIndex.set(r, idx);
      nets.push({ index: idx, name: `N${idx}`, terminals: [], partPins: [], groups: [] });
    }
    netOf.set(k, idx);
    const net = nets[idx];
    if (k.includes('#')) net.groups.push(k.split('#')[1]);
    else if (k.includes('/')) net.terminals.push(k);
    else {
      const [partId, pin] = k.split(':');
      net.partPins.push({ partId, pin });
      const part = doc.parts.find((p) => p.id === partId);
      if (part && part.placement.kind === 'table') net.terminals.push(k);
    }
  }
  return { nets, netOf };
}

export function netOfTerminal(c: Connectivity, t: TerminalRef): number | undefined {
  return c.netOf.get(terminalKey(t));
}

export function netOfPin(c: Connectivity, partId: string, pin: string): number | undefined {
  return c.netOf.get(pinKey(partId, pin));
}

/** คำอธิบายเน็ตสำหรับแสดงใน UI */
export function describeNet(c: Connectivity, doc: CircuitDoc, idx: number): string {
  const net = c.nets[idx];
  const parts = net.partPins.map(({ partId, pin }) => {
    const p = doc.parts.find((x) => x.id === partId);
    return p ? `${p.label}.${pin}` : pin;
  });
  const groups = net.groups.map(groupLabel);
  const items = [...parts, ...groups];
  return items.length ? items.join(', ') : 'ไม่มีอุปกรณ์';
}

export function terminalLabel(doc: CircuitDoc, t: TerminalRef): string {
  if (t.kind === 'hole') {
    const info = holeInfo(t.hole);
    return info ? `รู ${holeLabel(t.hole)}` : t.hole;
  }
  const p = doc.parts.find((x) => x.id === t.partId);
  const def = p ? pinDefs(p).find((d) => d.name === t.pin) : undefined;
  return p ? `${p.label} ${def?.label ?? t.pin}` : t.pin;
}
