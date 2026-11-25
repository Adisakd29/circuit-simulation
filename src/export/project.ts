import { isPico, isMicroPy } from '../model/types';
import { computeConnectivity, netLinked, type Connectivity } from '../connectivity/connectivity';
import { boardSpec, holeLabel } from '../model/breadboard';
import { catalogEntry, pinDefs } from '../model/catalog';
import { pinHolesFor, isBenchKind } from '../model/geometry';
import { SUPPORT } from '../model/support';
import { boardProfile, FEATURE_LABELS, LEVEL_LABEL } from '../model/board-features';
import type { CircuitDoc, Part, TerminalRef } from '../model/types';
import type { Diagnostic } from '../instruments/measure';

/**
 * ส่งออกโครงงานสำหรับประกอบฮาร์ดแวร์จริง (Master Prompt ข้อ 8)
 * ทุกตารางสร้างจากข้อมูลวงจรในไฟล์งาน (อุปกรณ์ ขา รู สาย และเน็ตจาก connectivity) — ไม่เดาจากภาพ 3 มิติ
 * ผลจำลอง (คำเตือน, กระแส) ใส่เฉพาะเมื่อผู้ใช้กด Run แล้ว และระบุว่าเป็นผลจำลอง ไม่ใช่การรับรองความปลอดภัย
 */

export interface BomRow { item: string; spec: string; qty: number; refs: string[]; note: string }
export interface PinRow { board: string; pin: string; label: string; net: string; to: string[] }
export interface WireRow { n: number; from: string; to: string; color: string; type: string }
export interface PlaceRow { ref: string; item: string; where: string; pins: string }
export interface CodeFile { board: string; kind: string; filename: string; language: string; code: string; libraries: string[]; upload: string[] }
export interface CheckItem { text: string; level: 'must' | 'check' }
export interface ProjectReport {
  title: string;
  date: string;
  bom: BomRow[];
  pins: PinRow[];
  wires: WireRow[];
  place: PlaceRow[];
  nets: Array<{ name: string; members: string[] }>;
  code: CodeFile[];
  power: string[];
  checklist: CheckItem[];
  limits: Array<{ item: string; text: string }>;
  diagnostics: Diagnostic[] | null;
}

const MCU_KINDS = ['uno', 'nano', 'unoq', 'mega', 'promini', 'attiny85', 'pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5', 'esp32s2', 'esp32s3lcd', 'bluepill', 'pico2', 'teensy41'];
const LED_TH: Record<string, string> = { red: 'แดง', green: 'เขียว', yellow: 'เหลือง', blue: 'น้ำเงิน', white: 'ขาว' };

export function fmtSI(v: number, unit: string): string {
  const a = Math.abs(v);
  const pre: Array<[number, string]> = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  for (const [m, p] of pre) if (a >= m * 0.999) return `${+(v / m).toPrecision(3)} ${p}${unit}`;
  return `${v} ${unit}`;
}

/** สเปกสั้นของอุปกรณ์สำหรับ BOM (จากพารามิเตอร์ในไฟล์งาน) */
export function partSpec(p: Part): string {
  const q = p.params as Record<string, unknown>;
  const s: string[] = [];
  if (typeof q.model === 'string') s.push(q.model);
  if (p.kind === 'resistor') s.push(`${fmtSI(q.resistance as number, 'Ω')} ${q.powerRating ? `${q.powerRating} W` : ''}`.trim());
  else if (p.kind === 'potentiometer') s.push(fmtSI(q.resistance as number, 'Ω'));
  if (p.kind === 'led' && typeof q.color === 'string') s.push(`สี${LED_TH[q.color] ?? q.color} 5 mm`);
  if (typeof q.capacitance === 'number') s.push(`${fmtSI(q.capacitance, 'F')} ${q.ratedVoltage ? `${q.ratedVoltage} V` : ''}${q.polarized ? ' อิเล็กโทรไลต์ (มีขั้ว)' : ''}`.trim());
  if (typeof q.inductance === 'number') s.push(fmtSI(q.inductance, 'H'));
  if (p.kind === 'buzzer' && typeof q.type === 'string') s.push(q.type === 'active' ? 'แบบแอกทีฟ (มีวงจรกำเนิดเสียงในตัว)' : 'แบบพาสซีฟ');
  if (p.kind === 'dcsupply' && typeof q.voltage === 'number') s.push(`ตั้ง ${q.voltage} V จำกัด ${fmtSI(q.currentLimit as number, 'A')}`);
  return s.join(' · ');
}

function partName(p: Part): string { return catalogEntry(p.kind)?.name ?? p.kind; }

function pinLabel(p: Part, pin: string): string {
  const d = pinDefs(p).find((x) => x.name === pin);
  return d?.label ?? pin;
}

export function terminalText(doc: CircuitDoc, t: TerminalRef): string {
  if (t.kind === 'hole') return `รู ${holeLabel(t.hole)}${doc.breadboards.length > 1 ? ` (${t.boardId})` : ''}`;
  const p = doc.parts.find((x) => x.id === t.partId);
  if (!p) return `${t.partId}:${t.pin}`;
  const lab = pinLabel(p, t.pin);
  return `${p.label} · ${lab === t.pin ? t.pin : `${t.pin} (${lab})`}`;
}

const COLOR_NAMES: Array<[string, string]> = [['#e53935', 'แดง'], ['#212121', 'ดำ'], ['#1e88e5', 'น้ำเงิน'], ['#43a047', 'เขียว'], ['#fdd835', 'เหลือง'], ['#fb8c00', 'ส้ม'], ['#8e24aa', 'ม่วง'], ['#ffffff', 'ขาว'], ['#757575', 'เทา'], ['#6d4c41', 'น้ำตาล'], ['#ff7043', 'ส้มอ่อน']];
function colorName(hex: string): string {
  const v = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const c = v(hex);
  let best = COLOR_NAMES[0], bd = Infinity;
  for (const n of COLOR_NAMES) { const d = v(n[0]).reduce((a, x, i) => a + (x - c[i]) ** 2, 0); if (d < bd) { bd = d; best = n; } }
  return best[1];
}

