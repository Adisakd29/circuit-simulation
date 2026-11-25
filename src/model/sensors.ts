/**
 * เซนเซอร์ชุด 1 (รอบ 87): โมดูลที่ให้สัญญาณดิจิทัล/อนาล็อกโดยตรง — บอร์ดทุกตัวอ่านผ่าน GPIO/ADC ได้
 *
 * โมดูลคอมพาราเตอร์ LM393 (เปลวไฟ เสียง ฝน MQ-2 ตรวจเส้น สั่นสะเทือน) สร้างจากอุปกรณ์ในวงจรจริงของโมดูล ไม่ใช่การกำหนดระดับขาออกตรงๆ:
 *   - ส่วนรับรู้ = ตัวแบ่งแรงดันจาก VCC (ความต้านทานของตัวรับรู้ขึ้นกับสภาพแวดล้อมที่ตั้งในแผง) → ขา AO
 *   - ทริมพอต 10 kΩ ระหว่าง VCC–GND → แรงดันอ้างอิง (จุดตัด) เป็นสัดส่วนของ VCC
 *   - คอมพาราเตอร์ LM393 ขาออก open-collector (สถานะใน solver แบบเดียวกับไอซี LM393 ในคลัง) + ตัวต้านทานดึงขึ้น 10 kΩ ไป VCC → ขา DO
 *   - LED ไฟเลี้ยง (1 kΩ + LED แดง) และ LED แสดงผลที่ DO (1 kΩ + LED จาก VCC เข้าขาออก — ติดเมื่อ DO ต่ำ)
 *   ผลที่ตามมา: DO/AO แปรตามไฟเลี้ยงจริง, ไม่มีไฟเลี้ยง = ไม่ทำงาน, ใช้ไฟ 5 V แล้ว DO สูงถึง 5 V (อันตรายต่อขา 3.3 V), เสียงที่ดังเกินจุดตัดทำให้ DO กระพริบตามคลื่นเสียง
 *   ค่าองค์ประกอบ (10 kΩ, 1 kΩ) เป็นค่าที่พบบ่อยในวงจรโมดูลแบบนี้ — โมดูลแต่ละผู้ผลิตอาจต่างกัน
 *
 * ค่าความไวของตัวรับรู้แต่ละชนิดเป็น "แบบจำลองเพื่อการสอน" ระบุไว้ในแต่ละฟังก์ชัน พร้อมแหล่งอ้างอิงเมื่อมี
 */
import type { CircuitDoc, Part, Placement, SensorKind, SensorPart } from './types';
import type { CompSpec, NetlistElement } from '../sim/netlist';

export const SENSOR_KINDS = ['flame', 'soundsensor', 'rainsensor', 'mq2', 'linetrack', 'vibsensor', 'touch', 'hall', 'reed', 'tilt', 'waterlevel', 'fsr'] as const satisfies readonly SensorKind[];
export const LM393_MODULE_KINDS = ['flame', 'soundsensor', 'rainsensor', 'mq2', 'linetrack', 'vibsensor'] as const;
export function isSensorKind(k: unknown): k is SensorKind { return (SENSOR_KINDS as readonly string[]).includes(k as string); }
export function isSensor(p: { kind: string }): p is SensorPart { return isSensorKind(p.kind); }
export function isLm393Module(p: { kind: string }): p is Extract<SensorPart, { kind: (typeof LM393_MODULE_KINDS)[number] }> { return (LM393_MODULE_KINDS as readonly string[]).includes(p.kind); }

const VT = 0.025852;
/** LED แดงบนโมดูล: Vf 2.0 V ที่ 20 mA (แบบเดียวกับ ledParamsFor('red')) */
const LED_RED = { Is: 0.02 / (Math.exp((2.0 - 0.1) / (2 * VT)) - 1), n: 2, Rs: 5 };
/** LED อินฟราเรด 950 nm ใน TCRT5000: VF ≈ 1.25 V ที่ 60 mA (เอกสาร Vishay TCRT5000) */
const LED_IR = { Is: 0.06 / (Math.exp((1.25 - 0.06) / (1.6 * VT)) - 1), n: 1.6, Rs: 1 };
const OPEN = 1e9;

/* ============================== ฟิสิกส์ของตัวรับรู้ ============================== */

/** เปลวไฟ: ความเข้มรังสีอินฟราเรด (หน่วยสัมพัทธ์) ∝ 1/d² — E = 1 ที่ระยะอ้างอิง (AO = VCC/2) · แดดจัดเพิ่มพื้นหลัง E = 4 (ของจริงทำให้ตรวจผิด) */
export function flameIrradiance(p: { flame: boolean; distance: number; refDistance: number; sunlight: boolean }): number {
  const d = Math.max(p.distance, 1);
  return (p.flame ? (p.refDistance / d) ** 2 : 0) + (p.sunlight ? 4 : 0);
}
/** ตัวรับ IR ทำงานเหมือนตัวต้านทานไวแสง: G = E/10 kΩ (+ กระแสมืด) → AO/VCC = 1/(1 + E) */
export function flameSenseR(p: Parameters<typeof flameIrradiance>[0]): number { return 1 / (flameIrradiance(p) / 1e4 + 1e-9); }

/** แผ่นตรวจฝน: ลายทองแดงสลับสองชุด · แห้ง = เปิดวงจร · เปียก w% → R = rWet·100/w (rWet = เปียกทั้งแผ่นด้วยน้ำประปา — ค่าประมาณ) */
export function rainSenseR(p: { wet: number; rWet: number }): number { return p.wet <= 0 ? OPEN : (p.rWet * 100) / Math.min(100, p.wet); }

/**
 * MQ-2: เส้นโค้ง Rs/Ro (log–log เส้นตรง) จากจุดสองจุดบนกราฟในเอกสาร Hanwei ตามที่ใช้ในโค้ดตัวอย่างของ Sandbox Electronics
 * {x = log10(200 ppm), y = log10(Rs/Ro), slope}: LPG {2.3, 0.21, −0.47}, ควัน {2.3, 0.53, −0.44}, CO {2.3, 0.72, −0.34} · อากาศสะอาด Rs/Ro = 9.83
 */
export const MQ2_CURVES = { lpg: [2.3, 0.21, -0.47], smoke: [2.3, 0.53, -0.44], co: [2.3, 0.72, -0.34] } as const;
export const MQ2_CLEAN_AIR = 9.83;
export function mq2Ratio(gas: keyof typeof MQ2_CURVES, ppm: number): number {
  if (ppm <= 0) return MQ2_CLEAN_AIR;
  const [x, y, m] = MQ2_CURVES[gas];
  return Math.min(MQ2_CLEAN_AIR, 10 ** (y + m * (Math.log10(ppm) - x)));
}
export function mq2Rs(p: { gas: keyof typeof MQ2_CURVES; ppm: number; ro: number }): number { return p.ro * mq2Ratio(p.gas, p.ppm); }
/** ความเข้มข้นที่คำนวณกลับจาก Rs/Ro (สูตรเดียวกับ MQGetPercentage) */
export function mq2PpmFromRatio(gas: keyof typeof MQ2_CURVES, ratio: number): number { const [x, y, m] = MQ2_CURVES[gas]; return 10 ** ((Math.log10(ratio) - y) / m + x); }

