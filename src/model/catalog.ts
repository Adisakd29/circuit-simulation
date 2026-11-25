import { isPico } from './types';
import { isSensor, isSensorKind, makeSensorPart, SENSOR_CATALOG, sensorPinDefs } from './sensors';
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
  /** ขาด้านบนตัวบอร์ด (รูภายใน/หัวต่อที่ไม่ได้เสียบลงเบรดบอร์ด เช่น A4–A7 ของ Pro Mini) — ต่อได้ด้วยสายที่ขาเท่านั้น dx/dy อาจไม่ใช่จำนวนเต็ม */
  top?: boolean;
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
    kind: 'ssd1306', name: 'จอ OLED 0.96" 128×64 (I²C, SSD1306)', nameEn: 'OLED display 0.96" 128×64, SSD1306, I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'DSP', keywords: ['oled', 'ssd1306', 'display', 'จอ', 'i2c', 'smart watch', 'นาฬิกา', '128x64'],
    description: 'จอ OLED สีขาว 128 × 64 จุด ไอซี SSD1306 แบบ I²C 4 ขา: GND, VCC (3.3–5 V), SCL, SDA · ที่อยู่ 0x3C · มีตัวต้านทานดึงขึ้นและปั๊มประจุบนโมดูล · ภาพบนจอมาจากคำสั่งที่ส่งผ่านบัส I²C เท่านั้น (ใช้ไดรเวอร์ ssd1306.py ของ MicroPython)',
  },
  {
    kind: 'ds3231', name: 'โมดูลนาฬิกา RTC DS3231 (I²C)', nameEn: 'Real-time clock module DS3231 (ZS-042), I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'RTC', keywords: ['rtc', 'ds3231', 'clock', 'นาฬิกา', 'เวลา', 'i2c', 'zs-042', 'smart watch'],
    description: 'โมดูล ZS-042: 32K, SQW, SCL, SDA, VCC (2.3–5.5 V), GND · DS3231 ที่อยู่ 0x68 (เวลาแบบ BCD ในรีจิสเตอร์ 0x00–0x06, อุณหภูมิ 0x11–0x12) + EEPROM AT24C32 ที่ 0x57 · ตั้งเวลาเริ่มต้นได้ในแผงคุณสมบัติ (เหมือนมีแบตสำรองเลี้ยงอยู่)',
  },
  {
    kind: 'mpu6050', name: 'เซนเซอร์ความเร่ง/ไจโร MPU6050 (GY-521)', nameEn: 'Accelerometer + gyroscope MPU6050 (GY-521), I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['mpu6050', 'gy-521', 'imu', 'accelerometer', 'gyro', 'ความเร่ง', 'นับก้าว', 'step', 'i2c', 'smart watch'],
    description: 'โมดูล GY-521: VCC (3–5 V), GND, SCL, SDA, XDA, XCL, AD0, INT · ที่อยู่ 0x68 (AD0 ต่ำ) หรือ 0x69 (ต่อ AD0 กับ 3V3) · หลังจ่ายไฟชิปอยู่ในโหมดหลับ ต้องเขียน 0 ที่รีจิสเตอร์ 0x6B ก่อน · ตั้งการเคลื่อนไหว (นิ่ง/เดิน/เขย่า) ในแผงคุณสมบัติ',
  },
  {
    kind: 'vibmotor', name: 'มอเตอร์สั่นแบบเหรียญ 3 V', nameEn: 'Coin vibration motor 10 × 2.7 mm, 3 V', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'M', keywords: ['vibration', 'vibrate', 'motor', 'มอเตอร์สั่น', 'สั่น', 'haptic', 'erm', 'smart watch'],
    description: 'มอเตอร์สั่น ERM Ø10 × 2.7 mm 3 V (ใช้ได้ 1.5–4.2 V) ≈ 50 mA 11,000 rpm · สายแดง (+) สายน้ำเงิน (−) · กระแสเกินขา GPIO — ขับผ่านทรานซิสเตอร์ + ไดโอดกันย้อน',
  },
  {
    kind: 'esp32s2', name: 'ESP32-S2-DevKitM-1 (เฉพาะโมเดล)', nameEn: 'ESP32-S2-DevKitM-1 — 3D model and pinout only', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['esp32', 'esp32-s2', 's2', 'devkitm', 'wifi', 'smart watch', 'บอร์ด'],
    description: 'ยังไม่รองรับการรันโค้ด — แสดงโมเดลและขาตามเอกสาร Espressif เท่านั้น (ยังไม่มีตัวจำลอง ESP32-S2 ที่ใช้ได้) · ขาทุกขาไม่มีไฟและไม่ทำงาน · บอร์ด 25.4 × 54 mm แถวขาห่าง 0.9" (ลงรู c และ j)',
  },
  {
    kind: 'gc9a01', name: 'จอกลม 1.28" GC9A01 + ทัชสกรีน (SPI + I²C)', nameEn: 'Round 1.28" 240×240 IPS LCD (GC9A01, SPI) with CST816S touch (I²C)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'LCD', keywords: ['gc9a01', 'cst816s', 'round', 'จอกลม', 'tft', 'lcd', 'ips', 'touch', 'ทัช', 'สัมผัส', 'spi', 'smart watch', 'นาฬิกา', '240x240', '1.28'],
    description: 'จอสี IPS กลม Ø32.4 mm 240 × 240 จุด ไอซี GC9A01 (SPI 4 สาย: SCLK, MOSI, CS, DC) + ทัชสกรีนแบบเก็บประจุ CST816S (I²C ที่อยู่ 0x15, ขา INT/RST) · 13 ขา: VCC GND MISO MOSI SCLK LCD_CS LCD_DC LCD_RST LCD_BL TP_SDA TP_SCL TP_INT TP_RST · ไฟเลี้ยง 3.3/5 V (ลอจิกต้องระดับเดียวกับไฟเลี้ยง) · ภาพบนจอมาจากไบต์ที่ส่งผ่าน SPI เท่านั้น · แตะ/ปัดบนจอในฉากหรือในแผงคุณสมบัติ',
  },
  {
    kind: 'qmi8658', name: 'โมดูลเซนเซอร์ 6 แกน QMI8658 (I²C)', nameEn: 'QMI8658 6-axis IMU module (accelerometer + gyroscope), I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['qmi8658', 'imu', 'accelerometer', 'gyro', 'ความเร่ง', 'ไจโร', 'นับก้าว', 'step', 'i2c', 'smart watch', '6 แกน'],
    description: 'โมดูลทั่วไป 5 ขา: VCC (1.71–3.6 V — ห้ามต่อ 5 V), GND, SCL, SDA, SA0 · ที่อยู่ 0x6A (SA0 ดึงขึ้นบนโมดูล) หรือ 0x6B (SA0 ต่อ GND) · WHO_AM_I = 0x05 · หลังจ่ายไฟเซนเซอร์ปิดอยู่ ต้องเปิดที่ CTRL7 (0x08) · ตั้งการเคลื่อนไหวในแผงคุณสมบัติ',
  },
  {
    kind: 'lcd1602', name: 'จอ LCD 16×2 แบบ I²C (HD44780 + PCF8574)', nameEn: 'Character LCD 16×2 with I²C backpack (HD44780 + PCF8574)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'LCD', keywords: ['lcd', '1602', '16x2', 'hd44780', 'pcf8574', 'i2c', 'จอ', 'ตัวอักษร', 'lcm1602', 'character'],
    description: 'จอตัวอักษร 16 ตัว × 2 บรรทัด ไอซี HD44780 พร้อมบอร์ด I²C (PCF8574) ด้านหลัง วางบนโต๊ะ: หัวเข็ม 4 ขา GND, VCC (5 V), SDA, SCL · ที่อยู่ 0x27 (PCF8574T) หรือ 0x3F (PCF8574AT) · ทริมพอตปรับความคมชัด จัมเปอร์ไฟพื้นหลัง · ตัวต้านทานดึงขึ้น SDA/SCL บนบอร์ดต่อไป 5 V (ถอดได้ในแผงคุณสมบัติ) · ใช้ไลบรารี lcd_api + machine_i2c_lcd ที่อยู่ในบอร์ด Pico แล้ว',
  },
  {
    kind: 'lcd1602p', name: 'จอ LCD 16×2 แบบขนาน (HD44780, 16 ขา)', nameEn: 'Character LCD 16×2, parallel interface (HD44780, 16-pin header)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'LCD', keywords: ['lcd', '1602', '16x2', 'hd44780', 'liquidcrystal', 'parallel', 'ขนาน', 'จอ', 'ตัวอักษร', 'character', '16 pin', '4 bit'],
    description: 'จอตัวอักษร 16 ตัว × 2 บรรทัด ไอซี HD44780 หัวเข็ม 16 ขาแถวเดียวเสียบเบรดบอร์ด: VSS, VDD (5 V), V0 (ความคมชัด — ต่อขากลาง VR 10 kΩ), RS, RW (ต่อ GND = เขียนอย่างเดียว), E, D0–D7 (โหมด 4 บิตใช้แค่ D4–D7), A/K (LED ไฟพื้นหลัง) · ใช้ไลบรารี LiquidCrystal ของ Arduino (เช่น LiquidCrystal lcd(12, 11, 5, 4, 3, 2))',
  },
  {
    kind: 'arcadebtn', name: 'ปุ่มอาร์เคด 24 mm (ไมโครสวิตช์)', nameEn: 'Arcade push button 24 mm (microswitch COM/NO/NC)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'SW', keywords: ['arcade', 'button', 'ปุ่ม', 'อาร์เคด', '24mm', '24 mm', 'microswitch', 'ไมโครสวิตช์', 'โครงงาน'],
    description: 'ปุ่มอาร์เคดหัว Ø 24 mm ติดแผง (รูเจาะ Ø 24 mm) กดติดปล่อยดับ · ไมโครสวิตช์ 3 ขั้ว: COM, NO (ต่อเมื่อกด), NC (ต่อเมื่อปล่อย) · ใช้กับขาเข้าแบบ INPUT_PULLUP: COM → GND, NO → ขาดิจิทัล (กด = LOW) · พิกัดไมโครสวิตช์ทั่วไป 3–5 A 125/250 VAC (วงจรลอจิกใช้กระแสน้อยมาก) · กดค้างที่ปุ่มในฉาก 3 มิติหรือในแผงคุณสมบัติ',
  },
  {
    kind: 'pushbtn16', name: 'ปุ่มกด 16 mm (ติดแผง)', nameEn: 'Panel push button 16 mm (momentary, normally open)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'SW', keywords: ['button', 'push', '16mm', '16 mm', 'ปุ่ม', 'ปุ่มกด', 'panel', 'momentary', 'โครงงาน'],
    description: 'ปุ่มกด Ø 16 mm ติดแผง (รูเจาะ Ø 16 mm) กดติดปล่อยดับ ปกติเปิด (NO) 2 ขั้ว · ใช้กับขาเข้าแบบ INPUT_PULLUP: ขั้วหนึ่ง → GND อีกขั้ว → ขาดิจิทัล (กด = LOW) · กดค้างที่ปุ่มในฉาก 3 มิติหรือในแผงคุณสมบัติ',
  },
  {
    kind: 'dcadapter', name: 'อะแดปเตอร์ 5 V 3 A + แจ็ก DC 5.5 × 2.1 mm', nameEn: 'Power adapter 5 V 3 A with DC jack 5.5 × 2.1 mm (screw terminal)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'PS', keywords: ['adapter', 'อะแดปเตอร์', 'power', 'ไฟเลี้ยง', '5v', '3a', 'dc jack', 'แจ็ก', '5.5', '2.1', 'barrel', 'servo power', 'โครงงาน'],
    description: 'อะแดปเตอร์ไฟบ้าน → 5 V DC จ่ายได้ 3 A ปลั๊ก DC 5.5 × 2.1 mm ขั้วกลางเป็นบวก เสียบแจ็ก DC ตัวเมียแบบขั้วต่อสกรู (+ / −) แล้วต่อสายจากขั้วสกรู · เกิน 3 A วงจรจำกัดกระแสทำให้แรงดันตก · ใช้จ่ายไฟเซอร์โว/โหลดกระแสสูงแยกจากบอร์ด (ต่อ GND ร่วมกับบอร์ดเสมอ)',
  },
  {
    kind: 'servohub', name: 'บอร์ดกระจายไฟเซอร์โว 4 ช่อง', nameEn: 'Servo power distribution board, 4 channels (passive)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'PD', keywords: ['servo', 'เซอร์โว', 'power distribution', 'กระจายไฟ', 'servo hub', 'แยกไฟ', 'โครงงาน'],
    description: 'บอร์ดพาสซีฟ: ขั้วสกรูไฟเข้า V+ / GND (เช่น จากอะแดปเตอร์ 5 V 3 A) → หัวเข็ม 3 ขาต่อช่อง (S สัญญาณ, V ไฟ, G กราวด์) สำหรับเสียบสายเซอร์โว 4 ตัว · ขา S1–S4 รับสัญญาณ PWM จากบอร์ดไมโครคอนโทรลเลอร์ + ขา GND สัญญาณ (ต่อกับ GND ของบอร์ดเพื่อให้กราวด์ร่วม) · ตัวเก็บประจุ 470 µF 16 V กรองไฟตอนเซอร์โวเริ่มหมุน · LED แสดงไฟเข้า (1 kΩ)',
  },
  {
    kind: 'bmp280', name: 'โมดูลความกดอากาศ BMP280 (GY-BMP280, I²C)', nameEn: 'Barometric pressure + temperature BMP280 module (GY-BMP280), I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['bmp280', 'bme280', 'barometer', 'pressure', 'ความกดอากาศ', 'อุณหภูมิ', 'i2c', 'weather', 'สถานีอากาศ', 'gy-bmp280'],
    description: 'โมดูล GY-BMP280 6 ขา: VCC (3.3 V — ไม่มีเรกูเลเตอร์), GND, SCL, SDA, CSB, SDO · ที่อยู่ 0x76 (SDO ไม่ต่อ) หรือ 0x77 (SDO → 3V3) · chip id = 0x58 · หลังจ่ายไฟอยู่ในโหมดหลับ ต้องเขียน ctrl_meas (0xF4) · ค่าที่อ่านเป็นค่าดิบ 20 บิต ต้องชดเชยด้วยค่าปรับเทียบในชิป (0x88–0x9F) · ตั้งอุณหภูมิและความกดอากาศในแผงคุณสมบัติ',
  },
  {
    kind: 'bh1750', name: 'โมดูลวัดแสง BH1750 (GY-302, I²C)', nameEn: 'Ambient light sensor BH1750 module (GY-302), I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['bh1750', 'gy-302', 'light', 'lux', 'แสง', 'ความเข้มแสง', 'i2c', 'weather', 'สถานีอากาศ'],
    description: 'โมดูล GY-302 5 ขา: VCC (3–5 V มีเรกูเลเตอร์), GND, SCL, SDA, ADDR · ที่อยู่ 0x23 (ADDR ไม่ต่อ) หรือ 0x5C (ADDR → 3V3) · สั่งวัดด้วยคำสั่ง 1 ไบต์ (0x10 = วัดต่อเนื่องละเอียด 1 lx) แล้วอ่าน 2 ไบต์ ÷ 1.2 = lux · ตั้งระดับแสงในแผงคุณสมบัติ',
  },
  {
    kind: 'ina219', name: 'โมดูลวัดกระแส/กำลัง INA219 (I²C)', nameEn: 'INA219 high-side current / power monitor module, I²C', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['ina219', 'current', 'power', 'กระแส', 'กำลังไฟฟ้า', 'วัตต์', 'shunt', 'i2c', 'มิเตอร์', 'power meter'],
    description: 'โมดูล INA219 6 ขา: VCC (3–5.5 V), GND, SCL, SDA, VIN−, VIN+ · มีตัวต้านทาน shunt 0.1 Ω ระหว่าง VIN+ กับ VIN− — ต่ออนุกรมด้านบวกของโหลด (high side) · ที่อยู่ 0x40 (บัดกรี A0/A1 → 0x41/0x44/0x45) · แรงดันบัสวัดที่ VIN− เทียบ GND (0–26 V) · ต้องเขียนรีจิสเตอร์ calibration (0x05) ก่อนอ่านกระแส/กำลัง',
  },
  {
    kind: 'tm1637', name: 'จอ 7 ส่วน 4 หลัก TM1637', nameEn: '4-digit 7-segment display module (TM1637)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'DS', keywords: ['tm1637', '7 segment', '7-segment', '4 digit', 'จอ', 'ตัวเลข', 'นาฬิกา', 'clock', 'display', 'เซเว่นเซกเมนต์'],
    description: 'โมดูลจอตัวเลข 4 หลักพร้อมโคลอนกลาง ไอซี TM1637 · 4 ขา CLK, DIO, VCC, GND · ใช้โปรโตคอล 2 สายของ TM1637 (คล้าย I²C แต่ไม่มีที่อยู่ ส่งบิตต่ำก่อน) ขับด้วยขา GPIO ธรรมดา · ปรับความสว่าง 8 ระดับ · ใช้ไลบรารี tm1637 ที่อยู่ในบอร์ด Pico แล้ว',
  },
  {
    kind: 'keypad', name: 'ปุ่มกดเมมเบรน 4×4 (keypad)', nameEn: '4×4 membrane keypad', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'KP', keywords: ['keypad', 'keyboard', 'membrane', '4x4', 'matrix', 'ปุ่ม', 'แป้น', 'คีย์แพด', 'รหัส', 'เมทริกซ์'],
    description: 'แผ่นปุ่มกดเมมเบรน 16 ปุ่ม (1 2 3 A / 4 5 6 B / 7 8 9 C / * 0 # D) วางบนโต๊ะ สายแพ 8 เส้น: R1–R4 (แถว) C1–C4 (คอลัมน์) · กดปุ่ม = ต่อแถวกับคอลัมน์ของปุ่มนั้น — ไม่มีไฟเลี้ยง ไม่มีตัวต้านทานดึงขึ้น โค้ดต้องสแกนเอง (ขาแถวเป็นเอาต์พุต ขาคอลัมน์เป็นขาเข้า + PULL_UP) · กดปุ่มในฉาก (แตะค้าง) หรือในแผงคุณสมบัติ',
  },
  {
    kind: 'encoder', name: 'โมดูล rotary encoder KY-040', nameEn: 'Rotary encoder module KY-040 (EC11)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'ENC', keywords: ['encoder', 'rotary', 'ky-040', 'ky040', 'ec11', 'หมุน', 'ลูกบิด', 'เอ็นโค้ดเดอร์', 'quadrature'],
    description: 'โมดูล KY-040 5 ขา: CLK, DT, SW, + (3.3–5 V), GND · ลูกบิด EC11 20 คลิกต่อรอบ หมุน 1 คลิก = สัญญาณ CLK/DT ครบหนึ่งรอบแบบควอดราเจอร์ (ตามเข็ม CLK ลงก่อน DT) · CLK/DT มีตัวต้านทานดึงขึ้น 10 kΩ ไป + บนโมดูล · กดลูกบิด = SW ต่อลง GND (ไม่มีตัวดึงขึ้น ใช้ PULL_UP ในขา) · หมุนและกดในแผงคุณสมบัติ',
  },
  {
    kind: 'joystick', name: 'โมดูลจอยสติ๊ก KY-023', nameEn: 'Joystick module KY-023 (2-axis + button)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'JS', keywords: ['joystick', 'ky-023', 'ky023', 'จอย', 'จอยสติ๊ก', 'analog stick', 'xy', 'แกน'],
    description: 'โมดูล KY-023 5 ขา: GND, +5V (ใช้ 3V3 กับ Pico), VRx, VRy, SW · ตัวต้านทานปรับค่า 10 kΩ สองแกน ปลายต่อ +5V กับ GND แกนกลางออกที่ VRx/VRy (ก้านอยู่กลาง ≈ ครึ่งหนึ่งของไฟเลี้ยง) · กดก้าน = SW ต่อลง GND (ไม่มีตัวดึงขึ้น) · ขยับก้านในแผงคุณสมบัติ',
  },
  {
    kind: 'esp32s3lcd', name: 'ESP32-S3-Touch-LCD-1.28 (เฉพาะโมเดล)', nameEn: 'ESP32-S3-Touch-LCD-1.28 round board — 3D model only', category: 'mcu', mount: 'table',
    supported: true, labelPrefix: 'U', keywords: ['esp32', 'esp32-s3', 's3', 'round', 'จอกลม', 'smart watch', 'นาฬิกา', 'gc9a01', 'qmi8658', 'บอร์ด', '1.28'],
    description: 'ยังไม่รองรับการรันโค้ด — แสดงโมเดลเท่านั้น (ยังไม่มีตัวจำลอง ESP32-S3 ที่ฝังในแอปได้) · บอร์ดจริงมี ESP32-S3R2, จอกลม GC9A01A 240×240, ทัช CST816S, QMI8658, ช่องแบต MX1.25, USB-C · ทดลองวงจรเดียวกันได้ด้วย Pico + จอกลม + QMI8658 (แลป 47)',
  },
  {
    kind: 'rgbled', name: 'LED RGB 5 mm (3 สีในตัวเดียว)', nameEn: 'RGB LED 5 mm (common cathode / common anode)', category: 'semiconductor', mount: 'board',
    supported: true, labelPrefix: 'LED', keywords: ['rgb', 'led', 'rgb led', 'สี', 'ผสมสี', 'แดง', 'เขียว', 'น้ำเงิน', 'common cathode', 'common anode', 'แคโทดร่วม', 'แอโนดร่วม'],
    description: 'LED 3 สี (แดง เขียว น้ำเงิน) ในเลนส์เดียว 4 ขาเรียงกัน: R, ขาร่วม (ขายาวสุด), G, B · แคโทดร่วม: ขาร่วมต่อลบ ป้อนบวกที่ขาสี · แอโนดร่วม: ขาร่วมต่อบวก ดึงขาสีลงลบ · Vf ≈ 2.0 / 3.2 / 3.2 V ที่ 20 mA — ใส่ตัวต้านทานแยกทุกสี · ผสมสีด้วย PWM',
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
    kind: 'soilsensor', name: 'เซนเซอร์ความชื้นในดิน (capacitive v1.2)', nameEn: 'Capacitive soil moisture sensor v1.2 (in a plant pot)', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'MS', keywords: ['soil', 'moisture', 'ความชื้น', 'ดิน', 'capacitive', 'smart farm', 'สมาร์ตฟาร์ม', 'กระถาง', 'ต้นไม้', 'รดน้ำ', 'sen0193'],
    description: 'เซนเซอร์ความชื้นในดินแบบ capacitive v1.2 (98 × 23 mm) ปักในกระถางต้นไม้: สาย GND (ดำ) VCC 3.3–5.5 V (แดง) AOUT (เหลือง) — ดินยิ่งชื้น แรงดันยิ่งต่ำ (≈ 2.5 V แห้ง → ≈ 1.25 V อิ่มน้ำ) ต่อเข้าขา ADC ของ Pico · ตั้งความชื้นดินและอัตราดินแห้งในแผงคุณสมบัติ',
  },
  {
    kind: 'pump', name: 'ปั๊มน้ำจุ่ม DC 3–6 V', nameEn: 'Submersible mini water pump 3–6 V', category: 'control', mount: 'table',
    supported: true, labelPrefix: 'P', keywords: ['pump', 'ปั๊ม', 'น้ำ', 'water', 'submersible', 'smart farm', 'สมาร์ตฟาร์ม', 'รดน้ำ', 'irrigation'],
    description: 'ปั๊มน้ำจุ่มขนาด Ø 24 × 33 mm ในถังน้ำ 3–6 V 130–220 mA 80–120 L/h: สายแดง (+) สายดำ (−) · สายยางรดกระถางของเซนเซอร์ความชื้นที่เลือกในแผงคุณสมบัติ · เป็นมอเตอร์ — ขับผ่านรีเลย์หรือทรานซิสเตอร์ (ขา GPIO จ่ายกระแสไม่พอ)',
  },
  {
    kind: 'dht22', name: 'เซนเซอร์อุณหภูมิ/ความชื้น DHT22', nameEn: 'Temperature & humidity sensor DHT22 (AM2302)', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['dht22', 'dht', 'am2302', 'humidity', 'temperature', 'ความชื้น', 'อุณหภูมิ', 'อากาศ', 'smart farm', 'สมาร์ตฟาร์ม', 'เซนเซอร์'],
    description: 'DHT22 (AM2302) 4 ขา มองด้านตะแกรง ขาลง: 1 VDD (3.3–6 V), 2 DATA, 3 NC, 4 GND · บัสสายเดียว ต้องมีตัวต้านทานดึงขึ้น 4.7–10 kΩ จาก DATA ไป VDD · อ่านด้วย MicroPython: dht.DHT22(Pin(15)) ห่างกันอย่างน้อย 2 วินาที และรอ 1 วินาทีหลังจ่ายไฟก่อนอ่านครั้งแรก · ตั้งอุณหภูมิและความชื้นในแผงคุณสมบัติ',
  },
  {
    kind: 'dht11', name: 'เซนเซอร์อุณหภูมิ/ความชื้น DHT11', nameEn: 'Temperature & humidity sensor DHT11', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['dht11', 'dht', 'humidity', 'temperature', 'ความชื้น', 'อุณหภูมิ', 'อากาศ', 'เซนเซอร์'],
    description: 'DHT11 ตัวถังสีฟ้า 4 ขา มองด้านตะแกรง ขาลง: 1 VDD (3.3–5.5 V), 2 DATA, 3 NC, 4 GND · บัสสายเดียวแบบเดียวกับ DHT22 แต่ข้อมูลเป็นจำนวนเต็ม (ความชื้น 20–90 %RH ±5 %RH, อุณหภูมิ 0–50 °C ±2 °C) · ต้องมีตัวต้านทานดึงขึ้น 4.7–10 kΩ · อ่านด้วย dht.DHT11(Pin(n)) ห่างกันอย่างน้อย 1 วินาที · ค่าที่อ่านได้เป็นผลการวัดครั้งก่อน (อ่านครั้งที่สองได้ค่าปัจจุบัน) และเซนเซอร์ตอบสนองช้า (1/e ≈ 6–10 s)',
  },
  {
    kind: 'pir', name: 'โมดูลตรวจจับความเคลื่อนไหว PIR HC-SR501', nameEn: 'PIR motion sensor module HC-SR501', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['pir', 'hc-sr501', 'sr501', 'motion', 'เคลื่อนไหว', 'คน', 'กันขโมย', 'ตรวจจับ', 'อินฟราเรด'],
    description: 'HC-SR501 3 ขา: VCC (4.5–20 V — ใช้ VBUS 5 V), OUT, GND · OUT สูง 3.3 V เมื่อตรวจพบความเคลื่อนไหว ค้างตามเวลาหน่วง (ทริมพอต Tx) แล้วกลับต่ำ จากนั้นไม่รับสัญญาณ ≈ 2.5 s · จัมเปอร์ H = ต่อเวลาเมื่อยังเคลื่อนไหว, L = ทริกเกอร์ครั้งเดียว · ขา OUT 3.3 V ต่อขา Pico ได้ตรง · สั่ง "มีคนเคลื่อนไหว" ในแผงคุณสมบัติ',
  },
  {
    kind: 'irobstacle', name: 'โมดูลตรวจจับวัตถุอินฟราเรด FC-51', nameEn: 'IR obstacle avoidance sensor module FC-51', category: 'control', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['ir', 'fc-51', 'obstacle', 'infrared', 'อินฟราเรด', 'สิ่งกีดขวาง', 'ตรวจจับวัตถุ', 'lm393', 'หุ่นยนต์'],
    description: 'FC-51 3 ขา: OUT, GND, VCC (3.3–5 V) · LED อินฟราเรดส่ง + โฟโตไดโอดรับแสงสะท้อน เปรียบเทียบด้วย LM393 · OUT ต่ำ (และ LED บนโมดูลติด) เมื่อมีวัตถุอยู่ใกล้กว่าระยะที่ตั้งด้วยทริมพอต (2–30 cm) · ขาออกมีตัวต้านทานดึงขึ้น 10 kΩ ไป VCC · ตั้งระยะวัตถุและสีผิววัตถุในแผงคุณสมบัติ',
  },
  ...SENSOR_CATALOG.map((e) => ({ ...e, keywords: [...e.keywords], category: 'control' as const, mount: 'board' as const, supported: true })),
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
    kind: 'logicanalyzer', name: 'เครื่องวิเคราะห์ลอจิก 8 ช่อง', nameEn: 'Logic analyzer, 8 channels', category: 'instrument', mount: 'table',
    supported: true, labelPrefix: 'LA', keywords: ['logic', 'analyzer', 'logic analyzer', 'ลอจิก', 'วิเคราะห์', 'uart', 'serial', 'pwm', 'decoder', 'ถอดรหัส', 'saleae', 'sigrok', 'pulseview'],
    description: 'โมดูลวิเคราะห์ลอจิก USB 8 ช่อง (24 MHz) วางบนโต๊ะ: ต่อสาย CH0–CH7 และ GND เข้าวงจร · ดูระดับลอจิกตามเวลา วัดความถี่/duty ของ PWM และถอดรหัส UART · เวลาขอบของขาไมโครคอนโทรลเลอร์มาจากตัวจำลอง CPU โดยตรง',
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
  {
    kind: 'picow', name: 'Raspberry Pi Pico W (ไม่มีไร้สาย)', nameEn: 'Raspberry Pi Pico W — wireless not simulated (RP2040)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'PICOW', keywords: ['pico w', 'picow', 'pico-w', 'rp2040', 'cyw43', 'micropython', 'python', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Raspberry Pi Pico W ขา header 40 ขาเหมือน Pico — CPU RP2040 จำลองจริง (rp2040js) รันเฟิร์มแวร์ MicroPython ของ Pico W ที่ปิดส่วนไร้สาย · **ไม่จำลองชิป CYW43439**: Wi-Fi/Bluetooth และ LED บนบอร์ด (Pin("LED")) ใช้ไม่ได้ — ต่อ LED ภายนอก · วางคร่อมร่องกลางเหมือน Pico',
  },
  {
    kind: 'xiao', name: 'Seeed Studio XIAO RP2040', nameEn: 'Seeed Studio XIAO RP2040 (RP2040, MicroPython)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'XIAO', keywords: ['xiao', 'seeed', 'rp2040', 'neopixel', 'ws2812', 'micropython', 'python', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'บอร์ดจิ๋ว 21 × 17.8 mm ขา 14 ขา (D0–D10, 5V, GND, 3V3) เสียบเบรดบอร์ดคร่อมร่องกลาง — แตะรูแถว h ให้ขา D0–D6 อยู่แถว h และ D7…5V อยู่แถว d · CPU RP2040 จำลองจริง (rp2040js) รันเฟิร์มแวร์ MicroPython ที่ใช้นิยามบอร์ด SEEED_XIAO_RP2040 (ชื่อขา "D0"…"D10", "LED_R/G/B", "NEOPIXEL") · LED RGB บนบอร์ดติดเมื่อขาเป็น LOW · NeoPixel (GPIO12, เปิดไฟที่ GPIO11) ถอดรหัสจากสัญญาณขาจริง — รองรับโมดูล neopixel ไม่รองรับ PIO · D6/D7 ใช้เป็น REPL',
  },
  {
    kind: 'nanoconnect', name: 'Arduino Nano RP2040 Connect (ไม่มีไร้สาย)', nameEn: 'Arduino Nano RP2040 Connect — NINA-W102 not simulated (RP2040, MicroPython)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'NRP', keywords: ['nano rp2040', 'nano connect', 'rp2040 connect', 'arduino', 'lsm6dsox', 'imu', 'rp2040', 'micropython', 'python', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Arduino Nano RP2040 Connect ขา 30 ขาแบบ Nano เสียบคร่อมร่องกลาง — แตะรูแถว h ให้ขา 1–15 (TX…D12) อยู่แถว h และขา 16–30 (D13…VIN) อยู่แถว d · CPU RP2040 จำลองจริง (rp2040js) รันเฟิร์มแวร์ MicroPython ที่ใช้นิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT แต่ปิดโมดูล NINA-W102 · IMU LSM6DSOX บนบอร์ด (0x6A ที่ A4/A5) จำลองระดับรีจิสเตอร์ · **ไม่จำลอง NINA-W102**: Wi-Fi/Bluetooth, LED RGB, การอ่านแอนะล็อก A4–A7 ใช้ไม่ได้ · ไม่จำลองไมโครโฟนและชิปเข้ารหัส · TX/RX ใช้เป็น REPL',
  },
  {
    kind: 'esp32devkitc', name: 'ESP32-DevKitC V4 (จำลองบนเซิร์ฟเวอร์)', nameEn: 'Espressif ESP32-DevKitC V4 (ESP32-WROOM-32E, MicroPython via QEMU on the server)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'ESP', keywords: ['esp32', 'devkitc', 'devkit', 'wroom', 'espressif', 'qemu', 'micropython', 'python', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'ESP32-DevKitC V4 (โมดูล ESP32-WROOM-32E) หัวต่อ J2/J3 อย่างละ 19 ขา เสียบคร่อมเบรดบอร์ด (แถวห่าง 1 นิ้ว) — แตะรูแถว j ให้ J2 อยู่แถว j และ J3 อยู่แถว b · CPU ESP32 จำลองด้วย QEMU (สาขา picsimlab-esp32) **บนเซิร์ฟเวอร์** รันเฟิร์มแวร์ MicroPython v1.24.1 ESP32_GENERIC ทางการ · ต้องตั้งที่อยู่บริการ (เหมือนบริการคอมไพล์) · ทำงานพร้อมกันได้จำกัดจำนวนบอร์ด · **ไม่จำลอง Wi-Fi/Bluetooth**, DAC, touch, RMT, ตัวดึงขึ้น/ลงของขา RTC',
  },
  {
    kind: 'uno', name: 'Arduino Uno R3', nameEn: 'Arduino Uno R3 (ATmega328P, C++)', category: 'mcu', mount: 'table',
    supported: true, labelPrefix: 'UNO', keywords: ['arduino', 'uno', 'atmega328p', 'avr', 'c++', 'cpp', 'sketch', 'ino', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Arduino Uno R3 (ATmega328P 16 MHz, ลอจิก 5 V) วางบนโต๊ะ ต่อสายจากหัวต่อตัวเมียเข้าเบรดบอร์ด · เขียนโค้ด C++ (Arduino) → คอมไพล์ด้วยบริการคอมไพล์ (avr-gcc) → รันบน CPU จำลอง (avr8js) · ขา ~3 ~5 ~6 ~9 ~10 ~11 ทำ PWM · A0–A5 อ่านแอนะล็อก 10 บิต · D0/D1 ใช้กับ Serial',
  },
  {
    kind: 'nano', name: 'Arduino Nano', nameEn: 'Arduino Nano (ATmega328P, C++)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'NANO', keywords: ['arduino', 'nano', 'atmega328p', 'avr', 'c++', 'cpp', 'sketch', 'ino', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Arduino Nano (ATmega328P 16 MHz, ลอจิก 5 V) เสียบเบรดบอร์ดคร่อมร่องกลาง — แตะรูแถว h ให้ขา 1–15 อยู่แถว h และขา 16–30 อยู่แถว d · ชิปเดียวกับ Uno: เขียน C++ → คอมไพล์ด้วยบริการคอมไพล์ (avr-gcc, บอร์ด Nano) → รันบน CPU จำลอง (avr8js) · A6/A7 อ่านแอนะล็อกได้อย่างเดียว · ขา 3V3 ≤ 50 mA',
  },
  {
    kind: 'promini', name: 'Arduino Pro Mini 328', nameEn: 'Arduino Pro Mini 328 (ATmega328P 5 V/16 MHz or 3.3 V/8 MHz, C++)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'PMINI', keywords: ['arduino', 'pro mini', 'promini', 'pro-mini', 'atmega328p', 'avr', '3.3v', '8mhz', 'ftdi', 'c++', 'sketch', 'ino', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Arduino Pro Mini 328 (ATmega328P) เสียบเบรดบอร์ดคร่อมร่องกลาง — แตะรูแถว h ให้ขา TXO…D9 อยู่แถว h และ RAW…D10 อยู่แถว d · เลือกรุ่น 5 V/16 MHz หรือ 3.3 V/8 MHz ในแผงคุณสมบัติ · ไม่มีพอร์ต USB: ตัวจำลองถือว่าต่อตัวแปลง USB-serial ที่หัว 6 ขา (ไฟ VCC + Serial) · A4–A7 เป็นรูบนบอร์ด ต่อสายที่ขา · เขียน C++ → คอมไพล์ด้วยบริการคอมไพล์ (avr-gcc, บอร์ด Pro Mini) → รันบน CPU จำลอง (avr8js)',
  },
  {
    kind: 'attiny85', name: 'ไอซีไมโครคอนโทรลเลอร์ ATtiny85 (DIP-8)', nameEn: 'ATtiny85 microcontroller IC (DIP-8, 8 MHz internal, C++)', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'TINY', keywords: ['attiny85', 'attiny', 'tiny85', 'avr', 'dip-8', 'dip8', 'c++', 'sketch', 'ino', 'mcu', 'ไมโครคอนโทรลเลอร์', 'ไอซี'],
    description: 'ไอซี ATtiny85 ตัวถัง DIP-8 เสียบคร่อมร่องกลาง (ขา 1–4 แถวของ anchor, ขา 5–8 อีกฝั่ง) · ไม่มีบอร์ด/USB: ต้องต่อขา 8 (VCC 2.7–5.5 V) และขา 4 (GND) กับแหล่งจ่ายเอง — CPU ทำงานเมื่อมีไฟพอ · PB0–PB4 ใช้เป็น I/O (D0–D4), PWM ที่ PB0/PB1/PB4, ADC ที่ A1 (PB2) A2 (PB4) A3 (PB3) · ขา 1 = RESET · ไม่มี UART/I²C/SPI ฮาร์ดแวร์ (Serial ใช้ไม่ได้) · เขียน C++ → คอมไพล์ด้วยบริการคอมไพล์ (avr-gcc, ATtiny85 8 MHz) → รันบน CPU จำลอง (avr8js)',
  },
  {
    kind: 'mega', name: 'Arduino Mega 2560', nameEn: 'Arduino Mega 2560 Rev3 (ATmega2560, C++)', category: 'mcu', mount: 'table',
    supported: true, labelPrefix: 'MEGA', keywords: ['arduino', 'mega', 'mega2560', 'mega 2560', 'atmega2560', 'avr', 'c++', 'cpp', 'sketch', 'ino', 'mcu', 'ไมโครคอนโทรลเลอร์'],
    description: 'Arduino Mega 2560 Rev3 (ATmega2560 16 MHz, ลอจิก 5 V, แฟลช 256 KB, SRAM 8 KB) วางบนโต๊ะ · เขียน C++ → คอมไพล์ด้วยบริการคอมไพล์ (avr-gcc, บอร์ด Mega 2560) → รันบน CPU จำลอง ATmega2560 (avr8js) · D0–D53, A0–A15 · PWM 15 ขา (2–13, 44–46) · Serial + Serial1–3 · INT0–5 · I²C ที่ D20/D21 · SPI ที่ D50–D53',
  },
  {
    kind: 'unoq', name: 'Arduino UNO Q (จำลองพฤติกรรม)', nameEn: 'Arduino UNO Q — behavioral (Arduino API) simulation', category: 'mcu', mount: 'table',
    supported: true, labelPrefix: 'UNOQ', keywords: ['arduino', 'uno q', 'unoq', 'uno-q', 'stm32u585', 'qrb2210', 'abx00162', 'c++', 'sketch', 'mcu', 'ไมโครคอนโทรลเลอร์', 'โครงงาน'],
    description: 'Arduino UNO Q (หัวต่อแบบ UNO, ลอจิก 3.3 V) วางบนโต๊ะ · **โหมดจำลองพฤติกรรมระดับ Arduino API**: สเก็ตช์ถูกคอมไพล์และรันบนแกนจำลอง ATmega328P แทน STM32U585 (ไม่ใช่เฟิร์มแวร์จริงของ UNO Q) โดยใช้ขาและไฟฟ้าตามเอกสาร UNO Q: ลอจิก 3.3 V, analogRead อ้างอิง 3.3 V, Wire ที่ขา SDA/SCL (D20/D21 ข้าง AREF), A0–A5 และ D3 ไม่ทน 5 V, 20 mA ต่อขา / 120 mA รวม · ไม่จำลอง Linux (QRB2210), Bridge, LED matrix, Wire1/Wire2, Serial1',
  },
  {
    kind: 'rpi5', name: 'Raspberry Pi 5 (Python · gpiozero)', nameEn: 'Raspberry Pi 5 — Python/gpiozero, library-level simulation', category: 'mcu', mount: 'table',
    supported: true, labelPrefix: 'RPI', keywords: ['raspberry', 'pi', 'pi5', 'rpi', 'raspberry pi 5', 'gpiozero', 'python', 'linux', 'sbc', 'mcu', 'บอร์ด'],
    description: 'Raspberry Pi 5 วางบนโต๊ะ ต่อสายจากหัวต่อ GPIO 40 ขา (ตัวผู้) เข้าเบรดบอร์ด · เขียน Python ด้วย gpiozero (ชุดย่อยที่เขียนขึ้นใหม่ให้ API ตรงกับ gpiozero 2.0) · จำลองระดับไลบรารี: รัน CPython 3.14 ใน WebAssembly (Pyodide) ไม่ได้จำลอง CPU BCM2712, ชิป RP1 หรือ Linux · ขา GPIO 3.3 V (ไม่ทน 5 V) · ครั้งแรกโหลด Python ราว 12 MB',
  },
  {
    kind: 'bluepill', name: 'STM32F103C8T6 "Blue Pill" (เฉพาะโมเดล)', nameEn: 'STM32F103C8T6 "Blue Pill" — 3D model and pinout only', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['stm32', 'stm32f103', 'f103', 'blue pill', 'bluepill', 'cortex-m3', 'arm', 'บอร์ด'],
    description: 'ยังไม่รองรับการรันโค้ด — แสดงโมเดลและขาเท่านั้น (ยังไม่มีตัวจำลอง CPU STM32F103 ในแอป) · ขาทุกขาไม่มีไฟและไม่ทำงาน · บอร์ด ≈ 23 × 53 mm แถวขาห่าง 0.6" (เช่น ลงรูแถว i และ e คร่อมร่องกลาง)',
  },
  {
    kind: 'pico2', name: 'Raspberry Pi Pico 2 (เฉพาะโมเดล)', nameEn: 'Raspberry Pi Pico 2 (RP2350) — 3D model and pinout only', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['pico 2', 'pico2', 'rp2350', 'raspberry pi', 'cortex-m33', 'risc-v', 'บอร์ด'],
    description: 'ยังไม่รองรับการรันโค้ด — ตัวจำลองในแอป (rp2040js) รองรับเฉพาะ RP2040 ไม่ใช่ RP2350 · ขาและขนาดเหมือน Pico (21 × 51 mm) · ขาทุกขาไม่มีไฟและไม่ทำงาน · ทำโปรเจกต์ที่รันได้ด้วย Raspberry Pi Pico',
  },
  {
    kind: 'teensy41', name: 'Teensy 4.1 (เฉพาะโมเดล)', nameEn: 'PJRC Teensy 4.1 — 3D model and pinout only', category: 'mcu', mount: 'board',
    supported: true, labelPrefix: 'U', keywords: ['teensy', 'teensy 4.1', 'teensy41', 'imxrt1062', 'cortex-m7', 'pjrc', 'บอร์ด'],
    description: 'ยังไม่รองรับการรันโค้ด — แสดงโมเดลและขาขอบนอก 48 ขาเท่านั้น (ยังไม่มีตัวจำลอง CPU i.MX RT1062) · ขาทุกขาไม่มีไฟและไม่ทำงาน · บอร์ด 2.4 × 0.7" (61 × 18 mm) แถวขาห่าง 0.6" (เช่น ลงรูแถว i และ e คร่อมร่องกลาง)',
  },
  { kind: 'esp32', name: 'ESP32', nameEn: 'ESP32', category: 'future', mount: 'board', supported: false, labelPrefix: 'U', keywords: ['esp32', 'mcu'], description: 'ยังไม่รองรับ: ตอนนี้รันโค้ดได้เฉพาะ Raspberry Pi Pico (MicroPython)' },
  { kind: 'tft', name: 'จอ TFT', nameEn: 'TFT display', category: 'future', mount: 'board', supported: false, labelPrefix: 'DSP', keywords: ['tft', 'display', 'จอ'], description: 'ยังไม่รองรับ: ต้องมีการจำลองบัส SPI ระหว่าง Pico กับจอ' },
];

