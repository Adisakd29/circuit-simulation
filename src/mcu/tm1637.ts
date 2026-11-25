/**
 * TM1637 (ไอซีขับจอ LED 7 ส่วน) — ถอดรหัสโปรโตคอล 2 สาย CLK/DIO จากระดับขาที่จำลอง (ดาต้าชีต TM1637 V2.4 หัวข้อ "Interface interpretation")
 *   - เริ่ม: DIO ลงขณะ CLK สูง · จบ: DIO ขึ้นขณะ CLK สูง
 *   - ข้อมูลส่งบิตต่ำก่อน อ่านที่ขอบขึ้นของ CLK · หลังบิตที่ 8 (ขอบลงของ CLK ที่ 8) ชิปดึง DIO ลงเป็น ACK จนถึงขอบลงของ CLK ที่ 9
 *   - ไบต์แรกหลังเริ่ม = คำสั่ง: 0b01xx_xxxx ตั้งข้อมูล (บิต 2 = ที่อยู่คงที่, บิต 1 = อ่านปุ่ม) · 0b11xx_xaaa ตั้งที่อยู่ (ตามด้วยข้อมูลแสดงผล)
 *     · 0b10xx_kbbb ควบคุมจอ (บิต 3 = เปิด, bbb = ความสว่าง 8 ระดับ: ความกว้างพัลส์ 1/16 2/16 4/16 10/16 11/16 12/16 13/16 14/16)
 *   - หน่วยความจำแสดงผล 6 ไบต์ (C0H–C5H) — โมดูล 4 หลักใช้ 4 ไบต์แรก บิต 7 ของหลักที่ 2 ต่อกับโคลอนกลาง (วงจรของโมดูลทั่วไป)
 * ระดับสาย: ขา MCU ที่เป็นเอาต์พุตกำหนดระดับ · ขาเข้า/ลอย = สูงจากตัวต้านทานดึงขึ้น 10 kΩ บนโมดูล (เมื่อโมดูลมีไฟ) ยกเว้นตอนที่ชิปดึง DIO ลง
 * อ่านปุ่ม (0x42): โมดูล 4 หลักทั่วไปไม่ได้ต่อปุ่มกับ K1/K2 → ข้อมูลปุ่ม = 1111_1111 ตามดาต้าชีต ("ไม่มีปุ่มกด")
 * กระแส LED (ไฟเลี้ยง): ส่วนที่ติด × IOL ทั่วไป 30 mA (SEG, ดาต้าชีต) × สัดส่วนพัลส์ของความสว่าง ÷ 6 grid ที่สแกน (ไม่รวมกระแสวงจรภายในชิป — ไม่ระบุในดาต้าชีต)
 * ตรวจเวลา: พัลส์ CLK ต้อง ≥ 400 ns (PWCLK) · อ่านปุ่มที่ความถี่ ≤ 250 kHz
 */

export interface Tm1637Spec { id: string; vcc: number; gnd: number; clk: number; dio: number; vMin: number; vMax: number }

export interface Tm1637State {
  powered: boolean;
  /** จอเปิด (คำสั่งควบคุมจอ บิต 3) */
  on: boolean;
  /** ความสว่าง 0–7 */
  brightness: number;
  /** หน่วยความจำแสดงผล 6 ไบต์ (บิต 0–6 = ส่วน a–g, บิต 7 = จุด/โคลอน) */
  ram: number[];
  /** จำนวนคำสั่งที่รับครบ (ไบต์แรกหลังเริ่ม) และไบต์ข้อมูลแสดงผล */
  cmds: number;
  dataBytes: number;
  /** ไบต์ที่ถูกตัดกลางคัน (เริ่ม/จบก่อนครบ 8 บิต) */
  partial: number;
  /** จำนวนครั้งที่อ่านปุ่ม (ได้ 0xFF — โมดูลไม่มีปุ่ม) */
  keyReads: number;
  /** พัลส์ CLK ที่สั้นที่สุดที่เห็น (s) และคาบ CLK สั้นสุดระหว่างอ่านปุ่ม (s) — Infinity = ยังไม่เห็น */
  minPulse: number;
  minKeyPeriod: number;
  /** กระแส LED เฉลี่ยตามส่วนที่ติด (A) */
  ledCurrent: number;
}

