/**
 * เครื่องวิเคราะห์ลอจิก 8 ช่อง — ส่วนเก็บสัญญาณ (ฝั่งตัวคำนวณ), บัฟเฟอร์ (ฝั่งแอป), การวัด PWM และตัวถอดรหัส UART
 *
 * ที่มาของขอบสัญญาณในแต่ละช่อง (ไม่มีการสร้างสัญญาณขึ้นเอง):
 *  - เน็ตที่ขาเอาต์พุตของไมโครคอนโทรลเลอร์ขับ: เวลาขอบจากตัวจำลอง CPU ตรงคำสั่งที่เปลี่ยนขา (avr8js: ทุกรอบสัญญาณนาฬิกา 62.5 ns, rp2040js: ns)
 *  - ขา TX/RX ของ UART ฮาร์ดแวร์ (Uno/Nano USART0, Pico UART0): ตัวจำลองส่ง/รับเป็นไบต์ — รูปคลื่นบิต (start · data LSB ก่อน · parity · stop)
 *    สร้างจากไบต์นั้นตามบอดเรตจากรีจิสเตอร์ของชิป (AVR: (UBRR+1)·ตัวคูณ รอบ/บิต — คลาดจากบอดเรตที่ขอเท่าชิปจริง) · วงจรแอนะล็อกยังเห็นขา TX ค้าง HIGH
 *  - สาย SDA/SCL ของ I²C ฮาร์ดแวร์ (Uno/Nano TWI, Pico I2C): ตัวจำลองทำธุรกรรมเป็นขั้น — รูปคลื่นสร้างจากขั้นนั้นตามคาบ SCL จากรีจิสเตอร์ของชิป
 *    (src/mcu/i2c-wave.ts) และ CPU ได้รับแจ้ง "เสร็จ" หลังเวลาเท่าบัสจริง
 *  - เน็ตอื่น: แรงดันที่คำนวณได้ทุกก้าวเวลาของตัวคำนวณวงจร เทียบเกณฑ์ LVTTL (LOW < 0.8 V, HIGH > 2.0 V มี hysteresis) — ความละเอียดเวลาเท่าก้าวจำลอง
 */
import { voltageBetween, type SimResult } from '../sim/solver';

/** ช่องของเครื่องวิเคราะห์ในเน็ตลิสต์: เน็ตของ CH0–CH7 (−1 = ไม่ได้ต่อ) และ GND */
export interface AnalyzerSpec { id: string; ch: number[]; gnd: number }

export const LA_VIL = 0.8;
export const LA_VIH = 2.0;
/** ขอบสูงสุดต่อช่องต่อคำขอหนึ่งครั้ง (กันหน่วยความจำ/การส่งข้อมูลล้นเมื่อสัญญาณถี่มาก) */
export const LA_MAX_EDGES = 20000;

export type ChSource = 'mcu' | 'uart' | 'i2c' | 'spi' | 'analog' | 'none';
/** ข้อมูลหนึ่งช่องในช่วงเวลา [t0, t1]: ระดับตอนเริ่ม + ขอบ (เวลา s, ระดับใหม่) */
export interface LogicChannelChunk { lvl0: 0 | 1 | null; t: number[]; v: Array<0 | 1 | null>; src: ChSource; over?: boolean }
export interface LogicChunk { t0: number; t1: number; ch: LogicChannelChunk[] }

/** เหตุการณ์จากตัวจำลอง CPU */
export type McuTraceEvent =
  | { kind: 'pin'; i: number; high: boolean | null; tNs: number }
  | { kind: 'tx' | 'rx'; byte: number; tNs: number; bitNs: number; bits: number; parity: 0 | 1 | 2; stop: number; /** USART 1–3 (Serial1–3 ของ Mega) — ไม่มี = USART0 */ uart?: number };

/** บิตของเฟรม UART (ระดับลอจิกบนสาย) ตามลำดับเวลา: start 0 · data LSB ก่อน · parity (1 = คี่, 2 = คู่) · stop 1 */
export function uartFrameBits(byte: number, bits = 8, parity: 0 | 1 | 2 = 0, stop = 1): Array<0 | 1> {
  const out: Array<0 | 1> = [0];
  let ones = 0;
  for (let k = 0; k < bits; k++) { const b = ((byte >> k) & 1) as 0 | 1; ones += b; out.push(b); }
  if (parity) out.push((parity === 2 ? ones & 1 : (ones + 1) & 1) as 0 | 1);
  for (let k = 0; k < stop; k++) out.push(1);
  return out;
}