/** TCRT5000: ผิวขาวสะท้อน ≈ 0.9, ดำ ≈ 0.05 (สัมพัทธ์) · สูงเกินระยะโฟกัส 2.5 mm แสงลดตาม (2.5/h)² · ทรานซิสเตอร์รับแสง G = E/1 kΩ */
export const LINE_REFLECT = { white: 0.9, black: 0.05, none: 0 } as const;
export function lineSenseR(p: { surface: keyof typeof LINE_REFLECT; height: number }): number {
  const h = Math.max(p.height, 0.5);
  const E = LINE_REFLECT[p.surface] * (h <= 2.5 ? 1 : (2.5 / h) ** 2);
  return 1 / (E / 1000 + 1e-7);
}

/** ไมโครโฟนอิเล็กเตรต: ความไว (dBV/Pa) → แรงดันยอดของคลื่นไซน์ที่ระดับเสียง level dB SPL (อ้างอิง 20 µPa) */
export function micPeak(p: { level: number; sensitivity: number }): number { return Math.SQRT2 * 10 ** (p.sensitivity / 20) * 20e-6 * 10 ** (p.level / 20); }

/**
 * แม่เหล็กนีโอไดเมียมทรงกระบอก Ø10 × 3 mm (N35, Br ≈ 1.2 T): สนามบนแกน B(z) = Br/2·[(z+L)/√((z+L)²+R²) − z/√(z²+R²)]
 * คืนค่าเป็นเกาส์ (1 mT = 10 G) · ขั้วเหนือหันเข้าหน้าเซนเซอร์ = สนามติดลบ (ตามแบบแผนของ Allegro: ขั้วใต้ = บวก)
 */
export const MAGNET = { Br: 1.2, R: 5, L: 3 };
export function magnetGauss(distanceMm: number, pole: 'S' | 'N' = 'S'): number {
  const z = Math.max(0, distanceMm), { Br, R, L } = MAGNET;
  const B = (Br / 2) * ((z + L) / Math.hypot(z + L, R) - z / Math.hypot(z, R));
  return (pole === 'S' ? 1 : -1) * B * 1e4;
}
/** สวิตช์แม่เหล็กแบบมีฮิสเทอรีซิส: ถึงจุดทำงาน → ติด · ต่ำกว่าจุดปล่อย → ดับ · อยู่ระหว่างกลาง = คงสถานะเดิม */
export function hallNext(prev: boolean, gauss: number, bop: number, brp: number): boolean { return gauss >= bop ? true : gauss < brp ? false : prev; }
export function reedNext(prev: boolean, magnet: boolean, d: number, operate: number, release: number): boolean { return !magnet ? false : d <= operate ? true : d >= release ? false : prev; }
/** สถานะจริงของ Hall/รีด: พารามิเตอร์ on/closed เก็บสถานะก่อนหน้า (ใช้เฉพาะเมื่อสนาม/ระยะอยู่ในช่วงฮิสเทอรีซิส) */
export function hallOn(p: { magnet: boolean; distance: number; pole: 'S' | 'N'; on: boolean; bop: number; brp: number }): boolean { return hallNext(p.on, p.magnet ? magnetGauss(p.distance, p.pole) : 0, p.bop, p.brp); }
export function reedClosed(p: { magnet: boolean; distance: number; closed: boolean; operate: number; release: number }): boolean { return reedNext(p.closed, p.magnet, p.distance, p.operate, p.release); }

/**
 * FSR 402: ตารางค่าทั่วไปของ Adafruit (0.2 N 30 kΩ · 1 N 6 kΩ · 10 N 1 kΩ · 100 N 250 Ω) + ช่วงแรงกดเบา ≈ 100 kΩ ที่ 0.1 N
 * ประมาณค่าระหว่างจุดแบบ log–log · ไม่กด (< 0.1 N) = เปิดวงจร (> 10 MΩ) · ตัวต่อตัวต่างกันได้ ≈ ±10%
 */
export const FSR_TABLE: Array<[number, number]> = [[0.1, 100e3], [0.2, 30e3], [1, 6e3], [10, 1e3], [100, 250]];
export function fsrResistance(force: number): number {
  if (force < FSR_TABLE[0][0]) return 1e7 * 10;
  for (let i = 1; i < FSR_TABLE.length; i++) {
    const [f0, r0] = FSR_TABLE[i - 1], [f1, r1] = FSR_TABLE[i];
    if (force <= f1) return 10 ** (Math.log10(r0) + ((Math.log10(force) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0))) * (Math.log10(r1) - Math.log10(r0)));
  }
  return FSR_TABLE[FSR_TABLE.length - 1][1];
}

/** เซนเซอร์ระดับน้ำ: ความนำไฟฟ้า ∝ ความยาวลายที่จมน้ำ · จุ่มเต็ม = S/VCC = fullRatio (≈ 521/1023 ที่ 5 V ตามค่าตัวอย่างของ arduinogetstarted) */
export function waterRatio(p: { level: number; fullRatio: number }): number {
  const g = (Math.max(0, Math.min(100, p.level)) / 100) * (p.fullRatio / (1 - p.fullRatio));
  return g / (1 + g);
}

/** TTP223: ระดับขาออก (true = สูง) */
export function touchOutHigh(p: { touched: boolean; activeLow: boolean; toggleMode: boolean; toggled: boolean }): boolean {
  const active = p.toggleMode ? p.toggled : p.touched;
  return p.activeLow ? !active : active;
}
export function tiltClosed(p: { angle: number; onAngle: number }): boolean { return Math.abs(p.angle) <= p.onAngle; }

/* ============================== ขา ============================== */

