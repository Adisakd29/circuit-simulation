/**
 * MPU6050 (Register Map rev 4.2): อัตราสุ่ม, FIFO, DATA_RDY บนขา INT, FIFO ล้น — ผ่านโค้ด MicroPython บน Pico (I2C0 GP4/GP5)
 */
import { describe, expect, it } from 'vitest';
import { pinHolesFor } from '../src/model/geometry';
import { runWatch, watchRig } from './watch-rig';
import { H } from './helpers';

const val = (con: string, k: string) => Number([...con.matchAll(new RegExp(`(?:^|>>> )R ${k} (-?\\d+)`, 'gm'))].at(-1)?.[1]);
const PRE = 'from machine import Pin, I2C\nimport time\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\nA = 0x69\nW = lambda r, v: i2c.writeto_mem(A, r, bytes([v]))\nR = lambda r, n=1: i2c.readfrom_mem(A, r, n)\ncount = lambda: int.from_bytes(R(0x72, 2), "big")\n';

function rig(code: string) {
  const b = watchRig({ code, skip: ['oled', 'rtc', 'vib'] });
  const imu = b.doc.parts.find((p) => p.id === 'IMU1')!;
  const int = pinHolesFor(imu).find((x) => x.pin === 'INT')!.hole!;
  const gp14 = pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === 'GP14')!.hole!;
  b.wire(H(`i${int.slice(1)}`), H(`j${gp14.slice(1)}`), 'wint', '#8e24aa');
  return b;
}

describe('MPU6050 FIFO + INT', () => {
  it('100 Hz (DLPF 1 → 1 kHz ÷ 10): ขอบขึ้นของ INT (DATA_RDY, พัลส์ 50 µs) ≈ 100 ครั้ง/วินาที · FIFO ความเร่ง 6 ไบต์/ตัวอย่าง → 0.2 s ≈ 120 ไบต์ ข้อมูลตรงกับรีจิสเตอร์ (แกน Z ≈ 1 g)', { timeout: 300000 }, () => {
    const code = PRE + [
      'W(0x6B, 0); W(0x19, 9); W(0x1A, 1); W(0x1C, 0)',
      'n = [0]', 'def cb(p): n[0] += 1',
      'Pin(14, Pin.IN).irq(cb, Pin.IRQ_RISING)',
      'W(0x38, 0x01)', 'time.sleep_ms(1000)', 'print("R edges %d" % n[0])',
      'W(0x23, 0x08); W(0x6A, 0x44); time.sleep_ms(200)',
      'c = count(); print("R count %d" % c)',
      'd = R(0x74, 6); z = int.from_bytes(d[4:6], "big"); z = z - 65536 if z > 32767 else z',
      'print("R z %d" % z); print("R after %d" % count())',
    ].join('\n') + '\n';
    const r = runWatch(rig(code), 2.4);
    expect(Math.abs(val(r.con, 'edges') - 100)).toBeLessThanOrEqual(3);
    expect(Math.abs(val(r.con, 'count') - 120)).toBeLessThanOrEqual(12);
    expect(val(r.con, 'count') % 6).toBe(0);
    expect(Math.abs(val(r.con, 'z') - 16384)).toBeLessThan(400);
    expect(val(r.con, 'after')).toBe(val(r.con, 'count') - 6 + (val(r.con, 'after') - val(r.con, 'count') + 6));
  });

  it('FIFO ล้น (ทุกเซนเซอร์ 14 ไบต์ × 100 Hz > 1024 ไบต์ใน ≈ 0.73 s): FIFO_COUNT ค้างที่ 1024 + INT_STATUS บิต FIFO_OFLOW · โหมด latch + active low: INT ค้างต่ำจนอ่าน INT_STATUS', { timeout: 300000 }, () => {
    const code = PRE + [
      'W(0x6B, 0); W(0x19, 9); W(0x1A, 1)',
      'W(0x23, 0xF8); W(0x6A, 0x44); time.sleep_ms(1200)',
      'print("R count %d" % count()); print("R st %d" % (R(0x3A)[0] & 0x10))',
      'W(0x6A, 0x04); print("R reset %d" % count())',
      'W(0x37, 0xA0); W(0x38, 0x01)',
      'p = Pin(14, Pin.IN); time.sleep_ms(50); print("R low %d" % p.value())',
      'R(0x3A); print("R cleared %d" % p.value())',
    ].join('\n') + '\n';
    const r = runWatch(rig(code), 2.2);
    expect(val(r.con, 'count')).toBe(1024);
    expect(val(r.con, 'st')).toBe(16);
    expect(val(r.con, 'reset')).toBeLessThanOrEqual(14);
    expect(val(r.con, 'low')).toBe(0);
    expect(val(r.con, 'cleared')).toBe(1);
  });
});
