import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultPart, pinDefs, rotateOffset } from '../src/model/catalog';
import type { Part, PartKind, Rotation } from '../src/model/types';

/** โมเดลอุปกรณ์บนบอร์ด (TO-92, DO-35/DO-41, ตัวเก็บประจุ, ตัวเหนี่ยวนำ, สวิตช์): ตรวจเชิงตัวเลขตามแบบตัวถัง */

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => {} }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const MM = 1 / 2.54;
type Case = { name: string; kind: PartKind; params?: Record<string, unknown> };
const CASES: Case[] = [
  { name: 'TO-92 (2N3904)', kind: 'bjt' },
  { name: 'DO-35 1N4148', kind: 'diode' },
  { name: 'DO-41 1N4007', kind: 'diode', params: { model: '1N4007' } },
  { name: 'ซีเนอร์ (DO-35)', kind: 'diode', params: { model: 'Z5V1' } },
  { name: 'อิเล็กโทรไลต์ 100 µF 16 V', kind: 'capacitor' },
  { name: 'อิเล็กโทรไลต์ 1000 µF 25 V ระยะขา 3', kind: 'capacitor', params: { capacitance: 1000e-6, ratedVoltage: 25, span: 3 } },
  { name: 'เซรามิก 100 nF', kind: 'capacitor', params: { capacitance: 100e-9, polarized: false } },
  { name: 'MLCC 10 µF', kind: 'capacitor', params: { capacitance: 10e-6, polarized: false } },
  { name: 'ตัวเหนี่ยวนำ', kind: 'inductor' },
  { name: 'สวิตช์ (ปิด)', kind: 'switch', params: { closed: true } },
  { name: 'สวิตช์ (เปิด)', kind: 'switch', params: { closed: false } },
  { name: 'ทริมพอต 3296W 10 kΩ', kind: 'potentiometer' },
  { name: 'ปุ่มกด 6 × 6 mm (ปล่อย)', kind: 'pushbutton' },
  { name: 'บัซเซอร์ active Ø12', kind: 'buzzer' },
  { name: 'LDR Ø5 (300 lx)', kind: 'ldr' },
  { name: '7 ส่วน 0.56" แคโทดร่วม', kind: 'sevenseg' },
  { name: 'L7805 TO-220', kind: 'vreg' },
  { name: 'L7812 TO-220 + แผ่นระบายความร้อน', kind: 'vreg', params: { model: 'L7812', vout: 12, heatsink: true } },
  { name: 'LDR Ø5 ระยะขา 3 (มืด)', kind: 'ldr', params: { lux: 0, span: 3 } },
  { name: 'บัซเซอร์ passive Ø12', kind: 'buzzer', params: { type: 'passive' } },
  { name: 'ปุ่มกด 6 × 6 mm (กด)', kind: 'pushbutton', params: { pressed: true } },
  { name: 'ทริมพอต 3296W 1 kΩ ชิดขา 1', kind: 'potentiometer', params: { resistance: 1000, position: 0 } },
  { name: 'TO-92 (LM35DZ)', kind: 'lm35' },
  { name: 'HC-SR04 อัลตราโซนิก', kind: 'sonar' },
];

async function build(c: Case, rotation: Rotation) {
  const { buildPartModel } = await import('../src/render/models');
  const base = defaultPart(c.kind, 'P', 'P', { kind: 'board', boardId: 'bb1', anchor: 'a5', rotation }) as Part;
  const part = { ...base, params: { ...base.params, ...(c.params ?? {}) } } as Part;
  const g = buildPartModel(part);
  g.rotation.y = -(rotation * Math.PI) / 180;
  g.updateMatrixWorld(true);
  const tips = new Map<string, THREE.Box3>();
  g.traverse((o) => { if (o.userData.leadTip) tips.set(o.userData.leadTip, new THREE.Box3().setFromObject(o)); });
  return { part, g, tips };
}

