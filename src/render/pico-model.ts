import * as THREE from 'three';

/**
 * โมเดล 3 มิติของ Raspberry Pi Pico (RP2040, รุ่นไม่มี Wi-Fi, micro-USB) แบบบัดกรีขา header ตัวผู้ 2 แถว
 *
 * แหล่งอ้างอิงขนาด (หน่วย mm):
 *  - Raspberry Pi Pico Datasheet (RP-008307-DS): บอร์ด 51 × 21 mm หนา 1 mm, รูยึด 4 รู Ø 2.1 mm,
 *    ขา 40 ขา ระยะ 2.54 mm (รู 1 mm) แบบ castellated/through-hole, micro-USB B ยื่นพ้นขอบบน, ขา debug 3 ขาที่ขอบล่าง
 *  - ตำแหน่งขา/ขา debug ตาม footprint RPi_Pico_SMD_TH (แถวขาห่าง 17.78 mm, ขา 1 ห่างขอบ USB 1.37 mm, ห่างขอบข้าง 1.61 mm;
 *    debug ห่างขอบล่าง 1.6 mm ระยะ 2.54 mm)
 *  - ตำแหน่งรูยึด (ห่างขอบปลาย 2.0 mm, ห่างกัน 11.4 × 47 mm) และตำแหน่งชิ้นส่วนบนบอร์ด วัดจากแบบวาดด้านบนของบอร์ดรุ่นนี้
 *    (ตำแหน่งชิ้นส่วนเล็ก เช่น ตัวเก็บประจุ 0402 เป็นค่าประมาณ — ไม่มีผลต่อการต่อวงจร)
 *
 * ระบบพิกัดภายใน: หน่วย mm, จุดกำเนิดที่ขา 1, +x ไปทางขา 20, ขา 21–40 อยู่ที่ z = −17.78 (ห่าง 7 รู),
 * y = 0 คือผิวเบรดบอร์ด — กลุ่มถูกย่อด้วย 1/2.54 ให้เป็นหน่วยรูเหมือนอุปกรณ์อื่น
 * กรอบภาพ "USB ชี้ขึ้น" (u = ระยะจากขอบฝั่งขา 1 ไปทางขวา, v = ระยะจากขอบฝั่ง USB ลงล่าง) ใช้วาด texture
 * และแปลงเป็นพิกัดโลกด้วย x = v − 1.37, z = 1.61 − u (เป็นการหมุน ไม่ใช่การกลับด้าน — ขาเรียงทวนเข็มนาฬิกาเมื่อมองจากด้านบนเหมือนของจริง)
 */

export const MM = 1 / 2.54;

/**
 * แผนที่แสงสะท้อนของสภาพแวดล้อม — ใส่เฉพาะวัสดุโลหะ (ขา, จุดบัดกรี, โล่ USB, แผ่นทอง)
 * ไม่ใส่ทั้งฉาก เพราะการสุ่ม env map ทุกพิกเซลของพื้นผิวขนาดใหญ่ (โต๊ะ เบรดบอร์ด) แพงบนมือถือ
 */
export const SHARED_ENV: { tex: THREE.Texture | null; intensity: number; enabled: boolean } = { tex: null, intensity: 0.55, enabled: true };
export function withEnv<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.userData.wantsEnv = true;
  m.userData.metal = { metalness: m.metalness, roughness: m.roughness };
  m.envMap = SHARED_ENV.enabled ? SHARED_ENV.tex : null;
  m.envMapIntensity = SHARED_ENV.intensity;
  if (!SHARED_ENV.enabled) { m.metalness *= 0.3; m.roughness = Math.max(0.45, m.roughness); } // โหมดประหยัด (ดู SceneView.setQuality)
  return m;
}
const BOARD_L = 51, BOARD_W = 21, PCB_T = 1.0;
const PIN_U = 1.61, PIN_V0 = 1.37, PITCH = 2.54;
/** ความสูงพลาสติกของ header (บอร์ดวางบนพลาสติกนี้) */
export const HEADER_H = 2.5;
/** ความสูงปลายขา header ด้านบน (mm จากผิวเบรดบอร์ด) — จุดที่คีบสาย/โพรบเมื่อต่อเข้าขาโดยตรง */
export const PICO_PIN_TOP_MM = HEADER_H + 1.0 + 1.6;
const PCB_BOTTOM = HEADER_H, PCB_TOP = HEADER_H + PCB_T;
const TEX_K = 40; // พิกเซลต่อ mm ของ texture ผิวบอร์ด

const wx = (v: number) => v - PIN_V0;
const wz = (u: number) => PIN_U - u;

