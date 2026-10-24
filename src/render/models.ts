import * as THREE from 'three';
import { buildPicoModel, withEnv } from './pico-model';
import { buildDip, buildDip8 } from './dip-model';
import { benchPinLocal, buildBenchFgen, buildBenchScope, buildBenchSupply, buildDmm, buildVom } from './bench';
import { buildDiode, buildElectrolytic, buildCeramic, buildInductor, buildSlideSwitch, buildTO220, buildTO92, buildTrimpot3296, buildTactile6x6, buildBuzzer12, buildLdr5, buildNtcBead, buildSevenSeg, buildRelayModule, RELAY_PIN_LOCAL, buildTransformerEI, TRANSFORMER_PIN_LOCAL, buildServoSG90, SERVO_PIN_LOCAL, buildTTMotor, MOTOR_PIN_LOCAL, buildSpeaker57, SPEAKER_PIN_LOCAL, buildSonarModule, buildStepperKit, STEPPER_PIN_LOCAL } from './board-parts';
import { isBenchKind } from '../model/geometry';
import { LED_HEX, LOGIC_FUNC, pinDefs, resistorBands } from '../model/catalog';
import type { BjtPart, CapacitorPart, DiodePart, OpampPart, FgenPart, InductorPart, LedPart, Part, ResistorPart, SwitchPart, Timer555Part, LogicPart, CounterPart, HbridgePart, ShiftRegPart, OptoPart, ComparatorPart, Lm386Part } from '../model/types';

/**
 * โมเดล 3 มิติของอุปกรณ์ (ออกแบบเอง, สร้างจาก primitive)
 * หน่วย: 1 = ระยะรู 2.54 mm, ผิวบอร์ด y = 0, ผิวโต๊ะ y = TABLE_Y
 * โมเดลมีไว้แสดงผลและ picking เท่านั้น — ไม่ใช้ตัดสินการเชื่อมต่อทางไฟฟ้า
 */

export const TABLE_Y = -2.4;
export const LEG_DEPTH = -0.5;

const mat = new Map<string, THREE.Material>();
export function M(key: string, make: () => THREE.Material): THREE.Material {
  let m = mat.get(key);
  if (!m) { m = make(); mat.set(key, m); }
  return m;
}
const std = (color: number, roughness = 0.6, metalness = 0) =>
  M(`std${color}-${roughness}-${metalness}`, () => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); return metalness >= 0.5 ? withEnv(m) : m; });
/** ลวดขาอุปกรณ์ชุบดีบุก (เงาโลหะ สะท้อนสภาพแวดล้อม) */
const legMat = () => std(0xd3d6da, 0.28, 1);
/** รัศมีขาอุปกรณ์: ลวด Ø 0.6 mm = 0.118 หน่วยรู */
const LEAD_R = 0.6 / 2 / 2.54;


/**
 * ขาอุปกรณ์: ออกจากตัวถังในแนวนอน → งอ 90° (รัศมีโค้งเล็ก ๆ แบบดัดด้วยคีม) → ตรงลงรู
 * ปลายลงไปใต้ผิวบอร์ดเล็กน้อย (มองเห็นเสียบอยู่ในรู ไม่ลอย)
 */
function leg(from: THREE.Vector3, holeX: number, holeZ: number) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const corner = new THREE.Vector3(holeX, from.y, holeZ);
  const bottom = new THREE.Vector3(holeX, LEG_DEPTH, holeZ);
  const horiz = corner.distanceTo(from);
  if (horiz < 0.01) {
    path.add(new THREE.LineCurve3(from, bottom));
  } else {
    const r = Math.min(0.22, horiz * 0.5, (from.y - LEG_DEPTH) * 0.4);
    const dir = corner.clone().sub(from).normalize();
    const a = corner.clone().addScaledVector(dir, -r);
    const b = corner.clone().add(new THREE.Vector3(0, -r, 0));
    path.add(new THREE.LineCurve3(from, a));
    path.add(new THREE.QuadraticBezierCurve3(a, corner, b));
    path.add(new THREE.LineCurve3(b, bottom));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, 20, LEAD_R, 6, false), legMat());
}