/** IOL ทั่วไปของขา SEG (ดาต้าชีต: 20/30/50 mA ต่ำสุด/ทั่วไป/สูงสุด ที่ Vo = 0.3 V) */
export const TM_IOL = 0.03;
/** กระแส LED เฉลี่ย: ส่วนที่ติดในหลัก 1–4 (+ โคลอน) × IOL × duty ÷ 6 grid */
export function tmLedCurrent(on: boolean, brightness: number, ram: number[]): number {
  if (!on) return 0;
  let n = 0;
  for (let i = 0; i < 4; i++) { const b = ram[i] & (i === 1 ? 0xff : 0x7f); for (let k = 0; k < 8; k++) if (b & (1 << k)) n++; }
  return (n * TM_IOL * tmDuty(brightness)) / 6;
}

const DUTY = [1, 2, 4, 10, 11, 12, 13, 14];
/** สัดส่วนเวลาที่ LED ติดตามระดับความสว่าง (ดาต้าชีต) */
export function tmDuty(level: number) { return DUTY[Math.max(0, Math.min(7, level | 0))] / 16; }

class Chip {
  on = false;
  brightness = 0;
  ram = [0, 0, 0, 0, 0, 0];
  fixed = false;
  readKeys = false;
  addr = 0;
  cmds = 0;
  dataBytes = 0;
  partial = 0;
  keyReads = 0;
  // ตัวถอดรหัส
  clk = true;
  dio = true;
  active = false;
  bits = 0;
  byte = 0;
  first = true;
  /** ชิปดึง DIO ลง (ACK) */
  ack = false;
  inData = false;
  /** ไบต์ถัดไปเป็นข้อมูลปุ่มที่ชิปส่งออก */
  keyByte = false;
  lastClkT = -Infinity;
  lastRiseT = -Infinity;
  minPulse = Infinity;
  minKeyPeriod = Infinity;

  reset() {
    this.on = false; this.brightness = 0; this.ram.fill(0); this.fixed = false; this.readKeys = false; this.addr = 0;
    this.active = false; this.bits = 0; this.byte = 0; this.ack = false; this.inData = false;
  }

  update(clk: boolean, dio: boolean, t = 0) {
    if (clk !== this.clk) {
      if (this.active) {
        this.minPulse = Math.min(this.minPulse, t - this.lastClkT);
        if (clk && this.keyByte) this.minKeyPeriod = Math.min(this.minKeyPeriod, t - this.lastRiseT);
      }
      this.lastClkT = t;
      if (clk) this.lastRiseT = t;
      this.clk = clk;
      this.dio = dio;
      if (clk) this.rise(); else this.fall();
      return;
    }
    if (dio !== this.dio) {
      this.dio = dio;
      if (this.clk && !this.ack) { if (!dio) this.start(); else this.stop(); }
    }
  }

  private start() {
    if (this.active && this.bits > 0 && this.bits < 8) this.partial++;
    this.active = true; this.bits = 0; this.byte = 0; this.first = true; this.ack = false; this.inData = false;
  }

  private stop() {
    // ขอบขึ้นของ CLK ก่อนสัญญาณจบนับเป็นบิตแรกของไบต์ถัดไปเสมอ (bits = 1) — ไม่ใช่ไบต์ที่ถูกตัด
    if (this.active && this.bits > 1 && this.bits < 8) this.partial++;
    this.active = false; this.bits = 0; this.ack = false; this.inData = false;
  }

