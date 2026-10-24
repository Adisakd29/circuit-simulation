import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfPin, netOfTerminal } from '../src/connectivity/connectivity';
import { addWire, insertPart, moveBoard, movePart } from '../src/editor/ops';
import { defaultPart } from '../src/model/catalog';
import { checkPlacement, checkWireEnd, footprint, holeWorld, tablePinXZ } from '../src/model/geometry';
import { emptyWork, type Part } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/storage';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

/**
 * วางอุปกรณ์อิสระบนโต๊ะ (ไม่ต้องอยู่บนเบรดบอร์ด) + ความถูกต้องของการเชื่อมต่อเมื่อย้ายเข้า/ออกบอร์ด
 * หลักการ: การเชื่อมต่อมาจาก "ขาในรู + สาย + การเชื่อมภายในบอร์ด" เท่านั้น — ระยะใกล้/การทับกันไม่สร้างการเชื่อมต่อ
 */

const R_TABLE = onTable(-6, 14); // ใต้บอร์ด (บอร์ดกว้าง z ±9.8)

describe('อุปกรณ์ชนิดเสียบบอร์ดวางบนโต๊ะได้', () => {
  it('ตัวต้านทาน LED ออปแอมป์ และ Pico วางบนโต๊ะผ่านการตรวจ', () => {
    const b = new Builder()
      .part('resistor', onTable(-6, 14), 'R1')
      .part('led', onTable(4, 14), 'D1')
      .part('opamp', onTable(10, 16), 'U1')
      .part('pico', onTable(-40, 4), 'PICO');
    expect(b.doc.parts.every((p) => p.placement.kind === 'table')).toBe(true);
  });

  it('ขาของอุปกรณ์บนโต๊ะคิดตำแหน่งจากขาที่ 1 + ระยะขา (หมุนได้)', () => {
    const r = defaultPart('resistor', 'R', 'R', { kind: 'table', x: 2, z: 20, rotation: 90 });
    const p1 = tablePinXZ(r, '1')!, p2 = tablePinXZ(r, '2')!;
    expect(p1).toEqual({ x: 2, z: 20 });
    expect(p2.x).toBe(2);
    expect(Math.abs(p2.z - 20)).toBe((r.params as { span: number }).span);
  });

  it('ขาบนโต๊ะไม่เชื่อมกับอะไรเลยจนกว่าจะต่อสาย — แม้วางชิดกัน', () => {
    const b = new Builder()
      .part('resistor', onTable(-6, 14), 'R1')
      .part('resistor', onTable(-6, 16), 'R2'); // ชิดกัน 2 หน่วย (5 mm) แต่ไม่ทับ
    const c = computeConnectivity(b.doc);
    const nets = new Set([netOfPin(c, 'R1', '1'), netOfPin(c, 'R1', '2'), netOfPin(c, 'R2', '1'), netOfPin(c, 'R2', '2')]);
    expect(nets.size).toBe(4);
  });

  it('วางทับอุปกรณ์อื่นหรือทับเบรดบอร์ดไม่ได้ (และไม่กลายเป็นการเชื่อมต่อ)', () => {
    const b = new Builder().part('resistor', R_TABLE, 'R1');
    const over = insertPart(b.doc, defaultPart('resistor', 'R2', 'R2', onTable(-5, 14)));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.join()).toMatch(/วางทับ R1/);
    const onBoardArea = insertPart(b.doc, defaultPart('resistor', 'R3', 'R3', onTable(0.3, 0.3)));
    expect(onBoardArea.ok).toBe(false);
    if (!onBoardArea.ok) expect(onBoardArea.errors.join()).toMatch(/ขาไม่ตรงรู/);
  });

  it('เครื่องมือ/แหล่งจ่ายยังเสียบลงบอร์ดไม่ได้', () => {
    const ps = defaultPart('dcsupply', 'PS', 'PS', onBoard('a5'));
    expect(checkPlacement({ ...new Builder().doc, parts: [ps] }, ps).ok).toBe(false);
  });
});