/** สร้างโปรไฟล์หมุนรอบแกน (lathe) จากฟังก์ชันรัศมี r(t) แบ่งเท่า ๆ กันตามความยาว — uv.v ∝ ระยะตามแกน (ใช้วาดแถบสีให้ตรงตำแหน่ง) */
function latheAlongX(len: number, r: (t: number) => number, n = 48, radial = 24): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(Math.max(1e-4, r(t)), t * len)); }
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateZ(-Math.PI / 2); // แกน y → แกน +x
  return g;
}

/** ตัวต้านทาน 1/4 W ฟิล์มคาร์บอน: ตัว Ø 2.3 × 6.3 mm ทรงกระดูก (หัวท้ายป่อง) แถบสี 4 แถบตามค่า ขาลวด Ø 0.6 mm
 *  ขาที่ local (0,0) และ (span,0) ก่อนหมุน */
function resistor(p: ResistorPart): THREE.Group {
  const g = new THREE.Group();
  const span = p.params.span;
  const len = Math.min(6.3 / 2.54, Math.max(0.8, span - 0.45));
  const cx = span / 2, h = 0.62;
  const R0 = 1.15 / 2.54, R1 = 1.25 / 2.54, Rm = 1.05 / 2.54;
  const radius = (t: number) => {
    const e = Math.min(t, 1 - t) * len * 2.54; // mm จากปลายใกล้สุด
    if (e < 0.35) return R0 * Math.sqrt(Math.max(0, e / 0.35)) * 0.95 + 0.02;
    if (e < 1.5) return R1 - (e - 0.35) * 0.002;
    if (e < 2.0) return R1 + (Rm - R1) * ((e - 1.5) / 0.5);
    return Rm;
  };
  const body = new THREE.Mesh(latheAlongX(len, radius), M(`res-${p.params.resistance}`, () => new THREE.MeshStandardMaterial({ map: bandTexture(resistorBands(p.params.resistance)), roughness: 0.5 })));
  body.position.set(cx - len / 2, h, 0);
  body.castShadow = true;
  g.add(body);
  g.add(leg(new THREE.Vector3(cx - len / 2 + 0.03, h, 0), 0, 0));
  g.add(leg(new THREE.Vector3(cx + len / 2 - 0.03, h, 0), span, 0));
  return g;
}

/** texture แถบสีของตัวต้านทาน: แกน v = ตามความยาวตัว (ตำแหน่งแถบตามมาตรฐาน 4 แถบ) */
function bandTexture(bands: string[]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const x = c.getContext('2d')!;
  const base = x.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#cdb48b'); base.addColorStop(0.5, '#d9c49c'); base.addColorStop(1, '#cdb48b');
  x.fillStyle = base;
  x.fillRect(0, 0, 8, 256);
  const pos = [0.24, 0.35, 0.46, 0.76];
  bands.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, (1 - pos[i] - 0.045) * 256, 8, 0.075 * 256); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * LED 5 mm: เลนส์ epoxy ใส (ทรงกระบอก + โดม) บนขอบฐาน Ø 5.8 mm ที่ตัดแบนฝั่งแคโทด, ภายในมีแท่นแคโทด (anvil) ใหญ่ และเสาแอโนด (post)
 * ขา A ยาวกว่า (งอเล็กน้อยให้ระยะขา 2.54 mm) — ความสว่างจาก emissive ตามกระแสที่คำนวณได้เท่านั้น
 */
