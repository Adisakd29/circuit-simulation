/**
 * ข้อมูลวงจร (Circuit document) — แหล่งความจริงเดียวของงานนักเรียน
 *
 * หลักการ:
 * - ทุกอุปกรณ์ สาย เบรดบอร์ด และโพรบมี ID คงที่ (ไม่เปลี่ยนเมื่อ Save/Load/Undo)
 * - ID ของขาอุปกรณ์ = `${partId}:${pinName}` ซึ่งคงที่ตาม ID อุปกรณ์
 * - การเชื่อมต่อทางไฟฟ้ามาจาก "การเสียบขาเข้ารู" + "สาย" + "การเชื่อมภายในเบรดบอร์ด" เท่านั้น
 *   ไม่ใช้ระยะห่างของโมเดล 3 มิติ
 */

export type PartKind = 'dcsupply' | 'resistor' | 'led' | 'switch' | 'ammeter' | 'capacitor' | 'inductor' | 'fgen' | 'scope' | 'diode' | 'bjt' | 'mosfet' | 'opamp' | 'pico' | 'potentiometer' | 'pushbutton' | 'buzzer' | 'ldr' | 'sevenseg' | 'relay' | 'timer555' | 'vreg' | 'transformer' | 'servo' | 'motor' | 'logic' | 'counter' | 'lm35' | 'hbridge' | 'sonar' | 'shiftreg' | 'opto' | 'stepper' | 'dmm' | 'vom' | 'scr' | 'lm317' | 'ntc' | 'comparator' | 'darlington' | 'lm386' | 'speaker';

/** มุมหมุนบนระนาบ (องศา) */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * จุดต่อ (terminal) ที่ปลายสายหรือโพรบเกาะได้
 * - รูเบรดบอร์ด:   { kind:'hole', boardId, hole:'a12' }
 * - ขั้วอุปกรณ์นอกบอร์ด (binding post): { kind:'pin', partId, pin:'pos' }
 */
export type TerminalRef =
  | { kind: 'hole'; boardId: string; hole: string }
  | { kind: 'pin'; partId: string; pin: string };

/** ตำแหน่งของอุปกรณ์ */
export type Placement =
  /** เสียบบนเบรดบอร์ด: ขาอ้างอิง (pin index 0) อยู่ในรู anchor */
  | { kind: 'board'; boardId: string; anchor: string; rotation: Rotation }
  /** วางบนโต๊ะนอกบอร์ด (หน่วย = ระยะห่างรู 2.54 mm) */
  | { kind: 'table'; x: number; z: number; rotation: Rotation };

export interface PartBase {
  id: string;
  /** ชื่อที่แสดง เช่น R1, LED1 — แก้ได้ ไม่ใช้เป็นคีย์ */
  label: string;
  kind: PartKind;
  placement: Placement;
}

export interface DcSupplyPart extends PartBase {
  kind: 'dcsupply';
  params: {
    /** แรงดันตั้ง (V) */
    voltage: number;
    /** ขีดจำกัดกระแส (A) */
    currentLimit: number;
    /** ความต้านทานภายในโหมด CV (Ω) */
    internalResistance: number;
    /** เปิด/ปิดเอาต์พุต */
    outputOn: boolean;
  };
}

export type LogicModel = '74HC00' | '74HC02' | '74HC04' | '74HC08' | '74HC32' | '74HC86';

export interface SonarPart extends PartBase {
  kind: 'sonar';
  params: {
    /** โมดูลวัดระยะอัลตราโซนิก HC-SR04 (หัวเข็ม 4 ขา VCC TRIG ECHO GND เสียบบอร์ดได้) */
    model: 'HC-SR04';
    /** ระยะถึงวัตถุตรงหน้า (cm) — เกิน 400 = ไม่มีวัตถุในระยะ */
    distance: number;
    /** อุณหภูมิอากาศ (°C) — ความเร็วเสียง 331.3 + 0.606·T m/s */
    temperature: number;
    /** ไฟเลี้ยงที่ใช้งานได้ (V) */
    vMin: number;
    vMax: number;
  };
}

export interface HbridgePart extends PartBase {
  kind: 'hbridge';
  params: {
    /** ไอซีขับมอเตอร์ L293D (DIP-16): ไดรเวอร์ครึ่งสะพาน 4 ตัว + ไดโอดกันย้อนในตัว */
    model: 'L293D';
    /** กระแสขาออกต่อเนื่องสูงสุดต่อช่อง (A) — ดาต้าชีต 600 mA */
    maxOutputCurrent: number;
    /** กระแสยอด (A) — 1.2 A ไม่เกิน 100 µs */
    peakOutputCurrent: number;
    /** ช่วงไฟเลี้ยงวงจรตรรกะ VCC1 (V) */
    vMin: number;
    vMax: number;
    /** ไฟเลี้ยงภาคขับ VCC2 สูงสุด (V) */
    vMotorMax: number;
  };
}

