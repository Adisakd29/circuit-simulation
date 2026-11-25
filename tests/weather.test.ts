import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { WEATHER_CODE } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { setPartParams } from '../src/editor/ops';
import { emptyWork, type StudentWork } from '../src/model/types';
import { Bh1750, Bmp280, Lcd1602, bmp280Compensate, bmp280Raw, charGlyph, charLcdContrast, charLcdGhost, charLcdText, charLcdView } from '../src/mcu/i2c-sensors';
import type { Builder } from './helpers';
import { weatherRig } from './weather-rig';

/** ส่งหนึ่งไบต์คำสั่ง/ข้อมูลแบบ 4 บิตผ่าน PCF8574 (ลำดับเดียวกับ machine_i2c_lcd) */
function send(l: Lcd1602, v: number, rs: boolean, bl = true) {
  for (const n of [v >> 4, v & 15]) {
    const b = (n << 4) | (rs ? 1 : 0) | (bl ? 8 : 0);
    l.write(b | 4); l.write(b);
  }
}
function init4(l: Lcd1602) {
  for (const n of [3, 3, 3, 2]) { l.write((n << 4) | 4); l.write(n << 4); }
  send(l, 0x28, false); send(l, 0x0c, false); send(l, 0x01, false); send(l, 0x06, false);
}
const puts = (l: Lcd1602, s: string) => { for (const ch of s) send(l, ch.charCodeAt(0), true); };

