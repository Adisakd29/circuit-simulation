# เฟิร์มแวร์ MicroPython สำหรับ Raspberry Pi Pico ในตัวจำลอง

ไฟล์ `micropython-v1.24.1-circuitlab-pico.bin` คือ MicroPython **v1.24.1** (MIT License) ที่ build จากซอร์สต้นฉบับ
สำหรับพอร์ต `rp2` โดยใช้บอร์ด `CIRCUITLAB_PICO` (โฟลเดอร์ `board/`) ซึ่งเหมือน `RPI_PICO` ทุกอย่าง ยกเว้น:

- `MICROPY_HW_ENABLE_UART_REPL = 1` — REPL ทาง UART0 (GP0 = TX, GP1 = RX) ให้ตัวจำลองต่อกับ console ของแอป
- `MICROPY_HW_ENABLE_USBDEV = 0` — ปิด USB (ตัวจำลองไม่มีโฮสต์ USB)
- ชื่อบอร์ดใน banner: `Raspberry Pi Pico (Circuit Lab 3D emulator)`

sha256: `5dbc1bd98fe4849acf87afd9e4a61a5b91c527cd9e5e2af6f2c00565b7713030`
(ค่าที่ build ได้อาจต่างเล็กน้อยตามวันที่ build เพราะ banner มีวันที่)

## วิธี build ซ้ำ

```bash
sudo apt-get install gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib cmake
git clone --depth 1 --branch v1.24.1 https://github.com/micropython/micropython.git
cd micropython && make -C mpy-cross
cp -r <โปรเจกต์นี้>/firmware/board ports/rp2/boards/CIRCUITLAB_PICO
cd ports/rp2 && make BOARD=CIRCUITLAB_PICO submodules && make BOARD=CIRCUITLAB_PICO
cp build-CIRCUITLAB_PICO/firmware.bin <โปรเจกต์นี้>/firmware/micropython-v1.24.1-circuitlab-pico.bin
```

### Pico W (ไม่จำลองไร้สาย)

`micropython-v1.24.1-circuitlab-picow.bin` = MicroPython v1.24.1 บอร์ด `CIRCUITLAB_PICO_W` (โฟลเดอร์ `board-picow/`) — ตั้งค่าเหมือน `CIRCUITLAB_PICO` (REPL ทาง UART0, ปิด USB, ระบบไฟล์ 1408 KB เพื่อใช้อิมเมจ LittleFS เดียวกัน)
แต่ `PICO_BOARD pico_w`, ชื่อบอร์ด "Raspberry Pi Pico W (Circuit Lab 3D emulator, no wireless)" และ pins.csv ไม่มี GP23/24/25/29 และชื่อ `LED` (บน Pico W ต่อกับชิป CYW43 ซึ่งตัวจำลองไม่มี)
— ไม่เปิด `MICROPY_PY_NETWORK_CYW43`/`CYW43_*` จึงไม่มีโมดูล network/bluetooth · ไม่ใช่เฟิร์มแวร์ `RPI_PICO_W` ที่ใช้บนบอร์ดจริง
sha256: `46be3fe8e6d797ce4146217eaf2a2ea8d0c45323e19cdbb47d50eed012de802d` (build 2026-11-24 ด้วย gcc-arm-none-eabi 13.2.rel1 ของ Ubuntu 24.04)

```bash
cp -r <โปรเจกต์นี้>/firmware/board-picow ports/rp2/boards/CIRCUITLAB_PICO_W
cd ports/rp2 && make BOARD=CIRCUITLAB_PICO_W submodules && make BOARD=CIRCUITLAB_PICO_W
cp build-CIRCUITLAB_PICO_W/firmware.bin <โปรเจกต์นี้>/firmware/micropython-v1.24.1-circuitlab-picow.bin
```

### Seeed Studio XIAO RP2040

