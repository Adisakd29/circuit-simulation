import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { ROUND_WATCH_CODE, pinDefs } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { emptyWork, type StudentWork } from '../src/model/types';
import { Cst816s, Gc9a01, Qmi8658, lcdRgba } from '../src/mcu/watch-devices';
import { lcdFrame } from '../src/mcu/spi-bus';
import { lcdText, lcdTextFromImage } from '../src/mcu/lcd-ocr';
import { FONT_BIG } from '../src/mcu/lcd-fonts';
import { rgbaTo565, bytesToB64 } from '../src/ui/image565';
import { Builder, onTable } from './helpers';
import { roundRig } from './round-rig';

type Touch = Array<{ x: number; y: number; down: boolean }>;

function runChecked(b: Builder, seconds: number, dt = 0.25, cmd?: (t: number) => Touch | void) {
  const work: StudentWork = emptyWork(); work.achieved.roundwatch = {};
  const built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '';
  const texts: string[][] = [];
  let maxVib = 0;
  let an!: ReturnType<typeof analyze>;
  let fb: Uint16Array | null = null;
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    const touch = cmd?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(touch ? { touch: { LCD1: touch } } : {}) });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson('roundwatch', { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.roundwatch[g] = true;
    fb = lcdFrame('LCD1', r.result.lcd?.LCD1);
    if (Math.round(t * 4) % 4 === 0) texts.push(lcdText(fb).map((l) => l.text));
    maxVib = Math.max(maxVib, Math.abs(an.parts.M1?.current ?? 0));
  }
  return { st, ach: work.achieved.roundwatch, con, texts, an, maxVib, fb };
}

const swipeLeft: Touch = [{ x: 190, y: 120, down: true }, { x: 120, y: 122, down: true }, { x: 50, y: 124, down: false }];

