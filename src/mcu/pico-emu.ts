import type { McuTraceEvent } from '../instruments/logic';
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
  /** watchdog หมดเวลา / machine.reset(): CPU หยุด (ขาเป็นขาเข้า) รอ cosim สร้างตัวจำลองใหม่ (บูตใหม่) ในคำขอถัดไป */
  rebootPending = false;

  /** bg: ข้อมูลแทนไฟล์ bg.bin (240×240 RGB565 ไบต์สูงก่อน) + ตำแหน่งในอิมเมจ — เหมือนคัดลอกรูปของผู้ใช้ลงบอร์ด */
  constructor(firmware: Uint8Array, lfsBlocks: Uint8Array, bg?: { data: Uint8Array; segments: Array<[number, number, number]> }, opts: { startNs?: number; flash?: Uint8Array } = {}) {
    const { mcu } = this;
    // เวลาเริ่มของบอร์ด = เวลาวงจรปัจจุบัน (บอร์ดที่บูตใหม่ระหว่างจำลองไม่ย้อนเวลา)
    if (opts.startNs) (this.clock as unknown as { nanosCounter: number }).nanosCounter = opts.startNs;
    mcu.loadBootrom(bootromB1);
    mcu.flash.fill(0xff);
    mcu.flash.set(firmware, 0);
    // ระบบไฟล์ LittleFS ที่ฟอร์แมตแล้วพร้อมไลบรารี ssd1306.py (ตัวจำลองไม่รองรับการเขียนแฟลชผ่าน SSI จึงเตรียมไว้ล่วงหน้า — scripts/make-lfs.py)
    for (let o = 0; o + 4100 <= lfsBlocks.length; o += 4100) {
      const blk = lfsBlocks[o] | (lfsBlocks[o + 1] << 8) | (lfsBlocks[o + 2] << 16) | (lfsBlocks[o + 3] << 24);
      if (blk >= 0 && (blk + 1) * 4096 <= FLASH_FS_BYTES) mcu.flash.set(lfsBlocks.subarray(o + 4, o + 4100), FLASH_FS_START + blk * 4096);
    }
    // บูตใหม่ (watchdog/machine.reset): แฟลชเดิมทั้งก้อน (รวมไฟล์ที่โปรแกรมเขียนไว้)
    if (opts.flash) mcu.flash.set(opts.flash);
    if (bg && !opts.flash) for (const [k, p, n] of bg.segments) if (k + n <= bg.data.length) mcu.flash.set(bg.data.subarray(k, k + n), FLASH_FS_START + p);
    const uart = mcu.uart[0] as unknown as { checkInterrupts: () => void; rp2040: { setInterrupt(irq: number, v: boolean): void }; irq: number; interruptStatus: number; interruptMask: number };
    // rp2040js ตั้งบิต TX interrupt ทุกครั้งที่ตรวจ ทำให้เกิด interrupt ซ้ำไม่รู้จบเมื่อเฟิร์มแวร์เปิดทุก mask
    // ฮาร์ดแวร์จริง (PL011) TX interrupt เกิดเมื่อระดับ FIFO ข้ามเกณฑ์เท่านั้น — REPL ส่งแบบ polling จึงไม่ต้องใช้
    uart.checkInterrupts = function (this: typeof uart) {
      this.rp2040.setInterrupt(this.irq, !!(this.interruptStatus & this.interruptMask));
    };
    // I²C (DW_apb_i2c): TX_EMPTY ของจริงขึ้นตามระดับ FIFO — หลัง abort (เช่น ที่อยู่ไม่มีอุปกรณ์ตอบ NACK) FIFO ถูกล้างจนว่าง บิตจึงขึ้นทันที
    // rp2040js ตั้งบิตนี้เฉพาะตอนดึงคำสั่งจาก FIFO ทำให้ pico-sdk (i2c_write_blocking) รอ TX_EMPTY ไม่สิ้นสุดจนหมดเวลา (ETIMEDOUT แทน EIO)
    // และค่า abort ค้างทำให้ธุรกรรมถัดไปล้มด้วย → ตั้ง TX_EMPTY เมื่อ abort
    for (const p of mcu.i2c) {
      const q = p as unknown as { abort(r: number): void; setInterrupts(m: number): void };
      const orig = q.abort.bind(q);
      q.abort = (reason: number) => { orig(reason); q.setInterrupts(1 << 4); };
    }
    // ถอดรหัส UTF-8 แบบต่อเนื่อง (ข้อความภาษาไทยที่ print ออกมาเป็นหลายไบต์ต่ออักษร — เดิมแสดงเป็นอักขระเพี้ยน)
    const dec = new TextDecoder('utf-8');
    mcu.uart[0].onByte = (b: number) => { this.serialOut += dec.decode(new Uint8Array([b]), { stream: true }); this.frame('tx', b); };
    mcu.gpio.forEach((g, i) => g.addListener(() => { if (!this.quietPins.has(i)) this.pinDirty = true; if (this.onTrace) this.traceOut(i); }));
    // watchdog (machine.WDT หมดเวลา และ machine.reset()): rp2040js ไม่มีตัวรีเซ็ตให้ (ค่าเริ่มต้นแค่เขียน log ซ้ำทุกรอบจนหน่วยความจำเต็ม)
    // → หยุด CPU ทันที แล้ว cosim บูตบอร์ดใหม่จากแฟลชเดิม
    const wd = (mcu as unknown as { peripherals: Record<number, { onWatchdogTrigger: () => void; alarm: { enable: boolean }; timer: { enable: boolean } }> }).peripherals[0x40058];
    wd.onWatchdogTrigger = () => { this.rebootPending = true; wd.alarm.enable = false; wd.timer.enable = false; this.pinDirty = true; };
    mcu.core.PC = 0x10000000;
  }

  get nanos(): number { return this.clock.nanos; }
  get seconds(): number { return this.clock.nanos / 1e9; }

  /** ขาภายในบอร์ดที่เปลี่ยนเร็วมาก (ข้อมูล NeoPixel) และไม่ได้ต่อกับวงจร — ไม่ต้องหยุด CPU ทุกขอบ */
  private quietPins = new Set<number>();
  private ws: { pin: number; power: number; hi: boolean; tRise: number; tFall: number; bits: number; nbits: number; pending: number | null; color: number | null } | null = null;
  /**
   * NeoPixel (WS2812B) หนึ่งดวงบนบอร์ดที่ขา pin รับไฟผ่านขา power (HIGH = มีไฟ) — ถอดรหัสจากเวลาขอบสัญญาณจริงของขา:
   * HIGH สั้น (T0H 0.4 µs) = 0, HIGH ยาว (T1H 0.85 µs) = 1 แยกที่ 0.6 µs · 24 บิตแรก (เรียง G R B บิตสูงก่อน) เป็นของดวงนี้ ที่เหลือส่งต่อ
   * · สีใหม่แสดงเมื่อสายเป็น LOW นานกว่าเวลารีเซ็ต (> 50 µs) · ไม่มีไฟ = ดับและลืมข้อมูล
   */
  enableWs2812(pin: number, power: number) {
    this.quietPins.add(pin);
    const st = this.ws = { pin, power, hi: false as boolean, tRise: 0, tFall: 0, bits: 0, nbits: 0, pending: null as number | null, color: null as number | null };
    const powered = () => this.pinMode(power) === 'out-high';
    this.mcu.gpio[power].addListener(() => { if (!powered()) { st.color = null; st.pending = null; st.nbits = 0; } });
    this.mcu.gpio[pin].addListener(() => {
      const hi = this.pinMode(pin) === 'out-high', t = this.clock.nanos;
      if (hi === st.hi) return;
      st.hi = hi;
      if (hi) { this.wsLatch(t); st.tRise = t; return; }
      st.tFall = t;
      if (!powered()) return;
      if (st.nbits < 24) {
        st.bits = (st.bits << 1) | (t - st.tRise > WS_BIT_NS ? 1 : 0);
        if (++st.nbits === 24) st.pending = st.bits;
      }
    });
  }
  private wsLatch(t: number) {
    const st = this.ws;
    if (!st || st.hi || t - st.tFall <= WS_RESET_NS) return;
    if (st.pending !== null) st.color = st.pending;
    st.pending = null; st.nbits = 0; st.bits = 0;
  }
  /** สีที่ NeoPixel แสดงอยู่ [R, G, B] 0–255 (null = ไม่มีไฟหรือยังไม่เคยรับข้อมูล = ดับ) และสถานะไฟเลี้ยง */
  ws2812(): { powered: boolean; rgb: [number, number, number] | null } | null {
    const st = this.ws;
    if (!st) return null;
    this.wsLatch(this.clock.nanos);
    const powered = this.pinMode(st.power) === 'out-high';
    const c = powered ? st.color : null;
    return { powered, rgb: c === null ? null : [(c >> 8) & 0xff, (c >> 16) & 0xff, c & 0xff] };
  }

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

  /** เหตุการณ์สำหรับเครื่องวิเคราะห์ลอจิก (ตั้งเฉพาะเมื่อมีเครื่องวิเคราะห์ในวงจร) */
  onTrace: ((e: McuTraceEvent) => void) | null = null;
  private lastOut: Array<boolean | null> = new Array(30).fill(null);
  private traceOut(i: number) {
    const m = this.pinMode(i);
    const o = m === 'out-high' ? true : m === 'out-low' ? false : null;
    if (o !== this.lastOut[i]) { this.lastOut[i] = o; this.onTrace?.({ kind: 'pin', i, high: o, tNs: this.clock.nanos }); }
  }
  /** ระดับขาเอาต์พุตปัจจุบันทุกขา (ส่งให้เครื่องวิเคราะห์ตอนเริ่ม) */
  traceAll() { for (let i = 0; i < 30; i++) this.traceOut(i); }
  private frame(kind: 'tx' | 'rx', byte: number) {
    if (!this.onTrace) return;
    // เวลาบิตจากตัวหารบอดเรตของ PL011 (clk_peri / (16 · divider)) แบบเดียวกับชิปจริง
    const u = this.mcu.uart[0] as unknown as { baudDivider: number; wordLength: number };
    const clk = (this.mcu as unknown as { clkPeri: number }).clkPeri;
    const bitNs = u.baudDivider && clk ? (1e9 * 16 * u.baudDivider) / clk : 1e9 / 115200;
    this.onTrace({ kind, byte, tNs: this.clock.nanos, bitNs, bits: u.wordLength || 8, parity: 0, stop: 1 });
  }

  pinMode(i: number): PinMode {
    if (this.rebootPending) return 'in';
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
  /** อุปกรณ์ภายนอกเปลี่ยนระดับขาออกของตัวเองจากธุรกรรมบนบัส (เช่น ล้างแฟล็กปลุกของ DS3231 → ขา INT ขึ้น): หยุด CPU ให้คำนวณวงจรใหม่ */
  poke() { this.pinDirty = true; }

  run(targetNs: number, deadline: number, stopOnPin = true): 'target' | 'pin' | 'deadline' {
    const { mcu, clock } = this;
    const core = mcu.core;
    const uart = mcu.uart[0] as unknown as { rxFIFO: { full: boolean } };
    this.pinDirty = false;
    let n = 0;
    while (clock.nanos < targetNs) {
      if (this.rebootPending) {
        // CPU อยู่ในสถานะรีเซ็ต: ไม่ประมวลผลคำสั่ง เวลาเดินต่อ
        clock.tick(targetNs - clock.nanos);
        if (stopOnPin && this.pinDirty) { this.pinDirty = false; return 'pin'; }
        break;
      }
      // ส่งเข้าขา RX ตามจังหวะ 115200 baud (87 µs/ไบต์) — ถ้าส่งรวดเดียว บัฟเฟอร์รับของ MicroPython ล้นระหว่างที่ยังพิมพ์ข้อความ
      // ของ raw REPL อยู่ ไบต์ตกหาย และโปรแกรมยาวกว่า ~500 ไบต์ไม่ทำงาน (ไม่มีข้อความแจ้ง)
      if (this.rx.length && !uart.rxFIFO.full && clock.nanos >= this.rxNextNs) { const b = this.rx.shift()!; this.frame('rx', b); mcu.uart[0].feedByte(b); this.rxNextNs = clock.nanos + RX_BYTE_NS; }
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

/** WS2812B (datasheet Worldsemi): T0H 0.4 µs ±150 ns, T1H 0.85 µs ±150 ns → แยกบิตที่ HIGH 0.6 µs · RES = LOW นานกว่า 50 µs */
const WS_BIT_NS = 600, WS_RESET_NS = 50_000;

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
  private errText = '';

  /** เริ่มส่งโปรแกรมใหม่ */
  start() { this.mode = 'raw-wait'; this.buf = ''; this.hadError = false; this.errText = ''; }

  get running() { return this.mode === 'raw-wait' || this.mode === 'stdout' || this.mode === 'stderr'; }

  /** คืนข้อความที่แสดงได้ และ finished เมื่อโปรแกรมเพิ่งจบในข้อมูลชุดนี้ */
  feed(s: string): { text: string; finished: null | { ok: boolean; error?: string } } {
    let text = '';
    let finished: null | { ok: boolean; error?: string } = null;
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
            else { this.mode = 'exit'; this.buf = ''; finished = this.hadError ? { ok: false, error: this.errText } : { ok: true }; }
          } else {
            if (this.mode === 'stderr') { this.hadError = true; if (this.errText.length < 4000) this.errText += ch; }
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

