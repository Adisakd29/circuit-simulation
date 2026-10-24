import type { BjtPart, DiodeModel, DiodePart, LedColor, MosfetModel, MosfetPart, OpampPart, Part, PartKind, Placement, Rotation, Timer555Part, VregModel, VregPart, LogicModel, OptoRank } from './types';

/**
 * คลังอุปกรณ์ — นิยามขา ค่าเริ่มต้น และตำแหน่งที่วางได้
 * อุปกรณ์ใหม่ในอนาคต (เช่น ไมโครคอนโทรลเลอร์) เพิ่มที่นี่ + ใน netlist builder
 */

export const VT = 0.025852; // แรงดันความร้อนที่ 300 K (V)

export interface PinDef {
  name: string;
  label: string;
  /** สำหรับอุปกรณ์บนบอร์ด: ระยะจากขาอ้างอิงตามแกนอุปกรณ์ (หน่วยรู) ก่อนหมุน */
  dx: number;
  dy: number;
}

export interface CatalogEntry {
  kind: PartKind | string;
  name: string;
  nameEn: string;
  category: 'source' | 'passive' | 'semiconductor' | 'control' | 'mcu' | 'instrument' | 'future';
  mount: 'board' | 'table';
  supported: boolean;
  description: string;
  labelPrefix: string;
  keywords: string[];
}

export const CATEGORIES: Record<CatalogEntry['category'], string> = {
  source: 'แหล่งจ่ายไฟ',
  passive: 'อุปกรณ์พาสซีฟ',
  semiconductor: 'สารกึ่งตัวนำ',
  control: 'สวิตช์และการควบคุม',
  mcu: 'ไมโครคอนโทรลเลอร์',
  instrument: 'เครื่องมือวัด',
  future: 'ยังไม่รองรับในระยะที่ 1',
};