/** ขา GPIO ที่ออกมาที่ขาของบอร์ด Pico */
export const PICO_GPIO = [...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28];
/** ตำแหน่งปุ่มของปุ่มกดเมมเบรน 4×4 [แถว][คอลัมน์] */
export const KEYPAD_KEYS = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']];

/** ลำดับขา 1–40 ของ Pico (ตามบอร์ดจริง) */
export const PICO_PINOUT: string[] = [
  'GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND.8', 'GP6', 'GP7', 'GP8', 'GP9', 'GND.13', 'GP10', 'GP11', 'GP12', 'GP13', 'GND.18', 'GP14', 'GP15',
  'GP16', 'GP17', 'GND.23', 'GP18', 'GP19', 'GP20', 'GP21', 'GND.28', 'GP22', 'RUN', 'GP26', 'GP27', 'AGND', 'GP28', 'ADC_VREF', '3V3', '3V3_EN', 'GND.38', 'VSYS', 'VBUS',
];

/**
 * หน้าที่พิเศษของขา GPIO ตามตาราง GPIO function select ของ RP2040 (ตรงกับแผนภาพขาของ Raspberry Pi Pico) — เป็นรูปแบบซ้ำ:
 *   SPI: บัส ⌊g/8⌋ mod 2, สัญญาณตาม g mod 4 = RX, CSn, SCK, TX
 *   I²C: บัส ⌊g/2⌋ mod 2, ขาคู่ SDA ขาคี่ SCL
 *   UART: ชุด ⌊(g+4)/8⌋ mod 2, สัญญาณตาม g mod 4 = TX, RX, CTS, RTS
 *   PWM: ทุกขา — slice ⌊g/2⌋ mod 8, ช่อง A (คู่) / B (คี่) · ADC เฉพาะ GP26–28 (ADC0–2) · ระดับลอจิก 3.3 V ไม่ทน 5 V
 */
