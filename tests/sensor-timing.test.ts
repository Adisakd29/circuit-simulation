/**
 * เวลาวัด/แปลงของเซนเซอร์ I²C ผ่านโค้ด MicroPython จริงบน Pico: BMP280 (forced + บิต measuring + IIR), INA219 (triggered + CNVR)
 */
import { describe, expect, it } from 'vitest';
import { weatherRig, runWeather } from './weather-rig';
import { powerRig, runPower } from './power-rig';
import { setPartParams } from '../src/editor/ops';

const vals = (con: string, k: string) => [...con.matchAll(new RegExp(`(?:^|>>> )R ${k} ([-\\d.]+)`, 'gm'))].map((m) => Number(m[1]));

describe('BMP280 จาก MicroPython: forced mode ใช้เวลาตามสูตรดาต้าชีต · IIR ทำให้ค่าเข้าหาค่าใหม่ทีละขั้น', () => {
  it('×16/×2 forced: บิต measuring (0xF3 บิต 3) เป็น 1 นาน ≈ 37.5 ms · ×1/×1 ≈ 5.5 ms (Table 13)', { timeout: 300000 }, () => {
    const code = 'from machine import Pin, I2C\nimport time\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\nB = 0x76\ndef forced(ctrl):\n    i2c.writeto_mem(B, 0xF4, bytes([ctrl])); t0 = time.ticks_us()\n    while i2c.readfrom_mem(B, 0xF3, 1)[0] & 8: pass\n    return time.ticks_diff(time.ticks_us(), t0)\nprint("R slow %d" % forced((2 << 5) | (5 << 2) | 1))\nprint("R fast %d" % forced((1 << 5) | (1 << 2) | 1))\nprint("R mode %d" % (i2c.readfrom_mem(B, 0xF4, 1)[0] & 3))\n';
    const r = runWeather(weatherRig({ code, skip: ['lcd', 'bh'] }), 1.5);
    expect(Math.abs(vals(r.con, 'slow')[0] / 1000 - 37.5)).toBeLessThan(1.5);
    expect(Math.abs(vals(r.con, 'fast')[0] / 1000 - 5.5)).toBeLessThan(1.0);
    expect(vals(r.con, 'mode')[0]).toBe(0);
  });

  it('normal + IIR ×16: ความกดเปลี่ยน 1000 → 1010 hPa → โค้ดเห็นค่าเพิ่มทีละขั้น (≈ 1/16 ของส่วนที่เหลือต่อการวัด) ไม่กระโดดทันที', { timeout: 300000 }, () => {
    const code = 'from machine import Pin, I2C\nimport time, struct\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\nB = 0x76\nc = i2c.readfrom_mem(B, 0x88, 24)\nT1, T2, T3, P1, P2, P3, P4, P5, P6, P7, P8, P9 = struct.unpack("<HhhHhhhhhhhh", c)\ni2c.writeto_mem(B, 0xF5, bytes([(3 << 5) | (4 << 2)]))  # t_sb 250 ms, IIR 16\ni2c.writeto_mem(B, 0xF4, bytes([(2 << 5) | (5 << 2) | 3]))\ndef read():\n    d = i2c.readfrom_mem(B, 0xF7, 6)\n    ap = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4); at = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)\n    v1 = (at / 16384 - T1 / 1024) * T2; v2 = (at / 131072 - T1 / 8192) ** 2 * T3; tf = v1 + v2\n    v1 = tf / 2 - 64000; v2 = v1 * v1 * P6 / 32768 + v1 * P5 * 2; v2 = v2 / 4 + P4 * 65536\n    v1 = (P3 * v1 * v1 / 524288 + P2 * v1) / 524288; v1 = (1 + v1 / 32768) * P1\n    p = 1048576 - ap; p = (p - v2 / 4096) * 6250 / v1\n    v1 = P9 * p * p / 2147483648; v2 = p * P8 / 32768\n    return (p + (v1 + v2 + P7) / 16) / 100\nwhile True:\n    print("R p %.3f" % read()); time.sleep_ms(290)\n';
    const r = runWeather(weatherRig({ code, pressure: 1000, skip: ['lcd', 'bh'] }), 5, 0.25, (t, b) => { if (Math.abs(t - 2) < 1e-9) { b.doc = (setPartParams(b.doc, 'BMP1', { pressure: 1010 }) as { doc: typeof b.doc }).doc; return true; } });
    const p = vals(r.con, 'p');
    const i = p.findIndex((x) => x > 1000.05);
    expect(i).toBeGreaterThan(0);
    expect(p[i]).toBeLessThan(1002); // ขั้นแรก ≈ +0.6 hPa
    for (let k = i + 1; k < p.length; k++) expect(p[k]).toBeGreaterThanOrEqual(p[k - 1] - 0.01);
    expect(p.at(-1)!).toBeGreaterThan(1003); expect(p.at(-1)!).toBeLessThan(1010);
  });
});

describe('INA219 จาก MicroPython: โหมด triggered + CNVR', () => {
  it('ADC เฉลี่ย 128 ครั้งทั้งสองช่อง (≈ 136 ms): สั่งแปลงแล้ววนรอ CNVR ใช้เวลาตามตาราง · อ่าน Power ล้าง CNVR', { timeout: 300000 }, () => {
    const code = 'from machine import Pin, I2C\nimport time\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\nA = 0x40\nw = lambda r, v: i2c.writeto_mem(A, r, bytes([v >> 8, v & 0xFF]))\nrd = lambda r: int.from_bytes(i2c.readfrom_mem(A, r, 2), "big")\nw(5, 4096)\ncfg = 0x2000 | 0x1800 | (0xF << 7) | (0xF << 3) | 3\nw(0, cfg); t0 = time.ticks_ms()\nwhile not rd(2) & 2: pass\nprint("R ms %d" % time.ticks_diff(time.ticks_ms(), t0))\nprint("R cur %d" % rd(4)); rd(3)\nprint("R cnvr %d" % (rd(2) & 2))\n';
    const r = runPower(powerRig({ code, skip: ['tm'] }), 1.0);
    expect(Math.abs(vals(r.con, 'ms')[0] - 136.2)).toBeLessThan(4);
    expect(vals(r.con, 'cur')[0]).toBeGreaterThan(0);
    expect(vals(r.con, 'cnvr')[0]).toBe(0);
  });
});
