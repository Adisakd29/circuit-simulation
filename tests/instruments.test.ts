import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultPart, pinDefs } from '../src/model/catalog';
import type { Part, PartKind } from '../src/model/types';

/** เครื่องมือบนโต๊ะขนาดจริง: จุดต่อสาย = หัวขั้ว/ปากรูเสียบ และขอบเขตตัวเครื่องไม่เกิน footprint ที่ใช้ตรวจการชน */
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => {} }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

describe('เครื่องมือบนโต๊ะ', () => {
  for (const kind of ['dcsupply', 'fgen', 'scope', 'ammeter', 'dmm', 'vom'] as PartKind[]) {
    it(`${kind}: หัวขั้วต่อทุกขั้วตรงจุดต่อสาย และตัวเครื่องอยู่ใน footprint`, async () => {
      const { buildPartModel, tablePinLocal } = await import('../src/render/models');
      const { TABLE_FOOTPRINT } = await import('../src/model/geometry');
      const part = defaultPart(kind, 'X', 'X', { kind: 'table', x: 0, z: 0, rotation: 0 }) as Part;
      const g = buildPartModel(part);
      g.updateMatrixWorld(true);
      for (const d of pinDefs(part)) {
        const t = tablePinLocal(part, d.name);
        let best = Infinity;
        g.traverse((o) => {
          if (o.userData.isPin && o.userData.pin === d.name && (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).visible !== false) {
            best = Math.min(best, new THREE.Box3().setFromObject(o).distanceToPoint(t));
          }
        });
        expect(best).toBeLessThan(0.05);
      }
      const box = new THREE.Box3();
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.isPin) box.union(new THREE.Box3().setFromObject(o)); });
      const fp = TABLE_FOOTPRINT[kind];
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(fp.w + 0.05);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(fp.d + 0.05); // footprint รวมส่วนที่ยื่นจากแผงหน้า (ขั้วต่อ/ปุ่มหมุน) แล้ว
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01); // วางบนพื้นโต๊ะพอดี
    });
  }
});
