/**
 * ข้อมูลวงจร (Circuit document) — แหล่งความจริงเดียวของงานนักเรียน
 *
 * หลักการ:
 * - ทุกอุปกรณ์ สาย เบรดบอร์ด และโพรบมี ID คงที่ (ไม่เปลี่ยนเมื่อ Save/Load/Undo)
 * - ID ของขาอุปกรณ์ = `${partId}:${pinName}` ซึ่งคงที่ตาม ID อุปกรณ์
 * - การเชื่อมต่อทางไฟฟ้ามาจาก "การเสียบขาเข้ารู" + "สาย" + "การเชื่อมภายในเบรดบอร์ด" เท่านั้น
 *   ไม่ใช้ระยะห่างของโมเดล 3 มิติ
 */

export type PartKind = 'dcsupply' | 'resistor' | 'led' | 'switch' | 'ammeter' | 'capacitor' | 'inductor' | 'fgen' | 'scope' | 'diode' | 'bjt' | 'mosfet' | 'opamp' | 'pico' | 'potentiometer' | 'pushbutton' | 'buzzer' | 'ldr' | 'sevenseg' | 'relay' | 'timer555' | 'vreg' | 'transformer' | 'servo' | 'motor' | 'logic' | 'counter' | 'lm35' | 'hbridge' | 'sonar' | 'shiftreg' | 'opto' | 'stepper' | 'dmm' | 'vom' | 'scr' | 'lm317' | 'ntc' | 'comparator' | 'darlington' | 'lm386' | 'speaker' | 'soilsensor' | 'pump' | 'dht22' | 'uno' | 'rgbled' | 'ssd1306' | 'ds3231' | 'mpu6050' | 'vibmotor' | 'esp32s2' | 'gc9a01' | 'qmi8658' | 'esp32s3lcd' | 'lcd1602' | 'bmp280' | 'bh1750' | 'ina219' | 'tm1637' | 'keypad' | 'encoder' | 'joystick' | 'dht11' | 'pir' | 'irobstacle' | 'rpi5' | 'nano' | 'logicanalyzer' | 'lcd1602p' | 'unoq' | 'mega' | 'promini' | 'attiny85' | 'picow' | 'xiao' | 'nanoconnect' | 'esp32devkitc' | 'bluepill' | 'pico2' | 'teensy41' | 'arcadebtn' | 'pushbtn16' | 'dcadapter' | 'servohub' | SensorKind;

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
    /** แรงบิดโหลดที่แกนออก (mN·m) — ไม่มี = 0 */
    shaftLoad?: number;
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
    /** กระแสมอเตอร์ขณะหมุนตัวเปล่า (A) — ไม่มี = 0.2 */
    runCurrent?: number;
    /** กระแสตอนเริ่มหมุน (ใกล้กระแสหยุดหมุน) ช่วง 20 ms แรกของการหมุน (A) — ไม่มี = 0.5 */
    startCurrent?: number;
    /** แรงบิดหยุดหมุนที่ 4.8 V (kgf·cm) — เอกสาร SG90: 1.8 · ไม่มี = 1.8 */
    stallTorque?: number;
    /** แรงบิดโหลดที่แขน ต้านการหมุน (kgf·cm, แบบแรงเสียดทาน) — ไม่มี = 0 */
    loadTorque?: number;
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

/** จอ OLED 0.96" 128×64 ไอซี SSD1306 แบบ I²C 4 ขา (GND VCC SCL SDA) มีเรกูเลเตอร์ + ปั๊มประจุบนโมดูล */
export interface OledPart extends PartBase {
  kind: 'ssd1306';
  params: {
    /** ที่อยู่ 7 บิต: 0x3C (ค่าเริ่มต้น) หรือ 0x3D (ย้ายตัวต้านทานด้านหลังโมดูล) */
    addr: number;
    /** ตัวต้านทานดึงขึ้น SCL/SDA บนโมดูล (Ω) */
    pullUp: number;
    vMin: number;
    vMax: number;
    /** กระแสไฟเลี้ยงโดยประมาณ (A) */
    supplyCurrent: number;
  };
}

/** โมดูลนาฬิกา DS3231 (ZS-042): 32K SQW SCL SDA VCC GND · มี EEPROM AT24C32 ที่ 0x57 และช่องแบตสำรอง */
export interface RtcPart extends PartBase {
  kind: 'ds3231';
  params: {
    /** เวลาที่ตั้งไว้ในชิปตอนเริ่มจำลอง "YYYY-MM-DD HH:MM:SS" (เหมือนตั้งเวลาไว้แล้วมีแบตสำรองเลี้ยง) */
    clock: string;
    /** อุณหภูมิรอบตัว (°C) — เซนเซอร์ในชิป */
    temperature: number;
    pullUp: number;
    vMin: number;
    vMax: number;
    supplyCurrent: number;
  };
}

/** โมดูล GY-521 (MPU6050): VCC GND SCL SDA XDA XCL AD0 INT · AD0 มีตัวต้านทานดึงลงบนโมดูล → 0x68 (ต่อ AD0 ขึ้นไฟ = 0x69) */
export interface ImuPart extends PartBase {
  kind: 'mpu6050';
  params: {
    /** การเคลื่อนไหวของข้อมือที่ติดเซนเซอร์ */
    motion: 'still' | 'walk' | 'shake';
    /** จังหวะเดิน (ก้าว/นาที) */
    spm: number;
    temperature: number;
    pullUp: number;
    vMin: number;
    vMax: number;
    supplyCurrent: number;
  };
}