/** ตำแหน่ง (u, v) ของขา 1–40 */
export function picoPinUV(pin: number): [number, number] {
  return pin <= 20 ? [PIN_U, PIN_V0 + (pin - 1) * PITCH] : [BOARD_W - PIN_U, PIN_V0 + (40 - pin) * PITCH];
}
const GND_PINS = new Set([3, 8, 13, 18, 23, 28, 33, 38]);
const MOUNT_HOLES: Array<[number, number]> = [[4.8, 2.0], [16.2, 2.0], [4.8, 49.0], [16.2, 49.0]];
const DEBUG_PADS: Array<[number, number, string]> = [[10.5 - 2.54, 49.4, 'SWCLK'], [10.5, 49.4, 'GND'], [10.5 + 2.54, 49.4, 'SWDIO']];

/* ---------------- texture ผิวบอร์ด (สี + ค่าความโลหะ/ความหยาบ) ---------------- */

interface PicoTextures { color: THREE.CanvasTexture; orm: THREE.CanvasTexture; chip: THREE.CanvasTexture; shadow: THREE.CanvasTexture }
let texCache: PicoTextures | null = null;

const MASK = '#0d6a39';
const MASK_DARK = '#0a5a30';
const COPPER_UNDER = '#127a44';
const GOLD = '#d7b062';
const SILK = '#f4f6f2';

function boardCanvas(): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.round(BOARD_L * TEX_K);
  c.height = Math.round(BOARD_W * TEX_K);
  const x = c.getContext('2d')!;
  // วาดในกรอบ "USB ชี้ขึ้น" (u, v) mm → canvas: X = K·v, Y = K·(21 − u)
  x.setTransform(0, -TEX_K, TEX_K, 0, 0, BOARD_W * TEX_K);
  return { c, x };
}

/** รูปทรงแผ่นทองแดงของขาแต่ละขา: รูที่ระยะ 1.61 mm + แผ่นยาวถึงขอบที่มีรูครึ่งวงกลม (castellation) */
function padPath(x: CanvasRenderingContext2D, pin: number, grow = 0) {
  const [u, v] = picoPinUV(pin);
  const left = pin <= 20;
  const edge = left ? 0 : BOARD_W;
  const r = 0.85 + grow, h = 0.8 + grow;
  x.beginPath();
  if (GND_PINS.has(pin)) {
    // ขา GND: แผ่นปลายเหลี่ยม (เหมือนบอร์ดจริง)
    const u0 = left ? edge : u - r, u1 = left ? u + r : edge;
    x.rect(u0, v - h, u1 - u0, 2 * h);
  } else {
    x.arc(u, v, r, 0, Math.PI * 2);
    const u0 = left ? edge : u, u1 = left ? u : edge;
    x.rect(u0, v - h, u1 - u0, 2 * h);
  }
}

