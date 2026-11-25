// สร้างไฟล์ .hex ทดสอบจาก .ino ด้วยบริการคอมไพล์ (ต้องมี avr-gcc): npx vite-node tests/fixtures/uno/gen.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileSketch } from '../../../server/compile.mjs';
import { DISPENSER_CODE, MOTOR_CODE, WATERING_CODE } from '../../../src/projects/final-projects';
import { ATTINY_DEFAULT_CODE, NANO_POT_CODE, UNO_DEFAULT_CODE, UNO_LA_CODE, UNO_LCD_CODE, UNO_RGB_CODE, UNO_I2C_LA_CODE } from '../../../src/model/catalog';
const dir = path.dirname(fileURLToPath(import.meta.url));
const jobs: Record<string, string> = { blink: UNO_DEFAULT_CODE, pwm: readFileSync(path.join(dir, 'pwm.ino'), 'utf8'), adc: readFileSync(path.join(dir, 'adc.ino'), 'utf8'), rgb: UNO_RGB_CODE, la: UNO_LA_CODE, lcd: UNO_LCD_CODE, i2cla: UNO_I2C_LA_CODE, lcd8: readFileSync(path.join(dir, 'lcd8.ino'), 'utf8'), ina219: readFileSync(path.join(dir, 'ina219.ino'), 'utf8'), blink9: UNO_DEFAULT_CODE.replace('const int LED = 13;', 'const int LED = 9; ') };
for (const k of ['interrupt', 'eeprom', 'watchdog', 'spi', 'servotone', 'sensors1']) jobs[k] = readFileSync(path.join(dir, `${k}.ino`), 'utf8');
// Arduino Nano (variant eightanaloginputs): ชื่อไฟล์ขึ้นต้น nano-
const nanoJobs: Record<string, string> = { 'nano-pot': NANO_POT_CODE, 'nano-blink': UNO_DEFAULT_CODE };
for (const k of ['interrupt', 'eeprom', 'watchdog', 'ina219', 'servotone', 'spi']) nanoJobs[`nano-${k}`] = jobs[k];
// Arduino UNO Q (โหมดจำลองพฤติกรรม — บอร์ด unoq ในบริการคอมไพล์): ชื่อไฟล์ขึ้นต้น unoq-
const unoqJobs: Record<string, string> = { 'unoq-adc': jobs.adc, 'unoq-dispenser': DISPENSER_CODE, 'unoq-watering': WATERING_CODE, 'unoq-motor': MOTOR_CODE, 'unoq-lcdi2c': readFileSync(path.join(dir, 'unoq-lcdi2c.ino'), 'utf8') };
// Arduino Mega 2560 (ATmega2560, variant mega): ชื่อไฟล์ขึ้นต้น mega-
const megaJobs: Record<string, string> = { 'mega-blink': UNO_DEFAULT_CODE };
for (const k of ['io', 'int', 'uart', 'eeprom', 'spi']) megaJobs[`mega-${k}`] = readFileSync(path.join(dir, `mega-${k}.ino`), 'utf8');
for (const k of ['ina219', 'watchdog', 'servotone']) megaJobs[`mega-${k}`] = jobs[k];
// Arduino Pro Mini (variant eightanaloginputs): promini- = 5 V/16 MHz, promini3- = 3.3 V/8 MHz (F_CPU 8000000L)
const prominiJobs: Record<string, string> = { 'promini-io': readFileSync(path.join(dir, 'promini-io.ino'), 'utf8'), 'promini-blink': UNO_DEFAULT_CODE };
for (const k of ['io', 'blink']) prominiJobs[`promini3-${k}`] = prominiJobs[`promini-${k}`];
for (const k of ['ina219', 'watchdog', 'interrupt', 'eeprom']) prominiJobs[`promini3-${k}`] = jobs[k];
// ATtiny85 (8 MHz ภายใน, variant gemma): ชื่อไฟล์ขึ้นต้น tiny-
const tinyJobs: Record<string, string> = { 'tiny-blink': ATTINY_DEFAULT_CODE };
for (const k of ['pwm', 'adc', 'int', 'eewdt']) tinyJobs[`tiny-${k}`] = readFileSync(path.join(dir, `tiny-${k}.ino`), 'utf8');
const only = process.argv[2];
for (const [k, src] of [...Object.entries(jobs), ...Object.entries(nanoJobs), ...Object.entries(unoqJobs), ...Object.entries(megaJobs), ...Object.entries(prominiJobs), ...Object.entries(tinyJobs)]) {
  if (only && !k.startsWith(only)) continue;
  const r = await compileSketch(src, k.startsWith('nano-') ? 'nano' : k.startsWith('unoq-') ? 'unoq' : k.startsWith('mega-') ? 'mega' : k.startsWith('promini3-') ? 'promini3' : k.startsWith('promini-') ? 'promini' : k.startsWith('tiny-') ? 'attiny85' : 'uno');
  if (!r.ok) throw new Error(`${k}: ${JSON.stringify(r.diagnostics)}`);
  writeFileSync(path.join(dir, `${k}.hex`), r.hex);
  console.log(k, r.size.flash, 'B');
}