export interface SensorPinDef { name: string; label: string; dx: number; dy: number }
const MOD4 = (ao: string, d: string): SensorPinDef[] => [
  { name: 'VCC', label: 'VCC ไฟเลี้ยง 3.3–5 V', dx: 0, dy: 0 },
  { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
  { name: 'DO', label: `DO ${d} (open-collector ดึงขึ้น 10 kΩ ไป VCC)`, dx: 2, dy: 0 },
  { name: 'AO', label: `AO ${ao}`, dx: 3, dy: 0 },
];
export function sensorPinDefs(part: SensorPart): SensorPinDef[] {
  switch (part.kind) {
    case 'flame': return MOD4('แรงดันลดลงเมื่อรังสีจากเปลวไฟมากขึ้น', 'ต่ำเมื่อพบเปลวไฟ');
    case 'soundsensor': return MOD4('สัญญาณไมโครโฟน (ไบแอส ≈ VCC/2)', 'ต่ำขณะเสียงดังเกินจุดตัด');
    case 'rainsensor': return MOD4('แรงดันลดลงเมื่อแผ่นเปียกมากขึ้น', 'ต่ำเมื่อเปียก');
    case 'mq2': return [{ ...MOD4('', '')[0], label: 'VCC ไฟเลี้ยง 5 V (ฮีตเตอร์ ≈ 170 mA)' }, ...MOD4('แรงดันเพิ่มขึ้นตามความเข้มข้นแก๊ส', 'ต่ำเมื่อแก๊สเกินจุดตัด').slice(1)];
    case 'linetrack': return MOD4('ผิวขาว = ต่ำ · เส้นดำ = สูง', 'ต่ำบนผิวขาว · สูงบนเส้นดำ');
    case 'vibsensor': return MOD4('', 'ต่ำขณะนิ่ง · สูงเมื่อสั่น').slice(0, 3);
    case 'touch': return [
      { name: 'GND', label: 'GND กราวด์', dx: 0, dy: 0 },
      { name: 'VCC', label: 'VCC ไฟเลี้ยง 2.0–5.5 V', dx: 1, dy: 0 },
      { name: 'IO', label: 'I/O ขาออก CMOS (แตะ = สูง ในโหมดเริ่มต้น)', dx: 2, dy: 0 },
    ];
    case 'hall': return [
      { name: 'VCC', label: 'ขา 1 VCC 4.5–24 V', dx: 0, dy: 0 },
      { name: 'GND', label: 'ขา 2 GND', dx: 1, dy: 0 },
      { name: 'OUT', label: 'ขา 3 OUT open-collector (ต่ำเมื่อขั้วใต้ใกล้) — ต้องมีตัวต้านทานดึงขึ้น', dx: 2, dy: 0 },
    ];
    case 'reed': return [{ name: '1', label: 'ขา 1', dx: 0, dy: 0 }, { name: '2', label: 'ขา 2', dx: part.params.span, dy: 0 }];
    case 'tilt': return [{ name: '1', label: 'ขา 1', dx: 0, dy: 0 }, { name: '2', label: 'ขา 2', dx: 1, dy: 0 }];
    case 'waterlevel': return [
      { name: 'S', label: 'S สัญญาณอนาล็อก (สูงขึ้นตามระดับน้ำ)', dx: 0, dy: 0 },
      { name: '+', label: '+ ไฟเลี้ยง 3.3–5 V (ควรจ่ายเฉพาะตอนอ่าน)', dx: 1, dy: 0 },
      { name: '-', label: '− กราวด์', dx: 2, dy: 0 },
    ];
    case 'fsr': return [{ name: '1', label: 'ขา 1', dx: 0, dy: 0 }, { name: '2', label: 'ขา 2', dx: 1, dy: 0 }];
  }
}

/* ============================== ค่าเริ่มต้น ============================== */

const LM = { vMin: 3.0, vMax: 5.5 };
export function sensorDefaults(kind: SensorKind): SensorPart['params'] {
  switch (kind) {
    case 'flame': return { ...LM, threshold: 0.5, flame: false, distance: 30, refDistance: 50, sunlight: false };
    case 'soundsensor': return { ...LM, threshold: 0.503, sound: false, level: 110, frequency: 500, sensitivity: -48 };
    case 'rainsensor': return { ...LM, threshold: 0.5, wet: 0, rWet: 2000 };
    case 'mq2': return { vMin: 4.5, vMax: 5.5, threshold: 0.4, gas: 'lpg', ppm: 0, ro: 2000, rl: 1000, heaterR: 29 };
    case 'linetrack': return { ...LM, threshold: 0.5, surface: 'white', height: 2.5 };
    case 'vibsensor': return { ...LM, threshold: 0.5, vibrating: false };
    case 'touch': return { touched: false, activeLow: false, toggleMode: false, toggled: false, vMin: 2.0, vMax: 5.5, rOut: 100 };
    case 'hall': return { magnet: false, distance: 20, pole: 'S', on: false, bop: 200, brp: 145, vMin: 4.5, vMax: 24, sinkMax: 0.025 };
    case 'reed': return { magnet: false, distance: 20, closed: false, operate: 10, release: 14, contactResistance: 0.1, maxCurrent: 0.5, maxVoltage: 200, span: 5 };
    case 'tilt': return { angle: 0, onAngle: 45, contactResistance: 1, maxCurrent: 0.02, maxVoltage: 12 };
    case 'waterlevel': return { level: 0, fullRatio: 0.51, rOut: 10000, vMin: 3.0, vMax: 5.5 };
    case 'fsr': return { force: 0, maxPower: 0.1 };
  }
}
export function makeSensorPart(kind: SensorKind, id: string, label: string, placement: Placement): SensorPart {
  return { id, label, kind, placement, params: sensorDefaults(kind) } as SensorPart;
}

/* ============================== คลังอุปกรณ์ ============================== */

export const SENSOR_CATALOG = [
  {
    kind: 'flame', name: 'โมดูลตรวจจับเปลวไฟ (IR 760–1100 nm, LM393)', nameEn: 'IR flame sensor module (LM393)', labelPrefix: 'U',
    keywords: ['flame', 'fire', 'เปลวไฟ', 'ไฟไหม้', 'ไฟ', 'อินฟราเรด', 'lm393', 'ky-026', 'เตือนภัย'],
    description: 'โมดูล 4 ขา VCC GND DO AO (3.3–5 V) · ตัวรับอินฟราเรด 760–1100 nm มุมรับ ≈ 60° · AO สูงเมื่อไม่มีไฟ และลดลงเมื่อรังสีจากเปลวไฟมากขึ้น · DO ต่ำ (LED บนโมดูลติด) เมื่อ AO ต่ำกว่าจุดตัดที่ตั้งด้วยทริมพอต · ตั้งเปลวไฟ ระยะ และแดดในแผงคุณสมบัติ · ลำดับขาของโมดูลแต่ละผู้ผลิตอาจต่างกัน ตรวจป้ายบนแผ่นจริง',
  },
  {
    kind: 'soundsensor', name: 'โมดูลตรวจจับเสียง (ไมโครโฟน + LM393)', nameEn: 'Sound sensor module (electret mic + LM393)', labelPrefix: 'U',
    keywords: ['sound', 'microphone', 'mic', 'เสียง', 'ไมค์', 'ไมโครโฟน', 'ปรบมือ', 'clap', 'ky-038', 'lm393'],
    description: 'โมดูล 4 ขา VCC GND DO AO (3.3–5 V) · ไมโครโฟนอิเล็กเตรต (ความไว ≈ −48 dBV/Pa) ไม่มีวงขยาย — AO คือแรงดันไบแอส ≈ VCC/2 บวกสัญญาณเสียงขนาดไม่กี่มิลลิโวลต์ · DO ต่ำขณะยอดคลื่นเกินจุดตัด จึงกระพริบตามคลื่นเสียง (โค้ดควรจับขอบหรืออ่านซ้ำหลายครั้ง) · ทริมพอตหลายรอบปรับจุดตัดละเอียด · ปุ่ม "ปรบมือ" ในแผงคุณสมบัติ',
  },
  {
    kind: 'rainsensor', name: 'เซนเซอร์น้ำฝน (แผ่นตรวจ + โมดูล LM393)', nameEn: 'Raindrop sensor (sensing pad + LM393 module)', labelPrefix: 'U',
    keywords: ['rain', 'raindrop', 'water', 'ฝน', 'น้ำฝน', 'หยดน้ำ', 'fc-37', 'yl-83', 'lm393'],
    description: 'โมดูล 4 ขา VCC GND DO AO (3.3–5 V) + แผ่นตรวจลายทองแดงสลับ · แผ่นแห้ง AO ≈ VCC, เปียกมากขึ้น AO ลดลง · DO ต่ำเมื่อเปียก (เทียบจุดตัดที่ทริมพอต) · ของจริง: ลายทองแดงกัดกร่อนเร็วถ้าจ่ายไฟตลอด ให้จ่ายไฟเฉพาะตอนอ่าน',
  },
  {
    kind: 'mq2', name: 'โมดูลตรวจแก๊ส/ควัน MQ-2', nameEn: 'MQ-2 gas / smoke sensor module', labelPrefix: 'U',
    keywords: ['mq-2', 'mq2', 'gas', 'smoke', 'lpg', 'แก๊ส', 'ควัน', 'แก๊สรั่ว', 'ไฟไหม้', 'lm393'],
    description: 'โมดูล 4 ขา VCC GND DO AO ใช้ไฟ 5 V · ฮีตเตอร์ 29 Ω ±3 Ω กินกระแส ≈ 170 mA (เอกสาร Winsen) · ตัวรับรู้ Rs ต่ออนุกรมตัวต้านทานโหลด RL 1 kΩ: AO = VCC·RL/(RL + Rs) สูงขึ้นตามความเข้มข้นแก๊ส · DO ต่ำเมื่อ AO เกินจุดตัด · ช่วงตรวจวัด 300–10,000 ppm · ของจริงต้องอุ่นเครื่องนาน (ครั้งแรก ≥ 24–48 ชม.) และต้องปรับเทียบ Ro ในอากาศสะอาด',
  },
  {
    kind: 'linetrack', name: 'โมดูลตรวจเส้น TCRT5000', nameEn: 'TCRT5000 line tracking sensor module', labelPrefix: 'U',
    keywords: ['tcrt5000', 'line', 'track', 'tracking', 'เส้น', 'ตรวจเส้น', 'หุ่นยนต์เดินตามเส้น', 'สะท้อน', 'อินฟราเรด'],
    description: 'โมดูล 4 ขา VCC GND DO AO (3.3–5 V) · LED อินฟราเรด + ทรานซิสเตอร์รับแสงหันลงพื้น ระยะใช้งาน 1–8 mm (โฟกัส 2.5 mm) · ผิวขาวสะท้อนมาก: AO ต่ำ DO ต่ำ (LED ติด) · เส้นดำดูดกลืน: DO สูง · ตั้งสีพื้นและความสูงในแผงคุณสมบัติ',
  },
  {
    kind: 'vibsensor', name: 'โมดูลตรวจการสั่นสะเทือน SW-420', nameEn: 'SW-420 vibration sensor module', labelPrefix: 'U',
    keywords: ['sw-420', 'sw420', 'vibration', 'shock', 'สั่น', 'สั่นสะเทือน', 'เคาะ', 'แผ่นดินไหว', 'lm393'],
    description: 'โมดูล 3 ขา VCC GND DO (3.3–5 V) · สวิตช์สปริง SW-420 ปกติปิด: นิ่ง = DO ต่ำ · สั่นจนหน้าสัมผัสเปิด = DO สูง (LM393 เทียบกับจุดตัด) · กด "เคาะ" หรือตั้ง "กำลังสั่น" ในแผงคุณสมบัติ',
  },
  {
    kind: 'touch', name: 'โมดูลสัมผัส TTP223', nameEn: 'TTP223 capacitive touch module', labelPrefix: 'U',
    keywords: ['ttp223', 'touch', 'capacitive', 'สัมผัส', 'แตะ', 'ปุ่มสัมผัส', 'ปุ่ม'],
    description: 'โมดูล 3 ขา GND VCC I/O (2.0–5.5 V) · ขาออก CMOS ระดับเท่าไฟเลี้ยง — โหมดเริ่มต้น: แตะ = สูง ปล่อย = ต่ำ · จัมเปอร์บัดกรีสองจุดเลือก "ขาออก active-low" และ "โหมดสลับ (แตะครั้งเดียวค้าง)" — ตัวอักษร A/B บนแผ่นต่างกันตามผู้ผลิต · ลำดับขาบางรุ่นเป็น VCC I/O GND ตรวจป้ายบนแผ่นจริง',
  },
  {
    kind: 'hall', name: 'เซนเซอร์แม่เหล็ก Hall A3144 (TO-92S)', nameEn: 'A3144 Hall-effect switch (TO-92S / UA)', labelPrefix: 'HS',
    keywords: ['hall', 'a3144', '3144', 'magnet', 'แม่เหล็ก', 'ฮอลล์', 'นับรอบ', 'ความเร็วรอบ', 'rpm'],
    description: 'A3144 มองด้านมีตัวอักษร ขาลง: 1 VCC (4.5–24 V), 2 GND, 3 OUT · ขาออก open-collector ต้องมีตัวต้านทานดึงขึ้น (เช่น 10 kΩ หรือ INPUT_PULLUP) · ขั้วใต้ของแม่เหล็กหันเข้าหน้าตัวอักษร สนาม ≥ BOP → OUT ต่ำ, < BRP → ปล่อย (ฮิสเทอรีซิส) · ขั้วเหนือไม่ทำงาน · ใช้ไฟ 3.3 V ต่ำกว่าเอกสารกำหนด',
  },
  {
    kind: 'reed', name: 'สวิตช์แม่เหล็ก (reed switch) ปกติเปิด', nameEn: 'Reed switch (normally open) with magnet', labelPrefix: 'SW',
    keywords: ['reed', 'magnet', 'door', 'แม่เหล็ก', 'รีด', 'ประตู', 'หน้าต่าง', 'กันขโมย', 'สวิตช์'],
    description: 'หน้าสัมผัสสองแผ่นในหลอดแก้ว ปกติเปิด · แม่เหล็กเข้าใกล้ถึงระยะทำงาน → ต่อกัน, ห่างเกินระยะปล่อย → เปิด · ใช้เป็นเซนเซอร์ประตู/หน้าต่าง (ต่อกับขาเข้าที่ดึงขึ้นหรือดึงลง) · พิกัดหน้าสัมผัสแบบ Littelfuse 59140: 0.5 A, 200 V DC, 10 W · หลอดแก้วเปราะ อย่างอขาชิดตัวหลอด',
  },
  {
    kind: 'tilt', name: 'สวิตช์เอียง SW-520D (ลูกบอล)', nameEn: 'SW-520D ball tilt switch', labelPrefix: 'SW',
    keywords: ['tilt', 'sw-520d', 'sw520d', 'ball', 'เอียง', 'ล้ม', 'ตะแคง', 'สวิตช์'],
    description: 'ลูกบอลโลหะในกระบอก 2 ขา · ตั้งขาชี้ลง (เอียงไม่เกิน ≈ 45°) ลูกบอลแตะสองขา = ต่อกัน · เอียงเกิน/คว่ำ = เปิด · พิกัด < 12 V < 20 mA · ของจริงหน้าสัมผัสเด้งขณะเปลี่ยนสถานะ ควรหน่วงเวลาในโค้ด',
  },
  {
    kind: 'waterlevel', name: 'เซนเซอร์ระดับน้ำ (แผ่นลายทองแดง)', nameEn: 'Water level sensor (exposed traces)', labelPrefix: 'U',
    keywords: ['water', 'level', 'liquid', 'น้ำ', 'ระดับน้ำ', 'น้ำท่วม', 'รั่ว', 'แท็งก์'],
    description: '3 ขา S + − (3.3–5 V) · ลายทองแดงจ่ายไฟและลายรับสลับกัน ต่อทรานซิสเตอร์ขยาย · แห้ง S ≈ 0 V, จุ่มลึกขึ้น S สูงขึ้น (จุ่มเต็ม ≈ 0.5·VCC) · ค่าขึ้นกับความนำไฟฟ้าของน้ำ ต้องปรับเทียบ · จ่ายไฟเฉพาะตอนอ่าน (ต่อ + กับขาดิจิทัล) เพื่อลดการกัดกร่อน',
  },
  {
    kind: 'fsr', name: 'ตัวต้านทานไวแรงกด FSR 402', nameEn: 'Force-sensing resistor FSR 402 (Ø 18 mm)', labelPrefix: 'FSR',
    keywords: ['fsr', 'fsr402', 'force', 'pressure', 'แรงกด', 'น้ำหนัก', 'กด', 'ความดัน'],
    description: 'ตัวต้านทานแผ่นกลม 2 ขา ไม่มีขั้ว · ไม่กด = เปิดวงจร (> 10 MΩ) · กดเบา ≈ 100 kΩ ลดลงจนถึง ≈ 250 Ω ที่ 100 N · ใช้ตัวแบ่งแรงดันกับตัวต้านทาน 10 kΩ แล้วอ่านด้วย ADC · ความแม่นยำต่ำ (ตัวต่อตัวต่าง ≈ 10%) เหมาะกับการตรวจว่ากด/แรงมากน้อย ไม่ใช่ชั่งน้ำหนัก',
  },
] as const;

/* ============================== ตรวจไฟล์ ============================== */

type NumFn = (errors: string[], where: string, v: unknown, min: number, max: number) => number;
export function validateSensor(kind: SensorKind, p: Record<string, unknown>, where: string, errors: string[], num: NumFn): void {
  const bool = (k: string) => { if (typeof p[k] !== 'boolean') errors.push(`${where}.${k} ต้องเป็น true/false`); };
  const oneOf = (k: string, xs: readonly string[]) => { if (!xs.includes(p[k] as string)) errors.push(`${where}.${k} ต้องเป็น ${xs.join('/')}`); };
  const supply = () => { num(errors, `${where}.vMin`, p.vMin, 0, 30); num(errors, `${where}.vMax`, p.vMax, 1, 30); };
  if ((LM393_MODULE_KINDS as readonly string[]).includes(kind)) { num(errors, `${where}.threshold`, p.threshold, 0, 1); supply(); }
  switch (kind) {
    case 'flame': bool('flame'); bool('sunlight'); num(errors, `${where}.distance`, p.distance, 1, 1000); num(errors, `${where}.refDistance`, p.refDistance, 5, 300); break;
    case 'soundsensor': bool('sound'); num(errors, `${where}.level`, p.level, 30, 130); num(errors, `${where}.frequency`, p.frequency, 50, 5000); num(errors, `${where}.sensitivity`, p.sensitivity, -70, -30); break;
    case 'rainsensor': num(errors, `${where}.wet`, p.wet, 0, 100); num(errors, `${where}.rWet`, p.rWet, 100, 1e6); break;
    case 'mq2': oneOf('gas', ['lpg', 'smoke', 'co']); num(errors, `${where}.ppm`, p.ppm, 0, 10000); num(errors, `${where}.ro`, p.ro, 100, 1e6); num(errors, `${where}.rl`, p.rl, 100, 1e5); num(errors, `${where}.heaterR`, p.heaterR, 10, 100); break;
    case 'linetrack': oneOf('surface', ['white', 'black', 'none']); num(errors, `${where}.height`, p.height, 0.5, 50); break;
    case 'vibsensor': bool('vibrating'); break;
    case 'touch': bool('touched'); bool('activeLow'); bool('toggleMode'); bool('toggled'); supply(); num(errors, `${where}.rOut`, p.rOut, 1, 1e4); break;
    case 'hall': bool('magnet'); bool('on'); oneOf('pole', ['S', 'N']); num(errors, `${where}.distance`, p.distance, 0, 200); num(errors, `${where}.bop`, p.bop, 10, 1000); num(errors, `${where}.brp`, p.brp, 5, 1000); supply(); num(errors, `${where}.sinkMax`, p.sinkMax, 0.001, 0.1);
      if ((p.brp as number) >= (p.bop as number)) errors.push(`${where}: BRP ต้องน้อยกว่า BOP`); break;
    case 'reed': bool('magnet'); bool('closed'); num(errors, `${where}.distance`, p.distance, 0, 200); num(errors, `${where}.operate`, p.operate, 1, 50); num(errors, `${where}.release`, p.release, 1, 80);
      num(errors, `${where}.contactResistance`, p.contactResistance, 0.001, 10); num(errors, `${where}.maxCurrent`, p.maxCurrent, 1e-3, 5); num(errors, `${where}.maxVoltage`, p.maxVoltage, 1, 1000); num(errors, `${where}.span`, p.span, 2, 10);
      if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`);
      if ((p.release as number) <= (p.operate as number)) errors.push(`${where}: ระยะปล่อยต้องมากกว่าระยะทำงาน`); break;
    case 'tilt': num(errors, `${where}.angle`, p.angle, -180, 180); num(errors, `${where}.onAngle`, p.onAngle, 5, 90); num(errors, `${where}.contactResistance`, p.contactResistance, 0.001, 100); num(errors, `${where}.maxCurrent`, p.maxCurrent, 1e-3, 1); num(errors, `${where}.maxVoltage`, p.maxVoltage, 1, 100); break;
    case 'waterlevel': num(errors, `${where}.level`, p.level, 0, 100); num(errors, `${where}.fullRatio`, p.fullRatio, 0.05, 0.95); num(errors, `${where}.rOut`, p.rOut, 100, 1e6); supply(); break;
    case 'fsr': num(errors, `${where}.force`, p.force, 0, 100); num(errors, `${where}.maxPower`, p.maxPower, 0.001, 10); break;
  }
}

/* ============================== netlist ============================== */

export interface SensorNetCtx { n: (pin: string) => number; newNode: () => number; el: (e: NetlistElement) => void; comp: (c: CompSpec) => void; inactive: (reason: string) => void }
const LM393 = { ron: 62.5, vMin: 2, iq: 0.0004 };

/** ส่วนร่วมของโมดูล LM393 — sense(VCC, GND) คืนโหนดสัญญาณที่เทียบ · lowWhen: 'below' = DO ต่ำเมื่อสัญญาณ < จุดตัด, 'above' = เมื่อ > จุดตัด */
function lm393Module(id: string, x: SensorNetCtx, threshold: number, lowWhen: 'below' | 'above', sense: (VCC: number, G: number) => number) {
  const VCC = x.n('VCC'), G = x.n('GND'), DO = x.n('DO');
  x.el({ type: 'MOS', id: `${id}#iq`, d: VCC, g: G, s: G, pol: 1, vth: -1, kp: 2 * LM393.iq, lambda: 0.003 });
  const P = x.newNode();
  x.el({ type: 'R', id: `${id}#pr`, role: 'module', a: VCC, b: P, R: 1000 });
  x.el({ type: 'LED', id: `${id}#pled`, a: P, k: G, ...LED_RED });
  const T = x.newNode(), th = Math.min(0.9999, Math.max(1e-4, threshold));
  x.el({ type: 'R', id: `${id}#pt`, role: 'module', a: VCC, b: T, R: 10000 * (1 - th) });
  x.el({ type: 'R', id: `${id}#pb`, role: 'module', a: T, b: G, R: 10000 * th });
  const S = sense(VCC, G);
  x.comp({ id: `${id}#cmp`, part: id, inp: lowWhen === 'below' ? S : T, inn: lowWhen === 'below' ? T : S, out: DO, vcc: VCC, gnd: G, Ron: LM393.ron, vMin: LM393.vMin });
  x.el({ type: 'R', id: `${id}#pu`, role: 'module', a: DO, b: VCC, R: 10000 });
  const D = x.newNode();
  x.el({ type: 'R', id: `${id}#dr`, role: 'module', a: VCC, b: D, R: 1000 });
  x.el({ type: 'LED', id: `${id}#dled`, a: D, k: DO, ...LED_RED });
}
/** ตัวแบ่งแรงดัน VCC—rTop—AO—rBot—GND */
function divider(id: string, x: SensorNetCtx, AO: number, rTop: number, rBot: number) {
  return (VCC: number, G: number) => {
    x.el({ type: 'R', id: `${id}#rt`, role: 'module', a: VCC, b: AO, R: rTop });
    x.el({ type: 'R', id: `${id}#rb`, role: 'module', a: AO, b: G, R: rBot });
    return AO;
  };
}

export function buildSensorNet(part: SensorPart, x: SensorNetCtx): void {
  const id = part.id;
  switch (part.kind) {
    case 'flame': { const pr = part.params; lm393Module(id, x, pr.threshold, 'below', divider(id, x, x.n('AO'), 10000, flameSenseR(pr))); break; }
    case 'rainsensor': { const pr = part.params; lm393Module(id, x, pr.threshold, 'below', divider(id, x, x.n('AO'), 10000, rainSenseR(pr))); break; }
    case 'linetrack': {
      const pr = part.params;
      lm393Module(id, x, pr.threshold, 'below', (VCC, G) => {
        const E = x.newNode();
        x.el({ type: 'R', id: `${id}#er`, role: 'module', a: VCC, b: E, R: 220 });
        x.el({ type: 'LED', id: `${id}#irled`, a: E, k: G, ...LED_IR });
        return divider(id, x, x.n('AO'), 10000, lineSenseR(pr))(VCC, G);
      });
      break;
    }
    case 'mq2': {
      const pr = part.params;
      lm393Module(id, x, pr.threshold, 'above', (VCC, G) => {
        x.el({ type: 'R', id: `${id}#heat`, role: 'module', a: VCC, b: G, R: pr.heaterR });
        return divider(id, x, x.n('AO'), mq2Rs(pr), pr.rl)(VCC, G);
      });
      break;
    }
    case 'vibsensor': {
      const pr = part.params;
      // สปริงปกติปิดลง GND: นิ่ง = จุดรับรู้ 0 V · สั่น = หน้าสัมผัสเปิด จุดรับรู้ถูกดึงขึ้น
      lm393Module(id, x, pr.threshold, 'below', (VCC, G) => divider(id, x, x.newNode(), 10000, pr.vibrating ? OPEN : 1)(VCC, G));
      break;
    }
    case 'soundsensor': {
      const pr = part.params;
      lm393Module(id, x, pr.threshold, 'above', (VCC, G) => {
        // ไมค์อิเล็กเตรตไบแอสผ่านตัวต้านทาน: จุดไบแอส VCC/2 (Thevenin 5 kΩ) · เสียง = แหล่งแรงดันไซน์ต่ออนุกรมไปขา AO
        const B = x.newNode(), AO = x.n('AO');
        x.el({ type: 'R', id: `${id}#b1`, role: 'module', a: VCC, b: B, R: 10000 });
        x.el({ type: 'R', id: `${id}#b2`, role: 'module', a: B, b: G, R: 10000 });
        if (pr.sound) x.el({ type: 'FGEN', id: `${id}#mic`, p: AO, n: B, wave: 'sine', freq: pr.frequency, vpp: 2 * micPeak(pr), offset: 0, Rout: 1, ppc: 24 });
        else x.el({ type: 'R', id: `${id}#mic`, role: 'module', a: AO, b: B, R: 1 });
        return AO;
      });
      break;
    }
    case 'touch': {
      const pr = part.params, VCC = x.n('VCC'), G = x.n('GND'), IO = x.n('IO');
      x.el({ type: 'R', id: `${id}#q`, role: 'module', a: VCC, b: G, R: 1e6 }); // ≈ 3–5 µA ที่ 3–5 V (เอกสาร: 1.5 µA ทั่วไปในโหมดประหยัด)
      const high = touchOutHigh(pr);
      x.el({ type: 'R', id: `${id}#o`, role: 'module', a: IO, b: high ? VCC : G, R: pr.rOut });
      break;
    }
    case 'hall': {
      const pr = part.params, VCC = x.n('VCC'), G = x.n('GND'), O = x.n('OUT');
      x.el({ type: 'MOS', id: `${id}#iq`, d: VCC, g: G, s: G, pol: 1, vth: -1, kp: 2 * 0.0044, lambda: 0.003 });
      x.el({ type: 'R', id: `${id}#oin`, role: 'module', a: O, b: G, R: 1e8 });
      // ขาออกนำเมื่อสนามถึงจุดทำงาน และไฟเลี้ยง ≥ 4.5 V (ใช้คอมพาราเตอร์ภายในที่ vMin = 4.5 V แทนวงจรล็อกไฟต่ำ)
      if (hallOn(pr)) x.comp({ id: `${id}#sw`, part: id, inp: G, inn: VCC, out: O, vcc: VCC, gnd: G, Ron: 9, vMin: pr.vMin });
      break;
    }
    case 'reed': {
      const pr = part.params;
      if (reedClosed(pr)) x.el({ type: 'R', id, role: 'switch', a: x.n('1'), b: x.n('2'), R: pr.contactResistance });
      else x.inactive(pr.magnet ? `หน้าสัมผัสเปิด — แม่เหล็กอยู่ห่าง ${pr.distance} mm (ระยะทำงาน ${pr.operate} mm)` : 'หน้าสัมผัสเปิด (ไม่มีแม่เหล็ก)');
      break;
    }
    case 'tilt': {
      const pr = part.params;
      if (tiltClosed(pr)) x.el({ type: 'R', id, role: 'switch', a: x.n('1'), b: x.n('2'), R: pr.contactResistance });
      else x.inactive(`หน้าสัมผัสเปิด — เอียง ${pr.angle}° (ต่อกันเมื่อไม่เกิน ${pr.onAngle}°)`);
      break;
    }
    case 'waterlevel': {
      const pr = part.params, r = waterRatio(pr);
      const rb = pr.rOut, rt = r <= 0 ? OPEN : (rb * (1 - r)) / r;
      x.el({ type: 'R', id: `${id}#rt`, role: 'module', a: x.n('+'), b: x.n('S'), R: rt });
      x.el({ type: 'R', id: `${id}#rb`, role: 'module', a: x.n('S'), b: x.n('-'), R: rb });
      break;
    }
    case 'fsr':
      x.el({ type: 'R', id, role: 'ldr', a: x.n('1'), b: x.n('2'), R: fsrResistance(part.params.force) });
      break;
  }
}

/* ============================== การวัดและคำเตือน ============================== */

export interface SensorReading { current: number; voltage: number; power: number; overRated?: boolean; extra?: Record<string, number> }
export interface SensorDiag { severity: 'info' | 'warn' | 'danger'; partId?: string; message: string }
export interface SensorMeasureCtx {
  /** แรงดันที่ขาของอุปกรณ์ (V เทียบโหนดอ้างอิง) */
  v: (pin: string) => number;
  /** ขานี้ต่อกับอะไรแล้วหรือยัง */
  linked: (pin: string) => boolean;
  el: (id: string) => { current: number; voltage: number; power: number } | undefined;
  comp: (id: string) => boolean;
  /** ขา GPIO ของบอร์ด 3.3 V ที่อยู่ในเน็ตเดียวกับขานี้ (เช่น "Pico1 GP15") */
  mcu3v3: (pin: string) => string[];
}
/** บอร์ดที่ขา GPIO ทนได้ 3.3 V (เกิน 3.6 V = เสียหาย) */
export const MCU_3V3_KINDS = ['pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5'] as const;
export const MCU_POWER_PIN = /^(GND|3V3|VBUS|VSYS|5V|VIN|AGND|ADC_VREF|RUN|3V3_EN|VREF|AREF|IOREF|RESET|NC)/;

const A = (x: number) => (Math.abs(x) < 1e-3 ? `${(x * 1e6).toFixed(0)} µA` : `${(x * 1e3).toFixed(1)} mA`);

export function measureSensor(part: SensorPart, x: SensorMeasureCtx, diags: SensorDiag[]): SensorReading {
  const id = part.id, L = part.label;
  const sumI = (ids: string[]) => ids.reduce((s, k) => s + Math.abs(x.el(`${id}#${k}`)?.current ?? 0), 0);
  const overV = (vcc: number, vMax: number, r: SensorReading) => { if (vcc > vMax + 0.3) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${vMax} V` }); return true; } return false; };
  const to3v3 = (pin: string, v: number, why: string) => {
    if (v <= 3.6) return;
    for (const m of x.mcu3v3(pin)) diags.push({ severity: 'danger', partId: id, message: `${L}: ขา ${pin} สูงถึง ${v.toFixed(1)} V ${why} ต่อกับ ${m} ซึ่งทนได้ 3.3 V — ใช้ไฟเลี้ยงโมดูลจาก 3V3 หรือใช้ตัวแบ่งแรงดัน/ตัวแปลงระดับ` });
  };
  if (isLm393Module(part)) {
    const pr = part.params;
    const g = x.v('GND'), vcc = x.v('VCC') - g, vdo = x.v('DO') - g, vao = part.kind === 'vibsensor' ? 0 : x.v('AO') - g;
    const iq = sumI(['iq', 'pr', 'pt', 'rt', 'pu', 'dr', 'heat', 'er', 'b1']);
    const powered = vcc >= LM393.vMin;
    const low = powered && x.comp(`${id}#cmp`);
    const extra: Record<string, number> = { vcc, vdo, vao, vth: vcc * pr.threshold, low: low ? 1 : 0, powered: powered ? 1 : 0, ledPower: (x.el(`${id}#pled`)?.current ?? 0) > 1e-4 ? 1 : 0, ledDo: (x.el(`${id}#dled`)?.current ?? 0) > 1e-4 ? 1 : 0 };
    const r: SensorReading = { current: iq, voltage: vcc, power: vcc * iq, extra };
    const wired = x.linked('VCC') && x.linked('GND');
    if (vcc < -0.5) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: ไฟเลี้ยงกลับขั้ว — ตรวจขา VCC/GND` }); }
    else if (!overV(vcc, pr.vMax, r) && wired && vcc < pr.vMin - 0.1) diags.push({ severity: 'warn', partId: id, message: part.kind === 'mq2' ? `${L}: ไฟเลี้ยง ${vcc.toFixed(2)} V — ฮีตเตอร์ MQ-2 ต้องการ 5.0 ±0.1 V ไม่อย่างนั้นตัวรับรู้ไม่ร้อนพอและค่าที่อ่านเชื่อถือไม่ได้ (แอปไม่จำลองผลของอุณหภูมิฮีตเตอร์) ต่อ VCC กับ 5V/VBUS` : `${L}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — โมดูลอาจทำงานไม่ถูกต้อง` });
    to3v3('DO', vdo, '(ตัวต้านทานดึงขึ้น 10 kΩ บนโมดูลต่อกับ VCC)');
    if (part.kind !== 'vibsensor') to3v3('AO', vao, '');
    switch (part.kind) {
      case 'flame': Object.assign(extra, { irr: flameIrradiance(part.params), rs: flameSenseR(part.params) }); break;
      case 'rainsensor': extra.rs = rainSenseR(part.params); break;
      case 'linetrack': extra.rs = lineSenseR(part.params); extra.ledIr = x.el(`${id}#irled`)?.current ?? 0; break;
      case 'mq2': {
        const p2 = part.params, rs = mq2Rs(p2);
        Object.assign(extra, { rs, ratio: rs / p2.ro, heater: Math.abs(x.el(`${id}#heat`)?.current ?? 0), ppm: p2.ppm });
        if (p2.ppm > 10000 * 0.999) diags.push({ severity: 'info', partId: id, message: `${L}: ความเข้มข้นถึงขอบบนของช่วงตรวจวัด 10,000 ppm` });
        break;
      }
      case 'soundsensor': extra.peak = part.params.sound ? micPeak(part.params) : 0; break;
      default: break;
    }
    return r;
  }
  switch (part.kind) {
    case 'touch': {
      const pr = part.params, g = x.v('GND'), vcc = x.v('VCC') - g, vo = x.v('IO') - g;
      const io = Math.abs(x.el(`${id}#o`)?.current ?? 0), iq = Math.abs(x.el(`${id}#q`)?.current ?? 0);
      const r: SensorReading = { current: iq + io, voltage: vcc, power: vcc * (iq + io), extra: { vcc, vout: vo, high: touchOutHigh(pr) ? 1 : 0, active: (pr.toggleMode ? pr.toggled : pr.touched) ? 1 : 0, iout: io } };
      if (vcc < -0.5) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: ไฟเลี้ยงกลับขั้ว — ตรวจขา VCC/GND` }); }
      else if (!overV(vcc, pr.vMax, r) && x.linked('VCC') && x.linked('GND') && vcc < pr.vMin - 0.05) diags.push({ severity: 'warn', partId: id, message: `${L}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — TTP223 ไม่ทำงาน` });
      if (io > 0.008) diags.push({ severity: 'warn', partId: id, message: `${L}: ขาออกจ่าย/รับกระแส ${A(io)} — ขาออก CMOS ของ TTP223 ขับได้ไม่กี่ mA ต่อ LED ผ่านตัวต้านทาน ≥ 1 kΩ หรือใช้ทรานซิสเตอร์` });
      to3v3('IO', vo, '(ขาออกระดับเท่าไฟเลี้ยงโมดูล)');
      return r;
    }
    case 'hall': {
      const pr = part.params, g = x.v('GND'), vcc = x.v('VCC') - g, vo = x.v('OUT') - g;
      const on = hallOn(pr), iq = Math.abs(x.el(`${id}#iq`)?.current ?? 0), isink = on ? Math.abs(x.el(`${id}#sw#on`)?.current ?? 0) : 0;
      const gauss = pr.magnet ? magnetGauss(pr.distance, pr.pole) : 0;
      const sinking = x.comp(`${id}#sw`);
      const r: SensorReading = { current: iq, voltage: vcc, power: vcc * iq + vo * isink, extra: { vcc, vout: vo, gauss, on: on ? 1 : 0, sinking: sinking ? 1 : 0, isink } };
      if (vcc < -0.5) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: ไฟเลี้ยงกลับขั้ว — ขา 1 คือ VCC (มองด้านมีตัวอักษร)` }); }
      else if (!overV(vcc, pr.vMax, r) && x.linked('VCC') && x.linked('GND') && vcc < pr.vMin - 0.05) diags.push({ severity: 'warn', partId: id, message: `${L}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V ที่เอกสาร A3144 กำหนด — แบบจำลองถือว่าขาออกไม่ทำงาน ต่อ VCC กับ 5 V (ขาออก open-collector ดึงขึ้นไป 3.3 V ได้)` });
      if (isink > pr.sinkMax) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: กระแสขาออก ${A(isink)} เกินพิกัด ${A(pr.sinkMax)} — ใส่ตัวต้านทานจำกัดกระแส/ดึงขึ้น` }); }
      if (pr.magnet && pr.pole === 'N' && pr.distance < 15) diags.push({ severity: 'info', partId: id, message: `${L}: หันขั้วเหนือเข้าหาเซนเซอร์ — A3144 ตอบสนองเฉพาะขั้วใต้ที่หันเข้าหน้ามีตัวอักษร` });
      return r;
    }
    case 'reed':
    case 'tilt': {
      const pr = part.params, closed = part.kind === 'reed' ? reedClosed(part.params) : tiltClosed(part.params);
      const e = x.el(id), i = Math.abs(e?.current ?? 0), v = Math.abs(x.v('1') - x.v('2'));
      const r: SensorReading = { current: i, voltage: v, power: i * v, extra: { closed: closed ? 1 : 0, ...(part.kind === 'reed' ? { distance: part.params.distance, magnet: part.params.magnet ? 1 : 0 } : { angle: part.params.angle }) } };
      if (closed && i > pr.maxCurrent) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: กระแสผ่านหน้าสัมผัส ${A(i)} เกินพิกัด ${A(pr.maxCurrent)} — หน้าสัมผัสไหม้/ติดค้างได้ ต่อผ่านตัวต้านทานหรือใช้ขับขาเข้าของบอร์ดเท่านั้น` }); }
      if (!closed && v > pr.maxVoltage) { r.overRated = true; diags.push({ severity: 'warn', partId: id, message: `${L}: แรงดันคร่อมหน้าสัมผัส ${v.toFixed(1)} V เกินพิกัด ${pr.maxVoltage} V` }); }
      return r;
    }
    case 'waterlevel': {
      const pr = part.params, g = x.v('-'), vcc = x.v('+') - g, vs = x.v('S') - g;
      const i = Math.abs(x.el(`${id}#rt`)?.current ?? 0);
      const r: SensorReading = { current: i, voltage: vcc, power: vcc * i, extra: { vcc, vs, level: pr.level } };
      if (vcc < -0.5) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: ไฟเลี้ยงกลับขั้ว — ตรวจขา + / −` }); }
      else overV(vcc, pr.vMax, r);
      to3v3('S', vs, '');
      return r;
    }
    case 'fsr': {
      const pr = part.params, e = x.el(id), i = Math.abs(e?.current ?? 0), v = Math.abs(x.v('1') - x.v('2'));
      const r: SensorReading = { current: i, voltage: v, power: i * v, extra: { force: pr.force, r: fsrResistance(pr.force) } };
      if (i * v > pr.maxPower) { r.overRated = true; diags.push({ severity: 'danger', partId: id, message: `${L}: กำลัง ${(i * v * 1e3).toFixed(0)} mW เกินพิกัด ${(pr.maxPower * 1e3).toFixed(0)} mW — ใส่ตัวต้านทานอนุกรม (ตัวแบ่งแรงดัน 10 kΩ)` }); }
      return r;
    }
  }
  return { current: 0, voltage: 0, power: 0 };
}

/** ขา GPIO ของบอร์ด 3.3 V ทั้งหมดในวงจร: ใช้ใน mcu3v3 */
export function mcu3v3Pins(doc: CircuitDoc, pinNames: (p: Part) => string[]): Array<{ partId: string; label: string; pin: string }> {
  const out: Array<{ partId: string; label: string; pin: string }> = [];
  for (const p of doc.parts) if ((MCU_3V3_KINDS as readonly string[]).includes(p.kind)) for (const n of pinNames(p)) if (!MCU_POWER_PIN.test(n)) out.push({ partId: p.id, label: p.label, pin: n });
  return out;
}