function drawText(x: CanvasRenderingContext2D, s: string, u: number, v: number, size: number, rot = 0, align: CanvasTextAlign = 'center', weight = 500, spacing = 0) {
  x.save();
  x.translate(u, v);
  x.rotate(rot);
  x.font = `${weight} ${size}px "IBM Plex Sans", "Chakra Petch", sans-serif`;
  x.textAlign = align;
  x.textBaseline = 'middle';
  if (spacing) (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  x.fillText(s, 0, 0);
  x.restore();
}

/** ชิ้นส่วนเล็ก (passive 0402/0603) — ตำแหน่ง (u, v, มุม, ชนิด) โดยประมาณรอบชิปตามบอร์ดจริง */
export const SMALL_PARTS: Array<[number, number, number, 'c' | 'r']> = [
  [6.2, 21.3, 0, 'c'], [6.2, 22.6, 0, 'c'], [6.2, 28.0, 0, 'c'], [6.2, 29.3, 0, 'r'], [14.7, 21.6, 0, 'c'], [14.7, 23.0, 0, 'c'],
  [14.7, 27.8, 0, 'c'], [14.7, 29.1, 0, 'r'], [8.6, 30.4, 1, 'c'], [12.3, 30.4, 1, 'c'], [10.4, 30.6, 1, 'r'], [8.4, 20.3, 1, 'c'],
  [12.5, 20.3, 1, 'r'], [5.7, 36.3, 1, 'c'], [10.8, 34.2, 0, 'c'], [11.8, 15.4, 1, 'c'], [13.3, 14.0, 0, 'c'], [17.4, 14.2, 0, 'c'],
  [13.4, 7.4, 1, 'r'], [15.0, 7.4, 1, 'r'], [8.3, 15.9, 1, 'c'], [4.7, 18.6, 0, 'r'], [9.0, 18.3, 0, 'c'], [16.6, 16.4, 1, 'r'],
];

function makeTextures(): PicoTextures {
  // --- สี ---
  const { c, x } = boardCanvas();
  x.fillStyle = MASK;
  x.fillRect(0, 0, BOARD_W, BOARD_L);
  // ลายวงจรใต้ solder mask (เห็นเป็นเส้นสีอ่อนกว่าเล็กน้อย) — แสดงลักษณะการเดินลาย ไม่ใช่ลายจริงทุกเส้น
  x.strokeStyle = COPPER_UNDER;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.lineWidth = 0.2;
  const chipU = 10.43, chipV = 25.35;
  for (let pin = 2; pin <= 39; pin++) {
    if (GND_PINS.has(pin) || pin === 20 || pin === 21) continue;
    const [u, v] = picoPinUV(pin);
    const left = pin <= 20;
    const side = left ? -1 : 1;
    const tu = chipU + side * 4.2, tv = chipV + (v - chipV) * 0.42;
    x.beginPath();
    x.moveTo(u + (left ? 0.9 : -0.9), v);
    x.lineTo(u + (left ? 1.8 : -1.8), v);
    x.lineTo(tu - side * 0.0, tv + (v > chipV ? 0.3 : -0.3));
    x.lineTo(chipU + side * 3.6, tv);
    x.stroke();
  }
  x.lineWidth = 0.35;
  x.beginPath(); x.moveTo(10.45, 4.2); x.lineTo(10.45, 8.5); x.lineTo(12.5, 10.4); x.stroke(); // VBUS → regulator
  x.beginPath(); x.moveTo(14.5, 12.0); x.lineTo(14.5, 18.5); x.lineTo(13.0, 21.6); x.stroke(); // 3V3
  x.beginPath(); x.moveTo(6.7, 20.0); x.lineTo(6.7, 22.0); x.lineTo(7.0, 23.0); x.stroke(); // flash
  x.beginPath(); x.moveTo(8.1, 33.2); x.lineTo(9.0, 29.0); x.stroke(); // crystal
  // ช่องว่าง (ground pour) เป็นบล็อกสีเข้มเล็กน้อย
  x.fillStyle = MASK_DARK;
  x.globalAlpha = 0.35;
  x.fillRect(3.4, 38.0, 14.2, 9.0);
  x.globalAlpha = 1;

  // แผ่นทองแดงชุบทอง (ENIG): ขา, รูยึด, ขา debug, test point
  const padsDraw = (ctx: CanvasRenderingContext2D, fill: string) => {
    ctx.fillStyle = fill;
    for (let pin = 1; pin <= 40; pin++) { padPath(ctx, pin); ctx.fill(); }
    for (const [u, v] of MOUNT_HOLES) { ctx.beginPath(); ctx.arc(u, v, 1.75, 0, Math.PI * 2); ctx.fill(); }
    for (const [u, v, name] of DEBUG_PADS) {
      ctx.beginPath();
      if (name === 'GND') ctx.rect(u - 0.8, v - 0.8, 1.6, 1.6); else ctx.arc(u, v, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [u, v] of [[4.72, 7.19], [16.43, 44.7]]) { ctx.beginPath(); ctx.arc(u, v, 0.5, 0, Math.PI * 2); ctx.fill(); }
    // แผ่นบัดกรีของชิ้นส่วน (มองเห็นรอบตัวชิ้นส่วน)
    for (const [u, v, rot] of SMALL_PARTS) {
      const [du, dv] = rot ? [0, 0.42] : [0.42, 0];
      for (const s of [-1, 1]) ctx.fillRect(u + s * du - 0.28, v + s * dv - 0.28, 0.56, 0.56);
    }
    // ขา QFN รอบ RP2040 (14 ขาต่อด้าน ระยะ 0.4 mm)
    for (let i = 0; i < 14; i++) {
      const o = -2.6 + i * 0.4;
      ctx.fillRect(chipU + o - 0.1, chipV - 3.85, 0.2, 0.55);
      ctx.fillRect(chipU + o - 0.1, chipV + 3.3, 0.2, 0.55);
      ctx.fillRect(chipU - 3.85, chipV + o - 0.1, 0.55, 0.2);
      ctx.fillRect(chipU + 3.3, chipV + o - 0.1, 0.55, 0.2);
    }
    // แผ่นของ USB (ขาโล่ 4 จุด) และ BOOTSEL
    for (const [u, v] of [[6.95, 1.8], [13.95, 1.8], [7.2, 4.6], [13.7, 4.6]]) ctx.fillRect(u - 0.7, v - 0.6, 1.4, 1.2);
    for (const [u, v] of [[5.0, 9.6], [8.9, 9.6], [5.0, 13.4], [8.9, 13.4]]) ctx.fillRect(u - 0.45, v - 0.45, 0.9, 0.9);
  };
  padsDraw(x, GOLD);
  // รูทะลุ (มองเห็นเป็นวงสีเข้มบน texture ด้วย เผื่อมุมที่ geometry ของรูเล็กกว่าพิกเซล)
  x.fillStyle = '#1b1a14';
  for (let pin = 1; pin <= 40; pin++) { const [u, v] = picoPinUV(pin); x.beginPath(); x.arc(u, v, 0.5, 0, Math.PI * 2); x.fill(); }
  for (const [u, v] of DEBUG_PADS) { x.beginPath(); x.arc(u, v, 0.5, 0, Math.PI * 2); x.fill(); }

  // ลายสกรีนสีขาว (ข้อความตามบอร์ดจริงด้านบน)
  x.fillStyle = SILK;
  x.strokeStyle = SILK;
  drawText(x, '1', 2.95, 1.45, 1.1, 0, 'left');
  drawText(x, '2', 2.95, 3.99, 1.1, 0, 'left');
  drawText(x, '39', 18.05, 3.99, 1.1, 0, 'right', 500, 0.15);
  drawText(x, 'LED', 4.72, 5.75, 0.95, 0, 'center', 500, 0.18);
  drawText(x, 'USB', 10.45, 5.75, 0.95, 0, 'center', 500, 0.25);
  drawText(x, 'BOOTSEL', 4.55, 11.6, 0.95, -Math.PI / 2, 'center', 500, 0.2);
  drawText(x, 'Raspberry Pi Pico  © 2020', 4.0, 33.9, 1.2, -Math.PI / 2, 'center', 500, 0.42);
  drawText(x, 'DEBUG', 10.5, 47.75, 0.85, 0, 'center', 600, 0.15);
  // เส้นกรอบ silkscreen รอบ BOOTSEL และตัวชิ้นส่วน
  x.lineWidth = 0.12;
  x.strokeRect(5.3, 9.4, 3.3, 4.2);
  x.strokeRect(12.0, 9.1, 2.6, 2.6);
  // จุดบอกขา 1 ของ RP2040
  x.beginPath(); x.arc(chipU - 4.25, chipV - 4.25, 0.25, 0, Math.PI * 2); x.fill();

  // --- ความโลหะ (B) / ความหยาบ (G): ผิว solder mask = ไม่ใช่โลหะ ค่อนข้างเรียบ, แผ่นทอง = โลหะ ---
  const { c: c2, x: x2 } = boardCanvas();
  x2.fillStyle = 'rgb(0,118,0)'; // roughness ≈ 0.46
  x2.fillRect(0, 0, BOARD_W, BOARD_L);
  padsDraw(x2, 'rgb(0,90,255)'); // roughness ≈ 0.35, metalness 1
  x2.fillStyle = 'rgb(0,150,0)';
  for (let pin = 1; pin <= 40; pin++) { const [u, v] = picoPinUV(pin); x2.beginPath(); x2.arc(u, v, 0.5, 0, Math.PI * 2); x2.fill(); }

  // --- ข้อความเลเซอร์บน RP2040 ---
  const cc = document.createElement('canvas');
  cc.width = cc.height = 512;
  const xc = cc.getContext('2d')!;
  xc.fillStyle = '#26272a';
  xc.fillRect(0, 0, 512, 512);
  xc.fillStyle = '#3a3c40';
  xc.font = '600 46px "IBM Plex Sans", sans-serif';
  xc.textAlign = 'center';
  xc.fillText('RP2-B2', 256, 330);
  xc.font = '500 38px "IBM Plex Sans", sans-serif';
  xc.fillText('21/32', 256, 382);
  xc.fillText('P64M15.00', 256, 430);
  xc.beginPath(); xc.arc(52, 52, 16, 0, Math.PI * 2); xc.fill(); // จุดขา 1

  // --- เงาสัมผัสใต้บอร์ด ---
  const sc = document.createElement('canvas');
  sc.width = 256; sc.height = 128;
  const xs = sc.getContext('2d')!;
  xs.filter = 'blur(10px)';
  xs.fillStyle = 'rgba(0,0,0,0.85)';
  xs.fillRect(22, 20, 212, 88);
  xs.filter = 'none';

  const color = new THREE.CanvasTexture(c);
  color.colorSpace = THREE.SRGBColorSpace;
  const orm = new THREE.CanvasTexture(c2);
  const chip = new THREE.CanvasTexture(cc);
  chip.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.CanvasTexture(sc);
  for (const t of [color, orm]) {
    // พิกัดผิว PCB (shape x = v − 1.37, y = z = 1.61 − u) → uv ของ canvas
    t.repeat.set(1 / BOARD_L, -1 / BOARD_W);
    t.offset.set(PIN_V0 / BOARD_L, PIN_U / BOARD_W);
    t.anisotropy = 8;
  }
  return (texCache = { color, orm, chip, shadow });
}

/* ---------------- วัสดุ (ใช้ร่วมกันทุกบอร์ด) ---------------- */

interface PicoMaterials { [k: string]: THREE.Material }
let matCache: PicoMaterials | null = null;
function materials(): PicoMaterials {
  if (matCache) return matCache;
  const t = texCache ?? makeTextures();
  matCache = {
    // solder mask: ผิวเรียบสะท้อนแสงเล็กน้อย (roughness ≈ 0.46 จาก texture) — ไม่ใช้ clearcoat เพื่อประหยัดบนมือถือ
    pcbTop: withEnv(new THREE.MeshStandardMaterial({ map: t.color, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1 })),
    pcbEdge: new THREE.MeshStandardMaterial({ color: 0xb5b98e, roughness: 0.85 }),
    gold: withEnv(new THREE.MeshStandardMaterial({ color: 0xd9b263, roughness: 0.32, metalness: 1, side: THREE.DoubleSide })),
    chip: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.82 }),
    chipTop: new THREE.MeshStandardMaterial({ map: t.chip, roughness: 0.78 }),
    lead: withEnv(new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.3, metalness: 1 })),
    tin: withEnv(new THREE.MeshStandardMaterial({ color: 0xd2d5d9, roughness: 0.22, metalness: 1 })),
    solder: withEnv(new THREE.MeshStandardMaterial({ color: 0xc6c9cc, roughness: 0.18, metalness: 1 })),
    shell: withEnv(new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.3, metalness: 1 })),
    plasticBlack: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.62 }),
    plasticWhite: new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.55 }),
    crystal: withEnv(new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.42, metalness: 1 })),
    capBody: new THREE.MeshStandardMaterial({ color: 0xa88d66, roughness: 0.6 }),
    resBody: new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.7 }),
    inductor: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.9 }),
    shadow: new THREE.MeshBasicMaterial({ map: t.shadow, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  return matCache;
}

/* ---------------- geometry (ใช้ร่วมกันทุกบอร์ด) ---------------- */

interface PicoGeoms { [k: string]: THREE.BufferGeometry }
let geoCache: PicoGeoms | null = null;
const shared = <T extends THREE.BufferGeometry>(g: T): T => { g.userData.shared = true; return g; };

function pcbGeometry(): THREE.BufferGeometry {
  // รูปทรงแผ่น PCB ในพิกัด shape (sx = v − 1.37, sy = 1.61 − u) พร้อมรู castellation ครึ่งวง, รูขา, รูยึด, รู debug
  const s = new THREE.Shape();
  const X0 = wx(0), X1 = wx(BOARD_L), Zn = wz(0), Zf = wz(BOARD_W); // Zn = ขอบฝั่งขา 1 (z บวก), Zf = ขอบฝั่งขา 40
  const R = 0.5; // มุมโค้งเล็กน้อยของบอร์ด
  const castR = 0.55;
  s.moveTo(X0 + R, Zn);
  // ขอบฝั่งขา 1–20 (z = Zn): เดินจาก USB ไปขา 20 พร้อมเว้าครึ่งวงกลมที่ทุกขา
  for (let k = 0; k < 20; k++) {
    const cx = k * PITCH;
    s.lineTo(cx - castR, Zn);
    s.absarc(cx, Zn, castR, Math.PI, 0, false);
  }
  s.lineTo(X1 - R, Zn);
  s.quadraticCurveTo(X1, Zn, X1, Zn - R);
  s.lineTo(X1, Zf + R);
  s.quadraticCurveTo(X1, Zf, X1 - R, Zf);
  for (let k = 19; k >= 0; k--) {
    const cx = k * PITCH;
    s.lineTo(cx + castR, Zf);
    s.absarc(cx, Zf, castR, 0, Math.PI, false);
  }
  s.lineTo(X0 + R, Zf);
  s.quadraticCurveTo(X0, Zf, X0, Zf + R);
  s.lineTo(X0, Zn - R);
  s.quadraticCurveTo(X0, Zn, X0 + R, Zn);
  const hole = (u: number, v: number, r: number) => { const p = new THREE.Path(); p.absarc(wx(v), wz(u), r, 0, Math.PI * 2, true); s.holes.push(p); };
  for (let pin = 1; pin <= 40; pin++) { const [u, v] = picoPinUV(pin); hole(u, v, 0.5); }
  for (const [u, v] of MOUNT_HOLES) hole(u, v, 1.05);
  for (const [u, v] of DEBUG_PADS) hole(u, v, 0.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: PCB_T, bevelEnabled: false, curveSegments: 10 });
  // shape (x, y) อยู่บนระนาบ XY → หมุนให้ y ของ shape เป็น z ของโลก และความหนาเป็นแกน y
  g.rotateX(Math.PI / 2);
  g.translate(0, PCB_TOP, 0);
  return g;
}

