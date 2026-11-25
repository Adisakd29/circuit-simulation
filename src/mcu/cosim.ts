import { LogicCapture, spiByteEdges, uartFrameBits, type AnalyzerSpec } from '../instruments/logic';
import type { ToneMeter } from '../sim/tone';
import type { McuSpec, Netlist, NetlistElement } from '../sim/netlist';
import { hasReactive } from '../sim/netlist';
import { solveDC, voltageBetween, type ElementResult, type SimResult } from '../sim/solver';
import { advance, newTranState, nextSonarEvent, restart, type TranState } from '../sim/transient';
import type { EngineRequest, EngineResponse, Sample, WatchItem } from '../sim/engine';
import { readWatch } from '../sim/engine';
import { FIRMWARE_B64, FIRMWARE_NANOCONNECT_B64, FIRMWARE_PICOW_B64, FIRMWARE_XIAO_B64, LFS_BG_MAP, LFS_BLOCKS_B64 } from './firmware-data';
import { PicoEmulator, RawReplFilter, decodeB64, rawRunBytes, type PinMode } from './pico-emu';
import { Esp32Emulator, ESP32_ADC } from './esp32-emu';
import { AvrEmulator, applyEepromFromFile, avrChipOf, avrClockOf, bytesToB64, eepromOf } from './avr-emu';
import { I2cHub } from './i2c-bus';
import { LcdHub } from './spi-bus';
import { Tm1637Hub } from './tm1637';
import { ParLcdHub } from './hd44780-par';
import { I2cWave } from './i2c-wave';
import { GPIO_ILIM, XIAO_LED, mcuRails } from './rails';
import { EncoderHub } from './encoder';
import { PiEmulator, type PiHost } from './pi-emu';

/**
 * การจำลองร่วม (co-simulation) ไมโครคอนโทรลเลอร์ + วงจร
 *
 * เวลา: นาฬิกาของ CPU ที่จำลองคือเวลาของวงจร
 * วงจรไม่มี C/L (ตอบสนองทันที): แบบ "ตามเหตุการณ์" — CPU ทำงานจนกว่าสถานะขาใดเปลี่ยน แล้วแก้วงจรใหม่ทันที
 *   และตั้งค่าขาเข้า/ADC จากแรงดันที่คำนวณได้ ก่อน CPU ทำงานต่อ (ไม่มีความหน่วงระหว่างขาออกกับขาเข้า)
 *   ค่าที่แสดง (มิเตอร์, ความสว่าง LED) = ค่าเฉลี่ยถ่วงเวลาในแต่ละช่วง 50 ms เหมือนมัลติมิเตอร์จริง
 *   คำตอบของแต่ละสถานะขาถูกเก็บไว้ (cache) จึงรองรับ PWM ได้โดยไม่ต้องแก้วงจรซ้ำ
 * วงจรมี C/L: เดินเวลาวงจร (transient) เป็นช่วงสั้นไม่เกิน QUANTUM หรือถึงเหตุการณ์ขาเปลี่ยน แล้วอัปเดตขาเข้า
 *
 * แบบจำลองขา GPIO (ประมาณจาก datasheet RP2040, drive 4 mA):
 *   ขาออก = แหล่ง 3.3 V หรือ 0 V ต่ออนุกรม 80 Ω (จำกัดกระแสลัดวงจร 50 mA)
 *   ขาเข้า: pull-up/pull-down ≈ 50 kΩ, ระดับลอจิก: สูงเมื่อ > 1.8 V, ต่ำเมื่อ < 1.4 V (มี hysteresis)
 *   ADC (GP26–28): 0–3.3 V → 0–4095 (12 บิต)
 *   ขา 3V3 = 3.3 V จากเรกูเลเตอร์ (≤ 300 mA), VBUS = 5 V จาก USB, VSYS ≈ 4.7 V
 */

export const GPIO_R_OUT = 80;
export const GPIO_R_PULL = 50e3;
export const V_IH = 1.8;
export const V_IL = 1.4;
/**
 * ไฟฟ้าของขาตามชนิดบอร์ด — Uno (ATmega328P ที่ 5 V, datasheet): ขาออกขับ 20 mA โดยแรงดันตกไม่เกิน 0.8 V (≈ 25–40 Ω) พิกัดสูงสุด 40 mA,
 * pull-up ภายใน 20–50 kΩ, ขาเข้า LOW < 0.3 Vcc / HIGH > 0.6 Vcc (ใช้จุดเปลี่ยน 0.45/0.55 Vcc ภายในช่วงนั้น)
 */
export const PIN_ELEC = {
  pico: { vdd: 3.3, rOut: GPIO_R_OUT, iLim: GPIO_ILIM.pico, rPull: GPIO_R_PULL, vih: V_IH, vil: V_IL },
  uno: { vdd: 5, rOut: 25, iLim: GPIO_ILIM.uno, rPull: 35e3, vih: 2.75, vil: 2.25 },
  /**
   * Raspberry Pi 5 (ขา GPIO ของชิป RP1, 3.3 V ไม่ทน 5 V) — ค่าประมาณ: ยังไม่พบตัวเลขไฟฟ้าของ RP1 ที่เผยแพร่ จึงใช้ค่าของ Pi 4 จาก pinout.xyz
   * pull-up/pull-down 33–73 kΩ (ใช้ 50 kΩ) · ขาเข้า LOW < 0.8 V / HIGH > 2.0 V · ขาออกจำกัดกระแสราว 16 mA (ค่า drive สูงสุดของ Pi รุ่นก่อน)
   */
  rpi5: { vdd: 3.3, rOut: 40, iLim: GPIO_ILIM.rpi5, rPull: 50e3, vih: 2.0, vil: 0.8 },
  /**
   * Arduino UNO Q (STM32U585 ที่ 3.3 V, datasheet STM32U585): กระแสต่อขา ±20 mA (IIO), VOH ≥ VDD−0.4 V ที่ 8 mA (≈ 50 Ω),
   * pull-up/pull-down 30–50 kΩ (ใช้ 40 kΩ), ขาเข้า LOW < 0.3 VDD / HIGH > 0.7 VDD (ใช้จุดเปลี่ยน 1.5/1.8 V ภายในช่วงนั้น)
   */
  unoq: { vdd: 3.3, rOut: 50, iLim: GPIO_ILIM.unoq, rPull: 40e3, vih: 1.8, vil: 1.5 },
  /**
   * Pro Mini 3.3 V (ATmega328P ที่ VCC 3.3 V, datasheet ตาราง DC characteristics): VOH ≥ 2.3 V ที่ 10 mA เมื่อ VCC = 3 V (แย่สุด ≈ 70 Ω — ใช้ค่ากลาง 45 Ω),
   * พิกัดสูงสุด 40 mA ต่อขา, pull-up 20–50 kΩ (35 kΩ), ขาเข้า LOW < 0.3 VCC / HIGH > 0.6 VCC (ใช้จุดเปลี่ยน 0.45/0.55 VCC แบบเดียวกับ Uno)
   */
  promini3: { vdd: 3.3, rOut: 45, iLim: GPIO_ILIM.uno, rPull: 35e3, vih: 1.815, vil: 1.485 },
  /**
   * ATtiny85 ชิปเดี่ยว (datasheet Atmel-2586 ตาราง 21-1): VOH ≥ 4.3 V ที่ 10 mA เมื่อ VCC 5 V (แย่สุด ≈ 70 Ω — ใช้ค่ากลาง 45 Ω), pull-up 20–50 kΩ (35 kΩ)
   * vdd/vih/vil เป็นค่าที่ VCC 5 V — ขณะจำลองใช้ VCC ที่วัดได้จริงจากวงจร (ตัวต้านทานขาออกต่อกับเน็ต VCC/GND ของชิป, จุดเปลี่ยน 0.45/0.55 VCC)
   */
  attiny85: { vdd: 5, rOut: 45, iLim: GPIO_ILIM.uno, rPull: 35e3, vih: 2.75, vil: 2.25 },
  /**
   * ESP32 (Espressif ESP32 Datasheet ตาราง 5-3 DC Characteristics ที่ 3.3 V): VOH ≥ 0.8 VDD (2.64 V) ที่ IOH 40 mA → ≈ 16.5 Ω,
   * VIH ≥ 0.75 VDD / VIL ≤ 0.25 VDD (ใช้จุดเปลี่ยน 2.475/0.825 V), RPU/RPD 45 kΩ · จำกัดกระแสที่ 40 mA (IOH แบบ drive สูงสุด)
   */
  esp32: { vdd: 3.3, rOut: 16.5, iLim: 0.04, rPull: 45e3, vih: 2.475, vil: 0.825 },
} as const;
/** ATtiny85: เริ่มทำงานเมื่อ VCC ≥ 2.7 V (ช่วงใช้งานที่ 0–10 MHz ของรุ่นไม่มี V) และหยุด (รีเซ็ต) เมื่อต่ำกว่า 2.5 V · ขา RESET (PB5) ต่ำกว่า 0.45 VCC = รีเซ็ต */
export const CHIP_VMIN_ON = 2.7, CHIP_VMIN_OFF = 2.5;
/** ค่าไฟฟ้าขาของบอร์ด (UNO Q ใช้ตัวจำลอง CPU ชุดเดียวกับ Uno แต่ไฟฟ้าขาต่างกัน) */
export function pinElec(kind: 'pico' | 'uno' | 'rpi5' | undefined, board?: string) { return board === 'esp32' ? PIN_ELEC.esp32 : board === 'unoq' ? PIN_ELEC.unoq : board === 'promini3' ? PIN_ELEC.promini3 : board === 'attiny85' ? PIN_ELEC.attiny85 : PIN_ELEC[kind ?? 'pico']; }
/** เน็ต SDA (line 0) / SCL (line 1) ของ TWI: Uno/Nano = A4/A5, UNO Q = หัวต่อ SDA/SCL */
export function twiNet(m: McuSpec | null, line: 0 | 1): number { if (!m) return -2; if (m.twi) return m.twi[line]; const i = avrChipOf(m.board).twiPins[line]; return i >= 0 ? m.gp[i] : -2; }
const QUANTUM = 50e-6;
/** ช่วงยาวขึ้นเมื่อไม่มีขาใดของบอร์ดที่ต้องอ่านค่าจากวงจร (ขาเข้า/ADC ที่ต่อวงจร) — ขาออกเปลี่ยนเมื่อไรก็หยุดตรงขอบอยู่แล้ว */
const QUANTUM_OUT_ONLY = 1e-3;
const MAX_EVENTS = 20000;
/** ช่วงอ่านขาเข้าสูงสุดเมื่อขาเข้านิ่ง (ปุ่มที่กดยังตอบสนองภายใน 4 ms — ไวกว่าการกดของคนมาก) */
const QUANTUM_IDLE_MAX = 4e-3;

