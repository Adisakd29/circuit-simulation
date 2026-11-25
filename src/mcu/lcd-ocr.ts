import { FONT_BIG, FONT_SMALL } from './lcd-fonts';
import { LCD_H, LCD_W } from './watch-devices';

/**
 * อ่านข้อความบนจอกลมจากพิกเซลที่จำลอง (ใช้ในแผงผลและตัวตรวจแลป — ไม่ได้อ่านจากโค้ด)
 * หาอักษรของฟอนต์ vga1_bold_16x32 และ vga1_8x16 (ฟอนต์ที่มากับ gc9a01py) ที่วาดด้วยสีเดียว:
 *   จุดของอักษรทุกจุดต้องเป็นสีเดียวกัน และจุดว่างในช่องอักษรอย่างน้อย 85% ต้องไม่ใช่สีนั้น (พื้นหลังเป็นรูปหรือสีพื้นก็ได้)
 */
interface Glyph { ch: string; on: Array<[number, number]>; off: Array<[number, number]>; w: number; h: number; font: 'big' | 'small'; onIdx?: Int32Array; offIdx?: Int32Array }

function glyphs(f: { w: number; h: number; first: number; b64: string }, font: 'big' | 'small'): Glyph[] {
  const bin = typeof atob === 'function' ? atob(f.b64) : '';
  const bpr = f.w / 8, per = bpr * f.h;
  const out: Glyph[] = [];
  for (let k = 0; k * per < bin.length && f.first + k < 0x7f; k++) {
    const ch = String.fromCharCode(f.first + k);
    const on: Array<[number, number]> = [], off: Array<[number, number]> = [];
    for (let r = 0; r < f.h; r++) {
      let bits = 0;
      for (let j = 0; j < bpr; j++) bits = (bits << 8) | bin.charCodeAt(k * per + r * bpr + j);
      for (let c = 0; c < f.w; c++) ((bits >> (f.w - 1 - c)) & 1 ? on : off).push([c, r]);
    }
    // อ่านเฉพาะตัวเลข ตัวอักษร และ : % / ° — อักษรรูปเส้น (_ - ~ = . ,) จับผิดกับขอบสีในรูปได้ง่าย
    if (/[0-9A-Za-z:%/]/.test(ch)) out.push({ ch, on, off: spread(off), w: f.w, h: f.h, font });
  }
  return out;
}

/** เรียงจุดว่างให้กระจายทั่วช่อง (ตรวจตัวอย่างแรก ๆ ก็ตัดตำแหน่งที่ไม่ใช่อักษรได้เร็ว) */
function spread<T>(a: T[]): T[] {
  const out: T[] = [];
  const step = 7;
  for (let s = 0; s < step; s++) for (let i = s; i < a.length; i += step) out.push(a[i]);
  return out;
}

let cache: Glyph[] | null = null;
const allGlyphs = () => (cache ??= [...glyphs(FONT_BIG, 'big'), ...glyphs(FONT_SMALL, 'small')]);

export interface LcdTextLine { text: string; x: number; y: number; font: 'big' | 'small'; color: number }