function geoms(): PicoGeoms {
  if (geoCache) return geoCache;
  const castCyl = new THREE.CylinderGeometry(0.55, 0.55, PCB_T * 1.002, 10, 1, true, 0, Math.PI);
  const pin = new THREE.BoxGeometry(0.64, 1, 0.64);
  pin.translate(0, 0.5, 0);
  geoCache = {
    pcb: shared(pcbGeometry()),
    castell: shared(castCyl),
    ring: shared(new THREE.CylinderGeometry(0.5, 0.5, PCB_T * 1.004, 10, 1, true)),
    pin: shared(pin),
    // ปลายขาลบมุม (chamfer) แบบ header ทั่วไป
    tip: shared(new THREE.CylinderGeometry(0.2, 0.45, 0.22, 4, 1).rotateY(Math.PI / 4)),
    // จุดบัดกรี: โปรไฟล์เว้า (meniscus) จากขอบแผ่นทองไต่ขึ้นไปหุ้มขา
    fillet: shared(new THREE.LatheGeometry(Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      return new THREE.Vector2(0.36 + 0.42 * (1 - t) ** 2.2, 0.5 * t);
    }), 16)),
    headerCell: shared(new THREE.BoxGeometry(2.38, HEADER_H, 2.42)),
    box: shared(new THREE.BoxGeometry(1, 1, 1)),
    cyl: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)),
    usbShell: shared(usbShellGeometry(5.3, 7.5, 2.6, 0.25)),
    usbMouth: shared(usbMouthGeometry(6.6, 1.9)),
  };
  return geoCache;
}

