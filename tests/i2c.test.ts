import { describe, expect, it } from 'vitest';
import { At24c32, Ds3231, FONT8, Mpu6050, Ssd1306, formatClock, oledPixels, oledText, parseClock, trueSteps } from '../src/mcu/i2c-devices';
import { I2cHub, type I2cSpec } from '../src/mcu/i2c-bus';

/** ธุรกรรมเขียนหนึ่งครั้ง: begin → ไบต์ → end */
const wr = (t: { begin(r: boolean): void; write(b: number): boolean; end(): void }, bytes: number[]) => { t.begin(false); const acks = bytes.map((b) => t.write(b)); t.end(); return acks; };
const rd = (t: { begin(r: boolean): void; read(): number; end(): void }, n: number) => { t.begin(true); const out = Array.from({ length: n }, () => t.read()); t.end(); return out; };

describe('SSD1306 (ดาต้าชีต Solomon Systech)', () => {
  const init = [0xae, 0x20, 0x00, 0x40, 0xa1, 0xa8, 0x3f, 0xc8, 0xd3, 0x00, 0xda, 0x12, 0xd5, 0x80, 0xd9, 0xf1, 0xdb, 0x30, 0x81, 0xff, 0xa4, 0xa6, 0x8d, 0x14, 0xaf];
  it('ไบต์ควบคุม Co/D·C: คำสั่งทีละตัว (0x80) และอาร์กิวเมนต์ข้ามธุรกรรม เหมือนไดรเวอร์ ssd1306.py', () => {
    const o = new Ssd1306();
    for (const c of init) wr(o, [0x80, c]);
    expect(o.s).toMatchObject({ on: true, pump: true, contrast: 0xff, segRemap: true, comRev: true, mux: 63, invert: false });
    // จอดับถ้าไม่เปิดปั๊มประจุ
    const o2 = new Ssd1306();
    for (const c of init.filter((c, i) => !(c === 0x8d || init[i - 1] === 0x8d))) wr(o2, [0x80, c]);
    o2.s.ram.fill(0xff);
    expect(oledPixels(o2.s).some((v) => v)).toBe(false);
  });
  it('โหมดที่อยู่แนวนอน: 0x21/0x22 + ข้อมูล 0x40 เขียนต่อเนื่องห่อบรรทัด · โหมดหน้า (ค่าเริ่มต้น) ใช้ 0xB0–0xB7 + คอลัมน์', () => {
    const o = new Ssd1306();
    wr(o, [0x00, 0x20, 0x00, 0x21, 126, 127, 0x22, 2, 3]);
    wr(o, [0x40, 1, 2, 3, 4, 5]);
    expect([o.s.ram[2 * 128 + 126], o.s.ram[2 * 128 + 127], o.s.ram[3 * 128 + 126], o.s.ram[3 * 128 + 127], o.s.ram[2 * 128 + 126 - 0]]).toEqual([5, 2, 3, 4, 5]);
    const p = new Ssd1306();
    wr(p, [0x00, 0xb5, 0x03, 0x11]); // หน้า 5 คอลัมน์ 0x13
    wr(p, [0x40, 0xaa]);
    expect(p.s.ram[5 * 128 + 0x13]).toBe(0xaa);
    expect(p.read()).toBe(0xff); // I²C ของ SSD1306 อ่านข้อมูลไม่ได้
  });
  it('พิกเซล: A1 + C8 = ภาพตรง, A0 กลับซ้ายขวา, C0 กลับบนล่าง, กลับสี, 0xA5 ติดทั้งจอ', () => {
    const o = new Ssd1306();
    Object.assign(o.s, { on: true, pump: true, segRemap: true, comRev: true });
    o.s.ram[0] = 0x01; // คอลัมน์ 0 แถว 0
    expect(oledPixels(o.s)[0]).toBe(1);
    expect(oledPixels({ ...o.s, segRemap: false })[127]).toBe(1);
    expect(oledPixels({ ...o.s, comRev: false })[63 * 128]).toBe(1);
    expect(oledPixels({ ...o.s, invert: true })[0]).toBe(0);
    expect(oledPixels({ ...o.s, allOn: true }).every((v) => v === 1)).toBe(true);
  });
  it('อ่านข้อความจากพิกเซลด้วยฟอนต์ 8×8 ของ framebuf (เหมือน oled.text)', () => {
    expect(FONT8.length).toBe(96 * 8);
    const px = new Uint8Array(128 * 64);
    const draw = (s: string, x: number, y: number) => [...s].forEach((ch, k) => {
      for (let j = 0; j < 8; j++) { const col = FONT8[(ch.charCodeAt(0) - 32) * 8 + j]; for (let b = 0; b < 8; b++) if ((col >> b) & 1) px[(y + b) * 128 + x + k * 8 + j] = 1; }
    });
    draw('09:41:07', 32, 16); draw('Steps 128', 24, 40); draw('Temp 25 C', 5, 3);
    expect(oledText(px).map((l) => l.text)).toEqual(['Temp 25 C', '09:41:07', 'Steps 128']);
  });
});