export const CATALOG: CatalogEntry[] = [
  {
    kind: 'dcsupply', name: 'แหล่งจ่ายไฟ DC', nameEn: 'DC Power Supply', category: 'source', mount: 'table',
    supported: true, labelPrefix: 'PS', keywords: ['power', 'supply', 'แบต', 'ไฟ', 'dc', 'แหล่งจ่าย'],
    description: 'แหล่งจ่ายแรงดันคงที่ (CV) พร้อมจำกัดกระแส (CC) วางบนโต๊ะ ต่อสายจากขั้ว + และ −',
  },
  {
    kind: 'resistor', name: 'ตัวต้านทาน', nameEn: 'Resistor', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'R', keywords: ['resistor', 'ohm', 'r', 'โอห์ม', 'ต้านทาน'],
    description: 'ตัวต้านทานเชิงเส้นในอุดมคติ (กฎของโอห์ม) แถบสีคำนวณจากค่าที่ตั้ง',
  },
  {
    kind: 'motor', name: 'มอเตอร์ DC เกียร์ TT (3–6 V)', nameEn: 'DC gear motor (TT, 1:48)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'M', keywords: ['motor', 'มอเตอร์', 'dc motor', 'tt', 'gear', 'เกียร์', 'ล้อ', 'wheel', 'robot', 'หุ่นยนต์'],
    description: 'มอเตอร์เกียร์ TT 1:48 ใส่ล้อ: สายแดง (+) สายดำ (−) — 6 V ไม่มีโหลด ≈ 250 rpm 0.16 A, หยุดค้าง ≈ 1.5 A · ต้องใช้วงจรขับ (มอสเฟต/ทรานซิสเตอร์ + ไดโอดกันย้อน) ห้ามต่อขา GPIO ตรง',
  },
  {
    kind: 'servo', name: 'เซอร์โวมอเตอร์ SG90', nameEn: 'Micro servo SG90', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'M', keywords: ['servo', 'เซอร์โว', 'sg90', 'motor', 'มอเตอร์', 'pwm', '9g'],
    description: 'เซอร์โว 9 g ไฟเลี้ยง 4.8–6 V: สายน้ำตาล GND, แดง +, ส้ม สัญญาณ PWM 50 Hz — พัลส์ 0.5–2.4 ms หมุน 0–180° (1.45 ms ≈ 90°)',
  },
  {
    kind: 'stepper', name: 'สเต็ปเปอร์มอเตอร์ 28BYJ-48 + บอร์ดขับ ULN2003', nameEn: 'Stepper motor 28BYJ-48 with ULN2003 driver', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'M', keywords: ['stepper', 'สเต็ป', 'สเต็ปเปอร์', '28byj-48', '28byj', 'uln2003', 'มอเตอร์', 'motor', 'step'],
    description: 'มอเตอร์ 5 V 4 เฟส เกียร์ 1:64 (4096 ฮาล์ฟสเต็ป/รอบ) เสียบกับบอร์ด ULN2003: หัวเข็ม IN1–IN4 (ต่อ GPIO) และ − + (ไฟ 5 V) — ป้อนลำดับสเต็ปให้ขดลวดทีละเฟส',
  },
  {
    kind: 'relay', name: 'โมดูลรีเลย์ 5 V (1 ช่อง)', nameEn: 'Relay module 5 V, 1 channel', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'K', keywords: ['relay', 'รีเลย์', 'srd-05vdc', 'module', 'โมดูล', 'switch', 'ky-019'],
    description: 'รีเลย์ SRD-05VDC-SL-C บนโมดูล (ทรานซิสเตอร์ขับ + ไดโอดกันย้อน + LED) วางบนโต๊ะ: ขา S (สัญญาณ HIGH = ดึง), + (5 V), − (GND) และขั้วสกรู NO / COM / NC',
  },
  {
    kind: 'sevenseg', name: 'ตัวแสดงผล 7 ส่วน (7-segment)', nameEn: '7-segment display 0.56"', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'DS', keywords: ['7-segment', 'seven segment', '7seg', '5161as', '5161bs', 'display', 'ตัวเลข', 'เซเวนเซกเมนต์', 'แสดงผล'],
    description: 'ตัวเลข 0.56" สีแดง 10 ขา (5161AS แคโทดร่วม / 5161BS แอโนดร่วม) วางคร่อมร่องกลาง: ขา 1–5 แถว h, ขา 6–10 แถว d · แต่ละส่วนเป็น LED ต้องมีตัวต้านทานจำกัดกระแสของตัวเอง',
  },
  {
    kind: 'ldr', name: 'ตัวต้านทานไวแสง (LDR)', nameEn: 'Photoresistor (LDR) GL5528', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'LDR', keywords: ['ldr', 'photoresistor', 'light', 'gl5528', 'cds', 'แสง', 'ไวแสง', 'ตรวจแสง'],
    description: 'GL5528 (Ø5 mm): 10–20 kΩ ที่ 10 lux, มืด ≥ 1 MΩ, γ ≈ 0.6 — ปรับความสว่างที่ตกบนตัวได้ในแผงคุณสมบัติ ไม่มีขั้ว',
  },
  {
    kind: 'buzzer', name: 'บัซเซอร์ (ลำโพงเสียงแหลม)', nameEn: 'Buzzer 12 mm', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'BZ', keywords: ['buzzer', 'beeper', 'บัซเซอร์', 'เสียง', 'ลำโพง', 'active', 'passive', 'tmb12a05', 'cem-1203'],
    description: 'Ø12 mm ขาห่าง 7.6 mm (3 ช่อง) · แบบมีวงจรในตัว (active, 5 V ≈ 30 mA, ≈ 2.4 kHz) ป้อนไฟตรงก็ดัง · แบบไม่มีวงจร (passive, ขดลวด 42 Ω) ต้องป้อนคลื่นสี่เหลี่ยมหรือ PWM — แอปเล่นเสียงจริงตามความถี่ที่ป้อน',
  },
  {
    kind: 'pushbutton', name: 'สวิตช์ปุ่มกด (tactile)', nameEn: 'Push button (6 × 6 mm tactile)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'SW', keywords: ['button', 'push', 'tactile', 'tact', 'ปุ่ม', 'ปุ่มกด', 'สวิตช์กด', 'b3f'],
    description: 'ปุ่มกดติดปล่อยดับ 4 ขาแบบ 6 × 6 mm วางคร่อมร่องกลาง — ขาคู่ที่คร่อมร่องต่อถึงกันภายใน กดแล้วต่อคู่ซ้ายกับคู่ขวา · กดค้างที่ปุ่มในฉาก 3 มิติหรือในแผงคุณสมบัติ',
  },
  {
    kind: 'potentiometer', name: 'ตัวต้านทานปรับค่าได้ (VR)', nameEn: 'Potentiometer (trimmer)', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'VR', keywords: ['potentiometer', 'pot', 'vr', 'trimmer', 'trimpot', '3296', 'โพเทนชิโอมิเตอร์', 'ปรับค่า', 'วอลุ่ม'],
    description: 'ทริมพอต 25 รอบแบบ 3296W ขาเรียง 1–2–3 (ขา 2 = แกนกลาง/wiper) ปรับตำแหน่งแกนได้ในแผงคุณสมบัติ',
  },
  {
    kind: 'capacitor', name: 'ตัวเก็บประจุ', nameEn: 'Capacitor', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'C', keywords: ['capacitor', 'ตัวเก็บประจุ', 'คาปาซิเตอร์', 'c', 'farad', 'rc'],
    description: 'ตัวเก็บประจุในอุดมคติ i = C·dv/dt (อิเล็กโทรไลต์มีขั้ว + / −) ทำให้วงจรต้องจำลองตามเวลา',
  },
  {
    kind: 'inductor', name: 'ตัวเหนี่ยวนำ', nameEn: 'Inductor', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'L', keywords: ['inductor', 'ตัวเหนี่ยวนำ', 'ขดลวด', 'coil', 'henry', 'rl'],
    description: 'ตัวเหนี่ยวนำ v = L·di/dt ต่ออนุกรมความต้านทานขดลวด (DCR)',
  },
  {
    kind: 'diode', name: 'ไดโอด', nameEn: 'Diode', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'D', keywords: ['diode', 'ไดโอด', '1n4148', '1n4007', 'zener', 'ซีเนอร์', 'rectifier', 'เรียงกระแส'],
    description: 'ไดโอดทั่วไป (1N4148, 1N4007) หรือซีเนอร์ 5.1 V — แบบจำลอง Shockley + Rs + การพังทลายย้อนกลับ ขา A และ K (แถบ)',
  },
  {
    kind: 'bjt', name: 'ทรานซิสเตอร์ BJT', nameEn: 'BJT transistor', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'Q', keywords: ['transistor', 'ทรานซิสเตอร์', 'bjt', 'npn', 'pnp', '2n3904', '2n3906'],
    description: 'NPN 2N3904 หรือ PNP 2N3906 ตัวถัง TO-92 ขา E B C เรียงจากซ้าย (มองด้านแบน) แบบจำลอง Ebers–Moll',
  },
  {
    kind: 'mosfet', name: 'มอสเฟต (MOSFET)', nameEn: 'MOSFET', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'Q', keywords: ['mosfet', 'fet', 'มอสเฟต', '2n7000', 'irlz44n', 'irf9540n', 'n-channel', 'p-channel', 'สวิตช์โหลด'],
    description: 'ช่อง N: 2N7000 (TO-92 ขา S G D) และ IRLZ44N (TO-220 ขา G D S, ขับได้จากขา 3.3 V) · ช่อง P: IRF9540N (TO-220 ขา G D S) — แบบจำลองระดับ 1 + ไดโอดในตัว',
  },
  {
    kind: 'opamp', name: 'ออปแอมป์ (DIP-8)', nameEn: 'Op-amp', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['opamp', 'op-amp', 'ออปแอมป์', '741', 'lm741', 'amplifier', 'ขยาย'],
    description: 'ออปแอมป์ตัวเดียวขาแบบ 741: 2 = IN−, 3 = IN+, 4 = V−, 6 = OUT, 7 = V+ — แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง ต้องต่อไฟเลี้ยง',
  },
  {
    kind: 'vreg', name: 'ไอซีคงแรงดัน 78xx (7805)', nameEn: 'Voltage regulator 78xx', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['7805', '7809', '7812', 'l7805', 'lm7805', 'regulator', 'เรกูเลเตอร์', 'คงแรงดัน', 'power supply', 'แหล่งจ่าย'],
    description: 'L7805 / L7809 / L7812 ตัวถัง TO-220 (มองด้านหน้า ขาลง): ขา 1 IN, 2 GND (ต่อกับแผ่นโลหะ), 3 OUT — ต้องการ IN สูงกว่า OUT อย่างน้อย 2 V',
  },
  {
    kind: 'logic', name: 'ไอซีเกตตรรกะ 74HC (DIP-14)', nameEn: 'Logic gate IC 74HC', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['logic', 'gate', 'เกต', 'ลอจิก', 'ดิจิทัล', '74hc00', '74hc08', '74hc32', '74hc04', '74hc86', '74hc02', 'nand', 'nor', 'and', 'or', 'not', 'xor'],
    description: '74HC00 NAND, 74HC02 NOR, 74HC04 NOT, 74HC08 AND, 74HC32 OR, 74HC86 XOR — ขา 7 GND, ขา 14 VCC (2–6 V) · แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'sonar', name: 'โมดูลวัดระยะอัลตราโซนิก HC-SR04', nameEn: 'Ultrasonic distance sensor HC-SR04', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'US', keywords: ['hc-sr04', 'hcsr04', 'ultrasonic', 'sonar', 'distance', 'อัลตราโซนิก', 'วัดระยะ', 'ระยะทาง', 'เซนเซอร์'],
    description: 'หัวเข็ม 4 ขา (มองด้านหน้าที่มีลำโพง): VCC 5 V, TRIG (พัลส์ ≥ 10 µs เริ่มวัด), ECHO (พัลส์ 5 V กว้างตามเวลาเสียงไป-กลับ), GND · วัด 2–400 cm · ปรับระยะวัตถุได้ในแผงคุณสมบัติ',
  },
  {
    kind: 'hbridge', name: 'ไอซีขับมอเตอร์ L293D (DIP-16)', nameEn: 'Motor driver L293D (H-bridge)', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['l293d', 'l293', 'h-bridge', 'hbridge', 'motor driver', 'ขับมอเตอร์', 'สะพาน', 'กลับทิศ', 'มอเตอร์'],
    description: 'L293D ไดรเวอร์ครึ่งสะพาน 4 ช่อง (ต่อเป็น H-bridge ได้ 2 ชุด) มีไดโอดกันย้อนในตัว — ขา 16 VCC1 5 V (ตรรกะ), ขา 8 VCC2 ไฟมอเตอร์ 4.5–36 V, ขา 4/5/12/13 GND · 600 mA ต่อช่อง',
  },
  {
    kind: 'scr', name: 'ไทริสเตอร์ SCR', nameEn: 'Thyristor SCR 2N5060', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'SCR', keywords: ['scr', 'thyristor', 'ไทริสเตอร์', 'เอสซีอาร์', '2n5060', 'latch', 'ล็อก', 'gate', 'เกต'],
    description: '2N5060 ตัวถัง TO-92 (มองหน้าแบน ขาลง): K แคโทด, G เกต, A แอโนด — ป้อนกระแสเกต ≥ 200 µA แล้วติดค้าง ดับเมื่อกระแสแอโนดต่ำกว่า 5 mA (ตัดวงจร/ลัด A–K) · 30 V 0.8 A',
  },
  {
    kind: 'lm317', name: 'ไอซีคงแรงดันปรับค่าได้ LM317', nameEn: 'Adjustable regulator LM317', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['lm317', '317', 'lm317t', 'adjustable', 'regulator', 'ปรับแรงดัน', 'เรกูเลเตอร์', 'คงแรงดัน', 'แหล่งจ่าย', 'power supply'],
    description: 'LM317 ตัวถัง TO-220 (มองด้านหน้า ขาลง): ขา 1 ADJ, 2 OUT (ต่อกับแผ่นโลหะ), 3 IN — VOUT = 1.25 V × (1 + R2/R1) ใช้ R1 ≈ 240 Ω จาก OUT ไป ADJ, R2 จาก ADJ ลงกราวด์ · ขาเข้าสูงกว่าขาออก ≥ 3 V',
  },
  {
    kind: 'ntc', name: 'เทอร์มิสเตอร์ NTC 10 kΩ', nameEn: 'NTC thermistor 10k B3950 (MF52)', category: 'passive', mount: 'board',
    supported: true, labelPrefix: 'TH', keywords: ['ntc', 'thermistor', 'เทอร์มิสเตอร์', 'mf52', '3950', '10k', 'temperature', 'อุณหภูมิ', 'ความร้อน', 'sensor', 'เซนเซอร์'],
    description: 'MF52A 10 kΩ ที่ 25 °C, B = 3950 K (หัวหยดอีพ็อกซี่สีดำ ไม่มีขั้ว) — ร้อนขึ้นความต้านทานลด (0 °C ≈ 33.6 kΩ, 100 °C ≈ 0.7 kΩ) · ต่อเป็นวงแบ่งแรงดันกับตัวต้านทาน 10 kΩ · กำลังไม่เกิน 50 mW',
  },
  {
    kind: 'comparator', name: 'คอมพาราเตอร์ LM393 (DIP-8)', nameEn: 'Dual comparator LM393', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['lm393', '393', 'comparator', 'คอมพาราเตอร์', 'เปรียบเทียบ', 'thermostat', 'เทอร์โมสตัท', 'schmitt', 'hysteresis'],
    description: 'คอมพาราเตอร์คู่ ขาออก open collector: ขา 1 OUTA, 2 INA−, 3 INA+, 4 GND, 5 INB+, 6 INB−, 7 OUTB, 8 VCC (2–36 V) · IN− > IN+ → ขาออกดึงลง GND · ต้องมีตัวต้านทาน pull-up หรือ LED + ตัวต้านทานจากไฟบวกเข้าขาออก — แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'darlington', name: 'ทรานซิสเตอร์ดาร์ลิงตัน TIP120', nameEn: 'Darlington transistor TIP120', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'Q', keywords: ['tip120', 'darlington', 'ดาร์ลิงตัน', 'transistor', 'ทรานซิสเตอร์', 'power', 'กำลัง', 'motor', 'มอเตอร์', 'driver', 'ขับโหลด'],
    description: 'TIP120 NPN ดาร์ลิงตัน TO-220 (มองด้านหน้า ขาลง): ขา 1 B, 2 C (แผ่นโลหะ), 3 E — hFE ≥ 1000, 5 A 60 V · ขับโหลดกระแสสูงจากกระแสเบสน้อย ๆ แต่ VBE ≈ 1.2–2.5 V และ VCE(sat) ≈ 0.7–2 V (สูงกว่าทรานซิสเตอร์ธรรมดา)',
  },
  {
    kind: 'lm386', name: 'ไอซีขยายเสียง LM386 (DIP-8)', nameEn: 'Audio power amplifier LM386', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['lm386', '386', 'audio', 'amplifier', 'ขยายเสียง', 'แอมป์', 'เครื่องขยาย', 'speaker', 'ลำโพง'],
    description: 'LM386N-1 ขยายเสียง 4–12 V: ขา 1 GAIN, 2 −IN, 3 +IN, 4 GND, 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN · อัตราขยาย 20 เท่า (ใส่ 10 µF ขา 1–8 → 200 เท่า) · ขาออก ≈ VS/2 ต้องต่อ C 250 µF ไปลำโพง 8 Ω — แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'speaker', name: 'ลำโพง 8 Ω 0.5 W', nameEn: 'Speaker 8 Ω 0.5 W (57 mm)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'LS', keywords: ['speaker', 'ลำโพง', 'loudspeaker', '8 ohm', 'เสียง', 'audio', 'lm386'],
    description: 'ลำโพงไดนามิก Ø 57 mm 8 Ω 0.5 W: สายแดง (+) สายดำ (−) — ขับด้วยไอซีขยายเสียงผ่านตัวเก็บประจุคัปปลิ้ง (ห้ามมีไฟตรงไหลผ่าน) · มีเสียงออกลำโพงคอมพิวเตอร์ตามความถี่และกำลังที่ได้',
  },
  {
    kind: 'lm35', name: 'เซนเซอร์อุณหภูมิ LM35', nameEn: 'Temperature sensor LM35DZ', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'TS', keywords: ['lm35', 'temperature', 'temp', 'sensor', 'อุณหภูมิ', 'เซนเซอร์', 'ความร้อน', 'thermometer', 'adc'],
    description: 'LM35DZ ตัวถัง TO-92 (มองหน้าแบน ขาลง): +VS ไฟเลี้ยง 4–30 V, VOUT 10 mV/°C, GND — ปรับอุณหภูมิได้ในแผงคุณสมบัติ',
  },
  {
    kind: 'opto', name: 'ออปโตคัปเปลอร์ PC817 (DIP-4)', nameEn: 'Optocoupler PC817', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['pc817', 'opto', 'optocoupler', 'photocoupler', 'ออปโต', 'แยกวงจร', 'isolation', 'โฟโต้ทรานซิสเตอร์', 'แสง'],
    description: 'PC817: LED อินฟราเรด (ขา 1 แอโนด, ขา 2 แคโทด) ส่องโฟโต้ทรานซิสเตอร์ (ขา 4 คอลเลกเตอร์, ขา 3 อิมิตเตอร์) — สองฝั่งไม่ต่อกันทางไฟฟ้า · IF ≤ 50 mA, VCEO 80 V · แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'shiftreg', name: 'ไอซีเลื่อนบิต 74HC595 (DIP-16)', nameEn: 'Shift register 74HC595', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['595', '74hc595', 'shift register', 'shift', 'เลื่อนบิต', 'ขยายขา', 'อนุกรม', 'serial', 'ดิจิทัล', 'spi'],
    description: '74HC595 รับข้อมูลทีละบิตที่ SER (ขา 14) เลื่อนเมื่อ SRCLK (ขา 11) ขึ้น แล้วโอนไปขาออก QA–QH เมื่อ RCLK (ขา 12) ขึ้น — ขา 16 VCC 2–6 V, ขา 8 GND, ขา 10 SRCLR ต่อ VCC, ขา 13 OE ต่อ GND · แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'counter', name: 'ไอซีนับ CD4017 (ทศวรรษ DIP-16)', nameEn: 'Decade counter CD4017', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['4017', 'cd4017', 'counter', 'นับ', 'ไฟวิ่ง', 'decade', 'johnson', 'ดิจิทัล', 'chaser', 'ทศวรรษ'],
    description: 'CD4017B นับ 0–9 ที่ขอบขาขึ้นของ CLK (ขา 14) ขาออก Q0–Q9 ติดทีละขา — ขา 8 VSS, ขา 16 VDD (3–18 V), RESET ขา 15 และ CLK INH ขา 13 ต้องต่อ VSS · แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'timer555', name: 'ไอซีไทเมอร์ 555 (DIP-8)', nameEn: '555 timer IC (NE555)', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['555', 'ne555', 'timer', 'ไทเมอร์', 'astable', 'monostable', 'กะพริบ', 'oscillator', 'ic'],
    description: 'NE555: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL, 6 THR, 7 DIS, 8 VCC (4.5–16 V) — แตะรูแถว f (ขา 1) ให้ตัวคร่อมร่องกลาง',
  },
  {
    kind: 'led', name: 'LED (ไดโอดเปล่งแสง)', nameEn: 'LED', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'LED', keywords: ['led', 'diode', 'ไดโอด', 'หลอด', 'แสง'],
    description: 'แบบจำลองไดโอด Shockley + ความต้านทานอนุกรม ขา A (แอโนด, ขายาว) และ K (แคโทด)',
  },
  {
    kind: 'switch', name: 'สวิตช์เลื่อน (SPST)', nameEn: 'Slide switch', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'SW', keywords: ['switch', 'สวิตช์', 'spst'],
    description: 'สวิตช์ทางเดียว เปิด = วงจรขาด, ปิด = ความต้านทานต่ำ',
  },
  {
    kind: 'transformer', name: 'หม้อแปลงลดแรงดัน 12-0-12 V', nameEn: 'Step-down transformer 12-0-12 V', category: 'source', mount: 'table',
    supported: true, labelPrefix: 'T', keywords: ['transformer', 'หม้อแปลง', 'ac', 'ไฟสลับ', '12v', 'center tap', 'แท็ปกลาง', 'rectifier', 'เรียงกระแส'],
    description: 'หม้อแปลงแกนเหล็ก (EI) 230 V → 12-0-12 V 1 A 50 Hz: ขั้ว A, CT (แท็ปกลาง), B — A–CT และ CT–B ได้ 12 V rms, A–B ได้ 24 V rms · ด้านไฟบ้านไม่อยู่ในการจำลอง',
  },
  {
    kind: 'fgen', name: 'เครื่องกำเนิดสัญญาณ', nameEn: 'Function generator', category: 'source', mount: 'table',
    supported: true, labelPrefix: 'FG', keywords: ['function', 'generator', 'สัญญาณ', 'ac', 'sine', 'square', 'ไซน์', 'คลื่น'],
    description: 'สร้างสัญญาณไซน์ สี่เหลี่ยม สามเหลี่ยม หรือ DC ตั้งความถี่ Vpp และ offset ได้ ขาออกมีความต้านทาน 50 Ω',
  },
  {
    kind: 'scope', name: 'ออสซิลโลสโคป 2 ช่อง', nameEn: 'Oscilloscope', category: 'instrument', mount: 'table',
    supported: true, labelPrefix: 'OSC', keywords: ['scope', 'oscilloscope', 'สโคป', 'ออสซิล', 'รูปคลื่น'],
    description: 'ดูรูปคลื่นแรงดัน CH1/CH2 เทียบขั้ว GND ตั้ง time/div, volts/div, trigger และวัด Vpp ความถี่ได้ ขาเข้า 1 MΩ',
  },
  {
    kind: 'ammeter', name: 'แอมมิเตอร์ (ต่ออนุกรม)', nameEn: 'Ammeter', category: 'instrument', mount: 'table',
    supported: true, labelPrefix: 'A', keywords: ['ammeter', 'current', 'กระแส', 'มิเตอร์', 'แอมป์'],
    description: 'เครื่องวัดกระแสแบบต่ออนุกรม มีความต้านทานภายใน (shunt) ค่าบวกเมื่อกระแสเข้าขั้ว A ออกขั้ว COM',
  },
  {
    kind: 'dmm', name: 'มัลติมิเตอร์ดิจิทัล', nameEn: 'Digital multimeter (DMM)', category: 'instrument', mount: 'table',
    supported: true, labelPrefix: 'DMM', keywords: ['multimeter', 'dmm', 'มัลติมิเตอร์', 'มิเตอร์', 'ดิจิทัล', 'ดิจิตอล', 'โวลต์', 'โอห์ม', 'แอมป์', 'volt', 'ohm', 'meter'],
    description: 'มัลติมิเตอร์ดิจิทัล 4000 count ขนาดจริง: สวิตช์หมุนเลือก V~ V⎓ mV Ω A mA (ปรับย่านอัตโนมัติ) · ขั้ว V/Ω ขาเข้า 10 MΩ · ขั้ว mA และ 10 A มี shunt และฟิวส์ภายใน — เสียบสายผิดขั้วแล้ววัดแรงดัน ฟิวส์ขาดได้เหมือนของจริง',
  },
  {
    kind: 'vom', name: 'มัลติมิเตอร์แบบเข็ม', nameEn: 'Analog multimeter (VOM)', category: 'instrument', mount: 'table',
    supported: true, labelPrefix: 'VOM', keywords: ['multimeter', 'analog', 'vom', 'มัลติมิเตอร์', 'เข็ม', 'มิเตอร์', 'อนาล็อก', 'โวลต์', 'โอห์ม', 'แอมป์', 'needle'],
    description: 'มัลติมิเตอร์แบบเข็ม 20 kΩ/V ขนาดจริง: DCV 0.1–1000 V, ACV 10–750 V, DCA 50 µA–0.25 A, Ω ×1–×1k — ผู้ใช้เลือกย่านเอง อ่านค่าจากสเกล · ย่าน V มีผลโหลดวงจรตามความไว · ย่าน Ω ขั้ว COM (ดำ) เป็นขั้วบวกของแบตเตอรี่ภายใน',
  },
  // ---- ยังไม่รองรับ (แสดงตรง ๆ ใน UI ไม่ให้วาง) ----
  {
    kind: 'pico', name: 'Raspberry Pi Pico', nameEn: 'Raspberry Pi Pico (RP2040)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'PICO', keywords: ['pico', 'rp2040', 'mcu', 'micropython', 'python', 'ไมโครคอนโทรลเลอร์', 'raspberry'],
    description: 'บอร์ด RP2040 (รุ่นไม่มี Wi-Fi) บัดกรีขา header แล้ว รัน MicroPython จริงในตัวจำลอง CPU (rp2040js) — แตะรูแถว h ให้ขา 1–20 อยู่แถว h และขา 21–40 อยู่แถว c · GP0/GP1 ใช้เป็น REPL',
  },
  { kind: 'esp32', name: 'ESP32', nameEn: 'ESP32', category: 'future', mount: 'board', supported: false, labelPrefix: 'U', keywords: ['esp32', 'mcu'], description: 'ยังไม่รองรับ: ตอนนี้รันโค้ดได้เฉพาะ Raspberry Pi Pico (MicroPython)' },
  { kind: 'tft', name: 'จอ TFT', nameEn: 'TFT display', category: 'future', mount: 'board', supported: false, labelPrefix: 'DSP', keywords: ['tft', 'display', 'จอ'], description: 'ยังไม่รองรับ: ต้องมีการจำลองบัส SPI ระหว่าง Pico กับจอ' },
];

