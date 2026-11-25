/**
 * อุปกรณ์ของนาฬิกาจอกลม (ระดับรีจิสเตอร์/คำสั่ง — อุปกรณ์รู้เฉพาะไบต์ที่มาถึงบนบัสและระดับขา ไม่อ่านข้อความโค้ด)
 *   GC9A01   ไอซีขับจอ TFT กลม 240×240 แบบ SPI 4 สาย (คำสั่ง/ข้อมูลแยกด้วยขา DC)
 *            คำสั่งมาตรฐาน: 0x01 SWRESET, 0x10/0x11 SLPIN/SLPOUT, 0x20/0x21 INVOFF/INVON, 0x28/0x29 DISPOFF/DISPON,
 *            0x2A CASET, 0x2B RASET, 0x2C RAMWR, 0x3C RAMWRC, 0x36 MADCTL (MY MX MV ML BGR MH), 0x3A COLMOD (16/18 บิต)
 *            คำสั่งเฉพาะผู้ผลิตในลำดับเริ่มต้น (0xEF, 0xEB, 0x84–0x8F, 0x62–0x67 …) รับไว้แต่ไม่มีผลต่อภาพในแบบจำลอง
 *   CST816S  ตัวควบคุมทัชสกรีน I²C ที่อยู่ 0x15 (Hynitron CST816S register declaration): 0x01 GestureID, 0x02 FingerNum,
 *            0x03–0x06 พิกัด X/Y 12 บิต, 0xA7 ChipID (0xB4 ตามตารางของ ESPHome), 0xED ความกว้างพัลส์ INT (×0.1 ms),
 *            0xFA IrqCtl (EnTouch/EnChange/EnMotion), 0xFE DisAutoSleep
 *   QMI8658  ความเร่ง + ไจโร 6 แกน (QST QMI8658A datasheet rev A): WHO_AM_I 0x00 = 0x05, CTRL1 0x02 (ADDR_AI บิต 6, BE บิต 5 ค่าเริ่ม 0x20),
 *            CTRL2/3 สเกลและอัตรา, CTRL7 0x08 (aEN/gEN — ปิดหลังเปิดเครื่อง), อุณหภูมิ 0x33–0x34, ข้อมูล 0x35–0x40, RESET 0x60 ← 0xB0
 * ข้อสมมติของแบบจำลอง (ไม่มีในเอกสาร — เลือกให้ไดรเวอร์ gc9a01py และตัวอย่างของผู้ผลิตได้ภาพตั้งตรงสีถูก):
 *   จอแสดงหน่วยความจำกลับซ้าย-ขวา (MADCTL 0x48 = แนวตั้งปกติ), ผลึกสีเรียง BGR (บิต BGR = 1 สีถูก), แผง IPS ต้อง INVON สีจึงถูก
 */
import { motionSample, trueSteps, type I2cTarget, type Motion } from './i2c-devices';

export const LCD_W = 240;
export const LCD_H = 240;

/* ===================== GC9A01 ===================== */

export class Gc9a01 {
  /** หน่วยความจำภาพ (ค่า 16 บิตตามลำดับที่ส่ง: ไบต์แรก = บิตสูง) */
  gram = new Uint16Array(LCD_W * LCD_H);
  sleep = true; on = false; inv = false; idle = false;
  madctl = 0; colmod = 0x66;
  xs = 0; xe = LCD_W - 1; ys = 0; ye = LCD_H - 1;
  private col = 0; private row = 0;
  private cmd = -1;
  private args: number[] = [];
  private writing = false;
  private part: number[] = [];
  /** เพิ่มทุกครั้งที่ภาพที่มองเห็นอาจเปลี่ยน */
  ver = 1;
  bytes = 0; cmds = 0; pixels = 0; resets = 0;

  /** ไฟเข้าใหม่: หน่วยความจำภาพเป็นค่าสุ่ม (ไม่ได้ล้าง) */
  powerOn(seed = 1) {
    let s = seed >>> 0 || 1;
    for (let i = 0; i < this.gram.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.gram[i] = s & 0xffff; }
    this.reset();
  }

