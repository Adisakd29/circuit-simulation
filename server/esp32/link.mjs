/**
 * เปิด esp32-bridge เป็นโปรเซสแยกแล้วคุยผ่าน FIFO แบบ synchronous (ใช้บน Node เท่านั้น — เซิร์ฟเวอร์และชุดทดสอบ)
 * การอ่าน/เขียน FIFO ด้วย fs.readSync/writeSync บล็อกจน bridge ตอบ: ตัวจำลองวงจรเดินเวลาพร้อมกับ CPU ของ ESP32 ได้ทีละช่วง (lockstep)
 * ตัวแปรสภาพแวดล้อม: ESP32_BRIDGE (โปรแกรม), ESP32_QEMU_LIB (libqemu-xtensa.so), ESP32_QEMU_BIOS (โฟลเดอร์ pc-bios ที่มี ROM),
 *                    ESP32_FLASH (อิมเมจแฟลช 4 MB ที่มี MicroPython) · ESP32_ICOUNT (ค่าเริ่ม shift=2 = 4 ns ต่อคำสั่ง)
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** @returns {{bridge:string, lib:string, bios:string, flash:string, icount?:string} | null} */
export function esp32PathsFromEnv(env = process.env) {
  const p = { bridge: env.ESP32_BRIDGE ?? '', lib: env.ESP32_QEMU_LIB ?? '', bios: env.ESP32_QEMU_BIOS ?? '', flash: env.ESP32_FLASH ?? '', icount: env.ESP32_ICOUNT };
  return p.bridge && p.lib && p.bios && p.flash && [p.bridge, p.lib, p.bios, p.flash].every((f) => existsSync(f)) ? p : null;
}

export function openEsp32Link(p) {
  const dir = mkdtempSync(path.join(tmpdir(), 'esp32-'));
  const ci = path.join(dir, 'ci'), co = path.join(dir, 'co');
  execFileSync('mkfifo', [ci, co]);
  // แฟลชของแต่ละบอร์ดเป็นสำเนา (MicroPython เขียนระบบไฟล์ลงแฟลช) — QEMU เปิดไฟล์แบบอ่านเขียน
  const flash = path.join(dir, 'flash.bin');
  execFileSync('cp', [p.flash, flash]);
  const child = spawn(p.bridge, [p.lib, ci, co, '-M', 'esp32-picsimlab', '-nographic', '-L', p.bios, '-drive', `file=${flash},if=mtd,format=raw`,
    '-serial', 'null', '-monitor', 'none', '-icount', p.icount ?? 'shift=2,sleep=off'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err = (err + String(d)).slice(-2000); });
  // ลำดับเปิดต้องตรงกับ bridge (bridge เปิด ci เพื่ออ่านก่อน แล้ว co เพื่อเขียน)
  const wfd = openSync(ci, 'w');
  const rfd = openSync(co, 'r');
  let buf = '';
  const chunk = Buffer.alloc(65536);
  let closed = false;
  return {
    send(line) { if (!closed) writeSync(wfd, line + '\n'); },
    readLine() {
      for (;;) {
        const i = buf.indexOf('\n');
        if (i >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); return l; }
        const n = readSync(rfd, chunk, 0, chunk.length, null);
        if (n <= 0) throw new Error(`esp32-bridge หยุดทำงาน${err ? `: ${err.trim().split('\n').pop()}` : ''}`);
        buf += chunk.toString('latin1', 0, n);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try { closeSync(wfd); } catch { /* */ }
      try { closeSync(rfd); } catch { /* */ }
      try { child.kill('SIGKILL'); } catch { /* */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}
