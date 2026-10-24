import { describe, expect, it } from 'vitest';
import { computeConnectivity, netOfTerminal } from '../src/connectivity/connectivity';
import { allHoles, groupHoles, holeInfo, railHasColumn } from '../src/model/breadboard';
import { Builder, H, P, onBoard, onTable } from './helpers';

describe('เบรดบอร์ด CL-400: การเชื่อมต่อภายใน', () => {
  it('มี 400 รู (300 รูพื้นที่หลัก + 100 รูรางไฟ)', () => {
    const holes = allHoles();
    expect(holes.length).toBe(400);
    expect(holes.filter((h) => /^[a-j]\d+$/.test(h.name)).length).toBe(300);
    expect([...Array(30)].map((_, i) => i + 1).filter((x) => railHasColumn(x)).length).toBe(25);
  });

  it('a–e คอลัมน์เดียวกันอยู่กลุ่มเดียวกัน, f–j แยกกลุ่ม', () => {
    expect(groupHoles('col12-top').sort()).toEqual(['a12', 'b12', 'c12', 'd12', 'e12']);
    expect(holeInfo('e12')!.group).not.toBe(holeInfo('f12')!.group);
    expect(holeInfo('a12')!.group).not.toBe(holeInfo('a13')!.group);
  });

  it('รางไฟ T+ ต่อเนื่องทั้งเส้น แต่ T+ บนกับ B+ ล่างไม่เชื่อมกัน', () => {
    expect(holeInfo('tp2')!.group).toBe(holeInfo('tp30')!.group);
    expect(holeInfo('tp2')!.group).not.toBe(holeInfo('bp2')!.group);
    expect(holeInfo('tp2')!.group).not.toBe(holeInfo('tn2')!.group);
  });
});

describe('connectivity จากขา + สาย + การเชื่อมภายในบอร์ด', () => {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1')
    .wire(P('PS1', 'pos'), H('a5'), 'w1')
    .wire(H('c5'), H('tp8'), 'w2') // สายในแถบเดียวกับ w1 → ต้องเชื่อม
    .wire(H('f5'), H('bp8'), 'w3'); // อีกฝั่งร่อง → ต้องแยก
  const c = computeConnectivity(b.doc);

  it('สายที่เสียบในกลุ่มรูเดียวกันเชื่อมถึงกัน', () => {
    expect(netOfTerminal(c, P('PS1', 'pos'))).toBe(netOfTerminal(c, H('tp30')));
    expect(netOfTerminal(c, H('e5'))).toBe(netOfTerminal(c, P('PS1', 'pos')));
  });

  it('คนละฝั่งร่องกลางแยกกัน', () => {
    expect(netOfTerminal(c, H('f5'))).not.toBe(netOfTerminal(c, H('e5')));
    expect(netOfTerminal(c, H('bp20'))).toBe(netOfTerminal(c, H('j5')));
    expect(netOfTerminal(c, H('bp20'))).not.toBe(netOfTerminal(c, H('tp20')));
  });

  it('ขาอุปกรณ์เชื่อมกับเน็ตของรูที่เสียบ ไม่ขึ้นกับตำแหน่ง 3 มิติ', () => {
    const b2 = new Builder().part('resistor', onBoard('b20'), 'R1');
    const c2 = computeConnectivity(b2.doc);
    expect(c2.netOf.get('R1:1')).toBe(netOfTerminal(c2, H('e20')));
    expect(c2.netOf.get('R1:2')).toBe(netOfTerminal(c2, H('a24')));
    expect(c2.netOf.get('R1:1')).not.toBe(c2.netOf.get('R1:2'));
  });

  it('หมุนอุปกรณ์ 90° ข้ามร่องกลาง: ขาอยู่คนละกลุ่ม', () => {
    const b3 = new Builder().part('resistor', onBoard('c10', 90), 'R1', { span: 9 }); // c10 → j10
    const c3 = computeConnectivity(b3.doc);
    expect(c3.netOf.get('R1:2')).toBe(netOfTerminal(c3, H('f10')));
  });
});
