import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { withEnv } from './pico-model';
import { BENCH_DIMS } from '../model/geometry';
import { DMM_MODES, VOM_POSITIONS, vomPosition } from '../model/catalog';
import type { Part } from '../model/types';
import type { DmmDisplay } from '../instruments/meters';

/**
 * เครื่องมือบนโต๊ะขนาดจริง (หน่วย mm ในกลุ่มย่อ 1/2.54 → หน่วยรู) — แบบทั่วไป ไม่มีโลโก้/ชื่อยี่ห้อ
 * ขนาดตัวเครื่องตาม BENCH_DIMS (อ้างอิงเครื่องรุ่นที่ใช้ในห้องแลปทั่วไป ดู geometry.ts)
 *
 * จุดกำเนิดของโมเดล = กึ่งกลาง footprint บนพื้นโต๊ะ (รวมส่วนที่ยื่นจากแผงหน้า) · แผงหน้าหันไปทาง +z
 * ขั้วต่อของเครื่องแถวหลัง (แหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคป) อยู่ที่แผงหน้า ยื่นออกมาทาง +z — จุดต่อสาย = ปลายขั้ว
 * มัลติมิเตอร์วางหงาย: ขั้วเสียบอยู่บนหน้าเครื่องด้านผู้ใช้ — จุดต่อสาย = ปากรูเสียบ (สายเสียบลงแนวตั้ง)
 */

export const MM = 1 / 2.54;

const mats = new Map<string, THREE.Material>();
const mat = <T extends THREE.Material>(k: string, f: () => T): T => { let m = mats.get(k); if (!m) { m = f(); mats.set(k, m); } return m as T; };
const std = (c: number, r = 0.6, m = 0) => mat(`b${c}-${r}-${m}`, () => (m >= 0.5 ? withEnv(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })) : new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })));
const nickel = () => std(0xc9ccd0, 0.28, 1);
const brass = () => std(0xd8c27a, 0.3, 0.9);

/** ระยะยื่นของขั้ว binding post จากแผงหน้า (mm) และของ BNC */
const POST_LEN = 27;
const BNC_LEN = 16;

const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void, cache = true): THREE.CanvasTexture {
  const hit = cache ? texCache.get(key) : undefined;
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  draw(c.getContext('2d')!, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = key;
  if (cache) texCache.set(key, t);
  return t;
}

/** แผงพิมพ์ (หน่วย mm, จุดกำเนิดมุมซ้ายล่าง) — px ต่อ mm */
const PX = 4;
type Pen = { x: CanvasRenderingContext2D; X: (mm: number) => number; Y: (mm: number) => number; S: (mm: number) => number };
function panelTex(key: string, w: number, h: number, bg: string, draw: (p: Pen) => void): THREE.CanvasTexture {
  return canvasTex(key, w * PX, h * PX, (x, W, H) => {
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    draw({ x, X: (v) => v * PX, Y: (v) => H - v * PX, S: (v) => v * PX });
  });
}
function txt(p: Pen, s: string, cx: number, cy: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 600) {
  p.x.fillStyle = color; p.x.textAlign = align; p.x.textBaseline = 'middle';
  p.x.font = `${weight} ${p.S(size)}px "Chakra Petch", "Arial Narrow", sans-serif`;
  p.x.fillText(s, p.X(cx), p.Y(cy));
}
function rect(p: Pen, x0: number, y0: number, w: number, h: number, color: string, stroke = false, lw = 0.4) {
  if (stroke) { p.x.strokeStyle = color; p.x.lineWidth = p.S(lw); p.x.strokeRect(p.X(x0), p.Y(y0 + h), p.S(w), p.S(h)); }
  else { p.x.fillStyle = color; p.x.fillRect(p.X(x0), p.Y(y0 + h), p.S(w), p.S(h)); }
}
/** ขีดสเกลรอบปุ่มหมุน (270°) */
function ticks(p: Pen, cx: number, cy: number, r: number, n: number, color: string) {
  p.x.strokeStyle = color; p.x.lineWidth = Math.max(1.5, p.S(0.35));
  for (let i = 0; i <= n; i++) {
    const a = (-225 + (270 * i) / n) * (Math.PI / 180);
    const r0 = r * (i % 5 === 0 ? 0.84 : 0.91);
    p.x.beginPath(); p.x.moveTo(p.X(cx + Math.cos(a) * r0), p.Y(cy - Math.sin(a) * r0)); p.x.lineTo(p.X(cx + Math.cos(a) * r), p.Y(cy - Math.sin(a) * r)); p.x.stroke();
  }
}

/* ---------------- ชิ้นส่วนร่วม (mm) ---------------- */

/** ตัวเครื่องตั้งโต๊ะ: กล่องขอบมน + ขายาง + กรอบหน้า + แผงหน้า (texture) — คืนกลุ่มและฟังก์ชันแปลงพิกัดแผง → โลก */
function caseBody(kind: string, colors: { body: number; frame: number }, panel: THREE.Texture) {
  const { w, h, d, front } = BENCH_DIMS[kind];
  const g = new THREE.Group();
  const feet = 8, zf = (d + front) / 2 - front;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(w, h - feet, d, 4, 5), std(colors.body, 0.62));
  shell.position.set(0, feet + (h - feet) / 2, zf - d / 2);
  g.add(shell);
  // ขายาง 4 มุม
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, feet, 16), std(0x1d1f22, 0.9));
    f.position.set(sx * (w / 2 - 14), feet / 2, zf - d / 2 + sz * (d / 2 - 16));
    g.add(f);
  }
  // กรอบหน้า (ยื่นเล็กน้อย) + แผง
  const frame = new THREE.Mesh(new RoundedBoxGeometry(w - 0.5, h - feet + 1, 6, 3, 2.5), std(colors.frame, 0.5));
  frame.position.set(0, feet + (h - feet) / 2, zf - 2.5);
  g.add(frame);
  const pw = w - 10, ph = h - feet - 10;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: panel, roughness: 0.55 }));
  face.position.set(0, feet + 5 + ph / 2, zf + 0.6);
  g.add(face);
  // ช่องระบายอากาศด้านข้าง
  const vent = std(0x15181b, 0.8);
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(d * 0.45, Math.min(4, (h - feet) * 0.03)), vent);
    v.rotation.y = s * Math.PI / 2;
    v.position.set(s * (w / 2 + 0.04), feet + (h - feet) * 0.35 + i * (h - feet) * 0.055, zf - d * 0.55);
    g.add(v);
  }
  /** พิกัดบนแผง (mm จากมุมซ้ายล่างของแผง) → โลก (ผิวแผง) */
  const at = (px: number, py: number, dz = 0.6) => new THREE.Vector3(-pw / 2 + px, feet + 5 + py, zf + dz);
  return { g, at, pw, ph, zf };
}