  private rise() {
    if (!this.active) return;
    if (this.bits < 8) { if (this.dio) this.byte |= 1 << this.bits; this.bits++; }
    else this.bits++; // คล็อกที่ 9 (ACK)
  }

  private fall() {
    if (!this.active) return;
    if (this.bits === 8 && !this.ack) { this.exec(this.byte); this.ack = true; }
    else if (this.bits >= 9) { this.ack = false; this.bits = 0; this.byte = 0; }
  }

  private exec(b: number) {
    if (this.keyByte) { this.keyByte = false; return; } // ไบต์ข้อมูลปุ่ม (ชิปส่ง 1111_1111 = ไม่มีปุ่ม: ปล่อยสายให้ตัวต้านทานดึงขึ้น)
    if (this.first) {
      this.first = false;
      this.cmds++;
      const kind = b & 0xc0;
      if (kind === 0x40) { this.fixed = (b & 4) !== 0; this.readKeys = (b & 3) === 2; if (this.readKeys) { this.keyReads++; this.keyByte = true; } }
      else if (kind === 0xc0) { this.addr = b & 7; this.inData = true; }
      else if (kind === 0x80) { this.on = (b & 8) !== 0; this.brightness = b & 7; }
      return;
    }
    if (!this.inData) return;
    if (this.addr < 6) { this.ram[this.addr] = b; this.dataBytes++; }
    if (!this.fixed) this.addr = (this.addr + 1) & 7;
  }
}

interface Dev { spec: Tm1637Spec; chip: Chip; wasPowered: boolean }

export class Tm1637Hub {
  private devs = new Map<string, Dev>();
  levels: { v(net: number, ref: number): number | null } | null = null;
  drive: ((net: number) => boolean | null) | null = null;

  sync(specs: Tm1637Spec[]) {
    for (const id of [...this.devs.keys()]) if (!specs.some((s) => s.id === id)) this.devs.delete(id);
    for (const s of specs) {
      let d = this.devs.get(s.id);
      if (!d) { d = { spec: s, chip: new Chip(), wasPowered: false }; this.devs.set(s.id, d); }
      d.spec = s;
    }
  }
  reset() { this.devs.clear(); }
  get size() { return this.devs.size; }
  nets(): number[] { const out: number[] = []; for (const d of this.devs.values()) out.push(d.spec.clk, d.spec.dio); return out.filter((n) => n >= 0); }

  private v(net: number, ref: number) { return net < 0 || ref < 0 ? null : (this.levels?.v(net, ref) ?? null); }
  powered(d: Dev, boardGnd: number) {
    const vcc = this.v(d.spec.vcc, d.spec.gnd);
    if (vcc === null || vcc < d.spec.vMin || vcc > d.spec.vMax + 0.5) return false;
    const g = this.v(d.spec.gnd, boardGnd);
    return g !== null && Math.abs(g) < 0.4;
  }

  /** ระดับสายตามผู้ขับ: ขา MCU เอาต์พุต > ชิปดึง DIO ลง > ตัวต้านทานดึงขึ้น (มีไฟ) */
  private line(net: number, chipLow: boolean, pw: boolean): boolean {
    const m = this.drive?.(net) ?? null;
    if (m !== null) return m;
    if (chipLow) return false;
    return pw;
  }

  /** เรียกหลังขา MCU เปลี่ยน: ถอดรหัสระดับสายใหม่ */
  check(boardGnd: number, t = 0) {
    for (const d of this.devs.values()) {
      const pw = this.powered(d, boardGnd);
      if (!pw) { if (d.wasPowered) d.chip.reset(); d.wasPowered = false; continue; }
      if (!d.wasPowered) { d.chip.reset(); d.chip.clk = this.line(d.spec.clk, false, true); d.chip.dio = this.line(d.spec.dio, false, true); }
      d.wasPowered = true;
      d.chip.update(this.line(d.spec.clk, false, true), this.line(d.spec.dio, d.chip.ack, true), t);
    }
  }

