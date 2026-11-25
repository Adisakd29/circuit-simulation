import { computeConnectivity, netLinked, netOfPin, type Connectivity } from '../connectivity/connectivity';
import type { CircuitDoc, PartKind, WaveShape } from '../model/types';
import type { I2cSpec } from '../mcu/i2c-bus';
import type { LcdSpec } from '../mcu/spi-bus';
import { buildSensorNet } from '../model/sensors';
import { OPAMP_DC_TYP, pirInView, PIR_WARMUP, LM393_CHANNELS, ntcResistance, SCR_GATE_DIODE, SCR_ON_DIODE, vomInternalR, vomPosition, STEPPER_INPUTS, HC595_OUTS, sonarEchoWidth, L293D_CHANNELS, lm35Vout, soilVout, dht22Bytes, dht11Bytes, irDetected, CD4017_OUTS, PICO_GPIO, XIAO_GPIO, NANOCONNECT_GPIO, ESP32DK_GPIO, UNO_DIGITAL, NANO_DIGITAL, ATTINY85_DIGITAL, MEGA_DIGITAL, RPI_GPIO_PINS, SEG_NAMES, SEG_PINS, diodeParamsFor, ldrResistance, ledParamsFor, ledIsFor, RGB_CH, logicGates, transformerModel, KEYPAD_KEYS } from '../model/catalog';

/**
 * Netlist — รูปแบบกลางที่ส่งให้ solver (ส่งข้าม Web Worker ได้, ไม่มีอ้างอิงถึง 3D)
 * หมายเลขโหนด = index ของเน็ตจาก connectivity
 * ในอนาคตสามารถแปลง netlist นี้เป็นข้อความ SPICE ให้ ngspice ได้ (ดู toSpice)
 */

export type NetlistElement =
  | { type: 'R'; id: string; role: 'resistor' | 'switch' | 'ammeter' | 'scope' | 'pot' | 'button' | 'buzzer' | 'ldr' | 'sevenseg' | 'contact' | 'module' | 'meter'; a: number; b: number; R: number;
      /** ฟิวส์ (A): กระแสเกิน 1.5 เท่าของพิกัด → ขาด (สถานะใน relayStates `${id}#blown` ค้างจนเริ่มจำลองใหม่) */
      fuse?: number }
  | { type: 'SUPPLY'; id: string; p: number; n: number; V: number; Rint: number; Ilim: number }
  | { type: 'LED'; id: string; a: number; k: number; Is: number; n: number; Rs: number; Bv?: number; Ibv?: number }
  /** ไดโอดทั่วไป/ซีเนอร์: Shockley + Rs + การพังทลายย้อนกลับที่ Bv (กระแส Ibv ที่ v = −Bv) */
  | { type: 'D'; id: string; a: number; k: number; Is: number; n: number; Rs: number; Bv: number; Ibv: number;
      /** แหล่งกระแสควบคุมด้วยกระแสไดโอด (ออปโตคัปเปลอร์): กระแส gain × I_D ไหลออกจากโหนด p เข้าโหนด q */
      ctl?: { p: number; q: number; gain: number } }
  /** ทรานซิสเตอร์ BJT แบบ Ebers–Moll (transport) pol = 1 NPN, −1 PNP */
  | { type: 'BJT'; id: string; c: number; b: number; e: number; pol: 1 | -1; Is: number; bf: number; br: number }
  /** MOSFET ชนิดเสริม (enhancement) ระดับ 1 (Shichman–Hodges) ต่อเนื่องในย่านใต้ขีดเริ่ม pol = 1 ช่อง N, −1 ช่อง P
   *  vth > 0 เสมอ (สำหรับช่อง P ใช้ขนาดของ Vth); ไดโอดในตัว (body diode) แยกเป็นอุปกรณ์ D ต่างหาก */
  | { type: 'MOS'; id: string; d: number; g: number; s: number; pol: 1 | -1; vth: number; kp: number; lambda: number }
  /** ออปแอมป์เชิงพฤติกรรม: ขยาย A·(V+ − V−) รอบกึ่งกลางไฟเลี้ยง จำกัดด้วยไฟเลี้ยง − headroom, ขาออกมี Rout */
  | { type: 'OPAMP'; id: string; inp: number; inn: number; out: number; vp: number; vn: number; A: number; Rout: number; headroom: number; Rin: number; Rq: number; gbw: number; sr: number }
  | { type: 'C'; id: string; a: number; b: number; C: number; v0: number }
  | { type: 'L'; id: string; a: number; b: number; L: number; R: number; motor?: MotorMech }
  /** เครื่องกำเนิดสัญญาณ: แหล่งแรงดันตามเวลา v(t) ต่ออนุกรม Rout */
  | { type: 'FGEN'; id: string; p: number; n: number; wave: WaveShape; freq: number; vpp: number; offset: number; Rout: number;
      /** จุดต่อคาบที่ใช้จำกัดก้าวเวลา (ไม่ระบุ = 64) — แหล่งที่ต่อกับวงจรตัวต้านทานล้วนใช้น้อยกว่าได้โดยค่าที่จุดคำนวณยังตรง */
      ppc?: number };

/**
 * ไมโครคอนโทรลเลอร์ (Raspberry Pi Pico) — solver ไม่รู้จักโดยตรง: engine จำลอง CPU แล้ว "ขยาย" เป็นแหล่งแรงดัน
 * ตามสถานะขาในขณะนั้น (ดู src/mcu/cosim.ts) gp[i] = เน็ตของ GPi (−1 = ไม่มีขานั้นบนบอร์ด)
 */
/**
 * ไมโครคอนโทรลเลอร์: pico = GP0–GP28 (gp ยาว 29), uno = D0–D13 + A0–A5 (gp ยาว 20)
 * v33/vbus/vsys/vref: Pico = 3V3/VBUS/VSYS/ADC_VREF · Uno = 3.3V/5V/VIN/AREF · hex = โปรแกรมของ Uno (null = ยังไม่อัปโหลด)
 */
export interface McuSpec { id: string; kind?: 'pico' | 'uno' | 'rpi5'; /** บอร์ด ATmega328P รุ่น Nano (ตัวจำลองเดียวกับ Uno, ขา 22 ขา) */ board?: 'nano' | 'unoq' | 'mega' | 'promini' | 'promini3' | 'attiny85';
  /** ชิปเดี่ยวที่รับไฟจากวงจร (ATtiny85): เน็ตขา VCC — CPU ทำงานเมื่อ VCC พอ, ขาออกเป็นตัวต้านทานไปยัง VCC/GND */ chipVcc?: number;
  /** ขา RESET ของชิป (ดึงต่ำ = รีเซ็ต) */ rst?: number;
  /** บอร์ด RP2040: เฟิร์มแวร์ของรุ่น Pico W (ปิดส่วนไร้สาย) หรือ XIAO RP2040 (นิยามบอร์ด SEEED_XIAO_RP2040 + NeoPixel บนบอร์ด) */ fw?: 'picow' | 'xiao' | 'nanoconnect' | 'esp32';
  /** UNO Q: เน็ต SDA/SCL ของ Wire (I2C2 ที่หัวต่อ SDA/SCL — ไม่ใช่ A4/A5 แบบ Uno R3) */ twi?: [number, number];
  /** UNO Q: กระแสที่แหล่งจ่าย USB-C จ่ายได้ (A) */ usbLimit?: number;
  gnd: number; v33: number; vbus: number; vsys: number; vref: number; gp: number[]; autorun: string | null; hex?: string | null;
  /** Uno: EEPROM จากไฟล์งาน (base64 1 KB) */
  eeprom?: string | null;
  /** Pico: ไฟล์ bg.bin ของผู้ใช้ (240×240 RGB565 ไบต์สูงก่อน, base64) — ไม่มี = รูปเริ่มต้นในอิมเมจ */
  bg?: string | null }

export interface Netlist {
  nodeCount: number;
  elements: NetlistElement[];
  /** ไมโครคอนโทรลเลอร์ในวงจร (ถ้ามี) */
  mcus?: McuSpec[];
  /** id ของ element ที่ต้องวัดความถี่กระแส (บัซเซอร์) */
  tones?: string[];
  /** รีเลย์: ขดลวดเป็น element (coilId) หน้าสัมผัสถูกใส่ตามสถานะใน solveDC */
  relays?: RelaySpec[];
  /** ไอซี 555 (สถานะฟลิปฟล็อปเก็บรวมกับสถานะรีเลย์ใน relayStates) */
  timers?: TimerSpec[];
  /** id หม้อแปลง (วัด rms ทุกก้าว) */
  transformers?: string[];
  /** เซอร์โว: วัดความกว้างพัลส์ที่ขาสัญญาณทุกก้าว แล้วหมุนตามเวลา (ใน ToneMeter) */
  servos?: ServoSpec[];
  steppers?: StepperSpec[];
  /** เกตตรรกะ (สถานะขาออกเก็บร่วมกับสถานะรีเลย์ใน relayStates — แก้แบบจุดตรึงใน solveDC) */
  gates?: GateSpec[];
  /** ไอซีนับ CD4017 (สถานะนับเก็บร่วมกับสถานะรีเลย์ใน relayStates: one-hot `#q0..9` + ระดับ CLK/INH ก่อนหน้า) */
  counters?: CounterSpec[];
  shiftregs?: ShiftSpec[];
  /** ไทริสเตอร์: ทาง A–K ใส่ใน solveDC ตามสถานะค้าง (relayStates[id]) — ขา G–K เป็นไดโอดถาวร `${id}#gk` */
  scrs?: ScrSpec[];
  comps?: CompSpec[];
  /** ไดรเวอร์ครึ่งสะพาน (L293D) — สถานะ เปิดใช้/สูง เก็บใน relayStates (`#e`, `#h`) แก้แบบจุดตรึงใน solveDC */
  drivers?: DriverSpec[];
  /** โมดูลวัดระยะ HC-SR04 — สถานะตามเวลาอยู่ใน TranState.sonar (ดู transient.ts) */
  sonars?: SonarSpec[];
  soils?: SoilSpec[];
  dhts?: DhtSpec[];
  pirs?: PirSpec[];
  /** อุปกรณ์บนบัส I²C (จอ OLED, RTC, MPU6050) — ทำงานเมื่อมีไมโครคอนโทรลเลอร์ใน co-simulation */
  i2cs?: I2cSpec[];
  lcds?: LcdSpec[];
  /** จอ 7 ส่วน TM1637 (ถอดรหัสจากระดับขา CLK/DIO ใน co-simulation) */
  tms?: import('../mcu/tm1637').Tm1637Spec[];
  /** จอ LCD 16×2 แบบขนาน (ถอดรหัสจากระดับขา RS/RW/E/D0–D7 ใน co-simulation) */
  plcds?: import('../mcu/hd44780-par').ParLcdSpec[];
  /** rotary encoder: หน้าสัมผัส A/B ปิดตามลำดับเวลาที่ผู้ใช้หมุน (co-simulation เพิ่มตัวต้านทานหน้าสัมผัสตามเวลา) */
  encs?: EncoderSpec[];
  pumps?: PumpSpec[];
  /** มัลติมิเตอร์: element ที่วัด (แรงดันตกคร่อม หรือกระแสผ่าน) — ToneMeter หาค่าเฉลี่ย/ค่า AC ตามเวลา */
  meters?: MeterSpec[];
  /** เครื่องวิเคราะห์ลอจิก (ไม่เพิ่ม element — อ่านระดับจากผลคำนวณและขอบจากตัวจำลอง CPU) */
  analyzers?: import('../instruments/logic').AnalyzerSpec[];
}

/** mode = ตำแหน่งสวิตช์ (เปลี่ยนย่าน → เริ่มเฉลี่ยใหม่) */
export interface ScrSpec { id: string; a: number; g: number; k: number; igt: number; ih: number; vdrm: number; on: { Is: number; n: number; Rs: number } }

export interface MeterSpec { id: string; el: string; q: 'v' | 'i'; mode: string }

