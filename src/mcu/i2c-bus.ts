import { Cst816s, Lsm6dsox, Qmi8658, type TouchEvent } from './watch-devices';
import { Bh1750, Bmp280, Ina219, Lcd1602, charLcdView, type CharLcdView } from './i2c-sensors';
import type { NetlistElement } from '../sim/netlist';
import { At24c32, Ds3231, Mpu6050, Ssd1306, oledPixels, oledText, parseClock, trueSteps, type I2cTarget, type Motion } from './i2c-devices';

/**
 * บัส I²C ใน co-simulation — อุปกรณ์ตอบเฉพาะธุรกรรมที่ไปถึงจริงทางไฟฟ้า:
 *   - สาย SDA/SCL ของอุปกรณ์ต่อกับขาของไมโครคอนโทรลเลอร์ที่ใช้ทำ I²C (ตรวจจากเน็ตที่ต่อจริง)
 *   - อุปกรณ์มีไฟเลี้ยงอยู่ในช่วงที่ใช้งานได้ และกราวด์ต่อร่วมกับบอร์ด (จากแรงดันที่วงจรคำนวณได้)
 * มาได้ 2 ทาง:
 *   1) ฮาร์ดแวร์ I²C ของ RP2040 (rp2040js RPI2C) — ใช้ตอน writeto/readfrom_mem: ขาต้องตั้งเป็นฟังก์ชัน I²C (FUNCSEL 3) ของ instance เดียวกัน
 *      ขา GPn: I2C((n >> 1) & 1), SDA เมื่อ n คู่, SCL เมื่อ n คี่ (ตาราง GPIO function ของ RP2040)
 *   2) สลับขาเอง (soft I²C / bit-bang) — MicroPython rp2 ใช้ทางนี้ใน i2c.scan() (เขียน 0 ไบต์) และ SoftI2C:
 *      ถอดรหัสจากระดับขาแบบ open-drain: สายต่ำเมื่อมีผู้ดึงลง (ขา MCU เป็นเอาต์พุต LOW หรืออุปกรณ์ตอบ ACK/ส่งบิต 0)
 * ที่อยู่ซ้ำ (เช่น DS3231 กับ MPU6050 ที่ AD0 ต่ำ ใช้ 0x68 ทั้งคู่): ทั้งสองตอบพร้อมกัน — ค่าที่อ่านได้ = AND ของสองตัว (สายแบบ wired-AND)
 */

export interface I2cSpec {
  id: string;
  dev: 'ssd1306' | 'ds3231' | 'mpu6050' | 'cst816s' | 'qmi8658' | 'lcd1602' | 'bmp280' | 'bh1750' | 'ina219' | 'lsm6dsox';
  vcc: number;
  gnd: number;
  sda: number;
  scl: number;
  /** MPU6050: ขา AD0 · QMI8658: ขา SA0 (−1 = ไม่มี) */
  ad0: number;
  /** CST816S: ขารีเซ็ต (active low) และขา INT ที่ชิปขับ (−1 = ไม่มี) */
  rst?: number;
  int?: number;
  /** SSD1306: ที่อยู่ที่เลือกด้วยตัวต้านทานบนโมดูล (0x3C/0x3D) */
  addr: number;
  vMin: number;
  vMax: number;
  /** DS3231: เวลาเริ่มต้น "YYYY-MM-DD HH:MM:SS", อุณหภูมิ · MPU6050: การเคลื่อนไหว, ก้าวต่อนาที, อุณหภูมิ */
  clock?: string;
  temperature?: number;
  motion?: Motion;
  spm?: number;
  /** BMP280: ความกดอากาศ (hPa) · BH1750: ความเข้มแสง (lx) */
  pressure?: number;
  lux?: number;
  /** BH1750: ความไว (count/lx) */
  sensitivity?: number;
  /** INA219: เน็ต VIN+ และ VIN− (ปลายสองข้างของตัวต้านทาน shunt บนโมดูล) */
  vinp?: number;
  vinm?: number;
  /** DS3231: ขา INT/SQW และ 32K (open-drain) */
  sqw?: number;
  k32?: number;
}