/**
 * หน้าตัดของโล่ micro-USB B: สี่เหลี่ยมคางหมู (ขอบล่างแคบ มุมบนโค้ง) ยาวตามแกน x (ทิศเสียบสาย)
 * w = ความกว้างด้านบน, h = ความสูง, t = ความหนาโลหะ — ทำเป็นท่อกลวงจึงเห็นช่องเสียบจริงจากปลาย
 */
function trapezoid(w: number, h: number, inset = 0): THREE.Shape {
  const s = new THREE.Shape();
  const wt = w / 2 - inset, wb = w / 2 - 0.9 - inset, y0 = inset, y1 = h - inset, r = 0.5;
  s.moveTo(-wb, y0);
  s.lineTo(wb, y0);
  s.lineTo(wt, y0 + 0.9);
  s.lineTo(wt, y1 - r);
  s.quadraticCurveTo(wt, y1, wt - r, y1);
  s.lineTo(-wt + r, y1);
  s.quadraticCurveTo(-wt, y1, -wt, y1 - r);
  s.lineTo(-wt, y0 + 0.9);
  s.closePath();
  return s;
}
function usbShellGeometry(len: number, w: number, h: number, t: number): THREE.BufferGeometry {
  const outer = trapezoid(w, h);
  outer.holes.push(new THREE.Path(trapezoid(w, h, t).getPoints(12).reverse()));
  const g = new THREE.ExtrudeGeometry(outer, { depth: len, bevelEnabled: false, curveSegments: 6 });
  // หน้าตัดบนระนาบ XY (x = ความกว้าง, y = ความสูง) ยาวตาม z → หมุนให้ยาวตาม +x ของโลก ความกว้างตามแกน z
  g.rotateY(Math.PI / 2);
  return g;
}
function usbMouthGeometry(w: number, h: number): THREE.BufferGeometry {
  // ผนังพลาสติกด้านในลึกเข้าไปจากปากช่อง 3 mm (มองเห็นเป็นช่องมืด)
  const g = new THREE.ShapeGeometry(trapezoid(w + 0.4, h + 0.6, 0.25));
  g.rotateY(-Math.PI / 2);
  g.translate(3.0, 0.08, 0);
  return g;
}