export interface McuCommand {
  /** ไบต์ที่พิมพ์เข้า REPL */
  serial?: number[];
  /** โค้ดที่จะรันผ่าน raw REPL */
  run?: string;
  /** Uno: รีเซ็ต CPU (เริ่มโปรแกรมใหม่) */
  reset?: boolean;
  /** หยุดโปรแกรม (Ctrl-C) */
  stop?: boolean;
}

export interface McuStatus {
  id: string;
  kind?: 'pico' | 'uno' | 'rpi5';
  console: string;
  /** Uno: EEPROM ใหม่ (base64) เมื่อโปรแกรมเขียน — app เก็บไว้บันทึกลงไฟล์งาน */
  eeprom?: string;
  /** ชิปที่รับไฟจากวงจร (ATtiny85): แรงดัน VCC ที่วัดได้ ทำงานอยู่หรือไม่ และขา RESET ถูกดึงต่ำ */
  chip?: { vcc: number; powered: boolean; rst: boolean };
  /** Raspberry Pi: สถานะตัวรัน Python */
  py?: { state: PiHost['state']; error?: string };
  /** โปรแกรมที่ส่งไปกำลังทำงาน */
  running: boolean;
  /** ผลของโปรแกรมที่เพิ่งจบ */
  finished: null | { ok: boolean; error?: string };
  booted: boolean;
  pins: PinMode[];
  /** สัดส่วนเวลาที่ขาเป็น HIGH ในช่วงล่าสุด (ขาออก) — ใช้แสดง PWM */
  duty: number[];
  /** ธุรกรรมบนบัส I²C ในช่วงล่าสุด (เฉพาะบอร์ดหลัก) */
  i2c?: string[];
  /** จำนวนครั้งที่ขาเปลี่ยนระดับในช่วงล่าสุด */
  edges?: number[];
  /** ความสว่าง LED บนบอร์ด 0–1 (Pico: GP25 · Nano RP2040 Connect: GPIO6 = D13 · Pico W/XIAO: 0 — ดู onboard) */
  led: number;
  /** XIAO RP2040: LED RGB บนบอร์ด (ความสว่าง R, G, B 0–1) และ NeoPixel (สี 0–255, null = ดับ) */
  onboard?: { rgb: [number, number, number]; neo: [number, number, number] | null; neoPower: boolean };
  /** คำสั่งที่ประมวลผลต่อวินาทีจริง (ล้านคำสั่ง) */
  mips: number;
  /** อัตราส่วนเวลาจำลอง/เวลาจริงในคำขอล่าสุด */
  ratio: number;
}

/**
 * XIAO RP2040: LED RGB บนบอร์ด (ขั้วร่วมแอโนดต่อ 3V3 — ติดเมื่อขาเป็น LOW: ความสว่าง = สัดส่วนเวลา LOW ของขาออก, ขาเข้า = ดับ)
 * และ NeoPixel ที่ถอดรหัสจากสัญญาณขา GPIO12
 */
function xiaoLeds(b: Board, pins: PinMode[], duty: number[]): Pick<McuStatus, 'onboard'> {
  if (b.avrBoard !== 'xiao') return {};
  const lit = (i: number) => (pins[i]?.startsWith('out') ? Math.max(0, Math.min(1, 1 - duty[i])) : 0);
  const ws = (b.emu as PicoEmulator).ws2812();
  return { onboard: { rgb: [lit(XIAO_LED.r), lit(XIAO_LED.g), lit(XIAO_LED.b)], neo: ws?.rgb ?? null, neoPower: !!ws?.powered } };
}

export function pinElements(m: McuSpec, modes: PinMode[], used: (net: number) => boolean): NetlistElement[] {
  const S = (id: string, p: number, V: number, Rint: number, Ilim: number): NetlistElement => ({ type: 'SUPPLY', id: `${m.id}#${id}`, p, n: m.gnd, V, Rint, Ilim });
  const out: NetlistElement[] = [];
  const E = pinElec(m.kind, m.board ?? m.fw);
  // ชิปที่รับไฟจากวงจร (ATtiny85): ขาออก = ตัวต้านทานไปยังเน็ต VCC/GND ของชิปเอง — กระแสขาออกไหลผ่านขา VCC จริง และ HIGH = แรงดัน VCC ที่ได้รับ
  if (m.chipVcc !== undefined) {
    const R = (id: string, a: number, b: number, r: number): NetlistElement => ({ type: 'R', id: `${m.id}#${id}`, role: 'module', a, b, R: r });
    if (m.chipVcc < 0 || m.gnd < 0 || m.chipVcc === m.gnd) return out;
    m.gp.forEach((net, i) => {
      if (net < 0 || !used(net)) return;
      const mode = modes[i];
      if (mode === 'out-high' && net !== m.chipVcc) out.push(R(`GP${i}`, net, m.chipVcc!, E.rOut));
      else if (mode === 'out-low' && net !== m.gnd) out.push(R(`GP${i}`, net, m.gnd, E.rOut));
      else if (mode === 'in-pullup' && net !== m.chipVcc) out.push(R(`GP${i}`, net, m.chipVcc!, E.rPull));
    });
    // ขา RESET มีตัวต้านทานดึงขึ้นภายใน 30–60 kΩ (ใช้ 45 kΩ)
    if (m.rst !== undefined && m.rst >= 0 && m.rst !== m.chipVcc && used(m.rst)) out.push(R('RSTPU', m.rst, m.chipVcc, 45e3));
    return out;
  }
  // Pi 5: ขา 5V ต่อตรงกับไฟเข้า USB-C (≈ 1.6 A รวม USB), 3V3 จากเรกูเลเตอร์ (≈ 0.5 A)
  // Uno: 5V จาก USB (ฟิวส์ 500 mA), 3.3V จาก LP2985 (150 mA) · VIN ไม่มีไฟเมื่อใช้ USB · Nano: 3V3 จากชิป USB-serial (≤ 50 mA) ไม่จำลองไดโอดกันย้อน
  // Pico: 3V3 (≈ 300 mA), VBUS, VSYS, ADC_VREF (ผ่านตัวกรอง 200 Ω)
  // Pro Mini: ไม่มีพอร์ต USB — ไฟ VCC มาจากตัวแปลง USB-serial ที่หัว 6 ขา (vbus = เน็ต VCC)
  const nets: Record<string, number> = { '5V': m.vbus, VBUS: m.vbus, VCC: m.vbus, '3V3': m.v33, VSYS: m.vsys, ADC_VREF: m.vref };
  const order = m.kind === 'uno' || m.kind === 'rpi5' ? mcuRails(m.kind, m.board, m.usbLimit) : mcuRails('pico', m.fw);
  for (const [name, v, rint, ilim] of order) { const net = nets[name]; if (net !== undefined && net >= 0 && used(net)) out.push(S(name, net, v, rint, ilim)); }
  m.gp.forEach((net, i) => {
    if (net < 0 || !used(net)) return;
    const mode = modes[i];
    if (mode === 'out-high') out.push(S(`GP${i}`, net, E.vdd, E.rOut, E.iLim));
    else if (mode === 'out-low') out.push(S(`GP${i}`, net, 0, E.rOut, E.iLim));
    else if (mode === 'in-pullup') out.push(S(`GP${i}`, net, E.vdd, E.rPull, 1));
    else if (mode === 'in-pulldown') out.push(S(`GP${i}`, net, 0, E.rPull, 1));
  });
  return out;
}

/** เน็ตที่มีอุปกรณ์อื่นต่ออยู่ (ขา MCU ที่ไม่ได้ต่ออะไรไม่ต้องสร้างแหล่งแรงดัน) */
function usedNets(nl: Netlist): Set<number> {
  const s = new Set<number>();
  for (const e of nl.elements) {
    if (e.type === 'R' || e.type === 'C' || e.type === 'L') { s.add(e.a); s.add(e.b); }
    else if (e.type === 'LED' || e.type === 'D') { s.add(e.a); s.add(e.k); }
    else if (e.type === 'BJT') { s.add(e.c); s.add(e.b); s.add(e.e); }
    else if (e.type === 'MOS') { s.add(e.d); s.add(e.g); s.add(e.s); }
    else if (e.type === 'OPAMP') { [e.inp, e.inn, e.out, e.vp, e.vn].forEach((n) => s.add(n)); }
    else { s.add(e.p); s.add(e.n); }
  }
  // ขาของ MCU ด้วยกันที่ต่อถึงกันผ่านสาย (เช่น GP2 → GP3)
  const cnt = new Map<number, number>();
  for (const m of nl.mcus ?? []) for (const n of [...m.gp, m.v33, m.vbus, m.vsys, m.vref]) if (n >= 0) cnt.set(n, (cnt.get(n) ?? 0) + 1);
  for (const [n, c] of cnt) if (c > 1) s.add(n);
  return s;
}