describe('DS3231 + AT24C32 (ดาต้าชีต Analog Devices/Maxim)', () => {
  it('เวลาแบบ BCD เดินตามเวลาจำลอง · ตัวชี้รีจิสเตอร์เพิ่มเอง · อุณหภูมิ 0x11–0x12 ละเอียด 0.25 °C', () => {
    let t = 0;
    const r = new Ds3231(() => t, parseClock('2026-10-26 23:59:58'));
    wr(r, [0x00]);
    expect(rd(r, 7)).toEqual([0x58, 0x59, 0x23, expect.any(Number), 0x26, 0x10, 0x26]);
    t = 3.2;
    wr(r, [0x00]);
    expect(rd(r, 7).filter((_, i) => i !== 3)).toEqual([0x01, 0x00, 0x00, 0x27, 0x10, 0x26]);
    // อุณหภูมิในรีจิสเตอร์อัปเดตเมื่อแปลงเสร็จ (อัตโนมัติทุก 64 s หรือสั่ง CONV — tCONV 200 ms)
    r.temperature = -3.25;
    wr(r, [0x11]);
    let [msb, lsb] = rd(r, 2);
    expect(((msb << 24) >> 24) + (lsb >> 6) / 4).toBeCloseTo(25, 5);
    wr(r, [0x0e, 0x3c]); // CONV
    t = 3.45;
    wr(r, [0x11]);
    [msb, lsb] = rd(r, 2);
    expect(((msb << 24) >> 24) + (lsb >> 6) / 4).toBeCloseTo(-3.25, 5);
    wr(r, [0x12]); rd(r, 1);
    expect(rd(r, 1)).toEqual([0x01]); // ห่อจาก 0x12 กลับ 0x00 (วินาที ณ t = 3.45 s)
  });
  it('เขียนเวลา (เช่น ตั้งนาฬิกาจากโค้ด) แล้วเดินต่อ · โหมด 12 ชม. (บิต 6) อ่านกลับเป็น AM/PM · วันในสัปดาห์ที่ผู้ใช้กำหนดเพิ่มตามวัน', () => {
    let t = 10;
    const r = new Ds3231(() => t, parseClock('2026-01-01 00:00:00'));
    wr(r, [0x00, 0x30, 0x15, 0x40 | 0x20 | 0x02, 0x05, 0x31, 0x12, 0x30]); // 14:15:30 (2 PM) วัน 5 31 ธ.ค. 2030
    expect(formatClock(r.clock())).toBe('2030-12-31 14:15:30');
    t = 10 + 35076; // 14:15:30 → 00:00:06 ของวันถัดไป
    wr(r, [0x00]);
    const v = rd(r, 7);
    expect(formatClock(r.clock())).toBe('2031-01-01 00:00:06');
    expect(v[2]).toBe(0x40 | 0x12); // 12 AM
    expect(v[3]).toBe(6);
  });
  it('AT24C32 ที่อยู่ภายใน 2 ไบต์ เขียนแล้วอ่านกลับ · ห่อภายในหน้า 32 ไบต์', () => {
    const e = new At24c32();
    wr(e, [0x01, 0xfe, 10, 20, 30]);
    wr(e, [0x01, 0xfe]);
    expect(rd(e, 2)).toEqual([10, 20]);
    wr(e, [0x01, 0xe0]);
    expect(rd(e, 1)).toEqual([30]); // 0x1FF → ห่อไป 0x1E0 (ต้นหน้า)
  });
});