export function picoFunctions(gp: number): string[] {
  const adc = gp >= 26 && gp <= 28 ? [`ADC${gp - 26}`] : [];
  const pwm = `PWM${(gp >> 1) & 7}${gp & 1 ? 'B' : 'A'}`;
  const i2c = `I2C${(gp >> 1) & 1} ${gp & 1 ? 'SCL' : 'SDA'}`;
  const spi = `SPI${(gp >> 3) & 1} ${['RX', 'CSn', 'SCK', 'TX'][gp & 3]}`;
  const uart = `UART${((gp + 4) >> 3) & 1} ${['TX', 'RX', 'CTS', 'RTS'][gp & 3]}`;
  return [...adc, pwm, i2c, spi, uart];
}
export const picoPwm = (gp: number) => picoFunctions(gp).find((f) => f.startsWith('PWM'))!;

const PICO_NOTE: Record<string, string> = {
  ...Object.fromEntries(PICO_GPIO.map((g) => [`GP${g}`, picoFunctions(g).join(' · ')])),
  GP0: `UART0 TX — ใช้เป็น REPL · ${picoPwm(0)}`, GP1: `UART0 RX — ใช้เป็น REPL · ${picoPwm(1)}`,
  RUN: 'รีเซ็ต — ไม่จำลอง', '3V3_EN': 'ไม่จำลอง',
  '3V3': 'ไฟเลี้ยง 3.3 V ออก', VSYS: 'ไฟเลี้ยงระบบ ≈ 4.7 V', VBUS: 'ไฟ USB 5 V', ADC_VREF: 'อ้างอิง ADC 3.3 V', AGND: 'กราวด์ ADC',
};

/**
 * Seeed Studio XIAO RP2040 — 14 ขา (ขา 1 = D0 เรียงทวนเข็มนาฬิกาเมื่อมองด้านบน หัว USB-C อยู่ซ้าย) [ชื่อในแอป, GPIO ของ RP2040 (−1 = ขาไฟ)]
 * ชื่อขาและ GPIO ตามนิยามบอร์ด SEEED_XIAO_RP2040 ของ MicroPython (pins.csv) และแผนภาพขาของ Seeed: D0–D3 = A0–A3 (GPIO26–29),
 * D4/D5 = SDA/SCL (GPIO6/7 — I2C1 ในฮาร์ดแวร์ RP2040), D6/D7 = TX/RX (GPIO0/1), D8/D9/D10 = SCK/MISO/MOSI (GPIO2/4/3)
 */
export const XIAO_PINOUT: Array<[string, number]> = [
  ['D0', 26], ['D1', 27], ['D2', 28], ['D3', 29], ['D4', 6], ['D5', 7], ['D6', 0],
  ['D7', 1], ['D8', 2], ['D9', 4], ['D10', 3], ['3V3', -1], ['GND', -1], ['5V', -1],
];
/** ขา GPIO ของ XIAO RP2040 ที่ออกมาที่ขาของบอร์ด: [ชื่อขา, GPIO] */
export const XIAO_GPIO = XIAO_PINOUT.filter(([, g]) => g >= 0) as Array<[string, number]>;
export { XIAO_LED } from '../mcu/rails';
const XIAO_NOTE: Record<string, string> = {
  D0: 'A0 · GPIO26 · ADC0', D1: 'A1 · GPIO27 · ADC1', D2: 'A2 · GPIO28 · ADC2', D3: 'A3 · GPIO29 · ADC3',
  D4: 'SDA · GPIO6 · I2C1 SDA', D5: 'SCL · GPIO7 · I2C1 SCL', D6: 'TX · GPIO0 · UART0 TX — ใช้เป็น REPL', D7: 'RX · GPIO1 · UART0 RX — ใช้เป็น REPL',
  D8: 'SCK · GPIO2 · SPI0 SCK', D9: 'MISO · GPIO4 · SPI0 RX', D10: 'MOSI · GPIO3 · SPI0 TX',
  '3V3': 'ไฟเลี้ยง 3.3 V ออก', GND: 'กราวด์', '5V': 'ไฟ USB 5 V (VBUS)',
};
export const XIAO_DEFAULT_CODE = `from machine import Pin
import time

led = Pin("LED_B", Pin.OUT)   # LED สีน้ำเงินบนบอร์ด (GPIO25) ติดเมื่อขาเป็น LOW
out = Pin("D0", Pin.OUT)      # ขา D0 (GPIO26)

while True:
    led.toggle()
    out.toggle()
    time.sleep(0.5)
`;

/**
 * Arduino Nano RP2040 Connect (ABX00052/ABX00053) — หัวต่อ 30 ขาแบบ Nano: JP1 ขา 1–15 (TX, RX, RST, GND, D2–D12) และ JP2 ขา 16–30 (D13, 3.3V, REF, A0–A7, VUSB, REC, GND, VIN)
 * ตามตาราง JP1/JP2 ใน datasheet · GPIO ของ RP2040 ตาม pins.csv ของนิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT (MicroPython v1.24.1)
 * A4/A5 = GPIO12/13 (บัส I²C ของ RP2040 ที่ต่อ IMU — มีตัวต้านทานดึงขึ้น 4.7 kΩ บนบอร์ด) และต่อกับ ADC ของ NINA-W102 ด้วย · A6/A7 ต่อกับ NINA-W102 เท่านั้น
 * [ชื่อในแอป, GPIO (−1 = ไม่ต่อกับ RP2040), ป้าย]
 */
export const NANOCONNECT_PINOUT: Array<[string, number, string]> = [
  ['D1', 0, 'ขา 1 TX · D1 · GPIO0 · UART0 TX — ใช้เป็น REPL ในตัวจำลอง (Pin("TX"))'], ['D0', 1, 'ขา 2 RX · D0 · GPIO1 · UART0 RX — ใช้เป็น REPL ในตัวจำลอง (Pin("RX"))'],
  ['RST.1', -1, 'ขา 3 RESET (ไม่จำลอง)'], ['GND.1', -1, 'ขา 4 GND'],
  ['D2', 25, 'ขา 5 D2 · GPIO25'], ['D3', 15, 'ขา 6 D3 · GPIO15'], ['D4', 16, 'ขา 7 D4 · GPIO16'], ['D5', 17, 'ขา 8 D5 · GPIO17'], ['D6', 18, 'ขา 9 D6 · GPIO18'],
  ['D7', 19, 'ขา 10 D7 · GPIO19'], ['D8', 20, 'ขา 11 D8 · GPIO20'], ['D9', 21, 'ขา 12 D9 · GPIO21'], ['D10', 5, 'ขา 13 D10 · GPIO5 · SPI0 CSn'],
  ['D11', 7, 'ขา 14 D11 · GPIO7 · SPI0 TX (COPI)'], ['D12', 4, 'ขา 15 D12 · GPIO4 · SPI0 RX (CIPO)'],
  ['D13', 6, 'ขา 16 D13 · GPIO6 · SPI0 SCK · LED บนบอร์ด (Pin("LED"))'], ['3V3', -1, 'ขา 17 3.3V ไฟออก (≤ 800 mA รวมไอซีบนบอร์ด)'], ['REF', -1, 'ขา 18 REF (ไม่ได้ต่อ — NC ตาม datasheet)'],
  ['A0', 26, 'ขา 19 A0 · GPIO26 · ADC0 (D14)'], ['A1', 27, 'ขา 20 A1 · GPIO27 · ADC1 (D15)'], ['A2', 28, 'ขา 21 A2 · GPIO28 · ADC2 (D16)'], ['A3', 29, 'ขา 22 A3 · GPIO29 · ADC3 (D17)'],
  ['A4', 12, 'ขา 23 A4 · GPIO12 · I²C0 SDA (Pin("SDA")) ต่อ IMU บนบอร์ด + ดึงขึ้น 4.7 kΩ · อ่านแอนะล็อกผ่าน NINA-W102 — ไม่จำลอง'],
  ['A5', 13, 'ขา 24 A5 · GPIO13 · I²C0 SCL (Pin("SCL")) ต่อ IMU บนบอร์ด + ดึงขึ้น 4.7 kΩ · อ่านแอนะล็อกผ่าน NINA-W102 — ไม่จำลอง'],
  ['A6', -1, 'ขา 25 A6 แอนะล็อกผ่าน NINA-W102 — ไม่จำลอง (ไม่ต่อกับ RP2040)'], ['A7', -1, 'ขา 26 A7 แอนะล็อกผ่าน NINA-W102 — ไม่จำลอง (ไม่ต่อกับ RP2040)'],
  ['VUSB', -1, 'ขา 27 VUSB ไฟ 5 V จาก USB'], ['REC', -1, 'ขา 28 REC (BOOTSEL — ไม่จำลอง)'], ['GND.2', -1, 'ขา 29 GND'], ['VIN', -1, 'ขา 30 VIN ไฟเข้า 4–20 V (ไม่จำลอง: ใช้ไฟจาก USB)'],
];
/** ขาของ Nano RP2040 Connect ที่ต่อกับ GPIO ของ RP2040: [ชื่อขา, GPIO] */
export const NANOCONNECT_GPIO = NANOCONNECT_PINOUT.filter(([, g]) => g >= 0).map(([n, g]): [string, number] => [n, g]);
/** ขา GPIO ที่ออกมาที่ขาของบอร์ด RP2040 แต่ละรุ่น: [ชื่อขาในแอป, GPIO] */
export function rp2Pins(kind: string): Array<[string, number]> {
  if (kind === 'esp32devkitc') return ESP32DK_GPIO;
  if (kind === 'xiao') return XIAO_GPIO;
  if (kind === 'nanoconnect') return NANOCONNECT_GPIO;
  return PICO_GPIO.map((g): [string, number] => [`GP${g}`, g]);
}
export const NANOCONNECT_DEFAULT_CODE = `from machine import Pin, I2C
from lsm6dsox import LSM6DSOX
import time

led = Pin("LED", Pin.OUT)                     # LED บนบอร์ด = D13 (GPIO6)
imu = LSM6DSOX(I2C(0, scl=Pin(13), sda=Pin(12)))  # IMU บนบอร์ดที่บัส I²C ของ A4/A5

while True:
    led.toggle()
    ax, ay, az = imu.accel()
    print("accel g: %.2f %.2f %.2f" % (ax, ay, az))
    time.sleep(0.5)
`;

/**
 * Espressif ESP32-DevKitC V4 — หัวต่อ J2 และ J3 อย่างละ 19 ขาตามตารางใน ESP32-DevKitC V4 User Guide
 * [ชื่อในแอป, GPIO (−1 = ขาไฟ/ไม่ต่อกับ ESP32 ในตัวจำลอง), ป้าย] · GPIO6–11 (CLK, D0–D3, CMD) ต่อกับแฟลชในโมดูล — ห้ามใช้
 */
export const ESP32DK_J2: Array<[string, number, string]> = [
  ['3V3', -1, 'J2-1 3V3 ไฟ 3.3 V'], ['EN', -1, 'J2-2 EN (CHIP_PU รีเซ็ต — ไม่จำลอง)'], ['VP', 36, 'J2-3 VP · GPIO36 · ADC1_CH0 (ขาเข้าเท่านั้น)'], ['VN', 39, 'J2-4 VN · GPIO39 · ADC1_CH3 (ขาเข้าเท่านั้น)'],
  ['IO34', 34, 'J2-5 IO34 · ADC1_CH6 (ขาเข้าเท่านั้น)'], ['IO35', 35, 'J2-6 IO35 · ADC1_CH7 (ขาเข้าเท่านั้น)'], ['IO32', 32, 'J2-7 IO32 · ADC1_CH4'], ['IO33', 33, 'J2-8 IO33 · ADC1_CH5'],
  ['IO25', 25, 'J2-9 IO25 · ADC2_CH8 · DAC_1'], ['IO26', 26, 'J2-10 IO26 · ADC2_CH9 · DAC_2'], ['IO27', 27, 'J2-11 IO27 · ADC2_CH7'], ['IO14', 14, 'J2-12 IO14 · ADC2_CH6'],
  ['IO12', 12, 'J2-13 IO12 · ADC2_CH5 (ขา strapping)'], ['GND.1', -1, 'J2-14 GND'], ['IO13', 13, 'J2-15 IO13 · ADC2_CH4'],
  ['D2', -1, 'J2-16 D2 (GPIO9 แฟลชภายใน — ห้ามใช้)'], ['D3', -1, 'J2-17 D3 (GPIO10 แฟลชภายใน — ห้ามใช้)'], ['CMD', -1, 'J2-18 CMD (GPIO11 แฟลชภายใน — ห้ามใช้)'], ['5V', -1, 'J2-19 5V (จาก USB)'],
];
export const ESP32DK_J3: Array<[string, number, string]> = [
  ['GND.2', -1, 'J3-1 GND'], ['IO23', 23, 'J3-2 IO23 · VSPI MOSI'], ['IO22', 22, 'J3-3 IO22 · I²C SCL (นิยมใช้)'], ['TX', 1, 'J3-4 TX · GPIO1 · U0TXD — REPL/USB'], ['RX', 3, 'J3-5 RX · GPIO3 · U0RXD — REPL/USB'],
  ['IO21', 21, 'J3-6 IO21 · I²C SDA (นิยมใช้)'], ['GND.3', -1, 'J3-7 GND'], ['IO19', 19, 'J3-8 IO19 · VSPI MISO'], ['IO18', 18, 'J3-9 IO18 · VSPI SCK'], ['IO5', 5, 'J3-10 IO5 (ขา strapping)'],
  ['IO17', 17, 'J3-11 IO17'], ['IO16', 16, 'J3-12 IO16'], ['IO4', 4, 'J3-13 IO4 · ADC2_CH0'], ['IO0', 0, 'J3-14 IO0 · ADC2_CH1 · ปุ่ม Boot (ขา strapping)'], ['IO2', 2, 'J3-15 IO2 · ADC2_CH2 (ขา strapping)'],
  ['IO15', 15, 'J3-16 IO15 · ADC2_CH3 (ขา strapping)'], ['D1', -1, 'J3-17 D1 (GPIO8 แฟลชภายใน — ห้ามใช้)'], ['D0', -1, 'J3-18 D0 (GPIO7 แฟลชภายใน — ห้ามใช้)'], ['CLK', -1, 'J3-19 CLK (GPIO6 แฟลชภายใน — ห้ามใช้)'],
];
export const ESP32DK_GPIO: Array<[string, number]> = [...ESP32DK_J2, ...ESP32DK_J3].filter(([, g]) => g >= 0).map(([n, g]): [string, number] => [n, g]);
export const ESP32DK_DEFAULT_CODE = `from machine import Pin, ADC
import time

led = Pin(2, Pin.OUT)          # LED ภายนอกที่ IO2 (บอร์ด DevKitC ไม่มี LED ผู้ใช้)
pot = ADC(Pin(34))             # IO34 อ่านแอนะล็อก
pot.atten(ADC.ATTN_11DB)

while True:
    led.value(not led.value())
    print("IO34 =", pot.read())
    time.sleep(0.5)
`;