class Board {
  emu: PicoEmulator | AvrEmulator | PiEmulator | Esp32Emulator;
  filter = new RawReplFilter();
  console = '';
  booted = false;
  autorunDone = false;
  finished: null | { ok: boolean; error?: string } = null;
  /** ผู้ใช้สั่งหยุด — ส่ง Ctrl-C ซ้ำทุกคำขอจนโปรแกรมจบ (Ctrl-C ที่มาถึงก่อนโปรแกรมเริ่มจะไม่มีผล) */
  stopPending = false;
  /** เวลา HIGH สะสมต่อขา (ns) ในช่วงล่าสุด */
  highNs = new Float64Array(70);
  /** จำนวนครั้งที่ขาออกเปลี่ยนระดับในคำขอล่าสุด (แยก PWM ออกจากการเปลี่ยนค่าครั้งเดียว) */
  edges = new Uint32Array(70);
  private lastHigh = new Uint8Array(70);
  countEdges(before: boolean[]) { for (let i = 0; i < this.pinCount; i++) { const v = before[i] ? 1 : 0; if (v !== this.lastHigh[i]) { this.edges[i]++; this.lastHigh[i] = v; } } }
  lastLevel = new Uint8Array(70);
  /** ขาเข้าที่ลอยอยู่ (ไม่มีตัวดึงขึ้น/ลง ไม่มีสิ่งใดขับ) */
  floating = new Set<number>();
  /** Uno: โปรแกรมที่โหลดอยู่ */
  hex: string | null = null;
  /** ผูก I²C ฮาร์ดแวร์ของ RP2040 กับบัสแล้ว */
  i2cHooked = false;
  /** ผูก SPI ฮาร์ดแวร์ของ RP2040 กับจอแล้ว */
  spiHooked = false;
  /** เวลาปลายไบต์ SPI ล่าสุดของแต่ละ instance (สร้างรูปคลื่นให้เครื่องวิเคราะห์ลอจิก) */
  spiEnd: number[] = [0, 0];
  /** ผูก TWI ของ Uno กับบัสแล้ว */
  twiHooked = false;
  /** รูปคลื่นสาย I²C ฮาร์ดแวร์ (ระดับปัจจุบันของ SDA/SCL) */
  i2cWave: I2cWave | null = null;
  /** Pico I2C0/I2C1 */
  picoWaves: Array<I2cWave | null> = [null, null];
  spec: McuSpec | null = null;
  /** ชิปที่รับไฟจากวงจร: มีไฟพอทำงาน (VCC ≥ 2.7 V) และไม่ถูกกดขา RESET */
  powered = false;
  /** แรงดัน VCC ล่าสุดที่วัดได้ (V) */
  vcc = 0;
  /** ขา RESET ถูกดึงต่ำ */
  rstLow = false;
  constructor(readonly id: string, readonly kind: 'pico' | 'uno' | 'rpi5' = 'pico', startNs = 0, readonly bg: string | null = null, piHost: PiHost | null = null, readonly avrBoard: string | null = null) {
    const bgData = bg ? decodeB64(bg) : null;
    if (kind === 'rpi5') { const pe = new PiEmulator(piHost); pe.nanos = startNs; this.emu = pe; return; }
    const chip = avrChipOf(avrBoard ?? undefined);
    this.emu = kind === 'uno' ? new AvrEmulator(eepromOf(id, chip.eepromBytes), chip, avrClockOf(avrBoard ?? undefined)) : this.newPico(bgData, { startNs });
    if (kind === 'uno') (this.emu as AvrEmulator).run(startNs, Infinity, false);
  }
  /**
   * บอร์ด RP2040: เฟิร์มแวร์ตามรุ่น (Pico / Pico W ไม่มีไร้สาย / XIAO RP2040 / Nano RP2040 Connect ไม่มี NINA-W102) · XIAO: ถอดรหัส NeoPixel บนบอร์ด (GPIO12, ไฟเลี้ยงจาก GPIO11)
   */
  private newPico(bgData: Uint8Array | null, opts: { startNs: number; flash?: Uint8Array }): PicoEmulator | Esp32Emulator {
    // ESP32: CPU อยู่ใน QEMU (โปรเซสแยกบนเซิร์ฟเวอร์) — ใช้ REPL ของ MicroPython ชุดเดียวกับบอร์ด RP2040
    if (this.avrBoard === 'esp32') return new Esp32Emulator(opts.startNs);
    const fw = this.avrBoard === 'picow' ? FIRMWARE_PICOW_B64 : this.avrBoard === 'xiao' ? FIRMWARE_XIAO_B64 : this.avrBoard === 'nanoconnect' ? FIRMWARE_NANOCONNECT_B64 : FIRMWARE_B64;
    const e = new PicoEmulator(decodeB64(fw), decodeB64(LFS_BLOCKS_B64), bgData && bgData.length === LFS_BG_MAP.size ? { data: bgData, segments: LFS_BG_MAP.segments } : undefined, opts);
    if (this.avrBoard === 'xiao') e.enableWs2812(XIAO_LED.neo, XIAO_LED.neoPower);
    return e;
  }
  /** ตัวจำลอง RP2040 (null = บอร์ดชนิดอื่น รวมถึง ESP32 ที่ใช้ REPL MicroPython เหมือนกันแต่ CPU ต่างกัน) */
  get rp2(): PicoEmulator | null { return this.kind === 'pico' && this.avrBoard !== 'esp32' ? (this.emu as PicoEmulator) : null; }
  get esp(): Esp32Emulator | null { return this.kind === 'pico' && this.avrBoard === 'esp32' ? (this.emu as Esp32Emulator) : null; }
  /** Pico: watchdog/machine.reset() — บูตใหม่ที่เวลาปัจจุบันจากแฟลชเดิม (เรียกก่อนเริ่มคำขอ) */
  rebootIfPending(): boolean {
    if (!this.rp2) return false;
    const old = this.emu as PicoEmulator;
    if (!old.rebootPending) return false;
    const bgData = this.bg ? decodeB64(this.bg) : null;
    this.emu = this.newPico(bgData, { startNs: old.nanos, flash: old.mcu.flash.slice() });
    this.console += old.takeSerial() + '\n[ระบบ] บอร์ดรีเซ็ต (watchdog / machine.reset) — บูต MicroPython ใหม่\n';
    const wasRunning = this.filter.running;
    this.filter = new RawReplFilter();
    if (this.finished === null && wasRunning) this.finished = { ok: false, error: 'บอร์ดรีเซ็ตโดย watchdog / machine.reset()' };
    this.booted = false;
    this.autorunDone = false;
    this.i2cHooked = false;
    this.spiHooked = false;
    this.stopPending = false;
    return true;
  }
  /** Uno 20 ขา (D0–D13, A0–A5) · Nano 22 ขา (+A6/A7 อ่าน ADC อย่างเดียว) · Mega 70 ขา (D0–D53, A0–A15) */
  get pinCount() { return this.kind === 'uno' ? (this.avrBoard === 'mega' ? 70 : this.avrBoard === 'attiny85' ? 6 : this.spec?.board === 'nano' || this.spec?.board === 'promini' || this.spec?.board === 'promini3' ? 22 : 20) : this.kind === 'rpi5' ? 28 : this.avrBoard === 'esp32' ? 40 : 30; }
  /** ชิป AVR ของบอร์ด (เฉพาะ kind = 'uno') */
  get chip() { return avrChipOf(this.avrBoard ?? undefined); }
  get pi(): PiEmulator | null { return this.kind === 'rpi5' ? (this.emu as PiEmulator) : null; }

  modes(): PinMode[] {
    const m: PinMode[] = [];
    for (let i = 0; i < this.pinCount; i++) m.push(this.emu.pinMode(i));
    if (this.kind === 'uno') {
      // UNO Q: Serial = Monitor ผ่าน Bridge (ไม่ใช่ D0/D1) และ Wire ใช้หัวต่อ SDA/SCL — A4/A5 จึงไม่ถูก TWI ยึด (ปล่อยเป็นอินพุต hi-Z)
      if (this.spec?.board === 'unoq') { if ((this.emu as AvrEmulator).twiEnabled) { m[18] = 'in'; m[19] = 'in'; } return m; }
      // ขา TX ของ USART ที่เปิดอยู่ว่างที่ HIGH (ตัวจำลองไม่ส่งบิตออกขา) — Mega มี USART0–3
      const avr = this.emu as AvrEmulator;
      this.chip.uartPins.forEach(([, tx], n) => { if (avr.uartTxEnabled(n)) m[tx] = 'out-high'; });
      return m;
    }
    if (this.kind === 'rpi5') return m;
    // GP0 = UART TX ของ REPL: ว่างอยู่ที่ HIGH (ตัวจำลองไม่ส่งสัญญาณบิตออกขา)
    m[0] = 'out-high';
    return m;
  }

  /** ขาที่ใช้กับ UART (ไม่รับค่าจากวงจร) */
  uartPin(i: number) {
    if (this.kind === 'rpi5') return false;
    if (this.kind === 'uno') {
      if (this.spec?.board === 'unoq') return false;
      const avr = this.emu as AvrEmulator;
      return this.chip.uartPins.some(([rx, tx], n) => (i === rx || i === tx) && avr.uartTxEnabled(n));
    }
    return i === 0 || i === 1;
  }

  /** ช่อง ADC ของขา (−1 = ไม่มี) */
  adcChannel(i: number) { if (this.kind === 'rpi5') return -1; if (this.kind === 'uno') { if (this.chip.adcPins) return this.chip.adcPins.indexOf(i); const a0 = this.chip.adcPin0; return i >= a0 && i < this.pinCount ? i - a0 : -1; } if (this.avrBoard === 'esp32') return ESP32_ADC.findIndex(([g]) => g === i); return i >= 26 && i <= 29 ? i - 26 : -1; }

  pump() {
    const pi = this.pi;
    if (pi) {
      this.console += pi.takeSerial();
      this.booted = true;
      if (pi.finished) { this.finished = pi.finished; pi.finished = null; }
      return;
    }
    if (this.kind === 'uno') {
      this.console += this.emu.takeSerial();
      this.booted = (this.emu as AvrEmulator).loaded;
      return;
    }
    const r = this.filter.feed(this.emu.takeSerial());
    this.console += r.text;
    if (!this.booted && this.console.includes('>>> ')) this.booted = true;
    if (r.finished) { this.finished = r.finished; (this.emu as PicoEmulator).sendSerial([2]); }
  }

  runCode(code: string) {
    if (this.pi) { this.pi.requestRun(code); return; }
    if (this.kind === 'uno') return;
    this.filter.start();
    this.finished = null;
    this.emu.sendSerial(rawRunBytes(code));
  }

  /** Uno: โหลดโปรแกรมใหม่ (อัปโหลด) — CPU เริ่มจากรีเซ็ต */
  loadHex(hex: string | null) {
    if (this.kind !== 'uno') return;
    this.hex = hex;
    // ชิปที่ไม่มีไฟเลี้ยง: เก็บโปรแกรมไว้ในแฟลช แต่ CPU ยังไม่ทำงานจนกว่า VCC จะพอ
    (this.emu as AvrEmulator).load(this.spec?.chipVcc !== undefined && !this.powered ? null : hex);
    this.console += hex ? '' : '';
  }
}

export class McuCosim {
  private boards = new Map<string, Board>();
  private st: TranState = newTranState();
  private cache = new Map<string, SimResult>();
  /** สถานะรีเลย์ล่าสุด (โหมด DC ที่มี Pico) */
  private relayStates: Record<string, boolean> = {};
  private cacheNl = '';
  private wall0 = 0;
  private mainEmu: { nanos: number } | null = null;
  /** ผลการคำนวณวงจรล่าสุด (แรงดันที่บัส I²C ใช้ตรวจไฟเลี้ยง/ที่อยู่) */
  private lastR: SimResult | null = null;
  /** สถานะขาออกของอุปกรณ์บนบัส I²C (SQW/32K) ครั้งก่อน */
  private lastPinKey = "";
  /** กระแส LED ของ TM1637 ครั้งก่อน */
  private lastTmKey = "";
  private hub = new I2cHub(() => (this.mainEmu ? this.mainEmu.nanos / 1e9 : 0));
  private lcd = new LcdHub();
  private tm = new Tm1637Hub();
  private plcd = new ParLcdHub(() => (this.mainEmu ? this.mainEmu.nanos / 1e9 : 0));
  private enc = new EncoderHub();
  /** เครื่องวิเคราะห์ลอจิกในวงจร */
  private las = new Map<string, LogicCapture>();
  /** เครื่องวิเคราะห์ที่เก็บข้อมูลอยู่ในคำขอปัจจุบัน (ตัวผูก I²C ส่งขอบให้) */
  private curLas: LogicCapture[] = [];

  /** ตัวรัน Python ของบอร์ด Raspberry Pi (มีเฉพาะใน Web Worker ที่รองรับการรอแบบ async) */
  constructor(readonly piHost: PiHost | null = null) {
    this.hub.levels = { v: (net, ref) => (this.lastR?.ok ? voltageBetween(this.lastR, net, ref).value : null) };
    this.lcd.levels = this.hub.levels;
    this.tm.levels = this.hub.levels;
    this.plcd.levels = this.hub.levels;
  }

