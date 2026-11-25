import * as THREE from 'three';
import { withEnv } from './pico-model';
import { attachGlb } from './glb';
import UNOQ_GLB_URL from '../assets/models/unoq.glb?url';

/**
 * โมเดลอุปกรณ์เสียบบอร์ดตามแบบตัวถังของผู้ผลิต (หน่วย mm ในกลุ่มที่ย่อ 1/2.54 ให้เป็นหน่วยรู)
 *
 * แหล่งอ้างอิงขนาด (ค่ากลางของช่วงในแบบ):
 *  - TO-92 (2N3904/2N3906, onsemi case 29 / JEDEC TO-226AA): กว้าง 4.8, ลึก 3.7 (หน้าแบน → หลังโค้ง), สูง 4.6,
 *    ขา 0.46 × 0.40 ระยะ 1.27 ที่ตัวถัง ดัดออกเป็น 2.54 สำหรับเบรดบอร์ด
 *  - DO-35 (1N4148, ซีเนอร์ 5.1 V): ตัวแก้ว ยาว 4.0 Ø 1.85, ขา Ø 0.5
 *  - DO-41 (1N4007): ตัวอีพ็อกซีดำ ยาว 4.8 Ø 2.6, ขา Ø 0.8, แถบแคโทดสีเทา
 *  - ตัวเก็บประจุอิเล็กโทรไลต์แบบขาเดียวกัน (radial): ขนาด Ø×สูง และระยะขา F ตามตารางมาตรฐานของผู้ผลิต
 *    (เช่น 100 µF 16 V = 6.3 × 11, F 2.5) ปลอกพลาสติกมีแถบขั้วลบ ฝาอะลูมิเนียมมีร่องนิรภัย
 *  - ตัวเก็บประจุเซรามิกแบบจาน (≤ 1 µF) และ MLCC ชุบอีพ็อกซี (> 1 µF) ระยะขา 5.0 พิมพ์รหัสค่า 3 หลัก
 *  - ตัวเหนี่ยวนำแบบแกนดรัม (radial choke เช่น Bourns RLB0912): Ø 9 สูง 11 ระยะขา 5.0 ขา Ø 0.6
 *  - สวิตช์เลื่อน 2 ขา (ตัวถังแบบ SS12D00): 8.6 × 3.6 × 3.6 ฝาเหล็กครอบ ก้านเลื่อน 1.6 × 1.6
 * ไม่ใส่โลโก้ผู้ผลิต
 *
 * ทุกชิ้นอยู่ใน parent เดียวกัน ขาที่ index i อยู่ที่ x = dx·2.54 mm, z = dy·2.54 mm
 * ปลายขา (ส่วนที่เสียบรู) เป็น mesh ที่ติด userData.leadTip = ชื่อขา ลงลึก TIP mm ใต้ผิวบอร์ด
 */

const MM = 1 / 2.54;
export const PITCH = 2.54;
/** ความลึกปลายขาใต้ผิวบอร์ด (mm) — บอร์ดหนา ~6 mm จึงไม่ทะลุ */
export const TIP = 3.0;

const mats = new Map<string, THREE.Material>();
const mat = <T extends THREE.Material>(k: string, f: () => T): T => { let m = mats.get(k); if (!m) { m = f(); mats.set(k, m); } return m as T; };
const tin = () => mat('tin', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.32, metalness: 1 })));
const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** กลุ่มราก (หน่วยรู) + กลุ่มลูก (หน่วย mm) */
function rootGroups() {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  return { root, g };
}

/**
 * ขาลวดกลม: เส้นทางผ่านจุด (mm) มุมหักโค้งรัศมีเล็ก ๆ จุดสุดท้ายต้องเป็น (px, 0, pz) = ผิวบอร์ดตรงรู
 * แล้วต่อด้วยปลายขาตรงลงรู TIP mm (mesh แยก ติดชื่อขา)
 */
function roundLead(pts: THREE.Vector3[], dia: number, pin: string, material: THREE.Material = tin()): THREE.Group {
  const grp = new THREE.Group();
  const r = dia / 2;
  const path = new THREE.CurvePath<THREE.Vector3>();
  const bend = Math.max(0.35, dia * 0.9);
  let prev = pts[0].clone();
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    if (!next) { path.add(new THREE.LineCurve3(prev, cur.clone())); break; }
    const a = cur.clone().sub(prev), b = next.clone().sub(cur);
    const k = Math.min(bend, a.length() * 0.45, b.length() * 0.45);
    const p1 = cur.clone().addScaledVector(a.normalize(), -k);
    const p2 = cur.clone().addScaledVector(b.normalize(), k);
    if (p1.distanceTo(prev) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, cur.clone(), p2));
    prev = p2;
  }
  const segs = Math.max(12, pts.length * 10);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, segs, r, 8, false), material);
  const end = pts[pts.length - 1];
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, TIP + 0.05, 8), material);
  tip.position.set(end.x, -TIP / 2 + 0.025, end.z);
  tip.userData.leadTip = pin;
  grp.add(tube, tip);
  return grp;
}

/** ขาแบนสี่เหลี่ยม (TO-92 / สวิตช์): ต่อเป็นชิ้นตามเส้นทาง (กล่องเรียงต่อกัน) + ปลายขาลงรู */
function flatLead(pts: THREE.Vector3[], w: number, t: number, pin: string, material: THREE.Material = tin()): THREE.Group {
  const grp = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len + t * 0.9, t), material);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    grp.add(m);
  }
  const end = pts[pts.length - 1];
  const tipGeo = new THREE.BoxGeometry(w, TIP, t);
  const pos = tipGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * 0.6); // ปลายเรียวเล็กน้อย
  tipGeo.computeVertexNormals();
  const tip = new THREE.Mesh(tipGeo, material);
  tip.position.set(end.x, -TIP / 2, end.z);
  tip.userData.leadTip = pin;
  grp.add(tip);
  return grp;
}

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function decal(tex: THREE.Texture, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  m.userData.decal = true;
  m.renderOrder = 2;
  return m;
}

function textTex(key: string, lines: string[], color = 'rgba(214,218,222,0.95)', w = 256, h = 256, size = 70): THREE.Texture {
  return canvasTex(`txt:${key}:${color}`, w, h, (x) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = color;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((s, i) => {
      x.font = `600 ${i === 0 ? size : size * 0.8}px "Chakra Petch", "Arial Narrow", sans-serif`;
      x.fillText(s, w / 2, h / 2 + (i - (n - 1) / 2) * size * 1.05, w * 0.94);
    });
  });
}

/* ======================= TO-92 ======================= */

/** ทรานซิสเตอร์ TO-92: ขา E B C ที่ x = 0, 2.54, 5.08 mm; หน้าแบน (มีตัวหนังสือ) หันไปทาง +z
 *  มองหน้าแบน ขาลง: E ซ้าย B กลาง C ขวา ตาม datasheet ของ 2N3904/2N3906 */
export function buildTO92(model: string, pins: [string, string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const R = 2.4, flat = 1.3, depth = R + flat; // หน้าตัดรูปตัว D
  const zFlat = 1.4, zc = zFlat - flat; // หน้าแบนที่ z = +1.4 (แนวขาที่ z = 0 อยู่ในตัวถัง)
  const H = 4.6, yb = 3.2, xc = PITCH;
  // วาดในระนาบ (X, Y) = (x, −z): หน้าแบน (คอร์ด) ที่ Y = −zFlat, ส่วนโค้งอยู่ด้าน Y มาก (z ลบ = ด้านหลัง)
  // ย่อขอบลงเท่า bevel เพื่อให้ขอบลาดแล้วขนาดรวมตรงแบบ
  const bev = 0.25;
  const R2 = R - bev, a2 = Math.asin((flat - bev) / R2);
  const inner = new THREE.Shape();
  inner.absarc(0, -zc, R2, -a2, Math.PI + a2, false);
  inner.closePath();
  const geo = new THREE.ExtrudeGeometry(inner, { depth: H - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 28 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(xc, yb + bev, 0);
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, mat('to92', () => new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.55 })));
  g.add(body);
  void depth;
  // ตัวหนังสือบนหน้าแบน
  const d = decal(textTex(`to92:${model}`, [model.slice(0, 2), model.slice(2)], 'rgba(210,214,218,0.92)', 256, 256, 74), 3.6, 3.6);
  d.position.set(xc, yb + H * 0.52, zFlat + 0.012);
  g.add(d);
  // ขา: ออกจากใต้ตัวถังห่าง 1.27 mm แล้วดัดออกเป็น 2.54 mm (ขากลางตรง)
  const w = 0.46, t = 0.4;
  for (let i = 0; i < 3; i++) {
    const xb = xc + (i - 1) * 1.27, xh = i * PITCH;
    const pts = i === 1 ? [V(xb, yb + 0.6), V(xh, 0)] : [V(xb, yb + 0.6), V(xb, yb - 0.9), V(xh, yb - 2.0), V(xh, 0)];
    g.add(flatLead(pts, w, t, pins[i]));
  }
  root.userData.topY = (yb + H) * MM;
  root.userData.back = (depth - zFlat + 0.6) * MM;
  return root;
}

/* ======================= ไดโอด axial ======================= */

function latheX(len: number, r: (t: number) => number, n = 40, radial = 20): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(Math.max(1e-3, r(t)), t * len)); }
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** ขาแนวนอน 2 ขาสำหรับอุปกรณ์ axial: ออกจากปลายตัวถัง → งอ 90° → ลงรู */
function axialLeads(span: number, cx: number, len: number, h: number, dia: number, pins: [string, string]) {
  const x0 = 0, x1 = span * PITCH;
  return [
    roundLead([V(cx - len / 2 + 0.2, h), V(x0, h), V(x0, 0)], dia, pins[0]),
    roundLead([V(cx + len / 2 - 0.2, h), V(x1, h), V(x1, 0)], dia, pins[1]),
  ];
}

