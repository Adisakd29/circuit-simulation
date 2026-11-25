/**
 * อุปกรณ์ I²C ของสถานีตรวจอากาศ (ระดับรีจิสเตอร์ — รู้เฉพาะไบต์บนบัส ไม่อ่านข้อความโค้ด)
 *   PCF8574 + HD44780  จอ LCD 16×2 แบบ I²C backpack: PCF8574 (NXP datasheet) เป็นพอร์ต 8 บิตแบบ quasi-bidirectional (เปิดไฟ = สูงทุกขา)
 *                      ต่อ P0 = RS, P1 = RW, P2 = E, P3 = ไฟพื้นหลัง, P4–P7 = D4–D7 ของ HD44780 (แบบเดียวกับไดรเวอร์ python_lcd)
 *                      HD44780 (Hitachi HD44780U): รับนิบเบิลตอนขอบลงของ E, ชุดคำสั่ง clear/home/entry/display/shift/function/CGRAM/DDRAM,
 *                      DDRAM 80 ไบต์ (2 บรรทัด: 0x00–0x27, 0x40–0x67), CGRAM 8 อักษร, รีเซ็ตเมื่อจ่ายไฟ = โหมด 8 บิต 1 บรรทัด จอปิด
 *   BMP280             ความกดอากาศ + อุณหภูมิ (Bosch BST-BMP280-DS001): id 0xD0 = 0x58, reset 0xE0 ← 0xB6, ctrl_meas 0xF4 (osrs_t, osrs_p, mode),
 *                      ข้อมูลดิบ 20 บิต 0xF7–0xFC (ค่าเมื่อข้าม/โหมดหลับ = 0x80000), ค่าปรับเทียบ dig_T1..dig_P9 ที่ 0x88–0x9F
 *   BH1750             ความเข้มแสง (ROHM BH1750FVI): คำสั่ง 1 ไบต์ (ปิด/เปิด/รีเซ็ต/วัดต่อเนื่อง/วัดครั้งเดียว/ตั้ง MTreg), อ่าน 2 ไบต์ = lux × 1.2
 * HD44780: เวลาประมวลผลคำสั่ง (busy) ที่ fosc 270 kHz — ข้อมูลที่ส่งระหว่าง busy ถูกทิ้ง (นับไว้แจ้งเตือน) · รีเซ็ตภายใน 10 ms หลังจ่ายไฟ (BF = 1)
 *   อ่านกลับ (RW = 1): RS = 0 → BF + AC, RS = 1 → ข้อมูล DDRAM/CGRAM ที่ AC (AC เลื่อนตามทิศการเขียน) · โหมด 4 บิตส่งนิบเบิลบนก่อน
 *   ผ่าน PCF8574: ขาที่เขียนเป็น 1 (quasi-bidirectional) ถูกจอดึงลงได้ระหว่าง E = 1, RW = 1 → master อ่านพอร์ตได้ข้อมูลจากจอ
 */

/** เวลาประมวลผล (s) ตามคำสั่งล่าสุด (−1 = เขียน/อ่านข้อมูล): Clear/Return home 1.52 ms, อื่น ๆ 37 µs, ข้อมูล 37 µs + tADD 4 µs (HD44780U ที่ fosc 270 kHz) */
export function hd44780ExecTime(op: number): number {
  if (op < 0) return 41e-6;
  if (op === 0x01 || op === 0x02 || op === 0x03) return 1.52e-3;
  return 37e-6;
}
/** ช่วงรีเซ็ตภายในหลังจ่ายไฟ (BF = 1) */
export const HD44780_RESET_S = 10e-3;
import type { I2cTarget } from './i2c-devices';
import { HD44780_A00_B64 } from './hd44780-font';

/* ===================== PCF8574 + HD44780 ===================== */

export class Lcd1602 implements I2cTarget {
  readonly name = 'PCF8574';
  /** สถานะขาของ PCF8574 (เปิดไฟ = 0xFF) */
  port = 0xff;
  ddram = new Uint8Array(80).fill(0x20);
  cgram = new Uint8Array(64);
  ac = 0; acCg = false;
  inc = true; entryShift = false;
  displayOn = false; cursor = false; blink = false;
  /** การเลื่อนจอ (ตำแหน่ง DDRAM ที่อยู่คอลัมน์ซ้ายสุด 0–39) */
  shift = 0;
  dl8 = true; lines2 = false; font10 = false;
  private half: number | null = null;
  /** สถิติ */
  writes = 0; instrs = 0; chars = 0; ver = 1;
  /** busy: เวลาที่ประมวลผลคำสั่งล่าสุดเสร็จ · ข้อมูล/คำสั่งที่ถูกทิ้งเพราะส่งระหว่าง busy · จำนวนครั้งที่อ่านจากจอ */
  busyUntil = 0; dropped = 0; reads = 0;
  /** การอ่านแบบ 4 บิต: นิบเบิลต่ำของไบต์ที่อ่าน (null = รอบถัดไปเป็นนิบเบิลบน) · นิบเบิลที่จอขับออก D7–D4 ขณะ E = 1 (PCF8574) */
  private rdLow: number | null = null;
  private outNib: number | null = null;
  /** now: เวลาจำลอง (s) — ไม่ส่งมา = ไม่คิดเวลาประมวลผล (ใช้ในเทสต์ระดับคำสั่ง) */
  constructor(private clock?: () => number) { this.reset(); }
  private now() { return this.clock?.() ?? 0; }