  /**
   * ผูก TWI ของ ATmega328P (avr8js AVRTWI) กับบัส: ขา A4 = SDA, A5 = SCL (ตาราง Arduino Uno) · TWI ใช้ขาเมื่อเปิด TWEN
   * แต่ละขั้นใช้เวลาตามคาบ SCL (ดู hookTwi) — Wire ของ Arduino รอผลผ่าน interrupt ตามปกติ
   */
  private hookTwi(b: Board) {
    const emu = b.emu as AvrEmulator;
    emu.twiHandler = (twi) => {
      let txn: ReturnType<I2cHub['open']> | null = null;
      // รูปคลื่นบนสายและเวลาที่แต่ละขั้นใช้ตามคาบ SCL = F_CPU / (16 + 2·TWBR·prescaler) — CPU ได้รับแจ้ง "เสร็จ" หลังเวลานั้น
      const wave = new I2cWave();
      b.i2cWave = wave;
      const T = () => 1 / Math.max(1, twi.sclFrequency);
      const now = () => emu.nanos / 1e9;
      const step = (dur: number, done: () => void) => {
        const m = b.spec;
        const edges = wave.take();
        if (m && this.curLas.length) for (const e of edges) { const net = twiNet(m, e.line === 'sda' ? 0 : 1); if (net >= 0) for (const c of this.curLas) c.i2cEdge(net, e.t, e.v); }
        emu.later(dur, done);
      };
      return {
        start: () => { txn?.close(); txn = null; step(wave.start(now(), T()), () => twi.completeStart()); },
        stop: () => { txn?.close(); txn = null; step(wave.stop(now(), T()), () => twi.completeStop()); },
        connectToSlave: (addr: number, write: boolean) => {
          const m = b.spec;
          const sda = twiNet(m, 0), scl = twiNet(m, 1);
          txn = this.hub.open(addr, !write, sda >= 0 ? sda : -2, scl >= 0 ? scl : -2, m ? m.gnd : -1, 'hw');
          const ack = txn.ack;
          step(wave.byte(now(), T(), (addr << 1) | (write ? 0 : 1), ack), () => twi.completeConnect(ack));
        },
        writeByte: (v: number) => { const ack = txn ? txn.write(v) : false; step(wave.byte(now(), T(), v, ack), () => twi.completeWrite(ack)); },
        readByte: (ack: boolean) => { const v = txn ? txn.read() : 0xff; step(wave.byte(now(), T(), v, ack), () => twi.completeRead(v)); },
      };
    };
    if (emu.twi) emu.twi.eventHandler = emu.twiHandler(emu.twi);
    b.twiHooked = true;
  }

  /** ผูก SPI0/SPI1 ของ RP2040 (rp2040js RPSPI) กับจอ: ขา SCK/TX ที่ตั้งเป็นฟังก์ชัน SPI ของ instance นั้นบอกว่าสายคู่ไหน */
  private hookSpi(b: Board) {
    const emu = b.emu as PicoEmulator;
    emu.mcu.spi.forEach((p, inst) => {
      // ไบต์ส่งเสร็จหลังเวลา 8 บิตตามความถี่ SPI ที่ตั้ง (ไม่เสร็จทันที) — DMA ฝั่งรับ (MicroPython ใช้ DMA เมื่อส่ง ≥ 32 ไบต์)
      // จึงอ่าน FIFO ทันก่อนล้น เหมือนฮาร์ดแวร์จริงที่ส่งทีละบิต
      const clk = emu.mcu.clock as unknown as { createAlarm(cb: () => void): { schedule(ns: number): void } };
      const done = clk.createAlarm(() => p.completeTransmit(0));
      p.onTransmit = (value: number) => {
        const m = b.spec;
        if (m && this.lcd.size) {
          let sck = -1, mosi = -1;
          for (let i = 0; i < 30; i++) {
            if (m.gp[i] < 0 || ((i >> 3) & 1) !== inst || emu.mcu.gpio[i].functionSelect !== 1) continue;
            if (i % 4 === 2 && sck < 0) sck = m.gp[i];
            if (i % 4 === 3 && mosi < 0) mosi = m.gp[i];
          }
          if (sck >= 0 && mosi >= 0) this.lcd.byte(sck, mosi, value & 0xff, m.gnd);
        }
        const f = p.clockFrequency;
        // เครื่องวิเคราะห์ลอจิก: สร้างรูปคลื่น SCK/MOSI ของไบต์นี้ตามความถี่และโหมด (SPO/SPH ของ SSPCR0) — ไบต์ต่อกันไม่ทับกัน
        if (m && this.curLas.length && f > 0) {
          let sckN = -1, txN = -1;
          for (let i = 0; i < 30; i++) {
            if (m.gp[i] < 0 || ((i >> 3) & 1) !== inst || emu.mcu.gpio[i].functionSelect !== 1) continue;
            if (i % 4 === 2 && sckN < 0) sckN = m.gp[i];
            if (i % 4 === 3 && txN < 0) txN = m.gp[i];
          }
          const cr0 = (p as unknown as { control0: number }).control0 ?? 0;
          const mode = ((cr0 >> 6) & 1) * 2 + ((cr0 >> 7) & 1);
          const t0 = Math.max(emu.nanos / 1e9, b.spiEnd[inst] ?? 0), T = 1 / f;
          const e = spiByteEdges(t0, T, value & 0xff, mode);
          for (const c of this.curLas) {
            if (sckN >= 0) for (const [t, v] of e.sck) c.spiEdge(sckN, t, v);
            if (txN >= 0) for (const [t, v] of e.data) c.spiEdge(txN, t, v);
          }
          b.spiEnd[inst] = t0 + 8 * T;
        }
        done.schedule(f > 0 ? Math.max(1, (8 * 1e9) / f) : 64);
      };
    });
    b.spiHooked = true;
  }

  /** ผูก I2C0/I2C1 ของ RP2040 (rp2040js RPI2C) กับบัส: ขาที่ตั้งเป็นฟังก์ชัน I²C ของ instance นั้นบอกว่าสายคู่ไหน
   *  แต่ละขั้นใช้เวลาตามคาบ SCL = (HCNT + LCNT) / clk_sys (ค่าที่ SDK ตั้งจาก freq) แล้วจึงแจ้ง "เสร็จ" + ส่งรูปคลื่นให้เครื่องวิเคราะห์ลอจิก */
  private hookI2c(b: Board) {
    const emu = b.emu as PicoEmulator;
    const clk = emu.mcu.clock as unknown as { createAlarm(cb: () => void): { schedule(ns: number): void } };
    emu.mcu.i2c.forEach((p, inst) => {
      let txn: ReturnType<I2cHub['open']> | null = null;
      const nets = () => {
        const m = b.spec;
        if (!m) return null;
        let sda = -1, scl = -1;
        for (let i = 0; i < 30; i++) {
          if (m.gp[i] < 0 || ((i >> 1) & 1) !== inst || emu.mcu.gpio[i].functionSelect !== 3) continue;
          if (i % 2 === 0 && sda < 0) sda = m.gp[i];
          if (i % 2 === 1 && scl < 0) scl = m.gp[i];
        }
        return sda >= 0 && scl >= 0 ? { sda, scl, gnd: m.gnd } : null;
      };
      const wave = new I2cWave();
      b.picoWaves[inst] = wave;
      let pending: (() => void) | null = null;
      const alarm = clk.createAlarm(() => { const f = pending; pending = null; f?.(); });
      const T = () => { const n = p.sclHighPeriod + p.sclLowPeriod; return n > 0 ? n / emu.mcu.clkSys : 1 / 100e3; };
      const now = () => emu.nanos / 1e9;
      const step = (dur: number, done: () => void) => {
        const edges = wave.take();
        const n = nets();
        if (n && this.curLas.length) for (const e of edges) for (const c of this.curLas) c.i2cEdge(e.line === 'sda' ? n.sda : n.scl, e.t, e.v);
        pending = done;
        alarm.schedule(Math.max(1, Math.round(dur * 1e9)));
      };
      p.onStart = () => { txn?.close(); txn = null; step(wave.start(now(), T()), () => p.completeStart()); };
      p.onConnect = (addr, mode) => {
        const n = nets();
        txn = this.hub.open(addr, mode === 1, n ? n.sda : -2, n ? n.scl : -2, n ? n.gnd : -1, 'hw');
        const ack = txn.ack;
        step(wave.byte(now(), T(), ((addr & 0x7f) << 1) | (mode === 1 ? 1 : 0), ack), () => p.completeConnect(ack));
      };
      p.onWriteByte = (v) => { const ack = txn ? txn.write(v) : false; step(wave.byte(now(), T(), v, ack), () => p.completeWrite(ack)); };
      p.onReadByte = (ack) => { const v = txn ? txn.read() : 0xff; step(wave.byte(now(), T(), v, ack), () => p.completeRead(v)); };
      p.onStop = () => { txn?.close(); txn = null; step(wave.stop(now(), T()), () => p.completeStop()); };
    });
    b.i2cHooked = true;
  }

  /**
   * ESP32: ธุรกรรม I²C จาก callback ของ QEMU (เหตุการณ์ของ i2c_event: 0 = START อ่าน, 1/2 = START เขียน, 3 = STOP, 5 = WRITE ไบต์ใน bit 8–15, 6 = READ)
   * ตอบ 0 = ACK · repeated START มาเป็น STOP + START · สายของบัส: ขาที่ GPIO matrix ส่งสัญญาณ I2CEXT0_SCL/SDA (29/30) หรือ I2CEXT1_SCL/SDA (95/96)
   */
  private hookEspI2c(b: Board) {
    const emu = b.esp!;
    let txn: ReturnType<I2cHub['open']> | null = null;
    emu.onI2c = (bus, addr, ev) => {
      const code = ev & 0xff;
      if (code <= 2) {
        txn?.close();
        const n = this.espI2cNets(b, bus);
        txn = this.hub.open(addr, code === 0, n ? n.sda : -2, n ? n.scl : -2, n ? n.gnd : -1, 'hw');
        return txn.ack ? 0 : 1;
      }
      if (code === 3) { txn?.close(); txn = null; return 0; }
      if (code === 5) return txn && txn.write((ev >> 8) & 0xff) ? 0 : 1;
      if (code === 6) return txn ? txn.read() : 0xff;
      return 0;
    };
    b.i2cHooked = true;
  }
  private espI2cNets(b: Board, bus: number) {
    const m = b.spec, emu = b.esp;
    if (!m || !emu) return null;
    const osel = emu.matrix();
    const [sclSig, sdaSig] = bus === 0 ? [29, 30] : [95, 96];
    const scl = osel.findIndex((v) => v === sclSig), sda = osel.findIndex((v) => v === sdaSig);
    return scl >= 0 && sda >= 0 && m.gp[sda] >= 0 && m.gp[scl] >= 0 ? { sda: m.gp[sda], scl: m.gp[scl], gnd: m.gnd } : null;
  }