export function buildDiode(model: '1N4148' | '1N4007' | 'Z5V1', span: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const big = model === '1N4007';
  const L = big ? 4.8 : 4.0, D = big ? 2.6 : 1.85, dia = big ? 0.8 : 0.5;
  const maxL = span * PITCH - 2.2;
  const len = Math.min(L, Math.max(2.0, maxL));
  const cx = (span * PITCH) / 2, h = D / 2 + 0.6; // ตัวลอยเหนือบอร์ด ~0.6 mm
  const R = D / 2;
  if (big) {
    // DO-41: ตัวอีพ็อกซีดำ ขอบมน + แถบสีเทาฝั่งแคโทด + ตัวหนังสือรอบตัว
    const prof = (t: number) => { const e = Math.min(t, 1 - t) * len; return e < 0.35 ? R * (0.72 + 0.28 * Math.sin((e / 0.35) * Math.PI / 2)) : R; };
    // texture: แกน x ของ canvas = รอบตัว (u), แกน y = ตามความยาว (v = 0 ฝั่งขา A ซ้าย, v = 1 ฝั่งแคโทด; canvas กลับด้าน)
    const tex = canvasTex(`do41:${model}`, 512, 512, (x, w, hh) => {
      x.fillStyle = '#17181b'; x.fillRect(0, 0, w, hh);
      x.fillStyle = '#b9bcc0'; x.fillRect(0, hh * (1 - 0.94), w, hh * 0.16); // แถบแคโทด v 0.78–0.94
      x.fillStyle = 'rgba(205,208,212,0.92)'; x.font = '600 54px "Chakra Petch", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (const u of [0.0, 0.5, 1.0]) { x.save(); x.translate(u * w, hh * 0.58); x.rotate(-Math.PI / 2); x.scale(1.7, 1); x.fillText('1N4007', 0, 0); x.restore(); }
    });
    const body = new THREE.Mesh(latheX(len, prof, 40, 24), mat(`do41m:${model}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })));
    body.position.set(cx - len / 2, h, 0);
    g.add(body);
  } else {
    // DO-35: ตัวแก้วใสสีอำพัน ปลายมน มองเห็นแท่งโลหะ 2 ข้างและชิปตรงกลาง + แถบดำฝั่งแคโทด
    const prof = (t: number) => { const e = Math.min(t, 1 - t) * len; return e < 0.5 ? R * (0.55 + 0.45 * Math.sin((e / 0.5) * Math.PI / 2)) : R; };
    const glass = mat(`glass:${model}`, () => new THREE.MeshPhysicalMaterial({ color: model === 'Z5V1' ? 0xe0a35a : 0xd2652a, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.55, depthWrite: false }));
    const body = new THREE.Mesh(latheX(len, prof, 40, 24), glass);
    body.position.set(cx - len / 2, h, 0);
    body.renderOrder = 3;
    const slugMat = mat('slug', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 1 })));
    for (const sgn of [-1, 1]) {
      const slug = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, len * 0.36, 14).rotateZ(Math.PI / 2), slugMat);
      slug.position.set(cx + sgn * len * 0.25, h, 0);
      g.add(slug);
    }
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.22, R * 0.45, R * 0.45), mat('die', () => new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4 })));
    die.position.set(cx + 0.06, h, 0);
    const band = new THREE.Mesh(latheX(0.55, () => R * 1.01, 2, 24), mat('band35', () => new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.5 })));
    band.position.set(cx + len / 2 - 1.15, h, 0);
    g.add(die, band, body);
  }
  for (const l of axialLeads(span, cx, len, h, dia, pins)) g.add(l);
  root.userData.topY = (h + R) * MM;
  root.userData.back = (R + 0.8) * MM;
  return root;
}

/* ======================= ตัวเก็บประจุ ======================= */

/** ขนาดกระป๋องอิเล็กโทรไลต์ (Ø, สูง, ระยะขา F, Ø ขา) ตามตารางมาตรฐานของผู้ผลิต (ค่าที่พบบ่อย) */
export function electrolyticSize(cF: number, v: number): { D: number; L: number; F: number; d: number } {
  const uF = cF * 1e6;
  const pick = (D: number, L: number) => ({ D, L, F: D <= 5 ? 2.0 : D <= 6.3 ? 2.5 : D <= 8 ? 3.5 : D <= 12.5 ? 5.0 : 7.5, d: D <= 6.3 ? 0.5 : D <= 12.5 ? 0.6 : 0.8 });
  if (uF <= 10) return v <= 35 ? pick(5, 11) : pick(6.3, 11);
  if (uF <= 47) return v <= 16 ? pick(5, 11) : v <= 35 ? pick(6.3, 11) : pick(8, 11.5);
  if (uF <= 100) return v <= 25 ? pick(6.3, 11) : pick(8, 11.5);
  if (uF <= 220) return v <= 16 ? pick(8, 11.5) : pick(10, 12.5);
  if (uF <= 470) return v <= 25 ? pick(10, 12.5) : pick(10, 16);
  if (uF <= 1000) return v <= 16 ? pick(10, 16) : pick(12.5, 20);
  if (uF <= 2200) return pick(12.5, 20);
  return pick(16, 25);
}

function fmtCap(cF: number): string {
  const uF = cF * 1e6;
  if (uF >= 1) return `${+uF.toPrecision(3)}µF`;
  const nF = cF * 1e9;
  if (nF >= 1) return `${+nF.toPrecision(3)}nF`;
  return `${+(cF * 1e12).toPrecision(3)}pF`;
}
/** รหัส 3 หลักบนตัวเก็บประจุเซรามิก (หน่วย pF) เช่น 100 nF → 104 */
export function capCode(cF: number): string {
  const pF = Math.round(cF * 1e12);
  if (pF < 100) return String(pF);
  const e = Math.floor(Math.log10(pF)) - 1;
  return `${Math.round(pF / 10 ** e)}${e}`;
}

/** ขาออกจากใต้ตัวถังที่ x = xb แล้วดัดไปลงรูที่ x = xh (ถ้าระยะต่างกัน) */
function radialLeadPts(xb: number, yb: number, xh: number): THREE.Vector3[] {
  if (Math.abs(xb - xh) < 0.05) return [V(xb, yb + 0.4), V(xh, 0)];
  return [V(xb, yb + 0.4), V(xb, Math.min(yb - 0.6, 2.2)), V(xh, Math.min(yb - 0.6, 2.2) - Math.min(1.2, Math.abs(xh - xb) * 0.8)), V(xh, 0)];
}

export function buildElectrolytic(cF: number, v: number, span: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const { D, L, F, d } = electrolyticSize(cF, v);
  const R = D / 2;
  const cx = (span * PITCH) / 2;
  const spread = Math.abs(span * PITCH - F) > 0.05;
  const yb = spread ? 2.6 : 0.6; // ยกตัวขึ้นถ้าต้องดัดขาให้ระยะตรงกับรู
  // ปลอกพลาสติก: โปรไฟล์หมุนรอบแกนตั้ง (ขอบม้วนล่าง/บน + ร่องคอด้านล่าง)
  const prof: THREE.Vector2[] = [];
  const add = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
  add(R - 0.45, 0); add(R - 0.12, 0.08); add(R, 0.35);
  add(R, 1.0); add(R - 0.35, 1.25); add(R - 0.35, 1.55); add(R, 1.8); // ร่องคอ (bead)
  add(R, L - 0.45); add(R - 0.12, L - 0.12); add(R - 0.45, L);
  const sleeveTex = canvasTex(`ecap:${cF}:${v}`, 512, 256, (x, w, h) => {
    x.fillStyle = '#1e3477'; x.fillRect(0, 0, w, h);
    // แถบขั้วลบ หันไปทางขา N (+x = u 0.25) พร้อมเครื่องหมาย −
    const u0 = 0.25 * w, sw = 0.17 * w;
    x.fillStyle = '#c9d4e6'; x.fillRect(u0 - sw / 2, 0, sw, h);
    x.fillStyle = '#1e3477';
    for (let k = 0; k < 5; k++) x.fillRect(u0 - sw * 0.28, h * (0.16 + k * 0.17), sw * 0.56, h * 0.035);
    // ตัวหนังสือแนวตั้งด้านหน้า (u 0 = +z) และด้านหลัง
    x.fillStyle = '#e8edf5'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const u of [0, 1, 0.5]) {
      x.save(); x.translate(u * w, h * 0.5); x.rotate(-Math.PI / 2);
      x.font = '600 34px "Chakra Petch", sans-serif'; x.fillText(`${fmtCap(cF)} ${v}V`, 0, -16, h * 0.9);
      x.font = '500 26px "Chakra Petch", sans-serif'; x.fillText('105°C', 0, 22);
      x.restore();
    }
  });
  const sleeveGeo = new THREE.LatheGeometry(prof, 40);
  { const pos = sleeveGeo.attributes.position, uv = sleeveGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / L); } // v ตามความสูงจริง (ตัวหนังสือไม่บิด)
  const sleeve = new THREE.Mesh(sleeveGeo, mat(`ecapm:${cF}:${v}`, () => new THREE.MeshStandardMaterial({ map: sleeveTex, roughness: 0.42 })));
  sleeve.position.set(cx, yb, 0); // u 0 ของ lathe อยู่ที่ +z (หน้า), u 0.25 ที่ +x = ฝั่งขา N → แถบขั้วลบหันไปฝั่งขาลบ
  // ฝาอะลูมิเนียมพร้อมร่องนิรภัยรูปตัว K (texture) — ฝาอยู่ต่ำกว่าขอบปลอกเล็กน้อย
  const ventTex = canvasTex('vent', 256, 256, (x, w) => {
    const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, '#d6dadf'); gr.addColorStop(1, '#a9afb6');
    x.fillStyle = gr; x.fillRect(0, 0, w, w);
    x.strokeStyle = '#7d848c'; x.lineWidth = 9; x.lineCap = 'round';
    x.beginPath(); x.moveTo(w * 0.36, w * 0.2); x.lineTo(w * 0.36, w * 0.8); x.moveTo(w * 0.36, w * 0.5); x.lineTo(w * 0.72, w * 0.22); x.moveTo(w * 0.36, w * 0.5); x.lineTo(w * 0.72, w * 0.78); x.stroke();
  });
  const top = new THREE.Mesh(new THREE.CircleGeometry(R - 0.42, 40).rotateX(-Math.PI / 2), mat('ecapTop', () => withEnv(new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.35, metalness: 0.9 }))));
  top.position.set(cx, yb + L - 0.08, 0);
  const seal = new THREE.Mesh(new THREE.CircleGeometry(R - 0.45, 32).rotateX(Math.PI / 2), mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.9 })));
  seal.position.set(cx, yb + 0.02, 0);
  g.add(sleeve, top, seal);
  // ขา: + (ยาว) ที่ x = 0, − ที่ span — ออกจากใต้กระป๋องห่าง F
  g.add(roundLead(radialLeadPts(cx - F / 2, yb, 0), d, pins[0]));
  g.add(roundLead(radialLeadPts(cx + F / 2, yb, span * PITCH), d, pins[1]));
  root.userData.topY = (yb + L) * MM;
  root.userData.back = (R + 0.8) * MM;
  return root;
}

/** เซรามิกแบบจาน (≤ 1 µF) หรือ MLCC ชุบอีพ็อกซี (> 1 µF) — ตัวตั้งขนานแนวขา หน้าพิมพ์รหัสหันไป +z */
export function buildCeramic(cF: number, v: number, span: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const cx = (span * PITCH) / 2;
  const disc = cF <= 1e-6;
  const pF = cF * 1e12;
  const Dm = disc ? (pF <= 1000 ? 4.5 : pF <= 1e4 ? 5.0 : pF <= 1e5 ? 6.0 : 7.5) : 5.5;
  const T = disc ? 2.6 : 3.2;
  const F = 5.0;
  const yb = 2.4; // ขอบล่างของตัว
  let body: THREE.Mesh;
  if (disc) {
    // จาน: ขอบมนหนา (ชุบเคลือบ) — ทรงรีแบนเล็กน้อย
    const geo = new THREE.SphereGeometry(Dm / 2, 32, 16);
    geo.scale(1, 1, T / Dm);
    body = new THREE.Mesh(geo, mat('discCer', () => new THREE.MeshStandardMaterial({ color: 0xc98a2e, roughness: 0.55 })));
    body.position.set(cx, yb + Dm / 2, 0);
  } else {
    // MLCC ชุบอีพ็อกซี: ก้อนเหลี่ยมมน
    const shape = new THREE.Shape();
    const w = Dm, hh = Dm, r = 1.3;
    shape.moveTo(-w / 2 + r, 0); shape.lineTo(w / 2 - r, 0); shape.quadraticCurveTo(w / 2, 0, w / 2, r); shape.lineTo(w / 2, hh - r); shape.quadraticCurveTo(w / 2, hh, w / 2 - r, hh);
    shape.lineTo(-w / 2 + r, hh); shape.quadraticCurveTo(-w / 2, hh, -w / 2, hh - r); shape.lineTo(-w / 2, r); shape.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T - 1.2, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 4, curveSegments: 10 });
    geo.translate(0, 0, -(T - 1.2) / 2);
    geo.computeVertexNormals();
    body = new THREE.Mesh(geo, mat('mlcc', () => new THREE.MeshStandardMaterial({ color: 0xd8b13b, roughness: 0.5 })));
    body.position.set(cx, yb, 0);
  }
  g.add(body);
  const code = capCode(cF);
  const dc = decal(textTex(`cer:${code}:${v}`, [code, `${v}V`], 'rgba(40,30,20,0.9)', 256, 256, 80), Dm * 0.7, Dm * 0.7);
  dc.position.set(cx, yb + (disc ? Dm / 2 : Dm / 2), T / 2 + 0.03);
  g.add(dc);
  // ขามีรอยหยัก (kink) ใต้ตัว แล้วดัดลงรู
  const ky = 1.2;
  // ขาออกจากใต้ตัว (ภายในเนื้อเคลือบ) → ลงมา → รอยหยัก → ดัดไปที่รู
  const xs = Math.min(F / 2, Dm * 0.3);
  const lead = (sgn: number, xh: number, pin: string) => {
    const x0 = cx + sgn * xs, xb = cx + sgn * F / 2;
    return roundLead([V(x0, yb + Dm * 0.3), V(x0, yb - 0.2), V(xb, ky + 0.3), V(xb, ky), V(xh, ky - 0.5 - Math.min(0.6, Math.abs(xh - xb) * 0.3)), V(xh, 0)], 0.5, pin);
  };
  g.add(lead(-1, 0, pins[0]), lead(1, span * PITCH, pins[1]));
  root.userData.topY = (yb + Dm) * MM;
  root.userData.back = (T / 2 + 0.8) * MM;
  return root;
}

/* ======================= ตัวเหนี่ยวนำ ======================= */

/** รหัสค่าความเหนี่ยวนำ 3 หลัก (หน่วย µH) เช่น 10 mH → 103 */
export function indCode(H: number): string {
  const uH = H * 1e6;
  if (uH < 10) return `${uH.toFixed(1).replace('.', 'R')}`;
  const e = Math.floor(Math.log10(uH)) - 1;
  return `${Math.round(uH / 10 ** e)}${e}`;
}

export function buildInductor(H: number, span: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const D = 9.0, Ht = 11.0, F = 5.0, d = 0.6;
  const R = D / 2, fl = 1.2, rw = 4.05;
  const cx = (span * PITCH) / 2;
  const spread = Math.abs(span * PITCH - F) > 0.05;
  const yb = spread ? 2.6 : 0.6;
  // แกนเฟอร์ไรต์แบบดรัม: ปีกล่าง + แกน + ปีกบน (ขอบมน)
  const prof: THREE.Vector2[] = [];
  const add = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
  add(0.01, 0); add(R - 0.3, 0); add(R, 0.3); add(R, fl - 0.25); add(R - 0.25, fl);
  add(2.6, fl); add(2.6, Ht - fl);
  add(R - 0.25, Ht - fl); add(R, Ht - fl + 0.25); add(R, Ht - 0.3); add(R - 0.3, Ht); add(0.01, Ht);
  const ferrite = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), mat('ferrite', () => new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 0.82 })));
  ferrite.position.set(cx, yb, 0);
  // ขดลวดทองแดงเคลือบ: ทรงกระบอกพร้อมลายเส้นลวดเรียงเป็นชั้น
  const wireTex = canvasTex('winding', 64, 256, (x, w, h) => {
    for (let i = 0; i < 64; i++) {
      const y0 = (i / 64) * h;
      const gr = x.createLinearGradient(0, y0, 0, y0 + h / 64);
      gr.addColorStop(0, '#6b3412'); gr.addColorStop(0.45, '#d58a4c'); gr.addColorStop(1, '#6b3412');
      x.fillStyle = gr; x.fillRect(0, y0, w, h / 64);
    }
  });
  wireTex.wrapS = wireTex.wrapT = THREE.RepeatWrapping;
  wireTex.repeat.set(1, 0.6);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(rw, rw, Ht - 2 * fl - 0.05, 40, 1, true), mat('copper', () => withEnv(new THREE.MeshStandardMaterial({ map: wireTex, roughness: 0.35, metalness: 0.7 }))));
  coil.position.set(cx, yb + Ht / 2, 0);
  g.add(ferrite, coil);
  // รหัสค่าบนปีกบน
  const dc = decal(textTex(`ind:${indCode(H)}`, [indCode(H)], 'rgba(220,222,226,0.9)', 256, 128, 84), 5.2, 2.6);
  dc.rotation.x = -Math.PI / 2;
  dc.position.set(cx, yb + Ht + 0.02, 0);
  g.add(dc);
  g.add(roundLead(radialLeadPts(cx - F / 2, yb, 0), d, pins[0]));
  g.add(roundLead(radialLeadPts(cx + F / 2, yb, span * PITCH), d, pins[1]));
  root.userData.topY = (yb + Ht) * MM;
  root.userData.back = (R + 0.8) * MM;
  return root;
}

/* ======================= สวิตช์เลื่อน ======================= */

export function buildSlideSwitch(closed: boolean, pins: [string, string], span = 2): THREE.Group {
  const { root, g } = rootGroups();
  const Lx = 8.6, W = 3.6, Hb = 2.4, Hs = 3.6, yb = 0.5;
  const cx = (span * PITCH) / 2;
  // ฐานพลาสติกดำ
  const baseGeo = new THREE.BoxGeometry(Lx - 0.4, Hb, W - 0.3);
  const base = new THREE.Mesh(baseGeo, mat('swBase', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6 })));
  base.position.set(cx, yb + Hb / 2, 0);
  // ฝาเหล็กชุบ: ครอบด้านบนและด้านข้างส่วนบน + แถบพับที่ปลายทั้งสอง
  const steel = mat('swSteel', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 1 })));
  const t = 0.25;
  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(Lx, t, W), steel);
  topPlate.position.set(cx, yb + Hs - t / 2, 0);
  const sideF = new THREE.Mesh(new THREE.BoxGeometry(Lx, Hs - Hb + 0.6, t), steel);
  sideF.position.set(cx, yb + Hb - 0.3 + (Hs - Hb + 0.6) / 2 - 0.0, W / 2 - t / 2);
  const sideB = sideF.clone(); sideB.position.z = -W / 2 + t / 2;
  const tabs: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(t, Hs - 0.2, 1.4), steel);
    tab.position.set(cx + s * (Lx / 2 - t / 2), yb + (Hs - 0.2) / 2 + 0.1, 0);
    tabs.push(tab);
  }
  // ช่องเลื่อนบนฝา + ก้านเลื่อน
  const slot = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.02, 1.9), mat('swSlot', () => new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.8 })));
  slot.position.set(cx, yb + Hs + 0.005, 0);
  const knobGeo = new THREE.BoxGeometry(1.6, 4.0, 1.6);
  const knob = new THREE.Mesh(knobGeo, mat('swKnob', () => new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.55 })));
  knob.position.set(cx + (closed ? 1.1 : -1.1), yb + Hs + 2.0 - 0.6, 0);
  g.add(base, topPlate, sideF, sideB, ...tabs, slot, knob);
  // ขาแบน 2 ขา (ขา A, B) ตรงลงรู
  for (let i = 0; i < 2; i++) {
    const xh = i * span * PITCH;
    g.add(flatLead([V(xh, yb + 0.8), V(xh, 0)], 0.7, 0.3, pins[i], steel));
  }
  // สัญลักษณ์ ON ที่ฝา (ฝั่งที่ก้านเลื่อนต้องอยู่เมื่อสวิตช์ต่อ)
  const on = decal(textTex('swON', ['ON'], 'rgba(30,32,36,0.95)', 128, 64, 46), 1.8, 0.9);
  on.rotation.x = -Math.PI / 2;
  on.position.set(cx + 3.1, yb + Hs + 0.01, 0.95);
  g.add(on);
  root.userData.topY = (yb + Hs + 3.4) * MM;
  root.userData.back = (W / 2 + 0.8) * MM;
  return root;
}

/* ======================= TO-220 ======================= */

/**
 * ตัวถัง TO-220 (JEDEC TO-220AB): ตัวอีพ็อกซีกว้าง 10.16 หนา 4.45 สูง 9.0 + แผ่นระบายความร้อนโลหะหนา 1.27 ยื่นเหนือตัว
 * (สูงรวม 15.6) มีรูยึด Ø 3.7 ห่างขอบบน 2.8 — ขา 3 ขาระยะ 2.54 ส่วนโคนกว้าง 1.3 แล้วเหลือ 0.8 × 0.5 ลงรู
 * ด้านหน้า (มีตัวหนังสือ) หันไป +z แผ่นโลหะอยู่ด้านหลัง; มองด้านหน้า ขา 1-2-3 จากซ้าย (MOSFET: G D S)
 */
export function buildTO220(model: string, pins: [string, string, string], opts: { heatsink?: boolean; code?: string } = {}): THREE.Group {
  const { root, g } = rootGroups();
  const W = 10.16, T = 4.45, Hb = 9.0, Htab = 15.6, tabT = 1.27, yb = 5.0, xc = PITCH;
  const zTabBack = -1.9, zBodyBack = zTabBack + tabT, zFront = zBodyBack + T;
  // ตัวอีพ็อกซี (ขอบลาดเล็กน้อย)
  const body = new THREE.Mesh(new RoundedBoxGeometryLite(W, Hb, T, 0.3), mat('to220', () => new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.55 })));
  body.position.set(xc, yb + Hb / 2, (zBodyBack + zFront) / 2);
  g.add(body);
  // แผ่นโลหะพร้อมรูยึด
  const tab = new THREE.Shape();
  const x0 = -W / 2, x1 = W / 2, chamfer = 0.8;
  tab.moveTo(x0, 0); tab.lineTo(x1, 0); tab.lineTo(x1, Htab - chamfer); tab.lineTo(x1 - chamfer, Htab); tab.lineTo(x0 + chamfer, Htab); tab.lineTo(x0, Htab - chamfer); tab.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, Htab - 2.8, 1.85, 0, Math.PI * 2, true);
  tab.holes.push(hole);
  const tabGeo = new THREE.ExtrudeGeometry(tab, { depth: tabT, bevelEnabled: false, curveSegments: 24 });
  const tabMesh = new THREE.Mesh(tabGeo, mat('tabTin', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8ccd1, roughness: 0.3, metalness: 1 }))));
  tabMesh.position.set(xc, yb, zTabBack);
  g.add(tabMesh);
  // ตัวหนังสือด้านหน้า
  const code = opts.code ?? '2441';
  const d = decal(textTex(`to220:${model}:${code}`, [model, code], 'rgba(212,216,220,0.9)', 512, 256, 78), 7.8, 3.9);
  d.position.set(xc, yb + Hb * 0.55, zFront + 0.012);
  g.add(d);
  // ขา: โคนกว้างออกจากใต้ตัว (แนวเดียวกับแผ่นโลหะ ด้านในตัวถัง) แล้วเหลือหน้าตัดแคบลงรู
  for (let i = 0; i < 3; i++) {
    const xh = i * PITCH;
    const sh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.5), tin());
    sh.position.set(xh, yb - 1.1 + 0.3, 0);
    g.add(sh);
    g.add(flatLead([V(xh, yb - 1.9), V(xh, 0)], 0.8, 0.5, pins[i]));
  }
  if (opts.heatsink) {
    // แผ่นระบายความร้อนอะลูมิเนียมรีดขึ้นรูปแบบหนีบ (ชุบดำ) ≈ 19 × 20 mm ครีบลึก 8 mm ด้านหลังแผ่นโลหะ — ตั้งอยู่เหนือผิวบอร์ด
    const al = mat('heatsinkBlack', () => new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6, metalness: 0.4 }));
    const hsW = 19, hsH = 20, base = 1.6, finD = 8, y0 = yb + 0.2;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(hsW, hsH, base), al);
    plate.position.set(xc, y0 + hsH / 2, zTabBack - base / 2);
    g.add(plate);
    const nFin = 6;
    for (let k = 0; k < nFin; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.0, hsH, finD), al);
      fin.position.set(xc - hsW / 2 + 0.5 + (k * (hsW - 1)) / (nFin - 1), y0 + hsH / 2, zTabBack - base - finD / 2);
      g.add(fin);
    }
    // สกรูยึดผ่านรูแผ่นโลหะ
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.2, 16), mat('relScrew', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 1 }))));
    screw.rotation.x = Math.PI / 2;
    screw.position.set(xc, yb + Htab - 2.8, zTabBack + tabT + 0.6);
    // หัวสกรูอยู่ด้านหน้าแผ่นโลหะ (เหนือตัวถังอีพ็อกซี)
    g.add(screw);
    root.userData.topY = Math.max(yb + Htab, y0 + hsH) * MM;
  } else root.userData.topY = (yb + Htab) * MM;
  root.userData.back = (zFront + 0.8) * MM;
  return root;
}

/** กล่องขอบมนแบบเบา (ExtrudeGeometry ขอบลาด) — ไม่ต้องใช้ addon */
class RoundedBoxGeometryLite extends THREE.ExtrudeGeometry {
  constructor(w: number, h: number, d: number, r: number) {
    const s = new THREE.Shape();
    const iw = w / 2 - r, ih = h / 2 - r; // bevel ขยายขอบออก r → ขนาดรวม w × h พอดี
    s.moveTo(-iw, -ih); s.lineTo(iw, -ih); s.lineTo(iw, ih); s.lineTo(-iw, ih); s.closePath();
    super(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2 });
    this.translate(0, 0, -(d - 2 * r) / 2);
    this.computeVertexNormals();
  }
}

/* ======================= ทริมพอต 25 รอบ (แบบ 3296W) ======================= */

/** รหัสค่าบนตัว VR: เลข 2 หลัก + จำนวนศูนย์ (10 kΩ = 103) */
export function potCode(ohm: number): string {
  const r = Math.round(ohm);
  if (r < 100) return `${r}R`.replace(/^(\d)R$/, '$1R0');
  const e = Math.floor(Math.log10(r)) - 1;
  return `${Math.round(r / 10 ** e)}${e}`;
}

/** มุมของร่องสกรูปรับ (rad): 25 รอบตลอดช่วง 0..1 */
export const POT_TURNS = 25;
export function potScrewAngle(position: number): number {
  return -position * POT_TURNS * 2 * Math.PI;
}

/**
 * ทริมพอตแบบ 3296W (ปรับด้านบน 25 รอบ): ตัวถังพลาสติกสีน้ำเงิน 9.53 × 4.83 × 10.03 mm (รวมหัวสกรู)
 * สกรูปรับทองเหลืองมีร่องอยู่ด้านบนปลายหนึ่ง ขา 1–2–3 เรียงแถวเดียวระยะ 2.54 mm ใต้ตัวถัง (ขา 2 = แกนกลาง)
 * ตัวถังวางกึ่งกลางเหนือขา 2; พิมพ์รหัสค่า (เช่น 103) บนด้านบน และ "3296" ที่ด้านหน้า (+z)
 */
export function buildTrimpot3296(resistance: number, position: number, pins: [string, string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const L = 9.53, W = 4.83, Htot = 10.03, standoff = 0.5;
  const screwH = 0.55, Hb = Htot - standoff - screwH;
  const xc = PITCH;
  const body = new THREE.Mesh(new RoundedBoxGeometryLite(L, Hb, W, 0.35), mat('pot3296', () => new THREE.MeshStandardMaterial({ color: 0x2b5fae, roughness: 0.45 })));
  body.position.set(xc, standoff + Hb / 2, 0);
  g.add(body);
  // ปุ่มรองใต้ตัวถัง (standoff) 2 ปุ่มที่ปลาย
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, standoff, W * 0.8), mat('pot3296f', () => new THREE.MeshStandardMaterial({ color: 0x24508f, roughness: 0.5 })));
    foot.position.set(xc + sx * (L / 2 - 0.9), standoff / 2, 0);
    g.add(foot);
  }
  // สกรูปรับ: บ่าทองเหลือง + หัวมีร่อง หมุนตามตำแหน่ง
  const yTop = standoff + Hb;
  const sx = xc - L / 2 + 1.75;
  const brass = mat('brass', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.32, metalness: 1 })));
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.12, 24), brass);
  collar.position.set(sx, yTop + 0.06, 0);
  const head = new THREE.Group();
  const r = 1.1, slotW = 0.38, slotD = 0.3;
  // หัวสกรู = สองครึ่งวงกลมแยกด้วยร่อง (เห็นร่องจริงจากทุกมุม)
  for (const sgn of [-1, 1]) {
    const sh = new THREE.Shape();
    const a0 = Math.asin(slotW / 2 / r);
    if (sgn > 0) { sh.absarc(0, 0, r, a0, Math.PI - a0, false); } else { sh.absarc(0, 0, r, Math.PI + a0, 2 * Math.PI - a0, false); }
    sh.closePath();
    const half = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: screwH - 0.12, bevelEnabled: false, curveSegments: 16 }).rotateX(-Math.PI / 2), brass);
    head.add(half);
  }
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, screwH - 0.12 - slotD, 24), brass);
  floor.position.y = (screwH - 0.12 - slotD) / 2;
  head.add(floor);
  head.position.set(sx, yTop + 0.12, 0);
  head.rotation.y = potScrewAngle(position);
  head.userData.potScrew = true;
  g.add(collar, head);
  // รหัสค่าบนด้านบน (อีกปลาย) และ "3296" ด้านหน้า
  const top = decal(textTex(`pot:${potCode(resistance)}`, [potCode(resistance)], 'rgba(236,240,246,0.95)', 256, 128, 92), 4.2, 2.1);
  top.rotation.x = -Math.PI / 2;
  top.position.set(xc + L / 2 - 3.0, yTop + 0.012, 0);
  const front = decal(textTex('pot:3296', ['3296W'], 'rgba(236,240,246,0.9)', 256, 96, 66), 5.0, 1.9);
  front.position.set(xc + 0.6, standoff + Hb * 0.62, W / 2 + 0.012);
  g.add(top, front);
  // ขา: ตรงลงจากใต้ตัวถัง (Ø 0.5)
  for (let i = 0; i < 3; i++) g.add(roundLead([V(i * PITCH, standoff + 0.6), V(i * PITCH, 0)], 0.5, pins[i]));
  root.userData.topY = (yTop + screwH) * MM;
  root.userData.back = (W / 2 + 0.6) * MM;
  return root;
}

/* ======================= ปุ่มกด 6 × 6 mm (แบบ B3F) ======================= */

/** ระยะกดของปุ่ม (mm) */
export const TACT_TRAVEL = 0.25;

/**
 * ปุ่มกด tactile 6 × 6 mm สูง 4.3 mm (แบบ Omron B3F-1000): ฐานพลาสติกดำ 6 × 6 × 3.2, แผ่นโลหะครอบด้านบนมีรู,
 * ก้านกดกลม Ø 3.5 ยื่นถึง 4.3 mm (กดแล้วลง 0.25 mm) · ขาแบน 0.7 × 0.3 ระยะ 6.5 × 4.5 mm ที่ตัวถัง
 * ดัดออกเล็กน้อยให้ลงรู 7.62 × 5.08 mm (คร่อมร่องกลางของเบรดบอร์ด)
 * ขา: 1 (0, 0), 2 (0, −7.62), 3 (5.08, 0), 4 (5.08, −7.62) — x = dx·2.54, z = dy·2.54
 */
export function buildTactile6x6(pressed: boolean, pins: [string, string, string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const xc = PITCH, zc = -1.5 * PITCH; // กึ่งกลางตัวถัง
  const B = 6.0, baseH = 3.2, coverT = 0.3, top = 4.3, plR = 1.75;
  const base = new THREE.Mesh(new RoundedBoxGeometryLite(B, baseH, B, 0.25), mat('tactBase', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6 })));
  base.position.set(xc, baseH / 2 + 0.05, zc);
  g.add(base);
  // แผ่นโลหะครอบ: สี่เหลี่ยมมีรูกลางสำหรับก้านกด + ขอบพับลงสองข้าง
  const sh = new THREE.Shape();
  sh.moveTo(-B / 2, -B / 2); sh.lineTo(B / 2, -B / 2); sh.lineTo(B / 2, B / 2); sh.lineTo(-B / 2, B / 2); sh.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, plR + 0.25, 0, Math.PI * 2, true); sh.holes.push(hole);
  const steel = mat('tactSteel', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.35, metalness: 1 })));
  const cover = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: coverT, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2), steel);
  cover.position.set(xc, baseH + 0.05, zc);
  g.add(cover);
  for (const sz of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.2), steel);
    flap.position.set(xc, baseH + 0.05 - 0.7, zc + sz * (B / 2 + 0.05));
    g.add(flap);
  }
  // ก้านกด
  const y0 = baseH + 0.05 + coverT;
  const plH = top - y0 - (pressed ? TACT_TRAVEL : 0);
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(plR, plR, plH, 32), mat('tactPl', () => new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.5 })));
  plunger.position.set(xc, y0 + plH / 2, zc);
  plunger.userData.pushPlunger = true;
  g.add(plunger);
  // พื้นที่แตะสำหรับนิ้ว (มองไม่เห็น ใหญ่กว่าก้าน) — แตะค้างเพื่อกด
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(xc, top, zc);
  hit.userData.pushPlunger = true;
  g.add(hit);
  // ขา: ออกจากใต้ตัวถังที่ระยะ 4.5 (แนว x) × 6.5 (แนว z) แล้วดัดลงรู
  const xs = [xc - 2.25, xc + 2.25], zs = [zc + 3.25, zc - 3.25];
  const holes: Array<[number, number]> = [[0, 0], [0, -3 * PITCH], [2 * PITCH, 0], [2 * PITCH, -3 * PITCH]];
  const legs: Array<[number, number]> = [[xs[0], zs[0]], [xs[0], zs[1]], [xs[1], zs[0]], [xs[1], zs[1]]];
  for (let i = 0; i < 4; i++) {
    const [xb, zb] = legs[i], [xh, zh] = holes[i];
    g.add(flatLead([V(xb, 1.2, zb), V(xb, 0.55, zb), V(xh, 0.15, zh), V(xh, 0, zh)], 0.7, 0.3, pins[i]));
  }
  root.userData.topY = top * MM;
  root.userData.back = (B / 2 + 2.0) * MM;
  return root;
}

/* ======================= บัซเซอร์ Ø12 mm ======================= */

/**
 * บัซเซอร์ Ø12 mm ขาห่าง 7.62 mm: active (แบบ TMB12A05) สูง 9.5 mm ใต้ตัวปิดด้วยอีพ็อกซีดำ มีสติกเกอร์ปิดรูเสียง
 * passive (แบบ CEM-1203) สูง 9.0 mm ใต้ตัวเห็นแผ่น PCB สีเขียว · ด้านบนมีรูเสียง Ø2 และพิมพ์ "+" ฝั่งขา +
 * ขา + อยู่ที่ x = 0, ขา − ที่ x = 7.62 mm
 */
export function buildBuzzer12(type: 'active' | 'passive', pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const D = 12, H = type === 'active' ? 9.5 : 9.0, standoff = 0.4, xc = 1.5 * PITCH;
  const black = mat('bzBody', () => new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.42 }));
  // ตัวถัง: ทรงกระบอกขอบบนลาดเล็กน้อย (lathe)
  const prof: THREE.Vector2[] = [];
  const r = D / 2, ch = 0.5;
  prof.push(new THREE.Vector2(0.01, 0), new THREE.Vector2(r - 0.2, 0), new THREE.Vector2(r, 0.2), new THREE.Vector2(r, H - ch), new THREE.Vector2(r - ch * 0.6, H - 0.08), new THREE.Vector2(r - ch, H), new THREE.Vector2(1.0, H), new THREE.Vector2(1.0, H - 1.2), new THREE.Vector2(0.01, H - 1.2));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), black);
  body.position.set(xc, standoff, 0);
  g.add(body);
  // ด้านล่าง: active = อีพ็อกซีดำ, passive = PCB เขียว
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.35, r - 0.35, 0.3, 40), type === 'passive'
    ? mat('bzPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.55 }))
    : mat('bzEpoxy', () => new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7 })));
  bottom.position.set(xc, standoff + 0.1, 0);
  g.add(bottom);
  // "+" บนด้านบนฝั่งขา + และ (active) สติกเกอร์ปิดรูเสียง
  const plus = decal(textTex('bz:+', ['+'], 'rgba(235,238,240,0.95)', 128, 128, 110), 2.4, 2.4);
  plus.rotation.x = -Math.PI / 2;
  plus.position.set(xc - 3.4, standoff + H + 0.012, 0);
  g.add(plus);
  if (type === 'active') {
    const st = canvasTex('bz:sticker', 256, 256, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = 'rgba(246,246,240,0.96)'; x.beginPath(); x.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a2b2e'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '600 27px "Chakra Petch", sans-serif';
      x.fillText('REMOVE SEAL', w / 2, h * 0.38, w * 0.8); x.fillText('AFTER', w / 2, h * 0.5); x.fillText('WASHING', w / 2, h * 0.62, w * 0.8);
    });
    const s = decal(st, 7.2, 7.2);
    s.rotation.x = -Math.PI / 2;
    s.position.set(xc + 0.9, standoff + H + 0.02, 0);
    g.add(s);
  } else {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20).rotateX(-Math.PI / 2), mat('bzHole', () => new THREE.MeshBasicMaterial({ color: 0x050505 })));
    hole.position.set(xc, standoff + H - 1.19, 0);
    g.add(hole);
  }
  // ขา Ø 0.6 ตรงลงจากใต้ตัว
  for (let i = 0; i < 2; i++) g.add(roundLead([V(i * 3 * PITCH, standoff + 0.5), V(i * 3 * PITCH, 0)], 0.6, pins[i]));
  // ตัวบอกว่ากำลังดัง (วงคลื่นเสียง) — scene เปิด/ปิดเมื่อบัซเซอร์ดัง
  const wave = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 + k * 1.6, 0.18, 6, 40).rotateX(Math.PI / 2), mat('bzWave', () => new THREE.MeshBasicMaterial({ color: 0x2bb673, transparent: true, opacity: 0.75, depthWrite: false })));
    ring.position.y = k * 0.9;
    wave.add(ring);
  }
  wave.position.set(xc, standoff + H + 1.2, 0);
  wave.visible = false;
  wave.userData.soundWave = true;
  wave.traverse((o) => { o.userData.noPick = true; });
  g.add(wave);
  root.userData.topY = (standoff + H) * MM;
  root.userData.back = (r + 0.6) * MM;
  return root;
}

/* ======================= ตัวต้านทานไวแสง (LDR) Ø5 mm ======================= */

/**
 * LDR Ø5 mm (แบบ GL5528): แผ่นเซรามิกขาว Ø5.1 × หนา 2.1 mm เคลือบอีพ็อกซีใส มีลายเส้น CdS สีส้มแดงซิกแซก
 * ตัวตั้งขึ้น หน้ารับแสงหัน +z (ด้านหน้า) ขาออกจากขอบล่างห่าง 3.4 mm แล้วถ่างลงรูตาม span
 * แสดงระดับแสงที่ตั้งไว้ด้วยกรวยแสงจาง ๆ ด้านหน้า (มองเห็นมากขึ้นเมื่อสว่างขึ้น)
 */
export function buildLdr5(span: number, lux: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const D = 5.1, T = 2.1, lift = 3.2, xc = (span * PITCH) / 2;
  const yc = lift + D / 2;
  // ลาย CdS: ซิกแซกแบบหวีสองข้างเข้าหากัน
  const face = canvasTex('ldr:face', 256, 256, (x, w, h) => {
    x.fillStyle = '#f2efe6'; x.beginPath(); x.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); x.fill();
    x.save(); x.beginPath(); x.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2); x.clip();
    x.strokeStyle = '#c4462c'; x.lineWidth = 11; x.lineJoin = 'round';
    x.beginPath();
    const n = 7, top = h * 0.12, bot = h * 0.88;
    for (let i = 0; i <= n; i++) { const y = top + ((bot - top) * i) / n; if (i === 0) x.moveTo(w * 0.12, y); x.lineTo(i % 2 ? w * 0.12 : w * 0.88, y); if (i < n) x.lineTo(i % 2 ? w * 0.12 : w * 0.88, top + ((bot - top) * (i + 1)) / n); }
    x.stroke();
    x.restore();
    x.fillStyle = 'rgba(190,175,150,0.9)'; x.fillRect(w * 0.02, h * 0.46, w * 0.08, h * 0.08); x.fillRect(w * 0.9, h * 0.46, w * 0.08, h * 0.08);
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, T * 0.75, 40).rotateX(Math.PI / 2), mat('ldrCer', () => new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.7 })));
  disc.position.set(xc, yc, 0);
  g.add(disc);
  for (const sz of [1, -1]) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(D / 2 - 0.02, 40), new THREE.MeshStandardMaterial({ map: face, roughness: 0.35 }));
    f.position.set(xc, yc, sz * (T * 0.375 + 0.01));
    if (sz < 0) f.rotation.y = Math.PI;
    g.add(f);
  }
  // เคลือบใสด้านหน้า
  const coat = new THREE.Mesh(new THREE.SphereGeometry(D / 2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.12, 1).rotateX(Math.PI / 2), mat('ldrCoat', () => new THREE.MeshPhysicalMaterial({ color: 0xfff6e0, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.28, depthWrite: false })));
  coat.position.set(xc, yc, T * 0.375 + 0.02);
  g.add(coat);
  // ขา Ø0.5 ออกจากขอบล่าง (ห่าง 3.4 mm) ลงรู
  for (let i = 0; i < 2; i++) {
    const xb = xc + (i ? 1.7 : -1.7), xh = i * span * PITCH;
    g.add(roundLead([V(xb, lift + 0.4), V(xb, lift - 0.6), V(xh, 1.0), V(xh, 0)], 0.5, pins[i]));
  }
  // กรวยแสง (ตกบนหน้ารับแสง) — โปร่งตามระดับแสง
  const lv = lux > 0 ? Math.min(1, Math.log10(1 + lux) / 4) : 0;
  if (lv > 0.02) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(D * 0.55, 6, 24, 1, true).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.04 + 0.16 * lv, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(xc, yc, T / 2 + 3.1);
    cone.userData.noPick = true;
    cone.userData.lightCone = true;
    g.add(cone);
  }
  root.userData.topY = (lift + D) * MM;
  root.userData.back = (T / 2 + 0.8) * MM;
  return root;
}

/* ======================= เทอร์มิสเตอร์ NTC MF52A ======================= */

/**
 * NTC หัวหยดอีพ็อกซี่สีดำ (MF52A): หัว Ø 2.8 × 4 mm รูปหยดน้ำ ขาลวดทองแดงเคลือบดีบุก Ø 0.4 ห่าง 1.7 mm ที่โคนหัว
 * ยกหัวสูงจากบอร์ด 5 mm · มีรัศมีสีบอกอุณหภูมิรอบตัว (ฟ้า = เย็น, ส้มแดง = ร้อน) เพื่อให้เห็นว่ากำลังจำลองที่อุณหภูมิเท่าใด
 */
export function buildNtcBead(span: number, temp: number, pins: [string, string]): THREE.Group {
  const { root, g } = rootGroups();
  const lift = 5, Dh = 2.8, Hh = 4, xc = (span * PITCH) / 2;
  // โปรไฟล์หยดน้ำ (หมุนรอบแกนตั้ง): ฐานแคบที่ขาออก ป่องกลาง มนด้านบน
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, y = t * Hh;
    const r = (Dh / 2) * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95)) ** 0.7 * (t < 0.15 ? 0.55 + t * 3 : 1);
    prof.push(new THREE.Vector2(Math.max(0.35, r), y));
  }
  prof.push(new THREE.Vector2(0.001, Hh));
  const bead = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), mat('ntcEpoxy', () => new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 })));
  bead.scale.z = 0.8; // หัวหยดแบนเล็กน้อยตามแนวขา
  bead.position.set(xc, lift, 0);
  g.add(bead);
  for (let i = 0; i < 2; i++) {
    const xb = xc + (i ? 0.85 : -0.85), xh = i * span * PITCH;
    g.add(roundLead([V(xb, lift + 0.6), V(xb, lift - 1.2), V(xh, 1.2), V(xh, 0)], 0.4, pins[i]));
  }
  // รัศมีอุณหภูมิ: ไม่แสดงที่ 20–30 °C
  const hot = temp > 30, cold = temp < 20;
  if (hot || cold) {
    const k = hot ? Math.min(1, (temp - 30) / 70) : Math.min(1, (20 - temp) / 20);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 16), new THREE.MeshBasicMaterial({ color: hot ? 0xff6a2a : 0x66b8ff, transparent: true, opacity: 0.06 + 0.18 * k, depthWrite: false }));
    halo.position.set(xc, lift + Hh / 2, 0);
    halo.userData.noPick = true;
    halo.userData.tempHalo = true;
    g.add(halo);
  }
  root.userData.topY = (lift + Hh) * MM;
  root.userData.back = (Dh / 2 + 0.6) * MM;
  return root;
}

/* ======================= ตัวแสดงผล 7 ส่วน 0.56" ======================= */

/**
 * ตัวแสดงผล 7 ส่วน 0.56" 10 ขา (แบบ 5161AS/BS): ตัวถัง 12.6 (กว้าง) × 19 (สูง) × 8 mm (หนา) วางหงายหน้าขึ้น
 * ตัวเลขสูง 14.2 mm เอียง ≈ 10° — ขา 1–5 แถวล่าง (ฝั่ง +z, x = 0..10.16) ขา 6–10 แถวบน (z = −15.24) ห่าง 0.6"
 * ส่วนแต่ละส่วนใช้วัสดุของตัวเอง (userData.segMats) เพื่อให้ฉากปรับความสว่างตามกระแสได้
 */
export function buildSevenSeg(pins: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const W = 12.6, Hh = 19, T = 8, standoff = 0.3;
  const xc = 2 * PITCH, zc = -3 * PITCH;
  const body = new THREE.Mesh(new RoundedBoxGeometryLite(W, T, Hh, 0.3), mat('ssBody', () => new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.55 })));
  body.position.set(xc, standoff + T / 2, zc);
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, Hh - 0.6).rotateX(-Math.PI / 2), mat('ssFace', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.8 })));
  face.position.set(xc, standoff + T + 0.005, zc);
  g.add(face);
  // ส่วน: (u ขวา, v ขึ้น) บนหน้า → x = xc + u, z = zc − v; เอียงตัว u += 0.17·v
  const segMats: Record<string, THREE.MeshStandardMaterial> = {};
  const sw = 1.35, hl = 2.9, vy = 6.6, ux = 3.55;
  const bar = (len: number) => {
    const s = new THREE.Shape();
    const h = sw / 2;
    s.moveTo(-len / 2, 0); s.lineTo(-len / 2 + h, h); s.lineTo(len / 2 - h, h); s.lineTo(len / 2, 0); s.lineTo(len / 2 - h, -h); s.lineTo(-len / 2 + h, -h); s.closePath();
    return new THREE.ShapeGeometry(s);
  };
  const defs: Array<[string, number, number, number, number]> = [
    // name, u, v, angle(rad), length
    ['a', 0, vy, 0, hl * 2.35], ['g', 0, 0, 0, hl * 2.35], ['d', 0, -vy, 0, hl * 2.35],
    ['f', -ux, vy / 2, Math.PI / 2, vy - 0.5], ['b', ux, vy / 2, Math.PI / 2, vy - 0.5],
    ['e', -ux, -vy / 2, Math.PI / 2, vy - 0.5], ['c', ux, -vy / 2, Math.PI / 2, vy - 0.5],
  ];
  const slant = 0.17;
  for (const [name, u, v, ang, len] of defs) {
    const geo = bar(len);
    geo.rotateZ(ang);
    // เอียงตัว (shear) แล้ววางบนหน้า
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const yy = pos.getY(i) + v; pos.setX(i, pos.getX(i) + u + slant * yy); pos.setY(i, yy); }
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x8c8580, roughness: 0.5, emissive: 0xff2a1f, emissiveIntensity: 0 });
    segMats[name] = m;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(xc, standoff + T + 0.012, zc);
    g.add(mesh);
  }
  const dpm = new THREE.MeshStandardMaterial({ color: 0x8c8580, roughness: 0.5, emissive: 0xff2a1f, emissiveIntensity: 0 });
  segMats.dp = dpm;
  const dp = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2), dpm);
  dp.position.set(xc + ux + 1.6 + slant * -vy, standoff + T + 0.012, zc + vy);
  g.add(dp);
  g.userData.segMats = segMats;
  root.userData.segMats = segMats;
  // ขา 10 ขา Ø 0.5 ตรงลงจากใต้ตัว (ขา 1–5 z = 0, ขา 6–10 z = −15.24)
  pins.forEach((name, i) => {
    const pin = i + 1;
    const x = (pin <= 5 ? pin - 1 : 10 - pin) * PITCH, z = pin <= 5 ? 0 : -6 * PITCH;
    g.add(roundLead([V(x, standoff + 0.5, z), V(x, 0, z)], 0.5, name));
  });
  root.userData.topY = (standoff + T) * MM;
  root.userData.back = (6 * PITCH + 2.5) * MM;
  return root;
}

/* ======================= โมดูลรีเลย์ 5 V 1 ช่อง ======================= */

/** ตำแหน่งจุดต่อของโมดูลรีเลย์ (หน่วยรู, จุดกึ่งกลาง PCB = 0, ก่อนหมุน) — ใช้ร่วมกับ tablePinLocal */
export const RELAY_PIN_LOCAL: Record<string, [number, number, number]> = {
  // หัวเข็ม 3 ขา ระยะ 2.54 mm ที่ขอบซ้าย ปลายเข็มสูงจาก PCB 8.5 mm
  S: [-5.75, (1.6 + 8.5) / 2.54, -1], V: [-5.75, (1.6 + 8.5) / 2.54, 0], G: [-5.75, (1.6 + 8.5) / 2.54, 1],
  // ขั้วสกรู 3 ช่อง ระยะ 5.08 mm ที่ขอบขวา (หัวสกรูสูงจาก PCB ≈ 10 mm)
  NC: [5.15, (1.6 + 10.2) / 2.54, -2], COM: [5.15, (1.6 + 10.2) / 2.54, 0], NO: [5.15, (1.6 + 10.2) / 2.54, 2],
};

/**
 * โมดูลรีเลย์ 1 ช่อง (แบบทั่วไปที่ใช้ SRD-05VDC-SL-C ไม่มีออปโต้): PCB สีน้ำเงิน 34 × 26 × 1.6 mm,
 * รีเลย์ 19.2 × 15.6 × 15.8 mm, ขั้วสกรูเขียว 3 ช่อง (5.08 mm), หัวเข็มตัวผู้ 3 ขา (S + −), LED แดง, ทรานซิสเตอร์และไดโอดบนบอร์ด
 * ไม่ใส่โลโก้ผู้ผลิต — พิมพ์เฉพาะรุ่นและพิกัดบนตัวรีเลย์ · กลุ่มรากเป็นหน่วยรู (วางบนโต๊ะ)
 */
export function buildRelayModule(): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const L = 34, W = 26, T = 1.6;
  const pcb = new THREE.Mesh(new RoundedBoxGeometryLite(L, T, W, 0.4), mat('relPcb', () => new THREE.MeshStandardMaterial({ color: 0x1d4f9a, roughness: 0.55 })));
  pcb.position.y = 1.2 + T / 2; // ยกด้วยหัวน็อต/ขาใต้บอร์ด
  g.add(pcb);
  const yTop = 1.2 + T;
  // ตัวพิมพ์บน PCB
  // ชื่อขาหัวเข็มพิมพ์ข้างแต่ละขา (S, +, −) ระหว่างหัวเข็มกับตัวรีเลย์
  const silkCol = 'rgba(240,242,245,0.92)';
  for (const [pin, txt] of [['S', 'S'], ['V', '+'], ['G', '−']] as const) {
    const d = decal(textTex(`rel:h:${pin}`, [txt], silkCol, 128, 128, 110), 2.2, 2.2);
    d.rotation.x = -Math.PI / 2;
    d.position.set(-12.0, yTop + 0.01, RELAY_PIN_LOCAL[pin][2] * 2.54);
    g.add(d);
  }
  // รีเลย์
  const rel = new THREE.Mesh(new RoundedBoxGeometryLite(19.2, 15.8, 15.6, 0.5), mat('relBody', () => new THREE.MeshStandardMaterial({ color: 0x2a62c9, roughness: 0.4 })));
  rel.position.set(-0.8, yTop + 15.8 / 2, -2.6);
  g.add(rel);
  const label = decal(textTex('rel:label', ['SRD-05VDC-SL-C', '10A 250VAC 10A 30VDC', '10A 125VAC 10A 28VDC'], 'rgba(245,247,250,0.95)', 512, 256, 44), 17, 8.5);
  label.rotation.x = -Math.PI / 2;
  label.position.set(-0.8, yTop + 15.8 + 0.02, -2.6);
  g.add(label);
  const side = decal(textTex('rel:side', ['5VDC'], 'rgba(245,247,250,0.9)', 256, 96, 70), 8, 3);
  side.position.set(-0.8, yTop + 10, -2.6 + 7.8 + 0.02);
  g.add(side);
  // ขั้วสกรู 3 ช่อง
  const tb = new THREE.Mesh(new RoundedBoxGeometryLite(7.6, 10, 15.2, 0.3), mat('relTb', () => new THREE.MeshStandardMaterial({ color: 0x1f8a4c, roughness: 0.55 })));
  tb.position.set(13.1, yTop + 5, 0);
  g.add(tb);
  const steel = mat('relScrew', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 1 })));
  for (const pin of ['NC', 'COM', 'NO'] as const) {
    const [x, , z] = RELAY_PIN_LOCAL[pin];
    const head = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 20), steel);
    head.position.set(x * 2.54, yTop + 10 + 0.1, z * 2.54);
    head.userData.leadTip = pin; // จุดต่อสาย (ใช้ตรวจตำแหน่งขา)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.4), mat('relSlot', () => new THREE.MeshBasicMaterial({ color: 0x3a3d40 })));
    slot.position.set(x * 2.54, yTop + 10 + 0.45, z * 2.54);
    // ช่องเสียบสายด้านข้าง
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 3.0), mat('relMouth', () => new THREE.MeshBasicMaterial({ color: 0x101112 })));
    mouth.position.set(13.1 + 3.81, yTop + 3.2, z * 2.54);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x * 2.54, yTop + 10, z * 2.54);
    hit.userData = { pin, isPin: true };
    // ชื่อขั้วพิมพ์บนขั้วสกรู ข้างหัวสกรู (อ่านจากด้านที่เสียบสาย)
    const lab = new THREE.Group();
    const d = decal(textTex(`rel:t:${pin}`, [pin], silkCol, 256, 96, 80), 4.0, 1.5);
    d.rotation.x = -Math.PI / 2;
    lab.add(d);
    lab.rotation.y = Math.PI / 2;
    lab.position.set(10.4, yTop + 10 + 0.02, z * 2.54);
    g.add(head, slot, mouth, hit, lab);
  }
  // หัวเข็ม 3 ขา: ฐานพลาสติกดำ + เข็มทองเหลืองสี่เหลี่ยม 0.64 mm
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 7.62), mat('relHdr', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  hdr.position.set(-5.75 * 2.54, yTop + 1.25, 0);
  g.add(hdr);
  const gold = mat('relGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (const pin of ['S', 'V', 'G'] as const) {
    const [x, y, z] = RELAY_PIN_LOCAL[pin];
    const h0 = yTop - 2.5, h1 = y * 2.54;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, h1 - h0, 0.64), gold);
    p.position.set(x * 2.54, (h0 + h1) / 2, z * 2.54);
    p.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x * 2.54, h1 - 1.5, z * 2.54);
    hit.userData = { pin, isPin: true };
    g.add(p, hit);
  }
  // LED สถานะ (SMD 0805) — scene ปรับความสว่างตามกระแส
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x7a1c16, roughness: 0.3, emissive: 0xff2a1f, emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 1.25), ledMat);
  led.position.set(-12.0, yTop + 0.4, 9.0);
  g.add(led);
  root.userData.relayLed = ledMat;
  // ทรานซิสเตอร์ SOT-23, ไดโอด, ตัวต้านทาน SMD
  const smd = mat('relSmd', () => new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5 }));
  for (const [x, z, w, d] of [[-8, 9, 2.9, 1.3], [-4.5, 9.2, 3.5, 1.6], [-12, 5.5, 2.0, 1.25], [-8, 5.6, 2.0, 1.25]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), smd);
    m.position.set(x, yTop + 0.5, z);
    g.add(m);
  }
  // รูยึด 4 มุม
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.9, 20).rotateX(-Math.PI / 2), mat('relRing', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9c27a, metalness: 1, roughness: 0.35 }))));
    ring.position.set(sx * (L / 2 - 2.6), yTop + 0.012, sz * (W / 2 - 2.6));
    g.add(ring);
  }
  return root;
}

/* ======================= หม้อแปลงแกนเหล็ก EI-57 230 V → 12-0-12 V ======================= */

/** ตำแหน่งขั้วสกรูด้านทุติยภูมิ (หน่วยบอร์ด, ก่อนหมุน) — ขั้วเรียง A, CT, B ระยะ 5.08 mm บนบล็อกหน้าหม้อแปลง */
const TR_DZ = -7.5; // เลื่อนทั้งชิ้นให้ศูนย์กลางรอยวางอยู่กลาง (mm)
const TR_TB_Z = 33 + TR_DZ, TR_TB_TOP = 10;
export const TRANSFORMER_PIN_LOCAL: Record<string, [number, number, number]> = {
  A: [-5.08 / 2.54, (TR_TB_TOP + 0.4) / 2.54, TR_TB_Z / 2.54],
  CT: [0, (TR_TB_TOP + 0.4) / 2.54, TR_TB_Z / 2.54],
  B: [5.08 / 2.54, (TR_TB_TOP + 0.4) / 2.54, TR_TB_Z / 2.54],
};

/**
 * หม้อแปลง EI-57 (แกน 57 × 47.5 mm ซ้อนหนา 30 mm) ขดลวดพันเทปเหลืองโผล่หน้า-หลังแกน, ขาเหล็กยึดสองข้าง,
 * สายทุติยภูมิ 3 เส้น (เหลือง–ดำ–เหลือง) ลงบล็อกขั้วสกรู A/CT/B ด้านหน้า, สายไฟบ้านพร้อมปลั๊กด้านหลัง
 */
export function buildTransformerEI(): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const W = 57, Hc = 47.5, D = 30, y0 = 3; // ยกด้วยขาเหล็ก
  const steel = mat('trCore', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.45, metalness: 0.7 })));
  // แกนเหล็กแผ่นบาง (เส้นรอยต่อแผ่นด้วยลายบนด้านข้าง)
  const lamTex = canvasTex('trLam', 256, 64, (x, w, h) => {
    x.fillStyle = '#6d7175'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 4) { x.fillStyle = i % 8 ? 'rgba(40,42,45,0.35)' : 'rgba(200,205,210,0.18)'; x.fillRect(i, 0, 1.2, h); }
  });
  const sideMat = mat('trLamSide', () => withEnv(new THREE.MeshStandardMaterial({ map: lamTex, roughness: 0.5, metalness: 0.6 })));
  const core = new THREE.Mesh(new THREE.BoxGeometry(W, Hc, D), [sideMat, sideMat, steel, steel, steel, steel]);
  core.position.set(0, y0 + Hc / 2, TR_DZ);
  g.add(core);
  // ขดลวด: ส่วนที่โผล่จากแกนด้านหน้าและหลัง (กว้างตามหน้าต่าง 38 mm สูง 28.5 mm) พันเทปเหลือง
  const tape = mat('trTape', () => new THREE.MeshStandardMaterial({ color: 0xe8c64a, roughness: 0.55 }));
  for (const side of [1, -1]) {
    const coil = new THREE.Mesh(new RoundedBoxGeometryLite(38, 28.5, 8, 2.5), tape);
    coil.position.set(0, y0 + 9.5 + 28.5 / 2, TR_DZ + side * (D / 2 + 3.6));
    g.add(coil);
  }
  // ป้ายบนเทปด้านหน้า
  const lab = decal(textTex('trLabel', ['230V~ 50Hz', '12-0-12V 1A'], 'rgba(30,30,30,0.92)', 512, 256, 70), 30, 15);
  lab.position.set(0, y0 + 9.5 + 28.5 / 2, TR_DZ + D / 2 + 7.65);
  g.add(lab);
  // ขาเหล็กยึด (ฉากรูปตัว L) สองข้าง พร้อมรูน็อต
  const bracket = mat('trBracket', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.35, metalness: 0.9 })));
  for (const sx of [1, -1]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(1, 20, D + 2), bracket);
    up.position.set(sx * (W / 2 + 0.5), y0 + 10, TR_DZ);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(8, 1, D + 2), bracket);
    foot.position.set(sx * (W / 2 + 4), 0.5, TR_DZ);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.1, 16), mat('trHole', () => new THREE.MeshBasicMaterial({ color: 0x2a2c2e })));
    hole.position.set(sx * (W / 2 + 4.5), 0.55, TR_DZ);
    g.add(up, foot, hole);
  }
  // บล็อกขั้วสกรูด้านทุติยภูมิ
  const tb = new THREE.Mesh(new RoundedBoxGeometryLite(15.6, TR_TB_TOP, 8, 0.3), mat('relTb', () => new THREE.MeshStandardMaterial({ color: 0x1f8a4c, roughness: 0.55 })));
  tb.position.set(0, TR_TB_TOP / 2, TR_TB_Z);
  g.add(tb);
  const screwM = mat('relScrew', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 1 })));
  const wireCol: Record<string, number> = { A: 0xf0c419, CT: 0x1b1b1b, B: 0xf0c419 };
  for (const pin of ['A', 'CT', 'B'] as const) {
    const [ux, , uz] = TRANSFORMER_PIN_LOCAL[pin];
    const x = ux * 2.54, z = uz * 2.54;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 20), screwM);
    head.position.set(x, TR_TB_TOP + 0.1, z);
    head.userData.leadTip = pin;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.4), mat('relSlot', () => new THREE.MeshBasicMaterial({ color: 0x3a3d40 })));
    slot.position.set(x, TR_TB_TOP + 0.45, z);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, TR_TB_TOP, z);
    hit.userData = { pin, isPin: true };
    const t = decal(textTex(`tr:t:${pin}`, [pin], 'rgba(240,242,245,0.95)', 256, 128, 96), 3.6, 1.8);
    t.rotation.x = -Math.PI / 2;
    t.position.set(x, TR_TB_TOP + 0.02, z + 2.8);
    // สายจากขดลวดด้านหน้าลงมาเข้าด้านหลังบล็อก
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x * 1.6, y0 + 14, TR_DZ + D / 2 + 7.5), new THREE.Vector3(x * 1.3, 9, TR_TB_Z - 7), new THREE.Vector3(x, 4, TR_TB_Z - 4.2),
    ]);
    const w = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.7, 8), mat(`trWire${pin}`, () => new THREE.MeshStandardMaterial({ color: wireCol[pin], roughness: 0.5 })));
    g.add(head, slot, hit, t, w);
  }
  // สายไฟบ้านด้านหลัง (ปฐมภูมิ) + ปลั๊ก — ไม่อยู่ในการจำลอง
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6, y0 + 16, TR_DZ - D / 2 - 7.5), new THREE.Vector3(-10, 3, TR_DZ - D / 2 - 14), new THREE.Vector3(-20, 1.6, TR_DZ - D / 2 - 18), new THREE.Vector3(-30, 1.6, TR_DZ - D / 2 - 19),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 24, 1.6, 10), mat('trCord', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 }))));
  const plug = new THREE.Mesh(new RoundedBoxGeometryLite(10, 6, 14, 1.2), mat('trPlug', () => new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.5 })));
  plug.rotation.y = Math.PI / 2;
  plug.position.set(-36, 3, TR_DZ - D / 2 - 19);
  g.add(plug);
  for (const dz of [-2.3, 2.3]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 8, 10), tin());
    pin.rotation.z = Math.PI / 2;
    pin.position.set(-45, 3, TR_DZ - D / 2 - 19 + dz);
    g.add(pin);
  }
  root.userData.topY = (y0 + Hc) / 2.54;
  root.userData.back = (TR_DZ - D / 2 - 8) / 2.54;
  return root;
}

/* ======================= เซอร์โว SG90 (9 g) ======================= */

const SV_DZ = -7; // ตัวเซอร์โวอยู่หลัง หัวต่อสายอยู่หน้า (mm)
const SV_CON_Z = 15, SV_CON_LEN = 14, SV_CON_H = 2.6;
/** จุดต่อสายที่หัวต่อตัวเมีย 3 ขา (สายน้ำตาล–แดง–ส้ม) หน่วยบอร์ด ก่อนหมุน */
export const SERVO_PIN_LOCAL: Record<string, [number, number, number]> = {
  GND: [-2.54 / 2.54, (SV_CON_H + 0.3) / 2.54, (SV_CON_Z + SV_CON_LEN / 2 - 1) / 2.54],
  V: [0, (SV_CON_H + 0.3) / 2.54, (SV_CON_Z + SV_CON_LEN / 2 - 1) / 2.54],
  SIG: [2.54 / 2.54, (SV_CON_H + 0.3) / 2.54, (SV_CON_Z + SV_CON_LEN / 2 - 1) / 2.54],
};
/** มุมแขน (องศา 0–180) → การหมุนรอบแกน y ของกลุ่มแขน: 90° ชี้มาด้านหน้า (+z), 0° ชี้ขวา (+x), 180° ชี้ซ้าย */
export const servoHornRotation = (deg: number) => -(deg * Math.PI) / 180;

/**
 * SG90: ตัวถังพลาสติกฟ้าโปร่ง 22.5 × 11.8 × 22.7 mm, หูยึดรวมยาว 32.5 mm สูงจากฐาน 15.9 mm, เฟืองบนพร้อมแกนเฟืองฟัน (spline)
 * ที่ระยะ 5.35 mm จากกึ่งกลาง, แขนเดี่ยวสีขาว (root.userData.servoHorn หมุนตามมุม), สาย 3 เส้นไปหัวต่อ 2.54 mm
 */
export function buildServoSG90(): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const blue = mat('svBody', () => new THREE.MeshPhysicalMaterial({ color: 0x2c64c8, roughness: 0.28, transmission: 0.25, thickness: 2, transparent: true, opacity: 0.92 }));
  const L = 22.5, H = 22.7, W = 11.8, sx = 5.35;
  const body = new THREE.Mesh(new RoundedBoxGeometryLite(L, H, W, 0.6), blue);
  body.position.set(0, H / 2, SV_DZ);
  g.add(body);
  const tabs = new THREE.Mesh(new RoundedBoxGeometryLite(32.5, 2.5, W, 0.4), blue);
  tabs.position.set(0, 15.9 + 1.25, SV_DZ);
  g.add(tabs);
  const dark = mat('svHole', () => new THREE.MeshBasicMaterial({ color: 0x0d1a33 }));
  for (const x of [-13.9, 13.9]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 12), dark);
    h.position.set(x, 17.15, SV_DZ);
    g.add(h);
  }
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, 4, 32), blue);
  gear.position.set(sx, H + 2, SV_DZ);
  const bump = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.4, 20), blue);
  bump.position.set(-1.2, H + 1.2, SV_DZ);
  const cream = mat('svSpline', () => new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.5 }));
  const spline = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 18), cream);
  spline.position.set(sx, H + 4 + 1.6, SV_DZ);
  g.add(gear, bump, spline);
  // ป้ายข้างตัว (ไม่มีโลโก้ผู้ผลิต)
  const lab = decal(textTex('svLabel', ['SG90 9g', 'MICRO SERVO'], 'rgba(245,247,250,0.92)', 512, 256, 64), 18, 9);
  lab.position.set(0, 8.5, SV_DZ + W / 2 + 0.02);
  g.add(lab);
  // แขนเดี่ยว (horn) — หมุนรอบแกน y ของ spline
  const horn = new THREE.Group();
  horn.position.set(sx, H + 4 + 3.2 + 0.75, SV_DZ);
  const white = mat('svHorn', () => new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.45 }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.5, 24), white);
  const shape = new THREE.Shape();
  shape.moveTo(0, -3.0); shape.lineTo(16, -1.8); shape.absarc(16, 0, 1.8, -Math.PI / 2, Math.PI / 2, false); shape.lineTo(0, 3.0); shape.closePath();
  const arm = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }), white);
  arm.rotation.x = Math.PI / 2; // วางแนวนอน (แกนยาวตาม +x)
  arm.position.y = 0.75;
  horn.add(hub, arm);
  for (let k = 0; k < 5; k++) {
    const hh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 10), dark);
    hh.position.set(6 + k * 2.4, 0.05, 0);
    horn.add(hh);
  }
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 12), tin());
  screw.position.y = 0.95;
  horn.add(screw);
  horn.rotation.y = servoHornRotation(90);
  g.add(horn);
  root.userData.servoHorn = horn;
  // สาย 3 เส้น (น้ำตาล แดง ส้ม) จากปลายตัวถังลงโต๊ะไปหัวต่อด้านหน้า
  const cols = [0x6b3e1f, 0xc62828, 0xf28c28];
  ['GND', 'V', 'SIG'].forEach((pin, k) => {
    const [ux] = SERVO_PIN_LOCAL[pin];
    const x = ux * 2.54;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-L / 2 - 0.5, 4 + k * 0.0, SV_DZ + (k - 1) * 1.0), new THREE.Vector3(-L / 2 - 4, 0.6, SV_DZ + 4 + (k - 1) * 1.0),
      new THREE.Vector3(-6 + x * 0.5, 0.6, SV_CON_Z - SV_CON_LEN / 2 - 6), new THREE.Vector3(x, 1.3, SV_CON_Z - SV_CON_LEN / 2),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.5, 8), mat(`svWire${k}`, () => new THREE.MeshStandardMaterial({ color: cols[k], roughness: 0.5 }))));
  });
  const con = new THREE.Mesh(new RoundedBoxGeometryLite(7.8, SV_CON_H, SV_CON_LEN, 0.3), mat('svCon', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 })));
  con.position.set(0, SV_CON_H / 2, SV_CON_Z);
  g.add(con);
  for (const pin of ['GND', 'V', 'SIG'] as const) {
    const [ux, uy, uz] = SERVO_PIN_LOCAL[pin];
    const sock = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 1.1), dark);
    sock.position.set(ux * 2.54, SV_CON_H + 0.02, uz * 2.54);
    sock.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(ux * 2.54, uy * 2.54, uz * 2.54);
    hit.userData = { pin, isPin: true };
    g.add(sock, hit);
  }
  root.userData.topY = (H + 4 + 3.2 + 2) / 2.54;
  root.userData.back = (SV_DZ - W / 2 - 1) / 2.54;
  return root;
}

/* ======================= มอเตอร์ DC เกียร์ TT 1:48 ======================= */

const TT_SHAFT_X = 23, TT_AXIS_Y = 11;
/** ปลายสายแดง/ดำ (ขาตัวผู้ 2.54 mm วางบนโต๊ะด้านหน้า) หน่วยบอร์ด ก่อนหมุน */
/* ======================= ลำโพง 57 mm ======================= */

/** ปลายขาตัวผู้ของสายลำโพง (หน่วยรู, local ก่อนหมุน) — ด้านหน้า (+z) ของตัวลำโพง */
export const SPEAKER_PIN_LOCAL: Record<string, [number, number, number]> = {
  P: [-3 / 2.54, 1.3 / 2.54, 33 / 2.54],
  N: [3 / 2.54, 1.3 / 2.54, 33 / 2.54],
};

/**
 * ลำโพงไดนามิก Ø 57 mm 8 Ω 0.5 W วางหงายบนโต๊ะ (แม่เหล็กอยู่ล่าง): สูงรวม ≈ 25 mm
 * แม่เหล็กเฟอร์ไรต์ Ø 32 × 8 mm + แผ่นเหล็ก · โครงเหล็กปั๊ม (basket) สีดำ · ขอบยาง (surround) · กรวยกระดาษ · ฝาครอบกันฝุ่น
 * ขั้วบัดกรีสองขั้วที่ขอบด้านหน้า → สายแดง/ดำ → ขาตัวผู้ห่าง 6 mm (เสียบสายจัมเปอร์ได้)
 * userData.speakerCone: กลุ่มกรวย (ฉากขยับตามระดับเสียง)
 */
export function buildSpeaker57(): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const zc = -7.6; // จุดศูนย์กลางตัวลำโพง (mm) — เว้นด้านหน้าให้สาย
  const steel = mat('spkSteel', () => new THREE.MeshStandardMaterial({ color: 0xa7abb0, roughness: 0.4, metalness: 0.3 }));
  // แม่เหล็ก + แผ่นยึด
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 7, 40), mat('spkMag', () => new THREE.MeshStandardMaterial({ color: 0x47494d, roughness: 0.7 })));
  magnet.position.set(0, 4.5, zc);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(16.5, 16.5, 1, 40), steel);
  plate.position.set(0, 0.5, zc);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1.2, 40), steel);
  top.position.set(0, 8.6, zc);
  g.add(magnet, plate, top);
  // โครง basket: กรวยเหล็กเปิดช่อง (ใช้ lathe ด้านข้างบาง ๆ)
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(27.5, 13, 14, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x9ca0a5, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }));
  basket.position.set(0, 9.2 + 7, zc);
  g.add(basket);
  // ขอบหน้าแปลน (flange) วงแหวน Ø 57 พร้อมรูยึด 4 รู
  const flange = new THREE.Mesh(new THREE.RingGeometry(25, 28.5, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
  flange.position.set(0, 23.3, zc);
  g.add(flange);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16).rotateX(-Math.PI / 2), mat('spkHole', () => new THREE.MeshBasicMaterial({ color: 0x050505 })));
    hole.position.set(Math.cos(a) * 26.8, 23.32, zc + Math.sin(a) * 26.8);
    g.add(hole);
  }
  // กลุ่มกรวย: ขอบยาง + กรวยกระดาษ + ฝากันฝุ่น
  const cone = new THREE.Group();
  cone.position.set(0, 0, zc);
  const surround = new THREE.Mesh(new THREE.TorusGeometry(23.6, 1.5, 10, 64).rotateX(Math.PI / 2), mat('spkSurround', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 })));
  surround.position.y = 23.4;
  surround.scale.y = 0.6;
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(22.3, 9, 9.5, 48, 1, true), mat('spkPaper', () => new THREE.MeshStandardMaterial({ color: 0x303032, roughness: 0.95, side: THREE.DoubleSide })));
  paper.position.y = 23.2 - 4.75;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(9.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), mat('spkCap', () => new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.5 })));
  cap.position.y = 13.7 - 9.5 * Math.cos(Math.PI / 3.2) + 0.2;
  cone.add(surround, paper, cap);
  g.add(cone);
  root.userData.speakerCone = cone;
  // ขั้วบัดกรีที่ขอบด้านหน้า + สาย + ขาตัวผู้
  for (const [pin, col] of [['P', 0xc62828], ['N', 0x1b1b1b]] as const) {
    const [ux, uy, uz] = SPEAKER_PIN_LOCAL[pin];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    const tx = pin === 'P' ? -7 : 7, tz = zc + 25.5;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 5), tin());
    tab.position.set(tx, 21, tz);
    g.add(tab);
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(tx, 21, tz + 2), new THREE.Vector3(tx, 18, tz + 5), new THREE.Vector3((tx + x) / 2, 3, tz + 9), new THREE.Vector3(x, 1.3, z - 7)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.55, 8), mat(`spkWire${pin}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }))));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 7), mat('ttPinHousing', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
    housing.position.set(x, 1.3, z - 3.5);
    const pinM = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.64, 5), tin());
    pinM.position.set(x, 1.3, z + 2.2);
    const tipMark = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), tin());
    tipMark.position.set(x, y, z);
    tipMark.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y, z);
    hit.userData = { pin, isPin: true };
    g.add(housing, pinM, tipMark, hit);
  }
  // จุดสี + ข้างขั้วบวก
  root.userData.topY = 25 / 2.54;
  root.userData.back = (-zc + 28.5) / 2.54;
  return root;
}