/** สถานะอุปกรณ์ที่ส่งให้หน้าเว็บ (แสดงจอ, ค่าที่แผงคุณสมบัติ, ตรวจแลป) */
export interface I2cDevState {
  dev: I2cSpec['dev'];
  /** อุปกรณ์มีไฟและกราวด์ร่วม */
  powered: boolean;
  /** จำนวนครั้งที่ตอบ ACK ที่อยู่ */
  acks: number;
  /** ที่อยู่ปัจจุบัน */
  addr: number;
  /** 1 = ธุรกรรมล่าสุดชนกับอุปกรณ์อื่นที่อยู่เดียวกัน (ที่อยู่ซ้ำอยู่ตอนนี้) */
  conflicts: number;
  /** จำนวนธุรกรรมที่เคยชนทั้งหมด */
  conflictsTotal: number;
  // SSD1306
  ram?: string;
  on?: boolean; pump?: boolean; contrast?: number; invert?: boolean; allOn?: boolean; segRemap?: boolean; comRev?: boolean; startLine?: number; offset?: number; mux?: number; vTop?: number; vRows?: number; vScroll?: number; scrolling?: boolean;
  dataBytes?: number;
  // DS3231
  clock?: number;
  timeReads?: number; tempReads?: number; timeWrites?: number;
  rtcFlags?: number; rtcControl?: number; sqwLow?: boolean; alarms1?: number; alarms2?: number;
  // MPU6050
  asleep?: boolean; steps?: number; dataReads?: number; motion?: Motion; fifoCount?: number; mpuSamples?: number; mpuOverflows?: number; sampleRate?: number;
  // QMI8658
  aEn?: boolean; gEn?: boolean; autoInc?: boolean; bigEndian?: boolean;
  // LCD 16×2 (PCF8574 + HD44780)
  lcd?: CharLcdView; lcdWrites?: number; lcdChars?: number; lcdDropped?: number; lcdReads?: number;
  // BMP280 / BH1750
  bmpMode?: number; measurements?: number; bhOn?: boolean; bhMode?: string | null; bhValue?: number; bhReads?: number;
  // INA219
  inaRegs?: number[]; inaReads?: number;
  // CST816S
  inReset?: boolean; down?: boolean; x?: number; y?: number; gesture?: number; gestures?: number; touches?: number; touchReads?: number; irqCtl?: number; gestureLog?: number[];
}

export interface I2cLevels { v(net: number, ref: number): number | null }

interface Dev {
  spec: I2cSpec;
  targets: Array<{ t: I2cTarget; addr: () => number }>;
  oled?: Ssd1306; rtc?: Ds3231; mpu?: Mpu6050; qmi?: Qmi8658; lsm?: Lsm6dsox; tp?: Cst816s; lcd?: Lcd1602; bmp?: Bmp280; bh?: Bh1750; ina?: Ina219;
  /** CST816S: ขา RST ต่ำอยู่ (ไม่ตอบบัส) */
  inReset?: boolean;
  acks: number;
  conflicts: number;
  /** ธุรกรรมล่าสุดของอุปกรณ์นี้ชนกับอุปกรณ์อื่นที่อยู่เดียวกัน (แก้สายแล้วหายทันที) */
  lastConflict: boolean;
  key: string;
}

/** ธุรกรรมหนึ่งครั้ง (ส่งถึงเป้าหมายทุกตัวที่ตอบที่อยู่นี้) */
class Txn {
  constructor(readonly targets: I2cTarget[], readonly isRead: boolean, readonly log: number[]) {
    for (const t of targets) t.begin(isRead);
  }
  get ack() { return this.targets.length > 0; }
  write(b: number): boolean { this.log.push(b); let ack = false; for (const t of this.targets) ack = t.write(b) || ack; return ack; }
  read(): number { let v = 0xff; for (const t of this.targets) v &= t.read(); this.log.push(v); return v; }
  close() { for (const t of this.targets) t.end(); }
}

/** ตัวถอดรหัส I²C จากระดับขา (slave หลายตัวบนสายคู่เดียว) */
class SoftBus {
  sclHigh = true;
  sdaHigh = true;
  /** อุปกรณ์กำลังดึง SDA ลง */
  drive = false;
  private state: 'idle' | 'addr' | 'write' | 'read' | 'nack' = 'idle';
  private bits = 0;
  private decided = false;
  private byte = 0;
  private cur = 0;
  private ack = false;
  private rw = false;
  private masterAck = false;
  private txn: Txn | null = null;
  constructor(readonly sda: number, readonly scl: number, private hub: I2cHub, private boardGnd: () => number) {}

