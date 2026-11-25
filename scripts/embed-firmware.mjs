// สร้าง src/mcu/firmware-data.ts จากไฟล์ใน firmware/ (base64) — รันอัตโนมัติก่อน build/test
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
const fw = readFileSync('firmware/micropython-v1.24.1-circuitlab-pico.bin');
// Pico W (บอร์ด CIRCUITLAB_PICO_W ใน firmware/board-picow/: ตั้งค่า Pico W แต่ปิดส่วนไร้สาย)
const fwW = readFileSync('firmware/micropython-v1.24.1-circuitlab-picow.bin');
const shaW = createHash('sha256').update(fwW).digest('hex');
// Seeed Studio XIAO RP2040 (บอร์ด CIRCUITLAB_XIAO_RP2040 ใน firmware/board-xiao/: ยกนิยามบอร์ด SEEED_XIAO_RP2040 จาก MicroPython v1.28.0)
const fwX = readFileSync('firmware/micropython-v1.24.1-circuitlab-xiao.bin');
const shaX = createHash('sha256').update(fwX).digest('hex');
// Arduino Nano RP2040 Connect (บอร์ด CIRCUITLAB_NANO_RP2040_CONNECT ใน firmware/board-nanoconnect/: ไม่มี NINA-W102)
const fwN = readFileSync('firmware/micropython-v1.24.1-circuitlab-nanoconnect.bin');
const shaN = createHash('sha256').update(fwN).digest('hex');
const lfs = readFileSync('firmware/littlefs-blocks.bin');
const bgMap = readFileSync('firmware/littlefs-bg-map.json', 'utf8').trim();
const out = 'src/mcu/firmware-data.ts';
const sha = createHash('sha256').update(fw).digest('hex');
const body = `// สร้างอัตโนมัติโดย scripts/embed-firmware.mjs — อย่าแก้ด้วยมือ
// MicroPython v1.24.1 (MIT) สำหรับ RP2040 บอร์ด CIRCUITLAB_PICO (ดู firmware/README.md) sha256 ${sha}
export const FIRMWARE_SHA256 = '${sha}';
export const FIRMWARE_B64 = '${fw.toString('base64')}';
/** MicroPython v1.24.1 บอร์ด CIRCUITLAB_PICO_W (Pico W ไม่มีไร้สาย) sha256 ${shaW} */
export const FIRMWARE_PICOW_B64 = '${fwW.toString('base64')}';
/** MicroPython v1.24.1 บอร์ด CIRCUITLAB_XIAO_RP2040 (ชื่อขา D0–D10/LED_R/G/B/NEOPIXEL ตามนิยามบอร์ดต้นฉบับ) sha256 ${shaX} */
export const FIRMWARE_XIAO_B64 = '${fwX.toString('base64')}';
/** MicroPython v1.24.1 บอร์ด CIRCUITLAB_NANO_RP2040_CONNECT (นิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT ที่ปิด NINA-W102, มีไดรเวอร์ lsm6dsox) sha256 ${shaN} */
export const FIRMWARE_NANOCONNECT_B64 = '${fwN.toString('base64')}';
/** บล็อกที่ใช้ของ LittleFS (block 4096 B × 352): [เลขบล็อก uint32 LE][4096 B] ต่อกัน — ไลบรารีใน firmware/fs/ + bg.bin (scripts/make-lfs.py) ที่เหลือเป็น 0xFF */
export const LFS_BLOCKS_B64 = '${lfs.toString('base64')}';
/** ตำแหน่งข้อมูลของ bg.bin ในอิมเมจ: [offset ในไฟล์, offset ในอิมเมจ LittleFS, ความยาว] */
export const LFS_BG_MAP: { file: string; size: number; segments: Array<[number, number, number]> } = ${bgMap};
`;
if (!existsSync(out) || readFileSync(out, 'utf8') !== body) writeFileSync(out, body);
// ตัวอย่างพิกเซลของ bg.bin เริ่มต้น (ใช้ในหน้าเว็บ/ตัวตรวจแลป — ไฟล์เล็ก ไม่ต้องโหลดเฟิร์มแวร์ใน main thread)
const sOut = 'src/mcu/bg-default.ts';
const sBody = `// สร้างอัตโนมัติโดย scripts/embed-firmware.mjs จาก firmware/bg-default-samples.json — อย่าแก้ด้วยมือ
/** [ดัชนีพิกเซล y*240+x, ค่า RGB565] ของรูปเริ่มต้นใน bg.bin (ตาราง 20 × 20 จุด) */
export const BG_DEFAULT_SAMPLES: Array<[number, number]> = ${readFileSync('firmware/bg-default-samples.json', 'utf8').trim()};
`;
if (!existsSync(sOut) || readFileSync(sOut, 'utf8') !== sBody) writeFileSync(sOut, sBody);
console.log(`firmware ${fw.length} B sha256 ${sha.slice(0, 12)}…`);