/**
 * ตัวเก็บสัญญาณฝั่งตัวคำนวณ (หนึ่งตัวต่อเครื่องวิเคราะห์) — สถานะระดับสุดท้ายของแต่ละช่องคงอยู่ข้ามคำขอ
 * ลำดับการใช้ต่อคำขอ: begin(t0) → mcuEdge/uartFrame/analog (เรียงตามเวลาโดยประมาณ) → end(t1)
 */
export class LogicCapture {
  private lvl: Array<0 | 1 | null>;
  private lastT: number[];
  /** เวลาปลายเฟรม UART ล่าสุดของแต่ละช่อง (เฟรมถัดไปเริ่มไม่ก่อนนี้ — เหมือน shift register ที่ส่งทีละเฟรม) */
  private uartEnd: number[];
  private cur: LogicChannelChunk[] = [];
  private t0 = 0;
  constructor(public spec: AnalyzerSpec) {
    this.lvl = spec.ch.map(() => null);
    this.lastT = spec.ch.map(() => -Infinity);
    this.uartEnd = spec.ch.map(() => -Infinity);
  }
  reset() { this.lvl.fill(null); this.lastT.fill(-Infinity); this.uartEnd.fill(-Infinity); }
  begin(t0: number) {
    this.t0 = t0;
    this.cur = this.spec.ch.map((_, k) => ({ lvl0: this.lvl[k], t: [], v: [], src: this.spec.ch[k] < 0 ? 'none' : 'analog' }));
  }
  private push(k: number, t: number, v: 0 | 1 | null, src: ChSource) {
    const c = this.cur[k];
    if (!c) return;
    if (src !== 'analog' || c.src === 'none') c.src = src;
    if (this.spec.gnd < 0) v = null; // ไม่ได้ต่อ GND ของเครื่องวิเคราะห์ → อ่านระดับไม่ได้
    if (this.lvl[k] === v) return;
    if (c.t.length >= LA_MAX_EDGES) { c.over = true; this.lvl[k] = v; return; }
    const tt = Math.max(t, this.lastT[k]);
    c.t.push(tt); c.v.push(v);
    this.lvl[k] = v; this.lastT[k] = tt;
  }
  /** ช่องที่ต่ออยู่บนเน็ตนี้ */
  channelsOn(net: number): number[] { const r: number[] = []; if (net < 0) return r; this.spec.ch.forEach((n, k) => { if (n === net) r.push(k); }); return r; }
  /** ขอบจากขาเอาต์พุตของ MCU (null = ขาเลิกขับ — ระดับต่อจากนี้มาจากวงจร) */
  mcuEdge(net: number, t: number, high: boolean | null) {
    for (const k of this.channelsOn(net)) { if (high === null) { this.cur[k].src = 'analog'; continue; } this.push(k, t, high ? 1 : 0, 'mcu'); }
  }
  /** เฟรม UART หนึ่งไบต์บนเน็ตของขา TX/RX */
  uartFrame(net: number, t: number, bitS: number, bits: Array<0 | 1>) {
    for (const k of this.channelsOn(net)) {
      let ts = Math.max(t, this.uartEnd[k]);
      if (this.lvl[k] !== 1) this.push(k, Math.max(ts - bitS * 2, this.lastT[k]), 1, 'uart'); // สายว่าง = HIGH
      for (const b of bits) { this.push(k, ts, b, 'uart'); ts += bitS; }
      this.uartEnd[k] = ts;
      this.cur[k].src = 'uart';
    }
  }
  /** ขอบบนสาย I²C ฮาร์ดแวร์ (SDA/SCL) */
  i2cEdge(net: number, t: number, v: 0 | 1) { for (const k of this.channelsOn(net)) this.push(k, t, v, 'i2c'); }
  /** ขอบบนสาย SPI ฮาร์ดแวร์ (SCK/MOSI) สร้างจากไบต์ที่ส่งตามความถี่และโหมดของชิป */
  spiEdge(net: number, t: number, v: 0 | 1) { for (const k of this.channelsOn(net)) this.push(k, t, v, 'spi'); }
  /** ตัวอย่างจากตัวคำนวณวงจรที่เวลา t — ช่องที่ driven(net) = true ข้าม (ระดับมาจาก MCU/UART) */
  analog(t: number, r: SimResult, driven: (net: number) => boolean) {
    if (!r.ok) return;
    if (this.spec.gnd < 0) { this.spec.ch.forEach((net, k) => { if (net >= 0) this.push(k, t, null, 'analog'); }); return; }
    this.spec.ch.forEach((net, k) => {
      if (net < 0 || driven(net) || t < this.uartEnd[k]) return;
      const v = voltageBetween(r, net, this.spec.gnd).value;
      let nv: 0 | 1 | null;
      if (v === null) nv = null; // ลอย / ไม่มีอะไรกำหนดแรงดัน
      else if (v > LA_VIH) nv = 1;
      else if (v < LA_VIL) nv = 0;
      else nv = this.lvl[k] ?? (v >= (LA_VIL + LA_VIH) / 2 ? 1 : 0);
      this.push(k, t, nv, 'analog');
    });
  }
  /** ตั้งระดับเริ่มของช่องที่ MCU ขับอยู่ (ตอนเริ่มคำขอ) */
  setDriven(net: number, t: number, high: boolean, src: ChSource = 'mcu') { for (const k of this.channelsOn(net)) { this.push(k, t, high ? 1 : 0, src); this.cur[k].src = src; } }
  end(t1: number): LogicChunk { return { t0: this.t0, t1, ch: this.cur }; }
}