  /** ระดับสายใหม่ (หลังรวมผู้ดึงลงทุกตัว) */
  update(sclHigh: boolean, sdaMasterHigh: boolean) {
    const sdaHigh = sdaMasterHigh && !this.drive;
    if (sclHigh !== this.sclHigh) {
      // ขอบ SCL: SDA ระหว่างนี้คงที่
      this.sclHigh = sclHigh;
      this.sdaHigh = sdaHigh;
      if (sclHigh) this.rise(); else this.fall();
      return;
    }
    if (sdaHigh !== this.sdaHigh) {
      this.sdaHigh = sdaHigh;
      if (this.sclHigh && !this.drive) {
        if (!sdaHigh) this.start(); else this.stop();
      }
    }
  }

  private start() {
    this.txn?.close();
    this.txn = null;
    this.state = 'addr'; this.bits = 0; this.byte = 0; this.drive = false; this.decided = false;
  }

  private stop() {
    this.txn?.close();
    this.txn = null;
    this.state = 'idle'; this.drive = false;
  }

  /** ขอบขึ้นของ SCL: ผู้รับอ่านบิต (บิตที่ 1–8 = ข้อมูล, บิตที่ 9 = ACK) */
  private rise() {
    if (this.state === 'addr' || this.state === 'write') {
      if (this.bits < 8) this.byte = ((this.byte << 1) | (this.sdaHigh ? 1 : 0)) & 0xff;
      this.bits++;
    } else if (this.state === 'read') {
      if (this.bits === 8) this.masterAck = !this.sdaHigh;
      this.bits++;
    }
  }

  /** ขอบลงของ SCL: ผู้ส่งเปลี่ยนบิตถัดไป */
  private fall() {
    if (this.state === 'addr' || this.state === 'write') {
      if (this.bits === 8 && !this.decided) {
        // รับครบ 8 บิต: ตอบ ACK (ดึง SDA ลง) ตลอดคล็อกที่ 9
        if (this.state === 'addr') {
          this.rw = (this.byte & 1) === 1;
          this.txn = this.hub.open(this.byte >> 1, this.rw, this.sda, this.scl, this.boardGnd(), 'soft');
          this.ack = this.txn.ack;
        } else this.ack = this.txn ? this.txn.write(this.byte) : false;
        this.drive = this.ack;
        this.decided = true;
      } else if (this.bits >= 9) {
        this.drive = false; this.bits = 0; this.byte = 0; this.decided = false;
        if (!this.ack) { this.state = 'nack'; this.txn?.close(); this.txn = null; }
        else if (this.state === 'addr' && this.rw) { this.state = 'read'; this.cur = this.txn!.read(); this.drive = (this.cur & 0x80) === 0; }
        else if (this.state === 'addr') this.state = 'write';
      }
    } else if (this.state === 'read') {
      if (this.bits >= 1 && this.bits <= 7) this.drive = ((this.cur >> (7 - this.bits)) & 1) === 0;
      else if (this.bits === 8) this.drive = false; // ปล่อยสายให้ master ตอบ ACK/NACK
      else if (this.bits >= 9) {
        this.bits = 0;
        if (this.masterAck) { this.cur = this.txn!.read(); this.drive = (this.cur & 0x80) === 0; }
        else { this.state = 'nack'; this.drive = false; }
      }
    }
  }
}

export class I2cHub {
  private devs = new Map<string, Dev>();
  private soft = new Map<string, SoftBus>();
  levels: I2cLevels | null = null;
  /** ระดับลอจิกของเน็ตที่ขา MCU ขับ (null = ไม่มีขา MCU ขับ/ลอย) */
  drive: ((net: number) => boolean | null) | null = null;
  /** บันทึกธุรกรรมล่าสุด (ส่งให้หน้าเว็บแล้วล้าง) */
  log: string[] = [];
  constructor(private now: () => number) {}