function led(p: LedPart): THREE.Group {
  const g = new THREE.Group();
  const mm = 1 / 2.54;
  const cx = 0.5, base = 1.15; // ฐานลอยจากบอร์ด ≈ 2.9 mm
  const color = LED_HEX[p.params.color];
  const offColor = new THREE.Color(color).lerp(new THREE.Color(0x8a8f8c), 0.35).multiplyScalar(0.72);
  const lens = new THREE.MeshPhysicalMaterial({ color: offColor, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.15, transparent: true, opacity: 0.86, emissive: new THREE.Color(color), emissiveIntensity: 0, depthWrite: false });
  // ขอบฐาน (flange) ตัดแบนที่ฝั่งแคโทด (+x)
  const rimShape = new THREE.Shape();
  const rr = 2.9 * mm, flatX = 2.45 * mm, ang = Math.acos(flatX / rr);
  rimShape.absarc(0, 0, rr, ang, Math.PI * 2 - ang, false);
  rimShape.lineTo(flatX, -Math.sqrt(rr * rr - flatX * flatX));
  rimShape.closePath();
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 1.0 * mm, bevelEnabled: false, curveSegments: 20 });
  rimGeo.rotateX(-Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, lens);
  rim.position.set(cx, base, 0);
  // ตัวเลนส์: ทรงกระบอก Ø 5 mm สูง 5.6 mm + โดม
  const R = 2.5 * mm, H = 5.6 * mm;
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, H)];
  for (let k = 1; k <= 10; k++) { const a = (k / 10) * (Math.PI / 2); prof.push(new THREE.Vector2(Math.max(0.001, R * Math.cos(a)), H + R * Math.sin(a))); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), lens);
  body.position.set(cx, base + 1.0 * mm, 0);
  body.renderOrder = 2;
  rim.renderOrder = 2;
  // โครงภายใน (มองผ่านเลนส์): แท่นแคโทดรูปถ้วย และเสาแอโนด
  const inner = std(0x9aa0a6, 0.35, 0.9);
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.6 * mm, 2.2 * mm, 0.5 * mm), inner);
  anvil.position.set(cx + 0.55 * mm, base + 2.0 * mm, 0);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.6 * mm, 2.4 * mm, 0.5 * mm), inner);
  post.position.set(cx - 0.9 * mm, base + 2.1 * mm, 0);
  g.add(anvil, post, rim, body);
  // ขา: สี่เหลี่ยม 0.5 mm, A (ซ้าย) ยาวกว่าและมีรอยงอ
  const sq = 0.5 * mm;
  const legBox = (x0: number, x1: number, kinkY: number | null) => {
    const pts = kinkY === null
      ? [new THREE.Vector3(x0, base, 0), new THREE.Vector3(x1, LEG_DEPTH, 0)]
      : [new THREE.Vector3(x0, base, 0), new THREE.Vector3(x0, kinkY + 0.12, 0), new THREE.Vector3(x1, kinkY - 0.12, 0), new THREE.Vector3(x1, LEG_DEPTH, 0)];
    const grp = new THREE.Group();
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sq, len + sq * 0.6, sq), legMat());
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      grp.add(m);
    }
    return grp;
  };
  g.add(legBox(cx - 1.27 * mm, 0, 0.55), legBox(cx + 1.27 * mm, 1, null));
  const glow = new THREE.Sprite(M(`glow${color}`, () => new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })).clone() as THREE.SpriteMaterial);
  glow.position.set(cx, base + 4.5 * mm, 0);
  glow.scale.set(3.5, 3.5, 1);
  glow.userData.glow = true;
  g.add(glow);
  g.userData.lens = lens;
  g.userData.glowSprite = glow;
  return g;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** ตัวเก็บประจุ: อิเล็กโทรไลต์ (ขนาดตามค่า/แรงดัน) หรือเซรามิก/MLCC — ดู board-parts.ts */
function capacitor(p: CapacitorPart): THREE.Group {
  const pins = names(p, 2) as [string, string];
  return p.params.polarized ? buildElectrolytic(p.params.capacitance, p.params.ratedVoltage, p.params.span, pins) : buildCeramic(p.params.capacitance, p.params.ratedVoltage, p.params.span, pins);
}

/** ตัวเหนี่ยวนำแบบแกนดรัม (radial choke) */
function inductor(p: InductorPart): THREE.Group {
  return buildInductor(p.params.inductance, p.params.span, names(p, 2) as [string, string]);
}

/** สวิตช์เลื่อน 2 ขา: ก้านเลื่อนอยู่ฝั่ง ON เมื่อสวิตช์ต่อ + ป้ายสถานะเล็ก ๆ เหนือก้าน */
function sw(p: SwitchPart): THREE.Group {
  const g = buildSlideSwitch(p.params.closed, names(p, 2) as [string, string], pinDefs(p)[1].dx);
  const mark = labelSprite(p.params.closed ? 'ON' : 'OFF', p.params.closed ? '#e0a526' : '#cfd4d2', 0.55, 'rgba(29,39,35,0.78)');
  mark.position.set(pinDefs(p)[1].dx / 2 + (p.params.closed ? 0.43 : -0.43), (g.userData.topY as number) + 0.35, 0);
  mark.userData.stateTag = true;
  g.add(mark);
  return g;
}