  get busy() { return !!this.clock && this.now() < this.busyUntil - 1e-12; }
  /** ไฟกลับมาหลังดับระหว่างจำลอง: รีเซ็ตพร้อม BF = 1 นาน 10 ms */
  powerUp() { this.reset(HD44780_RESET_S); }

  /**
   * หนึ่งรอบการอ่าน (ขอบขึ้นของ E ขณะ RW = 1): โหมด 8 บิตคืนทั้งไบต์, 4 บิตคืนนิบเบิลบน (รอบแรก) / นิบเบิลต่ำ (รอบถัดไป) ในตำแหน่ง D7–D4
   */
  readCycle(rs: boolean): number {
    if (!this.dl8 && this.rdLow !== null) { const lo = this.rdLow; this.rdLow = null; return lo << 4; }
    let v: number;
    if (!rs) v = (this.busy ? 0x80 : 0) | (this.ac & 0x7f);
    else {
      this.reads++;
      v = this.acCg ? this.cgram[this.ac & 0x3f] : this.ddram[this.ddIndex(this.ac)];
      if (this.acCg) this.ac = (this.ac + (this.inc ? 1 : -1)) & 0x3f; else this.ac = this.nextAddr(this.ac, this.inc ? 1 : -1);
      this.busyUntil = this.now() + hd44780ExecTime(-1);
    }
    if (this.dl8) return v;
    this.rdLow = v & 0x0f;
    return v & 0xf0;
  }

  /**
   * จ่ายไฟใหม่: PCF8574 ขาสูงทุกขา · HD44780 รีเซ็ตภายใน — busyFor = เวลาที่ BF = 1 (10 ms เมื่อไฟกลับมาระหว่างจำลอง;
   * ตอนเริ่มจำลองใช้ 0 เพราะบอร์ดเริ่มรันโค้ดช้ากว่านั้นอยู่แล้ว: Uno มีเวลาเริ่มต้นจาก fuse 16K CK + 65 ms, Pico บูต MicroPython หลายร้อย ms)
   */
  reset(busyFor = 0) {
    this.busyUntil = this.now() + busyFor; this.rdLow = null; this.outNib = null;
    this.port = 0xff;
    this.ddram.fill(0x20); this.cgram.fill(0);
    this.ac = 0; this.acCg = false; this.inc = true; this.entryShift = false;
    this.displayOn = false; this.cursor = false; this.blink = false; this.shift = 0;
    this.dl8 = true; this.lines2 = false; this.font10 = false; this.half = null;
    this.ver++;
  }

  get backlight() { return (this.port & 0x08) !== 0; }

  begin() {}
  write(b: number): boolean {
    const prev = this.port;
    this.port = b & 0xff;
    this.writes++;
    const rw = (b & 0x02) !== 0;
    // ขอบขึ้นของ E ขณะ RW = 1 → จอขับ D7–D4 (P7–P4) · ขอบลงของ E ขณะ RW = 0 → HD44780 รับนิบเบิลบน D4–D7 ตาม RS (P0)
    if (!(prev & 0x04) && (b & 0x04) && rw) this.outNib = this.readCycle((b & 0x01) !== 0) >> 4;
    if ((prev & 0x04) && !(b & 0x04)) { if (!rw) this.nibble((b >> 4) & 0x0f, (b & 0x01) !== 0); this.outNib = null; }
    if (!(b & 0x04) || !rw) this.outNib = null;
    if ((prev ^ b) & 0x08) this.ver++;
    return true;
  }
  /** อ่านพอร์ต PCF8574: ระดับขาจริง — ขาที่เขียน 1 ถูกจอดึงลงได้ขณะจออ่านออก */
  read(): number { return this.outNib === null ? this.port : (this.port & 0x0f) | (this.port & 0xf0 & (this.outNib << 4)); }
  end() {}

