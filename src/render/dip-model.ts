import * as THREE from 'three';
import { withEnv } from './pico-model';

/**
 * IC ตัวถัง DIP-8 (PDIP, 300 mil) สำหรับออปแอมป์ LM741 / MCP6002
 *
 * ขนาดตาม package drawing ของผู้ผลิต — Texas Instruments "P (R-PDIP-T8)" ที่ใช้กับ LM741CN
 * (ตรงกับ JEDEC MS-001 variation BA) หน่วย mm:
 *   ตัวถังยาว D 9.81 (9.02–10.16) · กว้าง E1 6.35 · หนา A2 3.30 · ยกจากระนาบนั่ง A1 0.64 (≥ 0.51)
 *   ขาห่าง e 2.54 · ระยะระหว่างแถว eA 7.62 (300 mil)
 *   ขาโลหะแบนหนา c 0.25 · ส่วนบ่า (shoulder) กว้าง b1 1.52 · ส่วนเสียบกว้าง b 0.46 · ยาวใต้ระนาบนั่ง L 3.30
 *   รอยบากครึ่งวงกลมที่ปลายด้านขา 1 + จุดบุ๋มใกล้ขา 1
 *
 * พิกัด local (หน่วย mm ในกลุ่มที่ย่อ 1/2.54 ให้เป็นหน่วยรู): ขา 1 อยู่ที่จุดกำเนิด, ขา 1–4 เรียงตาม +x ที่ z = 0,
 * ขา 5–8 อยู่แถว z = −7.62 (ขา 8 ตรงข้ามขา 1) — ตรงกับ pinDefs ของออปแอมป์ (dx 0..3, dy 0 / −3)
 * ระนาบนั่ง (ใต้บ่าขา) = y 0 = ผิวเบรดบอร์ด; ปลายขาลงไปในรู 3.3 mm (บอร์ดหนา ~6 mm จึงไม่ทะลุ)
 * ทุกชิ้น (ตัวถัง ขา ข้อความ) อยู่ใน parent เดียวกัน — ย้าย/หมุนไปด้วยกันเสมอ
 */

export const DIP = {
  D: 9.81, E1: 6.35, A1: 0.64, A2: 3.3, e: 2.54, eA: 7.62,
  c: 0.25, b1: 1.52, b: 0.46, L: 3.3,
  /** ความสูงที่ขาออกจากตัวถัง (แนวรอยประกบแม่พิมพ์) */
  exitY: 0.64 + 1.15,
  /** รัศมีด้านในของการพับขา */
  bendR: 0.25,
  notchR: 0.8,
} as const;
const MM = 1 / 2.54;

type Geo = { lead: THREE.BufferGeometry; tip: THREE.BufferGeometry; lower: THREE.BufferGeometry; upper: THREE.BufferGeometry; dimple: THREE.BufferGeometry; notchWall: THREE.BufferGeometry };
const geoCache = new Map<number, Geo>();
/** ความยาวตัวถังตามจำนวนขา: DIP-8 9.81 mm (TI P), DIP-14 19.30 mm (TI N / JEDEC MS-001 AA 18.67–19.69) */
/** ความยาวตัวถัง: PDIP-8 ตาม DIP.D, PDIP-14/16 19.3 mm (TI N package, JEDEC MS-001) */
export const dipLength = (pins: number) => (pins >= 14 ? 19.3 : pins === 4 ? 4.6 : DIP.D);

function shared<T extends THREE.BufferGeometry>(g: T): T { g.userData.shared = true; return g; }

/**
 * ขาแบนส่วนบน: ออกจากด้านข้างตัวถังในแนวนอน → พับโค้งลง → แนวตั้งถึงระนาบนั่ง (กว้าง b1)
 * สร้างจากหน้าตัดด้านข้าง (z–y) ของแผ่นโลหะหนา c แล้ว extrude ตามความกว้าง b1 ในแกน x
 * แนวกึ่งกลางส่วนตั้งอยู่ที่ z = 0 (ตรงรู) ขาออกไปทาง +z (แถวหน้า)
 */