/** ไดโอด axial: 1N4148 / ซีเนอร์ (DO-35 แก้ว) และ 1N4007 (DO-41) — แถบที่ปลายฝั่งแคโทด (ขา K อยู่ที่ span) */
function diode(p: DiodePart): THREE.Group {
  return buildDiode(p.params.model, p.params.span, names(p, 2) as [string, string]);
}

/** ทรานซิสเตอร์ TO-92: ขา E B C ที่ x = 0,1,2 หน้าแบน (มีตัวหนังสือ) หันไปทาง +z */
function bjt(p: BjtPart): THREE.Group {
  return buildTO92(p.params.model, names(p, 3) as [string, string, string]);
}

/** ชื่อขาเรียงตามตำแหน่ง dx (ขาแรก = dx 0) */
function names(p: Part, n: number): string[] {
  return pinDefs(p).slice().sort((a, b) => a.dx - b.dx).slice(0, n).map((d) => d.name);
}

/**
 * ออปแอมป์ DIP-8 คร่อมร่องกลาง: ขา 1–4 ที่ z = 0 (x = 0..3), ขา 5–8 ที่ z = −3 รอยบากฝั่งขา 1/8 (x < 0)
 * มองจากด้านบน (รอยบากอยู่ซ้าย) ขา 1 อยู่ล่างซ้าย เรียงทวนเข็มนาฬิกาเหมือน IC จริง
 */
/** ออปแอมป์ DIP-8: โมเดลตาม package drawing (ดู dip-model.ts) ชื่อขาจาก pinDefs เดียวกับการต่อวงจร */
function opamp(p: OpampPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  const marking = p.params.model === 'LM741' ? ['LM741CN', 'OP-AMP'] : [p.params.model, 'OP-AMP'];
  return buildDip8(pinAt, marking);
}

/** ไอซีไทเมอร์ NE555 (PDIP-8 เดียวกับออปแอมป์) — ไม่มีโลโก้ผู้ผลิต พิมพ์เฉพาะรุ่น */
function timer555(p: Timer555Part): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip8(pinAt, ['NE555P', 'TIMER']);
}

/** คอมพาราเตอร์คู่ LM393 (PDIP-8 เดียวกับออปแอมป์) — พิมพ์รุ่น ไม่มีโลโก้ผู้ผลิต */
function comparator(p: ComparatorPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip8(pinAt, ['LM393P', 'DUAL COMP']);
}

/** ไอซีขยายเสียง LM386 (PDIP-8) — พิมพ์รุ่น ไม่มีโลโก้ผู้ผลิต */
function lm386(p: Lm386Part): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip8(pinAt, ['LM386N-1', 'AUDIO AMP']);
}

/** ไอซีเกต 74HC (PDIP-14) — พิมพ์รุ่นแบบ SN74HC..N และชนิดเกต ไม่มีโลโก้ผู้ผลิต */
function logic(p: LogicPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip(14, pinAt, [`${p.params.model}N`, `QUAD ${LOGIC_FUNC[p.params.model].name}`.replace('QUAD NOT', 'HEX NOT')]);
}

/** ไอซีนับ CD4017B (PDIP-16) — พิมพ์รุ่นแบบ CD4017BE ไม่มีโลโก้ผู้ผลิต */
function counter(p: CounterPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip(16, pinAt, ['CD4017BE', 'DECADE COUNTER']);
}

/** ออปโตคัปเปลอร์ PC817 (DIP-4 ไม่มีรอยบาก มีจุดขา 1) — พิมพ์รุ่นและกลุ่ม CTR ไม่มีโลโก้ผู้ผลิต */
function opto(p: OptoPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip(4, pinAt, [`PC817${p.params.rank}`]);
}

/** ไอซีเลื่อนบิต 74HC595 (PDIP-16) — พิมพ์รุ่นแบบ SN74HC595N ไม่มีโลโก้ผู้ผลิต */
function shiftreg(p: ShiftRegPart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip(16, pinAt, ['SN74HC595N', '8-BIT SHIFT REG']);
}

/** ไอซีขับมอเตอร์ L293D (PDIP-16) — พิมพ์รุ่น ไม่มีโลโก้ผู้ผลิต */
function hbridge(p: HbridgePart): THREE.Group {
  const defs = pinDefs(p);
  const pinAt = (dx: number, row: 0 | 1) => defs.find((d) => d.dx === dx && d.dy === (row === 0 ? 0 : -3))!.name;
  return buildDip(16, pinAt, ['L293DNE', 'H-BRIDGE DRIVER']);
}

