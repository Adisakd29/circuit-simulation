import type { McuTraceEvent } from '../instruments/logic';
import { ATtinyTimer1, attinyTimer1Config, AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRSPI, AVRTWI, AVRTimer, AVRUSART, AVRWatchdog, CPU, EEPROMMemoryBackend, type TWIEventHandler, PinState, avrInstruction, clockConfig } from 'avr8js';
import type { PinMode } from './pico-emu';
import { AVR_328P, type AvrChip } from './avr-chips';
export { AVR_328P, AVR_2560, AVR_TINY85, avrChipOf, avrClockOf, type AvrChip } from './avr-chips';

/**
 * ตัวจำลอง Arduino Uno R3 (ATmega328P 16 MHz) — ใช้ avr8js (MIT) ประมวลผลคำสั่ง AVR ทีละคำสั่ง
 * โปรแกรม: ไฟล์ .hex ที่คอมไพล์จาก sketch ด้วยบริการคอมไพล์ (avr-gcc + ArduinoCore-avr 1.8.6) — ไม่มี bootloader (โหลดลงแฟลชตรง)
 * อุปกรณ์ภายในที่ต่อกับวงจร: GPIO พอร์ต B/C/D, Timer0/1/2 (PWM ที่ขา 3 5 6 9 10 11 ขับขาผ่าน timerOverridePin), ADC 10 บิต (A0–A5 อ้างอิง AVcc 5 V),
 *   USART0 (Serial) ↔ Serial Monitor, TWI (I²C ขา A4 = SDA, A5 = SCL) ↔ บัส I²C ของวงจร, interrupt ภายนอก INT0/INT1 + pin change (avr8js AVRIOPort)
 *   EEPROM 1 KB (คงอยู่ข้าม RESET/อัปโหลด และบันทึกไปกับไฟล์งานผ่าน McuStatus.eeprom → app.docForSave)
 *   watchdog: หมดเวลา → รีเซ็ตบอร์ดแบบเดียวกับปุ่ม RESET · บอร์ด Uno จริงมี bootloader (optiboot) ที่ปิด watchdog และล้าง MCUSR ก่อนเข้าโปรแกรม
 *     ตัวจำลองไม่มี bootloader จึงทำผลเดียวกัน: หลังรีเซ็ต watchdog ปิด MCUSR = 0
 *   SPI master: SPI.transfer() ทำงานตามเวลา (ไม่ค้าง) ไบต์ที่อ่านกลับ = ระดับขา MISO (D12) จากวงจร (ทุกบิตเท่ากัน) — ยังไม่มีอุปกรณ์ SPI ที่สื่อสารกับ Uno
 *     และขา MOSI/SCK ไม่ได้สร้างรูปคลื่นในวงจร
 * ขา Arduino: D0–D7 = PORTD0–7, D8–D13 = PORTB0–5, A0–A5 (D14–D19) = PORTC0–5
 */
export const AVR_HZ = 16_000_000;
/** จำนวนขาของ Uno (ATmega328P ตัวถัง DIP) — ชิปอื่นดู AvrChip.pins */
export const UNO_PINS = 20;

/** แปลง Intel HEX → หน่วยความจำโปรแกรม (word 16 บิต) */
export function parseIntelHex(hex: string, flashBytes = 0x8000): Uint16Array {
  const bytes = new Uint8Array(flashBytes);
  let base = 0;
  for (const raw of hex.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l.startsWith(':')) continue;
    const n = parseInt(l.substr(1, 2), 16), addr = parseInt(l.substr(3, 4), 16), type = parseInt(l.substr(7, 2), 16);
    if (type === 0) for (let i = 0; i < n; i++) { const a = base + addr + i; if (a < flashBytes) bytes[a] = parseInt(l.substr(9 + i * 2, 2), 16); }
    else if (type === 2) base = parseInt(l.substr(9, 4), 16) << 4;
    else if (type === 4) base = parseInt(l.substr(9, 4), 16) << 16;
    else if (type === 1) break;
  }
  return new Uint16Array(bytes.buffer);
}