function leadGeometry(): THREE.BufferGeometry {
  const { c, b1, exitY, bendR, E1, eA } = DIP;
  const t = c / 2;
  const Rc = bendR + t; // รัศมีแนวกึ่งกลาง
  const zIn = -(eA - E1) / 2 - 0.35; // ฝังเข้าไปในตัวถังเล็กน้อย (ไม่เห็นรอยต่อ)
  const cy = exitY - Rc; // จุดศูนย์กลางโค้ง (z = −Rc, y = cy)
  // รูปร่างในระนาบ (u, v) = (−z, y) เพื่อให้หมุนรอบแกน y +90° แล้ว extrude กลายเป็นแกน x
  const s = new THREE.Shape();
  const P = (z: number, y: number) => [-z, y] as const;
  s.moveTo(...P(zIn, exitY + t));
  s.lineTo(...P(-Rc, exitY + t));
  const N = 10;
  for (let i = 1; i <= N; i++) { const a = (Math.PI / 2) * (1 - i / N); s.lineTo(...P(-Rc + (Rc + t) * Math.cos(a), cy + (Rc + t) * Math.sin(a))); }
  s.lineTo(...P(t, 0));
  s.lineTo(...P(-t, 0));
  s.lineTo(...P(-t, cy));
  for (let i = 0; i <= N; i++) { const a = (Math.PI / 2) * (i / N); s.lineTo(...P(-Rc + (Rc - t) * Math.cos(a), cy + (Rc - t) * Math.sin(a))); }
  s.lineTo(...P(zIn, exitY - t));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: b1, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -b1 / 2);
  g.rotateY(Math.PI / 2); // (u, v, w) → (x = w, y = v, z = −u) = แนว z ของหน้าตัดเดิม
  g.computeVertexNormals();
  return g;
}

/** ขาส่วนล่าง (เสียบรู): หน้าตรง (x–y) จากบ่ากว้าง b1 ลาดลงเป็นขาแคบ b ยาวถึง L ใต้ระนาบนั่ง ปลายเรียว — หนา c */
function tipGeometry(): THREE.BufferGeometry {
  const { b1, b, c, L } = DIP;
  const s = new THREE.Shape();
  s.moveTo(-b1 / 2, 0.02);
  s.lineTo(b1 / 2, 0.02);
  s.lineTo(b1 / 2, -0.15);
  s.lineTo(b / 2, -0.75);
  s.lineTo(b / 2, -L + 0.35);
  s.lineTo(b / 4, -L);
  s.lineTo(-b / 4, -L);
  s.lineTo(-b / 2, -L + 0.35);
  s.lineTo(-b / 2, -0.75);
  s.lineTo(-b1 / 2, -0.15);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: c, bevelEnabled: false });
  g.translate(0, 0, -c / 2);
  g.computeVertexNormals();
  return g;
}