/* ======================= ฝั่งแอป: บัฟเฟอร์ + การวัด + ถอดรหัส ======================= */

export interface LogicTrace { lvl0: 0 | 1 | null; t: number[]; v: Array<0 | 1 | null>; src: ChSource; over: boolean }

/** บัฟเฟอร์ของเครื่องวิเคราะห์หนึ่งตัว: ต่อชิ้นข้อมูลจากตัวคำนวณ เก็บย้อนหลัง keep วินาที */
export class LogicBuffer {
  ch: LogicTrace[] = Array.from({ length: 8 }, () => ({ lvl0: null, t: [], v: [], src: 'none', over: false }));
  t0 = 0;
  t1 = 0;
  frozen = false;
  reset() { this.ch = Array.from({ length: 8 }, () => ({ lvl0: null, t: [], v: [], src: 'none', over: false })); this.t0 = this.t1 = 0; }
  push(c: LogicChunk, keep: number) {
    if (this.frozen) return;
    if (!this.ch.some((x) => x.t.length) && this.t1 === 0) this.t0 = c.t0;
    c.ch.forEach((x, k) => {
      const tr = this.ch[k];
      if (!tr) return;
      if (!tr.t.length && tr.lvl0 === null) tr.lvl0 = x.lvl0;
      for (let i = 0; i < x.t.length; i++) {
        if (tr.t.length && x.t[i] < tr.t[tr.t.length - 1]) continue;
        tr.t.push(x.t[i]); tr.v.push(x.v[i]);
      }
      tr.src = x.src;
      if (x.over) tr.over = true;
    });
    this.t1 = Math.max(this.t1, c.t1);
    this.trim(keep);
  }
  trim(keep: number) {
    const cut = this.t1 - keep;
    if (cut <= this.t0) return;
    for (const tr of this.ch) {
      let i = 0;
      while (i < tr.t.length && tr.t[i] < cut) i++;
      if (i > 0) { tr.lvl0 = tr.v[i - 1]; tr.t.splice(0, i); tr.v.splice(0, i); }
      if (tr.t.length > 200000) { const d = tr.t.length - 200000; tr.lvl0 = tr.v[d - 1]; tr.t.splice(0, d); tr.v.splice(0, d); }
    }
    this.t0 = cut;
  }
}