/* ---------------- ประกอบ ---------------- */

/** วาง instance หลายตัวของ geometry เดียว (ลด draw call) */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: THREE.Matrix4[]): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => m.setMatrixAt(i, it));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}
const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

/** กล่องชิ้นส่วนบนบอร์ด ที่ตำแหน่ง (u, v) ขนาด du × dv (กรอบ USB ชี้ขึ้น) สูง h */
function partBox(mat: THREE.Material | THREE.Material[], u: number, v: number, du: number, dv: number, h: number, y0 = PCB_TOP): THREE.Mesh {
  const m = new THREE.Mesh(geoms().box, mat);
  m.scale.set(dv, h, du); // แกน v → x, แกน u → z
  m.position.set(wx(v), y0 + h / 2, wz(u));
  return m;
}

export function buildPicoModel(): THREE.Group {
  const M = materials();
  const G = geoms();
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  root.add(g);

  // PCB: ผิวบน (texture + แผ่นทองแบบโลหะ) / ขอบ FR-4
  const pcb = new THREE.Mesh(G.pcb, [M.pcbTop, M.pcbEdge]);
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  g.add(pcb);

  // ผนังรู castellation และรูขา (ชุบทอง)
  const cast: THREE.Matrix4[] = [], rings: THREE.Matrix4[] = [];
  for (let pin = 1; pin <= 40; pin++) {
    const [u, v] = picoPinUV(pin);
    const near = pin <= 20;
    cast.push(T(wx(v), PCB_BOTTOM + PCB_T / 2, wz(near ? 0 : BOARD_W), 1, 1, 1, near ? Math.PI / 2 : -Math.PI / 2));
    rings.push(T(wx(v), PCB_BOTTOM + PCB_T / 2, wz(u)));
  }
  for (const [u, v] of DEBUG_PADS) rings.push(T(wx(v), PCB_BOTTOM + PCB_T / 2, wz(u)));
  for (const [u, v] of MOUNT_HOLES) rings.push(T(wx(v), PCB_BOTTOM + PCB_T / 2, wz(u), 2.1, 1, 2.1));
  g.add(instanced(G.castell, M.gold, cast), instanced(G.ring, M.gold, rings));

  // header ตัวผู้ 2 แถว: พลาสติกดำใต้บอร์ด (แยกช่องละขา), ขาโลหะเสียบลงรูเบรดบอร์ด, จุดบัดกรีบนแผ่นทอง
  const cells: THREE.Matrix4[] = [], pins: THREE.Matrix4[] = [], tips: THREE.Matrix4[] = [], fillets: THREE.Matrix4[] = [];
  const PIN_BOTTOM = -3.0, PIN_TOP = PCB_TOP + 1.6;
  for (let pin = 1; pin <= 40; pin++) {
    const [u, v] = picoPinUV(pin);
    const x = wx(v), z = wz(u);
    cells.push(T(x, HEADER_H / 2, z));
    pins.push(T(x, PIN_BOTTOM, z, 1, PIN_TOP - PIN_BOTTOM - 0.22, 1));
    tips.push(T(x, PIN_TOP - 0.11, z, 1, 1, 1));
    fillets.push(T(x, PCB_TOP, z));
  }
  const header = instanced(G.headerCell, M.plasticBlack, cells);
  header.castShadow = true;
  const pinMesh = instanced(G.pin, M.tin, pins);
  pinMesh.castShadow = true;
  g.add(header, pinMesh, instanced(G.tip, M.tin, tips), instanced(G.fillet, M.solder, fillets));

  // micro-USB B (ยื่นพ้นขอบ 1.3 mm): โล่โลหะ + ช่องเสียบ + ลิ้นพลาสติก + ขาโล่บัดกรี
  const usbV0 = -1.3; // โล่ยาว 5.3 mm ถึง v = 4.0
  const usb = new THREE.Mesh(G.usbShell, M.shell);
  usb.position.set(wx(usbV0), PCB_TOP, wz(10.45));
  usb.castShadow = true;
  const mouth = new THREE.Mesh(G.usbMouth, M.plasticBlack);
  mouth.position.set(wx(usbV0) - 0.01, PCB_TOP, wz(10.45));
  const tongue = partBox(M.plasticBlack, 10.45, usbV0 + 1.2, 3.9, 2.0, 0.4, PCB_TOP + 1.05);
  const tabs = [[6.95, 1.8], [13.95, 1.8], [7.2, 4.6], [13.7, 4.6]].map(([u, v]) => partBox(M.shell, u, v, 0.5, 1.0, 0.5));
  g.add(usb, mouth, tongue, ...tabs);

  // BOOTSEL: ฐานโลหะ + ปุ่มพลาสติกขาว
  const btnBase = partBox(M.shell, 6.94, 11.5, 3.0, 4.0, 0.9);
  const btn = new THREE.Mesh(G.cyl, M.plasticWhite);
  btn.scale.set(1.9, 0.5, 1.9);
  btn.position.set(wx(11.5), PCB_TOP + 1.12, wz(6.94));
  g.add(btnBase, btn);

  // LED (GP25) แบบ 0603: ตัวขาวขุ่น + ขั้วโลหะ — สว่างตามสถานะขาเมื่อจำลอง
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xe9f2e6, emissive: new THREE.Color(0x38ff63), emissiveIntensity: 0, roughness: 0.35 });
  const led = partBox(ledMat, 4.72, 4.52, 0.8, 1.0, 0.45);
  const ledEnds = [-0.65, 0.65].map((d) => partBox(M.lead, 4.72, 4.52 + d, 0.8, 0.3, 0.42));
  g.add(led, ...ledEnds);

  // ชิป: RP2040 (QFN-56 7×7), แฟลช W25Q16JV, ตัวคุมแรงดัน RT6150 + ตัวเหนี่ยวนำ, ไดโอด, คริสตัล 12 MHz (ABM8 3.2×2.5)
  const rp = partBox([M.chip, M.chip, M.chipTop, M.chip, M.chip, M.chip], 10.43, 25.35, 7.0, 7.0, 0.9);
  rp.castShadow = true;
  rp.rotation.y = Math.PI / 2; // ให้ตัวหนังสืออ่านได้ในกรอบ USB ชี้ขึ้น (เหมือนบอร์ดจริง)
  rp.scale.set(7.0, 0.9, 7.0);
  const flash = partBox(M.chip, 6.69, 18.52, 2.0, 3.0, 0.55);
  const reg = partBox(M.chip, 13.27, 10.4, 2.4, 2.4, 0.75);
  const ind = partBox(M.inductor, 16.35, 10.4, 2.0, 2.4, 1.0);
  const diode = partBox(M.chip, 16.3, 6.1, 1.5, 2.5, 1.0);
  const xtal = partBox(M.crystal, 8.09, 34.2, 3.2, 2.5, 0.75);
  const xtalBase = partBox(M.chip, 8.09, 34.2, 3.25, 2.55, 0.12);
  g.add(rp, flash, reg, ind, diode, xtal, xtalBase);
  for (const m of [flash, reg, ind, diode, xtal]) m.castShadow = true;
  // ขาโลหะเล็ก ๆ ของไดโอดและตัวคุมแรงดัน
  g.add(partBox(M.lead, 16.3, 4.8, 0.9, 0.5, 0.3), partBox(M.lead, 16.3, 7.4, 0.9, 0.5, 0.3));

  // ชิ้นส่วน passive ขนาดเล็ก (instanced 2 ชุด + ขั้วโลหะ)
  const caps: THREE.Matrix4[] = [], ress: THREE.Matrix4[] = [], ends: THREE.Matrix4[] = [];
  for (const [u, v, rot, kind] of SMALL_PARTS) {
    const ry = rot ? Math.PI / 2 : 0;
    const body = T(wx(v), PCB_TOP + 0.25, wz(u), 1.0, 0.5, 0.5, ry + Math.PI / 2);
    (kind === 'c' ? caps : ress).push(body);
    for (const s of [-1, 1]) {
      const [du, dv] = rot ? [0, 0.42] : [0.42, 0];
      ends.push(T(wx(v + s * dv), PCB_TOP + 0.25, wz(u + s * du), 0.2, 0.52, 0.52, ry + Math.PI / 2));
    }
  }
  g.add(instanced(G.box, M.capBody, caps), instanced(G.box, M.resBody, ress), instanced(G.box, M.lead, ends));

  // เงาสัมผัสบนเบรดบอร์ด (นุ่ม ไม่ดำทึบ) — เสริมเงาจากแสงหลักให้ดูวางอยู่จริง
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_L + 6, BOARD_W + 6), M.shadow);
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(wx(BOARD_L / 2), 0.04, wz(BOARD_W / 2));
  sh.renderOrder = 1;
  sh.userData.noPick = true;
  sh.userData.contactShadow = true;
  sh.raycast = () => {};
  g.add(sh);

  // ไฟ LED ฟุ้ง
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x3cff6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  glow.position.set(wx(4.52), PCB_TOP + 1.2, wz(4.72));
  glow.scale.set(6, 6, 1);
  glow.userData.glow = true;
  g.add(glow);
  root.userData.picoLed = ledMat;
  root.userData.picoGlow = glow;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== sh) o.receiveShadow = true; });
  return root;
}