  sync(specs: I2cSpec[]) {
    for (const id of [...this.devs.keys()]) if (!specs.some((s) => s.id === id)) this.devs.delete(id);
    for (const s of specs) {
      const key = `${s.dev}|${s.clock ?? ''}`;
      let d = this.devs.get(s.id);
      if (!d || d.key !== key) {
        d = { spec: s, targets: [], acks: 0, conflicts: 0, lastConflict: false, key };
        if (s.dev === 'ssd1306') { d.oled = new Ssd1306(this.now); d.targets.push({ t: d.oled, addr: () => d!.spec.addr }); }
        else if (s.dev === 'ds3231') {
          d.rtc = new Ds3231(this.now, parseClock(s.clock ?? ''));
          d.rtc.onChange = () => this.onOutputChange?.();
          const ee = new At24c32();
          d.targets.push({ t: d.rtc, addr: () => 0x68 }, { t: ee, addr: () => 0x57 });
        } else if (s.dev === 'cst816s') {
          d.tp = new Cst816s(this.now);
          d.targets.push({ t: d.tp, addr: () => (d!.inReset ? -1 : 0x15) });
        } else if (s.dev === 'lcd1602') {
          d.lcd = new Lcd1602(this.now);
          d.targets.push({ t: d.lcd, addr: () => d!.spec.addr });
        } else if (s.dev === 'bmp280') {
          d.bmp = new Bmp280(this.now);
          d.targets.push({ t: d.bmp, addr: () => this.pinAddr(d!, 0x76, 0x77) });
        } else if (s.dev === 'bh1750') {
          d.bh = new Bh1750(this.now);
          d.targets.push({ t: d.bh, addr: () => this.pinAddr(d!, 0x23, 0x5c) });
        } else if (s.dev === 'ina219') {
          d.ina = new Ina219(() => {
            const sp = d!.spec;
            const sh = sp.vinp !== undefined && sp.vinm !== undefined ? this.v(sp.vinp, sp.vinm) : null;
            const bus = sp.vinm !== undefined ? this.v(sp.vinm, sp.gnd) : null;
            return { shunt: sh ?? 0, bus: bus ?? 0 };
          }, this.now);
          d.targets.push({ t: d.ina, addr: () => d!.spec.addr });
        } else if (s.dev === 'lsm6dsox') {
          // IMU บนบอร์ด Nano RP2040 Connect: SDO/SA0 ต่อกราวด์บนบอร์ด → 0x6A
          d.lsm = new Lsm6dsox(this.now);
          d.lsm.motionStart = this.now();
          d.targets.push({ t: d.lsm, addr: () => 0x6a });
        } else if (s.dev === 'qmi8658') {
          d.qmi = new Qmi8658(this.now);
          d.qmi.motionStart = this.now();
          d.targets.push({ t: d.qmi, addr: () => this.qmiAddr(d!) });
        } else {
          d.mpu = new Mpu6050(this.now);
          d.mpu.motionStart = this.now();
          d.mpu.onChange = () => this.onOutputChange?.();
          d.targets.push({ t: d.mpu, addr: () => this.mpuAddr(d!) });
        }
        this.devs.set(s.id, d);
      }
      if (d.mpu && (d.mpu.motion !== (s.motion ?? 'still') || d.mpu.spm !== (s.spm ?? 100))) { d.mpu.motion = s.motion ?? 'still'; d.mpu.spm = s.spm ?? 100; d.mpu.motionStart = this.now(); }
      if (d.mpu) d.mpu.temperature = s.temperature ?? 25;
      if (d.qmi && (d.qmi.motion !== (s.motion ?? 'still') || d.qmi.spm !== (s.spm ?? 100))) { d.qmi.motion = s.motion ?? 'still'; d.qmi.spm = s.spm ?? 100; d.qmi.motionStart = this.now(); }
      if (d.qmi) d.qmi.temperature = s.temperature ?? 25;
      if (d.lsm && (d.lsm.motion !== (s.motion ?? 'still') || d.lsm.spm !== (s.spm ?? 100))) { d.lsm.motion = s.motion ?? 'still'; d.lsm.spm = s.spm ?? 100; d.lsm.motionStart = this.now(); }
      if (d.lsm) d.lsm.temperature = s.temperature ?? 25;
      if (d.bmp) { d.bmp.temperature = s.temperature ?? 25; d.bmp.pressure = s.pressure ?? 1013.25; }
      if (d.bh) { d.bh.lux = s.lux ?? 300; d.bh.sensitivity = s.sensitivity ?? 1.2; }
      if (d.rtc) d.rtc.temperature = s.temperature ?? 25;
      d.spec = s;
    }
  }

  reset() { this.devs.clear(); this.soft.clear(); this.log = []; }

  private v(net: number, ref: number) { return net < 0 || ref < 0 ? null : (this.levels?.v(net, ref) ?? null); }

  /** MPU6050: AD0 สูงกว่า VDD/2 → 0x69 (โมดูล GY-521 มีตัวต้านทานดึงลง AD0 อยู่แล้ว) */
  private mpuAddr(d: Dev) {
    const v = this.v(d.spec.ad0, d.spec.gnd), vcc = this.v(d.spec.vcc, d.spec.gnd) ?? 3.3;
    return v !== null && v > Math.min(3.3, vcc) / 2 ? 0x69 : 0x68;
  }

