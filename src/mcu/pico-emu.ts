import { GPIOPinState, Simulator } from 'rp2040js';
import { bootromB1 } from './bootrom';

/**
 * ตัวจำลอง Raspberry Pi Pico (RP2040) — ใช้ rp2040js (MIT) ประมวลผลคำสั่ง ARM Cortex-M0+ จริงทีละคำสั่ง
 * เฟิร์มแวร์: MicroPython v1.24.1 ที่ build จากซอร์ส (บอร์ด CIRCUITLAB_PICO: REPL ทาง UART0, ปิด USB) — ดู firmware/README.md
 *
 * เวลา: นาฬิกาจำลองของ rp2040js (CPU 125 MHz, 1 คำสั่ง ≈ 8 ns × จำนวน cycle) คือ "เวลาของวงจร"
 *  เมื่อ CPU รอ (WFE/WFI) นาฬิกากระโดดไปยังเหตุการณ์ถัดไปทันที จึงเร็วกว่าเวลาจริงได้
 *  เมื่อ CPU ทำงานหนัก การจำลองอาจช้ากว่าเวลาจริง (แจ้งใน UI) แต่ลำดับเหตุการณ์และเวลาภายในยังถูกต้อง
 */

export const CPU_HZ = 125_000_000;
const CYCLE_NS = 1e9 / CPU_HZ;
const FLASH_FS_START = 0xa0000;
const FLASH_FS_BYTES = 1408 * 1024;

export type PinMode = 'out-high' | 'out-low' | 'in' | 'in-pullup' | 'in-pulldown' | 'in-keeper';

export function decodeB64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  throw new Error('ไม่มี atob สำหรับถอดรหัสเฟิร์มแวร์');
}

interface ClockLike { nanos: number; nanosToNextAlarm: number; tick(n: number): void }

export class PicoEmulator {
  readonly sim = new Simulator();
  readonly mcu = this.sim.rp2040;
  private clock = this.sim.clock as unknown as ClockLike;
  private rx: number[] = [];
  private pinDirty = false;
  serialOut = '';
  instructions = 0;

  constructor(firmware: Uint8Array, lfsHead: Uint8Array) {
    const { mcu } = this;
    mcu.loadBootrom(bootromB1);
    mcu.flash.fill(0xff);
    mcu.flash.set(firmware, 0);
    // ระบบไฟล์ LittleFS ว่าง (ตัวจำลองไม่รองรับการเขียนแฟลชผ่าน SSI จึงเตรียมไว้ล่วงหน้า ไม่ให้เฟิร์มแวร์ต้องฟอร์แมตเอง)
    mcu.flash.set(lfsHead.subarray(0, Math.min(lfsHead.length, FLASH_FS_BYTES)), FLASH_FS_START);
    const uart = mcu.uart[0] as unknown as { checkInterrupts: () => void; rp2040: { setInterrupt(irq: number, v: boolean): void }; irq: number; interruptStatus: number; interruptMask: number };
    // rp2040js ตั้งบิต TX interrupt ทุกครั้งที่ตรวจ ทำให้เกิด interrupt ซ้ำไม่รู้จบเมื่อเฟิร์มแวร์เปิดทุก mask
    // ฮาร์ดแวร์จริง (PL011) TX interrupt เกิดเมื่อระดับ FIFO ข้ามเกณฑ์เท่านั้น — REPL ส่งแบบ polling จึงไม่ต้องใช้
    uart.checkInterrupts = function (this: typeof uart) {
      this.rp2040.setInterrupt(this.irq, !!(this.interruptStatus & this.interruptMask));
    };
    // ถอดรหัส UTF-8 แบบต่อเนื่อง (ข้อความภาษาไทยที่ print ออกมาเป็นหลายไบต์ต่ออักษร — เดิมแสดงเป็นอักขระเพี้ยน)
    const dec = new TextDecoder('utf-8');
    mcu.uart[0].onByte = (b: number) => { this.serialOut += dec.decode(new Uint8Array([b]), { stream: true }); };
    for (const g of mcu.gpio) g.addListener(() => { this.pinDirty = true; });
    mcu.core.PC = 0x10000000;
  }

  get nanos(): number { return this.clock.nanos; }
  get seconds(): number { return this.clock.nanos / 1e9; }

