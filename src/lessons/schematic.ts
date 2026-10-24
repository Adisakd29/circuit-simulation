/**
 * รูปวงจร (schematic) ของแลป — วาดเป็น SVG จากรายการสัญลักษณ์ที่กำหนดพิกัดเอง (หน่วยพิกเซล บนกริด 10 px)
 *
 * หลักการ:
 * - อุปกรณ์สองขา (R, C, D, LED, แหล่งจ่าย, สวิตช์ …) วางระหว่างจุดปลายสองจุดที่อยู่แนวเดียวกัน (แนวนอนหรือแนวตั้ง)
 *   ตัวสัญลักษณ์อยู่กลาง ส่วนที่เหลือเป็นเส้นขา — จุดปลายจึงใช้ต่อสายได้ตรง ๆ
 * - อุปกรณ์หลายขา (ทรานซิสเตอร์ ออปแอมป์ ไอซี) มีตำแหน่งขาที่คำนวณได้ (ฟังก์ชัน *Pins) ให้ต่อสายตรงกับขา
 * - สีทั้งหมดใช้ currentColor (ตามธีมของแผง) ยกเว้นสีเน้นที่ส่งผ่าน CSS variable
 * - ใช้ได้ทั้งในเบราว์เซอร์ (innerHTML) และในเทสต์ (สตริง) — ไม่พึ่ง DOM
 */

export type Pt = [number, number];
export type Side = 't' | 'b' | 'l' | 'r';

export type Item =
  | { t: 'w'; p: Pt[]; dash?: boolean }
  | { t: 'dot'; at: Pt }
  | { t: 'txt'; at: Pt; s: string; a?: 'start' | 'middle' | 'end'; size?: number; bold?: boolean; muted?: boolean }
  | { t: '2'; k: TwoKind; a: Pt; b: Pt; label?: string; value?: string; side?: Side; pol?: boolean }
  | { t: 'gnd'; at: Pt; label?: string }
  | { t: 'vcc'; at: Pt; s: string }
  | { t: 'flag'; at: Pt; s: string; dir?: 'l' | 'r' }
  | { t: 'npn'; at: Pt; label?: string; value?: string; flip?: boolean }
  | { t: 'darl'; at: Pt; label?: string; value?: string }
  | { t: 'nmos'; at: Pt; label?: string; value?: string }
  | { t: 'opamp'; at: Pt; label?: string; value?: string; plusTop?: boolean; supply?: boolean }
  | { t: 'pot'; a: Pt; b: Pt; label?: string; value?: string }
  | { t: 'ic'; at: Pt; w: number; h: number; title: string; sub?: string; pins: IcPin[] }
  | { t: 'gate'; at: Pt; op: 'and' | 'or'; label?: string }
  | { t: 'xfmr'; at: Pt; label?: string; value?: string }
  | { t: 'opto'; at: Pt; label?: string; value?: string };

export type TwoKind = 'R' | 'C' | 'Cp' | 'L' | 'D' | 'Z' | 'LED' | 'BAT' | 'AC' | 'SW' | 'PB' | 'A' | 'V' | 'OHM' | 'SCR' | 'LDR' | 'NTC' | 'BZ' | 'M' | 'SPK' | 'WIRE';

/** ขาของกล่องไอซี: ด้าน, ระยะจากมุมบน/ซ้ายของด้านนั้น (px), ชื่อขา, หมายเลขขา */
export interface IcPin { side: Side; at: number; name: string; num?: string | number }

export interface Schematic {
  w: number;
  h: number;
  items: Item[];
  /** คำอธิบายใต้รูป (เช่น "ส่วน ก / ส่วน ข" หรือหมายเหตุ) */
  note?: string;
}

const STUB = 20; // ความยาวขาของกล่องไอซี

/* ---------- ตัวช่วยสร้าง (ใช้ในไฟล์ schematics.ts) ---------- */
export const W = (...p: Pt[]): Item => ({ t: 'w', p });
/** เส้นประ (เช่น แนวฉนวน/ขอบเขต) — ไม่ใช่สายไฟ */
export const DASH = (...p: Pt[]): Item => ({ t: 'w', p, dash: true });
export const DOT = (x: number, y: number): Item => ({ t: 'dot', at: [x, y] });
export const T = (x: number, y: number, s: string, o: { a?: 'start' | 'middle' | 'end'; size?: number; bold?: boolean; muted?: boolean } = {}): Item => ({ t: 'txt', at: [x, y], s, ...o });
export const P2 = (k: TwoKind, a: Pt, b: Pt, label?: string, value?: string, side?: Side): Item => ({ t: '2', k, a, b, label, value, side });
export const GND = (x: number, y: number): Item => ({ t: 'gnd', at: [x, y] });
export const VCC = (x: number, y: number, s: string): Item => ({ t: 'vcc', at: [x, y], s });
export const FLAG = (x: number, y: number, s: string, dir: 'l' | 'r' = 'r'): Item => ({ t: 'flag', at: [x, y], s, dir });

