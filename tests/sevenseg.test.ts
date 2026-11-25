import { describe, expect, it } from 'vitest';
import { decodeSegments, sevenSegParamsFor } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { buildNetlist } from '../src/sim/netlist';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

/** DS1 ที่ h20: ขา 1 E h20, 2 D h21, 3 COM h22, 4 C h23, 5 DP h24 · 6 B d24, 7 A d23, 8 COM d22, 9 F d21, 10 G d20 */
function one(opts: { common?: 'cc' | 'ca'; noResistor?: boolean; comTo?: 'neg' | 'pos' } = {}) {
  const common = opts.common ?? 'cc';
  const comTo = opts.comTo ?? (common === 'cc' ? 'neg' : 'pos');
  const segFrom = common === 'cc' ? 'pos' : 'neg';
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
    .part('sevenseg', onBoard('h20'), 'DS1', sevenSegParamsFor(common))
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
    .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('j22'), H(comTo === 'neg' ? 'bn22' : 'bp22'));
  const top = segFrom === 'pos' ? 'tp' : 'tn', bot = segFrom === 'pos' ? 'bp' : 'bn';
  if (opts.noResistor) b.wire(H('a24'), H(`${top}24`)).wire(H('j23'), H(`${bot}23`)); // B, C ต่อตรง
  else b.part('resistor', onBoard(`${top}24`, 90), 'RB', { resistance: 330, span: 3 }) // → a24 (B)
    .part('resistor', onBoard('i14'), 'RC', { resistance: 330, span: 9 }) // i14–i23 (C)
    .wire(H('j14'), H(`${bot}14`));
  return b;
}
const lesson = (b: Builder) => {
  const { analysis, result } = simulate(b.doc);
  return { analysis, st: checkLesson('sevenseg', { doc: b.doc, built: buildNetlist(b.doc), result, analysis, work: emptyWork() }) };
};

describe('ตัวแสดงผล 7 ส่วน 0.56"', () => {
  it('ตำแหน่งขาคร่อมร่อง: ขา 1–5 แถว h, ขา 6–10 แถว d (ขา 6 ตรงข้ามขา 5)', () => {
    const ph = pinHolesFor(one().doc.parts.find((p) => p.id === 'DS1')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ 1: 'h20', 2: 'h21', 3: 'h22', 4: 'h23', 5: 'h24', 6: 'd24', 7: 'd23', 8: 'd22', 9: 'd21', 10: 'd20' });
  });
  it('ถอดรหัสตัวเลข 0–9', () => {
    const pat = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];
    pat.forEach((p, d) => expect(decodeSegments(Object.fromEntries('abcdefg'.split('').map((s, i) => [s, p[i] === '1'])))).toBe(String(d)));
  });
  it('แคโทดร่วม + 330 Ω ที่ B และ C: แสดง "1" กระแสต่อส่วน = (5 − Vf)/330 และผ่านบทเรียน', () => {
    const { analysis, st } = lesson(one());
    const x = analysis.parts['DS1'].extra!;
    expect(String.fromCharCode(x.digit)).toBe('1');
    expect(x.i_a).toBeLessThan(1e-6);
    expect(x.i_b).toBeGreaterThan(8e-3);
    expect(x.i_b).toBeLessThan(10e-3);
    expect(analysis.diagnostics.filter((d) => d.partId === 'DS1')).toEqual([]);
    for (const k of ['common', 'resistor', 'digit']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
  });
  it('ต่อส่วนตรงเข้า 5 V ไม่มีตัวต้านทาน → เกินพิกัด และข้อ resistor ไม่ผ่าน', () => {
    const { analysis, st } = lesson(one({ noResistor: true }));
    expect(analysis.parts['DS1'].overRated).toBe(true);
    expect(st.resistor.pass).toBe(false);
  });
  it('แอโนดร่วม: ขาร่วมต่อบวก ดึงขาส่วนลงลบผ่านตัวต้านทาน → แสดง "1"', () => {
    const { analysis, st } = lesson(one({ common: 'ca' }));
    expect(String.fromCharCode(analysis.parts['DS1'].extra!.digit)).toBe('1');
    expect(st.common.pass).toBe(true);
  });
  it('ชนิดไม่ตรงการต่อ (แคโทดร่วมแต่ขาร่วมต่อบวก) → ไม่ติด, แจ้งข้อแนะนำ, ข้อ common ไม่ผ่าน', () => {
    const { analysis, st } = lesson(one({ common: 'cc', comTo: 'pos' }));
    expect(analysis.parts['DS1'].current).toBeLessThan(1e-6);
    expect(st.common.pass).toBe(false);
  });
  it('บทเรียนมีอยู่ + บันทึก/เปิดไฟล์ + schema 14', () => {
    const l = LESSONS.find((x) => x.id === 'sevenseg')!;
    expect(l.number).toBe(18);
    const doc = one().doc;
    const v = parseProject(serializeProject('ss', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 14;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});
