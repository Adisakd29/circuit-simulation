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

`littlefs-empty-head.bin` = สองบล็อกแรกของระบบไฟล์ LittleFS ว่าง (block 4096 B × 352 บล็อก ที่ offset 0xA0000 ของแฟลช)
สร้างด้วย `littlefs-python` — ตัวจำลองยังไม่รองรับการเขียนแฟลชผ่าน SSI เฟิร์มแวร์จึงต้องพบระบบไฟล์ที่ฟอร์แมตแล้ว

`npm run build` / `npm test` เรียก `scripts/embed-firmware.mjs` เพื่อฝังไฟล์ทั้งสองเป็น base64 ใน `src/mcu/firmware-data.ts`

## สัญญาอนุญาตของส่วนประกอบ

| ส่วน | ที่มา | สัญญาอนุญาต |
|---|---|---|
| MicroPython | github.com/micropython/micropython v1.24.1 | MIT |
| Raspberry Pi Pico SDK (ลิงก์ในเฟิร์มแวร์) | github.com/raspberrypi/pico-sdk | BSD-3-Clause |
| LittleFS (ในเฟิร์มแวร์) | github.com/littlefs-project/littlefs | BSD-3-Clause |
| RP2040 bootrom B1 (`src/mcu/bootrom.ts`) | github.com/raspberrypi/pico-bootrom | BSD-3-Clause |
| ตัวจำลอง CPU/อุปกรณ์ต่อพ่วง | npm `rp2040js` 1.4.1 (Wokwi) | MIT |

การปรับในแอป: `src/mcu/pico-emu.ts` แทนที่ฟังก์ชันตรวจ interrupt ของ UART ใน rp2040js ไม่ให้ตั้ง TX interrupt ซ้ำทุกครั้ง
(ฮาร์ดแวร์ PL011 จริงตั้งเมื่อระดับ FIFO ข้ามเกณฑ์) — มิฉะนั้นเฟิร์มแวร์ที่เปิดทุก mask จะติดอยู่ใน interrupt handler
