import { describe, expect, it } from 'vitest';
import { computeConnectivity } from '../src/connectivity/connectivity';
import { History } from '../src/editor/history';
import { addPart, addWire, deletePart, deleteWire, movePart, setPartParams } from '../src/editor/ops';
import { validateProjectFile } from '../src/model/schema';
import { emptyCircuit, emptyWork, type CircuitDoc } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/storage';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

/** ลายนิ้วมือการเชื่อมต่อ: กลุ่มของขา/ขั้วที่อยู่เน็ตเดียวกัน (ไม่ขึ้นกับหมายเลขเน็ต) */
function fingerprint(doc: CircuitDoc): string {
  const c = computeConnectivity(doc);
  return c.nets
    .map((n) => n.partPins.map((p) => `${p.partId}:${p.pin}`).sort().join(','))
    .filter((s) => s.length)
    .sort()
    .join(' | ');
}

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe('การวางอุปกรณ์', () => {
  it('ห้ามวางขาซ้ำรูที่มีขาอื่นอยู่', () => {
    const b = new Builder().part('resistor', onBoard('a5'), 'R1');
    const r = addPart(b.doc, 'resistor', onBoard('a9'));
    expect(r.ok).toBe(false);
  });
  it('ห้ามวางขาตกร่องกลาง', () => {
    const r = addPart(emptyCircuit(), 'resistor', onBoard('c5', 90)); // c→g? y5+4=9 = ร่อง
    expect(r.ok).toBe(false);
  });
  it('เตือนเมื่อขาทั้งสองอยู่กลุ่มเดียวกัน', () => {
    const r = ok(addPart(emptyCircuit(), 'led', onBoard('a5', 90))); // a5 → b5
    expect(r.warnings.join()).toContain('ลัดวงจร');
  });
  it('ห้ามแหล่งจ่ายวางทับเบรดบอร์ด', () => {
    expect(addPart(emptyCircuit(), 'dcsupply', onTable(0, 0)).ok).toBe(false);
  });
  it('ห้ามเสียบปลายสายในรูที่มีขาอุปกรณ์', () => {
    const b = new Builder().part('resistor', onBoard('a5'), 'R1');
    expect(addWire(b.doc, H('a5'), H('a20')).ok).toBe(false);
  });
});

describe('Undo/Redo รักษาการเชื่อมต่อ', () => {
  it('ย้อนกลับ/ทำซ้ำ การวาง การต่อสาย การแก้ค่า การย้าย และการลบ', () => {
    const h = new History(emptyCircuit());
    const fps: string[] = [fingerprint(h.doc)];
    const step = (doc: CircuitDoc, label: string) => { h.commit(doc, label); fps.push(fingerprint(h.doc)); };
    step(ok(addPart(h.doc, 'dcsupply', onTable(-40, -102), 'PS1')).doc, 'วางแหล่งจ่าย'); // ขนาดจริง: แถวหลังบอร์ด
    step(ok(addPart(h.doc, 'resistor', onBoard('a10'), 'R1')).doc, 'วาง R');
    step(ok(addWire(h.doc, P('PS1', 'pos'), H('b10'), '#e53935', 'w1')).doc, 'สาย 1');
    step(ok(addWire(h.doc, H('b14'), P('PS1', 'neg'), '#212121', 'w2')).doc, 'สาย 2');
    const I0 = simulate(h.doc).analysis.parts['R1'].current;
    step(ok(setPartParams(h.doc, 'R1', { resistance: 2000 })).doc, 'แก้ค่า R');
    expect(simulate(h.doc).analysis.parts['R1'].current).toBeCloseTo(I0 / 2, 6);
    step(ok(movePart(h.doc, 'R1', onBoard('a11'))).doc, 'ย้าย R'); // ขา 1 ออกจากคอลัมน์ 10 → เปิดวงจร
    expect(Math.abs(simulate(h.doc).analysis.parts['R1'].current)).toBeLessThan(1e-9);
    step(ok(deleteWire(h.doc, 'w1')).doc, 'ลบสาย');
    step(ok(deletePart(h.doc, 'PS1')).doc, 'ลบแหล่งจ่าย');
    expect(h.doc.wires.length).toBe(0); // สายที่เกาะ PS1 ถูกลบด้วย

    for (let i = fps.length - 2; i >= 0; i--) { h.undo(); expect(fingerprint(h.doc)).toBe(fps[i]); }
    expect(h.canUndo).toBe(false);
    for (let i = 1; i < fps.length; i++) { h.redo(); expect(fingerprint(h.doc)).toBe(fps[i]); }
    // ย้อนกลับไปหลังแก้ค่า → ค่าพารามิเตอร์กลับมา
    h.undo(); h.undo(); h.undo();
    const r1 = h.doc.parts.find((p) => p.id === 'R1')!;
    expect(r1.kind === 'resistor' && r1.params.resistance).toBe(2000);
    h.undo();
    const r1b = h.doc.parts.find((p) => p.id === 'R1')!;
    expect(r1b.kind === 'resistor' && r1b.params.resistance).toBe(1000);
  });
});

