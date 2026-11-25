import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfTerminal } from '../src/connectivity/connectivity';
import { addBreadboard, addPart, addWire, deleteBreadboard } from '../src/editor/ops';
import { boardRect, footprint, overlaps } from '../src/model/geometry';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onTable, simulate } from './helpers';

const H2 = (hole: string) => ({ kind: 'hole' as const, boardId: 'bb2', hole });

describe('หลายเบรดบอร์ด', () => {
  it('เพิ่มบอร์ดแผ่นที่ 2/3 ในที่ว่าง ไม่ทับบอร์ดหรืออุปกรณ์บนโต๊ะ', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1');
    let doc = b.doc;
    for (let k = 0; k < 2; k++) { const r = addBreadboard(doc); expect(r.ok).toBe(true); if (r.ok) doc = r.doc; }
    expect(doc.breadboards.map((x) => x.id)).toEqual(['bb1', 'bb2', 'bb3']);
    const rects = doc.breadboards.map((x) => boardRect(x));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    for (const p of doc.parts) { const f = footprint(p); if (f) for (const r of rects) expect(overlaps(f, r)).toBe(false); }
  });

  it('รางไฟสองแผ่นแยกกัน — ต่อถึงกันด้วยสาย jumper แล้ววงจรข้ามบอร์ดจ่ายกระแสได้ตามกฎของโอห์ม', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1');
    const r = addBreadboard(b.doc); if (!r.ok) throw new Error(r.errors.join());
    b.doc = r.doc;
    // R1 บนบอร์ด 2: 1 kΩ ระหว่าง a5–a8 (คนละคอลัมน์)
    const rp = addPart(b.doc, 'resistor', { kind: 'board', boardId: 'bb2', anchor: 'a5', rotation: 0 }, 'R1'); if (!rp.ok) throw new Error(rp.errors.join()); b.doc = rp.doc;
    b.wire(P('PS1', 'pos'), H('tp3'), 'w1').wire(P('PS1', 'neg'), H('tn3'), 'w2');
    let c = computeConnectivity(b.doc);
    expect(netOfTerminal(c, H('tp3'))).not.toBe(netOfTerminal(c, H2('tp3'))); // บอร์ดคนละแผ่น: รางไม่ต่อกันเอง
    b.wire(H('tp5'), H2('tp5'), 'w3').wire(H('tn5'), H2('tn5'), 'w4');
    c = computeConnectivity(b.doc);
    expect(netOfTerminal(c, H('tp3'))).toBe(netOfTerminal(c, H2('tp10')));
    const r1 = b.doc.parts.find((p) => p.id === 'R1')!;
    const span = (r1.params as { span: number }).span;
    b.wire(H2('tp8'), H2('b5'), 'w5').wire(H2('tn9'), H2(`b${5 + span}`), 'w6');
    const { analysis } = simulate(b.doc);
    const I = Math.abs(analysis.parts['R1'].current);
    const V = (b.doc.parts.find((p) => p.id === 'PS1')!.params as { voltage: number }).voltage;
    const R = (r1.params as { resistance: number }).resistance;
    expect(I).toBeGreaterThan(0);
    expect(I).toBeCloseTo(V / R, 4);
  });

  it('ลบบอร์ดได้เฉพาะเมื่อว่าง และต้องเหลืออย่างน้อย 1 แผ่น', () => {
    const b = new Builder();
    expect(deleteBreadboard(b.doc, 'bb1').ok).toBe(false);
    const r = addBreadboard(b.doc); if (!r.ok) throw new Error(); b.doc = r.doc;
    const w = addWire(b.doc, H2('a3'), H2('a9')); if (!w.ok) throw new Error(); 
    const busy = deleteBreadboard(w.doc, 'bb2');
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.errors[0]).toContain('สาย 1 เส้น');
    const d = deleteBreadboard(b.doc, 'bb2');
    expect(d.ok && d.doc.breadboards.map((x) => x.id)).toEqual(['bb1']);
  });

  it('บันทึก/เปิดไฟล์ที่มีสองบอร์ดได้ครบ', () => {
    const r = addBreadboard(new Builder().doc); if (!r.ok) throw new Error();
    const w = addWire(r.doc, H('a1'), H2('j30')); if (!w.ok) throw new Error();
    const back = parseProject(serializeProject('สองบอร์ด', w.doc, emptyWork()));
    expect(back.ok, back.errors.join()).toBe(true);
    expect(back.file!.circuit.breadboards.length).toBe(2);
    expect(back.file!.circuit.wires[0].b).toEqual(H2('j30'));
  });
});