/** ปุ่มหมุนแผงหน้า (แกนชี้ +z): ขอบโลหะ + ตัวจับมีร่อง + ฝา + ขีดชี้ */
function knob(r: number, angle: number, color = 0x2a2d31, depth = r * 0.9): THREE.Group {
  const g = new THREE.Group();
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.2, 1.6, 40), std(0xb8bdc2, 0.35, 0.9));
  skirt.position.y = 0.8;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r, depth, 36), std(color, 0.55));
  grip.position.y = 1.6 + depth / 2;
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.09, depth * 0.9, r * 0.09), std(color, 0.7), 24);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; m4.makeRotationY(a).setPosition(Math.sin(a) * r * 0.97, 1.6 + depth / 2, Math.cos(a) * r * 0.97); ribs.setMatrixAt(i, m4); }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.92, 0.8, 36), std(0x3a3e43, 0.4));
  cap.position.y = 1.6 + depth + 0.4;
  const ptr = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.8, r * 0.1), 0.3, r * 0.62), mat('ptrW', () => new THREE.MeshBasicMaterial({ color: 0xf2f4f0 })));
  ptr.position.set(0, 1.6 + depth + 0.85, -r * 0.42);
  const top = new THREE.Group();
  top.add(grip, ribs, cap, ptr);
  top.rotation.y = angle;
  g.add(skirt, top);
  g.rotation.x = Math.PI / 2;
  return g;
}