/** ขา GPIO ที่ออกมาที่ขาของบอร์ด Pico */
export const PICO_GPIO = [...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28];

/** ลำดับขา 1–40 ของ Pico (ตามบอร์ดจริง) */
export const PICO_PINOUT: string[] = [
  'GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND.8', 'GP6', 'GP7', 'GP8', 'GP9', 'GND.13', 'GP10', 'GP11', 'GP12', 'GP13', 'GND.18', 'GP14', 'GP15',
  'GP16', 'GP17', 'GND.23', 'GP18', 'GP19', 'GP20', 'GP21', 'GND.28', 'GP22', 'RUN', 'GP26', 'GP27', 'AGND', 'GP28', 'ADC_VREF', '3V3', '3V3_EN', 'GND.38', 'VSYS', 'VBUS',
];

const PICO_NOTE: Record<string, string> = {
  GP0: 'UART0 TX (REPL)', GP1: 'UART0 RX (REPL)', GP26: 'ADC0', GP27: 'ADC1', GP28: 'ADC2', RUN: 'รีเซ็ต — ไม่จำลอง', '3V3_EN': 'ไม่จำลอง',
  '3V3': 'ไฟเลี้ยง 3.3 V ออก', VSYS: 'ไฟเลี้ยงระบบ ≈ 4.7 V', VBUS: 'ไฟ USB 5 V', ADC_VREF: 'อ้างอิง ADC 3.3 V', AGND: 'กราวด์ ADC',
};

/** ขาที่ต่อถึงกันภายในอุปกรณ์ (เช่น GND ทุกขาของ Pico) — connectivity รวมเป็นเน็ตเดียว */
export function internalLinks(part: Part): string[][] {
  if (part.kind === 'pico') return [PICO_PINOUT.filter((n) => n.startsWith('GND') || n === 'AGND')];
  if (part.kind === 'hbridge') return [['GND', 'GND.5', 'GND.12', 'GND.13']]; // ขา GND ทั้งสี่ต่อกับแผ่นระบายความร้อนภายใน
  return [];
}

export const PICO_DEFAULT_CODE = `from machine import Pin
import time

led = Pin(15, Pin.OUT)   # GP15 = ขา 20 (มุมล่างซ้ายของบอร์ด)

while True:
    led.toggle()
    time.sleep(0.5)
`;

export function catalogEntry(kind: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.kind === kind);
}