/** HC-SR04: echoWidth = ความกว้างพัลส์ ECHO ที่จะให้ (s) */
/** เซนเซอร์ความชื้นในดิน: แรงดันของแหล่ง `ref` ถูกแทนตามความชื้นที่เปลี่ยนตามเวลา (transient) */
/** KY-040: หน้าสัมผัส A (CLK) และ B (DT) ต่อลงขา GND ของโมดูล */
export interface EncoderSpec { id: string; clk: number; dt: number; gnd: number; R: number; detentMs: number; /** เวลาเด้งของหน้าสัมผัส (ms, 0 = ไม่เด้ง) */ bounceMs?: number }
/** เซนเซอร์ความชื้นในดิน: แรงดันของแหล่ง `ref` ถูกแทนตามความชื้นที่เปลี่ยนตามเวลา (transient) */
export interface SoilSpec { id: string; ref: string; m0: number; dryRate: number; potWater: number; vDry: number; vWet: number }
/** ปั๊มน้ำ: element มอเตอร์ id เดียวกับปั๊ม — อัตราไหลจากความเร็ว รดกระถางของเซนเซอร์ target */
export interface PumpSpec { id: string; target: string; resistance: number; ke: number; noLoadCurrent: number; viscous: number; flowMax: number; headMax: number; lift: number }
/** DHT22: ดึง DATA ต่ำตามตารางเวลาหลังโฮสต์ส่งสัญญาณเริ่ม (สร้างใน transient) */
export interface DhtSpec { id: string; vdd: number; gnd: number; data: number; bytes: number[]; vMin: number; busyCurrent: number; /** สัญญาณเริ่มต่ำสุด (s) และรอบการอ่านต่ำสุด (s) */ minStart?: number; minInterval?: number; /** รุ่น และค่าสภาพแวดล้อมจริง (°C, %RH) — DHT11 ส่งผลการวัดครั้งก่อน และค่าที่วัดตามสภาพแวดล้อมแบบหน่วง (ค่าคงที่เวลา) */ kind?: 'dht11' | 'dht22'; temperature?: number; humidity?: number }
/** PIR HC-SR501: OUT ขับ 3.3 V/0 V ตามเวลา (transient) */
export interface PirSpec { id: string; vcc: number; gnd: number; out: number; motion: boolean; hold: number; block: number; mode: 'H' | 'L'; vMin: number; vMax: number; /** อยู่ในระยะและมุมตรวจจับ */ inView?: boolean; /** ช่วงเริ่มต้นหลังจ่ายไฟ (s, 0 = ไม่จำลอง) */ warmup?: number }
export interface SonarSpec { id: string; vcc: number; gnd: number; trig: number; echo: number; echoWidth: number; vMin: number }

/** ไดรเวอร์ครึ่งสะพานหนึ่งช่อง: ขาออกต่อ VCC2 (สูง) หรือ GND (ต่ำ) ผ่านแบบจำลองแรงดันตก หรือลอย (EN ต่ำ) */
export interface DriverSpec { id: string; a: number; en: number; y: number; vcc1: number; vcc2: number; gnd: number }

/** ไอซีนับทศวรรษ: q = โหนดขาออก Q0..Q9, ขาออกเป็น MOSFET ใส่ใน solveDC ตามสถานะ */
export interface ShiftSpec { id: string; vcc: number; gnd: number; ser: number; sck: number; rck: number; clr: number; oe: number; q: number[]; qh2: number; kp: number; vth: number; lambda: number }
export interface CounterSpec { id: string; vdd: number; vss: number; clk: number; inh: number; rst: number; q: number[]; co: number; kp: number; vth: number; lambda: number }

export type GateOp = 'nand' | 'nor' | 'not' | 'and' | 'or' | 'xor';
/** คอมพาราเตอร์ (ช่องเดียว): สถานะค้าง = ทรานซิสเตอร์ขาออกนำ (IN− > IN+) · ขาออก open collector */
export interface CompSpec { id: string; part: string; inp: number; inn: number; out: number; vcc: number; gnd: number; Ron: number; vMin: number }
export interface GateSpec { id: string; part: string; op: GateOp; inputs: number[]; out: number; vcc: number; gnd: number; Ron: number }

/** มอเตอร์ DC: ขดลวด (R + L) อนุกรมแรงเคลื่อนไฟฟ้าย้อนกลับ E = ke·ω — ω เป็นสถานะใน TranState (ดู transient.ts) */
export interface MotorMech { ke: number; J: number; Tc: number; b: number; Tload: number; ratio: number }

/** สเต็ปเปอร์: id ของอิลิเมนต์ขดลวดทั้ง 4 (กระแสบอกเฟสที่มีไฟ) และพารามิเตอร์กลไก */
export interface StepperSpec { id: string; coils: string[]; vcc: number; gnd: number; stepsPerRev: number; pullIn: number; pullOut: number; minCoilCurrent: number; /** แรงบิดโหลดที่แกนออก (mN·m) */ loadTorque?: number }
export interface ServoSpec { id: string; sig: number; gnd: number; vcc: number; pulseMin: number; pulseMax: number; speed: number; vMin: number; vMax: number;
  /** กระแสมอเตอร์ขณะหมุน / ช่วงเริ่มหมุน 20 ms แรก (A, ที่ 4.8 V) */ runCurrent: number; startCurrent: number;
  /** แรงบิดหยุดหมุนที่ 4.8 V และแรงบิดโหลด (kgf·cm) */ stallTorque: number; loadTorque: number }

/**
 * ไอซีไทเมอร์ 555: element ถาวร (วงแบ่ง 3 × 5 kΩ, กระแสเลี้ยง, ขาออกด้าน HIGH เป็นดาร์ลิงตัน 2 ไดโอด) อยู่ใน elements
 * ส่วนที่ขึ้นกับฟลิปฟล็อป Q ใส่ใน solveDC: Q = 1 → HI–OUT ต่อกัน, Q = 0 → OUT ลงกราวด์ และ DIS ลงกราวด์
 */
export interface TimerSpec { id: string; vcc: number; gnd: number; trig: number; thr: number; ctl: number; lo: number; out: number; dis: number; rst: number; hi: number; Rl: number; Rd: number }

export interface RelaySpec { id: string; coilId: string; com: number; no: number; nc: number; Rc: number; vPick: number; vDrop: number }

export interface BuiltNetlist {
  netlist: Netlist;
  connectivity: Connectivity;
  /** อุปกรณ์ที่ไม่มีส่วนในการคำนวณและเหตุผล (เช่น สวิตช์เปิด แหล่งจ่ายปิด) */
  inactive: Array<{ id: string; reason: string }>;
}

/** วงจรต้องวิเคราะห์ตามเวลาหรือไม่ (มีตัวเก็บประจุ ตัวเหนี่ยวนำ หรือเครื่องกำเนิดสัญญาณ) */
export function hasReactive(nl: Netlist): boolean {
  return nl.elements.some((e) => e.type === 'C' || e.type === 'L' || e.type === 'FGEN') || !!nl.sonars?.length || !!nl.dhts?.length || !!nl.pirs?.length || !!nl.soils?.some((x) => x.dryRate > 0);
}

/** มีไมโครคอนโทรลเลอร์ — จำลองตามเวลาเสมอ (เวลาเดินตาม CPU) */
export function hasMcu(nl: Netlist): boolean {
  return !!nl.mcus?.length;
}