/**
 * ไทริสเตอร์ SCR ตัวถัง TO-92 (2N5060 ไวเกต 0.8 A 30 V) — ขา K, G, A (แบบตัวถัง Case 29 Style 10)
 * แบบจำลอง: ขา G–K เป็นไดโอด, ทาง A–K เปิด/ปิดตามสถานะค้าง (ติดเมื่อ IG ≥ IGT, ดับเมื่อ IA < IH และไม่มีกระแสเกต)
 */
export interface ScrPart extends PartBase {
  kind: 'scr';
  params: {
    model: '2N5060';
    /** กระแสเกตที่ทำให้ติด (A) และกระแสค้างต่ำสุด (A) */
    igt: number;
    ih: number;
    /** แรงดันคร่อม A–K ขณะดับที่ทนได้ (V) — เกินแล้วนำกระแสเอง (breakover) */
    vdrm: number;
    /** พิกัดกระแส A–K (A rms) */
    maxCurrent: number;
  };
}

/**
 * ไอซีคงแรงดันปรับค่าได้ LM317 (TO-220 มองด้านหน้า ขาลง: ขา 1 ADJ, 2 OUT (ต่อกับแผ่นโลหะ), 3 IN) — ค่าจากเอกสาร TI LM317
 * VOUT = VREF·(1 + R2/R1) + IADJ·R2 · ไม่มีขากราวด์: กระแสนิ่งไหลออกทางขา OUT จึงต้องมีกระแสโหลดต่ำสุด
 */
export interface Lm317Part extends PartBase {
  kind: 'lm317';
  params: {
    model: 'LM317';
    /** แรงดันอ้างอิง OUT − ADJ (V) */
    vref: number;
    /** กระแสขา ADJ (A) */
    iadj: number;
    /** กระแสโหลดต่ำสุด (A) — กระแสนิ่งที่ไหลออกขา OUT */
    minLoad: number;
    /** แรงดันตกคร่อม IN − OUT ต่ำสุดที่ยังคงแรงดัน (V) */
    dropout: number;
    /** ผลต่าง IN − OUT สูงสุด (V) */
    maxDiff: number;
    /** กระแสขาออกสูงสุด (A) */
    maxLoad: number;
    heatsink: boolean;
  };
}

export interface Lm35Part extends PartBase {
  kind: 'lm35';
  params: {
    /** เซนเซอร์อุณหภูมิ LM35DZ (TO-92): ขาออก 10 mV/°C */
    model: 'LM35DZ';
    /** อุณหภูมิที่ตัวเซนเซอร์ (°C) — ปรับในแผงคุณสมบัติ */
    temperature: number;
    /** กระแสนิ่ง (A) — ดาต้าชีต 56 µA ทั่วไป */
    quiescentCurrent: number;
    /** ความต้านทานขาออก (Ω) */
    rOut: number;
    /** ช่วงไฟเลี้ยงที่แนะนำ (V) */
    vMin: number;
    vMax: number;
    /** กระแสขาออกสูงสุด (absolute maximum, A) */
    maxOutputCurrent: number;
  };
}

export interface StepperPart extends PartBase {
  kind: 'stepper';
  params: {
    /** ชุดสเต็ปเปอร์มอเตอร์ 28BYJ-48 (5 V, 4 เฟส unipolar) + บอร์ดขับ ULN2003 */
    model: '28BYJ-48';
    /** ความต้านทานขดลวดต่อเฟส (Ω) */
    coilResistance: number;
    /** ฮาล์ฟสเต็ปต่อรอบของแกนออก (มุมสเต็ป 5.625° / 64 → 4096) */
    stepsPerRev: number;
    /** ความถี่สเต็ปสูงสุดที่ออกตัวจากหยุดนิ่งได้ / ที่หมุนต่อเนื่องได้ (Hz, idle in-/out-traction) */
    pullIn: number;
    pullOut: number;
    /** กระแสขดลวดขั้นต่ำที่ให้แรงบิดพอดึงโรเตอร์ (A) */
    minCoilCurrent: number;
    /** แรงดันพิกัด (V) */
    vRated: number;
  };
}

export type OptoRank = 'A' | 'B' | 'C' | 'D';
export interface OptoPart extends PartBase {
  kind: 'opto';
  params: {
    /** ออปโตคัปเปลอร์ขาออกโฟโต้ทรานซิสเตอร์ (DIP-4): ขา 1 แอโนด 2 แคโทด 3 อิมิตเตอร์ 4 คอลเลกเตอร์ */
    model: 'PC817';
    /** กลุ่ม CTR ตามรหัสท้ายรุ่น (PC817A–D) */
    rank: OptoRank;
    /** อัตราส่วนการโอนกระแส IC/IF (เท่า เช่น 3 = 300%) */
    ctr: number;
    /** LED อินฟราเรดด้านขาเข้า (แบบจำลองไดโอด) */
    Is: number;
    n: number;
    Rs: number;
    /** พิกัดสูงสุด: กระแส LED, แรงดันย้อนกลับ LED, กระแสคอลเลกเตอร์, แรงดัน VCEO */
    maxForwardCurrent: number;
    maxReverseVoltage: number;
    maxCollectorCurrent: number;
    vceo: number;
  };
}

