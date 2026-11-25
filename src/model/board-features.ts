/**
 * ความสามารถของบอร์ดไมโครคอนโทรลเลอร์แต่ละรุ่น (ผล Audit 2026-10-29) — แสดงในแผงคุณสมบัติของบอร์ดและใน docs/AUDIT.md
 * ระดับ: supported = ใช้ได้และมีเทสต์ยืนยัน (evidence), partial = ใช้ได้บางส่วน (ดู note), unsupported = ยังไม่มี, na = ไม่มีในฮาร์ดแวร์รุ่นนี้
 * กติกา: ข้อที่เป็น supported/partial ต้องอ้างไฟล์เทสต์ที่รันโค้ดจริงบนตัวจำลอง (tests/board-features.test.ts ตรวจว่าไฟล์มีอยู่)
 */
export type FeatLevel = 'supported' | 'partial' | 'unsupported' | 'na';
export interface BoardFeature { id: string; level: FeatLevel; note: string; evidence?: string[] }
export interface BoardProfile {
  kind: 'uno' | 'nano' | 'promini' | 'attiny85' | 'mega' | 'unoq' | 'pico' | 'picow' | 'xiao' | 'nanoconnect' | 'esp32devkitc' | 'esp32s2' | 'esp32s3lcd' | 'bluepill' | 'pico2' | 'teensy41' | 'rpi5';
  name: string;
  /** ตัวประมวลผลโค้ด */
  engine: string;
  languages: Array<{ name: string; level: FeatLevel; note: string }>;
  features: BoardFeature[];
}

export const FEATURE_LABELS: Array<[string, string]> = [
  ['gpio', 'GPIO ขาเข้า/ขาออก'], ['adc', 'Analog Input / ADC'], ['pwm', 'PWM'], ['interrupt', 'Interrupt ภายนอก'], ['timer', 'Timer'],
  ['uart', 'UART'], ['i2c', 'I²C'], ['spi', 'SPI'], ['watchdog', 'Watchdog'], ['pull', 'Pull-up / Pull-down ภายใน'], ['serial', 'Serial Monitor / คอนโซล'],
  ['reset', 'ปุ่ม Reset / Boot'], ['voltage', 'ระดับแรงดันขาและการแจ้งเตือน'], ['multi', 'สื่อสารระหว่างหลายบอร์ด'], ['storage', 'หน่วยความจำถาวร (EEPROM/แฟลช)'],
];
export const LEVEL_LABEL: Record<FeatLevel, string> = { supported: 'Supported', partial: 'Partial', unsupported: 'Unsupported', na: 'ไม่มีในบอร์ด' };
export const LEVEL_SIGN: Record<FeatLevel, string> = { supported: '✓', partial: '◐', unsupported: '✗', na: '—' };

const F = (id: string, level: FeatLevel, note: string, evidence?: string[]): BoardFeature => ({ id, level, note, ...(evidence ? { evidence } : {}) });
const NONE = (why: string): BoardFeature[] => FEATURE_LABELS.map(([id]) => F(id, 'unsupported', why));