describe('ต่อสายจากอุปกรณ์นอกบอร์ดเข้าวงจร', () => {
  // แหล่งจ่าย 5 V → สาย → ตัวต้านทาน 1 kΩ ที่วางบนโต๊ะ → สาย → รูบนบอร์ด → สาย → ขั้วลบ
  const build = () => new Builder()
    .part('dcsupply', onTable(-30, 0), 'PS1', { voltage: 5 })
    .part('resistor', R_TABLE, 'R1', { resistance: 1000 })
    .wire(P('PS1', 'pos'), P('R1', '1'), 'w1')
    .wire(P('R1', '2'), H('a10'), 'w2')
    .wire(H('c10'), P('PS1', 'neg'), 'w3');

  it('สายเข้าขาตัวต้านทานบนโต๊ะ: เน็ตถูกต้อง', () => {
    const c = computeConnectivity(build().doc);
    expect(netOfPin(c, 'R1', '1')).toBe(netOfPin(c, 'PS1', 'pos'));
    expect(netOfPin(c, 'R1', '2')).toBe(netOfTerminal(c, H('e10')));
    expect(netOfPin(c, 'R1', '2')).toBe(netOfPin(c, 'PS1', 'neg'));
  });

  it('จำลอง DC: กระแส = 5 V / 1 kΩ', () => {
    const { analysis } = simulate(build().doc);
    expect(analysis.ok).toBe(true);
    expect(Math.abs(analysis.parts['R1'].current)).toBeCloseTo(5 / 1000, 4);
  });

  it('ขาเดียวรับสายได้หลายเส้น (เหมือนคีบปากจระเข้)', () => {
    const r = addWire(build().doc, P('R1', '1'), H('a20'), '#000000');
    expect(r.ok).toBe(true);
  });

  it('Pico วางข้างบอร์ด ต่อ GP15 เข้ารูบนบอร์ดด้วยสาย', () => {
    const b = new Builder()
      .part('pico', onTable(-40, 4), 'PICO')
      .part('resistor', onBoard('a20'), 'R1')
      .wire(P('PICO', 'GP15'), H('b20'), 'w1')
      .wire(P('PICO', 'GND'), H('tn5'), 'w2');
    const c = computeConnectivity(b.doc);
    expect(netOfPin(c, 'PICO', 'GP15')).toBe(netOfPin(c, 'R1', '1'));
    // GND หลายขาของ Pico เชื่อมกันภายในบอร์ด
    expect(netOfPin(c, 'PICO', 'GND.38')).toBe(netOfTerminal(c, H('tn30')));
  });
});

describe('ย้ายอุปกรณ์ระหว่างโต๊ะ ↔ บอร์ด', () => {
  it('โต๊ะ → บอร์ด: สายที่ต่อขาไว้ยังต่อขาเดิม และขาเชื่อมกับกลุ่มรูที่เสียบ', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-30, 0), 'PS1')
      .part('resistor', R_TABLE, 'R1')
      .wire(P('PS1', 'pos'), P('R1', '1'), 'w1');
    const r = movePart(b.doc, 'R1', onBoard('a12'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.wires.find((w) => w.id === 'w1')!.b).toEqual(P('R1', '1'));
    const c = computeConnectivity(r.doc);
    expect(netOfPin(c, 'PS1', 'pos')).toBe(netOfTerminal(c, H('e12')));
  });

  it('บอร์ด → โต๊ะ: สายที่เสียบรูยังอยู่ในรูเดิม แต่ไม่เชื่อมกับขาแล้ว', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-30, 0), 'PS1')
      .part('resistor', onBoard('a12'), 'R1')
      .wire(P('PS1', 'pos'), H('c12'), 'w1');
    const before = computeConnectivity(b.doc);
    expect(netOfPin(before, 'R1', '1')).toBe(netOfPin(before, 'PS1', 'pos'));
    const r = movePart(b.doc, 'R1', R_TABLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.wires.find((w) => w.id === 'w1')!.b).toEqual(H('c12'));
    const c = computeConnectivity(r.doc);
    expect(netOfPin(c, 'R1', '1')).not.toBe(netOfPin(c, 'PS1', 'pos'));
    expect(netOfTerminal(c, H('a12'))).toBe(netOfPin(c, 'PS1', 'pos'));
  });

  it('ย้ายไปมาแล้วกลับที่เดิม: การเชื่อมต่อเหมือนเดิมทุกประการ', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-30, 0), 'PS1')
      .part('resistor', onBoard('a12'), 'R1')
      .wire(P('PS1', 'pos'), H('c12'), 'w1')
      .wire(H('c16'), P('PS1', 'neg'), 'w2');
    const sig = (d: typeof b.doc) => { const c = computeConnectivity(d); return ['1', '2'].map((p) => netOfPin(c, 'R1', p) === netOfPin(c, 'PS1', p === '1' ? 'pos' : 'neg')); };
    const off = movePart(b.doc, 'R1', R_TABLE);
    if (!off.ok) throw new Error();
    expect(sig(off.doc)).toEqual([false, false]);
    const back = movePart(off.doc, 'R1', onBoard('a12'));
    if (!back.ok) throw new Error();
    expect(sig(back.doc)).toEqual([true, true]);
  });

  it('ยังห้ามสายใหม่ต่อเข้าขาที่เสียบบอร์ดอยู่ (ให้ใช้รูในกลุ่มเดียวกัน) แต่ขาบนโต๊ะต่อได้', () => {
    const b = new Builder().part('resistor', onBoard('a12'), 'R1').part('led', onTable(8, 14), 'D1');
    expect(checkWireEnd(b.doc, P('R1', '1'))).toMatch(/รูอื่นในกลุ่มเดียวกัน/);
    expect(checkWireEnd(b.doc, P('D1', 'A'))).toBeNull();
  });
});