/** ขาที่ต่อถึงกันภายในอุปกรณ์ (เช่น GND ทุกขาของ Pico) — connectivity รวมเป็นเน็ตเดียว */
/**
 * ESP32-S2-DevKitM-1 (Espressif user guide): J1 ขา 1–21 และ J3 ขา 1–21 — [ชื่อในแอป, ป้าย]
 * RGB LED บนบอร์ดต่อ GPIO18 · USB-UART ที่ U0TXD/U0RXD (GPIO43/44)
 */
export const ESP32S2_J1: Array<[string, string]> = [
  ['3V3', '3V3 ไฟ 3.3 V'],
  ...Array.from({ length: 18 }, (_, i): [string, string] => [`IO${i}`, `GPIO${i}${i >= 1 && i <= 10 ? ` · ADC1_CH${i - 1}` : i >= 11 && i <= 17 ? ` · ADC2_CH${i - 11}` : ''}${i >= 1 && i <= 14 ? ` · TOUCH${i}` : ''}${i === 17 ? ' · DAC_1 · U1TXD' : ''}${i === 0 ? ' (ปุ่ม BOOT)' : ''}`]),
  ['5V', '5V ไฟ 5 V'], ['GND.1', 'G กราวด์'],
];
export const ESP32S2_J3: Array<[string, string]> = [
  ['GND.2', 'G กราวด์'], ['RST', 'RST (CHIP_PU)'], ['IO46', 'GPIO46 (ขาเข้าเท่านั้น)'], ['IO45', 'GPIO45'], ['IO44', 'RX · U0RXD · GPIO44'], ['IO43', 'TX · U0TXD · GPIO43'],
  ['IO42', 'GPIO42 · MTMS'], ['IO41', 'GPIO41 · MTDI'], ['IO40', 'GPIO40 · MTDO'], ['IO39', 'GPIO39 · MTCK'], ['IO38', 'GPIO38'], ['IO37', 'GPIO37'], ['IO36', 'GPIO36'], ['IO35', 'GPIO35'],
  ['IO34', 'GPIO34'], ['IO33', 'GPIO33'], ['IO26', 'GPIO26'], ['IO21', 'GPIO21'], ['IO20', 'GPIO20 · USB_D+'], ['IO19', 'GPIO19 · USB_D−'], ['IO18', 'GPIO18 · DAC_2 · RGB LED บนบอร์ด'],
];

/**
 * STM32F103C8T6 "Blue Pill" (บอร์ดทั่วไปจากหลายผู้ผลิต — แบบเดียวกับที่ stm32-base.org บันทึกไว้) มองด้านบน หัว micro-USB อยู่ซ้าย
 * แถวหน้า (แถวของ anchor) จากฝั่ง USB: B12 … B9 5V G 3.3 · แถวหลังห่าง 0.6" (6 แถว) จากฝั่ง USB: G G 3.3 R B11 … C13 VB
 * ลำดับตาม stm32-base.org (Header 1/2) + deskthority wiki (ขาที่ติด USB = PB12 และ GND) + ตำแหน่งขาในไฟล์ Fritzing (top view, ระยะแถว 600 mil)
 * ขาไม่ทน 5 V (ไม่ใช่ FT ตาม datasheet STM32F103x8 ตาราง 5): PA0–PA7, PB0, PB1, PB5, PC13–PC15 · PC13–15 จ่ายกระแสออกไม่ได้ (sink ≤ 3 mA)
 */
const NFT = ' · ไม่ทน 5 V';
export const BLUEPILL_FRONT: Array<[string, string]> = [
  ['PB12', 'PB12 · SPI2_NSS'], ['PB13', 'PB13 · SPI2_SCK'], ['PB14', 'PB14 · SPI2_MISO'], ['PB15', 'PB15 · SPI2_MOSI'], ['PA8', 'PA8 · TIM1_CH1'],
  ['PA9', 'PA9 · USART1_TX'], ['PA10', 'PA10 · USART1_RX'], ['PA11', 'PA11 · USB D−'], ['PA12', 'PA12 · USB D+'], ['PA15', 'PA15'],
  ['PB3', 'PB3'], ['PB4', 'PB4'], ['PB5', `PB5${NFT}`], ['PB6', 'PB6 · I2C1_SCL'], ['PB7', 'PB7 · I2C1_SDA'], ['PB8', 'PB8'], ['PB9', 'PB9'],
  ['5V', '5V (ต่อตรงกับ VBUS ของ USB)'], ['GND.3', 'G กราวด์'], ['3V3.3', '3.3 ไฟ 3.3 V'],
];
export const BLUEPILL_BACK: Array<[string, string]> = [
  ['GND.1', 'G กราวด์'], ['GND.2', 'G กราวด์'], ['3V3.1', '3.3 ไฟ 3.3 V'], ['NRST', 'R รีเซ็ต (NRST)'], ['PB11', 'PB11 · I2C2_SDA · USART3_RX'], ['PB10', 'PB10 · I2C2_SCL · USART3_TX'],
  ['PB1', `PB1 · ADC12_IN9${NFT}`], ['PB0', `PB0 · ADC12_IN8${NFT}`],
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((i): [string, string] => [`PA${i}`, `PA${i} · ADC12_IN${i}${i === 2 ? ' · USART2_TX' : i === 3 ? ' · USART2_RX' : i === 5 ? ' · SPI1_SCK' : i === 6 ? ' · SPI1_MISO' : i === 7 ? ' · SPI1_MOSI' : ''}${NFT}`]),
  ['PC15', `PC15 · OSC32_OUT${NFT}`], ['PC14', `PC14 · OSC32_IN${NFT}`], ['PC13', `PC13 · LED บนบอร์ด (ติดเมื่อ LOW)${NFT}`], ['VBAT', 'VB (VBAT)'],
];
/**
 * PJRC Teensy 4.1 มองด้านบน หัว micro-USB อยู่ซ้าย — ขาขอบนอก 48 ขาที่เสียบเบรดบอร์ดได้ (ไม่รวมแพดด้านใน/ใต้บอร์ด, หัว USB Host, Ethernet)
 * ลำดับตามสัญลักษณ์ Teensy4.1 ของ teensy_library (KiCad, หมายเลขขา 1–48 แบบ DIP) และบัตรขา PJRC: ขา 1 (GND) ติด USB
 * แถวหน้า (แถวของ anchor): GND 0 … 12 3.3V 24 … 32 · แถวหลังห่าง 0.6" จากฝั่ง USB: VIN GND 3.3V 23 … 13 GND 41 … 33
 * ทุกขาไม่ทน 5 V (PJRC: "The pins are not 5V tolerant") · LED สีส้มที่ขา 13
 */
const T41_FUNC: Record<number, string> = {
  0: 'RX1 · CRX2 · CS1', 1: 'TX1 · CTX2 · MISO1', 2: 'OUT2', 3: 'LRCLK2', 4: 'BCLK2', 5: 'IN2', 6: 'OUT1D', 7: 'RX2 · OUT1A', 8: 'TX2 · IN1', 9: 'OUT1C',
  10: 'CS · MQSR', 11: 'MOSI · CTX1', 12: 'MISO · MQSL', 13: 'SCK · LED บนบอร์ด', 14: 'A0 · TX3 · S/PDIF OUT', 15: 'A1 · RX3 · S/PDIF IN', 16: 'A2 · RX4 · SCL1',
  17: 'A3 · TX4 · SDA1', 18: 'A4 · SDA', 19: 'A5 · SCL', 20: 'A6 · TX5 · LRCLK1', 21: 'A7 · RX5 · BCLK1', 22: 'A8 · CTX1', 23: 'A9 · CRX1 · MCLK1',
  24: 'A10 · TX6 · SCL2', 25: 'A11 · RX6 · SDA2', 26: 'A12 · MOSI1', 27: 'A13 · SCK1', 28: 'RX7', 29: 'TX7', 30: 'CRX3', 31: 'CTX3', 32: 'OUT1B',
  33: 'MCLK2', 34: 'RX8', 35: 'TX8', 36: 'CS', 37: 'CS', 38: 'A14 · CS1 · IN1', 39: 'A15 · MISO1 · OUT1A', 40: 'A16', 41: 'A17',
};
const t41 = (n: number): [string, string] => [`D${n}`, `${n} · ${T41_FUNC[n]}`];
export const TEENSY41_FRONT: Array<[string, string]> = [
  ['GND.1', 'GND กราวด์'], ...Array.from({ length: 13 }, (_, i) => t41(i)), ['3V3.1', '3.3V ไฟ 3.3 V (≤ 250 mA)'], ...Array.from({ length: 9 }, (_, i) => t41(24 + i)),
];
export const TEENSY41_BACK: Array<[string, string]> = [
  ['VIN', 'VIN ไฟเข้า 5 V (ต่อกับ VUSB ผ่านแพดใต้บอร์ด)'], ['GND.2', 'GND กราวด์'], ['3V3.2', '3.3V ไฟ 3.3 V'], ...Array.from({ length: 11 }, (_, i) => t41(23 - i)),
  ['GND.3', 'GND กราวด์'], ...Array.from({ length: 9 }, (_, i) => t41(41 - i)),
];

export function internalLinks(part: Part): string[][] {
  if (part.kind === 'esp32s2') return [['GND.1', 'GND.2']];
  if (part.kind === 'bluepill') return [['GND.1', 'GND.2', 'GND.3'], ['3V3.1', '3V3.2', '3V3.3']];
  if (part.kind === 'teensy41') return [['GND.1', 'GND.2', 'GND.3'], ['3V3.1', '3V3.2']];
  if (part.kind === 'pico2') return [PICO_PINOUT.filter((n) => n.startsWith('GND') || n === 'AGND')];
  if (isPico(part)) return [PICO_PINOUT.filter((n) => n.startsWith('GND') || n === 'AGND')];
  if (part.kind === 'rpi5') return [RPI_HEADER.filter(([n]) => n.startsWith('GND')).map(([n]) => n), ['3V3.1', '3V3.2'], ['5V.1', '5V.2']];
  if (part.kind === 'uno') return [['GND.1', 'GND.2', 'GND.3'], ['SDA', 'A4'], ['SCL', 'A5'], ['IOREF', '5V']]; // ลายทองแดงบนบอร์ด Uno
  if (part.kind === 'nano') return [['GND.1', 'GND.2'], ['RST.1', 'RST.2']];
  if (part.kind === 'nanoconnect') return [['GND.1', 'GND.2']];
  if (part.kind === 'esp32devkitc') return [['GND.1', 'GND.2', 'GND.3']];
  if (part.kind === 'promini') return [['GND.1', 'GND.2'], ['RST.1', 'RST.2']];
  // Mega 2560: GND ทุกขา, 5V ทุกขา (หัวต่อไฟเลี้ยง + หัวต่อคู่), SDA/SCL ข้าง AREF = D20/D21
  if (part.kind === 'mega') return [['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5'], ['5V', '5V.2', '5V.3', 'IOREF'], ['SDA', 'D20'], ['SCL', 'D21']];
  // UNO Q: SDA/SCL (D20/D21, I²C2) เป็นขาแยกจาก A4/A5 (I²C3) ต่างจาก Uno R3 · IOREF = ระดับลอจิก 3.3 V
  if (part.kind === 'unoq') return [['GND.1', 'GND.2', 'GND.3'], ['IOREF', '3V3']];
  if (part.kind === 'servohub') return [['GND', 'SG', 'CH1.G', 'CH2.G', 'CH3.G', 'CH4.G'], ['V+', 'CH1.V', 'CH2.V', 'CH3.V', 'CH4.V'], ['S1', 'CH1.S'], ['S2', 'CH2.S'], ['S3', 'CH3.S'], ['S4', 'CH4.S']];
  if (part.kind === 'hbridge') return [['GND', 'GND.5', 'GND.12', 'GND.13']]; // ขา GND ทั้งสี่ต่อกับแผ่นระบายความร้อนภายใน
  return [];
}

/**
 * ขา Arduino Uno R3 (ชื่อในแอป, ป้าย) — ตำแหน่งตามแบบบอร์ด Uno Rev3 (หัวต่อดิจิทัลบน, ไฟเลี้ยง/แอนะล็อกล่าง)
 * ~ = PWM (Timer0: D5 D6, Timer1: D9 D10, Timer2: D3 D11) · INT0/INT1 = D2/D3 · SPI D10–D13 · I²C A4/A5 (ซ้ำที่ SDA/SCL)
 */
export const UNO_PINOUT: Array<[string, string]> = [
  ['D0', 'D0 RX (Serial ← USB)'], ['D1', 'D1 TX (Serial → USB)'], ['D2', 'D2 · INT0'], ['D3', 'D3 ~PWM · INT1'], ['D4', 'D4'], ['D5', 'D5 ~PWM'], ['D6', 'D6 ~PWM'], ['D7', 'D7'],
  ['D8', 'D8'], ['D9', 'D9 ~PWM'], ['D10', 'D10 ~PWM · SPI SS'], ['D11', 'D11 ~PWM · SPI MOSI'], ['D12', 'D12 · SPI MISO'], ['D13', 'D13 · SPI SCK · LED L บนบอร์ด'],
  ['A0', 'A0 แอนะล็อก (D14)'], ['A1', 'A1 แอนะล็อก (D15)'], ['A2', 'A2 แอนะล็อก (D16)'], ['A3', 'A3 แอนะล็อก (D17)'], ['A4', 'A4 แอนะล็อก · I²C SDA'], ['A5', 'A5 แอนะล็อก · I²C SCL'],
  ['SCL', 'SCL (ต่อกับ A5)'], ['SDA', 'SDA (ต่อกับ A4)'], ['AREF', 'AREF อ้างอิง ADC (ไม่จำลอง)'], ['GND.1', 'GND'],
  ['IOREF', 'IOREF 5 V'], ['RESET', 'RESET (ไม่จำลอง)'], ['3V3', '3.3V ไฟออก (≤ 150 mA)'], ['5V', '5V ไฟออก (USB)'], ['GND.2', 'GND'], ['GND.3', 'GND'], ['VIN', 'VIN (ไฟเข้าจากแจ็ก — ไม่จำลอง)'],
];
export const UNO_DIGITAL = UNO_PINOUT.slice(0, 20).map(([n]) => n);

/**
 * ขา Arduino UNO Q ที่หัวต่อแบบ UNO (ชื่อในแอปเหมือน Uno R3 ตำแหน่งเดียวกัน) — ที่มา: Arduino UNO Q datasheet ABX00162/ABX00173 และ full pinout
 * ลอจิก 3.3 V: ขาส่วนใหญ่ทน 5 V เมื่อเป็นขาเข้า ยกเว้น D3 (PB0, ทนได้ 3.6 V) และ A0–A5 (ห้ามเกิน VDD + 0.3 V ตาม datasheet — แผ่น pinout ระบุเฉพาะ A0/A1)
 * Wire = I²C2 ที่ขา SDA/SCL (D20/D21) · A4/A5 = I²C3 (Wire2) · PWM: D3 D5 D6 D9 D10 D11 · DAC: A0 A1
 */
export const UNOQ_PINOUT: Array<[string, string]> = [
  ['D0', 'D0 (PB7) · Serial1 RX — ไม่จำลอง'], ['D1', 'D1 (PB6) · Serial1 TX — ไม่จำลอง'], ['D2', 'D2 (PB3)'], ['D3', 'D3 (PB0) ~PWM · ทนได้ไม่เกิน 3.6 V'], ['D4', 'D4 (PA12)'], ['D5', 'D5 (PA11) ~PWM'], ['D6', 'D6 (PB1) ~PWM'], ['D7', 'D7 (PB2)'],
  ['D8', 'D8 (PB4)'], ['D9', 'D9 (PB8) ~PWM'], ['D10', 'D10 (PB9) ~PWM · SPI SS'], ['D11', 'D11 (PB15) ~PWM · SPI MOSI'], ['D12', 'D12 (PB14) · SPI MISO'], ['D13', 'D13 (PB13) · SPI SCK'],
  ['A0', 'A0 (PA4) แอนะล็อก · DAC0 · ทนสูงสุด 3.6 V'], ['A1', 'A1 (PA5) แอนะล็อก · DAC1 · ทนสูงสุด 3.6 V'], ['A2', 'A2 (PA6) แอนะล็อก · ทนสูงสุด 3.6 V'], ['A3', 'A3 (PA7) แอนะล็อก · ทนสูงสุด 3.6 V'],
  ['A4', 'A4 (PC1) แอนะล็อก · I²C3 SDA (Wire2 — ไม่จำลอง) · ทนสูงสุด 3.6 V'], ['A5', 'A5 (PC0) แอนะล็อก · I²C3 SCL (Wire2 — ไม่จำลอง) · ทนสูงสุด 3.6 V'],
  ['SCL', 'SCL = D21 (PB10) · I²C2 ของ Wire'], ['SDA', 'SDA = D20 (PB11) · I²C2 ของ Wire'], ['AREF', 'AREF อ้างอิง ADC (ไม่จำลอง)'], ['GND.1', 'GND'],
  ['BOOT', 'BOOT (BOOT0 ของ STM32U585 — ไม่จำลอง)'], ['IOREF', 'IOREF 3.3 V (ระดับลอจิก)'], ['RESET', 'RESET (ไม่จำลอง)'], ['3V3', '3.3V ไฟออก'], ['5V', '5V (5V_SYS จาก USB-C)'], ['GND.2', 'GND'], ['GND.3', 'GND'], ['VIN', 'VIN ไฟเข้า 7–24 V (ไม่จำลอง)'],
];

/**
 * ขา Arduino Mega 2560 Rev3 (ชื่อในแอป, ป้าย) — ตาราง variants/mega/pins_arduino.h ของ ArduinoCore-avr 1.8.6 และเอกสาร ATmega2560
 * PWM: D2–D13 (Timer0/1/2/3/4), D44–D46 (Timer5) · INT0–5 = D21 D20 D19 D18 D2 D3 · Serial1–3 = D19/18, D17/16, D15/14
 * SPI: D50 MISO, D51 MOSI, D52 SCK, D53 SS · I²C: D20 SDA, D21 SCL (ซ้ำที่ขา SDA/SCL ข้าง AREF) · A0–A15 = D54–D69
 */
const MEGA_FN: Record<number, string> = {
  0: 'RX0 (Serial ← USB) · PCINT8', 1: 'TX0 (Serial → USB)', 2: '~PWM (T3B) · INT4', 3: '~PWM (T3C) · INT5', 4: '~PWM (T0B)', 5: '~PWM (T3A)', 6: '~PWM (T4A)', 7: '~PWM (T4B)',
  8: '~PWM (T4C)', 9: '~PWM (T2B)', 10: '~PWM (T2A) · PCINT4', 11: '~PWM (T1A) · PCINT5', 12: '~PWM (T1B) · PCINT6', 13: '~PWM (T0A) · PCINT7 · LED L บนบอร์ด',
  14: 'TX3 (Serial3) · PCINT10', 15: 'RX3 (Serial3) · PCINT9', 16: 'TX2 (Serial2)', 17: 'RX2 (Serial2)', 18: 'TX1 (Serial1) · INT3', 19: 'RX1 (Serial1) · INT2',
  20: 'SDA (I²C) · INT1', 21: 'SCL (I²C) · INT0', 44: '~PWM (T5C)', 45: '~PWM (T5B)', 46: '~PWM (T5A)', 50: 'SPI MISO · PCINT3', 51: 'SPI MOSI · PCINT2', 52: 'SPI SCK · PCINT1', 53: 'SPI SS · PCINT0',
};
export const MEGA_PINOUT: Array<[string, string]> = [
  ...Array.from({ length: 54 }, (_, i): [string, string] => [`D${i}`, `D${i}${MEGA_FN[i] ? ` ${MEGA_FN[i]}` : ''}`]),
  ...Array.from({ length: 16 }, (_, i): [string, string] => [`A${i}`, `A${i} แอนะล็อก (D${54 + i})${i >= 8 ? ` · PCINT${8 + i}` : ''}`]),
  ['SCL', 'SCL (ต่อกับ D21)'], ['SDA', 'SDA (ต่อกับ D20)'], ['AREF', 'AREF อ้างอิง ADC (ไม่จำลอง)'], ['GND.1', 'GND'],
  ['IOREF', 'IOREF 5 V'], ['RESET', 'RESET (ไม่จำลอง)'], ['3V3', '3.3V ไฟออก (≤ 150 mA)'], ['5V', '5V ไฟออก (USB)'], ['GND.2', 'GND'], ['GND.3', 'GND'], ['VIN', 'VIN (ไฟเข้าจากแจ็ก — ไม่จำลอง)'],
  ['5V.2', '5V (หัวต่อคู่ด้านขวา)'], ['5V.3', '5V (หัวต่อคู่ด้านขวา)'], ['GND.4', 'GND (หัวต่อคู่ด้านขวา)'], ['GND.5', 'GND (หัวต่อคู่ด้านขวา)'],
];
/** ลำดับขาที่ตัวจำลองใช้: D0–D53, A0–A15 (= D54–D69) */
export const MEGA_DIGITAL = MEGA_PINOUT.slice(0, 70).map(([n]) => n);