export interface ShiftRegPart extends PartBase {
  kind: 'shiftreg';
  params: {
    /** ไอซีเลื่อนบิต 8 บิต ขาเข้าอนุกรม ขาออกขนาน มีรีจิสเตอร์พักข้อมูล (DIP-16) */
    model: '74HC595';
    /** ทรานซิสเตอร์ขาออก (แบบจำลอง MOSFET ระดับ 1) */
    kp: number;
    vth: number;
    lambda: number;
    /** ช่วงไฟเลี้ยงที่แนะนำ (V) */
    vMin: number;
    vMax: number;
    /** กระแสต่อขาออกสูงสุด และกระแสรวมขา VCC/GND สูงสุด (absolute maximum, A) */
    maxOutputCurrent: number;
    maxSupplyCurrent: number;
  };
}

export interface CounterPart extends PartBase {
  kind: 'counter';
  params: {
    /** ไอซีนับทศวรรษ CMOS ตระกูล 4000B (DIP-16) — ขาออกถอดรหัส 10 ขา Q0–Q9 */
    model: 'CD4017B';
    /** ทรานซิสเตอร์ขาออก (แบบจำลอง MOSFET ระดับ 1): ค่าคงที่ความนำ (A/V²) และแรงดันขีดเริ่ม (V) */
    kp: number;
    vth: number;
    lambda: number;
    /** ช่วงไฟเลี้ยงที่แนะนำ (V) */
    vMin: number;
    vMax: number;
    /** กระแสขาเข้า/ขาออกสูงสุด (absolute maximum, A) */
    maxOutputCurrent: number;
  };
}

export interface LogicPart extends PartBase {
  kind: 'logic';
  params: {
    /** ไอซีเกตตรรกะ CMOS ตระกูล 74HC (DIP-14) */
    model: LogicModel;
    /** ความต้านทานขาออกขณะ HIGH/LOW (Ω) — 74HC ที่ 5 V: VOH ≥ 4.68 V ที่ −4 mA */
    outputResistance: number;
    /** ช่วงไฟเลี้ยง (V) */
    vMin: number;
    vMax: number;
    /** กระแสขาออกสูงสุดแบบ absolute maximum (A) */
    maxOutputCurrent: number;
  };
}

export interface MotorPart extends PartBase {
  kind: 'motor';
  params: {
    /** มอเตอร์เกียร์ TT (3–6 V, 1:48) — ค่าแบบจำลองจากค่าที่วัดของ Adafruit #3777 (ดู REPORT) */
    gearRatio: number;
    /** ค่าคงที่แรงเคลื่อนไฟฟ้าย้อนกลับ/แรงบิด ที่แกนมอเตอร์ (V·s/rad = N·m/A) */
    ke: number;
    /** ความต้านทานขดลวดรวมแปรงถ่าน (Ω) และความเหนี่ยวนำ (H) */
    resistance: number;
    inductance: number;
    /** โมเมนต์ความเฉื่อยที่แกนมอเตอร์ (kg·m²) */
    inertia: number;
    /** กระแสขณะไม่มีโหลด (แรงเสียดทานในเฟือง/แปรงถ่าน) (A) */
    noLoadCurrent: number;
    /** แรงเสียดทานหนืด (N·m·s/rad ที่แกนมอเตอร์) */
    viscous: number;
    /** ประสิทธิภาพชุดเฟือง (0–1) */
    gearEff: number;
    /** แรงบิดโหลดที่แกนออก (N·m) เช่นล้อดันพื้น */
    loadTorque: number;
  };
}

export interface ServoPart extends PartBase {
  kind: 'servo';
  params: {
    /** เซอร์โว SG90 (9 g): ความกว้างพัลส์ที่มุม 0° และ 180° (s) — คาบ 20 ms */
    pulseMin: number;
    pulseMax: number;
    /** ความเร็วหมุนที่ 4.8 V (องศา/วินาที) — เอกสาร 0.1 s/60° = 600 °/s */
    speed: number;
    /** ช่วงไฟเลี้ยงที่ใช้งาน (V) */
    vMin: number;
    vMax: number;
    /** กระแสขณะหยุดนิ่ง (A) */
    idleCurrent: number;
  };
}

export interface TransformerPart extends PartBase {
  kind: 'transformer';
  params: {
    /** หม้อแปลงลดแรงดัน 230 V → 12-0-12 V (ขดทุติยภูมิมีแท็ปกลาง) — จำลองเฉพาะด้านทุติยภูมิ */
    /** แรงดันพิกัดต่อครึ่งขด (V rms ที่กระแสพิกัด) */
    vRated: number;
    /** กระแสพิกัดขดทุติยภูมิ (A rms) */
    iRated: number;
    /** regulation (แรงดันขณะไม่มีโหลดสูงกว่าพิกัด เช่น 0.16 = 16%) */
    regulation: number;
    /** ความถี่ไฟบ้าน (Hz) */
    frequency: number;
    /** เสียบปลั๊ก/เปิดสวิตช์ด้านปฐมภูมิ */
    on: boolean;
  };
}