/** EEPROM ของแต่ละบอร์ด (ตาม id) — คงอยู่ข้ามการรีเซ็ต/เริ่มจำลองใหม่ภายในหน้าเว็บเดียวกัน เหมือน EEPROM จริงที่ไม่หายเมื่อถอดไฟ */
const EEPROMS = new Map<string, EEPROMMemoryBackend & { dirty?: boolean; src?: string }>();
export function eepromOf(id: string, size = 1024): EEPROMMemoryBackend & { dirty?: boolean; src?: string } {
  let e = EEPROMS.get(id);
  if (e && e.memory.length !== size) { EEPROMS.delete(id); e = undefined; } // เปลี่ยนชนิดบอร์ด (ขนาด EEPROM ต่างกัน)
  if (!e) {
    const b: EEPROMMemoryBackend & { dirty?: boolean; src?: string } = new EEPROMMemoryBackend(size);
    b.memory.fill(0xff);
    // โปรแกรมเขียน/ลบ → จดไว้ให้ cosim ส่งเนื้อหาใหม่กลับไปบันทึกลงไฟล์งาน
    const w = b.writeMemory.bind(b), er = b.eraseMemory.bind(b);
    b.writeMemory = (a, v) => { w(a, v); b.dirty = true; };
    b.eraseMemory = (a) => { er(a); b.dirty = true; };
    e = b; EEPROMS.set(id, e);
  }
  return e;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
  }
  return s;
}
export function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
/** โหลด EEPROM จากไฟล์งาน (ครั้งเดียวต่อเนื้อหาไฟล์ — ค่าที่โปรแกรมเขียนระหว่างจำลองไม่ถูกทับ) */
export function applyEepromFromFile(id: string, b64: string | null | undefined, size = 1024) {
  const e = eepromOf(id, size);
  const src = b64 ?? '';
  if (e.src === src) return;
  e.src = src;
  if (!src) { e.memory.fill(0xff); return; }
  const bytes = b64ToBytes(src);
  if (bytes.length === e.memory.length) e.memory.set(bytes);
}

export class AvrEmulator {
  private hex: string | null = null;
  /** watchdog หมดเวลา: รีเซ็ตก่อนคำสั่งถัดไป */
  private wdtReset = false;
  /** จำนวนครั้งที่ watchdog รีเซ็ตบอร์ด */
  wdtResets = 0;
  spi: AVRSPI | null = null;
  /** ขา MISO (Uno D12 · Mega D50) จากวงจร */
  private get misoHigh() { const i = this.chip.spiPins[1]; return i >= 0 && !!this.inputs[i]; }
  /** จำนวนขา Arduino (D0…) ของชิปนี้ */
  readonly pinCount: number;
  /** ความถี่สัญญาณนาฬิกา CPU (Hz) — Uno/Nano/Mega 16 MHz · Pro Mini 3.3 V ใช้ 8 MHz (เรโซเนเตอร์บนบอร์ด, F_CPU = 8000000L) */
  readonly hz: number;
  /** แรงดันไฟเลี้ยงชิป = AVcc (V) — ADC อ้างอิง AVcc ค่าเริ่มต้นของ analogRead() */
  readonly vcc: number;
  private readonly cycleNs: number;
  constructor(readonly eeprom: EEPROMMemoryBackend = new EEPROMMemoryBackend(1024), readonly chip: AvrChip = AVR_328P, opts: { hz?: number; vcc?: number } = {}) {
    this.hz = opts.hz ?? AVR_HZ;
    this.vcc = opts.vcc ?? 5;
    this.cycleNs = 1e9 / this.hz;
    this.pinCount = chip.pins.length;
    this.inputs = new Uint8Array(this.pinCount);
    this.lastOut = new Array(this.pinCount).fill(null);
    this.adcVolts = new Array(chip.adcChannels).fill(0);
  }