/** วงขอบสี่เหลี่ยมมุมมน (ขอบซองยาง): กว้าง w ลึก d หนา t รัศมีมุม rad สูง hgt — ฐานที่ y = 0 */
function roundedRing(w: number, d: number, t: number, rad: number, hgt: number): THREE.BufferGeometry {
  const rr = (W: number, D: number, r: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2 + r, -D / 2); sh.lineTo(W / 2 - r, -D / 2); sh.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
    sh.lineTo(W / 2, D / 2 - r); sh.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2); sh.lineTo(-W / 2 + r, D / 2);
    sh.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r); sh.lineTo(-W / 2, -D / 2 + r); sh.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
    return sh;
  };
  // ขอบ bevel 1.2 mm ทุกด้าน → ลดขนาดรูปร่างลงให้ขอบนอกเท่ากับ w × d
  const outer = rr(w - 2.4, d - 2.4, rad);
  outer.holes.push(rr(w - 2 * t + 2.4, d - 2 * t + 2.4, Math.max(1, rad - t / 2)) as unknown as THREE.Path);
  const geo = new THREE.ExtrudeGeometry(outer, { depth: hgt, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 2, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** ปุ่มกด/สวิตช์บนแผง */
function button(w: number, h: number, color: number, lit = false, depth = 4): THREE.Mesh {
  const m = lit
    ? mat(`btnLit${color}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85, roughness: 0.4 }))
    : std(color, 0.5);
  const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, depth, 2, Math.min(w, h) * 0.18), m);
  return b;
}

const tagPin = (o: THREE.Object3D, pin: string) => { o.traverse((c) => { c.userData.isPin = true; c.userData.pin = pin; }); };

/** พื้นที่แตะ (มองไม่เห็น) ของขั้วต่อ */
function hitCyl(r: number, len: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat('hit', () => new THREE.MeshBasicMaterial({ visible: false })));
  m.userData.noShadow = true;
  return m;
}

/**
 * ขั้ว binding post 4 mm แบบยื่นจากแผงหน้า (แกน +z): น็อตหกเหลี่ยม → ฉนวนสี → ฝาเกลียวมีร่อง → หัวโลหะรูบานาน่า
 * ปลายหัวโลหะอยู่ที่ z = POST_LEN (จุดต่อสาย)
 */
function bindingPost(color: number, pin: string | null): THREE.Group {
  const g = new THREE.Group();
  const parts = new THREE.Group();
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 2.5, 6), nickel());
  nut.position.y = 1.25;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.2, 9, 24), std(color, 0.42));
  body.position.y = 2.5 + 4.5;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6, 10, 28), std(color, 0.38));
  cap.position.y = 11.5 + 5;
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 9, 0.7), std(color, 0.5), 16);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; m4.makeRotationY(a).setPosition(Math.sin(a) * 5.75, 16.5, Math.cos(a) * 5.75); ribs.setMatrixAt(i, m4); }
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, POST_LEN - 21.5, 18), brass());
  stud.position.y = 21.5 + (POST_LEN - 21.5) / 2;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 14).rotateX(-Math.PI / 2), mat('bpHole', () => new THREE.MeshBasicMaterial({ color: 0x15130d })));
  hole.position.y = POST_LEN + 0.02;
  parts.add(nut, body, cap, ribs, stud, hole);
  g.add(parts);
  if (pin) {
    const hit = hitCyl(11, POST_LEN + 4);
    hit.position.y = (POST_LEN + 4) / 2;
    g.add(hit);
    tagPin(g, pin);
  }
  g.rotation.x = Math.PI / 2; // แกน +y ของชิ้น → +z ของโลก
  return g;
}

/** ขั้ว BNC (แกน +z): หน้าแปลนสี่เหลี่ยม + กระบอกนิกเกิลมีหมุดล็อก + ฉนวนขาว + ขาเข็มกลาง · ปลายกระบอกที่ z = BNC_LEN */
function bnc(ring: number, pin: string | null): THREE.Group {
  const g = new THREE.Group();
  const flange = new THREE.Mesh(new THREE.BoxGeometry(14, 2, 14), nickel());
  flange.position.y = 1;
  const ringM = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 1.2, 28), std(ring, 0.45));
  ringM.position.y = 2.6;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(4.75, 4.75, BNC_LEN - 3.2, 28, 1, true), nickel());
  barrel.position.y = 3.2 + (BNC_LEN - 3.2) / 2;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.45, 8, 28).rotateX(Math.PI / 2), nickel());
  lip.position.y = BNC_LEN - 0.4;
  const ins = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, BNC_LEN - 5, 24), std(0xe9e6dc, 0.6));
  ins.position.y = 3 + (BNC_LEN - 5) / 2;
  const pinM = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 10), brass());
  pinM.position.y = BNC_LEN - 4;
  const lugs = new THREE.Group();
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 8).rotateZ(Math.PI / 2), nickel()); l.position.set(s * 5.6, BNC_LEN - 4.5, 0); lugs.add(l); }
  g.add(flange, ringM, barrel, lip, ins, pinM, lugs);
  if (pin) { const hit = hitCyl(10, BNC_LEN + 3); hit.position.y = (BNC_LEN + 3) / 2; g.add(hit); tagPin(g, pin); }
  g.rotation.x = Math.PI / 2;
  return g;
}

/** รูเสียบบานาน่าแบบมีปลอกกันนิ้ว (มัลติมิเตอร์) แกน +y: ขอบปลอกสูงจากหน้าเครื่อง 2.5 mm · ปากรูที่ y = 2.5 */
function safetyJack(color: number, pin: string | null): THREE.Group {
  const g = new THREE.Group();
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 2.5, 28, 1, true), std(color, 0.45));
  shroud.position.y = 1.25;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6, 0.6, 8, 28).rotateX(Math.PI / 2), std(color, 0.45));
  rim.position.y = 2.5;
  const well = new THREE.Mesh(new THREE.CircleGeometry(5.6, 24).rotateX(-Math.PI / 2), mat('jackWell', () => new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 })));
  well.position.y = 0.4;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.2, 16), nickel());
  socket.position.y = 0.6;
  const holeM = new THREE.Mesh(new THREE.CircleGeometry(1.9, 14).rotateX(-Math.PI / 2), mat('bpHole', () => new THREE.MeshBasicMaterial({ color: 0x15130d })));
  holeM.position.y = 1.22;
  g.add(shroud, rim, well, socket, holeM);
  if (pin) {
    // ส่วนที่มองเห็น (ปากรู) ต้องแตะจุดต่อสาย (y = 2.5) — ใช้ขอบปลอก
    const hit = hitCyl(9, 8); hit.position.y = 3; g.add(hit);
    tagPin(g, pin);
  }
  return g;
}

/* ---------------- จอแสดงผล ---------------- */

const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', ' ': '', A: 'abcefg', b: 'cdefg', C: 'adef', c: 'deg', d: 'bcdeg', E: 'adefg', F: 'aefg', H: 'bcefg', L: 'def', o: 'cdeg', O: 'abcdef',
  P: 'abefg', r: 'eg', n: 'ceg', U: 'bcdef', u: 'cde', t: 'defg', S: 'afgcd',
};

/** วาดตัวเลข 7 ส่วน (ชิดขวาที่ right) คืนความกว้างที่ใช้ */
export function drawSegments(x: CanvasRenderingContext2D, text: string, right: number, top: number, h: number, on: string, off: string | null, cells = 0) {
  const cw = h * 0.58, gap = h * 0.16, t = h * 0.12, sl = h * 0.08;
  const glyphs: Array<{ ch: string; dp: boolean }> = [];
  for (const ch of text) {
    if (ch === '.' && glyphs.length) glyphs[glyphs.length - 1].dp = true;
    else if (ch === '.') glyphs.push({ ch: ' ', dp: true });
    else glyphs.push({ ch, dp: false });
  }
  while (glyphs.length < cells) glyphs.unshift({ ch: ' ', dp: false });
  const n = glyphs.length;
  const seg = (ox: number, oy: number, s: string, lit: boolean) => {
    if (!lit && !off) return;
    x.fillStyle = lit ? on : off!;
    const W = cw, H = h, hh = H / 2;
    // จุดยอดของแต่ละส่วน (พิกัดไม่เอียง) แล้วเอียงตาม y
    const P: Record<string, number[][]> = {
      a: [[t * 0.6, 0], [W - t * 0.6, 0], [W - t * 1.4, t], [t * 1.4, t]],
      d: [[t * 1.4, H - t], [W - t * 1.4, H - t], [W - t * 0.6, H], [t * 0.6, H]],
      g: [[t * 0.9, hh], [t * 1.5, hh - t / 2], [W - t * 1.5, hh - t / 2], [W - t * 0.9, hh], [W - t * 1.5, hh + t / 2], [t * 1.5, hh + t / 2]],
      f: [[0, t * 0.6], [t, t * 1.4], [t, hh - t * 0.6], [t / 2, hh - t * 0.1], [0, hh - t * 0.6]],
      b: [[W, t * 0.6], [W, hh - t * 0.6], [W - t / 2, hh - t * 0.1], [W - t, hh - t * 0.6], [W - t, t * 1.4]],
      e: [[0, hh + t * 0.6], [t / 2, hh + t * 0.1], [t, hh + t * 0.6], [t, H - t * 1.4], [0, H - t * 0.6]],
      c: [[W, hh + t * 0.6], [W, H - t * 0.6], [W - t, H - t * 1.4], [W - t, hh + t * 0.6], [W - t / 2, hh + t * 0.1]],
    };
    x.beginPath();
    P[s].forEach(([px, py], i) => { const X = ox + px + sl * (1 - py / H), Y = oy + py; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
    x.closePath(); x.fill();
  };
  for (let i = 0; i < n; i++) {
    const ox = right - (n - i) * (cw + gap), g = glyphs[i];
    const lit = SEG[g.ch] ?? '';
    for (const s of 'abcdefg') seg(ox, top, s, lit.includes(s));
    if (g.dp || off) { x.fillStyle = g.dp ? on : off!; x.beginPath(); x.arc(ox + cw + gap * 0.45, top + h - t * 0.5, t * 0.62, 0, Math.PI * 2); x.fill(); }
  }
  return n * (cw + gap);
}

/** จอ LED 7 ส่วนของแหล่งจ่าย (แรงดันสีแดง กระแสสีเขียว) — draw(lines, badge) แบบเดียวกับ LcdScreen */
export class SegDisplay {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  private shown = '';
  constructor(w: number, h: number) {
    this.canvas.width = Math.round(w * 6); this.canvas.height = Math.round(h * 6);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.draw(['- - -', '- - -'], '');
  }
  draw(lines: string[], badge: string) {
    const key = lines.join('\n') + '|' + badge;
    if (key === this.shown) return;
    this.shown = key;
    const x = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    x.fillStyle = '#120708'; x.fillRect(0, 0, W, H);
    const num = (s: string | undefined) => (s ?? '').replace(/[^0-9.\- ]/g, '').trim() || '- - -';
    const half = W / 2;
    const dh = H * 0.42, top = H * 0.22;
    const col = [['#ff3b2a', 'rgba(255,59,42,0.07)'], ['#3dff6e', 'rgba(61,255,110,0.06)']] as const;
    [num(lines[0]), num(lines[1])].forEach((s, i) => {
      const right = half * (i + 1) - W * 0.07;
      drawSegments(x, s.replace(/ /g, ''), right, top, dh, col[i][0], col[i][1], 4);
      x.fillStyle = col[i][0]; x.font = `700 ${Math.round(H * 0.2)}px "Chakra Petch", sans-serif`; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillText(i ? 'A' : 'V', right + W * 0.012, top + dh);
    });
    // ไฟแสดงโหมด
    const b = badge.toUpperCase();
    const leds: Array<[string, boolean, string]> = [['C.V', b.includes('CV'), '#3dff6e'], ['C.C', b.includes('CC'), '#ff3b2a'], ['OUT', !b.includes('OFF') && !b.includes('SET') && !b.includes('ERR') && !!b, '#ffb020']];
    leds.forEach(([t, on, c], i) => {
      const cx = W * (0.2 + i * 0.3), cy = H * 0.86;
      x.fillStyle = on ? c : 'rgba(255,255,255,0.08)'; x.beginPath(); x.arc(cx - W * 0.05, cy, H * 0.035, 0, Math.PI * 2); x.fill();
      x.fillStyle = on ? c : 'rgba(255,255,255,0.25)'; x.font = `600 ${Math.round(H * 0.09)}px "Chakra Petch", sans-serif`; x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText(t, cx - W * 0.02, cy);
    });
    if (b.includes('SET')) { x.fillStyle = 'rgba(255,200,120,0.75)'; x.font = `600 ${Math.round(H * 0.09)}px "Chakra Petch", sans-serif`; x.textAlign = 'right'; x.fillText('SET', W * 0.97, H * 0.1); }
    this.texture.needsUpdate = true;
  }
}

/** จอข้อความ (VFD ของเครื่องกำเนิดสัญญาณ) — draw(lines, badge) */
export class TextScreen {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  private shown = '';
  constructor(w: number, h: number, private fg = '#7ff3e4', private bg = '#071513') {
    this.canvas.width = Math.round(w * 6); this.canvas.height = Math.round(h * 6);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.draw(['- - -'], '');
  }
  draw(lines: string[], badge: string) {
    const key = lines.join('\n') + '|' + badge;
    if (key === this.shown) return;
    this.shown = key;
    const x = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    x.fillStyle = this.bg; x.fillRect(0, 0, W, H);
    x.fillStyle = this.fg; x.textBaseline = 'middle';
    const lh = H / (lines.length + 0.7);
    lines.forEach((l, i) => {
      x.font = `600 ${Math.floor(lh * (i ? 0.62 : 0.78))}px "Chakra Petch", monospace`;
      x.textAlign = 'right';
      x.fillText(l, W * 0.97, lh * (i + 0.62));
    });
    if (badge) { x.font = `700 ${Math.floor(lh * 0.4)}px "Chakra Petch", monospace`; x.textAlign = 'left'; x.fillText(badge, W * 0.03, H - lh * 0.3); }
    this.texture.needsUpdate = true;
  }
}

/** จอ LCD ของมัลติมิเตอร์ดิจิทัล: ตัวเลข 7 ส่วนใหญ่ + เครื่องหมายลบ + สัญลักษณ์ AUTO/DC/AC + หน่วย */
export class DmmLcd {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  private shown = '';
  constructor(w: number, h: number) {
    this.canvas.width = Math.round(w * 8); this.canvas.height = Math.round(h * 8);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.35 }));
    this.show({ text: '', unit: '', ann: '', ol: false });
  }
  show(d: DmmDisplay) {
    const key = `${d.text}|${d.unit}|${d.ann}`;
    if (key === this.shown) return;
    this.shown = key;
    const x = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    x.fillStyle = '#aab79a'; x.fillRect(0, 0, W, H);
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    if (!d.text && !d.unit) { this.texture.needsUpdate = true; return; } // ปิดเครื่อง: จอว่าง
    const ink = '#1a2116', ghost = 'rgba(26,33,22,0.06)';
    const neg = d.text.startsWith('-');
    const body = neg ? d.text.slice(1) : d.text;
    const dh = H * 0.56, top = H * 0.24, right = W * 0.8;
    drawSegments(x, body === 'OL' ? '0.L' : body, right, top, dh, ink, ghost, 4);
    if (neg) { x.fillStyle = ink; x.fillRect(W * 0.05, top + dh / 2 - dh * 0.06, W * 0.07, dh * 0.12); }
    x.fillStyle = ink; x.textBaseline = 'middle';
    x.font = `700 ${Math.round(H * 0.16)}px "Chakra Petch", sans-serif`; x.textAlign = 'left';
    x.fillText(d.ann, W * 0.05, H * 0.12);
    x.font = `700 ${Math.round(H * 0.22)}px "Chakra Petch", sans-serif`;
    x.fillText(d.unit, W * 0.82, top + dh * 0.78);
    this.texture.needsUpdate = true;
  }
}

/** จอออสซิลโลสโคป (canvas texture ที่ UI วาดรูปคลื่นลงไป) */
export class ScopeScreen {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  constructor(w: number, h: number) {
    this.canvas.width = 640; this.canvas.height = Math.round((640 * h) / w);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.clear('NO SIGNAL');
  }
  clear(text = '') {
    const x = this.canvas.getContext('2d', { willReadFrequently: true })!;
    const W = this.canvas.width, H = this.canvas.height;
    x.fillStyle = '#0c1714'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(160,200,185,0.22)'; x.lineWidth = 1;
    for (let i = 1; i < 10; i++) { x.beginPath(); x.moveTo((W * i) / 10, 0); x.lineTo((W * i) / 10, H); x.stroke(); }
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(0, (H * i) / 8); x.lineTo(W, (H * i) / 8); x.stroke(); }
    if (text) { x.fillStyle = 'rgba(200,230,215,0.7)'; x.font = '600 30px "Chakra Petch", monospace'; x.textAlign = 'center'; x.fillText(text, W / 2, H / 2 + 10); }
    this.texture.needsUpdate = true;
  }
}

/* ---------------- ตำแหน่งขั้วต่อ (mm บนแผงหน้า) ---------------- */

/** ขั้วของเครื่องแถวหลัง: [x, y] บนแผง (mm จากมุมซ้ายล่าง) และชนิดขั้ว */
const ROW_PINS: Record<string, Record<string, { px: number; py: number; type: 'post' | 'bnc' }>> = {
  dcsupply: { pos: { px: 70, py: 18, type: 'post' }, neg: { px: 106, py: 18, type: 'post' } },
  fgen: { OUT: { px: 200, py: 16, type: 'post' }, COM: { px: 226, py: 16, type: 'post' } },
  scope: { CH1: { px: 226, py: 22, type: 'bnc' }, CH2: { px: 256, py: 22, type: 'bnc' }, GND: { px: 288, py: 22, type: 'post' } },
};
/** ขั้วของมิเตอร์วางหงาย: [x, z] บนหน้าเครื่อง (mm จากกึ่งกลาง) */
const DMM_JACKS: Record<string, [number, number]> = { A10: [-30, 62], mA: [-10, 62], COM: [10, 62], V: [30, 62] };
const VOM_JACKS: Record<string, [number, number]> = { P: [46, 64], COM: [-46, 64] };
/** ความสูงหน้าเครื่องมิเตอร์ (mm) */
const DMM_FACE_Y = 44;
const VOM_FACE_Y = 38;

/** ตำแหน่งจุดต่อสาย (หน่วยรู, ก่อนหมุน, จุดกำเนิด = กึ่งกลาง footprint บนพื้นโต๊ะ) — null ถ้าไม่ใช่เครื่องมือขนาดจริง */
export function benchPinLocal(part: Part, pin: string): THREE.Vector3 | null {
  const k = part.kind;
  const rp = ROW_PINS[k]?.[pin];
  if (rp) {
    const { w, d, front } = BENCH_DIMS[k];
    const zf = (d + front) / 2 - front;
    const len = rp.type === 'bnc' ? BNC_LEN : POST_LEN;
    return new THREE.Vector3(-(w - 10) / 2 + rp.px, 8 + 5 + rp.py, zf + 0.6 + len).multiplyScalar(MM);
  }
  if (k === 'dmm' || k === 'ammeter') {
    const j = DMM_JACKS[k === 'ammeter' ? (pin === 'A' ? 'mA' : pin) : pin];
    if (j) return new THREE.Vector3(j[0], DMM_FACE_Y + 2.5, j[1]).multiplyScalar(MM);
  }
  if (k === 'vom') {
    const j = VOM_JACKS[pin];
    if (j) return new THREE.Vector3(j[0], VOM_FACE_Y + 2.5, j[1]).multiplyScalar(MM);
  }
  return null;
}

/** ทิศที่สายออกจากขั้ว (ก่อนหมุน) */
export function benchPinDir(part: Part): THREE.Vector3 {
  return ROW_PINS[part.kind] ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
}

/** กลุ่มรากหน่วยรู + กลุ่มลูกหน่วย mm */
function roots() {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  return { root, g };
}

function addRowPins(kind: string, g: THREE.Group, at: (x: number, y: number, dz?: number) => THREE.Vector3, colors: Record<string, number>, rings: Record<string, number> = {}) {
  for (const [pin, d] of Object.entries(ROW_PINS[kind])) {
    const o = d.type === 'bnc' ? bnc(rings[pin] ?? 0x888888, pin) : bindingPost(colors[pin] ?? 0x22262a, pin);
    o.position.copy(at(d.px, d.py));
    g.add(o);
  }
}

/* ---------------- แหล่งจ่ายไฟ DC (128 × 145 × 285 mm) ---------------- */

export function buildBenchSupply(voltage: number, currentLimit: number, outputOn: boolean): THREE.Group {
  const { root, g } = roots();
  const kind = 'dcsupply';
  const panel = panelTex('benchSupplyPanel', 118, 127, '#2e3432', (p) => {
    txt(p, 'DC POWER SUPPLY', 6, 124, 4.2, '#e4e9e5', 'left', 700);
    txt(p, '0–30 V  0–3 A', 112, 124, 3.2, '#a8b3ad', 'right');
    rect(p, 5, 82, 108, 38, '#0b0d0d');
    for (const [cx, lab] of [[30, 'VOLTAGE'], [88, 'CURRENT']] as const) {
      ticks(p, cx, 52, 19, 20, '#a8b3ad');
      txt(p, lab, cx, 75, 3.6, '#e4e9e5');
      txt(p, 'MIN', cx - 17, 36, 2.4, '#a8b3ad'); txt(p, 'MAX', cx + 17, 36, 2.4, '#a8b3ad');
    }
    txt(p, 'POWER', 14, 6, 2.8, '#a8b3ad');
    txt(p, 'OUTPUT', 40, 6, 2.8, '#a8b3ad');
    txt(p, '+', 70, 5, 6, '#ff6b5e', 'center', 700);
    txt(p, 'GND', 88, 6, 2.8, '#9fd8a8');
    txt(p, '−', 106, 5, 6, '#e4e9e5', 'center', 700);
    p.x.strokeStyle = '#7d8a84'; p.x.lineWidth = p.S(0.4); p.x.strokeRect(p.X(58), p.Y(32), p.S(60), p.S(29));
  });
  const { g: body, at } = caseBody(kind, { body: 0xd9dcd6, frame: 0x24292a }, panel);
  g.add(body);
  const disp = new SegDisplay(104, 34);
  disp.mesh.position.copy(at(59, 101, 0.8));
  g.add(disp.mesh);
  root.userData.lcd = disp;
  for (const [cx, frac] of [[30, voltage / 30], [88, Math.min(1, currentLimit / 3)]] as const) {
    const k = knob(13, -(-2.36 + Math.max(0, Math.min(1, frac)) * 4.71), 0x26292d, 13);
    k.position.copy(at(cx, 52));
    g.add(k);
  }
  const pw = button(10, 14, 0x1a1d22, false, 5); pw.position.copy(at(14, 18, 2.5)); g.add(pw);
  const out = button(14, 9, outputOn ? 0x4fbf6a : 0x3b4440, outputOn, 4); out.position.copy(at(40, 18, 2)); g.add(out);
  const gnd = bindingPost(0x2f9e4f, null);
  gnd.position.copy(at(88, 18)); g.add(gnd);
  addRowPins(kind, g, at, { pos: 0xc8372d, neg: 0x22262a });
  return root;
}

/* ---------------- เครื่องกำเนิดสัญญาณ (251 × 91 × 291 mm) ---------------- */

const WAVES = ['sine', 'square', 'triangle', 'dc'] as const;

export function buildBenchFgen(wave: string, outputOn: boolean): THREE.Group {
  const { root, g } = roots();
  const kind = 'fgen';
  const panel = panelTex('benchFgenPanel', 241, 73, '#28303d', (p) => {
    txt(p, 'FUNCTION GENERATOR', 8, 68, 4, '#dfe5ee', 'left', 700);
    txt(p, '0.1 Hz – 3 MHz', 128, 68, 3, '#9fb0c6', 'right');
    rect(p, 6, 30, 124, 33, '#05100f');
    ['SINE', 'SQR', 'TRI', 'DC'].forEach((t, i) => txt(p, t, 36 + i * 22, 6, 2.6, '#9fb0c6'));
    txt(p, 'POWER', 12, 6, 2.6, '#9fb0c6');
    txt(p, 'OUTPUT', 122, 6, 2.6, '#9fb0c6');
    ticks(p, 158, 44, 22, 30, '#9fb0c6'); txt(p, 'FREQUENCY', 158, 67, 3.2, '#dfe5ee');
    for (const [cx, lab] of [[194, 'AMPL'], [224, 'OFFSET']] as const) { ticks(p, cx, 50, 13, 10, '#9fb0c6'); txt(p, lab, cx, 66, 2.8, '#dfe5ee'); }
    txt(p, 'OUTPUT 50 Ω', 213, 32, 2.8, '#dfe5ee');
    txt(p, 'OUT', 200, 4, 2.6, '#ff8a7d'); txt(p, 'COM', 226, 4, 2.6, '#dfe5ee');
    txt(p, 'TTL', 178, 4, 2.4, '#9fb0c6');
    p.x.strokeStyle = '#7686a0'; p.x.lineWidth = p.S(0.4); p.x.strokeRect(p.X(166), p.Y(37), p.S(72), p.S(36));
  });
  const { g: body, at } = caseBody(kind, { body: 0xc9cdd3, frame: 0x1e242d }, panel);
  g.add(body);
  const lcd = new TextScreen(118, 28);
  lcd.mesh.position.copy(at(68, 46.5, 0.8));
  g.add(lcd.mesh);
  root.userData.lcd = lcd;
  const kf = knob(16, -0.8, 0x2a2d31, 14); kf.position.copy(at(158, 44)); g.add(kf);
  for (const cx of [194, 224]) { const k = knob(9, 0.6, 0x2a2d31, 10); k.position.copy(at(cx, 50)); g.add(k); }
  WAVES.forEach((w, i) => { const b = button(16, 8, wave === w ? 0x8fe0a0 : 0x4a5466, wave === w, 4); b.position.copy(at(36 + i * 22, 15, 2)); g.add(b); });
  const pw = button(12, 9, 0x1a1d22, false, 4); pw.position.copy(at(12, 15, 2)); g.add(pw);
  const ob = button(14, 8, outputOn ? 0xffb020 : 0x4a5466, outputOn, 4); ob.position.copy(at(122, 15, 2)); g.add(ob);
  const ttl = bnc(0x6b7686, null); ttl.position.copy(at(178, 16)); g.add(ttl);
  addRowPins(kind, g, at, { OUT: 0xc8372d, COM: 0x22262a });
  return root;
}

/* ---------------- ออสซิลโลสโคปดิจิทัล (313 × 161 × 122 mm) ---------------- */

export function buildBenchScope(): THREE.Group {
  const { root, g } = roots();
  const kind = 'scope';
  const panel = panelTex('benchScopePanel', 303, 143, '#d4d7d2', (p) => {
    rect(p, 4, 12, 184, 126, '#2a2d30');
    txt(p, 'DIGITAL OSCILLOSCOPE', 200, 138, 3.6, '#2a2f33', 'left', 700);
    txt(p, '2 CH · 50 MHz · 1 GSa/s', 200, 132, 2.6, '#5b6460', 'left');
    txt(p, 'HORIZONTAL', 226, 117, 2.8, '#2a2f33'); ticks(p, 226, 100, 14, 20, '#5b6460'); txt(p, 'TIME/DIV', 226, 84, 2.4, '#5b6460');
    txt(p, 'TRIGGER', 282, 117, 2.8, '#2a2f33'); ticks(p, 282, 100, 10, 10, '#5b6460'); txt(p, 'LEVEL', 282, 88, 2.4, '#5b6460');
    txt(p, 'VERTICAL', 241, 78, 2.8, '#2a2f33');
    for (const [cx, lab, col] of [[226, 'CH1', '#b08d00'], [256, 'CH2', '#1f8fae']] as const) {
      ticks(p, cx, 54, 11, 10, '#5b6460'); txt(p, `${lab} SCALE`, cx, 42, 2.3, col);
      txt(p, lab, cx, 6, 3, col, 'center', 700);
    }
    txt(p, 'GND', 288, 6, 2.8, '#2a2f33', 'center', 700);
    txt(p, '1 MΩ ≤ 300 Vpk', 256, 36, 2.2, '#5b6460');
    txt(p, 'RUN/STOP', 214, 124, 2, '#2a2f33'); txt(p, 'AUTO', 238, 124, 2, '#2a2f33');
    for (let i = 0; i < 5; i++) rect(p, 192, 26 + i * 22, 6, 12, '#bfc3be');
  });
  const { g: body, at } = caseBody(kind, { body: 0xc6c9c4, frame: 0xb4b8b2 }, panel);
  g.add(body);
  const screen = new ScopeScreen(160, 112);
  screen.mesh.position.copy(at(96, 75, 0.8));
  g.add(screen.mesh);
  root.userData.scopeScreen = screen;
  for (const [cx, cy, r] of [[226, 100, 10], [282, 100, 7], [226, 54, 8], [256, 54, 8], [226, 68, 5], [256, 68, 5]] as const) {
    const k = knob(r, cx * 0.03, 0x2a2d31, r * 0.9); k.position.copy(at(cx, cy)); g.add(k);
  }
  const rs = button(14, 7, 0x7fd18e, true, 4); rs.position.copy(at(214, 128, 2)); g.add(rs);
  const au = button(14, 7, 0x8a8f92, false, 4); au.position.copy(at(238, 128, 2)); g.add(au);
  const pwr = button(9, 9, 0x2a2d30, false, 3); pwr.position.copy(at(10, 6, 1.5)); g.add(pwr);
  addRowPins(kind, g, at, { GND: 0x22262a }, { CH1: 0xe8c21f, CH2: 0x31b5d6 });
  return root;
}

/* ---------------- มัลติมิเตอร์ดิจิทัล (91 × 49.5 × 183 mm วางหงาย) ---------------- */

/** มุมก้านสวิตช์ (องศา จากด้านบน ตามเข็มนาฬิกา) */
export function dmmDialAngle(mode: string): number { return DMM_MODES.find((m) => m.id === mode)?.angle ?? 0; }

export function buildDmm(mode: string, ammeterOnly = false): THREE.Group {
  const { root, g } = roots();
  const { w, h, d } = BENCH_DIMS.dmm;
  // ซองยางกันกระแทก (เหลือง): ฐาน + ขอบกันกระแทกยกสูงรอบหน้าเครื่อง (หน้าเครื่องจมลงจากขอบ 5.5 mm)
  const base = new THREE.Mesh(new RoundedBoxGeometry(w, DMM_FACE_Y - 2, d, 4, 8), std(0xe0a526, 0.78));
  base.position.y = (DMM_FACE_Y - 2) / 2;
  const rim = new THREE.Mesh(roundedRing(w, d, 12, 7, h - DMM_FACE_Y + 4), std(0xe0a526, 0.78));
  rim.position.y = DMM_FACE_Y - 4;
  const bodyTop = new THREE.Mesh(new RoundedBoxGeometry(w - 12, 4, d - 12, 3, 1.5), std(0x2b2f36, 0.55));
  bodyTop.position.y = DMM_FACE_Y - 2;
  g.add(base, rim, bodyTop);
  const fw = w - 14, fd = d - 16;
  const face = panelTex(`dmmFace:${ammeterOnly ? 'amm' : 'dmm'}`, fw, fd, '#2b2f36', (p) => {
    // พิกัดแผง: x 0 = ซ้าย, y 0 = ขอบด้านผู้ใช้ (+z) → y เพิ่มไปทางจอ
    const Y = (z: number) => fd / 2 - z; // z (โลก, mm) → y แผง
    const X = (x: number) => x + fw / 2;
    txt(p, ammeterOnly ? 'DIGITAL AMMETER' : 'DIGITAL MULTIMETER', X(-fw / 2 + 4), Y(-80.5), 3, '#e8ecef', 'left', 700);
    txt(p, '4000 COUNTS', X(fw / 2 - 4), Y(-80.5), 2.3, '#9aa4ad', 'right');
    rect(p, X(-33), Y(-42), 66, 36, '#15181c');
    ['HOLD', 'RANGE', 'REL', 'LIGHT'].forEach((t, i) => txt(p, t, X(-27 + i * 18), Y(-30.5), 2.3, '#9aa4ad'));
    // สเกลรอบสวิตช์
    for (const m of DMM_MODES) {
      const a = (m.angle * Math.PI) / 180;
      const r = 29;
      const on = ammeterOnly ? m.id === 'dcma' : m.id === mode;
      txt(p, m.dial, X(Math.sin(a) * r), Y(5 - Math.cos(a) * r), m.dial.length > 2 ? 3.2 : 3.8, on ? '#ffd166' : m.id === 'off' ? '#e8ecef' : '#e8ecef', 'center', 700);
      p.x.fillStyle = '#9aa4ad'; p.x.beginPath(); p.x.arc(p.X(X(Math.sin(a) * 22.5)), p.Y(Y(5 - Math.cos(a) * 22.5)), p.S(0.7), 0, Math.PI * 2); p.x.fill();
    }
    const lab: Record<string, [string, string]> = { A10: ['10A', 'MAX FUSED'], mA: ['mA µA', '400mA FUSED'], COM: ['COM', ''], V: ['VΩ', ''] };
    for (const [pin, [x, z]] of Object.entries(DMM_JACKS)) {
      txt(p, lab[pin][0], X(x), Y(z + 12), 2.9, pin === 'COM' ? '#e8ecef' : '#ff8a7d', 'center', 700);
      if (lab[pin][1]) txt(p, lab[pin][1], X(x), Y(z + 16.5), 1.8, '#9aa4ad');
    }
  });
  const faceM = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }));
  faceM.position.y = DMM_FACE_Y;
  g.add(faceM);
  const lcd = new DmmLcd(62, 33);
  lcd.mesh.position.set(0, DMM_FACE_Y + 0.15, -60);
  g.add(lcd.mesh);
  root.userData.dmmLcd = lcd;
  for (let i = 0; i < 4; i++) { const b = button(13, 7, 0x4a5058, false, 2.4); b.rotation.x = -Math.PI / 2; b.position.set(-27 + i * 18, DMM_FACE_Y + 1, -36); g.add(b); }
  // สวิตช์หมุน: แป้นกลม + ก้านจับ + ขีดชี้
  const dial = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(20, 21, 4, 40), std(0x1b1e22, 0.5));
  disc.position.y = 2;
  const bar = new THREE.Mesh(new RoundedBoxGeometry(9, 8, 40, 2, 3), std(0x24282d, 0.5));
  bar.position.y = 4 + 4;
  const ptr = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 12), mat('ptrW', () => new THREE.MeshBasicMaterial({ color: 0xf2f4f0 })));
  ptr.position.set(0, 12.2, -13);
  dial.add(disc, bar, ptr);
  dial.rotation.y = -(dmmDialAngle(ammeterOnly ? 'dcma' : mode) * Math.PI) / 180;
  dial.position.set(0, DMM_FACE_Y, 5);
  g.add(dial);
  const pins: Record<string, string | null> = ammeterOnly ? { A10: null, mA: 'A', COM: 'COM', V: null } : { A10: 'A10', mA: 'mA', COM: 'COM', V: 'V' };
  for (const [jk, [x, z]] of Object.entries(DMM_JACKS)) {
    const j = safetyJack(jk === 'COM' ? 0x22262a : 0xc8372d, pins[jk]);
    j.position.set(x, DMM_FACE_Y, z);
    g.add(j);
  }
  return root;
}

/* ---------------- มัลติมิเตอร์แบบเข็ม (129 × 41.5 × 159.5 mm วางหงาย) ---------------- */

/** มุมเข็ม (เรเดียน, 0 = ชี้ตรงไปด้านหลัง) จากสัดส่วนการตี f — ช่วงสเกล ±45° จำกัดที่หมุดกั้นเข็ม */
export function vomNeedleAngle(f: number): number {
  const c = Math.max(-0.06, Math.min(1.08, f));
  return ((-45 + 90 * c) * Math.PI) / 180;
}

/** แผ่นสเกล (mm บนหน้าเครื่อง): กึ่งกลาง z, ขนาด · แกนเข็มอยู่ใต้ขอบล่างของแผ่นสเกล (ซ่อนใต้ฝาครอบ) */
const PLATE = { z: -42, w: 112, d: 60 };
const PIVZ = 2;
const DIAL_Z = 38;
const R_OHM = 66, R_DC = 58, R_AC = 40;

export function buildVom(sel: string, center = 20): THREE.Group {
  const { root, g } = roots();
  const { w, d } = BENCH_DIMS.vom;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(w, VOM_FACE_Y, d, 4, 7), std(0x26282c, 0.6));
  shell.position.y = VOM_FACE_Y / 2;
  g.add(shell);
  const fw = w - 8, fd = d - 8;
  const pos = vomPosition(sel);
  const face = panelTex(`vomFace:${sel}`, fw, fd, '#1d1f22', (p) => {
    const Y = (z: number) => fd / 2 - z, X = (x: number) => x + fw / 2;
    txt(p, 'ANALOG MULTITESTER', X(0), Y(-73), 2.8, '#e8ecef', 'center', 700);
    txt(p, 'DC 20kΩ/V', X(46), Y(-5), 2, '#9aa4ad'); txt(p, 'AC 9kΩ/V', X(46), Y(-1.5), 2, '#9aa4ad');
    txt(p, 'FUSE 0.5A', X(-46), Y(-3), 2, '#9aa4ad');
    for (const q of VOM_POSITIONS) {
      const a = (q.angle * Math.PI) / 180, r = 29.5;
      const col = q.id === sel ? '#ffd166' : q.mode === 'acv' ? '#ff8a7d' : q.mode === 'ohm' ? '#9fd8a8' : q.mode === 'dca' ? '#8ecbff' : '#e8ecef';
      txt(p, q.dial, X(Math.sin(a) * r), Y(DIAL_Z - Math.cos(a) * r), 2.4, col, 'center', 700);
    }
    const head = (deg: number, t: string, col: string) => { const a = (deg * Math.PI) / 180; txt(p, t, X(Math.sin(a) * 36.5), Y(DIAL_Z - Math.cos(a) * 36.5), 2.4, col, 'center', 700); };
    head(72, 'DCV', '#e8ecef'); head(171, 'ACV', '#ff8a7d'); head(243, 'DCA', '#8ecbff'); head(315, 'Ω', '#9fd8a8');
    txt(p, '0Ω ADJ', X(48), Y(21), 2, '#9aa4ad');
    txt(p, '+', X(46), Y(72), 4.2, '#ff8a7d', 'center', 700);
    txt(p, '− COM', X(-46), Y(72), 2.8, '#e8ecef', 'center', 700);
  });
  const faceM = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }));
  faceM.position.y = VOM_FACE_Y + 0.06;
  g.add(faceM);
  // แผ่นสเกลสีขาว: Ω (ไม่เชิงเส้น ∞ ซ้าย → 0 ขวา) · แถบกระจก · DCV·A 0–10/50/250 · ACV (แดง)
  const { w: sw, d: sd } = PLATE;
  const scale = canvasTex(`vomScale:${center}`, sw * 8, sd * 8, (x, W) => {
    const s = W / sw;
    x.fillStyle = '#f4f1e6'; x.fillRect(0, 0, W, sd * s);
    const cx = W / 2, cy = (PIVZ - (PLATE.z - sd / 2)) * s;
    const A = (f: number) => (-90 - 45 + 90 * f) * (Math.PI / 180);
    const arc = (r: number, col: string, lw: number) => { x.strokeStyle = col; x.lineWidth = lw * s; x.beginPath(); x.arc(cx, cy, r * s, A(0), A(1)); x.stroke(); };
    const tick = (r: number, f: number, len: number, col: string, lw = 0.25) => {
      const a = A(f); x.strokeStyle = col; x.lineWidth = lw * s; x.beginPath();
      x.moveTo(cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s); x.lineTo(cx + Math.cos(a) * (r + len) * s, cy + Math.sin(a) * (r + len) * s); x.stroke();
    };
    const label = (r: number, f: number, t: string, col: string, size: number) => {
      const a = A(f); x.save(); x.translate(cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s); x.rotate(a + Math.PI / 2);
      x.fillStyle = col; x.font = `600 ${size * s}px "Chakra Petch", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, 0, 0); x.restore();
    };
    arc(R_OHM, '#1f6b3a', 0.35);
    for (const R of [0, 1, 2, 3, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000]) { const f = center / (center + R); tick(R_OHM, f, 3, '#1f6b3a', 0.3); if (R < 1000) label(R_OHM + 5, f, String(R), '#1f6b3a', 2.4); }
    for (let R = 1; R < 50; R += R < 10 ? 1 : 5) tick(R_OHM, center / (center + R), 1.7, '#1f6b3a', 0.2);
    label(R_OHM + 5, 0, '∞', '#1f6b3a', 3);
    arc(R_OHM - 3, '#b9c2c9', 2.2);
    arc(R_DC, '#1a1a1a', 0.35);
    for (let i = 0; i <= 50; i++) { const big = i % 5 === 0; tick(R_DC - (big ? 3.2 : 1.7), i / 50, big ? 3.2 : 1.7, '#1a1a1a', big ? 0.32 : 0.2); }
    const rows: Array<[number, number[]]> = [[R_DC - 6, [0, 2, 4, 6, 8, 10]], [R_DC - 9.5, [0, 10, 20, 30, 40, 50]], [R_DC - 13, [0, 50, 100, 150, 200, 250]]];
    for (const [r, vals] of rows) vals.forEach((v, i) => label(r, i / (vals.length - 1), String(v), '#1a1a1a', 2.3));
    arc(R_AC, '#c0392b', 0.3);
    for (let i = 0; i <= 50; i += 5) tick(R_AC - 2.2, i / 50, 2.2, '#c0392b', 0.25);
    [0, 2, 4, 6, 8, 10].forEach((v, i) => label(R_AC - 4.5, i / 5, String(v), '#c0392b', 2.1));
    x.font = `700 ${3.6 * s}px "Chakra Petch", sans-serif`; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillStyle = '#1f6b3a'; x.fillText('Ω', 3 * s, 5 * s);
    x.font = `700 ${2.4 * s}px "Chakra Petch", sans-serif`;
    x.fillStyle = '#1a1a1a'; x.fillText('DCV·A', 2.5 * s, 41 * s);
    x.fillStyle = '#c0392b'; x.fillText('ACV', 2.5 * s, 50 * s);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: scale, roughness: 0.6 }));
  plate.position.set(0, VOM_FACE_Y + 0.1, PLATE.z);
  g.add(plate);
  // เข็ม (หมุนรอบแกนตั้งฉากกับหน้าเครื่อง)
  const needle = new THREE.Group();
  const len = R_OHM + 4;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, len), mat('needle', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })));
  blade.position.z = -len / 2;
  const tipM = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 16), mat('needleTip', () => new THREE.MeshStandardMaterial({ color: 0xd62d20, roughness: 0.4 })));
  tipM.position.z = -len + 8;
  needle.add(blade, tipM);
  needle.position.set(0, VOM_FACE_Y + 1.2, PIVZ);
  needle.rotation.y = -vomNeedleAngle(0);
  g.add(needle);
  root.userData.vomNeedle = needle;
  // ฝาครอบแกนเข็ม + สกรูปรับศูนย์เข็ม + หน้าต่างใส
  const coverZ = (PLATE.z + sd / 2 + PIVZ + 4) / 2, coverD = PIVZ + 4 - (PLATE.z + sd / 2);
  const cover = new THREE.Mesh(new RoundedBoxGeometry(64, 3, coverD, 2, 1.2), std(0x1a1c1f, 0.5));
  cover.position.set(0, VOM_FACE_Y + 1.5, coverZ);
  const zero = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1, 20), std(0x2c2f33, 0.4));
  zero.position.set(0, VOM_FACE_Y + 3.4, coverZ);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 0.7), std(0x0d0e10, 0.6));
  slot.position.set(0, VOM_FACE_Y + 3.95, coverZ);
  const glass = new THREE.Mesh(new RoundedBoxGeometry(sw + 4, 1, sd + coverD + 4, 2, 0.4), mat('vomGlass', () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.1, clearcoat: 1, depthWrite: false })));
  glass.position.set(0, VOM_FACE_Y + 4.2, (PLATE.z - sd / 2 + PIVZ + 4) / 2);
  glass.userData.noPick = true;
  g.add(cover, zero, slot, glass);
  const adj = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 6, 28), std(0x2e3135, 0.5));
  adj.position.set(48, VOM_FACE_Y + 3, 12);
  g.add(adj);
  // สวิตช์ย่าน
  const dial = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(21, 22, 5, 44), std(0x15171a, 0.5));
  disc.position.y = 2.5;
  const bar = new THREE.Mesh(new RoundedBoxGeometry(10, 9, 42, 2, 3.5), std(0x202327, 0.5));
  bar.position.y = 5 + 4.5;
  const ptr = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 13), mat('ptrW', () => new THREE.MeshBasicMaterial({ color: 0xf2f4f0 })));
  ptr.position.set(0, 14.2, -13.5);
  dial.add(disc, bar, ptr);
  dial.rotation.y = -(pos.angle * Math.PI) / 180;
  dial.position.set(0, VOM_FACE_Y, DIAL_Z);
  g.add(dial);
  for (const [pin, [x, z]] of Object.entries(VOM_JACKS)) {
    const j = safetyJack(pin === 'COM' ? 0x22262a : 0xc8372d, pin);
    j.position.set(x, VOM_FACE_Y, z);
    g.add(j);
  }
  return root;
}