export type VregModel = 'L7805' | 'L7809' | 'L7812';

export interface VregPart extends PartBase {
  kind: 'vreg';
  params: {
    /** ไอซีคงแรงดันบวก 78xx (TO-220 ขา 1 IN, 2 GND, 3 OUT) — ค่าจากเอกสาร ST L78 */
    model: VregModel;
    /** แรงดันขาออก (V) */
    vout: number;
    /** แรงดันตกคร่อมขั้นต่ำ IN − OUT ที่ยังคงแรงดันได้ (V) */
    dropout: number;
    /** กระแสนิ่งขา GND (A) ที่ VIN = VOUT + 5 V */
    quiescentCurrent: number;
    /** ความต้านทานขาออก (load regulation) (Ω) */
    rOut: number;
    /** แรงดันขาเข้าสูงสุด (V) */
    maxInput: number;
    /** กระแสขาออกสูงสุดที่ใช้งาน (A) */
    maxLoad: number;
    /** ติดแผ่นระบายความร้อน */
    heatsink: boolean;
  };
}

export interface Timer555Part extends PartBase {
  kind: 'timer555';
  params: {
    /** NE555 (ไบโพลาร์) — ค่าจากเอกสาร TI SLFS022 */
    model: 'NE555';
    /** ขาออก HIGH: VOH ≈ VCC − outHighDrop − I·outHighResistance (100 mA → VCC − 1.7 V) */
    outHighDrop: number;
    outHighResistance: number;
    /** ขาออก LOW: ความต้านทานลงกราวด์ (8 mA → 0.15 V) */
    outLowResistance: number;
    /** ทรานซิสเตอร์คายประจุ (ขา 7) ขณะนำ (8 mA → 0.15 V) */
    dischargeResistance: number;
    /** กระแสเลี้ยงตัวเอง: ความต้านทานเทียบเท่า VCC–GND (≈ 3 mA ที่ 5 V รวมวงแบ่ง 3 × 5 kΩ) */
    quiescentResistance: number;
    /** ช่วงไฟเลี้ยงที่ใช้งานได้ (V) */
    minSupply: number;
    maxSupply: number;
    /** กระแสขาออกสูงสุดที่แนะนำ (A) */
    maxOutputCurrent: number;
  };
}

export interface RelayPart extends PartBase {
  kind: 'relay';
  params: {
    /** ขดลวดรีเลย์ (SRD-05VDC-SL-C): ความต้านทาน (Ω) และความเหนี่ยวนำ (H — ไม่มีในเอกสาร ใช้ค่าประมาณ) */
    coilResistance: number;
    coilInductance: number;
    /** แรงดันดึง / ปล่อยของขดลวด (V) */
    vPick: number;
    vDrop: number;
    /** ความต้านทานหน้าสัมผัส (Ω) และพิกัดกระแสหน้าสัมผัส (A) */
    contactResistance: number;
    contactRating: number;
    /** ตัวต้านทานเบสของทรานซิสเตอร์ขับบนโมดูล (Ω) */
    baseResistance: number;
  };
}

export interface SevenSegPart extends PartBase {
  kind: 'sevenseg';
  params: {
    /** cc = แคโทดร่วม (5161AS), ca = แอโนดร่วม (5161BS) */
    common: 'cc' | 'ca';
    /** แบบจำลอง LED ของแต่ละส่วน (สีแดง) */
    Is: number;
    n: number;
    Rs: number;
    /** กระแสที่ใช้เป็นสเกลความสว่าง (A) */
    ratedCurrent: number;
    /** กระแสสูงสุดต่อส่วน (A) */
    maxCurrent: number;
    maxReverseVoltage: number;
  };
}

export interface LdrPart extends PartBase {
  kind: 'ldr';
  params: {
    /** ความสว่างที่ตกบนตัว LDR (lux) — ปรับในแผงคุณสมบัติ */
    lux: number;
    /** ความต้านทานที่ 10 lux (Ω) */
    r10: number;
    /** ค่าแกมมา: R ∝ lux^(−γ) */
    gamma: number;
    /** ความต้านทานในที่มืด (Ω) */
    rdark: number;
    /** พิกัดกำลัง (W) */
    maxPower: number;
    /** ระยะขาบนบอร์ด (ช่อง) */
    span: number;
  };
}

/**
 * เทอร์มิสเตอร์ NTC แบบหัวหยดอีพ็อกซี่ (MF52A 10 kΩ B3950) — ไม่มีขั้ว
 * R(T) = R25·exp(B·(1/T − 1/298.15 K)) · ความร้อนในตัว ΔT = P / δ (แจ้งเตือน ไม่ป้อนกลับเข้าค่า R)
 */