  /** QMI8658: SA0 ต่ำ → 0x6B, สูง/ลอย → 0x6A (โมดูลมีตัวต้านทานดึงขึ้น SA0) */
  /** ที่อยู่ตามขาเลือกที่อยู่ (ad0): ต่ำ → lo, สูง → hi (โมดูลมีตัวต้านทานดึงลงที่ขานี้) */
  private pinAddr(d: Dev, lo: number, hi: number) {
    const v = this.v(d.spec.ad0, d.spec.gnd), vcc = this.v(d.spec.vcc, d.spec.gnd) ?? 3.3;
    return v !== null && v > Math.min(3.3, vcc) / 2 ? hi : lo;
  }

  private qmiAddr(d: Dev) {
    const v = this.v(d.spec.ad0, d.spec.gnd), vcc = this.v(d.spec.vcc, d.spec.gnd) ?? 3.3;
    return v !== null && v < Math.min(3.3, vcc) / 2 ? 0x6b : 0x6a;
  }

  /* ---------- ทัชสกรีน (CST816S): ขา RST, ขา INT, เหตุการณ์สัมผัส ---------- */

  /** ตรวจขา RST ของชิปทัช: ต่ำ = รีเซ็ตค้าง (ไม่ตอบบัส, รีจิสเตอร์กลับค่าเริ่ม) · ลอย = สูง (ตัวต้านทานดึงขึ้นบนโมดูล) */
  checkResets() {
    for (const d of this.devs.values()) {
      if (!d.tp) continue;
      const lvl = d.spec.rst !== undefined && d.spec.rst >= 0 && this.drive ? this.drive(d.spec.rst) : null;
      const low = lvl === false;
      if (low && !d.inReset) d.tp.reset();
      d.inReset = low;
    }
  }

  /** ส่งเหตุการณ์สัมผัสถึงชิปทัชของชิ้นส่วน id */
  touch(id: string, events: TouchEvent[]) {
    const d = this.devs.get(id) ?? this.devs.get(`${id}#tp`);
    if (!d?.tp) return;
    for (const e of events) d.tp.touch(this.now(), e);
  }

  /** เดินเวลาเหตุการณ์ของอุปกรณ์ถึงเวลาปัจจุบัน */
  advance() { const t = this.now(); for (const d of this.devs.values()) { d.tp?.advance(t); d.rtc?.poll(); d.bmp?.poll(); d.ina?.poll(); } }

  /* ---------- ขาออก open-drain ของ DS3231 (INT/SQW, 32K) ---------- */

  /** เน็ตที่มีสิ่งอื่นต่ออยู่นอกจากตัวต้านทานดึงขึ้นบนโมดูล (ตั้งจาก co-simulation) — ขาที่ไม่มีใครต่อไม่ต้องหยุด CPU ทุกขอบ */
  netUsed: (net: number) => boolean = () => true;
  /** ขาออกของอุปกรณ์อาจเปลี่ยนจากธุรกรรม (ตั้งจาก co-simulation ให้หยุด CPU คำนวณวงจรใหม่) */
  onOutputChange?: () => void;
  /** ความต้านทานขณะดึงลง: VOL 0.4 V ที่ IOL 3 mA (ค่าสูงสุดในดาต้าชีต) */
  static readonly RON = 0.4 / 3e-3;

  private rtcPins(d: Dev, boardGnd: number) {
    if (!d.rtc || !this.powered(d, boardGnd)) return { sqw: false, k32: false };
    return { sqw: d.spec.sqw !== undefined && d.spec.sqw >= 0 && d.rtc.sqwLow(), k32: d.spec.k32 !== undefined && d.spec.k32 >= 0 && d.rtc.k32Low() };
  }

  /** ตัวต้านทานดึงลงของขาที่กำลังต่ำ (เพิ่มในวงจรที่คำนวณ) */
  elements(boardGnd: number): NetlistElement[] {
    const out: NetlistElement[] = [];
    for (const d of this.devs.values()) {
      if (!d.rtc) continue;
      const p = this.rtcPins(d, boardGnd);
      if (p.sqw) out.push({ type: 'R', id: `${d.spec.id}#sqwon`, role: 'module', a: d.spec.sqw!, b: d.spec.gnd, R: I2cHub.RON });
      if (p.k32) out.push({ type: 'R', id: `${d.spec.id}#k32on`, role: 'module', a: d.spec.k32!, b: d.spec.gnd, R: I2cHub.RON });
    }
    return out;
  }