describe('ย้ายเบรดบอร์ดทั้งแผ่น', () => {
  const b = new Builder()
    .part('dcsupply', onTable(-30, 0), 'PS1')
    .part('resistor', onBoard('a12'), 'R1')
    .wire(P('PS1', 'pos'), H('c12'), 'w1');

  it('อุปกรณ์และสายบนบอร์ดย้ายตาม การเชื่อมต่อไม่เปลี่ยน', () => {
    const r = moveBoard(b.doc, 'bb1', 6, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(holeWorld(r.doc.breadboards[0], 'a12')!.x - holeWorld(b.doc.breadboards[0], 'a12')!.x).toBe(6);
    const c0 = computeConnectivity(b.doc), c1 = computeConnectivity(r.doc);
    expect(netOfPin(c1, 'R1', '1') === netOfPin(c1, 'PS1', 'pos')).toBe(netOfPin(c0, 'R1', '1') === netOfPin(c0, 'PS1', 'pos'));
  });

  it('ย้ายทับเครื่องมือบนโต๊ะไม่ได้', () => {
    // แหล่งจ่ายขนาดจริงอยู่แถวหลังบอร์ด (ขอบหน้าที่ z = −40) → ย้ายบอร์ดถอยหลังไปทับ
    const r = moveBoard(b.doc, 'bb1', -40, -40);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/ทับ PS1/);
  });
});

describe('Save / Load เก็บตำแหน่งบนโต๊ะ บนบอร์ด และสายทุกเส้น', () => {
  it('ไฟล์รอบเดียวได้วงจรเดิมทุกอย่าง (รวมสายเข้าขาของอุปกรณ์ที่ย้ายลงบอร์ดแล้ว)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-30, 0), 'PS1')
      .part('resistor', R_TABLE, 'R1')
      .part('pico', onTable(-45, 24), 'PICO')
      .part('led', onBoard('a20'), 'D1')
      .wire(P('PS1', 'pos'), P('R1', '1'), 'w1')
      .wire(P('R1', '2'), H('b20'), 'w2')
      .wire(P('PICO', 'GP15'), H('b21'), 'w3');
    // ย้าย R1 ลงบอร์ดหลังต่อสายเข้าขาแล้ว → สาย w1 ต่อขาของอุปกรณ์บนบอร์ด (ต้องโหลดกลับได้)
    const moved = movePart(b.doc, 'R1', onBoard('f5'));
    if (!moved.ok) throw new Error(moved.errors.join());
    const moved2 = moveBoard(moved.doc, 'bb1', 2, -1);
    if (!moved2.ok) throw new Error(moved2.errors.join());
    const text = serializeProject('t', moved2.doc, emptyWork());
    const v = parseProject(text);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.file!.circuit).toEqual(moved2.doc);
  });

  it('ไฟล์ที่วางอุปกรณ์ทับกันบนโต๊ะถูกปฏิเสธพร้อมเหตุผล', () => {
    const b = new Builder().part('resistor', R_TABLE, 'R1');
    const bad = { ...b.doc, parts: [...b.doc.parts, { ...b.doc.parts[0], id: 'R2', label: 'R2' } as Part] };
    const v = parseProject(serializeProject('t', bad, emptyWork()));
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/วางทับ/);
  });

  it('footprint ของ Pico บนโต๊ะครอบ PCB (20 × 7 ช่องขา + ขอบ)', () => {
    const p = defaultPart('pico', 'P', 'P', onTable(0, 30));
    const f = footprint(p)!;
    expect(f.x1 - f.x0).toBeCloseTo(19 + 1.2, 5);
    expect(f.z1 - f.z0).toBeCloseTo(7 + 1.2, 5);
  });
});