/** img = ภาพตามที่มองเห็น (ค่า 16 บิตต่อพิกเซล เรียงแถวจากบนซ้าย) */
export function lcdTextFromImage(img: Uint16Array): LcdTextLine[] {
  const G = allGlyphs();
  // นับพิกเซลตามสี — สีที่มีมากเกินไป (พื้นทั้งจอ) ข้าม
  const count = new Uint32Array(65536);
  for (let i = 0; i < img.length; i++) count[img[i]]++;
  const hits: Array<{ x: number; y: number; g: Glyph; color: number; bad: number }> = [];
  const seen = new Set<string>();
  // ตำแหน่งที่สีเท่ากับจุดทางขวา (เส้นของฟอนต์ทั้งสองหนา ≥ 2 จุด) — พื้นรูปที่ไล่สี/ดิทเธอร์แทบไม่มีคู่แบบนี้ จึงตัดตำแหน่งได้เกือบหมด
  const cand: number[] = [];
  for (let i = 0; i < img.length - 1; i++) { const n = count[img[i]]; if (img[i] === img[i + 1] && n >= 10 && n <= 6000) cand.push(i); }
  for (const g of G) {
    // จุดอ้างอิง = จุดแรกของอักษรที่จุดทางขวาก็เป็นจุดของอักษร · ออฟเซ็ตของจุดอื่นนับจากจุดนี้
    const anchor = g.on.find(([c, r]) => g.on.some(([c2, r2]) => r2 === r && c2 === c + 1));
    if (!anchor) continue;
    const [fx, fy] = anchor;
    g.onIdx ??= Int32Array.from(g.on, ([c, r]) => (r - fy) * LCD_W + (c - fx));
    g.offIdx ??= Int32Array.from(g.off, ([c, r]) => (r - fy) * LCD_W + (c - fx));
    const on = g.onIdx, off = g.offIdx, nOn = on.length, nOff = off.length, lim = nOff * 0.15;
    const xMin = fx, xMax = LCD_W - g.w + fx, yMin = fy, yMax = LCD_H - g.h + fy;
    for (const i of cand) {
      {
        const x = i % LCD_W, y = (i - x) / LCD_W;
        if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
        const color = img[i];
        if (count[color] < nOn) continue;
        let k = 0;
        while (k < nOn && img[i + on[k]] === color) k++;
        if (k < nOn) continue;
        // จุดว่างที่เป็นสีเดียวกับอักษรได้ไม่เกิน 15% — ตรวจแบบสะสม (ตัดพื้นสีเรียบได้หลังตรวจไม่กี่จุด)
        let bad = 0, j = 0;
        for (; j < nOff; j++) if (img[i + off[j]] === color && ++bad > 2 + j * 0.15) break;
        if (j < nOff || bad > lim) continue;
        const x0 = x - fx, y0 = y - fy;
        const key = `${x0},${y0},${g.font},${g.ch}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ x: x0, y: y0, g, color, bad });
      }
    }
  }
  // อักษรที่ซ้อนกัน (เช่น c อยู่ในรูป e, : อยู่ในตัวอักษร, อักษรเล็กอยู่ในอักษรใหญ่) → เก็บตัวที่จุดตรงมากกว่า (จุดว่างผิดน้อยกว่า)
  const score = (h: (typeof hits)[number]) => h.g.on.length - 4 * h.bad + (h.g.font === 'big' ? 1000 : 0);
  hits.sort((a, b) => score(b) - score(a));
  const kept: typeof hits = [];
  for (const h of hits) {
    const overlap = kept.some((k) => h.x < k.x + k.g.w && k.x < h.x + h.g.w && h.y < k.y + k.g.h && k.y < h.y + h.g.h);
    if (!overlap) kept.push(h);
  }
  // เรียงเป็นบรรทัด: y เดียวกัน ฟอนต์เดียวกัน สีเดียวกัน ระยะห่างเป็นจำนวนเท่าของความกว้างอักษร
  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: LcdTextLine[] = [];
  const used = new Set<number>();
  kept.forEach((h, i) => {
    if (used.has(i)) return;
    used.add(i);
    let text = h.g.ch, end = h.x + h.g.w;
    for (let j = i + 1; j < kept.length; j++) {
      const o = kept[j];
      if (used.has(j) || o.y !== h.y || o.g.font !== h.g.font || o.color !== h.color) continue;
      const gap = o.x - end;
      if (gap < 0 || gap % h.g.w !== 0 || gap > 3 * h.g.w) continue;
      text += ' '.repeat(gap / h.g.w) + o.g.ch;
      end = o.x + o.g.w;
      used.add(j);
    }
    lines.push({ text, x: h.x, y: h.y, font: h.g.font, color: h.color });
  });
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** ภาพที่มองเห็นจากหน่วยความจำจอ (จอแสดงกลับซ้าย-ขวา — ดู watch-devices.ts) */
export function lcdLogical(gram: Uint16Array): Uint16Array {
  const out = new Uint16Array(LCD_W * LCD_H);
  for (let y = 0; y < LCD_H; y++) for (let x = 0; x < LCD_W; x++) out[y * LCD_W + x] = gram[y * LCD_W + (LCD_W - 1 - x)];
  return out;
}

const memo = new WeakMap<Uint16Array, LcdTextLine[]>();
/** ข้อความบนจอ (จำผลต่อภาพ) */
export function lcdText(gram: Uint16Array | null): LcdTextLine[] {
  if (!gram) return [];
  let r = memo.get(gram);
  if (!r) { r = lcdTextFromImage(lcdLogical(gram)); memo.set(gram, r); }
  return r;
}

/**
 * ข้อความบนจอของชิ้นส่วน id สำหรับหน้าเว็บ — อ่านใหม่เมื่อภาพเปลี่ยนและห่างจากครั้งก่อน ≥ 0.4 s (อ่านหนึ่งครั้ง ≈ 0.1 s)
 * ระหว่างนั้นคืนผลครั้งล่าสุด (ภาพที่เปลี่ยนถี่ระหว่างวาดหน้าใหม่ไม่ทำให้หน้าเว็บกระตุก)
 */
const latest = new Map<string, { gram: Uint16Array; at: number; lines: LcdTextLine[] }>();
export function lcdTextThrottled(id: string, gram: Uint16Array | null, now = Date.now()): LcdTextLine[] {
  if (!gram) return [];
  const l = latest.get(id);
  if (l && (l.gram === gram || now - l.at < 400)) return l.lines;
  const lines = lcdText(gram);
  latest.set(id, { gram, at: now, lines });
  return lines;
}