  /** รีเซ็ต (ขา RST หรือคำสั่ง 0x01): กลับสู่สถานะหลับ ปิดจอ ค่าเริ่มต้นของรีจิสเตอร์ — หน่วยความจำภาพไม่ถูกล้าง */
  reset() {
    this.sleep = true; this.on = false; this.inv = false; this.idle = false;
    this.madctl = 0; this.colmod = 0x66;
    this.xs = 0; this.xe = LCD_W - 1; this.ys = 0; this.ye = LCD_H - 1;
    this.cmd = -1; this.args = []; this.writing = false; this.part = [];
    this.resets++; this.ver++;
  }

  command(c: number) {
    this.cmds++;
    this.cmd = c; this.args = []; this.writing = false; this.part = [];
    switch (c) {
      case 0x01: this.reset(); break;
      case 0x10: this.sleep = true; this.ver++; break;
      case 0x11: this.sleep = false; this.ver++; break;
      case 0x20: this.inv = false; this.ver++; break;
      case 0x21: this.inv = true; this.ver++; break;
      case 0x28: this.on = false; this.ver++; break;
      case 0x29: this.on = true; this.ver++; break;
      case 0x38: this.idle = false; this.ver++; break;
      case 0x39: this.idle = true; this.ver++; break;
      case 0x2c: this.writing = true; this.col = this.xs; this.row = this.ys; break;
      case 0x3c: this.writing = true; break;
    }
  }

  data(b: number) {
    this.bytes++;
    if (this.writing) {
      this.part.push(b);
      const n = (this.colmod & 7) === 6 ? 3 : 2;
      if (this.part.length < n) return;
      const p = this.part;
      this.part = [];
      // 18 บิต: R, G, B อย่างละไบต์ (ใช้ 6 บิตบน) → เก็บเป็น 5-6-5
      const v = n === 2 ? (p[0] << 8) | p[1] : ((p[0] >> 3) << 11) | ((p[1] >> 2) << 5) | (p[2] >> 3);
      this.put(v);
      return;
    }
    this.args.push(b);
    const a = this.args;
    switch (this.cmd) {
      case 0x2a: if (a.length === 4) { this.xs = (a[0] << 8) | a[1]; this.xe = (a[2] << 8) | a[3]; } break;
      case 0x2b: if (a.length === 4) { this.ys = (a[0] << 8) | a[1]; this.ye = (a[2] << 8) | a[3]; } break;
      case 0x36: if (a.length === 1) { this.madctl = b; this.ver++; } break;
      case 0x3a: if (a.length === 1) this.colmod = b; break;
    }
  }

  /** เขียนหนึ่งพิกเซลที่ตัวนับที่อยู่ปัจจุบัน แล้วเลื่อนตัวนับในหน้าต่าง CASET/RASET */
  private put(v: number) {
    let mx = this.col, my = this.row;
    if (this.madctl & 0x20) { const t = mx; mx = my; my = t; } // MV
    if (this.madctl & 0x40) mx = LCD_W - 1 - mx; // MX
    if (this.madctl & 0x80) my = LCD_H - 1 - my; // MY
    if (mx >= 0 && mx < LCD_W && my >= 0 && my < LCD_H) { this.gram[my * LCD_W + mx] = v; this.pixels++; }
    this.ver++;
    if (++this.col > this.xe) { this.col = this.xs; if (++this.row > this.ye) this.row = this.ys; }
  }
}

/** สถานะจอที่ส่งให้หน้าเว็บ */
export interface LcdView { powered: boolean; on: boolean; sleep: boolean; inv: boolean; madctl: number; bl: number }

/**
 * สีที่ตามองเห็น (RGBA 240×240) จากหน่วยความจำภาพ + สถานะจอ + ความสว่างไฟพื้นหลัง (0–1)
 * นอกวงกลม Ø240 เป็นโปร่งใส (หน้าจอกลม)
 */
