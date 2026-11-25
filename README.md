# Circuit Lab 3D — ห้องปฏิบัติการวงจรเสมือน

เว็บแอปให้นักเรียน ปวช./ปวส. ต่อวงจรบนเบรดบอร์ด 3 มิติ (ครึ่งแผ่น 400 จุด หรือเต็มแผ่น 830 จุด — เลือกบอร์ดแล้วเปลี่ยนรุ่นในแผงคุณสมบัติ · เพิ่มได้หลายแผ่นแล้วต่อถึงกันด้วยสาย · มุมกล้องสำเร็จรูปด้านหน้า/ด้านข้าง/ไอโซเมตริก/ด้านบน และปุ่มแสดงชื่อขาทั้งหมด) จำลองวงจร DC และวงจร RC/RL/RLC ตามเวลา ใช้ไดโอด LED และ LED RGB (แคโทด/แอโนดร่วม ผสมสีด้วย PWM) โมดูลบัส I²C — จอ OLED 0.96" SSD1306, นาฬิกา RTC DS3231 (ZS-042 พร้อม EEPROM AT24C32), เซนเซอร์ความเร่ง/ไจโร MPU6050 (GY-521 นับก้าว) — จอกลมสี 1.28" GC9A01 (SPI) พร้อมทัชสกรีน CST816S (แตะ/ปัดบนจอในฉากได้) เซนเซอร์ 6 แกน QMI8658 จอ LCD 16×2 แบบ I²C (HD44780 + PCF8574) และแบบขนาน 16 ขา (ไลบรารี LiquidCrystal ของ Arduino) เซนเซอร์ความกดอากาศ BMP280 เซนเซอร์แสง BH1750 โมดูลวัดกระแส/กำลัง INA219 จอ 7 ส่วน 4 หลัก TM1637 ปุ่มกดเมมเบรน 4×4 rotary encoder KY-040 จอยสติ๊ก KY-023 เซนเซอร์ความเคลื่อนไหว PIR HC-SR501 เซนเซอร์อินฟราเรด FC-51 DHT11 เซนเซอร์สำหรับโครงงานชุด 1 (2026-11-25: โมดูลเปลวไฟ เสียง น้ำฝน แก๊ส MQ-2 ตรวจเส้น TCRT5000 สั่นสะเทือน SW-420 ที่สร้างจากวงจร LM393 จริงในโมดูล, ปุ่มสัมผัส TTP223, Hall A3144 + แม่เหล็ก, สวิตช์รีด, สวิตช์เอียง SW-520D, เซนเซอร์ระดับน้ำ, FSR 402 — ตั้งสภาพแวดล้อมในแผงคุณสมบัติ ทดสอบกับโค้ดบน Pico และ Uno แล้ว · พฤติกรรมเป็นแบบจำลองเพื่อการสอน) มอเตอร์สั่นแบบเหรียญ ซีเนอร์ ทรานซิสเตอร์ BJT ดาร์ลิงตัน TIP120 มอสเฟต (MOSFET) ออปแอมป์ คอมพาราเตอร์ LM393 ไอซีไทเมอร์ 555 ไอซีคงแรงดัน 78xx และ LM317 (ปรับแรงดันได้) ไอซีขยายเสียง LM386 กับลำโพง 8 Ω (มีเสียงออกลำโพงคอมพิวเตอร์) อุปกรณ์สมาร์ตฟาร์ม (เซนเซอร์ความชื้นในดินแบบ capacitive ปักในกระถางต้นไม้ และปั๊มน้ำจุ่มในถังน้ำพร้อมสายยาง — ความชื้นดินเปลี่ยนตามน้ำที่ปั๊มส่ง และเซนเซอร์อุณหภูมิ/ความชื้นอากาศ DHT22 ที่สื่อสารบัสสายเดียวจริงกับโมดูล dht ของ MicroPython) ไอซีเกตตรรกะ 74HC ไอซีนับ CD4017 เซนเซอร์อุณหภูมิ LM35 เทอร์มิสเตอร์ NTC โมดูลวัดระยะอัลตราโซนิก HC-SR04 ไอซีเลื่อนบิต 74HC595 ออปโตคัปเปลอร์ PC817 ไทริสเตอร์ SCR 2N5060 ไอซีขับมอเตอร์ L293D สเต็ปเปอร์มอเตอร์ 28BYJ-48 กับบอร์ดขับ ULN2003 หม้อแปลงลดแรงดัน โมดูลรีเลย์ เซอร์โวมอเตอร์ และมอเตอร์ DC ใช้เครื่องวิเคราะห์ลอจิก 8 ช่อง (วัด PWM และถอดรหัส UART/I²C/SPI — ขอบของขาไมโครคอนโทรลเลอร์มาจากตัวจำลอง CPU โดยตรง) เครื่องวัดกำลังไฟฟ้า (กำลังของแหล่งจ่ายและอุปกรณ์ทุกตัว เฉลี่ยตามเวลา และพลังงานสะสม) และเครื่องมือบนโต๊ะขนาดจริง — แหล่งจ่าย DC เครื่องกำเนิดสัญญาณ ออสซิลโลสโคป มัลติมิเตอร์ดิจิทัลและมัลติมิเตอร์แบบเข็ม (สายโพรบแดง/ดำ สวิตช์เลือกย่าน ฟิวส์ และผลการโหลดของมิเตอร์) — และกราฟโบด (AC sweep) เขียนโปรแกรม MicroPython บน Raspberry Pi Pico, Pico W (Pico W: เฟิร์มแวร์ของรุ่นเองที่ปิดส่วนไร้สาย — ไม่จำลอง Wi-Fi/Bluetooth และ LED บนบอร์ด) Seeed Studio XIAO RP2040 (ชื่อขา D0–D10, LED RGB และ NeoPixel บนบอร์ดทำงานจากสัญญาณขาจริง — ไม่รองรับ PIO) Arduino Nano RP2040 Connect (IMU LSM6DSOX บนบอร์ดจำลองระดับรีจิสเตอร์ — ไม่จำลองโมดูล NINA-W102: Wi-Fi/Bluetooth, LED RGB และแอนะล็อก A4–A7 ใช้ไม่ได้) และ ESP32-DevKitC V4 (**CPU ESP32 จำลองด้วย QEMU บนเซิร์ฟเวอร์** รัน MicroPython ทางการ — ต้องมีบริการ `/api/sim/esp32` ดู [server/esp32/README.md](server/esp32/README.md) · ไม่จำลอง Wi-Fi/Bluetooth, DAC, touch, SPI กับอุปกรณ์ · ไม่รองรับ C/C++) ที่จำลอง CPU จริง (ตรวจโค้ดด้วยคอมไพเลอร์บนบอร์ด ข้อผิดพลาดชี้บรรทัด Serial Monitor — ตัวแก้ไขโค้ดของทุกบอร์ดมีไฮไลต์ไวยากรณ์และเติมคำเฉพาะ API ที่บอร์ดนั้นจำลองได้) และเขียน C++ บน Arduino Uno R3, Arduino Mega 2560 (ชิป ATmega2560: 70 ขา, PWM 15 ขา, Serial1–3 ส่งออกขา TX, EEPROM 4 KB) ไอซี ATtiny85 แบบ DIP-8 (เสียบเบรดบอร์ดแล้วต่อไฟเลี้ยงเอง — ชิปทำงานเมื่อ VCC ≥ 2.7 V, PWM 3 ขา, ADC อ้างอิง VCC จริง, ไม่มี UART), Arduino Pro Mini 328 (รุ่น 5 V/16 MHz และ 3.3 V/8 MHz — ชิปเดินที่ความถี่ของรุ่นจริง ถือว่าต่อตัวแปลง USB-serial ไว้ที่หัว 6 ขา) และ Arduino Nano (Nano เสียบคร่อมร่องกลางเบรดบอร์ด มี A6/A7 · คอมไพล์ด้วย avr-gcc บนบริการคอมไพล์ของเซิร์ฟเวอร์ แล้วรันไฟล์ .hex บน CPU ATmega328P ที่จำลองทีละคำสั่ง — ใช้ Wire.h กับอุปกรณ์ I²C ที่ขา A4/A5 ได้) และเขียน Python ด้วย gpiozero บน Raspberry Pi 5 (**จำลองระดับไลบรารี** — CPython รันใน WebAssembly แล้วสั่งขา GPIO ของวงจร ไม่ได้จำลอง CPU/Linux ของ Pi) วัดค่า ดูกราฟ และทำแลป 58 แลป (รวมโปรเจกต์นาฬิกาอัจฉริยะบน Pico ทั้งแบบจอ OLED และแบบจอกลมสีที่ใส่รูปพื้นหลังของตัวเองได้ — มีโมเดล 3D ของบอร์ด ESP32-S2-DevKitM-1, บอร์ดนาฬิกาจอกลม ESP32-S3, STM32F103C8T6 "Blue Pill", Raspberry Pi Pico 2 (RP2350) และ Teensy 4.1 แต่ **เฉพาะโมเดล ไม่มีการจำลอง CPU** (ขาไม่มีไฟ แผงแจ้งชัด) — ผลประเมินตัวจำลอง ESP32 อยู่ใน [docs/ESP32-EVAL.md](docs/ESP32-EVAL.md))ที่ตรวจผลจากวงจรที่ต่อจริง (ทุกแลปมีรูปวงจร) · อุปกรณ์ทุกชนิดแสดงระดับการรองรับ 6 ด้านและข้อจำกัดก่อนทดลอง — ปุ่ม **Export** ส่งออกเอกสารโครงงานสำหรับประกอบวงจรจริง (BOM, แหล่งจ่าย, ตารางต่อขา, ตำแหน่งขา → รู, รายการสาย, ภาพ, รายการเน็ต, โค้ด + ขั้นตอนติดตั้งไลบรารี/อัปโหลด, Hardware Validation Checklist, ข้อจำกัดที่การจำลองยังไม่ได้ตรวจ — พิมพ์เป็น PDF ได้) และ CSV · แผนขยายไปบอร์ดและอุปกรณ์อื่นอยู่ใน [docs/MCU-ROADMAP.md](docs/MCU-ROADMAP.md) · ผล Audit เทียบกับ Master Prompt และตารางความสามารถรายบอร์ด (Supported / Partial / Unsupported) อยู่ใน [docs/AUDIT.md](docs/AUDIT.md) และในแผงคุณสมบัติของบอร์ด