  /**
   * จอแบบขนาน (ไม่มี PCF8574): ขอบลงของ E รับข้อมูลจากขา D0–D7 — โหมด 8 บิตใช้ทั้งไบต์, โหมด 4 บิตใช้ D4–D7 (นิบเบิลบนก่อน)
   */
  parallelWrite(d: number, rs: boolean) {
    this.writes++;
    this.rdLow = null;
    if (this.dl8) { this.half = null; this.exec(d & 0xff, rs); } else this.nibble((d >> 4) & 0x0f, rs);
  }
  /** คำสั่งล่าสุดที่ทำ (−1 = เขียนข้อมูล) — ใช้คำนวณเวลาประมวลผล (busy) ของจอแบบขนาน */
  lastOp = 0;

  private nibble(n: number, rs: boolean) {
    this.rdLow = null;
    // ส่งระหว่างที่จอยังประมวลผลคำสั่งก่อนหน้า (busy) → ถูกทิ้ง (ของจริงผลไม่แน่นอน)
    if (this.busy) { this.dropped++; return; }
    if (this.dl8) { this.exec((n << 4) & 0xff, rs); return; } // D0–D3 ไม่ได้ต่อ (ถือเป็น 0)
    if (this.half === null) { this.half = n; return; }
    const v = (this.half << 4) | n;
    this.half = null;
    this.exec(v, rs);
  }

  private nextAddr(a: number, dir: number): number {
    if (!this.lines2) return (a + dir + 80) % 80;
    const line = a >= 0x40 ? 1 : 0, col = (a & 0x3f) + dir;
    if (col > 0x27) return line ? 0x00 : 0x40;
    if (col < 0) return line ? 0x27 : 0x67;
    return (line << 6) | col;
  }
  private ddIndex(a: number) { return this.lines2 ? (a >= 0x40 ? 40 + (a - 0x40) % 40 : a % 40) : a % 80; }

  exec(b: number, rs: boolean) {
    this.ver++;
    this.lastOp = rs ? -1 : b;
    this.busyUntil = this.now() + hd44780ExecTime(this.lastOp);
    if (rs) {
      this.chars++;
      if (this.acCg) { this.cgram[this.ac & 0x3f] = b & 0x1f; this.ac = (this.ac + (this.inc ? 1 : -1)) & 0x3f; return; }
      this.ddram[this.ddIndex(this.ac)] = b;
      this.ac = this.nextAddr(this.ac, this.inc ? 1 : -1);
      if (this.entryShift) this.shift = (this.shift + (this.inc ? 1 : -1) + 40) % 40;
      return;
    }
    this.instrs++;
    if (b & 0x80) { this.ac = b & 0x7f; this.acCg = false; }
    else if (b & 0x40) { this.ac = b & 0x3f; this.acCg = true; }
    else if (b & 0x20) { this.dl8 = (b & 0x10) !== 0; this.lines2 = (b & 0x08) !== 0; this.font10 = (b & 0x04) !== 0; this.half = null; }
    else if (b & 0x10) {
      const right = (b & 0x04) !== 0;
      if (b & 0x08) this.shift = (this.shift + (right ? -1 : 1) + 40) % 40;
      else this.ac = this.nextAddr(this.ac, right ? 1 : -1);
    } else if (b & 0x08) { this.displayOn = (b & 0x04) !== 0; this.cursor = (b & 0x02) !== 0; this.blink = (b & 0x01) !== 0; }
    else if (b & 0x04) { this.inc = (b & 0x02) !== 0; this.entryShift = (b & 0x01) !== 0; }
    else if (b & 0x02) { this.ac = 0; this.acCg = false; this.shift = 0; }
    else if (b & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.acCg = false; this.shift = 0; this.inc = true; }
  }
}

/** สถานะจอ LCD ที่ส่งให้หน้าเว็บ */
export interface CharLcdView {
  ddram: number[]; cgram: number[]; displayOn: boolean; cursor: boolean; blink: boolean; shift: number; lines2: boolean; ac: number; acCg: boolean; backlight: boolean;
}

export function charLcdView(l: Lcd1602): CharLcdView {
  return { ddram: Array.from(l.ddram), cgram: Array.from(l.cgram), displayOn: l.displayOn, cursor: l.cursor, blink: l.blink, shift: l.shift, lines2: l.lines2, ac: l.ac, acCg: l.acCg, backlight: l.backlight };
}

/** รหัสอักษรที่แสดงในแต่ละช่อง (2 แถว × 16) — −1 = ช่องว่าง (จอปิด/แถวที่ไม่ได้ใช้ในโหมด 1 บรรทัด) */
export function charLcdCells(v: CharLcdView, cols = 16): number[][] {
  const rows: number[][] = [[], []];
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    if (!v.displayOn || (r === 1 && !v.lines2)) { rows[r].push(-1); continue; }
    const i = v.lines2 ? r * 40 + (v.shift + c) % 40 : (v.shift + c) % 80;
    rows[r].push(v.ddram[i]);
  }
  return rows;
}

