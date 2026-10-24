import * as THREE from 'three';
import { withEnv } from './pico-model';

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
