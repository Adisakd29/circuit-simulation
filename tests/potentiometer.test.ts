import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultPart } from '../src/model/catalog';
import type { Part } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);

/** VR1 ที่ e10 (ขา 1 e10, ขา 2 e11, ขา 3 e12): ขา 1 → +5 V, ขา 3 → กราวด์, (โหลด) RL จากขา 2 ลงกราวด์ */
function divider(position: number, opts: { R?: number; load?: number; vs?: number } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: opts.vs ?? 5, currentLimit: 1 })
    .part('potentiometer', onBoard('e10'), 'VR1', { resistance: opts.R ?? 10000, position })
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
    .wire(H('a10'), H('tp10')).wire(H('a12'), H('tn12'));
  if (opts.load) b.part('resistor', onBoard('tn20', 90), 'RL', { resistance: opts.load, span: 2 }).wire(H('b11'), H('b20'));
  return b;
}

describe('ตัวต้านทานปรับค่าได้ (VR) ในวงจร', () => {
  it('วงแบ่งแรงดันไม่มีโหลด: V(ขา 2) = Vs·(R(1−p) + Rend)/(R + 2Rend) ทุกตำแหน่ง', () => {
    for (const p of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      const { analysis } = simulate(divider(p).doc);
      const r = analysis.parts['VR1'];
      const vs = r.extra!.v13;
      const ref = vs * (10000 * (1 - p) + 3) / (10000 + 6);
      expect(Math.abs(r.extra!.v23 - ref)).toBeLessThan(1e-7);
      expect(Math.abs(vs - 5)).toBeLessThan(0.01); // Rint ของแหล่งจ่าย
      expect(Math.abs(r.extra!.iw)).toBeLessThan(1e-4 * r.extra!.i1); // ความละเอียดของ solver (ส่วน 3 Ω ที่ปลาย)
      expect(rel(r.extra!.i1, vs / 10006)).toBeLessThan(1e-6);
    }
  });
  it('มีโหลด 1 kΩ ที่ขาแกนกลาง: แรงดันตกลงตามสูตรวงแบ่งที่มีโหลด (loading effect)', () => {
    const p = 0.5, R = 10000, re = 3, RL = 1000;
    const { analysis } = simulate(divider(p, { load: RL }).doc);
    const r = analysis.parts['VR1'];
    const vs = r.extra!.v13;
    const Ra = R * p + re, Rb = R * (1 - p) + re, Rp = (Rb * RL) / (Rb + RL);
    expect(rel(r.extra!.v23, (vs * Rp) / (Ra + Rp))).toBeLessThan(1e-9);
    expect(r.extra!.v23).toBeLessThan(0.75); // ไม่มีโหลด ≈ 2.5 V → 5 V·833 Ω/(5003 + 833) Ω ≈ 0.71 V
    expect(rel(-r.extra!.iw, r.extra!.v23 / RL)).toBeLessThan(1e-6); // กระแสออกทางแกนกลาง = กระแสโหลด
  });
  it('ต่อแกนกลางลงกราวด์ตรงแล้วหมุนเกือบสุด → เกินพิกัดของส่วนที่ใช้ (แจ้งอันตราย)', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
      .part('potentiometer', onBoard('e10'), 'VR1', { resistance: 1000, position: 0.02 })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
      .wire(H('a10'), H('tp10')).wire(H('a11'), H('tn11'));
    const { analysis } = simulate(b.doc);
    expect(analysis.parts['VR1'].overRated).toBe(true);
    expect(analysis.diagnostics.some((d) => d.partId === 'VR1' && d.severity === 'danger' && d.message.includes('1–2'))).toBe(true);
    // ตำแหน่งกลาง (500 Ω, 50 mW < 250 mW) ไม่เตือน
    const ok = simulate(new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
      .part('potentiometer', onBoard('e10'), 'VR1', { resistance: 1000, position: 0.5 })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
      .wire(H('a10'), H('tp10')).wire(H('a11'), H('tn11')).doc).analysis;
    expect(ok.parts['VR1'].overRated).toBeFalsy();
  });
  it('บันทึก/เปิดไฟล์ได้ครบ และไฟล์ schema 10 เดิมยังเปิดได้', () => {
    const doc = divider(0.37).doc;
    const v = parseProject(serializeProject('vr', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 10;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
    const bad = JSON.parse(serializeProject('b', doc, emptyWork()));
    bad.circuit.parts.find((p: Part) => p.kind === 'potentiometer').params.position = 1.5;
    expect(parseProject(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('โมเดล 3 มิติ 3296W', () => {
  it('ขนาดตัวถัง 9.53 × 4.83 mm สูงรวม 10.03 mm และร่องสกรูหมุนตามตำแหน่ง (25 รอบ)', async () => {
    const { buildPartModel } = await import('../src/render/models');
    const { potCode, potScrewAngle } = await import('../src/render/board-parts');
    const mk = (position: number) => buildPartModel({ ...defaultPart('potentiometer', 'V', 'V', { kind: 'board', boardId: 'bb1', anchor: 'a5', rotation: 0 }), params: { resistance: 10000, position, endResistance: 3, powerRating: 0.5 } } as Part);
    const g = mk(0.5);
    g.updateMatrixWorld(true);
    let box: THREE.Box3 | null = null;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.leadTip && !o.parent?.parent?.userData?.lead && (o as THREE.Mesh).geometry.type !== 'TubeGeometry' && (o as THREE.Mesh).geometry.type !== 'CylinderGeometry' || o.parent?.userData.potScrew) { const b = new THREE.Box3().setFromObject(o); box = box ? box.union(b) : b; } });
    const bb = box! as THREE.Box3;
    expect((bb.max.x - bb.min.x) / (1 / 2.54)).toBeCloseTo(9.53, 1);
    expect((bb.max.z - bb.min.z) / (1 / 2.54)).toBeCloseTo(4.83, 1);
    expect(bb.max.y / (1 / 2.54)).toBeCloseTo(10.03, 1);
    const ang = (gg: THREE.Group) => { let a = NaN; gg.traverse((o) => { if (o.userData.potScrew) a = o.rotation.y; }); return a; };
    expect(ang(mk(0.25))).toBeCloseTo(potScrewAngle(0.25), 9);
    expect(potScrewAngle(1) - potScrewAngle(0)).toBeCloseTo(-25 * 2 * Math.PI, 9);
    expect([potCode(1000), potCode(5000), potCode(10000), potCode(50000), potCode(100000), potCode(470)]).toEqual(['102', '502', '103', '503', '104', '471']);
  });
});

import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { buildNetlist } from '../src/sim/netlist';

describe('แลป 15: VR เป็นวงแบ่งแรงดัน', () => {
  const lesson = (b: Builder, achieved: Record<string, boolean> = {}) => {
    const { analysis, result } = simulate(b.doc);
    const work = emptyWork(); work.achieved = { pot: achieved };
    return checkLesson('pot', { doc: b.doc, built: buildNetlist(b.doc), result, analysis, work });
  };
  const withProbe = (b: Builder) => b.probe(H('c11'), H('tn26'));
  it('บทเรียนมีอยู่ เป้าหมายครบ', () => {
    const l = LESSONS.find((x) => x.id === 'pot')!;
    expect(l.number).toBe(15);
    expect(l.goals.map((g) => g.id)).toEqual(['wiring', 'probe', 'linear', 'sweep', 'load']);
  });
  it('ต่อถูก + โพรบที่แกนกลาง: linear ผ่าน, หมุนครบ 3 ช่วง (จำค่าที่เคยผ่าน) → sweep ผ่าน', () => {
    const ach: Record<string, boolean> = {};
    for (const p of [0.85, 0.5, 0.1]) { // ขา 1 ที่ +5 V → ส่วนล่าง = R(1 − p): สูง/กลาง/ต่ำ = 0.15/0.5/0.9
      const st = lesson(withProbe(divider(p)), ach);
      for (const k of ['wiring', 'probe', 'linear']) expect(st[k].pass, `${p} ${k}: ${st[k].detail}`).toBe(true);
      for (const [k, v] of Object.entries(st)) if (v.pass) ach[k] = true;
    }
    expect(ach.sweep).toBe(true);
  });
  it('ต่อโหลด 1 kΩ: load ผ่าน (แรงดันตกตามสูตร)', () => {
    const st = lesson(withProbe(divider(0.5, { load: 1000 })));
    expect(st.load.pass, st.load.detail).toBe(true);
    expect(st.linear.pass).toBe(false);
  });
  it('โพรบที่ขาปลาย → ข้อ probe ไม่ผ่าน; แกนกลางลงรางไฟ → wiring ไม่ผ่าน', () => {
    expect(lesson(divider(0.5).probe(H('c10'), H('tn26'))).probe.pass).toBe(false);
    const bad = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
      .part('potentiometer', onBoard('e10'), 'VR1')
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
      .wire(H('a10'), H('tp10')).wire(H('a11'), H('tn11'));
    const st = lesson(bad);
    expect(st.wiring.pass).toBe(false);
    expect(st.wiring.detail).toMatch(/ขา 2|แกนกลาง/);
  });
});