/** ขาทรานซิสเตอร์ NPN ที่ตำแหน่ง at (ศูนย์กลางวงกลม): B ซ้าย, C บน, E ล่าง */
export const npnPins = ([x, y]: Pt) => ({ B: [x - 30, y] as Pt, C: [x + 10, y - 30] as Pt, E: [x + 10, y + 30] as Pt });
/** ดาร์ลิงตัน NPN: Q1 ขับเบสของ Q2 คอลเลกเตอร์ร่วม */
export const darlPins = ([x, y]: Pt) => ({ B: [x - 40, y] as Pt, C: [x + 15, y - 40] as Pt, E: [x + 15, y + 40] as Pt });
/** ขามอสเฟตช่อง N: G ซ้าย, D บน, S ล่าง */
export const nmosPins = ([x, y]: Pt) => ({ G: [x - 30, y] as Pt, D: [x + 10, y - 30] as Pt, S: [x + 10, y + 30] as Pt });
/** ขาออปแอมป์ (ศูนย์กลางสามเหลี่ยม): ขาเข้าบน/ล่างด้านซ้าย, ขาออกขวา, ไฟเลี้ยงบน/ล่าง */
export const opampPins = ([x, y]: Pt, plusTop = false) => ({
  inTop: [x - 40, y - 10] as Pt, inBot: [x - 40, y + 10] as Pt, out: [x + 40, y] as Pt,
  vp: [x, y - 30] as Pt, vn: [x, y + 30] as Pt, plus: (plusTop ? [x - 40, y - 10] : [x - 40, y + 10]) as Pt, minus: (plusTop ? [x - 40, y + 10] : [x - 40, y - 10]) as Pt,
});
/** ปลายขาของกล่องไอซี */
export function icPin(it: { at: Pt; w: number; h: number }, side: Side, at: number): Pt {
  const [x, y] = it.at;
  if (side === 'l') return [x - STUB, y + at];
  if (side === 'r') return [x + it.w + STUB, y + at];
  if (side === 't') return [x + at, y - STUB];
  return [x + at, y + it.h + STUB];
}
/** ขาเกต AND/OR (ศูนย์กลางตัวเกต): A, B ซ้าย, Y ขวา */
export const gatePins = ([x, y]: Pt) => ({ A: [x - 40, y - 10] as Pt, B: [x - 40, y + 10] as Pt, Y: [x + 40, y] as Pt });
/** ขาหม้อแปลง (ศูนย์กลางแกน): ปฐมภูมิซ้ายบน/ล่าง, ทุติยภูมิขวาบน/กลาง/ล่าง */
export const xfmrPins = ([x, y]: Pt) => ({ p1: [x - 40, y - 30] as Pt, p2: [x - 40, y + 30] as Pt, s1: [x + 40, y - 30] as Pt, ct: [x + 40, y] as Pt, s2: [x + 40, y + 30] as Pt });
/** ขาออปโตคัปเปลอร์ (ศูนย์กลางกล่อง): 1 A, 2 K ซ้าย, 4 C, 3 E ขวา */
export const optoPins = ([x, y]: Pt) => ({ A: [x - 50, y - 20] as Pt, K: [x - 50, y + 20] as Pt, C: [x + 50, y - 20] as Pt, E: [x + 50, y + 20] as Pt });