export function lcdRgba(st: LcdView, gram: Uint16Array, out = new Uint8ClampedArray(LCD_W * LCD_H * 4)): Uint8ClampedArray {
  const show = st.powered && st.on && !st.sleep;
  const bl = st.powered ? Math.max(0, Math.min(1, st.bl)) : 0;
  const bgr = (st.madctl & 0x08) !== 0;
  const r2 = (LCD_W / 2) * (LCD_W / 2);
  for (let y = 0; y < LCD_H; y++) {
    for (let x = 0; x < LCD_W; x++) {
      const o = (y * LCD_W + x) * 4;
      const dx = x - 119.5, dy = y - 119.5;
      if (dx * dx + dy * dy > r2) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      out[o + 3] = 255;
      if (!show) { const k = Math.round(6 * bl); out[o] = out[o + 1] = out[o + 2] = k; continue; }
      let v = gram[y * LCD_W + (LCD_W - 1 - x)];
      if (!st.inv) v = ~v & 0xffff;
      let r = v >> 11, g = (v >> 5) & 63, b = v & 31;
      if (!bgr) { const t = r; r = b; b = t; }
      out[o] = ((r << 3) | (r >> 2)) * bl;
      out[o + 1] = ((g << 2) | (g >> 4)) * bl;
      out[o + 2] = ((b << 3) | (b >> 2)) * bl;
    }
  }
  return out;
}

/* ===================== CST816S ===================== */

export type TouchEvent = { x: number; y: number; down: boolean };

/** ระยะลากขั้นต่ำที่นับเป็นการปัด (พิกเซล) และเวลากดค้าง — ค่าที่เลือกในแบบจำลอง (เอกสารไม่ระบุ) */
const SWIPE_MIN = 30;
const LONG_PRESS_S = 1.5;
/** การแตะสั้นที่สุดที่ส่งให้ชิป (กด–ปล่อยในคำขอเดียวกันจากหน้าเว็บ) */
const MIN_TAP_S = 0.03;

export const GESTURE_NAMES: Record<number, string> = { 0: 'ไม่มี', 1: 'ปัดขึ้น', 2: 'ปัดลง', 3: 'ปัดซ้าย', 4: 'ปัดขวา', 5: 'แตะ', 0x0b: 'แตะสองครั้ง', 0x0c: 'กดค้าง' };

export class Cst816s implements I2cTarget {
  readonly name = 'CST816S';
  regs = new Uint8Array(256);
  private ptr = 0;
  private first = true;
  down = false;
  x = 0; y = 0;
  gesture = 0;
  private downAt = 0; private downX = 0; private downY = 0; private longDone = false;
  /** พัลส์ต่ำของขา INT ที่กำหนดเวลาไว้แล้ว [เริ่ม, จบ] */
  private pulses: Array<[number, number]> = [];
  /** เหตุการณ์สัมผัสที่ยังไม่ถึงเวลา */
  private queue: Array<TouchEvent & { t: number }> = [];
  private lastEvT = -Infinity;
  /** สถิติ (แผงผล/ตัวตรวจแลป) */
  touches = 0; gestures = 0; reads = 0; gestureLog: number[] = [];
  constructor(private now: () => number) { this.reset(); }

  reset() {
    this.regs.fill(0);
    this.regs[0xa7] = 0xb4; this.regs[0xa8] = 0x00; this.regs[0xa9] = 0x01;
    this.regs[0xed] = 10; this.regs[0xee] = 1; this.regs[0xf9] = 2; this.regs[0xfc] = 10;
    // ค่าเริ่มของ IrqCtl ไม่มีในเอกสาร: ผู้ใช้โมดูลรายงานว่า INT ต่ำทุกครั้งที่สัมผัส → ใช้ EnTouch + EnChange
    this.regs[0xfa] = 0x60;
    this.down = false; this.gesture = 0; this.pulses = []; this.longDone = false;
  }

  get irqCtl() { return this.regs[0xfa]; }
  private get width() { return Math.max(1, this.regs[0xed]) * 1e-4; }
  private get period() { return Math.max(1, this.regs[0xee]) * 0.01; }

  /** เหตุการณ์จากหน้าเว็บ ณ เวลาจำลอง t (การปล่อยนิ้วต้องห่างจากการกดอย่างน้อย 30 ms) */
  touch(t: number, e: TouchEvent) {
    let when = t;
    if (when < this.lastEvT + MIN_TAP_S) when = this.lastEvT + MIN_TAP_S;
    this.queue.push({ ...e, t: when });
    this.lastEvT = when;
  }

  private pulse(t: number) { this.pulses.push([t, t + this.width]); if (this.pulses.length > 64) this.pulses.splice(0, this.pulses.length - 64); }

