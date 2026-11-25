/**
 * แบบจำลองอุปกรณ์บนบัส I²C ระดับรีจิสเตอร์ตามดาต้าชีต — ไม่มีการเดาจากข้อความโค้ด: อุปกรณ์รู้เฉพาะไบต์ที่ส่งมาบนบัส
 *   SSD1306  ไอซีควบคุมจอ OLED 128×64 (Solomon Systech SSD1306 datasheet rev 1.1): ไบต์ควบคุม Co/D·C, ตารางคำสั่ง, GDDRAM 8 หน้า × 128 คอลัมน์
 *   DS3231   นาฬิกาเวลาจริง (Analog Devices/Maxim DS3231 datasheet): รีจิสเตอร์ 0x00–0x12 แบบ BCD, ตัวชี้รีจิสเตอร์เพิ่มเอง, อุณหภูมิ 0.25 °C
 *   AT24C32  EEPROM 4 KB บนโมดูล ZS-042 (ที่อยู่ 0x57 เมื่อ A0–A2 ดึงขึ้น) ที่อยู่ภายใน 2 ไบต์ หน้า 32 ไบต์
 *   MPU6050  ความเร่ง 3 แกน + ไจโร (InvenSense MPU-6000/6050 Register Map rev 4.2): PWR_MGMT_1 = 0x40 (หลับ) หลังรีเซ็ต, WHO_AM_I = 0x68,
 *            ACCEL_XOUT_H 0x3B … GYRO_ZOUT_L 0x48, สเกล ±2/4/8/16 g (16384/8192/4096/2048 LSB/g), อุณหภูมิ = ค่า/340 + 36.53
 * ไฟล์นี้ไม่มี dependency (ใช้ได้ทั้งใน Web Worker และหน้าเว็บ)
 */

export type I2cDevKind = 'ssd1306' | 'ds3231' | 'mpu6050';

/** เป้าหมายหนึ่งที่อยู่บนบัส (อุปกรณ์หนึ่งชิ้นอาจมีหลายเป้าหมาย เช่น DS3231 + AT24C32 บนโมดูลเดียว) */
export interface I2cTarget {
  readonly name: string;
  /** เริ่มธุรกรรมที่ส่งถึงที่อยู่นี้ (หลัง START + ที่อยู่ตรง) */
  begin(read: boolean): void;
  /** ไบต์ที่ master เขียน — คืน ACK */
  write(b: number): boolean;
  /** ไบต์ที่ master อ่าน */
  read(): number;
  /** STOP หรือ repeated START */
  end(): void;
}

const bcd = (v: number) => ((Math.floor(v / 10) % 10) << 4) | (v % 10);
const unbcd = (b: number) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f);

/* ===================== SSD1306 ===================== */

/** จำนวนไบต์อาร์กิวเมนต์ของคำสั่ง (ตาราง 9-1 ของดาต้าชีต) */
function ssdArgs(op: number): number {
  switch (op) {
    case 0x81: case 0x20: case 0xa8: case 0xd3: case 0xda: case 0xd5: case 0xd9: case 0xdb: case 0x8d: case 0xad: return 1;
    case 0x21: case 0x22: case 0xa3: return 2;
    case 0x29: case 0x2a: return 5;
    case 0x26: case 0x27: return 6;
    default: return 0;
  }
}

export interface OledState {
  ram: Uint8Array;
  on: boolean;
  pump: boolean;
  contrast: number;
  invert: boolean;
  allOn: boolean;
  segRemap: boolean;
  comRev: boolean;
  startLine: number;
  offset: number;
  mux: number;
  /** เลื่อนแนวตั้ง (0x29/0x2A + 0xA3): แถวคงที่ด้านบน, จำนวนแถวที่เลื่อน, จำนวนแถวที่เลื่อนไปแล้ว */
  vTop?: number;
  vRows?: number;
  vScroll?: number;
}

/** ช่วงเฟรมระหว่างการเลื่อนหนึ่งก้าว ตามค่า 3 บิตของคำสั่งเลื่อน (ดาต้าชีต 10.3.1) */
const SCROLL_FRAMES = [5, 64, 128, 256, 3, 4, 25, 2];

export class Ssd1306 implements I2cTarget {
  readonly name = 'SSD1306';
  s: OledState = { ram: new Uint8Array(1024), on: false, pump: false, contrast: 0x7f, invert: false, allOn: false, segRemap: false, comRev: false, startLine: 0, offset: 0, mux: 63, vTop: 0, vRows: 64, vScroll: 0 };
  /** การเลื่อนภาพอัตโนมัติ: ตั้งค่าล่าสุด (0x26/0x27/0x29/0x2A) และสถานะเปิด (0x2F) */
  private scr: { dir: 1 | -1; p0: number; p1: number; frames: number; vOff: number; vert: boolean } | null = null;
  scrolling = false;
  private scrollT0 = 0;
  private scrollDone = 0;
  /** ค่าเวลาของแผง: 0xD5 (fosc/ตัวหาร), 0xD9 (pre-charge) — ใช้คำนวณอัตราเฟรม */
  private clk = 0x80;
  private pre = 0x22;
  constructor(private now: () => number = () => 0) {}

  /** อัตราเฟรม (Hz) = Fosc / (D × K × MUX) · K = phase1 + phase2 + 50 (ดาต้าชีต 8.3) · Fosc ≈ 370 kHz ที่ค่าเริ่ม (ตาราง DC characteristics) — ค่าอื่นประมาณเชิงเส้น ±5 % ต่อขั้น */
  frameRate(): number {
    const d = (this.clk & 0x0f) + 1, fosc = 370e3 * (1 + 0.05 * (((this.clk >> 4) & 0x0f) - 8));
    const k = Math.max(1, this.pre & 0x0f) + Math.max(1, (this.pre >> 4) & 0x0f) + 50;
    return fosc / (d * k * (this.s.mux + 1));
  }

  /** เดินการเลื่อนภาพถึงเวลาปัจจุบัน — การเลื่อนแนวนอนย้ายข้อมูลใน GDDRAM จริง (ดาต้าชีต: หลังหยุดเลื่อนต้องเขียนข้อมูลใหม่) */
  advanceScroll() {
    if (!this.scrolling || !this.scr) return;
    const want = Math.floor(((this.now() - this.scrollT0) * this.frameRate()) / this.scr.frames);
    let n = want - this.scrollDone;
    if (n <= 0) return;
    this.scrollDone = want;
    const { dir, p0, p1, vOff, vert } = this.scr;
    if (vert) { const rows = Math.max(1, this.s.vRows ?? 64); this.s.vScroll = ((this.s.vScroll ?? 0) + n * vOff) % rows; }
    n %= 128;
    if (n) {
      const ram = this.s.ram;
      for (let pg = p0; ; pg = (pg + 1) & 7) {
        const row = ram.slice(pg * 128, pg * 128 + 128);
        for (let c = 0; c < 128; c++) ram[pg * 128 + ((c + dir * n + 128 * 2) % 128)] = row[c];
        if (pg === p1) break;
      }
    }
    this.version++;
  }
  /** โหมดที่อยู่: 0 แนวนอน, 1 แนวตั้ง, 2 หน้า (ค่าเริ่มต้นหลังรีเซ็ต = หน้า) */
  private mode = 2;
  private colStart = 0; private colEnd = 127; private pageStart = 0; private pageEnd = 7;
  private col = 0; private page = 0;
  /** สถานะการแยกไบต์ในธุรกรรม */
  private expect: 'ctrl' | 'cmd' | 'data' | 'cmd1' | 'data1' = 'ctrl';
  private op = -1; private args: number[] = [];
  /** นับไบต์ข้อมูลที่เขียนลง GDDRAM (ใช้ในการตรวจผล) */
  dataBytes = 0;
  commands = 0;
  version = 0;

