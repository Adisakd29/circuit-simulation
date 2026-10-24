import { computeConnectivity, netOfPin, type Connectivity } from '../connectivity/connectivity';
import type { CircuitDoc, PartKind, WaveShape } from '../model/types';
import { LM393_CHANNELS, ntcResistance, SCR_GATE_DIODE, SCR_ON_DIODE, vomInternalR, vomPosition, STEPPER_INPUTS, HC595_OUTS, sonarEchoWidth, L293D_CHANNELS, lm35Vout, CD4017_OUTS, PICO_GPIO, SEG_NAMES, SEG_PINS, diodeParamsFor, ldrResistance, ledParamsFor, logicGates, transformerModel } from '../model/catalog';

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
  | { type: 'FGEN'; id: string; p: number; n: number; wave: WaveShape; freq: number; vpp: number; offset: number; Rout: number };

/**
 * ไมโครคอนโทรลเลอร์ (Raspberry Pi Pico) — solver ไม่รู้จักโดยตรง: engine จำลอง CPU แล้ว "ขยาย" เป็นแหล่งแรงดัน
 * ตามสถานะขาในขณะนั้น (ดู src/mcu/cosim.ts) gp[i] = เน็ตของ GPi (−1 = ไม่มีขานั้นบนบอร์ด)
 */
export interface McuSpec { id: string; gnd: number; v33: number; vbus: number; vsys: number; vref: number; gp: number[]; autorun: string | null }

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
  /** มัลติมิเตอร์: element ที่วัด (แรงดันตกคร่อม หรือกระแสผ่าน) — ToneMeter หาค่าเฉลี่ย/ค่า AC ตามเวลา */
  meters?: MeterSpec[];
}

/** mode = ตำแหน่งสวิตช์ (เปลี่ยนย่าน → เริ่มเฉลี่ยใหม่) */
export interface ScrSpec { id: string; a: number; g: number; k: number; igt: number; ih: number; vdrm: number; on: { Is: number; n: number; Rs: number } }

export interface MeterSpec { id: string; el: string; q: 'v' | 'i'; mode: string }

/** HC-SR04: echoWidth = ความกว้างพัลส์ ECHO ที่จะให้ (s) */
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
export interface StepperSpec { id: string; coils: string[]; vcc: number; gnd: number; stepsPerRev: number; pullIn: number; pullOut: number; minCoilCurrent: number }
export interface ServoSpec { id: string; sig: number; gnd: number; vcc: number; pulseMin: number; pulseMax: number; speed: number; vMin: number; vMax: number }

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
  return nl.elements.some((e) => e.type === 'C' || e.type === 'L' || e.type === 'FGEN') || !!nl.sonars?.length;
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
  const scrs: ScrSpec[] = [];
  const comps: CompSpec[] = [];
  const gates: GateSpec[] = [];
  const counters: CounterSpec[] = [];
  const shiftregs: ShiftSpec[] = [];
  const drivers: DriverSpec[] = [];
  const sonars: SonarSpec[] = [];
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
      case 'opamp':
        elements.push({
          type: 'OPAMP', id: part.id, inp: n(part.id, 'IN+'), inn: n(part.id, 'IN-'), out: n(part.id, 'OUT'), vp: n(part.id, 'V+'), vn: n(part.id, 'V-'),
          A: part.params.gain, Rout: part.params.outputResistance, headroom: part.params.headroom,
          Rin: part.params.inputResistance, Rq: part.params.quiescentResistance, gbw: part.params.gbw, sr: part.params.slewRate,
        });
        break;
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
        steppers.push({ id: part.id, coils: [1, 2, 3, 4].map((c) => `${part.id}#c${c}`), vcc: V, gnd: G, stepsPerRev: pr.stepsPerRev, pullIn: pr.pullIn, pullOut: pr.pullOut, minCoilCurrent: pr.minCoilCurrent });
        break;
      }
      case 'servo': {
        // วงจรควบคุมในตัว: กระแสนิ่ง (ตัวต้านทานเทียบเท่าที่ 4.8 V) + ขาสัญญาณ 100 kΩ — กระแสมอเตอร์ขณะหมุนไม่อยู่ในแบบจำลอง
        const pr = part.params;
        const G = n(part.id, 'GND'), V = n(part.id, 'V'), S = n(part.id, 'SIG');
        elements.push({ type: 'R', id: `${part.id}#q`, role: 'module', a: V, b: G, R: 4.8 / pr.idleCurrent });
        elements.push({ type: 'R', id: `${part.id}#in`, role: 'module', a: S, b: G, R: 1e5 });
        servos.push({ id: part.id, sig: S, gnd: G, vcc: V, pulseMin: pr.pulseMin, pulseMax: pr.pulseMax, speed: pr.speed, vMin: pr.vMin, vMax: pr.vMax });
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
      case 'scope': {
        // ขาเข้าแต่ละช่องเป็นความต้านทาน 1 MΩ ลง GND (โหลดวงจรเล็กน้อยเหมือนเครื่องจริง)
        const g = n(part.id, 'GND');
        elements.push({ type: 'R', id: `${part.id}#ch1`, role: 'scope', a: n(part.id, 'CH1'), b: g, R: part.params.inputResistance });
        elements.push({ type: 'R', id: `${part.id}#ch2`, role: 'scope', a: n(part.id, 'CH2'), b: g, R: part.params.inputResistance });
        break;
      }
      case 'pico': {
        const gp = Array.from({ length: 29 }, (_, i) => (PICO_GPIO.includes(i) ? n(part.id, `GP${i}`) : -1));
        mcus.push({
          id: part.id, gnd: n(part.id, 'GND'), v33: n(part.id, '3V3'), vbus: n(part.id, 'VBUS'), vsys: n(part.id, 'VSYS'),
          vref: n(part.id, 'ADC_VREF'), gp, autorun: part.params.autorun ? part.params.code : null,
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
    const pick: Array<[PartKind, string]> = [['scope', 'GND'], ['vreg', 'GND'], ['dcsupply', 'neg'], ['pico', 'GND'], ['fgen', 'COM']];
    for (const [k, pin] of pick) for (const p of doc.parts) if (p.kind === k) { const x = n(p.id, pin); if (x >= 0) return x; }
    return null;
  };
  for (const id of transformers) {
    const g = groundNet(), ct = n(id, 'CT');
    if (g !== null && ct >= 0 && g !== ct) elements.push({ type: 'R', id: `${id}#leak`, role: 'module', a: ct, b: g, R: 1e8 });
  }
  return { netlist: { nodeCount: connectivity.nets.length + extraNodes, elements, ...(mcus.length ? { mcus } : {}), ...(tones.length ? { tones } : {}), ...(relays.length ? { relays } : {}), ...(timers.length ? { timers } : {}), ...(transformers.length ? { transformers } : {}), ...(servos.length ? { servos } : {}), ...(steppers.length ? { steppers } : {}), ...(gates.length ? { gates } : {}), ...(shiftregs.length ? { shiftregs } : {}), ...(counters.length ? { counters } : {}), ...(drivers.length ? { drivers } : {}), ...(sonars.length ? { sonars } : {}), ...(meters.length ? { meters } : {}), ...(scrs.length ? { scrs } : {}), ...(comps.length ? { comps } : {}) }, connectivity, inactive };
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