  /** เดินเวลาถึง t: ประมวลผลเหตุการณ์ที่ถึงเวลา + กดค้าง */
  advance(t: number) {
    while (this.queue.length && this.queue[0].t <= t + 1e-12) {
      const e = this.queue.shift()!;
      this.checkLong(e.t);
      const x = Math.max(0, Math.min(239, Math.round(e.x))), y = Math.max(0, Math.min(239, Math.round(e.y)));
      if (e.down && !this.down) {
        this.down = true; this.downAt = e.t; this.downX = x; this.downY = y; this.longDone = false; this.gesture = 0; this.touches++;
        if (this.irqCtl & 0x20) this.pulse(e.t);
      } else if (!e.down && this.down) {
        this.down = false;
        const dx = x - this.downX, dy = y - this.downY;
        let g = 0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) g = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 3 : 4) : (dy < 0 ? 1 : 2);
        else if (!this.longDone) g = 5;
        if (g) this.setGesture(g, e.t);
        if ((this.irqCtl & 0x20) && !(g && (this.irqCtl & 0x10))) this.pulse(e.t);
      }
      this.x = x; this.y = y;
    }
    this.checkLong(t);
  }

  /** กดค้างครบเวลา (ลากไปไกลแล้วไม่นับ) */
  private checkLong(t: number) {
    if (this.down && !this.longDone && t - this.downAt >= LONG_PRESS_S - 1e-12) {
      this.longDone = true;
      if (Math.max(Math.abs(this.x - this.downX), Math.abs(this.y - this.downY)) < SWIPE_MIN) this.setGesture(0x0c, this.downAt + LONG_PRESS_S);
    }
  }

  private setGesture(g: number, t: number) {
    this.gesture = g; this.gestures++; this.gestureLog.push(g);
    if (this.gestureLog.length > 20) this.gestureLog.shift();
    if (this.irqCtl & 0x10) this.pulse(t);
  }

  /** ขา INT ต่ำอยู่ที่เวลา t (พัลส์ต่ำ — สัมผัสค้าง: ทุกคาบสแกนเมื่อเปิด EnTouch) */
  intLow(t: number): boolean {
    for (const [a, b] of this.pulses) if (t >= a - 1e-12 && t < b - 1e-12) return true;
    if (this.down && (this.irqCtl & 0x40)) {
      const ph = (t - this.downAt) % this.period;
      if (t >= this.downAt && ph < this.width - 1e-12) return true;
    }
    return false;
  }

  /** เวลาของขอบ INT หรือเหตุการณ์ถัดไปหลัง t */
  nextEvent(t: number): number {
    let n = Infinity;
    for (const [a, b] of this.pulses) { if (a > t + 1e-12) n = Math.min(n, a); else if (b > t + 1e-12) n = Math.min(n, b); }
    if (this.queue.length) n = Math.min(n, Math.max(this.queue[0].t, t + 1e-9));
    if (this.down) {
      if (this.irqCtl & 0x40) {
        const k = Math.floor((t - this.downAt) / this.period);
        const start = this.downAt + k * this.period, end = start + this.width;
        n = Math.min(n, end > t + 1e-12 ? end : start + this.period);
      }
      if (!this.longDone) n = Math.min(n, this.downAt + LONG_PRESS_S);
    }
    this.pulses = this.pulses.filter(([, b]) => b > t - 0.05);
    return n;
  }

  private reg(i: number): number {
    switch (i) {
      case 0x01: return this.gesture;
      case 0x02: return this.down ? 1 : 0;
      case 0x03: return (this.x >> 8) & 0x0f;
      case 0x04: return this.x & 0xff;
      case 0x05: return (this.y >> 8) & 0x0f;
      case 0x06: return this.y & 0xff;
    }
    return this.regs[i];
  }

  begin(read: boolean) { this.first = !read; this.advance(this.now()); if (read && this.ptr >= 0x01 && this.ptr <= 0x06) this.reads++; }
  write(b: number): boolean {
    if (this.first) { this.ptr = b & 0xff; this.first = false; return true; }
    if (this.ptr >= 0xec) this.regs[this.ptr] = b;
    this.ptr = (this.ptr + 1) & 0xff;
    return true;
  }
  read(): number { const v = this.reg(this.ptr); this.ptr = (this.ptr + 1) & 0xff; return v; }
  end() {}
}

/* ===================== QMI8658 ===================== */