export interface NtcPart extends PartBase {
  kind: 'ntc';
  params: {
    /** อุณหภูมิรอบตัวเทอร์มิสเตอร์ (°C) — ปรับในแผงคุณสมบัติ */
    temperature: number;
    /** ความต้านทานที่ 25 °C (Ω) */
    r25: number;
    /** ค่า B (K) */
    beta: number;
    /** ค่าคงที่การระบายความร้อน δ (W/°C) */
    dissipation: number;
    /** พิกัดกำลัง (W) */
    maxPower: number;
    /** ระยะขาบนบอร์ด (ช่อง) */
    span: number;
  };
}

/**
 * คอมพาราเตอร์คู่ LM393 (PDIP-8): ขา 1 OUTA, 2 INA−, 3 INA+, 4 GND, 5 INB+, 6 INB−, 7 OUTB, 8 VCC
 * ขาออก open collector: IN− > IN+ → ทรานซิสเตอร์ขาออกนำ (ดึงลง GND) · IN+ > IN− → ขาออกลอย (ต้องมี pull-up)
 */
export interface ComparatorPart extends PartBase {
  kind: 'comparator';
  params: {
    model: 'LM393';
    /** ความต้านทานขาออกขณะนำ (Ω) — VOL ≈ Ron × กระแส */
    ron: number;
    /** กระแสขาออกที่รับได้ (A) — ดาต้าชีต: อย่างน้อย 6 mA ที่ VO ≤ 1.5 V */
    sinkMax: number;
    /** กระแสนิ่งรวม (A) */
    quiescentCurrent: number;
    /** ช่วงไฟเลี้ยง (V) */
    vMin: number;
    vMax: number;
  };
}

/**
 * ทรานซิสเตอร์ดาร์ลิงตัน NPN TIP120 (TO-220: ขา 1 B, 2 C (แผ่นโลหะ), 3 E) — ค่าจากเอกสาร onsemi TIP120
 * ภายใน: Q1 (ขับ) ต่อดาร์ลิงตันกับ Q2 (กำลัง), R1 ≈ 8 kΩ จาก B ไปเบสของ Q2 (= อิมิตเตอร์ Q1), R2 ≈ 120 Ω จากเบส Q2 ไป E
 */
export interface DarlingtonPart extends PartBase {
  kind: 'darlington';
  params: {
    model: 'TIP120';
    /** อัตราขยายของทรานซิสเตอร์แต่ละตัว (รวม ≈ bf1 × bf2) */
    bf1: number;
    bf2: number;
    is1: number;
    is2: number;
    r1: number;
    r2: number;
    /** ความต้านทานเนื้อสารขาคอลเลกเตอร์/อิมิตเตอร์ (Ω) */
    rc: number;
    re: number;
    maxIc: number;
    maxVce: number;
    heatsink: boolean;
  };
}

/**
 * ไอซีขยายเสียง LM386 (PDIP-8): ขา 1 GAIN, 2 −IN, 3 +IN, 4 GND, 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN — ค่าจากเอกสาร TI LM386
 * อัตราขยาย 20 เท่า (ขา 1–8 เปิด) · 200 เท่า (C 10 µF ระหว่างขา 1–8) · ขาออกไบแอสที่ ≈ VS/2 ต้องมี C คัปปลิ้งไปลำโพง
 */
export interface Lm386Part extends PartBase {
  kind: 'lm386';
  params: {
    model: 'LM386N-1';
    /** ความต้านทานภายใน: ป้อนกลับ (Rf), ระหว่างขา 1–8 (Rb) และอนุกรมขา 1 (Ra) — กำหนดอัตราขยาย 1 + Rf/(Ra + Rb) */
    rf: number;
    ra: number;
    rb: number;
    /** ความต้านทานขาเข้า (Ω) */
    rin: number;
    /** ผลคูณอัตราขยาย–แบนด์วิดท์ (Hz) — 300 kHz ที่อัตราขยาย 20 */
    gbw: number;
    /** แรงดันที่ขาออกแกว่งเข้าใกล้ไฟเลี้ยง/กราวด์ไม่ได้ (V) */
    headroom: number;
    quiescentCurrent: number;
    vMin: number;
    vMax: number;
  };
}

/** ลำโพงไดนามิก 8 Ω (Ø 57 mm, 0.5 W) — วางบนโต๊ะ สายแดง (+) ดำ (−) */
export interface SpeakerPart extends PartBase {
  kind: 'speaker';
  params: {
    impedance: number;
    maxPower: number;
  };
}

export type BuzzerType = 'active' | 'passive';

export interface BuzzerPart extends PartBase {
  kind: 'buzzer';
  params: {
    /** active = มีวงจรกำเนิดเสียงในตัว (ป้อนไฟตรงก็ดัง), passive = ขดลวดล้วน (ต้องป้อนคลื่นสี่เหลี่ยม/PWM) */
    type: BuzzerType;
    /** แรงดันใช้งานที่กำหนด (V) */
    ratedVoltage: number;
    /** กระแสที่แรงดันกำหนด (A) */
    ratedCurrent: number;
    /** ความถี่เสียง (active) หรือความถี่เรโซแนนซ์ (passive) (Hz) */
    frequency: number;
    /** ความต้านทานขดลวด (passive) (Ω) */
    coilResistance: number;
  };
}