/** มอเตอร์สั่นแบบเหรียญ 10 × 2.7 mm (ERM) สายแดง (+) สายน้ำเงิน (−) — แบบจำลองมอเตอร์ DC ขนาดเล็ก */
export interface VibMotorPart extends PartBase {
  kind: 'vibmotor';
  params: {
    resistance: number;
    inductance: number;
    ke: number;
    inertia: number;
    noLoadCurrent: number;
    ratedVoltage: number;
    maxVoltage: number;
  };
}

/**
 * บอร์ดที่มีเฉพาะโมเดล 3D และตำแหน่ง/ชื่อขา — ไม่มีตัวจำลอง CPU, ขาทุกขาไม่มีไฟ (มีเพียงขา GND/3V3 ของบอร์ดเดียวกันต่อถึงกัน)
 * bluepill = STM32F103C8T6 "Blue Pill" (บอร์ดทั่วไป ไม่มีผู้ผลิตรายเดียว) · pico2 = Raspberry Pi Pico 2 (RP2350A) · teensy41 = PJRC Teensy 4.1 (i.MX RT1062)
 */
export interface ModelOnlyBoardPart extends PartBase {
  kind: 'bluepill' | 'pico2' | 'teensy41';
  params: { model: 'STM32F103C8T6 Blue Pill' | 'Raspberry Pi Pico 2' | 'Teensy 4.1' };
}

/** บอร์ด ESP32-S2-DevKitM-1 — โมเดล 3D และขาตามเอกสาร Espressif เท่านั้น (ยังไม่มีตัวจำลอง CPU) */
export interface Esp32s2Part extends PartBase {
  kind: 'esp32s2';
  params: { model: 'ESP32-S2-DevKitM-1' };
}

/**
 * จอกลม 1.28" 240×240 IPS ไอซี GC9A01 (SPI) + ทัชสกรีน CST816S (I²C) บนโมดูลเดียว — ขา 13 ขาเรียงตามชื่อขาของโมดูล 1.28inch Touch LCD:
 * VCC GND MISO MOSI SCLK LCD_CS LCD_DC LCD_RST LCD_BL TP_SDA TP_SCL TP_INT TP_RST
 */
export interface RoundLcdPart extends PartBase {
  kind: 'gc9a01';
  params: {
    /** ตัวต้านทานดึงขึ้น TP_SDA/TP_SCL บนโมดูล (Ω) — ค่าสมมติ */
    pullUp: number;
    vMin: number;
    vMax: number;
    /** กระแสไฟเลี้ยงรวมไฟพื้นหลังโดยประมาณ (A) */
    supplyCurrent: number;
  };
}

/** โมดูล QMI8658 (ความเร่ง + ไจโร 6 แกน, I²C): VCC GND SCL SDA SA0 · SA0 ดึงขึ้นบนโมดูล → 0x6A (ต่อ GND = 0x6B) · ไฟเลี้ยง 1.71–3.6 V */
export interface Qmi8658Part extends PartBase {
  kind: 'qmi8658';
  params: {
    motion: 'still' | 'walk' | 'shake';
    spm: number;
    temperature: number;
    pullUp: number;
    vMin: number;
    vMax: number;
    supplyCurrent: number;
  };
}

/** บอร์ด ESP32-S3-Touch-LCD-1.28 (จอกลม + ESP32-S3 บนแผ่นเดียว) — โมเดล 3D เท่านั้น (ไม่มีตัวจำลอง ESP32-S3 ในแอป) */
export interface Esp32s3LcdPart extends PartBase {
  kind: 'esp32s3lcd';
  params: { model: 'ESP32-S3-Touch-LCD-1.28' };
}

/** จอ LCD 16×2 (HD44780) + บอร์ด I²C PCF8574 ด้านหลัง: หัวเข็ม 4 ขา GND VCC SDA SCL · วางบนโต๊ะ ต่อสายจากหัวเข็ม */
export interface CharLcdPart extends PartBase {
  kind: 'lcd1602';
  params: {
    /** ที่อยู่ I²C ตามรุ่นชิปและจัมเปอร์ A0–A2 (PCF8574T 0x20–0x27, PCF8574AT 0x38–0x3F) */
    addr: number;
    /** ตัวต้านทานดึงขึ้น SDA/SCL 4.7 kΩ บนบอร์ด I²C (ไปยัง VCC) — false = ถอดออกแล้ว */
    pullUps: boolean;
    /** ทริมพอตปรับความคมชัด (0–1) */
    contrast: number;
    /** จัมเปอร์ไฟพื้นหลัง (LED) */
    blJumper: boolean;
    color: 'blue' | 'green';
    pullUp: number;
    vMin: number;
    vMax: number;
    supplyCurrent: number;
  };
}

/** โมดูล GY-BMP280 (3.3 V): VCC GND SCL SDA CSB SDO · SDO ดึงลงบนโมดูล → 0x76 (ต่อ 3V3 = 0x77) */
export interface Bmp280Part extends PartBase {
  kind: 'bmp280';
  params: { temperature: number; pressure: number; pullUp: number; vMin: number; vMax: number; supplyCurrent: number };
}