  private cpu: CPU | null = null;
  private ports = new Map<string, AVRIOPort>();
  /** USART0 (Serial) … USART3 (Serial3 ของ Mega) */
  private usarts: AVRUSART[] = [];
  private get usart(): AVRUSART | null { return this.usarts[0] ?? null; }
  private adc: AVRADC | null = null;
  private pinDirty = false;
  /** ดู PicoEmulator.poke */
  poke() { this.pinDirty = true; }
  private rx: number[] = [];
  private rxNextNs = 0;
  private dec = new TextDecoder('utf-8');
  /** เวลา (ns) เมื่อไม่มีโปรแกรม (CPU ไม่ทำงาน แต่นาฬิกาวงจรยังเดิน) */
  private idleNs = 0;
  private cyc0 = 0;
  serialOut = '';
  instructions = 0;
  /** มีโปรแกรมโหลดอยู่ */
  loaded = false;
  private adcVolts: number[];
  /** TWI (I²C) ของโปรแกรมปัจจุบัน — ผู้ใช้ (cosim) ผูกตัวจัดการเหตุการณ์ผ่าน twiHandler */
  twi: AVRTWI | null = null;
  twiHandler: ((twi: AVRTWI) => TWIEventHandler) | null = null;
  private inputs: Uint8Array;
  /** เหตุการณ์สำหรับเครื่องวิเคราะห์ลอจิก (ตั้งเฉพาะเมื่อมีเครื่องวิเคราะห์ในวงจร): ขาเอาต์พุตเปลี่ยน / ไบต์ที่ USART ส่ง-รับ */
  onTrace: ((e: McuTraceEvent) => void) | null = null;
  private lastOut: Array<boolean | null>;
  /** ตรวจขาเอาต์พุตทุกขา แจ้งเฉพาะขาที่ระดับเปลี่ยน (เรียกเมื่อพอร์ตถูกเขียน รวมขาที่ timer ขับ PWM) */
  private traceOut() {
    if (!this.onTrace) return;
    const tNs = this.nanos;
    for (let i = 0; i < this.pinCount; i++) {
      const m = this.pinMode(i);
      const o = m === 'out-high' ? true : m === 'out-low' ? false : null;
      if (o !== this.lastOut[i]) { this.lastOut[i] = o; this.onTrace({ kind: 'pin', i, high: o, tNs }); }
    }
  }
  private frame(kind: 'tx' | 'rx', byte: number, n = 0) {
    const u = this.usarts[n] as unknown as { UBRR: number; multiplier: number; bitsPerChar: number; stopBits: number; parityEnabled: boolean; parityOdd: boolean } | null;
    if (!this.onTrace || !u) return;
    this.onTrace({ kind, byte, tNs: this.nanos, bitNs: (u.UBRR + 1) * u.multiplier * this.cycleNs, bits: u.bitsPerChar, parity: u.parityEnabled ? (u.parityOdd ? 1 : 2) : 0, stop: u.stopBits, ...(n ? { uart: n } : {}) });
  }