export function pinDefs(part: Part): PinDef[] {
  switch (part.kind) {
    case 'resistor':
      return [
        { name: '1', label: 'ขา 1', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2', dx: part.params.span, dy: 0 },
      ];
    case 'motor':
      return [
        { name: 'A', label: 'สายแดง ขั้ว + (A บวกกว่า B = หมุนเดินหน้า)', dx: 0, dy: 0 },
        { name: 'B', label: 'สายดำ ขั้ว −', dx: 0, dy: 0 },
      ];
    case 'servo':
      return [
        { name: 'GND', label: 'สายน้ำตาล GND (−)', dx: 0, dy: 0 },
        { name: 'V', label: 'สายแดง + ไฟเลี้ยง 4.8–6 V', dx: 0, dy: 0 },
        { name: 'SIG', label: 'สายส้ม สัญญาณ PWM (50 Hz, 0.5–2.4 ms)', dx: 0, dy: 0 },
      ];
    case 'transformer':
      return [
        { name: 'A', label: 'A ปลายขดทุติยภูมิ (12 V จาก CT)', dx: 0, dy: 0 },
        { name: 'CT', label: 'CT แท็ปกลาง (0 V)', dx: 0, dy: 0 },
        { name: 'B', label: 'B ปลายขดทุติยภูมิ (12 V จาก CT กลับเฟสกับ A)', dx: 0, dy: 0 },
      ];
    case 'stepper':
      return [
        ...STEPPER_INPUTS.map((p, k) => ({ name: p, label: `${p} ขาเข้าเฟส ${'ABCD'[k]} (สูง = ขดลวด${STEPPER_WIRES[k]}มีไฟ)`, dx: 0, dy: 0 })),
        { name: 'G', label: '− กราวด์ (ต่อกราวด์ร่วมกับ Pico)', dx: 0, dy: 0 },
        { name: 'V', label: '+ ไฟเลี้ยงมอเตอร์ 5 V', dx: 0, dy: 0 },
      ];
    case 'relay':
      return [
        { name: 'S', label: 'S สัญญาณควบคุม (HIGH = ดึง)', dx: 0, dy: 0 },
        { name: 'V', label: '+ ไฟเลี้ยง 5 V', dx: 0, dy: 0 },
        { name: 'G', label: '− กราวด์', dx: 0, dy: 0 },
        { name: 'NO', label: 'NO ปกติเปิด (ต่อกับ COM เมื่อรีเลย์ทำงาน)', dx: 0, dy: 0 },
        { name: 'COM', label: 'COM ขาร่วม', dx: 0, dy: 0 },
        { name: 'NC', label: 'NC ปกติปิด (ต่อกับ COM เมื่อรีเลย์ไม่ทำงาน)', dx: 0, dy: 0 },
      ];
    case 'sevenseg': {
      // มองจากด้านหน้า (ตัวเลขตั้งตรง): ขา 1–5 แถวล่างจากซ้ายไปขวา, ขา 6–10 แถวบนจากขวาไปซ้าย (ห่าง 15.24 mm = 6 แถว)
      const com = part.params.common === 'cc' ? 'แคโทดร่วม (−)' : 'แอโนดร่วม (+)';
      const seg = ['E', 'D', 'COM', 'C', 'DP', 'B', 'A', 'COM', 'F', 'G'];
      return seg.map((s, i) => {
        const pin = i + 1;
        return { name: String(pin), label: `ขา ${pin} ${s === 'COM' ? com : `ส่วน ${s}`}`, dx: pin <= 5 ? pin - 1 : 10 - pin, dy: pin <= 5 ? 0 : -6 };
      });
    }
    case 'lm386':
      // ขาเรียงแบบ DIP-8: 1–4 แถว anchor, 5–8 อีกฝั่งร่อง (ขา 8 ตรงข้ามขา 1)
      return [
        { name: 'G1', label: 'ขา 1 GAIN (ตั้งอัตราขยาย)', dx: 0, dy: 0 },
        { name: 'IN-', label: 'ขา 2 −INPUT', dx: 1, dy: 0 },
        { name: 'IN+', label: 'ขา 3 +INPUT (สัญญาณเข้า)', dx: 2, dy: 0 },
        { name: 'GND', label: 'ขา 4 GND', dx: 3, dy: 0 },
        { name: 'OUT', label: 'ขา 5 VOUT (≈ VS/2 + สัญญาณ)', dx: 3, dy: -3 },
        { name: 'VS', label: 'ขา 6 VS ไฟเลี้ยง 4–12 V', dx: 2, dy: -3 },
        { name: 'BYP', label: 'ขา 7 BYPASS', dx: 1, dy: -3 },
        { name: 'G8', label: 'ขา 8 GAIN (ตั้งอัตราขยาย)', dx: 0, dy: -3 },
      ];
    case 'speaker':
      return [
        { name: 'P', label: 'สายแดง ขั้ว +', dx: 0, dy: 0 },
        { name: 'N', label: 'สายดำ ขั้ว −', dx: 0, dy: 0 },
      ];
    case 'darlington':
      return [
        { name: 'B', label: 'ขา 1 B เบส', dx: 0, dy: 0 },
        { name: 'C', label: 'ขา 2 C คอลเลกเตอร์ (ต่อกับแผ่นโลหะ)', dx: 1, dy: 0 },
        { name: 'E', label: 'ขา 3 E อิมิตเตอร์', dx: 2, dy: 0 },
      ];
    case 'comparator':
      return [
        { name: 'OUTA', label: 'ขา 1 OUTA ขาออก A (open collector)', dx: 0, dy: 0 },
        { name: 'INA-', label: 'ขา 2 INA− ขาเข้ากลับเฟส A', dx: 1, dy: 0 },
        { name: 'INA+', label: 'ขา 3 INA+ ขาเข้าไม่กลับเฟส A', dx: 2, dy: 0 },
        { name: 'GND', label: 'ขา 4 GND', dx: 3, dy: 0 },
        { name: 'INB+', label: 'ขา 5 INB+ ขาเข้าไม่กลับเฟส B', dx: 3, dy: -3 },
        { name: 'INB-', label: 'ขา 6 INB− ขาเข้ากลับเฟส B', dx: 2, dy: -3 },
        { name: 'OUTB', label: 'ขา 7 OUTB ขาออก B (open collector)', dx: 1, dy: -3 },
        { name: 'VCC', label: 'ขา 8 VCC ไฟเลี้ยง 2–36 V', dx: 0, dy: -3 },
      ];
    case 'ntc':
      return [
        { name: '1', label: 'ขา 1', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2', dx: part.params.span, dy: 0 },
      ];
    case 'ldr':
      return [
        { name: '1', label: 'ขา 1', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2', dx: part.params.span, dy: 0 },
      ];
    case 'buzzer':
      // ขา + (ขายาว, ฝั่งที่พิมพ์ "+" บนตัว) และขา − ห่าง 7.62 mm (3 ช่อง)
      return [
        { name: 'P', label: 'ขา + (ขายาว)', dx: 0, dy: 0 },
        { name: 'N', label: 'ขา −', dx: 3, dy: 0 },
      ];
    case 'pushbutton':
      // 6 × 6 mm วางคร่อมร่องกลาง: ขา 1, 3 ที่แถวของ anchor (เช่น f) ขา 2, 4 อีกฝั่งร่อง (แถว e)
      // ขาที่คร่อมร่อง (1–2, 3–4) ต่อถึงกันภายในตัวปุ่มเสมอ · กดปุ่ม = ต่อ 1–2 เข้ากับ 3–4
      return [
        { name: '1', label: 'ขา 1 (ต่อกับขา 2 ภายใน)', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2 (ต่อกับขา 1 ภายใน)', dx: 0, dy: -3 },
        { name: '3', label: 'ขา 3 (ต่อกับขา 4 ภายใน)', dx: 2, dy: 0 },
        { name: '4', label: 'ขา 4 (ต่อกับขา 3 ภายใน)', dx: 2, dy: -3 },
      ];
    case 'potentiometer':
      // 3296W มองด้านที่มีสกรูปรับอยู่ด้านบน: ขา 1–2–3 เรียงแถวเดียว ระยะ 2.54 mm, ขา 2 = แกนกลาง (wiper)
      return [
        { name: '1', label: 'ขา 1 (ปลาย)', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2 แกนกลาง (wiper)', dx: 1, dy: 0 },
        { name: '3', label: 'ขา 3 (ปลาย)', dx: 2, dy: 0 },
      ];
    case 'led':
      return [
        { name: 'A', label: 'A แอโนด (+)', dx: 0, dy: 0 },
        { name: 'K', label: 'K แคโทด (−)', dx: 1, dy: 0 },
      ];
    case 'capacitor':
      return part.params.polarized
        ? [{ name: 'P', label: 'ขา + (ขายาว)', dx: 0, dy: 0 }, { name: 'N', label: 'ขา − (แถบขาว)', dx: part.params.span, dy: 0 }]
        : [{ name: 'P', label: 'ขา 1', dx: 0, dy: 0 }, { name: 'N', label: 'ขา 2', dx: part.params.span, dy: 0 }];
    case 'inductor':
      return [
        { name: '1', label: 'ขา 1', dx: 0, dy: 0 },
        { name: '2', label: 'ขา 2', dx: part.params.span, dy: 0 },
      ];
    case 'diode':
      return [
        { name: 'A', label: 'A แอโนด', dx: 0, dy: 0 },
        { name: 'K', label: 'K แคโทด (ฝั่งแถบ)', dx: part.params.span, dy: 0 },
      ];
    case 'bjt':
      return [
        { name: 'E', label: 'E อีมิตเตอร์', dx: 0, dy: 0 },
        { name: 'B', label: 'B เบส', dx: 1, dy: 0 },
        { name: 'C', label: 'C คอลเลกเตอร์', dx: 2, dy: 0 },
      ];
    case 'mosfet':
      // 2N7000 (TO-92, มองด้านแบน ขาลง): S G D จากซ้าย · TO-220 (มองด้านหน้า แผ่นโลหะอยู่ด้านหลัง): G D S จากซ้าย
      return part.params.model === '2N7000'
        ? [{ name: 'S', label: 'S ซอร์ส', dx: 0, dy: 0 }, { name: 'G', label: 'G เกต', dx: 1, dy: 0 }, { name: 'D', label: 'D เดรน', dx: 2, dy: 0 }]
        : [{ name: 'G', label: 'G เกต', dx: 0, dy: 0 }, { name: 'D', label: 'D เดรน (ต่อกับแผ่นโลหะด้วย)', dx: 1, dy: 0 }, { name: 'S', label: 'S ซอร์ส', dx: 2, dy: 0 }];
    case 'pico':
      // ขา 1–20 ตามแนว anchor (dx 0..19, เช่น แถว h), ขา 21–40 อีกฝั่งห่าง 7 แถวไปทางแถว a โดยขา 40 ตรงข้ามขา 1
      // มองจากด้านบน (USB อยู่ซ้าย) ขา 1 อยู่ล่างซ้าย เรียงทวนเข็มนาฬิกาเหมือนบอร์ดจริง (schema 7)
      return PICO_PINOUT.map((name, k) => {
        const pin = k + 1;
        const base = name.replace(/\.\d+$/, '');
        const note = PICO_NOTE[name];
        return { name, label: `ขา ${pin} ${base}${note ? ` (${note})` : ''}`, dx: pin <= 20 ? pin - 1 : 40 - pin, dy: pin <= 20 ? 0 : -7 };
      });
    case 'opamp':
      // ขา 1–4 เรียงที่แถวของ anchor (เช่น แถว f), ขา 5–8 อยู่อีกฝั่งร่องกลาง (ห่าง 3 แถวไปทางแถว a) โดยขา 8 ตรงข้ามขา 1
      // มองจากด้านบนเรียงทวนเข็มนาฬิกาเหมือน IC จริง (schema 7 — รุ่นก่อนเรียงกลับด้าน)
      return [
        { name: 'NC1', label: 'ขา 1 (offset — ไม่ใช้)', dx: 0, dy: 0 },
        { name: 'IN-', label: 'ขา 2 IN− (กลับเฟส)', dx: 1, dy: 0 },
        { name: 'IN+', label: 'ขา 3 IN+ (ไม่กลับเฟส)', dx: 2, dy: 0 },
        { name: 'V-', label: 'ขา 4 V− (ไฟเลี้ยงลบ)', dx: 3, dy: 0 },
        { name: 'NC5', label: 'ขา 5 (offset — ไม่ใช้)', dx: 3, dy: -3 },
        { name: 'OUT', label: 'ขา 6 OUT', dx: 2, dy: -3 },
        { name: 'V+', label: 'ขา 7 V+ (ไฟเลี้ยงบวก)', dx: 1, dy: -3 },
        { name: 'NC8', label: 'ขา 8 (ไม่ใช้)', dx: 0, dy: -3 },
      ];
    case 'sonar':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 5 V', dx: 0, dy: 0 },
        { name: 'TRIG', label: 'TRIG สั่งวัด (พัลส์สูง ≥ 10 µs)', dx: 1, dy: 0 },
        { name: 'ECHO', label: 'ECHO ขาออกพัลส์ 5 V (ต่อ Pico ผ่านตัวแบ่งแรงดัน)', dx: 2, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 3, dy: 0 },
      ];
    case 'opto':
      // DIP-4 มองด้านบน จุดขา 1 ซ้ายล่าง: ขา 1–2 แถว anchor, ขา 3–4 อีกฝั่ง (ขา 4 ตรงข้ามขา 1)
      return PC817_PINOUT.map((nm, k) => {
        const pin = k + 1;
        return { name: nm, label: `ขา ${pin} ${PC817_LABEL[nm]}`, dx: pin <= 2 ? pin - 1 : 4 - pin, dy: pin <= 2 ? 0 : -3 };
      });
    case 'shiftreg':
      return HC595_PINOUT.map((nm, k) => {
        const pin = k + 1;
        return { name: nm, label: `ขา ${pin} ${HC595_LABEL[nm]}`, dx: pin <= 8 ? pin - 1 : 16 - pin, dy: pin <= 8 ? 0 : -3 };
      });
    case 'hbridge':
      // DIP-16 ขา 1–8 แถว anchor, 9–16 อีกฝั่ง (ขา 16 ตรงข้ามขา 1)
      return L293D_PINOUT.map((nm, k) => {
        const pin = k + 1;
        return { name: nm, label: `ขา ${pin} ${L293D_LABEL[nm]}`, dx: pin <= 8 ? pin - 1 : 16 - pin, dy: pin <= 8 ? 0 : -3 };
      });
    case 'lm317':
      return [
        { name: 'ADJ', label: 'ขา 1 ADJ ปรับแรงดัน (OUT − ADJ = 1.25 V)', dx: 0, dy: 0 },
        { name: 'OUT', label: 'ขา 2 OUT ขาออก (ต่อกับแผ่นโลหะ)', dx: 1, dy: 0 },
        { name: 'IN', label: 'ขา 3 IN ขาเข้า', dx: 2, dy: 0 },
      ];
    case 'scr':
      return [
        { name: 'K', label: 'ขา 1 K แคโทด', dx: 0, dy: 0 },
        { name: 'G', label: 'ขา 2 G เกต (IGT ≤ 200 µA)', dx: 1, dy: 0 },
        { name: 'A', label: 'ขา 3 A แอโนด', dx: 2, dy: 0 },
      ];
    case 'lm35':
      return [
        { name: 'VS', label: '+VS ไฟเลี้ยง 4–30 V', dx: 0, dy: 0 },
        { name: 'OUT', label: 'VOUT ขาออก 10 mV/°C', dx: 1, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 2, dy: 0 },
      ];
    case 'counter':
      // DIP-16 ขา 1–8 แถว anchor, 9–16 อีกฝั่ง (ขา 16 ตรงข้ามขา 1)
      return CD4017_PINOUT.map((nm, k) => {
        const pin = k + 1;
        return { name: nm, label: `ขา ${pin} ${CD4017_LABEL[nm]}`, dx: pin <= 8 ? pin - 1 : 16 - pin, dy: pin <= 8 ? 0 : -3 };
      });
    case 'logic': {
      // DIP-14 ขา 1–7 แถว anchor, 8–14 อีกฝั่ง (ขา 14 ตรงข้ามขา 1)
      const names = LOGIC_PINOUT[part.params.model];
      return names.map((nm, k) => {
        const pin = k + 1;
        return { name: nm, label: `ขา ${pin} ${logicPinLabel(part.params.model, nm)}`, dx: pin <= 7 ? pin - 1 : 14 - pin, dy: pin <= 7 ? 0 : -3 };
      });
    }
    case 'vreg':
      return [
        { name: 'IN', label: 'ขา 1 IN ขาเข้า (ไฟที่ยังไม่คงที่)', dx: 0, dy: 0 },
        { name: 'GND', label: 'ขา 2 GND กราวด์ (ต่อกับแผ่นโลหะ)', dx: 1, dy: 0 },
        { name: 'OUT', label: `ขา 3 OUT ขาออก ${part.params.vout} V`, dx: 2, dy: 0 },
      ];
    case 'timer555':
      // ขาเรียงแบบ DIP-8 เดียวกับออปแอมป์: 1–4 แถว anchor, 5–8 อีกฝั่งร่อง (ขา 8 ตรงข้ามขา 1)
      return [
        { name: 'GND', label: 'ขา 1 GND (กราวด์)', dx: 0, dy: 0 },
        { name: 'TRIG', label: 'ขา 2 TRIG ทริกเกอร์ (< ⅓ VCC → OUT = HIGH)', dx: 1, dy: 0 },
        { name: 'OUT', label: 'ขา 3 OUT ขาออก', dx: 2, dy: 0 },
        { name: 'RESET', label: 'ขา 4 RESET (LOW = รีเซ็ต — ปกติต่อ VCC)', dx: 3, dy: 0 },
        { name: 'CTRL', label: 'ขา 5 CTRL แรงดันควบคุม (≈ ⅔ VCC, ต่อ C 10 nF ลงกราวด์)', dx: 3, dy: -3 },
        { name: 'THR', label: 'ขา 6 THR เทรชโฮลด์ (> ⅔ VCC → OUT = LOW)', dx: 2, dy: -3 },
        { name: 'DIS', label: 'ขา 7 DIS คายประจุ (ต่อลงกราวด์เมื่อ OUT = LOW)', dx: 1, dy: -3 },
        { name: 'VCC', label: 'ขา 8 VCC ไฟเลี้ยง 4.5–16 V', dx: 0, dy: -3 },
      ];
    case 'switch':
      return [
        { name: 'A', label: 'ขา A', dx: 0, dy: 0 },
        { name: 'B', label: 'ขา B', dx: 2, dy: 0 },
      ];
    case 'dcsupply':
      return [
        { name: 'pos', label: 'ขั้ว + (แดง)', dx: 0, dy: 0 },
        { name: 'neg', label: 'ขั้ว − (ดำ)', dx: 0, dy: 0 },
      ];
    case 'fgen':
      return [
        { name: 'OUT', label: 'ขั้ว OUT (สัญญาณ, แดง)', dx: 0, dy: 0 },
        { name: 'COM', label: 'ขั้ว COM (ดำ)', dx: 0, dy: 0 },
      ];
    case 'scope':
      return [
        { name: 'CH1', label: 'CH1 (เหลือง)', dx: 0, dy: 0 },
        { name: 'CH2', label: 'CH2 (ฟ้า)', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND (ดำ)', dx: 0, dy: 0 },
      ];
    case 'ammeter':
      return [
        { name: 'A', label: 'ขั้ว A (กระแสเข้า)', dx: 0, dy: 0 },
        { name: 'COM', label: 'ขั้ว COM (กระแสออก)', dx: 0, dy: 0 },
      ];
    case 'dmm':
      return [
        { name: 'A10', label: 'ขั้ว 10 A (แดง, วัดกระแสสูง ฟิวส์ 11 A)', dx: 0, dy: 0 },
        { name: 'mA', label: 'ขั้ว mA µA (แดง, วัดกระแสต่ำ ฟิวส์ 440 mA)', dx: 0, dy: 0 },
        { name: 'COM', label: 'ขั้ว COM (ดำ, ร่วม)', dx: 0, dy: 0 },
        { name: 'V', label: 'ขั้ว V Ω (แดง, วัดแรงดัน/ความต้านทาน)', dx: 0, dy: 0 },
      ];
    case 'vom':
      return [
        { name: 'P', label: 'ขั้ว + (แดง)', dx: 0, dy: 0 },
        { name: 'COM', label: 'ขั้ว − COM (ดำ)', dx: 0, dy: 0 },
      ];
  }
}

export function rotateOffset(dx: number, dy: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 0: return [dx, dy];
    case 90: return [-dy, dx];
    case 180: return [-dx, -dy];
    case 270: return [dy, -dx];
  }
}

/** คำนวณพารามิเตอร์ LED จากแรงดันตกคร่อมที่กระแสอ้างอิง */
export function ledParamsFor(color: LedColor) {
  const vf: Record<LedColor, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.1 };
  const If = 0.02;
  const n = 2;
  const Rs = 5;
  const Vd = vf[color] - If * Rs;
  const Is = If / (Math.exp(Vd / (n * VT)) - 1);
  return { color, Is, n, Rs, ratedCurrent: 0.02, maxCurrent: 0.03, maxReverseVoltage: 5 };
}

export const LED_HEX: Record<LedColor, number> = {
  red: 0xff2a1f, yellow: 0xffd21f, green: 0x2bff4a, blue: 0x2f6bff, white: 0xf4f6ff,
};

export const LED_NAMES: Record<LedColor, string> = {
  red: 'แดง', yellow: 'เหลือง', green: 'เขียว', blue: 'น้ำเงิน', white: 'ขาว',
};

export function defaultPart(kind: PartKind, id: string, label: string, placement: Placement): Part {
  switch (kind) {
    case 'dcsupply':
      return { id, label, kind, placement, params: { voltage: 5, currentLimit: 0.1, internalResistance: 0.01, outputOn: true } };
    case 'resistor':
      return { id, label, kind, placement, params: { resistance: 1000, powerRating: 0.25, span: 4 } };
    case 'buzzer':
      return { id, label, kind, placement, params: buzzerParamsFor('active') };
    case 'sevenseg':
      return { id, label, kind, placement, params: sevenSegParamsFor('cc') };
    case 'timer555':
      return { id, label, kind, placement, params: { ...TIMER555_DEFAULTS } };
    case 'vreg':
      return { id, label, kind, placement, params: vregParamsFor('L7805') };
    case 'logic':
      return { id, label, kind, placement, params: { ...LOGIC_DEFAULTS, model: '74HC08' } };
    case 'counter':
      return { id, label, kind, placement, params: { ...COUNTER_DEFAULTS } };
    case 'lm35':
      return { id, label, kind, placement, params: { ...LM35_DEFAULTS } };
    case 'lm317':
      return { id, label, kind, placement, params: { ...LM317_DEFAULTS } };
    case 'scr':
      return { id, label, kind, placement, params: { ...SCR_DEFAULTS } };
    case 'hbridge':
      return { id, label, kind, placement, params: { ...L293D_DEFAULTS } };
    case 'shiftreg':
      return { id, label, kind, placement, params: { ...HC595_DEFAULTS } };
    case 'opto':
      return { id, label, kind, placement, params: { ...PC817_DEFAULTS } };
    case 'sonar':
      return { id, label, kind, placement, params: { ...SONAR_DEFAULTS } };
    case 'transformer':
      return { id, label, kind, placement, params: { ...TRANSFORMER_DEFAULTS } };
    case 'servo':
      return { id, label, kind, placement, params: { ...SERVO_DEFAULTS } };
    case 'stepper':
      return { id, label, kind, placement, params: { ...STEPPER_DEFAULTS } };
    case 'motor':
      return { id, label, kind, placement, params: { ...MOTOR_DEFAULTS } };
    case 'relay':
      return { id, label, kind, placement, params: { coilResistance: 70, coilInductance: 0.1, vPick: 3.75, vDrop: 0.5, contactResistance: 0.1, contactRating: 10, baseResistance: 1000 } };
    case 'ntc':
      return { id, label, kind, placement, params: { ...NTC_DEFAULTS } };
    case 'comparator':
      return { id, label, kind, placement, params: { ...LM393_DEFAULTS } };
    case 'darlington':
      return { id, label, kind, placement, params: { ...TIP120_DEFAULTS } };
    case 'lm386':
      return { id, label, kind, placement, params: { ...LM386_DEFAULTS } };
    case 'speaker':
      return { id, label, kind, placement, params: { ...SPEAKER_DEFAULTS } };
    case 'ldr':
      return { id, label, kind, placement, params: { lux: 300, r10: 15000, gamma: 0.6, rdark: 1e6, maxPower: 0.1, span: 2 } };
    case 'pushbutton':
      return { id, label, kind, placement, params: { pressed: false, contactResistance: 0.1, maxCurrent: 0.05, maxVoltage: 24 } };
    case 'potentiometer':
      return { id, label, kind, placement, params: { resistance: 10000, position: 0.5, endResistance: 3, powerRating: 0.5 } };
    case 'led':
      return { id, label, kind, placement, params: ledParamsFor('red') };
    case 'switch':
      return { id, label, kind, placement, params: { closed: true, onResistance: 0.05 } };
    case 'diode':
      return { id, label, kind, placement, params: diodeParamsFor('1N4148') };
    case 'bjt':
      return { id, label, kind, placement, params: bjtParamsFor('npn') };
    case 'mosfet':
      return { id, label, kind, placement, params: mosfetParamsFor('2N7000') };
    case 'opamp':
      return { id, label, kind, placement, params: opampParamsFor('LM741') };
    case 'pico':
      return { id, label, kind, placement, params: { code: PICO_DEFAULT_CODE, autorun: true } };
    case 'fgen':
      return { id, label, kind, placement, params: { wave: 'sine', frequency: 1000, vpp: 2, offset: 0, outputImpedance: 50, outputOn: true } };
    case 'scope':
      return { id, label, kind, placement, params: { inputResistance: 1e6, timeDiv: 0.0002, vdiv1: 0.5, vdiv2: 0.5, ch1On: true, ch2On: true, trigSource: 'ch1', trigLevel: 0, trigSlope: 'rise', ...BODE_DEFAULTS } };
    case 'capacitor':
      return { id, label, kind, placement, params: { capacitance: 100e-6, ratedVoltage: 16, polarized: true, initialVoltage: 0, span: 2 } };
    case 'inductor':
      return { id, label, kind, placement, params: { inductance: 0.01, resistance: 1, ratedCurrent: 0.5, span: 3 } };
    case 'ammeter':
      return { id, label, kind, placement, params: { shuntResistance: 1, range: 0.2 } };
    case 'dmm':
      return { id, label, kind, placement, params: { ...DMM_DEFAULTS } };
    case 'vom':
      return { id, label, kind, placement, params: { ...VOM_DEFAULTS } };
  }
}

/** ค่ามาตรฐาน E12 สำหรับเลือกเร็ว */
/** พารามิเตอร์ไดโอดตามรุ่น (ประมาณจากแบบจำลอง SPICE ที่ใช้ทั่วไป ปรับให้ใช้กับแบบจำลองนี้) */
/** ค่าตั้งเริ่มต้นของกราฟโบด (เพิ่มใน schema 5 — ไฟล์เก่าได้ค่านี้ตอนเปิด) */
export const BODE_DEFAULTS = { bodeStart: 10, bodeStop: 100e3, bodePpd: 20, bodeRef: 'ch1' as const };

export function diodeParamsFor(model: DiodeModel): DiodePart['params'] {
  switch (model) {
    case '1N4148': return { model, Is: 2.52e-9, n: 1.752, Rs: 0.568, Bv: 100, Ibv: 1e-4, maxCurrent: 0.3, maxPower: 0.5, span: 4 };
    case '1N4007': return { model, Is: 7.03e-9, n: 1.808, Rs: 0.034, Bv: 1000, Ibv: 5e-6, maxCurrent: 1, maxPower: 3, span: 4 };
    case 'Z5V1': return { model, Is: 1e-14, n: 1, Rs: 2, Bv: 5.0, Ibv: 0.049, maxCurrent: 0.178, maxPower: 1, span: 4 };
  }
}

export const DIODE_NAMES: Record<DiodeModel, string> = {
  '1N4148': '1N4148 (สวิตชิ่ง สัญญาณเล็ก)',
  '1N4007': '1N4007 (เรียงกระแส 1 A)',
  'Z5V1': 'ซีเนอร์ 5.1 V (1N4733A)',
};

export function bjtParamsFor(polarity: 'npn' | 'pnp'): BjtPart['params'] {
  return polarity === 'npn'
    ? { model: '2N3904', polarity, Is: 6.734e-15, bf: 200, br: 0.737, maxIc: 0.2, maxVce: 40, maxPower: 0.625 }
    : { model: '2N3906', polarity, Is: 1.41e-15, bf: 180, br: 4.977, maxIc: 0.2, maxVce: 40, maxPower: 0.625 };
}

export const MOSFET_NAMES: Record<MosfetModel, string> = {
  '2N7000': '2N7000 ช่อง N (TO-92, 200 mA, 60 V)',
  'IRLZ44N': 'IRLZ44N ช่อง N ลอจิก (TO-220, 47 A, 55 V)',
  'IRF9540N': 'IRF9540N ช่อง P (TO-220, −23 A, −100 V)',
};

/**
 * ค่าพารามิเตอร์ประมาณจาก datasheet (ค่าทั่วไป) สำหรับแบบจำลองระดับ 1:
 *  - 2N7000 (onsemi): Vgs(th) 0.8–3 V (ทั่วไป 2.1), Rds(on) ≤ 5.3 Ω ที่ Vgs 4.5 V → KP ≈ 0.08 A/V², Pd 400 mW, Vsd ≈ 0.88 V ที่ 115 mA
 *  - IRLZ44N (Infineon): Vgs(th) 1–2 V, Rds(on) 22 mΩ ที่ Vgs 5 V → KP ≈ 14 A/V², ไม่มีฮีตซิงก์ RθJA 62 °C/W → ≈ 2.4 W
 *  - IRF9540N (Infineon): Vgs(th) −2…−4 V, Rds(on) 117 mΩ ที่ Vgs −10 V → KP ≈ 1.2 A/V², ไม่มีฮีตซิงก์ ≈ 2.4 W
 * แบบจำลองนี้ไม่มีความจุเกต/เวลาสวิตช์ — เหมาะกับการเรียนการใช้เป็นสวิตช์และการขับโหลด DC/PWM ช้า
 */
export function mosfetParamsFor(model: MosfetModel): MosfetPart['params'] {
  switch (model) {
    case '2N7000': return { model, polarity: 'n', vth: 2.1, kp: 0.08, lambda: 0.02, body: { Is: 1.6e-11, n: 1.5, Rs: 0.5 }, maxId: 0.2, maxVds: 60, maxVgs: 20, maxPower: 0.4 };
    case 'IRLZ44N': return { model, polarity: 'n', vth: 1.7, kp: 14, lambda: 0.01, body: { Is: 1e-9, n: 1.5, Rs: 0.02 }, maxId: 47, maxVds: 55, maxVgs: 16, maxPower: 2.4 };
    case 'IRF9540N': return { model, polarity: 'p', vth: 3.0, kp: 1.2, lambda: 0.01, body: { Is: 1e-9, n: 1.5, Rs: 0.03 }, maxId: 23, maxVds: 100, maxVgs: 20, maxPower: 2.4 };
  }
}

export function opampParamsFor(model: 'LM741' | 'MCP6002'): OpampPart['params'] {
  return model === 'LM741'
    ? { model, gain: 2e5, outputResistance: 75, headroom: 1.5, maxSupply: 36, inputResistance: 2e6, quiescentResistance: 14e3, gbw: 1e6, slewRate: 0.5e6 }
    : { model, gain: 1e5, outputResistance: 50, headroom: 0.025, maxSupply: 6, inputResistance: 1e9, quiescentResistance: 50e3, gbw: 1e6, slewRate: 0.6e6 };
}

/** ค่าความจุที่ใช้บ่อย */
export const C_QUICK = [1e-9, 10e-9, 100e-9, 1e-6, 10e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6];
export const L_QUICK = [100e-6, 1e-3, 10e-3, 100e-3, 1];

/** ขาของแต่ละส่วนของตัวแสดงผล 7 ส่วน (มาตรฐาน 0.56" 10 ขา: 5161AS/BS) */
export const SEG_PINS: Record<string, string> = { a: '7', b: '6', c: '4', d: '2', e: '1', f: '9', g: '10', dp: '5' };
export const SEG_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;

/** 5161AS/BS สีแดง 640 nm: Vf ≈ 2.1 V ที่ 20 mA, IF สูงสุด 20 mA, VR 5 V */
export function sevenSegParamsFor(common: 'cc' | 'ca') {
  const If = 0.02, n = 2, Rs = 5;
  const Vd = 2.1 - If * Rs;
  const Is = If / (Math.exp(Vd / (n * VT)) - 1);
  return { common, Is, n, Rs, ratedCurrent: 0.01, maxCurrent: 0.02, maxReverseVoltage: 5 };
}

/** แปลงชุดส่วนที่ติดเป็นตัวอักษร (0–9, A–F บางตัว, −) หรือ null ถ้าไม่ตรงรูปแบบ */
export function decodeSegments(on: Record<string, boolean>): string | null {
  const key = (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map((s) => (on[s] ? '1' : '0')).join('');
  const map: Record<string, string> = {
    '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3', '0110011': '4', '1011011': '5', '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9',
    '1110111': 'A', '0011111': 'b', '1001110': 'C', '0111101': 'd', '1001111': 'E', '1000111': 'F', '0000001': '−', '0000000': ' ',
  };
  return map[key] ?? null;
}

/** LM386N-1 (TI SNAS545): VS 4–12 V, กระแสนิ่ง 4 mA (สูงสุด 8 mA) ที่ 6 V, อัตราขยาย 26 dB (20) / 46 dB (200 เมื่อมี 10 µF ขา 1–8),
 *  แบนด์วิดท์ 300 kHz ที่อัตราขยาย 20, ขาเข้า 50 kΩ, กำลังขาออก 250–325 mW ที่ 6 V 8 Ω (THD 10%)
 *  Ra/Rb/Rf: แก้สมการ 1 + Rf/(Ra + Rb) = 20 และ 1 + Rf/Ra = 200 โดย Rb = 1.35 kΩ (ค่าในเอกสาร) · headroom 0.7 V ประมาณจากกำลัง 325 mW ที่ 6 V */
export const LM386_DEFAULTS = { model: 'LM386N-1' as const, rf: 28360, ra: 142.5, rb: 1350, rin: 50000, gbw: 6e6, headroom: 0.7, quiescentCurrent: 0.004, vMin: 4, vMax: 12 };
/** ลำโพง Ø 57 mm 8 Ω 0.5 W (ค่าทั่วไป) */
export const SPEAKER_DEFAULTS = { impedance: 8, maxPower: 0.5 };
/** TIP120 (onsemi TIP120/D): VCEO 60 V, IC 5 A (8 A ยอด), hFE ≥ 1000 ที่ 0.5 A และ 3 A (typ 2500 ที่ 4 A), VCE(sat) ≤ 2 V ที่ 3 A/12 mA,
 *  VBE(on) ≤ 2.5 V ที่ 3 A, PD 2 W (TA 25 °C) / 65 W (TC 25 °C), RθJA 62.5 °C/W, RθJC 1.92 °C/W, R ภายใน ≈ 8 kΩ และ 120 Ω
 *  is1/is2/bf1/bf2/rc/re: ค่าที่ปรับให้ VBE ≈ 1.2 V ที่ 0.1 A, ≈ 1.7 V ที่ 3 A และ VCE(sat) ≈ 1.3 V ที่ 3 A (อยู่ในค่าสูงสุดของเอกสาร — ประมาณ) */
export const TIP120_DEFAULTS = { model: 'TIP120' as const, bf1: 40, bf2: 80, is1: 1e-14, is2: 1e-13, r1: 8000, r2: 120, rc: 0.1, re: 0.05, maxIc: 5, maxVce: 60, heatsink: false };
/** ความต้านทานความร้อนรอยต่อ–อากาศ (°C/W): ตัวเปล่า 62.5 (เอกสาร), ติดแผ่นระบายความร้อน ≈ 1.92 + 1 + 10 */
export const tip120ThermalResistance = (heatsink: boolean) => (heatsink ? 13 : 62.5);
/** LM393 (ST Doc ID 2164): VCC 2–36 V, กระแสนิ่ง 0.4 mA (ทั้งสองช่อง ที่ 5 V), VOL 250 mV typ / 400 mV max ที่ 4 mA (→ Ron 62.5 Ω),
 *  กระแสขาออก ≥ 6 mA (typ 16 mA) ที่ VO = 1.5 V, ขาเข้า common mode 0 … VCC − 1.5 V, กระแสไบอัส 25 nA, เวลาตอบสนอง 1.3 µs (ไม่จำลอง) */
export const LM393_DEFAULTS = { model: 'LM393' as const, ron: 62.5, sinkMax: 0.016, quiescentCurrent: 0.0004, vMin: 2, vMax: 36 };
export const LM393_CHANNELS = [{ n: 'A', inp: 'INA+', inn: 'INA-', out: 'OUTA' }, { n: 'B', inp: 'INB+', inn: 'INB-', out: 'OUTB' }] as const;
/** MF52A103F3950: R25 10 kΩ ±1%, B25/50 3950 K, 50 mW, −55…125 °C, τ ≈ 7 s · δ ≈ 2 mW/°C (ค่าทั่วไปของ NTC หัวหยดอีพ็อกซี่ในอากาศนิ่ง — ประมาณ) */
export const NTC_DEFAULTS = { temperature: 25, r25: 10000, beta: 3950, dissipation: 0.002, maxPower: 0.05, span: 2 };
/** R(T) = R25·exp(B·(1/T − 1/T25)) */
export function ntcResistance(p: { temperature: number; r25: number; beta: number }): number {
  const T = p.temperature + 273.15;
  return p.r25 * Math.exp(p.beta * (1 / T - 1 / 298.15));
}
/** ย้อนกลับ: อุณหภูมิ (°C) จากความต้านทาน */
export function ntcTemperature(r: number, r25 = 10000, beta = 3950): number {
  return 1 / (1 / 298.15 + Math.log(r / r25) / beta) - 273.15;
}

/** ระดับแสงตัวอย่าง (lux) */
export const LUX_PRESETS: Array<[number, string]> = [[0, 'มืดสนิท'], [1, 'กลางคืน (มีแสงจันทร์)'], [10, 'ห้องมืด'], [100, 'ทางเดิน'], [300, 'ห้องเรียน'], [1000, 'ใกล้หน้าต่าง'], [10000, 'กลางแจ้ง (มีเมฆ)']];

/**
 * ความต้านทาน LDR: R_light = R10·(lux/10)^(−γ) ขนานกับ R_dark (ที่มืดสนิทได้ R_dark, ที่สว่างมากได้ R_light)
 */
export function ldrResistance(p: { lux: number; r10: number; gamma: number; rdark: number }): number {
  if (!(p.lux > 0)) return p.rdark;
  const rl = p.r10 * Math.pow(p.lux / 10, -p.gamma);
  return 1 / (1 / rl + 1 / p.rdark);
}

/**
 * บัซเซอร์ Ø12 mm
 *  - active: แบบ TMB12A05 (มีวงจรขับในตัว) 5 V, ≈ 30 mA, 2.4 kHz, ทำงาน 4–8 V
 *  - passive: แบบ CEM-1203(42) (ขดลวด 42 Ω ไม่มีวงจรขับ) 3.5 V, 35 mA, เรโซแนนซ์ 2.048 kHz
 */
export function buzzerParamsFor(type: 'active' | 'passive'): { type: 'active' | 'passive'; ratedVoltage: number; ratedCurrent: number; frequency: number; coilResistance: number } {
  return type === 'active'
    ? { type, ratedVoltage: 5, ratedCurrent: 0.03, frequency: 2400, coilResistance: 42 }
    : { type, ratedVoltage: 3.5, ratedCurrent: 0.035, frequency: 2048, coilResistance: 42 };
}

/** ค่ามาตรฐานของทริมพอต (รหัสบนตัว: 102, 502, 103, 503, 104) */
export const POT_VALUES = [1000, 2000, 5000, 10000, 50000, 100000];

export const E12_QUICK = [10, 47, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000];

const BAND_COLORS = ['#111111', '#7a4a1e', '#d42020', '#ff8a1c', '#f2d21b', '#2c9a3c', '#2156d8', '#8a3fc7', '#8c8c8c', '#f5f5f5'];
const GOLD = '#c9a43a';
const SILVER = '#bfc3c7';

/** แถบสี 4 แถบ (2 หลัก + ตัวคูณ + ค่าคลาดเคลื่อน 5% ทอง) */
export function resistorBands(ohms: number): string[] {
  if (!(ohms > 0) || !isFinite(ohms)) return [BAND_COLORS[0], BAND_COLORS[0], BAND_COLORS[0], GOLD];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let sig = Math.round(ohms / Math.pow(10, exp));
  if (sig >= 100) { sig = Math.round(sig / 10); exp += 1; }
  const d1 = Math.floor(sig / 10), d2 = sig % 10;
  let mult: string;
  if (exp >= 0 && exp <= 9) mult = BAND_COLORS[exp];
  else if (exp === -1) mult = GOLD;
  else if (exp === -2) mult = SILVER;
  else mult = BAND_COLORS[0];
  return [BAND_COLORS[d1] ?? BAND_COLORS[0], BAND_COLORS[d2], mult, GOLD];
}

/** NE555 (TI SLFS022): VOH 100 mA → VCC − 1.7 V, VOL 8 mA → 0.15 V, คายประจุ 8 mA → 0.15 V, กระแสเลี้ยง 3 mA ที่ 5 V, ไฟเลี้ยง 4.5–16 V, ขาออก ±200 mA */
export const TIMER555_DEFAULTS: Timer555Part['params'] = {
  model: 'NE555', outHighDrop: 1.2, outHighResistance: 5, outLowResistance: 15, dischargeResistance: 18,
  quiescentResistance: 1800, minSupply: 4.5, maxSupply: 16, maxOutputCurrent: 0.2,
};

/** ความถี่และ duty ของวงจร astable มาตรฐาน: f = 1.44 / ((RA + 2RB)·C), duty = (RA + RB) / (RA + 2RB) */
export function astable555(ra: number, rb: number, c: number) {
  const f = 1.44 / ((ra + 2 * rb) * c);
  return { f, duty: (ra + rb) / (ra + 2 * rb), tHigh: 0.693 * (ra + rb) * c, tLow: 0.693 * rb * c };
}

/** ไอซีคงแรงดัน 78xx (ST L78, TO-220): dropout 2 V ที่ 1 A, กระแสนิ่ง ≈ 5 mA (สูงสุด 8 mA), ขาเข้าสูงสุด 35 V, ใช้งาน 1.5 A, load regulation ≤ 100 mV (5 mA–1.5 A) */
export function vregParamsFor(model: VregModel, heatsink = false): VregPart['params'] {
  const vout = model === 'L7805' ? 5 : model === 'L7809' ? 9 : 12;
  return { model, vout, dropout: 2, quiescentCurrent: 0.005, rOut: 0.02, maxInput: 35, maxLoad: 1.5, heatsink };
}
export const VREG_MODELS: VregModel[] = ['L7805', 'L7809', 'L7812'];
/** ความต้านทานความร้อนรอยต่อ–อากาศ (°C/W): TO-220 เปล่า 50 (เอกสาร), ติดแผ่นระบายความร้อนขนาดเล็ก ≈ 5 (รอยต่อ–ตัวถัง) + 1 + 10 */
export const vregThermalResistance = (heatsink: boolean) => (heatsink ? 16 : 50);

/** หม้อแปลง 12-0-12 V 1 A: regulation 16% (ค่าทั่วไปของหม้อแปลงเล็ก — เอกสาร VTX-146-015-112 2 × 12 V 15 VA ระบุ 16%) */
export const TRANSFORMER_DEFAULTS = { vRated: 12, iRated: 1, regulation: 0.16, frequency: 50, on: true };
/** ค่าแบบจำลองต่อครึ่งขด: แรงดันขณะไม่มีโหลด (V rms) และความต้านทานขดลวดสมมูล (Ω) ที่ทำให้แรงดันตกเหลือพิกัดที่กระแสพิกัด */
export function transformerModel(p: { vRated: number; iRated: number; regulation: number }) {
  const vnl = p.vRated * (1 + p.regulation);
  return { vnl, vpk: vnl * Math.SQRT2, rw: (vnl - p.vRated) / p.iRated };
}

/**
 * 28BYJ-48 5 V (เอกสารผู้ผลิต): 4 เฟส, เกียร์ 1/64, มุมสเต็ป 5.625°/64, ความต้านทานขด 50 Ω ±7%, idle in-traction > 600 Hz,
 * idle out-traction > 1000 Hz, แรงบิด > 34.3 mN·m · ULN2003 (TI): ดาร์ลิงตัน 2.7 kΩ ที่ขาเข้า, 7.2 kΩ/3 kΩ ภายใน,
 * VCE(sat) ≈ 0.9 V ที่ 100 mA, ไดโอดกันย้อนไปขา COM · บอร์ดขับทั่วไป: LED A–D + 1 kΩ ต่อคร่อมแต่ละขดลวด
 */
export const STEPPER_DEFAULTS = { model: '28BYJ-48' as const, coilResistance: 50, stepsPerRev: 4096, pullIn: 600, pullOut: 1000, minCoilCurrent: 0.06, vRated: 5 };
export const STEPPER_INPUTS = ['IN1', 'IN2', 'IN3', 'IN4'] as const;
/** สีสายขดลวดตามลำดับ IN1–IN4 (สายแดง = ร่วม +5 V) */
export const STEPPER_WIRES = ['สีน้ำเงิน', 'สีชมพู', 'สีเหลือง', 'สีส้ม'];
/** ลำดับฮาล์ฟสเต็ป: เฟสที่มีไฟ (บิต 0 = IN1) → ตำแหน่งสนามแม่เหล็ก 0–7 */
export const STEPPER_HALF_SEQ = [0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001];
export const stepperIndexOf = (mask: number) => STEPPER_HALF_SEQ.indexOf(mask);

/** SG90 (TowerPro): 4.8 V, 0.1 s/60°, dead band 10 µs, พัลส์ 500–2400 µs คาบ 20 ms; กระแสนิ่ง ≈ 6 mA (ค่าวัดทั่วไป) */
export const SERVO_DEFAULTS = { pulseMin: 0.0005, pulseMax: 0.0024, speed: 600, vMin: 4.0, vMax: 6.0, idleCurrent: 0.006 };
export const SERVO_DEADBAND = 10e-6;
/** มุมเป้าหมาย (องศา 0–180) จากความกว้างพัลส์ */
export function servoAngleFor(p: { pulseMin: number; pulseMax: number }, pw: number) {
  return Math.max(0, Math.min(180, ((pw - p.pulseMin) / (p.pulseMax - p.pulseMin)) * 180));
}

/**
 * มอเตอร์เกียร์ TT 1:48 — ค่าที่ fit จากค่าวัดของ Adafruit #3777: ไม่มีโหลด 6 V 250 rpm 0.16 A, 3 V 120 rpm 0.15 A, หยุดค้าง 6 V 1.5 A
 * R ≈ 3.5 Ω (หยุดค้าง 3 V วัดได้ 1.1 A — ต่างไปเพราะแปรงถ่าน), ke จาก E = V − I·R ที่ไม่มีโหลด, แรงเสียดทานจากกระแสไม่มีโหลด
 * L, ความเฉื่อย และประสิทธิภาพเฟือง (0.4 ให้แรงบิดหยุดค้าง ≈ 0.8 kg·cm ที่ 6 V ตามสเปก) เป็นค่าประมาณ
 */
export const MOTOR_DEFAULTS = { gearRatio: 48, ke: 4.33e-3, resistance: 3.5, inductance: 1e-3, inertia: 2.1e-7, noLoadCurrent: 0.145, viscous: 5.2e-8, gearEff: 0.4, loadTorque: 0 };
/** rad/s ที่แกนมอเตอร์ → rpm ที่แกนออก (หลังเฟือง) */
export const motorRpm = (w: number, ratio: number) => (w * 60) / (2 * Math.PI) / ratio;

/**
 * HC-SR04 (เอกสารโมดูล Elecfreaks/Cytron): ไฟ 5 V 15 mA, 40 kHz, วัด 2–400 cm ความละเอียด ≈ 0.3 cm, มุม 15°,
 * TRIG พัลส์สูง ≥ 10 µs → ส่งคลื่น 8 ลูก แล้ว ECHO สูงนาน = เวลาเสียงไป-กลับ (ระยะ = เวลา × ความเร็วเสียง / 2),
 * ไม่พบวัตถุ: ECHO สูง ≈ 38 ms · แนะนำวัดห่างกัน ≥ 60 ms
 * เวลาหน่วงจากขอบลงของ TRIG ถึงขอบขึ้นของ ECHO (≈ 0.45 ms) ไม่มีในเอกสาร — เป็นค่าประมาณจากการวัดโมดูลทั่วไป
 */
export const SONAR_DEFAULTS = { model: 'HC-SR04' as const, distance: 20, temperature: 25, vMin: 4.5, vMax: 5.5 };
export const SONAR_DELAY = 0.45e-3;
export const SONAR_NO_ECHO = 0.038;
export const SONAR_MAX_CM = 400;
export const soundSpeed = (tC: number) => 331.3 + 0.606 * tC;
/** ความกว้างพัลส์ ECHO (s) สำหรับระยะ (cm) */
export function sonarEchoWidth(cm: number, tC: number): number {
  if (cm > SONAR_MAX_CM) return SONAR_NO_ECHO;
  return (2 * Math.max(2, cm) / 100) / soundSpeed(tC);
}
export const DIST_PRESETS: Array<[number, string]> = [[5, '5 cm'], [10, '10 cm'], [20, '20 cm'], [50, '50 cm'], [100, '1 m'], [500, 'ไม่มีวัตถุ']];

/**
 * PC817 (ดาต้าชีต PC817 "Semiconductor technical data" และ Sharp PC817): IF ≤ 50 mA, VR ≤ 6 V, IC ≤ 50 mA, VCEO 80 V (บางผู้ผลิต 35 V),
 * VF 1.2 V ทั่วไป / 1.4 V สูงสุดที่ 20 mA, CTR ที่ IF 5 mA VCE 5 V: A 80–160%, B 130–260%, C 200–400%, D 300–600%,
 * VCE(sat) 0.1 V ทั่วไป / 0.2 V สูงสุดที่ IF 20 mA IC 1 mA, tr/tf 4/3 µs, ฉนวนระหว่างสองฝั่ง 5000 Vrms
 * แบบจำลอง: ไดโอด Is 3e-13 A n 1.8 Rs 2 Ω (VF 1.20 V ที่ 20 mA, 1.11 V ที่ 5 mA) · CTR ค่ากลางของกลุ่ม (เรขาคณิต)
 */
export const PC817_CTR: Record<OptoRank, [number, number]> = { A: [0.8, 1.6], B: [1.3, 2.6], C: [2, 4], D: [3, 6] };
export const pc817TypCtr = (r: OptoRank) => +Math.sqrt(PC817_CTR[r][0] * PC817_CTR[r][1]).toFixed(2);
export const PC817_DEFAULTS = { model: 'PC817' as const, rank: 'C' as OptoRank, ctr: pc817TypCtr('C'), Is: 3e-13, n: 1.8, Rs: 2, maxForwardCurrent: 0.05, maxReverseVoltage: 6, maxCollectorCurrent: 0.05, vceo: 80 };
/** ผังขา PC817 (DIP-4) */
export const PC817_PINOUT = ['A', 'K', 'E', 'C'];
const PC817_LABEL: Record<string, string> = { A: 'แอโนด LED (+ ขาเข้า)', K: 'แคโทด LED (− ขาเข้า)', E: 'อิมิตเตอร์ (ขาออก)', C: 'คอลเลกเตอร์ (ขาออก)' };

/**
 * 74HC595 (ดาต้าชีต TI SCLS041 SN74HC595): VCC 2–6 V, VIH 1.5 / 3.15 / 4.2 V ที่ VCC 2 / 4.5 / 6 V (≈ 0.7 VCC),
 * VOH ≥ 3.98 V (ทั่วไป 4.3 V) ที่ −6 mA และ VCC 4.5 V, กระแสต่อขาออก ±35 mA และขา VCC/GND รวม ±70 mA (absolute maximum)
 * แบบจำลองขาออก: MOSFET kp 8 mA/V², vth 0.9 V → ตก ≈ 0.2 V ที่ 6 mA (VCC 4.5 V)
 */
export const HC595_DEFAULTS = { model: '74HC595' as const, kp: 8e-3, vth: 0.9, lambda: 0.02, vMin: 2, vMax: 6, maxOutputCurrent: 0.035, maxSupplyCurrent: 0.07 };
/** ผังขา 74HC595 (DIP-16) — QH2 คือ QH′ (ขาออกอนุกรมสำหรับต่อพ่วงตัวถัดไป) */
export const HC595_PINOUT = ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', 'QH2', 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'];
export const HC595_OUTS = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];
const HC595_LABEL: Record<string, string> = {
  ...Object.fromEntries(HC595_OUTS.map((q, k) => [q, `${q} ขาออกบิต ${k}${k === 0 ? ' (บิตที่เลื่อนเข้าล่าสุด)' : ''}`])),
  GND: 'GND กราวด์', VCC: 'VCC ไฟเลี้ยง 2–6 V', QH2: "QH′ ขาออกอนุกรม (ต่อ SER ของตัวถัดไป)",
  SRCLR: 'SRCLR ล้างรีจิสเตอร์เลื่อน (ต่ำ = ล้าง, ปกติต่อ VCC)', SRCLK: 'SRCLK สัญญาณเลื่อนบิต (ขอบขาขึ้น)',
  RCLK: 'RCLK โอนข้อมูลไปขาออก (ขอบขาขึ้น — latch)', OE: 'OE เปิดขาออก (ต่ำ = ทำงาน, ปกติต่อ GND)', SER: 'SER ข้อมูลอนุกรมขาเข้า',
};

/**
 * L293D (ดาต้าชีต TI SLRS008): VCC1 4.5–7 V, VCC2 = VCC1–36 V, VIH ≥ 2.3 V / VIL ≤ 1.5 V (ขับจาก 3.3 V ได้),
 * 600 mA ต่อเนื่อง / 1.2 A ยอดต่อช่อง, VOH = VCC2 − 1.4 V และ VOL = 1.2 V (ทั่วไป ที่ 0.6 A), ไดโอดกันย้อน 1.3 V ที่ 0.6 A
 */
export const L293D_DEFAULTS = { model: 'L293D' as const, maxOutputCurrent: 0.6, peakOutputCurrent: 1.2, vMin: 4.5, vMax: 7, vMotorMax: 36 };
export const L293D_PINOUT = ['EN12', '1A', '1Y', 'GND', 'GND.5', '2Y', '2A', 'VCC2', 'EN34', '3A', '3Y', 'GND.12', 'GND.13', '4Y', '4A', 'VCC1'];
/** ช่องขับ 1–4: ขาเข้า, ขาออก, ขาเปิดใช้งาน */
export const L293D_CHANNELS = [1, 2, 3, 4].map((n) => ({ n, a: `${n}A`, y: `${n}Y`, en: n <= 2 ? 'EN12' : 'EN34' }));
const L293D_LABEL: Record<string, string> = {
  EN12: '1,2EN เปิดใช้ช่อง 1–2 (สูง = ทำงาน, ใช้ PWM ปรับความเร็ว)', EN34: '3,4EN เปิดใช้ช่อง 3–4',
  '1A': '1A ขาเข้าช่อง 1', '2A': '2A ขาเข้าช่อง 2', '3A': '3A ขาเข้าช่อง 3', '4A': '4A ขาเข้าช่อง 4',
  '1Y': '1Y ขาออกช่อง 1 (ต่อมอเตอร์)', '2Y': '2Y ขาออกช่อง 2 (ต่อมอเตอร์)', '3Y': '3Y ขาออกช่อง 3', '4Y': '4Y ขาออกช่อง 4',
  GND: 'GND (และระบายความร้อน)', 'GND.5': 'GND', 'GND.12': 'GND', 'GND.13': 'GND',
  VCC1: 'VCC1 ไฟเลี้ยงวงจรตรรกะ 5 V', VCC2: 'VCC2 ไฟเลี้ยงมอเตอร์ 4.5–36 V',
};

/**
 * LM35 (ดาต้าชีต TI SNIS159): 10 mV/°C, ไฟเลี้ยง 4–30 V, กระแสนิ่ง 56 µA, ขาออกสูงสุด 10 mA, ความต้านทานขาออก 0.1–0.5 Ω
 * รุ่น D: ใช้งาน 0–100 °C ความแม่นยำ ±0.6 °C ทั่วไปที่ 25 °C · วงจรพื้นฐาน (ไฟเลี้ยงเดียว) วัดได้ 2–150 °C
 */
export const LM35_DEFAULTS = { model: 'LM35DZ' as const, temperature: 25, quiescentCurrent: 56e-6, rOut: 0.5, vMin: 4, vMax: 30, maxOutputCurrent: 0.01 };
export const TEMP_PRESETS: Array<[number, string]> = [[0, 'น้ำแข็ง'], [25, 'ห้องปรับอากาศ'], [32, 'ห้องทั่วไป'], [37, 'ร่างกาย'], [60, 'น้ำร้อน'], [100, 'น้ำเดือด']];
/** แรงดันขาออกตามอุดมคติ (วงจรพื้นฐาน ไฟเลี้ยงเดียว: ต่ำกว่า 0 °C ขาออกไปไม่ถึงค่าลบ) */
export const lm35Vout = (t: number) => 0.01 * Math.max(0, t);

/**
 * CD4017B (ดาต้าชีต CD4017B/CD4022B, TI SCHS027 และ HGSemi): ไฟเลี้ยง 3–18 V, กระแสขาเข้า/ขาออก ±10 mA สูงสุด
 * ขาออกแบบจำลองเป็น MOSFET ระดับ 1 (ช่อง P ขึ้น VDD / ช่อง N ลง VSS) ให้กระแสอิ่มตัวตาม VDD:
 *  KP 0.52 mA/V², Vth 1.5 V → VDD 5 V: 0.69 mA ที่ตกคร่อม 0.4 V (ดาต้าชีตทั่วไป 1 mA, ต่ำสุด 0.51), 3.2 mA ที่ VO 2.5 V (ทั่วไป 3.2 mA)
 *                              VDD 10 V: 2.2 mA ที่ตกคร่อม 0.5 V (ทั่วไป 2.6 mA)
 */
export const COUNTER_DEFAULTS = { model: 'CD4017B' as const, kp: 0.52e-3, vth: 1.5, lambda: 0.02, vMin: 3, vMax: 18, maxOutputCurrent: 0.01 };
/** ผังขา CD4017B (DIP-16) */
export const CD4017_PINOUT = ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'INH', 'CLK', 'RST', 'VDD'];
export const CD4017_OUTS = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];
const CD4017_LABEL: Record<string, string> = {
  ...Object.fromEntries(CD4017_OUTS.map((q) => [q, `${q} ขาออก (สูงเมื่อนับได้ ${q.slice(1)})`])),
  VSS: 'VSS กราวด์', VDD: 'VDD ไฟเลี้ยง 3–18 V', CO: 'CO — CARRY OUT (สูงเมื่อนับ 0–4) ต่อไอซีตัวถัดไป',
  INH: 'CLK INH — CLOCK INHIBIT (สูง = หยุดนับ) ปกติต่อ VSS', CLK: 'CLK — CLOCK สัญญาณนับ (นับที่ขอบขาขึ้น)', RST: 'RESET (สูง = กลับไป Q0) ปกติต่อ VSS',
};