export const BOARD_PROFILES: BoardProfile[] = [
  {
    kind: 'uno', name: 'Arduino Uno R3 (ATmega328P)',
    engine: 'avr8js 0.21.1 — ประมวลผลคำสั่ง AVR ทีละคำสั่งที่ 16 MHz จากไฟล์ .hex ที่คอมไพล์จริง',
    languages: [
      { name: 'Arduino C/C++', level: 'supported', note: 'คอมไพล์จริงด้วย avr-gcc 7.3 + ArduinoCore-avr 1.8.6 บนบริการคอมไพล์ของเซิร์ฟเวอร์ (ไลบรารี: Wire, SPI, SoftwareSerial, EEPROM, Servo, LiquidCrystal) · หน้าเว็บไฟล์เดียวต้องตั้งที่อยู่บริการ' },
      { name: 'MicroPython / CircuitPython', level: 'na', note: 'ATmega328P มีแรม 2 KB ไม่รองรับ' },
    ],
    features: [
      F('gpio', 'supported', 'D0–D13, A0–A5 (D14–D19) · ขาออกต้านทาน ≈ 25 Ω จำกัด 40 mA · ขาเข้า LOW < 2.25 V / HIGH > 2.75 V (มี hysteresis)', ['tests/uno.test.ts', 'tests/e2e/uno_ui.py']),
      F('adc', 'supported', '10 บิต A0–A5 อ้างอิง AVcc 5 V · ไม่จำลองขา AREF ภายนอก', ['tests/uno.test.ts']),
      F('pwm', 'supported', 'Timer0/1/2 ที่ขา ~3 ~5 ~6 ~9 ~10 ~11 (490/980 Hz) · Servo (Timer1) · tone()', ['tests/uno.test.ts', 'tests/uno-periph.test.ts']),
      F('interrupt', 'supported', 'attachInterrupt INT0 (D2) / INT1 (D3) และ pin change (PCINT) ทุกพอร์ต · ไม่จำลองการเด้งของหน้าสัมผัสปุ่ม', ['tests/uno-periph.test.ts']),
      F('timer', 'supported', 'Timer0 (millis/delay), Timer1, Timer2 รวม interrupt ของ timer', ['tests/uno-periph.test.ts']),
      F('uart', 'partial', 'USART0 ↔ Serial Monitor (บอดเรตตามโค้ด) · เครื่องวิเคราะห์ลอจิกเห็นรูปคลื่นเฟรมที่ขา TX/RX (สร้างจากไบต์ตามบอดเรตของชิป) · วงจรแอนะล็อกยังเห็นขา TX เป็น HIGH จึงยังต่อ UART กับบอร์ด/โมดูลอื่นไม่ได้', ['tests/uno.test.ts', 'tests/logic-analyzer.test.ts']),
      F('i2c', 'supported', 'TWI (Wire.h) ที่ A4/A5 กับอุปกรณ์ I²C ทุกชนิดในแอป · แต่ละขั้นใช้เวลาตามคาบ SCL ของ TWBR (Wire 100 kHz: ไบต์ละ 90 µs) · เครื่องวิเคราะห์ลอจิกเห็นรูปคลื่น SDA/SCL และถอดรหัสได้ · ไม่จำลองเวลาขึ้นของสายจากตัวต้านทานดึงขึ้นและ clock stretching', ['tests/power.test.ts', 'tests/i2c-wave.test.ts']),
      F('spi', 'partial', 'SPI master: SPI.transfer() เสร็จตามเวลา ไบต์ที่อ่าน = ระดับขา MISO (D12) จากวงจร · ยังไม่มีอุปกรณ์ SPI ที่คุยกับ Uno และขา MOSI/SCK ไม่สร้างรูปคลื่น', ['tests/uno-periph.test.ts']),
      F('watchdog', 'supported', 'wdt_enable/wdt_reset · หมดเวลา → รีเซ็ตบอร์ด (เหมือน optiboot: หลังรีเซ็ต watchdog ปิด MCUSR = 0)', ['tests/uno-periph.test.ts']),
      F('pull', 'supported', 'INPUT_PULLUP 20–50 kΩ (ใช้ 35 kΩ) · ATmega328P ไม่มี pull-down ภายใน', ['tests/uno-periph.test.ts']),
      F('serial', 'supported', 'Serial Monitor รับ/ส่งข้อความ', ['tests/uno.test.ts', 'tests/e2e/uno_ui.py']),
      F('reset', 'supported', 'ปุ่ม RESET ในแผง (เริ่มโปรแกรมใหม่ เวลาวงจรเดินต่อ) · ไม่มีปุ่ม Boot ในบอร์ดรุ่นนี้', ['tests/uno.test.ts']),
      F('voltage', 'supported', 'ลอจิก 5 V คำนวณในวงจร · เตือนกระแสขาเกิน 20 mA (แนะนำ) / ถึง 40 mA (สูงสุด), กระแสรวม 200 mA, ขา 5V/3.3V เกิน · ขาออกในแบบจำลองถูกจำกัดที่ 40 mA (ของจริงไม่มีตัวจำกัด)', ['tests/export.test.ts']),
      F('multi', 'partial', 'หลายบอร์ดในวงจรเดียวเดินเวลาพร้อมกัน ขา GPIO ต่อถึงกันได้ (ขอบสัญญาณจากบอร์ดแรกถึงบอร์ดอื่นตรงเวลา) · บอร์ดที่สองขึ้นไปเห็นผลของขาที่ตัวเองเปลี่ยนช้าได้ถึงหนึ่งช่วงคำนวณ (≤ 50 ms) · UART/I²C ระหว่างบอร์ดยังไม่ได้', ['tests/uno-periph.test.ts']),
      F('storage', 'supported', 'EEPROM 1 KB (EEPROM.h) คงอยู่ข้าม RESET/อัปโหลด/เริ่มจำลองใหม่ และบันทึกไปกับไฟล์งาน (Save/บันทึกอัตโนมัติ) เหมือน EEPROM จริงที่ไม่หายเมื่อถอดไฟ', ['tests/uno-periph.test.ts']),
    ],
  },
  {
    kind: 'nano', name: 'Arduino Nano (ATmega328P)',
    engine: 'avr8js 0.21.1 — ชิปเดียวกับ Uno: ประมวลผลคำสั่ง AVR ทีละคำสั่งที่ 16 MHz จากไฟล์ .hex ที่คอมไพล์เป็นบอร์ด Nano (variant eightanaloginputs)',
    languages: [
      { name: 'Arduino C/C++', level: 'supported', note: 'คอมไพล์จริงด้วย avr-gcc 7.3 + ArduinoCore-avr 1.8.6 ตั้งค่าบอร์ด Nano (ARDUINO_AVR_NANO, NUM_ANALOG_INPUTS 8, แฟลช 30,720 ไบต์) · ไลบรารีเดียวกับ Uno' },
      { name: 'MicroPython / CircuitPython', level: 'na', note: 'ATmega328P มีแรม 2 KB ไม่รองรับ' },
    ],
    features: [
      F('gpio', 'supported', 'D0–D13, A0–A5 (D14–D19) · ขาออก ≈ 25 Ω จำกัด 40 mA · ขาเข้า LOW < 2.25 V / HIGH > 2.75 V · A6/A7 ไม่มีวงจรขาดิจิทัล (digitalRead ได้ 0 เสมอ)', ['tests/nano.test.ts', 'tests/e2e/nano_ui.py']),
      F('adc', 'supported', '10 บิต A0–A7 อ้างอิง AVcc 5 V (A6/A7 แอนะล็อกอย่างเดียว) · ไม่จำลองขา AREF ภายนอก', ['tests/nano.test.ts', 'tests/e2e/nano_ui.py']),
      F('pwm', 'supported', 'analogWrite ที่ขา ~3 ~5 ~6 ~9 ~10 ~11 · Servo (Timer1) · tone()', ['tests/nano.test.ts']),
      F('interrupt', 'supported', 'attachInterrupt INT0 (D2) / INT1 (D3) · pin change (PCINT) — ทดสอบ INT0 บน Nano · ไม่จำลองการเด้งของหน้าสัมผัสปุ่ม', ['tests/nano.test.ts']),
      F('timer', 'supported', 'Timer0 (millis/delay), Timer1 (Servo), Timer2 (tone)', ['tests/nano.test.ts']),
      F('uart', 'partial', 'USART0 ↔ Serial Monitor · เครื่องวิเคราะห์ลอจิกเห็นรูปคลื่นเฟรมที่ขา TX/RX  · วงจรแอนะล็อกยังเห็นขา TX เป็น HIGH จึงยังต่อ UART กับบอร์ด/โมดูลอื่นไม่ได้', ['tests/nano.test.ts', 'tests/logic-analyzer.test.ts']),
      F('i2c', 'supported', 'TWI (Wire.h) ที่ A4/A5 · เวลาตามคาบ SCL ของ TWBR · รูปคลื่น SDA/SCL ให้เครื่องวิเคราะห์ลอจิก', ['tests/nano.test.ts']),
      F('spi', 'partial', 'SPI master: ไบต์ที่อ่าน = ระดับขา MISO (D12) จากวงจร · ยังไม่มีอุปกรณ์ SPI ที่คุยกับบอร์ด AVR และขา MOSI/SCK ไม่สร้างรูปคลื่น', ['tests/nano.test.ts']),
      F('watchdog', 'supported', 'wdt_enable/wdt_reset · หมดเวลา → รีเซ็ตบอร์ด', ['tests/nano.test.ts']),
      F('pull', 'supported', 'INPUT_PULLUP 20–50 kΩ (ใช้ 35 kΩ) · ไม่มี pull-down ภายใน · A6/A7 ไม่มี pull-up', ['tests/nano.test.ts']),
      F('serial', 'supported', 'Serial Monitor รับ/ส่งข้อความ', ['tests/nano.test.ts', 'tests/e2e/nano_ui.py']),
      F('reset', 'partial', 'ปุ่ม RESET ในแผงจำลอง (เริ่มโปรแกรมใหม่) · ปุ่มบนตัวบอร์ดและขา RESET (ขา 3/28) ไม่ต่อกับตัวจำลอง', ['tests/nano.test.ts']),
      F('voltage', 'supported', 'ลอจิก 5 V · เตือนกระแสขา 20/40 mA, กระแสรวม 200 mA, ขา 3V3 เกิน 50 mA (ไฟจากชิป USB-serial) · ไม่จำลองแรงดันตกคร่อมไดโอด USB (~0.3 V) และไฟเข้า VIN', ['tests/nano.test.ts']),
      F('multi', 'partial', 'หลายบอร์ดเดินเวลาพร้อมกัน ขา GPIO ต่อถึงกันได้ (ทดสอบ Nano → Uno) · บอร์ดที่สองขึ้นไปเห็นผลของขาที่ตัวเองเปลี่ยนช้าได้ถึงหนึ่งช่วงคำนวณ · UART/I²C ระหว่างบอร์ดยังไม่ได้', ['tests/nano.test.ts']),
      F('storage', 'supported', 'EEPROM 1 KB คงอยู่ข้าม RESET และโหลดจากไฟล์งาน', ['tests/nano.test.ts']),
    ],
  },
  {
    kind: 'promini', name: 'Arduino Pro Mini 328 (ATmega328P)',
    engine: 'avr8js 0.21.1 — ชิปเดียวกับ Uno/Nano: ประมวลผลคำสั่ง AVR ทีละคำสั่งที่ 16 MHz (รุ่น 5 V) หรือ 8 MHz (รุ่น 3.3 V) จากไฟล์ .hex ที่คอมไพล์เป็นบอร์ด Pro or Pro Mini ตาม F_CPU ของรุ่น',
    languages: [
      { name: 'Arduino C/C++', level: 'supported', note: 'คอมไพล์จริงด้วย avr-gcc 7.3 + ArduinoCore-avr 1.8.6 ตั้งค่าบอร์ด Pro or Pro Mini (ARDUINO_AVR_PRO, variant eightanaloginputs, แฟลช 30,720 ไบต์) · F_CPU 16000000L (5 V) / 8000000L (3.3 V) · ไลบรารีเดียวกับ Uno' },
      { name: 'MicroPython / CircuitPython', level: 'na', note: 'ATmega328P มีแรม 2 KB ไม่รองรับ' },
    ],
    features: [
      F('gpio', 'supported', 'D0–D13, A0–A5 · รุ่น 5 V: ขาออก ≈ 25 Ω, ขาเข้า LOW < 2.25 V / HIGH > 2.75 V · รุ่น 3.3 V: ขาออก ≈ 45 Ω (ค่ากลางจาก VOH ≥ 2.3 V ที่ 10 mA), ขาเข้า LOW < 1.49 V / HIGH > 1.82 V · A6/A7 ไม่มีวงจรขาดิจิทัล', ['tests/promini.test.ts', 'tests/e2e/promini_ui.py']),
      F('adc', 'supported', '10 บิต A0–A7 อ้างอิง AVcc = ไฟเลี้ยงของรุ่น (5 V หรือ 3.3 V) · A4–A7 เป็นรูบนบอร์ด ต่อสายที่ขา · ไม่มีขา AREF', ['tests/promini.test.ts', 'tests/e2e/promini_ui.py']),
      F('pwm', 'supported', 'analogWrite ~3 ~5 ~6 ~9 ~10 ~11 · ความถี่ตาม F_CPU: 5 V = 490/977 Hz, 3.3 V = 245/488 Hz (ทดสอบ D9/D5)', ['tests/promini.test.ts', 'tests/e2e/promini_ui.py']),
      F('interrupt', 'supported', 'attachInterrupt INT0 (D2) / INT1 (D3) · pin change — ทดสอบ INT0 บนรุ่น 3.3 V · ไม่จำลองการเด้งของหน้าสัมผัสปุ่ม', ['tests/promini.test.ts']),
      F('timer', 'supported', 'Timer0 (millis/delay) ตรงเวลาทั้ง 16 และ 8 MHz · Timer1/2', ['tests/promini.test.ts']),
      F('uart', 'partial', 'USART0 ↔ Serial Monitor ผ่านตัวแปลง USB-serial (สมมติว่าเสียบหัว 6 ขาไว้) · เครื่องวิเคราะห์ลอจิกถอด 9600 baud ที่ขา TXO ได้บนรุ่น 8 MHz · วงจรแอนะล็อกยังเห็นขา TX เป็น HIGH จึงยังต่อ UART กับโมดูลอื่นไม่ได้', ['tests/promini.test.ts', 'tests/e2e/promini_ui.py']),
      F('i2c', 'supported', 'TWI (Wire.h) ที่รู A4 (SDA)/A5 (SCL) บนบอร์ด · ทดสอบ INA219 บนรุ่น 3.3 V', ['tests/promini.test.ts']),
      F('spi', 'partial', 'SPI master แบบเดียวกับ Nano (ไบต์ที่อ่าน = ระดับขา MISO D12) · ยังไม่มีอุปกรณ์ SPI ที่ตอบกลับ · ยังไม่ได้ทดสอบบน Pro Mini โดยตรง (ชิปและโค้ดตัวจำลองเดียวกับ Nano)', ['tests/nano.test.ts']),
      F('watchdog', 'supported', 'wdt_enable/wdt_reset · หมดเวลาตามฐานเวลา 128 kHz (ไม่ขึ้นกับ 8/16 MHz) → รีเซ็ตบอร์ด', ['tests/promini.test.ts']),
      F('pull', 'supported', 'INPUT_PULLUP 20–50 kΩ (ใช้ 35 kΩ) ดึงขึ้นไปที่ไฟเลี้ยงของรุ่น · ไม่มี pull-down ภายใน', ['tests/promini.test.ts']),
      F('serial', 'supported', 'Serial Monitor รับ/ส่งข้อความ', ['tests/promini.test.ts', 'tests/e2e/promini_ui.py']),
      F('reset', 'partial', 'ปุ่ม RESET ในแผงจำลอง · ปุ่มบนบอร์ด ขา RST และขา DTR/GRN ของตัวแปลง (รีเซ็ตอัตโนมัติ) ไม่ต่อกับตัวจำลอง', ['tests/promini.test.ts']),
      F('voltage', 'partial', 'ลอจิก 5 V หรือ 3.3 V ตามรุ่น · เตือนขาเกิน VCC + 0.5 V บนรุ่น 3.3 V, กระแสขา 20/40 mA, กระแสรวม 200 mA, VCC เกินที่ตัวแปลงจ่ายได้ · ไม่จำลอง: การจ่ายไฟเข้า RAW/แบตเตอรี่ (บอร์ดทำงานจากไฟตัวแปลงเสมอ), เรกูเลเตอร์บนบอร์ด, กระแสที่ชิปกินเอง', ['tests/promini.test.ts']),
      F('multi', 'partial', 'ใช้กลไกหลายบอร์ดเดียวกับ Uno/Nano · ยังไม่ได้ทดสอบ Pro Mini คู่กับบอร์ดอื่นโดยตรง', ['tests/nano.test.ts']),
      F('storage', 'supported', 'EEPROM 1 KB คงอยู่ข้าม RESET และบันทึกไปกับไฟล์งาน', ['tests/promini.test.ts']),
    ],
  },
  {
    kind: 'attiny85', name: 'ATtiny85 (ไอซี DIP-8)',
    engine: 'avr8js 0.21.1 + โปรไฟล์ชิป ATtiny85 ของแอป (ที่อยู่รีจิสเตอร์/เวกเตอร์ตาม avr-libc iotnx5.h, Timer1 แบบ ATtiny ที่แก้โหมด PWM ให้ตรง datasheet) — ประมวลผลทีละคำสั่งที่ 8 MHz จาก .hex ที่คอมไพล์จริง · ชิปทำงานเมื่อไฟเลี้ยงจากวงจรพอ',
    languages: [
      { name: 'Arduino C/C++', level: 'supported', note: 'คอมไพล์จริงด้วย avr-gcc 7.3 + ArduinoCore-avr 1.8.6 (-mmcu=attiny85, F_CPU 8000000L, ตารางขา variants/gemma) · ไลบรารี: SoftwareSerial, EEPROM, LiquidCrystal · บนเครื่องจริงนิยมใช้แกน ATTinyCore — ฟังก์ชันพื้นฐานใช้หมายเลขขาเดียวกัน' },
      { name: 'MicroPython / CircuitPython', level: 'na', note: 'ATtiny85 มีแฟลช 8 KB แรม 512 ไบต์ ไม่รองรับ' },
    ],
    features: [
      F('gpio', 'supported', 'PB0–PB4 (D0–D4) · ขาออกเป็นตัวต้านทาน ≈ 45 Ω ไปยัง VCC/GND ของชิป (ค่าประมาณจาก VOH ≥ 4.3 V ที่ 10 mA) · ขาเข้าเปลี่ยนที่ 0.45/0.55 VCC ที่วัดได้ · ขา 1 (PB5) เป็น RESET', ['tests/attiny85.test.ts', 'tests/e2e/attiny85_ui.py']),
      F('adc', 'supported', '10 บิต A1 (PB2) A2 (PB4) A3 (PB3) อ้างอิง VCC ที่จ่ายจริง (ทดสอบ 5 V และ 4 V) · ไม่รองรับ: ADC0 ที่ขา RESET, อ้างอิงภายใน 2.56 V, อินพุตแบบต่าง (differential)', ['tests/attiny85.test.ts', 'tests/e2e/attiny85_ui.py']),
      F('pwm', 'supported', 'PB0/PB1 (Timer0 fast PWM ≈ 488 Hz) · PB4 (Timer1 TOP = OCR1C ≈ 7.8 kHz ตามสูตร datasheet — แก้จาก avr8js ที่นับขึ้น-ลง)', ['tests/attiny85.test.ts', 'tests/e2e/attiny85_ui.py']),
      F('interrupt', 'supported', 'INT0 (PB2) ทดสอบ FALLING · pin change ใช้ผ่าน SoftwareSerial (ขา RX) แต่ยังไม่ได้ทดสอบรับข้อมูล · ไม่จำลองการเด้งของปุ่ม', ['tests/attiny85.test.ts']),
      F('timer', 'supported', 'Timer0 (millis/delay ตรงเวลาที่ 8 MHz) · Timer1 8 บิตแบบ ATtiny', ['tests/attiny85.test.ts']),
      F('uart', 'na', 'ATtiny85 ไม่มี UART ฮาร์ดแวร์ — ใช้ SoftwareSerial (ดูแถว Serial)'),
      F('i2c', 'unsupported', 'ไม่มี TWI ฮาร์ดแวร์ · USI ของชิปยังไม่ได้ผูกกับบัส I²C ของวงจร และบริการคอมไพล์ยังไม่มีไลบรารี USI (TinyWire)'),
      F('spi', 'unsupported', 'ไม่มี SPI ฮาร์ดแวร์ · USI โหมดสามสายยังไม่จำลอง'),
      F('watchdog', 'supported', 'wdt_enable/wdt_reset · หมดเวลา → รีเซ็ต (ทดสอบ 250 ms)', ['tests/attiny85.test.ts']),
      F('pull', 'supported', 'INPUT_PULLUP 20–50 kΩ (35 kΩ) ไปยัง VCC ของชิป · ขา RESET มีตัวดึงขึ้นภายใน (45 kΩ)', ['tests/attiny85.test.ts']),
      F('serial', 'partial', 'ไม่มี Serial Monitor (ชิปไม่มี USB/UART) · SoftwareSerial ส่งออกขาใดก็ได้ — เครื่องวิเคราะห์ลอจิกถอด 9600 baud ได้ (ทดสอบที่ PB3/PB4) · ยังไม่มีตัวแปลง USB-serial ในแอปที่ต่อเข้าขาแล้วแสดงใน Serial Monitor', ['tests/attiny85.test.ts', 'tests/e2e/attiny85_ui.py']),
      F('reset', 'supported', 'ขา 1 (RESET) ดึงต่ำ = หยุดที่รีเซ็ต ปล่อย = เริ่มใหม่ · ปุ่ม RESET ในแผงจำลอง', ['tests/attiny85.test.ts']),
      F('voltage', 'supported', 'ไฟเลี้ยงจากวงจรที่ขา 8/4: ทำงานเมื่อ VCC ≥ 2.7 V (หยุดเมื่อ < 2.5 V) · HIGH = VCC จริง · กระแสขาออกไหลผ่านแหล่งจ่าย · เตือน VCC เกิน 5.5/6.0 V, กลับขั้ว, ขาเกิน VCC + 0.5 V, กระแสขา 20/40 mA, รวม 200 mA · ไม่จำลองกระแสที่ชิปกินเอง', ['tests/attiny85.test.ts', 'tests/e2e/attiny85_ui.py']),
      F('multi', 'partial', 'ใช้กลไกหลายบอร์ดเดียวกับ AVR อื่น · ยังไม่ได้ทดสอบ ATtiny85 คู่กับบอร์ดอื่น', ['tests/nano.test.ts']),
      F('storage', 'supported', 'EEPROM 512 ไบต์ คงอยู่ข้ามการรีเซ็ตและบันทึกไปกับไฟล์งาน', ['tests/attiny85.test.ts']),
    ],
  },
  {
    kind: 'mega', name: 'Arduino Mega 2560 (ATmega2560)',
    engine: 'avr8js 0.21.1 + โปรไฟล์ชิป ATmega2560 (src/mcu/avr-chips.ts: พอร์ต A–L, Timer0–5, USART0–3, ADC 16 ช่อง, INT0–7, PCINT0–2, PC 22 บิต) — ประมวลผลคำสั่ง AVR ทีละคำสั่งที่ 16 MHz จากไฟล์ .hex ที่คอมไพล์เป็นบอร์ด Mega 2560',
    languages: [
      { name: 'Arduino C/C++', level: 'supported', note: 'คอมไพล์จริงด้วย avr-gcc 7.3 + ArduinoCore-avr 1.8.6 ตั้งค่าบอร์ด Mega 2560 (ARDUINO_AVR_MEGA2560, variant mega, แฟลช 253,952 ไบต์, RAM 8 KB) · ไลบรารีเดียวกับ Uno' },
      { name: 'MicroPython / CircuitPython', level: 'na', note: 'ไม่มีพอร์ตสำหรับ ATmega2560' },
    ],
    features: [
      F('gpio', 'supported', 'D0–D53, A0–A15 (D54–D69) · ขาออก ≈ 25 Ω จำกัด 40 mA · ขาเข้า LOW < 2.25 V / HIGH > 2.75 V · ทดสอบพอร์ต A, C, B, E, G, H, J, K, L ผ่านโปรแกรมจริง', ['tests/mega.test.ts']),
      F('adc', 'supported', '10 บิต A0–A15 อ้างอิง AVcc 5 V (ADC8–15 ผ่านบิต MUX5) · ไม่จำลองขา AREF ภายนอก และแรงดันอ้างอิงภายใน 1.1/2.56 V ยังไม่ได้ทดสอบ', ['tests/mega.test.ts']),
      F('pwm', 'supported', 'analogWrite ที่ 15 ขา: Timer0 (D4, D13 ≈ 977 Hz), Timer1/2/3/4/5 (≈ 490 Hz) รวมช่อง C ของ Timer1/3/4/5 · Servo (Timer5) · tone() (Timer2)', ['tests/mega.test.ts']),
      F('interrupt', 'supported', 'attachInterrupt ที่ D2 (INT4), D3 (INT5), D18 (INT3), D19 (INT2) ทดสอบแล้ว · D20/D21 (INT1/INT0) ใช้ร่วมกับ I²C · pin change PCINT0–2 (ทดสอบ PCINT16 ที่ A8 และ PCINT9 ที่ D15) · ไม่จำลองการเด้งของหน้าสัมผัสปุ่ม', ['tests/mega.test.ts']),
      F('timer', 'supported', 'Timer0 (millis/delay), Timer1–5 (PWM, Servo ใช้ Timer5), Timer2 (tone)', ['tests/mega.test.ts']),
      F('uart', 'partial', 'Serial (USART0) ↔ Serial Monitor · Serial1–3 ส่งออกขา TX (D18/D16/D14) ตามบอดเรต — เครื่องวิเคราะห์ลอจิกถอดข้อความได้ ไม่ปนใน Serial Monitor (เหมือนบอร์ดจริง) · วงจรแอนะล็อกยังเห็นขา TX เป็น HIGH และขา RX1–3 ยังไม่รับข้อมูลจากอุปกรณ์อื่น', ['tests/mega.test.ts']),
      F('i2c', 'supported', 'TWI (Wire.h) ที่ D20 (SDA)/D21 (SCL) และขา SDA/SCL ข้าง AREF (ต่อกันบนบอร์ด) กับอุปกรณ์ I²C ในแอป · ต่อที่ A4/A5 แบบ Uno → ไม่พบอุปกรณ์ (เหมือนบอร์ดจริง)', ['tests/mega.test.ts']),
      F('spi', 'partial', 'SPI master: SPI.transfer() เสร็จตามเวลา ไบต์ที่อ่าน = ระดับขา MISO (D50) จากวงจร · ยังไม่มีอุปกรณ์ SPI ที่คุยกับบอร์ด AVR และขา MOSI/SCK ไม่สร้างรูปคลื่น', ['tests/mega.test.ts']),
      F('watchdog', 'supported', 'wdt_enable/wdt_reset · หมดเวลา → รีเซ็ตบอร์ด (ตัวจำลองไม่มี bootloader stk500v2: หลังรีเซ็ต watchdog ปิด)', ['tests/mega.test.ts']),
      F('pull', 'supported', 'INPUT_PULLUP 20–50 kΩ (ใช้ 35 kΩ) · ไม่มี pull-down ภายใน', ['tests/mega.test.ts']),
      F('serial', 'supported', 'Serial Monitor รับ/ส่งข้อความ (USART0)', ['tests/mega.test.ts']),
      F('reset', 'partial', 'ปุ่ม RESET ในแผงจำลอง (เริ่มโปรแกรมใหม่) · ปุ่มบนตัวบอร์ดและขา RESET ไม่ต่อกับตัวจำลอง', ['tests/mega.test.ts']),
      F('voltage', 'supported', 'ลอจิก 5 V · เตือนกระแสขา 20/40 mA โดยใช้ชื่อขาของ Mega, กระแสรวม 200 mA, ขา 5V/3.3V เกิน · ไม่ตรวจขีดจำกัดกระแสรวมต่อกลุ่มพอร์ตตาม datasheet', ['tests/mega.test.ts']),
      F('multi', 'partial', 'หลายบอร์ดเดินเวลาพร้อมกัน ขา GPIO ต่อถึงกันได้ (ทดสอบ Mega → Uno) · UART/I²C ระหว่างบอร์ดยังไม่ได้', ['tests/mega.test.ts']),
      F('storage', 'supported', 'EEPROM 4 KB คงอยู่ข้าม RESET และบันทึก/โหลดกับไฟล์งาน (ทดสอบที่อยู่ 4000)', ['tests/mega.test.ts']),
    ],
  },
  {
    kind: 'unoq', name: 'Arduino UNO Q (โหมดจำลองพฤติกรรม)',
    engine: 'โหมดจำลองพฤติกรรม — ไม่มีตัวจำลอง STM32U585 (Cortex-M33 + Zephyr) และ QRB2210 (Linux): สเก็ตช์คอมไพล์ด้วย API ของ Arduino (บอร์ด "unoq" = avr-gcc + ArduinoCore-avr, กำหนด CIRCUITLAB_UNOQ_BEHAVIORAL) แล้วรันบน avr8js โดยใช้ไฟฟ้าขาของ UNO Q · เวลาคำสั่งเป็นของ AVR 16 MHz',
    languages: [
      { name: 'Arduino C/C++ (API ของ Arduino)', level: 'partial', note: 'ฟังก์ชันมาตรฐาน (pinMode/digitalWrite/digitalRead/analogRead/analogWrite/millis/delay/Serial/Wire/Servo/LiquidCrystal_I2C) ทำงานผ่านตัวจำลอง AVR · คำสั่งเฉพาะ UNO Q (Bridge, Arduino_LED_Matrix, Wire1/Wire2, Serial1, analogReadResolution, Zephyr) ถูกปฏิเสธตอนคอมไพล์พร้อมข้อความ · โค้ดที่ใช้ได้ในแอปไม่รับประกันว่าคอมไพล์บน Arduino Core (Zephyr) จริงได้ทุกบรรทัด' },
      { name: 'Python (แอปฝั่ง Linux / App Lab)', level: 'unsupported', note: 'ไม่มีการจำลอง Debian Linux บน QRB2210' },
    ],
    features: [
      F('gpio', 'partial', 'D0–D13, A0–A5 ลอจิก 3.3 V: ขาออก ≈ 50 Ω จำกัด 20 mA · ขาเข้า LOW < 1.5 V / HIGH > 1.8 V · ขาเข้าทน 5 V ยกเว้น D3 และ A0–A5 (3.6 V) — เวลาเปลี่ยนขาเป็นของ AVR', ['tests/unoq.test.ts']),
      F('adc', 'partial', 'analogRead() 10 บิต อ้างอิง 3.3 V (ADC จริง 14 บิต — analogReadResolution ไม่รองรับ) · DAC A0/A1 ไม่รองรับ', ['tests/unoq.test.ts']),
      F('pwm', 'partial', 'analogWrite() และ Servo ที่ ~3 ~5 ~6 ~9 ~10 ~11 ระดับ 3.3 V · ความถี่ PWM เป็นของ Timer AVR (490/980 Hz) ไม่ใช่ของ STM32', ['tests/unoq.test.ts']),
      F('interrupt', 'partial', 'attachInterrupt ทำงานตามตัวจำลอง AVR (D2/D3 + pin change) — บน UNO Q จริงใช้ได้ทุกขา', ['tests/unoq.test.ts']),
      F('timer', 'partial', 'millis/delay/micros ตามเวลาจำลอง · Timer ของ STM32 ไม่จำลอง', ['tests/unoq.test.ts']),
      F('uart', 'unsupported', 'Serial1 (D0/D1) ไม่รองรับ — คอมไพล์แล้วแจ้งข้อผิดพลาด'),
      F('i2c', 'partial', 'Wire = I2C2 ที่หัวต่อ SDA/SCL (ไม่ใช่ A4/A5) กับอุปกรณ์ I²C ในแอป (LCD 16×2 I²C, OLED, RTC ฯลฯ) · Wire1 (Qwiic) และ Wire2 (A4/A5) ไม่รองรับ', ['tests/unoq.test.ts']),
      F('spi', 'unsupported', 'ยังไม่ได้ทดสอบกับ UNO Q'),
      F('watchdog', 'unsupported', 'ไม่จำลอง watchdog ของ STM32'),
      F('pull', 'partial', 'INPUT_PULLUP ≈ 40 kΩ ไป 3.3 V · INPUT_PULLDOWN ไม่รองรับ (ตัวจำลอง AVR ไม่มี)', ['tests/unoq.test.ts']),
      F('serial', 'partial', 'Serial → Serial Monitor (บน UNO Q จริงส่งผ่าน Monitor/Bridge) · ไม่ออกขา D0/D1', ['tests/unoq.test.ts']),
      F('reset', 'partial', 'ปุ่ม RESET ในแผงเริ่มสเก็ตช์ใหม่ · ไม่จำลองการบูต Linux', ['tests/unoq.test.ts']),
      F('voltage', 'supported', 'เตือนแรงดันเกิน 3.6 V ที่ A0–A5/D3 และเกิน 5.5 V ที่ขาอื่น, กระแสขาเกิน 20 mA, รวมเกิน 120 mA, ขา 5V เกินแหล่งจ่าย USB-C ที่เลือก, โมดูล I²C ที่ต่อ A4/A5', ['tests/unoq.test.ts']),
      F('multi', 'unsupported', 'Bridge/RPC ระหว่าง MCU กับ Linux ไม่รองรับ'),
      F('storage', 'unsupported', 'บน UNO Q จริงไม่มี EEPROM แบบ AVR — ตัวจำลองยังรับ EEPROM.h แต่ไม่ตรงกับบอร์ดจริง จึงไม่ประกาศว่ารองรับ'),
    ],
  },
  {
    kind: 'picow', name: 'Raspberry Pi Pico W (RP2040 — ไม่จำลองไร้สาย)',
    engine: 'rp2040js 1.4.1 — ARM Cortex-M0+ ทีละคำสั่ง รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build จากการตั้งค่า Pico W (PICO_BOARD pico_w) โดยปิดส่วนไร้สาย — ชิป CYW43439 ไม่ได้จำลอง',
    languages: [
      { name: 'MicroPython', level: 'supported', note: 'เฟิร์มแวร์ที่ build เฉพาะรุ่นนี้ (firmware/board-picow) · network/bluetooth ไม่มีในเฟิร์มแวร์จำลอง · Pin("LED") แจ้ง ValueError' },
      { name: 'C/C++ (Pico SDK / Arduino)', level: 'unsupported', note: 'ยังไม่มีบริการคอมไพล์สำหรับ ARM' },
      { name: 'CircuitPython', level: 'unsupported', note: 'ยังไม่ได้ build เฟิร์มแวร์' },
    ],
    features: [
      F('gpio', 'supported', 'GP0–GP22, GP26–GP28 เหมือน Pico (GP23/24/25/29 ใช้กับชิปไร้สาย ไม่ออกหัวต่อ) · LED บนบอร์ดต่อกับ CYW43 — ไม่จำลอง', ['tests/picow.test.ts', 'tests/e2e/picow_ui.py']),
      F('adc', 'partial', 'ADC 12 บิต GP26–GP28 — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/e2e/adcpwm_ui.py']),
      F('pwm', 'supported', 'PWM ฮาร์ดแวร์ (ทดสอบ GP16 1 kHz duty 25 % ด้วยเฟิร์มแวร์ Pico W)', ['tests/picow.test.ts', 'tests/e2e/picow_ui.py']),
      F('interrupt', 'partial', 'Pin.irq — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/input.test.ts']),
      F('timer', 'partial', 'machine.Timer, time.sleep — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/pico-periph.test.ts']),
      F('uart', 'partial', 'UART0 = REPL/Serial Monitor (ทดสอบ) · UART กับโมดูลอื่นยังไม่ได้ (เหมือน Pico)', ['tests/picow.test.ts']),
      F('i2c', 'partial', 'I2C ฮาร์ดแวร์/SoftI2C — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/i2c-wave.test.ts']),
      F('spi', 'partial', 'SPI ทิศส่งออก — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/e2e/roundwatch_ui.py']),
      F('watchdog', 'partial', 'machine.WDT — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/pico-periph.test.ts']),
      F('pull', 'supported', 'Pin.PULL_UP (ทดสอบ SW2 ในแลป 52 ด้วยเฟิร์มแวร์ Pico W) / PULL_DOWN', ['tests/picow.test.ts']),
      F('serial', 'supported', 'REPL/Serial Monitor ผ่าน UART0', ['tests/picow.test.ts', 'tests/e2e/picow_ui.py']),
      F('reset', 'partial', 'ปุ่ม "รีเซ็ตบอร์ด" ในแผง · ไม่จำลอง BOOTSEL/UF2', ['tests/pico-periph.test.ts']),
      F('voltage', 'partial', 'คำเตือนแรงดัน/กระแสขาแบบเดียวกับ Pico — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบซ้ำด้วยเฟิร์มแวร์ Pico W', ['tests/sensor.test.ts']),
      F('multi', 'partial', 'เหมือน Pico: GPIO ระหว่างบอร์ดได้ · UART/I²C ระหว่างบอร์ดยังไม่ได้', []),
      F('storage', 'partial', 'LittleFS อิมเมจเดียวกับ Pico (มีไลบรารีจอ) · ขนาดระบบไฟล์ในตัวจำลอง 1.4 MB ใหญ่กว่าบอร์ดจริง (≈ 848 KB เพราะเฟิร์มแวร์จริงมีส่วนไร้สาย)', ['tests/picow.test.ts']),
    ],
  },
  {
    kind: 'esp32devkitc', name: 'ESP32-DevKitC V4 (ESP32 ผ่าน QEMU บนเซิร์ฟเวอร์)',
    engine: 'QEMU (lcgamboa/qemu สาขา picsimlab-esp32, GPL-2.0) รันเป็นโปรเซสแยกบนเซิร์ฟเวอร์ผ่าน esp32-bridge — จำลอง CPU Xtensa LX6 ทีละคำสั่งด้วย -icount (4 ns ต่อคำสั่ง) เดินเวลาพร้อมกับตัวจำลองวงจร (ทำงานบนเซิร์ฟเวอร์เช่นกัน) · เฟิร์มแวร์ MicroPython v1.24.1 ESP32_GENERIC ทางการ',
    languages: [
      { name: 'MicroPython', level: 'supported', note: 'เฟิร์มแวร์ทางการของ micropython.org (ไม่ได้ดัดแปลง) · ต้องตั้งที่อยู่บริการ · เซิร์ฟเวอร์รับได้จำกัดจำนวนพร้อมกัน' },
      { name: 'Arduino C/C++ (arduino-esp32)', level: 'unsupported', note: 'ยังไม่ได้ติดตั้งชุดคอมไพเลอร์ ESP32 (~1.5 GB) บนเซิร์ฟเวอร์' },
      { name: 'ESP-IDF (C)', level: 'unsupported', note: 'ยังไม่มีบริการคอมไพล์' },
    ],
    features: [
      F('gpio', 'supported', 'GPIO 0–5, 12–19, 21–23, 25–27, 32–33 ขาออก/ขาเข้า · 34–39 ขาเข้าเท่านั้น · GPIO6–11 (แฟลช) ไม่ต่อ · ขาออก ≈ 16.5 Ω จำกัด 40 mA, ขาเข้า LOW < 0.825 V / HIGH > 2.475 V (datasheet ตาราง 5-3)', ['tests/esp32.test.ts', 'tests/e2e/esp32_ui.py']),
      F('adc', 'partial', 'ADC1/ADC2 12 บิต (ทดสอบ IO34 = ADC1_CH6) · ค่าคิดเต็มสเกล 3.3 V ไม่ขึ้นกับ atten และไม่จำลองความไม่เป็นเชิงเส้นของ ADC ESP32 · read_uv() ใช้ไม่ได้ (QEMU ไม่มีค่าปรับเทียบใน eFuse)', ['tests/esp32.test.ts']),
      F('pwm', 'partial', 'machine.PWM (LEDC) — QEMU เก็บรีจิสเตอร์ แอปสร้างรูปคลื่นที่ขาจากรีจิสเตอร์ (ทดสอบ 1 kHz duty 25 % บน IO2) · อ่านรีจิสเตอร์ทุก 1 ms ของเวลาจำลอง เฟสของคาบไม่ตรงกับชิปจริง', ['tests/esp32.test.ts']),
      F('interrupt', 'unsupported', 'Pin.irq ยังไม่ได้ทดสอบกับ ESP32'),
      F('timer', 'partial', 'time.sleep / time.sleep_ms ตามเวลาเสมือนของ QEMU (ทดสอบ) · machine.Timer ยังไม่ได้ทดสอบ', ['tests/esp32.test.ts']),
      F('uart', 'partial', 'UART0 = REPL/Serial Monitor (เหมือนบอร์ดจริงที่ผ่านชิป USB-UART) · UART1/2 กับอุปกรณ์ในวงจรยังไม่ได้', ['tests/esp32.test.ts']),
      F('i2c', 'supported', 'I2C ฮาร์ดแวร์ (I2C(0) ที่ IO21/IO22 กับ BH1750: scan + อ่านค่า) ผ่าน callback ระดับธุรกรรมของ QEMU · ขาของบัสหาจาก GPIO matrix', ['tests/esp32.test.ts']),
      F('spi', 'unsupported', 'ยังไม่ได้ต่อ callback SPI ของ QEMU กับอุปกรณ์ในวงจร'),
      F('watchdog', 'unsupported', 'ยังไม่ได้ทดสอบ'),
      F('pull', 'partial', 'Pin.PULL_UP/PULL_DOWN ได้เฉพาะขาที่ไม่ใช่ RTC IO (เช่น IO5, 16–19, 21–23 — ทดสอบ IO5) · ขา RTC IO (0, 2, 4, 12–15, 25–27, 32–39) QEMU ไม่จำลองรีจิสเตอร์ RTC_IO จึงไม่มีตัวดึง', ['tests/esp32.test.ts']),
      F('serial', 'supported', 'REPL/Serial Monitor ผ่าน UART0', ['tests/esp32.test.ts', 'tests/e2e/esp32_ui.py']),
      F('reset', 'unsupported', 'ปุ่ม EN/Boot และการรีเซ็ตยังไม่ได้ต่อ (เริ่มจำลองใหม่ = บูตใหม่)'),
      F('voltage', 'supported', 'เตือนขาเกิน 3.6 V, กระแสขาเกิน 20 mA, ต่อขาแฟลช GPIO6–11, IO12 ถูกดึงขึ้น (ขา strapping)', ['tests/esp32.test.ts']),
      F('multi', 'unsupported', 'ESP32 ต้องอยู่คนเดียวในวงจร (ยังไม่ได้ทดสอบร่วมกับบอร์ดอื่น)'),
      F('storage', 'partial', 'ระบบไฟล์ของ MicroPython ในแฟลช 4 MB ของ QEMU (สำเนาต่อเซสชัน หายเมื่อปิดเซสชัน) · ยังไม่ได้ทดสอบการเขียนไฟล์', []),
    ],
  },
  {
    kind: 'nanoconnect', name: 'Arduino Nano RP2040 Connect (RP2040 — ไม่จำลอง NINA-W102)',
    engine: 'rp2040js 1.4.1 — ARM Cortex-M0+ ทีละคำสั่ง รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build จากนิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT โดยปิดโมดูล NINA-W102 · IMU LSM6DSOX บนบอร์ดจำลองระดับรีจิสเตอร์บนบัส I²C ของ A4/A5',
    languages: [
      { name: 'MicroPython', level: 'supported', note: 'เฟิร์มแวร์ที่ build เฉพาะรุ่นนี้ (firmware/board-nanoconnect) · ชื่อขา TX/RX/D2–D13/A0–A3/SDA/SCL/LED ตามนิยามบอร์ด · มีไดรเวอร์ lsm6dsox · network/bluetooth และขาผ่าน NINA (LEDR/LEDG/LEDB, A4–A7 แอนะล็อก) ไม่มีในเฟิร์มแวร์จำลอง' },
      { name: 'Arduino C/C++ (Arduino Mbed OS / arduino-pico)', level: 'unsupported', note: 'ยังไม่มีบริการคอมไพล์สำหรับ ARM' },
      { name: 'CircuitPython', level: 'unsupported', note: 'ยังไม่ได้ build เฟิร์มแวร์' },
    ],
    features: [
      F('gpio', 'supported', 'D2–D13, A0–A5 เป็นขาดิจิทัล (GPIO ตาม pins.csv) · TX/RX ใช้เป็น REPL · LED บนบอร์ด = D13 (GPIO6) · A6/A7 ไม่ต่อกับ RP2040', ['tests/nanoconnect.test.ts', 'tests/e2e/nanoconnect_ui.py']),
      F('adc', 'partial', 'A0–A3 (ADC0–3 ของ RP2040) ทดสอบ A3 · A4–A7 แบบแอนะล็อกอ่านผ่าน ADC ของ NINA-W102 — ไม่จำลอง', ['tests/nanoconnect.test.ts']),
      F('pwm', 'supported', 'PWM ฮาร์ดแวร์ (ทดสอบ D2 1 kHz duty 25 %)', ['tests/nanoconnect.test.ts']),
      F('interrupt', 'supported', 'Pin.irq ขอบขาลงที่ D3 นับการกดปุ่ม', ['tests/nanoconnect.test.ts']),
      F('timer', 'supported', 'machine.Timer แบบ PERIODIC 50 ms (ทดสอบความถี่ที่ LED บนบอร์ด), time.sleep', ['tests/nanoconnect.test.ts']),
      F('uart', 'partial', 'UART0 (TX/RX) = REPL/Serial Monitor ในตัวจำลอง (บนบอร์ดจริง REPL อยู่ที่ USB) · UART1 ใช้กับ NINA บนบอร์ดจริง · UART กับโมดูลอื่นยังไม่ได้', ['tests/nanoconnect.test.ts']),
      F('i2c', 'supported', 'I2C(0) ที่ A4 (SDA, GPIO12) / A5 (SCL, GPIO13) ดึงขึ้น 4.7 kΩ บนบอร์ด: IMU LSM6DSOX (0x6A) + BH1750 ภายนอกบนบัสเดียวกัน · ชิปเข้ารหัส ATECC608A (0x60) ไม่จำลอง — scan บนบอร์ดจริงเห็น 0x60 เพิ่ม', ['tests/nanoconnect.test.ts']),
      F('spi', 'partial', 'SPI0 ที่ D11/D12/D13 ทิศส่งออก — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบด้วยเฟิร์มแวร์นี้', ['tests/e2e/roundwatch_ui.py']),
      F('watchdog', 'partial', 'machine.WDT — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบด้วยเฟิร์มแวร์นี้', ['tests/pico-periph.test.ts']),
      F('pull', 'supported', 'Pin.PULL_UP ที่ D3 (ปุ่มลง GND) / PULL_DOWN', ['tests/nanoconnect.test.ts']),
      F('serial', 'supported', 'REPL/Serial Monitor ผ่าน UART0', ['tests/nanoconnect.test.ts', 'tests/e2e/nanoconnect_ui.py']),
      F('reset', 'partial', 'ปุ่ม "รีเซ็ตบอร์ด" ในแผง (ทดสอบบน Pico) · ขา RST/REC และปุ่มบนบอร์ดไม่จำลอง', ['tests/pico-periph.test.ts']),
      F('voltage', 'supported', 'เตือนขาเกิน 3.6 V ด้วยชื่อขา D/A + GPIO, ขา REPL ถูกใช้, กระแสขาเกิน 8 mA (IOH/IOL ใน datasheet), ใช้ A6/A7 (ผ่าน NINA) · 3.3V ≤ 800 mA', ['tests/nanoconnect.test.ts']),
      F('multi', 'partial', 'เหมือน Pico: GPIO ระหว่างบอร์ดได้ · UART/I²C ระหว่างบอร์ดยังไม่ได้', []),
      F('storage', 'partial', 'LittleFS อิมเมจเดียวกับ Pico ขนาด 1.4 MB (บอร์ดจริง 14 MB แบบ FAT ผ่าน USB) · ทดสอบการเขียนไฟล์บน Pico เท่านั้น', ['tests/pico-periph.test.ts']),
    ],
  },
  {
    kind: 'xiao', name: 'Seeed Studio XIAO RP2040',
    engine: 'rp2040js 1.4.1 — ARM Cortex-M0+ ทีละคำสั่ง รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build ด้วยนิยามบอร์ด SEEED_XIAO_RP2040 (ยกมาจาก MicroPython v1.28.0) · LED RGB และ NeoPixel บนบอร์ดอ่านจากสถานะ/สัญญาณขาจริงของ CPU',
    languages: [
      { name: 'MicroPython', level: 'supported', note: 'เฟิร์มแวร์ที่ build เฉพาะรุ่นนี้ (firmware/board-xiao) · ชื่อขา Pin("D0")…Pin("D10"), "A0"–"A3", "LED_R/G/B", "NEOPIXEL" ตามนิยามบอร์ดของ MicroPython · โมดูล neopixel ใช้ได้ (ทดสอบ) · rp2.PIO/StateMachine ไม่รองรับ' },
      { name: 'C/C++ (Pico SDK / Arduino)', level: 'unsupported', note: 'ยังไม่มีบริการคอมไพล์สำหรับ ARM' },
      { name: 'CircuitPython', level: 'unsupported', note: 'ยังไม่ได้ build เฟิร์มแวร์' },
    ],
    features: [
      F('gpio', 'supported', 'D0–D10 (GPIO26–29, 6, 7, 0, 1, 2, 4, 3) · D6/D7 ใช้เป็น REPL · ไฟฟ้าขาแบบเดียวกับ Pico (RP2040 3.3 V) · LED RGB บนบอร์ด (GPIO17/16/25) ติดเมื่อ LOW', ['tests/xiao.test.ts', 'tests/e2e/xiao_ui.py']),
      F('adc', 'supported', 'ADC 12 บิต D0–D3 (A0–A3 = ADC0–3) อ้างอิง 3.3 V · ทดสอบ A3 (GPIO29 = ADC3 ซึ่ง Pico ไม่มีออกขา) อ่านตัวแบ่งแรงดัน', ['tests/xiao.test.ts']),
      F('pwm', 'supported', 'PWM ฮาร์ดแวร์ (ทดสอบ LED_G 1 kHz duty 25 % → LED สว่าง 75 % เพราะติดเมื่อ LOW)', ['tests/xiao.test.ts']),
      F('interrupt', 'supported', 'Pin.irq ขอบขาลงที่ D1 นับการกดปุ่ม', ['tests/xiao.test.ts']),
      F('timer', 'supported', 'machine.Timer แบบ PERIODIC 50 ms (ทดสอบความถี่ที่ขา D0), time.sleep', ['tests/xiao.test.ts']),
      F('uart', 'partial', 'UART0 (D6/D7) = REPL/Serial Monitor ในตัวจำลอง (บนบอร์ดจริง REPL อยู่ที่ USB) · UART กับโมดูลอื่นยังไม่ได้', ['tests/xiao.test.ts']),
      F('i2c', 'supported', 'I2C(1) ฮาร์ดแวร์ที่ D4 (SDA, GPIO6) / D5 (SCL, GPIO7) กับ BH1750: scan + อ่านค่า · I2C(0) ที่นิยามบอร์ดต้นฉบับตั้งเป็นค่าเริ่มไม่ได้ทดสอบ (GPIO6/7 เป็นขาของ I2C1 ในฮาร์ดแวร์)', ['tests/xiao.test.ts']),
      F('spi', 'partial', 'SPI0 ที่ D8/D9/D10 ทิศส่งออก — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบด้วยเฟิร์มแวร์ XIAO', ['tests/e2e/roundwatch_ui.py']),
      F('watchdog', 'partial', 'machine.WDT — ใช้ตัวจำลอง RP2040 ชุดเดียวกับ Pico — ทดสอบด้วยเฟิร์มแวร์ Pico ยังไม่ได้ทดสอบด้วยเฟิร์มแวร์ XIAO', ['tests/pico-periph.test.ts']),
      F('pull', 'supported', 'Pin.PULL_UP ที่ D1 (ปุ่มลง GND) / PULL_DOWN', ['tests/xiao.test.ts']),
      F('serial', 'supported', 'REPL/Serial Monitor ผ่าน UART0', ['tests/xiao.test.ts', 'tests/e2e/xiao_ui.py']),
      F('reset', 'partial', 'ปุ่ม "รีเซ็ตบอร์ด" ในแผง (ทดสอบบน Pico) · ปุ่ม B/R บนโมเดลไม่ได้จำลอง', ['tests/pico-periph.test.ts']),
      F('voltage', 'supported', 'เตือนขาเกิน 3.6 V (ไม่ทน 5 V) ด้วยชื่อขา D และ GPIO, ขา REPL ถูกใช้, กระแสขาเกิน 12 mA · พิกัด 3V3 (300 mA) เป็นค่าประมาณ — Seeed ไม่ระบุ', ['tests/xiao.test.ts']),
      F('multi', 'partial', 'เหมือน Pico: GPIO ระหว่างบอร์ดได้ · UART/I²C ระหว่างบอร์ดยังไม่ได้', []),
      F('storage', 'partial', 'LittleFS อิมเมจเดียวกับ Pico (1.4 MB เท่าบอร์ดจริงตามนิยามบอร์ด) · ทดสอบการเขียนไฟล์บน Pico เท่านั้น', ['tests/pico-periph.test.ts']),
    ],
  },
  {
    kind: 'pico', name: 'Raspberry Pi Pico (RP2040)',
    engine: 'rp2040js 1.4.1 — ประมวลผลคำสั่ง ARM Cortex-M0+ ทีละคำสั่ง รันเฟิร์มแวร์ MicroPython v1.24.1 จริง',
    languages: [
      { name: 'MicroPython', level: 'supported', note: 'เฟิร์มแวร์จริง · ตรวจโค้ดด้วยคอมไพเลอร์บนบอร์ด · traceback ชี้บรรทัด' },
      { name: 'C/C++ (Pico SDK / Arduino)', level: 'unsupported', note: 'ยังไม่มีบริการคอมไพล์สำหรับ ARM' },
      { name: 'CircuitPython', level: 'unsupported', note: 'ยังไม่ได้ build เฟิร์มแวร์' },
    ],
    features: [
      F('gpio', 'supported', 'GP0–GP22, GP26–GP28 (GP0/GP1 ใช้เป็น REPL) · ขาออก 80 Ω จำกัด 50 mA · ขาเข้า 1.4/1.8 V', ['tests/sensor.test.ts', 'tests/e2e/adcpwm_ui.py']),
      F('adc', 'supported', '12 บิต GP26–GP28 อ้างอิง 3.3 V', ['tests/e2e/adcpwm_ui.py']),
      F('pwm', 'supported', 'PWM ฮาร์ดแวร์ทุกขา GPIO', ['tests/e2e/adcpwm_ui.py']),
      F('interrupt', 'supported', 'Pin.irq (ขอบขึ้น/ลง)', ['tests/input.test.ts']),
      F('timer', 'supported', 'machine.Timer, time.sleep/ticks', ['tests/pico-periph.test.ts']),
      F('uart', 'partial', 'UART0 = REPL/Serial Monitor · เครื่องวิเคราะห์ลอจิกเห็นรูปคลื่นเฟรมที่ GP0/GP1 (สร้างจากไบต์ตามตัวหารบอดเรตของชิป) · วงจรแอนะล็อกไม่เห็นบิต UART จึงยังต่อ UART กับบอร์ด/โมดูลอื่นไม่ได้', ['tests/sensor.test.ts', 'tests/logic-analyzer.test.ts']),
      F('i2c', 'supported', 'I2C ฮาร์ดแวร์ทั้งสองชุด + SoftI2C กับอุปกรณ์ I²C ในแอป · I2C ฮาร์ดแวร์ใช้เวลาตามคาบ SCL (HCNT + LCNT) และส่งรูปคลื่นให้เครื่องวิเคราะห์ลอจิก', ['tests/power.test.ts', 'tests/i2c-wave.test.ts']),
      F('spi', 'partial', 'SPI ทิศส่งออก → จอ GC9A01 · การอ่านกลับทาง MISO ยังไม่ต่อกับอุปกรณ์', ['tests/e2e/roundwatch_ui.py']),
      F('watchdog', 'supported', 'machine.WDT หมดเวลา และ machine.reset() → บูต MicroPython ใหม่จากแฟลชเดิม (time.ticks_ms ไม่เริ่มที่ 0 ใหม่)', ['tests/pico-periph.test.ts']),
      F('pull', 'supported', 'Pin.PULL_UP / Pin.PULL_DOWN ≈ 50 kΩ · ขาเข้าลอยค้างค่าเดิม + คำเตือน', ['tests/sensor.test.ts']),
      F('serial', 'supported', 'REPL/Serial Monitor ผ่าน UART0', ['tests/sensor.test.ts']),
      F('reset', 'partial', 'ปุ่ม "รีเซ็ตบอร์ด" ในแผง · ไม่จำลองปุ่ม BOOTSEL และโหมด UF2', ['tests/pico-periph.test.ts']),
      F('voltage', 'supported', 'เตือนขาเกิน 3.6 V (ไม่ทน 5 V), กระแสขาเกิน 12 mA, 3V3/VBUS เกิน, ขาเข้าลอย', ['tests/sensor.test.ts']),
      F('multi', 'partial', 'GPIO ระหว่างบอร์ดได้ · UART/I²C ระหว่างบอร์ดยังไม่ได้ · PIO ยังไม่ต่อกับวงจร', []),
      F('storage', 'partial', 'ระบบไฟล์ LittleFS ในแฟลช (มีไลบรารีจอให้แล้ว) คงอยู่ข้ามการรีเซ็ตด้วย watchdog — เริ่มจำลองใหม่กลับเป็นอิมเมจเดิม', ['tests/pico-periph.test.ts']),
    ],
  },
  {
    kind: 'esp32s2', name: 'ESP32-S2-DevKitM-1',
    engine: 'ไม่มี — ยังไม่มีตัวจำลอง CPU Xtensa LX7 ที่ทำงานในเบราว์เซอร์ (เฉพาะโมเดล 3D และตำแหน่ง/ชื่อขา)',
    languages: [{ name: 'Arduino C/C++, MicroPython, CircuitPython', level: 'unsupported', note: 'รันโค้ดไม่ได้ — แผงแจ้งชัดเจนว่าเฉพาะโมเดล' }],
    features: NONE('เฉพาะโมเดล 3D — ไม่มีการจำลอง CPU'),
  },
  {
    kind: 'bluepill', name: 'STM32F103C8T6 "Blue Pill"',
    engine: 'ไม่มี — ยังไม่มีตัวจำลอง CPU STM32F103 (Cortex-M3) ในแอป (เฉพาะโมเดล 3D และตำแหน่ง/ชื่อขา)',
    languages: [{ name: 'Arduino C/C++ (STM32duino), MicroPython', level: 'unsupported', note: 'รันโค้ดไม่ได้ — แผงแจ้งชัดเจนว่าเฉพาะโมเดล' }],
    features: NONE('เฉพาะโมเดล 3D — ไม่มีการจำลอง CPU'),
  },
  {
    kind: 'pico2', name: 'Raspberry Pi Pico 2 (RP2350)',
    engine: 'ไม่มี — rp2040js ในแอปจำลองได้เฉพาะ RP2040 · RP2350 (Cortex-M33 / Hazard3 RISC-V) ยังไม่มีตัวจำลอง (เฉพาะโมเดล 3D และตำแหน่ง/ชื่อขา)',
    languages: [{ name: 'MicroPython, C/C++ (Pico SDK/Arduino)', level: 'unsupported', note: 'รันโค้ดไม่ได้ — ใช้ Raspberry Pi Pico (RP2040) แทนได้ ขาเหมือนกัน' }],
    features: NONE('เฉพาะโมเดล 3D — ไม่มีการจำลอง CPU'),
  },
  {
    kind: 'teensy41', name: 'Teensy 4.1 (i.MX RT1062)',
    engine: 'ไม่มี — ยังไม่มีตัวจำลอง CPU i.MX RT1062 (Cortex-M7 600 MHz) ในแอป (เฉพาะโมเดล 3D และตำแหน่ง/ชื่อขาขอบนอก)',
    languages: [{ name: 'Arduino C/C++ (Teensyduino), CircuitPython', level: 'unsupported', note: 'รันโค้ดไม่ได้ — แผงแจ้งชัดเจนว่าเฉพาะโมเดล' }],
    features: NONE('เฉพาะโมเดล 3D — ไม่มีการจำลอง CPU'),
  },
  {
    kind: 'esp32s3lcd', name: 'ESP32-S3-Touch-LCD-1.28',
    engine: 'ไม่มี — เฉพาะโมเดล 3D (จอกลมแสดงภาพนิ่ง ไม่ได้มาจากโค้ด)',
    languages: [{ name: 'Arduino C/C++, MicroPython, CircuitPython', level: 'unsupported', note: 'รันโค้ดไม่ได้' }],
    features: NONE('เฉพาะโมเดล 3D — ไม่มีการจำลอง CPU'),
  },
  {
    kind: 'rpi5', name: 'Raspberry Pi 5',
    engine: 'จำลองระดับไลบรารี — CPython 3.14 ใน WebAssembly (Pyodide) + gpiozero ชุดย่อยที่เขียนใหม่ · ไม่จำลอง BCM2712/RP1/Linux',
    languages: [
      { name: 'Python (gpiozero)', level: 'partial', note: 'คลาส LED, PWMLED, Buzzer, RGBLED, Servo, AngularServo, Button, Digital*Device, MotionSensor, LineSensor · ต้องมี JSPI' },
      { name: 'RPi.GPIO / lgpio / C', level: 'unsupported', note: 'ยังไม่มี' },
    ],
    features: [
      F('gpio', 'supported', 'GPIO0–27 ผ่าน gpiozero (ระดับไลบรารี) · ค่าไฟฟ้าประมาณจาก Pi 4', ['tests/rpi.test.ts', 'tests/e2e/rpi_ui.py']),
      F('adc', 'na', 'Raspberry Pi ไม่มี ADC ในตัว'),
      F('pwm', 'partial', 'PWM ซอฟต์แวร์ของ gpiozero (PWMLED/Servo/blink/pulse) ตามเวลาจำลอง · PWM ฮาร์ดแวร์ไม่จำลอง', ['tests/rpi.test.ts']),
      F('interrupt', 'partial', 'callback when_pressed ฯลฯ ถูกเรียกเมื่อโปรแกรมหลักพัก (ของจริงเรียกจากเธรด)', ['tests/rpi.test.ts']),
      F('timer', 'partial', 'time.sleep/time.time ใช้เวลาจำลอง · ไม่มี threading', ['tests/rpi.test.ts']),
      F('uart', 'unsupported', 'ยังไม่มี'), F('i2c', 'unsupported', 'ยังไม่มี (ตัวดึงขึ้น 1.8 kΩ ที่ GPIO2/3 จำลองแล้ว)'), F('spi', 'unsupported', 'ยังไม่มี'),
      F('watchdog', 'unsupported', 'ไม่จำลอง Linux'),
      F('pull', 'supported', 'pull_up=True/False/None', ['tests/rpi.test.ts']),
      F('serial', 'supported', 'print/traceback ในเทอร์มินัล', ['tests/rpi.test.ts']),
      F('reset', 'partial', 'รัน/หยุด (KeyboardInterrupt) · ไม่จำลองปุ่มเปิดปิดและการบูต', ['tests/rpi.test.ts']),
      F('voltage', 'supported', 'เตือนขาเกิน 3.6 V, กระแสขาเกิน 16 mA, ขาเข้าลอย', ['tests/rpi.test.ts']),
      F('multi', 'partial', 'GPIO ต่อกับบอร์ดอื่นได้ · รัน Python ได้ทีละบอร์ด Pi', []),
      F('storage', 'unsupported', 'ไม่มีระบบไฟล์ Linux'),
    ],
  },
];