/* ---------- การวาด ---------- */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n: number) => (Math.round(n * 10) / 10).toString();
const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
const poly = (pts: Pt[], close = false, fill = false) => `<${close ? 'polygon' : 'polyline'} points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}"${fill ? ' class="fill"' : ''}/>`;
/** ขอบเขตข้อความที่วาด (ประมาณจากจำนวนอักษร) — ใช้ขยาย viewBox ไม่ให้ป้ายถูกตัด */
let BB = { x0: 0, y0: 0, x1: 0, y1: 0 };
/** ความกว้างโดยประมาณของข้อความ (สระ/วรรณยุกต์ไทยที่ไม่กินที่ไม่นับ) */
export const textWidth = (s: string, px = 11.5) => [...s].filter((ch) => !/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch)).length * px * 0.56;
const text = (x: number, y: number, s: string, a: 'start' | 'middle' | 'end' = 'middle', cls = '', size?: number) => {
  const px = size ?? (cls === 'pin' ? 10 : cls === 'num' ? 9 : cls === 'lab' ? 12 : 11.5), w = textWidth(s, px);
  const x0 = a === 'start' ? x : a === 'end' ? x - w : x - w / 2;
  BB = { x0: Math.min(BB.x0, x0), x1: Math.max(BB.x1, x0 + w), y0: Math.min(BB.y0, y - px), y1: Math.max(BB.y1, y + 4) };
  return textEl(x, y, s, a, cls, size);
};
const textEl = (x: number, y: number, s: string, a: 'start' | 'middle' | 'end' = 'middle', cls = '', size?: number) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${a}"${cls ? ` class="${cls}"` : ''}${size ? ` font-size="${size}"` : ''}>${esc(s)}</text>`;

/** วาดในกรอบพิกัด local: แกน u ตามทิศ a→b (ยาว L), แกน v ตั้งฉาก — แล้วแปลงด้วย transform */
function two(it: Extract<Item, { t: '2' }>): string {
  const [ax, ay] = it.a, [bx, by] = it.b;
  const L = Math.hypot(bx - ax, by - ay);
  const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const body = BODY[it.k];
  const half = body.len / 2, c = L / 2;
  let g = '';
  if (it.k === 'WIRE') g = line(0, 0, L, 0);
  else g = line(0, 0, c - half, 0) + line(c + half, 0, L, 0) + body.draw(c);
  let out = `<g transform="translate(${f(ax)},${f(ay)}) rotate(${f(ang)})">${g}</g>`;
  // ตัวอักษรในสัญลักษณ์ (A, V, M, +) ไม่หมุนตามแนวอุปกรณ์ — แปลงตำแหน่ง local → global แล้ววาดตั้งตรง
  const ux = (bx - ax) / (L || 1), uy = (by - ay) / (L || 1);
  for (const [u, v, str, cls] of body.marks?.(c) ?? []) {
    const gx = ax + ux * u - uy * v, gy = ay + uy * u + ux * v;
    out += text(gx, gy + (cls === 'sym' ? 4.5 : 3.5), str, 'middle', cls);
  }
  // ป้ายชื่อ: แนวนอน → บน (หรือล่าง), แนวตั้ง → ขวา (หรือซ้าย)
  const horiz = Math.abs(by - ay) < Math.abs(bx - ax);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const side = it.side ?? (horiz ? 't' : 'r');
  const lines = [it.label, it.value].filter(Boolean) as string[];
  if (lines.length) {
    const off = body.width / 2 + 6;
    if (side === 't') lines.forEach((s, i) => { out += text(mx, my - off - (lines.length - 1 - i) * 13, s, 'middle', i ? 'val' : 'lab'); });
    else if (side === 'b') lines.forEach((s, i) => { out += text(mx, my + off + 10 + i * 13, s, 'middle', i ? 'val' : 'lab'); });
    else if (side === 'r') lines.forEach((s, i) => { out += text(mx + off, my - (lines.length - 1) * 6.5 + 4 + i * 13, s, 'start', i ? 'val' : 'lab'); });
    else lines.forEach((s, i) => { out += text(mx - off, my - (lines.length - 1) * 6.5 + 4 + i * 13, s, 'end', i ? 'val' : 'lab'); });
  }
  return out;
}