/** ระดับของช่องที่เวลา t (ค้นแบบทวิภาค) */
export function levelAt(tr: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, t: number): 0 | 1 | null {
  let lo = 0, hi = tr.t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m] <= t) lo = m + 1; else hi = m; }
  return lo === 0 ? tr.lvl0 : tr.v[lo - 1];
}
/** ดัชนีขอบแรกที่เวลา ≥ t */
export function edgeIndex(tr: Pick<LogicTrace, 't'>, t: number): number {
  let lo = 0, hi = tr.t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

export interface PwmMeasure { freq: number | null; period: number | null; duty: number | null; high: number | null; low: number | null; rising: number; level: 0 | 1 | null }

/** วัดความถี่/duty จากขอบขาขึ้นในช่วง [a, b] (ใช้เฉพาะคาบที่ครบ) */
export function measurePwm(tr: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, a: number, b: number): PwmMeasure {
  const i0 = edgeIndex(tr, a), i1 = edgeIndex(tr, b);
  const rises: number[] = [], falls: number[] = [];
  for (let i = i0; i < i1; i++) { const prev = i === 0 ? tr.lvl0 : tr.v[i - 1]; if (tr.v[i] === 1 && prev === 0) rises.push(tr.t[i]); else if (tr.v[i] === 0 && prev === 1) falls.push(tr.t[i]); }
  const level = levelAt(tr, b);
  if (rises.length < 2) return { freq: null, period: null, duty: null, high: null, low: null, rising: rises.length, level };
  const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  let hiSum = 0, n = 0;
  for (let k = 0; k + 1 < rises.length; k++) {
    const f = falls.find((x) => x > rises[k] && x < rises[k + 1]);
    if (f === undefined) continue;
    hiSum += f - rises[k]; n++;
  }
  const high = n ? hiSum / n : null;
  return { freq: 1 / period, period, duty: high !== null ? high / period : null, high, low: high !== null ? period - high : null, rising: rises.length, level };
}

export const STD_BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 250000, 460800, 500000, 921600, 1000000];

/** เดาบอดเรตจากพัลส์ที่แคบที่สุด (บิตเดียว) → บอดเรตมาตรฐานที่ใกล้ที่สุดภายใน ±6% · null = เดาไม่ได้ */
export function guessBaud(tr: Pick<LogicTrace, 't' | 'v'>, a = -Infinity, b = Infinity): number | null {
  let min = Infinity;
  const i0 = edgeIndex(tr, a), i1 = edgeIndex(tr, b);
  // ช่วงระหว่างขอบสองขอบที่ระดับรู้ค่า (ไม่นับช่วงก่อนสายเริ่มทำงาน)
  for (let i = Math.max(i0, 2); i < i1; i++) { if (tr.v[i - 2] === null || tr.v[i - 1] === null) continue; const w = tr.t[i] - tr.t[i - 1]; if (w > 2e-7 && w < min) min = w; }
  if (!isFinite(min)) return null;
  const br = 1 / min;
  let best: number | null = null, err = Infinity;
  for (const s of STD_BAUDS) { const e = Math.abs(s - br) / s; if (e < err) { err = e; best = s; } }
  return err <= 0.06 ? best : null;
}

export interface UartFrame { t0: number; t1: number; byte: number; ok: boolean }

/**
 * ถอดรหัส UART (สายว่าง HIGH, 8 บิตข้อมูล LSB ก่อน, ไม่มี parity, stop 1 บิต — ค่าเริ่มต้นของ Serial.begin / MicroPython)
 * อ่านแต่ละบิตที่กึ่งกลางบิตนับจากขอบลงของ start bit · stop ไม่เป็น HIGH → ok = false (framing error)
 */
export function decodeUart(tr: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, baud: number, a = -Infinity, b = Infinity, bits = 8): UartFrame[] {
  const T = 1 / baud;
  const out: UartFrame[] = [];
  let i = edgeIndex(tr, a);
  let busyUntil = -Infinity;
  while (i < tr.t.length && tr.t[i] <= b) {
    const prev = i === 0 ? tr.lvl0 : tr.v[i - 1];
    const ts = tr.t[i];
    if (tr.v[i] !== 0 || prev !== 1 || ts < busyUntil) { i++; continue; }
    if (ts + (bits + 1.5) * T > b) break; // เฟรมยังไม่จบในช่วงที่มีข้อมูล (b = เวลาล่าสุดที่มีข้อมูล)
    if (levelAt(tr, ts + 0.5 * T) !== 0) { i++; continue; } // สัญญาณรบกวนสั้นกว่าครึ่งบิต
    let byte = 0;
    for (let k = 0; k < bits; k++) if (levelAt(tr, ts + (k + 1.5) * T) === 1) byte |= 1 << k;
    const ok = levelAt(tr, ts + (bits + 1.5) * T) === 1;
    out.push({ t0: ts, t1: ts + (bits + 2) * T, byte, ok });
    busyUntil = ts + (bits + 1.5) * T;
    i = edgeIndex(tr, busyUntil);
  }
  return out;
}