/** โมดูล GY-302 (BH1750): VCC GND SCL SDA ADDR · ADDR ดึงลงบนโมดูล → 0x23 (ต่อ 3V3 = 0x5C) */
export interface Bh1750Part extends PartBase {
  kind: 'bh1750';
  /** sensitivity: ความไว (count/lx ที่ MTreg 69 โหมด H) — ดาต้าชีต: ทั่วไป 1.2 ช่วงของแต่ละตัว 0.96–1.44 · ไม่มี = 1.2 */
  params: { lux: number; pullUp: number; vMin: number; vMax: number; supplyCurrent: number; sensitivity?: number };
}

/** โมดูล INA219 (วัดกระแส/แรงดัน/กำลัง, I²C): VCC GND SCL SDA VIN− VIN+ · ตัวต้านทาน shunt 0.1 Ω ระหว่าง VIN+ กับ VIN− บนโมดูล · ที่อยู่ 0x40 (บัดกรี A0 → 0x41, A1 → 0x44, ทั้งคู่ → 0x45) */
export interface Ina219Part extends PartBase {
  kind: 'ina219';
  params: { addr: number; shunt: number; pullUp: number; vMin: number; vMax: number; supplyCurrent: number };
}

/**
 * จอ LCD 16×2 แบบขนาน (HD44780, หัวเข็ม 16 ขาแถวเดียว เสียบเบรดบอร์ด): VSS VDD V0 RS RW E D0–D7 A K
 * ความคมชัดจากแรงดัน VDD − V0 (ต่อ V0 กับขากลางของ VR) · ไฟพื้นหลังเป็น LED ระหว่าง A–K
 */
export interface ParLcdPart extends PartBase {
  kind: 'lcd1602p';
  params: {
    color: 'blue' | 'green';
    /** ตัวต้านทานอนุกรมไฟพื้นหลังบนแผ่นวงจร (Ω) — 0 = ไม่มี (ต้องต่อตัวต้านทานภายนอกเอง) */
    blR: number;
    /** แรงดันตกคร่อม LED ไฟพื้นหลังที่ 20 mA (V) */
    blVf: number;
    /** กระแสไฟพื้นหลังสูงสุดที่แนะนำ (A) */
    blMax: number;
    vMin: number; vMax: number; supplyCurrent: number;
  };
}

/** โมดูลจอ 7 ส่วน 4 หลัก TM1637 (มีโคลอนกลาง): CLK DIO VCC GND · โปรโตคอล 2 สายของ TM1637 (ไม่ใช่ I²C) · ตัวต้านทานดึงขึ้น 10 kΩ บนโมดูล */
export interface Tm1637Part extends PartBase {
  kind: 'tm1637';
  params: { color: 'red' | 'green' | 'blue'; pullUp: number; vMin: number; vMax: number; supplyCurrent: number };
}

/** ปุ่มกดเมมเบรน 4×4: สาย 8 เส้น R1–R4 (แถว) C1–C4 (คอลัมน์) · กดปุ่ม = หน้าสัมผัสต่อแถวกับคอลัมน์ของปุ่มนั้น · วางบนโต๊ะ ต่อสายจากหัวเข็มปลายสายแพ */
export interface KeypadPart extends PartBase {
  kind: 'keypad';
  params: {
    /** ปุ่มที่กดอยู่ ('' = ไม่กด) — 1 2 3 A / 4 5 6 B / 7 8 9 C / * 0 # D */
    pressed: string;
    /** ความต้านทานหน้าสัมผัสเมมเบรนขณะกด (Ω) */
    contactResistance: number;
    maxVoltage: number;
  };
}

/** โมดูล rotary encoder KY-040 (EC11 20 คลิก/รอบ): CLK DT SW + GND · CLK/DT ดึงขึ้น 10 kΩ ไป + บนโมดูล · หน้าสัมผัส A/B ต่อลง GND · SW ต่อลง GND เมื่อกด (ไม่มีตัวดึงขึ้น) */
export interface EncoderPart extends PartBase {
  kind: 'encoder';
  /** bounceMs: เวลาเด้งของหน้าสัมผัสหลังเปลี่ยนสถานะ (ms) — 0 = หน้าสัมผัสไม่เด้ง (ค่าเริ่ม), ดาต้าชีต EC11B: bounce ≤ 2 ms, chattering ≤ 3 ms */
  params: { pressed: boolean; pullUp: number; contactResistance: number; detentMs: number; bounceMs?: number };
}

/** โมดูลจอยสติ๊ก KY-023: GND +5V VRx VRy SW · ตัวต้านทานปรับค่า 10 kΩ สองแกน (ปลายต่อ +5V กับ GND) · SW ต่อลง GND เมื่อกดก้าน (ไม่มีตัวดึงขึ้น) */
export interface JoystickPart extends PartBase {
  kind: 'joystick';
  params: {
    /** ตำแหน่งก้าน 0–1 (0.5 = กลาง) — x: ซ้าย → ขวา, y: ล่าง → บน */
    x: number;
    y: number;
    pressed: boolean;
    resistance: number;
    contactResistance: number;
  };
}