const CHAR_MAP: Record<number, string> = { 0x5c: '¥', 0x7e: '→', 0x7f: '←', 0xdf: '°' };
/** ข้อความบนจอ (อักษรใน CGRAM แสดงเป็น ▮) */
export function charLcdText(v: CharLcdView | undefined): string[] {
  if (!v) return [];
  return charLcdCells(v).map((row) => row.map((c) => (c < 0 ? ' ' : c < 16 ? '▮' : CHAR_MAP[c] ?? (c >= 0x20 && c < 0x7e ? String.fromCharCode(c) : '·'))).join(''));
}

let font: Uint8Array | null = null;
/** แถวจุด 5×8 ของอักษร (บิต 0 = ซ้ายสุด) — รหัส 0–15 มาจาก CGRAM */
export function charGlyph(v: CharLcdView, code: number): number[] {
  if (code >= 0 && code < 16) { const k = (code & 7) * 8; return v.cgram.slice(k, k + 8).map((b) => { let o = 0; for (let i = 0; i < 5; i++) if (b & (0x10 >> i)) o |= 1 << i; return o; }); }
  if (!font) { const s = atob(HD44780_A00_B64); font = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) font[i] = s.charCodeAt(i); }
  return Array.from(font.subarray(code * 8, code * 8 + 8));
}

/**
 * ความเข้มของจุดที่ติด (0–1): ผลึกเหลวต้องการแรงดัน V_LCD = VCC − V0 ราว 4–4.7 V (ทริมพอตปรับ V0) — ไฟเลี้ยง 3.3 V จึงแทบมองไม่เห็นแม้หมุนสุด
 * ค่าในแบบจำลอง: V_LCD = VCC × ตำแหน่งทริมพอต, ติดเต็มที่เมื่อ ≥ 4.4 V, เริ่มเห็นที่ 3.4 V (ค่าประมาณ)
 */
export function charLcdContrast(vcc: number, pot: number): number {
  const vlcd = Math.max(0, vcc) * Math.max(0, Math.min(1, pot));
  return Math.max(0, Math.min(1, (vlcd - 3.4) / 1.0));
}
/** ความเข้มของจุดที่ไม่ติด: V_LCD สูงเกิน (≥ 4.6 V) จะเห็นกล่องจุดจาง ๆ ทุกช่อง */
export function charLcdGhost(vcc: number, pot: number): number {
  const vlcd = Math.max(0, vcc) * Math.max(0, Math.min(1, pot));
  return Math.max(0, Math.min(0.6, ((vlcd - 4.6) / 0.6) * 0.6));
}

/* ===================== BMP280 ===================== */

/** ค่าปรับเทียบของชิปในแบบจำลอง (ชิปจริงแต่ละตัวต่างกัน — ค่านี้อยู่ในช่วงปกติของ BMP280) */
export const BMP280_CAL = { T1: 27504, T2: 26435, T3: -1000, P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000 };

/** สูตรชดเชยแบบทศนิยมตามดาต้าชีต (ภาคผนวก 8.1) */
export function bmp280Compensate(adcT: number, adcP: number, c = BMP280_CAL): { t: number; p: number; tFine: number } {
  let v1 = (adcT / 16384 - c.T1 / 1024) * c.T2;
  let v2 = (adcT / 131072 - c.T1 / 8192) * (adcT / 131072 - c.T1 / 8192) * c.T3;
  const tFine = Math.trunc(v1 + v2);
  const t = (v1 + v2) / 5120;
  v1 = tFine / 2 - 64000;
  v2 = (v1 * v1 * c.P6) / 32768;
  v2 = v2 + v1 * c.P5 * 2;
  v2 = v2 / 4 + c.P4 * 65536;
  v1 = ((c.P3 * v1 * v1) / 524288 + c.P2 * v1) / 524288;
  v1 = (1 + v1 / 32768) * c.P1;
  if (v1 === 0) return { t, p: 0, tFine };
  let p = 1048576 - adcP;
  p = ((p - v2 / 4096) * 6250) / v1;
  v1 = (c.P9 * p * p) / 2147483648;
  v2 = (p * c.P8) / 32768;
  p = p + (v1 + v2 + c.P7) / 16;
  return { t, p, tFine };
}

/** ค่าดิบ adc_T, adc_P ที่ให้อุณหภูมิ (°C) และความกด (Pa) ตามสูตรชดเชย (ค้นแบบแบ่งครึ่ง) */
export function bmp280Raw(tC: number, pPa: number): { adcT: number; adcP: number } {
  let lo = 0, hi = (1 << 20) - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bmp280Compensate(m, 0).t < tC) lo = m + 1; else hi = m; }
  const adcT = lo;
  // ความกดลดลงเมื่อ adc_P เพิ่ม
  lo = 0; hi = (1 << 20) - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bmp280Compensate(adcT, m).p > pPa) lo = m + 1; else hi = m; }
  return { adcT, adcP: lo };
}