function runChecked(b: Builder, seconds: number, dt = 0.25, cmd?: (t: number, b: Builder) => boolean | void) {
  const work: StudentWork = emptyWork(); work.achieved.weather = {};
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '';
  let an!: ReturnType<typeof analyze>;
  let text: string[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson('weather', { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.weather[g] = true;
    text = charLcdText(r.result.i2c?.LCD1?.lcd);
  }
  return { st, ach: work.achieved.weather, con, an, text };
}

describe('แบบจำลอง PCF8574 + HD44780 / BMP280 / BH1750', () => {
  it('HD44780 ผ่าน PCF8574: เริ่มแบบ 8 บิต 1 บรรทัด จอปิด · ตั้ง 4 บิต · 2 บรรทัด (0x40) · ล้างจอ · เลื่อนจอ · CGRAM · ไฟพื้นหลังที่ P3', () => {
    const l = new Lcd1602();
    expect(l.port).toBe(0xff); // เปิดไฟ PCF8574 ขาสูงทุกขา → ไฟพื้นหลังติด
    expect(l.displayOn || l.lines2 || !l.dl8).toBe(false);
    init4(l);
    expect(l.dl8).toBe(false); expect(l.lines2).toBe(true); expect(l.displayOn).toBe(true);
    puts(l, 'Hello');
    send(l, 0x80 | 0x40, false); puts(l, 'World 25');
    send(l, 0xdf, true); puts(l, 'C');
    expect(charLcdText(charLcdView(l))).toEqual(['Hello           ', 'World 25°C      ']);
    // เลื่อนจอไปทางซ้าย 1 ช่อง (S/C = 1, R/L = 0)
    send(l, 0x18, false);
    expect(charLcdText(charLcdView(l))[0].startsWith('ello')).toBe(true);
    // อักษรกำหนดเองที่ CGRAM 0
    send(l, 0x40, false); for (const r of [0, 10, 31, 31, 14, 4, 0, 0]) send(l, r, true);
    expect(charGlyph(charLcdView(l), 0)[2]).toBe(31);
    // ไฟพื้นหลัง
    l.write(0x00);
    expect(l.backlight).toBe(false);
    send(l, 0x01, false, false);
    expect(charLcdText(charLcdView(l))[0].trim()).toBe('');
    // ฟอนต์ ROM: 'E' แถวบนเต็ม, แถวที่สองจุดซ้ายสุด
    expect(charGlyph(charLcdView(l), 0x45).slice(0, 2)).toEqual([31, 1]);
  });

  it('ความคมชัด: 5 V + ทริมพอต 90% ชัด, 3.3 V แม้หมุนสุดแทบมองไม่เห็น, หมุนสุดที่ 5 V เห็นกล่องจาง', () => {
    expect(charLcdContrast(5, 0.9)).toBeGreaterThan(0.95);
    expect(charLcdContrast(3.3, 1)).toBeLessThan(0.05);
    expect(charLcdGhost(5, 0.9)).toBe(0);
    expect(charLcdGhost(5, 1)).toBeGreaterThan(0.2);
  });

  it('BMP280: chip id 0x58, หลับหลังจ่ายไฟ (0x80000), สูตรชดเชยจากค่าดิบได้ค่าที่ตั้ง, ×1 = 16 บิต, forced แล้วกลับหลับ, reset', () => {
    let now = 0;
    const b = new Bmp280(() => now);
    b.temperature = 31.25; b.pressure = 1001.6;
    const rd = (r: number, n: number) => { b.begin(false); b.write(r); b.end(); b.begin(true); const v = Array.from({ length: n }, () => b.read()); b.end(); return v; };
    const wr = (r: number, v: number) => { b.begin(false); b.write(r); b.write(v); b.end(); };
    expect(rd(0xd0, 1)).toEqual([0x58]);
    expect(rd(0xf7, 6)).toEqual([0x80, 0, 0, 0x80, 0, 0]);
    const { adcT, adcP } = bmp280Raw(31.25, 100160);
    const c = bmp280Compensate(adcT, adcP);
    expect(c.t).toBeCloseTo(31.25, 2);
    expect(c.p / 100).toBeCloseTo(1001.6, 1);
    wr(0xf4, 0x27);
    // เวลาวัด ×1/×1 = 5.5 ms (ดาต้าชีต Table 13): ระหว่างวัด status บิต 3 = 1 และข้อมูลยังเป็นค่าเดิม
    expect(rd(0xf3, 1)[0] & 8).toBe(8);
    now = 0.005; expect(rd(0xf7, 1)[0]).toBe(0x80);
    now = 0.0058; expect(rd(0xf3, 1)[0] & 8).toBe(0); // ช่วงพัก t_standby 0.5 ms (รอบ 6.0 ms)
    const d = rd(0xf7, 6);
    const p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4), t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4);
    expect(p & 15).toBe(0); expect(t & 15).toBe(0); // ×1 = 16 บิต
    const r = bmp280Compensate(t, p);
    expect(Math.abs(r.t - 31.25)).toBeLessThan(0.05);
    expect(Math.abs(r.p / 100 - 1001.6)).toBeLessThan(0.1);
    // ค่าปรับเทียบ dig_T1 อ่านได้ (ไม่มีเครื่องหมาย, ไบต์ต่ำก่อน)
    const cal = rd(0x88, 2);
    expect(cal[0] | (cal[1] << 8)).toBe(27504);
    wr(0xf4, 0x25); // forced
    expect(rd(0xf4, 1)[0] & 3).toBe(1); // ยังวัดอยู่
    now += 0.006;
    expect(rd(0xf4, 1)[0] & 3).toBe(0);
    expect(rd(0xf7, 1)[0]).not.toBe(0x80);
    wr(0xe0, 0xb6);
    expect(rd(0xf4, 1)).toEqual([0]);
  });

  it('BMP280 โหมด normal: รอบวัด = เวลาวัด + t_standby (config t_sb) · ฟิลเตอร์ IIR ×16 ค่าเข้าหาค่าใหม่ทีละขั้น (ค่า = (เดิม·15 + ใหม่)/16)', () => {
    let now = 0;
    const b = new Bmp280(() => now);
    b.pressure = 1000;
    const rd = (r: number, n: number) => { b.begin(false); b.write(r); b.end(); b.begin(true); const v = Array.from({ length: n }, () => b.read()); b.end(); return v; };
    const wr = (r: number, v: number) => { b.begin(false); b.write(r); b.write(v); b.end(); };
    const press = () => { const d = rd(0xf7, 6); const p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4), t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4); return bmp280Compensate(t, p).p / 100; };
    wr(0xf5, (5 << 5) | (4 << 2)); // t_sb 1000 ms, IIR 16
    wr(0xf4, (5 << 5) | (5 << 2) | 3); // ×16/×16 normal → เวลาวัด 1 + 32 + 32.5 = 65.5 ms
    now = 0.066; expect(Math.abs(press() - 1000)).toBeLessThan(0.05); // ค่าแรก = ค่าเริ่มของฟิลเตอร์
    expect(b.measurements).toBe(1);
    b.pressure = 1010;
    now = 0.066 + 1.0655 - 0.002; press(); expect(b.measurements).toBe(1); // ยังไม่ถึงรอบถัดไป
    now = 0.066 + 1.0655 + 0.001; const p1 = press(); expect(b.measurements).toBe(2);
    expect(Math.abs(p1 - (1000 + 10 / 16))).toBeLessThan(0.05);
    now += 10 * 1.0655; const p2 = press(); expect(b.measurements).toBe(12);
    expect(Math.abs(p2 - (1010 - 10 * Math.pow(15 / 16, 11)))).toBeLessThan(0.08);
  });

  it('BH1750: อ่านก่อนวัด = 0 · วัดต่อเนื่อง 1 lx หลัง 120 ms = lux × 1.2 · วัดครั้งเดียวแล้วปิด · ละเอียด 4 lx · MTreg', () => {
    let t = 0;
    const s = new Bh1750(() => t);
    s.lux = 500;
    const rd = () => { s.begin(true); const v = (s.read() << 8) | s.read(); s.end(); return v; };
    const cmd = (c: number) => { s.begin(false); s.write(c); s.end(); };
    expect(rd()).toBe(0);
    cmd(0x10);
    t = 0.1; expect(rd()).toBe(0);
    t = 0.125; expect(rd()).toBe(600);
    s.lux = 100; t = 0.25; expect(rd()).toBe(120);
    cmd(0x20); t = 0.4; expect(rd()).toBe(120); expect(s.on).toBe(false);
    s.lux = 101; cmd(0x13); t = 0.42; expect(rd() % 4).toBe(0);
    cmd(0x47); cmd(0x7e); // MTreg = 254
    expect(s.mt).toBe(254);
  });
  it('BH1750 ความไวของแต่ละตัว (ดาต้าชีต 0.96–1.44 count/lx): 1000 lx → 960 / 1440 count · โค้ดที่หารด้วย 1.2 อ่านได้ 800 / 1200 lx', () => {
    let t = 0;
    const s = new Bh1750(() => t);
    s.lux = 1000;
    const rd = () => { s.begin(true); const v = (s.read() << 8) | s.read(); s.end(); return v; };
    const cmd = (b: number) => { s.begin(false); s.write(b); s.end(); };
    cmd(0x01); cmd(0x10);
    s.sensitivity = 0.96; t = 0.13; expect(rd()).toBe(960); expect(rd() / 1.2).toBe(800);
    s.sensitivity = 1.44; t = 0.26; expect(rd()).toBe(1440); expect(rd() / 1.2).toBe(1200);
  });
});

