import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { schematicSvg, type Item, type Pt } from '../src/lessons/schematic';

/** จุดปลายของสาย/อุปกรณ์สองขา (ใช้ตรวจว่าทุกอย่างอยู่บนกริด 5 px และอุปกรณ์สองขาวางแนวตรง) */
const ends = (it: Item): Pt[] => (it.t === 'w' ? it.p : it.t === '2' || it.t === 'pot' ? [it.a, it.b] : []);

describe('รูปวงจรของแลป', () => {
  it('ทุกแลปมีรูปวงจร และไม่มีรูปที่ไม่ได้ใช้', () => {
    for (const l of LESSONS) expect(SCHEMATICS[l.id], l.id).toBeTruthy();
    expect(Object.keys(SCHEMATICS).sort()).toEqual(LESSONS.map((l) => l.id).sort());
  });
  for (const l of LESSONS) {
    it(`แลป ${l.number} ${l.id}: SVG ถูกต้อง อุปกรณ์สองขาวางแนวนอน/ตั้ง จุดต่ออยู่บนกริด`, () => {
      const s = SCHEMATICS[l.id];
      const svg = schematicSvg(s, l.title);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined/);
      // แท็กเปิด/ปิดสมดุล (พอเป็น XML ได้)
      expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
      for (const it of s.items) {
        for (const [x, y] of ends(it)) { expect(Math.abs(x % 5), `${l.id} x=${x}`).toBeLessThan(1e-9); expect(Math.abs(y % 5), `${l.id} y=${y}`).toBeLessThan(1e-9); }
        if (it.t === '2' || it.t === 'pot') {
          const horiz = it.a[1] === it.b[1], vert = it.a[0] === it.b[0];
          const diag = it.t === '2' && it.k === 'D' && l.id === 'psu'; // ไดโอดบริดจ์วาดแนวทแยงตามแบบทั่วไป
          expect(horiz || vert || diag, `${l.id}: อุปกรณ์ ${it.t === '2' ? it.k : 'pot'} ${JSON.stringify(it.a)}→${JSON.stringify(it.b)}`).toBe(true);
          expect(Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]), `${l.id}: ยาวพอใส่สัญลักษณ์`).toBeGreaterThanOrEqual(40);
        }
        if (it.t === 'w') for (let k = 1; k < it.p.length; k++) {
          const [a, b] = [it.p[k - 1], it.p[k]];
          expect(a[0] === b[0] || a[1] === b[1], `${l.id}: สายแนวทแยง ${JSON.stringify(a)}→${JSON.stringify(b)}`).toBe(true);
        }
      }
    });
  }
});