/** อักขระแทนเฟรมเสีย (U+FFFD) — สร้างตอนรันเพื่อไม่ให้มีอักขระนี้ในไฟล์ที่บิลด์ */
export const BAD_FRAME: string = JSON.parse('"\\ufffd"');

/** แสดงไบต์เป็นข้อความ (อักขระพิมพ์ได้ / \r \n / ฐานสิบหก) */
export function uartText(frames: UartFrame[]): string {
  return frames.map((f) => (!f.ok ? BAD_FRAME : f.byte === 10 ? '\n' : f.byte === 13 ? '' : f.byte >= 32 && f.byte < 127 ? String.fromCharCode(f.byte) : `<${f.byte.toString(16).padStart(2, '0').toUpperCase()}>`)).join('');
}

/* ======================= ตัวถอดรหัส I²C ======================= */

export interface I2cFrame {
  t0: number; t1: number;
  kind: 'start' | 'restart' | 'stop' | 'addr' | 'data';
  /** ที่อยู่ 7 บิต (addr) หรือไบต์ข้อมูล */
  value: number;
  /** addr: true = อ่าน */
  read?: boolean;
  /** บิตที่ 9: true = ACK (0) */
  ack?: boolean;
}

/**
 * ถอดรหัส I²C จากสองช่อง (SDA, SCL) ในช่วง [a, b]: START = SDA ลงขณะ SCL สูง, STOP = SDA ขึ้นขณะ SCL สูง,
 * อ่านบิตที่ขอบขึ้นของ SCL (บิตสูงสุดก่อน) ครบ 9 บิต = ไบต์ + ACK · ไบต์แรกหลัง START = ที่อยู่ 7 บิต + R/W
 * ใช้ได้กับขอบทุกแหล่ง (I²C ฮาร์ดแวร์ หรือ soft I²C ที่ขยับขาเอง)
 */
export function decodeI2c(sda: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, scl: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, a = -Infinity, b = Infinity): I2cFrame[] {
  const ev: Array<[number, 0 | 1, 0 | 1 | null]> = [];
  for (let i = edgeIndex(sda, a); i < sda.t.length && sda.t[i] <= b; i++) ev.push([sda.t[i], 0, sda.v[i]]);
  for (let i = edgeIndex(scl, a); i < scl.t.length && scl.t[i] <= b; i++) ev.push([scl.t[i], 1, scl.v[i]]);
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let d = levelAt(sda, a), c = levelAt(scl, a);
  const out: I2cFrame[] = [];
  let inTx = false, bits = 0, n = 0, tByte = 0, first = false;
  for (const [t, line, v] of ev) {
    if (line === 0) {
      if (c === 1 && d === 1 && v === 0) { out.push({ t0: t, t1: t, kind: inTx ? 'restart' : 'start', value: 0 }); inTx = true; bits = 0; n = 0; first = true; }
      else if (c === 1 && d === 0 && v === 1 && inTx) { out.push({ t0: t, t1: t, kind: 'stop', value: 0 }); inTx = false; n = 0; }
      d = v;
    } else {
      if (c === 0 && v === 1 && inTx && d !== null) {
        if (n === 0) tByte = t;
        if (n < 8) bits = (bits << 1) | d;
        n++;
        if (n === 9) {
          const ack = d === 0;
          out.push(first ? { t0: tByte, t1: t, kind: 'addr', value: bits >> 1, read: (bits & 1) === 1, ack } : { t0: tByte, t1: t, kind: 'data', value: bits & 0xff, ack });
          first = false; bits = 0; n = 0;
        }
      }
      c = v;
    }
  }
  return out;
}

/** ข้อความสรุปธุรกรรม I²C เช่น "S 0x40 W ACK 0x00 ACK Sr 0x40 R ACK 0x12 ACK 0x34 NACK P" */
export function i2cText(frames: I2cFrame[]): string {
  const hx = (v: number) => `0x${v.toString(16).padStart(2, '0').toUpperCase()}`;
  return frames.map((f) => f.kind === 'start' ? 'S' : f.kind === 'restart' ? 'Sr' : f.kind === 'stop' ? 'P\n' : f.kind === 'addr' ? `${hx(f.value)} ${f.read ? 'R' : 'W'} ${f.ack ? 'ACK' : 'NACK'}` : `${hx(f.value)} ${f.ack ? 'ACK' : 'NACK'}`).join(' ').replace(/\n /g, '\n');
}