export const MOTOR_PIN_LOCAL: Record<string, [number, number, number]> = {
  A: [-26 / 2.54, 2.2 / 2.54, 15 / 2.54],
  B: [-20 / 2.54, 2.2 / 2.54, 15 / 2.54],
};

/**
 * มอเตอร์เกียร์ TT 1:48 (70 × 22 × 18 mm): กล่องเฟืองพลาสติกเหลือง, มอเตอร์กระป๋องโลหะ Ø20 mm, แกนออกสองด้าน (แกน D สีขาว)
 * จานบอกการหมุนสีขาว-แดงด้าน +z (root.userData.motorDisc หมุนรอบแกน z ตามมุมแกนออก), สายแดง/ดำไปขาตัวผู้ด้านหน้า
 */
export function buildTTMotor(): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const yellow = mat('ttGear', () => new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.45 }));
  const box = new THREE.Mesh(new RoundedBoxGeometryLite(40, 22, 18, 1.2), yellow);
  box.position.set(15, 11, 0);
  g.add(box);
  // หูยึดด้านปลายกล่องเฟือง (มีรู)
  const ear = new THREE.Mesh(new RoundedBoxGeometryLite(6, 3, 18, 0.6), yellow);
  ear.position.set(37.5, 1.5, 0);
  g.add(ear);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 12), mat('ttHole', () => new THREE.MeshBasicMaterial({ color: 0x2b2410 })));
  hole.position.set(38, 1.5, 0);
  g.add(hole);
  // ตัวหนังสือบนกล่องเฟือง
  const lab = decal(textTex('ttLabel', ['DC 3-6V', '1:48'], 'rgba(60,45,10,0.85)', 512, 256, 80), 16, 8);
  lab.rotation.x = -Math.PI / 2;
  lab.position.set(9, 22.02, 0);
  g.add(lab);
  // มอเตอร์กระป๋อง + ฝาท้ายพลาสติกดำ + ขาบัดกรี
  const can = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 27, 32), mat('ttCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9 }))));
  can.rotation.z = Math.PI / 2;
  can.position.set(-18.5, TT_AXIS_Y, 0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 3, 32), mat('ttCap', () => new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.6 })));
  cap.rotation.z = Math.PI / 2;
  cap.position.set(-33.5, TT_AXIS_Y, 0);
  g.add(can, cap);
  for (const dz of [-4, 4]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1.6), tin());
    tab.position.set(-35.6, TT_AXIS_Y + 3, dz);
    g.add(tab);
  }
  // แกนออกสองด้าน + จานบอกการหมุน
  const white = mat('ttShaft', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 }));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 34, 16), white);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(TT_SHAFT_X, TT_AXIS_Y, 0);
  g.add(shaft);
  const disc = new THREE.Group();
  disc.position.set(TT_SHAFT_X, TT_AXIS_Y, 15.5);
  const face = canvasTex('ttDisc', 256, 256, (x, w, h) => {
    x.fillStyle = '#f7f7f4'; x.beginPath(); x.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#d32f2f'; x.beginPath(); x.moveTo(w / 2, h / 2); x.arc(w / 2, h / 2, w / 2, -0.35, 0.35); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(w / 2, h / 2); x.arc(w / 2, h / 2, w / 2, Math.PI - 0.35, Math.PI + 0.35); x.closePath(); x.fill();
    x.fillStyle = '#333'; x.beginPath(); x.arc(w / 2, h / 2, 14, 0, Math.PI * 2); x.fill();
  });
  const dm = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.6, 40), [mat('ttDiscEdge', () => new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5 })), mat('ttDiscFace', () => new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 })), mat('ttDiscFace', () => new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }))]);
  dm.rotation.x = Math.PI / 2;
  disc.add(dm);
  g.add(disc);
  root.userData.motorDisc = disc;
  // สายแดง/ดำ จากขาบัดกรีไปขาตัวผู้ด้านหน้า
  for (const [pin, col, dz] of [['A', 0xc62828, 4], ['B', 0x1b1b1b, -4]] as const) {
    const [ux, uy, uz] = MOTOR_PIN_LOCAL[pin];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-35.6, TT_AXIS_Y + 5, dz), new THREE.Vector3(-38, TT_AXIS_Y + 2, dz + 2), new THREE.Vector3(-36, 1, 9), new THREE.Vector3(x, 1.0, z - 7),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.55, 8), mat(`ttWire${pin}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }))));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 7), mat('ttPinHousing', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
    housing.position.set(x, 1.3, z - 3.5);
    const pinM = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.64, 5), tin());
    pinM.position.set(x, 1.3, z + 2.2);
    const tipMark = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), tin());
    tipMark.position.set(x, y, z);
    tipMark.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y, z);
    hit.userData = { pin, isPin: true };
    g.add(housing, pinM, tipMark, hit);
  }
  root.userData.topY = 23 / 2.54;
  root.userData.back = -18 / 2.54;
  return root;
}

/* ======================= โมดูลวัดระยะอัลตราโซนิก HC-SR04 ======================= */

/**
 * HC-SR04 (ขนาดตามเอกสารโมดูล 45 × 20 × 15 mm): PCB สีน้ำเงินตั้งฉากกับบอร์ด, ลำโพงอัลตราโซนิก Ø16 × 12 mm สองตัว
 * (ห่างศูนย์กลาง 26 mm) หันไปทาง +z, คริสตัล HC-49S ระหว่างลำโพง, หัวเข็มตัวผู้ 4 ขา (Vcc Trig Echo Gnd) ลงรูบอร์ดเรียงตามแกน x
 * พิมพ์ชื่อรุ่น "HC-SR04" และชื่อขาเท่านั้น ไม่มีโลโก้ผู้ผลิต · กลุ่มรากหน่วยรู ขา 1 (VCC) ที่จุดกำเนิด
 */
export function buildSonarModule(): THREE.Group {
  const { root, g } = rootGroups();
  const cx = 1.5 * PITCH, y0 = 3.5, H = 20, W = 45, T = 1.6;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), mat('srPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 })));
  pcb.position.set(cx, y0 + H / 2, 0);
  g.add(pcb);
  const zf = T / 2;
  // ลำโพง/ไมโครโฟน: ตัวกระบอกโลหะ + หน้าตะแกรง
  const can = mat('srCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.28, metalness: 1 })));
  const meshTex = canvasTex('srMesh', 256, 256, (x, w, h) => {
    x.fillStyle = '#9a9ea3'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2a2c2f';
    for (let i = 6; i < w; i += 11) for (let j = 6; j < h; j += 11) { x.beginPath(); x.arc(i + ((j / 11) % 2) * 5, j, 3.4, 0, Math.PI * 2); x.fill(); }
  });
  const grille = mat('srGrille', () => new THREE.MeshStandardMaterial({ map: meshTex, roughness: 0.6, metalness: 0.4 }));
  for (const [sx, lab] of [[-13, 'T'], [13, 'R']] as const) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 12, 40, 1, true), can);
    body.rotation.x = Math.PI / 2;
    body.position.set(cx + sx, y0 + H / 2, zf + 6);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.45, 8, 40), can);
    rim.position.set(cx + sx, y0 + H / 2, zf + 12);
    const face = new THREE.Mesh(new THREE.CircleGeometry(7.4, 40), grille);
    face.position.set(cx + sx, y0 + H / 2, zf + 11.7);
    g.add(body, rim, face);
    const d = decal(textTex(`sr:${lab}`, [lab], 'rgba(240,242,245,0.95)', 64, 64, 50), 2.2, 2.2);
    d.position.set(cx + sx + (sx < 0 ? -9.5 : 9.5), y0 + H - 3, zf + 0.02);
    g.add(d);
  }
  // คริสตัล 4 MHz (HC-49S) ระหว่างลำโพงด้านบน
  const xtal = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 7.5, 6, 16), can);
  xtal.rotation.z = Math.PI / 2;
  xtal.position.set(cx, y0 + H - 3.5, zf + 1.8);
  g.add(xtal);
  const name = decal(textTex('sr:name', ['HC-SR04'], 'rgba(240,242,245,0.95)', 256, 64, 46), 8.6, 2.15);
  name.position.set(cx, y0 + H / 2 - 1, zf + 0.02);
  g.add(name);
  // ชื่อขาเหนือหัวเข็ม
  const pins = ['VCC', 'TRIG', 'ECHO', 'GND'] as const;
  const silk = ['Vcc', 'Trig', 'Echo', 'Gnd'];
  pins.forEach((p, i) => {
    const d = decal(textTex(`sr:p:${p}`, [silk[i]], 'rgba(240,242,245,0.95)', 128, 64, 44), 2.5, 1.25);
    d.position.set(i * PITCH, y0 + 2.4, zf + 0.02);
    g.add(d);
  });
  // ไอซี SMD ด้านหลัง (MCU, ขยายสัญญาณ, ขับลำโพง)
  const smd = mat('srSmd', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.5 }));
  for (const [x, y, w, h] of [[-8, 13, 5, 4], [cx + 2, 9, 5, 4], [14, 13, 4, 3]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.5), smd);
    m.position.set(x, y0 + y, -T / 2 - 0.75);
    g.add(m);
  }
  // หัวเข็มตัวผู้ 4 ขา: ฐานพลาสติก + เข็มทองเหลือง 0.64 mm ลงรู
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(4 * PITCH, 2.5, 2.5), mat('srHdr', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  hdr.position.set(cx, 1.25 + 1.0, 0);
  g.add(hdr);
  const gold = mat('srGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  pins.forEach((p, i) => g.add(flatLead([V(i * PITCH, y0 + 0.5), V(i * PITCH, 0)], 0.64, 0.64, p, gold)));
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/* ======================= สเต็ปเปอร์มอเตอร์ 28BYJ-48 + บอร์ดขับ ULN2003 ======================= */

const SM_BOARD_Z = 19; // บอร์ดขับอยู่หน้า มอเตอร์อยู่หลัง (mm)
const SM_HDR_TOP = 1.6 + 1.6 + 8.5;
/** จุดต่อสาย: หัวเข็ม IN1–IN4 (ขอบซ้ายบอร์ด) และ − + (มุมขวาล่าง) — หน่วยรู ก่อนหมุน */
export const STEPPER_PIN_LOCAL: Record<string, [number, number, number]> = {
  IN1: [-15 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z - 3.81) / 2.54], IN2: [-15 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z - 1.27) / 2.54],
  IN3: [-15 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z + 1.27) / 2.54], IN4: [-15 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z + 3.81) / 2.54],
  G: [14 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z + 9.0) / 2.54], V: [14 / 2.54, SM_HDR_TOP / 2.54, (SM_BOARD_Z + 11.54) / 2.54],
};

/**
 * 28BYJ-48 (ตัวถัง Ø28 × 19 mm, หูยึดรู Ø4.2 ห่าง 35 mm, แกนออก Ø5 มีบ่าแบน 3 mm สูง ≈ 9 mm เยื้องศูนย์ 8 mm, ฝาครอบสายสีน้ำเงิน)
 * + บอร์ดขับ ULN2003 ทั่วไป (PCB เขียว 35 × 32 mm, ไอซี DIP-16, LED A–D, หัวเข็ม IN1–IN4 และ − +, ขั้วต่อ 5 ขาสีขาว)
 * ขนาดบอร์ดเป็นค่าที่วัดจากโมดูลที่ขายทั่วไป · พิมพ์เฉพาะรุ่น/ชื่อขา ไม่มีโลโก้ผู้ผลิต
 * root.userData.stepShaft หมุนตามมุมแกนออก (รอบแกน y), root.userData.stepLeds = วัสดุ LED A–D
 */
export function buildStepperKit(dip: (pinAt: (dx: number, row: 0 | 1) => string) => THREE.Group): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const T = 1.6, yb = 1.6, yTop = yb + T, zb = SM_BOARD_Z;
  // บอร์ด
  const pcb = new THREE.Mesh(new RoundedBoxGeometryLite(35, T, 32, 0.6), mat('smPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f6b3c, roughness: 0.55 })));
  pcb.position.set(0, yb + T / 2, zb);
  g.add(pcb);
  // ไอซี ULN2003 (DIP-16) — ใช้โมเดล DIP ร่วม ตัดเครื่องหมายปลายขาออก (ไม่ใช่จุดต่อสายของชิ้นนี้)
  const ic = dip((dx, row) => `x${dx}${row}`);
  ic.traverse((o) => { delete o.userData.leadTip; delete o.userData.lead; });
  ic.position.set(-10 / 2.54, yTop / 2.54, (zb + 0.4) / 2.54);
  root.add(ic);
  const silk = 'rgba(240,242,245,0.92)';
  // LED A–D (Ø3 mm) + ป้าย
  const ledMats: THREE.MeshStandardMaterial[] = [];
  'ABCD'.split('').forEach((L, k) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x8a1d18, roughness: 0.25, emissive: 0xff2a1f, emissiveIntensity: 0, transparent: true, opacity: 0.92 });
    ledMats.push(m);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 16), m);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    const z = zb - 11 + k * 4.2;
    body.position.set(11.5, yTop + 1.5, z); dome.position.set(11.5, yTop + 3, z);
    const d = decal(textTex(`sm:l:${L}`, [L], silk, 64, 64, 54), 1.8, 1.8);
    d.rotation.x = -Math.PI / 2; d.position.set(14.2, yTop + 0.01, z);
    g.add(body, dome, d);
  });
  root.userData.stepLeds = ledMats;
  // หัวเข็ม IN1–IN4 และ − + (ฐานดำ + เข็มทองเหลือง)
  const gold = mat('smGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const blk = mat('smHdr', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const hdr = (pins: string[]) => {
    const xs = pins.map((p) => STEPPER_PIN_LOCAL[p][0] * 2.54), zs = pins.map((p) => STEPPER_PIN_LOCAL[p][2] * 2.54);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, Math.max(...zs) - Math.min(...zs) + 2.54), blk);
    base.position.set(xs[0], yTop + 1.25, (Math.max(...zs) + Math.min(...zs)) / 2);
    g.add(base);
    for (const pin of pins) {
      const [x, y, z] = STEPPER_PIN_LOCAL[pin];
      const h0 = yTop - 2.5, h1 = y * 2.54;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, h1 - h0, 0.64), gold);
      p.position.set(x * 2.54, (h0 + h1) / 2, z * 2.54);
      p.userData.leadTip = pin;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4, 10), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x * 2.54, h1 - 1.5, z * 2.54);
      hit.userData = { pin, isPin: true };
      const lab = decal(textTex(`sm:p:${pin}`, [pin === 'G' ? '−' : pin === 'V' ? '+' : pin], silk, 160, 64, 50), pin.length > 1 ? 3.6 : 1.8, 1.45);
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(x * 2.54 + (pin.startsWith('IN') ? 4.0 : -3.2), yTop + 0.01, z * 2.54);
      g.add(p, hit, lab);
    }
  };
  hdr(['IN1', 'IN2', 'IN3', 'IN4']);
  hdr(['G', 'V']);
  const v5 = decal(textTex('sm:v', ['5–12V'], silk, 256, 64, 48), 5, 1.3);
  v5.rotation.x = -Math.PI / 2; v5.position.set(8.2, yTop + 0.01, zb + 14.4);
  g.add(v5);
  // ขั้วต่อ JST-XH 5 ขา (ขาว) ที่ขอบหลังบอร์ด + ปลั๊กสาย
  const white = mat('smJst', () => new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 }));
  const jst = new THREE.Mesh(new THREE.BoxGeometry(14.9, 7, 5.8), white);
  jst.position.set(-1, yTop + 3.5, zb - 12.5);
  g.add(jst);
  // มอเตอร์: ตัวถังโลหะ Ø28 × 19, หูยึด, ฝาสายน้ำเงิน, แกนออก
  const mz = -21, steel = mat('smCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc3c7cc, roughness: 0.35, metalness: 1 })));
  const can = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 19, 48), steel);
  can.position.set(0, 19 / 2, mz);
  // หูยึด: แผ่นโลหะทรงแคปซูล 42 × 7 mm หนา 0.8 mm ที่ขอบบนตัวถัง
  const st = new THREE.Shape();
  st.moveTo(-17.5, -3.5); st.lineTo(17.5, -3.5); st.absarc(17.5, 0, 3.5, -Math.PI / 2, Math.PI / 2, false); st.lineTo(-17.5, 3.5); st.absarc(-17.5, 0, 3.5, Math.PI / 2, Math.PI * 1.5, false);
  const flange = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.8, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2), steel);
  flange.position.set(0, 19 - 0.8, mz);
  const holeMat = mat('smHole', () => new THREE.MeshBasicMaterial({ color: 0x2a2c2f }));
  for (const x of [-17.5, 17.5]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.9, 16), holeMat); h.position.set(x, 19 - 0.4, mz); g.add(h); }
  const blue = mat('smCap', () => new THREE.MeshStandardMaterial({ color: 0x2556b8, roughness: 0.45 }));
  const cap = new THREE.Mesh(new RoundedBoxGeometryLite(17, 16, 6, 1), blue);
  cap.position.set(0, 8, mz + 14 + 1.5);
  g.add(can, flange, cap);
  const lab = decal(textTex('sm:lab', ['28BYJ-48', '5V DC'], 'rgba(30,32,36,0.85)', 256, 128, 44), 10, 5);
  lab.rotation.x = -Math.PI / 2; lab.position.set(-4, 19.02, mz - 3);
  g.add(lab);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 1.5, 32), steel);
  boss.position.set(0, 19 + 0.75, mz - 8);
  g.add(boss);
  // แกนออกหมุนรอบ y: แกน Ø5 บ่าแบน + ชี้มุม (แผ่นขาวมีขีดแดง)
  const shaft = new THREE.Group();
  shaft.position.set(0, 20.5, mz - 8);
  const brass = mat('smShaft', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd6b56a, roughness: 0.35, metalness: 1 })));
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 3, 24), brass); s1.position.y = 1.5;
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 5), brass); s2.position.y = 6;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.2, 40), mat('smDisc', () => new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.5 })));
  disc.position.y = 9.6;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 7.5), mat('smMark', () => new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 })));
  mark.position.set(0, 10.3, 4.2);
  shaft.add(s1, s2, disc, mark);
  g.add(shaft);
  root.userData.stepShaft = shaft;
  // สาย 5 เส้น (แดง ส้ม เหลือง ชมพู น้ำเงิน) จากฝาสายไปปลั๊ก
  const cols = [0xd32f2f, 0xf28c28, 0xf4d03f, 0xf48fb1, 0x1e63c6];
  cols.forEach((c, k) => {
    const dx = (k - 2) * 1.3;
    const curve = new THREE.CatmullRomCurve3([V(dx, 3, mz + 17.6), V(dx * 1.4, 1.2, mz + 22), V(-1 + (k - 2) * 2.5, 2.5, zb - 20), V(-1 + (k - 2) * 2.5, yTop + 3.5, zb - 15.6)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.55, 8), mat(`smW${k}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }))));
  });
  root.userData.topY = 31 / 2.54;
  root.userData.back = (-mz + 14) / 2.54;
  return root;
}

/* ======================= สมาร์ตฟาร์ม: เซนเซอร์ความชื้นในดินในกระถาง ======================= */

/** จุดศูนย์กลางกระถาง (mm, local) — ใช้ในฉากหาจุดปลายสายยางของปั๊ม */
export const SOIL_POT = { x: 0, z: -12, rTop: 50, h: 90, soilY: 80 };
/** ตำแหน่ง local (x, z mm) ของแผ่นเซนเซอร์และลำต้น — ปลายสายยางของปั๊มหลบสองจุดนี้ */
export const SOIL_POT_PCB: [number, number] = [20, -16];
export const SOIL_POT_STEM: [number, number] = [-16, -8];
/** ปลายขาตัวผู้ของสายเซนเซอร์ (หน่วยรู, local ก่อนหมุน) */
export const SOIL_PIN_LOCAL: Record<string, [number, number, number]> = {
  GND: [-6 / 2.54, 1.3 / 2.54, 56 / 2.54],
  VCC: [0, 1.3 / 2.54, 56 / 2.54],
  AOUT: [6 / 2.54, 1.3 / 2.54, 56 / 2.54],
};
const SOIL_DRY = new THREE.Color(0xa8835c), SOIL_WET = new THREE.Color(0x3a281c);
/** สีดินตามความชื้น (%) */
export function soilColor(m: number, out = new THREE.Color()): THREE.Color {
  return out.copy(SOIL_DRY).lerp(SOIL_WET, Math.min(1, Math.max(0, m / 100)) ** 0.8);
}

/** สีดิน + ใบตก/ซีดตามความชื้น (%) — ใบตกเมื่อดิน < 20% */
export function applySoilLook(root: THREE.Object3D, m: number) {
  const sm = root.userData.soilMat as THREE.MeshStandardMaterial | undefined;
  if (sm) soilColor(m, sm.color);
  const droop = Math.min(1, Math.max(0, (20 - m) / 20));
  for (const l of (root.userData.plantLeaves ?? []) as { tilt: THREE.Object3D; base: number }[]) l.tilt.rotation.z = l.base - droop * (l.base + 0.7);
  const lm = root.userData.leafMat as THREE.MeshStandardMaterial | undefined;
  if (lm) lm.color.setHex(0x4c9a3b).lerp(new THREE.Color(0xa3a24a), droop * 0.8);
}

/** ปลายขาตัวผู้ของสายจัมเปอร์ที่วางบนโต๊ะ (housing ดำ + ขาโลหะ + จุดชนสำหรับเลือกขา) */
function tablePinEnd(g: THREE.Group, pin: string, x: number, y: number, z: number) {
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 7), mat('ttPinHousing', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
  housing.position.set(x, 1.3, z - 3.5);
  const pinM = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.64, 5), tin());
  pinM.position.set(x, 1.3, z + 2.2);
  const tipMark = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), tin());
  tipMark.position.set(x, y, z);
  tipMark.userData.leadTip = pin;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(x, y, z);
  hit.userData = { pin, isPin: true };
  g.add(housing, pinM, tipMark, hit);
}

