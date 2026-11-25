/**
 * บริการคอมไพล์ Arduino (AVR) — avr-gcc + ArduinoCore-avr ตามสูตรใน platform.txt ของ Arduino
 * ใช้ได้ทั้งเป็นโมดูล (server.mjs) และคำสั่ง: node server/compile.mjs --prebuild (สร้างไลบรารี core ไว้ล่วงหน้า)
 *
 * ขั้นตอน (เหมือน Arduino IDE): .ino → เติม #include <Arduino.h> + ต้นแบบฟังก์ชัน (prototype) + #line ให้เลขบรรทัดตรงไฟล์เดิม
 *   → avr-g++ → ลิงก์กับ core.a และไลบรารีมาตรฐาน (Wire, SPI, SoftwareSerial, EEPROM, Servo, LiquidCrystal, LiquidCrystal_I2C ที่เขียนใหม่ใน server/libraries) → .hex + ขนาดโปรแกรม
 * ความปลอดภัย: คอมไพล์อย่างเดียว (ไม่รันโค้ดบนเซิร์ฟเวอร์) · ห้าม include ด้วย path สัมบูรณ์/.. /มาโคร · ห้าม .incbin/.include ใน asm
 *   (กันการดึงไฟล์บนเซิร์ฟเวอร์เข้ามาในผลคอมไพล์) · จำกัดขนาดโค้ด เวลา และขนาดข้อความ
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_DIR = process.env.ARDUINO_CORE_DIR ?? '/opt/arduino/ArduinoCore-avr';
export const SERVO_DIR = process.env.ARDUINO_SERVO_DIR ?? '/opt/arduino/Servo';
export const LOCAL_LIBS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'libraries');
export const LCD_DIR = process.env.ARDUINO_LCD_DIR ?? '/opt/arduino/LiquidCrystal';
const CACHE_DIR = process.env.ARDUINO_CACHE_DIR ?? path.join(tmpdir(), 'circuitlab-avr-cache');
const TOOL_TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS ?? 25000);
export const MAX_SOURCE = 64 * 1024;

/** บอร์ดที่รองรับ — ค่าจาก boards.txt ของ ArduinoCore-avr 1.8.6 */
export const BOARDS = {
  uno: { name: 'Arduino Uno R3', mcu: 'atmega328p', fcpu: '16000000L', board: 'AVR_UNO', variant: 'standard', maxFlash: 32256, maxRam: 2048 },
  // Nano (ATmega328P): variant eightanaloginputs = A6/A7 (NUM_ANALOG_INPUTS 8) · flash 30,720 ไบต์ตาม boards.txt (บูตโหลดเดอร์ 2 KB)
  nano: { name: 'Arduino Nano', mcu: 'atmega328p', fcpu: '16000000L', board: 'AVR_NANO', variant: 'eightanaloginputs', maxFlash: 30720, maxRam: 2048 },
  // Arduino UNO Q — โหมดจำลองพฤติกรรม (ระดับ Arduino API): คอมไพล์สเก็ตช์เป็นโปรแกรม ATmega328P แทน STM32U585 + Zephyr
  // ขนาดโปรแกรม/RAM จึงจำกัดตามแกนที่ใช้แทน (บอร์ดจริงมีแฟลช 2 MB, SRAM 786 KB) · ดู UNOQ_UNSUPPORTED
  // Mega 2560 (ATmega2560): variant mega = ขา D0–D69, A0–A15 · flash 253,952 ไบต์ (บูตโหลดเดอร์ stk500v2 8 KB) · RAM 8 KB
  mega: { name: 'Arduino Mega 2560', mcu: 'atmega2560', fcpu: '16000000L', board: 'AVR_MEGA2560', variant: 'mega', maxFlash: 253952, maxRam: 8192 },
  // Pro or Pro Mini (ATmega328P): variant eightanaloginputs, flash 30,720 ไบต์ (บูตโหลดเดอร์ 2 KB), RAM 2,048 · pro.menu.cpu.16MHzatmega328 (5 V) / 8MHzatmega328 (3.3 V)
  promini: { name: 'Arduino Pro Mini (5V, 16 MHz)', mcu: 'atmega328p', fcpu: '16000000L', board: 'AVR_PRO', variant: 'eightanaloginputs', maxFlash: 30720, maxRam: 2048 },
  promini3: { name: 'Arduino Pro Mini (3.3V, 8 MHz)', mcu: 'atmega328p', fcpu: '8000000L', board: 'AVR_PRO', variant: 'eightanaloginputs', maxFlash: 30720, maxRam: 2048 },
  // ATtiny85 ชิปเดี่ยว (DIP-8) ใช้แกน ArduinoCore-avr + variant gemma (ตารางขา ATtiny85 ของแกนทางการ) · นาฬิกาภายใน 8 MHz (ค่าที่ boards.txt ของ gemma ใช้)
  // แฟลช 8,192 ไบต์ (เขียนด้วยเครื่องโปรแกรม ISP ไม่มีบูตโหลดเดอร์) · RAM 512 ไบต์ · ไม่มี UART/TWI/SPI ฮาร์ดแวร์ → ไลบรารีที่ใช้ได้: EEPROM, SoftwareSerial, LiquidCrystal
  attiny85: { name: 'ATtiny85 (8 MHz ภายใน)', mcu: 'attiny85', fcpu: '8000000L', board: 'AVR_ATTINY85', variant: 'gemma', maxFlash: 8192, maxRam: 512, libs: ['SoftwareSerial', 'EEPROM', 'LiquidCrystal'] },
  unoq: { name: 'Arduino UNO Q (จำลองพฤติกรรม)', mcu: 'atmega328p', fcpu: '16000000L', board: 'AVR_UNO', variant: 'standard', maxFlash: 32256, maxRam: 2048, defines: ['CIRCUITLAB_UNOQ_BEHAVIORAL'] },
};