/** ไอซีเกต 74HC (เอกสาร TI SN74HC00/08/32/86/02/04): ไฟเลี้ยง 2–6 V, VOH ≥ 4.68 V ที่ −4 mA (VCC 4.5 V ≈ 50 Ω), ขาออก ±25 mA สูงสุด */
export const LOGIC_DEFAULTS = { outputResistance: 50, vMin: 2, vMax: 6, maxOutputCurrent: 0.025 };
export const LOGIC_MODELS: LogicModel[] = ['74HC00', '74HC02', '74HC04', '74HC08', '74HC32', '74HC86'];
export const LOGIC_FUNC: Record<LogicModel, { name: string; th: string; inputs: 1 | 2; f: (a: boolean, b: boolean) => boolean; symbol: string }> = {
  '74HC00': { name: 'NAND', th: 'แนนด์', inputs: 2, f: (a, b) => !(a && b), symbol: 'Y = (A·B)\'' },
  '74HC02': { name: 'NOR', th: 'นอร์', inputs: 2, f: (a, b) => !(a || b), symbol: 'Y = (A+B)\'' },
  '74HC04': { name: 'NOT', th: 'น็อต (อินเวอร์เตอร์)', inputs: 1, f: (a) => !a, symbol: 'Y = A\'' },
  '74HC08': { name: 'AND', th: 'แอนด์', inputs: 2, f: (a, b) => a && b, symbol: 'Y = A·B' },
  '74HC32': { name: 'OR', th: 'ออร์', inputs: 2, f: (a, b) => a || b, symbol: 'Y = A+B' },
  '74HC86': { name: 'XOR', th: 'เอกซ์คลูซีฟออร์', inputs: 2, f: (a, b) => a !== b, symbol: 'Y = A⊕B' },
};
const QUAD = ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
/** ผังขา DIP-14 ตามเอกสาร TI: 00/08/32/86 แบบเดียวกัน, 02 ขาออกอยู่ก่อนขาเข้า, 04 อินเวอร์เตอร์ 6 ตัว */
export const LOGIC_PINOUT: Record<LogicModel, string[]> = {
  '74HC00': QUAD, '74HC08': QUAD, '74HC32': QUAD, '74HC86': QUAD,
  '74HC02': ['1Y', '1A', '1B', '2Y', '2A', '2B', 'GND', '3A', '3B', '3Y', '4A', '4B', '4Y', 'VCC'],
  '74HC04': ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'],
};
/** เกตแต่ละตัวในไอซี: [ขาเข้า..., ขาออก] */
export function logicGates(model: LogicModel): Array<{ n: number; inputs: string[]; out: string }> {
  const k = LOGIC_FUNC[model].inputs === 1 ? 6 : 4;
  return Array.from({ length: k }, (_, i) => ({ n: i + 1, inputs: LOGIC_FUNC[model].inputs === 1 ? [`${i + 1}A`] : [`${i + 1}A`, `${i + 1}B`], out: `${i + 1}Y` }));
}
function logicPinLabel(model: LogicModel, nm: string) {
  if (nm === 'GND') return 'GND (กราวด์)';
  if (nm === 'VCC') return 'VCC ไฟเลี้ยง 2–6 V';
  const g = nm[0], io = nm.slice(1);
  return `${nm} — เกต ${LOGIC_FUNC[model].name} ตัวที่ ${g} ${io === 'Y' ? 'ขาออก' : `ขาเข้า ${io}`}`;
}