  reset() {
    this.hub.reset();
    this.lcd.reset();
    this.tm.reset();
    this.plcd.reset();
    this.enc.reset();
    this.lastR = null;
    for (const b of this.boards.values()) { b.pi?.dispose(); b.esp?.dispose(); }
    this.boards.clear();
    restart(this.st);
    this.cache.clear();
    this.relayStates = {};
    this.las.clear();
  }

  /** คำนวณแบบซิงโครนัส (บอร์ด Raspberry Pi ไม่ทำงานในโหมดนี้ — Python ต้องพักแบบ async) */
  handle(req: EngineRequest, cmds: Record<string, McuCommand> = {}, tone?: ToneMeter): EngineResponse & { mcu: McuStatus[] } {
    const g = this.gen(req, cmds, tone, false);
    const r = g.next();
    if (!r.done) throw new Error('cosim: unexpected async step');
    return r.value;
  }

  /** คำนวณโดยให้ Python ของ Raspberry Pi ทำงานตามจุดพัก (await ระหว่างทาง) */
  async handleAsync(req: EngineRequest, cmds: Record<string, McuCommand> = {}, tone?: ToneMeter): Promise<EngineResponse & { mcu: McuStatus[] }> {
    const g = this.gen(req, cmds, tone, true);
    let r = g.next();
    while (!r.done) { await r.value; r = g.next(); }
    return r.value;
  }