/** โครงร่างตัวถังมองจากด้านบน (x, −z) มุมโค้งเล็กน้อย พร้อมรอยบากครึ่งวงกลมที่ปลายด้านขา 1 (ถ้า notch) */
function bodyOutline(inset: number, notch: boolean, pins: number): THREE.Shape {
  const { E1, e, notchR } = DIP;
  const D = dipLength(pins);
  const cx = ((pins / 2 - 1) * e) / 2, cz = -DIP.eA / 2;
  const x0 = cx - D / 2 + inset, x1 = cx + D / 2 - inset;
  // รูปร่างในระนาบ (X, Y) = (x, −z) — หมุนรอบ x −90° แล้วแกน extrude เป็น +y
  const y0 = -cz - E1 / 2 + inset, y1 = -cz + E1 / 2 - inset;
  const r = 0.25;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  if (notch) {
    const ym = -cz, nr = notchR + inset; // bevel ขยายขอบออก → รอยบากจะแคบลงเท่า inset
    s.lineTo(x0, ym + nr);
    s.absarc(x0, ym, nr, Math.PI / 2, -Math.PI / 2, true); // เว้าเข้าไปในตัวถัง
  }
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

function bodyPart(yBottom: number, height: number, notch: boolean, pins: number): THREE.BufferGeometry {
  const bev = 0.14;
  const g = new THREE.ExtrudeGeometry(bodyOutline(bev, notch, pins), { depth: height - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 12 });
  g.rotateX(-Math.PI / 2); // (X, Y, Z) → (x = X, y = Z, z = −Y)
  g.translate(0, yBottom + bev, 0);
  g.computeVertexNormals();
  return g;
}

function geometries(pins: number): Geo {
  const hit = geoCache.get(pins);
  if (hit) return hit;
  const { A1, A2, exitY, notchR } = DIP;
  // ผนังโค้งของรอยบาก (ด้านในเว้าลงไปถึงแนวรอยประกบ) — ปิดช่องที่มองเห็นเหนือตัวถังส่วนล่าง
  const wall = new THREE.CylinderGeometry(notchR, notchR, 0.02, 24, 1, false, 0, Math.PI);
  const geo: Geo = {
    lead: shared(leadGeometry()),
    tip: shared(tipGeometry()),
    lower: shared(bodyPart(A1, exitY - A1, false, pins)),
    upper: shared(bodyPart(exitY, A1 + A2 - exitY, pins > 4, pins)), // DIP-4 (ออปโต) ไม่มีรอยบาก มีแค่จุดขา 1
    dimple: shared(new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2)),
    notchWall: shared(wall),
  };
  geoCache.set(pins, geo);
  return geo;
}

const markCache = new Map<string, THREE.Texture>();
/** ข้อความพิมพ์บนตัวถัง (เลเซอร์/หมึกสีเทาอ่อน) — ไม่ใส่โลโก้ผู้ผลิต */
function markTexture(lines: string[], wide = false): THREE.Texture {
  const key = lines.join('|') + (wide ? '|w' : '');
  let t = markCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  // ภาพกว้าง:สูง ต้องตรงกับแผ่นข้อความ (DIP-8 6.6 × 3.3 mm, DIP-14 13 × 4.2 mm) ไม่ให้ตัวอักษรยืด
  const W = wide ? 792 : 512, Hh = 256, mid = W / 2;
  c.width = W; c.height = Hh;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, W, Hh);
  x.fillStyle = 'rgba(214,218,222,0.92)';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '600 92px "Chakra Petch", "Arial Narrow", sans-serif';
  x.fillText(lines[0], mid, lines.length > 1 ? 100 : 128, W - 42);
  if (lines[1]) { x.font = '500 54px "Chakra Petch", sans-serif'; x.fillStyle = 'rgba(200,205,210,0.8)'; x.fillText(lines[1], mid, 186, W - 92); }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  markCache.set(key, t);
  return t;
}

const matCache = new Map<string, THREE.Material>();
const mat = (k: string, f: () => THREE.Material) => { let m = matCache.get(k); if (!m) { m = f(); matCache.set(k, m); } return m; };

/**
 * สร้างโมเดล DIP-8
 * @param pinAt ชื่อขาตามตำแหน่ง (dx 0..3, แถว 0 = ขา 1–4, แถว 1 = ขา 8–5)
 * @param marking ข้อความบนตัวถัง
 */
export function buildDip8(pinAt: (dx: number, row: 0 | 1) => string, marking: string[]): THREE.Group {
  return buildDip(8, pinAt, marking);
}