/* ---------------- มัลติมิเตอร์ ---------------- */

/**
 * มัลติมิเตอร์ดิจิทัล (อ้างอิงสเปกรุ่นมือถือ 4000 count ทั่วไป: DCV 400 mV–1000 V ขาเข้า > 10 MΩ, ย่าน mV 1 MΩ,
 * DCA 400 µA–400 mA และ 10 A, Ω 400 Ω–40 MΩ) · ค่า shunt ฟิวส์ และแหล่งทดสอบย่าน Ω เป็นค่าประมาณของเครื่องระดับนี้ (ดาต้าชีตไม่ระบุ)
 */
export const DMM_DEFAULTS = { mode: 'dcv' as const, inputResistance: 10e6, mvInputResistance: 1e6, shuntA: 0.01, shuntMa: 1, fuseA: 11, fuseMa: 0.44, ohmVoc: 1.2, ohmRs: 1000 };
export const DMM_COUNTS = 4000;
export const DMM_MODES: Array<{ id: 'off' | 'acv' | 'dcv' | 'mv' | 'ohm' | 'dca' | 'dcma'; label: string; dial: string; angle: number }> = [
  { id: 'off', label: 'ปิด (OFF)', dial: 'OFF', angle: -90 },
  { id: 'acv', label: 'แรงดันไฟสลับ V~', dial: 'V~', angle: -60 },
  { id: 'dcv', label: 'แรงดันไฟตรง V⎓', dial: 'V⎓', angle: -30 },
  { id: 'mv', label: 'แรงดันต่ำ mV⎓', dial: 'mV', angle: 0 },
  { id: 'ohm', label: 'ความต้านทาน Ω', dial: 'Ω', angle: 30 },
  { id: 'dca', label: 'กระแสสูง A⎓ (ขั้ว 10 A)', dial: 'A⎓', angle: 60 },
  { id: 'dcma', label: 'กระแสต่ำ mA⎓ (ขั้ว mA µA)', dial: 'mA⎓', angle: 90 },
];