describe('แบบจำลองอุปกรณ์ของนาฬิกาจอกลม', () => {
  it('GC9A01: คำสั่ง/ข้อมูลตาม DC, หน้าต่าง CASET/RASET, MADCTL 0x48 ภาพตั้งตรง, ไม่ INVON = สีกลับ, หลับ/ปิดจอ = ดำ', () => {
    const d = new Gc9a01();
    d.powerOn(3);
    const cmd = (c: number, ...a: number[]) => { d.command(c); for (const x of a) d.data(x); };
    cmd(0x36, 0x48); cmd(0x3a, 0x55); cmd(0x21); cmd(0x11); cmd(0x29);
    // พิกเซลแดงที่ (10, 20) มุมซ้ายบนของหน้าต่าง 2×1
    cmd(0x2a, 0, 100, 0, 101); cmd(0x2b, 0, 110, 0, 110); cmd(0x2c, 0xf8, 0x00, 0x00, 0x1f);
    const st = { powered: true, on: true, sleep: false, inv: true, madctl: 0x48, bl: 1 };
    const px = lcdRgba(st, d.gram);
    const at = (x: number, y: number) => Array.from(px.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 3));
    expect(at(100, 110)).toEqual([255, 0, 0]);
    expect(at(101, 110)).toEqual([0, 0, 255]);
    // บิต BGR = 0 → แดง/น้ำเงินสลับ · ไม่ส่ง INVON → สีกลับ
    expect(lcdRgba({ ...st, madctl: 0x40 }, d.gram).slice((110 * 240 + 100) * 4, (110 * 240 + 100) * 4 + 3)).toEqual(new Uint8ClampedArray([0, 0, 255]));
    expect(Array.from(lcdRgba({ ...st, inv: false }, d.gram).slice((110 * 240 + 100) * 4, (110 * 240 + 100) * 4 + 3))).toEqual([0, 255, 255]);
    expect(Array.from(lcdRgba({ ...st, sleep: true }, d.gram).slice((110 * 240 + 100) * 4, (110 * 240 + 100) * 4 + 3))).toEqual([6, 6, 6]);
    // นอกวงกลมโปร่งใส
    expect(px[3]).toBe(0);
    // รีเซ็ต: กลับเป็นหลับ ปิดจอ แต่หน่วยความจำภาพไม่ถูกล้าง
    d.reset();
    expect(d.sleep && !d.on).toBe(true);
    expect(d.gram[110 * 240 + (239 - 100)]).toBe(0xf800);
  });

  it('CST816S: ปัดซ้าย/ขวา/ขึ้น/ลง แตะ กดค้าง · พัลส์ INT ต่ำ 1 ms ตาม IrqCtl · พิกัด 12 บิต · ChipID 0xB4', () => {
    let t = 0;
    const c = new Cst816s(() => t);
    const rd = (r: number) => { c.begin(false); c.write(r); c.end(); c.begin(true); const v = c.read(); c.end(); return v; };
    expect(rd(0xa7)).toBe(0xb4);
    const g = (x0: number, y0: number, x1: number, y1: number, hold = 0.2) => {
      c.touch(t, { x: x0, y: y0, down: true }); c.advance(t);
      t += hold; c.touch(t, { x: x1, y: y1, down: false }); c.advance(t);
      return rd(0x01);
    };
    expect(g(200, 120, 40, 120)).toBe(3);
    expect(g(40, 120, 200, 120)).toBe(4);
    expect(g(120, 200, 120, 30)).toBe(1);
    expect(g(120, 30, 120, 200)).toBe(2);
    expect(g(120, 120, 122, 121)).toBe(5);
    expect(g(120, 120, 121, 120, 2)).toBe(0x0c);
    // ระหว่างกด: จำนวนนิ้ว 1 และพิกัด
    t += 0.05; c.touch(t, { x: 230, y: 17, down: true }); c.advance(t);
    expect(rd(0x02)).toBe(1);
    c.begin(false); c.write(0x03); c.end(); c.begin(true);
    const xy = [c.read(), c.read(), c.read(), c.read()]; c.end();
    expect(((xy[0] & 15) << 8) | xy[1]).toBe(230);
    expect(((xy[2] & 15) << 8) | xy[3]).toBe(17);
    // ค่าเริ่ม IrqCtl (EnTouch + EnChange): ต่ำทุกคาบสแกน 10 ms ขณะกด
    expect(c.intLow(t + 0.0005)).toBe(true);
    expect(c.intLow(t + 0.005)).toBe(false);
    expect(c.intLow(t + 0.0105)).toBe(true);
    expect(c.nextEvent(t + 0.005)).toBeCloseTo(t + 0.01, 6);
    t += 0.1; c.touch(t, { x: 230, y: 17, down: false }); c.advance(t);
    // EnMotion อย่างเดียว: พัลส์เฉพาะตอนจำท่าทางได้
    c.begin(false); c.write(0xfa); c.write(0x10); c.end();
    t += 1; c.touch(t, { x: 200, y: 100, down: true }); c.advance(t);
    expect(c.intLow(t + 0.0005)).toBe(false);
    t += 0.2; c.touch(t, { x: 30, y: 100, down: false }); c.advance(t);
    expect(c.intLow(t + 0.0005)).toBe(true);
    expect(c.intLow(t + 0.0012)).toBe(false);
  });

  it('QMI8658: WHO_AM_I 0x05, เซนเซอร์ปิดหลังจ่ายไฟ, ADDR_AI ปิด = อ่านรีจิสเตอร์เดิมซ้ำ, BE เลือกลำดับไบต์, สเกล ±4 g', () => {
    let t = 0;
    const q = new Qmi8658(() => t);
    const rd = (r: number, n: number) => { q.begin(false); q.write(r); q.end(); q.begin(true); const v = Array.from({ length: n }, () => q.read()); q.end(); return v; };
    const wr = (r: number, v: number) => { q.begin(false); q.write(r); q.write(v); q.end(); };
    expect(rd(0x00, 1)).toEqual([0x05]);
    expect(rd(0x39, 2)).toEqual([0, 0]); // ปิดอยู่
    wr(0x03, 0x15); wr(0x08, 0x01);
    // CTRL1 ค่าเริ่ม 0x20: ไม่เลื่อนที่อยู่ + ไบต์สูงก่อน → อ่าน 2 ไบต์จาก AZ_L ได้ไบต์เดียวกันซ้ำ
    const same = rd(0x39, 2);
    expect(same[0]).toBe(same[1]);
    wr(0x02, 0x40);
    const [zl, zh] = rd(0x39, 2);
    const z = ((zh << 8) | zl) << 16 >> 16;
    expect(z / 8192).toBeCloseTo(1, 1);
    wr(0x60, 0xb0);
    expect(rd(0x02, 1)).toEqual([0x20]);
    expect(q.aEn).toBe(false);
    t = 1;
  });

  it('อ่านข้อความบนจอ: อักษร vga1_bold_16x32 ทับรูปพื้นหลังที่มีสีหลากหลาย', () => {
    const img = new Uint16Array(240 * 240);
    for (let i = 0; i < img.length; i++) img[i] = (i * 2654435761) >>> 16; // พื้นสุ่ม
    const bin = atob(FONT_BIG.b64);
    const put = (s: string, x0: number, y0: number, color: number) => {
      [...s].forEach((ch, k) => {
        const base = (ch.charCodeAt(0) - 32) * 64;
        for (let r = 0; r < 32; r++) {
          const bits = (bin.charCodeAt(base + r * 2) << 8) | bin.charCodeAt(base + r * 2 + 1);
          for (let c = 0; c < 16; c++) if (bits & (0x8000 >> c)) img[(y0 + r) * 240 + x0 + k * 16 + c] = color;
        }
      });
    };
    put('12:34:56', 56, 84, 0xffff);
    put('Hi', 100, 150, 0x07e0);
    const lines = lcdTextFromImage(img).map((l) => l.text);
    expect(lines).toContain('12:34:56');
    expect(lines).toContain('Hi');
  });

  it('แปลงรูปเป็น RGB565 (ไบต์สูงก่อน): ขาว/แดงล้วนได้ค่าตรงทุกจุด', () => {
    const w = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    expect(Array.from(rgbaTo565(w, 4, 4).slice(0, 2))).toEqual([0xff, 0xff]);
    const r = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) { r[i * 4] = 255; r[i * 4 + 3] = 255; }
    const o = rgbaTo565(r, 4, 4);
    for (let i = 0; i < 16; i++) expect((o[i * 2] << 8) | o[i * 2 + 1]).toBe(0xf800);
  });
});

