import { describe, expect, it } from 'vitest';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';
import { BOARD_SPECS, allGroups, allHoles, groupHoles, holeInfo, holeOnBoard, railHasColumn } from '../src/model/breadboard';
import { addPart, movePart, setBoardModel } from '../src/editor/ops';
import { boardRect, footprint, holeWorld, overlaps, pinHolesFor } from '../src/model/geometry';
import { computeConnectivity, netOfTerminal } from '../src/connectivity/connectivity';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';

const mb = (doc: CircuitDoc): CircuitDoc => { const r = setBoardModel(doc, 'bb1', 'MB-102'); if (!r.ok) throw new Error(r.errors.join('; ')); return r.doc; };

describe('เบรดบอร์ด MB-102 (เต็มแผ่น 830 จุด)', () => {
  it('830 จุด = 630 รูพื้นที่หลัก (63 คอลัมน์ × 10) + 200 รูรางไฟ (4 เส้น × 50) · CL-400 ยัง 400 จุดเท่าเดิม', () => {
    const h = allHoles('MB-102');
    expect(h.length).toBe(830);
    expect(h.filter((x) => /^[a-j]\d+$/.test(x.name)).length).toBe(630);
    expect([...Array(63)].map((_, i) => i + 1).filter((x) => railHasColumn(x, 'MB-102')).length).toBe(50);
    expect(allHoles('CL-400').length).toBe(400);
    expect(BOARD_SPECS['MB-102'].mm).toEqual({ w: 165.1, h: 54.6, t: 8.5 });
  });
  it('การเชื่อมต่อภายใน: a–e คอลัมน์ 63 เป็นกลุ่มเดียว · รางไฟ T+ ต่อเนื่องตลอด 50 รู · บน CL-400 ไม่มีรู a31/tp32', () => {
    expect(groupHoles('col63-top', 'MB-102').sort()).toEqual(['a63', 'b63', 'c63', 'd63', 'e63']);
    expect(groupHoles('rail-tp-0', 'MB-102').length).toBe(50);
    expect(groupHoles('rail-tp-0', 'CL-400').length).toBe(25);
    expect(holeOnBoard('a31', 'CL-400')).toBe(false); expect(holeOnBoard('a31', 'MB-102')).toBe(true);
    expect(holeOnBoard('tp32', 'CL-400')).toBe(false); expect(holeOnBoard('tp60', 'MB-102')).toBe(true); expect(holeOnBoard('tp61', 'MB-102')).toBe(false);
    expect(allGroups('MB-102').length).toBe(63 * 2 + 4);
    expect(holeInfo('a45', 'CL-400')).toBeUndefined();
  });
  it('เปลี่ยน CL-400 → MB-102: อ้างอิงรูเดิมใช้ได้ ผลจำลองเหมือนเดิมทุกค่า · กึ่งกลางบอร์ดคงที่ รู a1 เลื่อนตามความยาวบอร์ด', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-40, 0), 'PS1', { voltage: 5 })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 1000 })
      .part('led', onBoard('c9'), 'LED1')
      .wire(P('PS1', 'pos'), H('tp2'), 'w1').wire(P('PS1', 'neg'), H('tn2'), 'w2').wire(H('b5'), H('tp5'), 'w3').wire(H('d10'), H('tn10'), 'w4');
    const before = simulate(b.doc);
    const d2 = mb(b.doc);
    const after = simulate(d2);
    expect(after.analysis.parts.LED1.current).toBeCloseTo(before.analysis.parts.LED1.current, 12);
    expect(d2.breadboards[0].x).toBe(b.doc.breadboards[0].x);
    const w1 = holeWorld(b.doc.breadboards[0], 'a1')!, w2 = holeWorld(d2.breadboards[0], 'a1')!;
    expect(w2.x).toBeCloseTo(w1.x - 16.5, 9); // (63 − 30) / 2
  });
  it('วางอุปกรณ์ที่คอลัมน์ 50 ได้บน MB-102 แต่ CL-400 ไม่ได้ · ต่อสายเข้ารางไฟคอลัมน์ 58 แล้วเชื่อมกับรางคอลัมน์ 2', () => {
    const b = new Builder().part('dcsupply', onTable(-60, 0), 'PS1', { voltage: 5 });
    const small = addPart(b.doc, 'resistor', onBoard('a50'), 'R9');
    expect(small.ok).toBe(false);
    const big = addPart(mb(b.doc), 'resistor', onBoard('a50'), 'R9');
    expect(big.ok).toBe(true);
    const d = big.ok ? big.doc : b.doc;
    expect(pinHolesFor(d.parts.find((p) => p.id === 'R9')!).map((x) => x.hole)).toEqual(['a50', 'a54']);
    const c = computeConnectivity(d);
    expect(netOfTerminal(c, H('tp58'))).toBe(netOfTerminal(c, H('tp2')));
    expect(netOfTerminal(c, H('tp58'))).not.toBe(netOfTerminal(c, H('tn58')));
    expect(netOfTerminal(c, H('a50'))).toBe(netOfTerminal(c, H('e50')));
  });
  it('เปลี่ยนกลับเป็น CL-400 ไม่ได้ถ้ามีอุปกรณ์อยู่เลยคอลัมน์ 30 (บอกชื่อ) · ย้ายเข้ามาแล้วเปลี่ยนได้', () => {
    const b = new Builder().part('resistor', onBoard('a5'), 'R1');
    let d = mb(b.doc);
    const r = addPart(d, 'resistor', onBoard('a40'), 'R2'); if (!r.ok) throw new Error(); d = r.doc;
    const back = setBoardModel(d, 'bb1', 'CL-400');
    expect(back.ok).toBe(false);
    expect(back.ok ? '' : back.errors.join()).toContain('R2');
    const m = movePart(d, 'R2', onBoard('c5')); if (!m.ok) throw new Error(m.errors.join());
    expect(setBoardModel(m.doc, 'bb1', 'CL-400').ok).toBe(true);
  });
  it('เครื่องมือขนาดจริงที่บอร์ดยาวขึ้นจะทับ (มัลติมิเตอร์ข้างบอร์ด) ถูกย้ายไปช่องว่าง · อุปกรณ์อื่นบนโต๊ะที่ทับ → บอกให้ย้ายก่อน', () => {
    const b = new Builder().part('dmm', onTable(42, 0), 'DMM1');
    const r = setBoardModel(b.doc, 'bb1', 'MB-102');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fp = footprint(r.doc.parts[0])!;
    expect(overlaps(fp, boardRect(r.doc.breadboards[0]))).toBe(false);
    expect(r.warnings.join()).toContain('DMM1');
    const c = new Builder().part('motor', onTable(40, 0), 'M1');
    const r2 = setBoardModel(c.doc, 'bb1', 'MB-102');
    expect(r2.ok).toBe(false);
    expect(r2.ok ? '' : r2.errors.join()).toContain('M1');
  });
  it('บันทึก/เปิดไฟล์ MB-102 ได้ครบ · ไฟล์ CL-400 ที่อ้างรู a45 ถูกปฏิเสธพร้อมเหตุผล', () => {
    const b = new Builder().part('resistor', onBoard('a5'), 'R1');
    const r = addPart(mb(b.doc), 'resistor', onBoard('a45'), 'R2'); if (!r.ok) throw new Error();
    const text = serializeProject('t', r.doc, emptyWork());
    const back = parseProject(text);
    expect(back.ok).toBe(true);
    expect(back.file!.circuit).toEqual(r.doc);
    const bad = JSON.parse(text); bad.circuit.breadboards[0].model = 'CL-400';
    const res = parseProject(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/R2|a45/);
  });
});