/** ย่านอัตโนมัติ (ค่าเต็มย่าน) ของมัลติมิเตอร์ดิจิทัลตามโหมด */
export const DMM_RANGES: Record<string, number[]> = {
  dcv: [4, 40, 400, 1000], acv: [4, 40, 400, 1000], mv: [0.4], ohm: [400, 4e3, 40e3, 400e3, 4e6, 40e6],
  dcma: [400e-6, 4e-3, 40e-3, 400e-3], dca: [4, 10],
};

/**
 * มัลติมิเตอร์แบบเข็ม (อ้างอิงสเปกรุ่นเข็มทั่วไป 20 kΩ/V: DCV 0.1/0.25/2.5/10/50/250/1000 V (250/1000 V ที่ 9 kΩ/V),
 * ACV 10/50/250/750 V ที่ 9 kΩ/V, DCA 50 µA/2.5 mA/25 mA/0.25 A, Ω ×1/×10/×100/×1k, แบตเตอรี่ 3 V, ฟิวส์ 0.5 A)
 * ค่ากลางสเกล Ω (20 Ω ที่ ×1) และแรงดันตกย่านกระแส (0.1 V ที่ 50 µA, 0.25 V ย่านอื่น) เป็นค่าประมาณ
 */
export const VOM_DEFAULTS = { sel: 'dcv10', sensitivityDC: 20000, sensitivityAC: 9000, battery: 3, centerOhm: 20, fuse: 0.5 };
export interface VomPosition { id: string; mode: 'off' | 'dcv' | 'acv' | 'dca' | 'ohm'; full: number; label: string; dial: string; angle: number }
const vp = (id: string, mode: VomPosition['mode'], full: number, label: string, dial: string): Omit<VomPosition, 'angle'> => ({ id, mode, full, label, dial });
/** ตำแหน่งสวิตช์ย่านเรียงตามเข็มนาฬิกาจากด้านบน (ห่างกัน 18°) */
export const VOM_POSITIONS: VomPosition[] = [
  vp('off', 'off', 0, 'ปิด (OFF)', 'OFF'),
  vp('dcv0.1', 'dcv', 0.1, 'DCV 0.1 V', '0.1'), vp('dcv0.25', 'dcv', 0.25, 'DCV 0.25 V', '0.25'), vp('dcv2.5', 'dcv', 2.5, 'DCV 2.5 V', '2.5'),
  vp('dcv10', 'dcv', 10, 'DCV 10 V', '10'), vp('dcv50', 'dcv', 50, 'DCV 50 V', '50'), vp('dcv250', 'dcv', 250, 'DCV 250 V', '250'), vp('dcv1000', 'dcv', 1000, 'DCV 1000 V', '1000'),
  vp('acv750', 'acv', 750, 'ACV 750 V', '750'), vp('acv250', 'acv', 250, 'ACV 250 V', '250'), vp('acv50', 'acv', 50, 'ACV 50 V', '50'), vp('acv10', 'acv', 10, 'ACV 10 V', '10'),
  vp('dca0.25', 'dca', 0.25, 'DCA 0.25 A', '0.25'), vp('dca25m', 'dca', 25e-3, 'DCA 25 mA', '25m'), vp('dca2.5m', 'dca', 2.5e-3, 'DCA 2.5 mA', '2.5m'), vp('dca50u', 'dca', 50e-6, 'DCA 50 µA', '50µ'),
  vp('ohm1k', 'ohm', 1000, 'Ω ×1k', '×1k'), vp('ohm100', 'ohm', 100, 'Ω ×100', '×100'), vp('ohm10', 'ohm', 10, 'Ω ×10', '×10'), vp('ohm1', 'ohm', 1, 'Ω ×1', '×1'),
].map((x, i) => ({ ...x, angle: i * 18 }));
export const vomPosition = (sel: string): VomPosition => VOM_POSITIONS.find((p) => p.id === sel) ?? VOM_POSITIONS[0];