/** ช่วงพักในโหมด normal ตาม t_sb[2:0] ของ config 0xF5 (ดาต้าชีต Table 11) (s) */
export const BMP280_TSB = [0.5e-3, 62.5e-3, 125e-3, 250e-3, 500e-3, 1, 2, 4];
/** ค่าสัมประสิทธิ์ IIR ตาม filter[2:0] (0 = ปิด) */
export const BMP280_IIR = [1, 2, 4, 8, 16, 16, 16, 16];
/** จำนวนเท่าของ oversampling ตาม osrs[2:0] (0 = ข้าม) */
const OS = [0, 1, 2, 4, 8, 16, 16, 16];
/** เวลาวัดหนึ่งครั้งแบบ typical (s): 1 + 2·T_os + (2·P_os + 0.5) ms — ตรงกับทุกแถวของดาต้าชีต Table 13 */
export function bmp280MeasTime(ctrl: number): number {
  const t = OS[(ctrl >> 5) & 7], p = OS[(ctrl >> 2) & 7];
  return (1 + 2 * t + (p ? 2 * p + 0.5 : 0)) * 1e-3;
}

export class Bmp280 implements I2cTarget {
  readonly name = 'BMP280';
  regs = new Uint8Array(256);
  private ptr = 0;
  private first = true;
  private latch: number[] | null = null;
  temperature = 25;
  /** ความกดอากาศ (hPa) */
  pressure = 1013.25;
  /** รีจิสเตอร์ข้อมูล 0xF7–0xFC (อัปเดตเมื่อการวัดแต่ละครั้งเสร็จ) */
  private held: number[] | null = null;
  /** สถานะฟิลเตอร์ IIR (ค่า ADC 20 บิต) */
  private fT: number | null = null;
  private fP: number | null = null;
  /** โหมด normal: เวลาเริ่มรอบแรก และจำนวนการวัดที่เสร็จแล้ว · โหมด forced: เวลาที่การวัดเสร็จ */
  private cycT0 = 0;
  private cycDone = 0;
  private forcedEnd = -1;
  dataReads = 0; measurements = 0;
  constructor(private now: () => number = () => 0) { this.reset(); }
  reset() {
    this.regs.fill(0); this.regs[0xd0] = 0x58; this.held = null; this.fT = null; this.fP = null; this.forcedEnd = -1;
    const c = BMP280_CAL;
    const w = (a: number, v: number) => { const u = v & 0xffff; this.regs[a] = u & 0xff; this.regs[a + 1] = u >> 8; };
    w(0x88, c.T1); w(0x8a, c.T2); w(0x8c, c.T3); w(0x8e, c.P1); w(0x90, c.P2); w(0x92, c.P3); w(0x94, c.P4); w(0x96, c.P5); w(0x98, c.P6); w(0x9a, c.P7); w(0x9c, c.P8); w(0x9e, c.P9);
  }
  get mode() { return this.regs[0xf4] & 3; }

  /**
   * วัดหนึ่งครั้งแล้วเขียนรีจิสเตอร์ข้อมูล: ความละเอียดตาม oversampling (×1 = 16 บิต … ×16 = 20 บิต) ·
   * ฟิลเตอร์ IIR (config 0xF5 filter[2:0]): ค่า = (ค่าเดิม·(c − 1) + ค่า ADC)/c (ดาต้าชีต 3.3.3) ใช้กับความกดและอุณหภูมิ (อุณหภูมิละเอียด 20 บิตเมื่อเปิดฟิลเตอร์)
   * ค่าเริ่มของฟิลเตอร์ = ผลวัดครั้งแรก (ดาต้าชีตไม่ระบุ — สมมติ)
   */
  private measure(): number[] {
    this.measurements++;
    const osT = (this.regs[0xf4] >> 5) & 7, osP = (this.regs[0xf4] >> 2) & 7;
    const c = BMP280_IIR[(this.regs[0xf5] >> 2) & 7];
    const { adcT, adcP } = bmp280Raw(this.temperature, this.pressure * 100);
    const q = (v: number, os: number) => (os === 0 ? 0x80000 : v & ~((1 << (4 - Math.min(4, os - 1))) - 1));
    let t = q(adcT, osT), p = q(adcP, osP);
    if (c > 1) {
      if (osT) { this.fT = this.fT === null ? adcT : (this.fT * (c - 1) + adcT) / c; t = Math.round(this.fT); }
      if (osP) { this.fP = this.fP === null ? adcP : (this.fP * (c - 1) + adcP) / c; p = Math.round(this.fP); }
    } else { this.fT = adcT; this.fP = adcP; }
    return [(p >> 12) & 0xff, (p >> 4) & 0xff, (p & 0x0f) << 4, (t >> 12) & 0xff, (t >> 4) & 0xff, (t & 0x0f) << 4];
  }