/**
 * API ของ UNO Q ที่โหมดจำลองพฤติกรรมยังไม่มี — แจ้งเป็นภาษาไทยก่อนคอมไพล์ (แทนข้อความ "not declared" ของคอมไพเลอร์)
 * ที่มา: เอกสาร UNO Q (Wire = I2C2 ที่ขา SDA/SCL, Wire1 = Qwiic, Wire2 = A4/A5), บทความ Arduino "Migrating to Zephyr core 0.55.0" (Serial = Monitor, Serial1 = D0/D1)
 */
export const UNOQ_UNSUPPORTED = [
  [/#\s*include\s*[<"]Arduino_RouterBridge\.h[>"]|\bBridge\s*\./, 'Bridge (RPC กับ Linux ฝั่ง QRB2210) ยังไม่จำลอง — โหมดนี้จำลองเฉพาะฝั่งไมโครคอนโทรลเลอร์'],
  [/#\s*include\s*[<"]Arduino_LED_Matrix\.h[>"]/, 'LED matrix 8 × 13 บนบอร์ดยังไม่จำลอง'],
  [/\bWire1\b/, 'Wire1 (I²C4 ที่ช่อง Qwiic) ยังไม่จำลอง — ใช้ Wire (ขา SDA/SCL ข้าง AREF)'],
  [/\bWire2\b/, 'Wire2 (I²C3 ที่ A4/A5) ยังไม่จำลอง — ใช้ Wire (ขา SDA/SCL ข้าง AREF)'],
  [/\bSerial1\b/, 'Serial1 (UART ที่ D0/D1) ยังไม่จำลอง — Serial แสดงที่ Serial Monitor'],
  [/\banalog(Read|Write)Resolution\s*\(/, 'analogReadResolution/analogWriteResolution ยังไม่จำลอง — analogRead ให้ค่า 10 บิต (0–1023) อ้างอิง 3.3 V'],
  [/#\s*include\s*[<"](zephyr\/|Arduino_Bridge|Arduino_RPClite)/, 'ไลบรารีเฉพาะ Zephyr/Bridge ยังไม่จำลอง'],
];

/**
 * ATtiny85 ไม่มี USART/TWI/SPI ฮาร์ดแวร์ — แจ้งเป็นภาษาไทยก่อนคอมไพล์ (แทนข้อความ "not declared"/"no such file" ของคอมไพเลอร์)
 * ที่มา: datasheet ATtiny25/45/85 (Atmel-2586) — มีเฉพาะ USI ซึ่งต้องใช้ไลบรารีเฉพาะ (TinyWire ฯลฯ) ที่บริการคอมไพล์ยังไม่มี
 */
export const ATTINY_UNSUPPORTED = [
  [/\bSerial\s*\./, 'ATtiny85 ไม่มี UART ฮาร์ดแวร์ — ใช้ Serial ไม่ได้ (บนชิปจริงก็ไม่มี) · ส่งข้อความด้วย SoftwareSerial (เช่น SoftwareSerial s(3, 4);) แล้วดูด้วยเครื่องวิเคราะห์ลอจิก'],
  [/#\s*include\s*[<"]Wire\.h[>"]/, 'ATtiny85 ไม่มี TWI (I²C) ฮาร์ดแวร์ — Wire.h ใช้ไม่ได้ (บนชิปจริงต้องใช้ไลบรารี USI เช่น TinyWire ซึ่งบริการคอมไพล์ยังไม่มี)'],
  [/#\s*include\s*[<"]SPI\.h[>"]/, 'ATtiny85 ไม่มี SPI ฮาร์ดแวร์ — SPI.h ใช้ไม่ได้ (ไลบรารี USI ยังไม่มีในบริการคอมไพล์)'],
  [/#\s*include\s*[<"]Servo\.h[>"]/, 'ไลบรารี Servo ของ Arduino ต้องใช้ Timer1 แบบ 16 บิต ซึ่ง ATtiny85 ไม่มี — ยังไม่รองรับ'],
  [/#\s*include\s*[<"]LiquidCrystal_I2C\.h[>"]/, 'จอ LCD I²C ต้องใช้ Wire (I²C) ซึ่ง ATtiny85 ไม่มีฮาร์ดแวร์ — ยังไม่รองรับ'],
];

const LIBS = [
  { name: 'Wire', dir: () => path.join(CORE_DIR, 'libraries/Wire/src') },
  { name: 'SPI', dir: () => path.join(CORE_DIR, 'libraries/SPI/src') },
  { name: 'SoftwareSerial', dir: () => path.join(CORE_DIR, 'libraries/SoftwareSerial/src') },
  { name: 'EEPROM', dir: () => path.join(CORE_DIR, 'libraries/EEPROM/src') },
  { name: 'Servo', dir: () => path.join(SERVO_DIR, 'src'), sub: 'avr' },
  { name: 'LiquidCrystal', dir: () => path.join(LCD_DIR, 'src') },
  // เขียนใหม่ใน repo นี้ (MIT) ให้ API ตรงกับ LiquidCrystal_I2C ที่นิยมใช้ — ไม่ได้ใช้โค้ดต้นฉบับ (ไม่ระบุใบอนุญาต)
  { name: 'LiquidCrystal_I2C', dir: () => path.join(LOCAL_LIBS, 'LiquidCrystal_I2C') },
];

/** ไลบรารีที่บอร์ดนี้ใช้ได้ (ATtiny85 ไม่มี TWI/SPI/USART ฮาร์ดแวร์ — Wire/SPI/Servo คอมไพล์ไม่ได้) */
function libsOf(b) { return b.libs ? LIBS.filter((l) => b.libs.includes(l.name)) : LIBS; }

function flags(b) {
  const inc = [path.join(CORE_DIR, 'cores/arduino'), path.join(CORE_DIR, 'variants', b.variant), ...libsOf(b).map((l) => l.dir())];
  const common = [`-mmcu=${b.mcu}`, `-DF_CPU=${b.fcpu}`, '-DARDUINO=10819', `-DARDUINO_${b.board}`, '-DARDUINO_ARCH_AVR', ...(b.defines ?? []).map((d) => `-D${d}`), ...inc.map((d) => `-I${d}`)];
  return {
    cpp: ['-c', '-g', '-Os', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections', '-fno-threadsafe-statics', '-Wno-error=narrowing', '-flto', ...common],
    c: ['-c', '-g', '-Os', '-std=gnu11', '-ffunction-sections', '-fdata-sections', '-flto', '-fno-fat-lto-objects', ...common],
    S: ['-c', '-g', '-x', 'assembler-with-cpp', '-flto', ...common],
    link: ['-Os', '-g', '-flto', '-fuse-linker-plugin', '-Wl,--gc-sections', `-mmcu=${b.mcu}`],
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const cap = (s, d) => (s.length < 200000 ? s + d : s);
    p.stdout.on('data', (d) => { out = cap(out, d.toString()); });
    p.stderr.on('data', (d) => { err = cap(err, d.toString()); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); err += `\n[หมดเวลา ${TOOL_TIMEOUT_MS / 1000} วินาที]`; }, opts.timeout ?? TOOL_TIMEOUT_MS);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e.message ?? e) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
  });
}

async function listSources(dir, recurse = true) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir)) {
    const f = path.join(dir, e);
    const s = await stat(f);
    if (s.isDirectory()) { if (recurse) out.push(...(await listSources(f))); }
    else if (/\.(c|cpp|S)$/.test(e)) out.push(f);
  }
  return out;
}

async function compileFile(src, obj, f) {
  const ext = path.extname(src);
  const args = ext === '.cpp' ? f.cpp : ext === '.c' ? f.c : f.S;
  const r = await run(ext === '.cpp' ? 'avr-g++' : 'avr-gcc', [...args, src, '-o', obj]);
  if (r.code !== 0) throw new Error(`คอมไพล์ ${path.basename(src)} ไม่ได้:\n${r.err}`);
}

/** สร้าง core.a และไลบรารีมาตรฐานของบอร์ด (ครั้งเดียว เก็บไว้ใน cache) */
export async function prebuild(boardId = 'uno') {
  const b = BOARDS[boardId];
  const dir = path.join(CACHE_DIR, boardId);
  // ชื่อไฟล์บอกรายการไลบรารี — เพิ่มไลบรารีใหม่แล้วสร้างใหม่อัตโนมัติ
  const done = path.join(dir, `ready-${libsOf(b).map((l) => l.name).join('-')}`);
  if (existsSync(done)) return dir;
  await mkdir(dir, { recursive: true });
  const f = flags(b);
  const groups = [['core', await listSources(path.join(CORE_DIR, 'cores/arduino'), false)]];
  for (const l of libsOf(b)) {
    const base = l.dir();
    const files = l.sub ? await listSources(path.join(base, l.sub)) : await listSources(base);
    groups.push([`lib${l.name}`, files]);
  }
  for (const [name, files] of groups) {
    if (!files.length) continue;
    const objs = [];
    for (const src of files) {
      const obj = path.join(dir, `${name}-${path.basename(src)}.o`);
      await compileFile(src, obj, f);
      objs.push(obj);
    }
    const a = path.join(dir, `${name}.a`);
    await rm(a, { force: true });
    const r = await run('avr-gcc-ar', ['rcs', a, ...objs]);
    if (r.code !== 0) throw new Error(`สร้าง ${name}.a ไม่ได้: ${r.err}`);
  }
  await writeFile(done, new Date().toISOString());
  return dir;
}

/* ---------------- เตรียมไฟล์ .ino ---------------- */

/** แทนคอมเมนต์/สตริงด้วยช่องว่าง (คงจำนวนบรรทัด) เพื่อหาโครงสร้างโค้ด */
function blankCode(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { out += '  '; i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; out += q; i++; while (i < s.length && s[i] !== q && s[i] !== '\n') { if (s[i] === '\\') { out += '  '; i += 2; continue; } out += ' '; i++; } if (i < s.length) { out += s[i]; i++; } continue; }
    out += c; i++;
  }
  return out;
}

const NOT_FUNC = /^(if|else|while|for|switch|do|return|struct|class|union|enum|namespace|typedef|template|extern|using)\b/;

/**
 * หาฟังก์ชันระดับบนสุดเพื่อสร้าง prototype (Arduino IDE ทำด้วย ctags) — ผู้เรียนเรียกฟังก์ชันก่อนประกาศได้เหมือนใน IDE
 * คืน prototype และบรรทัด (0-based) ของฟังก์ชันแรก
 */
export function findFunctions(src) {
  const b = blankCode(src);
  const protos = [];
  let depth = 0, paren = 0, acc = '', accLine = -1, line = 0, first = -1, lineStart = true;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === '\n') { line++; lineStart = true; if (depth === 0) acc += ' '; continue; }
    if (lineStart && c === '#' && depth === 0) { while (i < b.length && b[i] !== '\n') { if (b[i] === '\\' && b[i + 1] === '\n') { i++; line++; } i++; } i--; acc = ''; continue; }
    if (!/\s/.test(c)) lineStart = false;
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
    if (c === '(') paren++;
    if (c === ')') paren--;
    if (c === ';' || c === '}') { acc = ''; accLine = -1; continue; }
    if (c === '{' && paren === 0) {
      const head = acc.replace(/\s+/g, ' ').trim();
      // ชนิดคืนค่ากับชื่อต้องคั่นด้วยช่องว่าง/*/&/> — ไม่งั้น ISR(PCINT2_vect) จะถูกแยกเป็น "I SR(...)"
      const m = head.match(/^(.*?[*&>\s])\s*([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(const)?$/);
      if (m && m[1].trim() && !NOT_FUNC.test(head) && !head.includes('=') && !/\bstatic_assert\b/.test(head)) {
        protos.push(`${m[1].trim()} ${m[2]}(${m[3].replace(/=[^,]*/g, '').trim()})${m[4] ? ' const' : ''};`);
        if (first < 0) first = accLine;
      }
      depth = 1; acc = ''; accLine = -1;
      continue;
    }
    if (acc === '' || /^\s*$/.test(acc)) accLine = line;
    acc += c;
  }
  return { protos, firstLine: first };
}

/** โค้ด .ino → .cpp ที่คอมไพล์ได้ โดยเลขบรรทัดในข้อผิดพลาดตรงกับไฟล์ sketch.ino */
export function preprocessSketch(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const { protos, firstLine } = findFunctions(lines.join('\n'));
  const at = firstLine >= 0 ? firstLine : lines.length;
  const parts = ['#include <Arduino.h>', '#line 1 "sketch.ino"', ...lines.slice(0, at)];
  if (protos.length) parts.push(...protos, `#line ${at + 1} "sketch.ino"`);
  parts.push(...lines.slice(at));
  return { cpp: parts.join('\n') + '\n', protos };
}

/** ตรวจความปลอดภัยของโค้ดก่อนคอมไพล์ — คืนรายการข้อผิดพลาด (ชี้บรรทัด) */
export function checkSource(src) {
  const errs = [];
  if (src.length > MAX_SOURCE) errs.push({ line: 1, col: 1, severity: 'error', message: `โค้ดยาวเกิน ${MAX_SOURCE / 1024} KB` });
  src.split('\n').forEach((l, k) => {
    const inc = l.match(/^\s*#\s*(include|include_next|import)\b\s*(.*)$/);
    if (inc) {
      const arg = inc[2].trim();
      const m = arg.match(/^[<"]([\w./+-]+)[>"]/);
      if (inc[1] !== 'include' || !m) errs.push({ line: k + 1, col: 1, severity: 'error', message: 'บริการคอมไพล์รับเฉพาะ #include <ชื่อไฟล์.h> หรือ "ชื่อไฟล์.h" ที่เขียนตรง ๆ (ไม่รับมาโคร)' });
      else if (m[1].startsWith('/') || m[1].split('/').includes('..')) errs.push({ line: k + 1, col: 1, severity: 'error', message: 'ห้าม include ด้วย path สัมบูรณ์หรือ .. (อ่านไฟล์นอกโปรเจกต์ไม่ได้)' });
    }
    if (/\.(incbin|include)\b/.test(l)) errs.push({ line: k + 1, col: 1, severity: 'error', message: 'ไม่รองรับ .incbin/.include ในแอสเซมบลี' });
  });
  return errs;
}

/** แยกข้อความของคอมไพเลอร์เป็นรายการ (ไฟล์ บรรทัด คอลัมน์ ระดับ ข้อความ) */
export function parseDiagnostics(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^(.*?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/);
    if (m) out.push({ file: path.basename(m[1]), line: Number(m[2]), col: m[3] ? Number(m[3]) : 1, severity: m[4] === 'fatal error' ? 'error' : m[4], message: m[5] });
    else if (/undefined reference to/.test(raw)) out.push({ file: '', line: 0, col: 0, severity: 'error', message: raw.replace(/^.*?: /, '').trim() });
  }
  return out;
}

/**
 * คอมไพล์ sketch → { ok, hex, size: { flash, ram, maxFlash, maxRam }, diagnostics, log }
 */
export async function compileSketch(src, boardId = 'uno') {
  const b = BOARDS[boardId];
  if (!b) return { ok: false, diagnostics: [{ file: '', line: 0, col: 0, severity: 'error', message: `ไม่รู้จักบอร์ด ${boardId}` }], log: '' };
  const bad = checkSource(src);
  if (boardId === 'attiny85') src.split('\n').forEach((l, k) => { const code = l.replace(/\/\/.*$/, ''); for (const [re, msg] of ATTINY_UNSUPPORTED) if (re.test(code)) bad.push({ line: k + 1, col: 1, severity: 'error', message: msg }); });
  if (boardId === 'unoq') src.split('\n').forEach((l, k) => { const code = l.replace(/\/\/.*$/, ''); for (const [re, msg] of UNOQ_UNSUPPORTED) if (re.test(code)) bad.push({ line: k + 1, col: 1, severity: 'error', message: `UNO Q (โหมดจำลองพฤติกรรม): ${msg}` }); });
  if (bad.length) return { ok: false, diagnostics: bad.map((d) => ({ file: 'sketch.ino', ...d })), log: '' };
  const lib = await prebuild(boardId);
  const dir = await mkdtemp(path.join(tmpdir(), 'sketch-'));
  try {
    const f = flags(b);
    const { cpp } = preprocessSketch(src);
    await writeFile(path.join(dir, 'sketch.ino.cpp'), cpp);
    const cc = await run('avr-g++', [...f.cpp, 'sketch.ino.cpp', '-o', 'sketch.o'], { cwd: dir });
    let log = cc.err;
    if (cc.code !== 0) return { ok: false, diagnostics: parseDiagnostics(cc.err), log };
    const libs = libsOf(b).map((l) => path.join(lib, `lib${l.name}.a`)).filter((a) => existsSync(a));
    const ld = await run('avr-gcc', [...f.link, '-o', 'sketch.elf', 'sketch.o', '-Wl,--start-group', ...libs, path.join(lib, 'core.a'), '-Wl,--end-group', '-lm'] /* ไลบรารีอ้างถึงกันเอง (เช่น LiquidCrystal_I2C → Wire) */, { cwd: dir });
    log += ld.err;
    if (ld.code !== 0) return { ok: false, diagnostics: parseDiagnostics(ld.err).length ? parseDiagnostics(ld.err) : [{ file: '', line: 0, col: 0, severity: 'error', message: ld.err.trim().split('\n').slice(-3).join(' ') }], log };
    const hx = await run('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', 'sketch.elf', 'sketch.hex'], { cwd: dir });
    if (hx.code !== 0) return { ok: false, diagnostics: [{ file: '', line: 0, col: 0, severity: 'error', message: hx.err }], log };
    const sz = await run('avr-size', ['-A', 'sketch.elf'], { cwd: dir });
    const sec = (n) => Number(sz.out.match(new RegExp(`^\\${n}\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    const flash = sec('.text') + sec('.data'), ram = sec('.data') + sec('.bss');
    const diagnostics = parseDiagnostics(cc.err);
    if (flash > b.maxFlash) return { ok: false, diagnostics: [...diagnostics, { file: '', line: 0, col: 0, severity: 'error', message: `โปรแกรมใหญ่เกินหน่วยความจำแฟลช: ${flash} จาก ${b.maxFlash} ไบต์` }], log };
    if (ram > b.maxRam) diagnostics.push({ file: '', line: 0, col: 0, severity: 'warning', message: `ตัวแปรใช้ RAM ${ram} จาก ${b.maxRam} ไบต์ — เกินแล้วโปรแกรมจะทำงานผิดปกติ` });
    const hex = await readFile(path.join(dir, 'sketch.hex'), 'utf8');
    return { ok: true, hex, size: { flash, ram, maxFlash: b.maxFlash, maxRam: b.maxRam }, diagnostics, log };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** รุ่นของเครื่องมือ (สำหรับ /api/health) */
export async function toolchainInfo() {
  const g = await run('avr-gcc', ['--version'], { timeout: 5000 });
  return { avrGcc: g.out.split('\n')[0] ?? '', core: 'ArduinoCore-avr 1.8.6', servo: 'Servo 1.2.2', boards: Object.keys(BOARDS) };
}

/** มี avr-gcc และ ArduinoCore-avr พร้อมคอมไพล์หรือไม่ */
export async function toolchainReady() {
  if (!existsSync(path.join(CORE_DIR, 'cores', 'arduino', 'Arduino.h'))) return false;
  const g = await run('avr-gcc', ['--version'], { timeout: 5000 });
  return g.code === 0;
}

if (process.argv.includes('--prebuild')) {
  const t0 = Date.now();
  Promise.all(Object.keys(BOARDS).map((b) => prebuild(b))).then((d) => { console.log(`prebuilt core → ${d.join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }, (e) => { console.error(e); process.exit(1); });
}