/** ชื่อเน็ตที่อ่านง่าย: ใช้ขาไฟเลี้ยง/กราวด์ของบอร์ด ถ้ามี ไม่งั้น "N<เลข>" */
function netNames(doc: CircuitDoc, c: Connectivity): string[] {
  return c.nets.map((n) => {
    for (const pp of n.partPins) {
      const p = doc.parts.find((x) => x.id === pp.partId);
      if (!p) continue;
      if (MCU_KINDS.includes(p.kind) && /^(GND|3V3|5V|VBUS|VSYS|VIN)/.test(pp.pin)) return `${pp.pin.replace(/\.\d+$/, '')} (${p.label})`;
      if (p.kind === 'dcsupply') return `${pp.pin === 'pos' ? '+' : '−'} ${p.label}`;
    }
    return `N${n.index + 1}`;
  });
}

function codeFiles(doc: CircuitDoc): CodeFile[] {
  const out: CodeFile[] = [];
  for (const p of doc.parts) {
    if (p.kind === 'uno' || p.kind === 'nano' || p.kind === 'unoq' || p.kind === 'mega' || p.kind === 'promini' || p.kind === 'attiny85') {
      const code = p.params.code;
      const libs = [...code.matchAll(/^\s*#include\s*[<"]([^>"]+)[>"]/gm)].map((m) => m[1]);
      const builtIn: Record<string, string> = { 'Wire.h': 'Wire (มากับ Arduino IDE)', 'SPI.h': 'SPI (มากับ Arduino IDE)', 'EEPROM.h': 'EEPROM (มากับ Arduino IDE)', 'SoftwareSerial.h': 'SoftwareSerial (มากับ Arduino IDE)', 'Servo.h': 'Servo — Library Manager: "Servo" by Arduino (มักติดตั้งมาแล้ว)', 'LiquidCrystal.h': 'LiquidCrystal — Library Manager: "LiquidCrystal" by Arduino, Adafruit (มักติดตั้งมาแล้ว)', 'avr/wdt.h': 'avr/wdt.h (มากับคอมไพเลอร์ AVR)', 'avr/interrupt.h': 'avr/interrupt.h (มากับคอมไพเลอร์ AVR)', 'LiquidCrystal_I2C.h': 'LiquidCrystal_I2C — Library Manager: ค้นหา "LiquidCrystal I2C" (API เดียวกับที่บริการคอมไพล์ของแอปใช้: init/begin, backlight, setCursor, print)' };
      out.push({
        board: p.label, kind: p.kind, filename: `${p.label}/${p.label}.ino`, language: 'Arduino C/C++', code,
        libraries: libs.map((l) => builtIn[l] ?? `${l} — ไม่มีในบริการคอมไพล์ของแอป: หาใน Arduino IDE → Library Manager และตรวจใบอนุญาตเอง`),
        upload: p.kind === 'unoq' ? ['ติดตั้ง Arduino App Lab (หรือ Arduino IDE 2.x + แพ็กเกจบอร์ด "Arduino UNO Q Boards" ใน Boards Manager)', 'Tools → Board → Arduino UNO Q', 'ต่อสาย USB-C แล้วเลือกพอร์ต', `เปิดไฟล์ ${p.label}.ino แล้วกด Upload`, 'โค้ดนี้ผ่านการจำลองแบบพฤติกรรม (คอมไพล์ด้วย AVR) เท่านั้น — บนบอร์ดจริงคอมไพล์ด้วย Arduino Core บน Zephyr: ตรวจคำเตือนของคอมไพเลอร์และทดสอบทีละส่วนก่อนต่อโหลดจริง', 'Serial บน UNO Q ส่งผ่าน Monitor/Bridge ไปยัง Serial Monitor (ไม่ออกขา D0/D1)'] : p.kind === 'attiny85' ? ['ติดตั้ง Arduino IDE 2.x แล้วเพิ่มแกน ATtiny (เช่น ATTinyCore ของ Spence Konde ผ่าน Boards Manager — ตรวจใบอนุญาตและเวอร์ชันเอง) · ในแอปคอมไพล์ด้วย ArduinoCore-avr + ตารางขา gemma: pinMode/digitalWrite/analogRead/analogWrite/delay/millis/EEPROM/SoftwareSerial ใช้หมายเลขขาเดียวกัน (D0–D4 = PB0–PB4, A1 = PB2, A2 = PB4, A3 = PB3)', 'Tools → Board → ATtiny25/45/85 (No bootloader) · Chip ATtiny85 · Clock 8 MHz (internal)', 'ต่อเครื่องโปรแกรม ISP (เช่น USBasp หรือ Arduino as ISP): MOSI = ขา 5, MISO = ขา 6, SCK = ขา 7, RESET = ขา 1, VCC = ขา 8, GND = ขา 4', 'กด Tools → Burn Bootloader หนึ่งครั้งเพื่อตั้ง fuse นาฬิกาภายใน 8 MHz (ชิปใหม่จากโรงงานเดินที่ 1 MHz — ถ้าไม่ตั้ง delay() จะช้าลง 8 เท่า)', `เปิดไฟล์ ${p.label}.ino แล้วกด Sketch → Upload Using Programmer`, 'ATtiny85 ไม่มี UART: ถ้าต้องการดูข้อความ ใช้ SoftwareSerial ส่งออกขาหนึ่งแล้วต่อเข้าตัวแปลง USB-serial (ขา RX) — ใช้ GND ร่วมกัน'] : p.kind === 'promini' ? ['ติดตั้ง Arduino IDE 2.x', 'Tools → Board → Arduino AVR Boards → Arduino Pro or Pro Mini', `Tools → Processor → ${p.params.volt === 3.3 ? 'ATmega328P (3.3V, 8 MHz)' : 'ATmega328P (5V, 16 MHz)'} — ต้องตรงกับรุ่นบอร์ด ไม่เช่นนั้นเวลา/บอดเรตผิดสองเท่า`, `บอร์ดไม่มีพอร์ต USB: ต่อตัวแปลง USB-serial ${p.params.volt === 3.3 ? '3.3 V' : '5 V'} เข้าหัว 6 ขา (GND–GND, VCC–VCC, TX–RXI, RX–TXO, DTR–GRN เพื่อรีเซ็ตอัตโนมัติ) — ใช้ตัวแปลงที่แรงดันตรงกับบอร์ด`, 'เลือก Tools → Port ของตัวแปลง', `เปิดไฟล์ ${p.label}.ino (โฟลเดอร์ต้องชื่อเดียวกับไฟล์) แล้วกด Upload — ถ้าตัวแปลงไม่มีขา DTR ให้กดปุ่ม RESET บนบอร์ดตอนเริ่มอัปโหลด`, 'เปิด Serial Monitor ตั้งบอดเรตให้ตรงกับ Serial.begin() ในโค้ด'] : ['ติดตั้ง Arduino IDE 2.x', ...(p.kind === 'mega' ? ['Tools → Board → Arduino AVR Boards → Arduino Mega or Mega 2560', 'Tools → Processor → ATmega2560 (Mega 2560)'] : p.kind === 'nano' ? ['Tools → Board → Arduino AVR Boards → Arduino Nano', 'Tools → Processor → ATmega328P (บอร์ดรุ่นเก่า/บอร์ดเลียนแบบหลายรุ่นต้องเลือก ATmega328P (Old Bootloader) — ถ้าอัปโหลดไม่ผ่านให้ลองอีกตัวเลือก)', 'บอร์ดเลียนแบบที่ใช้ชิป CH340 อาจต้องติดตั้งไดรเวอร์ USB-serial ก่อน'] : ['Tools → Board → Arduino AVR Boards → Arduino Uno']), 'ต่อสาย USB แล้วเลือก Tools → Port', `เปิดไฟล์ ${p.label}.ino (โฟลเดอร์ต้องชื่อเดียวกับไฟล์) แล้วกด Upload`, 'เปิด Serial Monitor ตั้งบอดเรตให้ตรงกับ Serial.begin() ในโค้ด'],
      });
    } else if (isMicroPy(p)) {
      const code = p.params.code;
      const mods = [...code.matchAll(/^\s*(?:import\s+([\w, .]+)|from\s+(\w+)\s+import)/gm)].flatMap((m) => (m[1] ?? m[2]).split(',').map((x) => x.trim().split(/\s+as\s+/)[0].split('.')[0]));
      const files: Record<string, string> = { ssd1306: 'ssd1306.py (micropython-lib, MIT) — คัดลอกลงบอร์ดด้วย Thonny', gc9a01py: 'gc9a01py.py (Russ Hughes, MIT) + ฟอนต์ vga1_*', tm1637: 'tm1637.py (Mike Causer, MIT)', lcd_api: 'lcd_api.py + machine_i2c_lcd.py (python_lcd, MIT)', machine_i2c_lcd: 'machine_i2c_lcd.py (python_lcd, MIT)' };
      const builtin = new Set(['lsm6dsox', 'machine', 'time', 'utime', 'dht', 'struct', 'math', 'random', 'sys', 'gc', 'micropython', 'rp2', 'ustruct', 'framebuf', 'neopixel', 'onewire', 'ds18x20', 'os', 'uos', 'array', 'collections', 'json', 'select']);
      const libs = [...new Set(mods)].filter((m) => !builtin.has(m)).map((m) => files[m] ?? `${m} — ไม่มีในเฟิร์มแวร์มาตรฐาน: ต้องหาไฟล์ ${m}.py มาคัดลอกลงบอร์ด`);
      out.push({
        board: p.label, kind: p.kind, filename: `${p.label}/main.py`, language: 'MicroPython', code, libraries: libs,
        upload: p.kind === 'esp32devkitc' ? ['ติดตั้งเฟิร์มแวร์ MicroPython ของบอร์ด ESP32_GENERIC (micropython.org — ในแอปใช้ v1.24.1): esptool.py --chip esp32 erase_flash แล้ว esptool.py --chip esp32 write_flash -z 0x1000 <ไฟล์ .bin> (หรือใช้ Thonny → Install or update MicroPython (esptool))', 'บอร์ด DevKitC ใช้ชิป USB-UART: ติดตั้งไดรเวอร์ของชิปนั้นถ้าคอมพิวเตอร์ไม่เห็นพอร์ต · ถ้าเขียนไม่ได้ให้กดปุ่ม Boot ค้างตอนเริ่มเขียน', 'เปิด Thonny → Run → Configure interpreter → MicroPython (ESP32) แล้วเลือกพอร์ต', ...libs.length ? ['คัดลอกไลบรารีในรายการด้านบนลงบอร์ด'] : [], 'บันทึกโค้ดลงบอร์ดชื่อ main.py (รันเองเมื่อเปิดเครื่อง)', 'ในแอปไม่ได้จำลอง Wi-Fi/Bluetooth, DAC, touch, RMT และตัวดึงขึ้น/ลงของขา RTC — ทดสอบส่วนนี้บนบอร์ดจริง'] : p.kind === 'nanoconnect' ? ['ดับเบิลคลิกปุ่ม RESET (หรือจั๊มขา REC กับ GND แล้วเสียบ USB) → คัดลอกเฟิร์มแวร์ MicroPython (.uf2) ของบอร์ด ARDUINO_NANO_RP2040_CONNECT (micropython.org) ลงไดรฟ์ RPI-RP2 — บนบอร์ดจริง Wi-Fi/Bluetooth, LED RGB และ A4–A7 แบบแอนะล็อกใช้ได้ผ่าน NINA-W102 แต่ในแอปยังไม่ได้ทดสอบส่วนนี้', 'เปิด Thonny → Run → Configure interpreter → MicroPython (Raspberry Pi Pico) แล้วเลือกพอร์ตของบอร์ด (หรือใช้ Arduino Lab for MicroPython)', ...libs.length ? ['คัดลอกไลบรารีในรายการด้านบนลงบอร์ด'] : [], 'บันทึกโค้ดลงบอร์ดชื่อ main.py (รันเองเมื่อเสียบไฟ)', 'บนบอร์ดจริง REPL อยู่ที่ USB — ขา TX/RX ว่างใช้งานได้ (ในแอปใช้เป็น REPL) · ไลบรารี lsm6dsox มีในเฟิร์มแวร์ของบอร์ดนี้แล้ว'] : p.kind === 'xiao' ? ['กดปุ่ม B (BOOT) ค้างแล้วเสียบสาย USB-C → คัดลอกเฟิร์มแวร์ MicroPython (.uf2) ของบอร์ด SEEED_XIAO_RP2040 (micropython.org — มีตั้งแต่ v1.28.0) ลงไดรฟ์ RPI-RP2 · ถ้าใช้เฟิร์มแวร์ RPI_PICO แทน ชื่อขา "D0"…"D10"/"LED_R" จะไม่มี ต้องใช้เลข GPIO (เช่น Pin(26) แทน Pin("D0"))', 'เปิด Thonny → Run → Configure interpreter → MicroPython (Raspberry Pi Pico) แล้วเลือกพอร์ตของบอร์ด', ...libs.length ? ['คัดลอกไลบรารีในรายการด้านบนลงบอร์ด (File → Save as → Raspberry Pi Pico)'] : [], 'บันทึกโค้ดลงบอร์ดชื่อ main.py (รันเองเมื่อเสียบไฟ)', 'บนบอร์ดจริง REPL อยู่ที่ USB — ขา D6/D7 (GPIO0/1) ว่างใช้งานได้ (ในแอปใช้เป็น REPL)'] : [p.kind === 'picow' ? 'กดปุ่ม BOOTSEL ค้างแล้วเสียบ USB → คัดลอกเฟิร์มแวร์ MicroPython (.uf2) ของ Raspberry Pi Pico W (RPI_PICO_W) ลงไดรฟ์ RPI-RP2 — บนบอร์ดจริง Wi-Fi และ Pin("LED") ใช้ได้ แต่ในแอปยังไม่ได้ทดสอบส่วนนี้' : 'กดปุ่ม BOOTSEL ค้างแล้วเสียบ USB → คัดลอกเฟิร์มแวร์ MicroPython (.uf2) ของ Raspberry Pi Pico ลงไดรฟ์ RPI-RP2', 'เปิด Thonny → Run → Configure interpreter → MicroPython (Raspberry Pi Pico)', ...libs.length ? ['คัดลอกไลบรารีในรายการด้านบนลงบอร์ด (File → Save as → Raspberry Pi Pico)'] : [], 'บันทึกโค้ดลงบอร์ดชื่อ main.py (รันเองเมื่อเสียบไฟ)'],
      });
    } else if (p.kind === 'rpi5') {
      out.push({
        board: p.label, kind: p.kind, filename: `${p.label}/main.py`, language: 'Python 3 (gpiozero)', code: p.params.code,
        libraries: ['gpiozero — ติดตั้งมากับ Raspberry Pi OS (ถ้าไม่มี: sudo apt install python3-gpiozero)', 'โค้ดในแอปใช้ gpiozero ชุดย่อยที่เขียนใหม่ให้ API ตรงกับ gpiozero 2.0 — ยังไม่ได้ทดสอบกับบอร์ดจริง'],
        upload: ['ติดตั้ง Raspberry Pi OS (Bookworm ขึ้นไป) ลง microSD', 'คัดลอก main.py ไปที่ Pi (เช่น ~/project/main.py)', 'รันด้วย python3 main.py · หยุดด้วย Ctrl-C'],
      });
    }
  }
  return out;
}

/** สร้างข้อมูลรายงานทั้งหมดจากวงจร (+ คำเตือนจากการจำลองล่าสุด ถ้ามี) */
export function buildProjectReport(doc: CircuitDoc, title: string, diagnostics: Diagnostic[] | null = null, now = new Date()): ProjectReport {
  const c = computeConnectivity(doc);
  const names = netNames(doc, c);
  // ---------- BOM ----------
  const groups = new Map<string, BomRow>();
  for (const p of doc.parts) {
    if (isBenchKind(p.kind)) continue; // เครื่องมือวัด/แหล่งจ่ายบนโต๊ะ — อยู่ในหมวดเครื่องมือ
    const spec = partSpec(p);
    const key = `${p.kind}|${spec}`;
    const g = groups.get(key) ?? { item: partName(p), spec, qty: 0, refs: [], note: '' };
    g.qty++; g.refs.push(p.label);
    groups.set(key, g);
  }
  const bom = [...groups.values()];
  for (const b of doc.breadboards) bom.push({ item: 'เบรดบอร์ด', spec: boardSpec(b.model).name, qty: 1, refs: [b.id], note: '' });
  const toMale = doc.wires.filter((w) => [w.a, w.b].some((t) => t.kind === 'pin' && doc.parts.find((p) => p.id === t.partId)?.kind === 'rpi5'));
  if (doc.wires.length - toMale.length > 0) bom.push({ item: 'สายจัมเปอร์ ผู้–ผู้', spec: 'ยาว 10–20 cm', qty: doc.wires.length - toMale.length, refs: [], note: 'ตรวจชนิดหัวสายกับขั้วต่อของอุปกรณ์จริงอีกครั้ง' });
  if (toMale.length) bom.push({ item: 'สายจัมเปอร์ เมีย–ผู้', spec: 'สำหรับหัวต่อ GPIO ตัวผู้ของ Raspberry Pi', qty: toMale.length, refs: [], note: '' });
  const instruments = doc.parts.filter((p) => isBenchKind(p.kind));
  for (const p of instruments) bom.push({ item: partName(p), spec: partSpec(p), qty: 1, refs: [p.label], note: 'เครื่องมือ/แหล่งจ่ายบนโต๊ะ' });

  // ---------- ตารางต่อขาของบอร์ด ----------
  const pins: PinRow[] = [];
  for (const p of doc.parts.filter((x) => MCU_KINDS.includes(x.kind))) {
    // ขาหลายขาบนเน็ตเดียวกัน (GND หลายขา): แสดงขาที่มีสายต่อ ถ้าไม่มีแสดงขาแรก
    const wiredPin = new Set(doc.wires.flatMap((w) => [w.a, w.b]).filter((t) => t.kind === 'pin' && t.partId === p.id).map((t) => (t as { pin: string }).pin));
    const shown = new Map<number, string>();
    for (const d of pinDefs(p)) { const n = c.netOf.get(`${p.id}:${d.name}`); if (n !== undefined && (!shown.has(n) || wiredPin.has(d.name) && !wiredPin.has(shown.get(n)!))) shown.set(n, d.name); }
    for (const d of pinDefs(p)) {
      if (shown.get(c.netOf.get(`${p.id}:${d.name}`) ?? -1) !== d.name) continue;
      const net = c.netOf.get(`${p.id}:${d.name}`);
      if (net === undefined || !netLinked(c, doc, net)) continue;
      // ขาที่ต่อถึงกันเองภายในบอร์ด (เช่น GND หลายขา, A4 = SDA) แต่ไม่มีอุปกรณ์/สายอื่น — ไม่นับว่าใช้งาน
      const wired = doc.wires.some((w) => [w.a, w.b].some((t) => c.netOf.get(t.kind === 'hole' ? `${t.boardId}/${t.hole}` : `${t.partId}:${t.pin}`) === net));
      if (!wired && !c.nets[net].partPins.some((pp) => pp.partId !== p.id)) continue;
      const to = c.nets[net].partPins.filter((pp) => pp.partId !== p.id).map((pp) => { const q = doc.parts.find((x) => x.id === pp.partId)!; return `${q.label} ${pp.pin === pinLabel(q, pp.pin) ? pp.pin : `${pp.pin} (${pinLabel(q, pp.pin)})`}`; });
      const viaHoles = c.nets[net].terminals.filter((t) => t.includes('/')).length;
      pins.push({ board: p.label, pin: d.name, label: d.label, net: names[net], to: to.length ? to : [viaHoles ? 'ต่อเข้ารูบนเบรดบอร์ด (ยังไม่มีอุปกรณ์อื่น)' : '—'] });
    }
  }

  // ---------- สาย ----------
  const wires: WireRow[] = doc.wires.map((w, i) => ({ n: i + 1, from: terminalText(doc, w.a), to: terminalText(doc, w.b), color: colorName(w.color), type: toMale.includes(w) ? 'เมีย–ผู้' : 'ผู้–ผู้' }));

  // ---------- ตำแหน่งวาง ----------
  const place: PlaceRow[] = doc.parts.map((p) => {
    if (p.placement.kind === 'board') {
      const bb = doc.breadboards.find((b) => b.id === (p.placement as { boardId: string }).boardId);
      const holes = pinHolesFor(p, bb?.model).map((h) => `${h.pin === pinLabel(p, h.pin) ? h.pin : `${h.pin}`} → ${h.hole ?? '?'}`);
      return { ref: p.label, item: `${partName(p)}${partSpec(p) ? ` (${partSpec(p)})` : ''}`, where: `เสียบเบรดบอร์ด${p.placement.rotation ? ` หมุน ${p.placement.rotation}°` : ''}`, pins: holes.join(', ') };
    }
    return { ref: p.label, item: partName(p), where: 'วางบนโต๊ะ ต่อด้วยสาย', pins: '' };
  });

  // ---------- เน็ต ----------
  const nets = c.nets.filter((n) => n.partPins.length > 1).map((n) => ({ name: names[n.index], members: n.partPins.map((pp) => { const q = doc.parts.find((x) => x.id === pp.partId); return q ? `${q.label}.${pp.pin}` : pp.partId; }) }));

  // ---------- ไฟเลี้ยง ----------
  const power: string[] = [];
  for (const p of doc.parts) {
    if (p.kind === 'nano') power.push(`${p.label}: ไฟจาก USB 5 V (Mini-B) หรือ VIN 7–12 V · ขา 5V จ่ายออกจาก USB ผ่านไดโอดกันย้อน (แรงดันต่ำกว่า 5 V เล็กน้อย) · ขา 3V3 ≤ 50 mA (จากชิป USB-serial) · ขา GPIO ≤ 20 mA ที่แนะนำ (สูงสุด 40 mA) รวมทั้งชิป ≤ 200 mA`);
    if (p.kind === 'attiny85') power.push(`${p.label}: ไอซี ATtiny85 รับไฟจากวงจร — ขา 8 VCC 2.7–5.5 V (สูงสุด 6 V), ขา 4 GND · ใส่ตัวเก็บประจุ 100 nF คร่อม VCC–GND ใกล้ชิป · ขา I/O ≤ 40 mA (สูงสุด) รวมขา VCC/GND ≤ 200 mA · ขา 1 (RESET) ปล่อยลอยได้ (มีตัวดึงขึ้นภายใน) หรือต่อ 10 kΩ ขึ้น VCC · ในแอปไม่จำลองกระแสที่ชิปกินเอง`);
    if (p.kind === 'promini') power.push(`${p.label}: รุ่น ${p.params.volt === 3.3 ? '3.3 V / 8 MHz' : '5 V / 16 MHz'} · ไฟจากตัวแปลง USB-serial ที่หัว 6 ขา (VCC) หรือจ่ายเข้า RAW ${p.params.volt === 3.3 ? '3.4–12 V' : '5–12 V'} ผ่านเรกูเลเตอร์บนบอร์ด (≤ 150 mA) · ขา GPIO ≤ 20 mA ที่แนะนำ (สูงสุด 40 mA) รวม ≤ 200 mA${p.params.volt === 3.3 ? ' · ลอจิก 3.3 V: ห้ามต่อสัญญาณ 5 V เข้าขาตรง ๆ' : ''} · ในแอปจำลองเฉพาะไฟจากตัวแปลง ไม่ได้จำลองการจ่ายไฟเข้า RAW`);
    if (p.kind === 'mega') power.push(`${p.label}: ไฟจาก USB 5 V (หรือแจ็ก DC 7–12 V) · ขา 5V จ่ายออกได้ตามแหล่งจ่าย USB (≈ 500 mA รวม, มีฟิวส์คืนตัว) · ขา 3.3V ≤ 150 mA (ตามแบบจำลองเดียวกับ Uno — เอกสาร Arduino ระบุ 50 mA) · ขา GPIO ≤ 20 mA ที่แนะนำ (สูงสุด 40 mA) รวมทั้งชิป ≤ 200 mA`);
    if (p.kind === 'uno') power.push(`${p.label}: ไฟจาก USB 5 V (หรือแจ็ก DC 7–12 V) · ขา 5V จ่ายออกได้ตามแหล่งจ่าย USB (≈ 500 mA รวม) · ขา 3.3V ≤ 150 mA · ขา GPIO ≤ 20 mA ที่แนะนำ (สูงสุด 40 mA) รวมทั้งชิป ≤ 200 mA`);
    if (p.kind === 'unoq') power.push(`${p.label}: ไฟจาก USB-C 5 V (แนะนำแหล่งจ่าย 5 V 3 A) หรือ VIN 7–24 V · ลอจิกขา 3.3 V (A0–A5 และ D3 ทนได้ไม่เกิน 3.6 V, ขาอื่นทน 5 V เฉพาะขาเข้า) · กระแสต่อขา ≤ 20 mA รวมทุกขา ≤ 120 mA · อย่าจ่ายไฟเซอร์โวหลายตัวจากขา 5V ของบอร์ด ให้ใช้อะแดปเตอร์แยกและต่อ GND ร่วม`);
    if (p.kind === 'dcadapter') power.push(`${p.label}: อะแดปเตอร์ ${p.params.voltage} V ${fmtSI(p.params.currentLimit, 'A')} (แจ็ก DC 5.5 × 2.1 mm ขั้วกลางบวก) — ตรวจขั้วด้วยมัลติมิเตอร์ก่อนต่อเข้าวงจร`);
    if (p.kind === 'picow') power.push(`${p.label}: Pico W — ไฟและหัวต่อเหมือน Pico · ในแอปไม่ได้จำลองชิปไร้สาย CYW43439 (กินไฟเพิ่มเมื่อเปิด Wi-Fi บนบอร์ดจริง)`);
    if (isPico(p)) power.push(`${p.label}: ไฟจาก USB 5 V (VBUS) · ขา 3V3 ≤ 300 mA · ขา GPIO 3.3 V ไม่ทน 5 V แนะนำ ≤ 12 mA ต่อขา`);
    if (p.kind === 'esp32devkitc') power.push(`${p.label}: ESP32-DevKitC — ไฟจาก Micro-USB หรือขา 5V หรือขา 3V3 **เลือกทางเดียวเท่านั้น** (คำเตือนใน User Guide) · ขา GPIO 3.3 V ไม่ทน 5 V · กระแสขาแนะนำ ≤ 20 mA (สูงสุด 40 mA ที่ drive สูงสุด) · ESP32 กินไฟสูงสุดหลายร้อย mA ตอนส่ง Wi-Fi — ใช้สาย USB/แหล่งจ่ายที่จ่ายได้ ≥ 500 mA · ในแอปไม่ได้จำลองการกินไฟของ ESP32 และ Wi-Fi`);
    if (p.kind === 'nanoconnect') power.push(`${p.label}: Nano RP2040 Connect — ไฟจาก USB 5 V (ขา VUSB) หรือ VIN 4–20 V · ขา 3.3V ≤ 800 mA รวมไอซีบนบอร์ด · ขา GPIO 3.3 V ไม่ทน 5 V กระแส ≤ 8 mA ต่อขา (datasheet) · A4/A5 มีตัวต้านทานดึงขึ้น 4.7 kΩ บนบอร์ด (บัส I²C ของ IMU) · ในแอปไม่ได้จำลอง NINA-W102 (กินไฟเพิ่มเมื่อเปิด Wi-Fi บนบอร์ดจริง)`);
    if (p.kind === 'xiao') power.push(`${p.label}: XIAO RP2040 — ไฟจาก USB-C 5 V (ขา 5V = VBUS) · ขา 3V3 จ่ายไฟออก (Seeed ไม่ระบุกระแสสูงสุด — ในแอปจำลอง 300 mA เป็นค่าประมาณ) · ขา GPIO 3.3 V ไม่ทน 5 V · ห้ามต่อ USB-C พร้อมแบตเตอรี่ที่แผ่นด้านล่าง (คำเตือนของ Seeed)`);
    if (p.kind === 'rpi5') power.push(`${p.label}: อะแดปเตอร์ USB-C 5 V 5 A (หรือ 5 V 3 A โดยจำกัดกระแส USB) · ขา GPIO 3.3 V ไม่ทน 5 V · ขา 5V บนหัวต่อต่อตรงกับไฟเข้า`);
    if (p.kind === 'dcsupply') power.push(`${p.label}: แหล่งจ่าย DC ${p.params.voltage} V จำกัดกระแส ${fmtSI(p.params.currentLimit, 'A')}`);
  }

  // ---------- รายการตรวจก่อนจ่ายไฟ ----------
  const checklist: CheckItem[] = [
    { level: 'must', text: 'ถอดไฟทุกแหล่ง (USB/อะแดปเตอร์/แบตเตอรี่) ระหว่างต่อหรือแก้วงจร' },
    { level: 'must', text: 'ตรวจสายทีละเส้นตามตาราง "สายจัมเปอร์" และตำแหน่งขาทุกตัวตามตาราง "ตำแหน่งวางอุปกรณ์"' },
  ];
  for (const p of doc.parts) {
    if (p.kind === 'led') checklist.push({ level: 'must', text: `${p.label}: ขายาว (A, ขั้วบวก) และขาสั้น/ด้านแบน (K) ตรงตำแหน่ง · มีตัวต้านทานจำกัดกระแสอนุกรม` });
    if (p.kind === 'resistor') checklist.push({ level: 'check', text: `${p.label}: ค่า ${fmtSI(p.params.resistance, 'Ω')} — วัดด้วยมัลติมิเตอร์หรืออ่านแถบสีก่อนเสียบ` });
    if (p.kind === 'capacitor' && p.params.polarized) checklist.push({ level: 'must', text: `${p.label}: ตัวเก็บประจุมีขั้ว — แถบขั้วลบอยู่ฝั่งแรงดันต่ำ พิกัด ${p.params.ratedVoltage} V ต้องสูงกว่าแรงดันใช้งาน` });
    if (p.kind === 'diode') checklist.push({ level: 'must', text: `${p.label}: ทิศไดโอด (แถบ = แคโทด)` });
    if (['pico', 'rpi5'].includes(p.kind)) checklist.push({ level: 'must', text: `${p.label}: ไม่มีสายจาก 5V/VBUS/VIN เข้าขา GPIO (ขา 3.3 V ไม่ทน 5 V)` });
  }
  // กราวด์ร่วม: บอร์ดและแหล่งจ่ายทุกตัวต้องอยู่เน็ต GND เดียวกัน (ถ้ามีมากกว่าหนึ่งแหล่ง)
  const gndNets = new Set<number>();
  for (const p of doc.parts) {
    const gp = p.kind === 'dcsupply' ? 'neg' : MCU_KINDS.includes(p.kind) ? pinDefs(p).find((d) => d.name.startsWith('GND'))?.name : null;
    if (gp) { const n = c.netOf.get(`${p.id}:${gp}`); if (n !== undefined && netLinked(c, doc, n)) gndNets.add(n); }
  }
  if (gndNets.size > 1) checklist.push({ level: 'must', text: `กราวด์ยังไม่ร่วมกัน: บอร์ด/แหล่งจ่ายอยู่บนกราวด์ ${gndNets.size} เน็ตแยกกัน — ต่อ GND ทุกตัวเข้าด้วยกัน ถ้าทั้งสองฝั่งต้องสื่อสารหรืออ้างอิงแรงดันกัน` });
  for (const d of diagnostics ?? []) if (d.severity === 'danger') checklist.push({ level: 'must', text: `แก้ก่อนจ่ายไฟ (จากการจำลอง): ${d.message}` });
  checklist.push(
    { level: 'check', text: 'ก่อนเสียบบอร์ด: จ่ายไฟให้รางเบรดบอร์ดแล้ววัดแรงดันรางด้วยมัลติมิเตอร์ (ขั้วถูกต้อง ค่าตรงที่ออกแบบ)' },
    { level: 'check', text: 'จ่ายไฟครั้งแรกโดยใช้แหล่งจ่ายที่จำกัดกระแสได้ หรือสังเกตความร้อน/กลิ่นไหม้ในวินาทีแรก — ถอดไฟทันทีถ้าผิดปกติ' },
    { level: 'check', text: 'อัปโหลดโปรแกรม แล้วทดสอบทีละส่วนตามขั้นตอนของแลป เทียบกับผลในแอป' },
  );

  // ---------- ข้อจำกัดที่ยังไม่ได้ตรวจจากการจำลอง ----------
  const limits: ProjectReport['limits'] = [{ item: 'ภาพรวม', text: 'การจำลองผ่านไม่ได้รับรองว่าวงจรจริงปลอดภัยหรือทำงานได้ — แบบจำลองอุปกรณ์เป็นแบบเพื่อการสอน มีค่าคลาดเคลื่อนของอุปกรณ์จริง สายหลวม และสัญญาณรบกวนที่แอปไม่จำลอง' }];
  const seen = new Set<string>();
  for (const p of doc.parts) {
    if (seen.has(p.kind)) continue;
    seen.add(p.kind);
    const s = SUPPORT[p.kind];
    if (s) limits.push({ item: partName(p), text: s.limits });
    const bp = boardProfile(p.kind);
    if (bp) {
      const part = bp.features.filter((f) => f.level === 'partial' || f.level === 'unsupported').map((f) => `${FEATURE_LABELS.find(([id]) => id === f.id)![1]}: ${LEVEL_LABEL[f.level]} — ${f.note}`);
      if (part.length) limits.push({ item: `${partName(p)} — ความสามารถที่จำลองไม่ครบ`, text: part.join(' · ') });
    }
  }
  return { title, date: now.toISOString().slice(0, 10), bom, pins, wires, place, nets, code: codeFiles(doc), power, checklist, limits, diagnostics };
}

/** "<" ที่สร้างตอนรัน (ตัวย่อโค้ดรวม "</body>" กลับเป็นข้อความคงที่ไม่ได้) */
const LT = String.fromCharCode(60);
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const table = (head: string[], rows: string[][]) => `<table><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** CSV (UTF-8 BOM ให้ Excel อ่านภาษาไทยได้) */
export function toCsv(head: string[], rows: Array<Array<string | number>>): string {
  const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/** เอกสารโครงงาน HTML ไฟล์เดียว (แท็ก head/body เขียนแยกในโค้ด — สคริปต์ make-artifact ตัดหน้าเว็บตามแท็ก </body> ตัวแรก)
 * เดิม:  (เปิดในเบราว์เซอร์แล้วพิมพ์เป็น PDF ได้) */
export function reportHtml(r: ProjectReport, images: Array<{ caption: string; src: string }> = []): string {
  const sec = (id: string, h: string, body: string) => `<section id="${id}"><h2>${esc(h)}</h2>${body}</section>`;
  return `<!doctype html><html lang="th">${LT}head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)} — เอกสารโครงงาน</title>