let glowCache: THREE.Texture | null = null;
function glowTex(): THREE.Texture {
  if (glowCache) return glowCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  return (glowCache = new THREE.CanvasTexture(c));
}

/* ---------------- ป้ายชื่อขา (ตัวช่วยในแอป — ไม่ใช่ลายสกรีน) ---------------- */

/**
 * ป้ายชื่อขาบนบอร์ดจริงพิมพ์อยู่ด้านล่าง จึงมองไม่เห็นเมื่อเสียบเบรดบอร์ด
 * แอปจึงแสดงป้ายลอยข้างแถวขา (เฉพาะเมื่อเลือกบอร์ด) เพื่อช่วยฝึกต่อวงจร — สีต่างจากลายสกรีนชัดเจน
 */
export function buildPinLabelOverlay(pinout: string[]): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(MM);
  const K = 24; // px/mm
  const L = BOARD_L;
  const mk = (near: boolean) => {
    const c = document.createElement('canvas');
    c.width = Math.round(L * K);
    c.height = Math.round(5 * K);
    const x = c.getContext('2d')!;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (let k = 0; k < 20; k++) {
      const pin = near ? k + 1 : 40 - k;
      const name = pinout[pin - 1].replace(/\.\d+$/, '');
      const cx = (PIN_V0 + k * PITCH) * K;
      const gnd = name.includes('GND');
      const power = ['3V3', 'VBUS', 'VSYS', '3V3_EN', 'ADC_VREF', 'RUN'].includes(name);
      x.fillStyle = gnd ? 'rgba(30,32,34,0.88)' : power ? 'rgba(170,40,32,0.9)' : 'rgba(18,70,140,0.9)';
      const w = 2.3 * K, h = 4.4 * K;
      x.beginPath();
      x.roundRect(cx - w / 2, (5 * K - h) / 2, w, h, 0.4 * K);
      x.fill();
      x.fillStyle = '#ffffff';
      x.save();
      x.translate(cx, 2.5 * K);
      x.rotate(-Math.PI / 2);
      x.font = `600 ${name.length > 4 ? 0.95 * K : 1.15 * K}px "Chakra Petch", sans-serif`;
      x.fillText(name, 0, -0.45 * K);
      x.font = `500 ${0.75 * K}px "Chakra Petch", sans-serif`;
      x.fillText(String(pin), 0, 0.75 * K);
      x.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 5), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    m.rotation.x = -Math.PI / 2;
    // แถวขา 1–20 อยู่ฝั่ง z บวก ป้ายอยู่นอกขอบบอร์ด (ห่างขาราว 2 รู)
    m.position.set(wx(L / 2), 0.9, near ? 2.54 * 2.1 : -17.78 - 2.54 * 2.1);
    m.renderOrder = 10; // วาดทับวงไฮไลต์รูที่เชื่อมถึงกัน
    m.userData.noPick = true;
    m.raycast = () => {};
    return m;
  };
  g.add(mk(true), mk(false));
  g.userData.noPick = true;
  return g;
}