  /** โหลดโปรแกรมใหม่และรีเซ็ต (เหมือนอัปโหลดผ่าน USB — เวลาของวงจรเดินต่อ) */
  load(hex: string | null) {
    const t = this.nanos;
    this.cpu = null; this.ports = new Map(); this.usarts = []; this.adc = null; this.twi = null; this.spi = null; this.loaded = false;
    this.idleNs = t;
    this.hex = hex;
    this.wdtReset = false;
    this.uartTx = [];
    this.traceOut(); // รีเซ็ต: ขาทั้งหมดกลับเป็นขาเข้า
    if (!hex) return;
    const c = this.chip;
    const cpu = new CPU(parseIntelHex(hex, c.flashBytes), c.sramBytes);
    this.cyc0 = Math.round(t / this.cycleNs);
    cpu.cycles = this.cyc0;
    const clock = new AVRClock(cpu, this.hz, c.clkpr ? { CLKPR: c.clkpr } : clockConfig);
    // เวลาเขียน EEPROM ของ avr8js ตั้งเป็นจำนวนรอบที่ 16 MHz (1.8 ms) → ปรับตามความถี่ของชิปให้ได้เวลาเท่าเดิม
    const eeCycles = Math.round((c.eeprom.writeCycles * this.hz) / 16e6);
    new AVREEPROM(cpu, this.eeprom, { ...c.eeprom, writeCycles: eeCycles, eraseCycles: eeCycles });
    new AVRWatchdog(cpu, c.watchdog, clock);
    // AVRWatchdog เรียก cpu.reset() เมื่อหมดเวลา (ซึ่งรีเซ็ตแค่ PC/SP) → ทำการรีเซ็ตเต็มแบบปุ่ม RESET แทน
    cpu.reset = () => { this.wdtReset = true; };
    if (c.spi) {
      const spi = new AVRSPI(cpu, c.spi, this.hz);
      spi.onByte = () => { cpu.addClockEvent(() => spi.completeTransfer(this.misoHigh ? 0xff : 0x00), spi.transferCycles); };
      this.spi = spi;
    }
    for (const tc of c.timers) new AVRTimer(cpu, tc);
    if (c.attinyTimer1) {
      const t1 = new ATtinyTimer1(cpu, attinyTimer1Config);
      fixTinyTimer1Pwm(t1, cpu);
      // datasheet ATtiny25/45/85: OCR1C เริ่มต้น = 0xFF (avr8js เริ่มที่ 0) — ค่านี้เป็น TOP ของ PWM บน OC1B (PB4) ที่ analogWrite ใช้
      cpu.writeHooks[attinyTimer1Config.OCR1C](0xff, 0, attinyTimer1Config.OCR1C, 0xff);
      cpu.data[attinyTimer1Config.OCR1C] = 0xff;
    }
    for (const [name, pc] of Object.entries(c.ports)) this.ports.set(name, new AVRIOPort(cpu, pc));
    for (const p of this.ports.values()) p.addListener(() => { this.pinDirty = true; if (this.onTrace) this.traceOut(); });
    this.usarts = c.usarts.map((uc, n) => {
      const u = new AVRUSART(cpu, uc, this.hz);
      // Serial (USART0) → Serial Monitor ผ่านชิป USB-serial · Serial1–3 ของ Mega ออกขา TX ของตัวเองเท่านั้น (ไม่ผ่าน USB) — เห็นได้ในเครื่องวิเคราะห์ลอจิก
      u.onByteTransmit = (b) => { if (n === 0) this.serialOut += this.dec.decode(new Uint8Array([b]), { stream: true }); else this.uartTx[n] = (this.uartTx[n] ?? 0) + 1; this.frame('tx', b, n); };
      return u;
    });
    if (c.twi) {
      this.twi = new AVRTWI(cpu, c.twi, this.hz);
      if (this.twiHandler) this.twi.eventHandler = this.twiHandler(this.twi);
    }
    this.adc = new AVRADC(cpu, c.adc);
    this.adc.avcc = this.vccLive ?? this.vcc;
    for (let ch = 0; ch < c.adcChannels; ch++) this.adc.channelValues[ch] = this.adcVolts[ch];
    // ขาเข้าที่วงจรกำหนดไว้แล้ว
    for (let i = 0; i < this.pinCount; i++) { const [p, bit] = this.portOf(i); p.setPin(bit, !!this.inputs[i]); }
    this.cpu = cpu;
    this.loaded = true;
    this.traceOut();
  }

  /** รีเซ็ต (ปุ่ม RESET) — เริ่มโปรแกรมเดิมใหม่ */
  reset(hex: string | null) { this.load(hex); }