/**
 * สถานะการจำลอง 4 ด้านของบอร์ด (แยกให้ชัดตามคำขอ 2026-11-23): ความสมจริงของโมเดล 3D, วงจรไฟฟ้าที่ขา, การรันโปรแกรม และสิ่งที่ยังจำลองไม่ได้
 * ระดับ: full = ครบตามที่ระบุ, partial = บางส่วน, none = ยังไม่มี — เปลี่ยนเป็น full ได้เมื่อมีความสามารถจริงและเทสต์ยืนยันเท่านั้น
 */
export type Status4Level = 'full' | 'partial' | 'none';
export interface BoardStatus4 { fidelity: [Status4Level, string]; electrical: [Status4Level, string]; firmware: [Status4Level, string]; unsupported: string[] }
export const STATUS4_LABELS: Array<[keyof Omit<BoardStatus4, 'unsupported'>, string]> = [['fidelity', '3D Model Fidelity — ความสมจริงของโมเดล'], ['electrical', 'Electrical Simulation — วงจรไฟฟ้าที่ขา'], ['firmware', 'Firmware Simulation — การรันโปรแกรม']];
export const STATUS4: Record<string, BoardStatus4> = {
  unoq: {
    fidelity: ['partial', 'สร้างจากไฟล์ CAD ของผู้ผลิต (STEP + Gerber + IPC-356, CC BY-SA 4.0): รูปร่าง ความหนา รูยึด ลายทองแดง แพด และตำแหน่งชิ้นส่วนทุกชิ้นตรงไฟล์ · ตำแหน่งขาหัวต่อทั้ง 32 ขาตรวจกับแพดจริงอัตโนมัติ (คลาดไม่เกิน 0.01 mm) · รูปทรงชิ้นส่วนเป็นแบบย่อ (ขนาดจริง ไม่มีโลโก้ผู้ผลิต) · LED matrix แสดงดับเสมอ'],
    electrical: ['partial', 'ขา 3.3 V ของ STM32U585: ขาออก ≈ 50 Ω จำกัด 20 mA, pull-up ≈ 40 kΩ, ADC อ้างอิง 3.3 V · ตรวจแรงดันเกิน (A0–A5/D3 3.6 V, ขาอื่น 5 V), กระแสต่อขา/รวม 120 mA, ไฟ 5V จาก USB-C ตามที่ตั้ง · ไม่จำลอง: ตัวต้านทานอนุกรมบนบอร์ดที่ D0/D1/D10–D13/SDA/SCL, วงจรจ่ายไฟภายใน, ขา BOOT/RESET'],
    firmware: ['partial', 'โหมดจำลองพฤติกรรม: สเก็ตช์ Arduino (GPIO, digitalRead/Write, PWM, ADC, Serial, Wire/I²C, Servo, LiquidCrystal_I2C) คอมไพล์จริงแล้วรันบนตัวจำลอง CPU ATmega328P โดยใช้ไฟฟ้าขาของ UNO Q — ไม่ใช่การจำลอง Cortex-M33/Zephyr · เวลาคำสั่ง หน่วยความจำ และความถี่ PWM เป็นของ AVR'],
    unsupported: ['Linux (Debian) บน QRB2210 และแอป Python ของ App Lab', 'Bridge/RPC ระหว่าง MCU กับ Linux', 'Wi-Fi / Bluetooth', 'LED matrix 13 × 8 และ RGB LED บนบอร์ด', 'Wire1 (Qwiic), Wire2 (A4/A5), Serial1 (D0/D1), SPI, CAN, DAC, OPAMP', 'analogReadResolution (ADC 14 บิต)', 'ขา BOOT / RESET, หัวต่อ JCTL / JMISC / JMEDIA, USB-C ฝั่งข้อมูล/จอ'],
  },
  uno: {
    fidelity: ['partial', 'โมเดลสร้างเองตามแบบ Uno Rev3 (ขนาด รูยึด ตำแหน่งหัวต่อตามแบบ — ใส่ shield ได้) · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต (อยู่ในแผนรอบถัดไป)'],
    electrical: ['full', 'ขา 5 V ของ ATmega328P (25 Ω, 40 mA, pull-up 35 kΩ), เตือนกระแสขา/รวม, ไฟ 5V/3.3V'],
    firmware: ['full', 'CPU ATmega328P จริงทีละคำสั่ง (avr8js) จากไฟล์ .hex ที่คอมไพล์ด้วย avr-gcc + ArduinoCore-avr'],
    unsupported: ['ชิป USB-serial (ATmega16U2) และ AREF ภายนอก', 'UART กับบอร์ด/โมดูลอื่น', 'อุปกรณ์ SPI ที่ตอบกลับ'],
  },
  nano: {
    fidelity: ['partial', 'โมเดลสร้างเองตามแบบ Nano 3.x (ขนาด/ตำแหน่งขาตามแบบ) · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['full', 'ขา 5 V แบบเดียวกับ Uno · 3V3 ≤ 50 mA'],
    firmware: ['full', 'CPU ATmega328P จริง (avr8js) จาก .hex ที่คอมไพล์เป็นบอร์ด Nano'],
    unsupported: ['ไดโอดกันย้อน USB, ไฟเข้า VIN', 'ปุ่ม RESET บนบอร์ด (ใช้ปุ่มในแผง)'],
  },
  attiny85: {
    fidelity: ['full', 'ตัวถัง PDIP-8 ขนาดมาตรฐาน (ระยะขา 2.54 mm แถวห่าง 7.62 mm) แบบเดียวกับไอซี DIP-8 อื่นในแอป · พิมพ์เฉพาะรหัสรุ่น ไม่มีโลโก้'],
    electrical: ['partial', 'ไฟเลี้ยงจากวงจรจริง (ทำงาน/หยุดตาม VCC, HIGH = VCC, กระแสขาผ่านแหล่งจ่าย) · ความต้านทานขาออกเป็นค่าประมาณคงที่ 45 Ω (ของจริงสูงขึ้นเมื่อ VCC ต่ำ) · ไม่จำลองกระแสที่ชิปกินเองและ brown-out detector'],
    firmware: ['partial', 'CPU ATtiny85 ทีละคำสั่ง (avr8js + โปรไฟล์ชิป) ที่ 8 MHz · ทดสอบ GPIO, PWM ทั้ง 3 ขา, ADC, INT0, millis, EEPROM, watchdog, SoftwareSerial · ยังไม่ผูก USI (I²C/SPI) และ analog comparator · นาฬิกาแม่นยำ (ของจริงคลาดได้ ±10%)'],
    unsupported: ['USI (I²C/SPI แบบ TinyWire)', 'Serial Monitor (ชิปไม่มี USB/UART — ใช้ SoftwareSerial + เครื่องวิเคราะห์ลอจิก)', 'ขา 1 ในฐานะ I/O หรือ ADC0 (ต้องเปลี่ยน fuse RSTDISBL)', 'fuse และการตั้งนาฬิกา (ถือว่าตั้ง 8 MHz ภายในแล้ว)', 'กระแสที่ชิปกินเอง, โหมด sleep'],
  },
  promini: {
    fidelity: ['partial', 'โมเดลสร้างเอง: ขนาด PCB 33.02 × 17.78 mm และตำแหน่งขาทั้ง 24 ขา + หัว 6 ขา + รู A4–A7 ตาม footprint Arduino_Pro_Mini_Socket (KiCad Library for Arduino, CC BY-SA 4.0) · ชิ้นส่วนบนบอร์ด (ATmega328P, เรโซเนเตอร์, เรกูเลเตอร์, ปุ่ม, LED) วางตามตำแหน่งโดยประมาณ · ตัวแปลง USB-serial เป็นโมเดลทั่วไปไม่อิงรุ่นใด'],
    electrical: ['partial', 'ขาไฟฟ้าตามรุ่น 5 V (เหมือน Uno) หรือ 3.3 V (ค่าจาก datasheet ที่ VCC 3 V) · ไฟ VCC จากตัวแปลง USB-serial · ไม่จำลองการจ่ายไฟเข้า RAW และเรกูเลเตอร์บนบอร์ด'],
    firmware: ['full', 'CPU ATmega328P จริง (avr8js) ที่ 16 หรือ 8 MHz จาก .hex ที่คอมไพล์เป็นบอร์ด Pro Mini ตาม F_CPU · ทดสอบ GPIO, PWM, ADC, millis, Serial, INT0, TWI, EEPROM, watchdog'],
    unsupported: ['การทำงานจากไฟ RAW/แบตเตอรี่โดยไม่มีตัวแปลง USB-serial', 'ปุ่ม RESET/ขา RST/DTR (ใช้ปุ่มในแผง)', 'การกินไฟของชิปและโหมด sleep', 'อุปกรณ์ SPI ที่ตอบกลับ'],
  },
  mega: {
    fidelity: ['partial', 'โมเดลสร้างเอง: ขอบบอร์ด รูยึด 6 รู และตำแหน่งขาหัวต่อทั้ง 85 ขาตามรอยเท้า Mega 2560 R3 (KiCad Library for Arduino) · ชิ้นส่วนอื่น (ATmega2560 TQFP-100, ATmega16U2, คริสตัล, แจ็ก) วางตามตำแหน่งโดยประมาณ ไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['full', 'ขา 5 V แบบเดียวกับ Uno (25 Ω, 40 mA, pull-up 35 kΩ), เตือนกระแสขา/รวม 200 mA, ไฟ 5V/3.3V'],
    firmware: ['full', 'CPU ATmega2560 ทีละคำสั่ง (avr8js + โปรไฟล์ชิป) จาก .hex ที่คอมไพล์เป็นบอร์ด Mega 2560 · ทดสอบ GPIO, PWM 6 timer, ADC 16 ช่อง, INT/PCINT, USART1–3, TWI, SPI, EEPROM 4 KB, watchdog'],
    unsupported: ['การรับข้อมูลทาง Serial1–3 จากอุปกรณ์ในวงจร (ส่งออกได้อย่างเดียว)', 'อุปกรณ์ SPI ที่ตอบกลับ', 'ชิป USB-serial (ATmega16U2), AREF ภายนอก, ไฟเข้า VIN', 'ขีดจำกัดกระแสรวมต่อกลุ่มพอร์ต'],
  },
  picow: {
    fidelity: ['partial', 'ใช้โมเดล Pico (ขนาดบอร์ด ตำแหน่งขา castellated ตามแบบ) + ฝาโลหะโมดูลไร้สายและพื้นที่สายอากาศที่ปลายบอร์ด (ตำแหน่ง/ขนาดโดยประมาณ) · ไม่มีโลโก้'],
    electrical: ['full', 'ขา 3.3 V ของ RP2040 แบบเดียวกับ Pico (80 Ω, 50 mA, pull ≈ 50 kΩ) · เตือนขาเกิน 3.6 V'],
    firmware: ['partial', 'CPU RP2040 จริงทีละคำสั่ง รันเฟิร์มแวร์ MicroPython ที่ build จากการตั้งค่า Pico W แต่ปิดส่วนไร้สาย — ไม่ใช่เฟิร์มแวร์ RPI_PICO_W ที่ใช้กับบอร์ดจริง'],
    unsupported: ['Wi-Fi / Bluetooth (ชิป CYW43439)', 'LED บนบอร์ด (ต่อกับ CYW43 — Pin("LED"))', 'ขา WL_GPIO และการวัด VBUS ผ่าน CYW43', 'C/C++ (Pico SDK/Arduino)', 'BOOTSEL / UF2'],
  },
  esp32devkitc: {
    fidelity: ['partial', 'โมเดลสร้างเอง: ตำแหน่งขา J2/J3 ตามตาราง User Guide ระยะแถว 25.4 mm · ขนาด PCB และตำแหน่งชิ้นส่วน (โมดูล WROOM-32E, USB-UART, LDO, ปุ่ม EN/Boot, LED) โดยประมาณ — ยังไม่ได้เทียบกับไฟล์ขนาดของ Espressif · ไม่มีโลโก้'],
    electrical: ['partial', 'ขาตาม datasheet ESP32 ตาราง 5-3 (VOH, VIH/VIL, RPU/RPD 45 kΩ) · ตัวดึงของขา RTC ไม่มี · 3V3 ≤ 500 mA เป็นค่าประมาณ · ไม่จำลองการกินไฟของ ESP32'],
    firmware: ['partial', 'CPU ESP32 จริงทีละคำสั่งใน QEMU บนเซิร์ฟเวอร์ รัน MicroPython ทางการ · GPIO, ADC, I²C, UART0 ผ่าน callback ของ QEMU · PWM สร้างจากรีจิสเตอร์ LEDC · บูตช้ากว่าบอร์ดจริงหลายเท่า (เวลาจริงหลายวินาที) · ทำงานผ่านเครือข่าย จึงหน่วงตามเครือข่าย'],
    unsupported: ['Wi-Fi / Bluetooth', 'DAC, touch, RMT (NeoPixel), SPI กับอุปกรณ์, UART1/2', 'ตัวดึงขึ้น/ลงของขา RTC IO', 'ADC.read_uv() (ค่าปรับเทียบ eFuse)', 'deep sleep / ULP', 'ปุ่ม EN/Boot', 'Arduino C/C++ และ ESP-IDF', 'ใช้งานในหน้าเว็บไฟล์เดียวโดยไม่มีเซิร์ฟเวอร์'],
  },
  nanoconnect: {
    fidelity: ['partial', 'โมเดลสร้างเอง: PCB 45 × 18 mm และตำแหน่งขา 30 ขาแบบ Nano (ระยะแถว 15.24 mm) · RP2040, แฟลช, โมดูล NINA-W102 (ฝาโลหะ + สายอากาศ), IMU, ไมโครโฟน, ปุ่ม, LED วางตามตำแหน่งโดยประมาณ · ไม่มีโลโก้ · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['partial', 'ขา 3.3 V ของ RP2040 แบบเดียวกับ Pico (80 Ω, 50 mA, pull ≈ 50 kΩ) · เตือนกระแสขาที่ 8 mA ตาม datasheet ของบอร์ด · ตัวดึงขึ้น 4.7 kΩ ที่ A4/A5 · 3.3V ≤ 800 mA · ไม่จำลองไฟเข้า VIN และการกินไฟของ NINA-W102'],
    firmware: ['partial', 'CPU RP2040 จริงทีละคำสั่ง รัน MicroPython v1.24.1 + นิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT ที่ปิด NINA-W102 — ไม่ใช่เฟิร์มแวร์ที่ใช้บนบอร์ดจริงทั้งชุด · REPL ทาง UART0 (TX/RX) แทน USB · IMU LSM6DSOX ระดับรีจิสเตอร์ (ไม่มี FIFO/ฟังก์ชันฝังตัว/MLC)'],
    unsupported: ['Wi-Fi / Bluetooth (โมดูล NINA-W102)', 'LED RGB (ต่อกับ NINA)', 'การอ่านแอนะล็อก A4–A7 (ADC ของ NINA)', 'ไมโครโฟน PDM MP34DT06JTR', 'ชิปเข้ารหัส ATECC608A (0x60)', 'FIFO / ฟังก์ชันฝังตัว / MLC และขา INT ของ LSM6DSOX', 'REPL ทาง USB (ในแอปใช้ TX/RX)', 'C/C++ (Arduino)'],
  },
  xiao: {
    fidelity: ['partial', 'โมเดลสร้างเอง: PCB 21 × 17.8 mm ตาม Seeed wiki, ขา castellated 7 ขาต่อด้าน ระยะ 2.54 mm แถวห่าง 15.24 mm · ฝาโลหะ, USB-C, ปุ่ม B/R, LED RGB, NeoPixel วางตามตำแหน่งโดยประมาณจากรูปบอร์ด · ไม่มีโลโก้ · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['partial', 'ขา 3.3 V ของ RP2040 แบบเดียวกับ Pico (80 Ω, 50 mA, pull ≈ 50 kΩ) · เตือนขาเกิน 3.6 V · ขา 3V3 จำกัด 300 mA เป็นค่าประมาณ (Seeed ไม่ระบุ) · ไม่จำลองแบตเตอรี่ที่แผ่นด้านล่าง'],
    firmware: ['partial', 'CPU RP2040 จริงทีละคำสั่ง รัน MicroPython v1.24.1 + นิยามบอร์ด SEEED_XIAO_RP2040 (ต้นฉบับมีใน v1.28.0 ขึ้นไป) · REPL ทาง UART0 (D6/D7) แทน USB · NeoPixel ถอดรหัสจากสัญญาณขาจริง (โมดูล neopixel) · ไม่รองรับ PIO'],
    unsupported: ['rp2.PIO / StateMachine (ตัวจำลองไม่เดิน PIO ตามเวลา CPU) — รวมถึง NeoPixel ผ่าน PIO', 'REPL ทาง USB (ในแอปใช้ D6/D7)', 'แบตเตอรี่ที่แผ่น BAT ด้านล่าง', 'ปุ่ม B (BOOT) / R (RESET) บนบอร์ด, UF2', 'C/C++ (Pico SDK/Arduino)'],
  },
  pico: {
    fidelity: ['partial', 'โมเดลสร้างเองตามแบบ Pico (ขนาด/ตำแหน่งขา castellated ตามแบบ) · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['full', 'ขา 3.3 V ของ RP2040 (80 Ω, 50 mA, pull ≈ 50 kΩ) · เตือนขาเกิน 3.6 V'],
    firmware: ['full', 'CPU RP2040 จริงทีละคำสั่ง (rp2040js) รันเฟิร์มแวร์ MicroPython v1.24.1'],
    unsupported: ['C/C++ (Pico SDK/Arduino)', 'PIO กับวงจรภายนอก', 'ปุ่ม BOOTSEL / UF2', 'SPI ทิศรับข้อมูล'],
  },
  rpi5: {
    fidelity: ['partial', 'โมเดลสร้างเองตามแบบ Raspberry Pi 5 (ขนาด/หัวต่อ 40 ขา) · ยังไม่ได้สร้างจากไฟล์ CAD ของผู้ผลิต'],
    electrical: ['partial', 'GPIO 3.3 V (ค่าประมาณจาก Pi 4 — ยังไม่พบตัวเลขของชิป RP1) · ตัวดึงขึ้น 1.8 kΩ ที่ GPIO2/3'],
    firmware: ['partial', 'จำลองระดับไลบรารี: CPython 3.14 (Pyodide) + gpiozero ชุดย่อย — ไม่จำลอง CPU BCM2712 หรือ Linux'],
    unsupported: ['Linux, RPi.GPIO / lgpio', 'I²C / SPI / UART', 'กล้อง จอ HDMI USB Ethernet'],
  },
};

export function boardProfile(kind: string): BoardProfile | undefined {
  return BOARD_PROFILES.find((b) => b.kind === kind);
}