describe('MPU6050 (Register Map rev 4.2)', () => {
  it('หลังจ่ายไฟหลับ (0x6B = 0x40) อ่านได้ 0 · WHO_AM_I 0x68 · ปลุกแล้วอ่าน z ≈ +1 g ตามสเกล ±2/±8 g · อุณหภูมิ ค่า/340 + 36.53', () => {
    let t = 1;
    const m = new Mpu6050(() => t);
    wr(m, [0x75]); expect(rd(m, 1)).toEqual([0x68]);
    wr(m, [0x3b]); expect(rd(m, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    wr(m, [0x6b, 0x00]);
    const s16 = (h: number, l: number) => ((h << 8) | l) << 16 >> 16;
    wr(m, [0x3b]); let d = rd(m, 14);
    expect(s16(d[4], d[5]) / 16384).toBeCloseTo(1, 1);
    expect(s16(d[6], d[7]) / 340 + 36.53).toBeCloseTo(25, 1);
    wr(m, [0x1c, 2 << 3]);
    wr(m, [0x3b]); d = rd(m, 6);
    expect(s16(d[4], d[5]) / 4096).toBeCloseTo(1, 1);
    wr(m, [0x6b, 0x80]); // DEVICE_RESET
    wr(m, [0x6b]); expect(rd(m, 1)).toEqual([0x40]);
  });
  it('เดิน 120 ก้าว/นาที: ขนาดความเร่งพุ่งเกิน 1.2 g หนึ่งครั้งต่อก้าว ตรงกับ trueSteps', () => {
    let t = 0;
    const m = new Mpu6050(() => t);
    m.motion = 'walk'; m.spm = 120; m.motionStart = 0;
    wr(m, [0x6b, 0x00]);
    let steps = 0, high = false;
    const s16 = (h: number, l: number) => ((h << 8) | l) << 16 >> 16;
    for (t = 0; t < 10; t += 0.02) {
      wr(m, [0x3b]); const d = rd(m, 6);
      const a = Math.hypot(s16(d[0], d[1]), s16(d[2], d[3]), s16(d[4], d[5])) / 16384;
      if (a > 1.2 && !high) { steps++; high = true; } else if (a < 1.05) high = false;
    }
    expect(trueSteps(10, 120)).toBe(20);
    expect(Math.abs(steps - 20)).toBeLessThanOrEqual(1);
  });
});

describe('บัส I²C: การเข้าถึงทางไฟฟ้า ที่อยู่ซ้ำ และการถอดรหัสระดับขา', () => {
  const spec = (id: string, dev: I2cSpec['dev'], o: Partial<I2cSpec> = {}): I2cSpec => ({ id, dev, vcc: 1, gnd: 0, sda: 2, scl: 3, ad0: dev === 'mpu6050' ? 4 : -1, addr: dev === 'ssd1306' ? 0x3c : 0x68, vMin: 3, vMax: 5.5, ...o });
  const mk = (v: Record<number, number>) => { const h = new I2cHub(() => 0); h.levels = { v: (n, ref) => (v[n] ?? 0) - (v[ref] ?? 0) }; return h; };
  it('ตอบเฉพาะอุปกรณ์ที่มีไฟเลี้ยงและต่อสายคู่เดียวกัน · AD0 สูง = 0x69 · ที่อยู่ซ้ำตอบพร้อมกัน (ค่าอ่าน = AND)', () => {
    const h = mk({ 1: 3.3, 2: 3.3, 3: 3.3, 4: 0 });
    h.sync([spec('O', 'ssd1306'), spec('R', 'ds3231'), spec('M', 'mpu6050')]);
    expect(h.open(0x3c, false, 2, 3, 0, 'hw').ack).toBe(true);
    expect(h.open(0x3c, false, 9, 3, 0, 'hw').ack).toBe(false); // สาย SDA คนละเส้น
    const both = h.open(0x68, false, 2, 3, 0, 'hw');
    expect(both.targets.length).toBe(2);
    both.write(0x75); both.close();
    const r = h.open(0x68, true, 2, 3, 0, 'hw');
    expect(r.read()).toBe(0x68 & 0x00); // DS3231 ชี้ 0x75 % 0x13 = 0x02 (ชั่วโมง 0x00) AND WHO_AM_I 0x68
    r.close();
    expect(h.snapshot(0).M.conflicts).toBeGreaterThan(0);
    const h2 = mk({ 1: 3.3, 2: 3.3, 3: 3.3, 4: 3.3 });
    h2.sync([spec('R', 'ds3231'), spec('M', 'mpu6050')]);
    expect(h2.open(0x69, false, 2, 3, 0, 'hw').targets.length).toBe(1);
    const h3 = mk({ 1: 1.2, 2: 3.3, 3: 3.3 }); // ไฟเลี้ยงไม่พอ
    h3.sync([spec('O', 'ssd1306')]);
    expect(h3.open(0x3c, false, 2, 3, 0, 'hw').ack).toBe(false);
  });
  it('soft I²C: START → ที่อยู่ + W → อุปกรณ์ดึง SDA ลงเป็น ACK ที่คล็อกที่ 9 · ที่อยู่ไม่มีอุปกรณ์ = NACK · อ่านไบต์ทีละบิต', () => {
    const h = mk({ 1: 3.3, 2: 3.3, 3: 3.3 });
    h.sync([spec('R', 'ds3231', { clock: '2026-01-01 12:34:56' })]);
    let scl = true, sda = true;
    const lev = () => h.pinLevels((n) => (n === 3 ? !scl : n === 2 ? !sda : false), () => 0);
    // ข้อมูลเปลี่ยนเฉพาะตอน SCL ต่ำ: ลง SCL ก่อนแล้วเปลี่ยน SDA · ขึ้น SCL หลังตั้ง SDA
    const set = (c: boolean, d: boolean) => { if (!c && scl) { scl = false; lev(); } if (d !== sda) { sda = d; lev(); } if (c !== scl) { scl = c; lev(); } };
    const line = () => sda && !h.pulledLow(2);
    const sendByte = (b: number) => {
      for (let i = 7; i >= 0; i--) { set(false, ((b >> i) & 1) === 1); set(true, ((b >> i) & 1) === 1); }
      set(false, true); set(true, true); const ack = !line(); set(false, true); return ack;
    };
    const readByte = (ack: boolean) => {
      let v = 0;
      for (let i = 0; i < 8; i++) { set(false, true); set(true, true); v = (v << 1) | (line() ? 1 : 0); }
      set(false, !ack); set(true, !ack); set(false, !ack); return v;
    };
    const start = () => { set(true, true); sda = false; lev(); set(false, false); };
    const stop = () => { set(false, false); set(true, false); sda = true; lev(); };
    start(); expect(sendByte(0x68 << 1)).toBe(true); expect(sendByte(0x00)).toBe(true); stop();
    start(); expect(sendByte((0x68 << 1) | 1)).toBe(true);
    expect([readByte(true), readByte(true), readByte(false)]).toEqual([0x56, 0x34, 0x12]); stop();
    start(); expect(sendByte(0x50 << 1)).toBe(false); stop();
    expect(h.takeLog()).toEqual(['SW 0x68 ACK [00]', 'SR 0x68 ACK [56 34 12]', 'SW 0x50 NACK']);
  });
});