/** ข้อความลอย (canvas sprite) */
export function labelSprite(text: string, color = '#1d2723', height = 0.9, bg: string | null = null): THREE.Sprite {
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  const font = '600 44px "Chakra Petch", "IBM Plex Sans Thai", sans-serif';
  x.font = font;
  const w = Math.ceil(x.measureText(text).width) + 24;
  c.width = w; c.height = 64;
  x.font = font;
  if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect(0, 4, w, 56, 10); x.fill(); }
  x.fillStyle = color;
  x.textBaseline = 'middle';
  x.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set((height * w) / 64, height, 1);
  s.renderOrder = 10;
  return s;
}

/** หน้าจอ LCD แบบสะท้อนแสง (canvas texture ที่อัปเดตได้) */
export class LcdScreen {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  constructor(w: number, h: number, private px = 64) {
    this.canvas.width = Math.round(w * px);
    this.canvas.height = Math.round(h * px);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.draw(['- - -'], '');
  }
  private shown = '';
  draw(lines: string[], badge: string) {
    // ข้อความเดิม → ไม่วาด/ไม่ส่ง texture ใหม่ (ถูกเรียกทุกผลจำลอง)
    const key = lines.join('\n') + '|' + badge;
    if (key === this.shown) return;
    this.shown = key;
    const x = this.canvas.getContext('2d', { willReadFrequently: true })!;
    const W = this.canvas.width, Hh = this.canvas.height;
    x.fillStyle = '#c3d0a8';
    x.fillRect(0, 0, W, Hh);
    x.fillStyle = 'rgba(30,42,23,0.08)';
    x.fillRect(0, 0, W, Hh * 0.08);
    x.fillStyle = '#1e2a17';
    x.textBaseline = 'middle';
    const lh = Hh / (lines.length + (badge ? 0.6 : 0.2));
    lines.forEach((l, i) => {
      x.font = `600 ${Math.floor(lh * 0.78)}px "Chakra Petch", monospace`;
      x.textAlign = 'right';
      x.fillText(l, W - this.px * 0.25, lh * (i + 0.6));
    });
    if (badge) {
      x.font = `700 ${Math.floor(lh * 0.42)}px "Chakra Petch", monospace`;
      x.textAlign = 'left';
      x.fillText(badge, this.px * 0.2, Hh - lh * 0.32);
    }
    this.texture.needsUpdate = true;
  }
}