export class Qmi8658 implements I2cTarget {
  readonly name = 'QMI8658';
  regs = new Uint8Array(128);
  private ptr = 0;
  private first = true;
  private latch: number[] | null = null;
  motion: Motion = 'still';
  spm = 100;
  temperature = 25;
  motionStart = 0;
  dataReads = 0;
  constructor(private now: () => number) { this.reset(); }
  reset() { this.regs.fill(0); this.regs[0x00] = 0x05; this.regs[0x01] = 0x7c; this.regs[0x02] = 0x20; }
  get aEn() { return (this.regs[0x08] & 1) !== 0 && !(this.regs[0x02] & 1); }
  get gEn() { return (this.regs[0x08] & 2) !== 0 && !(this.regs[0x02] & 1); }
  /** ข้อมูลเรียงไบต์สูงก่อน (CTRL1.BE = 1 ค่าเริ่มต้น) */
  get bigEndian() { return (this.regs[0x02] & 0x20) !== 0; }
  get autoInc() { return (this.regs[0x02] & 0x40) !== 0; }

  /** 0x30–0x40: TIMESTAMP 3 ไบต์, TEMP 2 ไบต์, AX..GZ 12 ไบต์ ณ เวลานี้ */
  private sample(): number[] {
    const t = this.now();
    const s = motionSample(this.motion, t - this.motionStart, this.spm);
    const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
    const aS = 16384 >> ((this.regs[0x03] >> 4) & 3), gS = 2048 >> ((this.regs[0x04] >> 4) & 7);
    const on = this.aEn || this.gEn;
    const ts = on ? Math.floor(t * 1000) & 0xffffff : 0;
    const temp = on ? clamp(this.temperature * 256) : 0;
    const words = [temp, ...(this.aEn ? s.a.map((v) => clamp(v * aS)) : [0, 0, 0]), ...(this.gEn ? s.g.map((v) => clamp(v * gS)) : [0, 0, 0])];
    const be = this.bigEndian;
    const bytes = words.flatMap((w) => (be ? [(w >> 8) & 0xff, w & 0xff] : [w & 0xff, (w >> 8) & 0xff]));
    return [ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, ...bytes];
  }

  private reg(i: number): number {
    if (i >= 0x30 && i <= 0x40) { this.latch ??= this.sample(); return this.latch[i - 0x30]; }
    if (i === 0x2e) return (this.aEn ? 1 : 0) | (this.gEn ? 2 : 0);
    return this.regs[i];
  }

  begin(read: boolean) { this.first = !read; this.latch = null; if (read && this.ptr >= 0x35 && this.ptr <= 0x40) this.dataReads++; }
  write(b: number): boolean {
    if (this.first) { this.ptr = b & 0x7f; this.first = false; return true; }
    const i = this.ptr;
    if (i === 0x60) { if (b === 0xb0) this.reset(); }
    else if (i >= 0x02 && i <= 0x0a) this.regs[i] = b;
    if (this.autoInc) this.ptr = (i + 1) & 0x7f;
    return true;
  }
  read(): number { const v = this.reg(this.ptr); if (this.autoInc) this.ptr = (this.ptr + 1) & 0x7f; return v; }
  end() { this.latch = null; }
  steps(): number { return this.motion === 'walk' ? trueSteps(this.now() - this.motionStart, this.spm) : 0; }
}

/**
 * LSM6DSOX ความเร่ง 3 แกน + ไจโร (STMicroelectronics LSM6DSOX datasheet DS12814) — IMU บนบอร์ด Arduino Nano RP2040 Connect
 * WHO_AM_I (0x0F) = 0x6C · CTRL3_C (0x12) ค่าเริ่ม 0x04: IF_INC (บิต 2) = ตัวชี้รีจิสเตอร์เพิ่มเองเมื่ออ่าน/เขียนต่อเนื่อง, SW_RESET (บิต 0) ล้างตัวเองหลังรีเซ็ต
 * CTRL1_XL (0x10): ODR_XL บิต 7–4 (0000 = ปิด), FS_XL บิต 3–2: 00 ±2 g, 01 ±16 g, 10 ±4 g, 11 ±8 g → 0.061/0.488/0.122/0.244 mg/LSB
 * CTRL2_G (0x11): ODR_G บิต 7–4, FS_G บิต 3–2: 00 250, 01 500, 10 1000, 11 2000 dps (8.75/17.5/35/70 mdps/LSB), FS_125 บิต 1 → 4.375 mdps/LSB
 * ข้อมูล 16 บิตไบต์ต่ำก่อน: OUT_TEMP 0x20–0x21 (256 LSB/°C, 0 = 25 °C), OUTX_L_G 0x22–0x27, OUTX_L_A 0x28–0x2D · STATUS_REG 0x1E: XLDA/GDA/TDA
 * ขณะปิด (ODR = 0000) รีจิสเตอร์ข้อมูลค้างค่าล่าสุด · ค่ามาจากการเคลื่อนไหวที่ตั้งในแผงคุณสมบัติ (motionSample เดียวกับ MPU6050/QMI8658)
 * ไม่จำลอง: FIFO, ฟังก์ชันฝังตัว/MLC, ขา INT1/INT2, ตัวกรอง, โหมดประหยัดพลังงาน
 */