/** ขาบอร์ดกระจายไฟเซอร์โว 4 ช่อง */
export const SERVOHUB_PINS: Array<[string, string]> = [
  ['V+', 'V+ ไฟเข้า (ขั้วสกรู) — 5–6 V สำหรับเซอร์โว'], ['GND', 'GND ไฟเข้า (ขั้วสกรู)'],
  ['S1', 'S1 สัญญาณ PWM เข้าช่อง 1 (จากบอร์ด)'], ['S2', 'S2 สัญญาณ PWM เข้าช่อง 2'], ['S3', 'S3 สัญญาณ PWM เข้าช่อง 3'], ['S4', 'S4 สัญญาณ PWM เข้าช่อง 4'], ['SG', 'GND สัญญาณ (ต่อกับ GND ของบอร์ด — กราวด์ร่วม)'],
  ...[1, 2, 3, 4].flatMap((k) => [[`CH${k}.S`, `ช่อง ${k} S สัญญาณ (สายส้มของเซอร์โว)`], [`CH${k}.V`, `ช่อง ${k} V+ (สายแดง)`], [`CH${k}.G`, `ช่อง ${k} GND (สายน้ำตาล)`]] as Array<[string, string]>),
];

/**
 * ขา Arduino Nano (หัวต่อ 2 แถว × 15 ขา ระยะแถว 0.6") ตามลำดับเลขขา 1–30 (ชื่อในแอป, ป้าย)
 * ขา 1–15: D1/TX D0/RX RESET GND D2…D12 · ขา 16–30: D13 3V3 AREF A0…A7 5V RESET GND VIN — ขา 15/16 (D12/D13) อยู่ฝั่งหัว USB
 * แหล่งข้อมูล: แผ่น pinout ของ Arduino Nano และเอกสารบอร์ด (3V3 ≤ 50 mA, A6/A7 เป็นขาแอนะล็อกอย่างเดียว)
 */
export const NANO_PINOUT: Array<[string, string]> = [
  ['D1', 'ขา 1 D1 TX (Serial → USB)'], ['D0', 'ขา 2 D0 RX (Serial ← USB)'], ['RST.1', 'ขา 3 RESET (ไม่จำลอง)'], ['GND.1', 'ขา 4 GND'],
  ['D2', 'ขา 5 D2 · INT0'], ['D3', 'ขา 6 D3 ~PWM · INT1'], ['D4', 'ขา 7 D4'], ['D5', 'ขา 8 D5 ~PWM'], ['D6', 'ขา 9 D6 ~PWM'], ['D7', 'ขา 10 D7'],
  ['D8', 'ขา 11 D8'], ['D9', 'ขา 12 D9 ~PWM'], ['D10', 'ขา 13 D10 ~PWM · SPI SS'], ['D11', 'ขา 14 D11 ~PWM · SPI MOSI'], ['D12', 'ขา 15 D12 · SPI MISO'],
  ['D13', 'ขา 16 D13 · SPI SCK · LED L บนบอร์ด'], ['3V3', 'ขา 17 3V3 ไฟออก (≤ 50 mA)'], ['AREF', 'ขา 18 AREF อ้างอิง ADC (ไม่จำลอง)'],
  ['A0', 'ขา 19 A0 แอนะล็อก (D14)'], ['A1', 'ขา 20 A1 แอนะล็อก (D15)'], ['A2', 'ขา 21 A2 แอนะล็อก (D16)'], ['A3', 'ขา 22 A3 แอนะล็อก (D17)'],
  ['A4', 'ขา 23 A4 แอนะล็อก · I²C SDA'], ['A5', 'ขา 24 A5 แอนะล็อก · I²C SCL'], ['A6', 'ขา 25 A6 แอนะล็อกอย่างเดียว (ใช้เป็นขาดิจิทัลไม่ได้)'], ['A7', 'ขา 26 A7 แอนะล็อกอย่างเดียว (ใช้เป็นขาดิจิทัลไม่ได้)'],
  ['5V', 'ขา 27 5V ไฟออก (USB)'], ['RST.2', 'ขา 28 RESET (ไม่จำลอง)'], ['GND.2', 'ขา 29 GND'], ['VIN', 'ขา 30 VIN ไฟเข้า 7–12 V (ไม่จำลอง)'],
];
/**
 * ขา Arduino Pro Mini 328 (แบบเปิดของ SparkFun) — ตำแหน่งจาก footprint Arduino_Pro_Mini_Socket ของ KiCad Library for Arduino (Alarm-Siren, CC BY-SA 4.0)
 * PCB 17.78 × 33.02 mm (0.7" × 1.3") · ขาสองแถว × 12 ขา ระยะแถว 15.24 mm (0.6") · หัว 6 ขาที่ปลาย (BLK GND VCC RXI TXO GRN) ต่อตัวแปลง USB-serial
 * แถว A (dy 0): TXO(D1) RXI(D0) RST GND D2…D9 · แถว B (dy −6): RAW GND RST VCC A3 A2 A1 A0 D13 D12 D11 D10 · A4/A5/A6/A7 = รูภายในบนบอร์ด (ไม่ได้เสียบเบรดบอร์ด)
 * dx = (y + 12.7) / 2.54, dy = −(x + 7.62) / 2.54 จากพิกัด footprint (mm, มองด้านบน)
 */
export const PROMINI_ROW_A: Array<[string, string]> = [
  ['D1', 'TXO · D1 TX (Serial → ตัวแปลง USB-serial)'], ['D0', 'RXI · D0 RX (Serial ← ตัวแปลง USB-serial)'], ['RST.1', 'RST รีเซ็ต (ไม่จำลอง)'], ['GND.1', 'GND'],
  ['D2', 'D2 · INT0'], ['D3', 'D3 ~PWM · INT1'], ['D4', 'D4'], ['D5', 'D5 ~PWM'], ['D6', 'D6 ~PWM'], ['D7', 'D7'], ['D8', 'D8'], ['D9', 'D9 ~PWM'],
];
export const PROMINI_ROW_B: Array<[string, string]> = [
  ['RAW', 'RAW ไฟเข้าเรกูเลเตอร์บนบอร์ด (≤ 12 V) — ไม่จำลอง: ตัวจำลองใช้ไฟจากตัวแปลง USB-serial'], ['GND.2', 'GND'], ['RST.2', 'RST รีเซ็ต (ไม่จำลอง)'],
  ['VCC', 'VCC ไฟเลี้ยงชิป (ต่อตรงกับ VCC ของตัวแปลง USB-serial)'], ['A3', 'A3 แอนะล็อก (D17)'], ['A2', 'A2 แอนะล็อก (D16)'], ['A1', 'A1 แอนะล็อก (D15)'], ['A0', 'A0 แอนะล็อก (D14)'],
  ['D13', 'D13 · SPI SCK · LED บนบอร์ด'], ['D12', 'D12 · SPI MISO'], ['D11', 'D11 ~PWM · SPI MOSI'], ['D10', 'D10 ~PWM · SPI SS'],
];
/** รูภายในบนบอร์ด: [ชื่อ, ป้าย, dx, dy] */
export const PROMINI_TOP: Array<[string, string, number, number]> = [
  ['A5', 'A5 แอนะล็อก · I²C SCL (รูบนบอร์ด — ต่อสายที่ขา)', 3.453, -4.848], ['A4', 'A4 แอนะล็อก · I²C SDA (รูบนบอร์ด — ต่อสายที่ขา)', 4.453, -4.848],
  ['A7', 'A7 แอนะล็อกอย่างเดียว (รูบนบอร์ด — ใช้เป็นขาดิจิทัลไม่ได้)', 7.553, -4.848], ['A6', 'A6 แอนะล็อกอย่างเดียว (รูบนบอร์ด — ใช้เป็นขาดิจิทัลไม่ได้)', 8.553, -4.848],
];

/**
 * ขา ATtiny85 (PDIP-8) ตามเลขขา 1–8 — datasheet Atmel-2586 รูป 1-1 และ ArduinoCore-avr variants/gemma (D0–D5 = PB0–PB5, A1 = PB2, A2 = PB4, A3 = PB3)
 * ขา 1 (PB5) เป็น RESET ตามค่า fuse เริ่มต้น (RSTDISBL ไม่ได้ตั้ง) — ไม่ใช้เป็นขา I/O ในแอป
 */
export const ATTINY85_PINOUT: Array<[string, string]> = [
  ['PB5', 'ขา 1 RESET (PB5) · ดึงต่ำ = รีเซ็ต · มีตัวดึงขึ้นภายใน'], ['PB3', 'ขา 2 PB3 · D3 · A3 (ADC3)'], ['PB4', 'ขา 3 PB4 · D4 ~PWM (OC1B) · A2 (ADC2)'], ['GND', 'ขา 4 GND'],
  ['PB0', 'ขา 5 PB0 · D0 ~PWM (OC0A) · AREF · MOSI/SDA ของ USI (ไม่จำลอง)'], ['PB1', 'ขา 6 PB1 · D1 ~PWM (OC0B) · MISO ของ USI (ไม่จำลอง)'],
  ['PB2', 'ขา 7 PB2 · D2 · A1 (ADC1) · INT0 · SCK/SCL ของ USI (ไม่จำลอง)'], ['VCC', 'ขา 8 VCC ไฟเลี้ยง 2.7–5.5 V (ต่อจากแหล่งจ่าย)'],
];
/** ลำดับขาที่ตัวจำลองใช้: D0–D5 = PB0–PB5 */
export const ATTINY85_DIGITAL = ['PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5'];

/** ลำดับขาที่ตัวจำลองใช้: D0–D13, A0–A7 (ช่อง 20–21 = A6/A7 อ่าน ADC ได้อย่างเดียว) — Pro Mini ใช้ลำดับเดียวกัน */
export const NANO_DIGITAL = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

/**
 * หัวต่อ GPIO 40 ขา (J8) ของ Raspberry Pi 5 ตามลำดับเลขขา 1–40 (ชื่อในแอป, ป้าย) — ขาคี่แถวใน ขาคู่แถวริมบอร์ด
 * ที่มา: เอกสาร Raspberry Pi (GPIO header) และ pinout.xyz · GPIO2/GPIO3 มีตัวต้านทานดึงขึ้น 1.8 kΩ บนบอร์ด (I²C)
 */
const RPI_FN: Record<number, string> = { 2: 'I²C1 SDA (ดึงขึ้น 1.8 kΩ)', 3: 'I²C1 SCL (ดึงขึ้น 1.8 kΩ)', 4: 'GPCLK0', 14: 'UART TXD', 15: 'UART RXD', 18: 'PCM CLK · PWM0', 12: 'PWM0', 13: 'PWM1', 19: 'PCM FS · PWM1', 10: 'SPI0 MOSI', 9: 'SPI0 MISO', 11: 'SPI0 SCLK', 8: 'SPI0 CE0', 7: 'SPI0 CE1', 0: 'ID_SD (EEPROM HAT)', 1: 'ID_SC (EEPROM HAT)' };
const RPI_PHYS: Array<string | number> = ['3V3', '5V', 2, '5V', 3, 'GND', 4, 14, 'GND', 15, 17, 18, 27, 'GND', 22, 23, '3V3', 24, 10, 'GND', 9, 25, 11, 8, 'GND', 7, 0, 1, 5, 'GND', 6, 12, 13, 'GND', 19, 16, 26, 20, 'GND', 21];
export const RPI_HEADER: Array<[string, string]> = (() => {
  const seen: Record<string, number> = {};
  return RPI_PHYS.map((x, i) => {
    const pin = i + 1;
    if (typeof x === 'number') return [`GPIO${x}`, `ขา ${pin} · GPIO${x}${RPI_FN[x] ? ` · ${RPI_FN[x]}` : ''}`] as [string, string];
    seen[x] = (seen[x] ?? 0) + 1;
    const lab = x === 'GND' ? 'GND กราวด์' : x === '3V3' ? '3V3 ไฟออก 3.3 V' : '5V ต่อตรงกับไฟเข้า USB-C';
    return [`${x}.${seen[x]}`, `ขา ${pin} · ${lab}`] as [string, string];
  });
})();
/** ขา GPIO0–27 → ชื่อขาในแอป */
export const RPI_GPIO_PINS = Array.from({ length: 28 }, (_, i) => `GPIO${i}`);

/** ตัวอย่างเริ่มต้นของ Raspberry Pi 5: LED กะพริบที่ GPIO17 */
export const RPI_DEFAULT_CODE = `from gpiozero import LED
from time import sleep

led = LED(17)          # GPIO17 = ขา 11 ของหัวต่อ

while True:
    led.on()
    print("ติด")
    sleep(0.5)
    led.off()
    print("ดับ")
    sleep(0.5)
`;
/** ตัวอย่างแลป 54: ปุ่มที่ GPIO27 ควบคุม LED ที่ GPIO17 ด้วย callback และ PWMLED หรี่แสงที่ GPIO18 */
export const RPI_BUTTON_CODE = `from gpiozero import LED, PWMLED, Button
from signal import pause

led = LED(17)          # ขา 11
glow = PWMLED(18)      # ขา 12 — PWM ซอฟต์แวร์ 100 Hz
button = Button(27)    # ขา 13 · ปุ่มต่อลง GND (ใช้ pull-up ภายใน กด = LOW)
count = 0

def pressed():
    global count
    count += 1
    led.on()
    glow.value = min(1.0, count / 4)
    print("กดปุ่มครั้งที่", count, "ความสว่าง", glow.value)

def released():
    led.off()

button.when_pressed = pressed
button.when_released = released
print("พร้อม — กดปุ่มที่ GPIO27")
pause()
`;
/** ตัวอย่างแลป 45: สแกนบัส I²C แล้วแสดงข้อความ + ตัวนับบนจอ OLED */
export const OLED_CODE = `from machine import Pin, I2C
import ssd1306, time

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)
print("found:", [hex(a) for a in i2c.scan()])
oled = ssd1306.SSD1306_I2C(128, 64, i2c)   # 0x3C

n = 0
while True:
    oled.fill(0)
    oled.text("Circuit Lab", 20, 8)
    oled.text("Pico + OLED", 20, 24)
    oled.text("count %d" % n, 28, 44)
    oled.show()
    n += 1
    time.sleep(0.5)
`;

/**
 * ตัวอย่างแลป 46 (smart watch บน Pico): เวลา DS3231, นับก้าวจาก MPU6050, ปุ่มสลับหน้า, สั่นทุก 10 ก้าว
 * อ่านรีจิสเตอร์ตรงด้วย readfrom_mem (ไม่ต้องใช้ไลบรารีของ RTC/MPU) · จอใช้ ssd1306.py ที่อยู่ในบอร์ดแล้ว
 */
export const WATCH_CODE = `from machine import Pin, I2C
import time, ssd1306

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)
print("I2C:", [hex(a) for a in i2c.scan()])
oled = ssd1306.SSD1306_I2C(128, 64, i2c)   # 0x3C
RTC = 0x68                                  # DS3231
MPU = 0x69                                  # MPU6050 (AD0 -> 3V3)
btn = Pin(15, Pin.IN, Pin.PULL_UP)
vib = Pin(16, Pin.OUT)

def bcd(b):
    return (b >> 4) * 10 + (b & 0x0F)

def clock():
    s, m, h = i2c.readfrom_mem(RTC, 0x00, 3)
    return bcd(h & 0x3F), bcd(m), bcd(s & 0x7F)

def accel():
    d = i2c.readfrom_mem(MPU, 0x3B, 6)
    g = []
    for k in (0, 2, 4):
        v = d[k] << 8 | d[k + 1]
        if v > 32767:
            v -= 65536
        g.append(v / 16384)                 # สเกล ±2 g
    return (g[0] ** 2 + g[1] ** 2 + g[2] ** 2) ** 0.5

i2c.writeto_mem(MPU, 0x6B, b"\\x00")       # ปลุก MPU6050 (หลังจ่ายไฟอยู่ในโหมดหลับ)

steps = 0
high = False
page = 0
last = 1
buzz = 0
GOAL = 10

while True:
    a = accel()
    if a > 1.2 and not high:                # ยอดความเร่ง = 1 ก้าว
        high = True
        steps += 1
        if steps % GOAL == 0:               # ครบทุก 10 ก้าว สั่น 0.4 s (ไม่หยุดรอ)
            vib.on()
            buzz = time.ticks_add(time.ticks_ms(), 400)
    elif a < 1.05:
        high = False
    if vib.value() and time.ticks_diff(time.ticks_ms(), buzz) > 0:
        vib.off()
    b = btn.value()
    if b == 0 and last == 1:                # กดปุ่ม = สลับหน้า
        page = 1 - page
    last = b
    oled.fill(0)
    if page == 0:
        h, m, s = clock()
        oled.text("%02d:%02d:%02d" % (h, m, s), 32, 16)
        oled.text("Steps %d" % steps, 32, 40)
    else:
        t = i2c.readfrom_mem(RTC, 0x11, 1)[0]
        oled.text("Temp %d C" % t, 28, 28)
    oled.show()
    time.sleep_ms(20)
`;

/**
 * ตัวอย่างแลป 47 (นาฬิกาจอกลม บน Pico): จอ GC9A01 ผ่าน SPI1 (ไดรเวอร์ gc9a01py — มีในบอร์ดแล้ว) วาดรูป bg.bin เป็นหน้าปัด
 * ทัช CST816S + DS3231 + QMI8658 บน I2C1 (GP6/GP7) · ปัดซ้าย/ขวาเปลี่ยนหน้า · สั่นทุก 10 ก้าว
 */
