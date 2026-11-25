/**
 * SSD1306: การเลื่อนภาพอัตโนมัติ (คำสั่ง 0x26/0x27/0x29/0x2A/0xA3/0x2E/0x2F ดาต้าชีต Solomon Systech SSD1306 §10.3)
 * โค้ด MicroPython (ไดรเวอร์ ssd1306 ในเฟิร์มแวร์) วาดบล็อก แล้วส่งคำสั่งเลื่อนเองทาง I²C — ตรวจจากพิกเซลที่แสดง (สร้างจากไบต์บนบัส)
 */
import { describe, expect, it } from 'vitest';
import { screenPixels } from '../src/mcu/i2c-bus';
import { Ssd1306 } from '../src/mcu/i2c-devices';
import { runWatch, watchRig } from './watch-rig';

const PRE = 'from machine import Pin, I2C\nimport ssd1306, time\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\noled = ssd1306.SSD1306_I2C(128, 64, i2c)\noled.fill(0); oled.fill_rect(0, 0, 8, 8, 1); oled.show()\ncmd = lambda *c: i2c.writeto(0x3C, bytes((0x00,) + c))\n';
/** คอลัมน์ซ้ายสุดของบล็อกในแถวบนสุด */
const blockX = (px: Uint8Array, y = 0) => { for (let x = 0; x < 128; x++) if (px[y * 128 + x] && !px[y * 128 + ((x + 127) % 128)]) return x; return -1; };
const val = (con: string, k: string) => Number([...con.matchAll(new RegExp(`(?:^|>>> )R ${k} (\\d+)`, 'gm'))].at(-1)?.[1]);

describe('SSD1306 เลื่อนภาพอัตโนมัติ (MicroPython บน Pico)', () => {
  it('อัตราเฟรมตามสูตรดาต้าชีต Fosc/(D·K·MUX): ค่าเริ่ม (D5 = 0x80, D9 = 0x22) ≈ 107 Hz · ไดรเวอร์ MicroPython ตั้ง D9 = 0xF1 → ≈ 87.6 Hz', () => {
    const o = new Ssd1306(() => 0);
    expect(o.frameRate()).toBeCloseTo(370e3 / (54 * 64), 6);
    const w = (b: number[]) => { o.begin(); o.write(0x00); for (const x of b) o.write(x); o.end(); };
    w([0xd9, 0xf1]);
    expect(o.frameRate()).toBeCloseTo(370e3 / (66 * 64), 6);
  });

  it('เลื่อนขวา (0x26 ทุก 2 เฟรม หน้า 0–7) แล้วหยุด (0x2E): บล็อกย้ายไปตามจำนวนก้าว = ⌊เวลา × อัตราเฟรม / 2⌋ และ GDDRAM ถูกย้ายจริง (หยุดแล้วภาพคงที่)', { timeout: 300000 }, () => {
    const code = PRE + 'time.sleep_ms(200)\ncmd(0x26, 0x00, 0x00, 0x07, 0x07, 0x00, 0xFF)\ncmd(0x2F); t0 = time.ticks_us()\ntime.sleep_ms(1000)\ncmd(0x2E); print("R dt %d" % time.ticks_diff(time.ticks_us(), t0))\n';
    const r = runWatch(watchRig({ code, skip: ['rtc', 'mpu', 'vib'] }), 3.6);
    const steps = Math.floor((val(r.con, 'dt') / 1e6) * (370e3 / (66 * 64)) / 2);
    const mid = [...r.st].reverse().find((s) => s.i2c.OLED1?.scrolling)!;
    expect(mid).toBeTruthy();
    const end = r.st.at(-1)!.i2c.OLED1!;
    expect(end.scrolling).toBe(false);
    // ไดรเวอร์ตั้ง A1 (คอลัมน์ RAM = x บนจอ): เลื่อนขวา n ก้าว → บล็อกอยู่ที่ x = n mod 128 (คลาดได้ 1 ก้าวจากจังหวะเริ่ม/หยุดภายในเฟรม)
    expect(Math.abs(blockX(screenPixels(end)!) - (steps % 128))).toBeLessThanOrEqual(1);
    expect(blockX(screenPixels(mid.i2c.OLED1!)!)).toBeGreaterThan(0);
    const x1 = blockX(screenPixels(r.st.at(-3)!.i2c.OLED1!)!), x2 = blockX(screenPixels(end)!);
    expect(x1).toBe(x2);
    expect(steps).toBeGreaterThan(30);
  });

  it('เลื่อนแนวตั้ง + ขวา (0xA3 ทั้งจอ, 0x29 ออฟเซ็ต 1 แถว/ก้าว): แถวของบล็อกเปลี่ยนไปตามก้าว ระหว่างเลื่อน', { timeout: 300000 }, () => {
    const code = PRE + 'time.sleep_ms(200)\ncmd(0xA3, 0, 64)\ncmd(0x29, 0x00, 0x00, 0x07, 0x07, 0x01)\ncmd(0x2F); t0 = time.ticks_us()\ntime.sleep_ms(300)\nprint("R dt %d" % time.ticks_diff(time.ticks_us(), t0))\ntime.sleep_ms(2000)\n';
    const r = runWatch(watchRig({ code, skip: ['rtc', 'mpu', 'vib'] }), 1.0);
    const st = r.st.at(-1)!.i2c.OLED1!;
    expect(st.scrolling).toBe(true);
    expect(st.vScroll).toBeGreaterThan(0);
    const px = screenPixels(st)!;
    // บล็อกไม่อยู่แถวบนสุดอีกแล้ว (เลื่อนแนวตั้ง) แต่ยังมี 64 พิกเซลสว่างครบ (เลื่อนเป็นวง)
    expect(px.reduce((a, b) => a + b, 0)).toBe(64);
    expect(px.slice(0, 128).some((v) => v)).toBe(false);
  });
});