/** สัญลักษณ์อุปกรณ์สองขา: ความยาวตัวสัญลักษณ์ (ตามแนว a→b), ความกว้าง (ตั้งฉาก ใช้วางป้าย) และการวาดที่กึ่งกลาง c */
const BODY: Record<TwoKind, { len: number; width: number; draw: (c: number) => string; marks?: (c: number) => Array<[number, number, string, string]> }> = {
  WIRE: { len: 0, width: 0, draw: () => '' },
  R: { len: 36, width: 12, draw: (c) => poly([[c - 18, 0], [c - 15, -6], [c - 9, 6], [c - 3, -6], [c + 3, 6], [c + 9, -6], [c + 15, 6], [c + 18, 0]]) },
  LDR: {
    len: 36, width: 26, draw: (c) => `<rect x="${f(c - 16)}" y="-6" width="32" height="12"/>`
      + arrow([c - 14, -22], [c - 5, -10]) + arrow([c - 4, -22], [c + 5, -10]),
  },
  NTC: {
    len: 36, width: 30, draw: (c) => `<rect x="${f(c - 16)}" y="-6" width="32" height="12"/>` + poly([[c - 22, 13], [c - 14, 13], [c + 14, -13]]),
    marks: (c) => [[c + 16, -15, '−t°', 'pin']],
  },
  C: { len: 10, width: 24, draw: (c) => line(c - 4, -12, c - 4, 12) + line(c + 4, -12, c + 4, 12) },
  Cp: { len: 10, width: 24, draw: (c) => line(c - 4, -12, c - 4, 12) + `<path d="M${f(c + 7)},-12 Q${f(c + 2)},0 ${f(c + 7)},12"/>`, marks: (c) => [[c - 11, -11, '+', 'pin']] },
  L: { len: 40, width: 12, draw: (c) => [0, 1, 2, 3].map((k) => `<path d="M${f(c - 20 + k * 10)},0 a5,5 0 0 1 10,0"/>`).join('') },
  D: { len: 20, width: 20, draw: (c) => poly([[c - 8, -9], [c - 8, 9], [c + 8, 0]], true) + line(c + 8, -9, c + 8, 9) },
  Z: { len: 20, width: 20, draw: (c) => poly([[c - 8, -9], [c - 8, 9], [c + 8, 0]], true) + poly([[c + 4, -11], [c + 8, -9], [c + 8, 9], [c + 12, 11]]) },
  LED: {
    len: 20, width: 50, draw: (c) => poly([[c - 8, -9], [c - 8, 9], [c + 8, 0]], true) + line(c + 8, -9, c + 8, 9)
      + arrow([c - 1, -12], [c + 7, -22]) + arrow([c + 6, -10], [c + 14, -20]),
  },
  BAT: { len: 12, width: 30, draw: (c) => line(c - 5, -14, c - 5, 14) + `<line class="thick" x1="${f(c + 5)}" y1="-7" x2="${f(c + 5)}" y2="7"/>`, marks: (c) => [[c - 13, -12, '+', 'pin']] },
  AC: { len: 32, width: 32, draw: (c) => `<circle cx="${f(c)}" cy="0" r="16"/><path d="M${f(c - 9)},0 q4.5,-9 9,0 t9,0"/>` },
  A: { len: 28, width: 28, draw: (c) => `<circle cx="${f(c)}" cy="0" r="14"/>`, marks: (c) => [[c, 0, 'A', 'sym'], [c - 19, -9, '+', 'pin']] },
  V: { len: 28, width: 28, draw: (c) => `<circle cx="${f(c)}" cy="0" r="14"/>`, marks: (c) => [[c, 0, 'V', 'sym'], [c - 19, -9, '+', 'pin']] },
  /** ไทริสเตอร์ (A → K ตามแนว a→b): ขาเกตออกจากด้านแคโทด ปลายที่ local (c + 15, 20) — แนวตั้งลง = ซ้ายของตัว 20, ใต้กึ่งกลาง 15 */
  SCR: { len: 20, width: 40, draw: (c) => poly([[c - 8, -9], [c - 8, 9], [c + 8, 0]], true) + line(c + 8, -9, c + 8, 9) + line(c + 8, 4, c + 15, 14) + line(c + 15, 14, c + 15, 20), marks: (c) => [[c + 22, 26, 'G', 'pin']] },
  OHM: { len: 28, width: 28, draw: (c) => `<circle cx="${f(c)}" cy="0" r="14"/>`, marks: (c) => [[c, 0, 'Ω', 'sym']] },
  SPK: { len: 24, width: 34, draw: (c) => `<rect x="${f(c - 6)}" y="-5" width="12" height="10"/>` + poly([[c - 6, -5], [c - 12, -14], [c + 12, -14], [c + 6, -5]]) },
  M: { len: 32, width: 32, draw: (c) => `<circle cx="${f(c)}" cy="0" r="16"/>`, marks: (c) => [[c, 0, 'M', 'sym']] },
  SW: { len: 28, width: 18, draw: (c) => `<circle cx="${f(c - 12)}" cy="0" r="2.2" class="fill"/><circle cx="${f(c + 12)}" cy="0" r="2.2" class="fill"/>` + line(c - 12, 0, c + 10, -11) },
  PB: {
    len: 28, width: 24, draw: (c) => `<circle cx="${f(c - 12)}" cy="0" r="2.2" class="fill"/><circle cx="${f(c + 12)}" cy="0" r="2.2" class="fill"/>`
      + line(c - 14, -8, c + 14, -8) + line(c, -8, c, -16) + line(c - 5, -16, c + 5, -16),
  },
  BZ: { len: 24, width: 44, draw: (c) => `<path d="M${f(c - 12)},0 L${f(c - 12)},-10 A12,12 0 0 1 ${f(c + 12)},-10 L${f(c + 12)},0 Z"/>`, marks: (c) => [[c - 15, 9, '+', 'pin']] },
};