export interface PushbuttonPart extends PartBase {
  kind: 'pushbutton';
  params: {
    /** กดอยู่หรือไม่ (ปุ่มกดติดปล่อยดับ — ปล่อยแล้วกลับเป็น false) */
    pressed: boolean;
    /** ความต้านทานหน้าสัมผัสขณะกด (Ω) */
    contactResistance: number;
    /** พิกัดหน้าสัมผัส (A, V) — ใช้แจ้งเตือนเชิงการสอน */
    maxCurrent: number;
    maxVoltage: number;
  };
}

export interface PotentiometerPart extends PartBase {
  kind: 'potentiometer';
  params: {
    /** ค่าความต้านทานรวมระหว่างขา 1–3 (Ω) */
    resistance: number;
    /** ตำแหน่งแกน (wiper) 0 = ชิดขา 1, 1 = ชิดขา 3 — R(1–2) = R·position */
    position: number;
    /** ความต้านทานปลาย (end resistance) ที่เหลือเมื่อหมุนสุด (Ω) */
    endResistance: number;
    /** พิกัดกำลังเมื่อใช้ทั้งเส้นความต้านทาน (W) */
    powerRating: number;
  };
}

export interface ResistorPart extends PartBase {
  kind: 'resistor';
  params: {
    resistance: number; // Ω
    /** พิกัดกำลัง (W) — ใช้เตือนเชิงการสอน */
    powerRating: number;
    /** ระยะขา (จำนวนช่องรู) */
    span: number;
  };
}

export type LedColor = 'red' | 'green' | 'yellow' | 'blue' | 'white';

export interface LedPart extends PartBase {
  kind: 'led';
  params: {
    color: LedColor;
    /** พารามิเตอร์แบบจำลอง Shockley + Rs (เปิดเผยให้ผู้ใช้เห็น/แก้) */
    Is: number; // A
    n: number; // ideality factor
    Rs: number; // Ω
    /** กระแสใช้งานที่กำหนด (A) — ใช้ปรับสเกลความสว่าง */
    ratedCurrent: number;
    /** กระแสสูงสุดตามแบบจำลองการสอน (A) */
    maxCurrent: number;
    /** แรงดันย้อนสูงสุด (V) */
    maxReverseVoltage: number;
  };
}

export interface SwitchPart extends PartBase {
  kind: 'switch';
  params: {
    closed: boolean;
    onResistance: number; // Ω
  };
}

export interface AmmeterPart extends PartBase {
  kind: 'ammeter';
  params: {
    /** ความต้านทานภายใน (burden/shunt) Ω */
    shuntResistance: number;
    /** ย่านวัดสูงสุด (A) — เกินแล้วเตือน */
    range: number;
  };
}

/** ตำแหน่งสวิตช์เลือกย่านของมัลติมิเตอร์ดิจิทัล (ปรับย่านอัตโนมัติภายในแต่ละตำแหน่ง) */
export type DmmMode = 'off' | 'acv' | 'dcv' | 'mv' | 'ohm' | 'dca' | 'dcma';

/**
 * มัลติมิเตอร์ดิจิทัลแบบมือถือ 4000 count (ทั่วไป ไม่อิงยี่ห้อ ขนาดและสเปกใกล้เคียงรุ่นยอดนิยมในห้องแลป)
 * ขั้วเสียบ 4 ขั้ว: A10 (10 A), mA (mA/µA), COM, V (V/Ω) — ขั้ว A10/mA ต่อกับ shunt + ฟิวส์ภายในตลอดเวลา (เหมือนเครื่องจริง)
 */
export interface DmmPart extends PartBase {
  kind: 'dmm';
  params: {
    mode: DmmMode;
    /** ความต้านทานขาเข้าย่าน V (Ω) */
    inputResistance: number;
    /** ความต้านทานขาเข้าย่าน mV (Ω) */
    mvInputResistance: number;
    /** shunt ขั้ว A10 / ขั้ว mA (Ω) */
    shuntA: number;
    shuntMa: number;
    /** พิกัดฟิวส์ขั้ว A10 / ขั้ว mA (A) */
    fuseA: number;
    fuseMa: number;
    /** แหล่งจ่ายทดสอบย่าน Ω: แรงดันเปิดวงจร (V) และความต้านทานภายใน (Ω) */
    ohmVoc: number;
    ohmRs: number;
  };
}

/**
 * มัลติมิเตอร์แบบเข็ม (VOM) 20 kΩ/V (ทั่วไป ไม่อิงยี่ห้อ) — สวิตช์ย่านเป็นตำแหน่ง เช่น 'dcv10', 'ohm100', 'dca25m'
 * ขั้วเสียบ 2 ขั้ว: + (แดง) และ COM (ดำ) · ย่าน Ω ใช้แบตเตอรี่ภายใน โดยขั้ว COM เป็นขั้วบวกของแบตเตอรี่
 */