  private *gen(req: EngineRequest, cmds: Record<string, McuCommand>, tone: ToneMeter | undefined, canYield: boolean): Generator<Promise<void>, EngineResponse & { mcu: McuStatus[] }, void> {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const deadline = t0 + req.budgetMs;
    const nl = req.netlist;
    const specs = nl.mcus ?? [];
    if (req.restart) this.reset();
    for (const id of [...this.boards.keys()]) if (!specs.some((m) => m.id === id)) { this.boards.get(id)!.pi?.dispose(); this.boards.get(id)!.esp?.dispose(); this.boards.delete(id); }
    const t0Ns = this.boards.size ? [...this.boards.values()][0].emu.nanos : 0;
    for (const m of specs) {
      const kind = m.kind ?? 'pico';
      const old = this.boards.get(m.id);
      // ไฟล์ bg.bin เปลี่ยน = คัดลอกไฟล์ใหม่ลงบอร์ดแล้วรีเซ็ต (บอร์ดเริ่มใหม่)
      // ชิป AVR ต่างรุ่น (Mega ↔ Uno/Nano) = สร้างตัวจำลองใหม่
      // ชิปหรือสัญญาณนาฬิกาต่างกัน (Mega = ATmega2560, Pro Mini 3.3 V = 8 MHz) → avrBoard ต่างกัน
      // Pico W / XIAO RP2040 ใช้เฟิร์มแวร์ต่างจาก Pico → เก็บในช่องเดียวกัน (variant ของบอร์ด)
      const avrBoard = kind === 'uno' && (m.board === 'mega' || m.board === 'promini3' || m.board === 'attiny85') ? m.board : kind === 'pico' && m.fw ? m.fw : null;
      const stale = !old || old.kind !== kind || old.bg !== (m.bg ?? null) || old.avrBoard !== avrBoard;
      if (old && stale) { old.pi?.dispose(); old.esp?.dispose(); }
      if (stale) this.boards.set(m.id, new Board(m.id, kind, t0Ns, m.bg ?? null, canYield ? this.piHost : null, avrBoard));
    }
    const boards = specs.map((m) => this.boards.get(m.id)!);
    for (const b of boards) b.rebootIfPending();
    boards.forEach((b, k) => { b.spec = specs[k]; if (b.rp2 && !b.i2cHooked) this.hookI2c(b); if (b.rp2 && !b.spiHooked) this.hookSpi(b); if (b.esp && !b.i2cHooked) this.hookEspI2c(b); if (b.kind === 'uno' && !b.twiHooked) this.hookTwi(b); });
    this.mainEmu = boards[0].emu;
    // เครื่องวิเคราะห์ลอจิก: ขอบจากขาเอาต์พุตและเฟรม UART ของตัวจำลอง CPU + ระดับจากผลคำนวณวงจรสำหรับเน็ตอื่น
    const las = syncCaptures(this.las, nl.analyzers);
    this.curLas = las;
    const laNets = new Set<number>(las.flatMap((c) => c.spec.ch.filter((n) => n >= 0)));
    const avrOf = (k: number) => (boards[k].kind === 'uno' ? (boards[k].emu as AvrEmulator) : null);
    /** เน็ตที่ระดับมาจากตัวจำลอง CPU โดยตรง (ขาเอาต์พุต, ขา TX/RX ของ UART ฮาร์ดแวร์ที่เปิดอยู่) */
    const laDriven = (net: number): boolean => {
      for (let k = 0; k < specs.length; k++) {
        const b = boards[k];
        if (b.kind === 'rpi5') continue;
        const gp = specs[k].gp;
        const avr = avrOf(k);
        const q = specs[k].board === 'unoq';
        if (avr ? !q && b.chip.uartPins.some(([rx, tx], n) => (avr.uartTxEnabled(n) && gp[tx] === net) || (avr.uartRxEnabled(n) && gp[rx] === net)) : gp[0] === net || gp[1] === net) return true;
        if (avr && avr.twiEnabled && (twiNet(specs[k], 0) === net || twiNet(specs[k], 1) === net)) return true;
        if (b.rp2) { const i = gp.indexOf(net); if (i >= 0 && (b.rp2.mcu.gpio[i].functionSelect === 3 || b.rp2.mcu.gpio[i].functionSelect === 1)) return true; }
        for (let i = 0; i < gp.length; i++) if (gp[i] === net) { const md = b.emu.pinMode(i); if (md === 'out-high' || md === 'out-low') return true; }
      }
      return false;
    };
    boards.forEach((b, k) => {
      if (b.kind === 'rpi5') return;
      const emu2 = b.emu as AvrEmulator | PicoEmulator;
      if (!las.length) { emu2.onTrace = null; return; }
      const gp = specs[k].gp, avr = b.kind === 'uno';
      emu2.onTrace = (e) => {
        if (e.kind === 'pin') { const net = gp[e.i]; if (net >= 0 && laNets.has(net)) for (const c of las) c.mcuEdge(net, e.tNs / 1e9, e.high); return; }
        if (specs[k].board === 'unoq') return; // UNO Q: Serial ไม่ออกขา D0/D1
        const up = avr ? b.chip.uartPins[e.uart ?? 0] : null;
        const net = e.kind === 'tx' ? gp[up ? up[1] : 0] : gp[up ? up[0] : 1];
        if (net >= 0 && laNets.has(net)) for (const c of las) c.uartFrame(net, e.tNs / 1e9, e.bitNs / 1e9, uartFrameBits(e.byte, e.bits, e.parity, e.stop));
      };
    });
    const laT0 = boards[0].emu.nanos / 1e9;
    for (const c of las) {
      c.begin(laT0);
      for (const net of new Set(c.spec.ch)) {
        if (net < 0) continue;
        for (let k = 0; k < specs.length; k++) {
          if (boards[k].kind === 'rpi5') continue;
          const avr = avrOf(k);
          if (avr && avr.twiEnabled && specs[k].twi) { const li = specs[k].twi!.indexOf(net); if (li >= 0) { const w = boards[k].i2cWave; c.setDriven(net, laT0, w ? (li === 0 ? w.sda : w.scl) === 1 : true, 'i2c'); break; } }
          const i = specs[k].gp.indexOf(net);
          if (i < 0) continue;
          const q = specs[k].board === 'unoq';
          if ((avr && !q && boards[k].chip.uartPins.some(([rx, tx], n) => (avr.uartTxEnabled(n) && i === tx) || (avr.uartRxEnabled(n) && i === rx))) || (!avr && (i === 0 || i === 1))) { c.setDriven(net, laT0, true, 'uart'); break; }
          const tp = boards[k].chip.twiPins;
          if (avr && !q && avr.twiEnabled && (i === tp[0] || i === tp[1])) { const w = boards[k].i2cWave; c.setDriven(net, laT0, w ? (i === tp[0] ? w.sda : w.scl) === 1 : true, 'i2c'); break; }
          if (boards[k].rp2 && boards[k].rp2!.mcu.gpio[i].functionSelect === 1) {
            // ขา SPI ฮาร์ดแวร์: SCK ว่าง = CPOL ของ instance นั้น · MOSI ค้างบิตสุดท้าย (ไม่ตั้งใหม่ทุกคำขอ)
            const sp = boards[k].rp2!.mcu.spi[(i >> 3) & 1] as unknown as { control0: number };
            if (i % 4 === 2) c.setDriven(net, laT0, ((sp.control0 >> 6) & 1) === 1, 'spi');
            break;
          }
          if (boards[k].rp2 && boards[k].rp2!.mcu.gpio[i].functionSelect === 3) { const w = boards[k].picoWaves[(i >> 1) & 1]; c.setDriven(net, laT0, w ? (i % 2 === 0 ? w.sda : w.scl) === 1 : true, 'i2c'); break; }
          const md = boards[k].emu.pinMode(i);
          if (md === 'out-high' || md === 'out-low') { c.setDriven(net, laT0, md === 'out-high'); break; }
        }
      }
    }
    const i2cOn = !!nl.i2cs?.length;
    this.hub.sync(nl.i2cs ?? []);
    // ขาออกของ DS3231 (SQW/32K): ต้องหยุด CPU ทุกขอบเฉพาะเมื่อมีสิ่งอื่นต่อกับขานั้น (ขาบอร์ดหรืออุปกรณ์อื่น นอกจากตัวต้านทานดึงขึ้นบนโมดูล)
    {
      const touched = new Set<number>();
      for (const e of nl.elements) {
        if (e.type === 'R' && /#(psqw|p32k)$/.test(e.id)) continue;
        for (const k of ['a', 'b', 'p', 'n', 'c', 'e', 'd', 'g', 's', 'k', 'inp', 'inn', 'out', 'vp', 'vn'] as const) { const v = (e as unknown as Record<string, unknown>)[k]; if (typeof v === 'number') touched.add(v); }
      }
      for (const m of nl.mcus ?? []) for (const g of m.gp) if (g >= 0) touched.add(g);
      for (const l of nl.analyzers ?? []) for (const c of l.ch) if (c >= 0) touched.add(c);
      for (const w of req.watch ?? []) for (const v of Object.values(w as unknown as Record<string, unknown>)) if (typeof v === "number" && v >= 0) touched.add(v);
      this.hub.netUsed = (net) => touched.has(net);
    }
    this.lcd.sync(nl.lcds ?? []);
    const lcdOn = this.lcd.size > 0;
    this.tm.sync(nl.tms ?? []);
    const tmOn = this.tm.size > 0;
    this.plcd.sync(nl.plcds ?? []);
    const plcdOn = this.plcd.size > 0;
    this.enc.sync(nl.encs ?? []);
    const encOn = this.enc.size > 0;
    for (const [id, n] of Object.entries(req.encoder ?? {})) this.enc.turn(id, n, this.mainEmu.nanos / 1e9);
    /** ระดับลอจิกที่ขา MCU ขับให้เน็ต (เอาต์พุต HIGH/LOW) — null = ไม่มีขาเอาต์พุตต่ออยู่ (ลอยหรือเป็นขาเข้า) */
    const drive = (net: number): boolean | null => {
      if (net < 0) return null;
      for (let k = 0; k < specs.length; k++) {
        const gp = specs[k].gp;
        for (let i = 0; i < gp.length; i++) {
          if (gp[i] !== net) continue;
          const md = boards[k].emu.pinMode(i);
          if (md === 'out-high') return true;
          if (md === 'out-low') return false;
        }
      }
      return null;
    };
    this.hub.drive = drive;
    this.hub.onOutputChange = () => { for (const b of boards) (b.emu as { poke?: () => void }).poke?.(); };
    this.lcd.drive = drive;
    this.tm.drive = drive;
    this.plcd.drive = drive;
    for (const [id, evs] of Object.entries(req.touch ?? {})) this.hub.touch(id, evs);
    let encCh = false;
    /** ขาเข้าที่อุปกรณ์ขับโดยตรง (ขา INT ของชิปทัช) */
    const devTick = () => {
      if (tmOn) { this.tm.check(specs[0].gnd, emu.nanos / 1e9); const k = this.tm.key(specs[0].gnd); if (k !== this.lastTmKey) { this.lastTmKey = k; encCh = true; } }
      if (plcdOn) this.plcd.check(specs[0].gnd);
      if (encOn) encCh = this.enc.advance(emu.nanos / 1e9) || encCh;
      if (!i2cOn && !lcdOn) return;
      this.hub.checkResets();
      this.hub.advance();
      // ขา SQW/32K ของ DS3231 เปลี่ยนระดับ: คำนวณจุดปลายช่วงด้วยสถานะใหม่ (เหมือนหน้าสัมผัส encoder)
      if (i2cOn) { const pk = this.hub.pinKey(specs[0].gnd); if (pk !== this.lastPinKey) { this.lastPinKey = pk; encCh = true; } }
      if (lcdOn) this.lcd.check(specs[0].gnd);
    };
    // soft I²C: ขา MCU ที่อยู่บนสาย SDA/SCL ของอุปกรณ์ (ดึงสายลงเมื่อเป็นเอาต์พุต LOW)
    const busPins = new Map<number, Array<[number, number]>>();
    if (i2cOn) for (const [sda, scl] of this.hub.busPairs()) for (const net of [sda, scl]) specs.forEach((m, k) => m.gp.forEach((g, i) => { if (g === net) { const l = busPins.get(net) ?? []; l.push([k, i]); busPins.set(net, l); } }));
    const lowNet = (net: number) => (busPins.get(net) ?? []).some(([k, i]) => boards[k].emu.pinMode(i) === 'out-low');
    const softI2c = () => { if (i2cOn) this.hub.pinLevels(lowNet, () => specs[0].gnd); };
    /** สถานะขา MCU ที่ต่อกับวงจร ยกเว้นขาบนสาย I²C */
    const otherPins = () => specs.map((m, k) => m.gp.map((net, i) => (net >= 0 && used.has(net) && !busPins.has(net) ? boards[k].emu.pinMode(i) : '')).join(',')).join('|');
    // Uno: โปรแกรมในไฟล์งานเปลี่ยน (อัปโหลดใหม่) → โหลดและรีเซ็ต CPU
    for (const m of specs) if (m.kind === 'uno') applyEepromFromFile(m.id, m.eeprom, avrChipOf(m.board).eepromBytes);
    specs.forEach((m, k) => { if (m.kind === 'uno' && boards[k].hex !== (m.hex ?? null)) boards[k].loadHex(m.hex ?? null); });
    const main = boards[0];
    const emu = main.emu;
    // คำสั่งจากผู้ใช้
    for (const b of boards) {
      const c = cmds[b.id];
      if (!c) continue;
      if (b.kind === 'uno') { if (c.reset) b.loadHex(b.hex); if (c.serial?.length) b.emu.sendSerial(c.serial); continue; }
      if (b.pi) { if (c.stop || c.reset) b.pi.requestStop(); if (c.run !== undefined) b.pi.requestRun(c.run); continue; }
      if (c.stop) { b.emu.sendSerial([3, 3]); b.stopPending = b.filter.running; }
      if (c.run !== undefined) b.runCode(c.run);
      if (c.serial?.length) b.emu.sendSerial(c.serial);
    }
    const pis = boards.map((b) => b.pi).filter((x): x is PiEmulator => !!x);
    for (const p of pis) p.poll();
    // บอร์ดที่เพิ่งรีเซ็ต: โปรแกรมเก่ากำลังจบด้วย KeyboardInterrupt (ต้องให้ event loop ทำงาน) — รอสั้น ๆ แล้วเริ่มโปรแกรมใหม่
    for (let k = 0; canYield && k < 100 && pis.some((p) => p.waitingHost); k++) { yield new Promise<void>((r) => setTimeout(r, 1)); for (const p of pis) p.poll(); }
    /** เวลาเหตุการณ์ถัดไปของ Raspberry Pi (ตื่นจาก sleep / ขอบ PWM) — บอร์ดหลักหยุดตรงนั้นเพื่อให้ Python ทำงานตรงเวลา */
    const piNext = () => { let t = Infinity; for (const p of pis) t = Math.min(t, p.nextEvent()); return t; };
    const piPending = () => canYield && pis.some((p) => p.pending);
    for (const b of boards) {
      if (b.kind === 'pico' && b.stopPending && b.filter.running) b.emu.sendSerial([3]);
      else b.stopPending = false;
    }
    const tran = hasReactive(nl);
    const nlKey = JSON.stringify(nl.elements) + JSON.stringify(specs.map((m) => ({ ...m, autorun: null, hex: m.hex ? m.hex.length : null, eeprom: null, bg: m.bg ? m.bg.length : null })));
    if (nlKey !== this.cacheNl) { this.cache.clear(); this.cacheNl = nlKey; }
    const used = usedNets(nl);
    const isUsed = (n: number) => used.has(n);
    const tStartNs = emu.nanos;
    const targetNs = tStartNs + Math.max(0, req.advance) * 1e9;
    const spacing = Math.max(req.sampleSpacing ?? req.advance / 120, req.advance / 8000, 1e-7);
    const samples: Sample[] = [];
    let lastSampleT = -Infinity;
    const pushSample = (t: number, r: SimResult, force = false) => {
      tone?.feed(t, r);
      for (const c of las) c.analog(t, r, laDriven);
      if (force || t - lastSampleT >= spacing) { samples.push({ t, v: readWatch(r, req.watch) }); lastSampleT = t; }
    };
    for (const b of boards) { b.highNs.fill(0); b.edges.fill(0); }
    const instr0 = boards.reduce((a, b) => a + b.emu.instructions, 0);

    const expanded = (): { key: string; nl: Netlist } => {
      const els: NetlistElement[] = [...nl.elements];
      let key = '';
      specs.forEach((m, k) => {
        const modes = boards[k].modes();
        key += modes.map((x, i) => (m.gp[i] >= 0 && used.has(m.gp[i]) ? x : '')).join(',') + '|';
        els.push(...pinElements(m, modes, isUsed));
      });
      if (encOn) { els.push(...this.enc.elements()); key += 'E' + this.enc.key(); }
      if (i2cOn) { const pk = this.hub.pinKey(specs[0].gnd); if (pk) { els.push(...this.hub.elements(specs[0].gnd)); key += 'I' + pk; } }
      if (tmOn) { els.push(...this.tm.elements(specs[0].gnd)); key += 'T' + this.tm.key(specs[0].gnd); }
      // เซอร์โว: กระแสมอเตอร์ขณะเริ่มหมุน/หมุน (ตัวต้านทานเทียบเท่าที่ 4.8 V) — ไฟเลี้ยงตกและแหล่งจ่ายจำกัดกระแสได้จริงเมื่อหลายตัวหมุนพร้อมกัน
      if (tone && nl.servos?.length) {
        key += 'S';
        for (const sv of nl.servos) {
          const st = tone.servoLoad(sv.id);
          key += st.state[0] + Math.round(st.current * 1000);
          if (st.state !== 'hold' && sv.vcc >= 0 && sv.gnd >= 0 && sv.vcc !== sv.gnd) els.push({ type: 'R', id: `${sv.id}#m`, role: 'module', a: sv.vcc, b: sv.gnd, R: 4.8 / Math.max(1e-3, st.current) });
        }
      }
      // รีเลย์มี hysteresis: สถานะก่อนหน้าเป็นส่วนหนึ่งของคำตอบ (คีย์แคชต้องรวมสถานะ)
      const latches = [...(nl.relays ?? []), ...(nl.timers ?? []), ...(nl.gates ?? [])].map((r) => r.id);
      for (const c of nl.counters ?? []) for (let k = 0; k < 10; k++) latches.push(`${c.id}#q${k}`);
      for (const d of nl.drivers ?? []) latches.push(`${d.id}#e`, `${d.id}#h`);
      // 74HC595: รวมทุกสถานะ (บิตและระดับนาฬิกาครั้งก่อน) — คำตอบที่เก็บไว้จึงตรงกับการแก้ใหม่ทุกครั้ง
      for (const s of nl.shiftregs ?? []) for (const x of ['sck', 'rck', 'oe', ...Array.from({ length: 8 }, (_, k) => `s${k}`), ...Array.from({ length: 8 }, (_, k) => `o${k}`)]) latches.push(`${s.id}#${x}`);
      for (const e of nl.elements) if (e.type === 'R' && e.fuse) latches.push(`${e.id}#blown`);
      for (const c of nl.scrs ?? []) latches.push(c.id);
      for (const c of nl.comps ?? []) latches.push(c.id);
      if (latches.length) key += 'R' + latches.map((id) => (this.relayStates[id] ? 1 : 0)).join('');
      return { key, nl: { ...nl, nodeCount: nl.nodeCount, elements: els } };
    };
    /** ตั้งขาเข้าและ ADC จากแรงดันที่คำนวณได้ */
    const applyInputs = (r: SimResult) => {
      if (!r.ok) return;
      specs.forEach((m, k) => {
        const b = boards[k];
        let E: { vih: number; vil: number } = pinElec(b.kind, m.board ?? m.fw);
        if (m.chipVcc !== undefined) {
          const avr = b.emu as AvrEmulator;
          const vcc = m.chipVcc >= 0 && m.gnd >= 0 ? voltageBetween(r, m.chipVcc, m.gnd).value ?? 0 : 0;
          b.vcc = vcc;
          const vr = m.rst !== undefined && m.rst >= 0 ? voltageBetween(r, m.rst, m.gnd).value : null;
          const rstLow = vr !== null && vr < 0.45 * vcc;
          const ok = (b.powered ? vcc >= CHIP_VMIN_OFF : vcc >= CHIP_VMIN_ON) && !rstLow;
          if (ok !== b.powered) { b.powered = ok; avr.load(ok ? b.hex : null); }
          b.rstLow = rstLow;
          avr.setVcc(vcc);
          E = { vih: 0.55 * vcc, vil: 0.45 * vcc };
        } else if (m.board !== 'unoq' && m.vbus >= 0 && m.gnd >= 0 && b.emu && 'setVcc' in (b.emu as object)) {
          // บอร์ด AVR (Uno/Nano/Mega/Pro Mini): ADC อ้างอิง AVCC ซึ่งต่อกับราง 5V ของบอร์ด — แรงดันตกที่ราง (โหลดหนัก เช่น ฮีตเตอร์ MQ-2) จึงไม่ทำให้ค่า analogRead ของเซนเซอร์แบบอัตราส่วนเพี้ยน
          const v5 = voltageBetween(r, m.vbus, m.gnd).value;
          if (v5 !== null && v5 > 1) (b.emu as AvrEmulator).setVcc(v5);
        }
        // UNO Q: ADC อ้างอิง 3.3 V — ตัวจำลอง CPU (ADC อ้างอิง 5 V) จึงได้แรงดันที่ปรับสเกลให้ค่า analogRead ตรงกับบอร์ดจริง (10 บิต)
        const adcScale = m.board === 'unoq' ? 5 / 3.3 : 1;
        m.gp.forEach((net, i) => {
          if (net < 0 || b.uartPin(i)) return;
          const v = voltageBetween(r, net, m.gnd).value;
          const mode = b.emu.pinMode(i);
          let high = false;
          // ขาเข้าที่ไม่มีตัวต้านทานดึงขึ้น/ลงและไม่มีสิ่งใดขับ (เช่น ต่อแค่ปุ่มที่ปล่อยอยู่) = ลอย:
          // ประจุที่ค้างที่ขา CMOS ทำให้อ่านค่าเดิมค้างอยู่ (ของจริงเปลี่ยนเองแบบสุ่มเมื่อมีสัญญาณรบกวน) — บันทึกไว้แจ้งเตือน
          if (v === null) { high = mode === 'in-pullup' || mode === 'out-high' || (mode === 'in' && !!b.lastLevel[i]); if (mode === 'in' && !busPins.has(net)) b.floating.add(i); else b.floating.delete(i); }
          else { b.floating.delete(i); }
          if (v !== null) high = b.lastLevel[i] ? v > E.vil : v > E.vih;
          // สาย I²C (soft I²C): ระดับแบบ wired-AND — ต่ำเมื่อมีผู้ดึงลง (ขา MCU เป็นเอาต์พุต LOW หรืออุปกรณ์ตอบ ACK/บิต 0)
          // สูงเมื่อไม่มีผู้ดึงและมีโมดูลที่มีไฟเลี้ยง (ตัวต้านทานดึงขึ้น) — ไม่ต้องคำนวณวงจรใหม่ทุกขอบคล็อก
          if (busPins.has(net)) high = !lowNet(net) && !this.hub.pulledLow(net) && (this.hub.lineHasPullUp(net, m.gnd) || mode === 'in-pullup');
          if (i2cOn) { const dv = this.hub.driven(net, m.gnd); if (dv !== null) high = dv; }
          if (tmOn && !mode.startsWith('out')) { const dv = this.tm.driven(net, m.gnd); if (dv !== null) high = dv; }
          if (plcdOn && !mode.startsWith('out')) { const dv = this.plcd.driven(net, m.gnd); if (dv !== null) high = dv; }
          b.lastLevel[i] = high ? 1 : 0;
          b.emu.setInput(i, high);
          const ch = b.adcChannel(i);
          if (ch >= 0) b.emu.setAdc(ch, Math.min(5, (v ?? 0) * adcScale));
        });
      });
    };
    /** สถานะ HIGH ของขาก่อนช่วงเวลาที่จะเดิน (ใช้สะสม duty) */
    const highNow = () => boards.map((b) => Array.from({ length: b.pinCount }, (_, i) => b.emu.pinMode(i) === 'out-high'));
    const accHigh = (before: boolean[][], dtNs: number) => {
      boards.forEach((b, k) => { b.countEdges(before[k]); for (let i = 0; i < b.pinCount; i++) if (before[k][i]) b.highNs[i] += dtNs; });
    };
    const runBoards = (until: number, stopOnPin: boolean) => {
      // บอร์ดหลักกำหนดเวลา บอร์ดอื่นวิ่งตามให้ถึงเวลาเดียวกัน
      const r = emu.run(until, deadline, stopOnPin);
      for (const b of boards) if (b !== main) b.emu.run(emu.nanos, Infinity, false);
      for (const b of boards) b.pump();
      return r;
    };

    let result: SimResult | null = null;
    let reached = true;
    let steps = 0;
    if (!tran) {
      const weights = new Map<string, number>();
      let events = 0;
      for (;;) {
        const ex = expanded();
        let r = this.cache.get(ex.key);
        if (!r) { r = solveDC(ex.nl, { relayStates: this.relayStates }); delete r.x; this.cache.set(ex.key, r); }
        if (r.relayStates) this.relayStates = { ...r.relayStates };
        steps++;
        this.lastR = r;
        applyInputs(r);
        result = r;
        const ta = emu.nanos;
        const hi = highNow();
        pushSample(ta / 1e9, r, true);
        if (piPending()) {
          for (const p of pis) if (p.pending) yield p.resume();
          for (const b of boards) b.pump();
          if (now() > deadline || ++events > MAX_EVENTS) { reached = emu.nanos >= targetNs; weights.set(ex.key, (weights.get(ex.key) ?? 0) + 1e-9); break; }
          continue;
        }
        if (emu.nanos >= targetNs) { weights.set(ex.key, (weights.get(ex.key) ?? 0) + 1e-9); break; }
        const evT = Math.min(i2cOn ? this.hub.nextEvent() : Infinity, encOn ? this.enc.nextEvent() : Infinity, piNext());
        const evNs = isFinite(evT) ? Math.ceil(evT * 1e9) : Infinity;
        const why = runBoards(Math.min(targetNs, Math.max(evNs, emu.nanos + 1)), true);
        softI2c();
        devTick();
        const dt = emu.nanos - ta;
        weights.set(ex.key, (weights.get(ex.key) ?? 0) + dt);
        accHigh(hi, dt);
        pushSample(emu.nanos / 1e9, r);
        if (why === 'deadline' || ++events > MAX_EVENTS) { reached = emu.nanos >= targetNs; break; }
        if (why === 'target' && emu.nanos >= targetNs) break;
      }
      // ค่าเฉลี่ยถ่วงเวลา (เหมือนมัลติมิเตอร์ที่เฉลี่ยค่าในช่วงวัด)
      result = averageResults([...weights].map(([k, w]) => [this.cache.get(k)!, w]), result!);
      const fin = expanded();
      const rNow = this.cache.get(fin.key) ?? solveDC(fin.nl, { relayStates: this.relayStates });
      if (rNow.relayStates) this.relayStates = { ...rNow.relayStates };
      applyInputs(rNow);
    } else {
      if (this.st.t === 0 && emu.nanos > 0) this.st.t = emu.nanos / 1e9;
      // ช่วงอ่านขาเข้าแบบปรับได้: ระดับขาเข้า/ค่า ADC ไม่เปลี่ยน → ขยายช่วงเป็นสองเท่า (สูงสุด 4 ms) · เปลี่ยน → กลับเป็น 50 µs ทันที
      // (ขอบ ECHO ของ HC-SR04 และสัญญาณ DHT22 ใช้เหตุการณ์แยก — ไม่ขึ้นกับช่วงนี้) ลดงานคำนวณวงจรตามเวลาเมื่อขาเข้านิ่ง เช่น ปุ่มที่ไม่ได้กด
      let q = QUANTUM;
      let lastSig = '';
      // ขยายควอนตัมเฉพาะวงจรที่ไม่มีเหตุการณ์จังหวะละเอียดระดับ µs (HC-SR04/DHT22) — มิฉะนั้น time_pulse_us พลาดขอบ ECHO
      const adaptive = !nl.sonars?.length && !nl.dhts?.length;
      const inputSig = (r: SimResult) => specs.map((m, k) => m.gp.map((net, i) => {
        if (net < 0 || i <= 1 || !used.has(net)) return '';
        const isAdc = boards[k].adcChannel(i) >= 0;
        if (!isAdc && !boards[k].emu.pinMode(i).startsWith('in')) return '';
        const v = voltageBetween(r, net, m.gnd).value ?? 0;
        return isAdc ? Math.round(v * 200) : v > 1.65 ? 1 : 0;
      }).join(',')).join('|');
      for (let guard = 0; guard < MAX_EVENTS; guard++) {
        if (piPending()) {
          const pinsBefore = otherPins();
          for (const p of pis) if (p.pending) yield p.resume();
          for (const b of boards) b.pump();
          // Python เปลี่ยนขา (เช่น เปิดตัวดึงขึ้น) ณ เวลานี้: คำนวณวงจรทันทีให้ขาเข้าได้ค่าใหม่ก่อน Python อ่านต่อ
          if (otherPins() !== pinsBefore) {
            const inst = advance(expanded().nl, this.st, emu.nanos / 1e9, { deadline: Infinity, maxSteps: 10 });
            if (inst.ok) { this.lastR = inst.result; result = inst.result; applyInputs(inst.result); }
          }
          if (result && now() > deadline) { reached = false; break; }
        }
        const ex = expanded();
        // ต้องอัปเดตขาเข้าถี่ ๆ เฉพาะเมื่อมีขาเข้า (หรือขา ADC GP26–28) ที่ต่อกับวงจร
        const needInputs = specs.some((m, k) => m.gp.some((net, i) => net >= 0 && i > 1 && used.has(net) && (i >= 26 || boards[k].emu.pinMode(i).startsWith('in'))));
        // หยุด CPU ตรงขอบ ECHO ของ HC-SR04 ด้วย (ขาเข้าได้ค่าใหม่ทันที — วัดความกว้างพัลส์ได้ละเอียดระดับ µs)
        const ev = Math.min(nextSonarEvent(this.st, emu.nanos / 1e9), i2cOn ? this.hub.nextEvent() : Infinity, encOn ? this.enc.nextEvent() : Infinity, piNext());
        const tSeg = Math.min(targetNs, emu.nanos + (needInputs ? q : QUANTUM_OUT_ONLY) * 1e9, isFinite(ev) ? Math.ceil(ev * 1e9) : Infinity);
        const ta = emu.nanos;
        const hi = highNow();
        const before = otherPins();
        const modesBefore = boards.map((b) => b.modes());
        const why = emu.nanos < targetNs ? runBoards(tSeg, true) : 'target';
        softI2c();
        devTick();
        accHigh(hi, emu.nanos - ta);
        // ขาที่เปลี่ยนเป็นขาบนสาย I²C เท่านั้น (soft I²C เช่น i2c.scan()): สายต่อแค่ตัวต้านทานดึงขึ้น ไม่กระทบส่วนอื่นของวงจร
        // → ไม่ต้องคำนวณวงจรตามเวลาที่ขอบคล็อกนี้ (ช่วงเวลารวมไปคำนวณในก้าวถัดไป) แค่ป้อนระดับสายให้ CPU
        // (ใช้กับขาที่ไม่ได้ต่อกับวงจรด้วย เช่น CS/DC ของจอที่ต่อแค่ขาเข้าลอจิก)
        if (why === 'pin' && !encCh && otherPins() === before && emu.nanos < targetNs && this.lastR) { applyInputs(this.lastR); continue; }
        // หน้าสัมผัส encoder เปลี่ยนตรงปลายช่วงนี้: คำนวณจุดปลายด้วยสถานะใหม่ ขาเข้าได้ระดับใหม่ทันที
        const exN = encCh ? expanded() : ex;
        encCh = false;
        const out = advance(exN.nl, this.st, emu.nanos / 1e9, { deadline: Infinity, maxSteps: 2000, onSample: (t, r) => pushSample(t, r) });
        steps += out.steps;
        result = out.result;
        if (!out.ok) { reached = false; break; }
        this.lastR = out.result;
        applyInputs(out.result);
        // ขาเอาต์พุตเพิ่งถูกปล่อยเป็นขาเข้า (เช่น บัสสายเดียว open-drain ของ DHT): ช่วงที่เพิ่งเดินคำนวณด้วยโหมดเดิม
        // → คำนวณวงจร ณ เวลานี้ด้วยโหมดใหม่ทันที ไม่งั้นขาเข้าอ่านระดับเก่า (ต่ำ) ไปจนจบช่วงถัดไป — DHT ตอบเร็วกว่านั้น (≤ 100 µs)
        // เซอร์โว: ความกว้างพัลส์วัดจากเวลาขอบ — ช่วงที่เพิ่งเดินคำนวณด้วยระดับขาเดิมถึงเวลาขอบ จึงต้องคำนวณ ณ เวลาขอบด้วยระดับใหม่ทันที
        // (ไม่งั้นขอบถูกเห็นช้าไปหนึ่งก้าวของตัวแก้สมการ พัลส์คลาดได้หลายสิบ µs → เซอร์โวกระตุกเกินแถบไม่ตอบสนอง 10 µs)
        if (why === 'pin' && nl.servos?.length) {
          const inst = advance(expanded().nl, this.st, emu.nanos / 1e9, { deadline: Infinity, maxSteps: 10 });
          if (inst.ok) { this.lastR = inst.result; result = inst.result; applyInputs(inst.result); pushSample(emu.nanos / 1e9, inst.result); }
        } else if (why === 'pin' && boards.some((b, k) => { const now2 = b.modes(); return specs[k].gp.some((net, i) => net >= 0 && used.has(net) && modesBefore[k][i]?.startsWith('out') && now2[i]?.startsWith('in')); })) {
          const inst = advance(expanded().nl, this.st, emu.nanos / 1e9, { deadline: Infinity, maxSteps: 10 });
          if (inst.ok) { this.lastR = inst.result; result = inst.result; applyInputs(inst.result); }
        }
        if (needInputs) {
          const sig = inputSig(out.result);
          q = adaptive && sig === lastSig && why !== 'pin' ? Math.min(q * 2, QUANTUM_IDLE_MAX) : QUANTUM;
          lastSig = sig;
        }
        if (emu.nanos >= targetNs) break;
        if (why === 'deadline' || now() > deadline) { reached = false; break; }
      }
      if (result) { result = { ...result }; delete result.x; }
    }
    const dtNs = emu.nanos - tStartNs;
    const wall = now() - t0;
    const instr = boards.reduce((a, b) => a + b.emu.instructions, 0) - instr0;
    const status: McuStatus[] = boards.map((b) => {
      const pins = b.modes();
      const duty = pins.map((p, i) => (dtNs > 0 ? b.highNs[i] / dtNs : p === 'out-high' ? 1 : 0));
      const c = b.console;
      b.console = '';
      const fin = b.finished;
      b.finished = null;
      const ee = b.kind === 'uno' ? eepromOf(b.id, b.chip.eepromBytes) : null;
      const eeprom = ee?.dirty ? (ee.dirty = false, { eeprom: bytesToB64(ee.memory) }) : {};
      const py = b.pi ? { py: { state: b.pi.host?.state ?? 'failed', ...(b.pi.host?.error ? { error: b.pi.host.error } : {}) } as McuStatus['py'] } : {};
      const chip = b.spec?.chipVcc !== undefined ? { chip: { vcc: b.vcc, powered: b.powered, rst: b.rstLow } } : {};
      return { ...py, ...eeprom, ...chip, id: b.id, kind: b.kind, console: c, running: b.pi ? b.pi.running : b.kind === 'uno' ? b.booted : b.filter.running, finished: fin, booted: b.booted, pins, duty, edges: Array.from(b.edges.subarray(0, b.pinCount)), led: b.kind === 'uno' ? duty[13] : b.kind === 'rpi5' ? 1 : b.avrBoard === 'picow' || b.avrBoard === 'xiao' || b.avrBoard === 'esp32' ? 0 : b.avrBoard === 'nanoconnect' ? duty[6] : duty[25], ...xiaoLeds(b, pins, duty), mips: wall > 0 ? instr / wall / 1e3 : 0, ratio: wall > 0 ? dtNs / 1e6 / wall : 0 };
    });
    if (lcdOn && result) {
      const tNow = emu.nanos / 1e9;
      // ไฟพื้นหลัง: ขา BL ที่ขา MCU ขับ → สัดส่วนเวลา HIGH (PWM หรี่ได้) · ต่อกับไฟเลี้ยง → แรงดัน/3.3 V · ลอย → สว่าง (ตัวต้านทานดึงขึ้นบนโมดูล)
      const bl = (sp: { bl: number; gnd: number }) => {
        for (let k = 0; k < specs.length; k++) {
          const i = specs[k].gp.indexOf(sp.bl);
          if (sp.bl < 0 || i < 0) continue;
          const md = boards[k].emu.pinMode(i);
          if (md === 'out-high' || md === 'out-low') return dtNs > 0 ? boards[k].highNs[i] / dtNs : md === 'out-high' ? 1 : 0;
        }
        const v = result && result.ok ? voltageBetween(result, sp.bl, sp.gnd).value : null;
        return v === null ? 1 : Math.max(0, Math.min(1, v / 3.3));
      };
      result = { ...result, lcd: this.lcd.snapshot(specs[0].gnd, bl, tNow) };
    }
    if (tmOn && result) result = { ...result, seg: this.tm.snapshot(specs[0].gnd) };
    if (plcdOn && result) result = { ...result, plcd: this.plcd.snapshot(specs[0].gnd) };
    if (result && boards.some((b) => b.floating.size)) result = { ...result, floating: Object.fromEntries(boards.filter((b) => b.floating.size).map((b) => [b.id, [...b.floating].sort((a, c) => a - c)])) };
    if (encOn && result) result = { ...result, enc: this.enc.snapshot() };
    if (i2cOn && result) {
      this.hub.powerCheck(specs[0].gnd);
      result = { ...result, i2c: this.hub.snapshot(specs[0].gnd) };
      const log = this.hub.takeLog();
      if (log.length) status[0].i2c = log;
    }
    // รันโค้ดอัตโนมัติหลังบูต (เหมือน main.py)
    specs.forEach((m, k) => {
      const b = boards[k];
      if ((b.kind === 'pico' || b.kind === 'rpi5') && b.booted && !b.autorunDone) { b.autorunDone = true; if (m.autorun) b.runCode(m.autorun); }
    });
    if (!samples.length && result) samples.push({ t: emu.nanos / 1e9, v: readWatch(result, req.watch) });
    void this.wall0;
    const logic = las.length ? Object.fromEntries(las.map((c) => { if (result) c.analog(emu.nanos / 1e9, result, laDriven); return [c.spec.id, c.end(emu.nanos / 1e9)]; })) : undefined;
    return { seq: req.seq, mode: 'tran', result: result!, t: emu.nanos / 1e9, reached: reached && emu.nanos >= targetNs, samples, steps, mcu: status, ...(logic ? { logic } : {}) };
  }
}

/** สร้าง/อัปเดตตัวเก็บสัญญาณตามเครื่องวิเคราะห์ในเน็ตลิสต์ (เน็ตเปลี่ยน = เริ่มเก็บช่องนั้นใหม่) */
export function syncCaptures(map: Map<string, LogicCapture>, specs: AnalyzerSpec[] | undefined): LogicCapture[] {
  const list = specs ?? [];
  for (const id of [...map.keys()]) if (!list.some((a) => a.id === id)) map.delete(id);
  return list.map((a) => {
    let c = map.get(a.id);
    if (!c || c.spec.ch.join() !== a.ch.join() || c.spec.gnd !== a.gnd) { c = new LogicCapture(a); map.set(a.id, c); }
    return c;
  });
}

/** เฉลี่ยค่าของอุปกรณ์และแรงดันโหนดตามน้ำหนักเวลา */
export function averageResults(list: Array<[SimResult, number]>, fallback: SimResult): SimResult {
  const ok = list.filter(([r, w]) => r.ok && w > 0);
  if (!ok.length) return fallback;
  if (ok.length === 1) return ok[0][0];
  const W = ok.reduce((a, [, w]) => a + w, 0);
  const base = ok[ok.length - 1][0];
  const elements: Record<string, ElementResult> = {};
  for (const id of Object.keys(base.elements)) {
    const e: ElementResult = { ...base.elements[id], current: 0, voltage: 0, power: 0 };
    let extra: Record<string, number> | undefined;
    for (const [r, w] of ok) {
      const x = r.elements[id];
      if (!x) continue;
      e.current += (x.current * w) / W; e.voltage += (x.voltage * w) / W; e.power += (x.power * w) / W;
      if (x.extra) { extra ??= {}; for (const [k, v] of Object.entries(x.extra)) extra[k] = (extra[k] ?? 0) + (v * w) / W; }
    }
    if (extra) e.extra = { ...base.elements[id].extra, ...extra, ...(base.elements[id].extra?.region !== undefined ? { region: base.elements[id].extra!.region } : {}) };
    elements[id] = e;
  }
  const nodeVoltage = base.nodeVoltage.map((v, i) => {
    if (v === null) return null;
    let s = 0;
    for (const [r, w] of ok) { const x = r.nodeVoltage[i]; if (x === null) return v; s += ((x as number) * w) / W; }
    return s;
  });
  return { ...base, elements, nodeVoltage };
}

export type { WatchItem };
