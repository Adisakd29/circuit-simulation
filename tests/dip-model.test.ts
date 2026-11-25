import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultPart, pinDefs, rotateOffset } from '../src/model/catalog';
import type { Part, Rotation } from '../src/model/types';

/**
 * โมเดล 3 มิติของไอซี DIP-8 (LM741): ตรวจโครงสร้างเชิงตัวเลขตาม package drawing
 * — ไม่ใช่การตรวจภาพ; ภาพจริงจากแอปอยู่ที่ tests/visual/dip_shots.py
 */

// canvas ปลอมสำหรับ texture ข้อความ (Node ไม่มี DOM)
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const MM = 1 / 2.54;

async function build(rotation: Rotation = 0, kind: 'opamp' | 'timer555' | 'logic' | 'counter' | 'hbridge' | 'shiftreg' | 'opto' = 'opamp', model?: string) {
  const { buildPartModel } = await import('../src/render/models');
  const part = defaultPart(kind, 'U1', 'U1', { kind: 'board', boardId: 'bb1', anchor: 'f10', rotation }) as Part;
  if (model) (part.params as { model: string }).model = model;
  const g = buildPartModel(part);
  g.rotation.y = -(rotation * Math.PI) / 180; // เหมือน SceneView.placeModel
  g.updateMatrixWorld(true);
  const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
  const tips = new Map<string, THREE.Box3>();
  const leads = new Map<string, THREE.Box3>();
  g.traverse((o) => {
    if (o.userData.leadTip) tips.set(o.userData.leadTip, box(o));
    if (o.userData.lead) leads.set(o.userData.lead, box(o));
  });
  return { part, g, tips, leads };
}

describe('โมเดล DIP-8 ตาม package drawing (TI P / JEDEC MS-001)', () => {
  it('มีขา 8 ขา ชื่อตรงกับ pinDefs (ขา 1–4 แถวหนึ่ง ขา 5–8 อีกแถว)', async () => {
    const { part, tips } = await build();
    expect([...tips.keys()].sort()).toEqual(pinDefs(part).map((d) => d.name).sort());
  });

  for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`ปลายขาทุกขาอยู่ตรงตำแหน่งรูของขานั้น (หมุน ${rot}°)`, async () => {
      const { part, tips } = await build(rot);
      for (const d of pinDefs(part)) {
        const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
        const c = tips.get(d.name)!.getCenter(new THREE.Vector3());
        expect(c.x).toBeCloseTo(dx, 6);
        expect(c.z).toBeCloseTo(dy, 6);
      }
    });
  }

  it('ระยะขา 2.54 mm และระยะระหว่างแถว 7.62 mm', async () => {
    const { tips } = await build();
    const c = (n: string) => tips.get(n)!.getCenter(new THREE.Vector3());
    expect((c('IN-').x - c('NC1').x) / MM).toBeCloseTo(2.54, 6);
    expect((c('NC1').z - c('NC8').z) / MM).toBeCloseTo(7.62, 6);
  });

  it('ปลายขาลงในรู 3.3 mm ใต้ผิวบอร์ด (ไม่ทะลุบอร์ดหนา ~6 mm) และส่วนบ่ากว้าง 1.52 mm หยุดที่ผิวบอร์ด', async () => {
    const { tips, leads } = await build();
    for (const [, b] of tips) {
      expect(b.min.y / MM).toBeCloseTo(-3.3, 3);
      expect(b.min.y).toBeGreaterThan(-2.4);
    }
    // ส่วนขาเหนือบอร์ด (ทั้งชิ้น) กว้างไม่เกิน b1 = 1.52 mm ในแนวแถว
    for (const [, b] of leads) expect((b.max.x - b.min.x) / MM).toBeLessThanOrEqual(1.52 + 1e-6);
  });

  it('ขาเป็นชิ้นต่อเนื่องจากด้านข้างตัวถัง: ปลายด้านในของขาฝังอยู่ในตัวถัง และพับลงที่ ±3.81 mm จากแนวกลาง', async () => {
    const { g, leads } = await build();
    let body: THREE.Box3 | null = null;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.leadTip && !o.parent?.userData.lead && !o.userData.decal) body = body ? body.union(new THREE.Box3().setFromObject(o)) : new THREE.Box3().setFromObject(o); });
    const bb = body! as THREE.Box3;
    expect((bb.max.z - bb.min.z) / MM).toBeCloseTo(6.35, 1); // E1
    expect((bb.max.x - bb.min.x) / MM).toBeCloseTo(9.81, 1); // D
    expect(bb.min.y / MM).toBeCloseTo(0.64, 2); // ยกจากระนาบนั่ง
    expect((bb.max.y - bb.min.y) / MM).toBeCloseTo(3.3, 1); // A2 (+ จุดบุ๋มขา 1 ที่ผิวบน 0.012 mm)
    const cz = -1.5;
    for (const [, b] of leads) {
      const front = b.getCenter(new THREE.Vector3()).z > cz;
      const inner = front ? b.min.z : b.max.z; // ปลายด้านที่เข้าตัวถัง
      expect(Math.abs(inner - cz)).toBeLessThan(6.35 / 2 * MM); // อยู่ในตัวถัง
      const outer = front ? b.max.z : b.min.z;
      expect(Math.abs(Math.abs(outer - cz) / MM - (7.62 / 2 + 0.125))).toBeLessThan(1e-3); // ผิวนอกส่วนตั้ง
    }
  });

  it('ข้อความบนตัวถังอยู่บนผิวด้านบน และทุกชิ้นอยู่ใน parent เดียวกัน', async () => {
    const { g } = await build();
    let decal: THREE.Object3D | null = null;
    g.traverse((o) => { if (o.userData.decal) decal = o; });
    expect(decal).not.toBeNull();
    const top = (g.children[0].userData.dipTop as number | undefined) ?? (g.userData.dipTop as number);
    const y = new THREE.Box3().setFromObject(decal!).min.y;
    expect(y - top).toBeGreaterThan(0);
    expect(y - top).toBeLessThan(0.02 * MM + 1e-6);
    // ไม่มีป้ายข้อความลอย (sprite) ในตัวโมเดล นอกจากป้ายชื่อที่ scene จัดตำแหน่งเอง
    let sprites = 0;
    g.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites++; });
    expect(sprites).toBe(0);
  });
});