/* ======================= ตัวถอดรหัส SPI ======================= */

export interface SpiFrame { t0: number; t1: number; value: number }

/**
 * ถอดรหัส SPI (ทิศเดียวต่อช่องข้อมูล: MOSI หรือ MISO) จากช่อง SCK + ข้อมูล (+ CS ถ้ามี, ทำงานเมื่อ CS ต่ำ)
 * โหมด 0–3: CPOL = ระดับว่างของ SCK, CPHA = 0 อ่านที่ขอบแรก (leading) / 1 อ่านที่ขอบหลัง (trailing) · บิตสูงสุดก่อน (lsbFirst = บิตต่ำก่อน)
 * CS ขึ้นสูงกลางไบต์ → ทิ้งบิตที่ค้าง · ไม่มี CS: นับบิตต่อเนื่องจากขอบแรกในช่วง
 */
export function decodeSpi(sck: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, data: Pick<LogicTrace, 'lvl0' | 't' | 'v'>, cs: Pick<LogicTrace, 'lvl0' | 't' | 'v'> | null, mode: number, a = -Infinity, b = Infinity, lsbFirst = false): SpiFrame[] {
  const cpol = (mode >> 1) & 1, cpha = mode & 1;
  // ขอบที่อ่านบิต: โหมด 0/3 = ขอบขึ้น, โหมด 1/2 = ขอบลง
  const sampleRise = (cpol ^ cpha) === 0;
  const ev: Array<[number, 0 | 1 | 2, 0 | 1 | null]> = [];
  for (let i = edgeIndex(sck, a); i < sck.t.length && sck.t[i] <= b; i++) ev.push([sck.t[i], 0, sck.v[i]]);
  if (cs) for (let i = edgeIndex(cs, a); i < cs.t.length && cs.t[i] <= b; i++) ev.push([cs.t[i], 2, cs.v[i]]);
  // CS ก่อน SCK ที่เวลาเดียวกัน
  ev.sort((x, y) => x[0] - y[0] || (y[1] === 2 ? 1 : 0) - (x[1] === 2 ? 1 : 0));
  let c = levelAt(sck, a), sel = cs ? levelAt(cs, a) === 0 : true;
  const out: SpiFrame[] = [];
  let bits = 0, n = 0, tByte = 0;
  for (const [t, line, v] of ev) {
    if (line === 2) { sel = v === 0; n = 0; bits = 0; continue; }
    const rise = c === 0 && v === 1, fall = c === 1 && v === 0;
    c = v;
    if (!sel || !(sampleRise ? rise : fall)) continue;
    const d = levelAt(data, t);
    if (d === null) { n = 0; bits = 0; continue; }
    if (n === 0) tByte = t;
    bits = lsbFirst ? bits | (d << n) : (bits << 1) | d;
    n++;
    if (n === 8) { out.push({ t0: tByte, t1: t, value: bits & 0xff }); n = 0; bits = 0; }
  }
  return out;
}

export function spiText(frames: SpiFrame[]): string { return frames.map((f) => `0x${f.value.toString(16).padStart(2, '0').toUpperCase()}`).join(' '); }

/** ขอบของ SCK/ข้อมูลสำหรับหนึ่งไบต์ที่ส่งด้วย SPI ฮาร์ดแวร์ เริ่มที่ t ด้วยคาบบิต T (โหมด 0–3, บิตสูงก่อน) */
export function spiByteEdges(t: number, T: number, byte: number, mode: number): { sck: Array<[number, 0 | 1]>; data: Array<[number, 0 | 1]> } {
  const cpol = ((mode >> 1) & 1) as 0 | 1, cpha = mode & 1;
  const sck: Array<[number, 0 | 1]> = [], data: Array<[number, 0 | 1]> = [];
  for (let k = 0; k < 8; k++) {
    const bit = ((byte >> (7 - k)) & 1) as 0 | 1, tb = t + k * T;
    // CPHA = 0: ข้อมูลพร้อมก่อนขอบแรก (ตั้งที่ต้นบิต) · CPHA = 1: เปลี่ยนข้อมูลที่ขอบแรก แล้วอ่านที่ขอบหลัง
    data.push([cpha ? tb : tb, bit]);
    sck.push([tb + (cpha ? 0 : T / 2), (1 - cpol) as 0 | 1]);
    sck.push([tb + (cpha ? T / 2 : T), cpol]);
  }
  return { sck, data };
}