  /** เดินสถานะถึงเวลาปัจจุบัน: โหมด normal วัดซ้ำทุก (เวลาวัด + t_standby), โหมด forced วัดหนึ่งครั้งแล้วกลับเป็นหลับ */
  poll() {
    const t = this.now();
    if (this.forcedEnd >= 0 && t >= this.forcedEnd) { this.forcedEnd = -1; this.held = this.measure(); this.regs[0xf4] &= ~3; }
    if (this.mode === 3) {
      const tm = bmp280MeasTime(this.regs[0xf4]), per = tm + BMP280_TSB[(this.regs[0xf5] >> 5) & 7];
      const n = t >= this.cycT0 + tm ? Math.floor((t - this.cycT0 - tm) / per) + 1 : 0;
      // ฟิลเตอร์ลู่เข้าหลังไม่กี่สิบรอบ — ทำย้อนหลังไม่เกิน 400 ครั้ง
      for (let k = Math.max(this.cycDone, n - 400); k < n; k++) this.held = this.measure();
      this.cycDone = Math.max(this.cycDone, n);
    }
  }

  /** กำลังแปลงอยู่ (status 0xF3 บิต 3) */
  private measuring(): boolean {
    const t = this.now();
    if (this.forcedEnd >= 0) return t < this.forcedEnd;
    if (this.mode !== 3) return false;
    const tm = bmp280MeasTime(this.regs[0xf4]), per = tm + BMP280_TSB[(this.regs[0xf5] >> 5) & 7];
    return ((t - this.cycT0) % per + per) % per < tm;
  }

  private reg(i: number): number {
    if (i >= 0xf7 && i <= 0xfc) {
      // อ่านต่อเนื่อง: รีจิสเตอร์ shadow คงค่าตลอดการอ่านแบบ burst (ดาต้าชีต 3.10)
      if (!this.latch) this.latch = this.held ?? [0x80, 0, 0, 0x80, 0, 0];
      return this.latch[i - 0xf7];
    }
    if (i === 0xf3) return this.measuring() ? 0x08 : 0;
    if (i === 0xe0) return 0;
    return this.regs[i];
  }
  begin(read: boolean) { this.poll(); this.first = !read; this.latch = null; if (read && this.ptr >= 0xf7 && this.ptr <= 0xfc) this.dataReads++; }
  write(b: number): boolean {
    // เขียน: ที่อยู่รีจิสเตอร์ แล้วค่า — เขียนหลายไบต์ส่งเป็นคู่ (ที่อยู่, ค่า) ต่อกัน (ไม่เลื่อนที่อยู่อัตโนมัติตอนเขียน)
    if (this.first) { this.ptr = b; this.first = false; return true; }
    if (this.wantAddr) { this.ptr = b; this.wantAddr = false; return true; }
    const i = this.ptr;
    if (i === 0xe0) { if (b === 0xb6) this.reset(); }
    else if (i === 0xf4) {
      this.poll();
      const was = this.mode;
      this.regs[0xf4] = b;
      // forced (01/10): วัดหนึ่งครั้ง ใช้เวลาตามสูตร แล้วกลับเป็นโหมดหลับ · normal (11): เริ่มรอบวัดต่อเนื่องจากตอนนี้
      if ((b & 3) === 1 || (b & 3) === 2) this.forcedEnd = this.now() + bmp280MeasTime(b);
      else if ((b & 3) === 3 && was !== 3) { this.cycT0 = this.now(); this.cycDone = 0; }
    } else if (i === 0xf5) { this.poll(); this.regs[0xf5] = b & 0xfd; }
    this.wantAddr = true;
    return true;
  }
  /** อ่าน: ที่อยู่เพิ่มอัตโนมัติ */
  read(): number { const v = this.reg(this.ptr); this.ptr = (this.ptr + 1) & 0xff; return v; }
  end() { this.latch = null; this.wantAddr = false; }
  private wantAddr = false;
}

/* ===================== BH1750 ===================== */

export class Bh1750 implements I2cTarget {
  readonly name = 'BH1750';
  /** ความเข้มแสงจริงรอบเซนเซอร์ (lx) */
  lux = 300;
  /** ความไว count/lx (ทั่วไป 1.2, แต่ละตัว 0.96–1.44 — ค่าที่โค้ดหารด้วย 1.2 จึงคลาดได้ ±20 %) */
  sensitivity = 1.2;
  on = false;
  /** 'h' 1 lx, 'h2' 0.5 lx, 'l' 4 lx · null = ยังไม่สั่งวัด */
  mode: 'h' | 'h2' | 'l' | null = null;
  oneTime = false;
  mt = 69;
  private data = 0;
  private start = 0;
  private reading = 0;
  private mtHi = -1;
  reads = 0; commands = 0;
  constructor(private now: () => number) {}
  reset() { this.on = false; this.mode = null; this.data = 0; this.mt = 69; }