const wireMat = (col: number) => mat(`jw${col}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));

/**
 * เซนเซอร์ความชื้นในดินแบบ capacitive v1.2 (PCB สีดำ 98 × 23 × 1.6 mm) ปักในกระถางพลาสติกดำ Ø 100 mm สูง 90 mm พร้อมต้นกล้า
 * ส่วนที่โผล่พ้นดิน ≈ 40 mm: ไอซีไทเมอร์ SOIC-8, ตัวคุมแรงดัน SOT-23, R/C 0603, ขั้ว PH2.0 3 ขา (ขาว) ที่ขอบบน
 * สาย 3 เส้น ดำ GND / แดง VCC / เหลือง AOUT ข้ามขอบกระถางลงมาเป็นขาตัวผู้บนโต๊ะด้านหน้า
 * userData.soilMat (สีดินตามความชื้น), userData.plantLeaves (มุมใบตามความชื้น)
 */
export function buildSoilPot(moisture: number): THREE.Group {
  const { root, g } = rootGroups();
  const P = SOIL_POT;
  const black = mat('potBlack', () => new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.75, side: THREE.DoubleSide }));
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(P.rTop, 37.5, P.h, 56, 1, true), black);
  wall.position.set(P.x, P.h / 2, P.z);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(P.rTop + 0.6, 1.8, 8, 56).rotateX(Math.PI / 2), black);
  rim.position.set(P.x, P.h - 1, P.z);
  const base = new THREE.Mesh(new THREE.CircleGeometry(37.5, 40).rotateX(-Math.PI / 2), black);
  base.position.set(P.x, 0.4, P.z);
  g.add(wall, rim, base);
  // ดิน: ผิวมีจุดเม็ดดิน (texture) สีตามความชื้น + เพอร์ไลต์สีขาวเล็กน้อย
  const tex = canvasTex('soilSpeckle', 256, 256, (x, w, h) => {
    x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, w, h);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2600; k++) { const v = 120 + Math.floor(rnd() * 135); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
  });
  const soilMat = new THREE.MeshStandardMaterial({ map: tex, color: soilColor(moisture), roughness: 1 });
  const soil = new THREE.Mesh(new THREE.CircleGeometry(P.rTop - 1.6 - ((P.h - P.soilY) / P.h) * 12.5, 48).rotateX(-Math.PI / 2), soilMat);
  soil.position.set(P.x, P.soilY, P.z);
  soil.receiveShadow = true;
  g.add(soil);
  root.userData.soilMat = soilMat;
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const perlite = mat('perlite', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }));
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, r = 8 + rnd() * 36;
    const pb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + rnd() * 0.8, 0), perlite);
    pb.position.set(P.x + Math.cos(a) * r, P.soilY + 0.3, P.z + Math.sin(a) * r);
    g.add(pb);
  }
  // ต้นกล้า: ลำต้น + ใบ 6 ใบ (กลุ่มเอียงแยก ให้ฉากปรับมุมตามความชื้น)
  const [sx, sz] = SOIL_POT_STEM;
  const stemMat = mat('plantStem', () => new THREE.MeshStandardMaterial({ color: 0x5d8a33, roughness: 0.7 }));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.9, 42, 10), stemMat);
  stem.position.set(sx, P.soilY + 21, sz);
  g.add(stem);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(6, 6.5, 18, 7, 27, 0);
  leafShape.bezierCurveTo(18, -7, 6, -6.5, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 10).rotateX(-Math.PI / 2);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c9a3b, roughness: 0.55, side: THREE.DoubleSide });
  const leaves: { tilt: THREE.Object3D; base: number }[] = [];
  const LEAVES: [number, number, number][] = [[18, 0.3, 0.55], [22, 2.4, 0.5], [27, 4.3, 0.6], [33, 1.3, 0.75], [37, 3.4, 0.8], [41, 5.4, 0.95]];
  for (const [hy, az, up] of LEAVES) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, P.soilY + hy, sz);
    pivot.rotation.y = az;
    const tilt = new THREE.Group();
    tilt.rotation.z = up;
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.scale.setScalar(0.75 + hy / 120);
    tilt.add(leaf);
    pivot.add(tilt);
    g.add(pivot);
    leaves.push({ tilt, base: up });
  }
  root.userData.plantLeaves = leaves;
  root.userData.leafMat = leafMat;
  // PCB ส่วนที่โผล่พ้นดิน (ส่วนที่ปักในดินถูกดินบัง)
  const [bx, bz] = SOIL_POT_PCB, top = P.soilY + 40;
  const pcbMat = mat('soilPcb', () => new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.45 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(23, 42, 1.6), pcbMat);
  pcb.position.set(bx, top - 21, bz);
  g.add(pcb);
  const silk = canvasTex('soilSilk', 230, 420, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(235,235,230,0.95)';
    x.fillRect(8, h - 52, w - 16, 7); // เส้นขาว: ปักลึกไม่เกินเส้นนี้
    x.font = '600 26px "Chakra Petch", "Arial Narrow", sans-serif';
    x.textAlign = 'center';
    x.fillText('GND VCC AOUT', w / 2, 92);
    x.font = '600 19px "Chakra Petch", "Arial Narrow", sans-serif';
    x.fillText('Capacitive Soil', w / 2, h - 105); x.fillText('Moisture Sensor v1.2', w / 2, h - 82);
    // แผ่นทองแดงชุบใต้ชิ้นส่วน
    x.fillStyle = 'rgba(200,170,90,0.9)';
    for (const [px, py] of [[60, 180], [60, 196], [150, 150], [168, 150], [186, 150], [150, 230], [170, 230]]) x.fillRect(px, py, 10, 8);
  });
  const sk = decal(silk, 23, 42);
  sk.position.set(bx, top - 21, bz + 0.81);
  g.add(sk);
  const icMat = mat('soicBody', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
  const ic = new THREE.Mesh(new THREE.BoxGeometry(4.9, 3.9, 1.5), icMat);
  ic.position.set(bx + 1, top - 22, bz + 1.55);
  const reg = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.4, 1.1), icMat);
  reg.position.set(bx - 5.5, top - 15, bz + 1.35);
  g.add(ic, reg);
  for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) {
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.3), tin());
    lg.position.set(bx + 1 - 1.9 + k * 1.27, top - 22 + sd * 2.2, bz + 0.95);
    g.add(lg);
  }
  const passive = mat('chip0603', () => new THREE.MeshStandardMaterial({ color: 0x8a6f4e, roughness: 0.6 }));
  for (const [px, py] of [[-6, -20], [-6, -24], [7, -18], [7, -26], [-2, -29]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.5), passive);
    c.position.set(bx + px, top + py, bz + 1.05);
    g.add(c);
  }
  // ขั้ว PH2.0 3 ขาที่ขอบบน (สีขาว)
  const ph = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 4.5), mat('phWhite', () => new THREE.MeshStandardMaterial({ color: 0xefece2, roughness: 0.55 })));
  ph.position.set(bx, top - 2, bz + 3);
  g.add(ph);
  // สาย 3 เส้นจากขั้ว → ข้ามขอบกระถางด้านหน้า → ลงโต๊ะ → ขาตัวผู้
  const front = P.z + P.rTop;
  for (const [pin, col, k] of [['GND', 0x1b1b1b, -1], ['VCC', 0xc62828, 0], ['AOUT', 0xf2c200, 1]] as const) {
    const [ux, uy, uz] = SOIL_PIN_LOCAL[pin];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    const wx = bx + k * 2;
    const c = new THREE.CatmullRomCurve3([
      V(wx, top + 0.5, bz + 3), V(wx, top + 12, bz + 6), V(wx - 6 + k, P.h + 18, front - 6), V((wx + x) / 2, P.h + 6, front + 6),
      V((wx + x) / 2 + k * 2, P.h * 0.45, front + 9), V(x, 6, z - 12), V(x, 1.3, z - 7),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 48, 0.6, 8), wireMat(col)));
    tablePinEnd(g, pin, x, y, z);
  }
  applySoilLook(root, moisture);
  root.userData.topY = (top + 8) / 2.54;
  root.userData.back = (-P.z + P.rTop) / 2.54;
  return root;
}

/* ======================= สมาร์ตฟาร์ม: ปั๊มน้ำจุ่มในถังน้ำ ======================= */

export const PUMP_TANK = { z: -10, w: 130, d: 95, h: 80, water: 60 };
/** ปลายท่อออกของปั๊ม (mm, local) */
export const PUMP_NOZZLE = { x: -17, y: 8, z: -10 };
export const PUMP_PIN_LOCAL: Record<string, [number, number, number]> = {
  P: [-38 / 2.54, 1.3 / 2.54, 52 / 2.54],
  N: [-32 / 2.54, 1.3 / 2.54, 52 / 2.54],
};

/**
 * ปั๊มน้ำจุ่ม DC 3–6 V (ตัวทรงกระบอก Ø 24 × 33 mm ท่อออก Ø 7.5 mm ช่องดูดน้ำรอบฐาน) วางก้นถังพลาสติกใส 130 × 95 × 80 mm (น้ำลึก 60 mm)
 * สายแดง/ดำจากฝาบนปั๊ม ข้ามขอบถังด้านหน้าลงเป็นขาตัวผู้ · สายยางสร้างในฉาก (buildPumpHose) ตามกระถางที่เลือก
 */
export function buildPumpTank(): THREE.Group {
  const { root, g } = rootGroups();
  const T = PUMP_TANK;
  const clear = mat('tankClear', () => new THREE.MeshStandardMaterial({ color: 0xe6f2f6, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  const edge = mat('tankEdge', () => new THREE.MeshStandardMaterial({ color: 0xd4e6ec, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false }));
  const wt = 1.5;
  const walls: [number, number, number, number, number, number][] = [
    [T.w, T.h, wt, 0, T.h / 2, T.z - T.d / 2], [T.w, T.h, wt, 0, T.h / 2, T.z + T.d / 2],
    [wt, T.h, T.d, -T.w / 2, T.h / 2, T.z], [wt, T.h, T.d, T.w / 2, T.h / 2, T.z], [T.w, wt, T.d, 0, wt / 2, T.z],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), clear);
    m.position.set(x, y, z); m.renderOrder = 3; m.userData.noShadow = true;
    g.add(m);
  }
  for (const [w, d, x, z] of [[T.w + 3, 3, 0, T.z - T.d / 2], [T.w + 3, 3, 0, T.z + T.d / 2], [3, T.d, -T.w / 2, T.z], [3, T.d, T.w / 2, T.z]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), edge);
    m.position.set(x, T.h - 1, z); m.renderOrder = 3;
    g.add(m);
  }
  const water = new THREE.Mesh(new THREE.BoxGeometry(T.w - 3, T.water, T.d - 3), mat('tankWater', () => new THREE.MeshStandardMaterial({ color: 0x2c8fd0, roughness: 0.1, transparent: true, opacity: 0.42, depthWrite: false })));
  water.position.set(0, T.water / 2 + wt, T.z); water.renderOrder = 2;
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(T.w - 3, T.d - 3).rotateX(-Math.PI / 2), mat('tankSurf', () => new THREE.MeshStandardMaterial({ color: 0x5fb6e8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.6, depthWrite: false })));
  surf.position.set(0, T.water + wt + 0.05, T.z); surf.renderOrder = 2;
  g.add(water, surf);
  for (const m of [water, surf]) m.userData.noShadow = true;
  // ตัวปั๊ม
  const px = PUMP_NOZZLE.x - 18, pz = T.z;
  const body = mat('pumpBody', () => new THREE.MeshStandardMaterial({ color: 0x262729, roughness: 0.55 }));
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 30, 36), body);
  housing.position.set(px, wt + 15, pz);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 12, 3, 36), body);
  cap.position.set(px, wt + 31.5, pz);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(12.05, 0.35, 6, 36).rotateX(Math.PI / 2), mat('pumpSeam', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 })));
  seam.position.set(px, wt + 13, pz);
  g.add(housing, cap, seam);
  // ช่องดูดน้ำรอบฐาน
  const slot = mat('pumpSlot', () => new THREE.MeshBasicMaterial({ color: 0x050505 }));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const sl = new THREE.Mesh(new THREE.BoxGeometry(2, 5, 0.6), slot);
    sl.position.set(px + Math.cos(a) * 12.05, wt + 4.5, pz + Math.sin(a) * 12.05);
    sl.rotation.y = -a + Math.PI / 2;
    g.add(sl);
  }
  // ท่อออก Ø 7.5 mm (ด้านข้าง ระดับห้องใบพัด)
  const nz = new THREE.Mesh(new THREE.CylinderGeometry(3.75, 3.75, 10, 20).rotateZ(Math.PI / 2), body);
  nz.position.set(PUMP_NOZZLE.x - 5 + 0.5, PUMP_NOZZLE.y + wt, pz);
  const nzBoss = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 4, 20).rotateZ(Math.PI / 2), body);
  nzBoss.position.set(px + 12.5, PUMP_NOZZLE.y + wt, pz);
  g.add(nz, nzBoss);
  // สายไฟจากฝาบน → ข้ามขอบถังด้านหน้า → ขาตัวผู้
  const front = T.z + T.d / 2;
  for (const [pin, col, k] of [['P', 0xc62828, -1], ['N', 0x1b1b1b, 1]] as const) {
    const [ux, uy, uz] = PUMP_PIN_LOCAL[pin];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    const c = new THREE.CatmullRomCurve3([
      V(px + k * 2.5, wt + 33, pz), V(px + k * 3, wt + 50, pz + 12), V(px + k * 3, T.h + 10, front - 8), V(px + k * 3, T.h + 4, front + 5),
      V((px + x) / 2 + k * 2, T.h * 0.4, front + 8), V(x, 6, z - 12), V(x, 1.3, z - 7),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 48, 0.65, 8), wireMat(col)));
    tablePinEnd(g, pin, x, y, z);
  }
  root.userData.topY = (T.h + 12) / 2.54;
  root.userData.back = (-T.z + T.d / 2) / 2.54;
  return root;
}

/**
 * สายยางซิลิโคนใส Ø 7.5 mm จากท่อออกของปั๊ม (pts: จุดในหน่วยรู local ของกลุ่มปั๊ม เริ่มที่ท่อออก จุดท้ายคือปลายสายชี้ลง)
 * + สายน้ำที่ไหลจากปลายสายลงถึงความสูง yStop (หน่วยรู) — userData.pumpStream แสดงเมื่อปั๊มดันน้ำได้
 */
export function buildPumpHose(pts: THREE.Vector3[], yStop: number): THREE.Group {
  const grp = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const hoseMat = mat('hoseClear', () => new THREE.MeshStandardMaterial({ color: 0xeef5f2, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 3.75 / 2.54, 12), hoseMat);
  tube.renderOrder = 4;
  grp.add(tube);
  const end = pts[pts.length - 1];
  const len = Math.max(0.2, end.y - yStop);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(1.6 / 2.54, 2.2 / 2.54, len, 12), mat('pumpStream', () => new THREE.MeshStandardMaterial({ color: 0x6ec6f0, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false })));
  stream.position.set(end.x, end.y - len / 2, end.z);
  stream.visible = false;
  stream.userData.noShadow = true;
  grp.add(stream);
  grp.userData.pumpStream = stream;
  grp.userData.isHose = true;
  return grp;
}

/* ======================= DHT22 (AM2302) ======================= */

/**
 * DHT22 ตัวถังพลาสติกขาว 15.1 × 25 × 7.7 mm (รวมหูยึดด้านบน) ขา 4 ขาห่าง 2.54 mm ลงรูบอร์ด ตะแกรงระบายอากาศหันไป +z
 * มองด้านตะแกรง ขาลง: 1 VDD, 2 DATA, 3 NC, 4 GND (ซ้าย → ขวา) · ไม่มีโลโก้ผู้ผลิต
 */
export function buildDht22(pins: [string, string, string, string], variant: 'dht22' | 'dht11' = 'dht22'): THREE.Group {
  const { root, g } = rootGroups();
  // DHT11: ตัวถังสีฟ้า 15.5 × 12 × 5.5 mm ไม่มีหูยึด · DHT22: สีขาว 15.1 × 20 × 7.7 mm + หูยึด
  const d11 = variant === 'dht11';
  const cx = 1.5 * PITCH, y0 = 4.5, W = d11 ? 15.5 : 15.1, H = d11 ? 12 : 20, D = d11 ? 5.5 : 7.7;
  const white = d11 ? mat('dht11Blue', () => new THREE.MeshStandardMaterial({ color: 0x3f8fd8, roughness: 0.55 })) : mat('dhtWhite', () => new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), white);
  body.position.set(cx, y0 + H / 2, 0);
  g.add(body);
  // หูยึดด้านบน (บางกว่า ชิดด้านหลัง) มีรูยึด Ø 3 mm
  const tabT = 2.6;
  if (!d11) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(W, 5, tabT), white);
    tab.position.set(cx, y0 + H + 2.5, -D / 2 + tabT / 2);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, tabT + 0.1, 20).rotateX(Math.PI / 2), mat('dhtHole', () => new THREE.MeshBasicMaterial({ color: 0x1a1a1a })));
    hole.position.set(cx, y0 + H + 2.6, -D / 2 + tabT / 2);
    g.add(tab, hole);
  }
  // ตะแกรงด้านหน้า: ช่องสี่เหลี่ยมเรียงเป็นตาราง มองเห็นแผ่นเซนเซอร์ด้านใน
  const grille = canvasTex(d11 ? 'dht11Grille' : 'dhtGrille', 151, d11 ? 116 : 200, (x, w, h) => {
    x.fillStyle = d11 ? '#3f8fd8' : '#f0f0ea'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1f2a33';
    const cols = 4, rows = d11 ? 4 : 7, mx = 16, my = 18, gx = 7, gy = 7;
    const cw = (w - 2 * mx - (cols - 1) * gx) / cols, ch = (h - 2 * my - (rows - 1) * gy) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) x.fillRect(mx + i * (cw + gx), my + j * (ch + gy), cw, ch);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, H - 0.2), new THREE.MeshStandardMaterial({ map: grille, roughness: 0.6 }));
  face.position.set(cx, y0 + H / 2, D / 2 + 0.01);
  g.add(face);
  // ขอบนูนรอบตะแกรง
  const rim = d11 ? mat('dht11Rim', () => new THREE.MeshStandardMaterial({ color: 0x3584cc, roughness: 0.55 })) : mat('dhtRim', () => new THREE.MeshStandardMaterial({ color: 0xe6e6df, roughness: 0.6 }));
  for (const [w, h, x, y] of [[W, 1.2, 0, H / 2 - 0.6], [W, 1.2, 0, -H / 2 + 0.6], [1.2, H, -W / 2 + 0.6, 0], [1.2, H, W / 2 - 0.6, 0]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), rim);
    m.position.set(cx + x, y0 + H / 2 + y, D / 2 + 0.25);
    g.add(m);
  }
  // ขา 4 ขา (แผ่นบาง 0.6 × 0.25 mm) จากใต้ตัวถังลงรู
  pins.forEach((p, i) => g.add(flatLead([V(i * PITCH, y0 + 0.5), V(i * PITCH, 0)], 0.6, 0.25, p)));
  root.userData.topY = (y0 + H + (d11 ? 0 : 5)) * MM;
  return root;
}

/* ======================= Arduino Uno R3 ======================= */

/** ขอบบอร์ด Uno R3 (mm) และระยะเลื่อนให้จุดกึ่งกลาง footprint (รวมแจ็ก USB ที่ยื่น 6.35 mm ทางซ้าย) อยู่ที่ 0 */
const UNO_W = 68.58, UNO_D = 53.34, UNO_CX = (UNO_W - 6.35) / 2, UNO_PCB_Y = 3, UNO_HDR_H = 8.5;
/** ตำแหน่งขาบนหัวต่อตัวเมีย (x จากขอบซ้าย, แถวบน/ล่าง) ตามแบบ Uno Rev3: แถวบนห่างขอบบน 2.54 mm แถวล่างห่างขอบล่าง 2.54 mm
 *  ระหว่าง D7–D8 ห่าง 0.16" และระหว่าง VIN–A0 ห่าง 0.2" (ตรงกับแบบบอร์ดจริง ใส่ shield ได้) */
const UNO_HDR: Record<string, [number, 'top' | 'bot']> = {
  D0: [63.5, 'top'], D1: [60.96, 'top'], D2: [58.42, 'top'], D3: [55.88, 'top'], D4: [53.34, 'top'], D5: [50.8, 'top'], D6: [48.26, 'top'], D7: [45.72, 'top'],
  D8: [41.656, 'top'], D9: [39.116, 'top'], D10: [36.576, 'top'], D11: [34.036, 'top'], D12: [31.496, 'top'], D13: [28.956, 'top'], 'GND.1': [26.416, 'top'], AREF: [23.876, 'top'], SDA: [21.336, 'top'], SCL: [18.796, 'top'],
  IOREF: [30.48, 'bot'], RESET: [33.02, 'bot'], '3V3': [35.56, 'bot'], '5V': [38.1, 'bot'], 'GND.2': [40.64, 'bot'], 'GND.3': [43.18, 'bot'], VIN: [45.72, 'bot'],
  A0: [50.8, 'bot'], A1: [53.34, 'bot'], A2: [55.88, 'bot'], A3: [58.42, 'bot'], A4: [60.96, 'bot'], A5: [63.5, 'bot'],
};
const unoX = (x: number) => x - UNO_CX;
const unoZ = (fromTop: number) => fromTop - UNO_D / 2;
/** ปลายขา (รูบนหัวต่อตัวเมีย) หน่วยรู local ก่อนหมุน — สายจัมเปอร์เสียบจากด้านบน */
export const UNO_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(UNO_HDR).map(([n, [x, row]]) =>
  [n, [unoX(x) / 2.54, (UNO_PCB_Y + 1.6 + UNO_HDR_H) / 2.54, unoZ(row === 'top' ? 2.54 : UNO_D - 2.54) / 2.54]]));

/**
 * Arduino Uno R3 (68.6 × 53.3 mm, PCB 1.6 mm บนขายาง 3 mm) — ไม่มีโลโก้ผู้ผลิต
 * หัวต่อตัวเมีย 10+8 ขา (บน) 8+6 ขา (ล่าง) สูง 8.5 mm · แจ็ก USB-B และแจ็กไฟ DC ซ้าย · ATmega328P DIP-28 บนซ็อกเก็ต · เรโซเนเตอร์/คริสตัล 16 MHz
 * ปุ่ม RESET · ICSP 2×3 · LED L (D13) TX RX ON · ลายสกรีนชื่อขา (~ = PWM)
 * userData.picoLed / picoGlow = LED L (ฉากสว่างตามสถานะ D13 ใช้กลไกเดียวกับ LED บนบอร์ด Pico)
 */
export function buildUnoR3(): THREE.Group {
  const { root, g } = rootGroups();
  const y0 = UNO_PCB_Y, top = y0 + 1.6;
  const pcbMat = new THREE.MeshStandardMaterial({ color: 0x1d6aa5, roughness: 0.55 });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(UNO_W, 1.6, UNO_D), pcbMat);
  pcb.position.set(unoX(UNO_W / 2), y0 + 0.8, 0);
  g.add(pcb);
  // ลายสกรีน (10 px/mm)
  const silk = canvasTex('unoSilk', 686, 534, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(245,247,250,0.95)'; x.strokeStyle = 'rgba(245,247,250,0.9)'; x.lineWidth = 3;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const at = (s: string, mx: number, my: number, size = 15, rot = 0) => { x.save(); x.translate(mx * 10, my * 10); x.rotate(rot); x.font = `600 ${size}px "Chakra Petch", "Arial Narrow", sans-serif`; x.fillText(s, 0, 0); x.restore(); };
    for (const [n, [mx, row]] of Object.entries(UNO_HDR)) {
      const lab = n.startsWith('D') ? `${[3, 5, 6, 9, 10, 11].includes(Number(n.slice(1))) ? '~' : ''}${n.slice(1)}` : n.replace(/\.\d$/, '').replace('3V3', '3.3V');
      if (row === 'top') at(n === 'D1' ? 'TX→1' : n === 'D0' ? 'RX←0' : lab, mx, 7.4, 13, -Math.PI / 2);
      else at(lab, mx, UNO_D - 6.9, 11, -Math.PI / 2);
    }
    at('DIGITAL (PWM~)', 50, 12.2, 17); at('POWER', 38, UNO_D - 10.9, 14); at('ANALOG IN', 57, UNO_D - 10.9, 14);
    at('UNO R3', 46, 23, 30); at('ON', 59.5, 29, 13); at('L', 24.4, 15.5, 13); at('TX', 24.4, 19.5, 12); at('RX', 24.4, 22.5, 12);
    x.strokeRect(27 * 10, 30 * 10, 38 * 10, 10 * 10);
  });
  const sk = new THREE.Mesh(new THREE.PlaneGeometry(UNO_W, UNO_D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: silk, transparent: true, depthWrite: false, toneMapped: false }));
  sk.position.set(unoX(UNO_W / 2), top + 0.02, 0);
  sk.renderOrder = 2;
  g.add(sk);
  // ขายาง 4 มุม (ตำแหน่งรูยึด)
  const rub = mat('unoFoot', () => new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
  for (const [mx, mt] of [[13.97, UNO_D - 2.54], [15.24, 2.54], [66.04, UNO_D - 7.62], [66.04, UNO_D - 35.56]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, y0, 16), rub);
    f.position.set(unoX(mx), y0 / 2, unoZ(mt));
    const hole = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 20).rotateX(-Math.PI / 2), tin());
    hole.position.set(unoX(mx), top + 0.03, unoZ(mt));
    g.add(f, hole);
  }
  // แจ็ก USB-B (โลหะ) และแจ็กไฟ DC (ดำ)
  const metal = mat('unoUsb', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 1 })));
  const usb = new THREE.Mesh(new THREE.BoxGeometry(16.3, 10.9, 12), metal);
  usb.position.set(unoX(-6.35 + 8.15), top + 5.45, unoZ(9.5 + 6));
  const usbHole = new THREE.Mesh(new THREE.PlaneGeometry(8, 7).rotateY(-Math.PI / 2), mat('unoUsbIn', () => new THREE.MeshBasicMaterial({ color: 0x151515 })));
  usbHole.position.set(unoX(-6.35) - 0.05, top + 5.45, unoZ(15.5));
  const jack = new THREE.Mesh(new THREE.BoxGeometry(14.3, 11, 9), mat('unoJack', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })));
  jack.position.set(unoX(-1.8 + 7.15), top + 5.5, unoZ(41.4 + 4.5));
  const jackHole = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20).rotateY(-Math.PI / 2), mat('unoUsbIn', () => new THREE.MeshBasicMaterial({ color: 0x151515 })));
  jackHole.position.set(unoX(-1.8) - 0.05, top + 6, unoZ(45.9));
  g.add(usb, usbHole, jack, jackHole);
  // หัวต่อตัวเมีย
  const hdrMat = mat('unoHdr', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55 }));
  const holeMat = mat('unoHdrHole', () => new THREE.MeshBasicMaterial({ color: 0x040404 }));
  const strips: Array<[string, string]> = [['SCL', 'D8'], ['D7', 'D0'], ['IOREF', 'VIN'], ['A0', 'A5']];
  for (const [a, b] of strips) {
    const [xa, row] = UNO_HDR[a], [xb] = UNO_HDR[b];
    const x0 = Math.min(xa, xb) - (a === 'IOREF' ? 2.54 : 0), x1 = Math.max(xa, xb); // หัวต่อไฟเลี้ยงมีขา NC อีกหนึ่งขา
    const len = x1 - x0 + 2.54;
    const zt = row === 'top' ? 2.54 : UNO_D - 2.54;
    const hm = new THREE.Mesh(new THREE.BoxGeometry(len, UNO_HDR_H, 2.54), hdrMat);
    hm.position.set(unoX((x0 + x1) / 2), top + UNO_HDR_H / 2, unoZ(zt));
    g.add(hm);
    for (let xx = x0; xx <= x1 + 0.01; xx += 2.54) {
      const hl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2), holeMat);
      hl.position.set(unoX(xx), top + UNO_HDR_H + 0.02, unoZ(zt));
      g.add(hl);
    }
  }
  for (const [n, [mx, row]] of Object.entries(UNO_HDR)) {
    const zt = row === 'top' ? 2.54 : UNO_D - 2.54;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), tin());
    tip.position.set(unoX(mx), top + UNO_HDR_H, unoZ(zt));
    tip.userData.leadTip = n;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(unoX(mx), top + UNO_HDR_H - 0.8, unoZ(zt));
    hit.userData = { pin: n, isPin: true };
    g.add(tip, hit);
  }
  // ATmega328P DIP-28 บนซ็อกเก็ต (ขา 1 ทางซ้าย)
  const sock = new THREE.Mesh(new THREE.BoxGeometry(37, 3, 10.2), mat('unoSock', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7 })));
  sock.position.set(unoX(46), top + 1.5, unoZ(35));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(35.3, 3.4, 7.4), mat('unoChip', () => new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.45 })));
  chip.position.set(unoX(46), top + 3 + 1.7, unoZ(35));
  const notch = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 16), mat('unoNotch', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })));
  notch.position.set(unoX(46 - 17), top + 6.42, unoZ(35));
  g.add(sock, chip, notch);
  const mk = decal(textTex('uno:328', ['ATMEGA328P-PU'], 'rgba(214,218,222,0.95)', 512, 96, 64), 22, 4.1);
  mk.rotation.x = -Math.PI / 2;
  mk.position.set(unoX(46), top + 6.42, unoZ(35));
  g.add(mk);
  for (let k = 0; k < 14; k++) for (const sd of [-1, 1]) {
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.9), tin());
    lg.position.set(unoX(46 - 16.51 + k * 2.54), top + 4, unoZ(35 + sd * 4.1));
    g.add(lg);
  }
  // ATmega16U2 (USB), คริสตัล 16 MHz, ตัวคุมแรงดัน, ตัวเก็บประจุ
  const smd = mat('unoSmd', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5 }));
  const u2 = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5), smd);
  u2.position.set(unoX(17), top + 0.5, unoZ(13.5));
  const xtal = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 7.5, 6, 16), metal);
  xtal.rotation.z = Math.PI / 2;
  xtal.position.set(unoX(19), top + 1.8, unoZ(27.5));
  const reg = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.8, 3.5), smd);
  reg.position.set(unoX(9), top + 0.9, unoZ(36));
  const tab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 2), tin());
  tab.position.set(unoX(9), top + 0.1, unoZ(38.6));
  g.add(u2, xtal, reg, tab);
  const can = mat('unoCap', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9 })));
  for (const [mx, mt] of [[16.5, 37], [16.5, 46]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 5.8, 24), can);
    c.position.set(unoX(mx), top + 2.9, unoZ(mt));
    g.add(c);
  }
  // ปุ่ม RESET
  const rb = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 6), mat('unoRstBody', () => new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4, metalness: 0.6 })));
  rb.position.set(unoX(6.5), top + 1.6, unoZ(5.5));
  const rk = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1, 16), mat('unoRstKey', () => new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.5 })));
  rk.position.set(unoX(6.5), top + 3.7, unoZ(5.5));
  g.add(rb, rk);
  // ICSP 2×3 (ขาตัวผู้) ขอบขวา
  const pinMat = mat('unoIcsp', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const ib = new THREE.Mesh(new THREE.BoxGeometry(5.08, 2.5, 7.62), hdrMat);
  ib.position.set(unoX(63.6), top + 1.25, unoZ(UNO_D - 30.5));
  g.add(ib);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, 6, 0.64), pinMat);
    p.position.set(unoX(62.33 + i * 2.54), top + 3, unoZ(UNO_D - 33.04 + j * 2.54));
    g.add(p);
  }
  // LED SMD: L (D13), TX, RX, ON
  const ledL = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.4 });
  const ledOff = mat('unoLedOff', () => new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.4 }));
  const ledOn = mat('unoLedOn', () => new THREE.MeshStandardMaterial({ color: 0x8dff9a, emissive: 0x22dd44, emissiveIntensity: 1.6, roughness: 0.4 }));
  for (const [mt, m] of [[15.5, ledL], [19.5, ledOff], [22.5, ledOff]] as const) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.25), m);
    l.position.set(unoX(27), top + 0.4, unoZ(mt));
    g.add(l);
  }
  const on = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.25), ledOn);
  on.position.set(unoX(62), top + 0.4, unoZ(29));
  g.add(on);
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffb02e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(unoX(27), top + 1.5, unoZ(15.5));
  glow.scale.set(7, 7, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  root.userData.picoLed = ledL;
  root.userData.picoGlow = glow;
  root.userData.topY = (top + 11) / 2.54;
  return root;
}

/* ======================= Arduino Mega 2560 Rev3 ======================= */

/**
 * ตำแหน่งขาของ Arduino Mega 2560 Rev3 (mm: x จากขอบซ้าย, ระยะจากขอบบน) — จากรอยเท้า Arduino_Mega2560_R3_Shield ของ
 * KiCad Library for Arduino (Alarm-Siren, CC BY-SA 4.0 — ใช้เฉพาะค่าพิกัด): หัวต่อแบบ Uno ตำแหน่งเดิมทุกขา + D14–D21 (บน),
 * A6–A15 (ล่าง) และหัวต่อคู่ 2 × 18 ขาริมขวา (x 93.98/96.52: 5V คู่บนสุด, D22–D53, GND คู่ล่างสุด)
 */
export const MEGA_W = 101.6;
const MEGA_CX = (MEGA_W - 6.35) / 2;
const MEGA_HDR: Record<string, [number, number]> = (() => {
  const m: Record<string, [number, number]> = {};
  for (const [n, [x, row]] of Object.entries(UNO_HDR)) m[n] = [x, row === 'top' ? 2.54 : UNO_D - 2.54];
  for (let k = 0; k < 8; k++) m[`D${14 + k}`] = [68.58 + k * 2.54, 2.54];
  m.A6 = [66.04, UNO_D - 2.54]; m.A7 = [68.58, UNO_D - 2.54];
  for (let k = 0; k < 8; k++) m[`A${8 + k}`] = [73.66 + k * 2.54, UNO_D - 2.54];
  m['5V.2'] = [93.98, 2.54]; m['5V.3'] = [96.52, 2.54];
  for (let k = 0; k < 16; k++) { m[`D${22 + 2 * k}`] = [93.98, 5.08 + k * 2.54]; m[`D${23 + 2 * k}`] = [96.52, 5.08 + k * 2.54]; }
  m['GND.4'] = [93.98, 45.72]; m['GND.5'] = [96.52, 45.72];
  return m;
})();
const megaX = (x: number) => x - MEGA_CX;
/** ปลายขา (รูบนหัวต่อตัวเมีย) หน่วยรู local */
export const MEGA_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(MEGA_HDR).map(([n, [x, zt]]) =>
  [n, [megaX(x) / 2.54, (UNO_PCB_Y + 1.6 + UNO_HDR_H) / 2.54, unoZ(zt) / 2.54]]));

/**
 * Arduino Mega 2560 Rev3 (101.6 × 53.3 mm ขอบขวาตัดมุมตามแบบ, PCB 1.6 mm บนขายาง 3 mm) — ไม่มีโลโก้ผู้ผลิต
 * หัวต่อตัวเมียตำแหน่งตามรอยเท้า (ดู MEGA_HDR) · ชิ้นส่วนอื่น (ATmega2560 TQFP-100 วางเอียง 45°, ATmega16U2, คริสตัล, ตัวคุมแรงดัน,
 * แจ็ก USB-B/DC, ปุ่ม RESET, ICSP, LED) วางตามตำแหน่งโดยประมาณจากภาพบอร์ด ไม่ใช่แบบเชิงกลละเอียด
 * userData.picoLed / picoGlow = LED L (D13)
 */
export function buildMega2560(): THREE.Group {
  const { root, g } = rootGroups();
  const y0 = UNO_PCB_Y, top = y0 + 1.6;
  const D = UNO_D;
  // แผ่น PCB ตามเส้นขอบ (มุมขวาตัด/บาก)
  const outline: Array<[number, number]> = [[0, 0], [97.536, 0], [99.06, 1.524], [99.06, 12.7], [101.6, 15.24], [101.6, 49.53], [99.06, 52.07], [99.06, D], [0, D]];
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(megaX(x), -unoZ(z))));
  const pcb = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d6aa5, roughness: 0.55 }));
  pcb.position.y = y0;
  g.add(pcb);
  const silk = canvasTex('megaSilk', 1016, 534, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(245,247,250,0.95)'; x.strokeStyle = 'rgba(245,247,250,0.9)'; x.lineWidth = 3;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const at = (s: string, mx: number, my: number, size = 15, rot = 0) => { x.save(); x.translate(mx * 10, my * 10); x.rotate(rot); x.font = `600 ${size}px "Chakra Petch", "Arial Narrow", sans-serif`; x.fillText(s, 0, 0); x.restore(); };
    const pwm = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46]);
    const tx: Record<string, string> = { D0: 'RX0←0', D1: 'TX0→1', D14: 'TX3 14', D15: 'RX3 15', D16: 'TX2 16', D17: 'RX2 17', D18: 'TX1 18', D19: 'RX1 19', D20: 'SDA 20', D21: 'SCL 21' };
    for (const [n, [mx, zt]] of Object.entries(MEGA_HDR)) {
      const num = Number(n.slice(1));
      if (mx > 90) { at(n.startsWith('D') ? String(num) : n.replace(/\.\d$/, ''), mx === 93.98 ? 91.3 : 99.3, zt, 10); continue; }
      const lab = tx[n] ?? (n.startsWith('D') ? `${pwm.has(num) ? '~' : ''}${num}` : n.replace(/\.\d$/, '').replace('3V3', '3.3V'));
      if (zt < 10) at(lab, mx, 7.6, 12, -Math.PI / 2); else at(lab, mx, D - 7.1, 11, -Math.PI / 2);
    }
    at('PWM', 50, 12.6, 15); at('COMMUNICATION', 77.5, 12.6, 15); at('POWER', 38, D - 11.4, 14); at('ANALOG IN', 70, D - 11.4, 14); at('DIGITAL', 89, 27, 15, -Math.PI / 2);
    at('MEGA 2560', 36, 25, 30); at('ON', 76, 26, 13); at('L', 24.4, 15.5, 13); at('TX', 24.4, 19.5, 12); at('RX', 24.4, 22.5, 12);
  });
  const sk = new THREE.Mesh(new THREE.PlaneGeometry(MEGA_W, D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: silk, transparent: true, depthWrite: false, toneMapped: false }));
  sk.position.set(megaX(MEGA_W / 2), top + 0.02, 0);
  sk.renderOrder = 2;
  g.add(sk);
  // ขายาง 6 ตำแหน่ง (รูยึดตามรอยเท้า)
  const rub = mat('unoFoot', () => new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
  for (const [mx, mt] of [[13.97, D - 2.54], [15.24, 2.54], [66.04, D - 7.62], [66.04, D - 35.56], [90.17, 2.54], [96.52, D - 2.54]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, y0, 16), rub);
    f.position.set(megaX(mx), y0 / 2, unoZ(mt));
    const hole = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 20).rotateX(-Math.PI / 2), tin());
    hole.position.set(megaX(mx), top + 0.03, unoZ(mt));
    g.add(f, hole);
  }
  // แจ็ก USB-B และแจ็กไฟ DC (ตำแหน่งเดียวกับ Uno)
  const metal = mat('unoUsb', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 1 })));
  const dark = mat('unoUsbIn', () => new THREE.MeshBasicMaterial({ color: 0x151515 }));
  const usb = new THREE.Mesh(new THREE.BoxGeometry(16.3, 10.9, 12), metal);
  usb.position.set(megaX(-6.35 + 8.15), top + 5.45, unoZ(9.5 + 6));
  const usbHole = new THREE.Mesh(new THREE.PlaneGeometry(8, 7).rotateY(-Math.PI / 2), dark);
  usbHole.position.set(megaX(-6.35) - 0.05, top + 5.45, unoZ(15.5));
  const jack = new THREE.Mesh(new THREE.BoxGeometry(14.3, 11, 9), mat('unoJack', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })));
  jack.position.set(megaX(-1.8 + 7.15), top + 5.5, unoZ(41.4 + 4.5));
  const jackHole = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20).rotateY(-Math.PI / 2), dark);
  jackHole.position.set(megaX(-1.8) - 0.05, top + 6, unoZ(45.9));
  g.add(usb, usbHole, jack, jackHole);
  // หัวต่อตัวเมีย: [x0, x1, ระยะจากขอบบน z0, z1]
  const hdrMat = mat('unoHdr', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55 }));
  const holeMat = mat('unoHdrHole', () => new THREE.MeshBasicMaterial({ color: 0x040404 }));
  const strips: Array<[number, number, number, number]> = [
    [18.796, 41.656, 2.54, 2.54], [45.72, 63.5, 2.54, 2.54], [68.58, 86.36, 2.54, 2.54],
    [27.94, 45.72, D - 2.54, D - 2.54], [50.8, 68.58, D - 2.54, D - 2.54], [73.66, 91.44, D - 2.54, D - 2.54], [93.98, 96.52, 2.54, 45.72],
  ];
  for (const [x0, x1, z0, z1] of strips) {
    const hm = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 2.54, UNO_HDR_H, z1 - z0 + 2.54), hdrMat);
    hm.position.set(megaX((x0 + x1) / 2), top + UNO_HDR_H / 2, unoZ((z0 + z1) / 2));
    g.add(hm);
    for (let xx = x0; xx <= x1 + 0.01; xx += 2.54) for (let zz = z0; zz <= z1 + 0.01; zz += 2.54) {
      const hl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2), holeMat);
      hl.position.set(megaX(xx), top + UNO_HDR_H + 0.02, unoZ(zz));
      g.add(hl);
    }
  }
  for (const [n, [mx, zt]] of Object.entries(MEGA_HDR)) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), tin());
    tip.position.set(megaX(mx), top + UNO_HDR_H, unoZ(zt));
    tip.userData.leadTip = n;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(megaX(mx), top + UNO_HDR_H - 0.8, unoZ(zt));
    hit.userData = { pin: n, isPin: true };
    g.add(tip, hit);
  }
  // ATmega2560 TQFP-100 (ตัวถัง 14 × 14 mm + ขา) วางเอียง 45°
  const smd = mat('unoSmd', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5 }));
  const qfp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 14), mat('unoChip', () => new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.45 })));
  body.position.y = 0.6;
  qfp.add(body);
  for (let k = 0; k < 25; k++) for (let s = 0; s < 4; s++) {
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 1.0), tin());
    const t = -6 + k * 0.5;
    if (s < 2) lg.position.set(t, 0.08, (s ? 1 : -1) * 7.5); else { lg.rotation.y = Math.PI / 2; lg.position.set((s === 3 ? 1 : -1) * 7.5, 0.08, t); }
    qfp.add(lg);
  }
  const mk = decal(textTex('mega:2560', ['ATMEGA2560', '16AU'], 'rgba(214,218,222,0.95)', 512, 256, 64), 10, 5);
  mk.rotation.x = -Math.PI / 2;
  mk.position.y = 1.22;
  qfp.add(mk);
  qfp.rotation.y = Math.PI / 4;
  qfp.position.set(megaX(50), top, unoZ(31));
  g.add(qfp);
  // ATmega16U2 (USB), คริสตัล 16 MHz, ตัวคุมแรงดัน, ตัวเก็บประจุ
  const u2 = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5), smd);
  u2.position.set(megaX(17), top + 0.5, unoZ(13.5));
  const xtal = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 7.5, 6, 16), metal);
  xtal.rotation.z = Math.PI / 2;
  xtal.position.set(megaX(36), top + 1.8, unoZ(42));
  const reg = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.8, 3.5), smd);
  reg.position.set(megaX(9), top + 0.9, unoZ(36));
  g.add(u2, xtal, reg);
  const can = mat('unoCap', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9 })));
  for (const [mx, mt] of [[16.5, 37], [16.5, 46]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 5.8, 24), can);
    c.position.set(megaX(mx), top + 2.9, unoZ(mt));
    g.add(c);
  }
  // ปุ่ม RESET
  const rb = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 6), mat('unoRstBody', () => new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4, metalness: 0.6 })));
  rb.position.set(megaX(6.5), top + 1.6, unoZ(5.5));
  const rk = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1, 16), mat('unoRstKey', () => new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.5 })));
  rk.position.set(megaX(6.5), top + 3.7, unoZ(5.5));
  g.add(rb, rk);
  // ICSP 2×3 ของ ATmega2560 (ตำแหน่งเดียวกับ Uno: x 63.6–66.2, 22.9–27.9 mm จากขอบบน)
  const pinMat = mat('unoIcsp', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const ib = new THREE.Mesh(new THREE.BoxGeometry(5.08, 2.5, 7.62), hdrMat);
  ib.position.set(megaX(64.9), top + 1.25, unoZ(25.4));
  g.add(ib);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, 6, 0.64), pinMat);
    p.position.set(megaX(63.627 + i * 2.54), top + 3, unoZ(22.86 + j * 2.54));
    g.add(p);
  }
  // LED SMD: L (D13), TX, RX, ON
  const ledL = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.4 });
  const ledOff = mat('unoLedOff', () => new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.4 }));
  const ledOn = mat('unoLedOn', () => new THREE.MeshStandardMaterial({ color: 0x8dff9a, emissive: 0x22dd44, emissiveIntensity: 1.6, roughness: 0.4 }));
  for (const [mt, m] of [[15.5, ledL], [19.5, ledOff], [22.5, ledOff]] as const) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.25), m);
    l.position.set(megaX(27), top + 0.4, unoZ(mt));
    g.add(l);
  }
  const on = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.25), ledOn);
  on.position.set(megaX(76), top + 0.4, unoZ(29));
  g.add(on);
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffb02e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(megaX(27), top + 1.5, unoZ(15.5));
  glow.scale.set(7, 7, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  root.userData.picoLed = ledL;
  root.userData.picoGlow = glow;
  root.userData.topY = (top + 11) / 2.54;
  return root;
}

/* ======================= Raspberry Pi 5 ======================= */

/**
 * ขอบบอร์ด Raspberry Pi 5 (85 × 56 mm) — ตำแหน่งหัวต่อ GPIO ตามแบบเชิงกล: รูยึด (3.5, 3.5) และ (61.5, 3.5) จากมุมซ้ายบน
 * หัวต่อ 2×20 อยู่กึ่งกลางระหว่างรูยึดสองรู (x = 32.5 mm) แถวกลางที่ y = 3.5 mm · ขาคี่แถวใน ขาคู่แถวริมบอร์ด ขา 1 ทางซ้าย
 * ชิ้นส่วนอื่น (SoC, RP1, พอร์ต USB/Ethernet/HDMI/USB-C) วางตามตำแหน่งโดยประมาณจากภาพบอร์ด ไม่ใช่แบบเชิงกลละเอียด
 */
const RPI_W = 85, RPI_D = 56, RPI_PCB_Y = 3, RPI_HDR_BASE = 2.5, RPI_PIN_UP = 6;
const rpiX = (x: number) => x - RPI_W / 2;
const rpiZ = (y: number) => y - RPI_D / 2;
/** ตำแหน่ง (x, y) ของขาเลข n (1–40) บนบอร์ด (mm จากมุมซ้ายบน) */
const rpiPinXY = (n: number): [number, number] => [32.5 + (Math.floor((n - 1) / 2) - 9.5) * 2.54, n % 2 === 1 ? 3.5 + 1.27 : 3.5 - 1.27];
const RPI_TIP_Y = RPI_PCB_Y + 1.6 + RPI_HDR_BASE + RPI_PIN_UP;
/** ปลายเข็ม (ตำแหน่งที่สายจัมเปอร์ตัวเมียเสียบ) หน่วยรู local ก่อนหมุน — key = ชื่อขาในแอป */
export function rpiPinLocal(names: string[]): Record<string, [number, number, number]> {
  return Object.fromEntries(names.map((nm, i) => { const [x, y] = rpiPinXY(i + 1); return [nm, [rpiX(x) / 2.54, RPI_TIP_Y / 2.54, rpiZ(y) / 2.54]]; }));
}

/**
 * Raspberry Pi 5 (85 × 56 mm, PCB 1.6 mm บนเสารอง 3 mm) — ไม่มีโลโก้และชื่อผู้ผลิต
 * หัวต่อ GPIO ตัวผู้ 2×20 (สายจัมเปอร์ตัวเมียเสียบจากด้านบน) · SoC ฝาโลหะ · ชิป RP1 · RAM · Ethernet + USB 3.0/2.0 สองชั้นขอบขวา
 * USB-C และ micro-HDMI สองช่องขอบล่าง · ขั้วต่อ FFC (กล้อง/จอ, PCIe) · ปุ่มเปิดปิด · ขั้วต่อพัดลม · LED สถานะ
 * names = ชื่อขาในแอปเรียงตามเลขขา 1–40 · userData.picoLed = LED สถานะ (สีแดง = มีไฟ)
 */
export function buildRpi5(names: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const y0 = RPI_PCB_Y, top = y0 + 1.6;
  // แผ่นวงจรมุมโค้งรัศมี 3 mm
  const sh = new THREE.Shape();
  const hw = RPI_W / 2, hd = RPI_D / 2, rr = 3;
  sh.moveTo(-hw + rr, -hd); sh.lineTo(hw - rr, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + rr); sh.lineTo(hw, hd - rr); sh.quadraticCurveTo(hw, hd, hw - rr, hd);
  sh.lineTo(-hw + rr, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - rr); sh.lineTo(-hw, -hd + rr); sh.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const pcbGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2);
  const pcb = new THREE.Mesh(pcbGeo, mat('rpiPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f7a3d, roughness: 0.55 })));
  pcb.position.set(0, y0 + 1.6, 0);
  g.add(pcb);
  // รูยึด 4 มุม + เสารอง
  const ring = mat('rpiRing', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.35, metalness: 1 })));
  const foot = mat('rpiFoot', () => new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }));
  for (const [x, y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) {
    const r = new THREE.Mesh(new THREE.RingGeometry(1.4, 3, 24).rotateX(-Math.PI / 2), ring);
    r.position.set(rpiX(x), top + 0.03, rpiZ(y));
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, y0, 16), foot);
    f.position.set(rpiX(x), y0 / 2, rpiZ(y));
    g.add(r, f);
  }
  // หัวต่อ GPIO 2×20
  const base = new THREE.Mesh(new THREE.BoxGeometry(20 * 2.54, RPI_HDR_BASE, 2 * 2.54), mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  base.position.set(rpiX(32.5), top + RPI_HDR_BASE / 2, rpiZ(3.5));
  g.add(base);
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const pinGeo = new THREE.BoxGeometry(0.64, RPI_PIN_UP + RPI_HDR_BASE, 0.64);
  names.forEach((nm, i) => {
    const [x, y] = rpiPinXY(i + 1);
    const p = new THREE.Mesh(pinGeo, gold);
    p.position.set(rpiX(x), top + (RPI_PIN_UP + RPI_HDR_BASE) / 2, rpiZ(y));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), gold);
    tip.position.set(rpiX(x), RPI_TIP_Y, rpiZ(y));
    tip.userData.leadTip = nm;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 3, 2.3), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(rpiX(x), RPI_TIP_Y - 1, rpiZ(y));
    hit.userData = { pin: nm, isPin: true };
    g.add(p, tip, hit);
  });
  // ลายสกรีน: เลขขา 1/2 และ 39/40 ข้างหัวต่อ (ช่วยหาขา 1) — ไม่มีชื่อ/โลโก้ผู้ผลิต
  const silk = canvasTex('rpiSilk', 850, 560, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(245,247,250,0.92)'; x.strokeStyle = 'rgba(245,247,250,0.85)'; x.lineWidth = 3;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const at = (s: string, mx: number, my: number, size = 16) => { x.font = `600 ${size}px "Chakra Petch", "Arial Narrow", sans-serif`; x.fillText(s, mx * 10, my * 10); };
    at('1', 6.4, 4.8, 15); at('2', 6.4, 2.2, 15); at('39', 58.8, 4.8, 15); at('40', 58.8, 2.2, 15);
    x.strokeRect(7.4 * 10, 1.1 * 10, 50.6 * 10, 4.8 * 10);
    at('J8', 32.5, 8.1, 16);
    at('PWR', 4.3, 45.2, 13); at('FAN', 72, 3.5, 13); at('PCIe', 5.5, 22, 13);
    at('CAM/DISP', 53, 36.2, 12); at('0', 50, 55.2, 12); at('1', 56, 55.2, 12); at('USB-C 5V', 11.2, 47.5, 13); at('HDMI0', 25.8, 48.2, 13); at('HDMI1', 39.2, 48.2, 13);
  });
  const sk = new THREE.Mesh(new THREE.PlaneGeometry(RPI_W, RPI_D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: silk, transparent: true, depthWrite: false, toneMapped: false }));
  sk.position.set(0, top + 0.02, 0);
  sk.renderOrder = 2;
  g.add(sk);
  // SoC (ฝาโลหะ) · RAM · RP1
  const metal = mat('rpiMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc7cbd0, roughness: 0.32, metalness: 1 })));
  const ic = mat('rpiIc', () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5 }));
  const soc = new THREE.Mesh(new THREE.BoxGeometry(19, 1.0, 19), mat('rpiSub', () => new THREE.MeshStandardMaterial({ color: 0x2b4a2f, roughness: 0.6 })));
  soc.position.set(rpiX(25), top + 0.5, rpiZ(30));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.1, 15.5), metal);
  lid.position.set(rpiX(25), top + 1.55, rpiZ(30));
  const ram = new THREE.Mesh(new THREE.BoxGeometry(12, 1.0, 11), ic);
  ram.position.set(rpiX(42.5), top + 0.5, rpiZ(28));
  const rp1 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.9, 9), ic);
  rp1.position.set(rpiX(62), top + 0.45, rpiZ(25));
  g.add(soc, lid, ram, rp1);
  // Ethernet (บน) + USB 3.0 + USB 2.0 ขอบขวา ยื่นออกนอกบอร์ด
  const steel = mat('rpiSteel', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc1, roughness: 0.35, metalness: 0.95 })));
  const blue = mat('rpiUsb3', () => new THREE.MeshStandardMaterial({ color: 0x2a64c4, roughness: 0.5 }));
  const black = mat('rpiBlackIn', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  const eth = new THREE.Mesh(new THREE.BoxGeometry(21, 13.5, 16), steel);
  eth.position.set(rpiX(RPI_W - 21 / 2 + 2.5), top + 6.75, rpiZ(10.25));
  const ethHole = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 9).rotateY(Math.PI / 2), black);
  ethHole.position.set(rpiX(RPI_W + 2.5) + 0.05, top + 6.2, rpiZ(10.25));
  g.add(eth, ethHole);
  for (const [y, inner] of [[29, blue], [47, black]] as const) {
    const u = new THREE.Mesh(new THREE.BoxGeometry(17.5, 15.5, 13.2), steel);
    u.position.set(rpiX(RPI_W - 17.5 / 2 + 2.5), top + 7.75, rpiZ(y));
    g.add(u);
    for (const yy of [4.1, 11.4]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.9, 11), inner);
      t.position.set(rpiX(RPI_W + 2.5) + 0.2, top + yy, rpiZ(y));
      g.add(t);
    }
  }
  // USB-C และ micro-HDMI สองช่อง ขอบล่าง
  for (const [x, w, hgt] of [[11.2, 9, 3.3], [25.8, 7.5, 3.5], [39.2, 7.5, 3.5]] as const) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 7.5), steel);
    c.position.set(rpiX(x), top + hgt / 2, rpiZ(RPI_D - 7.5 / 2 + 1));
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.4, hgt - 1.2), black);
    hole.position.set(rpiX(x), top + hgt / 2, rpiZ(RPI_D + 1) + 0.03);
    g.add(c, hole);
  }
  // ขั้วต่อ FFC (กล้อง/จอ ×2 และ PCIe) — ฐานดำ ฝาปิดสีขาว
  const ffcBase = mat('rpiFfc', () => new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.6 }));
  const ffcLatch = mat('rpiFfcL', () => new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }));
  for (const [x, y, w, d] of [[50, 46, 3.4, 16.5], [56, 46, 3.4, 16.5], [3.2, 26, 3.4, 12]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), ffcBase);
    b.position.set(rpiX(x), top + 0.8, rpiZ(y));
    const l = new THREE.Mesh(new THREE.BoxGeometry(w > d ? w - 1 : 1.1, 0.6, w > d ? 1.1 : d - 1), ffcLatch);
    l.position.set(rpiX(x), top + 1.9, rpiZ(y));
    g.add(b, l);
  }
  // ขั้วต่อพัดลม 4 ขา (ขาว) และปุ่มเปิดปิดขอบซ้าย
  const fan = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3, 3.2), ffcLatch);
  fan.position.set(rpiX(72), top + 1.5, rpiZ(7));
  g.add(fan);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3), mat('rpiBtn', () => new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.45, metalness: 0.4 })));
  btn.position.set(rpiX(1.2), top + 1.1, rpiZ(42));
  g.add(btn);
  // ช่อง microSD ใต้บอร์ดขอบซ้าย
  const sd = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 11.5), steel);
  sd.position.set(rpiX(6), y0 - 0.7, rpiZ(28));
  g.add(sd);
  // LED สถานะ (แดง = มีไฟ)
  const led = new THREE.MeshStandardMaterial({ color: 0xff6a5a, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.4 });
  const lm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1), led);
  lm.position.set(rpiX(4.3), top + 0.35, rpiZ(48));
  g.add(lm);
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xff4030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(rpiX(4.3), top + 1.2, rpiZ(48));
  glow.scale.set(6, 6, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  root.userData.picoLed = led;
  root.userData.picoGlow = glow;
  root.userData.topY = (top + 16) / 2.54;
  return root;
}

/* ===================== โมดูล I²C, มอเตอร์สั่น, ESP32-S2 ===================== */

/** หัวเข็มตัวผู้ n ขา (ฐานพลาสติก + เข็มลงรู) ที่ x = 0 … (n−1)·PITCH */
function maleHeader(g: THREE.Group, names: string[], y0: number, key: string) {
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(names.length * PITCH, 2.5, 2.5), mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  hdr.position.set(((names.length - 1) * PITCH) / 2, 1.25 + 1.0, 0);
  g.add(hdr);
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  names.forEach((p, i) => g.add(flatLead([V(i * PITCH, y0), V(i * PITCH, 0)], 0.64, 0.64, p, gold)));
  void key;
}

/**
 * จอ OLED 0.96" I²C (SSD1306): แผ่นวงจร 27.3 × 27.8 mm หัวเข็ม 4 ขาที่ขอบบน (GND VCC SCL SDA) · กระจก 26.7 × 19.3 mm พื้นที่แสดงผล 21.74 × 10.86 mm (128 × 64)
 * เสียบที่แถวขอบบอร์ดแล้ววางราบ ตัวโมดูลยื่นออกด้านหน้า (หัวเข็มอยู่ขอบหลัง ภาพจึงตั้งตรงเมื่อมองจากด้านหน้า — ทิศเดียวกับไดรเวอร์ ssd1306.py)
 * userData.oledCanvas / oledTex: ฉากวาดพิกเซลจากหน่วยความจำจอ (GDDRAM) ที่จำลอง
 */
export function buildOledModule(): THREE.Group {
  const { root, g } = rootGroups();
  const cx = 1.5 * PITCH, yP = 4.6, T = 1.2;
  const pcbMat = mat('oledPcb', () => new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.55 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(27.3, T, 27.8), pcbMat);
  pcb.position.set(cx, yP + T / 2, 27.8 / 2 - 2.6);
  g.add(pcb);
  // รูยึด 4 มุม
  const holeMat = mat('oledHole', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.35, metalness: 1 })));
  for (const [dx, dz] of [[-11.6, -0.6], [11.6, -0.6], [-11.6, 22.6], [11.6, 22.6]] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.35, 6, 18), holeMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx + dx, yP + T + 0.02, dz);
    g.add(ring);
  }
  // กระจก + กรอบดำ
  const glass = new THREE.Mesh(new THREE.BoxGeometry(26.7, 1.4, 19.3), mat('oledGlass', () => new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.15, metalness: 0.2 })));
  glass.position.set(cx, yP + T + 0.7, 3.2 + 19.3 / 2);
  g.add(glass);
  // สายแพจากกระจกลงไปใต้แผ่นวงจร (ขอบหน้า)
  const flex = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 2.4), mat('oledFlex', () => new THREE.MeshStandardMaterial({ color: 0xc58a2c, roughness: 0.5 })));
  flex.position.set(cx, yP + T + 0.15, 23.6);
  g.add(flex);
  // พื้นที่แสดงผล: CanvasTexture 128 × 64 (จุดต่อจุด)
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(21.74, 10.86), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(cx, yP + T + 1.42, 5.6 + 10.86 / 2);
  g.add(screen);
  root.userData.oledCanvas = canvas;
  root.userData.oledTex = tex;
  // ป้ายขาบนแผ่นวงจร (ระหว่างหัวเข็มกับกระจก)
  ['GND', 'VCC', 'SCL', 'SDA'].forEach((p, i) => {
    const d = decal(textTex(`oled:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.6, 1.3);
    d.rotation.x = -Math.PI / 2;
    d.position.set(i * PITCH, yP + T + 0.02, 1.9);
    g.add(d);
  });
  // ขาตั้งจากหัวเข็มขึ้นถึงแผ่นวงจร
  maleHeader(g, ['GND', 'VCC', 'SCL', 'SDA'], yP + T, 'oled');
  root.userData.topY = (yP + T + 1.5) * MM;
  return root;
}