export function buildNetlist(doc: CircuitDoc): BuiltNetlist {
  const connectivity = computeConnectivity(doc);
  const elements: NetlistElement[] = [];
  const inactive: BuiltNetlist['inactive'] = [];
  const mcus: McuSpec[] = [];
  const tones: string[] = [];
  const relays: RelaySpec[] = [];
  const timers: TimerSpec[] = [];
  const transformers: string[] = [];
  const servos: ServoSpec[] = [];
  const steppers: StepperSpec[] = [];
  const meters: MeterSpec[] = [];
  let analyzers: import('../instruments/logic').AnalyzerSpec[] | undefined;
  const scrs: ScrSpec[] = [];
  const comps: CompSpec[] = [];
  const gates: GateSpec[] = [];
  const counters: CounterSpec[] = [];
  const shiftregs: ShiftSpec[] = [];
  const drivers: DriverSpec[] = [];
  const sonars: SonarSpec[] = [];
  const soils: SoilSpec[] = [];
  const dhts: DhtSpec[] = [];
  const pirs: PirSpec[] = [];
  const i2cs: I2cSpec[] = [];
  const tms: import('../mcu/tm1637').Tm1637Spec[] = [];
  const plcds: import('../mcu/hd44780-par').ParLcdSpec[] = [];
  const encs: EncoderSpec[] = [];
  const lcds: LcdSpec[] = [];
  const pumps: PumpSpec[] = [];
  /** โหนดภายในอุปกรณ์ (ต่อท้ายเน็ตของบอร์ด) */
  let extraNodes = 0;
  const newNode = () => connectivity.nets.length + extraNodes++;
  const n = (partId: string, pin: string) => {
    const v = netOfPin(connectivity, partId, pin);
    if (v === undefined) throw new Error(`ไม่พบเน็ตของ ${partId}:${pin}`);
    return v;
  };
  for (const part of doc.parts) {
    switch (part.kind) {
      case 'relay': {
        // โมดูลรีเลย์: S → Rb → เบส NPN (S8050 ≈ β 200), ขดลวด (R + L) จาก + ไปคอลเลกเตอร์, ไดโอดกันย้อน 1N4148 คร่อมขดลวด,
        // LED แสดงสถานะ + 1 kΩ คร่อมขดลวด; หน้าสัมผัส COM–NO / COM–NC ตามแรงดันขดลวด (solveDC)
        const S = n(part.id, 'S'), Vp = n(part.id, 'V'), G = n(part.id, 'G');
        const B = newNode(), Cn = newNode(), Ln = newNode();
        const pr = part.params;
        elements.push({ type: 'R', id: `${part.id}#rb`, role: 'module', a: S, b: B, R: pr.baseResistance });
        elements.push({ type: 'BJT', id: `${part.id}#q`, c: Cn, b: B, e: G, pol: 1, Is: 6.734e-15, bf: 200, br: 0.737 });
        elements.push({ type: 'L', id: `${part.id}#coil`, a: Vp, b: Cn, L: pr.coilInductance, R: pr.coilResistance });
        const d = diodeParamsFor('1N4148');
        elements.push({ type: 'D', id: `${part.id}#d`, a: Cn, k: Vp, Is: d.Is, n: d.n, Rs: d.Rs, Bv: d.Bv, Ibv: d.Ibv });
        elements.push({ type: 'R', id: `${part.id}#rl`, role: 'module', a: Vp, b: Ln, R: 1000 });
        const led = ledParamsFor('red');
        elements.push({ type: 'LED', id: `${part.id}#led`, a: Ln, k: Cn, Is: led.Is, n: led.n, Rs: led.Rs });
        relays.push({ id: part.id, coilId: `${part.id}#coil`, com: n(part.id, 'COM'), no: n(part.id, 'NO'), nc: n(part.id, 'NC'), Rc: pr.contactResistance, vPick: pr.vPick, vDrop: pr.vDrop });
        break;
      }
      case 'vreg': {
        // 78xx: แหล่งอ้างอิง VOUT (เทียบ GND) → ขยายผิดพลาดกำลังสูง (ออปแอมป์แบบคงที่ ไม่มี GBW) ไฟเลี้ยงจาก IN
        // ช่วงขาออก [GND + dropout, IN − dropout] — ใต้ dropout ขาออก ≈ IN − dropout; กระแสขาออกและกระแสนิ่งไหลมาจาก IN
        // ต่ออนุกรม rOut นอกวงป้อนกลับ (load regulation)
        const pr = part.params;
        const IN = n(part.id, 'IN'), G = n(part.id, 'GND'), O = n(part.id, 'OUT');
        const ref = newNode(), x = newNode();
        elements.push({ type: 'SUPPLY', id: `${part.id}#ref`, p: ref, n: G, V: pr.vout, Rint: 1, Ilim: 1e3 }); // แหล่งอ้างอิงภายใน: ไม่มีวันเข้าโหมดจำกัดกระแส
        elements.push({ type: 'OPAMP', id: `${part.id}#amp`, inp: ref, inn: x, out: x, vp: IN, vn: G, A: 1e5, Rout: 0.5, headroom: pr.dropout, Rin: 1e9, Rq: 1e9, gbw: 0, sr: 0 });
        // กระแสนิ่ง ≈ คงที่ (เอกสาร: เปลี่ยน ≤ 0.8 mA ตลอด 7–23 V) — แหล่งกระแสแบบมอสเฟตชนิด depletion (Vth −1 V, G = S = GND): I = kp/2 เมื่อ IN − GND > 1 V
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: IN, g: G, s: G, pol: 1, vth: -1, kp: 2 * pr.quiescentCurrent, lambda: 0.003 });
        elements.push({ type: 'R', id: `${part.id}#ro`, role: 'module', a: x, b: O, R: Math.max(pr.rOut, 1e-4) });
        break;
      }
      case 'lm317': {
        // LM317: แหล่งอ้างอิง VREF ลอยอยู่บนขา ADJ (ref = ADJ + VREF) → วงขยายผิดพลาดป้อนกลับจากขา OUT ไฟเลี้ยงจากขา IN
        // ภาคขาออกจ่ายกระแสได้ทางเดียว (ไดโอดอนุกรม) — จ่ายกระแสออกได้อย่างเดียว ดูดกลับไม่ได้ เหมือนทรานซิสเตอร์ขาออกของจริง
        // กระแสนิ่ง (≈ กระแสโหลดต่ำสุด) ไหลจาก IN ออกทางขา OUT: ถ้าวงจรภายนอกรับกระแสได้น้อยกว่านี้ แรงดันขาออกจะสูงเกิน (ต้องใช้ R1 ≤ 240 Ω)
        // IADJ ไหลจาก IN ออกทางขา ADJ · ช่วงขาออกสูงสุด ≈ IN − dropout (headroom ของวงขยาย + แรงดันไดโอดขาออก)
        const pr = part.params;
        const IN = n(part.id, 'IN'), A = n(part.id, 'ADJ'), O = n(part.id, 'OUT');
        const ref = newNode(), lo = newNode(), x = newNode(), y = newNode();
        elements.push({ type: 'SUPPLY', id: `${part.id}#ref`, p: ref, n: A, V: pr.vref, Rint: 1, Ilim: 1e3 });
        elements.push({ type: 'SUPPLY', id: `${part.id}#lo`, p: IN, n: lo, V: 45, Rint: 1, Ilim: 1e3 }); // ราวล่างสมมติของวงขยาย (IN − 45 V) ไม่มีกระแสไหล
        const vd = 0.75; // แรงดันไดโอดขาออกที่กระแสปานกลาง
        elements.push({ type: 'OPAMP', id: `${part.id}#amp`, inp: ref, inn: O, out: x, vp: IN, vn: lo, A: 1e5, Rout: 0.2, headroom: Math.max(0.05, pr.dropout - vd), Rin: 1e9, Rq: 1e9, gbw: 0, sr: 0 });
        elements.push({ type: 'D', id: `${part.id}#do`, a: x, k: y, Is: 1e-13, n: 1, Rs: 0.05, Bv: 100, Ibv: 1e-9 });
        elements.push({ type: 'R', id: `${part.id}#ro`, role: 'module', a: y, b: O, R: 0.01 });
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: IN, g: O, s: O, pol: 1, vth: -1, kp: 2 * pr.minLoad, lambda: 0.003 });
        elements.push({ type: 'MOS', id: `${part.id}#ia`, d: IN, g: A, s: A, pol: 1, vth: -1, kp: 2 * pr.iadj, lambda: 0.003 });
        break;
      }
      case 'timer555': {
        const pr = part.params;
        const T = { vcc: n(part.id, 'VCC'), gnd: n(part.id, 'GND'), trig: n(part.id, 'TRIG'), thr: n(part.id, 'THR'), ctl: n(part.id, 'CTRL'), out: n(part.id, 'OUT'), dis: n(part.id, 'DIS'), rst: n(part.id, 'RESET') };
        const lo = newNode(), mid = newNode(), hi = newNode();
        const R = (suffix: string, a: number, b: number, r: number) => elements.push({ type: 'R', id: `${part.id}#${suffix}`, role: 'module', a, b, R: r });
        R('rq', T.vcc, T.gnd, pr.quiescentResistance);
        R('d1', T.vcc, T.ctl, 5000); R('d2', T.ctl, lo, 5000); R('d3', lo, T.gnd, 5000); // วงแบ่ง ⅔ / ⅓ VCC
        R('rr', T.rst, T.vcc, 10000); // ขา RESET: กระแส ≈ −0.4 mA เมื่อต่อกราวด์
        R('it', T.trig, T.gnd, 1e8); R('ih', T.thr, T.gnd, 1e8); R('ld', T.dis, T.gnd, 1e9); R('bh', hi, T.gnd, 1e6);
        // ขาออกด้าน HIGH: ดาร์ลิงตัน ≈ 2 Vbe — VOH ≈ VCC − 1.2 V ที่กระแสน้อย, VCC − 1.7 V ที่ 100 mA
        const rs = Math.max(0, (pr.outHighResistance - 2.2) / 2);
        const dIs = 1.2e-13 * Math.exp((1.2 - pr.outHighDrop) / 2 / 0.02585);
        elements.push({ type: 'D', id: `${part.id}#q1`, a: T.vcc, k: mid, Is: dIs, n: 1, Rs: rs, Bv: 100, Ibv: 1e-6 });
        elements.push({ type: 'D', id: `${part.id}#q2`, a: mid, k: hi, Is: dIs, n: 1, Rs: rs, Bv: 100, Ibv: 1e-6 });
        timers.push({ id: part.id, ...T, lo, hi, Rl: pr.outLowResistance, Rd: pr.dischargeResistance });
        break;
      }
      case 'rgbled': {
        // ไดโอด 3 ตัว: แคโทดร่วม = ขาสี → COM, แอโนดร่วม = COM → ขาสี
        const pr = part.params, C = n(part.id, 'COM');
        const vf: Record<string, number> = { R: pr.vfR, G: pr.vfG, B: pr.vfB };
        for (const ch of RGB_CH) {
          const p = n(part.id, ch);
          elements.push({ type: 'LED', id: `${part.id}#${ch}`, a: pr.common === 'cc' ? p : C, k: pr.common === 'cc' ? C : p, Is: ledIsFor(vf[ch], pr.n, pr.Rs), n: pr.n, Rs: pr.Rs });
        }
        break;
      }
      case 'sevenseg': {
        // ขาร่วม 3 และ 8 ต่อถึงกันภายใน; แต่ละส่วน = LED จากขาส่วนไปขาร่วม (cc) หรือจากขาร่วมไปขาส่วน (ca)
        const c3 = n(part.id, '3'), c8 = n(part.id, '8');
        elements.push({ type: 'R', id: `${part.id}#com`, role: 'sevenseg', a: c3, b: c8, R: 1e-3 });
        const pr = part.params;
        for (const s of SEG_NAMES) {
          const sp = n(part.id, SEG_PINS[s]);
          elements.push({ type: 'LED', id: `${part.id}#${s}`, a: pr.common === 'cc' ? sp : c3, k: pr.common === 'cc' ? c3 : sp, Is: pr.Is, n: pr.n, Rs: pr.Rs });
        }
        break;
      }
      case 'ntc':
        elements.push({ type: 'R', id: part.id, role: 'ldr', a: n(part.id, '1'), b: n(part.id, '2'), R: ntcResistance(part.params) });
        break;
      case 'ldr':
        elements.push({ type: 'R', id: part.id, role: 'ldr', a: n(part.id, '1'), b: n(part.id, '2'), R: ldrResistance(part.params) });
        break;
      case 'buzzer': {
        const P = n(part.id, 'P'), Nn = n(part.id, 'N');
        if (part.params.type === 'passive') {
          // ขดลวดแม่เหล็ก: ความต้านทานขดลวด (ไม่รวมความเหนี่ยวนำ)
          elements.push({ type: 'R', id: part.id, role: 'buzzer', a: P, b: Nn, R: part.params.coilResistance });
        } else {
          // วงจรขับในตัว: ไดโอดกันกลับขั้ว + ความต้านทานสมมูล ให้ได้กระแสกำหนดที่แรงดันกำหนด
          const nVt = 2 * 0.025852, Is = 1e-12;
          const vf = nVt * Math.log(part.params.ratedCurrent / Is);
          const Rs = Math.max(1, (part.params.ratedVoltage - vf) / part.params.ratedCurrent);
          elements.push({ type: 'D', id: part.id, a: P, k: Nn, Is, n: 2, Rs, Bv: 30, Ibv: 1e-6 });
        }
        tones.push(part.id);
        break;
      }
      case 'pushbutton': {
        // ขาคู่ที่คร่อมร่องเป็นแผ่นโลหะเดียวกัน (≈ 0) · กดแล้วหน้าสัมผัสต่อ 1 ↔ 3
        const p1 = n(part.id, '1'), p2 = n(part.id, '2'), p3 = n(part.id, '3'), p4 = n(part.id, '4');
        elements.push({ type: 'R', id: `${part.id}#l`, role: 'button', a: p1, b: p2, R: 1e-3 });
        elements.push({ type: 'R', id: `${part.id}#r`, role: 'button', a: p3, b: p4, R: 1e-3 });
        if (part.params.pressed) elements.push({ type: 'R', id: part.id, role: 'button', a: p1, b: p3, R: part.params.contactResistance });
        break;
      }
      case 'arcadebtn': {
        // ไมโครสวิตช์ 3 ขั้ว: ปล่อย = COM–NC ต่อ, กด = COM–NO ต่อ
        const C = n(part.id, 'COM');
        elements.push({ type: 'R', id: part.id, role: 'button', a: C, b: n(part.id, part.params.pressed ? 'NO' : 'NC'), R: part.params.contactResistance });
        break;
      }
      case 'pushbtn16':
        // ปุ่มกดติดปล่อยดับ (normally open) 2 ขั้ว
        if (part.params.pressed) elements.push({ type: 'R', id: part.id, role: 'button', a: n(part.id, '1'), b: n(part.id, '2'), R: part.params.contactResistance });
        break;
      case 'dcadapter':
        // อะแดปเตอร์ 5 V: แหล่งจ่ายแรงดันคงที่ + ความต้านทานภายใน (รวมสาย) + จำกัดกระแสตามพิกัด (วงจรป้องกันของอะแดปเตอร์)
        if (part.params.plugged) elements.push({ type: 'SUPPLY', id: part.id, p: n(part.id, '+'), n: n(part.id, '-'), V: part.params.voltage, Rint: part.params.internalResistance, Ilim: part.params.currentLimit });
        else inactive.push({ id: part.id, reason: 'อะแดปเตอร์ยังไม่ได้เสียบปลั๊ก' });
        break;
      case 'servohub': {
        // แผ่นกระจายไฟเซอร์โว: ทองแดงเชื่อมช่อง (internalLinks) + ตัวเก็บประจุ 470 µF คร่อม V+/GND + LED แสดงไฟเข้า (ผ่าน 1 kΩ)
        const Vp = n(part.id, 'V+'), G = n(part.id, 'GND');
        if (Vp >= 0 && G >= 0 && Vp !== G) {
          elements.push({ type: 'C', id: `${part.id}#c`, a: Vp, b: G, C: part.params.capacitance, v0: 0 });
          const Ln = newNode(), led = ledParamsFor('red');
          elements.push({ type: 'R', id: `${part.id}#rl`, role: 'module', a: Vp, b: Ln, R: 1000 });
          elements.push({ type: 'LED', id: `${part.id}#led`, a: Ln, k: G, Is: led.Is, n: led.n, Rs: led.Rs });
        }
        break;
      }
      case 'potentiometer': {
        // สองส่วนของเส้นความต้านทาน: 1–2 = R·p + Rend, 2–3 = R·(1 − p) + Rend
        const { resistance: R, position: p, endResistance: re } = part.params;
        elements.push({ type: 'R', id: `${part.id}#a`, role: 'pot', a: n(part.id, '1'), b: n(part.id, '2'), R: Math.max(R * p + re, 1e-3) });
        elements.push({ type: 'R', id: `${part.id}#b`, role: 'pot', a: n(part.id, '2'), b: n(part.id, '3'), R: Math.max(R * (1 - p) + re, 1e-3) });
        break;
      }
      case 'resistor':
        elements.push({ type: 'R', id: part.id, role: 'resistor', a: n(part.id, '1'), b: n(part.id, '2'), R: part.params.resistance });
        break;
      case 'switch':
        if (part.params.closed) elements.push({ type: 'R', id: part.id, role: 'switch', a: n(part.id, 'A'), b: n(part.id, 'B'), R: part.params.onResistance });
        else inactive.push({ id: part.id, reason: 'สวิตช์เปิดอยู่ (วงจรขาด)' });
        break;
      case 'ammeter':
        elements.push({ type: 'R', id: part.id, role: 'ammeter', a: n(part.id, 'A'), b: n(part.id, 'COM'), R: part.params.shuntResistance });
        break;
      case 'dmm': {
        // ขั้ว 10 A และ mA ต่อ shunt + ฟิวส์ลง COM ตลอด (ไม่ขึ้นกับสวิตช์ — เสียบผิดขั้วแล้ววัดแรงดัน = ลัดวงจรผ่าน shunt)
        // ขั้ว V/Ω: ย่าน V = ความต้านทานขาเข้า, ย่าน Ω = แหล่งทดสอบ (ขั้ว V เป็นบวก), ย่านกระแส/ปิด = เปิดวงจร
        const pr = part.params, COM = n(part.id, 'COM'), V = n(part.id, 'V');
        elements.push({ type: 'R', id: `${part.id}#a10`, role: 'meter', a: n(part.id, 'A10'), b: COM, R: pr.shuntA, fuse: pr.fuseA });
        elements.push({ type: 'R', id: `${part.id}#ma`, role: 'meter', a: n(part.id, 'mA'), b: COM, R: pr.shuntMa, fuse: pr.fuseMa });
        if (pr.mode === 'ohm') elements.push({ type: 'SUPPLY', id: `${part.id}#m`, p: V, n: COM, V: pr.ohmVoc, Rint: pr.ohmRs, Ilim: 1 });
        else elements.push({ type: 'R', id: `${part.id}#m`, role: 'meter', a: V, b: COM, R: pr.mode === 'mv' ? pr.mvInputResistance : pr.mode === 'dcv' || pr.mode === 'acv' ? pr.inputResistance : 1e10 });
        meters.push({ id: part.id, el: pr.mode === 'dca' ? `${part.id}#a10` : pr.mode === 'dcma' ? `${part.id}#ma` : `${part.id}#m`, q: pr.mode === 'dca' || pr.mode === 'dcma' ? 'i' : 'v', mode: pr.mode });
        break;
      }
      case 'vom': {
        // ขั้ว + → ฟิวส์ → วงจรภายในตามตำแหน่งสวิตช์ → COM · ย่าน Ω: แบตเตอรี่ + ที่ขั้ว COM, อนุกรมความต้านทานค่ากลางสเกล
        const pr = part.params, pos = vomPosition(pr.sel), P = n(part.id, 'P'), COM = n(part.id, 'COM'), X = newNode();
        elements.push({ type: 'R', id: `${part.id}#fuse`, role: 'meter', a: P, b: X, R: 0.05, fuse: pr.fuse });
        if (pos.mode === 'ohm') elements.push({ type: 'SUPPLY', id: `${part.id}#m`, p: COM, n: X, V: pr.battery, Rint: pr.centerOhm * pos.full, Ilim: 10 });
        else elements.push({ type: 'R', id: `${part.id}#m`, role: 'meter', a: X, b: COM, R: pos.mode === 'off' ? 1e10 : vomInternalR(pr, pos) });
        meters.push({ id: part.id, el: `${part.id}#m`, q: pos.mode === 'dca' || pos.mode === 'ohm' ? 'i' : 'v', mode: pos.id });
        break;
      }
      case 'led':
        elements.push({ type: 'LED', id: part.id, a: n(part.id, 'A'), k: n(part.id, 'K'), Is: part.params.Is, n: part.params.n, Rs: part.params.Rs });
        break;
      case 'capacitor':
        elements.push({ type: 'C', id: part.id, a: n(part.id, 'P'), b: n(part.id, 'N'), C: part.params.capacitance, v0: part.params.initialVoltage });
        break;
      case 'inductor':
        elements.push({ type: 'L', id: part.id, a: n(part.id, '1'), b: n(part.id, '2'), L: part.params.inductance, R: part.params.resistance });
        break;
      case 'diode':
        elements.push({ type: 'D', id: part.id, a: n(part.id, 'A'), k: n(part.id, 'K'), Is: part.params.Is, n: part.params.n, Rs: part.params.Rs, Bv: part.params.Bv, Ibv: part.params.Ibv });
        break;
      case 'bjt':
        elements.push({ type: 'BJT', id: part.id, c: n(part.id, 'C'), b: n(part.id, 'B'), e: n(part.id, 'E'), pol: part.params.polarity === 'npn' ? 1 : -1, Is: part.params.Is, bf: part.params.bf, br: part.params.br });
        break;
      case 'mosfet': {
        const pol = part.params.polarity === 'n' ? 1 : -1;
        const d = n(part.id, 'D'), g = n(part.id, 'G'), s = n(part.id, 'S');
        elements.push({ type: 'MOS', id: part.id, d, g, s, pol, vth: part.params.vth, kp: part.params.kp, lambda: part.params.lambda });
        // ไดโอดในตัว: ช่อง N แอโนด = S แคโทด = D; ช่อง P กลับกัน
        const bd = part.params.body;
        elements.push({ type: 'D', id: `${part.id}#body`, a: pol === 1 ? s : d, k: pol === 1 ? d : s, Is: bd.Is, n: bd.n, Rs: bd.Rs, Bv: part.params.maxVds * 1.15, Ibv: 1e-3 });
        break;
      }
      case 'opamp': {
        // ความไม่อุดมคติด้าน DC: แรงดันออฟเซ็ต (แหล่งแรงดันอนุกรมขา IN+ ภายใน) และกระแสไบแอส (แหล่งกระแสแบบมอสเฟต depletion จากขาเข้าไป V−:
        // ขาเข้าทรานซิสเตอร์ NPN ของ LM741 ดึงกระแสเบสเข้าขา) — ค่าเริ่มเป็นค่าทั่วไปในดาต้าชีต (OPAMP_DC_TYP)
        const pr = part.params, typ = OPAMP_DC_TYP[pr.model] ?? OPAMP_DC_TYP.LM741;
        const vos = pr.offsetVoltage ?? typ.vos, ib = pr.biasCurrent ?? typ.ib, ios = pr.offsetCurrent ?? typ.ios;
        const IP = n(part.id, 'IN+'), IM = n(part.id, 'IN-'), VN = n(part.id, 'V-');
        let inp = IP;
        if (vos !== 0) { inp = newNode(); elements.push({ type: 'SUPPLY', id: `${part.id}#vos`, p: inp, n: IP, V: vos, Rint: 1e-3, Ilim: 1e3 }); }
        for (const [pin, cur, tag] of [[IP, ib + ios / 2, 'ibp'], [IM, ib - ios / 2, 'ibn']] as const) {
          if (cur > 0) elements.push({ type: 'MOS', id: `${part.id}#${tag}`, d: pin, g: VN, s: VN, pol: 1, vth: -1, kp: 2 * cur, lambda: 0 });
        }
        elements.push({
          type: 'OPAMP', id: part.id, inp, inn: IM, out: n(part.id, 'OUT'), vp: n(part.id, 'V+'), vn: VN,
          A: pr.gain, Rout: pr.outputResistance, headroom: pr.headroom,
          Rin: pr.inputResistance, Rq: pr.quiescentResistance, gbw: pr.gbw, sr: pr.slewRate,
        });
        break;
      }
      case 'sonar': {
        // HC-SR04: กระแสนิ่ง ≈ 2 mA (ทำงาน 15 mA — เพิ่มใน transient ระหว่างวัด), TRIG 100 kΩ ลง GND, ECHO 100 MΩ (ขับใน transient)
        const pr = part.params;
        const V = n(part.id, 'VCC'), G = n(part.id, 'GND');
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: V, g: G, s: G, pol: 1, vth: -1, kp: 2 * 0.002, lambda: 0.001 });
        elements.push({ type: 'R', id: `${part.id}#trig`, role: 'module', a: n(part.id, 'TRIG'), b: G, R: 1e5 });
        elements.push({ type: 'R', id: `${part.id}#eo`, role: 'module', a: n(part.id, 'ECHO'), b: G, R: 1e8 });
        sonars.push({ id: part.id, vcc: V, gnd: G, trig: n(part.id, 'TRIG'), echo: n(part.id, 'ECHO'), echoWidth: sonarEchoWidth(pr.distance, pr.temperature), vMin: pr.vMin });
        break;
      }
      case 'hbridge': {
        // L293D: กระแสนิ่ง ICC1 ≈ 8 mA, ICC2 ≈ 2 mA (ขาออกลอย — ดาต้าชีต) เป็นแหล่งกระแสแบบมอสเฟต depletion
        // ไดโอดกันย้อนในตัวทุกขาออก (ขาออก → VCC2 และ GND → ขาออก, 1.3 V ที่ 0.6 A); ขาเข้า 100 MΩ ลง GND (ตรวจขาลอยแยก)
        const V1 = n(part.id, 'VCC1'), V2 = n(part.id, 'VCC2'), G = n(part.id, 'GND');
        elements.push({ type: 'MOS', id: `${part.id}#icc1`, d: V1, g: G, s: G, pol: 1, vth: -1, kp: 2 * 0.008, lambda: 0.001 });
        elements.push({ type: 'MOS', id: `${part.id}#icc2`, d: V2, g: G, s: G, pol: 1, vth: -1, kp: 2 * 0.002, lambda: 0.001 });
        for (const p of ['EN12', 'EN34', '1A', '2A', '3A', '4A']) elements.push({ type: 'R', id: `${part.id}#in${p}`, role: 'module', a: n(part.id, p), b: G, R: 1e8 });
        for (const ch of L293D_CHANNELS) {
          const Y = n(part.id, ch.y);
          elements.push({ type: 'D', id: `${part.id}#k${ch.n}h`, a: Y, k: V2, Is: 7.4e-12, n: 2, Rs: 0.05, Bv: 100, Ibv: 1e-6 });
          elements.push({ type: 'D', id: `${part.id}#k${ch.n}l`, a: G, k: Y, Is: 7.4e-12, n: 2, Rs: 0.05, Bv: 100, Ibv: 1e-6 });
          elements.push({ type: 'R', id: `${part.id}#z${ch.n}`, role: 'module', a: Y, b: G, R: 1e8 });
          drivers.push({ id: `${part.id}#${ch.n}`, a: n(part.id, ch.a), en: n(part.id, ch.en), y: Y, vcc1: V1, vcc2: V2, gnd: G });
        }
        break;
      }
      case 'scr': {
        const pr = part.params, A = n(part.id, 'A'), G = n(part.id, 'G'), K = n(part.id, 'K');
        elements.push({ type: 'D', id: `${part.id}#gk`, a: G, k: K, ...SCR_GATE_DIODE, Bv: 8, Ibv: 1e-3 });
        scrs.push({ id: part.id, a: A, g: G, k: K, igt: pr.igt, ih: pr.ih, vdrm: pr.vdrm, on: SCR_ON_DIODE });
        break;
      }
      case 'lm35': {
        // LM35: แหล่งอ้างอิง 10 mV/°C เทียบ GND (ความต้านทานขาออก rOut) ผ่านสวิตช์มอสเฟตที่นำเมื่อมีไฟเลี้ยง (เกตที่ +VS)
        // → ไม่มีไฟเลี้ยง/กลับขั้ว ขาออกไม่มีแรงดัน (เหลือ 100 MΩ ลง GND) · ไฟเลี้ยงต่ำกว่า 4 V มีคำเตือนแยก
        // (เคยใช้ออปแอมป์ตามแรงดันแต่ขาออกอยู่ชิดรางล่าง Newton ลู่เข้ายาก)
        // กระแสนิ่งเกือบคงที่ตลอดช่วงไฟเลี้ยง (ดาต้าชีต 56 µA ที่ 5 V และ 30 V) — แหล่งกระแสแบบมอสเฟต depletion
        const pr = part.params;
        const VS = n(part.id, 'VS'), G = n(part.id, 'GND'), O = n(part.id, 'OUT');
        const ref = newNode();
        elements.push({ type: 'SUPPLY', id: `${part.id}#ref`, p: ref, n: G, V: lm35Vout(pr.temperature), Rint: Math.max(pr.rOut, 1e-3), Ilim: 1e3 });
        elements.push({ type: 'MOS', id: `${part.id}#on`, d: ref, g: VS, s: O, pol: 1, vth: 1.5, kp: 2, lambda: 0 });
        elements.push({ type: 'R', id: `${part.id}#ro`, role: 'module', a: O, b: G, R: 1e8 });
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: VS, g: G, s: G, pol: 1, vth: -1, kp: 2 * pr.quiescentCurrent, lambda: 0.001 });
        break;
      }
      case 'opto': {
        // PC817: LED อินฟราเรด (ไดโอด) ส่องแสงสร้างกระแสโฟโต้ที่รอยต่อคอลเลกเตอร์–เบส ของโฟโต้ทรานซิสเตอร์ (เบสลอยภายใน)
        // กระแสโฟโต้ = CTR × IF / (βF + 1) → ทรานซิสเตอร์ขยายเป็น IC ≈ CTR × IF ในย่านขยาย และอิ่มตัวเองเมื่อโหลดต้องการกระแสน้อยกว่า
        // สองฝั่งไม่มีทางเดินกระแสถึงกัน (ฉนวน) — ต่อกันผ่านแหล่งกระแสควบคุมเท่านั้น
        const pr = part.params;
        const A = n(part.id, 'A'), K = n(part.id, 'K'), Cn = n(part.id, 'C'), E = n(part.id, 'E');
        const B = newNode();
        const BF = 500;
        elements.push({ type: 'D', id: `${part.id}#led`, a: A, k: K, Is: pr.Is, n: pr.n, Rs: pr.Rs, Bv: 15, Ibv: 1e-5, ctl: { p: Cn, q: B, gain: pr.ctr / (BF + 1) } });
        elements.push({ type: 'BJT', id: `${part.id}#q`, c: Cn, b: B, e: E, pol: 1, Is: 1e-14, bf: BF, br: 0.5 });
        // เบสภายในลง E ด้วยความต้านทานสูงมาก (ไม่ให้โหนดลอยตอนไม่มีแสง)
        elements.push({ type: 'R', id: `${part.id}#rbe`, role: 'module', a: B, b: E, R: 1e9 });
        break;
      }
      case 'shiftreg': {
        // 74HC595: กระแสนิ่งเล็กมาก (1 MΩ), ขาเข้าและขาออกทุกขา 100 MΩ ลง GND (ไม่ให้โหนดลอย) — สถานะบิตอยู่ใน solveDC
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND');
        elements.push({ type: 'R', id: `${part.id}#q`, role: 'module', a: VCC, b: G, R: 1e6 });
        for (const p of ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE', 'QH2', ...HC595_OUTS]) elements.push({ type: 'R', id: `${part.id}#in${p}`, role: 'module', a: n(part.id, p), b: G, R: 1e8 });
        shiftregs.push({ id: part.id, vcc: VCC, gnd: G, ser: n(part.id, 'SER'), sck: n(part.id, 'SRCLK'), rck: n(part.id, 'RCLK'), clr: n(part.id, 'SRCLR'), oe: n(part.id, 'OE'),
          q: HC595_OUTS.map((q) => n(part.id, q)), qh2: n(part.id, 'QH2'), kp: pr.kp, vth: pr.vth, lambda: pr.lambda });
        break;
      }
      case 'counter': {
        // CD4017B: กระแสนิ่งเล็กมาก (1 MΩ), ขาเข้า CLK/INH/RST 100 MΩ ลง VSS (ไม่ให้โหนดลอย — ขาเข้าลอยถูกเตือน)
        // ขาออกทุกขา 100 MΩ ลง VSS (ตอนไม่มีไฟเลี้ยงทรานซิสเตอร์ขาออกไม่นำ)
        const pr = part.params;
        const VDD = n(part.id, 'VDD'), VSS = n(part.id, 'VSS');
        elements.push({ type: 'R', id: `${part.id}#q`, role: 'module', a: VDD, b: VSS, R: 1e6 });
        for (const p of ['CLK', 'INH', 'RST', 'CO', ...CD4017_OUTS]) elements.push({ type: 'R', id: `${part.id}#in${p}`, role: 'module', a: n(part.id, p), b: VSS, R: 1e8 });
        counters.push({ id: part.id, vdd: VDD, vss: VSS, clk: n(part.id, 'CLK'), inh: n(part.id, 'INH'), rst: n(part.id, 'RST'), q: CD4017_OUTS.map((q) => n(part.id, q)), co: n(part.id, 'CO'), kp: pr.kp, vth: pr.vth, lambda: pr.lambda });
        break;
      }
      case 'lm386': {
        // LM386: A0 ลบสัญญาณ (IN+ − IN−) แล้วยกขึ้นที่ M (= VS/2 จากวงแบ่งขา 7) · A1 ขยายแบบไม่กลับเฟส 1 + Rf/(Ra + Rb) อ้างอิง M
        // Ra–ขา 1–Rb–ขา 8–M: ตัวเก็บประจุภายนอกขา 1–8 ลัด Rb → อัตราขยาย 1 + Rf/Ra · A2 บัฟเฟอร์ M · ขาเข้า 50 kΩ ลงกราวด์
        const pr = part.params;
        const VS = n(part.id, 'VS'), G = n(part.id, 'GND'), O = n(part.id, 'OUT');
        const IP = n(part.id, 'IN+'), IM = n(part.id, 'IN-'), G1 = n(part.id, 'G1'), G8 = n(part.id, 'G8'), BY = n(part.id, 'BYP');
        const M = newNode(), D = newNode(), dp = newNode(), dn = newNode(), F = newNode();
        const R = (s: string, a: number, b: number, r: number) => elements.push({ type: 'R', id: `${part.id}#${s}`, role: 'module', a, b, R: r });
        R('rip', IP, G, pr.rin); R('rim', IM, G, pr.rin);
        R('b1', VS, BY, 15000); R('b2', BY, G, 15000);
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: VS, g: G, s: G, pol: 1, vth: -1, kp: 2 * Math.max(0, pr.quiescentCurrent - 0.0002), lambda: 0.003 });
        // อัตราขยายวงเปิด: บัฟเฟอร์ภายใน 1e3 (คลาด ≈ 0.1%) · ภาคขยายหลัก 2e4 (ที่อัตราขยาย 200 คลาด ≈ 1%) — A สูงกว่านี้ Newton เริ่มจากศูนย์แล้วค้างที่จุดอิ่มตัว
        const amp = (s: string, inp: number, inn: number, out: number, A: number, gbw: number, headroom: number, Rout: number) =>
          elements.push({ type: 'OPAMP', id: `${part.id}#${s}`, inp, inn, out, vp: VS, vn: G, A, Rout, headroom, Rin: 1e9, Rq: 1e9, gbw, sr: 0 });
        amp('a2', BY, M, M, 1e3, 0, 0, 1);
        // A0: วงลบ 4 ตัวต้านทาน 10 MΩ (ไม่โหลดขาเข้า) → D = M + (IN+ − IN−)
        R('d1', IP, dp, 1e7); R('d2', dp, M, 1e7); R('d3', IM, dn, 1e7); R('d4', dn, D, 1e7);
        amp('a0', dp, dn, D, 1e3, 0, 0, 1);
        R('rf', O, F, pr.rf); R('ra', F, G1, pr.ra); R('rb', G1, G8, pr.rb); R('rm', G8, M, 0.01);
        amp('a1', D, F, O, 2e4, pr.gbw, pr.headroom, 0.3);
        break;
      }
      case 'ssd1306': case 'ds3231': case 'mpu6050': {
        // โมดูล I²C: ตัวต้านทานดึงขึ้น SCL/SDA ไป VCC บนโมดูล + ภาระไฟเลี้ยงโดยประมาณ (กระแสพิกัดที่ 3.3 V)
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), SCL = n(part.id, 'SCL'), SDA = n(part.id, 'SDA');
        elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 3.3 / pr.supplyCurrent });
        let ad0 = -1;
        if (part.kind === 'ds3231') {
          // ZS-042: SQW และ 32K เป็นขา open-drain มีตัวต้านทานดึงขึ้น 4.7 kΩ บนโมดูล — ตอนดึงลง co-simulation เพิ่มตัวต้านทาน 133 Ω ลง GND (I2cHub.elements)
          elements.push({ type: 'R', id: `${part.id}#psqw`, role: 'module', a: n(part.id, 'SQW'), b: VCC, R: 4700 });
          elements.push({ type: 'R', id: `${part.id}#p32k`, role: 'module', a: n(part.id, '32K'), b: VCC, R: 4700 });
        }
        if (part.kind === 'mpu6050') {
          // GY-521: AD0 ดึงลง 4.7 kΩ บนโมดูล (ที่อยู่ 0x68 ถ้าไม่ต่อ), XDA/XCL ดึงขึ้น
          ad0 = n(part.id, 'AD0');
          elements.push({ type: 'R', id: `${part.id}#pad0`, role: 'module', a: ad0, b: G, R: 4700 });
        }
        const base = { id: part.id, vcc: VCC, gnd: G, sda: SDA, scl: SCL, ad0, vMin: pr.vMin, vMax: pr.vMax };
        if (part.kind === 'ssd1306') i2cs.push({ ...base, dev: 'ssd1306', addr: part.params.addr });
        else if (part.kind === 'ds3231') i2cs.push({ ...base, dev: 'ds3231', addr: 0x68, clock: part.params.clock, temperature: part.params.temperature, sqw: n(part.id, 'SQW'), k32: n(part.id, '32K') });
        else i2cs.push({ ...base, dev: 'mpu6050', addr: 0x68, motion: part.params.motion, spm: part.params.spm, temperature: part.params.temperature, int: n(part.id, 'INT') });
        break;
      }
      case 'gc9a01': {
        // จอ: ขา SPI/CS/DC/RST/BL เป็นขาเข้าลอจิก (ไม่มี element — อ่านระดับจากขา MCU ที่ขับตอนส่งไบต์)
        // ทัช: ตัวต้านทานดึงขึ้น TP_SDA/TP_SCL ไป VCC (ค่าสมมติ) · ภาระไฟเลี้ยงรวมไฟพื้นหลัง
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), SDA = n(part.id, 'TP_SDA'), SCL = n(part.id, 'TP_SCL');
        elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 3.3 / pr.supplyCurrent });
        lcds.push({ id: part.id, vcc: VCC, gnd: G, sck: n(part.id, 'SCLK'), mosi: n(part.id, 'MOSI'), cs: n(part.id, 'LCD_CS'), dc: n(part.id, 'LCD_DC'), rst: n(part.id, 'LCD_RST'), bl: n(part.id, 'LCD_BL'), vMin: pr.vMin, vMax: pr.vMax });
        i2cs.push({ id: `${part.id}#tp`, dev: 'cst816s', vcc: VCC, gnd: G, sda: SDA, scl: SCL, ad0: -1, addr: 0x15, vMin: pr.vMin, vMax: pr.vMax, rst: n(part.id, 'TP_RST'), int: n(part.id, 'TP_INT') });
        break;
      }
      case 'qmi8658': {
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), SCL = n(part.id, 'SCL'), SDA = n(part.id, 'SDA'), SA0 = n(part.id, 'SA0');
        elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#psa0`, role: 'module', a: SA0, b: VCC, R: 10000 });
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 3.3 / pr.supplyCurrent });
        i2cs.push({ id: part.id, dev: 'qmi8658', vcc: VCC, gnd: G, sda: SDA, scl: SCL, ad0: SA0, addr: 0x6a, vMin: pr.vMin, vMax: pr.vMax, motion: pr.motion, spm: pr.spm, temperature: pr.temperature });
        break;
      }
      case 'esp32s3lcd':
        // เฉพาะโมเดล
        break;
      case 'lcd1602': case 'bmp280': case 'bh1750': {
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), SCL = n(part.id, 'SCL'), SDA = n(part.id, 'SDA');
        // LCD: ตัวต้านทานดึงขึ้นบนบอร์ด I²C ไป VCC (5 V) — ถอดออกได้ · โมดูลเซนเซอร์มีตัวดึงขึ้นไปไฟเลี้ยงโมดูล
        if (part.kind !== 'lcd1602' || part.params.pullUps) {
          elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: VCC, R: pr.pullUp });
          elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: VCC, R: pr.pullUp });
        }
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 3.3 / pr.supplyCurrent });
        let sel = -1;
        if (part.kind === 'bmp280') {
          // GY-BMP280: SDO ดึงลง (0x76), CSB ดึงขึ้น (I²C) — ค่าบนโมดูลทั่วไป
          sel = n(part.id, 'SDO');
          elements.push({ type: 'R', id: `${part.id}#psdo`, role: 'module', a: sel, b: G, R: 10000 });
          elements.push({ type: 'R', id: `${part.id}#pcsb`, role: 'module', a: n(part.id, 'CSB'), b: VCC, R: 10000 });
        } else if (part.kind === 'bh1750') {
          sel = n(part.id, 'ADDR');
          elements.push({ type: 'R', id: `${part.id}#paddr`, role: 'module', a: sel, b: G, R: 10000 });
        }
        const base = { id: part.id, vcc: VCC, gnd: G, sda: SDA, scl: SCL, ad0: sel, vMin: pr.vMin, vMax: pr.vMax };
        if (part.kind === 'lcd1602') i2cs.push({ ...base, dev: 'lcd1602', addr: part.params.addr });
        else if (part.kind === 'bmp280') i2cs.push({ ...base, dev: 'bmp280', addr: 0x76, temperature: part.params.temperature, pressure: part.params.pressure });
        else i2cs.push({ ...base, dev: 'bh1750', addr: 0x23, lux: part.params.lux, sensitivity: part.params.sensitivity ?? 1.2 });
        break;
      }
      case 'ina219': {
        // shunt บนโมดูลระหว่าง VIN+ กับ VIN− · ตัวต้านทานดึงขึ้น SDA/SCL 10 kΩ ไป VCC · กระแสใช้งานของชิป (กระแสเข้า VIN± ≈ 20 µA ไม่จำลอง)
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), SCL = n(part.id, 'SCL'), SDA = n(part.id, 'SDA'), VP = n(part.id, 'VIN+'), VM = n(part.id, 'VIN-');
        elements.push({ type: 'R', id: `${part.id}#shunt`, role: 'module', a: VP, b: VM, R: pr.shunt });
        elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 3.3 / pr.supplyCurrent });
        i2cs.push({ id: part.id, dev: 'ina219', vcc: VCC, gnd: G, sda: SDA, scl: SCL, ad0: -1, addr: pr.addr, vMin: pr.vMin, vMax: pr.vMax, vinp: VP, vinm: VM });
        break;
      }
      case 'keypad': {
        // หน้าสัมผัสเมมเบรน: ปุ่มที่กดต่อแถวกับคอลัมน์ของปุ่มนั้น
        const k = part.params.pressed;
        const r = KEYPAD_KEYS.findIndex((row) => row.includes(k));
        if (k && r >= 0) elements.push({ type: 'R', id: part.id, role: 'button', a: n(part.id, `R${r + 1}`), b: n(part.id, `C${KEYPAD_KEYS[r].indexOf(k) + 1}`), R: part.params.contactResistance });
        break;
      }
      case 'encoder': {
        const pr = part.params;
        const P = n(part.id, '+'), G = n(part.id, 'GND'), CLK = n(part.id, 'CLK'), DT = n(part.id, 'DT');
        elements.push({ type: 'R', id: `${part.id}#pclk`, role: 'module', a: CLK, b: P, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#pdt`, role: 'module', a: DT, b: P, R: pr.pullUp });
        if (pr.pressed) elements.push({ type: 'R', id: `${part.id}#sw`, role: 'button', a: n(part.id, 'SW'), b: G, R: pr.contactResistance });
        encs.push({ id: part.id, clk: CLK, dt: DT, gnd: G, R: pr.contactResistance, detentMs: pr.detentMs, bounceMs: pr.bounceMs ?? 0 });
        break;
      }
      case 'joystick': {
        // ตัวต้านทานปรับค่าสองแกน: +5V –R(1−p)– VR –R·p– GND
        const pr = part.params;
        const P = n(part.id, '+5V'), G = n(part.id, 'GND');
        for (const [ax, pos] of [['x', pr.x], ['y', pr.y]] as const) {
          const W = n(part.id, ax === 'x' ? 'VRx' : 'VRy');
          elements.push({ type: 'R', id: `${part.id}#${ax}a`, role: 'pot', a: P, b: W, R: Math.max(pr.resistance * (1 - pos), 1) });
          elements.push({ type: 'R', id: `${part.id}#${ax}b`, role: 'pot', a: W, b: G, R: Math.max(pr.resistance * pos, 1) });
        }
        if (pr.pressed) elements.push({ type: 'R', id: `${part.id}#sw`, role: 'button', a: n(part.id, 'SW'), b: G, R: pr.contactResistance });
        break;
      }
      case 'tm1637': {
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), CLK = n(part.id, 'CLK'), DIO = n(part.id, 'DIO');
        elements.push({ type: 'R', id: `${part.id}#pclk`, role: 'module', a: CLK, b: VCC, R: pr.pullUp });
        elements.push({ type: 'R', id: `${part.id}#pdio`, role: 'module', a: DIO, b: VCC, R: pr.pullUp });
        // กระแสไฟเลี้ยง = กระแส LED ตามส่วนที่ติด (co-simulation เพิ่มแหล่งกระแส `#led`) — ไม่รวมกระแสวงจรภายในชิป (ไม่ระบุในดาต้าชีต)
        tms.push({ id: part.id, vcc: VCC, gnd: G, clk: CLK, dio: DIO, vMin: pr.vMin, vMax: pr.vMax });
        break;
      }
      case 'lcd1602p': {
        // HD44780U: กระแสไฟเลี้ยง ~1.5 mA · RS/RW/D0–D7 มีตัวดึงขึ้นภายใน (กระแส ~100 µA ที่ 5 V → ≈ 50 kΩ)
        // V0: วงจรแบ่งแรงดันไบอัสของจอต่อระหว่าง VDD กับ V0 (ค่าประมาณ 10 kΩ) · ไฟพื้นหลัง: LED A–K (+ ตัวต้านทานบนแผ่นถ้ามี)
        const pr = part.params, P = (x: string) => n(part.id, x);
        const VDD = P('VDD'), G = P('VSS');
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VDD, b: G, R: 5 / pr.supplyCurrent });
        elements.push({ type: 'R', id: `${part.id}#bias`, role: 'module', a: P('V0'), b: VDD, R: 10000 });
        for (const x of ['RS', 'RW', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) elements.push({ type: 'R', id: `${part.id}#pu${x}`, role: 'module', a: P(x), b: VDD, R: 50000 });
        let A = P('A');
        if (pr.blR > 0) { const x = newNode(); elements.push({ type: 'R', id: `${part.id}#blr`, role: 'module', a: A, b: x, R: pr.blR }); A = x; }
        elements.push({ type: 'LED', id: `${part.id}#bl`, a: A, k: P('K'), Is: ledIsFor(pr.blVf, 2, 5), n: 2, Rs: 5 });
        plcds.push({ id: part.id, vdd: VDD, vss: G, rs: P('RS'), rw: P('RW'), e: P('E'), d: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map(P), vMin: pr.vMin, vMax: pr.vMax });
        break;
      }
      case 'vibmotor': {
        // มอเตอร์ DC จิ๋ว ไม่มีเฟือง: แรงเสียดทานคงที่เทียบเท่ากระแสไม่มีโหลด, ไม่มีโหลดภายนอก
        const pr = part.params;
        elements.push({ type: 'L', id: part.id, a: n(part.id, 'A'), b: n(part.id, 'B'), L: pr.inductance, R: pr.resistance,
          motor: { ke: pr.ke, J: pr.inertia, Tc: pr.ke * pr.noLoadCurrent, b: 0, Tload: 0, ratio: 1 } });
        break;
      }
      case 'bluepill':
      case 'pico2':
      case 'teensy41':
      case 'esp32s2':
        // เฉพาะโมเดล: ไม่มีอุปกรณ์ไฟฟ้า (ขา G สองขาต่อถึงกันผ่าน internalLinks)
        break;
      case 'pir': {
        // กระแสพัก + ขาออก (ใน transient) · ไม่มีไฟเลี้ยงพอ = ขาออกลอย
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), O = n(part.id, 'OUT');
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 5 / pr.supplyCurrent });
        elements.push({ type: 'R', id: `${part.id}#oin`, role: 'module', a: O, b: G, R: 1e8 });
        pirs.push({ id: part.id, vcc: VCC, gnd: G, out: O, motion: pr.motion, hold: pr.holdTime, block: pr.blockTime, mode: pr.mode, vMin: pr.vMin, vMax: pr.vMax, inView: pirInView(pr), warmup: pr.warmup ? PIR_WARMUP : 0 });
        break;
      }
      case 'flame': case 'soundsensor': case 'rainsensor': case 'mq2': case 'linetrack': case 'vibsensor': case 'touch': case 'hall': case 'reed': case 'tilt': case 'waterlevel': case 'fsr':
        buildSensorNet(part, { n: (pin) => n(part.id, pin), newNode, el: (e) => elements.push(e), comp: (cs) => comps.push(cs), inactive: (reason) => inactive.push({ id: part.id, reason }) });
        break;
      case 'irobstacle': {
        // LM393 open-collector: ดึงขึ้น 10 kΩ ไป VCC · พบวัตถุ = ทรานซิสเตอร์ขาออกนำ (≈ 50 Ω ลง GND) · ไฟเลี้ยง LED อินฟราเรด/LED แสดงผล = โหลดคงที่
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), O = n(part.id, 'OUT');
        elements.push({ type: 'R', id: `${part.id}#load`, role: 'module', a: VCC, b: G, R: 5 / pr.supplyCurrent });
        elements.push({ type: 'R', id: `${part.id}#pu`, role: 'module', a: O, b: VCC, R: 10000 });
        if (irDetected(pr)) elements.push({ type: 'R', id: `${part.id}#sink`, role: 'module', a: O, b: G, R: 50 });
        break;
      }
      case 'dht11':
      case 'dht22': {
        // กระแสพัก (แหล่งกระแสแบบมอสเฟต depletion) · ขณะส่งข้อมูลเพิ่มกระแสและดึง DATA ต่ำด้วยทรานซิสเตอร์ open-drain (ใน transient)
        const pr = part.params;
        const VDD = n(part.id, 'VDD'), G = n(part.id, 'GND'), D = n(part.id, 'DATA');
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: VDD, g: G, s: G, pol: 1, vth: -1, kp: 2 * pr.standbyCurrent, lambda: 0.001 });
        elements.push({ type: 'R', id: `${part.id}#din`, role: 'module', a: D, b: G, R: 1e8 });
        // DHT11: เอกสารกำหนดสัญญาณเริ่มต่ำ ≥ 18 ms — MicroPython ใช้ delay_ms(18) ซึ่งได้จริง 17–18 ms (นับตามขอบ tick 1 ms) จึงยอมรับ ≥ 15 ms
        if (part.kind === 'dht11') dhts.push({ id: part.id, vdd: VDD, gnd: G, data: D, bytes: dht11Bytes(pr.temperature, pr.humidity), vMin: pr.vMin, busyCurrent: pr.supplyCurrent, minStart: 15e-3, minInterval: 0.95, kind: 'dht11', temperature: pr.temperature, humidity: pr.humidity });
        else dhts.push({ id: part.id, vdd: VDD, gnd: G, data: D, bytes: dht22Bytes(pr.temperature, pr.humidity), vMin: pr.vMin, busyCurrent: pr.supplyCurrent, kind: 'dht22', temperature: pr.temperature, humidity: pr.humidity });
        break;
      }
      case 'soilsensor': {
        // แหล่งแรงดันตามความชื้น (ความต้านทานขาออก rOut) อ้าง GND ผ่านสวิตช์มอสเฟตที่นำเมื่อมีไฟเลี้ยง (เกตที่ VCC) + กระแสใช้งานคงที่
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND'), O = n(part.id, 'AOUT'), X = newNode();
        elements.push({ type: 'SUPPLY', id: `${part.id}#ref`, p: O, n: X, V: soilVout(pr.moisture, pr), Rint: Math.max(pr.rOut, 1e-3), Ilim: 1e3 });
        elements.push({ type: 'MOS', id: `${part.id}#on`, d: X, g: VCC, s: G, pol: 1, vth: 1.0, kp: 2, lambda: 0 });
        elements.push({ type: 'R', id: `${part.id}#ro`, role: 'module', a: O, b: G, R: 1e8 });
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: VCC, g: G, s: G, pol: 1, vth: -1, kp: 2 * pr.supplyCurrent, lambda: 0.001 });
        soils.push({ id: part.id, ref: `${part.id}#ref`, m0: pr.moisture, dryRate: pr.dryRate, potWater: pr.potWater, vDry: pr.vDry, vWet: pr.vWet });
        break;
      }
      case 'pump': {
        const pr = part.params;
        elements.push({ type: 'L', id: part.id, a: n(part.id, 'P'), b: n(part.id, 'N'), L: pr.inductance, R: pr.resistance,
          motor: { ke: pr.ke, J: pr.inertia, Tc: pr.ke * pr.noLoadCurrent, b: pr.viscous, Tload: 0, ratio: 1 } });
        pumps.push({ id: part.id, target: pr.target, resistance: pr.resistance, ke: pr.ke, noLoadCurrent: pr.noLoadCurrent, viscous: pr.viscous, flowMax: pr.flowMax, headMax: pr.headMax, lift: pr.lift });
        break;
      }
      case 'speaker':
        elements.push({ type: 'R', id: part.id, role: 'buzzer', a: n(part.id, 'P'), b: n(part.id, 'N'), R: part.params.impedance });
        tones.push(part.id);
        break;
      case 'darlington': {
        // TIP120: Q1 (C → C, B → B, E → M) + Q2 (C → C', B → M, E → E') · R1 B–M, R2 M–E' · ความต้านทานเนื้อสาร RC (C–C'), RE (E'–E)
        const pr = part.params;
        const B = n(part.id, 'B'), C = n(part.id, 'C'), E = n(part.id, 'E');
        const M = newNode(), Ci = newNode(), Ei = newNode();
        elements.push({ type: 'BJT', id: `${part.id}#q1`, c: Ci, b: B, e: M, pol: 1, Is: pr.is1, bf: pr.bf1, br: 0.5 });
        elements.push({ type: 'BJT', id: `${part.id}#q2`, c: Ci, b: M, e: Ei, pol: 1, Is: pr.is2, bf: pr.bf2, br: 0.5 });
        elements.push({ type: 'R', id: `${part.id}#r1`, role: 'module', a: B, b: M, R: pr.r1 });
        elements.push({ type: 'R', id: `${part.id}#r2`, role: 'module', a: M, b: Ei, R: pr.r2 });
        elements.push({ type: 'R', id: `${part.id}#rc`, role: 'module', a: C, b: Ci, R: pr.rc });
        elements.push({ type: 'R', id: `${part.id}#re`, role: 'module', a: Ei, b: E, R: pr.re });
        break;
      }
      case 'comparator': {
        // LM393: กระแสนิ่ง ≈ คงที่ (แหล่งกระแสแบบ MOSFET depletion VCC → GND), ขาเข้า 100 MΩ ลงกราวด์ (กระแสไบอัส 25 nA ไม่จำลอง)
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND');
        elements.push({ type: 'MOS', id: `${part.id}#iq`, d: VCC, g: G, s: G, pol: 1, vth: -1, kp: 2 * pr.quiescentCurrent, lambda: 0.003 });
        for (const ch of LM393_CHANNELS) {
          for (const p of [ch.inp, ch.inn]) elements.push({ type: 'R', id: `${part.id}#in${p}`, role: 'module', a: n(part.id, p), b: G, R: 1e8 });
          comps.push({ id: `${part.id}#${ch.n}`, part: part.id, inp: n(part.id, ch.inp), inn: n(part.id, ch.inn), out: n(part.id, ch.out), vcc: VCC, gnd: G, Ron: pr.ron, vMin: pr.vMin });
        }
        break;
      }
      case 'logic': {
        // ไอซีเกต 74HC: กระแสนิ่งเล็กมาก (1 MΩ), ขาเข้าแต่ละขา 100 MΩ ลงกราวด์ (ไม่ให้โหนดลอย — ขาเข้าที่ไม่ได้ต่อจะถูกเตือน)
        const pr = part.params;
        const VCC = n(part.id, 'VCC'), G = n(part.id, 'GND');
        elements.push({ type: 'R', id: `${part.id}#q`, role: 'module', a: VCC, b: G, R: 1e6 });
        const op = ({ '74HC00': 'nand', '74HC02': 'nor', '74HC04': 'not', '74HC08': 'and', '74HC32': 'or', '74HC86': 'xor' } as const)[pr.model];
        for (const gt of logicGates(pr.model)) {
          const ins = gt.inputs.map((p) => n(part.id, p));
          gt.inputs.forEach((p, k) => elements.push({ type: 'R', id: `${part.id}#in${p}`, role: 'module', a: ins[k], b: G, R: 1e8 }));
          gates.push({ id: `${part.id}#${gt.n}`, part: part.id, op, inputs: ins, out: n(part.id, gt.out), vcc: VCC, gnd: G, Ron: pr.outputResistance });
        }
        break;
      }
      case 'motor': {
        const pr = part.params;
        elements.push({ type: 'L', id: part.id, a: n(part.id, 'A'), b: n(part.id, 'B'), L: pr.inductance, R: pr.resistance,
          motor: { ke: pr.ke, J: pr.inertia, Tc: pr.ke * pr.noLoadCurrent, b: pr.viscous, Tload: pr.loadTorque / (pr.gearRatio * pr.gearEff), ratio: pr.gearRatio } });
        break;
      }
      case 'stepper': {
        // บอร์ด ULN2003 ต่อช่องละ 1 ชุดตามวงจรในดาต้าชีต: ขาเข้า → 2.7 kΩ → เบส Q1, 7.2 kΩ (B1–B2), 3 kΩ (B2–E), ดาร์ลิงตัน Q1/Q2
        // ขาออก (คอลเลกเตอร์) ← ขดลวด 50 Ω จาก +5 V (สายแดงร่วม) · ไดโอดกันย้อนจากขาออกไป COM (= +) · LED แสดงเฟส + 1 kΩ คร่อมขดลวด
        const pr = part.params;
        const V = n(part.id, 'V'), G = n(part.id, 'G');
        const lp = ledParamsFor('red');
        STEPPER_INPUTS.forEach((pin, k) => {
          const IN = n(part.id, pin), B1 = newNode(), B2 = newNode(), O = newNode(), L = newNode(), c = k + 1;
          elements.push({ type: 'R', id: `${part.id}#rin${c}`, role: 'module', a: IN, b: B1, R: 2700 });
          elements.push({ type: 'R', id: `${part.id}#rb1${c}`, role: 'module', a: B1, b: B2, R: 7200 });
          elements.push({ type: 'R', id: `${part.id}#rb2${c}`, role: 'module', a: B2, b: G, R: 3000 });
          elements.push({ type: 'BJT', id: `${part.id}#q1${c}`, c: O, b: B1, e: B2, pol: 1, Is: 1e-14, bf: 60, br: 0.5 });
          elements.push({ type: 'BJT', id: `${part.id}#q2${c}`, c: O, b: B2, e: G, pol: 1, Is: 1e-13, bf: 40, br: 0.5 });
          elements.push({ type: 'R', id: `${part.id}#c${c}`, role: 'module', a: V, b: O, R: pr.coilResistance });
          elements.push({ type: 'D', id: `${part.id}#d${c}`, a: O, k: V, Is: 2.52e-9, n: 1.752, Rs: 0.568, Bv: 100, Ibv: 1e-4 });
          elements.push({ type: 'R', id: `${part.id}#rl${c}`, role: 'module', a: V, b: L, R: 1000 });
          elements.push({ type: 'LED', id: `${part.id}#led${c}`, a: L, k: O, Is: lp.Is, n: lp.n, Rs: lp.Rs });
        });
        steppers.push({ id: part.id, coils: [1, 2, 3, 4].map((c) => `${part.id}#c${c}`), vcc: V, gnd: G, stepsPerRev: pr.stepsPerRev, pullIn: pr.pullIn, pullOut: pr.pullOut, minCoilCurrent: pr.minCoilCurrent, loadTorque: pr.shaftLoad ?? 0 });
        break;
      }
      case 'servo': {
        // วงจรควบคุมในตัว: กระแสนิ่ง (ตัวต้านทานเทียบเท่าที่ 4.8 V) + ขาสัญญาณ 100 kΩ
        // กระแสมอเตอร์ขณะหมุน (ช่วงเริ่ม 20 ms = startCurrent, หมุนต่อ = runCurrent) เพิ่มโดยตัวจำลอง MCU ตามสถานะการหมุน (cosim: `#m`)
        const pr = part.params;
        const G = n(part.id, 'GND'), V = n(part.id, 'V'), S = n(part.id, 'SIG');
        elements.push({ type: 'R', id: `${part.id}#q`, role: 'module', a: V, b: G, R: 4.8 / pr.idleCurrent });
        elements.push({ type: 'R', id: `${part.id}#in`, role: 'module', a: S, b: G, R: 1e5 });
        servos.push({ id: part.id, sig: S, gnd: G, vcc: V, pulseMin: pr.pulseMin, pulseMax: pr.pulseMax, speed: pr.speed, vMin: pr.vMin, vMax: pr.vMax, runCurrent: pr.runCurrent ?? 0.2, startCurrent: pr.startCurrent ?? 0.5, stallTorque: pr.stallTorque ?? 1.8, loadTorque: pr.loadTorque ?? 0 });
        break;
      }
      case 'transformer': {
        // ขดทุติยภูมิสองครึ่ง (เฟสเดียวกัน): CT → A และ B → CT แต่ละครึ่งเป็นแหล่งแรงดันไซน์ + ความต้านทานขดลวดสมมูล
        if (!part.params.on) { inactive.push({ id: part.id, reason: 'ถอดปลั๊ก/ปิดสวิตช์หม้อแปลงอยู่' }); break; }
        const m = transformerModel(part.params);
        const A = n(part.id, 'A'), CT = n(part.id, 'CT'), B = n(part.id, 'B');
        elements.push({ type: 'FGEN', id: `${part.id}#a`, p: A, n: CT, wave: 'sine', freq: part.params.frequency, vpp: 2 * m.vpk, offset: 0, Rout: m.rw });
        transformers.push(part.id);
        elements.push({ type: 'FGEN', id: `${part.id}#b`, p: CT, n: B, wave: 'sine', freq: part.params.frequency, vpp: 2 * m.vpk, offset: 0, Rout: m.rw });
        break;
      }
      case 'fgen':
        if (part.params.outputOn) {
          elements.push({
            type: 'FGEN', id: part.id, p: n(part.id, 'OUT'), n: n(part.id, 'COM'), wave: part.params.wave,
            freq: part.params.frequency, vpp: part.params.vpp, offset: part.params.offset, Rout: part.params.outputImpedance,
          });
        } else inactive.push({ id: part.id, reason: 'เอาต์พุตเครื่องกำเนิดสัญญาณปิดอยู่' });
        break;
      case 'logicanalyzer': {
        // ช่องที่ไม่ได้ต่อกับอะไร = −1
        const lk = (pin: string) => { const x = n(part.id, pin); return x >= 0 && netLinked(connectivity, doc, x) ? x : -1; };
        (analyzers ??= []).push({ id: part.id, ch: Array.from({ length: 8 }, (_, k) => lk(`CH${k}`)), gnd: lk('GND') });
        break;
      }
      case 'scope': {
        // ขาเข้าแต่ละช่องเป็นความต้านทาน 1 MΩ ลง GND (โหลดวงจรเล็กน้อยเหมือนเครื่องจริง)
        const g = n(part.id, 'GND');
        elements.push({ type: 'R', id: `${part.id}#ch1`, role: 'scope', a: n(part.id, 'CH1'), b: g, R: part.params.inputResistance });
        elements.push({ type: 'R', id: `${part.id}#ch2`, role: 'scope', a: n(part.id, 'CH2'), b: g, R: part.params.inputResistance });
        break;
      }
      case 'pico':
      case 'picow': {
        const gp = Array.from({ length: 29 }, (_, i) => (PICO_GPIO.includes(i) ? n(part.id, `GP${i}`) : -1));
        mcus.push({
          ...(part.kind === 'picow' ? { fw: 'picow' as const } : {}), id: part.id, gnd: n(part.id, 'GND'), v33: n(part.id, '3V3'), vbus: n(part.id, 'VBUS'), vsys: n(part.id, 'VSYS'),
          vref: n(part.id, 'ADC_VREF'), gp, autorun: part.params.autorun ? part.params.code : null, ...(part.params.bg ? { bg: part.params.bg } : {}),
        });
        break;
      }
      case 'xiao': {
        // XIAO RP2040: GPIO 0–29 (gp ยาว 30) — ขาที่ออกมาตาม XIAO_PINOUT (D3 = GPIO29 = ADC3) · 5V = VBUS จาก USB-C · 3V3 จากเรกูเลเตอร์บนบอร์ด
        const gp = Array.from({ length: 30 }, () => -1);
        for (const [name, g] of XIAO_GPIO) gp[g] = n(part.id, name);
        mcus.push({ fw: 'xiao', id: part.id, gnd: n(part.id, 'GND'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: -1, vref: -1, gp, autorun: part.params.autorun ? part.params.code : null, ...(part.params.bg ? { bg: part.params.bg } : {}) });
        break;
      }
      case 'esp32devkitc': {
        // ESP32-DevKitC V4: GPIO 0–39 (gp ยาว 40) ตามหัวต่อ J2/J3 · 5V = ไฟ USB · 3V3 จากเรกูเลเตอร์บนบอร์ด · CPU ใน QEMU (เฟิร์มแวร์ fw 'esp32')
        const gp = Array.from({ length: 40 }, () => -1);
        for (const [name, g] of ESP32DK_GPIO) gp[g] = n(part.id, name);
        mcus.push({ fw: 'esp32', id: part.id, gnd: n(part.id, 'GND.1'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: -1, vref: -1, gp, autorun: part.params.autorun ? part.params.code : null });
        break;
      }
      case 'nanoconnect': {
        // Nano RP2040 Connect: GPIO 0–29 ตาม NANOCONNECT_PINOUT · VUSB = 5 V จาก USB · 3V3 จากเรกูเลเตอร์บนบอร์ด (≤ 800 mA)
        // บัส I²C ของ A4 (GPIO12) / A5 (GPIO13): ตัวต้านทานดึงขึ้น 4.7 kΩ บนบอร์ด + IMU LSM6DSOX (0x6A, SDO/SA0 ต่อกราวด์) ใช้ไฟ 3.3 V ของบอร์ด
        // กระแส IMU ≈ 0.55 mA (ความเร่ง + ไจโรโหมด high-performance ตาม datasheet LSM6DSOX) — โหลดคงที่แบบเดียวกับโมดูล I²C อื่นในแอป
        const gp = Array.from({ length: 30 }, () => -1);
        for (const [name, g] of NANOCONNECT_GPIO) gp[g] = n(part.id, name);
        const G = n(part.id, 'GND.1'), V33 = n(part.id, '3V3'), SDA = n(part.id, 'A4'), SCL = n(part.id, 'A5');
        if (SDA !== V33) elements.push({ type: 'R', id: `${part.id}#psda`, role: 'module', a: SDA, b: V33, R: 4700 });
        if (SCL !== V33) elements.push({ type: 'R', id: `${part.id}#pscl`, role: 'module', a: SCL, b: V33, R: 4700 });
        if (V33 !== G) elements.push({ type: 'R', id: `${part.id}#imu`, role: 'module', a: V33, b: G, R: 3.3 / 0.55e-3 });
        i2cs.push({ id: `${part.id}#imu`, dev: 'lsm6dsox', vcc: V33, gnd: G, sda: SDA, scl: SCL, ad0: -1, addr: 0x6a, vMin: 1.71, vMax: 3.6, motion: part.params.motion ?? 'still', spm: part.params.spm ?? 100, temperature: 25 });
        mcus.push({ fw: 'nanoconnect', id: part.id, gnd: G, v33: V33, vbus: n(part.id, 'VUSB'), vsys: -1, vref: -1, gp, autorun: part.params.autorun ? part.params.code : null, ...(part.params.bg ? { bg: part.params.bg } : {}) });
        break;
      }
      case 'rpi5': {
        const gnd = n(part.id, 'GND.1'), v33 = n(part.id, '3V3.1');
        const gp = RPI_GPIO_PINS.map((p) => n(part.id, p));
        // ตัวต้านทานดึงขึ้น 1.8 kΩ บนบอร์ดที่ GPIO2 (SDA) และ GPIO3 (SCL)
        for (const i of [2, 3]) if (gp[i] >= 0 && v33 >= 0 && gp[i] !== v33) elements.push({ type: 'R', id: `${part.id}#pu${i}`, role: 'module', a: gp[i], b: v33, R: 1800 });
        mcus.push({ id: part.id, kind: 'rpi5', gnd, v33, vbus: n(part.id, '5V.1'), vsys: -1, vref: -1, gp, autorun: part.params.autorun ? part.params.code : null });
        break;
      }
      case 'nano': {
        // ชิปเดียวกับ Uno — ลำดับขา D0–D13, A0–A7 (A6/A7 = ช่อง 20/21 อ่าน ADC อย่างเดียว) · 3V3 จากชิป USB-serial (≤ 50 mA)
        mcus.push({
          id: part.id, kind: 'uno', board: 'nano', gnd: n(part.id, 'GND.1'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: n(part.id, 'VIN'), vref: n(part.id, 'AREF'),
          gp: NANO_DIGITAL.map((p) => n(part.id, p)), autorun: null, hex: part.params.hex, ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'attiny85': {
        // ไอซีเดี่ยว: ไฟเลี้ยงมาจากวงจรที่ขา 8 (VCC) / 4 (GND) — ไม่มีรางไฟของบอร์ด · ขา 1 (PB5) = RESET จึงไม่ใช้เป็นขา I/O
        mcus.push({
          id: part.id, kind: 'uno', board: 'attiny85', gnd: n(part.id, 'GND'), v33: -1, vbus: -1, vsys: -1, vref: -1, chipVcc: n(part.id, 'VCC'), rst: n(part.id, 'PB5'),
          gp: ATTINY85_DIGITAL.map((p, i) => (i === 5 ? -1 : n(part.id, p))), autorun: null, hex: part.params.hex, ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'promini': {
        // Pro Mini: ชิป ATmega328P ลำดับขาเดียวกับ Nano (D0–D13, A0–A7) · ไม่มี USB — VCC มาจากตัวแปลง USB-serial ที่หัว 6 ขา (vbus = เน็ต VCC)
        // ไม่มีขา 3V3/AREF ออกหัวต่อ · RAW = ขาเข้าเรกูเลเตอร์ (ไม่จำลอง) · รุ่น 3.3 V = บอร์ด 'promini3' (8 MHz, ลอจิก 3.3 V)
        mcus.push({
          id: part.id, kind: 'uno', board: part.params.volt === 3.3 ? 'promini3' : 'promini', gnd: n(part.id, 'GND.1'), v33: -1, vbus: n(part.id, 'VCC'), vsys: -1, vref: -1,
          gp: NANO_DIGITAL.map((p) => n(part.id, p)), autorun: null, hex: part.params.hex, ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'mega': {
        // Mega 2560: ตัวจำลอง CPU ATmega2560 · ลำดับขา D0–D53, A0–A15 (ช่อง 54–69) · 3V3 จากเรกูเลเตอร์ LP2985 บนบอร์ด
        mcus.push({
          id: part.id, kind: 'uno', board: 'mega', gnd: n(part.id, 'GND.1'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: n(part.id, 'VIN'), vref: n(part.id, 'AREF'),
          gp: MEGA_DIGITAL.map((p) => n(part.id, p)), autorun: null, hex: part.params.hex, ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'unoq': {
        // UNO Q โหมดจำลองพฤติกรรม: ใช้ตัวจำลอง CPU ATmega328P รันสเก็ตช์ (คอมไพล์ด้วยบอร์ด 'unoq') แต่ขาเป็นไฟฟ้าแบบ STM32U585 3.3 V
        // Wire = หัวต่อ SDA/SCL (ไม่ต่อกับ A4/A5 บนบอร์ดนี้) · ไม่มี VIN จากแจ็ก DC (ใช้ USB-C)
        mcus.push({
          id: part.id, kind: 'uno', board: 'unoq', gnd: n(part.id, 'GND.1'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: n(part.id, 'VIN'), vref: n(part.id, 'AREF'),
          gp: UNO_DIGITAL.map((p) => n(part.id, p)), autorun: null, hex: part.params.hex, twi: [n(part.id, 'SDA'), n(part.id, 'SCL')], usbLimit: part.params.usbLimit,
          ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'uno': {
        mcus.push({
          id: part.id, kind: 'uno', gnd: n(part.id, 'GND.1'), v33: n(part.id, '3V3'), vbus: n(part.id, '5V'), vsys: n(part.id, 'VIN'), vref: n(part.id, 'AREF'),
          gp: UNO_DIGITAL.map((p) => n(part.id, p)), autorun: null, hex: part.params.hex, ...(part.params.eeprom ? { eeprom: part.params.eeprom } : {}),
        });
        break;
      }
      case 'dcsupply':
        if (part.params.outputOn) {
          elements.push({
            type: 'SUPPLY', id: part.id, p: n(part.id, 'pos'), n: n(part.id, 'neg'),
            V: part.params.voltage, Rint: part.params.internalResistance, Ilim: part.params.currentLimit,
          });
        } else inactive.push({ id: part.id, reason: 'เอาต์พุตแหล่งจ่ายปิดอยู่' });
        break;
    }
  }
  // ขดทุติยภูมิหม้อแปลงลอยจากวงจรอื่น (ต่อผ่านไดโอดเท่านั้น) — ช่วงที่ไดโอดทุกตัวดับ แรงดันของขดไม่ถูกกำหนด ทำให้ Newton ลู่เข้ายาก
  // ของจริงมีความจุแฝงระหว่างขดลวดกับแกน/สายดินอยู่แล้ว จึงยึดแท็ปกลางกับกราวด์ของวงจร (GND สโคป / GND ไอซีคงแรงดัน / ขั้วลบแหล่งจ่าย / GND Pico)
  // ด้วย 100 MΩ (กระแส < 0.2 µA ไม่มีผลต่อการวัด)
  const groundNet = (): number | null => {
    const pick: Array<[PartKind, string]> = [['scope', 'GND'], ['vreg', 'GND'], ['dcsupply', 'neg'], ['pico', 'GND'], ['rpi5', 'GND.1'], ['fgen', 'COM']];
    for (const [k, pin] of pick) for (const p of doc.parts) if (p.kind === k) { const x = n(p.id, pin); if (x >= 0) return x; }
    return null;
  };
  for (const id of transformers) {
    const g = groundNet(), ct = n(id, 'CT');
    if (g !== null && ct >= 0 && g !== ct) elements.push({ type: 'R', id: `${id}#leak`, role: 'module', a: ct, b: g, R: 1e8 });
  }
  return { netlist: { nodeCount: connectivity.nets.length + extraNodes, elements, ...(mcus.length ? { mcus } : {}), ...(tones.length ? { tones } : {}), ...(relays.length ? { relays } : {}), ...(timers.length ? { timers } : {}), ...(transformers.length ? { transformers } : {}), ...(servos.length ? { servos } : {}), ...(steppers.length ? { steppers } : {}), ...(gates.length ? { gates } : {}), ...(shiftregs.length ? { shiftregs } : {}), ...(counters.length ? { counters } : {}), ...(drivers.length ? { drivers } : {}), ...(sonars.length ? { sonars } : {}), ...(soils.length ? { soils } : {}), ...(dhts.length ? { dhts } : {}), ...(pirs.length ? { pirs } : {}), ...(i2cs.length ? { i2cs } : {}), ...(lcds.length ? { lcds } : {}), ...(tms.length ? { tms } : {}), ...(plcds.length ? { plcds } : {}), ...(encs.length ? { encs } : {}), ...(pumps.length ? { pumps } : {}), ...(meters.length ? { meters } : {}), ...(scrs.length ? { scrs } : {}), ...(comps.length ? { comps } : {}), ...(analyzers ? { analyzers } : {}) }, connectivity, inactive };
}

/** แปลงเป็น SPICE netlist (เพื่อตรวจเทียบกับ ngspice ในระยะถัดไป) */
export function toSpice(nl: Netlist, groundNode = 0): string {
  const node = (i: number) => (i === groundNode ? '0' : `n${i}`);
  const lines = ['* Circuit Lab 3D export'];
  let k = 0;
  for (const e of nl.elements) {
    k++;
    if (e.type === 'R') lines.push(`R${k}_${e.id} ${node(e.a)} ${node(e.b)} ${e.R}`);
    else if (e.type === 'C') lines.push(`C${k}_${e.id} ${node(e.a)} ${node(e.b)} ${e.C}`);
    else if (e.type === 'L') { lines.push(`L${k}_${e.id} ${node(e.a)} m${k} ${e.L}`); lines.push(`R${k}_${e.id}_dcr m${k} ${node(e.b)} ${Math.max(e.R, 1e-3)}`); }
    else if (e.type === 'LED' || e.type === 'D') {
      lines.push(`D${k}_${e.id} ${node(e.a)} ${node(e.k)} DM${k}`);
      lines.push(`.model DM${k} D(IS=${e.Is} N=${e.n} RS=${e.Rs}${e.Bv !== undefined && isFinite(e.Bv) ? ` BV=${e.Bv} IBV=${e.Ibv}` : ''})`);
    } else if (e.type === 'MOS') {
      lines.push(`M${k}_${e.id} ${node(e.d)} ${node(e.g)} ${node(e.s)} ${node(e.s)} MM${k}`);
      lines.push(`.model MM${k} ${e.pol === 1 ? 'NMOS' : 'PMOS'}(LEVEL=1 VTO=${e.pol * e.vth} KP=${e.kp} LAMBDA=${e.lambda})`);
    } else if (e.type === 'BJT') {
      lines.push(`Q${k}_${e.id} ${node(e.c)} ${node(e.b)} ${node(e.e)} QM${k}`);
      lines.push(`.model QM${k} ${e.pol === 1 ? 'NPN' : 'PNP'}(IS=${e.Is} BF=${e.bf} BR=${e.br})`);
    } else if (e.type === 'OPAMP') {
      lines.push(`* ${e.id}: ออปแอมป์เชิงพฤติกรรม (A=${e.A}, Rout=${e.Rout}, headroom=${e.headroom}, GBW=${e.gbw} Hz, SR=${e.sr} V/s — ต้องเพิ่มขั้วและ slew เอง) ใช้ B-source/subckt ใน ngspice`);
      lines.push(`E${k}_${e.id} o${k} 0 ${node(e.inp)} ${node(e.inn)} ${e.A}`);
      lines.push(`R${k}_${e.id}_out o${k} ${node(e.out)} ${e.Rout}`);
    } else if (e.type === 'FGEN') {
      const A = e.vpp / 2;
      const src = e.wave === 'sine' ? `SIN(${e.offset} ${A} ${e.freq})`
        : e.wave === 'square' ? `PULSE(${e.offset + A} ${e.offset - A} ${0.5 / e.freq} 1n 1n ${0.5 / e.freq} ${1 / e.freq})`
        : e.wave === 'triangle' ? `PULSE(${e.offset - A} ${e.offset + A} ${-0.25 / e.freq} ${0.5 / e.freq} ${0.5 / e.freq} 0 ${1 / e.freq})`
        : `DC ${e.offset}`;
      lines.push(`V${k}_${e.id} v${k}int ${node(e.n)} ${src}`);
      lines.push(`R${k}_${e.id}_out v${k}int ${node(e.p)} ${e.Rout}`);
    } else {
      lines.push(`V${k}_${e.id} v${k}int ${node(e.n)} DC ${e.V}`);
      lines.push(`R${k}_${e.id}_int v${k}int ${node(e.p)} ${e.Rint}`);
      lines.push(`* current limit ${e.Ilim} A (CC mode not represented in plain SPICE)`);
    }
  }
  lines.push('.op', '.end');
  return lines.join('\n');
}