  /** ข้อมูลเข้า REPL (ป้อนทีละไบต์เมื่อ FIFO ว่าง เหมือนสาย UART จริงที่ไม่ล้น) */
  private rxNextNs = 0;
  sendSerial(bytes: number[] | string) {
    for (const b of typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0) & 0xff) : bytes) this.rx.push(b & 0xff);
  }

  takeSerial(): string {
    const s = this.serialOut;
    this.serialOut = '';
    return s;
  }

  pinMode(i: number): PinMode {
    switch (this.mcu.gpio[i].value) {
      case GPIOPinState.High: return 'out-high';
      case GPIOPinState.Low: return 'out-low';
      case GPIOPinState.InputPullUp: return 'in-pullup';
      case GPIOPinState.InputPullDown: return 'in-pulldown';
      case GPIOPinState.InputBusKeeper: return 'in-keeper';
      default: return 'in';
    }
  }

  setInput(i: number, high: boolean) {
    const g = this.mcu.gpio[i] as unknown as { rawInputValue: boolean; setInputValue(v: boolean): void };
    if (g.rawInputValue !== high) g.setInputValue(high);
  }

  /** ADC ช่อง 0–3 = GP26–GP29, แรงดันเทียบ GND (อ้างอิง 3.3 V, 12 บิต) */
  setAdc(ch: number, volts: number) {
    this.mcu.adc.channelValues[ch] = Math.max(0, Math.min(4095, Math.round((volts / 3.3) * 4095)));
  }

  /**
   * เดินเวลา CPU จนถึง targetNs หรือจนกว่าสถานะขา GPIO เปลี่ยน (คืน 'pin') หรือหมดงบเวลาจริง (คืน 'deadline')
   * stopOnPin = false ใช้ตอนไม่มีวงจรภายนอกต่อกับขา
   */
  run(targetNs: number, deadline: number, stopOnPin = true): 'target' | 'pin' | 'deadline' {
    const { mcu, clock } = this;
    const core = mcu.core;
    const uart = mcu.uart[0] as unknown as { rxFIFO: { full: boolean } };
    this.pinDirty = false;
    let n = 0;
    while (clock.nanos < targetNs) {
      // ส่งเข้าขา RX ตามจังหวะ 115200 baud (87 µs/ไบต์) — ถ้าส่งรวดเดียว บัฟเฟอร์รับของ MicroPython ล้นระหว่างที่ยังพิมพ์ข้อความ
      // ของ raw REPL อยู่ ไบต์ตกหาย และโปรแกรมยาวกว่า ~500 ไบต์ไม่ทำงาน (ไม่มีข้อความแจ้ง)
      if (this.rx.length && !uart.rxFIFO.full && clock.nanos >= this.rxNextNs) { mcu.uart[0].feedByte(this.rx.shift()!); this.rxNextNs = clock.nanos + RX_BYTE_NS; }
      if (core.waiting) {
        const next = clock.nanosToNextAlarm;
        let room = targetNs - clock.nanos;
        if (this.rx.length) room = Math.min(room, Math.max(1, this.rxNextNs - clock.nanos));
        clock.tick(next > 0 ? Math.min(next, room) : Math.min(room, 1000));
      } else {
        clock.tick(core.executeInstruction() * CYCLE_NS);
        this.instructions++;
      }
      if (stopOnPin && this.pinDirty) return 'pin';
      if ((++n & 0x3fff) === 0 && now() > deadline) return 'deadline';
    }
    return 'target';
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** ห่อโค้ดของผู้ใช้เป็นลำดับไบต์ของ raw REPL: Ctrl-C ×2 (หยุดโปรแกรมเดิม), Ctrl-A (raw), โค้ด, Ctrl-D (รัน) */
/** เวลาต่อหนึ่งไบต์ของ UART 115200 baud แบบ 8N1 (10 บิต) */
const RX_BYTE_NS = 86_806;

export function rawRunBytes(code: string): number[] {
  const enc = new TextEncoder().encode(code.replace(/\r\n?/g, '\n'));
  return [3, 3, 1, ...enc, 4];
}

/**
 * แปลงข้อความจาก raw REPL ให้อ่านง่าย: ตัดข้อความ "raw REPL; CTRL-B to exit", "OK", ตัวคั่น \x04 และพรอมต์ของ raw REPL
 * เมื่อโปรแกรมจบ (หรือถูกหยุด) ผู้เรียกต้องส่ง Ctrl-B กลับสู่ REPL ปกติ — ข้อความต้อนรับที่พิมพ์ซ้ำจะถูกซ่อนจนถึงพรอมต์ ">>> "
 */
export class RawReplFilter {
  private mode: 'friendly' | 'raw-wait' | 'stdout' | 'stderr' | 'exit' = 'friendly';
  private buf = '';
  private hadError = false;

  /** เริ่มส่งโปรแกรมใหม่ */
  start() { this.mode = 'raw-wait'; this.buf = ''; this.hadError = false; }

  get running() { return this.mode === 'raw-wait' || this.mode === 'stdout' || this.mode === 'stderr'; }

  /** คืนข้อความที่แสดงได้ และ finished เมื่อโปรแกรมเพิ่งจบในข้อมูลชุดนี้ */
  feed(s: string): { text: string; finished: null | { ok: boolean } } {
    let text = '';
    let finished: null | { ok: boolean } = null;
    for (const ch of s) {
      switch (this.mode) {
        case 'friendly': text += ch; break;
        case 'raw-wait':
          this.buf += ch;
          if (this.buf.endsWith('>OK')) { this.mode = 'stdout'; this.buf = ''; }
          else if (this.buf.length > 2000) this.buf = this.buf.slice(-100);
          break;
        case 'stdout':
        case 'stderr':
          if (ch === '\x04') {
            if (this.mode === 'stdout') this.mode = 'stderr';
            else { this.mode = 'exit'; this.buf = ''; finished = { ok: !this.hadError }; }
          } else {
            if (this.mode === 'stderr') this.hadError = true;
            text += ch;
          }
          break;
        case 'exit':
          this.buf += ch;
          if (this.buf.endsWith('>>> ')) { this.mode = 'friendly'; this.buf = ''; text += '>>> '; }
          else if (this.buf.length > 2000) this.buf = this.buf.slice(-100);
          break;
      }
    }
    return { text, finished };
  }
}