`micropython-v1.24.1-circuitlab-xiao.bin` = MicroPython v1.24.1 บอร์ด `CIRCUITLAB_XIAO_RP2040` (โฟลเดอร์ `board-xiao/`) — MicroPython v1.24.1 ยังไม่มีบอร์ดนี้
จึงยก `pins.csv`, `board.json` และค่าใน `mpconfigboard.h`/`mpconfigboard.cmake` จาก `ports/rp2/boards/SEEED_XIAO_RP2040` ของ MicroPython **v1.28.0** (MIT) มาใช้
(`PICO_BOARD seeed_xiao_rp2040` ของ pico-sdk 2.0.0 ที่มากับ v1.24.1 · ชื่อขา D0–D10, A0–A3, LED_R/G/B, LED, NEOPIXEL, NEOPIXEL_POWER ตามต้นฉบับ)
แล้วปรับสำหรับตัวจำลองแบบเดียวกับ `CIRCUITLAB_PICO`: REPL ทาง UART0 (GPIO0/1 = D6/D7), ปิด USB, ชื่อบอร์ด "Seeed Studio XIAO RP2040 (Circuit Lab 3D emulator)"
· ระบบไฟล์ 1408 KB เท่าต้นฉบับ จึงใช้อิมเมจ LittleFS เดียวกับ Pico
· ข้อสังเกต: ต้นฉบับตั้ง `MICROPY_HW_I2C0_SCL/SDA` = GPIO7/6 แต่ในฮาร์ดแวร์ RP2040 GPIO6/7 เป็นขาของ I2C1 — แลปและเทสต์ใช้ `I2C(1, sda=Pin("D4"), scl=Pin("D5"))` ตามตัวอย่างของ Seeed
sha256: `2b9fd1a628f456ac909f9d1b470442e935854c64c6f478b9b17f6e784365e5fa` (319,308 ไบต์, build 2026-11-24 ด้วย gcc-arm-none-eabi 13.2.rel1 ของ Ubuntu 24.04)

```bash
cp -r <โปรเจกต์นี้>/firmware/board-xiao ports/rp2/boards/CIRCUITLAB_XIAO_RP2040
cd ports/rp2 && make BOARD=CIRCUITLAB_XIAO_RP2040 submodules && make BOARD=CIRCUITLAB_XIAO_RP2040
cp build-CIRCUITLAB_XIAO_RP2040/firmware.bin <โปรเจกต์นี้>/firmware/micropython-v1.24.1-circuitlab-xiao.bin
```

### Arduino Nano RP2040 Connect (ไม่จำลอง NINA-W102)

`micropython-v1.24.1-circuitlab-nanoconnect.bin` = MicroPython v1.24.1 บอร์ด `CIRCUITLAB_NANO_RP2040_CONNECT` (โฟลเดอร์ `board-nanoconnect/`)
ดัดแปลงจาก `ports/rp2/boards/ARDUINO_NANO_RP2040_CONNECT` ของ v1.24.1 (MIT): `PICO_BOARD arduino_nano_rp2040_connect`, ค่า UART1/SPI1/I2C1 เดิม
· **ไม่เปิด** network/Bluetooth/NINA-W10 และขาภายนอกผ่าน NINA (`MICROPY_HW_PIN_EXT_COUNT`/`ADC_EXT_COUNT` — แถว `EXT_GPIO` ใน pins.csv ถูกตัด: LEDR/LEDG/LEDB, D18–D21, A4–A7 แบบ EXT)
· manifest คงไดรเวอร์ `lsm6dsox`, `time`, `logging` (ตัด bundle-networking, espflash, senml, aioble) · ไม่ตั้ง `MICROPY_PY_HASHLIB_MD5` และ `MICROPY_USE_INTERNAL_ERRNO` แบบต้นฉบับ
· REPL ทาง UART0 (GPIO0/1 = TX/RX), ปิด USB/USB MSC · ระบบไฟล์ LittleFS 1408 KB ที่ `MICROPY_HW_FLASH_STORAGE_BASE 0xA0000` เพื่อใช้อิมเมจเดียวกับ Pico (บอร์ดจริง: 14 MB ที่ท้ายแฟลช 16 MB)
sha256: `5d0f48b10ec02b6cfde0a0408c46cac3194741d3abd8bdd7d55e0e49e3286ab0` (326,120 ไบต์, build 2026-11-24 ด้วย gcc-arm-none-eabi 13.2.rel1 ของ Ubuntu 24.04)