  /** สถานะขาออกทั้งหมด (คีย์แคชคำตอบวงจร) */
  pinKey(boardGnd: number): string {
    let k = '';
    for (const d of this.devs.values()) if (d.rtc) { const p = this.rtcPins(d, boardGnd); k += (p.sqw ? 'Q' : 'q') + (p.k32 ? 'K' : 'k'); }
    return k;
  }

  /** ระดับที่อุปกรณ์ขับให้เน็ต (ขา INT ของชิปทัช) — null = อุปกรณ์ไม่ได้ขับเน็ตนี้ */
  driven(net: number, boardGnd: number): boolean | null {
    if (net < 0) return null;
    for (const d of this.devs.values()) {
      if (d.spec.int !== net) continue;
      if (d.mpu) { if (!this.powered(d, boardGnd)) return false; return d.mpu.intLevel(); }
      if (!d.tp) continue;
      if (!this.powered(d, boardGnd)) return false;
      if (d.inReset) return true;
      return !d.tp.intLow(this.now());
    }
    return null;
  }

  hasDriven(net: number): boolean { for (const d of this.devs.values()) if ((d.tp || d.mpu) && d.spec.int === net && net >= 0) return true; return false; }

  /** เวลา (s) ของเหตุการณ์ถัดไปที่ต้องหยุด CPU (ขอบ INT, การสัมผัสที่ตั้งเวลาไว้) */
  nextEvent(): number {
    const t = this.now();
    let n = Infinity;
    for (const d of this.devs.values()) {
      if (d.tp) n = Math.min(n, d.tp.nextEvent(t));
      if (d.mpu && d.spec.int !== undefined && d.spec.int >= 0 && this.netUsed(d.spec.int)) n = Math.min(n, d.mpu.nextEvent());
      if (d.rtc) n = Math.min(n, d.rtc.nextEdge(d.spec.sqw !== undefined && d.spec.sqw >= 0 && this.netUsed(d.spec.sqw), d.spec.k32 !== undefined && d.spec.k32 >= 0 && this.netUsed(d.spec.k32)));
    }
    return n;
  }

  powered(d: Dev, boardGnd: number): boolean {
    const vcc = this.v(d.spec.vcc, d.spec.gnd);
    if (vcc === null || vcc < d.spec.vMin || vcc > d.spec.vMax + 0.5) return false;
    const g = this.v(d.spec.gnd, boardGnd);
    return g !== null && Math.abs(g) < 0.4;
  }

  /** เปิดธุรกรรมกับอุปกรณ์ที่ต่อกับสายคู่นี้และตอบที่อยู่นี้ */
  open(addr: number, read: boolean, sda: number, scl: number, boardGnd: number, via: 'hw' | 'soft'): Txn {
    const hit: Array<{ d: Dev; t: I2cTarget }> = [];
    for (const d of this.devs.values()) {
      if (d.spec.sda !== sda || d.spec.scl !== scl || !this.powered(d, boardGnd)) continue;
      for (const x of d.targets) if (x.addr() === addr) hit.push({ d, t: x.t });
    }
    for (const h of hit) { h.d.acks++; h.d.lastConflict = hit.length > 1; if (hit.length > 1) h.d.conflicts++; }
    const bytes: number[] = [];
    const txn = new Txn(hit.map((h) => h.t), read, bytes);
    const tag = `${via === 'soft' ? 'S' : ''}${read ? 'R' : 'W'} 0x${addr.toString(16).padStart(2, '0')}`;
    const origClose = txn.close.bind(txn);
    txn.close = () => {
      origClose();
      const hex = bytes.slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(' ') + (bytes.length > 12 ? ` …(${bytes.length})` : '');
      this.push(`${tag} ${txn.ack ? (hit.length > 1 ? 'ACK×' + hit.length + ' (ที่อยู่ซ้ำ)' : 'ACK') : 'NACK'}${bytes.length ? ' [' + hex + ']' : ''}`);
    };
    return txn;
  }