/** ป้ายขาแนวตั้งด้านหน้าแผ่นวงจรที่ตั้งบนหัวเข็ม (แบบ HC-SR04) */
function standingPcb(g: THREE.Group, w: number, h: number, color: number, key: string, y0: number, cx: number) {
  const T = 1.6;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(w, h, T), mat(`${key}Pcb`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
  pcb.position.set(cx, y0 + h / 2, 0);
  g.add(pcb);
  return T / 2;
}

/**
 * โมดูล DS3231 ZS-042: แผ่นวงจร 38 × 22 mm ตั้งบนหัวเข็ม 6 ขา (32K SQW SCL SDA VCC GND) · ด้านหน้า DS3231 (SO-16W), AT24C32 (SO-8), LED ไฟเลี้ยง
 * ด้านหลัง ช่องใส่ถ่าน CR2032/LIR2032
 */
export function buildRtcModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'];
  const cx = 2.5 * PITCH, y0 = 3.5, W = 22, H = 38;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'rtc', y0, cx);
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const ic = new THREE.Mesh(new THREE.BoxGeometry(7.5, 10.3, 2.4), black);
  ic.position.set(cx - 2, y0 + 23, zf + 1.2);
  const ee = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.9, 1.5), black);
  ee.position.set(cx + 6, y0 + 12, zf + 0.75);
  g.add(ic, ee);
  const icLab = decal(textTex('rtc:ic', ['DS3231'], 'rgba(200,204,208,0.9)', 256, 64, 46), 6.4, 1.6);
  icLab.position.set(cx - 2, y0 + 23, zf + 2.42);
  g.add(icLab);
  const ledMat = mat('rtcLed', () => new THREE.MeshStandardMaterial({ color: 0xd32f2f, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.4 }));
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.6), ledMat);
  led.position.set(cx + 7, y0 + 30, zf + 0.3);
  g.add(led);
  root.userData.powerLed = ledMat;
  // ช่องถ่านด้านหลัง
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 10.5, 3.2, 40), black);
  holder.rotation.x = Math.PI / 2;
  holder.position.set(cx, y0 + 22, -zf - 1.6);
  g.add(holder);
  const name = decal(textTex('rtc:name', ['ZS-042'], 'rgba(240,242,245,0.95)', 256, 64, 44), 7, 1.75);
  name.position.set(cx, y0 + 33.5, zf + 0.02);
  g.add(name);
  pins.forEach((p, i) => {
    const d = decal(textTex(`rtc:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.6, 1.3);
    d.position.set(i * PITCH, y0 + 2.4, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'rtc');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** โมดูล GY-521 (MPU6050): แผ่นวงจร 21 × 16 mm ตั้งบนหัวเข็ม 8 ขา · ชิป QFN 4 × 4 mm, เรกูเลเตอร์ 3.3 V, LED ไฟเลี้ยง, ลูกศรแกน X/Y */
export function buildImuModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'];
  const cx = 3.5 * PITCH, y0 = 3.5, W = 21, H = 16;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'imu', y0, cx);
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.9), black);
  chip.position.set(cx, y0 + 10, zf + 0.45);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.6, 1.1), black);
  ldo.position.set(cx - 6, y0 + 12, zf + 0.55);
  g.add(chip, ldo);
  const ledMat = mat('imuLed', () => new THREE.MeshStandardMaterial({ color: 0xd32f2f, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.4 }));
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.6), ledMat);
  led.position.set(cx + 6.5, y0 + 13, zf + 0.3);
  g.add(led);
  root.userData.powerLed = ledMat;
  const ax = decal(textTex('imu:axes', ['↑Y  →X'], 'rgba(240,242,245,0.95)', 256, 64, 40), 5.2, 1.3);
  ax.position.set(cx + 5, y0 + 7, zf + 0.02);
  const nm = decal(textTex('imu:name', ['GY-521'], 'rgba(240,242,245,0.95)', 256, 64, 44), 5.6, 1.4);
  nm.position.set(cx - 4.5, y0 + 6.6, zf + 0.02);
  g.add(ax, nm);
  pins.forEach((p, i) => {
    const d = decal(textTex(`imu:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'imu');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** ปลายขาตัวผู้ของสายมอเตอร์สั่น (หน่วยรู) */
export const VIB_PIN_LOCAL: Record<string, [number, number, number]> = {
  A: [-1.25 / 1, 2.2 / 2.54, 10 / 2.54],
  B: [1.25 / 1, 2.2 / 2.54, 10 / 2.54],
};

/** มอเตอร์สั่นแบบเหรียญ Ø10 × 2.7 mm ด้านบนมีเทปกาว สายแดง/น้ำเงินเส้นเล็กไปขาตัวผู้ด้านหน้า · userData.vibCoin = ส่วนที่สั่น */
export function buildVibMotor(): THREE.Group {
  const { root, g } = rootGroups();
  const coin = new THREE.Group();
  const can = mat('vibCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2.7, 40), can);
  body.position.y = 1.35;
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.15, 40), mat('vibTape', () => new THREE.MeshStandardMaterial({ color: 0xe9e2c8, roughness: 0.8 })));
  tape.position.y = 2.78;
  coin.add(body, tape);
  coin.position.set(0, 0, -8);
  g.add(coin);
  root.userData.vibCoin = coin;
  for (const [pin, col, sx] of [['A', 0xc62828, -1], ['B', 0x1e5bd8, 1]] as const) {
    const [ux, uy, uz] = VIB_PIN_LOCAL[pin];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    const c = new THREE.CatmullRomCurve3([V(sx * 1.2, 1.2, -3.2), V(sx * 2.2, 1.0, 1), V(x, 1.0, z - 7)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.3, 6), mat(`vibWire${pin}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }))));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 7), mat('ttPinHousing', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
    housing.position.set(x, 1.3, z - 3.5);
    const pinM = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.64, 5), tin());
    pinM.position.set(x, 1.3, z + 2.2);
    const tipMark = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), tin());
    tipMark.position.set(x, y, z);
    tipMark.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y, z);
    hit.userData = { pin, isPin: true };
    g.add(housing, pinM, tipMark, hit);
  }
  root.userData.topY = 3 * MM;
  return root;
}

/**
 * ESP32-S2-DevKitM-1 (แบบขนาดของ Espressif): แผ่นวงจรดำ 25.4 × 54 mm แถวขาห่าง 22.86 mm (0.9") 21 ขาต่อแถว
 * มองด้านบน USB อยู่ซ้าย: J1 แถวหลัง (G 5V 17 … 0 3V3 จากซ้าย), J3 แถวหน้า (18 19 20 … RST G) · โมดูล ESP32-S2-MINI-1 ด้านขวา เสาอากาศยื่นพ้นขอบ
 * ปุ่ม BOOT/RST สองข้าง micro-USB, RGB LED (IO18), LDO 3.3 V, LED ไฟ — เฉพาะโมเดล ไม่มีการจำลองการทำงาน (ไม่มีโลโก้ผู้ผลิต)
 * พิกัด: ขา J3-21 (IO18) ที่ (0, 0), ขาเรียงไป +x, แถว J1 ที่ z = −22.86
 */
export function buildEsp32s2(): THREE.Group {
  const { root, g } = rootGroups();
  const L = 54, W = 25.4, T = 1.6, y0 = 8.5;
  const cx = 10 * PITCH, cz = -22.86 / 2;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), mat('s2Pcb', () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 })));
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const top = y0 + T;
  // โมดูล ESP32-S2-MINI-1: ฝาโลหะ 15.4 × 15.4 (ส่วนเสาอากาศยื่นออกขวาพ้นขอบบอร์ด)
  const shield = new THREE.Mesh(new THREE.BoxGeometry(15.4, 2.4, 15.4), mat('s2Shield', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.35, metalness: 1 }))));
  shield.position.set(cx + L / 2 - 8.2, top + 1.2, cz);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.8, 15.4), mat('s2Ant', () => new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5 })));
  ant.position.set(cx + L / 2 + 2.4, top + 0.4, cz);
  g.add(shield, ant);
  const lab = decal(textTex('s2:mod', ['ESP32-S2-MINI-1'], 'rgba(40,44,50,0.9)', 256, 64, 34), 12, 3);
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2;
  lab.position.set(cx + L / 2 - 8.2, top + 2.42, cz);
  g.add(lab);
  // micro-USB ซ้าย + ปุ่ม BOOT/RST
  const usb = new THREE.Mesh(new THREE.BoxGeometry(5.7, 2.6, 7.6), mat('s2Usb', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 }))));
  usb.position.set(cx - L / 2 + 2.2, top + 1.3, cz);
  g.add(usb);
  const btnBase = mat('s2BtnBase', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.35, metalness: 0.9 })));
  const btnCap = mat('s2BtnCap', () => new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.6 }));
  for (const [dz, txt] of [[-7.4, 'BOOT'], [7.4, 'RST']] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.5, 3.5), btnBase);
    b.position.set(cx - L / 2 + 6.5, top + 0.75, cz + dz);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 16), btnCap);
    cap.position.set(cx - L / 2 + 6.5, top + 1.9, cz + dz);
    const t = decal(textTex(`s2:${txt}`, [txt], 'rgba(235,238,240,0.95)', 128, 64, 36), 3, 1.5);
    t.rotation.x = -Math.PI / 2;
    t.position.set(cx - L / 2 + 10, top + 0.02, cz + dz);
    g.add(b, cap, t);
  }
  // ไอซี USB-UART (QFN), LDO, RGB LED, LED ไฟ
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const uart = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 4), black);
  uart.position.set(cx - 9, top + 0.45, cz + 2);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 3.5), black);
  ldo.position.set(cx + 4.5, top + 0.8, cz - 2);
  const rgb = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1, 2.8), mat('s2Rgb', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 })));
  rgb.position.set(cx - 1, top + 0.5, cz - 6);
  g.add(uart, ldo, rgb);
  const rgbLab = decal(textTex('s2:rgb', ['RGB@IO18'], 'rgba(235,238,240,0.95)', 256, 64, 34), 5, 1.25);
  rgbLab.rotation.x = -Math.PI / 2;
  rgbLab.position.set(cx - 1, top + 0.02, cz - 2.6);
  g.add(rgbLab);
  // ป้าย "เฉพาะโมเดล" บนบอร์ด (ช่วยไม่ให้เข้าใจผิดว่ารันโค้ดได้)
  const tag = decal(textTex('s2:model', ['MODEL ONLY'], 'rgba(255,183,77,0.95)', 256, 64, 40), 9, 2.25);
  tag.rotation.x = -Math.PI / 2;
  tag.position.set(cx - 4, top + 0.03, cz + 7.5);
  g.add(tag);
  // หัวเข็มตัวผู้สองแถวใต้บอร์ด + ป้ายขา
  const j3 = ['18', '19', '20', '21', '26', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', 'TX', 'RX', '45', '46', 'RST', 'G'];
  const j1 = ['G', '5V', '17', '16', '15', '14', '13', '12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0', '3V3'];
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (const [row, z, names] of [['j3', 0, j3], ['j1', -22.86, j1]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(21 * PITCH, 2.5, 2.5), hdr);
    base.position.set(cx, 1.25 + 1.0 + 3.6, z);
    g.add(base);
    names.forEach((n, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(i * PITCH, top + 0.02, z);
      const t = decal(textTex(`s2:pin:${n}`, [n], 'rgba(235,238,240,0.95)', 128, 64, 40), 2.2, 1.1);
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * PITCH, top + 0.02, z + (row === 'j3' ? -2.3 : 2.3));
      g.add(ring, t);
    });
  }
  const leadNames = [
    'IO18', 'IO19', 'IO20', 'IO21', 'IO26', 'IO33', 'IO34', 'IO35', 'IO36', 'IO37', 'IO38', 'IO39', 'IO40', 'IO41', 'IO42', 'IO43', 'IO44', 'IO45', 'IO46', 'RST', 'GND.2',
  ];
  const leadNames1 = ['GND.1', '5V', 'IO17', 'IO16', 'IO15', 'IO14', 'IO13', 'IO12', 'IO11', 'IO10', 'IO9', 'IO8', 'IO7', 'IO6', 'IO5', 'IO4', 'IO3', 'IO2', 'IO1', 'IO0', '3V3'];
  leadNames.forEach((n, i) => g.add(flatLead([V(i * PITCH, y0), V(i * PITCH, 0)], 0.64, 0.64, n, gold)));
  leadNames1.forEach((n, i) => g.add(flatLead([V(i * PITCH, y0, -22.86), V(i * PITCH, 0, -22.86)], 0.64, 0.64, n, gold)));
  root.userData.topY = (top + 2.4) * MM;
  return root;
}

/**
 * หัวเข็มตัวผู้สองแถว (ใต้บอร์ด) ของบอร์ดเฉพาะโมเดล: แถวหน้า z = 0, แถวหลัง z = −rowGap · ขา i ที่ x = i·PITCH
 * ป้ายขาบนบอร์ด (ด้านในของแถว) + ปลายขา flatLead ที่ชื่อขาตาม pinDefs (ใช้คลิก/ต่อสาย)
 */
function modelOnlyHeaders(g: THREE.Group, key: string, y0: number, top: number, rowGap: number,
  front: Array<[string, string]>, back: Array<[string, string]>, labelColor: string): void {
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (const [z, pins, inward] of [[0, front, -1], [-rowGap, back, 1]] as const) {
    const n = pins.length, cx = (n - 1) / 2 * PITCH;
    const base = new THREE.Mesh(new THREE.BoxGeometry(n * PITCH, 2.5, 2.5), hdr);
    base.position.set(cx, y0 - 1.25, z);
    g.add(base);
    pins.forEach(([name, silk], i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(i * PITCH, top + 0.02, z);
      const t = decal(textTex(`${key}:pin:${silk}`, [silk], labelColor, 128, 64, 40), 2.2, 1.1);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(i * PITCH, top + 0.02, z + inward * 2.4);
      g.add(ring, t);
      g.add(flatLead([V(i * PITCH, y0, z), V(i * PITCH, 0, z)], 0.64, 0.64, name, gold));
    });
  }
}

/** ป้าย "MODEL ONLY" บนบอร์ด (ช่วยไม่ให้เข้าใจผิดว่ารันโค้ดได้) */
function modelOnlyTag(g: THREE.Group, key: string, x: number, y: number, z: number, w = 9): void {
  const tag = decal(textTex(`${key}:model`, ['MODEL ONLY'], 'rgba(255,183,77,0.97)', 256, 64, 40), w, w / 4);
  tag.rotation.x = -Math.PI / 2;
  tag.position.set(x, y + 0.03, z);
  g.add(tag);
}

/** ตัวถัง QFP (LQFP-48/64) วางราบ หมุนได้ · ขาเป็นแถบเล็กรอบตัว */
function qfp(g: THREE.Group, key: string, x: number, y: number, z: number, body: number, pinsPerSide: number, pitch: number, rotY: number, text: string[]): void {
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const grp = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(body, 1.4, body), black);
  b.position.y = 0.75;
  grp.add(b);
  const lead = tin();
  for (let side = 0; side < 4; side++) for (let i = 0; i < pinsPerSide; i++) {
    const o = (i - (pinsPerSide - 1) / 2) * pitch;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 1.0), lead);
    const [lx, lz] = side === 0 ? [o, body / 2 + 0.5] : side === 1 ? [o, -body / 2 - 0.5] : side === 2 ? [body / 2 + 0.5, o] : [-body / 2 - 0.5, o];
    l.position.set(lx, 0.1, lz);
    if (side >= 2) l.rotation.y = Math.PI / 2;
    grp.add(l);
  }
  const t = decal(textTex(`${key}:chip`, text, 'rgba(150,154,160,0.9)', 256, 128, 34), body * 0.8, body * 0.4);
  t.rotation.x = -Math.PI / 2;
  t.position.y = 1.47;
  grp.add(t);
  grp.position.set(x, y, z);
  grp.rotation.y = rotY;
  g.add(grp);
}

/**
 * STM32F103C8T6 "Blue Pill" (เฉพาะโมเดล — ไม่มีการจำลอง CPU, ไม่มีโลโก้ผู้ผลิต): แผ่นวงจรสีน้ำเงิน ≈ 53.3 × 22.9 mm
 * มองด้านบน micro-USB อยู่ซ้าย · แถวหน้า (z = 0) B12 … 3.3, แถวหลังห่าง 15.24 mm (0.6") G G 3.3 R … VB · หัว SWD 4 ขาที่ปลายขวา
 * ตำแหน่งจัมเปอร์ BOOT0/BOOT1 และหัว SWD ตามไฟล์ Fritzing · ชิ้นส่วนอื่น (คริสตัล 8 MHz, ปุ่มรีเซ็ต, LED, LDO) ตำแหน่งโดยประมาณ
 */
export function buildBluePill(front: Array<[string, string]>, back: Array<[string, string]>): THREE.Group {
  const { root, g } = rootGroups();
  const L = 53.3, W = 22.9, T = 1.6, y0 = 8.5, rowGap = 15.24;
  const x0 = -3.0, cz = -rowGap / 2; // ขอบซ้าย (ฝั่ง USB) ห่างขาแรก 3 mm
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), mat('bpPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 })));
  pcb.position.set(x0 + L / 2, y0 + T / 2, cz);
  g.add(pcb);
  const top = y0 + T;
  const steel = mat('bpSteel', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  // micro-USB ยื่นพ้นขอบซ้ายเล็กน้อย
  const usb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 7.6), steel);
  usb.position.set(x0 + 2.2, top + 1.3, cz);
  g.add(usb);
  // STM32F103C8T6 LQFP-48 (7 × 7 mm ระยะขา 0.5 mm) วางเอียง 45° กลางบอร์ด
  qfp(g, 'bp', 30, top, cz, 7, 12, 0.5, Math.PI / 4, ['STM32F103', 'C8T6']);
  // คริสตัล 8 MHz (HC-49/S SMD) + 32.768 kHz, ปุ่มรีเซ็ต, LDO, LED ไฟ + LED PC13
  const xtal = new THREE.Mesh(new THREE.BoxGeometry(10, 3.4, 3.0), steel);
  xtal.position.set(20, top + 1.7, -4.9);
  const xtal32 = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 6, 14), steel);
  xtal32.rotation.z = Math.PI / 2;
  xtal32.position.set(38, top + 1.0, -4.0);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 3.5), mat('bpBtnBase', () => new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.5 })));
  btn.position.set(6, top + 0.8, -9.5);
  const btnCap = new THREE.Mesh(new THREE.BoxGeometry(3, 1.0, 1.6), black);
  btnCap.position.set(6, top + 2.0, -9.5);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 1.7), black);
  ldo.position.set(5, top + 0.55, -4.8);
  g.add(xtal, xtal32, btn, btnCap, ldo);
  for (const [lx, col, txt] of [[41.5, 0xd32f2f, 'PWR'], [37, 0x43a047, 'PC13']] as const) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.8), mat(`bpLed${txt}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })));
    led.position.set(lx, top + 0.3, -7.6);
    const t = decal(textTex(`bp:${txt}`, [txt], 'rgba(240,242,245,0.95)', 128, 64, 36), 2.4, 1.2);
    t.rotation.x = -Math.PI / 2;
    t.position.set(lx, top + 0.02, -6.4);
    g.add(led, t);
  }
  // จัมเปอร์ BOOT0 / BOOT1 (หัว 3 ขาสองแถว + จัมเปอร์ฝั่ง 0)
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const jump = mat('bpJumper', () => new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.5 }));
  for (const z of [-10.2, -7.66]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3 * PITCH, 2.5, 2.5), hdr);
    base.position.set(10 + PITCH, top + 1.25, z);
    const j = new THREE.Mesh(new THREE.BoxGeometry(2 * PITCH, 5.5, 2.4), jump);
    j.position.set(10 + PITCH / 2, top + 3.0, z);
    g.add(base, j);
  }
  // หัว SWD 4 ขา (3.3 DIO CLK GND) ที่ปลายขวา
  for (let i = 0; i < 4; i++) {
    const z = -11.6 + i * PITCH;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), hdr);
    b.position.set(44.6, top + 1.25, z);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.64, 6, 0.64), tin());
    pin.position.set(44.6, top + 4, z);
    g.add(b, pin);
  }
  modelOnlyTag(g, 'bp', 38, top, -10.5, 8);
  modelOnlyHeaders(g, 'bp', y0, top, rowGap, front.map(([n]) => [n, silkBp(n)]), back.map(([n]) => [n, silkBp(n)]), 'rgba(240,242,245,0.95)');
  root.userData.topY = (top + 6) * MM;
  return root;
}
const silkBp = (n: string) => n.replace(/^GND\.\d$/, 'G').replace(/^3V3\.\d$/, '3.3').replace(/^NRST$/, 'R').replace(/^VBAT$/, 'VB').replace(/^P([ABC]\d+)$/, '$1');

/**
 * PJRC Teensy 4.1 (เฉพาะโมเดล — ไม่มีการจำลอง CPU, ไม่มีโลโก้ผู้ผลิต): แผ่นวงจรสีเขียว 61 × 17.8 mm (2.4 × 0.7") ขาขอบนอก 24 ขาต่อแถว แถวห่าง 0.6"
 * มองด้านบน micro-USB อยู่ซ้าย · ชิป i.MX RT1062 (BGA 10 × 10 mm), ช่อง microSD ที่ปลายขวา, ปุ่มโปรแกรม, LED ขา 13 — ตำแหน่งชิ้นส่วนโดยประมาณ
 * ไม่มีแพดด้านใน (VUSB, VBAT, 3.3V, GND, PROGRAM, ON/OFF), หัว USB Host 5 ขา, แพด Ethernet และแพดใต้บอร์ด
 */
export function buildTeensy41(front: Array<[string, string]>, back: Array<[string, string]>): THREE.Group {
  const { root, g } = rootGroups();
  const L = 61, W = 17.8, T = 1.6, y0 = 8.5, rowGap = 15.24;
  const x0 = -(L - 23 * PITCH) / 2, cz = -rowGap / 2;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), mat('t41Pcb', () => new THREE.MeshStandardMaterial({ color: 0x1d6b3a, roughness: 0.5 })));
  pcb.position.set(x0 + L / 2, y0 + T / 2, cz);
  g.add(pcb);
  const top = y0 + T;
  const steel = mat('bpSteel', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const usb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 7.6), steel);
  usb.position.set(x0 + 1.8, top + 1.3, cz);
  g.add(usb);
  // i.MX RT1062 (BGA 10 × 10 mm) — ไม่มีขาให้เห็น
  const cpu = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 10), black);
  cpu.position.set(x0 + 24, top + 0.6, cz);
  const cpuT = decal(textTex('t41:chip', ['MIMXRT1062', 'DVJ6B'], 'rgba(150,154,160,0.9)', 256, 128, 30), 8, 4);
  cpuT.rotation.x = -Math.PI / 2;
  cpuT.position.set(x0 + 24, top + 1.22, cz);
  // แฟลช (SOIC-8 กว้าง), ชิปบูตโหลดเดอร์ (QFN เล็ก), ตัวคุมแรงดัน, ช่อง microSD (ปลายขวา), ปุ่มโปรแกรม, LED ขา 13
  const flash = new THREE.Mesh(new THREE.BoxGeometry(4, 1.0, 4), black);
  flash.position.set(x0 + 33, top + 0.5, cz - 1.8);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 3), black);
  boot.position.set(x0 + 13, top + 0.4, cz + 2.5);
  const reg = new THREE.Mesh(new THREE.BoxGeometry(3, 1.0, 3), black);
  reg.position.set(x0 + 9, top + 0.5, cz - 2.0);
  const sd = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 11), steel);
  sd.position.set(x0 + L - 6.5, top + 0.9, cz);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.4, 2.6), mat('t41Btn', () => new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.55 })));
  btn.position.set(x0 + 41, top + 0.7, cz + 2.6);
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.8), mat('t41Led', () => new THREE.MeshStandardMaterial({ color: 0xff8f00, roughness: 0.4 })));
  led.position.set(x0 + 8, top + 0.3, cz + 3.5);
  g.add(cpu, cpuT, flash, boot, reg, sd, btn, led);
  const nm = decal(textTex('t41:name', ['Teensy 4.1'], 'rgba(240,242,245,0.95)', 256, 64, 40), 9, 2.25);
  nm.rotation.x = -Math.PI / 2;
  nm.position.set(x0 + 34, top + 0.02, cz + 2.4);
  g.add(nm);
  modelOnlyTag(g, 't41', x0 + 40.5, top, cz - 2.2, 7);
  modelOnlyHeaders(g, 't41', y0, top, rowGap, front.map(([n]) => [n, silkT41(n)]), back.map(([n]) => [n, silkT41(n)]), 'rgba(240,242,245,0.95)');
  root.userData.topY = (top + 2) * MM;
  return root;
}
const silkT41 = (n: string) => n.replace(/^GND\.\d$/, 'G').replace(/^3V3\.\d$/, '3.3').replace(/^D(\d+)$/, '$1');