export class Lsm6dsox implements I2cTarget {
  readonly name = 'LSM6DSOX';
  regs = new Uint8Array(128);
  private ptr = 0;
  private first = true;
  private latch: number[] | null = null;
  /** ค่าล่าสุดที่วัดได้ (ค้างไว้เมื่อปิดเซนเซอร์) */
  private last = new Array<number>(14).fill(0);
  motion: Motion = 'still';
  spm = 100;
  temperature = 25;
  motionStart = 0;
  dataReads = 0;
  constructor(private now: () => number) { this.reset(); }
  reset() { this.regs.fill(0); this.regs[0x0f] = 0x6c; this.regs[0x12] = 0x04; this.last.fill(0); }
  get aOn() { return (this.regs[0x10] >> 4) !== 0; }
  get gOn() { return (this.regs[0x11] >> 4) !== 0; }
  get autoInc() { return (this.regs[0x12] & 0x04) !== 0; }
  /** LSB ต่อ g ตาม FS_XL */
  get aLsb() { return 1000 / [0.061, 0.488, 0.122, 0.244][(this.regs[0x10] >> 2) & 3]; }
  /** LSB ต่อ dps ตาม FS_G / FS_125 */
  get gLsb() { return 1000 / ((this.regs[0x11] & 0x02) ? 4.375 : [8.75, 17.5, 35, 70][(this.regs[0x11] >> 2) & 3]); }

  /** 0x20–0x2D: TEMP, GX..GZ, AX..AZ ไบต์ต่ำก่อน */
  private sample(): number[] {
    const s = motionSample(this.motion, this.now() - this.motionStart, this.spm);
    const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
    const w = (k: number) => [this.last[2 * k] | (this.last[2 * k + 1] << 8)];
    const words = [
      ...(this.aOn || this.gOn ? [clamp((this.temperature - 25) * 256)] : w(0)),
      ...(this.gOn ? s.g.map((v) => clamp(v * this.gLsb)) : [1, 2, 3].flatMap(w)),
      ...(this.aOn ? s.a.map((v) => clamp(v * this.aLsb)) : [4, 5, 6].flatMap(w)),
    ];
    this.last = words.flatMap((x) => [x & 0xff, (x >> 8) & 0xff]);
    return this.last;
  }

  private reg(i: number): number {
    if (i >= 0x20 && i <= 0x2d) { this.latch ??= this.sample(); return this.latch[i - 0x20]; }
    if (i === 0x1e) return (this.aOn ? 1 : 0) | (this.gOn ? 2 : 0) | (this.aOn || this.gOn ? 4 : 0);
    return this.regs[i];
  }
  begin(read: boolean) { this.first = !read; this.latch = null; if (read && this.ptr >= 0x22 && this.ptr <= 0x2d) this.dataReads++; }
  write(b: number): boolean {
    if (this.first) { this.ptr = b & 0x7f; this.first = false; return true; }
    const i = this.ptr;
    if (i === 0x12 && (b & 0x01)) this.reset(); // SW_RESET: รีจิสเตอร์กลับค่าเริ่ม บิตล้างเอง
    else if (i === 0x12) this.regs[i] = b & 0x7e; // BOOT (บิต 7) ล้างเองทันที
    else if (i !== 0x0f && i !== 0x1e && !(i >= 0x20 && i <= 0x2d)) this.regs[i] = b;
    if (this.autoInc) this.ptr = (i + 1) & 0x7f;
    return true;
  }
  read(): number { const v = this.reg(this.ptr); if (this.autoInc) this.ptr = (this.ptr + 1) & 0x7f; return v; }
  end() { this.latch = null; }
}