  begin() { this.advanceScroll(); this.expect = 'ctrl'; }
  end() { this.expect = 'ctrl'; }
  /** SSD1306 ในโหมด I²C ไม่รองรับการอ่านข้อมูล (ดาต้าชีต 8.1.5) — คืน 0xFF (สายดึงขึ้น) */
  read() { return 0xff; }

  write(b: number): boolean {
    switch (this.expect) {
      case 'ctrl': {
        const co = (b & 0x80) !== 0, dc = (b & 0x40) !== 0;
        this.expect = co ? (dc ? 'data1' : 'cmd1') : (dc ? 'data' : 'cmd');
        return true;
      }
      case 'cmd': this.cmdByte(b); return true;
      case 'cmd1': this.cmdByte(b); this.expect = this.op >= 0 ? 'cmd1' : 'ctrl'; return true;
      case 'data': this.dataByte(b); return true;
      case 'data1': this.dataByte(b); this.expect = 'ctrl'; return true;
    }
  }

  private cmdByte(b: number) {
    if (this.op < 0) {
      if (ssdArgs(b) > 0) { this.op = b; this.args = []; return; }
      this.exec(b, []);
      return;
    }
    this.args.push(b);
    if (this.args.length >= ssdArgs(this.op)) { const op = this.op; this.op = -1; this.exec(op, this.args); }
  }

  private exec(op: number, a: number[]) {
    const s = this.s;
    this.commands++;
    this.version++;
    if (op >= 0x00 && op <= 0x0f) { this.col = (this.col & 0xf0) | op; return; }
    if (op >= 0x10 && op <= 0x1f) { this.col = ((op & 0x07) << 4) | (this.col & 0x0f); return; }
    if (op >= 0x40 && op <= 0x7f) { s.startLine = op & 0x3f; return; }
    if (op >= 0xb0 && op <= 0xb7) { this.page = op & 0x07; return; }
    switch (op) {
      case 0x81: s.contrast = a[0]; break;
      case 0xa4: s.allOn = false; break;
      case 0xa5: s.allOn = true; break;
      case 0xa6: s.invert = false; break;
      case 0xa7: s.invert = true; break;
      case 0xae: s.on = false; break;
      case 0xaf: s.on = true; break;
      case 0x20: this.mode = a[0] & 0x03; if (this.mode === 3) this.mode = 2; break;
      case 0x21: this.colStart = a[0] & 0x7f; this.colEnd = a[1] & 0x7f; this.col = this.colStart; break;
      case 0x22: this.pageStart = a[0] & 0x07; this.pageEnd = a[1] & 0x07; this.page = this.pageStart; break;
      case 0xa0: s.segRemap = false; break;
      case 0xa1: s.segRemap = true; break;
      case 0xa8: s.mux = Math.max(15, a[0] & 0x3f); break;
      case 0xc0: s.comRev = false; break;
      case 0xc8: s.comRev = true; break;
      case 0xd3: s.offset = a[0] & 0x3f; break;
      case 0x8d: s.pump = (a[0] & 0x04) !== 0; break;
      case 0xd5: this.clk = a[0]; break;
      case 0xd9: this.pre = a[0]; break;
      // เลื่อนแนวนอน: A = 0x00, B = หน้าเริ่ม, C = ช่วงเฟรม, D = หน้าสุดท้าย, E = 0x00, F = 0xFF
      case 0x26: case 0x27: this.scr = { dir: op === 0x26 ? 1 : -1, p0: a[1] & 7, p1: a[3] & 7, frames: SCROLL_FRAMES[a[2] & 7], vOff: 0, vert: false }; break;
      // เลื่อนแนวตั้ง + แนวนอน: E = จำนวนแถวต่อก้าว (1–63)
      case 0x29: case 0x2a: this.scr = { dir: op === 0x29 ? 1 : -1, p0: a[1] & 7, p1: a[3] & 7, frames: SCROLL_FRAMES[a[2] & 7], vOff: a[4] & 0x3f, vert: true }; break;
      case 0xa3: s.vTop = a[0] & 0x3f; s.vRows = a[1] & 0x7f; break;
      case 0x2f: if (this.scr && !this.scrolling) { this.scrolling = true; this.scrollT0 = this.now(); this.scrollDone = 0; } break;
      case 0x2e: this.advanceScroll(); this.scrolling = false; s.vScroll = 0; break;
      default: break; // ค่าแรงดัน (0xDB, 0xDA) ไม่มีผลต่อภาพในแบบจำลอง
    }
  }

  private dataByte(b: number) {
    this.s.ram[this.page * 128 + this.col] = b;
    this.dataBytes++;
    this.version++;
    if (this.mode === 0) {
      if (this.col >= this.colEnd) { this.col = this.colStart; this.page = this.page >= this.pageEnd ? this.pageStart : this.page + 1; } else this.col++;
    } else if (this.mode === 1) {
      if (this.page >= this.pageEnd) { this.page = this.pageStart; this.col = this.col >= this.colEnd ? this.colStart : this.col + 1; } else this.page++;
    } else {
      this.col = this.col >= 127 ? 0 : this.col + 1;
    }
  }
}

/**
 * พิกเซลที่ตามองเห็นบนจอ (128 × 64, 1 = สว่าง) จากสถานะ SSD1306
 * โมดูลทั่วไปติดกระจกให้ภาพตั้งตรงเมื่อใช้ A1 (กลับคอลัมน์) + C8 (สแกน COM ย้อน) ตามที่ไดรเวอร์ ssd1306.py ตั้ง
 * จอดับเมื่อปิดจอ (0xAE) หรือไม่ได้เปิดปั๊มประจุ (0x8D 0x14) — โมดูลไม่มีไฟเลี้ยงแผง 7–15 V จากภายนอก
 */