/** ลูกศรเล็ก (แสง) จาก p ไป q */
function arrow(p: Pt, q: Pt): string {
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const h1: Pt = [q[0] - 5 * Math.cos(a - 0.5), q[1] - 5 * Math.sin(a - 0.5)], h2: Pt = [q[0] - 5 * Math.cos(a + 0.5), q[1] - 5 * Math.sin(a + 0.5)];
  return line(p[0], p[1], q[0], q[1]) + poly([h1, q, h2]);
}

function npn(it: Extract<Item, { t: 'npn' }>): string {
  const [x, y] = it.at;
  let s = `<circle cx="${x}" cy="${y}" r="18"/>`;
  s += line(x - 30, y, x - 8, y) + `<line class="thick" x1="${x - 8}" y1="${y - 11}" x2="${x - 8}" y2="${y + 11}"/>`;
  s += poly([[x - 8, y - 5], [x + 10, y - 16], [x + 10, y - 30]]);
  s += poly([[x - 8, y + 5], [x + 10, y + 16], [x + 10, y + 30]]);
  // ลูกศรอิมิตเตอร์ชี้ออก
  s += poly([[x + 1, y + 15.5], [x + 8, y + 15], [x + 4, y + 9]], true, true);
  s += labels(x + 22, y, it.label, it.value, 'start');
  s += text(x - 26, y - 5, 'B', 'middle', 'pin') + text(x + 16, y - 24, 'C', 'start', 'pin') + text(x + 16, y + 30, 'E', 'start', 'pin');
  return s;
}

function darl(it: Extract<Item, { t: 'darl' }>): string {
  const [x, y] = it.at;
  let s = `<circle cx="${x}" cy="${y}" r="27"/>`;
  // Q1: เบสจากขา B, คอลเลกเตอร์ขึ้นรางร่วม, อิมิตเตอร์ไปเบสของ Q2
  s += line(x - 40, y - 6, x - 13, y - 6) + line(x - 40, y, x - 40, y - 6) + `<line class="thick" x1="${x - 13}" y1="${y - 15}" x2="${x - 13}" y2="${y + 3}"/>`;
  s += poly([[x - 13, y - 10], [x - 4, y - 18], [x + 15, y - 18]]);
  s += poly([[x - 13, y - 2], [x - 4, y + 6], [x + 1, y + 6]]);
  s += poly([[x - 6.5, y + 4.6], [x - 4, y + 6], [x - 6, y + 1]], true, true);
  // Q2
  s += `<line class="thick" x1="${x + 1}" y1="${y - 2}" x2="${x + 1}" y2="${y + 16}"/>`;
  s += poly([[x + 1, y + 2], [x + 15, y - 6], [x + 15, y - 40]]);
  s += poly([[x + 1, y + 12], [x + 15, y + 20], [x + 15, y + 40]]);
  s += poly([[x + 6, y + 19], [x + 14, y + 19.5], [x + 10, y + 13]], true, true);
  s += labels(x + 32, y, it.label, it.value, 'start');
  s += text(x - 36, y - 10, 'B', 'middle', 'pin') + text(x + 20, y - 32, 'C', 'start', 'pin') + text(x + 20, y + 38, 'E', 'start', 'pin');
  return s;
}