export const ROUND_WATCH_CODE = `from machine import Pin, SPI, I2C
import time, struct
import gc9a01py as gc9a01
import vga1_bold_16x32 as BIG
import vga1_8x16 as SMALL

spi = SPI(1, baudrate=40_000_000, sck=Pin(10), mosi=Pin(11), miso=Pin(12))
tft = gc9a01.GC9A01(spi, dc=Pin(8, Pin.OUT), cs=Pin(9, Pin.OUT),
                    reset=Pin(13, Pin.OUT), backlight=Pin(14, Pin.OUT))
i2c = I2C(1, sda=Pin(6), scl=Pin(7), freq=400_000)
tp_rst = Pin(16, Pin.OUT)
tp_int = Pin(17, Pin.IN, Pin.PULL_UP)
vib = Pin(18, Pin.OUT, value=0)
TP, RTC, IMU = 0x15, 0x68, 0x6A

tp_rst(0); time.sleep_ms(10); tp_rst(1); time.sleep_ms(50)   # รีเซ็ตชิปทัช
i2c.writeto_mem(TP, 0xFA, b"\\x10")      # IrqCtl: INT เมื่อจำท่าทางได้ (ปัด/แตะ)
i2c.writeto_mem(TP, 0xFE, b"\\x01")      # ไม่เข้าโหมดประหยัดพลังงานเอง
print("I2C:", [hex(a) for a in i2c.scan()])
i2c.writeto_mem(IMU, 0x02, b"\\x40")     # CTRL1: อ่านต่อเนื่อง (ADDR_AI) + ไบต์ต่ำก่อน
i2c.writeto_mem(IMU, 0x03, b"\\x15")     # CTRL2: ±4 g (8192 ต่อ g), 250 Hz
i2c.writeto_mem(IMU, 0x08, b"\\x01")     # CTRL7: เปิดความเร่ง

touched = False
def on_touch(pin):                       # ขอบลงของ TP_INT = ทัชมีข้อมูลใหม่
    global touched
    touched = True
tp_int.irq(on_touch, Pin.IRQ_FALLING)

bg = open("bg.bin", "rb")                # รูป 240x240 RGB565 (เปลี่ยนรูปได้ที่แผงของ Pico)

def bg_box(x, y, w, h):                  # อ่านรูปพื้นหลังเฉพาะกรอบ
    buf = bytearray(w * h * 2)
    mv = memoryview(buf)
    for r in range(h):
        bg.seek(((y + r) * 240 + x) * 2)
        bg.readinto(mv[r * w * 2:(r + 1) * w * 2])
    return buf

def put_text(buf, w, x, y, s, font, color):   # วาดตัวอักษรทับรูป (ไม่มีพื้น)
    hi, lo = color >> 8, color & 0xFF
    bpr = font.WIDTH // 8
    for ch in s:
        i = (ord(ch) - font.FIRST) * font.HEIGHT * bpr
        for r in range(font.HEIGHT):
            bits = font.FONT[i + r * bpr]
            if bpr == 2:
                bits = bits << 8 | font.FONT[i + r * bpr + 1]
            o = ((y + r) * w + x) * 2
            c = font.WIDTH - 1
            while bits:
                if bits & 1:
                    buf[o + c * 2] = hi
                    buf[o + c * 2 + 1] = lo
                bits >>= 1
                c -= 1
        x += font.WIDTH

def bcd(b):
    return (b >> 4) * 10 + (b & 0x0F)

def clock():
    s, m, h = i2c.readfrom_mem(RTC, 0x00, 3)
    return bcd(h & 0x3F), bcd(m), bcd(s & 0x7F)

def draw():
    if page == 0:                        # หน้าปัด: รูป + เวลา + จำนวนก้าว
        buf = bytearray(240 * 20 * 2)
        bg.seek(0)
        for y in range(0, 240, 20):
            bg.readinto(buf)
            tft.blit_buffer(buf, 0, y, 240, 20)
        tick()
    elif page == 1:                      # หน้าจำนวนก้าว
        tft.fill(gc9a01.color565(20, 30, 60))
        tft.text(SMALL, "STEPS", 100, 70, gc9a01.CYAN, gc9a01.color565(20, 30, 60))
        tft.text(BIG, "%5d" % steps, 80, 100, gc9a01.WHITE, gc9a01.color565(20, 30, 60))
        tft.text(SMALL, "GOAL %d" % GOAL, 88, 150, gc9a01.YELLOW, gc9a01.color565(20, 30, 60))
    else:                                # หน้าอุณหภูมิ
        tft.fill(gc9a01.color565(60, 20, 20))
        t = i2c.readfrom_mem(RTC, 0x11, 1)[0]
        tft.text(SMALL, "TEMP", 104, 80, gc9a01.YELLOW, gc9a01.color565(60, 20, 20))
        tft.text(BIG, "%d C" % t, 88, 104, gc9a01.WHITE, gc9a01.color565(60, 20, 20))

def tick():                              # อัปเดตเวลา/ก้าวบนหน้าปัด (ทับรูปเฉพาะกรอบ)
    h, m, s = clock()
    box = bg_box(56, 84, 128, 32)
    put_text(box, 128, 0, 0, "%02d:%02d:%02d" % (h, m, s), BIG, gc9a01.WHITE)
    tft.blit_buffer(box, 56, 84, 128, 32)
    box = bg_box(64, 132, 112, 16)
    put_text(box, 112, 0, 0, "Steps %d" % steps, SMALL, gc9a01.WHITE)
    tft.blit_buffer(box, 64, 132, 112, 16)

def accel():
    x, y, z = struct.unpack("<hhh", i2c.readfrom_mem(IMU, 0x35, 6))
    return (x * x + y * y + z * z) ** 0.5 / 8192

def buzz(ms):
    global buzz_until
    vib.on()
    buzz_until = time.ticks_add(time.ticks_ms(), ms)

steps, high, page, GOAL = 0, False, 0, 10
buzz_until = 0
draw()
last = time.ticks_ms()
while True:
    a = accel()
    if a > 1.2 and not high:             # ยอดความเร่ง = 1 ก้าว
        high = True
        steps += 1
        if steps % GOAL == 0:
            buzz(400)                    # ครบทุก 10 ก้าว สั่น 0.4 s
        if page == 1:
            draw()
    elif a < 1.05:
        high = False
    if touched:                          # ทัชส่งพัลส์ INT → อ่านท่าทาง
        touched = False
        g = i2c.readfrom_mem(TP, 0x01, 1)[0]
        if g == 3 or g == 4:             # ปัดซ้าย/ขวา = เปลี่ยนหน้า
            page = (page + (1 if g == 3 else -1)) % 3
            buzz(60)
            draw()
    if page == 0 and time.ticks_diff(time.ticks_ms(), last) >= 1000:
        last = time.ticks_add(last, 1000)
        tick()
    if vib.value() and time.ticks_diff(time.ticks_ms(), buzz_until) > 0:
        vib.off()
    time.sleep_ms(20)
`;

/**
 * ตัวอย่างแลป 48 (สถานีตรวจอากาศ บน Pico): จอ LCD 16×2 แบบ I²C (ไลบรารี machine_i2c_lcd — มีในบอร์ดแล้ว) + BMP280 + BH1750 บน I2C0
 * ชดเชยค่า BMP280 ด้วยสูตรทศนิยมจากดาต้าชีต (ภาคผนวก 8.1)
 */
export const WEATHER_CODE = `from machine import Pin, I2C
import time, struct
from machine_i2c_lcd import I2cLcd

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=100_000)
print("I2C:", [hex(a) for a in i2c.scan()])
lcd = I2cLcd(i2c, 0x27, 2, 16)          # LCD 16x2 ที่ 0x27
BMP, BH = 0x76, 0x23

# BMP280: ค่าปรับเทียบ 0x88-0x9F (T1, P1 ไม่มีเครื่องหมาย ที่เหลือมีเครื่องหมาย)
T1, T2, T3, P1, P2, P3, P4, P5, P6, P7, P8, P9 = struct.unpack("<HhhHhhhhhhhh", i2c.readfrom_mem(BMP, 0x88, 24))
i2c.writeto_mem(BMP, 0xF4, b"\\x27")     # osrs_t x1, osrs_p x1, โหมด normal (วัดต่อเนื่อง)
i2c.writeto(BH, b"\\x10")                # BH1750: วัดต่อเนื่อง ละเอียด 1 lx
time.sleep_ms(180)                       # รอวัดรอบแรก (BH1750 ≈ 120 ms)

def bmp280():
    d = i2c.readfrom_mem(BMP, 0xF7, 6)
    adc_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
    adc_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
    v1 = (adc_t / 16384 - T1 / 1024) * T2
    v2 = (adc_t / 131072 - T1 / 8192) ** 2 * T3
    t_fine = int(v1 + v2)
    t = (v1 + v2) / 5120
    v1 = t_fine / 2 - 64000
    v2 = v1 * v1 * P6 / 32768 + v1 * P5 * 2
    v2 = v2 / 4 + P4 * 65536
    v1 = (P3 * v1 * v1 / 524288 + P2 * v1) / 524288
    v1 = (1 + v1 / 32768) * P1
    p = 1048576 - adc_p
    p = (p - v2 / 4096) * 6250 / v1
    p = p + (P9 * p * p / 2147483648 + p * P8 / 32768 + P7) / 16
    return t, p / 100                    # องศาเซลเซียส, hPa

def lux():
    hi, lo = i2c.readfrom(BH, 2)
    return (hi << 8 | lo) / 1.2

while True:
    t, p = bmp280()
    lx = lux()
    print("T=%.2f C  P=%.2f hPa  L=%.1f lx" % (t, p, lx))
    lcd.move_to(0, 0)
    lcd.putstr("T%5.1f" % t + chr(223) + "C%6dlx" % round(lx))   # chr(223) = องศา ในฟอนต์ของจอ
    lcd.move_to(0, 1)
    lcd.putstr("P %7.1f hPa  " % p)
    time.sleep(1)
`;

/**
 * ตัวอย่างแลป 49 (เครื่องวัดกำลังไฟฟ้า บน Pico): INA219 บน I2C0 + จอ 7 ส่วน TM1637 ที่ GP14/GP15 (ไลบรารี tm1637 — มีในบอร์ดแล้ว)
 * calibration = 4096 กับ shunt 0.1 Ω → กระแส 0.1 mA ต่อบิต, กำลัง 2 mW ต่อบิต (สูตรในดาต้าชีต INA219 หัวข้อ 8.5.1)
 */
export const POWER_METER_CODE = `from machine import Pin, I2C
import time
from tm1637 import TM1637

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400_000)
print("I2C:", [hex(a) for a in i2c.scan()])
INA = 0x40

def wr(reg, v):
    i2c.writeto_mem(INA, reg, bytes([v >> 8, v & 0xFF]))

def rd(reg):
    hi, lo = i2c.readfrom_mem(INA, reg, 2)
    v = (hi << 8) | lo
    return v - 65536 if v > 32767 else v   # รีจิสเตอร์ shunt/กระแสมีเครื่องหมาย

wr(0x00, 0x399F)   # 32 V, ±320 mV, ADC 12 บิต, วัดต่อเนื่อง (ค่าเริ่มต้น)
wr(0x05, 4096)     # calibration: 0.04096 / (0.1 mA × 0.1 Ω) = 4096
tm = TM1637(clk=Pin(14), dio=Pin(15), brightness=5)

while True:
    vbus = (rd(0x02) >> 3) * 0.004      # V (4 mV ต่อบิต)
    vsh = rd(0x01) * 0.01               # mV (10 µV ต่อบิต)
    i_ma = rd(0x04) * 0.1               # mA
    p_mw = (rd(0x03) & 0xFFFF) * 2      # mW
    tm.number(round(i_ma))              # จอแสดงกระแส (mA)
    print("V=%.3f V  I=%.1f mA  P=%d mW  Vshunt=%.2f mV" % (vbus, i_ma, p_mw, vsh))
    time.sleep(0.5)
`;

/**
 * ตัวอย่างแลป 50 (กุญแจรหัสผ่าน บน Pico): สแกนปุ่มกด 4×4 (แถว GP6–GP9 เอาต์พุต, คอลัมน์ GP10–GP13 ขาเข้า PULL_UP)
 * จอ TM1637 ที่ GP14/GP15 แสดงตัวเลขที่พิมพ์ · # = ยืนยัน → LED เขียว GP16 (ถูก) / LED แดง GP17 (ผิด) · * = ล้างและล็อกใหม่
 */
export const KEYPAD_LOCK_CODE = `from machine import Pin
import time
from tm1637 import TM1637

ROWS = [Pin(n, Pin.OUT, value=1) for n in (6, 7, 8, 9)]
COLS = [Pin(n, Pin.IN, Pin.PULL_UP) for n in (10, 11, 12, 13)]
KEYS = ("123A", "456B", "789C", "*0#D")
tm = TM1637(clk=Pin(14), dio=Pin(15))
green = Pin(16, Pin.OUT, value=0)
red = Pin(17, Pin.OUT, value=0)
CODE = "2580"                          # รหัสที่ถูกต้อง

def scan():
    for r, row in enumerate(ROWS):
        row.value(0)                   # ดึงแถวนี้ลง แล้วดูว่าคอลัมน์ไหนต่ำตาม
        for c, col in enumerate(COLS):
            if col.value() == 0:
                row.value(1)
                return KEYS[r][c]
        row.value(1)
    return None

entered = ""
last = None
tm.show("----")
while True:
    k = scan()
    if k and k != last:                # นับครั้งเดียวต่อการกดหนึ่งครั้ง
        print("key:", k)
        red.off()
        if k == "*":
            entered = ""
            green.off()
        elif k == "#":
            if entered == CODE:
                print("OPEN")
                green.on()
            else:
                print("WRONG")
                red.on()
            entered = ""
        elif k in "0123456789" and len(entered) < 4:
            entered += k
        tm.show((entered + "----")[:4])
    last = k
    time.sleep_ms(20)
`;

/**
 * ตัวอย่างแลป 51 (ตัวนับด้วย rotary encoder + จอยสติ๊ก บน Pico): encoder CLK GP22 / DT GP21 / SW GP20 · จอยสติ๊ก VRx GP26 / VRy GP27 / SW GP19
 * หมุนตามเข็ม +1 ต่อคลิก (อินเทอร์รัปต์ขอบลงของ CLK) · ดันก้านขึ้น +10 / ดึงลง −10 ทุก 0.1 s · กดลูกบิดหรือกดก้าน = 0 · แสดงบน TM1637
 */
export const ENCODER_COUNTER_CODE = `from machine import Pin, ADC
import time
from tm1637 import TM1637

tm = TM1637(clk=Pin(14), dio=Pin(15))
clk = Pin(22, Pin.IN)                  # KY-040 มีตัวดึงขึ้น CLK/DT บนโมดูลแล้ว
dt = Pin(21, Pin.IN)
sw = Pin(20, Pin.IN, Pin.PULL_UP)      # SW ไม่มีตัวดึงขึ้นบนโมดูล
jx = ADC(Pin(26))
jy = ADC(Pin(27))
jsw = Pin(19, Pin.IN, Pin.PULL_UP)

value = 0

def on_clk(pin):
    global value
    # CLK เพิ่งลง: DT ยังสูง = หมุนตามเข็ม, DT ต่ำแล้ว = ทวนเข็ม
    value += 1 if dt.value() else -1

clk.irq(trigger=Pin.IRQ_FALLING, handler=on_clk)

shown = None
while True:
    y = jy.read_u16()
    if y > 50000:
        value += 10
    elif y < 15000:
        value -= 10
    if sw.value() == 0 or jsw.value() == 0:
        value = 0
    value = max(-999, min(9999, value))
    if value != shown:
        tm.number(value)
        print("value:", value, " x:", jx.read_u16(), " y:", y)
        shown = value
    time.sleep_ms(100)
`;

/**
 * ตัวอย่างแลป 52 (ปุ่มกด: ดึงขึ้น/ดึงลง บน Pico): SW1 ระหว่าง 3V3 กับ GP14 + ตัวต้านทานดึงลง 10 kΩ ภายนอก · SW2 ระหว่าง GND กับ GP15 + ดึงขึ้นภายใน
 * LED1 (GP16) ติดเมื่อกด SW1 · LED2 (GP17) ติดเมื่อกด SW2 · พิมพ์ค่าที่อ่านได้เมื่อเปลี่ยน และนับจำนวนครั้งที่กด
 */
export const PULLDOWN_CODE = `from machine import Pin
import time

sw1 = Pin(14, Pin.IN)                  # ตัวต้านทานดึงลง 10 kΩ ภายนอก: ปล่อย = 0, กด = 1
sw2 = Pin(15, Pin.IN, Pin.PULL_UP)     # ตัวต้านทานดึงขึ้นภายใน Pico: ปล่อย = 1, กด = 0
led1 = Pin(16, Pin.OUT)
led2 = Pin(17, Pin.OUT)

n1 = n2 = 0
last1 = last2 = None
while True:
    a = sw1.value()
    b = sw2.value()
    led1.value(a)                      # กด SW1 (a = 1) → LED1 ติด
    led2.value(1 - b)                  # กด SW2 (b = 0) → LED2 ติด
    if a == 1 and last1 == 0:
        n1 += 1
    if b == 0 and last2 == 1:
        n2 += 1
    if a != last1 or b != last2:
        print("SW1 =", a, " SW2 =", b, " presses:", n1, n2)
    last1, last2 = a, b
    time.sleep_ms(20)
`;

/**
 * ตัวอย่างแลป 53 (ระบบกันขโมย บน Pico): PIR HC-SR501 OUT → GP14 · FC-51 OUT → GP15 (พบวัตถุ = 0) · DHT11 DATA → GP13
 * LED แดง GP16 = ตรวจพบความเคลื่อนไหว · LED เหลือง GP17 = มีวัตถุหน้าเซนเซอร์ IR · พิมพ์อุณหภูมิ/ความชื้นทุก 2 วินาที
 */
export const ALARM_CODE = `from machine import Pin
import time, dht

pir = Pin(14, Pin.IN)                  # HC-SR501: OUT 3.3 V เมื่อตรวจพบ (ขับเองทั้งสูง/ต่ำ)
obs = Pin(15, Pin.IN)                  # FC-51: ดึงขึ้นบนโมดูลแล้ว — พบวัตถุ = 0
alarm = Pin(16, Pin.OUT)
door = Pin(17, Pin.OUT)
sensor = dht.DHT11(Pin(13))

last = time.ticks_add(time.ticks_ms(), -1000)  # อ่าน DHT11 ครั้งแรกหลังเริ่ม 1 s (เอกสาร: ห้ามสั่งงานภายใน 1 s หลังจ่ายไฟ)
was = 0
while True:
    m = pir.value()
    alarm.value(m)
    door.value(1 - obs.value())
    if m and not was:
        print("MOTION!")
    was = m
    if time.ticks_diff(time.ticks_ms(), last) >= 2000:
        last = time.ticks_ms()
        sensor.measure()
        print("T=%d C  H=%d %%  PIR=%d  OBS=%d" % (sensor.temperature(), sensor.humidity(), m, obs.value()))
    time.sleep_ms(50)
`;

/** ตัวอย่างแลป 44: LED RGB แคโทดร่วมที่ขา ~9 ~10 ~11 วนสีทุก 0.5 s */
export const UNO_RGB_CODE = `// LED RGB แคโทดร่วม: R → D9, G → D10, B → D11 (ขา ~PWM)
const int PIN_R = 9, PIN_G = 10, PIN_B = 11;

void setColor(int r, int g, int b) {
  analogWrite(PIN_R, r);
  analogWrite(PIN_G, g);
  analogWrite(PIN_B, b);
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  setColor(255, 0, 0);   Serial.println("red");     delay(500);
  setColor(0, 255, 0);   Serial.println("green");   delay(500);
  setColor(0, 0, 255);   Serial.println("blue");    delay(500);
  setColor(255, 255, 0); Serial.println("yellow");  delay(500);
  setColor(255, 0, 255); Serial.println("magenta"); delay(500);
  setColor(64, 0, 0);    Serial.println("dim red"); delay(500);
  setColor(0, 0, 0);     Serial.println("off");     delay(500);
}
`;

/** แลป 56: PWM ที่ D9 + ข้อความ Serial ทุก 0.2 s (ดูด้วยเครื่องวิเคราะห์ลอจิก) */
export const UNO_LA_CODE = `// แลป 56: ดู PWM และ Serial ด้วยเครื่องวิเคราะห์ลอจิก
void setup() {
  Serial.begin(9600);
  pinMode(9, OUTPUT);
  analogWrite(9, 64);   // duty 64/255 = 25%
}

int n = 0;

void loop() {
  Serial.print("HELLO ");
  Serial.println(n++);
  delay(200);
}
`;

/** แลป 57: จอ LCD 16×2 แบบขนานกับไลบรารี LiquidCrystal (โหมด 4 บิต: RS 12, E 11, D4–D7 = 5, 4, 3, 2 ตามตัวอย่าง HelloWorld ของ Arduino) */
export const UNO_LCD_CODE = `// แลป 57: จอ LCD 16x2 แบบขนาน (โหมด 4 บิต)
#include <LiquidCrystal.h>

// RS, E, D4, D5, D6, D7
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  lcd.begin(16, 2);          // 16 ตัวอักษร 2 บรรทัด
  lcd.print("Hello, World!");
}

void loop() {
  lcd.setCursor(0, 1);       // คอลัมน์ 0 บรรทัดที่ 2
  lcd.print("t = ");
  lcd.print(millis() / 1000);
  lcd.print(" s");
  delay(200);
}
`;

/** แลป 58: อ่าน BH1750 ด้วย Wire แล้วดูสัญญาณ I²C (A4 = SDA, A5 = SCL) ด้วยเครื่องวิเคราะห์ลอจิก */
export const UNO_I2C_LA_CODE = `// แลป 58: อ่านแสงจาก BH1750 ผ่าน I2C แล้วดูสัญญาณด้วยเครื่องวิเคราะห์ลอจิก
#include <Wire.h>

const uint8_t BH = 0x23;       // ที่อยู่ BH1750 (ขา ADDR ไม่ต่อ)

void setup() {
  Serial.begin(9600);
  Wire.begin();                // SDA = A4, SCL = A5, 100 kHz
}

void loop() {
  Wire.beginTransmission(BH);
  Wire.write(0x20);            // คำสั่ง: วัดหนึ่งครั้ง ละเอียด 1 lx (เสร็จแล้วชิปพักเอง)
  Wire.endTransmission();
  delay(180);                  // รอวัด (ไม่เกิน 180 ms)
  Wire.requestFrom(BH, (uint8_t)2);
  uint16_t raw = Wire.read() << 8;
  raw |= Wire.read();
  Serial.print("raw=0x");
  Serial.print(raw, HEX);
  Serial.print(" lux=");
  Serial.println(raw / 1.2);
}
`;