describe('โมเดลอุปกรณ์บนบอร์ด: ขาต่อเนื่องจากตัวถังและลงรูตรงตำแหน่ง', () => {
  for (const c of CASES) {
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      it(`${c.name} หมุน ${rot}°: ปลายขาทุกขาตรงตำแหน่งรูของขานั้น ลึก 3 mm ไม่ทะลุบอร์ด`, async () => {
        const { part, tips } = await build(c, rot);
        expect([...tips.keys()].sort()).toEqual(pinDefs(part).map((d) => d.name).sort());
        for (const d of pinDefs(part)) {
          const [dx, dy] = rotateOffset(d.dx, d.dy, rot);
          const b = tips.get(d.name)!;
          const ctr = b.getCenter(new THREE.Vector3());
          expect(ctr.x).toBeCloseTo(dx, 6);
          expect(ctr.z).toBeCloseTo(dy, 6);
          expect(b.min.y / MM).toBeCloseTo(-3.0, 1);
          expect(b.min.y).toBeGreaterThan(-2.4);
        }
      });
    }
    it(`${c.name}: ตัวถังอยู่เหนือผิวบอร์ด และไม่มีชิ้นส่วนลอยแยก (ทุก mesh อยู่ใน parent เดียว)`, async () => {
      const { g } = await build(c, 0);
      let minBody = Infinity;
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.leadTip && !(o.parent && o.parent.children.some((k) => k.userData.leadTip))) minBody = Math.min(minBody, new THREE.Box3().setFromObject(o).min.y); });
      expect(minBody).toBeGreaterThanOrEqual(-1e-6);
      expect(g.userData.topY).toBeGreaterThan(0);
    });
  }
});

describe('ขนาดตามแบบตัวถัง', () => {
  const size = async (c: Case, pick: (o: THREE.Object3D) => boolean) => {
    const { g } = await build(c, 0);
    const box = new THREE.Box3();
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && pick(o)) box.union(new THREE.Box3().setFromObject(o)); });
    return box.getSize(new THREE.Vector3()).divideScalar(MM);
  };
  it('TO-92 กว้าง 4.8 ลึก 3.7 สูง 4.6 mm', async () => {
    const s = await size(CASES[0], (o) => (o as THREE.Mesh).geometry.type === 'ExtrudeGeometry');
    expect(s.x).toBeCloseTo(4.8, 1); expect(s.z).toBeCloseTo(3.7, 1); expect(s.y).toBeCloseTo(4.6, 1);
  });
  it('HC-SR04: PCB 45 × 20 mm, ลำโพง Ø16 ยื่นหน้า 12 mm, ห่างศูนย์กลาง 26 mm', async () => {
    const c = CASES.find((k) => k.kind === 'sonar')!;
    const pcb = await size(c, (o) => (o as THREE.Mesh).geometry.type === 'BoxGeometry' && Math.abs(new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).x / MM - 45) < 0.1);
    expect(pcb.x).toBeCloseTo(45, 1); expect(pcb.y).toBeCloseTo(20, 1);
    const cans = await size(c, (o) => (o as THREE.Mesh).geometry.type === 'CylinderGeometry');
    expect(cans.x).toBeCloseTo(26 + 16, 1); expect(cans.y).toBeCloseTo(16, 1); expect(cans.z).toBeCloseTo(12, 1);
  });
  it('อิเล็กโทรไลต์ 100 µF 16 V = Ø 6.3 × 11 mm', async () => {
    const s = await size(CASES[4], (o) => (o as THREE.Mesh).geometry.type === 'LatheGeometry');
    expect(s.x).toBeCloseTo(6.3, 1); expect(s.y).toBeCloseTo(11, 1);
  });
  it('รหัสค่าบนตัวเก็บประจุ/ตัวเหนี่ยวนำ', async () => {
    const { capCode, indCode, electrolyticSize } = await import('../src/render/board-parts');
    expect(capCode(100e-9)).toBe('104');
    expect(capCode(10e-6)).toBe('106');
    expect(capCode(22e-12)).toBe('22');
    expect(indCode(0.01)).toBe('103');
    expect(electrolyticSize(1000e-6, 25)).toMatchObject({ D: 12.5, L: 20, F: 5 });
  });
});