  /** เรียก fn หลังเวลาจำลองผ่านไป sec วินาที (นับรอบสัญญาณนาฬิกาของ CPU) */
  later(sec: number, fn: () => void) { this.cpu?.addClockEvent(fn, Math.max(1, Math.round(sec * this.hz))); }
  /** TWI เปิดอยู่ (TWCR.TWEN) — ขา A4/A5 เป็น SDA/SCL */
  get twiEnabled(): boolean { return !!this.cpu && !!this.twi && (this.cpu.data[0xbc] & 0x04) !== 0; }
  /** แรงดันไฟเลี้ยงที่วัดได้ของชิปที่รับไฟจากวงจร (ATtiny85) — ADC อ้างอิง VCC ตามค่านี้ */
  setVcc(v: number) { this.vccLive = Math.max(0.5, v); if (this.adc) this.adc.avcc = this.vccLive; }
  private vccLive: number | null = null;
  get nanos(): number { return this.cpu ? this.cpu.cycles * this.cycleNs : this.idleNs; }

  private portOf(i: number): [AVRIOPort, number] {
    const [name, bit] = this.chip.pins[i];
    return [this.ports.get(name)!, bit];
  }

  pinMode(i: number): PinMode {
    if (!this.cpu || i >= this.pinCount) return 'in';
    const [p, bit] = this.portOf(i);
    switch (p.pinState(bit)) {
      case PinState.High: return 'out-high';
      case PinState.Low: return 'out-low';
      case PinState.InputPullUp: return 'in-pullup';
      default: return 'in';
    }
  }

  /** ขา TX (D1) ขับเป็น HIGH (ว่าง) เมื่อเปิด USART — ตัวจำลองไม่ส่งบิตออกขา */
  get txEnabled(): boolean { return !!this.usart?.txEnable; }
  /** เปิดตัวรับของ USART แล้ว (Serial.begin) — ขา D0 ถูกชิป USB-serial บนบอร์ดขับ (ว่าง = HIGH) */
  get rxEnabled(): boolean { return !!this.usart?.rxEnable; }
  get baudRate(): number { return this.usart?.baudRate ?? 0; }
  /** USART n (1–3 = Serial1–3 ของ Mega) เปิดตัวส่ง/ตัวรับ */
  uartTxEnabled(n: number): boolean { return !!this.usarts[n]?.txEnable; }
  uartRxEnabled(n: number): boolean { return !!this.usarts[n]?.rxEnable; }
  /** จำนวนไบต์ที่ Serial1–3 ส่งออกขา TX (นับตั้งแต่โหลดโปรแกรม) */
  uartTx: number[] = [];

  setInput(i: number, high: boolean) {
    if (i >= this.pinCount) return; // A6/A7 ของ Nano ไม่มีวงจรขาดิจิทัล (ต่อเข้า ADC อย่างเดียว)
    this.inputs[i] = high ? 1 : 0;
    if (!this.cpu) return;
    const [p, bit] = this.portOf(i);
    p.setPin(bit, high);
  }

  /** ADC ช่อง 0–5 = A0–A5, 6–7 = A6/A7 (มีเฉพาะชิปตัวถัง TQFP/QFN เช่นบน Nano) (แรงดันเทียบ GND, อ้างอิง AVcc 5 V) */
  setAdc(ch: number, volts: number) {
    if (ch < 0 || ch >= this.chip.adcChannels) return;
    this.adcVolts[ch] = volts;
    if (this.adc) this.adc.channelValues[ch] = volts;
  }

  sendSerial(bytes: number[] | string) {
    for (const b of typeof bytes === 'string' ? [...new TextEncoder().encode(bytes)] : bytes) this.rx.push(b & 0xff);
  }

  takeSerial(): string { const s = this.serialOut; this.serialOut = ''; return s; }