describe('แลป 47: นาฬิกาจอกลม Pico + GC9A01 + CST816S + DS3231 + QMI8658', () => {
  it('ขา/คลัง/ระดับการรองรับ · รูปวงจร · โมเดล ESP32-S3 จอกลมเป็นเฉพาะโมเดล', () => {
    const l = LESSONS.find((x) => x.id === 'roundwatch')!;
    expect(l.number).toBe(47);
    expect(l.sampleCode).toBe(ROUND_WATCH_CODE);
    expect(SCHEMATICS.roundwatch).toBeDefined();
    expect(pinDefs({ kind: 'gc9a01' } as never).map((p) => p.name)).toEqual(['VCC', 'GND', 'MISO', 'MOSI', 'SCLK', 'LCD_CS', 'LCD_DC', 'LCD_RST', 'LCD_BL', 'TP_SDA', 'TP_SCL', 'TP_INT', 'TP_RST']);
    expect(supportSummary(SUPPORT.esp32s3lcd).text).toBe('เฉพาะโมเดล');
    expect(supportSummary(SUPPORT.gc9a01).text).toBe('จำลองบางส่วน');
    const b = roundRig({ skip: ['vib', 'rtc', 'imu'] }).part('esp32s3lcd', onTable(-40, 30), 'S3');
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const built = buildNetlist(b.doc);
    expect(built.netlist.lcds?.length).toBe(1);
  });

  it('โค้ดตัวอย่าง: scan พบ 0x15 0x57 0x68 0x6a · รูป bg.bin บนจอ · เวลาตรง RTC · ปัดซ้ายเปลี่ยนหน้า · นับก้าว · สั่น · ผ่านครบ 7 ข้อ', { timeout: 300000 }, () => {
    const b = roundRig({ code: ROUND_WATCH_CODE, motion: 'walk', spm: 120 });
    const r = runChecked(b, 13, 0.25, (t) => (Math.abs(t - 6) < 1e-6 ? swipeLeft : undefined));
    expect(r.con).toContain("I2C: ['0x15', '0x57', '0x68', '0x6a']");
    expect(r.con).not.toContain('Traceback');
    // หน้าปัดก่อนปัด: เวลา + Steps · หลังปัด: หน้าจำนวนก้าว
    expect(r.texts.slice(2, 5).some((t) => t.some((s) => /^09:00:0\d$/.test(s)) && t.some((s) => /^Steps \d+$/.test(s)))).toBe(true);
    expect(r.texts.at(-1)).toContain('STEPS');
    expect(r.maxVib).toBeGreaterThan(0.03);
    for (const g of ['wire', 'bus', 'image', 'clock', 'swipe', 'steps', 'vibrate']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
  });

  it('รูปของผู้ใช้ (bg.bin ที่แอปเขียนลงอิมเมจ LittleFS) แสดงบนจอ — ตัวตรวจเทียบกับรูปนั้น', { timeout: 300000 }, () => {
    // รูปทดสอบ: แถบสีแนวตั้ง 8 สี
    const rgba = new Uint8ClampedArray(240 * 240 * 4);
    const cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 128, 0], [128, 0, 255]];
    for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) { const c = cols[Math.floor(x / 30)]; rgba.set([c[0], c[1], c[2], 255], (y * 240 + x) * 4); }
    const bg = bytesToB64(rgbaTo565(rgba));
    const code = ROUND_WATCH_CODE.split('steps, high, page, GOAL')[0] + 'page, steps = 0, 0\ndraw()\nprint("drawn")\n';
    const r = runChecked(roundRig({ code, bg }), 5);
    expect(r.con).toContain('drawn');
    expect(r.ach.image, r.st.image?.detail).toBe(true);
    // พิกเซลบนจอ (ภาพที่มองเห็น) = สีแถบที่ x = 20 (แดง) และ x = 75 (น้ำเงิน) แถว y = 150 — นอกกรอบตัวเลข
    const px = lcdRgba({ powered: true, on: true, sleep: false, inv: true, madctl: 0x48, bl: 1 }, r.fb!);
    expect(Array.from(px.slice((150 * 240 + 20) * 4, (150 * 240 + 20) * 4 + 3))).toEqual([255, 0, 0]);
    expect(Array.from(px.slice((150 * 240 + 75) * 4, (150 * 240 + 75) * 4 + 3))).toEqual([0, 0, 255]);
  });

  it('ถอดสาย LCD_DC → จอไม่รับข้อมูล + คำเตือน · QMI8658 ต่อ 5 V → อันตราย · ไม่เปิด CTRL7 → คำแนะนำ', { timeout: 300000 }, () => {
    const r = runChecked(roundRig({ code: ROUND_WATCH_CODE, skip: ['dc'] }), 4);
    expect(r.ach.image ?? false).toBe(false);
    expect(r.an.diagnostics.some((d) => d.partId === 'LCD1' && d.message.includes('LCD_DC'))).toBe(true);
    const off = runChecked(roundRig({ code: ROUND_WATCH_CODE.replace('i2c.writeto_mem(IMU, 0x08, b"\\x01")', 'pass'), motion: 'walk' }), 4);
    expect(off.an.diagnostics.some((d) => d.partId === 'IMU1' && d.message.includes('CTRL7'))).toBe(true);
    expect(off.ach.steps ?? false).toBe(false);
  });

  it('SPI ผ่าน DMA (≥ 32 ไบต์) ส่งครบตามเวลาของความถี่ SPI — ไม่ค้าง (rp2040js ส่งเสร็จทันทีทำให้ FIFO รับล้น)', { timeout: 120000 }, () => {
    const code = 'from machine import Pin, SPI\nimport time\nspi = SPI(1, baudrate=10_000_000, sck=Pin(10), mosi=Pin(11), miso=Pin(12))\ncs = Pin(9, Pin.OUT, value=1)\ndc = Pin(8, Pin.OUT, value=1)\nt0 = time.ticks_us()\ncs(0); spi.write(bytes(4096)); cs(1)\nprint("us", time.ticks_diff(time.ticks_us(), t0))\n';
    const b = roundRig({ code, skip: ['vib', 'rtc', 'imu'] });
    const built = buildNetlist(b.doc);
    const e = new SimEngine();
    let con = '', last: ReturnType<typeof e.handle> | null = null;
    for (let k = 0; k < 8; k++) { last = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.25, restart: k === 0, watch: [], budgetMs: 1e9 }); con += last.mcu?.[0].console ?? ''; }
    const us = Number(/us (\d+)/.exec(con)?.[1]);
    // 4096 ไบต์ × 8 บิต ที่ ≈ 10 MHz ≈ 3.3 ms (+ เวลาซอฟต์แวร์)
    expect(us).toBeGreaterThan(3000);
    expect(us).toBeLessThan(6000);
    expect(last!.result.lcd?.LCD1.bytes).toBe(4096);
  });
});