describe('Save/Load', () => {
  const doc = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 7.5 })
    .part('ammeter', onTable(-25, 12), 'A1')
    .part('resistor', onBoard('a10'), 'R1', { resistance: 470 })
    .part('led', onBoard('b14', 0), 'LED1', { color: 'green' })
    .wire(P('PS1', 'pos'), P('A1', 'A'), 'w0')
    .wire(P('A1', 'COM'), H('c10'), 'w1')
    .wire(H('c15'), P('PS1', 'neg'), 'w2')
    .probe(H('d10'), H('d15')).doc;

  it('เปิดไฟล์กลับมาแล้วตำแหน่ง ค่า และการเชื่อมต่อเหมือนเดิม และผลจำลองเท่าเดิม', () => {
    const work = { ...emptyWork(), lessonId: 'ohm', answers: { ohm: { q1: 'ทดสอบ' } } };
    const text = serializeProject('งานทดสอบ', doc, work);
    const v = parseProject(text);
    expect(v.ok).toBe(true);
    expect(v.file!.circuit).toEqual(doc);
    expect(v.file!.studentWork.answers.ohm.q1).toBe('ทดสอบ');
    expect(fingerprint(v.file!.circuit)).toBe(fingerprint(doc));
    expect(simulate(v.file!.circuit).analysis.probe.value).toBeCloseTo(simulate(doc).analysis.probe.value!, 12);
  });

  it('ปฏิเสธไฟล์ที่ไม่ถูกต้องพร้อมเหตุผล', () => {
    expect(parseProject('{ไม่ใช่ json').ok).toBe(false);
    expect(validateProjectFile({ format: 'other' }).ok).toBe(false);
    const f = JSON.parse(serializeProject('x', doc, emptyWork()));
    f.schemaVersion = 99;
    expect(validateProjectFile(f).errors[0]).toContain('รุ่นใหม่กว่า');
    const g = JSON.parse(serializeProject('x', doc, emptyWork()));
    g.circuit.wires[1].b = { kind: 'hole', boardId: 'bb1', hole: 'z99' };
    expect(validateProjectFile(g).ok).toBe(false);
    const h = JSON.parse(serializeProject('x', doc, emptyWork()));
    h.circuit.parts[2].params.resistance = -5;
    expect(validateProjectFile(h).ok).toBe(false);
    const k = JSON.parse(serializeProject('x', doc, emptyWork()));
    k.circuit.parts[3].placement.anchor = 'a10'; // ชนกับ R1
    const vk = validateProjectFile(k);
    expect(vk.ok).toBe(false);
    expect(vk.errors.join()).toContain('เสียบอยู่แล้ว');
  });
});