## วิธีรัน

ต้องมี Node.js 20+ (ทดสอบกับ Node 22)

```bash
npm install
npm run dev            # โหมดพัฒนา http://localhost:5173
npm test               # เทสต์อัตโนมัติ (solver, connectivity, editor, บันทึกไฟล์, แลป, fuzz) — เทสต์ที่รัน Python ของ Raspberry Pi ต้องใช้ Node ≥ 24 (JSPI) จะถูกข้ามบน Node 22
npm run build          # build ปกติ → dist/
npm run build:single   # HTML ไฟล์เดียว → dist-single/index.html (worker ฝังในไฟล์)
npm run build:artifact # ไฟล์เดียวสำหรับเผยแพร่เป็น claude.ai Artifact → artifact/index.html
npm start              # เซิร์ฟเวอร์ใช้งานจริง: เสิร์ฟ dist/ + บริการคอมไพล์ Arduino POST /api/compile (พอร์ตจาก PORT, ค่าเริ่มต้น 8080)
```

### บริการคอมไพล์ Arduino (`server/`)

โค้ด C++ ของ Arduino Uno ต้องคอมไพล์เป็นภาษาเครื่องก่อน เบราว์เซอร์ทำเองไม่ได้ จึงมีเซิร์ฟเวอร์ Node (ไม่มี dependency) ที่เสิร์ฟหน้าเว็บและคอมไพล์ในบริการเดียวกัน