  /** เดินเวลาจนถึง targetNs หรือจนกว่าขาเปลี่ยน ('pin') หรือหมดงบเวลาจริง ('deadline') */
  run(targetNs: number, deadline: number, stopOnPin = true): 'target' | 'pin' | 'deadline' {
    const cpu = this.cpu;
    if (!cpu) { this.idleNs = Math.max(this.idleNs, targetNs); return 'target'; }
    const target = Math.ceil(targetNs / this.cycleNs);
    this.pinDirty = false;
    let n = 0;
    while (cpu.cycles < target) {
      if (this.rx.length && this.usart && this.usart.rxEnable && cpu.cycles * this.cycleNs >= this.rxNextNs && !this.usart.rxBusy) {
        const b = this.rx.shift()!;
        this.frame('rx', b);
        this.usart.writeByte(b);
        this.rxNextNs = cpu.cycles * this.cycleNs + (10 / Math.max(300, this.usart.baudRate)) * 1e9;
      }
      avrInstruction(cpu);
      cpu.tick();
      this.instructions++;
      if (this.wdtReset) {
        // watchdog: เริ่มโปรแกรมใหม่ที่เวลานี้ (EEPROM คงอยู่) · ขาทั้งหมดกลับเป็นขาเข้า
        this.wdtResets++;
        this.load(this.hex);
        this.pinDirty = true;
        if (stopOnPin) return 'pin';
        return this.run(targetNs, deadline, stopOnPin);
      }
      if (stopOnPin && this.pinDirty) return 'pin';
      if ((++n & 0x3fff) === 0 && now() > deadline) return 'deadline';
    }
    return 'target';
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * แก้โหมด PWM ของ Timer/Counter1 ของ ATtiny85 ให้ตรง datasheet (Atmel-2586 §12.2.2): ตัวนับนับขึ้นจาก 0 ถึง OCR1C แล้วกลับเป็น 0
 * (ความถี่ = สัญญาณนาฬิกาของ Timer1 ÷ (OCR1C + 1)) · COM1x = 10: ขา OC1x ลงเมื่อตรง OCR1x และขึ้นเมื่อ TCNT1 = 0 · COM1x = 11: กลับด้าน
 * avr8js 0.21.1 นับขึ้น-ลงแบบ phase correct ทำให้ความถี่ครึ่งหนึ่งของบอร์ดจริง — จึงแทนที่เมธอดนับในโหมด PWM ของอ็อบเจกต์นี้
 */
function fixTinyTimer1Pwm(t1: ATtinyTimer1, cpu: CPU) {
  const SET = 2, CLEAR = 3, PORTB = 0x38;
  const t = t1 as unknown as { TOP: number; ocrA: number; ocrB: number; comA: number; comB: number; pwmA: boolean; pwmB: boolean; tcntUpdated: boolean; OVF: unknown; OCFA: unknown; OCFB: unknown; phasePwmCount: (v: number, d: number) => number };
  const pin = (ch: 'A' | 'B', high: boolean) => {
    const com = ch === 'A' ? t.comA : t.comB;
    if (!(ch === 'A' ? t.pwmA : t.pwmB) || com === 0) return;
    const out = com === 3 ? !high : high;
    (cpu as unknown as { gpioByPort: Record<number, AVRIOPort | undefined> }).gpioByPort[PORTB]?.timerOverridePin(ch === 'A' ? 1 : 4, out ? SET : CLEAR);
  };
  t.phasePwmCount = (value: number, delta: number) => {
    const top = t.TOP;
    while (delta > 0) {
      value++;
      if (value > top) { value = 0; cpu.setInterruptFlag(t.OVF as never); if (!t.tcntUpdated) { pin('A', true); pin('B', true); } }
      if (!t.tcntUpdated) {
        if (value === t.ocrA) { cpu.setInterruptFlag(t.OCFA as never); pin('A', false); }
        if (value === t.ocrB) { cpu.setInterruptFlag(t.OCFB as never); pin('B', false); }
      }
      delta--;
    }
    return value & 0xff;
  };
}