  /** เวลาวัดหนึ่งครั้ง (s): H/H2 120 ms, L 16 ms (ค่าทั่วไป) × MTreg/69 */
  private period() { return (this.mode === 'l' ? 0.016 : 0.12) * (this.mt / 69); }
  private count(): number {
    const k = this.lux * this.sensitivity * (this.mt / 69) * (this.mode === 'h2' ? 2 : 1);
    let c = Math.max(0, Math.min(65535, Math.floor(k)));
    if (this.mode === 'l') c &= ~3;
    return c;
  }
  /** ข้อมูลในรีจิสเตอร์ ณ เวลานี้ (อัปเดตเมื่อวัดเสร็จแต่ละรอบ) */
  private update() {
    if (!this.mode) return;
    const t = this.now(), p = this.period();
    if (t - this.start >= p) {
      this.data = this.count();
      if (this.oneTime) { this.on = false; this.mode = null; }
      else this.start += Math.floor((t - this.start) / p) * p;
    }
  }

  begin(read: boolean) { if (read) { this.update(); this.reading = 0; this.reads++; } }
  write(b: number): boolean {
    this.update();
    this.commands++;
    if (b === 0x00) { this.on = false; this.mode = null; }
    else if (b === 0x01) this.on = true;
    else if (b === 0x07) { if (this.on) this.data = 0; }
    else if ((b & 0xf8) === 0x40) this.mtHi = b & 7;
    else if ((b & 0xe0) === 0x60) { const lo = b & 0x1f; this.mt = Math.max(31, Math.min(254, ((this.mtHi < 0 ? this.mt >> 5 : this.mtHi) << 5) | lo)); }
    else {
      const m: Record<number, ['h' | 'h2' | 'l', boolean]> = { 0x10: ['h', false], 0x11: ['h2', false], 0x13: ['l', false], 0x20: ['h', true], 0x21: ['h2', true], 0x23: ['l', true] };
      const x = m[b];
      if (x) { this.on = true; this.mode = x[0]; this.oneTime = x[1]; this.start = this.now(); }
    }
    return true;
  }
  read(): number { const v = this.reading++ === 0 ? this.data >> 8 : this.data & 0xff; return v; }
  end() {}
  get value() { return this.data; }
}

/* ===================== INA219 ===================== */

/**
 * INA219 วัดกระแส/แรงดัน/กำลังด้าน high side (TI SBOS448): รีจิสเตอร์ 16 บิตส่งไบต์สูงก่อน ผ่านตัวชี้รีจิสเตอร์
 *   0x00 config (ค่าเริ่ม 0x399F: BRNG 32 V, PGA ÷8 = ±320 mV, ADC 12 บิต, โหมดต่อเนื่อง shunt+bus) · 0x01 แรงดัน shunt (10 µV ต่อบิต)
 *   0x02 แรงดันบัส (บิต 15–3 × 4 mV, บิต 1 CNVR, บิต 0 OVF) · 0x03 กำลัง · 0x04 กระแส · 0x05 calibration (ค่าเริ่ม 0 = กระแส/กำลังเป็น 0)
 *   กระแส = shunt × cal / 4096 · กำลัง = กระแส × (บัส >> 3) / 5000 (ปัดเศษทิ้ง) · ค่าแรงดันมาจากวงจรที่คำนวณ (VIN+ − VIN−, VIN− เทียบ GND)
 */
/** เวลาแปลงของช่อง ADC ตามค่า 4 บิต BADC/SADC (TI SBOS448 Table 4): 0xxx = 9–12 บิต, 1000 = 12 บิต, 1001–1111 = เฉลี่ย 2–128 ครั้ง (s) */
export function ina219ConvTime(adc: number): number {
  if (!(adc & 8)) return [84e-6, 148e-6, 276e-6, 532e-6][adc & 3];
  return [532e-6, 1.06e-3, 2.13e-3, 4.26e-3, 8.51e-3, 17.02e-3, 34.05e-3, 68.10e-3][adc & 7];
}

export class Ina219 implements I2cTarget {
  readonly name = 'INA219';
  regs = new Uint16Array(6);
  private ptr = 0;
  private first = true;
  private wbuf: number[] = [];
  private rhi = true;
  reads = 0;
  /** เวลาเริ่มรอบแปลง (shunt แล้ว bus) และจำนวนรอบที่ทำเสร็จ · โหมด triggered ทำรอบเดียว */
  private t0 = 0;
  private done = 0;
  conversions = 0;
  constructor(private volts: () => { shunt: number; bus: number }, private now: () => number = () => 0) { this.reset(); }
  reset() { this.regs.fill(0); this.regs[0] = 0x399f; this.t0 = this.now(); this.done = 0; }
  get mode() { return this.regs[0] & 7; }