- `POST /api/compile` รับ `{ "board": "uno", "source": "<sketch.ino>" }` แล้วคืน `{ ok, hex, size: { flash, ram, maxFlash, maxRam }, diagnostics: [{ file, line, col, severity, message }] }` · `GET /api/health` บอกรุ่นเครื่องมือ
- เครื่องมือ: avr-gcc 7.3.0 (แพ็กเกจ `gcc-avr avr-libc binutils-avr` ของ Ubuntu 24.04), ArduinoCore-avr 1.8.6 (LGPL-2.1) และไลบรารี Servo 1.2.2, LiquidCrystal 1.0.7 (LGPL-2.1) · แฟล็กคอมไพล์ตาม `platform.txt` ของ Arduino (-Os, LTO, `-mmcu=atmega328p -DF_CPU=16000000L -DARDUINO_AVR_UNO`) · สร้าง prototype ของฟังก์ชันให้เหมือน Arduino IDE และใส่ `#line` ให้ข้อผิดพลาดชี้บรรทัดของ sketch.ino
- ความปลอดภัย: เซิร์ฟเวอร์ไม่รันโค้ดของผู้ใช้ (คอมไพล์อย่างเดียว) · รับเฉพาะ `#include <ชื่อ.h>` ที่เขียนตรง (ห้าม path สัมบูรณ์, `..`, มาโคร, `.incbin`) · โค้ด ≤ 64 KB · หมดเวลา 25 วินาที · คอมไพล์พร้อมกัน 2 งาน คิว 16 · ไม่เก็บโค้ด · CORS เปิด (หน้า Artifact เรียกข้ามโดเมนได้)
- รันในเครื่อง (Linux): `sudo apt install gcc-avr avr-libc binutils-avr` แล้ว clone `arduino/ArduinoCore-avr` แท็ก 1.8.6, `arduino-libraries/Servo` แท็ก 1.2.2 และ `arduino-libraries/LiquidCrystal` แท็ก 1.0.7 ไว้ที่ `/opt/arduino/` (หรือกำหนด `ARDUINO_CORE_DIR`, `ARDUINO_SERVO_DIR`, `ARDUINO_LCD_DIR`) → `npm run build && npm start` · โหมดพัฒนา: `npm run serve:api` คู่กับ `npm run dev` (vite proxy `/api` → พอร์ต 8080)
- **Docker / Railway:** `Dockerfile` ที่ราก repo สร้างทุกอย่างในอิมเมจเดียว (สเตจ 1 node:22 build หน้าเว็บ, สเตจ 2 ubuntu:24.04 + avr-gcc + core + `node server/compile.mjs --prebuild`) — Railway ตรวจพบ Dockerfile เองและตั้ง `PORT` ให้ · หน้าเว็บแบบไฟล์เดียว (Artifact) คอมไพล์เองไม่ได้: ใส่ที่อยู่บริการในแผงคุณสมบัติของ Uno → "บริการคอมไพล์ (avr-gcc)"

### Arduino UNO Q (โหมดจำลองพฤติกรรม) และโปรเจกต์จบ

