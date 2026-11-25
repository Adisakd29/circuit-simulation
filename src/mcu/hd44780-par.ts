/**
 * จอ LCD 16×2 แบบขนาน (HD44780 ต่อขาตรง 16 ขา: VSS VDD V0 RS RW E D0–D7 A K) — ใช้กับไลบรารี LiquidCrystal ของ Arduino
 *
 * อ้างอิง Hitachi HD44780U datasheet:
 *  - รับข้อมูลที่ขอบลงของ E: RS = 0 คำสั่ง, RS = 1 ข้อมูล · RW = 1 = อ่าน: ขอบขึ้นของ E จอขับ D7–D0 (หรือ D7–D4 ในโหมด 4 บิต)
 *    ด้วย BF + AC (RS = 0) หรือข้อมูลที่ AC (RS = 1) จนถึงขอบลงของ E — ขาเข้าของ MCU อ่านได้ (driven)
 *  - โหมด 8 บิตใช้ D0–D7, โหมด 4 บิตใช้ D4–D7 ส่งนิบเบิลบนก่อน (ชุดคำสั่งเดียวกับรุ่น I²C ใน i2c-sensors.ts)
 *  - ขา RS, RW, D0–D7 มีทรานซิสเตอร์ดึงขึ้นภายใน (ขาที่ไม่ต่อ = สูง) · VIH 2.2 V / VIL 0.6 V ที่ VCC 4.5–5.5 V (0.7·VCC ที่ไฟต่ำกว่า)
 *  - เวลาประมวลผลที่ fosc 270 kHz: Clear/Return home 1.52 ms, คำสั่งอื่น 37 µs, เขียนข้อมูล 37 µs + tADD 4 µs
 *    ข้อมูลที่ส่งมาก่อนครบเวลานี้ถูกทิ้ง (นับเป็น dropped — ของจริงอาจได้ผลผิดเพี้ยน) · รีเซ็ตภายใน 10 ms (BF = 1, ข้อมูลถูกทิ้ง) เมื่อไฟกลับมาระหว่างจำลอง
 * ระดับขาอ่านจากขาเอาต์พุตของไมโครคอนโทรลเลอร์โดยตรง (ทุกขอบที่ CPU เปลี่ยน) หรือแรงดันจากการคำนวณวงจรเมื่อไม่มีขา MCU ขับ
 */
import { Lcd1602, charLcdView, hd44780ExecTime, HD44780_RESET_S, type CharLcdView } from './i2c-sensors';
export { hd44780ExecTime };

export interface ParLcdSpec { id: string; vdd: number; vss: number; rs: number; rw: number; e: number; d: number[]; vMin: number; vMax: number }

export interface ParLcdState {
  powered: boolean;
  lcd: CharLcdView;
  /** จำนวนครั้งที่รับข้อมูล (ขอบลงของ E ที่ RW = 0) */
  writes: number;
  chars: number;
  instrs: number;
  /** ข้อมูลที่ถูกทิ้งเพราะส่งเร็วกว่าเวลาประมวลผลของคำสั่งก่อนหน้า */
  dropped: number;
  /** ขอบลงของ E ขณะ RW = 1 (การอ่าน — ไม่จำลอง) */
  reads: number;
  /** โหมด 8 บิต */
  dl8: boolean;
}

interface Dev { spec: ParLcdSpec; lcd: Lcd1602; wasPowered: boolean; everPowered?: boolean; e: boolean; lv: boolean[]; reads: number; /** ค่าที่จอขับออกขา D0–D7 ขณะอ่าน (null = ไม่ขับ) */ out: number | null }

export class ParLcdHub {
  private devs = new Map<string, Dev>();
  levels: { v(net: number, ref: number): number | null } | null = null;
  drive: ((net: number) => boolean | null) | null = null;
  /** เวลาปัจจุบัน (s) ของตัวจำลอง CPU */
  constructor(private readonly now: () => number) {}