  /** ระดับที่โมดูลให้กับเน็ต (ขาเข้าของ MCU อ่านได้): ACK ต่ำ, มิฉะนั้นสูงจากตัวต้านทานดึงขึ้น — null = ไม่ใช่สายของโมดูล */
  driven(net: number, boardGnd: number): boolean | null {
    for (const d of this.devs.values()) {
      if (net !== d.spec.clk && net !== d.spec.dio) continue;
      const pw = this.powered(d, boardGnd);
      if (net === d.spec.dio && pw && d.chip.ack) return false;
      return null;
    }
    return null;
  }

  /** กระแส LED เป็นแหล่งกระแส VCC → GND (มอสเฟต depletion แบบเดียวกับกระแสนิ่งของอุปกรณ์อื่น) */
  elements(boardGnd: number): import('../sim/netlist').NetlistElement[] {
    const out: import('../sim/netlist').NetlistElement[] = [];
    for (const d of this.devs.values()) {
      const i = this.powered(d, boardGnd) ? tmLedCurrent(d.chip.on, d.chip.brightness, d.chip.ram) : 0;
      if (i > 0) out.push({ type: 'MOS', id: `${d.spec.id}#led`, d: d.spec.vcc, g: d.spec.gnd, s: d.spec.gnd, pol: 1, vth: -1, kp: 2 * i, lambda: 0.001 });
    }
    return out;
  }
  key(boardGnd: number): string { let k = ''; for (const d of this.devs.values()) k += Math.round((this.powered(d, boardGnd) ? tmLedCurrent(d.chip.on, d.chip.brightness, d.chip.ram) : 0) * 1e4) + ','; return k; }

  snapshot(boardGnd: number): Record<string, Tm1637State> {
    const out: Record<string, Tm1637State> = {};
    for (const [id, d] of this.devs) {
      const c = d.chip, pw = this.powered(d, boardGnd);
      out[id] = { powered: pw, on: pw && c.on, brightness: c.brightness, ram: [...c.ram], cmds: c.cmds, dataBytes: c.dataBytes, partial: c.partial, keyReads: c.keyReads, minPulse: c.minPulse, minKeyPeriod: c.minKeyPeriod, ledCurrent: pw ? tmLedCurrent(c.on, c.brightness, c.ram) : 0 };
    }
    return out;
  }
}

/** ส่วนของตัวเลข (บิต a–g) → ตัวอักษรที่อ่านได้ */
const SEG_CHARS: Record<number, string> = {
  0x3f: '0', 0x06: '1', 0x5b: '2', 0x4f: '3', 0x66: '4', 0x6d: '5', 0x7d: '6', 0x07: '7', 0x7f: '8', 0x6f: '9',
  0x77: 'A', 0x7c: 'b', 0x39: 'C', 0x5e: 'd', 0x79: 'E', 0x71: 'F', 0x3d: 'G', 0x76: 'H', 0x30: 'I', 0x1e: 'J', 0x38: 'L', 0x54: 'n', 0x5c: 'o',
  0x73: 'P', 0x50: 'r', 0x78: 't', 0x3e: 'U', 0x1c: 'u', 0x6e: 'y', 0x40: '-', 0x08: '_', 0x00: ' ', 0x63: '°',
};

/** ข้อความที่อ่านได้บนจอ 4 หลัก (โคลอน = ":" ระหว่างหลัก 2 และ 3 เมื่อบิต 7 ของหลักที่ 2 ติด) — จอดับ = '' */
export function tmText(s: Tm1637State | undefined): string {
  if (!s || !s.on) return '';
  let t = '';
  for (let i = 0; i < 4; i++) {
    t += SEG_CHARS[s.ram[i] & 0x7f] ?? '?';
    if (i === 1 && s.ram[1] & 0x80) t += ':';
  }
  return t;
}