export function oledPixels(s: Pick<OledState, 'ram' | 'on' | 'pump' | 'invert' | 'allOn' | 'segRemap' | 'comRev' | 'startLine' | 'offset' | 'mux' | 'vTop' | 'vRows' | 'vScroll'>): Uint8Array {
  const out = new Uint8Array(128 * 64);
  if (!s.on || !s.pump) return out;
  const rows = s.mux + 1;
  const vTop = s.vTop ?? 0, vRows = s.vRows ?? 64, vs = s.vScroll ?? 0;
  for (let y = 0; y < 64; y++) {
    if (y >= rows) continue;
    let yy = s.comRev ? y : rows - 1 - y;
    // พื้นที่เลื่อนแนวตั้ง (0xA3): แถวแสดงผลในช่วง [vTop, vTop + vRows) อ่านจากแถวที่เลื่อนไป vs แถว
    if (vs && yy >= vTop && yy < vTop + vRows) yy = vTop + ((yy - vTop + vs) % vRows);
    const r = (yy + s.startLine + s.offset) & 63;
    for (let x = 0; x < 128; x++) {
      const c = s.segRemap ? x : 127 - x;
      let on = s.allOn || ((s.ram[(r >> 3) * 128 + c] >> (r & 7)) & 1) === 1;
      if (s.invert) on = !on;
      out[y * 128 + x] = on ? 1 : 0;
    }
  }
  return out;
}

/* ===================== DS3231 + AT24C32 ===================== */

const DAY_MS = 86400e3;

/** วันที่แบบไม่มีเขตเวลา (ใช้ UTC ของ Date เป็นปฏิทินล้วน) */
function civil(sec: number) {
  const d = new Date(Math.floor(sec) * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), days: Math.floor(d.getTime() / DAY_MS) };
}

export function parseClock(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return Date.UTC(2026, 0, 1) / 1000;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000;
}

