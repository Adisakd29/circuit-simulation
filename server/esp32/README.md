# บริการจำลอง ESP32 (QEMU) — server/esp32

ESP32-DevKitC V4 ในแอปจำลองด้วย QEMU **บนเซิร์ฟเวอร์** (ทำในเบราว์เซอร์ไม่ได้: QEMU เป็นโปรแกรม C และใบอนุญาต GPL-2.0)

## ส่วนประกอบและใบอนุญาต

| ส่วน | ที่มา | ใบอนุญาต | หมายเหตุ |
|---|---|---|---|
| QEMU สาขา `picsimlab-esp32` | github.com/lcgamboa/qemu commit `fac9a4689ba3e0aff149e2788dfdcba7ef6c7d3d` | GPL-2.0 | build เป็น `libqemu-xtensa.so` ด้วย `build-qemu.sh` (ไม่ได้แก้ซอร์ส) |
| `bridge.c` → `esp32-bridge` | ไฟล์ในโฟลเดอร์นี้ | **GPL-2.0-or-later** | โปรแกรมแยกที่โหลด libqemu แล้วคุยกับแอปผ่าน FIFO — ไม่ได้ลิงก์กับโค้ดของแอป |
| ROM ของ ESP32 (`esp32-v3-rom.bin`, `esp32-v3-rom-app.bin` ใน pc-bios ของ QEMU fork) | Espressif (แจกมากับ QEMU fork) | **ใน fork ไม่มีข้อความใบอนุญาตของไฟล์นี้** · Espressif เผยแพร่ไฟล์ ELF ของ ROM ชุดเดียวกันที่ github.com/espressif/esp-rom-elfs ภายใต้ Apache-2.0 (ตัวโค้ด ROM ไม่ใช่โอเพนซอร์ส) | **ความเสี่ยงที่ยังเหลือ:** ยังไม่ได้ตรวจว่า .bin ใน fork ตรงกับ ELF ที่ประกาศ Apache-2.0 — ผู้ deploy ควรยืนยันกับ Espressif ก่อนเปิดให้บริการสาธารณะ |
| MicroPython v1.24.1 `ESP32_GENERIC-20241129-v1.24.1.bin` | micropython.org (ไม่ได้ดัดแปลง) | MIT | sha256 `21d61b5241b2e00f9a774a797079fc287b66beb071dfaf4b6b340bf84d15f048` · วางที่ 0x1000 ในอิมเมจแฟลช 4 MB (`make-flash.mjs`) |

ผู้ที่ได้รับ image ของเซิร์ฟเวอร์มีสิทธิ์ขอซอร์สของ QEMU (commit ข้างบน) และ `bridge.c` ตาม GPL — ซอร์สทั้งสองอยู่ในที่เปิดเผยแล้ว

## การทำงาน

```
เบราว์เซอร์ ──POST /api/sim/esp32 {sid, req}──▶ server.mjs ──▶ worker_thread (server/engine/esp32-worker.mjs = SimEngine ชุดเดียวกับหน้าเว็บ)
                                                                   │  ต่อบอร์ด ESP32 หนึ่งตัว: Esp32Emulator ──FIFO──▶ esp32-bridge (โปรเซสแยก) ──▶ libqemu-xtensa
```

- เวลา: QEMU ใช้ `-icount shift=2,sleep=off` (4 ns ต่อคำสั่ง — เวลาเสมือนกำหนดได้แน่นอน) · bridge ตั้ง timer บนนาฬิกาเสมือนให้หยุดตรงเวลาที่แอปขอ หรือหยุดเมื่อขาออกเปลี่ยน
- โปรโตคอล (บรรทัดข้อความ) อธิบายไว้ต้น `bridge.c`
- PWM: QEMU เก็บรีจิสเตอร์ LEDC แต่ไม่สลับขา → `src/mcu/esp32-emu.ts` สร้างรูปคลื่นจากรีจิสเตอร์ (duty, ความถี่ของ timer, สัญญาณที่ GPIO matrix ส่งออก)
- I²C: QEMU ส่งธุรกรรมผ่าน callback → แอปตอบจากแบบจำลองอุปกรณ์ชุดเดียวกับบอร์ดอื่น (I2cHub)

## ตัวแปรสภาพแวดล้อม

| ชื่อ | ความหมาย |
|---|---|
| `ESP32_BRIDGE` | ไฟล์ `esp32-bridge` |
| `ESP32_QEMU_LIB` | `libqemu-xtensa.so` |
| `ESP32_QEMU_BIOS` | โฟลเดอร์ที่มี `esp32-v3-rom.bin`, `esp32-v3-rom-app.bin` |
| `ESP32_FLASH` | อิมเมจแฟลช 4 MB ที่มี MicroPython (แต่ละเซสชันได้สำเนาของตัวเอง) |
| `ESP32_MAX_SESSIONS` | จำนวนเซสชันพร้อมกัน (ค่าเริ่ม 2 — แต่ละบอร์ดใช้ ≈ 1 คอร์ + RAM ≈ 170 MB ขณะรัน) |
| `ESP32_IDLE_S` | ปิดเซสชันที่ไม่มีคำขอเกินกี่วินาที (ค่าเริ่ม 120) |

ถ้าไม่ได้ตั้ง `GET /api/health` จะรายงาน `esp32.available = false` และ `/api/sim/esp32` ตอบ 503 พร้อมข้อความ

## build ด้วยมือ (Linux)

```sh
sudo apt-get install git gcc ninja-build python3-venv pkg-config libglib2.0-dev libpixman-1-dev libgcrypt20-dev libslirp-dev flex bison
sh server/esp32/build-qemu.sh /tmp/qemu-work /opt/esp32
curl -fsSLO https://micropython.org/resources/firmware/ESP32_GENERIC-20241129-v1.24.1.bin
node server/esp32/make-flash.mjs ESP32_GENERIC-20241129-v1.24.1.bin /opt/esp32/flash-mp.bin
npm run build:engine     # → server/engine/esp32-worker.mjs
ESP32_BRIDGE=/opt/esp32/esp32-bridge ESP32_QEMU_LIB=/opt/esp32/libqemu-xtensa.so ESP32_QEMU_BIOS=/opt/esp32/pc-bios ESP32_FLASH=/opt/esp32/flash-mp.bin node server/server.mjs
```

ชุดทดสอบ `tests/esp32.test.ts` ใช้ตัวแปรชุดเดียวกัน (ไม่ได้ตั้ง = ข้ามข้อที่ต้องใช้ QEMU)
