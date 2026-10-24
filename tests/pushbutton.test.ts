import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultPart } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import type { Part } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { History } from '../src/editor/history';
import { setPartParams } from '../src/editor/ops';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

/** SW1 ที่ f10: ขา 1 f10, 2 e10, 3 f12, 4 e12 · +5 V → 330 Ω → ขา 2 (ผ่านภายในถึงขา 1) · ขา 3 → LED → กราวด์ */
function circuit(pressed: boolean, rot: 0 | 90 = 0) {
  return new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 })
    .part('pushbutton', onBoard('f10', rot), 'SW1', { pressed })
    .part('resistor', onBoard('tp4', 90), 'R1', { resistance: 330, span: 3 }) // tp4 → a4
    .part('led', onBoard('i16'), 'LED1') // A i16 K i17
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('b4'), H('b10')).wire(H('j12'), H('j16')).wire(H('j17'), H('bn17'));
}

describe('ปุ่มกด 6 × 6 mm', () => {
  it('วางคร่อมร่อง: ขา 1/3 แถว f ขา 2/4 แถว e (ระยะ 5.08 × 7.62 mm)', () => {
    const b = circuit(false);
    const ph = pinHolesFor(b.doc.parts.find((p) => p.id === 'SW1')!);
    expect(Object.fromEntries(ph.map((x) => [x.pin, x.hole]))).toEqual({ 1: 'f10', 2: 'e10', 3: 'f12', 4: 'e12' });
  });
  it('ปล่อย: LED ดับ แรงดันเกือบทั้งหมดคร่อมปุ่ม · กด: LED ติด I = (5 − Vled − I·Rc)/330', () => {
    const off = simulate(circuit(false).doc).analysis;
    expect(Math.abs(off.parts['LED1'].current)).toBeLessThan(1e-6);
    expect(off.parts['SW1'].extra!.pressed).toBe(0);
    expect(off.parts['SW1'].voltage).toBeGreaterThan(2.5); // ขา 1 ≈ 5 V, ขา 3 ≈ ต่ำ (LED ไม่นำ)
    const on = simulate(circuit(true).doc).analysis;
    const I = on.parts['LED1'].current;
    expect(I).toBeGreaterThan(5e-3);
    expect(Math.abs(on.parts['SW1'].current - I) / I).toBeLessThan(1e-6);
    const vs = 5 - on.parts['LED1'].voltage;
    expect(Math.abs(I - vs / (330 + 0.1 + 0.002 + 0.01)) / I).toBeLessThan(2e-3); // + Rint ของแหล่งจ่าย
    expect(on.diagnostics.filter((d) => d.partId === 'SW1')).toEqual([]);
  });
  it('ขาคู่ที่คร่อมร่อง (1–2) ต่อถึงกันภายในเสมอ แม้ไม่กด', () => {
    const { result, built } = simulate(circuit(false).doc);
    const c = built.connectivity;
    const v = (pin: string) => result.nodeVoltage[c.netOf.get(`SW1:${pin}`)!]!;
    expect(Math.abs(v('1') - v('2'))).toBeLessThan(1e-6);
  });
  it('หมุน 90°: ขา 1 กับ 3 อยู่กลุ่มเดียวกัน → เตือนว่าปุ่มถูกลัดตลอด', () => {
    let doc;
    doc = circuit(false, 90).doc;
    const { analysis } = simulate(doc);
    expect(analysis.diagnostics.some((d) => d.partId === 'SW1' && d.message.includes('ลัด'))).toBe(true);
  });
  it('กระแสเกิน 50 mA → เตือน', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 1 })
      .part('pushbutton', onBoard('f10'), 'SW1', { pressed: true })
      .part('resistor', onBoard('tp4', 90), 'R1', { resistance: 47, span: 3 })
      .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('bn2'))
      .wire(H('b4'), H('b10')).wire(H('j12'), H('bn12'));
    const { analysis } = simulate(b.doc);
    expect(analysis.diagnostics.some((d) => d.partId === 'SW1' && d.message.includes('เกินพิกัด'))).toBe(true);
  });
  it('การกดไม่ลงประวัติ Undo (History.replace) และไฟล์ schema 11 เดิมเปิดได้', () => {
    const doc = circuit(false).doc;
    const h = new History(doc);
    const r = setPartParams(doc, 'SW1', { pressed: true });
    if (!r.ok) throw new Error(r.errors.join());
    h.replace(r.doc);
    expect(h.undo()).toBeNull();
    const v = parseProject(serializeProject('b', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 11;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
  it('โมเดล: ตัวถัง 6 × 6 mm สูง 4.3 mm, กดแล้วก้านลง 0.25 mm', async () => {
    const { buildPartModel } = await import('../src/render/models');
    const top = (pressed: boolean) => {
      const g = buildPartModel({ ...defaultPart('pushbutton', 'B', 'B', { kind: 'board', boardId: 'bb1', anchor: 'f10', rotation: 0 }), params: { pressed, contactResistance: 0.1, maxCurrent: 0.05, maxVoltage: 24 } } as Part);
      g.updateMatrixWorld(true);
      let pl: THREE.Box3 | null = null, body: THREE.Box3 | null = null;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        if (o.userData.pushPlunger && (m.material as THREE.Material).visible !== false) pl = b;
        else if (!o.userData.pushPlunger && !o.userData.leadTip && o.parent === g.children[0] && m.geometry.type !== 'BoxGeometry') body = body ? body.union(b) : b;
      });
      return { pl: pl! as THREE.Box3, body: body! as THREE.Box3 };
    };
    const MM = 1 / 2.54;
    const up = top(false), down = top(true);
    expect(up.pl.max.y / MM).toBeCloseTo(4.3, 2);
    expect((up.pl.max.y - down.pl.max.y) / MM).toBeCloseTo(0.25, 3);
    expect((up.body.max.x - up.body.min.x) / MM).toBeCloseTo(6.0, 1);
    expect((up.body.max.z - up.body.min.z) / MM).toBeCloseTo(6.0, 1);
  });
});