/* ===================== จอกลม GC9A01 + ทัช, โมดูล QMI8658, บอร์ด ESP32-S3 จอกลม (เฉพาะโมเดล) ===================== */

export const ROUND_LCD_PINS = ['VCC', 'GND', 'MISO', 'MOSI', 'SCLK', 'LCD_CS', 'LCD_DC', 'LCD_RST', 'LCD_BL', 'TP_SDA', 'TP_SCL', 'TP_INT', 'TP_RST'];

/** จอ IPS กลม: กระจกนอก Ø35.6 mm พื้นที่แสดงผล Ø32.4 mm (240 × 240) — แคนวาส + พื้นผิวที่รับการแตะ (userData.touchScreen) */
function roundScreen(g: THREE.Group, cx: number, y: number, cz: number, key: string): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(17.8, 17.8, 1.6, 64), mat(`${key}Glass`, () => new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.12, metalness: 0.3 })));
  glass.position.set(cx, y + 0.8, cz);
  g.add(glass);
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 240);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.CircleGeometry(16.2, 96), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  // วางราบหน้าจอขึ้น · ด้านบนของภาพ (แถว 0) อยู่ด้านหลัง (ฝั่งหัวเข็ม/สาย) — มองจากด้านหน้าภาพตั้งตรง
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(cx, y + 1.62, cz);
  screen.userData.touchScreen = true;
  g.add(screen);
  return { canvas, tex };
}

/**
 * โมดูลจอกลม 1.28" GC9A01 + CST816S: แผ่นวงจรกลม Ø38.5 mm + แถบหัวเข็ม 13 ขาด้านหลัง (ป้ายขาตามชื่อขาของโมดูล 1.28inch Touch LCD)
 * เสียบแถวขอบบอร์ดแล้ววางราบแบบจอ OLED ตัวจอยื่นออกด้านหน้า · โมดูลจริงใช้สายแพ/สายต่อ — หัวเข็มเรียงเป็นการจัดเพื่อเสียบเบรดบอร์ด
 * userData.lcdCanvas / lcdTex: ฉากวาดภาพจากหน่วยความจำจอที่จำลอง
 */
export function buildRoundLcd(): THREE.Group {
  const { root, g } = rootGroups();
  const cx = 6 * PITCH, yP = 4.6, T = 1.2;
  const pcbMat = mat('rlcdPcb', () => new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.55 }));
  const tab = new THREE.Mesh(new THREE.BoxGeometry(36, T, 7), pcbMat);
  tab.position.set(cx, yP + T / 2, 1.2);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(19.25, 19.25, T, 72), pcbMat);
  const cz = 4.5 + 19.25;
  disc.position.set(cx, yP + T / 2, cz);
  g.add(tab, disc);
  const { canvas, tex } = roundScreen(g, cx, yP + T, cz, 'rlcd');
  root.userData.lcdCanvas = canvas;
  root.userData.lcdTex = tex;
  ROUND_LCD_PINS.forEach((p, i) => {
    const d = decal(textTex(`rlcd:p:${p}`, [p.replace('LCD_', '').replace('TP_', 'T')], 'rgba(240,242,245,0.95)', 128, 64, 34), 2.5, 1.25);
    d.rotation.x = -Math.PI / 2; d.rotation.z = Math.PI / 2;
    d.position.set(i * PITCH, yP + T + 0.02, 3.2);
    g.add(d);
  });
  const nm = decal(textTex('rlcd:name', ['GC9A01 + CST816S'], 'rgba(240,242,245,0.95)', 512, 64, 40), 14, 1.75);
  nm.rotation.x = -Math.PI / 2;
  nm.position.set(cx, yP + T + 0.02, 1.1 - 2.4);
  g.add(nm);
  maleHeader(g, ROUND_LCD_PINS, yP + T, 'rlcd');
  root.userData.topY = (yP + T + 1.7) * MM;
  return root;
}

/** โมดูล QMI8658 ทั่วไป: แผ่นวงจรตั้งบนหัวเข็ม 5 ขา (VCC GND SCL SDA SA0) ชิป LGA 2.5 × 3 mm */
export function buildQmiModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'SA0'];
  const cx = 2 * PITCH, y0 = 3.5, W = 15.5, H = 13;
  const zf = standingPcb(g, W, H, 0x6a1b9a, 'qmi', y0, cx);
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 0.86), black);
  chip.position.set(cx, y0 + 8.5, zf + 0.43);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.6, 1.1), black);
  ldo.position.set(cx - 4.5, y0 + 10, zf + 0.55);
  g.add(chip, ldo);
  const nm = decal(textTex('qmi:name', ['QMI8658'], 'rgba(240,242,245,0.95)', 256, 64, 44), 6, 1.5);
  nm.position.set(cx + 2.5, y0 + 11.6, zf + 0.02);
  const ax = decal(textTex('qmi:axes', ['↑Y →X'], 'rgba(240,242,245,0.95)', 256, 64, 40), 4.4, 1.1);
  ax.position.set(cx + 4.6, y0 + 7.2, zf + 0.02);
  g.add(nm, ax);
  pins.forEach((p, i) => {
    const d = decal(textTex(`qmi:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'qmi');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/**
 * บอร์ด ESP32-S3 จอกลม 1.28" (เฉพาะโมเดล): จอกลมด้านบนบนแผ่นวงจรกลม + USB-C + ช่องแบต · ไม่มีขาลงเบรดบอร์ด วางบนโต๊ะ
 * สัดส่วนประมาณจากภาพผลิตภัณฑ์ (ผู้ผลิตไม่ได้ระบุขนาดเป็นตัวเลข) · ไม่มีโลโก้ผู้ผลิต · จอดำ (ไม่มีตัวจำลอง CPU)
 */
export function buildEsp32s3Lcd(): THREE.Group {
  const { root, g } = rootGroups();
  const pcb = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 1.6, 72), mat('s3Pcb', () => new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.55 })));
  pcb.position.set(0, 0.8, 0);
  g.add(pcb);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(19.6, 19.6, 3.2, 72), mat('s3Body', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.35 })));
  housing.position.set(0, 1.6 + 1.6, 0);
  g.add(housing);
  const s = roundScreen(g, 0, 4.8, 0, 's3');
  const ctx = s.canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 240);
  s.tex.needsUpdate = true;
  const usb = new THREE.Mesh(new THREE.BoxGeometry(8.9, 3.2, 7.4), mat('s3Usb', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 }))));
  usb.position.set(-6, 1.6 + 1.6, 18.2);
  const bat = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 4.2), mat('s3Bat', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 })));
  bat.position.set(9, 1.6 + 1.4, 16.4);
  g.add(usb, bat);
  const tag = decal(textTex('s3:model', ['MODEL ONLY'], 'rgba(255,183,77,0.95)', 256, 64, 40), 9, 2.25);
  tag.rotation.x = -Math.PI / 2;
  tag.position.set(0, 4.85 + 1.7, -10);
  tag.renderOrder = 3;
  g.add(tag);
  root.userData.topY = 7 * MM;
  return root;
}

/* ===================== จอ LCD 16×2 + บอร์ด I²C, BMP280, BH1750 ===================== */

/** ขนาดมาตรฐานของโมดูล LCD 1602 (mm): แผ่นวงจร 80 × 36, กรอบ 71.2 × 24.2, พื้นที่มองเห็น 64.5 × 16, อักษร 2.95 × 5.55 ระยะ 3.55 / 5.95 */
export const LCD1602_DIM = { L: 80, W: 36, viewW: 64.5, viewH: 16, charW: 2.95, charH: 5.55, pitchX: 3.55, pitchY: 5.95 };
const LCD_PCB_Y = 11; // บอร์ด I²C + หัวต่อด้านล่างยกแผ่นวงจร LCD สูงจากโต๊ะ ≈ 11 mm
const LCD_HDR_Z = -6; // กึ่งกลางหัวเข็ม 4 ขาของบอร์ด I²C (ใต้หัวต่อ 16 ขาที่ขอบบน)

/** ตำแหน่งปลายหัวเข็ม GND VCC SDA SCL (หน่วยรู, กึ่งกลางแผ่นวงจร = 0) ยื่นออกทางซ้าย */
export const LCD_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(
  ['GND', 'VCC', 'SDA', 'SCL'].map((p, i) => [p, [(-40 - 4.5) / 2.54, 4 / 2.54, (LCD_HDR_Z + (i - 1.5) * 2.54) / 2.54]]),
) as Record<string, [number, number, number]>;

/**
 * จอ LCD 1602 วางหงายบนโต๊ะ: แผ่นวงจรเขียว 80 × 36 mm, กรอบโลหะดำ, กระจกแสดงผลเป็นแคนวาส (ฉากวาดจุด 5 × 8 ของแต่ละอักษรจาก DDRAM/CGRAM ที่จำลอง)
 * บอร์ด I²C (PCF8574) อยู่ใต้แผ่นวงจร หัวเข็ม 4 ขายื่นออกซ้าย · ไม่มีโลโก้ผู้ผลิต
 * userData.lcdCanvas / lcdTex — ภาพหน้าจอ · userData.lcdPx = พิกเซลต่อ mm ของแคนวาส
 */
export function buildCharLcd(color: 'blue' | 'green'): THREE.Group {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);
  const { L, W, viewW, viewH } = LCD1602_DIM;
  const pcb = new THREE.Mesh(new RoundedBoxGeometryLite(L, 1.6, W, 0.4), mat('lcdPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.55 })));
  pcb.position.y = LCD_PCB_Y + 0.8;
  g.add(pcb);
  const top = LCD_PCB_Y + 1.6;
  // กรอบโลหะ + กระจก
  const frame = new THREE.Mesh(new THREE.BoxGeometry(71.2, 7, 24.2), mat('lcdFrame', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.6 }))));
  frame.position.set(0, top + 3.5, 0.8);
  g.add(frame);
  const PX = 10;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewW * PX); canvas.height = Math.round(viewH * PX);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(viewW, viewH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.set(0, top + 7.02, 0.8);
  g.add(glass);
  root.userData.lcdCanvas = canvas; root.userData.lcdTex = tex; root.userData.lcdPx = PX; root.userData.lcdColor = color;
  // หัวต่อ 16 ขาที่ขอบบน (บัดกรีกับบอร์ด I²C ด้านล่าง)
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (let i = 0; i < 16; i++) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 12), gold);
    pad.position.set(-35 + 4 + i * 2.54, top + 0.05, -W / 2 + 2.5);
    g.add(pad);
  }
  // บอร์ด I²C ใต้จอ: แผ่นวงจรน้ำเงิน 41 × 19, PCF8574 (SO-16), ทริมพอตน้ำเงิน, จัมเปอร์ไฟพื้นหลัง
  const bp = new THREE.Mesh(new THREE.BoxGeometry(41, 1.6, 19), mat('lcdI2cPcb', () => new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.55 })));
  bp.position.set(-40 + 41 / 2 + 2, 5.5, LCD_HDR_Z);
  const ic = new THREE.Mesh(new THREE.BoxGeometry(10.3, 2.3, 7.5), mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 })));
  ic.position.set(-12, 5.5 - 0.8 - 1.15, LCD_HDR_Z + 2);
  const pot = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4.5, 6.6), mat('potBlue', () => new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.5 })));
  pot.position.set(-30, 5.5 - 0.8 - 2.25, LCD_HDR_Z + 3);
  g.add(bp, ic, pot);
  // ขาตั้งเลียนแบบหัวต่อ (เสาสองต้นใต้แผ่นวงจร LCD ด้านขวา — แผ่นจริงวางพิงบนบอร์ด I²C)
  const post = mat('lcdPost', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  for (const z of [-12, 12]) { const s = new THREE.Mesh(new THREE.BoxGeometry(3, LCD_PCB_Y, 3), post); s.position.set(36, LCD_PCB_Y / 2, z); g.add(s); }
  // หัวเข็ม 4 ขา (GND VCC SDA SCL) ยื่นออกทางซ้ายของบอร์ด I²C
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 4 * 2.54), mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  hdr.position.set(-40 + 0.5, 4, LCD_HDR_Z);
  g.add(hdr);
  for (const [pin, [x, y, z]] of Object.entries(LCD_PIN_LOCAL)) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.64, 0.64), gold);
    p.position.set(x * 2.54 + 3.25, y * 2.54, z * 2.54);
    p.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x * 2.54 + 1.5, y * 2.54, z * 2.54);
    hit.userData = { pin, isPin: true };
    const lab = decal(textTex(`lcd:p:${pin}`, [pin], 'rgba(240,242,245,0.95)', 128, 64, 40), 3.4, 1.7);
    lab.rotation.x = -Math.PI / 2;
    lab.position.set(-40 - 1, 6.4, z * 2.54);
    g.add(p, hit, lab);
  }
  // ป้ายบนแผ่นวงจร
  const nm = decal(textTex('lcd:name', ['LCD 1602  I²C 0x27/0x3F'], 'rgba(240,242,245,0.9)', 512, 64, 36), 22, 2.75);
  nm.rotation.x = -Math.PI / 2;
  nm.position.set(10, top + 0.02, W / 2 - 2.6);
  g.add(nm);
  // รูยึด 4 มุม
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.8, 20).rotateX(-Math.PI / 2), mat('relRing', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9c27a, metalness: 1, roughness: 0.35 }))));
    ring.position.set(sx * 37.5, top + 0.012, sz * 15.5);
    g.add(ring);
  }
  root.userData.topY = (top + 7) * MM;
  return root;
}

/**
 * จอ LCD 1602 แบบขนาน: หัวเข็ม 16 ขาแถวเดียว (VSS … K) เสียบแถวขอบเบรดบอร์ด แล้ววางราบ ตัวจอยื่นออกด้านหน้า (แบบเดียวกับจอ OLED)
 * ขอบหัวเข็มคือขอบบนของจอ ข้อความจึงตั้งตรงเมื่อมองจากด้านหน้า · แผ่นวงจร 80 × 36 mm ขา 1 ห่างขอบซ้าย 8 mm · ไม่มีโลโก้ผู้ผลิต
 * userData เหมือน buildCharLcd (lcdCanvas / lcdTex / lcdPx / lcdColor) — ฉากใช้ฟังก์ชันวาดเดียวกัน
 */
export function buildCharLcdPar(color: 'blue' | 'green', pins: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const { L, W, viewW, viewH } = LCD1602_DIM;
  const yP = 4.6, T = 1.6, cx = 40 - 8, cz = W / 2 - 2.5;
  const pcb = new THREE.Mesh(new RoundedBoxGeometryLite(L, T, W, 0.4), mat('lcdPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.55 })));
  pcb.position.set(cx, yP + T / 2, cz);
  g.add(pcb);
  const top = yP + T;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(71.2, 7, 24.2), mat('lcdFrame', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.6 }))));
  frame.position.set(cx, top + 3.5, cz + 0.8);
  g.add(frame);
  const PX = 10;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewW * PX); canvas.height = Math.round(viewH * PX);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(viewW, viewH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.set(cx, top + 7.02, cz + 0.8);
  g.add(glass);
  root.userData.lcdCanvas = canvas; root.userData.lcdTex = tex; root.userData.lcdPx = PX; root.userData.lcdColor = color;
  // ป้ายขาบนแผ่นวงจร (ระหว่างหัวเข็มกับกรอบจอ) — ตัวเลขขา 1 และ 16 ที่ปลายทั้งสอง
  pins.forEach((p, i) => {
    const d = decal(textTex(`lcdp:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.rotation.x = -Math.PI / 2;
    d.position.set(i * PITCH, top + 0.02, 2.0);
    g.add(d);
  });
  for (const [txt, x] of [['1', -1.9], ['16', 15 * PITCH + 2.1]] as const) {
    const d = decal(textTex(`lcdp:n:${txt}`, [txt], 'rgba(240,242,245,0.95)', 64, 64, 40), 1.4, 1.4);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, top + 0.02, 0);
    g.add(d);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.8, 20).rotateX(-Math.PI / 2), mat('relRing', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9c27a, metalness: 1, roughness: 0.35 }))));
    ring.position.set(cx + sx * 37.5, top + 0.012, cz + sz * 15.5);
    g.add(ring);
  }
  maleHeader(g, pins, yP, 'lcdp');
  root.userData.topY = (top + 7) * MM;
  return root;
}

/** โมดูล GY-BMP280: แผ่นวงจรม่วงตั้งบนหัวเข็ม 6 ขา (VCC GND SCL SDA CSB SDO) ชิป LGA 2 × 2.5 mm */
export function buildBmp280Module(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'];
  const cx = 2.5 * PITCH, y0 = 3.5, W = 15.5, H = 11.5;
  const zf = standingPcb(g, W, H, 0x6a1b9a, 'bmp', y0, cx);
  const can = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 0.95), mat('bmpCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 }))));
  can.position.set(cx + 2.5, y0 + 7.5, zf + 0.48);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10), mat('bmpHole', () => new THREE.MeshBasicMaterial({ color: 0x111111 })));
  hole.rotation.x = Math.PI / 2; hole.position.set(cx + 3.1, y0 + 7.9, zf + 0.97);
  g.add(can, hole);
  const nm = decal(textTex('bmp:name', ['BMP280'], 'rgba(240,242,245,0.95)', 256, 64, 44), 5.4, 1.35);
  nm.position.set(cx - 3, y0 + 9.8, zf + 0.02);
  g.add(nm);
  pins.forEach((p, i) => {
    const d = decal(textTex(`bmp:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'bmp');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** โมดูล GY-302 (BH1750): แผ่นวงจรน้ำเงินตั้งบนหัวเข็ม 5 ขา (VCC GND SCL SDA ADDR) ชิปวัดแสงด้านหน้า */
export function buildBh1750Module(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'ADDR'];
  const cx = 2 * PITCH, y0 = 3.5, W = 13.9, H = 18.5;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'bh', y0, cx);
  const chip = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 1.0), mat('bhChip', () => new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.25 })));
  chip.position.set(cx, y0 + 13, zf + 0.5);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), mat('bhWin', () => new THREE.MeshStandardMaterial({ color: 0x7a5a2a, roughness: 0.2 })));
  win.position.set(cx, y0 + 13, zf + 1.02);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.6, 1.1), mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 })));
  ldo.position.set(cx - 3.5, y0 + 8, zf + 0.55);
  g.add(chip, win, ldo);
  const nm = decal(textTex('bh:name', ['GY-302'], 'rgba(240,242,245,0.95)', 256, 64, 44), 5.4, 1.35);
  nm.position.set(cx + 2.5, y0 + 6.6, zf + 0.02);
  g.add(nm);
  pins.forEach((p, i) => {
    const d = decal(textTex(`bh:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'bh');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/**
 * โมดูล INA219: แผ่นวงจรม่วง 22.3 × 25.5 mm ตั้งบนหัวเข็ม 6 ขา (VCC GND SCL SDA VIN− VIN+) · ด้านหน้า INA219 (SOIC-8), ตัวต้านทาน shunt 2512 (R100 = 0.1 Ω),
 * เทอร์มินัลสกรู 2 ช่อง (VIN+ / VIN−) ที่ขอบบน · ไม่มีโลโก้ผู้ผลิต
 */
export function buildIna219Module(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'VIN-', 'VIN+'];
  const cx = 2.5 * PITCH, y0 = 3.5, W = 22.3, H = 25.5;
  const zf = standingPcb(g, W, H, 0x5b2a86, 'ina', y0, cx);
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const ic = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.9, 1.5), black);
  ic.position.set(cx - 4.5, y0 + 11, zf + 0.75);
  const shunt = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 0.6), black);
  shunt.position.set(cx + 3.5, y0 + 11, zf + 0.3);
  const capsM = mat('inaTerm', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.3, metalness: 1 })));
  for (const dx of [-3.2, 3.2]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.2, 0.7), capsM);
    c.position.set(cx + 3.5 + dx * 1.05, y0 + 11, zf + 0.35);
    g.add(c);
  }
  // เทอร์มินัลสกรู 2 ช่อง (ระยะ 5.08 mm)
  const term = new THREE.Mesh(new THREE.BoxGeometry(10.2, 7.5, 8), mat('inaBlock', () => new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5 })));
  term.position.set(cx, y0 + H - 4.5, zf + 4);
  g.add(term);
  for (const dx of [-2.54, 2.54]) {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 16), capsM);
    sc.position.set(cx + dx, y0 + H - 0.7, zf + 4.5);
    g.add(sc);
  }
  g.add(ic, shunt);
  const icLab = decal(textTex('ina:ic', ['219'], 'rgba(200,204,208,0.9)', 128, 64, 40), 3, 1.4);
  icLab.position.set(cx - 4.5, y0 + 11, zf + 1.52);
  const shLab = decal(textTex('ina:sh', ['R100'], 'rgba(220,222,226,0.95)', 128, 64, 44), 3.6, 1.6);
  shLab.position.set(cx + 3.5, y0 + 11, zf + 0.62);
  const nm = decal(textTex('ina:name', ['INA219'], 'rgba(240,242,245,0.95)', 256, 64, 44), 6, 1.4);
  nm.position.set(cx, y0 + 6.2, zf + 0.02);
  g.add(icLab, shLab, nm);
  pins.forEach((p, i) => {
    const d = decal(textTex(`ina:p:${p}`, [p.replace('-', '−')], 'rgba(240,242,245,0.95)', 128, 64, 38), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'ina');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** ขนาดจอ 7 ส่วน 4 หลัก 0.36" บนโมดูล TM1637 (mm) */
export const TM1637_DIM = { W: 30, H: 14, PX: 12 };

/**
 * โมดูล TM1637: แผ่นวงจรน้ำเงิน 42 × 24 mm ตั้งบนหัวเข็ม 4 ขา (CLK DIO VCC GND) · จอ 7 ส่วน 4 หลัก 0.36" พร้อมโคลอนกลาง
 * userData.segCanvas / segTex — ฉากวาดส่วนที่ติดจากหน่วยความจำแสดงผลของ TM1637 ที่จำลอง
 */
export function buildTm1637Module(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['CLK', 'DIO', 'VCC', 'GND'];
  const cx = 1.5 * PITCH, y0 = 3.5, W = 42, H = 24;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'tm', y0, cx);
  const D = TM1637_DIM;
  const body = new THREE.Mesh(new THREE.BoxGeometry(D.W + 0.6, D.H + 5, 7), mat('tmBody', () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 })));
  body.position.set(cx, y0 + 14, zf + 3.5);
  g.add(body);
  const canvas = document.createElement('canvas');
  canvas.width = D.W * D.PX; canvas.height = D.H * D.PX;
  { const c2 = canvas.getContext('2d'); if (c2) { c2.fillStyle = '#121214'; c2.fillRect(0, 0, canvas.width, canvas.height); } }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(D.W, D.H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(cx, y0 + 14, zf + 7.02);
  g.add(face);
  root.userData.segCanvas = canvas; root.userData.segTex = tex;
  const ic = new THREE.Mesh(new THREE.BoxGeometry(5, 3.9, 1.5), mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 })));
  ic.position.set(cx + 15, y0 + 4.5, zf + 0.75);
  g.add(ic);
  pins.forEach((p, i) => {
    const d = decal(textTex(`tm:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'tm');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/* ===================== ปุ่มกด 4×4, rotary encoder, จอยสติ๊ก ===================== */

const KP_KEYS = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']];
/** ปุ่มกดเมมเบรน 4×4: แผ่น 69 × 77 mm (กึ่งกลางที่ z = +18 ด้านผู้ใช้) สายแพยื่นไปด้านหลัง หัวเข็ม 8 ขาที่ z = −30 mm (ปลายขาชี้ไปทางบอร์ด −z) */
const KP_HDR_Z = -30;
export const KEYPAD_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(
  ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].map((p, i) => [p, [((i - 3.5) * 2.54) / 2.54, 1.4 / 2.54, (KP_HDR_Z - 5) / 2.54]]),
) as Record<string, [number, number, number]>;

/**
 * ปุ่มกดเมมเบรน 4×4 วางบนโต๊ะ: ปุ่มแต่ละปุ่มเป็น mesh ที่มี userData.keypadKey (แตะค้างในฉาก = กดปุ่มนั้น) · ปุ่มที่กดอยู่ยุบลง
 * สายแพ 8 เส้นออกด้านหลัง (ทางบอร์ด) ปลายเป็นหัวเข็ม R1–R4 C1–C4 (ต่อสายจากหัวเข็ม) · ไม่มีโลโก้ผู้ผลิต
 */
export function buildKeypad(pressed: string): THREE.Group {
  const { root, g } = rootGroups();
  const W = 69, D = 77, zc = 18;
  const base = new THREE.Mesh(new RoundedBoxGeometryLite(W, 0.8, D, 0.35), mat('kpBase', () => new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.7 })));
  base.position.set(0, 0.4, zc);
  g.add(base);
  const pitchX = 17, pitchZ = 17;
  KP_KEYS.forEach((row, r) => row.forEach((k, c) => {
    const letter = /[A-D]/.test(k), sym = /[*#]/.test(k);
    const color = letter ? 0xd23a3a : sym ? 0x3a62d2 : 0x2b6ed6;
    const down = pressed === k;
    const key = new THREE.Mesh(new RoundedBoxGeometryLite(13, down ? 0.3 : 0.9, 13, down ? 0.12 : 0.4), mat(`kpKey${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45 })));
    const x = (c - 1.5) * pitchX, z = zc + (r - 1.5) * pitchZ;
    key.position.set(x, 0.8 + (down ? 0.15 : 0.45), z);
    key.userData.keypadKey = k;
    const lab = decal(textTex(`kp:${k}`, [k], 'rgba(250,250,252,0.97)', 128, 128, 92), 9, 9);
    lab.rotation.x = -Math.PI / 2;
    lab.position.set(x, 0.8 + (down ? 0.33 : 0.93), z);
    lab.userData.keypadKey = k;
    g.add(key, lab);
  }));
  // สายแพ + หัวเข็ม
  const tail = new THREE.Mesh(new THREE.BoxGeometry(21, 0.3, (zc - D / 2) - KP_HDR_Z + 2), mat('kpTail', () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 })));
  tail.position.set(0, 0.15, (zc - D / 2 + KP_HDR_Z) / 2);
  g.add(tail);
  const hdr = new THREE.Mesh(new THREE.BoxGeometry(8 * 2.54, 2.5, 2.5), mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  hdr.position.set(0, 1.4, KP_HDR_Z);
  g.add(hdr);
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (const [pin, [x, y, z]] of Object.entries(KEYPAD_PIN_LOCAL)) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.64, 6), gold);
    p.position.set(x * 2.54, y * 2.54, z * 2.54 + 3);
    p.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x * 2.54, y * 2.54, z * 2.54 + 1.5);
    hit.userData = { pin, isPin: true };
    const lab = decal(textTex(`kp:p:${pin}`, [pin], 'rgba(240,242,245,0.95)', 128, 64, 44), 2.4, 1.2);
    lab.rotation.x = -Math.PI / 2;
    lab.position.set(x * 2.54, 0.33, KP_HDR_Z + 4);
    g.add(p, hit, lab);
  }
  root.userData.topY = 2 * MM;
  return root;
}

/**
 * โมดูล KY-040: แผ่นวงจร 18.5 × 26 mm ตั้งบนหัวเข็ม 5 ขา (CLK DT SW + GND) · ตัว EC11 12 × 12 mm แกนมีลูกบิดชี้ไปด้านหน้า (+z)
 * userData.knob — ฉากหมุนลูกบิดตามจำนวนคลิก (18° ต่อคลิก) และกดลง (SW)
 */