/** แลป Nano: VR ที่ A7 (ขาแอนะล็อกอย่างเดียว) หรี่ LED ที่ D9 ด้วย PWM · พิมพ์ค่า A6/A7 และผล digitalRead(A7) (ได้ 0 เสมอ) */
export const NANO_POT_CODE = `// Arduino Nano: VR ที่ A7 -> ความสว่าง LED ที่ D9 (PWM)
const int LED = 9;    // ขา ~9 ทำ PWM ได้

void setup() {
  Serial.begin(9600);
  pinMode(LED, OUTPUT);
  pinMode(13, OUTPUT);
}

unsigned long last = 0;

void loop() {
  int a7 = analogRead(A7);         // 0-1023 (A6/A7 อ่านแอนะล็อกได้อย่างเดียว)
  analogWrite(LED, a7 / 4);        // 0-255
  digitalWrite(13, a7 > 512 ? HIGH : LOW);
  if (millis() - last >= 100) {
    last = millis();
    Serial.print("A6=");
    Serial.print(analogRead(A6));
    Serial.print(" A7=");
    Serial.print(a7);
    Serial.print(" dA7=");
    Serial.println(digitalRead(A7)); // A7 ไม่มีวงจรขาดิจิทัล -> 0 เสมอ
  }
}
`;

/** โค้ดเริ่มต้นของ UNO Q: LED ภายนอกที่ D13 (ลอจิก 3.3 V) + ข้อความที่ Serial Monitor */
export const UNOQ_DEFAULT_CODE = `// Arduino UNO Q (โหมดจำลองพฤติกรรม ระดับ Arduino API)
// ต่อ LED + ตัวต้านทาน 220 Ω จากขา D13 ลง GND — ขาออก HIGH = 3.3 V
const int LED = 13;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
  Serial.println("blink");
}
`;

/** ATtiny85: กะพริบ LED ที่ขา 5 (PB0) · หรี่ LED ที่ขา 6 (PB1, PWM) ตาม VR ที่ขา 7 (PB2 = A1) */
export const ATTINY_DEFAULT_CODE = `// ATtiny85: LED กะพริบที่ PB0 (ขา 5) + LED หรี่ตาม VR ที่ PB1 (ขา 6)
const int LED = 0;    // PB0 = ขา 5
const int DIM = 1;    // PB1 = ขา 6 (PWM)
// VR ต่อที่ A1 = PB2 (ขา 7)

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, !digitalRead(LED));
  for (int i = 0; i < 50; i++) {
    analogWrite(DIM, analogRead(A1) / 4);   // 0-1023 -> 0-255
    delay(10);
  }
}
`;