export interface VomPart extends PartBase {
  kind: 'vom';
  params: {
    sel: string;
    /** ความไว ย่าน DCV (Ω/V) และ ย่าน DCV 250/1000 V กับ ACV (Ω/V) */
    sensitivityDC: number;
    sensitivityAC: number;
    /** แบตเตอรี่ย่าน Ω (V) และค่ากลางสเกลที่ ×1 (Ω) */
    battery: number;
    centerOhm: number;
    /** พิกัดฟิวส์ (A) */
    fuse: number;
  };
}

export interface CapacitorPart extends PartBase {
  kind: 'capacitor';
  params: {
    capacitance: number; // F
    /** พิกัดแรงดัน (V) — เกินแล้วเตือนเชิงการสอน */
    ratedVoltage: number;
    /** มีขั้ว (อิเล็กโทรไลต์) — กลับขั้วแล้วเตือน */
    polarized: boolean;
    /** แรงดันเริ่มต้นเมื่อเริ่มจำลอง/เริ่มเวลาใหม่ (V, ขา + เทียบ −) */
    initialVoltage: number;
    span: number;
  };
}

export interface InductorPart extends PartBase {
  kind: 'inductor';
  params: {
    inductance: number; // H
    /** ความต้านทานขดลวด DCR (Ω) */
    resistance: number;
    /** พิกัดกระแส (A) */
    ratedCurrent: number;
    span: number;
  };
}

export type WaveShape = 'sine' | 'square' | 'triangle' | 'dc';

export interface FgenPart extends PartBase {
  kind: 'fgen';
  params: {
    wave: WaveShape;
    frequency: number; // Hz
    /** แรงดันยอดถึงยอดขณะไม่มีโหลด (V) */
    vpp: number;
    offset: number; // V
    /** ความต้านทานขาออก (Ω) — เครื่องจริงทั่วไป 50 Ω */
    outputImpedance: number;
    outputOn: boolean;
  };
}

export interface ScopePart extends PartBase {
  kind: 'scope';
  params: {
    /** ความต้านทานขาเข้าแต่ละช่อง (Ω) — ออสซิลโลสโคปทั่วไป 1 MΩ */
    inputResistance: number;
    /** ค่าตั้งหน้าเครื่อง (บันทึกไปกับไฟล์) */
    timeDiv: number; // s/div
    vdiv1: number; // V/div
    vdiv2: number;
    ch1On: boolean;
    ch2On: boolean;
    trigSource: 'ch1' | 'ch2';
    trigLevel: number; // V
    trigSlope: 'rise' | 'fall';
    /** AC coupling ของแต่ละช่อง (ตัดระดับ DC ออกจากการแสดงผล — schema 19, ไม่มี = DC) */
    ac1?: boolean;
    ac2?: boolean;
    /** ค่าตั้ง AC sweep / กราฟโบด (schema 5) */
    bodeStart: number; // Hz
    bodeStop: number; // Hz
    bodePpd: number; // จุดต่อทศวรรษ
    /** อ้างอิงของอัตราขยาย: CH2/CH1 หรือ CH2/แรงดันแหล่ง (EMF ของเครื่องกำเนิด) */
    bodeRef: 'ch1' | 'source';
  };
}

export type DiodeModel = '1N4148' | '1N4007' | 'Z5V1';

export interface DiodePart extends PartBase {
  kind: 'diode';
  params: {
    model: DiodeModel;
    Is: number; n: number; Rs: number;
    /** แรงดันพังทลายย้อนกลับ (V) และกระแสที่แรงดันนั้น (A) */
    Bv: number; Ibv: number;
    /** กระแสไปข้างหน้าสูงสุด (A) */
    maxCurrent: number;
    /** กำลังสูงสุด (W) */
    maxPower: number;
    span: number;
  };
}

export interface BjtPart extends PartBase {
  kind: 'bjt';
  params: {
    model: '2N3904' | '2N3906';
    polarity: 'npn' | 'pnp';
    Is: number;
    /** อัตราขยายกระแสไปข้างหน้า/ย้อนกลับ (β) */
    bf: number; br: number;
    maxIc: number; maxVce: number; maxPower: number;
  };
}

export type MosfetModel = '2N7000' | 'IRLZ44N' | 'IRF9540N';

export interface MosfetPart extends PartBase {
  kind: 'mosfet';
  params: {
    model: MosfetModel;
    /** ช่อง N หรือ P (enhancement) */
    polarity: 'n' | 'p';
    /** แรงดันขีดเริ่ม |Vgs(th)| (V) */
    vth: number;
    /** ค่าคงที่ความนำ KP (A/V²) — แบบจำลองระดับ 1: Id = KP/2·(Vgs − Vth)² ในย่านอิ่มตัว */
    kp: number;
    /** channel-length modulation λ (1/V) */
    lambda: number;
    /** ไดโอดในตัว (body diode) */
    body: { Is: number; n: number; Rs: number };
    maxId: number; maxVds: number; maxVgs: number; maxPower: number;
  };
}