export function buildEncoderModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['CLK', 'DT', 'SW', '+', 'GND'];
  const cx = 2 * PITCH, y0 = 3.5, W = 18.5, H = 26;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'enc', y0, cx);
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 6.5), mat('encBody', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 }))));
  body.position.set(cx, y0 + 15, zf + 3.25);
  g.add(body);
  const knob = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 24).rotateX(Math.PI / 2), mat('encShaft', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd0d3d8, roughness: 0.3, metalness: 1 }))));
  shaft.position.z = 3;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 12, 24).rotateX(Math.PI / 2), mat('encCap', () => new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.55 })));
  cap.position.z = 11;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(1, 5, 0.4), mat('encMark', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 })));
  mark.position.set(0, 3.5, 17.1);
  knob.add(shaft, cap, mark);
  knob.position.set(cx, y0 + 15, zf + 6.5);
  knob.traverse((o) => { o.userData.encKnob = true; });
  g.add(knob);
  root.userData.knob = knob;
  pins.forEach((p, i) => {
    const d = decal(textTex(`enc:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'enc');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/**
 * โมดูล KY-023: แผ่นวงจร 34 × 26 mm ตั้งบนหัวเข็ม 5 ขา (GND +5V VRx VRy SW) · ตัวจอยสติ๊กพร้อมหัวโดมชี้ไปด้านหน้า
 * userData.stick — ฉากเอียงก้านตาม x, y และกดลง (SW)
 */
export function buildJoystickModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['GND', '+5V', 'VRx', 'VRy', 'SW'];
  const cx = 2 * PITCH, y0 = 3.5, W = 26, H = 34;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'js', y0, cx);
  const black = mat('jsBody', () => new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.55 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 9), black);
  body.position.set(cx, y0 + 19, zf + 4.5);
  g.add(body);
  // ตัวปรับค่าสองแกน (ด้านข้าง)
  for (const [dx, dy, w, h] of [[-9.5, 0, 3, 10], [0, -9.5, 10, 3]] as const) {
    const pot = new THREE.Mesh(new THREE.BoxGeometry(w, h, 7), mat('jsPot', () => new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5 })));
    pot.position.set(cx + dx, y0 + 19 + dy, zf + 3.5);
    g.add(pot);
  }
  const stick = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 16).rotateX(Math.PI / 2), black);
  rod.position.z = 4;
  const capGeo = new THREE.SphereGeometry(11, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6).rotateX(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, mat('jsCap', () => new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.75 })));
  cap.position.z = 0;
  const capG = new THREE.Group();
  capG.add(cap);
  capG.position.z = -3;
  stick.add(rod, capG);
  stick.position.set(cx, y0 + 19, zf + 9);
  stick.traverse((o) => { o.userData.jsStick = true; });
  g.add(stick);
  root.userData.stick = stick;
  pins.forEach((p, i) => {
    const d = decal(textTex(`js:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 38), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'js');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/* ===================== PIR HC-SR501, FC-51 ===================== */

/**
 * โมดูล HC-SR501: แผ่นวงจรเขียว 32.3 × 24.3 mm ตั้งบนหัวเข็ม 3 ขา (VCC OUT GND) · เลนส์เฟรสเนลโดมสีขาว Ø 23 mm ด้านหน้า
 * ทริมพอตส้ม 2 ตัว (ความไว Sx, เวลาหน่วง Tx) · โมดูลจริงไม่มี LED แสดงสถานะ — ดูสถานะ OUT ในแผงผล
 */
export function buildPirModule(): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['VCC', 'OUT', 'GND'];
  const cx = PITCH, y0 = 3.5, W = 32.3, H = 24.3;
  const zf = standingPcb(g, W, H, 0x2f7a3a, 'pir', y0, cx);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(11.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2),
    mat('pirDome', () => new THREE.MeshPhysicalMaterial({ color: 0xf6f6f0, roughness: 0.55, transmission: 0.15, thickness: 1 })));
  dome.position.set(cx, y0 + H / 2 + 1, zf + 0.5);
  const ring = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 1.2), mat('pirRing', () => new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 0.6 })));
  ring.position.set(cx, y0 + H / 2 + 1, zf + 0.6);
  g.add(ring, dome);
  const orange = mat('pirPot', () => new THREE.MeshStandardMaterial({ color: 0xe8862a, roughness: 0.5 }));
  for (const dx of [-12, 12]) { const pot = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.4, 20).rotateX(Math.PI / 2), orange); pot.position.set(cx + dx, y0 + 4, zf + 1.2); g.add(pot); }
  pins.forEach((p, i) => {
    const d = decal(textTex(`pir:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 1.6, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'pir');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/**
 * โมดูล FC-51: แผ่นวงจรน้ำเงิน 14 × 31 mm ตั้งบนหัวเข็ม 3 ขา (OUT GND VCC) · LED อินฟราเรดใส + โฟโตไดโอดดำที่ขอบบน ชี้ไปด้านหน้า
 * ทริมพอตน้ำเงิน, LM393 · userData.obsLed — LED แสดงการพบวัตถุบนโมดูล (ติดเมื่อ OUT ต่ำ)
 */
export function buildIrObstacleModule(distanceCm = 100, surface: 'white' | 'black' = 'white'): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['OUT', 'GND', 'VCC'];
  const cx = PITCH, y0 = 3.5, W = 14, H = 31;
  const zf = standingPcb(g, W, H, 0x1d3f8a, 'fc51', y0, cx);
  const clear = mat('fcIrLed', () => new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, roughness: 0.1, transmission: 0.6, thickness: 1 }));
  const black = mat('fcPd', () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3 }));
  for (const [dx, m] of [[-3.2, clear], [3.2, black]] as const) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6, 20).rotateX(Math.PI / 2), m);
    body.position.set(cx + dx, y0 + H - 3, zf + 4);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), m);
    cap.position.set(cx + dx, y0 + H - 3, zf + 7);
    g.add(body, cap);
  }
  const pot = new THREE.Mesh(new THREE.BoxGeometry(6.6, 6.6, 4.5), mat('fcPot', () => new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5 })));
  pot.position.set(cx, y0 + 15, zf + 2.25);
  const ic = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.9, 1.5), mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 })));
  ic.position.set(cx, y0 + 8, zf + 0.75);
  g.add(pot, ic);
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), mat('fcLed', () => new THREE.MeshStandardMaterial({ color: 0x115511, emissive: 0x22ff44, emissiveIntensity: 0, roughness: 0.4 })).clone());
  led.position.set(cx + 4.5, y0 + 21, zf + 0.4);
  g.add(led);
  root.userData.obsLed = led.material;
  // วัตถุทดสอบหน้าเซนเซอร์ (แผ่น 24 × 18 × 3 mm) ที่ระยะตามแผง — แสดงเมื่อไม่เกิน 40 cm
  if (distanceCm <= 40) {
    const obj = new THREE.Mesh(new THREE.BoxGeometry(24, 18, 3), mat(`fcObj${surface}`, () => new THREE.MeshStandardMaterial({ color: surface === 'white' ? 0xf2f2ee : 0x1c1c1e, roughness: 0.7 })));
    obj.position.set(cx, y0 + H - 3, zf + 7 + distanceCm * 10 + 1.5);
    obj.userData.noPick = true;
    g.add(obj);
  }
  pins.forEach((p, i) => {
    const d = decal(textTex(`fc:p:${p}`, [p], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y0 + 2.2, zf + 0.02);
    g.add(d);
  });
  maleHeader(g, pins, y0 + 0.5, 'fc51');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/* ======================= Arduino Nano (ATmega328P) ======================= */

/**
 * Arduino Nano เสียบเบรดบอร์ด: PCB 18 × 43.18 mm หนา 1.6 mm บนพลาสติกหัวเข็ม 2.5 mm · หัวเข็มตัวผู้ 2 แถว × 15 ขา ระยะแถว 15.24 mm (0.6")
 * จุดกำเนิด = ขา 1 (D1/TX), +x ไปทางขา 15 (D12, ฝั่ง Mini-USB), ขา 16–30 ที่ z = −15.24 (ขา 30 ตรงข้ามขา 1)
 * ตำแหน่งชิปและชิ้นส่วนบนผิวบน (ATmega328P TQFP-32 เอียง 45°, ปุ่ม RESET, LED TX/RX/L/PWR, เรโซเนเตอร์ 16 MHz, แผ่น ICSP 2×3)
 * เป็นค่าประมาณจากภาพบอร์ด — ไม่มีผลต่อการต่อวงจร · ไม่ใส่โลโก้ผู้ผลิต (ป้ายบนบอร์ดมีเฉพาะชื่อขา)
 * userData.picoLed / picoGlow = LED L (สว่างตามสถานะ D13)
 */
export function buildNanoModel(names: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const L = 43.18, W = 18, T = 1.6, y0 = 2.5, cx = 7 * PITCH, cz = -7.62;
  const top = y0 + T;
  const pcbMat = mat('nanoPcb', () => new THREE.MeshStandardMaterial({ color: 0x0b5c9e, roughness: 0.48 }));
  const edge = mat('nanoEdge', () => new THREE.MeshStandardMaterial({ color: 0x8fa3a0, roughness: 0.8 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [edge, edge, pcbMat, pcbMat, edge, edge]);
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const metal = mat('nanoMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  // Mini-USB B (ยื่นพ้นขอบฝั่งขา 15/16 ราว 1.5 mm)
  const usb = new THREE.Mesh(new THREE.BoxGeometry(9.2, 3.9, 7.7), metal);
  usb.position.set(cx + L / 2 - 9.2 / 2 + 1.5, top + 1.95, cz);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 6.2), black);
  mouth.position.set(cx + L / 2 + 1.52, top + 1.95, cz);
  g.add(usb, mouth);
  // ATmega328P TQFP-32: ตัว 7 × 7 × 1.0 mm เอียง 45° + ขา 8 ขาต่อด้าน ระยะ 0.8 mm
  const mcuG = new THREE.Group();
  mcuG.position.set(cx - 1.0, top, cz);
  mcuG.rotation.y = Math.PI / 4;
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 1.0, 7), black);
  body.position.y = 0.6;
  mcuG.add(body);
  const legGeo = new THREE.BoxGeometry(1.0, 0.15, 0.37);
  for (let side = 0; side < 4; side++) for (let k = 0; k < 8; k++) {
    const leg = new THREE.Mesh(legGeo, metal);
    const off = (k - 3.5) * 0.8;
    const a = side * Math.PI / 2;
    leg.position.set(Math.cos(a) * 4.0 - Math.sin(a) * off, 0.1, Math.sin(a) * 4.0 + Math.cos(a) * off);
    leg.rotation.y = -a;
    mcuG.add(leg);
  }
  const mark = decal(textTex('nano:mcu', ['ATMEGA328P', 'AU'], 'rgba(205,208,212,0.9)', 256, 128, 40), 5.6, 2.8);
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 1.11;
  mcuG.add(mark);
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 12), mat('nanoDot', () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9 })));
  dot.position.set(-2.6, 1.12, -2.6);
  mcuG.add(dot);
  g.add(mcuG);
  // ปุ่ม RESET (ฐานโลหะ + ปุ่มพลาสติก) ระหว่างชิปกับ LED
  const rb = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.4, 4.4), metal);
  rb.position.set(cx - 9.0, top + 0.7, cz);
  const rc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.9, 16), mat('nanoBtn', () => new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.5 })));
  rc.position.set(cx - 9.0, top + 1.85, cz);
  g.add(rb, rc);
  // เรโซเนเตอร์ 16 MHz + ตัวเก็บประจุ/ตัวต้านทานเล็ก
  const res = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.3), mat('nanoRes', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.4, metalness: 0.8 }))));
  res.position.set(cx + 5.6, top + 0.45, cz - 4.8);
  g.add(res);
  const capM = mat('nanoCap', () => new THREE.MeshStandardMaterial({ color: 0xa88d66, roughness: 0.6 }));
  for (const [x, z] of [[4.8, -2.4], [4.8, 2.6], [-5.4, 4.6], [-5.4, -4.6], [8.6, 3.6], [8.6, -1.2]] as const) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.8), capM);
    c.position.set(cx + x, top + 0.3, cz + z);
    g.add(c);
  }
  // LED: TX RX (ส้มดับ), L (D13), PWR (ติดเมื่อมีไฟ) — แถวเดียวกันใกล้ฝั่งขา 1
  const ledL = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.4 });
  const ledOff = mat('unoLedOff', () => new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.4 }));
  const ledOn = mat('nanoLedPwr', () => new THREE.MeshStandardMaterial({ color: 0x8fd0ff, emissive: 0x3a8cff, emissiveIntensity: 1.4, roughness: 0.4 }));
  const ledX = cx - 14.6;
  const leds: Array<[number, THREE.Material, string]> = [[-4.2, ledOff, 'TX'], [-1.4, ledOff, 'RX'], [1.4, ledOn, 'PWR'], [4.2, ledL, 'L']];
  for (const [dz, m, t] of leds) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.6, 2.0), m);
    l.position.set(ledX, top + 0.3, cz + dz);
    const tl = decal(textTex(`nano:led:${t}`, [t], 'rgba(240,243,245,0.95)', 128, 64, 40), 2.4, 1.2);
    tl.rotation.x = -Math.PI / 2; tl.rotation.z = Math.PI / 2;
    tl.position.set(ledX + 1.9, top + 0.02, cz + dz);
    g.add(l, tl);
  }
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffb02e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(ledX, top + 1.4, cz + 4.2);
  glow.scale.set(6, 6, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  // แผ่น ICSP 2×3 (ฝั่งขา 1) — ไม่บัดกรีหัวเข็ม
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.28, 6, 14), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-1.27 + i * 2.54 - 0.6, top + 0.02, cz + (j - 1) * 2.54);
    g.add(ring);
  }
  const icsp = decal(textTex('nano:icsp', ['ICSP'], 'rgba(240,243,245,0.95)', 128, 64, 40), 3.2, 1.6);
  icsp.rotation.x = -Math.PI / 2; icsp.rotation.z = Math.PI / 2;
  icsp.position.set(1.9, top + 0.02, cz);
  g.add(icsp);
  // หัวเข็มตัวผู้ 2 แถว: พลาสติกดำใต้บอร์ด + ขาโลหะลงรู + วงทองบนบอร์ด + ป้ายชื่อขาด้านใน
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const short = (n: string) => ({ D1: 'TX1', D0: 'RX0' } as Record<string, string>)[n] ?? n.replace(/\.\d$/, '');
  for (const [z, from] of [[0, 0], [-15.24, 15]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(15 * PITCH, y0, 2.5), hdr);
    base.position.set(cx, y0 / 2, z);
    g.add(base);
    for (let k = 0; k < 15; k++) {
      const name = names[from + k];
      const x = from === 0 ? k * PITCH : (14 - k) * PITCH;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, top + 0.02, z);
      const t = decal(textTex(`nano:pin:${short(name)}`, [short(name)], 'rgba(240,243,245,0.96)', 128, 64, 42), 2.3, 1.15);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(x, top + 0.02, z + (from === 0 ? -2.3 : 2.3));
      g.add(ring, t);
      g.add(flatLead([V(x, top + 1.0, z), V(x, 0, z)], 0.64, 0.64, name));
    }
  }
  root.userData.picoLed = ledL;
  root.userData.picoGlow = glow;
  root.userData.topY = (top + 3.9) * MM;
  return root;
}

/* ======================= Arduino Pro Mini 328 ======================= */

/** ความสูงปลายขาด้านบน (A4–A7) เหนือผิวเบรดบอร์ด (mm): พลาสติกหัวเข็ม 2.5 + PCB 0.8 + พลาสติก 2.5 + เข็ม 6 */
export const PROMINI_TOP_PIN_MM = 2.5 + 0.8 + 2.5 + 6;

/**
 * Arduino Pro Mini 328 เสียบเบรดบอร์ด: PCB 33.02 × 17.78 mm หนา 0.8 mm บนพลาสติกหัวเข็ม 2.5 mm · ขาสองแถว × 12 ขา ระยะแถว 15.24 mm
 * จุดกำเนิด = ขา TXO (D1), +x ไปทาง D9, แถว RAW…D10 ที่ z = −15.24 · ตำแหน่งขา/หัว 6 ขา/รู A4–A7 ตาม footprint ของ KiCad Library for Arduino
 * ชิ้นส่วนบนผิวบน (ATmega328P TQFP-32, เรโซเนเตอร์, เรกูเลเตอร์ SOT-23-5, ปุ่ม RESET, LED PWR/L) เป็นค่าประมาณ — ไม่มีผลต่อวงจร · ไม่มีโลโก้
 * ตัวแปลง USB-serial (แบบทั่วไป ไม่มียี่ห้อ) เสียบหัว 6 ขาไว้ — แสดงสมมติฐานของตัวจำลอง (ไฟ VCC + Serial มาจากตัวแปลงนี้)
 * userData.picoLed / picoGlow = LED L (D13)
 */
export function buildProMini(names: string[], volt: 5 | 3.3): THREE.Group {
  const { root, g } = rootGroups();
  const L = 33.02, W = 17.78, T = 0.8, y0 = 2.5, cx = 12.7, cz = -7.62;
  const top = y0 + T;
  const pcbMat = mat('pminiPcb', () => new THREE.MeshStandardMaterial({ color: 0x0d5a8f, roughness: 0.5 }));
  const edge = mat('nanoEdge', () => new THREE.MeshStandardMaterial({ color: 0x8fa3a0, roughness: 0.8 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [edge, edge, pcbMat, pcbMat, edge, edge]);
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const metal = mat('nanoMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const silk = 'rgba(240,243,245,0.96)';
  // ATmega328P TQFP-32 เอียง 45°
  const mcuG = new THREE.Group();
  mcuG.position.set(cx + 1.6, top, cz);
  mcuG.rotation.y = Math.PI / 4;
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 1.0, 7), black);
  body.position.y = 0.6;
  mcuG.add(body);
  const legGeo = new THREE.BoxGeometry(1.0, 0.15, 0.37);
  for (let side = 0; side < 4; side++) for (let k = 0; k < 8; k++) {
    const leg = new THREE.Mesh(legGeo, metal);
    const off = (k - 3.5) * 0.8;
    const a = side * Math.PI / 2;
    leg.position.set(Math.cos(a) * 4.0 - Math.sin(a) * off, 0.1, Math.sin(a) * 4.0 + Math.cos(a) * off);
    leg.rotation.y = -a;
    mcuG.add(leg);
  }
  const mark = decal(textTex('nano:mcu', ['ATMEGA328P', 'AU'], 'rgba(205,208,212,0.9)', 256, 128, 40), 5.6, 2.8);
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 1.11;
  mcuG.add(mark);
  g.add(mcuG);
  // เรโซเนเตอร์ (16 MHz รุ่น 5 V · 8 MHz รุ่น 3.3 V)
  const res = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.3), mat('nanoRes', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.4, metalness: 0.8 }))));
  res.position.set(cx + 8.2, top + 0.45, cz + 3.6);
  g.add(res);
  // เรกูเลเตอร์ SOT-23-5 ใกล้ขา RAW + ตัวเก็บประจุ
  const reg = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.1, 1.6), black);
  reg.position.set(3.4, top + 0.55, -11.6);
  g.add(reg);
  const capM = mat('nanoCap', () => new THREE.MeshStandardMaterial({ color: 0xa88d66, roughness: 0.6 }));
  for (const [x, z] of [[3.4, -9.0], [6.4, -11.6], [7.0, -3.6], [19.4, -12.2]] as const) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.8), capM);
    c.position.set(x, top + 0.3, z);
    g.add(c);
  }
  // ปุ่ม RESET แบบ SMD
  const rb = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 4.0), metal);
  rb.position.set(4.2, top + 0.5, -4.0);
  const rc = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.2), mat('nanoBtn', () => new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.5 })));
  rc.position.set(4.2, top + 1.3, -4.0);
  g.add(rb, rc);
  // LED PWR (ติดเมื่อมีไฟ) และ L (D13)
  const ledL = new THREE.MeshStandardMaterial({ color: 0x9ff0a8, emissive: 0x20d040, emissiveIntensity: 0, roughness: 0.4 });
  const ledPwr = mat('pminiLedPwr', () => new THREE.MeshStandardMaterial({ color: 0xff9a8a, emissive: 0xff2a10, emissiveIntensity: 1.3, roughness: 0.4 }));
  const ledX = 24.6;
  for (const [dz, m, t] of [[-11.8, ledPwr, 'PWR'], [-3.4, ledL, 'L']] as const) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.6, 2.0), m);
    l.position.set(ledX, top + 0.3, dz);
    const tl = decal(textTex(`nano:led:${t}`, [t], silk, 128, 64, 40), 2.4, 1.2);
    tl.rotation.x = -Math.PI / 2; tl.rotation.z = Math.PI / 2;
    tl.position.set(ledX + 1.9, top + 0.02, dz);
    g.add(l, tl);
  }
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0x40ff60, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(ledX, top + 1.4, -3.4);
  glow.scale.set(6, 6, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  // ป้ายรุ่นแรงดัน/ความถี่ (ข้อความทั่วไป ไม่ใช่โลโก้)
  const vt = volt === 5 ? '5V 16MHz' : '3V3 8MHz';
  const vlab = decal(textTex(`pmini:v:${vt}`, [vt], silk, 256, 64, 40), 7.2, 1.8);
  vlab.rotation.x = -Math.PI / 2; vlab.rotation.z = Math.PI / 2;
  vlab.position.set(cx + 8.4, top + 0.02, cz - 3.2);
  g.add(vlab);
  // หัวเข็มสองแถว (ใต้บอร์ด → ลงรู) + วงทอง + ป้ายชื่อขาด้านใน
  const short = (n: string) => ({ D1: 'TXO', D0: 'RXI' } as Record<string, string>)[n] ?? n.replace(/\.\d$/, '');
  for (const [z, from] of [[0, 0], [-15.24, 12]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(12 * PITCH, y0, 2.5), hdr);
    base.position.set(5.5 * PITCH, y0 / 2, z);
    g.add(base);
    for (let k = 0; k < 12; k++) {
      const name = names[from + k];
      const x = k * PITCH;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, top + 0.02, z);
      const t = decal(textTex(`nano:pin:${short(name)}`, [short(name)], silk, 128, 64, 42), 2.3, 1.15);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(x, top + 0.02, z + (from === 0 ? -2.3 : 2.3));
      g.add(ring, t);
      g.add(flatLead([V(x, top + 1.0, z), V(x, 0, z)], 0.64, 0.64, name));
    }
  }
  // รูภายใน A4–A7: หัวเข็มตั้งขึ้น (ต่อสายจัมเปอร์ตัวเมียที่ปลายเข็ม)
  const tipY = PROMINI_TOP_PIN_MM;
  const tops: Array<[string, number, number]> = [['A5', 3.453, -4.848], ['A4', 4.453, -4.848], ['A7', 7.553, -4.848], ['A6', 8.553, -4.848]];
  for (const [name, dx, dy] of tops) {
    const x = dx * PITCH, z = dy * PITCH;
    const pb = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), hdr);
    pb.position.set(x, top + 1.25, z);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.64, tipY - top, 0.64), gold);
    pin.position.set(x, (top + tipY) / 2, z);
    pin.userData.leadTip = name;
    const t = decal(textTex(`nano:pin:${name}`, [name], silk, 128, 64, 42), 2.3, 1.15);
    t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
    t.position.set(x, top + 0.02, z - 2.2);
    g.add(pb, pin, t);
  }
  // หัว 6 ขาแบบงอฉาก (BLK GND VCC RXI TXO GRN) + ตัวแปลง USB-serial ที่เสียบอยู่
  const ftdi = ['BLK', 'GND', 'VCC', 'RXI', 'TXO', 'GRN'];
  const hy = top + 1.27;
  ftdi.forEach((n, i) => {
    const z = -(([-6.35, -3.81, -1.27, 1.27, 3.81, 6.35][i]) + 7.62);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.27 + 0.6, 0.64), gold);
    v.position.set(-2.54, top + 0.5, z);
    const hpin = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.64, 0.64), gold);
    hpin.position.set(-2.54 - 3.2, hy, z);
    const t = decal(textTex(`pmini:ftdi:${n}`, [n], silk, 128, 64, 40), 2.2, 1.1);
    t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
    t.position.set(-0.4, top + 0.02, z);
    g.add(v, hpin, t);
  });
  const rab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 15.24), hdr);
  rab.position.set(-4.2, hy, cz);
  g.add(rab);
  // ตัวแปลง USB-serial แบบทั่วไป: หัวตัวเมีย 6 ขา + PCB 18 × 16 mm + ชิปแปลง + หัว USB
  const ad = new THREE.Group();
  const adPcb = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 16.5), [edge, edge, mat('pminiAdapter', () => new THREE.MeshStandardMaterial({ color: 0x6d1f2a, roughness: 0.5 })), edge, edge, edge]);
  adPcb.position.set(-19.6, hy - 1.6, cz);
  const fem = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 15.4), hdr);
  fem.position.set(-9.4, hy, cz);
  const chip = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.2, 5.0), black);
  chip.position.set(-17.5, hy - 0.4, cz);
  const usb = new THREE.Mesh(new THREE.BoxGeometry(6.0, 3.0, 7.8), metal);
  usb.position.set(-27.0, hy - 0.4, cz);
  const lab = decal(textTex(`pmini:ad:${volt}`, ['USB-SERIAL', volt === 5 ? '5V' : '3V3'], silk, 256, 128, 44), 7.6, 3.8);
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2;
  lab.position.set(-22.6, hy - 0.98, cz);
  ad.add(adPcb, fem, chip, usb, lab);
  g.add(ad);
  root.userData.picoLed = ledL;
  root.userData.picoGlow = glow;
  root.userData.topY = tipY * MM;
  return root;
}

/* ======================= เครื่องวิเคราะห์ลอจิก USB 8 ช่อง ======================= */

/**
 * โมดูลวิเคราะห์ลอจิก USB 8 ช่องแบบทั่วไป (กล่องอะลูมิเนียม ≈ 50 × 26 × 12 mm, หัวต่อ Mini-USB ด้านหลัง)
 * หัวเข็ม 9 ขาบนฝาด้านหน้า (CH0–CH7, GND) ระยะ 2.54 mm · ไม่มีโลโก้ยี่ห้อ — ป้ายบนฝาเป็นข้อความทั่วไป
 * ตำแหน่งขา (หน่วยรู ก่อนหมุน): x = ลำดับขา − 4, ปลายเข็มสูง 19.5 mm, z = +3.5 (ฝั่งผู้ใช้)
 */
export const LA_PINS = ['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'GND'];
export const LA_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(LA_PINS.map((n, k) => [n, [k - 4, 19.5 / 2.54, 3.5]]));

export function buildLogicAnalyzer(): THREE.Group {
  const { root, g } = rootGroups();
  const L = 50, W = 26, H = 12;
  const body = new THREE.Mesh(new RoundedBoxGeometryLite(L, H, W, 1.6), mat('laBody', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.45, metalness: 0.6 }))));
  body.position.y = H / 2;
  g.add(body);
  // ฝาบน: แผ่นป้ายพิมพ์
  const top = decal(textTex('la:top', ['LOGIC ANALYZER', '8 CH · 24 MHz · USB'], 'rgba(235,238,242,0.92)', 512, 192, 64), 30, 11.2);
  top.rotation.x = -Math.PI / 2;
  top.position.set(-4, H + 0.02, -5.5);
  g.add(top);
  // ฐานหัวเข็ม + เข็ม 9 ขา + ชื่อขา
  const base = new THREE.Mesh(new THREE.BoxGeometry(9 * PITCH, 2.5, 2.5), mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })));
  base.position.set(0, H + 1.25, 3.5 * PITCH);
  g.add(base);
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  for (const pin of LA_PINS) {
    const [x, y, z] = LA_PIN_LOCAL[pin];
    const h0 = H, h1 = y * 2.54;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, h1 - h0, 0.64), gold);
    p.position.set(x * PITCH, (h0 + h1) / 2, z * PITCH);
    p.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x * PITCH, h1 - 1.5, z * PITCH);
    hit.userData = { pin, isPin: true };
    const txt = pin === 'GND' ? 'G' : pin.slice(2);
    const t = decal(textTex(`la:pin:${txt}`, [txt], pin === 'GND' ? 'rgba(255,214,120,0.95)' : 'rgba(235,238,242,0.95)', 128, 128, 96), 2.1, 2.1);
    t.rotation.x = -Math.PI / 2;
    t.position.set(x * PITCH, H + 0.02, z * PITCH - 3.0);
    g.add(p, hit, t);
  }
  const chTxt = decal(textTex('la:chs', ['CH0 … CH7 · GND'], 'rgba(235,238,242,0.85)', 512, 64, 44), 14, 1.75);
  chTxt.rotation.x = -Math.PI / 2;
  chTxt.position.set(0, H + 0.02, 3.5 * PITCH + 2.6);
  g.add(chTxt);
  // Mini-USB ด้านหลัง + สาย USB ออกไปทางหลังโต๊ะ + LED ไฟเลี้ยง
  const usb = new THREE.Mesh(new THREE.BoxGeometry(7.7, 3.9, 2.0), mat('laUsb', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 1 }))));
  usb.position.set(0, 5, -W / 2 - 1.0);
  const plug = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 14), mat('laPlug', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55 })));
  plug.position.set(0, 5, -W / 2 - 9);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 8, 12).rotateX(Math.PI / 2), mat('laCable', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6 })));
  cable.position.set(0, 3.5, -W / 2 - 20);
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12), mat('laLed', () => new THREE.MeshStandardMaterial({ color: 0x7dff9a, emissive: 0x22cc44, emissiveIntensity: 1.2, roughness: 0.4 })));
  led.position.set(L / 2 - 5, H + 0.2, -W / 2 + 5);
  g.add(usb, plug, cable, led);
  root.userData.topY = (H + 8) * MM;
  return root;
}

/* ======================= Arduino UNO Q ======================= */

/** ความสูงผิวบน PCB ของ UNO Q (mm จากพื้นโต๊ะ): บอร์ดวางบนหัวต่อ JMISC/JMEDIA ด้านล่างที่ยื่นลง 5 mm ใต้ PCB หนา 1.0 mm (STEP ของผู้ผลิต) */
export const UNOQ_PCB_TOP = 6.0;
/** หัวต่อตัวเมียสูง 8.5 mm เหนือผิว PCB */
const UNOQ_HDR_H = 8.5;
/**
 * ตำแหน่งขาของ UNO Q (mm: x จากขอบ USB-C, แถว top/bot) — ตรวจกับพิกัดแพดในไฟล์ IPC-356 ของผู้ผลิต (tests/board-cad.test.ts)
 * ขา BOOT อยู่ตำแหน่ง NC ของ Uno R3 (หัวต่อไฟ 8 ขา: BOOT IOREF RESET 3V3 5V GND GND VIN)
 */
export const UNOQ_HDR: Record<string, [number, 'top' | 'bot']> = { ...UNO_HDR, BOOT: [27.94, 'bot'] };
export const UNOQ_PIN_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(UNOQ_HDR).map(([n, [x, row]]) =>
  [n, [unoX(x) / 2.54, (UNOQ_PCB_TOP + UNOQ_HDR_H) / 2.54, unoZ(row === 'top' ? 2.54 : UNO_D - 2.54) / 2.54]]));

/**
 * Arduino UNO Q (ABX00162/ABX00173) — โมเดลจากไฟล์ CAD ของผู้ผลิต (src/assets/models/unoq.glb, CC BY-SA 4.0):
 * รูปร่าง/ความหนา/รูยึดจาก STEP, ลายทองแดง แพด และมาสก์จาก Gerber, ตำแหน่งชิ้นส่วนทุกชิ้นจาก IPC-356 · ไม่มีโลโก้ผู้ผลิต
 * ฟังก์ชันนี้สร้างจุดต่อสาย (ตำแหน่งขาจริง) + ภาพแทนอย่างง่ายระหว่างโหลดไฟล์ GLB
 */
export function buildUnoQ(): THREE.Group {
  const { root, g } = rootGroups();
  const top = UNOQ_PCB_TOP;
  // ภาพแทนระหว่างโหลด: แผ่นบอร์ด + หัวต่อ (ซ่อนเมื่อโมเดลจริงพร้อม)
  const ph = new THREE.Group();
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(UNO_W, 1.0, UNO_D), mat('unoqPh', () => new THREE.MeshStandardMaterial({ color: 0x0a2236, roughness: 0.6 })));
  pcb.position.set(unoX(UNO_W / 2), top - 0.5, 0);
  ph.add(pcb);
  const hdrMat = mat('unoHdr', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55 }));
  for (const [a, b2] of [['SCL', 'D8'], ['D7', 'D0'], ['BOOT', 'VIN'], ['A0', 'A5']] as Array<[string, string]>) {
    const [xa, row] = UNOQ_HDR[a], [xb] = UNOQ_HDR[b2];
    const hm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(xb - xa) + 2.54, UNOQ_HDR_H, 2.54), hdrMat);
    hm.position.set(unoX((xa + xb) / 2), top + UNOQ_HDR_H / 2, unoZ(row === 'top' ? 2.54 : UNO_D - 2.54));
    ph.add(hm);
  }
  g.add(ph);
  attachGlb(g, UNOQ_GLB_URL, new THREE.Vector3(unoX(0), top, unoZ(0)), ph);
  // จุดต่อสาย: ปลายขา (รูบนหัวต่อ) + กล่องรับการแตะ
  for (const [n, [mx, row]] of Object.entries(UNOQ_HDR)) {
    const zt = row === 'top' ? 2.54 : UNO_D - 2.54;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    tip.position.set(unoX(mx), top + UNOQ_HDR_H, unoZ(zt));
    tip.userData.leadTip = n;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(unoX(mx), top + UNOQ_HDR_H - 0.8, unoZ(zt));
    hit.userData = { pin: n, isPin: true };
    g.add(tip, hit);
  }
  root.userData.topY = (top + UNOQ_HDR_H + 1.5) / 2.54;
  return root;
}

/* ======================= ปุ่มติดแผง (อาร์เคด 24 mm / 16 mm) ======================= */

const BTN_COLORS: Record<string, number> = { red: 0xd32f2f, green: 0x2e9d43, blue: 0x1e63c8, yellow: 0xf2c218, white: 0xf2f2ee, black: 0x202022 };
/** ปลายขั้ว (หน่วยรู) ของปุ่มติดแผง — ขั้วหันมาด้านหน้า (+z) ใต้แผ่นยึด */
export const ARCADE_PIN_LOCAL: Record<string, [number, number, number]> = { COM: [-7 / 2.54, 9 / 2.54, 13 / 2.54], NO: [0, 9 / 2.54, 13 / 2.54], NC: [7 / 2.54, 9 / 2.54, 13 / 2.54] };
export const PB16_PIN_LOCAL: Record<string, [number, number, number]> = { '1': [-3.5 / 2.54, 7 / 2.54, 10 / 2.54], '2': [3.5 / 2.54, 7 / 2.54, 10 / 2.54] };

function panelButton(g: THREE.Group, o: { plate: number; postH: number; bezel: number; cap: number; capH: number; color: string; pressed: boolean; key: string }) {
  const metalDark = mat('pbPost', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 })));
  const plate = new THREE.Mesh(new THREE.BoxGeometry(o.plate, 2, o.plate), mat('pbPlate', () => new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7 })));
  plate.position.y = o.postH + 1;
  g.add(plate);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, o.postH, 12), metalDark);
    post.position.set(sx * (o.plate / 2 - 3), o.postH / 2, sz * (o.plate / 2 - 3));
    g.add(post);
  }
  const col = BTN_COLORS[o.color] ?? 0xd32f2f;
  const bez = new THREE.Mesh(new THREE.CylinderGeometry(o.bezel / 2, o.bezel / 2, 2.5, 40), mat(`pbBezel${o.color}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 })));
  bez.position.y = o.postH + 2 + 1.25;
  const capY = o.postH + 2 + 2.5 + o.capH / 2 - (o.pressed ? o.capH * 0.55 : 0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(o.cap / 2, o.cap / 2 * 1.02, o.capH, 40), mat(`pbCap${o.color}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.3 })));
  cap.position.y = capY;
  cap.userData.pushPlunger = true;
  g.add(bez, cap);
  // ตัวเรือนใต้แผ่น + น็อตยึด
  const body = new THREE.Mesh(new THREE.CylinderGeometry(o.bezel * 0.38, o.bezel * 0.38, o.postH - 5, 24), mat('pbBody', () => new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6 })));
  body.position.y = 5 + (o.postH - 5) / 2;
  g.add(body);
}

function panelLug(g: THREE.Group, pin: string, x: number, y: number, z: number, label: string) {
  const lug = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 6), tin());
  lug.position.set(x, y, z - 3);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.8), tin());
  tip.position.set(x, y + 0.3, z);
  tip.userData.leadTip = pin;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3.2), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(x, y, z);
  hit.userData = { pin, isPin: true };
  const d = decal(textTex(`lug:${label}`, [label], 'rgba(30,34,38,0.95)', 128, 64, 44), 4, 2);
  d.rotation.x = -Math.PI / 2;
  d.position.set(x, y + 0.3, z - 6.4);
  g.add(lug, tip, hit, d);
}

/** ปุ่มอาร์เคด 24 mm บนแผ่นยึดตัวอย่าง 40 × 40 mm (เสา 20 mm) · ไมโครสวิตช์ใต้แผ่น ขั้ว COM / NO / NC หันมาด้านหน้า */
export function buildArcadeButton(color: string, pressed: boolean): THREE.Group {
  const { root, g } = rootGroups();
  panelButton(g, { plate: 40, postH: 20, bezel: 30, cap: 22, capH: 6, color, pressed, key: 'arc' });
  const sw = new THREE.Mesh(new THREE.BoxGeometry(20, 6.5, 10.3), mat('microSw', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 })));
  sw.position.set(0, 9, 4);
  g.add(sw);
  for (const pin of ['COM', 'NO', 'NC'] as const) { const [x, y, z] = ARCADE_PIN_LOCAL[pin]; panelLug(g, pin, x * 2.54, y * 2.54, z * 2.54, pin); }
  root.userData.topY = 34 * MM;
  return root;
}

/** ปุ่มกด 16 mm บนแผ่นยึดตัวอย่าง 30 × 30 mm (เสา 16 mm) · ขั้วบัดกรี 2 ขั้วหันมาด้านหน้า */
export function buildPushButton16(color: string, pressed: boolean): THREE.Group {
  const { root, g } = rootGroups();
  panelButton(g, { plate: 30, postH: 16, bezel: 19, cap: 12, capH: 4, color, pressed, key: 'p16' });
  for (const pin of ['1', '2'] as const) { const [x, y, z] = PB16_PIN_LOCAL[pin]; panelLug(g, pin, x * 2.54, y * 2.54, z * 2.54, pin); }
  root.userData.topY = 26 * MM;
  return root;
}

/* ======================= อะแดปเตอร์ 5 V 3 A + แจ็ก DC ======================= */

export const ADAPTER_PIN_LOCAL: Record<string, [number, number, number]> = { '+': [-2.5 / 2.54, 12.5 / 2.54, 14 / 2.54], '-': [2.5 / 2.54, 12.5 / 2.54, 14 / 2.54] };

/** ตัวแปลงไฟ (ด้านหลัง) → สาย → แจ็ก DC 5.5 × 2.1 ตัวเมียแบบขั้วต่อสกรู (ด้านหน้า) · ฉลากบอกพิกัด · ไม่มีโลโก้ผู้ผลิต */
export function buildDcAdapter(plugged: boolean): THREE.Group {
  const { root, g } = rootGroups();
  const black = mat('adpBody', () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.55 }));
  const brick = new THREE.Mesh(new RoundedBoxGeometryLite(44, 30, 56, 4), black);
  brick.position.set(0, 15, -40);
  g.add(brick);
  const lab = decal(textTex('adp:lab', ['INPUT 100–240V~', 'OUTPUT 5V ⎓ 3A', '(+)–◯–(−)  5.5×2.1'], 'rgba(220,224,228,0.95)', 512, 320, 64), 36, 22);
  lab.rotation.x = -Math.PI / 2;
  lab.position.set(0, 30.05, -40);
  g.add(lab);
  // ขาปลั๊กไฟบ้าน (เสียบผนังด้านหลัง) แสดงเป็นเส้นสายไฟ
  const cable = new THREE.CatmullRomCurve3([V(0, 6, -12), V(0, 4, -4), V(0, 5, 2)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 16, 1.6, 8), black));
  // ปลั๊ก DC + แจ็กตัวเมียขั้วสกรู
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 10, 20).rotateX(Math.PI / 2), black);
  plug.position.set(0, 6, plugged ? 4 : -2);
  const jack = new THREE.Mesh(new THREE.BoxGeometry(14, 11, 16), mat('adpJack', () => new THREE.MeshStandardMaterial({ color: 0x2b6cc4, roughness: 0.5 })));
  jack.position.set(0, 5.5, 12);
  g.add(plug, jack);
  for (const pin of ['+', '-'] as const) {
    const [x, y, z] = ADAPTER_PIN_LOCAL[pin].map((v) => v * 2.54);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1.2, 16), tin());
    screw.position.set(x, y - 0.8, z);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.5), mat('adpSlot', () => new THREE.MeshBasicMaterial({ color: 0x333333 })));
    slot.position.set(x, y - 0.15, z);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.8), tin());
    tip.position.set(x, y, z);
    tip.userData.leadTip = pin;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 3.4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y, z);
    hit.userData = { pin, isPin: true };
    const d = decal(textTex(`adp:${pin}`, [pin === '+' ? '+' : '−'], pin === '+' ? 'rgba(255,90,90,0.95)' : 'rgba(240,240,240,0.95)', 64, 64, 56), 2.6, 2.6);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 11.06, z + 3.6);
    g.add(screw, slot, tip, hit, d);
  }
  root.userData.topY = 30 * MM;
  return root;
}

/* ======================= บอร์ดกระจายไฟเซอร์โว 4 ช่อง ======================= */

/** แผ่นวงจร 56 × 40 mm: ขั้วสกรู V+/GND ซ้าย, หัวเข็ม S/V/G สี่ช่องแนวตั้งด้านหลัง, แถวขาสัญญาณ S1–S4 + GND ด้านหน้า (ขาตัวผู้ตั้งขึ้น) */
export const SERVOHUB_PIN_LOCAL: Record<string, [number, number, number]> = (() => {
  const out: Record<string, [number, number, number]> = {};
  const top = (5 + 1.6 + 8.5) / 2.54;
  out['V+'] = [-23 / 2.54, (5 + 1.6 + 10) / 2.54, -6 / 2.54];
  out['GND'] = [-23 / 2.54, (5 + 1.6 + 10) / 2.54, 0];
  [1, 2, 3, 4].forEach((k, i) => {
    const x = -8 + i * 8;
    out[`CH${k}.S`] = [x / 2.54, top, -14 / 2.54];
    out[`CH${k}.V`] = [x / 2.54, top, -11.46 / 2.54];
    out[`CH${k}.G`] = [x / 2.54, top, -8.92 / 2.54];
    out[`S${k}`] = [(-8 + i * 2.54) / 2.54, top, 14 / 2.54];
  });
  out['SG'] = [(-8 + 4 * 2.54) / 2.54, top, 14 / 2.54];
  return out;
})();

export function buildServoHub(): THREE.Group {
  const { root, g } = rootGroups();
  const y0 = 5, top = y0 + 1.6;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(56, 1.6, 40), mat('hubPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f5e33, roughness: 0.55 })));
  pcb.position.set(0, y0 + 0.8, 0);
  g.add(pcb);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const so = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, y0, 10), mat('hubStand', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9a65a, roughness: 0.35, metalness: 0.9 }))));
    so.position.set(sx * 25, y0 / 2, sz * 17);
    g.add(so);
  }
  // ขั้วสกรู 2 ช่อง (ฟ้า)
  const tb = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 12), mat('hubTb', () => new THREE.MeshStandardMaterial({ color: 0x2b6cc4, roughness: 0.5 })));
  tb.position.set(-23, top + 5, -3);
  g.add(tb);
  const hdr = mat('unoHdr', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55 }));
  const gold = mat('hubPin', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const pinAt = (name: string) => {
    const [ux, uy, uz] = SERVOHUB_PIN_LOCAL[name];
    const x = ux * 2.54, y = uy * 2.54, z = uz * 2.54;
    if (name === 'V+' || name === 'GND') {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1.2, 16), tin());
      screw.position.set(x, y - 0.6, z);
      g.add(screw);
    } else {
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.54, 2.5, 2.54), hdr);
      base.position.set(x, top + 1.25, z);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.64, 6, 0.64), gold);
      p.position.set(x, top + 5.5, z);
      g.add(base, p);
    }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), tin());
    tip.position.set(x, y, z);
    tip.userData.leadTip = name;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.6, 2.3), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y - 0.6, z);
    hit.userData = { pin: name, isPin: true };
    g.add(tip, hit);
  };
  for (const n of Object.keys(SERVOHUB_PIN_LOCAL)) pinAt(n);
  // ตัวเก็บประจุ 470 µF และ LED ไฟเข้า
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 12, 24), mat('hubCap', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45 })));
  cap.position.set(-12, top + 6, 8);
  const led = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.25), new THREE.MeshStandardMaterial({ color: 0xffb3b3, emissive: 0xff2020, emissiveIntensity: 0, roughness: 0.4 }));
  led.position.set(-18, top + 0.4, 12);
  g.add(cap, led);
  root.userData.hubLed = led.material;
  const silk = canvasTex('hubSilk', 560, 400, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(240,244,240,0.95)'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const at = (s: string, mx: number, mz: number, size = 22) => { x.font = `600 ${size}px "Chakra Petch", sans-serif`; x.fillText(s, (mx + 28) * 10, (mz + 20) * 10); };
    at('V+', -17.5, -6, 20); at('GND', -17.5, 0, 18);
    [1, 2, 3, 4].forEach((k, i) => { at(`CH${k}`, -8 + i * 8, -18.5, 20); });
    at('S  V  G', 6, -6.5, 16);
    at('S1 S2 S3 S4 GND', 1.5, 17.5, 16);
    at('470µF', -12, 3, 16); at('SERVO POWER ×4', 8, 6, 22);
  });
  const sk = new THREE.Mesh(new THREE.PlaneGeometry(56, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: silk, transparent: true, depthWrite: false, toneMapped: false }));
  sk.position.set(0, top + 0.02, 0);
  sk.renderOrder = 2;
  g.add(sk);
  root.userData.topY = (top + 12) * MM;
  return root;
}

/* ======================= Seeed Studio XIAO RP2040 ======================= */

/**
 * Seeed Studio XIAO RP2040 บัดกรีหัวเข็มตัวผู้แล้วเสียบเบรดบอร์ดคร่อมร่องกลาง: PCB 21 × 17.8 mm (Seeed wiki) หนา 1.0 mm บนพลาสติกหัวเข็ม 2.5 mm
 * ขา castellated 7 ขาต่อด้าน ระยะ 2.54 mm แถวห่าง 15.24 mm · จุดกำเนิด = ขา D0, +x ไปทาง D6 (หัว USB-C อยู่ฝั่ง x ลบ), แถว D7…5V ที่ z = −15.24
 * ชิ้นส่วนบนผิวบน (ฝาโลหะครอบ RP2040/แฟลช, USB-C, ปุ่ม B/R, LED RGB, NeoPixel, LED ไฟเลี้ยง) ตำแหน่งเป็นค่าประมาณจากรูปบอร์ด — ไม่มีผลต่อวงจร · ไม่มีโลโก้
 * userData.xiaoRgb = วัสดุ LED RGB (สีผสมตามความสว่าง R/G/B), xiaoNeo = วัสดุ NeoPixel, xiaoRgbGlow / xiaoNeoGlow = แสงเรือง
 */
export function buildXiaoRp2040(names: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const L = 21, W = 17.8, T = 1.0, y0 = 2.5, cx = 3 * PITCH, cz = -7.62;
  const top = y0 + T;
  const pcbMat = mat('xiaoPcb', () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5 }));
  const edge = mat('xiaoEdge', () => new THREE.MeshStandardMaterial({ color: 0x6c6f72, roughness: 0.8 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [edge, edge, pcbMat, pcbMat, edge, edge]);
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const metal = mat('nanoMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const shieldM = mat('xiaoShield', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.42, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  // ฝาโลหะครอบ RP2040 + แฟลช (ห้ามแกะตามคำเตือนของ Seeed) — ครอบพื้นที่ฝั่งปลายที่ไกลจาก USB
  const shield = new THREE.Mesh(new THREE.BoxGeometry(8.7, 1.6, 12.6), shieldM);
  shield.position.set(cx + L / 2 - 8.7 / 2 - 1.0, top + 0.8, cz);
  g.add(shield);
  // USB-C (ยื่นพ้นขอบฝั่ง D0/5V ราว 1.2 mm)
  const usb = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.2, 9.0), metal);
  usb.position.set(cx - L / 2 + 7.4 / 2 - 1.2, top + 1.6, cz);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 7.8), black);
  mouth.position.set(cx - L / 2 - 1.22, top + 1.6, cz);
  g.add(usb, mouth);
  // ปุ่ม B (BOOT) และ R (RESET) ถัดจากหัว USB — ไม่จำลอง (ตัวอักษรบนปุ่ม ไม่ให้ทับป้ายชื่อขา)
  const btnBase = mat('xiaoBtnBase', () => new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.55 }));
  const btnCap = mat('xiaoBtnCap', () => new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.6 }));
  const bx = cx - L / 2 + 7.5;
  for (const [dz, t] of [[-3.6, 'B'], [3.6, 'R']] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 3.0), btnBase);
    b.position.set(bx, top + 0.45, cz + dz);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.8), btnCap);
    c.position.set(bx, top + 1.15, cz + dz);
    const tl = decal(textTex(`xiao:btn:${t}`, [t], 'rgba(240,243,245,0.95)', 64, 64, 46), 1.1, 1.1);
    tl.rotation.x = -Math.PI / 2;
    tl.position.set(bx, top + 1.42, cz + dz);
    g.add(b, c, tl);
  }
  // LED ไฟเลี้ยง (ติดเมื่อมีไฟ), LED RGB ผู้ใช้ และ NeoPixel 2 × 2 mm — แถวระหว่างหัว USB กับฝาโลหะ
  const ledX = cx - L / 2 + 9.9; // ระหว่างปุ่มกับขอบฝาโลหะ
  const pwr = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), mat('xiaoPwr', () => new THREE.MeshStandardMaterial({ color: 0xffd0c8, emissive: 0xff3020, emissiveIntensity: 1.2, roughness: 0.4 })));
  pwr.position.set(ledX, top + 0.25, cz - 4.2);
  const rgbMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0x000000, emissiveIntensity: 2.2, roughness: 0.35 });
  const rgb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), rgbMat);
  rgb.position.set(ledX, top + 0.3, cz - 1.2);
  const neoMat = new THREE.MeshStandardMaterial({ color: 0xf6f4ee, emissive: 0x000000, emissiveIntensity: 2.2, roughness: 0.3 });
  const neoBody = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 2.0), mat('xiaoNeoBody', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 })));
  neoBody.position.set(ledX, top + 0.4, cz + 2.4);
  const neo = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1.4), neoMat);
  neo.position.set(ledX, top + 0.83, cz + 2.4);
  g.add(pwr, rgb, neoBody, neo);
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const mkGlow = (z: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    s.position.set(ledX, top + 1.6, z);
    s.scale.set(6, 6, 1);
    s.userData.glow = true;
    s.userData.noPick = true;
    g.add(s);
    return s;
  };
  const rgbGlow = mkGlow(cz - 1.2), neoGlow = mkGlow(cz + 2.4);
  const lt = decal(textTex('xiao:rgb', ['RGB'], 'rgba(240,243,245,0.9)', 128, 64, 40), 2.4, 1.2);
  lt.rotation.x = -Math.PI / 2; lt.rotation.z = Math.PI / 2;
  lt.position.set(ledX + 1.7, top + 0.02, cz - 1.2);
  g.add(lt);
  // ขา castellated + หัวเข็ม 2 แถว: พลาสติกดำใต้บอร์ด + ขาโลหะลงรู + ครึ่งวงทองที่ขอบ + ป้ายชื่อขาด้านใน
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  for (const [z, from] of [[0, 0], [-15.24, 7]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(7 * PITCH, y0, 2.5), hdr);
    base.position.set(cx, y0 / 2, z);
    g.add(base);
    for (let k = 0; k < 7; k++) {
      const name = names[from + k];
      const x = from === 0 ? k * PITCH : (6 - k) * PITCH;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.9), gold);
      pad.position.set(x, top + 0.04, z + (from === 0 ? 0.35 : -0.35));
      const t = decal(textTex(`xiao:pin:${name}`, [name], 'rgba(240,243,245,0.96)', 128, 64, 42), 2.0, 1.0);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(x, top + 0.02, z + (from === 0 ? -1.75 : 1.75));
      g.add(pad, t);
      g.add(flatLead([V(x, top + 1.0, z), V(x, 0, z)], 0.64, 0.64, name));
    }
  }
  root.userData.xiaoRgb = rgbMat;
  root.userData.xiaoNeo = neoMat;
  root.userData.xiaoRgbGlow = rgbGlow;
  root.userData.xiaoNeoGlow = neoGlow;
  root.userData.topY = (top + 3.2) * MM;
  return root;
}

/* ======================= Arduino Nano RP2040 Connect ======================= */

/**
 * Arduino Nano RP2040 Connect บัดกรีหัวเข็มแล้วเสียบเบรดบอร์ด: PCB 45 × 18 mm (ขนาดตระกูล Nano) หนา 1.6 mm บนพลาสติกหัวเข็ม 2.5 mm
 * ขา 2 แถว × 15 ขา ระยะ 2.54 mm แถวห่าง 15.24 mm ตำแหน่งเดียวกับ Arduino Nano · จุดกำเนิด = ขา 1 (TX), +x ไปทาง D12, หัว Micro-USB ฝั่ง D12/D13
 * ชิ้นส่วนบนผิวบน (RP2040 QFN-56, แฟลช, โมดูล NINA-W102 พร้อมฝาโลหะและสายอากาศ, IMU LSM6DSOX, LED RGB, LED บนบอร์ด, ปุ่ม RESET) ตำแหน่งโดยประมาณ — ไม่มีผลต่อวงจร · ไม่มีโลโก้
 * userData.picoLed / picoGlow = LED บนบอร์ด (GPIO6 = D13) · LED RGB ต่อกับ NINA-W102 จึงไม่ผูกกับสถานะใด (ดับตลอด)
 */
export function buildNanoConnect(names: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const L = 45, W = 18, T = 1.6, y0 = 2.5, cx = 7 * PITCH, cz = -7.62;
  const top = y0 + T;
  const pcbMat = mat('ncPcb', () => new THREE.MeshStandardMaterial({ color: 0x0e6f73, roughness: 0.5 }));
  const edge = mat('nanoEdge', () => new THREE.MeshStandardMaterial({ color: 0x8fa3a0, roughness: 0.8 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [edge, edge, pcbMat, pcbMat, edge, edge]);
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const metal = mat('nanoMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const shieldM = mat('xiaoShield', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.42, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  // Micro-USB (ยื่นพ้นขอบฝั่ง D12/D13 ราว 1 mm)
  const usb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 7.6), metal);
  usb.position.set(cx + L / 2 - 5.6 / 2 + 1.0, top + 1.3, cz);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 6.4), black);
  mouth.position.set(cx + L / 2 + 1.02, top + 1.3, cz);
  g.add(usb, mouth);
  // RP2040 (QFN-56 7 × 7 mm) + แฟลช 16 MB (SOIC-8)
  const mcu = new THREE.Mesh(new THREE.BoxGeometry(7, 0.9, 7), black);
  mcu.position.set(cx + 6.0, top + 0.45, cz);
  const mk = decal(textTex('nc:mcu', ['RP2-B2'], 'rgba(205,208,212,0.9)', 256, 128, 44), 5.2, 2.6);
  mk.rotation.x = -Math.PI / 2; mk.position.set(cx + 6.0, top + 0.91, cz);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.2, 4.0), black);
  flash.position.set(cx - 3.6, top + 0.6, cz - 2.4);
  g.add(mcu, mk, flash);
  // โมดูล NINA-W102: ฝาโลหะ + พื้นที่สายอากาศที่ปลายบอร์ดฝั่งขา 1 (ไม่จำลอง)
  const nina = new THREE.Mesh(new THREE.BoxGeometry(10.6, 2.0, 13.0), shieldM);
  nina.position.set(cx - L / 2 + 4.6 + 5.3, top + 1.0, cz);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 13.0), mat('ncAnt', () => new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.5 })));
  ant.position.set(cx - L / 2 + 2.6, top + 0.45, cz);
  g.add(nina, ant);
  // IMU LSM6DSOX (LGA-14 2.5 × 3 mm) และไมโครโฟน (ไม่จำลอง)
  const imu = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.83, 3.0), black);
  imu.position.set(cx - 4.3, top + 0.42, cz + 2.4);
  const mic = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.0, 2.6), metal);
  mic.position.set(cx + 0.0, top + 0.5, cz + 2.6);
  g.add(imu, mic);
  // ปุ่ม RESET ใกล้หัว USB
  const rb = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.2, 3.6), metal);
  rb.position.set(cx + 15.4, top + 0.6, cz + 2.6);
  const rc = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.7, 16), mat('nanoBtn', () => new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.5 })));
  rc.position.set(cx + 15.4, top + 1.5, cz + 2.6);
  g.add(rb, rc);
  // LED บนบอร์ด (ส้ม, GPIO6) + LED ไฟเลี้ยง (เขียว, ติดเมื่อมีไฟ) + LED RGB (ต่อกับ NINA — ดับ)
  const ledL = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa000, emissiveIntensity: 0, roughness: 0.4 });
  const ledPwr = mat('ncLedPwr', () => new THREE.MeshStandardMaterial({ color: 0xb8f0c0, emissive: 0x20d040, emissiveIntensity: 1.2, roughness: 0.4 }));
  const ledRgb = mat('ncLedRgb', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.35 }));
  const ledX = cx + 11.7;
  const leds: Array<[number, THREE.Material, string, number]> = [[2.6, ledL, 'LED', 1.0], [-2.6, ledPwr, 'PWR', 1.0], [0, ledRgb, 'RGB', 1.6]];
  for (const [dz, m, t, w] of leds) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, t === 'RGB' ? 1.6 : 0.6), m);
    l.position.set(ledX, top + 0.3, cz + dz);
    g.add(l);
  }
  const glowT = canvasTex('unoGlow', 64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffb02e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(ledX, top + 1.4, cz + 2.6);
  glow.scale.set(6, 6, 1);
  glow.userData.glow = true;
  glow.userData.noPick = true;
  g.add(glow);
  // หัวเข็มตัวผู้ 2 แถว + ป้ายชื่อขาด้านใน
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const short = (n: string) => ({ D1: 'TX', D0: 'RX' } as Record<string, string>)[n] ?? n.replace(/\.\d$/, '');
  for (const [z, from] of [[0, 0], [-15.24, 15]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(15 * PITCH, y0, 2.5), hdr);
    base.position.set(cx, y0 / 2, z);
    g.add(base);
    for (let k = 0; k < 15; k++) {
      const name = names[from + k];
      const x = from === 0 ? k * PITCH : (14 - k) * PITCH;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, top + 0.02, z);
      const t = decal(textTex(`nc:pin:${short(name)}`, [short(name)], 'rgba(240,243,245,0.96)', 128, 64, 42), 2.3, 1.15);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(x, top + 0.02, z + (from === 0 ? -2.3 : 2.3));
      g.add(ring, t);
      g.add(flatLead([V(x, top + 1.0, z), V(x, 0, z)], 0.64, 0.64, name));
    }
  }
  root.userData.picoLed = ledL;
  root.userData.picoGlow = glow;
  root.userData.topY = (top + 2.6) * MM;
  return root;
}

/* ======================= Espressif ESP32-DevKitC V4 ======================= */

/**
 * ESP32-DevKitC V4 (ESP32-WROOM-32E) บัดกรีหัวเข็มแล้วเสียบเบรดบอร์ด: J2/J3 อย่างละ 19 ขา ระยะ 2.54 mm แถวห่าง 25.4 mm
 * PCB ≈ 54.4 × 27.9 mm (ขนาดโดยประมาณ — ยังไม่ได้เทียบกับไฟล์ขนาดของ Espressif) · จุดกำเนิด = J2-1 (3V3), +x ไปทาง J2-19 (5V, ฝั่ง USB), J3 ที่ z = −25.4
 * ชิ้นส่วนบนผิวบน (โมดูล WROOM พร้อมฝาโลหะและสายอากาศ PCB, ชิป USB-UART, เรกูเลเตอร์, ปุ่ม EN/Boot, LED ไฟเลี้ยง, Micro-USB) ตำแหน่งโดยประมาณ · ไม่มีโลโก้
 */
export function buildEsp32DevKitC(names: string[]): THREE.Group {
  const { root, g } = rootGroups();
  const L = 54.4, W = 27.9, T = 1.6, y0 = 2.5, cx = 9 * PITCH, cz = -12.7;
  const top = y0 + T;
  const pcbMat = mat('espPcb', () => new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5 }));
  const edge = mat('xiaoEdge', () => new THREE.MeshStandardMaterial({ color: 0x6c6f72, roughness: 0.8 }));
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [edge, edge, pcbMat, pcbMat, edge, edge]);
  pcb.position.set(cx, y0 + T / 2, cz);
  g.add(pcb);
  const metal = mat('nanoMetal', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc8cbcf, roughness: 0.3, metalness: 1 })));
  const shieldM = mat('xiaoShield', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.42, metalness: 1 })));
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  // โมดูล ESP32-WROOM-32E (18 × 25.5 mm): PCB ของโมดูล + ฝาโลหะ + สายอากาศ PCB ยื่นพ้นปลายบอร์ดฝั่ง J2-1
  const modX0 = cx - L / 2 - 2.0;
  const modPcb = new THREE.Mesh(new THREE.BoxGeometry(25.5, 0.8, 18), mat('espModPcb', () => new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.55 })));
  modPcb.position.set(modX0 + 25.5 / 2, top + 0.4, cz);
  const can = new THREE.Mesh(new THREE.BoxGeometry(17.6, 2.4, 15.4), shieldM);
  can.position.set(modX0 + 25.5 - 17.6 / 2 - 0.5, top + 0.8 + 1.2, cz);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.05, 15.0), mat('espAnt', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.4, metalness: 0.8 }))));
  ant.position.set(modX0 + 3.3, top + 0.83, cz);
  g.add(modPcb, can, ant);
  // Micro-USB (ยื่นพ้นขอบฝั่ง J2-19 ราว 1 mm) + ชิป USB-UART + เรกูเลเตอร์ 3.3 V
  const usb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 7.6), metal);
  usb.position.set(cx + L / 2 - 5.6 / 2 + 1.0, top + 1.3, cz);
  const bridgeIc = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, 4), black);
  bridgeIc.position.set(cx + 16.5, top + 0.4, cz - 4.5);
  const ldo = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 3.5), black);
  ldo.position.set(cx + 10.0, top + 0.8, cz + 5.5);
  g.add(usb, bridgeIc, ldo);
  // ปุ่ม EN และ Boot ข้างหัว USB · LED ไฟเลี้ยง (แดง ติดเมื่อมีไฟ)
  const btnBase = mat('xiaoBtnBase', () => new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.55 }));
  const btnCap = mat('xiaoBtnCap', () => new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.6 }));
  for (const [dz, t] of [[8.6, 'EN'], [-8.6, 'BOOT']] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.2, 3.0), btnBase);
    b.position.set(cx + L / 2 - 4.0, top + 0.6, cz + dz);
    const c = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 1.6), btnCap);
    c.position.set(cx + L / 2 - 4.0, top + 1.5, cz + dz);
    const tl = decal(textTex(`esp:btn:${t}`, [t], 'rgba(240,243,245,0.95)', 128, 64, 40), 2.4, 1.2);
    tl.rotation.x = -Math.PI / 2; tl.rotation.z = Math.PI / 2;
    tl.position.set(cx + L / 2 - 7.2, top + 0.02, cz + dz);
    g.add(b, c, tl);
  }
  const pwr = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), mat('espPwr', () => new THREE.MeshStandardMaterial({ color: 0xffd0c8, emissive: 0xff2010, emissiveIntensity: 1.2, roughness: 0.4 })));
  pwr.position.set(cx + 13.0, top + 0.25, cz + 1.0);
  g.add(pwr);
  // หัวเข็ม 2 แถว × 19 ขา + ป้ายชื่อขาด้านใน
  const hdr = mat('hdrBlack', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const short = (n: string) => n.replace(/\.\d$/, '');
  for (const [z, from] of [[0, 0], [-25.4, 19]] as const) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(19 * PITCH, y0, 2.5), hdr);
    base.position.set(cx, y0 / 2, z);
    g.add(base);
    for (let k = 0; k < 19; k++) {
      const name = names[from + k];
      const x = k * PITCH;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 6, 14), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, top + 0.02, z);
      const t = decal(textTex(`esp:pin:${short(name)}`, [short(name)], 'rgba(240,243,245,0.96)', 128, 64, 42), 2.3, 1.15);
      t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2;
      t.position.set(x, top + 0.02, z + (from === 0 ? -2.3 : 2.3));
      g.add(ring, t);
      g.add(flatLead([V(x, top + 1.0, z), V(x, 0, z)], 0.64, 0.64, name));
    }
  }
  root.userData.topY = (top + 3.2) * MM;
  return root;
}

/* ======================= เซนเซอร์ชุด 1 (รอบ 87) ======================= */

/** LED SMD 0805 บนแผ่นวงจรตั้ง: วัสดุแยกต่อชิ้น (emissive ปรับตามผลจำลอง) */
function smdLed(g: THREE.Group, x: number, y: number, z: number, color: number, glow: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 0, roughness: 0.35 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.25, 0.8), m);
  led.position.set(x, y, z + 0.4);
  g.add(led);
  return m;
}
function pinLabels(g: THREE.Group, key: string, pins: string[], y: number, z: number, shown?: string[]) {
  pins.forEach((p, i) => {
    const t = shown?.[i] ?? p;
    const d = decal(textTex(`${key}:p:${t}`, [t], 'rgba(240,242,245,0.95)', 128, 64, 40), 2.4, 1.2);
    d.position.set(i * PITCH, y, z + 0.02);
    g.add(d);
  });
}
function smdBox(g: THREE.Group, w: number, h: number, t: number, x: number, y: number, z: number, key: string, color: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat(key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45 })));
  m.position.set(x, y, z + t / 2);
  g.add(m);
  return m;
}
/** ทริมพอตสีน้ำเงิน: square = 3362 (6.6 mm, หัวสกรูกลม) · multi = 3296 หลายรอบ (9.5 × 4.8 × 10 mm, สกรูทองเหลืองด้านบน) */
function bluePot(g: THREE.Group, x: number, y: number, z: number, kind: 'square' | 'multi') {
  const blue = mat('modPot', () => new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5 }));
  if (kind === 'square') {
    smdBox(g, 6.6, 6.6, 4.2, x, y, z, 'modPotB', 0x2f6fd0);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.6, 20).rotateX(Math.PI / 2), mat('modPotW', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 })));
    s.position.set(x, y, z + 4.5);
    g.add(s);
  } else {
    const b = new THREE.Mesh(new THREE.BoxGeometry(9.5, 10, 4.8), blue);
    b.position.set(x, y, z + 2.4);
    g.add(b);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 16), mat('brass', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.35, metalness: 1 }))));
    s.position.set(x - 3.2, y + 5.4, z + 2.4);
    g.add(s);
  }
}

/**
 * โมดูลคอมพาราเตอร์ LM393 (เปลวไฟ/เสียง/ฝน/MQ-2/ตรวจเส้น/สั่นสะเทือน): แผ่นวงจรตั้งบนหัวเข็ม VCC GND DO (AO)
 * ตัวรับรู้อยู่ขอบบน หันไปด้านหน้า (+z) · LED ไฟเลี้ยง + LED DO (userData.ledPower / ledDo) · ทริมพอตตั้งจุดตัด · LM393 SO-8
 * ขนาดแผ่นจากภาพโมดูลทั่วไป (ประมาณ): 32 × 14 mm (MQ-2 32 × 22 mm) — ไม่มีผลต่อการต่อวงจร
 */
export function buildLm393Module(kind: 'flame' | 'soundsensor' | 'rainsensor' | 'mq2' | 'linetrack' | 'vibsensor', o: { wet?: number; surface?: 'white' | 'black' | 'none'; height?: number; flame?: boolean; distance?: number } = {}): THREE.Group {
  const { root, g } = rootGroups();
  const pins = kind === 'vibsensor' ? ['VCC', 'GND', 'DO'] : ['VCC', 'GND', 'DO', 'AO'];
  const cx = ((pins.length - 1) * PITCH) / 2, y0 = 3.5;
  const W = kind === 'mq2' ? 22 : 14, H = kind === 'mq2' ? 32 : 30;
  const color = kind === 'mq2' ? 0x1d3f8a : kind === 'soundsensor' ? 0x1a4f9a : 0x1d3f8a;
  const zf = standingPcb(g, W, H, color, `lm${kind}`, y0, cx);
  const top = y0 + H;
  const black = mat('icBlack', () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 }));
  // LM393 SO-8 + ตัวต้านทาน/ตัวเก็บประจุ SMD
  const ic = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.9, 1.5), black);
  ic.position.set(cx - 2.5, y0 + 9, zf + 0.75);
  g.add(ic);
  for (const [dx, dy] of [[3, 6.5], [3, 9.5], [3, 12.5]] as const) smdBox(g, 2.0, 1.25, 0.5, cx + dx, y0 + dy, zf, 'smdR', 0x202020);
  bluePot(g, cx, y0 + 17, zf, kind === 'soundsensor' ? 'multi' : 'square');
  root.userData.ledPower = smdLed(g, cx - W / 2 + 2.2, y0 + 5, zf, 0x551111, 0xff3322);
  root.userData.ledDo = smdLed(g, cx + W / 2 - 2.2, y0 + 5, zf, 0x551111, 0xff3322);
  const fwd = (o2: THREE.Object3D, y: number, dz: number) => { o2.position.set(cx, y, zf + dz); g.add(o2); };
  switch (kind) {
    case 'flame': {
      // ตัวรับ IR 5 mm สีดำ (กรองแสงที่ตามองเห็น) ที่ขอบบน
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 5.6, 20).rotateX(Math.PI / 2), mat('irRx', () => new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15 })));
      fwd(body, top - 3, 3.2);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), body.material as THREE.Material);
      fwd(cap, top - 3, 6);
      if (o.flame && (o.distance ?? 999) <= 60) {
        // เปลวเทียน (สัญลักษณ์) ที่ระยะตามแผง — แสดงเมื่อไม่เกิน 60 cm
        const fl = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12).scale(1, 2.2, 1), mat('flameGlow', () => new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xff7a10, emissiveIntensity: 2.2, roughness: 1, transparent: true, opacity: 0.9 })));
        fl.position.set(cx, top + 2, zf + 8 + (o.distance ?? 0) * 10);
        fl.userData.noPick = true;
        const wick = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 18, 20), mat('candle', () => new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.8 })));
        wick.position.set(cx, top - 12, zf + 8 + (o.distance ?? 0) * 10);
        wick.userData.noPick = true;
        g.add(fl, wick);
      }
      break;
    }
    case 'soundsensor': {
      // ไมโครโฟนอิเล็กเตรต Ø 9.7 × 6.7 mm หน้าผ้าสีดำ
      const can = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 6.7, 28).rotateX(Math.PI / 2), mat('micCan', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 1 }))));
      fwd(can, top - 5, 3.35);
      const felt = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28), mat('micFelt', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 })));
      fwd(felt, top - 5, 6.72);
      break;
    }
    case 'rainsensor': {
      // แผ่นตรวจฝน 54 × 40 mm (ลายทองแดงสลับ) วางเอียงด้านหน้า ต่อด้วยสายสองเส้น · จุดน้ำตามความเปียก
      const pad = new THREE.Group();
      const pcb = new THREE.Mesh(new THREE.BoxGeometry(40, 1.6, 54), mat('rainPad', () => new THREE.MeshStandardMaterial({ color: 0x1e4a8a, roughness: 0.45 })));
      pad.add(pcb);
      const tr = mat('rainTrace', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.3, metalness: 1 })));
      for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(34, 0.1, 1.4), tr); s.position.set(i % 2 ? 1.5 : -1.5, 0.85, -22 + i * 5.5); pad.add(s); }
      const wet = Math.max(0, Math.min(100, o.wet ?? 0));
      const drop = mat('rainDrop', () => new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, roughness: 0.05, transmission: 0.7, thickness: 1 }));
      for (let i = 0; i < Math.round(wet / 4); i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8).scale(1, 0.45, 1), drop); d.position.set(((i * 37) % 32) - 16, 1.2, ((i * 53) % 48) - 24); pad.add(d); }
      pad.position.set(cx, 4, zf + 40);
      pad.userData.noPick = true;
      g.add(pad);
      const wire = mat('rainWire', () => new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }));
      for (const dx of [-1.3, 1.3]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 18, 8).rotateX(Math.PI / 2), wire); w.position.set(cx + dx, top - 3, zf + 9); g.add(w); }
      const hdr = smdBox(g, 5.2, 2.5, 6, cx, top - 3, zf, 'hdrBlack', 0x141414); void hdr;
      break;
    }
    case 'mq2': {
      // MQ-2: ฐานเบกาไลต์ Ø 19.8 + ฝาตะแกรงสแตนเลส Ø 16.5 สูงรวม ≈ 16 mm หันไปด้านหน้า
      const base = new THREE.Mesh(new THREE.CylinderGeometry(9.9, 9.9, 7, 32).rotateX(Math.PI / 2), mat('mqBase', () => new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 })));
      fwd(base, y0 + H - 11, 3.5);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(8.25, 8.25, 9, 32, 1, true).rotateX(Math.PI / 2), mat('mqMesh', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.55, metalness: 0.9, wireframe: false }))));
      fwd(mesh, y0 + H - 11, 11.5);
      const capm = new THREE.Mesh(new THREE.CircleGeometry(8.25, 32), mat('mqCap', () => withEnv(new THREE.MeshStandardMaterial({ color: 0x9da2a8, roughness: 0.6, metalness: 0.9 }))));
      fwd(capm, y0 + H - 11, 16);
      break;
    }
    case 'linetrack': {
      // TCRT5000: ตัวถัง 10.2 × 5.8 × 7 mm (LED สีน้ำเงินใส + ตัวรับสีดำ) หันไปด้านหน้า · พื้นทดสอบตามความสูงในแผง
      const hous = smdBox(g, 10.2, 5.8, 7, cx, top - 4, zf, 'tcrtBody', 0x15161a); void hous;
      const led = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 16).rotateX(Math.PI / 2), mat('tcrtLed', () => new THREE.MeshPhysicalMaterial({ color: 0x4a7ad8, roughness: 0.1, transmission: 0.4, thickness: 1 })));
      led.position.set(cx - 2.5, top - 4, zf + 7.4);
      const rx = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 16).rotateX(Math.PI / 2), mat('tcrtRx', () => new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 })));
      rx.position.set(cx + 2.5, top - 4, zf + 7.4);
      g.add(led, rx);
      if (o.surface && o.surface !== 'none') {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 1.5), mat(`tcrt${o.surface}`, () => new THREE.MeshStandardMaterial({ color: o.surface === 'white' ? 0xf2f2ee : 0x141416, roughness: 0.8 })));
        plate.position.set(cx, top - 4, zf + 7 + (o.height ?? 2.5) + 0.75);
        plate.userData.noPick = true;
        g.add(plate);
      }
      break;
    }
    case 'vibsensor': {
      // SW-420: กระบอกโลหะ Ø 4 × 10 mm วางนอนบนแผ่น
      const can = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 10, 16).rotateZ(Math.PI / 2), mat('sw420', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xa8aeb6, roughness: 0.3, metalness: 1 }))));
      fwd(can, top - 4, 2.2);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 6, 16).rotateZ(Math.PI / 2), mat('sw420g', () => new THREE.MeshStandardMaterial({ color: 0x2c8a3e, roughness: 0.5 })));
      fwd(sleeve, top - 4, 2.2);
      break;
    }
  }
  pinLabels(g, `lm${kind}`, pins, y0 + 2.2, zf);
  maleHeader(g, pins, y0 + 0.5, `lm${kind}`);
  root.userData.topY = (top + 2) * MM;
  return root;
}

/** TTP223: แผ่นสีแดง 24 × 15 mm ตั้งบนหัวเข็ม GND VCC I/O · วงแผ่นสัมผัสด้านหน้า · LED (userData.touchLed) */
export function buildTouchModule(touched: boolean): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['GND', 'VCC', 'IO'], cx = PITCH, y0 = 3.5, W = 15, H = 24;
  const zf = standingPcb(g, W, H, 0xb0261f, 'ttp', y0, cx);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.6, 36), mat('ttpRing', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.35, metalness: 1 }))));
  ring.position.set(cx, y0 + 15, zf + 0.03);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4.4, 36), mat('ttpPad', () => new THREE.MeshStandardMaterial({ color: 0x9a1f19, roughness: 0.6 })));
  pad.position.set(cx, y0 + 15, zf + 0.02);
  g.add(ring, pad);
  if (touched) {
    const finger = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 14).scale(1, 1.4, 0.7), mat('finger', () => new THREE.MeshStandardMaterial({ color: 0xe6b9a0, roughness: 0.7 })));
    finger.position.set(cx, y0 + 18, zf + 4.5);
    finger.userData.noPick = true;
    g.add(finger);
  }
  smdBox(g, 2.9, 2.8, 1.1, cx - 4, y0 + 7, zf, 'icBlack', 0x17181a);
  root.userData.touchLed = smdLed(g, cx + 4.5, y0 + 7, zf, 0x113311, 0x33ff55);
  pinLabels(g, 'ttp', pins, y0 + 2.2, zf, ['GND', 'VCC', 'I/O']);
  maleHeader(g, pins, y0 + 0.5, 'ttp');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** A3144 ตัวถัง UA (SIP-3): 4.0 × 3.0 × 1.5 mm หน้ามีตัวอักษรหันไปด้านหน้า · ขา 1 VCC 2 GND 3 OUT ระยะ 1.27 ดัดออกเป็น 2.54 · แม่เหล็ก Ø 10 × 3 mm ที่ระยะตามแผง */
export function buildHallA3144(o: { magnet: boolean; distance: number; pole: 'S' | 'N' }): THREE.Group {
  const { root, g } = rootGroups();
  const xc = PITCH, yb = 5.5, W = 4.0, H = 3.0, T = 1.5;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), mat('hallBody', () => new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.5 })));
  body.position.set(xc, yb + H / 2, 0);
  g.add(body);
  const d = decal(textTex('hall:3144', ['3144'], 'rgba(210,214,218,0.92)', 256, 128, 90), 3.4, 1.7);
  d.position.set(xc, yb + H * 0.55, T / 2 + 0.012);
  g.add(d);
  for (let i = 0; i < 3; i++) {
    const xb = xc + (i - 1) * 1.27, xh = i * PITCH;
    const pts = i === 1 ? [V(xb, yb + 0.3), V(xh, 0)] : [V(xb, yb + 0.3), V(xb, yb - 1.2), V(xh, yb - 2.6), V(xh, 0)];
    g.add(flatLead(pts, 0.43, 0.38, ['VCC', 'GND', 'OUT'][i]));
  }
  if (o.magnet && o.distance <= 60) magnetDisc(g, xc, yb + H / 2, T / 2 + o.distance, o.pole, 'z');
  root.userData.topY = (yb + H) * MM;
  return root;
}
/** แม่เหล็กนีโอไดเมียม Ø 10 × 3 mm ชุบนิกเกิล พร้อมป้ายขั้วที่หันเข้าหาเซนเซอร์ */
function magnetDisc(g: THREE.Group, x: number, y: number, near: number, pole: 'S' | 'N', axis: 'z' | 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3, 32), mat('magnet', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc7cbd1, roughness: 0.25, metalness: 1 }))));
  const lab = decal(textTex(`mag:${pole}`, [pole], pole === 'S' ? 'rgba(40,90,220,0.95)' : 'rgba(220,40,40,0.95)', 128, 128, 100), 5, 5);
  if (axis === 'z') { m.rotation.x = Math.PI / 2; m.position.set(x, y, near + 1.5); lab.rotation.y = Math.PI; lab.position.set(x, y, near - 0.02); }
  else { m.position.set(x, near + 1.5, 0); lab.rotation.x = -Math.PI / 2; lab.position.set(x, near + 3.02, 0); }
  m.userData.noPick = true; lab.userData.noPick = true;
  g.add(m, lab);
}

/** สวิตช์รีดหลอดแก้ว Ø 2.5 × 14 mm ขาตามแนวแกน ดัดลงที่ระยะ span · หน้าสัมผัสสองแผ่นในหลอด (ชิดกันเมื่อปิด) · แม่เหล็กเหนือหลอดตามระยะ */
export function buildReedSwitch(span: number, closed: boolean, o: { magnet: boolean; distance: number }): THREE.Group {
  const { root, g } = rootGroups();
  const L = span * PITCH, cx = L / 2, y = 3.2, len = 14;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, len, 20).rotateZ(Math.PI / 2), mat('reedGlass', () => new THREE.MeshPhysicalMaterial({ color: 0xdfeef0, roughness: 0.05, transmission: 0.85, thickness: 0.6, transparent: true, opacity: 0.6 })));
  glass.position.set(cx, y, 0);
  g.add(glass);
  const reedM = mat('reedBlade', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.3, metalness: 1 })));
  const gap = closed ? 0 : 0.35;
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 0.8), reedM); b.position.set(cx + s * 3.2, y + s * (0.18 + gap / 2), 0); g.add(b); }
  g.add(roundLead([V(cx - len / 2, y), V(0, y), V(0, 0)], 0.5, '1'));
  g.add(roundLead([V(cx + len / 2, y), V(L, y), V(L, 0)], 0.5, '2'));
  if (o.magnet && o.distance <= 60) magnetDisc(g, cx, 0, y + 1.25 + o.distance, 'N', 'y');
  root.userData.topY = (y + 1.5) * MM;
  return root;
}

/** SW-520D: กระบอก Ø 5.5 × 13.5 mm (ปลอกหดสีดำ ฝาโลหะด้านบน) ตั้งตรง ขาชี้ลงระยะ 2.54 mm */
export function buildTiltSw520(): THREE.Group {
  const { root, g } = rootGroups();
  const cx = PITCH / 2, yb = 2.5, H = 13.5;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.75, H - 1.5, 24), mat('sw520', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.55 })));
  body.position.set(cx, yb + (H - 1.5) / 2, 0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.5, 24), mat('sw520cap', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc0c4ca, roughness: 0.3, metalness: 1 }))));
  cap.position.set(cx, yb + H - 0.75, 0);
  g.add(body, cap);
  g.add(roundLead([V(cx - 0.7, yb), V(0, yb - 1.2), V(0, 0)], 0.5, '1'));
  g.add(roundLead([V(cx + 0.7, yb), V(PITCH, yb - 1.2), V(PITCH, 0)], 0.5, '2'));
  root.userData.topY = (yb + H) * MM;
  return root;
}

/** เซนเซอร์ระดับน้ำ: แผ่นแดง 62 × 20 mm ตั้งบนหัวเข็ม S + − ลายทองแดง 10 เส้นที่ปลายบน · น้ำ (โปร่งแสง) ท่วมจากปลายลงมาตามระดับ */
export function buildWaterLevel(level: number): THREE.Group {
  const { root, g } = rootGroups();
  const pins = ['S', '+', '-'], cx = PITCH, y0 = 3.5, W = 20, H = 62;
  const zf = standingPcb(g, W, H, 0xb0261f, 'wl', y0, cx);
  const tr = mat('wlTrace', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.3, metalness: 1 })));
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.0, 40, 0.08), tr); s.position.set(cx - 8.1 + i * 1.8, y0 + H - 21, zf + 0.05); g.add(s); }
  smdBox(g, 2.9, 2.8, 1.1, cx, y0 + 10, zf, 'icBlack', 0x17181a);
  root.userData.ledPower = smdLed(g, cx + 6, y0 + 10, zf, 0x551111, 0xff3322);
  const lv = Math.max(0, Math.min(100, level));
  if (lv > 0) {
    const h = (40 * lv) / 100;
    const water = new THREE.Mesh(new THREE.BoxGeometry(W + 6, h, 8), mat('wlWater', () => new THREE.MeshStandardMaterial({ color: 0x3f8fd8, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false })));
    water.position.set(cx, y0 + H - h / 2, 0);
    water.userData.noPick = true;
    g.add(water);
  }
  pinLabels(g, 'wl', pins, y0 + 2.2, zf, ['S', '+', '−']);
  maleHeader(g, pins, y0 + 0.5, 'wl');
  root.userData.topY = (y0 + H) * MM;
  return root;
}

/** FSR 402: แผ่นกลม Ø 18.3 mm (พื้นที่รับแรง Ø 12.7) หาง 7.6 mm กว้าง ขาตัวผู้ 2 ขาระยะ 2.54 mm · ตั้งตรง หน้ารับแรงหันไปด้านหน้า */
export function buildFsr402(force: number): THREE.Group {
  const { root, g } = rootGroups();
  const cx = PITCH / 2, y0 = 3.5, tail = 22;
  const film = mat('fsrFilm', () => new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 0.55 }));
  const t = new THREE.Mesh(new THREE.BoxGeometry(7.6, tail, 0.4), film);
  t.position.set(cx, y0 + tail / 2, 0);
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(9.15, 9.15, 0.45, 40).rotateX(Math.PI / 2), film);
  disk.position.set(cx, y0 + tail + 8.5, 0);
  const act = new THREE.Mesh(new THREE.CircleGeometry(6.35, 40), mat('fsrAct', () => new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7 })));
  act.position.set(cx, y0 + tail + 8.5, 0.24);
  g.add(t, disk, act);
  if (force >= 0.1) {
    const finger = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14).scale(1, 1.4, 0.7), mat('finger', () => new THREE.MeshStandardMaterial({ color: 0xe6b9a0, roughness: 0.7 })));
    finger.position.set(cx, y0 + tail + 9, 0.24 + 4.9 - Math.min(1.2, force / 20));
    finger.userData.noPick = true;
    g.add(finger);
  }
  const gold = mat('hdrGold', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xd8b66a, roughness: 0.3, metalness: 1 })));
  const crimp = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 1.4), mat('fsrCrimp', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc0c4ca, roughness: 0.3, metalness: 1 }))));
  crimp.position.set(cx, y0 + 1.5, 0);
  g.add(crimp);
  ['1', '2'].forEach((p, i) => g.add(flatLead([V(i * PITCH, y0), V(i * PITCH, 0)], 0.64, 0.64, p, gold)));
  root.userData.topY = (y0 + tail + 18) * MM;
  return root;
}