function nmos(it: Extract<Item, { t: 'nmos' }>): string {
  const [x, y] = it.at;
  let s = `<circle cx="${x}" cy="${y}" r="18"/>`;
  s += line(x - 30, y, x - 10, y) + line(x - 10, y - 10, x - 10, y + 10);
  s += `<line class="thick" x1="${x - 5}" y1="${y - 12}" x2="${x - 5}" y2="${y - 5}"/><line class="thick" x1="${x - 5}" y1="${y - 3}" x2="${x - 5}" y2="${y + 3}"/><line class="thick" x1="${x - 5}" y1="${y + 5}" x2="${x - 5}" y2="${y + 12}"/>`;
  s += poly([[x - 5, y - 9], [x + 10, y - 9], [x + 10, y - 30]]);
  s += poly([[x - 5, y + 9], [x + 10, y + 9], [x + 10, y + 30]]);
  s += line(x - 5, y, x + 10, y) + line(x + 10, y, x + 10, y + 9);
  s += poly([[x - 4, y], [x + 2, y - 3.5], [x + 2, y + 3.5]], true, true);
  s += labels(x + 22, y, it.label, it.value, 'start');
  s += text(x - 26, y - 5, 'G', 'middle', 'pin') + text(x + 16, y - 24, 'D', 'start', 'pin') + text(x + 16, y + 30, 'S', 'start', 'pin');
  return s;
}

function opamp(it: Extract<Item, { t: 'opamp' }>): string {
  const [x, y] = it.at;
  let s = poly([[x - 25, y - 28], [x - 25, y + 28], [x + 25, y]], true);
  s += line(x - 40, y - 10, x - 25, y - 10) + line(x - 40, y + 10, x - 25, y + 10) + line(x + 25, y, x + 40, y);
  const top = it.plusTop ? '+' : '−', bot = it.plusTop ? '−' : '+';
  s += text(x - 18, y - 6, top, 'middle', 'sym2') + text(x - 18, y + 14, bot, 'middle', 'sym2');
  if (it.supply) s += line(x, y - 14, x, y - 30) + line(x, y + 14, x, y + 30);
  s += labels(x + 8, y - 30, it.label, it.value, 'start', true);
  return s;
}

function pot(it: Extract<Item, { t: 'pot' }>): string {
  const base = two({ t: '2', k: 'R', a: it.a, b: it.b, label: it.label, value: it.value, side: 'l' });
  const [ax, ay] = it.a, [bx, by] = it.b;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  // ขากลาง (wiper) ชี้เข้าหาตัวต้านทานจากด้านขวา (แนวตั้ง) หรือด้านล่าง (แนวนอน)
  const vert = Math.abs(bx - ax) < Math.abs(by - ay);
  return base + (vert ? arrow([mx + 30, my], [mx + 8, my]) : arrow([mx, my + 30], [mx, my + 8]));
}

function ic(it: Extract<Item, { t: 'ic' }>): string {
  const [x, y] = it.at;
  let s = `<rect x="${x}" y="${y}" width="${it.w}" height="${it.h}" rx="3" class="box"/>`;
  // ชื่อไอซี: กลางกล่องถ้าไม่ทับชื่อขาซ้าย/ขวา, ไม่เช่นนั้นวางกลางช่องว่างหรือเขียนแนวตั้ง
  const occ = (side: Side) => Math.max(0, ...it.pins.filter((p) => p.side === side).map((p) => textWidth(p.name, 10) + 6));
  const L = x + 4 + occ('l'), R = x + it.w - 4 - occ('r');
  const tw = Math.max(textWidth(it.title, 12), it.sub ? textWidth(it.sub) : 0) + 8;
  if (R - L >= tw) {
    const cx = R - L >= tw && x + it.w / 2 - tw / 2 >= L && x + it.w / 2 + tw / 2 <= R ? x + it.w / 2 : (L + R) / 2;
    s += text(cx, y + it.h / 2 + (it.sub ? -2 : 4), it.title, 'middle', 'lab');
    if (it.sub) s += text(cx, y + it.h / 2 + 12, it.sub, 'middle', 'val');
  } else {
    const cx = R - L >= 18 ? (L + R) / 2 : x + it.w / 2, cy = y + it.h / 2;
    s += `<text x="${f(cx + 4)}" y="${f(cy)}" text-anchor="middle" class="lab" transform="rotate(-90 ${f(cx + 4)} ${f(cy)})">${esc(it.title + (it.sub ? ` · ${it.sub}` : ''))}</text>`;
  }
  for (const p of it.pins) {
    const [ex, ey] = icPin(it, p.side, p.at);
    const [ix, iy] = p.side === 'l' ? [x, ey] : p.side === 'r' ? [x + it.w, ey] : p.side === 't' ? [ex, y] : [ex, y + it.h];
    s += line(ex, ey, ix, iy);
    // ชื่อขาด้านในกล่อง, หมายเลขขาบนเส้นขา
    if (p.side === 'l') s += text(x + 4, ey + 4, p.name, 'start', 'pin') + (p.num !== undefined ? text(x - 10, ey - 3, String(p.num), 'middle', 'num') : '');
    else if (p.side === 'r') s += text(x + it.w - 4, ey + 4, p.name, 'end', 'pin') + (p.num !== undefined ? text(x + it.w + 10, ey - 3, String(p.num), 'middle', 'num') : '');
    else if (p.side === 't') s += text(ex, y + 12, p.name, 'middle', 'pin') + (p.num !== undefined ? text(ex + 6, y - 6, String(p.num), 'start', 'num') : '');
    else s += text(ex, y + it.h - 5, p.name, 'middle', 'pin') + (p.num !== undefined ? text(ex + 6, y + it.h + 12, String(p.num), 'start', 'num') : '');
  }
  return s;
}

