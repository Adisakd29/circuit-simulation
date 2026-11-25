/**
 * ตัวแก้ไขโค้ด: ไฮไลต์ไวยากรณ์ + เติมคำอัตโนมัติ บน <textarea> เดิม (เขียนเอง ไม่มี dependency)
 *
 * เหตุที่ไม่ใช้ Monaco/CodeMirror: ต้องคงพฤติกรรมเดิมของช่องโค้ดทั้งหมด (เลขบรรทัด, แถบบรรทัดที่ผิด, Tab, Ctrl+Enter, การพิมพ์บน iPad/มือถือ
 * ซึ่งใช้ textarea ของระบบ) และหน้าเว็บไฟล์เดียวมีขนาดจำกัด — จึงวางชั้นข้อความที่ระบายสีไว้ "ใต้" textarea ที่ตัวอักษรโปร่งใส
 * รายการเติมคำมีเฉพาะ API ที่ตัวจำลองรองรับจริงของแต่ละบอร์ด (เช่น gpiozero มีเฉพาะคลาสในชุดย่อย) และชื่อที่ประกาศในโค้ดเอง
 */
export type CodeLang = 'cpp' | 'micropython' | 'gpiozero';

const CPP_KW = new Set('void int long short unsigned signed float double char bool byte boolean word const static volatile extern inline if else for while do switch case default break continue return true false struct class enum union public private protected new delete sizeof typedef auto nullptr this template typename namespace using uint8_t uint16_t uint32_t int8_t int16_t int32_t size_t String'.split(' '));
const PY_KW = new Set('def class if elif else for while in not and or is None True False return import from as with try except finally raise pass break continue lambda global nonlocal yield async await del assert'.split(' '));
const PY_BUILTIN = new Set('print range len int float str bool list dict tuple set abs min max round sum enumerate zip sorted reversed isinstance type open input hex bin ord chr super object Exception KeyboardInterrupt ValueError OSError RuntimeError TypeError'.split(' '));

export interface Suggestion { label: string; insert?: string; detail: string }
const S = (label: string, detail: string, insert?: string): Suggestion => ({ label, detail, ...(insert ? { insert } : {}) });

