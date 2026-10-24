// สร้าง src/mcu/firmware-data.ts จากไฟล์ใน firmware/ (base64) — รันอัตโนมัติก่อน build/test
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
const fw = readFileSync('firmware/micropython-v1.24.1-circuitlab-pico.bin');
const lfs = readFileSync('firmware/littlefs-empty-head.bin');
const out = 'src/mcu/firmware-data.ts';
const sha = createHash('sha256').update(fw).digest('hex');
const body = `// สร้างอัตโนมัติโดย scripts/embed-firmware.mjs — อย่าแก้ด้วยมือ
// MicroPython v1.24.1 (MIT) สำหรับ RP2040 บอร์ด CIRCUITLAB_PICO (ดู firmware/README.md) sha256 ${sha}
export const FIRMWARE_SHA256 = '${sha}';
export const FIRMWARE_B64 = '${fw.toString('base64')}';
/** สองบล็อกแรกของ LittleFS ว่าง (block 4096 B × 352) — ที่เหลือของพื้นที่เป็น 0xFF */
export const LFS_HEAD_B64 = '${lfs.toString('base64')}';
`;
if (!existsSync(out) || readFileSync(out, 'utf8') !== body) writeFileSync(out, body);
console.log(`firmware ${fw.length} B sha256 ${sha.slice(0, 12)}…`);