- **ไม่ใช่การจำลองชิปจริง**: ยังไม่มีตัวจำลอง STM32U585 (Cortex-M33 + Zephyr) และ QRB2210 (Linux) — สเก็ตช์คอมไพล์ด้วยบอร์ด `"unoq"` ของบริการคอมไพล์ (avr-gcc + ArduinoCore-avr, มาโคร `CIRCUITLAB_UNOQ_BEHAVIORAL`) แล้วรันบน avr8js โดยใช้ไฟฟ้าขาของ UNO Q: ลอจิก 3.3 V, ≤ 20 mA ต่อขา รวม ≤ 120 mA, ADC อ้างอิง 3.3 V, Wire ที่หัวต่อ SDA/SCL (ไม่ใช่ A4/A5), Serial → Serial Monitor (ไม่ออก D0/D1)
- ตรวจแรงดันเกินตามขา (A0–A5 และ D3 ทน 3.6 V, ขาอื่นทน 5 V เฉพาะขาเข้า) · คำสั่งที่ไม่ได้จำลอง (Bridge, LED matrix, Wire1/Wire2, Serial1, analogReadResolution, Zephyr) ถูกปฏิเสธตอนคอมไพล์พร้อมข้อความภาษาไทย
- ไลบรารี `LiquidCrystal_I2C` ในบริการคอมไพล์ (`server/libraries/LiquidCrystal_I2C/`) เขียนใหม่ใบอนุญาต MIT ให้ API ตรงกับไลบรารียอดนิยม (ตัวต้นฉบับไม่มีใบอนุญาต จึงไม่นำมาใช้)
- อุปกรณ์โครงงาน: ปุ่มอาร์เคด 24 mm (COM/NO/NC), ปุ่ม 16 mm, อะแดปเตอร์ 5 V 3 A + แจ็ก DC 5.5 × 2.1 mm, บอร์ดกระจายไฟเซอร์โว 4 ช่อง · เซอร์โวมีกระแสมอเตอร์ขณะเริ่มหมุน/หมุน (ค่าประมาณ)
- **โมเดล 3D ของ UNO Q สร้างจากไฟล์ CAD ของผู้ผลิต** (STEP + Gerber + IPC-356, CC BY-SA 4.0 — `src/assets/models/README.md`, สร้างใหม่ด้วย `scripts/models/build-unoq.sh`) · ตำแหน่งขาตรวจกับแพดจริงในเทสต์ · แผงคุณสมบัติแสดงสถานะการจำลอง 4 ด้าน · ปุ่มโฟกัส (G) และตรวจดูรอบด้าน/ด้านล่าง (I)
- **เมนูโปรเจกต์จบ** (แท็บแลป → โปรเจกต์จบ): แม่แบบที่พร้อม 3 แบบ — 1 "เครื่องจ่ายยาอัตโนมัติ 4 ช่อง", 2 "ระบบรดน้ำต้นไม้อัตโนมัติ" (เซนเซอร์ความชื้นดิน + รีเลย์ + ปั๊ม: รดน้ำเองจนถึง 60%, ตรวจน้ำหมดด้วยเวลาเปิดปั๊ม) และ 5 "ระบบควบคุมมอเตอร์" (L293D + มอเตอร์ TT + สเต็ปเปอร์ 28BYJ-48 + VR) — พร้อมรูปวงจร BOM ตารางจุดต่อ โค้ด และผลทดสอบ (โปรแกรมคอมไพล์ไว้แล้ว เปิดแล้ว Run ได้ทันที) · แม่แบบ 3, 4, 6 แสดงเป็น "วางแผน" พร้อมเหตุผล — แผนและ Audit: [docs/FINAL-PROJECT-PLAN.md](docs/FINAL-PROJECT-PLAN.md)

### Raspberry Pi 5 (Python · gpiozero)