  /** เวลาแปลงของ shunt และ bus ตามโหมด (ช่องที่ไม่ได้เลือก = 0) */
  private times() {
    const cfg = this.regs[0], m = cfg & 7;
    return { ts: m & 1 ? ina219ConvTime((cfg >> 3) & 15) : 0, tb: m & 2 ? ina219ConvTime((cfg >> 7) & 15) : 0 };
  }

  /** แปลงหนึ่งรอบ: เขียนรีจิสเตอร์ shunt/bus แล้วคำนวณกระแส/กำลังในพื้นหลัง (ไม่เพิ่มเวลาแปลง) และตั้ง CNVR */
  private measure() {
    const cfg = this.regs[0];
    const mode = cfg & 7;
    if (mode === 0 || mode === 4) return;
    this.conversions++;
    const { shunt, bus } = this.volts();
    const pga = 40e-3 * (1 << ((cfg >> 11) & 3));
    // แรงดัน shunt: ความละเอียด 10 µV, เกินช่วง PGA = ค่าสูงสุดของช่วง
    if (mode & 1) {
      const lim = Math.round(pga / 10e-6);
      this.regs[1] = Math.max(-lim, Math.min(lim, Math.round(shunt / 10e-6))) & 0xffff;
    }
    let ovf = Math.abs(shunt) > pga;
    const brng = (cfg >> 13) & 1 ? 32 : 16;
    if (mode & 2) this.regs[2] = (Math.min(8191, Math.round(Math.max(0, Math.min(brng, bus)) / 4e-3)) << 3);
    const cal = this.regs[5] & 0xfffe;
    const sh = (this.regs[1] << 16) >> 16;
    let cur = cal ? Math.trunc((sh * cal) / 4096) : 0;
    if (cur > 32767 || cur < -32768) { ovf = true; cur = Math.max(-32768, Math.min(32767, cur)); }
    this.regs[4] = cur & 0xffff;
    this.regs[3] = cal ? Math.min(65535, Math.trunc((Math.abs(cur) * (this.regs[2] >> 3)) / 5000)) : 0;
    this.regs[2] = (this.regs[2] & ~3) | 2 | (ovf ? 1 : 0);
  }

  /** เดินการแปลงถึงเวลาปัจจุบัน: ต่อเนื่อง = วนรอบ (shunt แล้ว bus), triggered = รอบเดียวหลังเขียน config */
  poll() {
    const m = this.mode;
    if (m === 0 || m === 4) return;
    const { ts, tb } = this.times(), per = ts + tb;
    if (per <= 0) return;
    const n = Math.floor((this.now() - this.t0 + 1e-12) / per);
    const want = m >= 5 ? n : Math.min(1, n);
    if (want > this.done) { this.measure(); this.done = want; }
  }

  begin(read: boolean) { this.poll(); this.first = !read; this.wbuf = []; this.rhi = true; if (read) this.reads++; }
  write(b: number): boolean {
    if (this.first) { this.ptr = b & 7; this.first = false; return true; }
    this.wbuf.push(b);
    if (this.wbuf.length === 2) {
      const v = (this.wbuf[0] << 8) | this.wbuf[1];
      this.wbuf = [];
      if (this.ptr === 0) {
        if (v & 0x8000) this.reset();
        else {
          this.regs[0] = v;
          // เขียน config (ยกเว้นโหมด power-down/ADC off) ล้าง CNVR และเริ่มรอบแปลงใหม่ (โหมด triggered = สั่งแปลงหนึ่งครั้ง)
          if ((v & 7) !== 0 && (v & 7) !== 4) this.regs[2] &= ~2;
          this.t0 = this.now(); this.done = 0;
        }
      } else if (this.ptr === 5) this.regs[5] = v & 0xfffe; // บิต 0 ของ calibration อ่าน/เขียนไม่ได้
    }
    return true;
  }
  read(): number {
    const v = this.regs[this.ptr] ?? 0;
    const b = this.rhi ? v >> 8 : v & 0xff;
    // ไม่เลื่อนตัวชี้อัตโนมัติ: อ่านต่อเกิน 2 ไบต์ได้รีจิสเตอร์เดิมซ้ำ
    this.rhi = !this.rhi;
    return b;
  }
  /** อ่านรีจิสเตอร์ Power (0x03) ล้าง CNVR (ดาต้าชีต 8.6.3.2) */
  end() { if (this.ptr === 3 && !this.first) this.regs[2] &= ~2; }
}