/** API ของ Arduino Uno ที่บริการคอมไพล์ + ตัวจำลองรองรับ (ดูตารางความสามารถของบอร์ด) */
const ARDUINO: Suggestion[] = [
  S('pinMode', 'pinMode(pin, OUTPUT | INPUT | INPUT_PULLUP)', 'pinMode('), S('digitalWrite', 'digitalWrite(pin, HIGH | LOW)', 'digitalWrite('), S('digitalRead', 'digitalRead(pin) → HIGH/LOW', 'digitalRead('),
  S('analogRead', 'analogRead(A0–A5) → 0–1023', 'analogRead('), S('analogWrite', 'analogWrite(~3 ~5 ~6 ~9 ~10 ~11, 0–255) PWM', 'analogWrite('),
  S('delay', 'delay(ms)', 'delay('), S('delayMicroseconds', 'delayMicroseconds(us)', 'delayMicroseconds('), S('millis', 'millis() → ms ตั้งแต่เริ่ม', 'millis()'), S('micros', 'micros() → µs', 'micros()'),
  S('attachInterrupt', 'attachInterrupt(digitalPinToInterrupt(2 | 3), isr, RISING | FALLING | CHANGE)', 'attachInterrupt('), S('digitalPinToInterrupt', 'digitalPinToInterrupt(2 | 3)', 'digitalPinToInterrupt('),
  S('detachInterrupt', 'detachInterrupt(n)', 'detachInterrupt('), S('noInterrupts', 'ปิด interrupt ชั่วคราว', 'noInterrupts();'), S('interrupts', 'เปิด interrupt', 'interrupts();'),
  S('tone', 'tone(pin, Hz) / tone(pin, Hz, ms)', 'tone('), S('noTone', 'noTone(pin)', 'noTone('), S('pulseIn', 'pulseIn(pin, HIGH, timeout) → µs', 'pulseIn('),
  S('map', 'map(x, inLo, inHi, outLo, outHi)', 'map('), S('constrain', 'constrain(x, lo, hi)', 'constrain('), S('random', 'random(max) / random(min, max)', 'random('), S('randomSeed', 'randomSeed(n)', 'randomSeed('),
  S('HIGH', 'ระดับสูง'), S('LOW', 'ระดับต่ำ'), S('INPUT', 'ขาเข้า (ลอย)'), S('OUTPUT', 'ขาออก'), S('INPUT_PULLUP', 'ขาเข้า + pull-up ภายใน'), S('RISING', 'ขอบขึ้น'), S('FALLING', 'ขอบลง'), S('CHANGE', 'ทุกขอบ'), S('LED_BUILTIN', 'D13'),
  ...['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((a) => S(a, 'ขาแอนะล็อก')), S('A6', 'ขาแอนะล็อกอย่างเดียว (Nano)'), S('A7', 'ขาแอนะล็อกอย่างเดียว (Nano)'),
  S('Serial.begin', 'Serial.begin(9600)', 'Serial.begin('), S('Serial.print', 'Serial.print(x)', 'Serial.print('), S('Serial.println', 'Serial.println(x)', 'Serial.println('),
  S('Serial.available', 'จำนวนไบต์ที่รอ', 'Serial.available()'), S('Serial.read', 'อ่านหนึ่งไบต์ (−1 = ไม่มี)', 'Serial.read()'), S('Serial.write', 'Serial.write(byte)', 'Serial.write('), S('Serial.parseInt', 'อ่านตัวเลข', 'Serial.parseInt()'),
  S('Wire.begin', 'เริ่ม I²C (A4 = SDA, A5 = SCL)', 'Wire.begin();'), S('Wire.beginTransmission', 'Wire.beginTransmission(addr)', 'Wire.beginTransmission('), S('Wire.write', 'Wire.write(byte)', 'Wire.write('),
  S('Wire.endTransmission', 'ส่ง → 0 = สำเร็จ, 2 = ไม่มีอุปกรณ์ตอบ', 'Wire.endTransmission()'), S('Wire.requestFrom', 'Wire.requestFrom(addr, n)', 'Wire.requestFrom('), S('Wire.read', 'อ่านหนึ่งไบต์', 'Wire.read()'), S('Wire.available', 'ไบต์ที่รอ', 'Wire.available()'),
  S('EEPROM.read', 'EEPROM.read(addr) (บันทึกลงไฟล์งาน)', 'EEPROM.read('), S('EEPROM.write', 'EEPROM.write(addr, v)', 'EEPROM.write('), S('EEPROM.update', 'เขียนเฉพาะเมื่อค่าต่าง', 'EEPROM.update('), S('EEPROM.get', 'EEPROM.get(addr, var)', 'EEPROM.get('), S('EEPROM.put', 'EEPROM.put(addr, var)', 'EEPROM.put('),
  S('SPI.begin', 'เริ่ม SPI (บางส่วน: อ่านได้แค่ระดับขา MISO)', 'SPI.begin();'), S('SPI.transfer', 'SPI.transfer(byte)', 'SPI.transfer('),
  S('Servo', 'Servo s; s.attach(9); s.write(90);'), S('attach', 'servo.attach(pin)', 'attach('), S('write', 'servo.write(0–180)', 'write('), S('detach', 'servo.detach()', 'detach()'),
  S('wdt_enable', 'wdt_enable(WDTO_1S) — #include <avr/wdt.h>', 'wdt_enable('), S('wdt_reset', 'เลี้ยง watchdog', 'wdt_reset();'), S('wdt_disable', 'ปิด watchdog', 'wdt_disable();'),
  S('LiquidCrystal', 'LiquidCrystal lcd(rs, e, d4, d5, d6, d7); — จอ LCD แบบขนาน', 'LiquidCrystal lcd('), S('lcd.begin', 'lcd.begin(16, 2)', 'lcd.begin(16, 2);'), S('lcd.print', 'lcd.print(x)', 'lcd.print('),
  S('lcd.setCursor', 'lcd.setCursor(คอลัมน์, แถว)', 'lcd.setCursor('), S('lcd.clear', 'ล้างจอ (ใช้เวลา ≈ 2 ms)', 'lcd.clear();'), S('lcd.createChar', 'lcd.createChar(0–7, byte[8])', 'lcd.createChar('),
  S('lcd.cursor', 'แสดงเคอร์เซอร์ขีดล่าง', 'lcd.cursor();'), S('lcd.blink', 'เคอร์เซอร์กะพริบ', 'lcd.blink();'), S('lcd.scrollDisplayLeft', 'เลื่อนทั้งจอไปซ้าย', 'lcd.scrollDisplayLeft();'),
  S('#include <LiquidCrystal.h>', 'จอ LCD แบบขนาน (HD44780)', '#include <LiquidCrystal.h>'),
  S('#include <Wire.h>', 'I²C', '#include <Wire.h>'), S('#include <EEPROM.h>', 'EEPROM', '#include <EEPROM.h>'), S('#include <Servo.h>', 'เซอร์โว', '#include <Servo.h>'), S('#include <SPI.h>', 'SPI', '#include <SPI.h>'),
  S('setup', 'void setup() { … } รันครั้งเดียว', 'setup'), S('loop', 'void loop() { … } รันวนซ้ำ', 'loop'),
];

/** MicroPython บน Pico (ตัวจำลองรันเฟิร์มแวร์จริง — รายการนี้เป็นส่วนที่ต่อกับวงจรในแอปแล้ว) */
const MPY: Suggestion[] = [
  S('from machine import Pin', 'นำเข้า Pin', 'from machine import Pin'), S('import machine', 'โมดูล machine'), S('import time', 'โมดูล time'),
  S('Pin', 'Pin(n, Pin.OUT | Pin.IN, Pin.PULL_UP | Pin.PULL_DOWN)', 'Pin('), S('Pin.OUT', 'ขาออก'), S('Pin.IN', 'ขาเข้า'), S('Pin.PULL_UP', 'pull-up ภายใน'), S('Pin.PULL_DOWN', 'pull-down ภายใน'),
  S('Pin.IRQ_FALLING', 'ขอบลง'), S('Pin.IRQ_RISING', 'ขอบขึ้น'),
  S('value', 'pin.value() อ่าน / pin.value(1) เขียน', 'value('), S('on', 'pin.on()', 'on()'), S('off', 'pin.off()', 'off()'), S('toggle', 'pin.toggle()', 'toggle()'), S('irq', 'pin.irq(trigger=Pin.IRQ_FALLING, handler=f)', 'irq('),
  S('machine.PWM', 'PWM(Pin(n))', 'machine.PWM('), S('PWM', 'PWM(Pin(n))', 'PWM('), S('freq', 'pwm.freq(Hz)', 'freq('), S('duty_u16', 'pwm.duty_u16(0–65535)', 'duty_u16('),
  S('machine.ADC', 'ADC(26 | 27 | 28)', 'machine.ADC('), S('ADC', 'ADC(26 | 27 | 28)', 'ADC('), S('read_u16', 'adc.read_u16() → 0–65535', 'read_u16()'),
  S('machine.I2C', 'I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)', 'machine.I2C('), S('I2C', 'I2C(0, sda=Pin(4), scl=Pin(5))', 'I2C('), S('SoftI2C', 'SoftI2C(sda=Pin(n), scl=Pin(n))', 'SoftI2C('),
  S('scan', 'i2c.scan() → รายการที่อยู่', 'scan()'), S('writeto', 'i2c.writeto(addr, bytes)', 'writeto('), S('readfrom', 'i2c.readfrom(addr, n)', 'readfrom('), S('readfrom_mem', 'i2c.readfrom_mem(addr, reg, n)', 'readfrom_mem('), S('writeto_mem', 'i2c.writeto_mem(addr, reg, bytes)', 'writeto_mem('),
  S('machine.SPI', 'SPI(1, baudrate=…, sck=Pin(10), mosi=Pin(11))', 'machine.SPI('),
  S('machine.Timer', 'Timer(); t.init(freq=10, callback=f)', 'machine.Timer('), S('Timer', 'Timer()', 'Timer('), S('init', 't.init(freq=…, callback=…)', 'init('), S('deinit', 'หยุด timer', 'deinit()'),
  S('machine.WDT', 'WDT(timeout=ms) — ต้อง feed()', 'machine.WDT('), S('feed', 'wdt.feed()', 'feed()'), S('machine.reset', 'รีเซ็ตบอร์ด', 'machine.reset()'),
  S('time.sleep', 'time.sleep(s)', 'time.sleep('), S('time.sleep_ms', 'time.sleep_ms(ms)', 'time.sleep_ms('), S('time.ticks_ms', 'ms ตั้งแต่บูต', 'time.ticks_ms()'), S('time.ticks_diff', 'time.ticks_diff(a, b)', 'time.ticks_diff('),
  S('import dht', 'DHT11/DHT22'), S('dht.DHT22', 'dht.DHT22(Pin(n))', 'dht.DHT22('), S('dht.DHT11', 'dht.DHT11(Pin(n))', 'dht.DHT11('), S('measure', 'sensor.measure()', 'measure()'), S('temperature', 'sensor.temperature()', 'temperature()'), S('humidity', 'sensor.humidity()', 'humidity()'),
  S('import ssd1306', 'จอ OLED (ไฟล์อยู่ในบอร์ดแล้ว)'), S('ssd1306.SSD1306_I2C', 'SSD1306_I2C(128, 64, i2c)', 'ssd1306.SSD1306_I2C('), S('text', 'oled.text("Hi", x, y)', 'text('), S('show', 'oled.show()', 'show()'), S('fill', 'oled.fill(0)', 'fill('),
];

/** gpiozero ชุดย่อยของ Raspberry Pi 5 ในแอป — เฉพาะคลาส/เมธอดที่มีจริง (src/mcu/pi/gpiozero.py) */
const GPIOZERO: Suggestion[] = [
  S('from gpiozero import LED', 'นำเข้า LED', 'from gpiozero import LED'), S('from gpiozero import Button', 'นำเข้า Button', 'from gpiozero import Button'), S('from signal import pause', 'pause() รอเหตุการณ์', 'from signal import pause'), S('from time import sleep', 'sleep(s)', 'from time import sleep'),
  S('LED', 'LED(gpio, active_high=True, initial_value=False)', 'LED('), S('PWMLED', 'PWMLED(gpio, frequency=100)', 'PWMLED('), S('Buzzer', 'Buzzer(gpio)', 'Buzzer('), S('RGBLED', 'RGBLED(red, green, blue)', 'RGBLED('),
  S('Servo', 'Servo(gpio)', 'Servo('), S('AngularServo', 'AngularServo(gpio, min_angle=-90, max_angle=90)', 'AngularServo('), S('Button', 'Button(gpio, pull_up=True, bounce_time=None, hold_time=1)', 'Button('),
  S('DigitalInputDevice', 'DigitalInputDevice(gpio, pull_up=False)', 'DigitalInputDevice('), S('DigitalOutputDevice', 'DigitalOutputDevice(gpio)', 'DigitalOutputDevice('), S('PWMOutputDevice', 'PWMOutputDevice(gpio)', 'PWMOutputDevice('),
  S('InputDevice', 'InputDevice(gpio, pull_up=False)', 'InputDevice('), S('MotionSensor', 'MotionSensor(gpio)', 'MotionSensor('), S('LineSensor', 'LineSensor(gpio)', 'LineSensor('),
  S('on', 'device.on()', 'on()'), S('off', 'device.off()', 'off()'), S('toggle', 'device.toggle()', 'toggle()'), S('blink', 'blink(on_time=1, off_time=1, n=None, background=True)', 'blink('), S('pulse', 'pulse(fade_in_time=1, fade_out_time=1)', 'pulse('),
  S('value', 'ค่า 0–1', 'value'), S('is_lit', 'LED ติดอยู่', 'is_lit'), S('is_pressed', 'ปุ่มถูกกดอยู่', 'is_pressed'), S('is_held', 'กดค้างเกิน hold_time', 'is_held'), S('motion_detected', 'มีการเคลื่อนไหว', 'motion_detected'),
  S('when_pressed', 'callback เมื่อกด', 'when_pressed = '), S('when_released', 'callback เมื่อปล่อย', 'when_released = '), S('when_held', 'callback เมื่อกดค้าง', 'when_held = '),
  S('when_motion', 'callback เมื่อตรวจพบ', 'when_motion = '), S('when_no_motion', 'callback เมื่อหยุดเคลื่อนไหว', 'when_no_motion = '), S('when_activated', 'callback', 'when_activated = '), S('when_deactivated', 'callback', 'when_deactivated = '),
  S('wait_for_press', 'wait_for_press(timeout=None)', 'wait_for_press('), S('wait_for_release', 'wait_for_release(timeout=None)', 'wait_for_release('), S('source', 'led.source = button', 'source = '),
  S('angle', 'servo.angle = องศา', 'angle'), S('color', 'rgb.color = (r, g, b)', 'color'), S('close', 'ปล่อยขา', 'close()'),
  S('sleep', 'sleep(s) — เวลาจำลอง', 'sleep('), S('pause', 'pause() — รอ callback', 'pause()'),
];

export function suggestionsFor(lang: CodeLang): Suggestion[] { return lang === 'cpp' ? ARDUINO : lang === 'micropython' ? MPY : GPIOZERO; }

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const span = (cls: string, s: string) => `<span class="hl-${cls}">${esc(s)}</span>`;

/** ระบายสีโค้ดเป็น HTML (ข้อความเดิมทุกตัวอักษร — จำนวนบรรทัดและคอลัมน์ตรงกับ textarea) */
export function highlight(code: string, lang: CodeLang): string {
  const py = lang !== 'cpp';
  const api = new Set(suggestionsFor(lang).map((s) => s.label.split('.').pop()!).filter((x) => /^\w+$/.test(x)));
  let out = '', i = 0;
  const n = code.length;
  const re = py
    ? /(#[^\n]*)|([rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@\w+)|(\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?)\b)|([A-Za-z_]\w*)|([\s\S])/y
    : /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b(?:0[xXbB][\da-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[uUlLfF]*\b)|([A-Za-z_]\w*)|([\s\S])/my;
  while (i < n) {
    re.lastIndex = i;
    const m = re.exec(code);
    if (!m || m[0].length === 0) { out += esc(code[i]); i++; continue; }
    const t = m[0];
    if (m[1]) out += span('com', t);
    else if (m[2]) out += span('str', t);
    else if (m[3]) out += span(py ? 'dec' : 'pre', t);
    else if (m[4]) out += span('num', t);
    else if (m[5]) {
      const kw = py ? PY_KW.has(t) : CPP_KW.has(t);
      if (kw) out += span('kw', t);
      else if (py && PY_BUILTIN.has(t)) out += span('bi', t);
      else if (api.has(t)) out += span(/^[A-Z][A-Z0-9_]+$/.test(t) ? 'const' : 'api', t);
      else out += esc(t);
    } else out += esc(t);
    i += t.length;
  }
  return out;
}

/** คำที่ประกาศในโค้ดเอง (ตัวแปร ฟังก์ชัน) สำหรับเติมคำ */
function ownWords(code: string, lang: CodeLang): string[] {
  const set = new Set<string>();
  const kws = lang === 'cpp' ? CPP_KW : PY_KW;
  for (const m of code.matchAll(/[A-Za-z_]\w{2,}/g)) if (!kws.has(m[0])) set.add(m[0]);
  return [...set];
}

/** คำก่อนเคอร์เซอร์ (รวมจุด เช่น "Serial.pr", "machine.P") */
export function wordBefore(code: string, pos: number): string {
  const m = /[#A-Za-z_][\w.]*$/.exec(code.slice(Math.max(0, pos - 60), pos));
  return m ? m[0] : '';
}

/** รายการเติมคำสำหรับคำที่พิมพ์อยู่ (ขึ้นต้นตรงกันก่อน แล้วจึงคำที่มีส่วนท้ายหลังจุดตรงกัน) */
export function complete(code: string, pos: number, lang: CodeLang, max = 8): Array<Suggestion & { replace: number }> {
  const w = wordBefore(code, pos);
  if (w.length < 2 && !w.endsWith('.')) return [];
  const tail = w.includes('.') ? w.slice(w.lastIndexOf('.') + 1) : w;
  const lw = w.toLowerCase(), lt = tail.toLowerCase();
  const out: Array<Suggestion & { replace: number }> = [];
  const seen = new Set<string>();
  const add = (s: Suggestion, replace: number) => { if (!seen.has(s.label) && out.length < max) { seen.add(s.label); out.push({ ...s, replace }); } };
  const all = suggestionsFor(lang);
  for (const s of all) if (s.label.toLowerCase().startsWith(lw) && s.label !== w) add(s, w.length);
  if (w.includes('.')) for (const s of all) if (!s.label.includes('.') && s.label.toLowerCase().startsWith(lt) && s.label !== tail && /^\w/.test(s.label)) add(s, tail.length);
  for (const word of ownWords(code, lang)) if (word.toLowerCase().startsWith(lt) && word !== tail && lt.length >= 2 && !out.some((o) => o.label.endsWith(`.${word}`) || o.label === word)) add({ label: word, detail: 'ชื่อในโค้ดนี้' }, tail.length);
  return out;
}

const LINE_H = 19, PAD = 8, BORDER = 1;
let measureCtx: CanvasRenderingContext2D | null = null;
function charWidth(ta: HTMLTextAreaElement): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 7.8;
  const cs = getComputedStyle(ta);
  measureCtx.font = `${cs.fontSize} ${cs.fontFamily}`;
  return measureCtx.measureText('0000000000').width / 10;
}

/**
 * เพิ่มไฮไลต์ + เติมคำให้ textarea (ต้องอยู่ใน .pc-edw — ถ้าไม่ใช่ จะห่อให้)
 * ทำงานกับการพิมพ์ทุกแบบ (คีย์บอร์ด, IME, iPad) เพราะผู้ใช้ยังพิมพ์ใน textarea จริง
 */
export function enhanceEditor(ta: HTMLTextAreaElement, lang: CodeLang): void {
  if (ta.dataset.enhanced) return;
  ta.dataset.enhanced = '1';
  let wrap = ta.parentElement!;
  if (!wrap.classList.contains('pc-edw')) {
    const w = document.createElement('div');
    w.className = 'pc-edw pc-edw-solo';
    wrap.insertBefore(w, ta);
    w.appendChild(ta);
    wrap = w;
  }
  ta.classList.add('hl-input');
  const pre = document.createElement('pre');
  pre.className = 'pc-hl';
  pre.setAttribute('aria-hidden', 'true');
  wrap.insertBefore(pre, wrap.firstChild);
  const paint = () => { pre.innerHTML = highlight(ta.value, lang) + '\n '; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  // ค่าที่โค้ดตั้งตรง (เช่น ใส่โค้ดตัวอย่าง) ไม่มี input event — ตรวจเป็นระยะแบบเบา ๆ ขณะช่องยังอยู่ในหน้า
  let last = '';
  const tick = () => { if (!ta.isConnected) { pop.remove(); return; } if (ta.value !== last) { last = ta.value; paint(); } setTimeout(tick, 400); };
  queueMicrotask(paint);

  // ---------- เติมคำ ----------
  const pop = document.createElement('div');
  pop.className = 'ac-pop';
  pop.setAttribute('role', 'listbox');
  pop.id = `${ta.id || 'code'}-ac`;
  pop.hidden = true;
  document.body.appendChild(pop);
  setTimeout(tick, 400);
  let items: Array<Suggestion & { replace: number }> = [];
  let sel = 0;
  const close = () => { pop.hidden = true; items = []; };
  const accept = (k: number) => {
    const it = items[k];
    if (!it) return;
    const pos = ta.selectionStart;
    const ins = it.insert ?? it.label;
    ta.setRangeText(ins, pos - it.replace, pos, 'end');
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  };
  const render = () => {
    pop.replaceChildren(...items.map((it, k) => {
      const d = document.createElement('div');
      d.className = `ac-item${k === sel ? ' sel' : ''}`;
      d.setAttribute('role', 'option');
      d.dataset.label = it.label;
      const a = document.createElement('span'); a.className = 'ac-l'; a.textContent = it.label;
      const b = document.createElement('span'); b.className = 'ac-d'; b.textContent = it.detail;
      d.append(a, b);
      // pointerdown: กดแล้วเลือกทันทีโดยไม่ทำให้ textarea เสียโฟกัส (นิ้ว/ปากกา/เมาส์)
      d.addEventListener('pointerdown', (e) => { e.preventDefault(); accept(k); });
      return d;
    }));
  };
  const open = () => {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) { close(); return; }
    items = complete(ta.value, pos, lang);
    if (!items.length) { close(); return; }
    sel = 0;
    render();
    place();
  };
  /** วางกล่องเติมคำใต้เคอร์เซอร์ (เรียกซ้ำเมื่อช่องโค้ดเลื่อน — การพิมพ์ท้ายบรรทัดยาวทำให้ textarea เลื่อนเอง) */
  const place = () => {
    if (pop.hidden && !items.length) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).split('\n');
    const line = before.length - 1;
    const col = before[line].replace(/\t/g, '    ').length;
    const r = ta.getBoundingClientRect();
    const x = r.left + BORDER + PAD + col * charWidth(ta) - ta.scrollLeft;
    const y = r.top + BORDER + PAD + (line + 1) * LINE_H - ta.scrollTop;
    pop.hidden = false;
    const w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x))}px`;
    pop.style.top = `${y + hh > window.innerHeight - 4 ? Math.max(4, y - LINE_H - hh) : y}px`;
  };
  ta.addEventListener('input', (e) => { if ((e as InputEvent).inputType?.startsWith('insert') && (e as InputEvent).inputType !== 'insertLineBreak') open(); else close(); });
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === ' ') { e.preventDefault(); open(); return; }
    if (pop.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(); }
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); accept(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('scroll', () => { if (!pop.hidden) place(); });
}