describe('NE555 ใช้โมเดล DIP-8 เดียวกัน: ชื่อขาตามขา 555', () => {
  for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`ปลายขา GND…VCC ตรงตำแหน่งรู (หมุน ${rot}°)`, async () => {
      const { part, tips } = await build(rot, 'timer555');
      expect([...tips.keys()].sort()).toEqual(['CTRL', 'DIS', 'GND', 'OUT', 'RESET', 'THR', 'TRIG', 'VCC']);
      for (const d of pinDefs(part)) {
        const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
        const c = tips.get(d.name)!.getCenter(new THREE.Vector3());
        expect(c.x).toBeCloseTo(dx, 6);
        expect(c.z).toBeCloseTo(dy, 6);
      }
    });
  }
});

describe('74HC (DIP-14 กว้าง 7.62 mm): ปลายขา 14 ขาตรงรู ตัวถังยาว 19.3 mm', () => {
  for (const model of ['74HC08', '74HC02', '74HC04']) for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`${model} หมุน ${rot}°`, async () => {
      const { part, tips, g } = await build(rot, 'logic', model);
      expect(tips.size).toBe(14);
      expect([...tips.keys()].sort()).toEqual(pinDefs(part).map((d) => d.name).sort());
      for (const d of pinDefs(part)) {
        const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
        const c = tips.get(d.name)!.getCenter(new THREE.Vector3());
        expect(c.x).toBeCloseTo(dx, 6);
        expect(c.z).toBeCloseTo(dy, 6);
      }
      if (rot === 0) {
        let body: THREE.Box3 | null = null;
        g.traverse((o) => { if (o.userData.dipBody) body = new THREE.Box3().setFromObject(o); });
        expect(body).not.toBeNull();
        if (body) { const s = (body as THREE.Box3).getSize(new THREE.Vector3()); expect(s.x / MM).toBeCloseTo(19.3, 0); }
      }
    });
  }
});

describe('DIP-16 (CD4017B, L293D, 74HC595): ปลายขา 16 ขาตรงรู ตัวถังยาว 19.3 mm', () => {
  for (const kind of ['counter', 'hbridge', 'shiftreg'] as const) for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`${kind} หมุน ${rot}°`, async () => {
      const { part, tips, g } = await build(rot, kind);
      expect(tips.size).toBe(16);
      expect([...tips.keys()].sort()).toEqual(pinDefs(part).map((d) => d.name).sort());
      for (const d of pinDefs(part)) {
        const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
        const c = tips.get(d.name)!.getCenter(new THREE.Vector3());
        expect(c.x).toBeCloseTo(dx, 6);
        expect(c.z).toBeCloseTo(dy, 6);
      }
      if (rot === 0) {
        let body: THREE.Box3 | null = null;
        g.traverse((o) => { if (o.userData.dipBody) body = new THREE.Box3().setFromObject(o); });
        expect(body).not.toBeNull();
        expect((body as unknown as THREE.Box3).getSize(new THREE.Vector3()).x / MM).toBeCloseTo(19.3, 0);
      }
    });
  }
});

describe('DIP-4 (PC817): ปลายขา 4 ขาตรงรู ตัวถัง 4.6 × 6.35 mm ไม่มีรอยบาก', () => {
  for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`PC817 หมุน ${rot}°`, async () => {
      const { part, tips, g } = await build(rot, 'opto');
      expect(tips.size).toBe(4);
      for (const d of pinDefs(part)) {
        const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
        const b = tips.get(d.name)!;
        const c = b.getCenter(new THREE.Vector3());
        expect(c.x).toBeCloseTo(dx, 6);
        expect(c.z).toBeCloseTo(dy, 6);
        expect(b.min.y).toBeGreaterThan(-2.4);
      }
      if (rot === 0) {
        let body: THREE.Box3 | null = null;
        g.traverse((o) => { if (o.userData.dipBody) body = new THREE.Box3().setFromObject(o); });
        const s = (body as unknown as THREE.Box3).getSize(new THREE.Vector3()).divideScalar(MM);
        expect(s.x).toBeCloseTo(4.6, 1);
        expect(s.z).toBeCloseTo(6.35, 1);
      }
    });
  }
});