export const UNO_DEFAULT_CODE = `// Blink + Serial Monitor
const int LED = 13;   // D13 = LED L บนบอร์ด

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED, HIGH);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(LED, LOW);
  Serial.println("LED OFF");
  delay(500);
}
`;

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
  if (isSensor(part)) return sensorPinDefs(part);
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
    case 'pir':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 4.5–20 V (ใช้ VBUS 5 V)', dx: 0, dy: 0 },
        { name: 'OUT', label: 'OUT สัญญาณ 3.3 V เมื่อตรวจพบ', dx: 1, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 2, dy: 0 },
      ];
    case 'irobstacle':
      return [
        { name: 'OUT', label: 'OUT ต่ำเมื่อพบวัตถุ (ดึงขึ้น 10 kΩ ไป VCC)', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 3.3–5 V', dx: 2, dy: 0 },
      ];
    case 'dht11':
    case 'dht22':
      return [
        { name: 'VDD', label: 'ขา 1 VDD ไฟเลี้ยง 3.3–6 V', dx: 0, dy: 0 },
        { name: 'DATA', label: 'ขา 2 DATA บัสสายเดียว (ต้องมีตัวต้านทานดึงขึ้น)', dx: 1, dy: 0 },
        { name: 'NC', label: 'ขา 3 NC (ไม่ต่อ)', dx: 2, dy: 0 },
        { name: 'GND', label: 'ขา 4 GND', dx: 3, dy: 0 },
      ];
    case 'uno':
      return UNO_PINOUT.map(([name, label]) => ({ name, label, dx: 0, dy: 0 }));
    case 'logicanalyzer':
      return [...Array.from({ length: 8 }, (_, k) => ({ name: `CH${k}`, label: `CH${k} ขาเข้าลอจิก (LOW < 0.8 V, HIGH > 2.0 V)`, dx: 0, dy: 0 })), { name: 'GND', label: 'GND อ้างอิง (ต่อกับกราวด์ของวงจร)', dx: 0, dy: 0 }];
    case 'nano':
      // ขา 1–15 ตามแนว anchor (เช่น แถว h, dx 0..14) ขา 16–30 อีกฝั่งห่าง 6 แถว (แถว d) โดยขา 30 ตรงข้ามขา 1 — ทวนเข็มนาฬิกาเมื่อมองจากด้านบนเหมือนบอร์ดจริง
      return NANO_PINOUT.map(([name, label], k) => { const pin = k + 1; return { name, label, dx: pin <= 15 ? pin - 1 : 30 - pin, dy: pin <= 15 ? 0 : -6 }; });
    case 'attiny85':
      // DIP-8: ขา 1–4 แถวของ anchor, ขา 5–8 อีกฝั่งร่องกลาง (ขา 8 ตรงข้ามขา 1) แบบเดียวกับไอซี DIP-8 อื่นในแอป
      return ATTINY85_PINOUT.map(([name, label], k) => ({ name, label, dx: k < 4 ? k : 7 - k, dy: k < 4 ? 0 : -3 }));
    case 'promini':
      return [
        ...PROMINI_ROW_A.map(([name, label], k) => ({ name, label, dx: k, dy: 0 })),
        ...PROMINI_ROW_B.map(([name, label], k) => ({ name, label, dx: k, dy: -6 })),
        ...PROMINI_TOP.map(([name, label, dx, dy]) => ({ name, label, dx, dy, top: true })),
      ];
    case 'rpi5':
      return RPI_HEADER.map(([name, label]) => ({ name, label, dx: 0, dy: 0 }));
    case 'soilsensor':
      return [
        { name: 'GND', label: 'สายดำ GND', dx: 0, dy: 0 },
        { name: 'VCC', label: 'สายแดง VCC 3.3–5.5 V', dx: 0, dy: 0 },
        { name: 'AOUT', label: 'สายเหลือง AOUT (แรงดันตามความชื้น)', dx: 0, dy: 0 },
      ];
    case 'pump':
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
    case 'unoq':
      return UNOQ_PINOUT.map(([name, label]) => ({ name, label, dx: 0, dy: 0 }));
    case 'mega':
      return MEGA_PINOUT.map(([name, label]) => ({ name, label, dx: 0, dy: 0 }));
    case 'arcadebtn':
      return [{ name: 'COM', label: 'COM ขั้วร่วมของไมโครสวิตช์', dx: 0, dy: 0 }, { name: 'NO', label: 'NO ปกติเปิด — ต่อกับ COM เมื่อกด', dx: 0, dy: 0 }, { name: 'NC', label: 'NC ปกติปิด — ต่อกับ COM เมื่อปล่อย', dx: 0, dy: 0 }];
    case 'pushbtn16':
      return [{ name: '1', label: 'ขั้ว 1 (ปกติเปิด)', dx: 0, dy: 0 }, { name: '2', label: 'ขั้ว 2 (ต่อกับขั้ว 1 เมื่อกด)', dx: 0, dy: 0 }];
    case 'dcadapter':
      return [{ name: '+', label: '+ 5 V (ขั้วสกรูของแจ็ก DC — ขั้วกลางของปลั๊ก)', dx: 0, dy: 0 }, { name: '-', label: '− GND (ขั้วสกรูของแจ็ก DC — ขั้วนอกของปลั๊ก)', dx: 0, dy: 0 }];
    case 'servohub':
      return SERVOHUB_PINS.map(([name, label]) => ({ name, label, dx: 0, dy: 0 }));
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
    case 'rgbled': {
      const com = part.params.common === 'cc' ? 'แคโทดร่วม (−) ขายาวสุด' : 'แอโนดร่วม (+) ขายาวสุด';
      return [
        { name: 'R', label: 'ขา 1 R แดง', dx: 0, dy: 0 },
        { name: 'COM', label: `ขา 2 ${com}`, dx: 1, dy: 0 },
        { name: 'G', label: 'ขา 3 G เขียว', dx: 2, dy: 0 },
        { name: 'B', label: 'ขา 4 B น้ำเงิน', dx: 3, dy: 0 },
      ];
    }
    case 'ssd1306':
      return [
        { name: 'GND', label: 'GND กราวด์', dx: 0, dy: 0 },
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 3.3–5 V', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
      ];
    case 'ds3231':
      return [
        { name: '32K', label: '32K ขาออก 32.768 kHz (open-drain, EN32kHz)', dx: 0, dy: 0 },
        { name: 'SQW', label: 'SQW คลื่นสี่เหลี่ยม 1 Hz–8.192 kHz / อินเทอร์รัปต์นาฬิกาปลุก (open-drain)', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 2.3–5.5 V', dx: 4, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 5, dy: 0 },
      ];
    case 'mpu6050':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 3–5 V (มีเรกูเลเตอร์ 3.3 V บนโมดูล)', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'XDA', label: 'XDA บัสเสริม (ไม่จำลอง)', dx: 4, dy: 0 },
        { name: 'XCL', label: 'XCL บัสเสริม (ไม่จำลอง)', dx: 5, dy: 0 },
        { name: 'AD0', label: 'AD0 เลือกที่อยู่: ต่ำ = 0x68, ต่อ 3V3 = 0x69', dx: 6, dy: 0 },
        { name: 'INT', label: 'INT อินเทอร์รัปต์ (DATA_RDY / FIFO ล้น)', dx: 7, dy: 0 },
      ];
    case 'vibmotor':
      return [
        { name: 'A', label: 'สายแดง (+)', dx: 0, dy: 0 },
        { name: 'B', label: 'สายน้ำเงิน (−)', dx: 0, dy: 0 },
      ];
    case 'gc9a01':
      return ([
        ['VCC', 'VCC ไฟเลี้ยง 3.3/5 V'], ['GND', 'GND กราวด์'], ['MISO', 'MISO (จอไม่ส่งข้อมูลกลับในแบบจำลอง)'], ['MOSI', 'MOSI ข้อมูล SPI เข้าจอ'], ['SCLK', 'SCLK สัญญาณนาฬิกา SPI'],
        ['LCD_CS', 'LCD_CS เลือกจอ (ต่ำ = เลือก)'], ['LCD_DC', 'LCD_DC ต่ำ = คำสั่ง, สูง = ข้อมูล'], ['LCD_RST', 'LCD_RST รีเซ็ตจอ (ต่ำ = รีเซ็ต)'], ['LCD_BL', 'LCD_BL ไฟพื้นหลัง (PWM หรี่ได้)'],
        ['TP_SDA', 'TP_SDA ข้อมูล I²C ของทัช'], ['TP_SCL', 'TP_SCL สัญญาณนาฬิกา I²C ของทัช'], ['TP_INT', 'TP_INT ทัชส่งพัลส์ต่ำเมื่อสัมผัส'], ['TP_RST', 'TP_RST รีเซ็ตทัช (ต่ำ = รีเซ็ต)'],
      ] as Array<[string, string]>).map(([name, label], dx) => ({ name, label, dx, dy: 0 }));
    case 'qmi8658':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 1.71–3.6 V (ห้าม 5 V)', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'SA0', label: 'SA0 เลือกที่อยู่: ลอย/สูง = 0x6A, ต่อ GND = 0x6B', dx: 4, dy: 0 },
      ];
    case 'esp32s3lcd':
      return [];
    case 'lcd1602':
      return [
        { name: 'GND', label: 'GND กราวด์', dx: 0, dy: 0 },
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 5 V (ที่ 3.3 V ตัวอักษรจางมาก)', dx: 0, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 0, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 0, dy: 0 },
      ];
    case 'lcd1602p':
      return LCD_PAR_PINS.map(([name, label], i) => ({ name, label, dx: i, dy: 0 }));
    case 'bmp280':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 1.71–3.6 V (ห้าม 5 V)', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'CSB', label: 'CSB เลือกชิป (ลอย/สูง = โหมด I²C)', dx: 4, dy: 0 },
        { name: 'SDO', label: 'SDO เลือกที่อยู่: ไม่ต่อ = 0x76, ต่อ 3V3 = 0x77', dx: 5, dy: 0 },
      ];
    case 'bh1750':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 3–5 V', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'ADDR', label: 'ADDR เลือกที่อยู่: ไม่ต่อ = 0x23, ต่อ 3V3 = 0x5C', dx: 4, dy: 0 },
      ];
    case 'ina219':
      return [
        { name: 'VCC', label: 'VCC ไฟเลี้ยงชิป 3–5.5 V', dx: 0, dy: 0 },
        { name: 'GND', label: 'GND กราวด์ (ต้องร่วมกับวงจรที่วัด)', dx: 1, dy: 0 },
        { name: 'SCL', label: 'SCL สัญญาณนาฬิกา I²C', dx: 2, dy: 0 },
        { name: 'SDA', label: 'SDA ข้อมูล I²C', dx: 3, dy: 0 },
        { name: 'VIN-', label: 'VIN− ไปยังโหลด (แรงดันบัสวัดที่ขานี้)', dx: 4, dy: 0 },
        { name: 'VIN+', label: 'VIN+ จากแหล่งจ่าย (ผ่าน shunt 0.1 Ω ไป VIN−)', dx: 5, dy: 0 },
      ];
    case 'keypad':
      return [...[1, 2, 3, 4].map((k) => ({ name: `R${k}`, label: `R${k} แถวที่ ${k} (${KEYPAD_KEYS[k - 1].join(' ')})`, dx: 0, dy: 0 })),
        ...[1, 2, 3, 4].map((k) => ({ name: `C${k}`, label: `C${k} คอลัมน์ที่ ${k} (${KEYPAD_KEYS.map((r) => r[k - 1]).join(' ')})`, dx: 0, dy: 0 }))];
    case 'encoder':
      // ป้ายบนโมดูล KY-040 จากซ้าย: CLK DT SW + GND
      return [
        { name: 'CLK', label: 'CLK หน้าสัมผัส A', dx: 0, dy: 0 },
        { name: 'DT', label: 'DT หน้าสัมผัส B', dx: 1, dy: 0 },
        { name: 'SW', label: 'SW ปุ่มกดลูกบิด (ต่อลง GND เมื่อกด)', dx: 2, dy: 0 },
        { name: '+', label: '+ ไฟเลี้ยงตัวต้านทานดึงขึ้น 3.3–5 V', dx: 3, dy: 0 },
        { name: 'GND', label: 'GND กราวด์ (ขาร่วมของหน้าสัมผัส A/B และ SW)', dx: 4, dy: 0 },
      ];
    case 'joystick':
      return [
        { name: 'GND', label: 'GND กราวด์', dx: 0, dy: 0 },
        { name: '+5V', label: '+5V ไฟเลี้ยงตัวต้านทานปรับค่า (ใช้ 3V3 กับ Pico)', dx: 1, dy: 0 },
        { name: 'VRx', label: 'VRx แรงดันแกน X (ซ้าย → ขวา)', dx: 2, dy: 0 },
        { name: 'VRy', label: 'VRy แรงดันแกน Y (ล่าง → บน)', dx: 3, dy: 0 },
        { name: 'SW', label: 'SW กดก้าน (ต่อลง GND เมื่อกด)', dx: 4, dy: 0 },
      ];
    case 'tm1637':
      return [
        { name: 'CLK', label: 'CLK สัญญาณนาฬิกา', dx: 0, dy: 0 },
        { name: 'DIO', label: 'DIO ข้อมูล (สองทาง)', dx: 1, dy: 0 },
        { name: 'VCC', label: 'VCC ไฟเลี้ยง 3.3–5 V', dx: 2, dy: 0 },
        { name: 'GND', label: 'GND กราวด์', dx: 3, dy: 0 },
      ];
    case 'bluepill':
    case 'teensy41': {
      // มองด้านบน USB อยู่ซ้าย: แถวหน้า = แถวของ anchor (dx 0 ติด USB) · แถวหลังห่าง 0.6" (6 แถว)
      const [fr, bk] = part.kind === 'bluepill' ? [BLUEPILL_FRONT, BLUEPILL_BACK] : [TEENSY41_FRONT, TEENSY41_BACK];
      const tag = ' — ไม่ทำงาน (เฉพาะโมเดล)';
      return [...fr.map(([name, label], k) => ({ name, label: label + tag, dx: k, dy: 0 })), ...bk.map(([name, label], k) => ({ name, label: label + tag, dx: k, dy: -6 }))];
    }
    case 'pico2':
      // ตำแหน่งและชื่อขาเหมือน Pico ทุกขา (Raspberry Pi: "The pinout and board layout for Raspberry Pi Pico and Pico H is the same as for Raspberry Pi Pico 2")
      return PICO_PINOUT.map((name, k) => {
        const pin = k + 1;
        const base = name.replace(/\.\d+$/, '');
        const adc = /^GP2[678]$/.test(base) ? ` (ADC${Number(base.slice(2)) - 26})` : '';
        return { name, label: `ขา ${pin} ${base}${adc} — ไม่ทำงาน (เฉพาะโมเดล)`, dx: pin <= 20 ? pin - 1 : 40 - pin, dy: pin <= 20 ? 0 : -7 };
      });
    case 'esp32s2':
      // มองด้านบน USB อยู่ซ้าย: J3 ที่แถว anchor (เช่น j) ขา 21 (IO18) ซ้ายสุด → ขา 1 (G) ขวาสุด · J1 อีกแถวห่าง 0.9" (9 แถว เช่น c)
      return [
        ...ESP32S2_J3.map(([name, label], k) => ({ name, label: `J3-${k + 1} ${label} — ไม่ทำงาน (เฉพาะโมเดล)`, dx: 20 - k, dy: 0 })),
        ...ESP32S2_J1.map(([name, label], k) => ({ name, label: `J1-${k + 1} ${label} — ไม่ทำงาน (เฉพาะโมเดล)`, dx: 20 - k, dy: -9 })),
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
    case 'picow':
      // ขา 1–20 ตามแนว anchor (dx 0..19, เช่น แถว h), ขา 21–40 อีกฝั่งห่าง 7 แถวไปทางแถว a โดยขา 40 ตรงข้ามขา 1
      // มองจากด้านบน (USB อยู่ซ้าย) ขา 1 อยู่ล่างซ้าย เรียงทวนเข็มนาฬิกาเหมือนบอร์ดจริง (schema 7)
      return PICO_PINOUT.map((name, k) => {
        const pin = k + 1;
        const base = name.replace(/\.\d+$/, '');
        const note = PICO_NOTE[name];
        return { name, label: `ขา ${pin} ${base}${note ? ` (${note})` : ''}`, dx: pin <= 20 ? pin - 1 : 40 - pin, dy: pin <= 20 ? 0 : -7 };
      });
    case 'esp32devkitc':
      // J2 ขา 1–19 ตามแนว anchor (เช่น แถว j) · J3 ขา 1–19 อีกฝั่งห่าง 10 แถว (1 นิ้ว — แถว b) เรียงทิศเดียวกัน: ขา 1 ของทั้งสองแถวอยู่ฝั่งสายอากาศ, ขา 19 ฝั่ง USB
      return [...ESP32DK_J2.map(([name, , label], k) => ({ name, label, dx: k, dy: 0 })), ...ESP32DK_J3.map(([name, , label], k) => ({ name, label, dx: k, dy: -10 }))];
    case 'nanoconnect':
      // ตำแหน่งเหมือน Arduino Nano: ขา 1–15 แถวของ anchor, ขา 16–30 อีกฝั่งห่าง 6 แถว (ขา 30 ตรงข้ามขา 1)
      return NANOCONNECT_PINOUT.map(([name, , label], k) => { const pin = k + 1; return { name, label, dx: pin <= 15 ? pin - 1 : 30 - pin, dy: pin <= 15 ? 0 : -6 }; });
    case 'xiao':
      // ขา 1–7 (D0–D6) ตามแนว anchor (เช่น แถว h, dx 0..6) ขา 8–14 (D7…5V) อีกฝั่งห่าง 6 แถว (แถว d) โดยขา 14 ตรงข้ามขา 1 — ทวนเข็มนาฬิกาเหมือนบอร์ดจริง
      return XIAO_PINOUT.map(([name], k) => {
        const pin = k + 1;
        return { name, label: `ขา ${pin} ${name}${XIAO_NOTE[name] ? ` (${XIAO_NOTE[name]})` : ''}`, dx: pin <= 7 ? pin - 1 : 14 - pin, dy: pin <= 7 ? 0 : -6 };
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
/** ขาจอ LCD 1602 แบบขนาน ตามลำดับหัวเข็ม (ขา 1 ซ้ายสุด) */
export const LCD_PAR_PINS: Array<[string, string]> = [
  ['VSS', 'VSS (ขา 1) กราวด์'], ['VDD', 'VDD (ขา 2) ไฟเลี้ยง 5 V'], ['V0', 'V0 (ขา 3) ปรับความคมชัด — ต่อขากลาง VR (แรงดันต่ำ = เข้ม)'],
  ['RS', 'RS (ขา 4) เลือก คำสั่ง (0) / ข้อมูล (1)'], ['RW', 'RW (ขา 5) อ่าน (1) / เขียน (0) — ปกติต่อ GND'], ['E', 'E (ขา 6) Enable — รับข้อมูลที่ขอบลง'],
  ['D0', 'D0 (ขา 7) ข้อมูลบิต 0 (โหมด 8 บิต)'], ['D1', 'D1 (ขา 8) ข้อมูลบิต 1 (โหมด 8 บิต)'], ['D2', 'D2 (ขา 9) ข้อมูลบิต 2 (โหมด 8 บิต)'], ['D3', 'D3 (ขา 10) ข้อมูลบิต 3 (โหมด 8 บิต)'],
  ['D4', 'D4 (ขา 11) ข้อมูลบิต 4'], ['D5', 'D5 (ขา 12) ข้อมูลบิต 5'], ['D6', 'D6 (ขา 13) ข้อมูลบิต 6'], ['D7', 'D7 (ขา 14) ข้อมูลบิต 7'],
  ['A', 'A (ขา 15) ขั้วบวก LED ไฟพื้นหลัง'], ['K', 'K (ขา 16) ขั้วลบ LED ไฟพื้นหลัง'],
];

export function ledParamsFor(color: LedColor) {
  const vf: Record<LedColor, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.1 };
  const If = 0.02;
  const n = 2;
  const Rs = 5;
  const Vd = vf[color] - If * Rs;
  const Is = If / (Math.exp(Vd / (n * VT)) - 1);
  return { color, Is, n, Rs, ratedCurrent: 0.02, maxCurrent: 0.03, maxReverseVoltage: 5 };
}

/**
 * LED RGB 5 mm ใสหรือขุ่น 4 ขา — ค่าทั่วไปจากผู้จำหน่าย: Vf (R, G, B) ≈ (2.0, 3.2, 3.2) V, กระแสใช้งาน 20 mA ต่อสี
 * (SparkFun COM-00105 / Protostack: R 1.8–2.0 V, G/B 3.2–3.4 V) · ลำดับขา R, ขาร่วม (ยาวสุด), G, B
 */
export function rgbLedParamsFor(common: 'cc' | 'ca') {
  return { common, vfR: 2.0, vfG: 3.2, vfB: 3.2, n: 2, Rs: 5, ratedCurrent: 0.02, maxCurrent: 0.03, maxReverseVoltage: 5 };
}

/** Is ของไดโอดที่ให้แรงดัน vf ที่กระแส 20 mA (แบบเดียวกับ ledParamsFor) */
export function ledIsFor(vf: number, n: number, Rs: number, If = 0.02) {
  return If / (Math.exp((vf - If * Rs) / (n * VT)) - 1);
}

export const RGB_CH = ['R', 'G', 'B'] as const;

/**
 * มอเตอร์สั่นแบบเหรียญ 10 × 2.7 mm: ดาต้าชีต (Farnell 4020640) ระบุ 3 V (1.5–4.2 V) 50 mA 11,000 ± 2,500 rpm
 * ค่าที่เอกสารไม่ระบุ (ประมาณ): ขดลวด 35 Ω (กระแสเริ่ม ≈ 86 mA ที่ 3 V), แรงเสียดทานเทียบเท่ากระแสไม่มีโหลด 45 mA,
 * ke ให้ความเร็วขณะหมุน ≈ 11,000 rpm ที่ 3 V, ความเฉื่อยของก้อนเยื้องศูนย์ ≈ 2 × 10⁻⁹ kg·m² (ถึงความเร็ว ≈ 0.1 s)
 */
export const VIBMOTOR_DEFAULTS = { resistance: 35, inductance: 1e-4, ke: (3 - 0.045 * 35) / (11000 * 2 * Math.PI / 60), inertia: 2e-9, noLoadCurrent: 0.045, ratedVoltage: 3, maxVoltage: 4.2 };

export const LED_HEX: Record<LedColor, number> = {
  red: 0xff2a1f, yellow: 0xffd21f, green: 0x2bff4a, blue: 0x2f6bff, white: 0xf4f6ff,
};

export const LED_NAMES: Record<LedColor, string> = {
  red: 'แดง', yellow: 'เหลือง', green: 'เขียว', blue: 'น้ำเงิน', white: 'ขาว',
};

export function defaultPart(kind: PartKind, id: string, label: string, placement: Placement): Part {
  if (isSensorKind(kind)) return makeSensorPart(kind, id, label, placement);
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
    case 'soilsensor':
      return { id, label, kind, placement, params: { ...SOIL_DEFAULTS } };
    case 'dht22':
      return { id, label, kind, placement, params: { ...DHT22_DEFAULTS } };
    case 'dht11':
      return { id, label, kind, placement, params: { ...DHT11_DEFAULTS } };
    case 'pir':
      return { id, label, kind, placement, params: { motion: false, holdTime: 5, blockTime: 2.5, mode: 'H', vMin: 4.5, vMax: 20, supplyCurrent: 50e-6 } };
    case 'irobstacle':
      return { id, label, kind, placement, params: { distance: 50, surface: 'white', threshold: 10, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.04 } };
    case 'pump':
      return { id, label, kind, placement, params: { ...PUMP_DEFAULTS } };
    case 'ldr':
      return { id, label, kind, placement, params: { lux: 300, r10: 15000, gamma: 0.6, rdark: 1e6, maxPower: 0.1, span: 2 } };
    case 'unoq':
      return { id, label, kind, placement, params: { code: UNOQ_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0, usbLimit: 3 } };
    case 'arcadebtn':
      return { id, label, kind, placement, params: { color: 'red', pressed: false, contactResistance: 0.03, maxCurrent: 5, maxVoltage: 250 } };
    case 'pushbtn16':
      return { id, label, kind, placement, params: { color: 'red', pressed: false, contactResistance: 0.05, maxCurrent: 3, maxVoltage: 250 } };
    case 'dcadapter':
      return { id, label, kind, placement, params: { voltage: 5, currentLimit: 3, internalResistance: 0.08, plugged: true } };
    case 'servohub':
      return { id, label, kind, placement, params: { capacitance: 470e-6, capRating: 16 } };
    case 'pushbutton':
      return { id, label, kind, placement, params: { pressed: false, contactResistance: 0.1, maxCurrent: 0.05, maxVoltage: 24 } };
    case 'potentiometer':
      return { id, label, kind, placement, params: { resistance: 10000, position: 0.5, endResistance: 3, powerRating: 0.5 } };
    case 'led':
      return { id, label, kind, placement, params: ledParamsFor('red') };
    case 'rgbled':
      return { id, label, kind, placement, params: rgbLedParamsFor('cc') };
    case 'ssd1306':
      return { id, label, kind, placement, params: { addr: 0x3c, pullUp: 4700, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.01 } };
    case 'ds3231':
      return { id, label, kind, placement, params: { clock: '2026-10-26 09:00:00', temperature: 25, pullUp: 4700, vMin: 2.3, vMax: 5.5, supplyCurrent: 0.003 } };
    case 'mpu6050':
      return { id, label, kind, placement, params: { motion: 'still', spm: 100, temperature: 25, pullUp: 4700, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.005 } };
    case 'vibmotor':
      return { id, label, kind, placement, params: { ...VIBMOTOR_DEFAULTS } };
    case 'esp32s2':
      return { id, label, kind, placement, params: { model: 'ESP32-S2-DevKitM-1' } };
    case 'bluepill':
      return { id, label, kind, placement, params: { model: 'STM32F103C8T6 Blue Pill' } };
    case 'pico2':
      return { id, label, kind, placement, params: { model: 'Raspberry Pi Pico 2' } };
    case 'teensy41':
      return { id, label, kind, placement, params: { model: 'Teensy 4.1' } };
    case 'esp32s3lcd':
      return { id, label, kind, placement, params: { model: 'ESP32-S3-Touch-LCD-1.28' } };
    case 'lcd1602':
      return { id, label, kind, placement, params: { addr: 0x27, pullUps: true, contrast: 0.9, blJumper: true, color: 'blue', pullUp: 4700, vMin: 2.5, vMax: 6.0, supplyCurrent: 0.025 } };
    case 'lcd1602p':
      return { id, label, kind, placement, params: { color: 'blue', blR: 100, blVf: 3.0, blMax: 0.03, vMin: 2.7, vMax: 5.5, supplyCurrent: 0.0015 } };
    case 'bmp280':
      return { id, label, kind, placement, params: { temperature: 30, pressure: 1008, pullUp: 10000, vMin: 1.71, vMax: 3.6, supplyCurrent: 0.0007 } };
    case 'bh1750':
      return { id, label, kind, placement, params: { lux: 300, pullUp: 4700, vMin: 2.4, vMax: 5.5, supplyCurrent: 0.0002 } };
    case 'ina219':
      return { id, label, kind, placement, params: { addr: 0x40, shunt: 0.1, pullUp: 10000, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.001 } };
    case 'keypad':
      return { id, label, kind, placement, params: { pressed: '', contactResistance: 200, maxVoltage: 24 } };
    case 'encoder':
      return { id, label, kind, placement, params: { pressed: false, pullUp: 10000, contactResistance: 1, detentMs: 12 } };
    case 'joystick':
      return { id, label, kind, placement, params: { x: 0.5, y: 0.5, pressed: false, resistance: 10000, contactResistance: 1 } };
    case 'tm1637':
      return { id, label, kind, placement, params: { color: 'red', pullUp: 10000, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.02 } };
    case 'gc9a01':
      return { id, label, kind, placement, params: { pullUp: 4700, vMin: 3.0, vMax: 5.5, supplyCurrent: 0.03 } };
    case 'qmi8658':
      return { id, label, kind, placement, params: { motion: 'still', spm: 100, temperature: 25, pullUp: 4700, vMin: 1.71, vMax: 3.6, supplyCurrent: 0.001 } };
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
    case 'picow':
      return { id, label, kind, placement, params: { code: PICO_DEFAULT_CODE, autorun: true } };
    case 'xiao':
      return { id, label, kind, placement, params: { code: XIAO_DEFAULT_CODE, autorun: true } };
    case 'esp32devkitc':
      return { id, label, kind, placement, params: { code: ESP32DK_DEFAULT_CODE, autorun: true } };
    case 'nanoconnect':
      return { id, label, kind, placement, params: { code: NANOCONNECT_DEFAULT_CODE, autorun: true, motion: 'still', spm: 100 } };
    case 'rpi5':
      return { id, label, kind, placement, params: { code: RPI_DEFAULT_CODE, autorun: true } };
    case 'uno':
      return { id, label, kind, placement, params: { code: UNO_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0 } };
    case 'logicanalyzer':
      return { id, label, kind, placement, params: { timeDiv: 0.001, trigCh: -1, trigEdge: 'rise', decoders: Array.from({ length: 8 }, () => 'none' as const), bauds: Array.from({ length: 8 }, () => 0) } };
    case 'nano':
      return { id, label, kind, placement, params: { code: UNO_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0 } };
    case 'attiny85':
      return { id, label, kind, placement, params: { code: ATTINY_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0 } };
    case 'promini':
      return { id, label, kind, placement, params: { code: UNO_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0, volt: 5 } };
    case 'mega':
      return { id, label, kind, placement, params: { code: UNO_DEFAULT_CODE, hex: null, hexSrc: '', flash: 0, ram: 0 } };
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

/**
 * ค่าทั่วไป (typical) ของความไม่อุดมคติด้าน DC: LM741 (TI SNOSC25D): VIO 1 mV, IIB 80 nA, IIO 20 nA ·
 * MCP6002 (Microchip DS21733): VOS ไม่ระบุค่าทั่วไป (สูงสุด ±4.5 mV — ใช้ 0), IB 1 pA
 */
export const OPAMP_DC_TYP: Record<'LM741' | 'MCP6002', { vos: number; ib: number; ios: number }> = { LM741: { vos: 1e-3, ib: 80e-9, ios: 20e-9 }, MCP6002: { vos: 0, ib: 1e-12, ios: 0 } };
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
/**
 * เซนเซอร์ความชื้นในดินแบบ capacitive v1.2 (เทียบ DFRobot SEN0193): ไฟ 3.3–5.5 V, ขาออก 0–3.0 V, กระแส 5 mA, 98 × 23 mm, ขั้ว PH2.0 3 ขา
 * แรงดันขาออกลดลงเมื่อดินชื้น — ตัวอย่างปรับเทียบในเอกสาร: อากาศ 520 / น้ำ 260 (ADC 10 บิต 5 V → ≈ 2.54 V / 1.27 V)
 * vDry/vWet = 2.5/1.25 V ใช้ค่าประมาณจากตัวอย่างนั้น (ของจริงต้องปรับเทียบเอง) · rOut 10 kΩ ประมาณ · ความชื้นเปลี่ยนเชิงเส้นกับแรงดัน (ประมาณ)
 * potWater 300 mL (กระถางเล็ก — ประมาณ) · dryRate 0.5 %/s เป็นการเร่งเวลา (ดินจริงแห้งในหลายชั่วโมง–วัน)
 */
export const SOIL_DEFAULTS = { moisture: 25, dryRate: 0.5, potWater: 300, vDry: 2.5, vWet: 1.25, rOut: 10000, supplyCurrent: 0.005, vMin: 3.3, vMax: 5.5 };
/** แรงดันขาออกของเซนเซอร์ความชื้นที่ความชื้น m (%) */
/**
 * DHT22 / AM2302 (เอกสาร Aosong): ไฟ 3.3–6 V, กระแสขณะวัด 1 mA (สูงสุด 1.5 mA) พัก 40–50 µA, ความชื้น 0–100 %RH ±2 %RH,
 * อุณหภูมิ −40…80 °C ±0.5 °C, ความละเอียด 0.1, รอบการวัด ≥ 2 s, ตัวถัง 15.1 × 25 × 7.7 mm ขาห่าง 2.54 mm (Adafruit)
 * จังหวะบัส: โฮสต์ดึงต่ำ ≥ 1 ms → ปล่อย → เซนเซอร์ตอบต่ำ 80 µs สูง 80 µs → 40 บิต (ต่ำ 50 µs + สูง 26–28 µs = 0 / 70 µs = 1) → ต่ำ 50 µs จบ
 * ข้อมูล: ความชื้น ×10 (16 บิต), อุณหภูมิ ×10 (16 บิต บิตบนสุด = ติดลบ), checksum = ผลรวม 4 ไบต์แรก (8 บิตล่าง)
 */
export const DHT22_DEFAULTS = { temperature: 30, humidity: 65, vMin: 3.3, vMax: 6, supplyCurrent: 1e-3, standbyCurrent: 5e-5 };
/**
 * DHT11 (เอกสาร Aosong/D-Robotics): ไฟ 3.3–5.5 V, กระแสขณะวัด 0.3 mA พัก 60 µA, ความชื้น 20–90 %RH ±5 %RH (ละเอียด 1),
 * อุณหภูมิ 0–50 °C ±2 °C, รอบการวัด ≥ 1 s · สัญญาณเริ่ม: โฮสต์ดึงต่ำ ≥ 18 ms · จังหวะตอบ/บิตเหมือน DHT22
 * ข้อมูล: ความชื้น (จำนวนเต็ม), ทศนิยมความชื้น (0), อุณหภูมิ (จำนวนเต็ม), ทศนิยมอุณหภูมิ, checksum · ตัวถัง 15.5 × 12 × 5.5 mm
 */
export const DHT11_DEFAULTS = { temperature: 28, humidity: 60, vMin: 3.3, vMax: 5.5, supplyCurrent: 0.3e-3, standbyCurrent: 6e-5 };
export function dht11Bytes(t: number, h: number): number[] {
  const hh = Math.round(Math.min(90, Math.max(20, h)));
  const tc = Math.min(50, Math.max(0, t));
  const ti = Math.floor(tc), td = Math.min(9, Math.round((tc - ti) * 10));
  const b = [hh, 0, ti, td];
  return [...b, b.reduce((a, x) => a + x, 0) & 0xff];
}
/** FC-51: ระยะตรวจจับจริง = ระยะที่ตั้ง (วัตถุสีขาว) · วัตถุสีดำสะท้อนอินฟราเรดน้อย ≈ 30% ของระยะ (ค่าประมาณเพื่อการสอน) */
export function irRange(pr: { surface: 'white' | 'black'; threshold: number }) { return pr.threshold * (pr.surface === 'black' ? 0.3 : 1); }
export function irDetected(pr: { distance: number; surface: 'white' | 'black'; threshold: number }) { return pr.distance <= irRange(pr); }
/**
 * HC-SR501 (เอกสาร HandsOn Tech): ตรวจจับในกรวย 110° ระยะปรับได้ประมาณ 3–7 m (ทริมพอต Sx) · ต้องใช้เวลาเริ่มต้นเกือบ 1 นาทีหลังจ่ายไฟ
 * ช่วงนั้น "มักให้สัญญาณตรวจจับหลอก" — แบบจำลองไม่ตรวจจับจริงในช่วงนี้ และให้สัญญาณหลอก 2 ครั้ง (ที่ 1/3 และ 2/3 ของช่วง — รูปแบบตัวอย่าง ของจริงไม่แน่นอน)
 */
export const PIR_CONE = 110;
export const PIR_WARMUP = 60;
export function pirInView(p: { distance?: number; angle?: number; senseRange?: number }) {
  return (p.distance ?? 2) <= Math.min(7, Math.max(3, p.senseRange ?? 7)) && Math.abs(p.angle ?? 0) <= PIR_CONE / 2;
}
export const DHT_TIMING = { minStartLow: 0.8e-3, go: 30e-6, respLow: 80e-6, respHigh: 80e-6, bitLow: 50e-6, bit0: 26e-6, bit1: 70e-6, endLow: 50e-6 };
/** 5 ไบต์ที่ DHT22 ส่ง (ค่าปัดเป็น 0.1) */
export function dht22Bytes(t: number, h: number): number[] {
  const hh = Math.round(Math.min(100, Math.max(0, h)) * 10);
  const tt = Math.round(Math.min(80, Math.max(-40, t)) * 10);
  const tw = tt < 0 ? 0x8000 | -tt : tt;
  const b = [hh >> 8, hh & 0xff, tw >> 8, tw & 0xff];
  return [...b, b.reduce((a, x) => a + x, 0) & 0xff];
}
export const soilVout = (m: number, pr: { vDry: number; vWet: number }) => pr.vDry - ((pr.vDry - pr.vWet) * Math.min(100, Math.max(0, m))) / 100;
/**
 * ปั๊มน้ำจุ่ม 3–6 V (ข้อมูลร้านค้า เช่น Electrokit 41037134): 130–220 mA, 80–120 L/h, ยกสูง 40–110 cm, Ø 24 × 33 mm, ท่อออก Ø 7.5 mm
 * แบบจำลองมอเตอร์ DC (ไม่มีเฟือง): R 8 Ω, ke 5.67 mV·s/rad → 5 V ≈ 0.18 A ≈ 6000 rpm, 3 V ≈ 0.13 A, 6 V ≈ 0.2 A (ปรับให้ผ่านช่วงกระแสในข้อมูล — ประมาณ)
 * อัตราไหลตามกฎความคล้ายของปั๊ม: Q ∝ ω, ความสูงยกสูงสุด ∝ ω² และ Q ลดลงตาม √(1 − ยก/ยกสูงสุด) (ประมาณ)
 */
export const PUMP_DEFAULTS = { target: '', resistance: 8, inductance: 5e-4, ke: 5.67e-3, inertia: 1e-7, noLoadCurrent: 0.069, viscous: 1e-6, flowMax: 120, headMax: 110, lift: 10, vMax: 6 };
type PumpPr = { resistance: number; ke: number; noLoadCurrent: number; viscous: number; flowMax: number; headMax: number; lift: number };
/** ความเร็วคงตัว (rad/s) ที่แรงดัน V */
export const pumpOmega = (V: number, pr: PumpPr) => Math.max(0, (pr.ke * V - pr.resistance * pr.ke * pr.noLoadCurrent) / (pr.ke * pr.ke + pr.resistance * pr.viscous));
/** อัตราไหล (L/h) ที่ความเร็ว w (rad/s) */
export function pumpFlow(w: number, pr: PumpPr): number {
  const w6 = pumpOmega(6, pr);
  if (w6 <= 0 || w <= 0) return 0;
  const r = w / w6, head = pr.headMax * r * r;
  if (head <= pr.lift) return 0;
  return pr.flowMax * r * Math.sqrt(1 - pr.lift / head);
}
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