export function formatClock(sec: number): string {
  const c = civil(sec);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${c.y}-${p(c.mo)}-${p(c.d)} ${p(c.h)}:${p(c.mi)}:${p(c.s)}`;
}

export class Ds3231 implements I2cTarget {
  readonly name = 'DS3231';
  /** เวลา (วินาทีแบบปฏิทิน) ณ เวลาจำลอง ref */
  private base: number;
  private ref: number;
  private dayBase = 0;
  private h12 = false;
  private regs = new Uint8Array(0x13);
  private ptr = 0;
  private first = true;
  private wrote = new Map<number, number>();
  /** อัตราเดินของนาฬิกาเทียบเวลาจำลอง (aging offset: บวก = ช้าลง ≈ 0.1 ppm ต่อ LSB ที่ 25 °C) */
  private rate = 1;
  /** วินาทีปฏิทินล่าสุดที่ตรวจการปลุกแล้ว */
  private lastSec: number;
  /** เวลาจำลองที่จ่ายไฟ (การแปลงอุณหภูมิอัตโนมัติทุก 64 s นับจากนี้) และผลการแปลงล่าสุด */
  private t0: number;
  private convIdx = 0;
  private convTemp: number;
  /** การแปลงที่สั่งด้วยบิต CONV: เสร็จที่เวลาจำลองนี้ (−1 = ไม่มี) */
  private convEnd = -1;
  /** ไม่มีไฟ VCC (ทำงานด้วยแบตสำรอง) */
  private onBattery = false;
  temperature = 25;
  timeReads = 0;
  tempReads = 0;
  timeWrites = 0;
  alarms1 = 0;
  alarms2 = 0;
  /** ขาออกอาจเปลี่ยนระดับจากการเขียนรีจิสเตอร์ (ควบคุม/สถานะ/เวลา) */
  onChange?: () => void;
  constructor(private now: () => number, start: number) {
    this.base = start;
    this.ref = now();
    this.t0 = this.ref;
    this.convTemp = this.temperature;
    // ค่าหลังจ่ายไฟตามดาต้าชีต: ควบคุม 0x1C (RS2 = RS1 = 1, INTCN = 1), สถานะ EN32kHz = 1
    // (OSF หลังจ่ายไฟครั้งแรกของชิปจริง = 1 — แบบจำลองถือว่าตั้งเวลาไว้แล้วและมีแบตสำรอง จึงเริ่มที่ 0)
    this.regs[0x0e] = 0x1c;
    this.regs[0x0f] = 0x08;
    // วันในสัปดาห์: ให้ 1 = จันทร์ (ผู้ใช้กำหนดเองได้ตามดาต้าชีต) — 2000-01-03 เป็นวันจันทร์
    this.dayBase = 0;
    this.lastSec = Math.floor(start);
  }

  /** เวลาปฏิทินปัจจุบัน (วินาที) */
  clock(): number { return this.base + (this.now() - this.ref) * this.rate; }

  setClock(sec: number) { this.base = sec; this.ref = this.now(); this.lastSec = Math.floor(sec); }

  /** ไฟ VCC หาย/กลับมา (แบตสำรองบนโมดูลเลี้ยงนาฬิกาต่อ) — EOSC = 1 ขณะใช้แบต: ออสซิลเลเตอร์หยุด เวลาค้าง และ OSF = 1 */
  setPowered(p: boolean) {
    if (p === !this.onBattery) return;
    this.poll();
    if (!p && (this.regs[0x0e] & 0x80)) { this.base = this.clock(); this.ref = this.now(); this.rate = 0; this.regs[0x0f] |= 0x80; }
    if (p) { this.base = this.clock(); this.ref = this.now(); this.rate = this.agingRate(); }
    this.onBattery = !p;
  }

  private agingRate() { const a = (this.regs[0x10] << 24) >> 24; return 1 - a * 0.1e-6; }

  private civilNow() { return civil(this.clock()); }

  private timeReg(i: number, c = this.civilNow()): number {
    switch (i) {
      case 0: return bcd(c.s);
      case 1: return bcd(c.mi);
      case 2: {
        if (!this.h12) return bcd(c.h);
        const pm = c.h >= 12, h = c.h % 12 || 12;
        return 0x40 | (pm ? 0x20 : 0) | bcd(h);
      }
      case 3: return this.dow(c.days);
      case 4: return bcd(c.d);
      case 5: return bcd(c.mo) | (c.y >= 2100 ? 0x80 : 0);
      default: return bcd(c.y % 100);
    }
  }
  private dow(days: number) { return ((((days - Date.UTC(2000, 0, 3) / DAY_MS) % 7) + 7 + this.dayBase) % 7) + 1; }

  /** ชั่วโมงของรีจิสเตอร์ปลุก (รูปแบบ 12/24 ตามบิต 6) → 0–23 */
  private alarmHour(b: number) { if (b & 0x40) { const h = unbcd(b & 0x1f) % 12; return h + (b & 0x20 ? 12 : 0); } return unbcd(b & 0x3f); }

  /** ตรวจการปลุก ณ วินาทีปฏิทิน sec (ทดสอบตอนอัปเดตเวลาทุกวินาที) */
  private matchAt(sec: number) {
    const c = civil(sec), r = this.regs;
    const field = (b: number, ok: boolean) => (b & 0x80) !== 0 || ok;
    const dayOk = (b: number) => field(b, b & 0x40 ? (b & 0x0f) === this.dow(c.days) : unbcd(b & 0x3f) === c.d);
    // ปลุก 1: วินาที/นาที/ชั่วโมง/วัน (บิต 7 ของแต่ละรีจิสเตอร์ = A1Mx: 1 = ไม่ต้องตรง)
    if (field(r[7], unbcd(r[7] & 0x7f) === c.s) && field(r[8], unbcd(r[8] & 0x7f) === c.mi) && field(r[9], this.alarmHour(r[9]) === c.h) && dayOk(r[0x0a])) { this.regs[0x0f] |= 0x01; this.alarms1++; }
    // ปลุก 2: วินาทีต้องเป็น 00 เสมอ
    if (c.s === 0 && field(r[0x0b], unbcd(r[0x0b] & 0x7f) === c.mi) && field(r[0x0c], this.alarmHour(r[0x0c]) === c.h) && dayOk(r[0x0d])) { this.regs[0x0f] |= 0x02; this.alarms2++; }
  }

  /** เดินสถานะถึงเวลาปัจจุบัน: การปลุกทุกวินาทีที่ผ่าน, การแปลงอุณหภูมิ (อัตโนมัติทุก 64 s และที่สั่งด้วย CONV) */
  poll() {
    const s = Math.floor(this.clock());
    // เวลากระโดดไกล (ตั้งเวลาใหม่ด้วยแผง/เขียนรีจิสเตอร์ใช้ setClock ซึ่งไม่ทำให้ปลุกย้อนหลัง) — จำกัดรอบกันค้าง
    if (s - this.lastSec > 400000) this.lastSec = s - 400000;
    for (let k = this.lastSec + 1; k <= s; k++) this.matchAt(k);
    if (s > this.lastSec) this.lastSec = s;
    const t = this.now();
    const idx = Math.floor((t - this.t0 - T_CONV) / 64) + 1; // การแปลงอัตโนมัติที่เสร็จแล้ว (ครั้งแรกตอนจ่ายไฟ)
    if (idx > this.convIdx) { this.convIdx = idx; this.convTemp = this.temperature; }
    if (this.convEnd >= 0 && t >= this.convEnd) { this.convEnd = -1; this.convTemp = this.temperature; this.regs[0x0e] &= ~0x20; }
  }

  private busy() { const t = this.now(); const ph = (t - this.t0) % 64; return this.convEnd >= 0 || (t - this.t0 >= 0 && ph < T_CONV); }

  private reg(i: number): number {
    if (i <= 6) return this.timeReg(i);
    if (i === 0x0f) return (this.regs[i] & ~0x04) | (this.busy() ? 0x04 : 0);
    if (i === 0x11 || i === 0x12) {
      // ก่อนการแปลงครั้งแรกหลังจ่ายไฟเสร็จ ใช้อุณหภูมิปัจจุบัน (ค่าในรีจิสเตอร์ของชิปจริงช่วงนี้ไม่ได้ระบุในดาต้าชีต)
      const t = Math.round((this.convIdx === 0 ? this.temperature : this.convTemp) * 4) / 4;
      return i === 0x11 ? Math.floor(t) & 0xff : (Math.round((t - Math.floor(t)) * 4) & 3) << 6;
    }
    return this.regs[i];
  }

  begin(read: boolean) { this.poll(); this.first = !read; if (read && this.ptr <= 6) this.timeReads++; if (read && this.ptr === 0x11) this.tempReads++; }

  write(b: number): boolean {
    if (this.first) { this.ptr = b % 0x13; this.first = false; return true; }
    const i = this.ptr;
    if (i <= 6) { this.wrote.set(i, b); if (i === 2) this.h12 = (b & 0x40) !== 0; }
    // สถานะ 0x0F: OSF/A2F/A1F ล้างได้ด้วยการเขียน 0 เท่านั้น (เขียน 1 ไม่ตั้งบิต), EN32kHz เขียนได้, BSY อ่านอย่างเดียว
    else if (i === 0x0f) this.regs[i] = (this.regs[i] & b & 0x83) | (b & 0x08) | (this.regs[i] & 0x04);
    else if (i === 0x0e) {
      // CONV: เริ่มการแปลงอุณหภูมิเมื่อไม่ได้แปลงอยู่ — บิตค้างเป็น 1 จนเสร็จ (tCONV สูงสุด 200 ms)
      const conv = (b & 0x20) !== 0 && !(this.regs[i] & 0x20) && !this.busy();
      this.regs[i] = (b & ~0x20) | (this.regs[i] & 0x20);
      if (conv) { this.regs[i] |= 0x20; this.convEnd = this.now() + T_CONV; }
    } else if (i === 0x10) {
      // aging offset: เปลี่ยนอัตราเดินนับจากตอนนี้
      this.base = this.clock(); this.ref = this.now(); this.regs[i] = b; if (this.rate !== 0) this.rate = this.agingRate();
    } else if (i !== 0x11 && i !== 0x12) this.regs[i] = b;
    this.ptr = (i + 1) % 0x13;
    if (i === 0x0e || i === 0x0f || i === 0x10) this.onChange?.();
    return true;
  }

  read(): number {
    const v = this.reg(this.ptr);
    this.ptr = (this.ptr + 1) % 0x13;
    return v;
  }

  end() {
    if (!this.wrote.size) return;
    this.onChange?.();
    // เขียนรีจิสเตอร์เวลา: รวมกับค่าปัจจุบันของรีจิสเตอร์ที่ไม่ได้เขียน (การเขียนวินาทีรีเซ็ตตัวนับย่อยวินาที)
    const cur = [0, 1, 2, 3, 4, 5, 6].map((i) => this.wrote.get(i) ?? this.timeReg(i));
    const s = unbcd(cur[0] & 0x7f), mi = unbcd(cur[1] & 0x7f);
    let h: number;
    if (cur[2] & 0x40) { const hh = unbcd(cur[2] & 0x1f) % 12; h = hh + (cur[2] & 0x20 ? 12 : 0); } else h = unbcd(cur[2] & 0x3f);
    const d = Math.max(1, unbcd(cur[4] & 0x3f)), mo = Math.min(12, Math.max(1, unbcd(cur[5] & 0x1f))), y = 2000 + unbcd(cur[6]) + (cur[5] & 0x80 ? 100 : 0);
    const sec = Date.UTC(y, mo - 1, d, h % 24, mi % 60, s % 60) / 1000;
    const dayWritten = this.wrote.get(3);
    this.setClock(sec);
    if (dayWritten !== undefined) {
      const auto = ((((Math.floor(sec * 1000 / DAY_MS) - Date.UTC(2000, 0, 3) / DAY_MS) % 7) + 7) % 7);
      this.dayBase = (((dayWritten & 7) - 1 - auto) % 7 + 7) % 7;
    }
    this.timeWrites++;
    this.wrote.clear();
  }

  /* ----- ขาออก open-drain (ดาต้าชีต: VOL ≤ 0.4 V ที่ 3 mA) ----- */

  /** ความถี่คลื่นสี่เหลี่ยมที่ขา INT/SQW เมื่อ INTCN = 0 (RS2:RS1) */
  sqwFreq() { return [1, 1024, 4096, 8192][(this.regs[0x0e] >> 3) & 3]; }
  get intcn() { return (this.regs[0x0e] & 0x04) !== 0; }
  get en32k() { return (this.regs[0x0f] & 0x08) !== 0; }
  get flags() { return this.regs[0x0f] & 0x03; }
  get control() { return this.regs[0x0e]; }

  /** ขา INT/SQW ถูกดึงลงอยู่ไหม — INTCN = 1: เมื่อ AxF และ AxIE · INTCN = 0: คลื่นสี่เหลี่ยม (1 Hz: สูง 500 ms หลังการอัปเดตวินาที) */
  sqwLow(): boolean {
    this.poll();
    const c = this.regs[0x0e], st = this.regs[0x0f];
    if (c & 0x04) return ((st & 1) !== 0 && (c & 1) !== 0) || ((st & 2) !== 0 && (c & 2) !== 0);
    if (this.onBattery && !(c & 0x40)) return false; // ใช้แบต: คลื่นสี่เหลี่ยมต้องเปิด BBSQW
    if (this.rate === 0) return false;
    const ph = this.clock() * this.sqwFreq();
    return ph - Math.floor(ph) < 0.5;
  }

  /** ขา 32kHz ถูกดึงลงอยู่ไหม (คลื่นสี่เหลี่ยม 32.768 kHz เมื่อ EN32kHz = 1) */
  k32Low(): boolean {
    if (!this.en32k || this.onBattery || this.rate === 0) return false;
    const ph = this.clock() * 32768;
    return ph - Math.floor(ph) < 0.5;
  }

  /** เวลาจำลองของการเปลี่ยนระดับขาครั้งถัดไป (ใช้หยุด CPU ตรงขอบ) */
  nextEdge(sqw: boolean, k32: boolean): number {
    const t = this.now();
    if (this.rate === 0) return Infinity;
    const next = (f: number) => { const ph = this.clock() * f * 2; return t + ((Math.floor(ph + 1e-9) + 1 - ph) / (f * 2)) / this.rate; };
    let n = Infinity;
    const c = this.regs[0x0e];
    if (sqw) {
      if (!(c & 0x04)) n = Math.min(n, next(this.sqwFreq()));
      else if ((c & 3) && (this.regs[0x0f] & 3) !== (c & 3)) n = Math.min(n, next(0.5)); // ทุกขอบวินาที: ตรวจการปลุก
    }
    if (k32 && this.en32k) n = Math.min(n, next(32768));
    return n;
  }
}

/** เวลาแปลงอุณหภูมิ (ดาต้าชีต tCONV 125–200 ms — ใช้ค่าสูงสุด) */
const T_CONV = 0.2;

export class At24c32 implements I2cTarget {
  readonly name = 'AT24C32';
  mem = new Uint8Array(4096).fill(0xff);
  private addr = 0;
  private nAddr = 0;
  begin(read: boolean) { if (!read) this.nAddr = 0; }
  write(b: number): boolean {
    if (this.nAddr === 0) { this.addr = ((b & 0x0f) << 8) | (this.addr & 0xff); this.nAddr = 1; return true; }
    if (this.nAddr === 1) { this.addr = (this.addr & 0xf00) | b; this.nAddr = 2; return true; }
    this.mem[this.addr] = b;
    this.addr = (this.addr & ~0x1f) | ((this.addr + 1) & 0x1f); // ห่อภายในหน้า 32 ไบต์
    return true;
  }
  read(): number { const v = this.mem[this.addr]; this.addr = (this.addr + 1) & 0xfff; return v; }
  end() { this.nAddr = 0; }
}

/* ===================== MPU6050 ===================== */

export type Motion = 'still' | 'walk' | 'shake';

/** ความเร่ง (g) และอัตราหมุน (°/s) ตามการเคลื่อนไหวที่ตั้งในแผงคุณสมบัติ — นาฬิกาที่ข้อมือหน้าปัดหงายขึ้น (z ≈ +1 g) */
export function motionSample(m: Motion, t: number, spm: number): { a: [number, number, number]; g: [number, number, number] } {
  const noise = (k: number) => Math.sin(t * 7919 + k * 104.7) * Math.sin(t * 3511 + k * 51.3) * 0.006;
  if (m === 'walk') {
    // หนึ่งจังหวะก้าวต่อหนึ่งคาบ: ขนาดความเร่งพุ่งเหนือ 1 g ครั้งเดียวต่อก้าว (ยอดที่ phase 0.25)
    const f = spm / 60, ph = 2 * Math.PI * f * t;
    return { a: [0.15 * Math.sin(ph / 2) + noise(1), 0.06 * Math.cos(ph) + noise(2), 1 + 0.35 * Math.sin(ph) + noise(3)], g: [30 * Math.cos(ph / 2), 8 * Math.sin(ph), 5 * Math.cos(ph)] };
  }
  if (m === 'shake') {
    const ph = 2 * Math.PI * 6 * t;
    return { a: [1.2 * Math.sin(ph) + noise(1), 0.6 * Math.cos(ph * 1.3) + noise(2), 1 + 0.5 * Math.sin(ph * 0.7) + noise(3)], g: [250 * Math.cos(ph), 120 * Math.sin(ph * 1.3), 60 * Math.cos(ph * 0.7)] };
  }
  return { a: [noise(1), noise(2), 1 + noise(3)], g: [noise(4) * 50, noise(5) * 50, noise(6) * 50] };
}

/** จำนวนก้าวจริงของแบบจำลอง (ยอดความเร่งที่ phase 0.25 + k) นับตั้งแต่เริ่มเดิน */
export function trueSteps(t: number, spm: number): number {
  const n = (t * spm) / 60;
  return n < 0.25 ? 0 : Math.floor(n - 0.25) + 1;
}

/**
 * MPU6050 (Register Map rev 4.2): ค่าเซนเซอร์ 0x3B–0x48 · อัตราสุ่ม = อัตราออกของไจโร (8 kHz เมื่อ DLPF_CFG = 0/7, มิฉะนั้น 1 kHz) ÷ (1 + SMPLRT_DIV)
 * FIFO 1024 ไบต์ (FIFO_EN 0x23 เลือกข้อมูล ตามลำดับรีจิสเตอร์: ความเร่ง 6, อุณหภูมิ 2, ไจโร X/Y/Z อย่างละ 2) เปิดด้วย USER_CTRL บิต 6, ล้างด้วยบิต 2
 * ล้น → ข้อมูลเก่าสุดหายและตั้ง FIFO_OFLOW_INT · INT_STATUS (0x3A): DATA_RDY ทุกครั้งที่สุ่ม, ล้างเมื่ออ่าน INT_STATUS (หรืออ่านรีจิสเตอร์ใดก็ได้เมื่อ INT_RD_CLEAR = 1)
 * ขา INT: INT_ENABLE (0x38) · INT_PIN_CFG (0x37): ACTL (บิต 7, 1 = active low), LATCH_INT_EN (บิต 5: 0 = พัลส์ 50 µs, 1 = ค้างจนล้าง)
 */
export class Mpu6050 implements I2cTarget {
  readonly name = 'MPU6050';
  regs = new Uint8Array(128);
  private ptr = 0;
  private first = true;
  private latch: number[] | null = null;
  motion: Motion = 'still';
  spm = 100;
  temperature = 25;
  /** เวลาจำลองที่เริ่มการเคลื่อนไหวแบบปัจจุบัน */
  motionStart = 0;
  dataReads = 0;
  fifo: number[] = [];
  /** การสุ่ม: เวลาเริ่มนับ (ตั้งใหม่เมื่ออัตราเปลี่ยน/ตื่น) และลำดับตัวอย่างล่าสุดที่ทำแล้ว */
  private sT0 = 0;
  private sDone = 0;
  /** เวลาของตัวอย่างล่าสุด (พัลส์ INT 50 µs) */
  lastSampleT = -1;
  samples = 0;
  overflows = 0;
  /** ขา INT เปลี่ยนจากการเขียนรีจิสเตอร์ */
  onChange?: () => void;
  constructor(private now: () => number) { this.reset(); }
  reset() { this.regs.fill(0); this.regs[0x6b] = 0x40; this.regs[0x75] = 0x68; this.fifo = []; this.sT0 = this.now(); this.sDone = 0; }
  get asleep() { return (this.regs[0x6b] & 0x40) !== 0; }

  /** อัตราสุ่ม (Hz) */
  sampleRate(): number { const dlpf = this.regs[0x1a] & 7; return (dlpf === 0 || dlpf === 7 ? 8000 : 1000) / (1 + this.regs[0x19]); }

  /** ค่าดิบ 14 ไบต์ของ 0x3B–0x48 ณ เวลา t (ความเร่ง/อุณหภูมิ/ไจโร) */
  private sampleAt(t: number): number[] {
    if (this.asleep) return new Array(14).fill(0);
    const s = motionSample(this.motion, t - this.motionStart, this.spm);
    const aS = 16384 >> ((this.regs[0x1c] >> 3) & 3), gS = 131 / (1 << ((this.regs[0x1b] >> 3) & 3));
    const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
    const words = [...s.a.map((v) => clamp(v * aS)), clamp((this.temperature - 36.53) * 340), ...s.g.map((v) => clamp(v * gS))];
    return words.flatMap((w) => [(w >> 8) & 0xff, w & 0xff]);
  }
  private sample(): number[] { return this.sampleAt(this.now()); }

  /** ไบต์ที่ FIFO เก็บต่อหนึ่งตัวอย่างตาม FIFO_EN */
  private fifoBytes(d: number[]): number[] {
    const en = this.regs[0x23], out: number[] = [];
    if (en & 0x08) out.push(...d.slice(0, 6));
    if (en & 0x80) out.push(d[6], d[7]);
    if (en & 0x40) out.push(d[8], d[9]);
    if (en & 0x20) out.push(d[10], d[11]);
    if (en & 0x10) out.push(d[12], d[13]);
    return out;
  }

  /** เดินการสุ่มถึงเวลาปัจจุบัน: เติม FIFO และตั้ง DATA_RDY */
  poll() {
    const t = this.now();
    if (this.asleep) { this.sT0 = t; this.sDone = 0; return; }
    const fs = this.sampleRate();
    const n = Math.floor((t - this.sT0) * fs + 1e-9);
    if (n <= this.sDone) return;
    // ย้อนหลังไม่เกินจำนวนที่ FIFO รับได้ (ตัวอย่างที่เก่ากว่านั้นถูกเขียนทับอยู่แล้ว)
    const fifoOn = (this.regs[0x6a] & 0x40) !== 0;
    const per = fifoOn ? Math.max(1, this.fifoBytes(new Array(14).fill(0)).length) : 1;
    const from = Math.max(this.sDone + 1, n - Math.ceil(1024 / per) - 1);
    for (let k = from; k <= n; k++) {
      const tk = this.sT0 + k / fs;
      if (fifoOn) {
        this.fifo.push(...this.fifoBytes(this.sampleAt(tk)));
        if (this.fifo.length > 1024) { this.fifo.splice(0, this.fifo.length - 1024); this.regs[0x3a] |= 0x10; this.overflows++; }
      }
      this.samples++;
    }
    this.regs[0x3a] |= 0x01;
    this.sDone = n;
    this.lastSampleT = this.sT0 + n / fs;
  }

  /** ขา INT ทำงาน (ตามเงื่อนไขของรีจิสเตอร์ ก่อนกลับขั้วตาม ACTL) */
  intActive(): boolean {
    this.poll();
    const en = this.regs[0x38], st = this.regs[0x3a] & en & 0x11;
    if (!st) return false;
    if (this.regs[0x37] & 0x20) return true; // latch
    // ใช้นิพจน์เดียวกับ nextEvent (ปลายพัลส์) — เทียบคนละรูปแบบแล้วปัดเศษต่างกันที่ขอบ ทำให้ขาค้างสูงข้ามรอบ
    return this.now() < this.pulseEnd();
  }
  private pulseEnd() { return this.lastSampleT + 50e-6; }
  /** ระดับขา INT (true = สูง) */
  intLevel(): boolean { const a = this.intActive(); return (this.regs[0x37] & 0x80) ? !a : a; }
  /** เวลาของการเปลี่ยนระดับ INT ครั้งถัดไป (ตัวอย่างถัดไป หรือปลายพัลส์ 50 µs) */
  nextEvent(): number {
    if (this.asleep || !(this.regs[0x38] & 0x01)) return Infinity;
    const t = this.now(), fs = this.sampleRate();
    if (!(this.regs[0x37] & 0x20) && t < this.pulseEnd()) return this.pulseEnd();
    return this.sT0 + (Math.floor((t - this.sT0) * fs + 1e-9) + 1) / fs;
  }

  private reg(i: number): number {
    if (i >= 0x3b && i <= 0x48) {
      // อ่านต่อเนื่อง: ค่าทุกแกนมาจากตัวอย่างเดียวกัน (เหมือนรีจิสเตอร์ shadow ของชิปจริงระหว่างการอ่านแบบ burst)
      this.latch ??= this.sample();
      return this.latch[i - 0x3b];
    }
    if (i === 0x72) return (this.fifo.length >> 8) & 0xff;
    if (i === 0x73) return this.fifo.length & 0xff;
    if (i === 0x74) return this.fifo.length ? this.fifo.shift()! : 0;
    if (i === 0x3a) { const v = this.regs[0x3a]; this.regs[0x3a] = 0; this.onChange?.(); return v; }
    return this.regs[i];
  }

  begin(read: boolean) { this.poll(); this.first = !read; this.latch = null; if (read && this.ptr >= 0x3b && this.ptr <= 0x48) this.dataReads++; }
  write(b: number): boolean {
    if (this.first) { this.ptr = b & 0x7f; this.first = false; return true; }
    const i = this.ptr;
    if (i === 0x6b && (b & 0x80)) this.reset();
    else if (i === 0x74) { /* เขียน FIFO จากภายนอกไม่ได้ใช้ */ }
    else if (i === 0x6a) { if (b & 0x04) this.fifo = []; this.regs[i] = b & ~0x04; }
    else if (i !== 0x75 && i !== 0x3a && !(i >= 0x3b && i <= 0x48) && i !== 0x72 && i !== 0x73) {
      const rateChange = (i === 0x19 || i === 0x1a || i === 0x6b) && this.regs[i] !== b;
      this.regs[i] = b;
      if (rateChange) { this.sT0 = this.now(); this.sDone = 0; }
    }
    // อ่านรีจิสเตอร์ FIFO ไม่เลื่อนตัวชี้ (อ่าน FIFO_R_W ต่อเนื่องได้)
    this.ptr = i === 0x74 ? i : (i + 1) & 0x7f;
    if (i === 0x37 || i === 0x38 || i === 0x6b) this.onChange?.();
    return true;
  }
  read(): number {
    const i = this.ptr;
    // INT_RD_CLEAR: อ่านรีจิสเตอร์ใดก็ได้ล้างสถานะ
    if (i !== 0x3a && (this.regs[0x37] & 0x10) && this.regs[0x3a]) { this.regs[0x3a] = 0; this.onChange?.(); }
    const v = this.reg(i);
    this.ptr = i === 0x74 ? i : (i + 1) & 0x7f;
    return v;
  }
  end() { this.latch = null; }
}

/* ===================== ข้อความบนจอ (ฟอนต์ 8×8 ของ framebuf) ===================== */

/**
 * ฟอนต์ petme128 8×8 ที่ MicroPython ใช้ใน framebuf.text() (extmod/font_petme128_8x8.h, MIT) อักษร 32–127
 * 8 ไบต์ต่ออักษร: แต่ละไบต์คือหนึ่งคอลัมน์ บิต 0 = แถวบนสุด
 */
export const FONT8 = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4f, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x07, 0x07, 0x00, 0x00, 0x07, 0x07, 0x00,
  0x14, 0x7f, 0x7f, 0x14, 0x14, 0x7f, 0x7f, 0x14, 0x00, 0x24, 0x2e, 0x6b, 0x6b, 0x3a, 0x12, 0x00, 0x00, 0x63, 0x33, 0x18, 0x0c, 0x66, 0x63, 0x00,
  0x00, 0x32, 0x7f, 0x4d, 0x4d, 0x77, 0x72, 0x50, 0x00, 0x00, 0x00, 0x04, 0x06, 0x03, 0x01, 0x00, 0x00, 0x00, 0x1c, 0x3e, 0x63, 0x41, 0x00, 0x00,
  0x00, 0x00, 0x41, 0x63, 0x3e, 0x1c, 0x00, 0x00, 0x08, 0x2a, 0x3e, 0x1c, 0x1c, 0x3e, 0x2a, 0x08, 0x00, 0x08, 0x08, 0x3e, 0x3e, 0x08, 0x08, 0x00,
  0x00, 0x00, 0x80, 0xe0, 0x60, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x00, 0x00, 0x00, 0x60, 0x60, 0x00, 0x00, 0x00,
  0x00, 0x40, 0x60, 0x30, 0x18, 0x0c, 0x06, 0x02, 0x00, 0x3e, 0x7f, 0x49, 0x45, 0x7f, 0x3e, 0x00, 0x00, 0x40, 0x44, 0x7f, 0x7f, 0x40, 0x40, 0x00,
  0x00, 0x62, 0x73, 0x51, 0x49, 0x4f, 0x46, 0x00, 0x00, 0x22, 0x63, 0x49, 0x49, 0x7f, 0x36, 0x00, 0x00, 0x18, 0x18, 0x14, 0x16, 0x7f, 0x7f, 0x10,
  0x00, 0x27, 0x67, 0x45, 0x45, 0x7d, 0x39, 0x00, 0x00, 0x3e, 0x7f, 0x49, 0x49, 0x7b, 0x32, 0x00, 0x00, 0x03, 0x03, 0x79, 0x7d, 0x07, 0x03, 0x00,
  0x00, 0x36, 0x7f, 0x49, 0x49, 0x7f, 0x36, 0x00, 0x00, 0x26, 0x6f, 0x49, 0x49, 0x7f, 0x3e, 0x00, 0x00, 0x00, 0x00, 0x24, 0x24, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x80, 0xe4, 0x64, 0x00, 0x00, 0x00, 0x00, 0x08, 0x1c, 0x36, 0x63, 0x41, 0x41, 0x00, 0x00, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x00,
  0x00, 0x41, 0x41, 0x63, 0x36, 0x1c, 0x08, 0x00, 0x00, 0x02, 0x03, 0x51, 0x59, 0x0f, 0x06, 0x00, 0x00, 0x3e, 0x7f, 0x41, 0x4d, 0x4f, 0x2e, 0x00,
  0x00, 0x7c, 0x7e, 0x0b, 0x0b, 0x7e, 0x7c, 0x00, 0x00, 0x7f, 0x7f, 0x49, 0x49, 0x7f, 0x36, 0x00, 0x00, 0x3e, 0x7f, 0x41, 0x41, 0x63, 0x22, 0x00,
  0x00, 0x7f, 0x7f, 0x41, 0x63, 0x3e, 0x1c, 0x00, 0x00, 0x7f, 0x7f, 0x49, 0x49, 0x41, 0x41, 0x00, 0x00, 0x7f, 0x7f, 0x09, 0x09, 0x01, 0x01, 0x00,
  0x00, 0x3e, 0x7f, 0x41, 0x49, 0x7b, 0x3a, 0x00, 0x00, 0x7f, 0x7f, 0x08, 0x08, 0x7f, 0x7f, 0x00, 0x00, 0x00, 0x41, 0x7f, 0x7f, 0x41, 0x00, 0x00,
  0x00, 0x20, 0x60, 0x41, 0x7f, 0x3f, 0x01, 0x00, 0x00, 0x7f, 0x7f, 0x1c, 0x36, 0x63, 0x41, 0x00, 0x00, 0x7f, 0x7f, 0x40, 0x40, 0x40, 0x40, 0x00,
  0x00, 0x7f, 0x7f, 0x06, 0x0c, 0x06, 0x7f, 0x7f, 0x00, 0x7f, 0x7f, 0x0e, 0x1c, 0x7f, 0x7f, 0x00, 0x00, 0x3e, 0x7f, 0x41, 0x41, 0x7f, 0x3e, 0x00,
  0x00, 0x7f, 0x7f, 0x09, 0x09, 0x0f, 0x06, 0x00, 0x00, 0x1e, 0x3f, 0x21, 0x61, 0x7f, 0x5e, 0x00, 0x00, 0x7f, 0x7f, 0x19, 0x39, 0x6f, 0x46, 0x00,
  0x00, 0x26, 0x6f, 0x49, 0x49, 0x7b, 0x32, 0x00, 0x00, 0x01, 0x01, 0x7f, 0x7f, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x7f, 0x40, 0x40, 0x7f, 0x3f, 0x00,
  0x00, 0x1f, 0x3f, 0x60, 0x60, 0x3f, 0x1f, 0x00, 0x00, 0x7f, 0x7f, 0x30, 0x18, 0x30, 0x7f, 0x7f, 0x00, 0x63, 0x77, 0x1c, 0x1c, 0x77, 0x63, 0x00,
  0x00, 0x07, 0x0f, 0x78, 0x78, 0x0f, 0x07, 0x00, 0x00, 0x61, 0x71, 0x59, 0x4d, 0x47, 0x43, 0x00, 0x00, 0x00, 0x7f, 0x7f, 0x41, 0x41, 0x00, 0x00,
  0x00, 0x02, 0x06, 0x0c, 0x18, 0x30, 0x60, 0x40, 0x00, 0x00, 0x41, 0x41, 0x7f, 0x7f, 0x00, 0x00, 0x00, 0x08, 0x0c, 0x06, 0x06, 0x0c, 0x08, 0x00,
  0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0x00, 0x00, 0x01, 0x03, 0x06, 0x04, 0x00, 0x00, 0x00, 0x20, 0x74, 0x54, 0x54, 0x7c, 0x78, 0x00,
  0x00, 0x7f, 0x7f, 0x44, 0x44, 0x7c, 0x38, 0x00, 0x00, 0x38, 0x7c, 0x44, 0x44, 0x6c, 0x28, 0x00, 0x00, 0x38, 0x7c, 0x44, 0x44, 0x7f, 0x7f, 0x00,
  0x00, 0x38, 0x7c, 0x54, 0x54, 0x5c, 0x58, 0x00, 0x00, 0x08, 0x7e, 0x7f, 0x09, 0x03, 0x02, 0x00, 0x00, 0x98, 0xbc, 0xa4, 0xa4, 0xfc, 0x7c, 0x00,
  0x00, 0x7f, 0x7f, 0x04, 0x04, 0x7c, 0x78, 0x00, 0x00, 0x00, 0x00, 0x7d, 0x7d, 0x00, 0x00, 0x00, 0x00, 0x40, 0xc0, 0x80, 0x80, 0xfd, 0x7d, 0x00,
  0x00, 0x7f, 0x7f, 0x30, 0x38, 0x6c, 0x44, 0x00, 0x00, 0x00, 0x41, 0x7f, 0x7f, 0x40, 0x00, 0x00, 0x00, 0x7c, 0x7c, 0x18, 0x30, 0x18, 0x7c, 0x7c,
  0x00, 0x7c, 0x7c, 0x04, 0x04, 0x7c, 0x78, 0x00, 0x00, 0x38, 0x7c, 0x44, 0x44, 0x7c, 0x38, 0x00, 0x00, 0xfc, 0xfc, 0x24, 0x24, 0x3c, 0x18, 0x00,
  0x00, 0x18, 0x3c, 0x24, 0x24, 0xfc, 0xfc, 0x00, 0x00, 0x7c, 0x7c, 0x04, 0x04, 0x0c, 0x08, 0x00, 0x00, 0x48, 0x5c, 0x54, 0x54, 0x74, 0x20, 0x00,
  0x04, 0x04, 0x3f, 0x7f, 0x44, 0x64, 0x20, 0x00, 0x00, 0x3c, 0x7c, 0x40, 0x40, 0x7c, 0x3c, 0x00, 0x00, 0x1c, 0x3c, 0x60, 0x60, 0x3c, 0x1c, 0x00,
  0x00, 0x1c, 0x7c, 0x30, 0x18, 0x30, 0x7c, 0x1c, 0x00, 0x44, 0x6c, 0x38, 0x38, 0x6c, 0x44, 0x00, 0x00, 0x9c, 0xbc, 0xa0, 0xa0, 0xfc, 0x7c, 0x00,
  0x00, 0x44, 0x64, 0x74, 0x5c, 0x4c, 0x44, 0x00, 0x00, 0x08, 0x08, 0x3e, 0x77, 0x41, 0x41, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00,
  0x00, 0x41, 0x41, 0x77, 0x3e, 0x08, 0x08, 0x00, 0x00, 0x02, 0x03, 0x01, 0x03, 0x02, 0x03, 0x01, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55,
]);

/**
 * อ่านข้อความที่ framebuf.text() วาดไว้บนจอ (เทียบลายอักษรทุกตำแหน่งแบบตรงทุกพิกเซลในช่อง 8×8)
 * ใช้ตรวจผลจากข้อมูลบนจอเท่านั้น — คืนรายการบรรทัด { y, x, text } (ช่องว่างระหว่างอักษรห่าง 8 px นับเป็นช่องว่าง)
 */
export function oledText(pix: Uint8Array): Array<{ y: number; x: number; text: string }> {
  const glyphs = new Map<string, string>();
  for (let c = 33; c < 127; c++) glyphs.set(Array.from(FONT8.subarray((c - 32) * 8, (c - 31) * 8)).join(','), String.fromCharCode(c));
  const cell = (x: number, y: number) => {
    const cols: number[] = [];
    for (let j = 0; j < 8; j++) {
      let v = 0;
      for (let k = 0; k < 8; k++) if (pix[(y + k) * 128 + x + j]) v |= 1 << k;
      cols.push(v);
    }
    return cols;
  };
  const out: Array<{ y: number; x: number; text: string }> = [];
  for (let y = 0; y <= 56; y++) {
    let x = 0;
    while (x <= 120) {
      const ch = glyphs.get(cell(x, y).join(','));
      if (!ch) { x++; continue; }
      // พบอักษร: อ่านต่อทีละ 8 px (ช่องว่าง = ช่องที่ไม่มีพิกเซลเลย)
      let text = '', xx = x, blanks = 0;
      const x0 = x;
      while (xx <= 120) {
        const c = cell(xx, y);
        const g = glyphs.get(c.join(','));
        if (g) { text += ' '.repeat(blanks) + g; blanks = 0; }
        else if (c.every((v) => v === 0)) { blanks++; if (blanks > 2) break; }
        else break;
        xx += 8;
      }
      out.push({ y, x: x0, text });
      x = xx;
    }
  }
  // ช่องที่คร่อมครึ่งบน/ล่างของอักษรอาจบังเอิญตรงกับอักษรเล็ก (เช่น " หรือ -) — เก็บข้อความที่ยาวกว่าเมื่อพื้นที่ทับกัน
  const kept: typeof out = [];
  for (const e of [...out].sort((p, q) => q.text.trim().length - p.text.trim().length)) {
    const w = e.text.length * 8;
    if (kept.some((k) => Math.abs(k.y - e.y) < 8 && e.x < k.x + k.text.length * 8 && k.x < e.x + w)) continue;
    kept.push(e);
  }
  return kept.sort((p, q) => p.y - q.y || p.x - q.x);
}