  sync(specs: ParLcdSpec[]) {
    for (const id of [...this.devs.keys()]) if (!specs.some((s) => s.id === id)) this.devs.delete(id);
    for (const s of specs) {
      let d = this.devs.get(s.id);
      if (!d) { d = { spec: s, lcd: new Lcd1602(this.now), wasPowered: false, e: false, lv: new Array(11).fill(true), reads: 0, out: null }; this.devs.set(s.id, d); }
      d.spec = s;
    }
  }
  reset() { this.devs.clear(); }
  get size() { return this.devs.size; }

  private v(net: number, ref: number) { return net < 0 || ref < 0 ? null : (this.levels?.v(net, ref) ?? null); }
  private vdd(d: Dev) { return this.v(d.spec.vdd, d.spec.vss); }
  powered(d: Dev, boardGnd: number) {
    const vcc = this.vdd(d);
    if (vcc === null || vcc < d.spec.vMin || vcc > d.spec.vMax + 0.5) return false;
    const g = this.v(d.spec.vss, boardGnd);
    return g !== null && Math.abs(g) < 0.4;
  }

  /** ระดับลอจิกของขา k (0 = E, 1 = RS, 2 = RW, 3–10 = D0–D7) */
  private level(d: Dev, k: number, net: number, vcc: number): boolean {
    const m = this.drive?.(net) ?? null;
    if (m !== null) return m;
    const v = this.v(net, d.spec.vss);
    if (v === null) return k !== 0; // ลอย: RS/RW/D มีตัวดึงขึ้นภายใน · E ไม่มี
    const vih = vcc >= 4.5 ? 2.2 : 0.7 * vcc;
    if (v >= vih) return true;
    if (v <= 0.6) return false;
    return d.lv[k];
  }

  /** เรียกหลังขา MCU เปลี่ยน: ตรวจขอบลงของ E แล้วรับคำสั่ง/ข้อมูล */
  check(boardGnd: number) {
    for (const d of this.devs.values()) {
      const pw = this.powered(d, boardGnd);
      if (!pw) { d.wasPowered = false; d.out = null; continue; }
      const vcc = this.vdd(d) ?? 5;
      if (!d.wasPowered) { d.lcd.reset(d.everPowered ? HD44780_RESET_S : 0); d.everPowered = true; d.out = null; d.e = this.level(d, 0, d.spec.e, vcc); d.wasPowered = true; continue; }
      const e = this.level(d, 0, d.spec.e, vcc);
      const rs = this.level(d, 1, d.spec.rs, vcc), rw = this.level(d, 2, d.spec.rw, vcc);
      if (!d.e && e && rw) { d.out = d.lcd.readCycle(rs); d.reads++; }
      if (!rw || !e) d.out = null;
      if (d.e && !e && !rw) {
        d.lv[1] = rs; d.lv[2] = rw;
        let byte = 0;
        d.spec.d.forEach((net, i) => { const b = this.level(d, 3 + i, net, vcc); d.lv[3 + i] = b; if (b) byte |= 1 << i; });
        if (d.lcd.busy) d.lcd.dropped++;
        else d.lcd.parallelWrite(byte, rs);
      }
      d.e = e;
    }
  }

  /** ระดับที่จอขับให้ขา D (ขณะอ่าน: E = 1, RW = 1) — null = จอไม่ได้ขับเน็ตนี้ */
  driven(net: number, boardGnd: number): boolean | null {
    if (net < 0) return null;
    for (const d of this.devs.values()) {
      if (d.out === null || !this.powered(d, boardGnd)) continue;
      const i = d.spec.d.indexOf(net);
      if (i < 0 || (!d.lcd.dl8 && i < 4)) continue;
      return ((d.out >> i) & 1) === 1;
    }
    return null;
  }

  snapshot(boardGnd: number): Record<string, ParLcdState> {
    const out: Record<string, ParLcdState> = {};
    for (const [id, d] of this.devs) {
      const l = d.lcd;
      out[id] = { powered: this.powered(d, boardGnd), lcd: { ...charLcdView(l), backlight: true }, writes: l.writes, chars: l.chars, instrs: l.instrs, dropped: l.dropped, reads: d.reads, dl8: l.dl8 };
    }
    return out;
  }
}