/** ตำแหน่ง local ของขั้ว binding post บนอุปกรณ์นอกบอร์ด (ก่อนหมุน, จุดศูนย์กลางอุปกรณ์ = 0) */
export function tablePinLocal(part: Part, pin: string): THREE.Vector3 {
  const bp = benchPinLocal(part, pin);
  if (bp) return bp;
  if (part.kind === 'relay') { const p = RELAY_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  if (part.kind === 'speaker') { const p = SPEAKER_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  if (part.kind === 'motor') { const p = MOTOR_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  if (part.kind === 'servo') { const p = SERVO_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  if (part.kind === 'stepper') { const p = STEPPER_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  if (part.kind === 'transformer') { const p = TRANSFORMER_PIN_LOCAL[pin]; if (p) return new THREE.Vector3(p[0], p[1], p[2]); }
  return new THREE.Vector3();
}

export { ScopeScreen } from './bench';

/** ข้อความบนจอเครื่องกำเนิดสัญญาณ */
export function fgenLcd(p: FgenPart): [string[], string] {
  const names = { sine: 'SINE', square: 'SQUARE', triangle: 'TRIANGLE', dc: 'DC' } as const;
  const f = p.params.frequency;
  const fs = f >= 1000 ? `${+(f / 1000).toPrecision(4)} kHz` : `${+f.toPrecision(4)} Hz`;
  return [[p.params.wave === 'dc' ? 'DC' : `${names[p.params.wave]} ${fs}`, `${p.params.vpp.toFixed(2)} Vpp ${p.params.offset >= 0 ? '+' : ''}${p.params.offset.toFixed(2)}`],
    p.params.outputOn ? `OUT ON · ${p.params.outputImpedance} Ω` : 'OUT OFF'];
}

export function buildPartModel(p: Part): THREE.Group {
  let g: THREE.Group;
  switch (p.kind) {
    case 'resistor': g = resistor(p); break;
    case 'led': g = led(p); break;
    case 'switch': g = sw(p); break;
    case 'dcsupply': g = buildBenchSupply(p.params.voltage, p.params.currentLimit, p.params.outputOn); break;
    case 'ammeter': g = buildDmm('dcma', true); break;
    case 'dmm': g = buildDmm(p.params.mode); break;
    case 'vom': g = buildVom(p.params.sel, p.params.centerOhm); break;
    case 'capacitor': g = capacitor(p); break;
    case 'inductor': g = inductor(p); break;
    case 'fgen': { g = buildBenchFgen(p.params.wave, p.params.outputOn); const [lines, badge] = fgenLcd(p); (g.userData.lcd as { draw: (l: string[], b: string) => void }).draw(lines, badge); break; }
    case 'scope': g = buildBenchScope(); break;
    case 'diode': g = diode(p); break;
    case 'bjt': g = bjt(p); break;
    case 'mosfet': g = p.params.model === '2N7000' ? buildTO92(p.params.model, names(p, 3) as [string, string, string]) : buildTO220(p.params.model, names(p, 3) as [string, string, string]); break;
    case 'opamp': g = opamp(p); break;
    case 'timer555': g = timer555(p); break;
    case 'logic': g = logic(p); break;
    case 'comparator': g = comparator(p); break;
    case 'lm386': g = lm386(p); break;
    case 'counter': g = counter(p); break;
    case 'hbridge': g = hbridge(p); break;
    case 'shiftreg': g = shiftreg(p); break;
    case 'opto': g = opto(p); break;
    case 'sonar': g = buildSonarModule(); break;
    case 'lm35': g = buildTO92(p.params.model, names(p, 3) as [string, string, string]); break;
    case 'darlington': g = buildTO220('TIP120', names(p, 3) as [string, string, string], { heatsink: p.params.heatsink, code: 'KD 2433' }); break;
    case 'lm317': g = buildTO220('LM317T', names(p, 3) as [string, string, string], { heatsink: p.params.heatsink, code: 'KC 2438' }); break;
    case 'scr': g = buildTO92(p.params.model, names(p, 3) as [string, string, string]); break;
    case 'vreg': g = buildTO220(`${p.params.model}CV`, names(p, 3) as [string, string, string], { heatsink: p.params.heatsink, code: 'GK 2441' }); break;
    case 'pico': g = buildPicoModel(); break;
    case 'speaker': g = buildSpeaker57(); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'motor': g = buildTTMotor(); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'servo': g = buildServoSG90(); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'transformer': g = buildTransformerEI(); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'stepper': g = buildStepperKit((pinAt) => buildDip(16, pinAt, ['ULN2003AN', 'DARLINGTON'])); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'relay': g = buildRelayModule(); g.traverse((o) => { if (o.userData.isPin || o.userData.leadTip) o.userData.partId = p.id; }); break;
    case 'sevenseg': g = buildSevenSeg(pinDefs(p).map((d) => d.name)); break;
    case 'ntc': g = buildNtcBead(p.params.span, p.params.temperature, ['1', '2']); break;
    case 'ldr': g = buildLdr5(p.params.span, p.params.lux, ['1', '2']); break;
    case 'buzzer': g = buildBuzzer12(p.params.type, ['P', 'N']); break;
    case 'pushbutton': g = buildTactile6x6(p.params.pressed, pinDefs(p).map((d) => d.name) as [string, string, string, string]); break;
    case 'potentiometer': g = buildTrimpot3296(p.params.resistance, p.params.position, names(p, 3) as [string, string, string]); break;
  }
  g.traverse((o) => {
    if (!o.userData.isPin || !o.userData.partId) o.userData.partId = p.id;
    if ((o as THREE.Mesh).isMesh && !o.userData.noPick) { o.castShadow = true; }
  });
  const label = labelSprite(p.label, '#1d2723', isBenchKind(p.kind) ? 2.6 : p.placement.kind === 'table' ? 1.1 : 0.8, 'rgba(238,241,236,0.88)');
  label.userData = { isLabel: true };
  g.userData.labelSprite = label;
  return g;
}