<style>
body{font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;color:#1d2723;max-width:960px;margin:24px auto;padding:0 16px;line-height:1.55;background:#fff}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;border-bottom:2px solid #1f7a3d;padding-bottom:4px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}th,td{border:1px solid #c9d2cc;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef3ef}
pre{background:#f4f6f5;border:1px solid #d5ddd8;padding:10px;font-size:12px;overflow:auto;white-space:pre-wrap}
.note{font-size:13px;color:#4c5a53}.warn{background:#fff6e5;border:1px solid #f0b35a;padding:8px 10px;border-radius:6px;font-size:13px}
ul.check{list-style:none;padding-left:0}ul.check li{margin:4px 0}ul.check li::before{content:"☐ ";font-size:16px}.must{font-weight:600}
img{max-width:100%;border:1px solid #c9d2cc}
@media print{section{break-inside:auto}h2{break-after:avoid}pre{white-space:pre-wrap}}
</style>${LT}/head>${LT}body>
<h1>${esc(r.title)}</h1>
<p class="note">เอกสารโครงงานจาก Circuit Lab 3D · ${esc(r.date)} · ตารางทั้งหมดสร้างจากวงจรในไฟล์งาน (อุปกรณ์ ขา รู และสาย)</p>
<p class="warn">เอกสารนี้ช่วยประกอบวงจรจริง แต่<b>ไม่ได้รับรองความปลอดภัย</b> — ทำตาม "รายการตรวจก่อนจ่ายไฟ" ทุกข้อ และอ่าน "ข้อจำกัดที่ยังไม่ได้ตรวจจากการจำลอง" ท้ายเอกสาร${r.diagnostics ? '' : ' · ยังไม่ได้กด Run ก่อนส่งออก จึงไม่มีคำเตือนจากการจำลองในเอกสารนี้'}</p>
${sec('bom', '1. รายการอุปกรณ์ (BOM)', table(['อุปกรณ์', 'สเปก', 'จำนวน', 'ตำแหน่ง/ชื่อในวงจร', 'หมายเหตุ'], r.bom.map((b) => [b.item, b.spec, String(b.qty), b.refs.join(', '), b.note])))}
${sec('power', '2. แหล่งจ่ายไฟและแรงดัน', r.power.length ? `<ul>${r.power.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="note">ไม่มีบอร์ดหรือแหล่งจ่ายในวงจร</p>')}
${sec('pins', '3. ตารางต่อขาของบอร์ด', r.pins.length ? table(['บอร์ด', 'ขา', 'หน้าที่ของขา', 'เน็ต', 'ต่อกับ'], r.pins.map((p) => [p.board, p.pin, p.label, p.net, p.to.join(', ')])) : '<p class="note">ไม่มีไมโครคอนโทรลเลอร์ในวงจร</p>')}
${sec('place', '4. ตำแหน่งวางอุปกรณ์ (ขา → รูบนเบรดบอร์ด)', table(['ชื่อ', 'อุปกรณ์', 'การวาง', 'ขา → รู'], r.place.map((p) => [p.ref, p.item, p.where, p.pins])))}
${sec('wires', '5. สายจัมเปอร์ (ต่อทีละเส้นตามลำดับ)', table(['#', 'จาก', 'ไป', 'สี', 'ชนิด'], r.wires.map((w) => [String(w.n), w.from, w.to, w.color, w.type])))}
${sec('diagram', '6. ภาพการต่อวงจรและรายการเน็ต', (images.length ? images.map((i) => `<figure><img src="${i.src}" alt="${esc(i.caption)}"><figcaption class="note">${esc(i.caption)}</figcaption></figure>`).join('') : '<p class="note">ไม่มีภาพ (เปิดพื้นที่ 3 มิติไม่ได้ตอนส่งออก)</p>')
  + '<p class="note">ภาพนี้คือเบรดบอร์ดเสมือนในแอป (ไม่ใช่วงจรเชิงสัญลักษณ์) · รายการเน็ตด้านล่างเป็นข้อมูลการเชื่อมต่อที่แน่นอนกว่าภาพ</p>'
  + table(['เน็ต', 'ขาที่ต่อถึงกัน'], r.nets.map((n) => [n.name, n.members.join(', ')])))}
${sec('code', '7. โค้ด ไลบรารี และการอัปโหลดลงบอร์ดจริง', r.code.length ? r.code.map((f) => `<h3>${esc(f.board)} — ${esc(f.language)} (${esc(f.filename)})</h3>
<p><b>ไลบรารี/ไฟล์ที่ต้องมี:</b> ${f.libraries.length ? `</p><ul>${f.libraries.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : 'ไม่มี (ใช้เฉพาะที่มากับบอร์ด)</p>'}
<p><b>ขั้นตอนอัปโหลด/รัน:</b></p><ol>${f.upload.map((u) => `<li>${esc(u)}</li>`).join('')}</ol>
<pre>${esc(f.code)}</pre>`).join('') : '<p class="note">ไม่มีโค้ด</p>')}
${sec('check', '8. รายการตรวจก่อนจ่ายไฟ (Hardware Validation Checklist)', `<ul class="check">${r.checklist.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join('')}</ul>`)}
${sec('sim', '9. คำเตือนจากการจำลองล่าสุด', r.diagnostics ? (r.diagnostics.length ? table(['ระดับ', 'ข้อความ'], r.diagnostics.map((d) => [d.severity === 'danger' ? 'อันตราย' : d.severity === 'warn' ? 'เตือน' : 'ข้อมูล', d.message])) : '<p>ไม่มีคำเตือน (ไม่ได้แปลว่าวงจรจริงปลอดภัย)</p>') : '<p class="note">ยังไม่ได้กด Run ก่อนส่งออก</p>')}
${sec('limits', '10. ข้อจำกัดที่ยังไม่ได้ตรวจจากการจำลอง', table(['หัวข้อ', 'ข้อจำกัด'], r.limits.map((l) => [l.item, l.text])))}
${LT}/body>${LT}/html>`;
}