```bash
cp -r <โปรเจกต์นี้>/firmware/board-nanoconnect ports/rp2/boards/CIRCUITLAB_NANO_RP2040_CONNECT
cd ports/rp2 && make BOARD=CIRCUITLAB_NANO_RP2040_CONNECT submodules && make BOARD=CIRCUITLAB_NANO_RP2040_CONNECT
cp build-CIRCUITLAB_NANO_RP2040_CONNECT/firmware.bin <โปรเจกต์นี้>/firmware/micropython-v1.24.1-circuitlab-nanoconnect.bin
```

`littlefs-blocks.bin` = อิมเมจระบบไฟล์ LittleFS ของ Pico (block 4096 B × 352 บล็อก, prog 256 B, ชื่อไฟล์ ≤ 32 อักษร ที่ offset 0xA0000 ของแฟลช)
เก็บเฉพาะบล็อกที่ใช้: `[เลขบล็อก uint32 LE][ข้อมูล 4096 B]` ต่อกัน ตัวจำลองเติมส่วนที่เหลือเป็น 0xFF · สร้างด้วย `scripts/make-lfs.py` (`littlefs-python` 0.19.0)
จากไฟล์ในโฟลเดอร์ `fs/` — ตัวจำลองยังไม่รองรับการเขียนแฟลชผ่าน SSI เฟิร์มแวร์จึงต้องพบระบบไฟล์ที่ฟอร์แมตแล้วและมีไลบรารีอยู่ก่อน
(เหมือนนักเรียนคัดลอกไฟล์ลงบอร์ดจริงด้วย Thonny/mpremote) · ตรวจแล้วว่าอิมเมจว่างที่ได้ตรงกับ `littlefs-empty-head.bin` รุ่นก่อนทุกไบต์

ไฟล์ใน `fs/`: `ssd1306.py` — ไดรเวอร์จอ OLED จาก micropython-lib (`micropython/drivers/display/ssd1306`, MIT) ไม่แก้ไข ·
`gc9a01py.py`, `vga1_bold_16x32.py`, `vga1_8x16.py` — ไดรเวอร์จอกลม GC9A01 และฟอนต์จาก github.com/russhughes/gc9a01py (MIT, commit bdc0667) ไม่แก้ไข
· `lcd_api.py`, `machine_i2c_lcd.py` — ไดรเวอร์จอ LCD HD44780 ผ่าน PCF8574 จาก github.com/dhylands/python_lcd (MIT) ไม่แก้ไข
· `tm1637.py` — ไดรเวอร์จอ 7 ส่วน TM1637 จาก github.com/mcauser/micropython-tm1637 (MIT, v1.3.0 commit cc9ecc6) ไม่แก้ไข
— ใส่ในอิมเมจเป็น `.mpy` ที่คอมไพล์ด้วย mpy-cross v1.24.1 (import เร็วขึ้น: ไดรเวอร์ 37 KB คอมไพล์บนบอร์ดใช้ ≈ 0.5 s)

`bg.bin` (240×240 RGB565 ไบต์สูงก่อน 115,200 ไบต์) สร้างโดย `make-lfs.py` (รูปท้องฟ้าไล่สีที่วาดด้วยโค้ด) · ผู้ใช้เปลี่ยนรูปได้ในแอป:
แอปเขียนข้อมูลรูปใหม่ทับบล็อกข้อมูลเดิมของไฟล์ตาม `littlefs-bg-map.json` (ข้อมูลไฟล์ใน LittleFS ไม่มี CRC มีเฉพาะ metadata)
— สคริปต์หาตำแหน่งโดยสร้างอิมเมจซ้ำด้วยข้อมูลรูปแบบเฉพาะ และตรวจว่าแทนที่แล้วได้อิมเมจเดียวกันทุกไบต์ · `bg-default-samples.json` = จุดตัวอย่าง 400 จุดของรูปเริ่มต้นสำหรับตัวตรวจแลป

`npm run build` / `npm test` เรียก `scripts/embed-firmware.mjs` เพื่อฝังไฟล์ทั้งสองเป็น base64 ใน `src/mcu/firmware-data.ts`

### ESP32-DevKitC V4 (QEMU บนเซิร์ฟเวอร์)