function gate(it: Extract<Item, { t: 'gate' }>): string {
  const [x, y] = it.at;
  let s = line(x - 40, y - 10, x - 18, y - 10) + line(x - 40, y + 10, x - 18, y + 10) + line(x + 22, y, x + 40, y);
  if (it.op === 'and') s += `<path d="M${x - 20},${y - 20} H${x} A20,20 0 0 1 ${x},${y + 20} H${x - 20} Z"/>`;
  else s += `<path d="M${x - 24},${y - 20} Q${x - 12},${y} ${x - 24},${y + 20} Q${x + 8},${y + 20} ${x + 22},${y} Q${x + 8},${y - 20} ${x - 24},${y - 20} Z"/>`;
  s += labels(x, y - 28, it.label, undefined, 'middle');
  return s;
}

function xfmr(it: Extract<Item, { t: 'xfmr' }>): string {
  const [x, y] = it.at;
  let s = '';
  // ขดปฐมภูมิ (ซ้าย) และทุติยภูมิมีแทปกลาง (ขวา) — แนวตั้ง
  const coil = (cx: number, y0: number, n: number, dir: 1 | -1) => Array.from({ length: n }, (_, k) => `<path d="M${cx},${y0 + k * 10} a5,5 0 0 ${dir === 1 ? 1 : 0} 0,10"/>`).join('');
  s += line(x - 40, y - 30, x - 12, y - 30) + line(x - 12, y - 30, x - 12, y - 20) + coil(x - 12, y - 20, 4, 1) + line(x - 12, y + 20, x - 12, y + 30) + line(x - 12, y + 30, x - 40, y + 30);
  s += line(x + 40, y - 30, x + 12, y - 30) + line(x + 12, y - 30, x + 12, y - 20) + coil(x + 12, y - 20, 4, -1) + line(x + 12, y + 20, x + 12, y + 30) + line(x + 12, y + 30, x + 40, y + 30);
  s += line(x + 12, y, x + 40, y);
  s += line(x - 3, y - 24, x - 3, y + 24) + line(x + 3, y - 24, x + 3, y + 24);
  s += labels(x, y - 40, it.label, it.value, 'middle', true);
  return s;
}

function opto(it: Extract<Item, { t: 'opto' }>): string {
  const [x, y] = it.at;
  let s = `<rect x="${x - 34}" y="${y - 32}" width="68" height="64" rx="3" class="box"/>`;
  // LED แนวตั้ง (แอโนดบน) ด้านซ้าย
  s += line(x - 50, y - 20, x - 20, y - 20) + line(x - 20, y - 20, x - 20, y - 8) + poly([[x - 28, y - 8], [x - 12, y - 8], [x - 20, y + 6]], true) + line(x - 28, y + 6, x - 12, y + 6) + line(x - 20, y + 6, x - 20, y + 20) + line(x - 20, y + 20, x - 50, y + 20);
  s += arrow([x - 8, y - 4], [x + 4, y - 4]) + arrow([x - 8, y + 4], [x + 4, y + 4]);
  // โฟโต้ทรานซิสเตอร์ (ไม่มีขาเบส)
  s += `<line class="thick" x1="${x + 10}" y1="${y - 12}" x2="${x + 10}" y2="${y + 12}"/>`;
  s += poly([[x + 10, y - 5], [x + 22, y - 14], [x + 22, y - 20], [x + 50, y - 20]]);
  s += poly([[x + 10, y + 5], [x + 22, y + 14], [x + 22, y + 20], [x + 50, y + 20]]);
  s += poly([[x + 15.5, y + 12.5], [x + 21, y + 13.5], [x + 18, y + 8.5]], true, true);
  s += text(x - 42, y - 24, '1', 'middle', 'num') + text(x - 42, y + 16, '2', 'middle', 'num') + text(x + 42, y - 24, '4', 'middle', 'num') + text(x + 42, y + 16, '3', 'middle', 'num');
  s += labels(x, y - 40, it.label, it.value, 'middle', true);
  return s;
}

