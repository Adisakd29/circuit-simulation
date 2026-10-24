import { describe, expect, it } from 'vitest';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { emptyWork, type StudentWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

function check(lesson: string, b: Builder, work: StudentWork = emptyWork()) {
  const s = simulate(b.doc);
  return checkLesson(lesson, { doc: b.doc, built: s.built, result: s.result, analysis: s.analysis, work });
}

describe('ข้อมูลแลปครบองค์ประกอบ', () => {
  it('มีอย่างน้อย 5 บท และทุกบทมีครบทุกหัวข้อ', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(5);
    for (const l of LESSONS) {
      for (const k of ['objectives', 'background', 'predictions', 'equipment', 'steps', 'table', 'hints', 'summary', 'goals'] as const) {
        expect((l[k] as unknown[]).length, `${l.id}.${k}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('แลป 1 เบรดบอร์ด', () => {
  it('ผ่านเมื่อต่อรางไฟ วัดราง และทดสอบร่องกลาง (ตำแหน่งใดก็ได้)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
      .probe(H('tp30'), H('tn29'));
    let r = check('breadboard', b);
    expect(r.rails.pass).toBe(true);
    expect(r.measureRail.pass).toBe(true);
    expect(r.groove.pass).toBe(false);
    b.wire(H('tp14'), H('a14')).probe(H('j14'), H('tn20'));
    r = check('breadboard', b);
    expect(r.groove.pass).toBe(true);
  });
});

describe('แลป 2 กฎของโอห์ม', () => {
  it('ตัวต้านทานที่ขาลัดกันในแถบเดียว → ไม่ผ่าน (ตรวจจากการเชื่อมต่อจริง)', () => {
    const bb = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ammeter', onTable(-25, 12), 'A1')
      .part('resistor', onBoard('a20', 90), 'R1', { span: 3 })
      .wire(P('PS1', 'pos'), P('A1', 'A')).wire(P('A1', 'COM'), H('e20')).wire(H('tn20'), P('PS1', 'neg'));
    expect(check('ohm', bb).ohm.pass).toBe(false);
  });
  it('ผ่านเมื่อแอมมิเตอร์อนุกรมกับ R ไม่ว่าจะวางตำแหน่งใด', () => {
    const bb = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 3 })
      .part('ammeter', onTable(25, 12), 'A1')
      .part('resistor', onBoard('j3'), 'R1', { resistance: 470 })
      .wire(P('PS1', 'pos'), H('f3')).wire(H('f7'), P('A1', 'A')).wire(P('A1', 'COM'), P('PS1', 'neg'));
    const r = check('ohm', bb);
    expect(r.series.pass).toBe(true);
    expect(r.ohm.pass).toBe(true);
    expect(r.three.pass).toBe(false);
  });
});

describe('แลป 3 อนุกรม/ขนาน', () => {
  it('อนุกรมผ่าน ขนานไม่ผ่าน และกลับกัน', () => {
    const series = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ammeter', onTable(-25, 12), 'A1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('resistor', onBoard('b9'), 'R2', { resistance: 2200 })
      .wire(P('PS1', 'pos'), P('A1', 'A')).wire(P('A1', 'COM'), H('c5')).wire(H('c13'), P('PS1', 'neg'));
    let r = check('series-parallel', series);
    expect(r.series.pass).toBe(true);
    expect(r.parallel.pass).toBe(false);
    const par = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ammeter', onTable(-25, 12), 'A1')
      .part('resistor', onBoard('a5'), 'R1')
      .part('resistor', onBoard('b5'), 'R2')
      .wire(P('PS1', 'pos'), P('A1', 'A')).wire(P('A1', 'COM'), H('c5')).wire(H('c9'), P('PS1', 'neg'));
    r = check('series-parallel', par);
    expect(r.series.pass).toBe(false);
    expect(r.parallel.pass).toBe(true);
  });
});

describe('แลป 4 แบ่งแรงดัน', () => {
  it('ผ่านเมื่อวัดคร่อม R ตัวล่าง และท้าทาย 3.3 V', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1', { resistance: 1000 })
      .part('resistor', onBoard('b9'), 'R2', { resistance: 2000 })
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c13'), P('PS1', 'neg'))
      .probe(H('d9'), H('d13'));
    const r = check('divider', b);
    expect(r.series.pass).toBe(true);
    expect(r.measure.pass).toBe(true);
    expect(r.design.pass).toBe(true); // 5·2/3 = 3.333 V อยู่ใน ±3%
  });
});

describe('แลป 5 LED', () => {
  it('220 Ω กับ LED แดงที่ 5 V ผ่าน, ไม่มี R ไม่ผ่าน', () => {
    const good = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('ammeter', onTable(-25, 12), 'A1')
      .part('resistor', onBoard('a5'), 'R1', { resistance: 220 })
      .part('led', onBoard('b9'), 'LED1')
      .wire(P('PS1', 'pos'), P('A1', 'A')).wire(P('A1', 'COM'), H('c5')).wire(H('c10'), P('PS1', 'neg'));
    const r = check('led', good);
    expect(r.forward.pass && r.resistor.pass && r.meter.pass).toBe(true);
    const bad = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('led', onBoard('b9'), 'LED1')
      .wire(P('PS1', 'pos'), H('c9')).wire(H('c10'), P('PS1', 'neg'));
    expect(check('led', bad).forward.pass).toBe(false);
  });
});