export interface OpampPart extends PartBase {
  kind: 'opamp';
  params: {
    model: 'LM741' | 'MCP6002';
    /** อัตราขยายวงเปิด */
    gain: number;
    outputResistance: number;
    /** ระยะห่างขั้นต่ำของแรงดันขาออกจากไฟเลี้ยง (V) */
    headroom: number;
    /** ไฟเลี้ยงสูงสุด V+ − V− (V) */
    maxSupply: number;
    /** ความต้านทานระหว่างขาเข้า (Ω) */
    inputResistance: number;
    /** ความต้านทานสมมูลของกระแสนิ่งระหว่าง V+ กับ V− (Ω) — LM741 ราว 1.7 mA ที่ ±12 V */
    quiescentResistance: number;
    /** ผลคูณอัตราขยาย-แบนด์วิดท์ (Hz) — วงเปิดมีขั้วเดียวที่ GBW/A */
    gbw: number;
    /** อัตราการเปลี่ยนแรงดันขาออกสูงสุด (V/s) */
    slewRate: number;
  };
}

export interface PicoPart extends PartBase {
  kind: 'pico';
  params: {
    /** โปรแกรม MicroPython ของนักเรียน (บันทึกไปกับไฟล์) */
    code: string;
    /** รันโค้ดอัตโนมัติเมื่อบอร์ดเริ่มทำงาน (เหมือน main.py) */
    autorun: boolean;
  };
}

export type Part = DcSupplyPart | ResistorPart | LedPart | SwitchPart | AmmeterPart | CapacitorPart | InductorPart | FgenPart | ScopePart | DiodePart | BjtPart | MosfetPart | OpampPart | PicoPart | PotentiometerPart | PushbuttonPart | BuzzerPart | LdrPart | SevenSegPart | RelayPart | Timer555Part | VregPart | TransformerPart | ServoPart | MotorPart | LogicPart | CounterPart | Lm35Part | HbridgePart | SonarPart | ShiftRegPart | OptoPart | StepperPart | DmmPart | VomPart | ScrPart | Lm317Part | NtcPart | ComparatorPart | DarlingtonPart | Lm386Part | SpeakerPart;

export interface Wire {
  id: string;
  a: TerminalRef;
  b: TerminalRef;
  color: string;
  /** ความสูงโค้งสาย (หน่วยรู) */
  arc: number;
  /** ระยะเยื้องด้านข้างของจุดกลางสาย (ใช้ "แก้แนวสาย") */
  bend: number;
}

export interface Breadboard {
  id: string;
  /** CL-400 ครึ่งแผ่น 400 จุด · MB-102 เต็มแผ่น 830 จุด */
  model: 'CL-400' | 'MB-102';
  x: number;
  z: number;
}

export interface ProbeSet {
  /** โพรบแดง (+) และดำ (COM) — วัด V(แดง) − V(ดำ) */
  red: TerminalRef | null;
  black: TerminalRef | null;
}

export interface CircuitDoc {
  breadboards: Breadboard[];
  parts: Part[];
  wires: Wire[];
  probes: ProbeSet;
}

/** งานของนักเรียน (แยกจากวงจรและแยกจากโจทย์/เฉลย) */
export interface StudentWork {
  lessonId: string | null;
  /** lessonId -> rowId -> {calc, sim} */
  records: Record<string, Record<string, { calc: string; sim: string }>>;
  /** lessonId -> questionId -> คำตอบ */
  answers: Record<string, Record<string, string>>;
  /** lessonId -> goalId -> true เมื่อเคยผ่าน */
  achieved: Record<string, Record<string, boolean>>;
}

/** 1 = ระยะที่ 1, 2 = เพิ่มตัวเก็บประจุ/ตัวเหนี่ยวนำ, 3 = เครื่องกำเนิดสัญญาณ/ออสซิลโลสโคป, 4 = ไดโอด/ทรานซิสเตอร์/ออปแอมป์ (อ่านรุ่นเก่าได้) */
export const SCHEMA_VERSION = 37;
export const FILE_FORMAT = 'circuitlab3d';

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  schemaVersion: number;
  app: string;
  savedAt: string;
  title: string;
  circuit: CircuitDoc;
  studentWork: StudentWork;
}

export function emptyCircuit(): CircuitDoc {
  return {
    breadboards: [{ id: 'bb1', model: 'CL-400', x: 0, z: 0 }],
    parts: [],
    wires: [],
    probes: { red: null, black: null },
  };
}

export function emptyWork(): StudentWork {
  return { lessonId: null, records: {}, answers: {}, achieved: {} };
}

export function terminalKey(t: TerminalRef): string {
  return t.kind === 'hole' ? `${t.boardId}/${t.hole}` : `${t.partId}:${t.pin}`;
}

export function sameTerminal(a: TerminalRef | null, b: TerminalRef | null): boolean {
  if (!a || !b) return false;
  return terminalKey(a) === terminalKey(b);
}