describe('แลป 48: สถานีตรวจอากาศ (LCD 16×2 I²C + BMP280 + BH1750 บน Pico)', () => {
  it('คลัง/ระดับการรองรับ/รูปวงจร/บันทึกไฟล์', () => {
    const l = LESSONS.find((x) => x.id === 'weather')!;
    expect(l.number).toBe(48);
    expect(l.sampleCode).toBe(WEATHER_CODE);
    expect(SCHEMATICS.weather).toBeDefined();
    for (const k of ['lcd1602', 'bmp280', 'bh1750']) expect(supportSummary(SUPPORT[k]).text, k).toBe('จำลองครบ');
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(weatherRig().doc)), errs, []), errs.join()).not.toBeNull();
  });

  it('โค้ดตัวอย่าง: scan พบ 0x23 0x27 0x76 · จอแสดง T/P/lx ตรงค่าที่ตั้ง · ปรับแสงแล้วค่าเปลี่ยน · ผ่านครบ 7 ข้อ', { timeout: 300000 }, () => {
    const r = runChecked(weatherRig({ temperature: 27.5, pressure: 995.5, lux: 300 }), 5, 0.25, (t, b) => {
      if (Math.abs(t - 3) < 1e-6) { const x = setPartParams(b.doc, 'BH1', { lux: 1000 }); if (x.ok) b.doc = x.doc; return true; }
    });
    expect(r.con).toContain("I2C: ['0x23', '0x27', '0x76']");
    expect(r.text).toEqual(['T 27.5°C  1000lx', 'P   995.5 hPa   ']);
    for (const g of ['wire', 'bus', 'text', 'temp', 'pressure', 'lux', 'update']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('ตัวต้านทานดึงขึ้นบนบอร์ด LCD (5 V) → สาย SDA 5 V อันตราย · LCD ที่ 3.3 V → ตัวอักษรไม่ชัด · ที่อยู่ 0x3F ผิด → OSError · ลืม ctrl_meas → แจ้ง', { timeout: 300000 }, () => {
    const pu = runChecked(weatherRig({ pullUps: true }), 2);
    expect(pu.an.diagnostics.some((d) => d.severity === 'danger' && d.partId === 'LCD1' && d.message.includes('ถอดตัวต้านทานดึงขึ้น'))).toBe(true);
    expect(pu.ach.wire ?? false).toBe(false);
    const lo = runChecked(weatherRig({ lcdVcc: '3V3' }), 2);
    expect(lo.ach.text ?? false).toBe(false);
    expect(lo.an.diagnostics.some((d) => d.partId === 'LCD1' && d.message.includes('ต้องการ ≈ 5 V'))).toBe(true);
    const wrong = runChecked(weatherRig({ addr: 0x3f }), 2);
    expect(wrong.con).toMatch(/OSError/);
    expect(wrong.con).toContain("'0x3f'");
    const sleep = runChecked(weatherRig({ code: WEATHER_CODE.replace('i2c.writeto_mem(BMP, 0xF4, b"\\x27")', 'pass') }), 2.5);
    expect(sleep.an.diagnostics.some((d) => d.partId === 'BMP1' && d.message.includes('โหมดหลับ'))).toBe(true);
    expect(sleep.ach.temp ?? false).toBe(false);
  });
});