ไม่ได้ build เอง — ใช้ไฟล์ทางการ `ESP32_GENERIC-20241129-v1.24.1.bin` จาก micropython.org (MIT, sha256 `21d61b5241b2e00f9a774a797079fc287b66beb071dfaf4b6b340bf84d15f048`) วางที่ 0x1000 ในอิมเมจแฟลช 4 MB ด้วย `server/esp32/make-flash.mjs` · ไม่ฝังในหน้าเว็บ (CPU ESP32 รันใน QEMU บนเซิร์ฟเวอร์) · วิธี build QEMU และใบอนุญาตอยู่ใน `server/esp32/README.md`

## สัญญาอนุญาตของส่วนประกอบ

| ส่วน | ที่มา | สัญญาอนุญาต |
|---|---|---|
| MicroPython | github.com/micropython/micropython v1.24.1 (+ นิยามบอร์ด SEEED_XIAO_RP2040 จาก v1.28.0) | MIT |
| lsm6dsox.py (frozen ในเฟิร์มแวร์ Nano RP2040 Connect) | micropython-lib `micropython/drivers/imu/lsm6dsox` | MIT |
| Raspberry Pi Pico SDK (ลิงก์ในเฟิร์มแวร์) | github.com/raspberrypi/pico-sdk | BSD-3-Clause |
| LittleFS (ในเฟิร์มแวร์) | github.com/littlefs-project/littlefs | BSD-3-Clause |
| RP2040 bootrom B1 (`src/mcu/bootrom.ts`) | github.com/raspberrypi/pico-bootrom | BSD-3-Clause |
| ssd1306.py (`fs/`) | github.com/micropython/micropython-lib | MIT |
| gc9a01py.py + ฟอนต์ vga1_* (`fs/`) | github.com/russhughes/gc9a01py | MIT |
| lcd_api.py, machine_i2c_lcd.py (`fs/`) | github.com/dhylands/python_lcd (commit 7affb0b) | MIT |
| tm1637.py (`fs/`) | github.com/mcauser/micropython-tm1637 v1.3.0 (commit cc9ecc6) | MIT |
| ตัวจำลอง CPU/อุปกรณ์ต่อพ่วง | npm `rp2040js` 1.4.1 (Wokwi) | MIT |

การปรับในแอป: `src/mcu/pico-emu.ts` แทนที่ฟังก์ชันตรวจ interrupt ของ UART ใน rp2040js ไม่ให้ตั้ง TX interrupt ซ้ำทุกครั้ง
(ฮาร์ดแวร์ PL011 จริงตั้งเมื่อระดับ FIFO ข้ามเกณฑ์) — มิฉะนั้นเฟิร์มแวร์ที่เปิดทุก mask จะติดอยู่ใน interrupt handler

การปรับ I²C: เมื่อ transaction ถูก abort (เช่น อุปกรณ์ไม่ตอบ NACK) rp2040js 1.4.1 ไม่ตั้งบิต TX_EMPTY (bit 4 ของ IC_RAW_INTR_STAT)
แต่ `i2c_write_blocking` ของ pico-sdk 2.0.0 รอบิตนี้ก่อนตรวจ abort → MicroPython ได้ ETIMEDOUT แทน EIO และ abort ค้างทำให้ transaction ถัดไปพัง
`src/mcu/pico-emu.ts` จึงตั้ง TX_EMPTY หลัง abort (ฮาร์ดแวร์จริงล้าง TX FIFO เมื่อ abort FIFO จึงว่าง) — มีชุดทดสอบใน `tests/watch.test.ts` ที่ไม่ผ่านถ้าเอาการแก้ออก

การปรับ SPI: rp2040js ส่งไบต์เสร็จทันทีที่เข้า FIFO (ค่าเริ่มของ `onTransmit`) — เมื่อ MicroPython ส่ง ≥ 32 ไบต์ด้วย DMA ช่อง TX เติม FIFO
เร็วกว่าช่อง RX อ่าน FIFO รับล้น และ `spi.write()` ค้างไม่สิ้นสุด · `src/mcu/cosim.ts` จึงให้ไบต์ส่งเสร็จหลังเวลา 8 บิตตามความถี่ SPI ที่ตั้ง
(เหมือนฮาร์ดแวร์ที่ส่งทีละบิต) — มีชุดทดสอบใน `tests/round.test.ts`
