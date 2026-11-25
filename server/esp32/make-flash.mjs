// สร้างอิมเมจแฟลช 4 MB สำหรับ QEMU จากเฟิร์มแวร์ MicroPython ESP32_GENERIC (.bin ที่เริ่มด้วย bootloader สำหรับเขียนที่ 0x1000)
// ใช้: node server/esp32/make-flash.mjs <firmware.bin> <flash-out.bin> — ตำแหน่ง 0x1000 ตามคำสั่ง esptool ในหน้าดาวน์โหลดของ micropython.org
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
const fw = readFileSync(src);
if (fw[0] !== 0xe9) throw new Error('ไม่ใช่ไฟล์เฟิร์มแวร์ ESP32 (ไบต์แรกต้องเป็น 0xE9)');
if (fw[2] !== 2) throw new Error('โหมดแฟลชต้องเป็น DIO (ไบต์ที่ 2 = 2) — QEMU บูตโหมด QIO ไม่ได้');
const img = Buffer.alloc(4 * 1024 * 1024, 0xff);
fw.copy(img, 0x1000);
writeFileSync(out, img);
console.log(`flash ${out}: ${fw.length} B ที่ 0x1000`);