/** โมดูล PIR HC-SR501: VCC OUT GND · OUT 3.3 V ขณะตรวจพบ + เวลาหน่วง (Tx) · หลัง OUT กลับต่ำ ไม่รับสัญญาณช่วง blockTime · จัมเปอร์ H/L */
export interface PirPart extends PartBase {
  kind: 'pir';
  params: {
    /** มีการเคลื่อนไหวในระยะตรวจจับขณะนี้ (สภาพแวดล้อมที่ตั้งในแผง) */
    motion: boolean;
    /** เวลาหน่วง OUT สูง (s) — ทริมพอต Tx */
    holdTime: number;
    /** ช่วงไม่รับสัญญาณหลัง OUT กลับต่ำ (s) */
    blockTime: number;
    /** H = ต่อเวลาเมื่อเคลื่อนไหวต่อเนื่อง (repeat trigger), L = ครั้งเดียว */
    mode: 'H' | 'L';
    vMin: number;
    vMax: number;
    supplyCurrent: number;
    /** ระยะของสิ่งที่เคลื่อนไหว (m) และมุมจากแกนกลาง (องศา) — ไม่มี = 2 m, 0° */
    distance?: number;
    angle?: number;
    /** ระยะตรวจจับที่ปรับด้วยทริมพอต Sx (m, เอกสาร ≈ 3–7) — ไม่มี = 7 */
    senseRange?: number;
    /** จำลองช่วงเริ่มต้นหลังจ่ายไฟ (≈ 1 นาที: ไม่ตรวจจับจริงและอาจให้สัญญาณหลอก) — ไม่มี/false = ถือว่าจ่ายไฟมานานแล้ว */
    warmup?: boolean;
  };
}

/** โมดูลตรวจจับวัตถุอินฟราเรด FC-51: OUT GND VCC · OUT ต่ำเมื่อวัตถุใกล้กว่าระยะที่ตั้ง (ทริมพอต) — แบบจำลองเพื่อการสอน */
export interface IrObstaclePart extends PartBase {
  kind: 'irobstacle';
  params: {
    /** ระยะวัตถุหน้าเซนเซอร์ (cm) */
    distance: number;
    /** สีผิววัตถุ: ขาวสะท้อนดี / ดำดูดกลืนแสงอินฟราเรด (ระยะตรวจจับสั้นลง) */
    surface: 'white' | 'black';
    /** ระยะตรวจจับที่ตั้งด้วยทริมพอตสำหรับวัตถุสีขาว (cm) */
    threshold: number;
    vMin: number;
    vMax: number;
    supplyCurrent: number;
  };
}

/* ============ เซนเซอร์ชุด 1 (รอบ 87) — รายละเอียดแบบจำลองอยู่ที่ src/model/sensors.ts ============ */
export type Lm393ModuleKind = 'flame' | 'soundsensor' | 'rainsensor' | 'mq2' | 'linetrack' | 'vibsensor';
export type SensorKind = Lm393ModuleKind | 'touch' | 'hall' | 'reed' | 'tilt' | 'waterlevel' | 'fsr';
/** ค่าร่วมของโมดูลคอมพาราเตอร์ LM393: ทริมพอตตั้งจุดตัด (สัดส่วนของ VCC ที่ขา IN อ้างอิง) + ช่วงไฟเลี้ยง */
interface Lm393Common { threshold: number; vMin: number; vMax: number }
/** โมดูลเปลวไฟ (IR 760–1100 nm): ไม่มีไฟ = AO ≈ VCC · ไฟใกล้ = AO ต่ำ · DO ต่ำเมื่อ AO < จุดตัด */
export interface FlamePart extends PartBase { kind: 'flame'; params: Lm393Common & { flame: boolean; distance: number; refDistance: number; sunlight: boolean } }
/** โมดูลเสียง (ไมค์อิเล็กเตรต + LM393): AO = ไบแอส VCC/2 + สัญญาณเสียง · DO ต่ำขณะ AO สูงกว่าจุดตัด */
export interface SoundSensorPart extends PartBase { kind: 'soundsensor'; params: Lm393Common & { sound: boolean; level: number; frequency: number; sensitivity: number } }
/** แผ่นตรวจฝน + โมดูล LM393: แผ่นเปียก = ความต้านทานต่ำ = AO ต่ำ · DO ต่ำเมื่อเปียก */
export interface RainSensorPart extends PartBase { kind: 'rainsensor'; params: Lm393Common & { wet: number; rWet: number } }
/** โมดูลแก๊ส MQ-2: ฮีตเตอร์ RH ที่ VCC · Rs ตามเส้นโค้ง Rs/Ro · AO = VCC·RL/(RL+Rs) · DO ต่ำเมื่อแก๊สเกินจุดตัด */
export interface Mq2Part extends PartBase { kind: 'mq2'; params: Lm393Common & { gas: 'lpg' | 'smoke' | 'co'; ppm: number; ro: number; rl: number; heaterR: number } }
/** โมดูลตรวจเส้น TCRT5000: ผิวขาวสะท้อนมาก = AO ต่ำ = DO ต่ำ · เส้นดำ = DO สูง */
export interface LineTrackPart extends PartBase { kind: 'linetrack'; params: Lm393Common & { surface: 'white' | 'black' | 'none'; height: number } }
/** โมดูลสั่นสะเทือน SW-420 (สวิตช์ปกติปิด): นิ่ง = DO ต่ำ · สั่น = สวิตช์เปิด = DO สูง */
export interface VibSensorPart extends PartBase { kind: 'vibsensor'; params: Lm393Common & { vibrating: boolean } }
/** โมดูลสัมผัส TTP223: ขาออก CMOS · จัมเปอร์บัดกรี: activeLow = แตะแล้วขาออกต่ำ, toggleMode = แตะหนึ่งครั้งสลับสถานะค้าง (ตัวอักษร A/B บนแผ่นต่างกันตามผู้ผลิต) */
export interface TouchPart extends PartBase { kind: 'touch'; params: { touched: boolean; activeLow: boolean; toggleMode: boolean; toggled: boolean; vMin: number; vMax: number; rOut: number } }
/** เซนเซอร์ Hall A3144 (TO-92 ขาออก open-collector): ขั้วใต้ของแม่เหล็กใกล้พอ (B ≥ BOP) → ขาออกนำลงกราวด์ · คืนเมื่อ B < BRP */
export interface HallPart extends PartBase { kind: 'hall'; params: { magnet: boolean; distance: number; pole: 'S' | 'N'; on: boolean; bop: number; brp: number; vMin: number; vMax: number; sinkMax: number } }
/** สวิตช์รีด (ปกติเปิด) + แม่เหล็ก: ปิดเมื่อแม่เหล็กเข้าใกล้ถึงระยะทำงาน เปิดเมื่อห่างเกินระยะปล่อย */
export interface ReedPart extends PartBase { kind: 'reed'; params: { magnet: boolean; distance: number; closed: boolean; operate: number; release: number; contactResistance: number; maxCurrent: number; maxVoltage: number; span: number } }
/** สวิตช์เอียง SW-520D (ลูกบอลโลหะ): ขาชี้ลง (มุมเอียง ≤ 45°) = ต่อกัน · เอียงเกิน = เปิด */
export interface TiltPart extends PartBase { kind: 'tilt'; params: { angle: number; onAngle: number; contactResistance: number; maxCurrent: number; maxVoltage: number } }
/** เซนเซอร์ระดับน้ำ (ลายทองแดงสลับ + ทรานซิสเตอร์): แห้ง = S ≈ 0 · จุ่มลึกขึ้น = S สูงขึ้น */
export interface WaterLevelPart extends PartBase { kind: 'waterlevel'; params: { level: number; fullRatio: number; rOut: number; vMin: number; vMax: number } }
/** ตัวต้านทานไวแรงกด FSR 402: ไม่กด = เปิดวงจร · R ลดลงตามแรงกด (ตารางค่าทั่วไป) */
export interface FsrPart extends PartBase { kind: 'fsr'; params: { force: number; maxPower: number } }
export type SensorPart = FlamePart | SoundSensorPart | RainSensorPart | Mq2Part | LineTrackPart | VibSensorPart | TouchPart | HallPart | ReedPart | TiltPart | WaterLevelPart | FsrPart;