- **จำลองระดับไลบรารี ไม่ใช่ CPU/Linux**: main.py รันด้วย CPython 3.14 ใน WebAssembly ([Pyodide](https://github.com/pyodide/pyodide) 314.0.7, MPL-2.0) ภายใน Web Worker ของการจำลอง แล้วสั่งขาผ่านโมดูล `gpiozero` ชุดย่อยที่เขียนขึ้นใหม่ให้ API ตรงกับ gpiozero 2.0 (`src/mcu/pi/gpiozero.py` — ไม่ใช่โค้ดของไลบรารีจริง) · คลาสที่มี: LED, PWMLED, Buzzer, RGBLED, Servo, AngularServo, Button, DigitalInputDevice, DigitalOutputDevice, PWMOutputDevice, InputDevice, MotionSensor, LineSensor (คลาสอื่น import ไม่ได้ — ไม่ทำงานผิด ๆ แบบเงียบ)
- ขา GPIO0–27 ของหัวต่อ 40 ขาเป็นแหล่งแรงดัน/ตัวต้านทานในวงจรเหมือนบอร์ดอื่น (3.3 V, ตัวดึง ≈ 50 kΩ, GPIO2/3 ดึงขึ้น 1.8 kΩ บนบอร์ด) · `time.sleep()` ใช้เวลาจำลอง · callback (`when_pressed` ฯลฯ) ถูกเรียกเมื่อโปรแกรมหลักพัก · ลูปที่ไม่พักถูกพักให้ทุก ~2 ms
- เบราว์เซอร์ต้องรองรับ JSPI (Chrome/Edge 137+, Firefox 153+, Safari 27+ ตาม caniuse) เพื่อพัก Python ระหว่าง `sleep()` · ครั้งแรกโหลด Python ราว 12 MB: เว็บที่ deploy (`npm run build` → `dist/pyodide/`) เสิร์ฟเอง · หน้าเว็บไฟล์เดียว (Artifact) โหลดจาก cdn.jsdelivr.net
- ไม่มี: RPi.GPIO, lgpio, I²C/SPI/UART, threading, ไฟล์ระบบ Linux

ทดสอบผ่านเบราว์เซอร์จริง (เมาส์ + touch):

```bash
npm run build && npx vite preview --port 4173 &
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e/e2e.py e2e-out
python3 tests/e2e/freeplace.py free-out   # ลากวาง/วางบนโต๊ะ 7 ขนาดจอ + โหมดล้มเหลว (ไม่มี WebGL, context หาย ฯลฯ)
python3 tests/e2e/mosfet_ui.py mos-out     # มอสเฟตผ่าน UI: แลป 13, เปลี่ยนรุ่น, ปลดสวิตช์, วางจากคลังอุปกรณ์
python3 tests/e2e/opamp_ui.py op-out       # slew rate/แบนด์วิดท์ของออปแอมป์ผ่าน UI: สโคปวัดความชัน, แก้ค่า SR, กราฟโบด, แลป 14
python3 tests/e2e/pot_ui.py pot-out       # VR (ทริมพอต 3296W) ผ่าน UI: ปรับตำแหน่ง, โพรบ, แลป 15
python3 tests/e2e/button_ui.py btn-out     # ปุ่มกด 6×6 mm ผ่าน UI: กดค้างในฉาก/แผง (เมาส์และ touch), ไม่ลง Undo, วางจากคลัง
python3 tests/e2e/buzzer_ui.py bz-out       # บัซเซอร์ active/passive: เสียงในแอป (Web Audio), วงคลื่น, เครื่องกำเนิดสัญญาณ
python3 tests/e2e/ldr_ui.py ldr-out      # LDR: ปรับระดับแสง, ไฟอัตโนมัติ, แลป 17
python3 tests/e2e/sevenseg_ui.py ss-out      # 7 ส่วน: แสดงเลข, ส่วนสว่างในฉาก, ชนิดขาร่วม, แลป 18
python3 tests/e2e/pintip_ui.py tip-out       # ชื่อขาเมื่อชี้ (เมาส์) / แตะ (สัมผัส)
python3 tests/e2e/relay_ui.py relay-out      # โมดูลรีเลย์ + Pico: ดึง/ปล่อย, โหลดผ่าน COM–NO, 3V3 ไม่พอ, แลป 19
python3 tests/e2e/timer555_ui.py t555-out    # NE555 astable: LED กะพริบ, ความถี่เทียบทฤษฎี, แก้ C, แลป 20
python3 tests/e2e/vreg_ui.py vreg-out       # 7805: คงแรงดัน, line regulation, dropout, แผ่นระบายความร้อน, แลป 21
python3 tests/e2e/psu_ui.py psu-out         # หม้อแปลง + บริดจ์ + C + 7805, สโคป AC วัด ripple, แลป 22
python3 tests/e2e/servo_ui.py servo-out     # เซอร์โว SG90 + Pico PWM: มุม 0/90/180°, แขนในฉากหมุนตาม, แลป 23
python3 tests/e2e/motor_ui.py motor-out     # มอเตอร์ DC + IRLZ44N + Pico PWM: ความเร็วตาม duty, ไดโอดกันย้อน, แลป 24
python3 tests/e2e/logic_ui.py logic-out     # 74HC08/74HC32: ตารางความจริงจากสวิตช์ + LED, ขาเข้าลอย, แลป 25
python3 tests/e2e/dock_ui.py dock-out       # แท็บเล็ตจอสัมผัส: ย่อ/ซ่อนแผงเวลาจำลองระหว่างจำลอง, จังหวะไฟกะพริบ 555 สม่ำเสมอ
python3 tests/e2e/counter_ui.py cnt-out      # ไฟวิ่ง 555 + CD4017: นับ 0–9, LED ทีละดวง, RESET → Q4, แลป 26
python3 tests/e2e/lm35_ui.py lm35-out      # LM35 + Pico ADC: ค่าที่พิมพ์ตามอุณหภูมิ, LED เตือน, 3V3 ไม่พอ, แลป 27
python3 tests/e2e/hbridge_ui.py hb-out        # L293D + Pico: เดินหน้า/ถอยหลัง/PWM, VCC1 จาก 3V3 ไม่ทำงาน, แลป 28
python3 tests/e2e/sonar_ui.py sonar-out      # HC-SR04 + Pico: ระยะที่พิมพ์ตามค่าตั้ง, ไม่มีวัตถุ, Echo ต่อตรง = อันตราย, แลป 29
python3 tests/e2e/shiftreg_ui.py sr-out      # 74HC595 + Pico: ไฟวิ่ง 8 ดวง, ค่า 170 ในฉาก, OE สูง = ดับ, แลป 30
python3 tests/e2e/opto_ui.py opto-out        # PC817 + Pico: สวิตช์วงจร 12 V แยกกราวด์, ย่านขยาย/CTR, กราวด์ร่วม = ไม่แยก, แลป 31
python3 tests/e2e/stepper_ui.py step-out     # 28BYJ-48 + ULN2003 + Pico: 90° แล้วกลับ 45°, LED A–D, แกนหมุนในฉาก, 3V3 ไม่พอ, แลป 32
python3 tests/e2e/schematic_ui.py sch-out      # แท็บ "แลป" + รูปวงจรครบ 53 แลป, แตะเพื่อขยาย, ไม่มีคำว่า "บททดลอง" เหลือ
python3 tests/e2e/meters_ui.py meters-out    # มัลติมิเตอร์ดิจิทัล + แบบเข็ม: ต่อสายโพรบ, ผลการโหลด 20 kΩ/V, เข็มตีเกินสเกล, ฟิวส์ขาด, แลป 33
python3 tests/e2e/scr_ui.py scr-out          # SCR 2N5060: กดเกตติด, ปล่อยแล้วติดค้าง, ลัด A–K ดับ, โหลดเบา (IA < IH) ดับเอง, แลป 34
python3 tests/e2e/lm317_ui.py lm317-out      # LM317: แรงดันตามสูตร, เลื่อนพอตได้ 5 V / 9 V, dropout, R1 ใหญ่เกินไม่มีโหลด → ขาออกสูงเกิน, แลป 35
python3 tests/e2e/ntc_ui.py ntc-out          # NTC 10 kΩ B3950: วางโพรบ, ชิปอุณหภูมิ 0/60/100 °C ตามสูตรค่า B, ความร้อนในตัว, แลป 36
python3 tests/e2e/comparator_ui.py cmp-out    # LM393 เทอร์โมสตัท: ร้อน → LED ติด, ตั้งจุดตัดด้วยพอต, hysteresis, ป้อนกลับลบ → แจ้งสั่น, แลป 37
python3 tests/e2e/darlington_ui.py tip-out    # TIP120 ขับมอเตอร์: IB 0.45 mA → 0.16 A อิ่มตัว, RB 100 kΩ ไม่นำ, แผ่นระบายความร้อน, แลป 38
python3 tests/e2e/board_ui.py board-out      # เบรดบอร์ด MB-102 830 จุด: เปลี่ยนรุ่นจากแผง, มิเตอร์ถูกย้ายไม่ทับ, วาง a50, เปลี่ยนกลับไม่ได้เมื่อมีอุปกรณ์นอกคอลัมน์ 30, Undo
python3 tests/e2e/lm386_ui.py lm386-out      # LM386 ขับลำโพง: อัตราขยาย 20 → ใส่ C ขา 1–8 → 200, ลำโพงดัง 1 kHz, เพิ่มสัญญาณจนตัดยอด + เตือนกำลังเกิน, แลป 39
python3 tests/e2e/smartfarm_ui.py farm-out   # สมาร์ตฟาร์ม: Pico + รีเลย์ เปิดปั๊ม ≈ 90 L/h เมื่อดินแห้ง หยุดเองเมื่อ > 60%, สายน้ำ/สีดิน, รดซ้ำ, ย้ายสายยาง, แลป 40
python3 tests/e2e/dht22_ui.py dht-out        # DHT22: Pico อ่าน 30 °C 65 %RH ด้วยโมดูล dht, ร้อนชื้น → LED เตือน, ถอดตัวต้านทานดึงขึ้น → ETIMEDOUT, Undo, แลป 41
python3 tests/e2e/adcpwm_ui.py adc-out       # ชุดแรก Pico ครบกระบวนการ: วาง LED → ต่อสาย → Compile ชี้บรรทัด → รัน → VR/ADC/PWM → แก้โค้ด → Save/Load, แลป 42
python3 tests/e2e/uno_ui.py uno-out          # Arduino Uno (ต้องรัน npm start หรือ serve:api คู่กับ preview): คอมไพล์ผิด → ชี้บรรทัด → อัปโหลด → LED กะพริบ + Serial → RESET → แก้ในแท็บ Ctrl+Enter → Save/Load ไม่คอมไพล์ซ้ำ, แลป 43
python3 tests/e2e/rgb_ui.py rgb-out          # LED RGB + Uno (ต้องมีบริการคอมไพล์): วางจากคลัง → อัปโหลด → เลนส์เรืองสีตามกระแส แดง/เขียว/น้ำเงิน/เหลือง/ม่วงแดง/หรี่ → แอโนดร่วมต่อผิด → Undo, แลป 44
python3 tests/e2e/oled_ui.py oled-out        # OLED SSD1306 + Pico I²C: scan พบ 0x3C, ข้อความบนจอในฉาก (อ่านจากหน่วยความจำจอที่จำลอง), สลับ SDA/SCL → NACK, invert, แลป 45
python3 tests/e2e/watch_ui.py watch-out      # นาฬิกาอัจฉริยะ: OLED + DS3231 + MPU6050 + ปุ่ม + มอเตอร์สั่น, เวลาตรง RTC, นับก้าว, สลับหน้า, ที่อยู่ซ้ำ 0x68, ESP32-S2 เฉพาะโมเดล, แลป 46
python3 tests/e2e/roundwatch_ui.py rw-out    # นาฬิกาจอกลม: โค้ดตัวอย่างจากหน้าแลป, จอ GC9A01 ในฉาก (รูป bg.bin + เวลา), ลากบนจอ = ปัด, นับก้าว, เปลี่ยนรูปพื้นหลัง, ESP32-S3 เฉพาะโมเดล, แลป 47
python3 tests/e2e/weather_ui.py wx-out       # สถานีตรวจอากาศ: LCD 16×2 I²C + BMP280 + BH1750, ถอดตัวดึงขึ้น 5 V, ตัวอักษรบนจอในฉาก, ทริมพอต/ไฟพื้นหลัง, แลป 48
python3 tests/e2e/sensor_ui.py sn-out        # ปุ่มดึงลง/ดึงขึ้น + ขาลอย แลป 52 · PIR (เวลาหน่วง) + FC-51 + DHT11 ระบบกันขโมย แลป 53
python3 tests/e2e/sensors1_ui.py s1-out      # เซนเซอร์ชุด 1: วางจากคลัง 12 ชนิด · Pico + 11 เซนเซอร์ เปลี่ยนสภาพแวดล้อมในแผงแล้วค่าในคอนโซลเปลี่ยนตาม
python3 tests/e2e/input_ui.py in-out         # ปุ่ม 4×4 (แตะในฉาก/แผง/แป้นพิมพ์) กุญแจรหัสผ่าน แลป 50 + rotary encoder/จอยสติ๊ก ตัวนับ แลป 51
python3 tests/e2e/export_ui.py export-out  # ปุ่ม Export: เอกสารโครงงาน HTML (BOM, ตารางต่อขา, สาย, ภาพ, โค้ด, รายการตรวจก่อนจ่ายไฟ, ข้อจำกัด), BOM CSV, โค้ด .ino
python3 tests/e2e/audit_ui.py audit-out    # ตารางความสามารถของบอร์ด + Uno EEPROM ข้าม RESET, watchdog รีเซ็ต, ISR คอมไพล์ผ่าน (ต้องมีบริการคอมไพล์)
python3 tests/e2e/mega_ui.py mega-out      # Arduino Mega 2560: วางบนโต๊ะ, 85 ขา, คอมไพล์เป็นบอร์ด mega, LED D13, เครื่องวิเคราะห์ถอด Serial1 (ต้องมีบริการคอมไพล์)
python3 tests/e2e/promini_ui.py promini-out   # Arduino Pro Mini: เสียบเบรดบอร์ด, ต่อสายเข้าเข็ม A4, รุ่น 3.3 V/8 MHz (PWM 245 Hz) → 5 V/16 MHz (490 Hz) (ต้องมีบริการคอมไพล์)
python3 tests/e2e/attiny85_ui.py tiny-out     # ATtiny85: เสียบที่ f10, ไฟจากแหล่งจ่าย 5 V, LED กะพริบ, PWM 488 Hz, ปิด/เปิดแหล่งจ่าย, Serial → ข้อความไม่มี UART (ต้องมีบริการคอมไพล์)
python3 tests/e2e/picow_ui.py picow-out     # Pico W (ไม่มีไร้สาย): วางจากคลัง, banner เฟิร์มแวร์ Pico W, LED ภายนอก GP16, Pin("LED") → ข้อความอธิบาย
python3 tests/e2e/xiao_ui.py xiao-out       # XIAO RP2040: วางจากคลัง, banner เฟิร์มแวร์ XIAO, LED ภายนอก D0, NeoPixel/LED RGB บนบอร์ดตามโค้ด
python3 tests/e2e/nanoconnect_ui.py nc-out   # Nano RP2040 Connect: วางจากคลัง, banner เฟิร์มแวร์, LED ภายนอก D2 + LED บนบอร์ด, IMU วางนิ่ง/เขย่า
python3 tests/e2e/modelonly_ui.py mo-out     # บอร์ดเฉพาะโมเดล Blue Pill / Teensy 4.1 / Pico 2: วางจากคลัง, ป้าย + กล่องเตือน, LED ที่ต่อขาไม่ติด + คำแจ้ง
python3 tests/e2e/esp32_ui.py esp-out        # ESP32-DevKitC ผ่าน QEMU บนเซิร์ฟเวอร์ (ต้องตั้งตัวแปร ESP32_* ก่อนเริ่ม API): banner, LED IO2, ADC IO34
python3 tests/e2e/nano_ui.py nano-out      # Arduino Nano: วางจากคลังคร่อมร่องกลาง, ชื่อขา, แลป 55 คอมไพล์เป็นบอร์ด Nano → A7 ตาม VR, LED หรี่ (ต้องมีบริการคอมไพล์)
python3 tests/e2e/workspace_ui.py ws-out    # มุมกล้องด้านหน้า/ข้าง/ไอโซเมตริก/บน, ชื่อขาทั้งหมด, เพิ่มเบรดบอร์ด + สายข้ามบอร์ด + ลบ/Undo
python3 tests/e2e/powermon_ui.py pw-out      # เครื่องวัดกำลังไฟฟ้า: วงจร DC 25 mW, RC พลังงาน = CV²(1 − e^(−t/τ)), แลป 57 ขา 5V ของ Uno (ต้องมีบริการคอมไพล์)
python3 tests/e2e/lcdpar_ui.py lcdp-out     # จอ LCD 16×2 แบบขนาน: วางจากคลัง (16 ขา), แลป 57 LiquidCrystal "Hello, World!", ความคมชัดตาม V0, ตรวจผล 6 ข้อ (ต้องมีบริการคอมไพล์)
python3 tests/e2e/analyzer_ui.py la-out      # เครื่องวิเคราะห์ลอจิก: วางจากคลัง, แลป 56 PWM 490 Hz / duty 25%, ถอดรหัส UART "HELLO", ทริกเกอร์ต้นข้อความ, Stop, แลป 58 ถอดรหัส I²C ของ BH1750 (0x23) SCL 100 kHz (ต้องมีบริการคอมไพล์)
python3 tests/e2e/editor_ui.py editor-out  # ตัวแก้ไขโค้ด: ไฮไลต์ตรงกับข้อความ, เติมคำ (ลูกศร+Enter / แตะ), Ctrl+Space, Pi 5 เสนอเฉพาะคลาสที่มี (ต้องมีบริการคอมไพล์)
python3 tests/e2e/rpi_ui.py rpi-out        # Raspberry Pi 5: โหลด Python → แลป 54 ปุ่ม (callback) → LED, PWMLED หรี่, หยุด → KeyboardInterrupt, โค้ดผิดชี้บรรทัด
python3 tests/e2e/power_ui.py pw-out         # เครื่องวัดกำลังไฟฟ้า: INA219 + TM1637 บน Pico, ตัวเลขบนจอ = กระแสจริง, เปลี่ยน R → ค่าใหม่, จอ 7 ส่วนในฉาก, แลป 49
python3 tests/visual/bench_shots.py bench-out  # ภาพเครื่องมือขนาดจริงบนโต๊ะ (ไฟล์ schema 29 → จัดเครื่องมือลงช่องใหม่)
```

## Stack

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | TypeScript (strict) | ตรวจชนิดข้อมูลวงจร/ไฟล์ได้ตั้งแต่ตอนคอมไพล์ |
| Build | Vite 8 | dev server เร็ว, รองรับ Web Worker แบบ inline, สร้างไฟล์เดียวได้ |
| 3D | three.js 0.186 | ใช้แพร่หลาย เบา รองรับ WebGL บนแท็บเล็ตทั่วไป |
| UI | DOM + CSS ล้วน | แผงไม่ซับซ้อน ไม่ต้องพึ่ง framework ลดขนาด bundle |
| Solver | เขียนเอง (Nodal + Newton, transient แบบ trapezoidal/BE, AC สัญญาณเล็ก, ไดโอด/BJT/op-amp) ใน Web Worker | คุมพฤติกรรมจำกัดกระแส ข้อผิดพลาด และเวลาจำลองได้เอง |
| ไมโครคอนโทรลเลอร์ | rp2040js 1.4.1 + MicroPython v1.24.1 (build จากซอร์ส, ดู firmware/README.md) · avr8js 0.21.1 (MIT) สำหรับ ATmega328P (16/8 MHz), ATmega2560 และ ATtiny85 | ประมวลผลคำสั่ง ARM/AVR จริงในเบราว์เซอร์ |
| บริการคอมไพล์ | Node `http` (ไม่มี dependency) + avr-gcc 7.3 + ArduinoCore-avr 1.8.6 ใน Docker | คอมไพล์ C++ แบบเดียวกับ Arduino IDE ได้ข้อผิดพลาดของคอมไพเลอร์จริง |
| ทดสอบ | Vitest + Playwright (Python) | unit/fuzz เร็ว, e2e ใช้ pointer event จริง |

## โครงสร้างโค้ด

```
src/
  model/         ข้อมูลวงจรและรูปแบบไฟล์ (types, เบรดบอร์ด CL-400 / MB-102, คลังอุปกรณ์, ตรวจการวาง, schema, bench = ช่องวางเครื่องมือขนาดจริง)
  editor/        คำสั่งแก้ไขแบบ pure function + Undo/Redo (snapshot)
  connectivity/  คำนวณเน็ตจาก ขา + สาย + การเชื่อมภายในบอร์ด (union-find)
  sim/           netlist, solver (DC), transient, ac (AC sweep), engine, Web Worker, ตัวควบคุมเวลา
  instruments/   โพรบสองจุด แอมมิเตอร์ มัลติมิเตอร์ดิจิทัล/แบบเข็ม (meters.ts) กราฟบันทึกค่า ออสซิลโลสโคป กราฟโบด ความสว่าง LED การแจ้งเกินพิกัด
  mcu/           ตัวจำลอง Pico (rp2040js + bootrom), Uno (avr8js), Raspberry Pi 5 (pi-emu + Python/Pyodide + gpiozero ชุดย่อยใน pi/), การจำลองร่วม CPU ↔ วงจร, เฟิร์มแวร์ที่ฝัง
  lessons/       lessons.ts = โจทย์ (เนื้อหา), checks.ts = ตัวตรวจ (เฉลย)
  projects/      แม่แบบโปรเจกต์จบ (วงจรสร้างด้วยคำสั่ง editor + โค้ด + BOM + โปรแกรมที่คอมไพล์ไว้)
  storage/       Export/Import JSON + บันทึกอัตโนมัติ
  render/        three.js: โมเดลอุปกรณ์, เครื่องมือขนาดจริง (bench.ts), ฉาก, สายโพรบ, picking (คืนค่าเชิงตรรกะ ไม่ตัดสินการเชื่อมต่อ)
  ui/            แผงต่าง ๆ, เครื่องมือ, การโต้ตอบเมาส์/touch, code-editor.ts = ไฮไลต์ + เติมคำในช่องโค้ด
tests/           unit + fuzz (Vitest), e2e/ (Playwright), visual/ (ภาพตรวจรับโมเดล 3 มิติ + วัดเวลาวาด)
firmware/        เฟิร์มแวร์ MicroPython ที่ใช้ วิธี build ซ้ำ และสัญญาอนุญาต
docs/visual/     ภาพเปรียบเทียบก่อน/หลังปรับโมเดล และผลวัดประสิทธิภาพ
docs/REPORT.md   รายงานระยะที่ 1, ระยะที่ 2 (ส่วนที่ 1–4), ระยะที่ 3 (Pico) และแผนระยะถัดไป
```

รายละเอียดแบบจำลอง ผลทดสอบ ข้อจำกัด และแผนระยะถัดไปอยู่ใน [docs/REPORT.md](docs/REPORT.md)