/** ความต้านทานภายในของมัลติมิเตอร์แบบเข็มที่ตำแหน่งสวิตช์นี้ (ย่าน V และ A) */
export function vomInternalR(p: { sensitivityDC: number; sensitivityAC: number }, pos: VomPosition): number {
  if (pos.mode === 'dcv') return (pos.full >= 250 ? p.sensitivityAC : p.sensitivityDC) * pos.full;
  if (pos.mode === 'acv') return p.sensitivityAC * pos.full;
  if (pos.mode === 'dca') return (pos.full <= 50e-6 ? 0.1 : 0.25) / pos.full;
  return 1e9;
}

/** ค่าที่สเกล Ω อ่านได้ ณ สัดส่วนการตีเข็ม f (1 = เต็มสเกล = 0 Ω) */
export const vomOhmAt = (f: number, center: number) => (f <= 0 ? Infinity : center * (1 / f - 1));

/* ---------------- ไทริสเตอร์ SCR ---------------- */

/**
 * 2N5060 (onsemi 2N5060 series): IGT ≤ 200 µA, VGT ≤ 0.8 V, IH ≤ 5 mA (VAK 7 V), VTM ≤ 1.7 V ที่ 1.2 A, IT(RMS) 0.8 A, VDRM 30 V
 * ใช้ค่าสูงสุดของดาต้าชีตเป็นเกณฑ์ (ออกแบบวงจรตามค่าสูงสุด = ตัวจริงทุกตัวติดได้) — ตัวจริงส่วนใหญ่ไวกว่านี้
 * ไดโอดขาเกต: VGK ≈ 0.74 V ที่ 200 µA · ทาง A–K ขณะติด: ≈ 0.9 V ที่ 10 mA, ≈ 1.45 V ที่ 1.2 A (≤ VTM 1.7 V)
 */
/** LM317 (TI SLVS044): VREF 1.25 V (1.2–1.3), IADJ 50 µA (สูงสุด 100), กระแสโหลดต่ำสุด 3.5 mA (สูงสุด 10 mA), IN − OUT 3–40 V, 1.5 A
 *  dropout ≈ 1.7 V (อ่านจากกราฟ dropout ในเอกสาร ช่วงกระแสปานกลาง — ค่าประมาณ) */
export const LM317_DEFAULTS = { model: 'LM317' as const, vref: 1.25, iadj: 50e-6, minLoad: 3.5e-3, dropout: 1.7, maxDiff: 40, maxLoad: 1.5, heatsink: false };
/** ทฤษฎี VOUT = VREF·(1 + R2/R1) + IADJ·R2 */
export const lm317Vout = (r1: number, r2: number, vref = 1.25, iadj = 50e-6) => vref * (1 + r2 / r1) + iadj * r2;
export const SCR_DEFAULTS = { model: '2N5060' as const, igt: 200e-6, ih: 5e-3, vdrm: 30, maxCurrent: 0.8 };
export const SCR_GATE_DIODE = { Is: 1e-14, n: 1.2, Rs: 10 };
export const SCR_ON_DIODE = { Is: 1e-12, n: 1.5, Rs: 0.3 };