export interface RgbLedPart extends PartBase {
  kind: 'rgbled';
  params: {
    /** cc = แคโทดร่วม (ขาร่วมต่อลบ), ca = แอโนดร่วม (ขาร่วมต่อบวก) */
    common: 'cc' | 'ca';
    /** แรงดันตกคร่อมที่ 20 mA ของแต่ละสี (V) — ใช้คำนวณ Is ของแบบจำลองไดโอด */
    vfR: number;
    vfG: number;
    vfB: number;
    n: number;
    Rs: number;
    /** กระแสที่ใช้เป็นสเกลความสว่าง (A) */
    ratedCurrent: number;
    /** กระแสสูงสุดต่อสี (A) */
    maxCurrent: number;
    maxReverseVoltage: number;
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

/**
 * เซนเซอร์ความชื้นในดินแบบ capacitive v1.2 ปักในกระถางต้นไม้ (วางบนโต๊ะ) — สาย 3 เส้น GND / VCC / AOUT
 * ความชื้นดิน (%) เป็นสภาพแวดล้อม: 0 = ดินแห้งสนิท (≈ อ่านในอากาศ), 100 = อิ่มน้ำ (≈ จุ่มน้ำ) — เปลี่ยนตามเวลาจากปั๊มที่รดกระถางนี้และการระเหย
 */
export interface SoilSensorPart extends PartBase {
  kind: 'soilsensor';
  params: {
    /** ความชื้นดินเริ่มต้น / ที่ตั้งใหม่ (%) */
    moisture: number;
    /** อัตราดินแห้ง (% ต่อวินาทีจำลอง — เร่งเวลา) */
    dryRate: number;
    /** ปริมาณน้ำที่ทำให้ความชื้นเปลี่ยนจาก 0 → 100 % (mL) */
    potWater: number;
    /** แรงดันขาออกในดินแห้งสนิท / อิ่มน้ำ (V) */
    vDry: number;
    vWet: number;
    /** ความต้านทานขาออก (Ω) */
    rOut: number;
    /** กระแสใช้งาน (A) */
    supplyCurrent: number;
    vMin: number;
    vMax: number;
  };
}

/** ปั๊มน้ำจุ่ม DC 3–6 V (Ø 24 × 33 mm) ในถังน้ำ — สายแดง (+) ดำ (−) · สายยางพาน้ำไปกระถางของเซนเซอร์ `target` */
export interface PumpPart extends PartBase {
  kind: 'pump';
  params: {
    /** id ของเซนเซอร์ความชื้น (กระถาง) ที่สายยางรดน้ำ ('' = ไม่ได้ต่อสายยางไปกระถาง) */
    target: string;
    resistance: number;
    inductance: number;
    ke: number;
    inertia: number;
    noLoadCurrent: number;
    viscous: number;
    /** อัตราไหลสูงสุดที่ 6 V ไม่มีความสูงยก (L/h) */
    flowMax: number;
    /** ความสูงยกสูงสุดที่ 6 V (cm) */
    headMax: number;
    /** ความสูงที่ต้องยกน้ำ จากผิวน้ำถึงปลายสายยาง (cm) */
    lift: number;
    vMax: number;
  };
}

/**
 * เซนเซอร์อุณหภูมิและความชื้นอากาศ DHT22 (AM2302) ตัวถังพลาสติกขาว 4 ขา: 1 VDD, 2 DATA, 3 NC, 4 GND
 * สื่อสารบัสสายเดียว (ต้องมีตัวต้านทานดึงขึ้นที่ DATA) — อุณหภูมิ/ความชื้นเป็นสภาพแวดล้อมที่ตั้งในแผงคุณสมบัติ
 */
export interface Dht22Part extends PartBase {
  kind: 'dht22' | 'dht11';
  params: {
    temperature: number;
    humidity: number;
    vMin: number;
    vMax: number;
    /** กระแสขณะวัด/ส่งข้อมูล และขณะพัก (A) */
    supplyCurrent: number;
    standbyCurrent: number;
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
    /** แรงดันออฟเซ็ตขาเข้า (V, บวก = IN+ ภายในสูงกว่าขาจริง) — ไม่มี = ค่าทั่วไปของรุ่น */
    offsetVoltage?: number;
    /** กระแสไบแอสขาเข้า (A, ไหลเข้าขา) และกระแสออฟเซ็ต (A, IN+ มากกว่า IN−) — ไม่มี = ค่าทั่วไปของรุ่น */
    biasCurrent?: number;
    offsetCurrent?: number;
  };
}

/**
 * Raspberry Pi Pico (kind 'pico') และ Pico W (kind 'picow') — หัวต่อ 40 ขาและขนาดบอร์ดเหมือนกัน
 * Pico W: เฟิร์มแวร์ MicroPython ที่ build จากการตั้งค่า Pico W แต่ปิดส่วนไร้สาย (ชิป CYW43 ไม่ได้จำลอง) — LED บนบอร์ด (ต่อกับ CYW43) และ Wi-Fi/Bluetooth ใช้ไม่ได้
 */
export interface PicoPart extends PartBase {
  /**
   * xiao = Seeed Studio XIAO RP2040 (14 ขา D0–D10 + 5V/GND/3V3 · LED RGB และ NeoPixel บนบอร์ด)
   * nanoconnect = Arduino Nano RP2040 Connect (30 ขาแบบ Nano · IMU LSM6DSOX บนบัส I²C ของ A4/A5 · ไม่จำลองโมดูล NINA-W102)
   * esp32devkitc = Espressif ESP32-DevKitC V4 (ESP32-WROOM-32E) — CPU ESP32 ใน QEMU บนเซิร์ฟเวอร์ รัน MicroPython ESP32_GENERIC
   * ทั้งหมดนี้ไม่ใช่หัวต่อ 40 ขาแบบ Pico (isPico() เป็นเท็จ)
   */
  kind: 'pico' | 'picow' | 'xiao' | 'nanoconnect' | 'esp32devkitc';
  params: {
    /** โปรแกรม MicroPython ของนักเรียน (บันทึกไปกับไฟล์) */
    code: string;
    /** รันโค้ดอัตโนมัติเมื่อบอร์ดเริ่มทำงาน (เหมือน main.py) */
    autorun: boolean;
    /** ไฟล์ bg.bin ในบอร์ด (รูป 240×240 RGB565 ไบต์สูงก่อน, base64) — ไม่มี = รูปเริ่มต้น */
    bg?: string;
    /** ชื่อรูปที่ผู้ใช้เลือก (แสดงในแผง) */
    bgName?: string;
    /** Nano RP2040 Connect: การเคลื่อนไหวของบอร์ดที่ IMU บนบอร์ดวัดได้ และจังหวะก้าวต่อนาที (เมื่อเดิน) */
    motion?: 'still' | 'walk' | 'shake';
    spm?: number;
  };
}

/**
 * Arduino Uno R3 (ATmega328P) วางบนโต๊ะ — โค้ด C++ (sketch .ino) คอมไพล์ด้วยบริการคอมไพล์ แล้วเก็บไฟล์ .hex ไว้กับไฟล์งาน
 * (เปิดไฟล์ใหม่รันได้ทันทีโดยไม่ต้องคอมไพล์ซ้ำ) · hexSrc = โค้ดที่ใช้สร้าง hex นั้น (ต่างจาก code = ยังไม่ได้อัปโหลดโค้ดล่าสุด)
 */
export interface UnoPart extends PartBase {
  kind: 'uno';
  params: {
    code: string;
    hex: string | null;
    hexSrc: string;
    /** ขนาดโปรแกรมที่คอมไพล์ (ไบต์) */
    flash: number;
    ram: number;
    /** EEPROM 1 KB (base64) ที่โปรแกรมเขียนไว้ — บันทึกไปกับไฟล์งาน (ไม่มี = ว่างทั้งหมด 0xFF) */
    eeprom?: string;
  };
}

/**
 * Arduino Nano (ATmega328P 16 MHz, 5 V) เสียบเบรดบอร์ดคร่อมร่องกลาง — ชิปและโปรแกรมแบบเดียวกับ Uno (คอมไพล์ด้วย variant eightanaloginputs: A6/A7 อ่านแอนะล็อกได้อย่างเดียว)
 * พารามิเตอร์เหมือน Uno ทุกตัว
 */
export interface NanoPart extends PartBase {
  kind: 'nano';
  params: UnoPart['params'];
}
/**
 * เครื่องวิเคราะห์ลอจิก USB 8 ช่อง (โมดูลทั่วไป 24 MHz) วางบนโต๊ะ — ขา CH0–CH7 + GND ต่อสายเข้าวงจร
 * ไม่โหลดวงจร (ขาเข้าในอุดมคติ) · ค่าตั้งหน้าจอบันทึกไปกับไฟล์
 */
export interface LogicAnalyzerPart extends PartBase {
  kind: 'logicanalyzer';
  params: {
    /** เวลาต่อช่อง (s/div) — หน้าจอแสดง 10 ช่อง */
    timeDiv: number;
    /** ช่องทริกเกอร์ 0–7 (−1 = ไม่ใช้ทริกเกอร์ แสดงต่อเนื่อง) */
    trigCh: number;
    trigEdge: 'rise' | 'fall';
    /** ตัวถอดรหัสของแต่ละช่อง (I²C: ช่องหนึ่งเป็น SDA อีกช่องเป็น SCL · SPI: ช่องข้อมูล (MOSI/MISO) + SCK (+ CS ถ้ามี)) */
    decoders: Array<'none' | 'uart' | 'i2c-sda' | 'i2c-scl' | 'spi-data' | 'spi-sck' | 'spi-cs'>;
    /** โหมด SPI 0–3 (CPOL·2 + CPHA) — ไม่มี = 0 */
    spiMode?: number;
    /** บอดเรตของตัวถอดรหัส UART แต่ละช่อง (0 = เดาจากพัลส์ที่แคบที่สุด) */
    bauds: number[];
  };
}

/** บอร์ด ATmega328P ที่เขียน C++ (Arduino) ได้ */
/**
 * Arduino UNO Q (ABX00162/ABX00173) วางบนโต๊ะ — หัวต่อแบบ UNO (ใส่ shield ได้) ลอจิก 3.3 V
 * **โหมดจำลองพฤติกรรม (ระดับ Arduino API)**: สเก็ตช์ถูกคอมไพล์และรันบนแกนจำลอง ATmega328P แทน STM32U585 + Zephyr
 * โดยใช้ขาและไฟฟ้าแบบ UNO Q (3.3 V, ADC อ้างอิง 3.3 V, Wire ที่ขา SDA/SCL, ขาที่ไม่ทน 5 V, 20 mA ต่อขา) — ไม่จำลอง Linux (QRB2210), Bridge, LED matrix
 */
export interface UnoQPart extends PartBase {
  kind: 'unoq';
  params: UnoPart['params'] & {
    /** กระแสสูงสุดของแหล่งจ่ายที่ต่อช่อง USB-C (A): พอร์ตคอมพิวเตอร์ 0.5/0.9 A หรืออะแดปเตอร์ USB-C 3 A */
    usbLimit: number;
  };
}

/**
 * Arduino Mega 2560 Rev3 (ATmega2560 16 MHz, 5 V) วางบนโต๊ะ — คอมไพล์เป็นบอร์ด Mega (variant mega) รันบนตัวจำลอง CPU AVR ชิป ATmega2560
 * พารามิเตอร์เหมือน Uno · EEPROM 4 KB
 */
export interface MegaPart extends PartBase {
  kind: 'mega';
  params: UnoPart['params'];
}

/** ปุ่มอาร์เคด 24 mm (ไมโครสวิตช์ 3 ขา COM/NO/NC) ติดแผง — วางบนโต๊ะ ต่อสายที่ขั้วไมโครสวิตช์ */
export interface ArcadeButtonPart extends PartBase {
  kind: 'arcadebtn';
  params: {
    color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'black';
    /** กดอยู่หรือไม่ (ปล่อยแล้วกลับเป็น false) */
    pressed: boolean;
    /** ความต้านทานหน้าสัมผัส (Ω) */
    contactResistance: number;
    /** พิกัดหน้าสัมผัสของไมโครสวิตช์ (A, V) */
    maxCurrent: number;
    maxVoltage: number;
  };
}

/** ปุ่มกด 16 mm แบบติดแผง (กดติดปล่อยดับ, ปกติเปิด 2 ขา) */
export interface PushButton16Part extends PartBase {
  kind: 'pushbtn16';
  params: {
    color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'black';
    pressed: boolean;
    contactResistance: number;
    maxCurrent: number;
    maxVoltage: number;
  };
}

/** อะแดปเตอร์ 5 V 3 A (ปลั๊ก DC 5.5 × 2.1 mm ขั้วกลางบวก) เสียบแจ็ก DC ตัวเมียแบบขั้วต่อสกรู (+/−) */
export interface DcAdapterPart extends PartBase {
  kind: 'dcadapter';
  params: {
    /** แรงดันขาออก (V) */
    voltage: number;
    /** กระแสพิกัด (A) — เกินแล้วแรงดันตก (วงจรจำกัดกระแส) */
    currentLimit: number;
    /** ความต้านทานภายใน + สาย (Ω) */
    internalResistance: number;
    /** เสียบปลั๊กไฟบ้านอยู่ */
    plugged: boolean;
  };
}

/** บอร์ดกระจายไฟเซอร์โว 4 ช่อง (แบบพาสซีฟ): ขั้วสกรูไฟเข้า, หัวเข็ม S/V/G ต่อช่อง, ขาสัญญาณเข้า S1–S4 + GND, ตัวเก็บประจุ, LED ไฟเข้า */
export interface ServoHubPart extends PartBase {
  kind: 'servohub';
  params: {
    /** ตัวเก็บประจุกรองไฟบนบอร์ด (F) */
    capacitance: number;
    /** พิกัดแรงดันตัวเก็บประจุ (V) */
    capRating: number;
  };
}

/**
 * Arduino Pro Mini 328 (ATmega328P) เสียบเบรดบอร์ดคร่อมร่องกลาง (ขาสองแถว 12 ขา ระยะแถว 0.6") — ไม่มีพอร์ต USB
 * ตัวจำลองถือว่าต่อตัวแปลง USB-serial ไว้ที่หัว 6 ขาตลอด (ไฟ VCC + Serial Monitor + อัปโหลด)
 * volt: 5 = รุ่น 5 V / 16 MHz · 3.3 = รุ่น 3.3 V / 8 MHz (ArduinoCore-avr boards.txt: pro.menu.cpu.16MHzatmega328 / 8MHzatmega328)
 * เปลี่ยนรุ่นแล้วต้องคอมไพล์ใหม่ (F_CPU ต่างกัน) — แอปล้าง hex ให้
 */
export interface ProMiniPart extends PartBase {
  kind: 'promini';
  params: UnoPart['params'] & { volt: 5 | 3.3 };
}

/**
 * ไอซีไมโครคอนโทรลเลอร์ ATtiny85 ตัวถัง DIP-8 เสียบคร่อมร่องกลาง — ไม่มีบอร์ด/USB: ต้องจ่ายไฟให้ขา 8 (VCC) และขา 4 (GND) จากวงจรเอง
 * CPU ทำงานเมื่อ VCC ≥ 2.7 V · โปรแกรมคอมไพล์เป็นบอร์ด attiny85 (ArduinoCore-avr + variant gemma, นาฬิกาภายใน 8 MHz) · EEPROM 512 ไบต์
 */
export interface Attiny85Part extends PartBase {
  kind: 'attiny85';
  params: UnoPart['params'];
}

/** บอร์ดตระกูล Raspberry Pi Pico (RP2040 + MicroPython) */
export function isPico(p: { kind: string }): p is PicoPart & { kind: 'pico' | 'picow' } { return p.kind === 'pico' || p.kind === 'picow'; }
/** บอร์ดที่รัน MicroPython ในแอป (RP2040: Pico, Pico W, XIAO, Nano RP2040 Connect · ESP32-DevKitC ผ่าน QEMU บนเซิร์ฟเวอร์) — ใช้กับส่วนรันโค้ด/คอนโซล ไม่ใช่ตำแหน่งขา */
export function isMicroPy(p: { kind: string }): p is PicoPart { return isPico(p) || p.kind === 'xiao' || p.kind === 'nanoconnect' || p.kind === 'esp32devkitc'; }

export type AvrPart = UnoPart | NanoPart | UnoQPart | MegaPart | ProMiniPart | Attiny85Part;

/**
 * Raspberry Pi 5 วางบนโต๊ะ — จำลองระดับไลบรารี: โค้ด Python (gpiozero ชุดย่อย) รันด้วย CPython ใน WebAssembly ไม่ได้จำลอง CPU/Linux
 */
export interface RpiPart extends PartBase {
  kind: 'rpi5';
  params: {
    /** main.py ของนักเรียน */
    code: string;
    /** รันอัตโนมัติเมื่อเริ่มจำลอง (เหมือนตั้งให้รันสคริปต์ตอนบูต) */
    autorun: boolean;
  };
}

export type Part = SensorPart | RpiPart | ProMiniPart | Attiny85Part | DcSupplyPart | ResistorPart | LedPart | RgbLedPart | OledPart | RtcPart | ImuPart | VibMotorPart | Esp32s2Part | ModelOnlyBoardPart | RoundLcdPart | Qmi8658Part | Esp32s3LcdPart | CharLcdPart | Bmp280Part | Bh1750Part | Ina219Part | Tm1637Part | KeypadPart | EncoderPart | JoystickPart | PirPart | IrObstaclePart | SwitchPart | AmmeterPart | CapacitorPart | InductorPart | FgenPart | ScopePart | DiodePart | BjtPart | MosfetPart | OpampPart | PicoPart | PotentiometerPart | PushbuttonPart | BuzzerPart | LdrPart | SevenSegPart | RelayPart | Timer555Part | VregPart | TransformerPart | ServoPart | MotorPart | LogicPart | CounterPart | Lm35Part | HbridgePart | SonarPart | ShiftRegPart | OptoPart | StepperPart | DmmPart | VomPart | ScrPart | Lm317Part | NtcPart | ComparatorPart | DarlingtonPart | Lm386Part | SpeakerPart | SoilSensorPart | PumpPart | Dht22Part | UnoPart | NanoPart | LogicAnalyzerPart | ParLcdPart | UnoQPart | MegaPart | ArcadeButtonPart | PushButton16Part | DcAdapterPart | ServoHubPart;

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
export const SCHEMA_VERSION = 61; // 61 = เซนเซอร์ชุด 1 (เปลวไฟ เสียง ฝน MQ-2 ตรวจเส้น สั่น สัมผัส Hall รีด เอียง ระดับน้ำ FSR), 60 = บอร์ดเฉพาะโมเดล Blue Pill / Pico 2 / Teensy 4.1, 59 = ESP32-DevKitC V4 (QEMU), 58 = Arduino Nano RP2040 Connect, 57 = Seeed XIAO RP2040, 56 = Pico W (ไม่มีไร้สาย), 55 = ATtiny85, 54 = Mega 2560 + Pro Mini, 49 = Arduino Nano, 50 = เครื่องวิเคราะห์ลอจิก, 51 = จอ LCD แบบขนาน, 52 = ตัวถอดรหัส I²C, 53 = UNO Q + อุปกรณ์โครงงานจบ
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