/** DIP 8 หรือ 14 ขา (300 mil): ขา 1..n/2 แถวหน้า, ขา n/2+1..n แถวหลัง (ขา n ตรงข้ามขา 1) */
export function buildDip(pins: 4 | 8 | 14 | 16, pinAt: (dx: number, row: 0 | 1) => string, marking: string[]): THREE.Group {
  const G = geometries(pins);
  const { e, eA, A1, A2, exitY, notchR } = DIP;
  const D = dipLength(pins), half = pins / 2;
  const root = new THREE.Group(); // หน่วยรู (parent ของทุกชิ้น)
  const g = new THREE.Group(); // หน่วย mm
  g.scale.setScalar(MM);
  root.add(g);

  const epoxy = mat('epoxy', () => new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.62, metalness: 0 }));
  const epoxyDark = mat('epoxyDark', () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.75, side: THREE.DoubleSide }));
  // ขาชุบดีบุก (matte tin): โลหะสีเงินหม่น
  const tin = mat('tin', () => withEnv(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.38, metalness: 1 })));

  const lower = new THREE.Mesh(G.lower, epoxy);
  const upper = new THREE.Mesh(G.upper, epoxy);
  upper.userData.dipBody = true;
  g.add(lower, upper);
  const cx = ((half - 1) * e) / 2, cz = -eA / 2, top = A1 + A2;
  // ผนังรอยบาก + จุดบุ๋มขา 1 (ผิวด้านกว่าเล็กน้อย)
  // รอยบากลึก ~0.55 mm จากผิวบน (ตามแบบ package): เติมเนื้ออีพ็อกซีครึ่งทรงกระบอกใต้รอยบาก
  const notchDepth = 0.55, nTop = top - notchDepth;
  const nx = cx - D / 2;
  const fillH = nTop - exitY;
  // กว้างกว่ารอยบากเล็กน้อยเพื่อปิดขอบมนของตัวถังรอบรอยบาก (ไม่ให้เห็นเป็นร่องแนวตั้ง)
  const fr = notchR + 0.2;
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(fr, fr, fillH, 24, 1, false, 0, Math.PI), epoxy);
  fill.position.set(nx, exitY + fillH / 2, cz);
  const fillFace = new THREE.Mesh(new THREE.PlaneGeometry(2 * fr, fillH).rotateY(-Math.PI / 2), epoxy);
  fillFace.position.set(nx - 0.002, exitY + 0.12 + (fillH - 0.12) / 2, cz);
  fillFace.scale.y = (fillH - 0.12) / fillH;
  const nw = new THREE.Mesh(G.notchWall, epoxyDark);
  nw.scale.set(1, notchDepth / 0.02, 1);
  nw.position.set(nx, nTop + notchDepth / 2, cz);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(notchR, 24, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), epoxyDark);
  floor.position.set(nx, nTop, cz);
  const dimple = new THREE.Mesh(G.dimple, epoxyDark);
  dimple.position.set(0.9, top + 0.012, -1.55); // จุดบุ๋มใกล้มุมขา 1
  if (pins > 4) g.add(fill, fillFace, nw, floor, dimple);
  else { dimple.position.set(-0.1, top + 0.012, -1.45); dimple.scale.setScalar(0.8); g.add(dimple); } // จุดขา 1 ที่มุมใกล้ขา 1

  // ข้อความบนผิวด้านบน (อ่านได้เมื่อรอยบากอยู่ซ้าย ขา 1 ล่างซ้าย)
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(pins >= 14 ? 13 : pins === 4 ? 4.0 : 6.6, pins >= 14 ? 4.2 : pins === 4 ? 2.0 : 3.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: markTexture(marking, pins >= 14), transparent: true, depthWrite: false, toneMapped: false }));
  decal.position.set(pins === 4 ? cx : cx + 0.35, top + 0.015, pins === 4 ? cz - 0.4 : cz + 0.2);
  decal.renderOrder = 2;
  decal.userData.decal = true;
  g.add(decal);

  // ขา 8 ขา: ชิ้นเดียวกันทุกขา (geometry ร่วม) ต่างกันแค่ตำแหน่ง/การหมุน — แถวหลังหมุน 180° รอบแกนตั้ง
  for (let i = 0; i < half; i++) {
    for (const row of [0, 1] as const) {
      const pin = pinAt(i, row);
      const lead = new THREE.Group();
      lead.position.set(i * e, 0, row === 0 ? 0 : -eA);
      lead.rotation.y = row === 0 ? 0 : Math.PI;
      const up = new THREE.Mesh(G.lead, tin);
      const tip = new THREE.Mesh(G.tip, tin);
      tip.userData.leadTip = pin;
      lead.add(up, tip);
      lead.userData.lead = pin;
      g.add(lead);
    }
  }
  root.userData.dipTop = top * MM;
  return root;
}