function labels(x: number, y: number, label?: string, value?: string, a: 'start' | 'middle' | 'end' = 'start', above = false): string {
  const ls = [label, value].filter(Boolean) as string[];
  if (!ls.length) return '';
  if (above) return ls.map((s, i) => text(x, y - (ls.length - 1 - i) * 13 - 2, s, a, i ? 'val' : 'lab')).join('');
  return ls.map((s, i) => text(x, y - (ls.length - 1) * 6.5 + 4 + i * 13, s, a, i ? 'val' : 'lab')).join('');
}

function render(it: Item): string {
  switch (it.t) {
    case 'w': return it.dash ? poly(it.p).replace('<polyline', '<polyline class="dash"') : poly(it.p);
    case 'dot': return `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="3" class="fill"/>`;
    case 'txt': return text(it.at[0], it.at[1], it.s, it.a ?? 'start', it.bold ? 'lab' : it.muted ? 'note' : 'val', it.size);
    case '2': return two(it);
    case 'gnd': { const [x, y] = it.at; return line(x, y, x, y + 8) + line(x - 10, y + 8, x + 10, y + 8) + line(x - 6, y + 12, x + 6, y + 12) + line(x - 2, y + 16, x + 2, y + 16); }
    case 'vcc': { const [x, y] = it.at; return line(x, y, x, y - 10) + line(x - 8, y - 10, x + 8, y - 10) + text(x, y - 15, it.s, 'middle', 'lab'); }
    case 'flag': {
      const [x, y] = it.at, d = it.dir === 'l' ? -1 : 1, w = 8 + it.s.length * 6.4;
      return poly([[x, y], [x + d * 6, y - 8], [x + d * (6 + w), y - 8], [x + d * (6 + w), y + 8], [x + d * 6, y + 8]], true) + text(x + d * (6 + w / 2), y + 4, it.s, 'middle', 'pin');
    }
    case 'npn': return npn(it);
    case 'darl': return darl(it);
    case 'nmos': return nmos(it);
    case 'opamp': return opamp(it);
    case 'pot': return pot(it);
    case 'ic': return ic(it);
    case 'gate': return gate(it);
    case 'xfmr': return xfmr(it);
    case 'opto': return opto(it);
  }
}

/** SVG ทั้งรูป (สีตาม currentColor ของผู้แสดง) */
export function schematicSvg(s: Schematic, title = ''): string {
  const style = `<style>
  .sch{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  .sch text{fill:currentColor;stroke:none;font-family:"Chakra Petch","Sarabun",system-ui,sans-serif;font-size:11.5px}
  .sch .lab{font-weight:600;font-size:12px}.sch .val{opacity:.85}.sch .pin{font-size:10px;opacity:.9}.sch .num{font-size:9px;opacity:.65}
  .sch .note{font-size:11px;opacity:.7}.sch .sym{font-weight:700;font-size:13px}.sch .sym2{font-size:15px;font-weight:700}
  .sch .dash{stroke-dasharray:6 4;opacity:.6}.sch .fill{fill:currentColor}.sch .thick{stroke-width:3}.sch .box{fill:rgba(127,127,127,.06)}
</style>`;
  BB = { x0: 0, y0: 0, x1: s.w, y1: s.h };
  const body = s.items.map(render).join('');
  const x0 = Math.floor(Math.min(0, BB.x0 - 6)), y0 = Math.floor(Math.min(0, BB.y0 - 6)), x1 = Math.ceil(Math.max(s.w, BB.x1 + 6)), y1 = Math.ceil(Math.max(s.h, BB.y1 + 6));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${x1 - x0}" height="${y1 - y0}" role="img" aria-label="${esc(title)}" class="schematic">${style}<g class="sch">${body}</g></svg>`;
}