  private push(line: string) {
    // สแกนบัส (NACK ต่อเนื่องหลายที่อยู่) ย่อเป็นบรรทัดเดียว
    const last = this.log[this.log.length - 1];
    const m = /^(S?W) 0x([0-9a-f]{2}) NACK$/.exec(line), lm = last && /^(S?W) 0x([0-9a-f]{2})(?:–0x([0-9a-f]{2}))? NACK$/.exec(last);
    if (m && lm && m[1] === lm[1]) { this.log[this.log.length - 1] = `${lm[1]} 0x${lm[2]}–0x${m[2]} NACK`; return; }
    this.log.push(line);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  takeLog(): string[] { const l = this.log; this.log = []; return l; }

  /* ---------- soft I²C ---------- */

  /** คู่สาย SDA/SCL ที่มีอุปกรณ์ต่ออยู่ */
  busPairs(): Array<[number, number]> {
    const m = new Map<string, [number, number]>();
    for (const d of this.devs.values()) if (d.spec.sda >= 0 && d.spec.scl >= 0) m.set(`${d.spec.sda}/${d.spec.scl}`, [d.spec.sda, d.spec.scl]);
    return [...m.values()];
  }

  /** อัปเดตตัวถอดรหัสระดับขา: low(net) = มีขา MCU ดึงสายนี้ลง */
  pinLevels(low: (net: number) => boolean, boardGnd: () => number) {
    for (const [sda, scl] of this.busPairs()) {
      const k = `${sda}/${scl}`;
      let b = this.soft.get(k);
      if (!b) { b = new SoftBus(sda, scl, this, boardGnd); this.soft.set(k, b); }
      b.update(!low(scl), !low(sda));
    }
  }

  /** อุปกรณ์กำลังดึงเน็ตนี้ลง (ACK/บิตข้อมูล 0) */
  pulledLow(net: number): boolean {
    for (const b of this.soft.values()) if (b.drive && b.sda === net) return true;
    return false;
  }

  /** สาย I²C สูงได้ไหม: มีโมดูลที่มีไฟเลี้ยงต่ออยู่ (ตัวต้านทานดึงขึ้นบนโมดูลไปยัง VCC ของโมดูล) */
  lineHasPullUp(net: number, boardGnd: number): boolean {
    for (const d of this.devs.values()) if ((d.spec.sda === net || d.spec.scl === net) && this.powered(d, boardGnd)) return true;
    return false;
  }

  hasBusOn(net: number): boolean {
    for (const d of this.devs.values()) if (d.spec.sda === net || d.spec.scl === net) return true;
    return false;
  }

  /* ---------- ส่งออก ---------- */

  snapshot(boardGnd: number): Record<string, I2cDevState> {
    const out: Record<string, I2cDevState> = {};
    for (const [id, d] of this.devs) {
      const st: I2cDevState = { dev: d.spec.dev, powered: this.powered(d, boardGnd), acks: d.acks, addr: d.targets[0].addr(), conflicts: d.lastConflict ? 1 : 0, conflictsTotal: d.conflicts };
      if (d.oled) {
        d.oled.advanceScroll();
        const s = d.oled.s;
        let bin = '';
        for (let i = 0; i < s.ram.length; i++) bin += String.fromCharCode(s.ram[i]);
        Object.assign(st, { ram: btoa(bin), on: s.on, pump: s.pump, contrast: s.contrast, invert: s.invert, allOn: s.allOn, segRemap: s.segRemap, comRev: s.comRev, startLine: s.startLine, offset: s.offset, mux: s.mux, vTop: s.vTop, vRows: s.vRows, vScroll: s.vScroll, scrolling: d.oled.scrolling, dataBytes: d.oled.dataBytes });
        // จอดับเมื่อไม่มีไฟเลี้ยง (GDDRAM หายเมื่อไฟดับ)
        if (!st.powered) { st.on = false; }
      }
      if (d.rtc) Object.assign(st, { clock: d.rtc.clock(), timeReads: d.rtc.timeReads, tempReads: d.rtc.tempReads, timeWrites: d.rtc.timeWrites, rtcFlags: d.rtc.flags, rtcControl: d.rtc.control, sqwLow: this.rtcPins(d, boardGnd).sqw, alarms1: d.rtc.alarms1, alarms2: d.rtc.alarms2 });
      if (d.lcd) Object.assign(st, { lcd: charLcdView(d.lcd), lcdWrites: d.lcd.writes, lcdChars: d.lcd.chars, lcdDropped: d.lcd.dropped, lcdReads: d.lcd.reads });
      if (d.bmp) Object.assign(st, { bmpMode: d.bmp.mode, measurements: d.bmp.measurements, dataReads: d.bmp.dataReads });
      if (d.bh) Object.assign(st, { bhOn: d.bh.on, bhMode: d.bh.mode, bhValue: d.bh.value, bhReads: d.bh.reads });
      if (d.ina) Object.assign(st, { inaRegs: [...d.ina.regs], inaReads: d.ina.reads });
      if (d.lsm) Object.assign(st, { aEn: d.lsm.aOn, gEn: d.lsm.gOn, autoInc: d.lsm.autoInc, dataReads: d.lsm.dataReads, motion: d.lsm.motion });
      if (d.qmi) Object.assign(st, { aEn: d.qmi.aEn, gEn: d.qmi.gEn, autoInc: d.qmi.autoInc, bigEndian: d.qmi.bigEndian, steps: d.qmi.steps(), dataReads: d.qmi.dataReads, motion: d.qmi.motion });
      if (d.tp) Object.assign(st, { addr: 0x15, inReset: !!d.inReset, down: d.tp.down, x: d.tp.x, y: d.tp.y, gesture: d.tp.gesture, gestures: d.tp.gestures, touches: d.tp.touches, touchReads: d.tp.reads, irqCtl: d.tp.irqCtl, gestureLog: [...d.tp.gestureLog] });
      if (d.mpu) { d.mpu.poll(); Object.assign(st, { asleep: d.mpu.asleep, steps: d.mpu.motion === 'walk' ? trueSteps(this.now() - d.mpu.motionStart, d.mpu.spm) : 0, dataReads: d.mpu.dataReads, motion: d.mpu.motion, fifoCount: d.mpu.fifo.length, mpuSamples: d.mpu.samples, mpuOverflows: d.mpu.overflows, sampleRate: d.mpu.sampleRate() }); }
      out[id] = st;
    }
    return out;
  }

  /** ไฟเลี้ยงหายระหว่างจำลอง → อุปกรณ์รีเซ็ต (GDDRAM/รีจิสเตอร์หาย; DS3231 มีแบตสำรองบนโมดูล — เวลาเดินต่อ) */
  powerCheck(boardGnd: number) {
    for (const d of this.devs.values()) {
      const p = this.powered(d, boardGnd);
      const was = (d as Dev & { wasPowered?: boolean }).wasPowered;
      if (was && !p) {
        if (d.oled) { const o = new Ssd1306(this.now); d.oled.s = o.s; d.oled.scrolling = false; }
        if (d.mpu) d.mpu.reset();
        if (d.qmi) d.qmi.reset();
        if (d.lsm) d.lsm.reset();
        if (d.lcd) d.lcd.reset();
        if (d.bmp) d.bmp.reset();
        if (d.bh) d.bh.reset();
        if (d.ina) d.ina.reset();
        if (d.tp) d.tp.reset();
      }
      if (d.rtc && was !== undefined) d.rtc.setPowered(p);
      if (d.lcd && was === false && p) d.lcd.powerUp();
      (d as Dev & { wasPowered?: boolean }).wasPowered = p;
    }
  }
}

export { oledPixels };

/** พิกเซลที่ตามองเห็นจากสถานะจอที่ส่งออก */
export function screenPixels(s: I2cDevState): Uint8Array | null {
  if (!s.ram) return null;
  const ram = Uint8Array.from(atob(s.ram), (c) => c.charCodeAt(0));
  return oledPixels({ ram, on: !!s.on, pump: !!s.pump, invert: !!s.invert, allOn: !!s.allOn, segRemap: !!s.segRemap, comRev: !!s.comRev, startLine: s.startLine ?? 0, offset: s.offset ?? 0, mux: s.mux ?? 63, vTop: s.vTop ?? 0, vRows: s.vRows ?? 64, vScroll: s.vScroll ?? 0 });
}

/**
 * ข้อความที่อ่านได้บนจอ OLED (ฟอนต์ 8×8 ของ framebuf) จากหน่วยความจำจอที่จำลอง — ใช้ทั้งแผงผลและตัวตรวจแลป
 * จอที่กลับสี (0xA7) ยังอ่านข้อความเดิมได้ (ตัวอักษรดำบนพื้นสว่าง) จึงอ่านจากพิกเซลก่อนกลับสี
 */
export function screenText(s: I2cDevState | undefined): string[] {
  const px = s ? screenPixels({ ...s, invert: false }) : null;
  return px ? oledText(px).map((l) => l.text) : [];
}
