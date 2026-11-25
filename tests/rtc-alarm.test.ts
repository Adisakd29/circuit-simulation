/**
 * DS3231: นาฬิกาปลุก 1/2 + ขา INT/SQW, คลื่นสี่เหลี่ยม 1 Hz/1.024 kHz, ขา 32K, aging offset, การแปลงอุณหภูมิ (ดาต้าชีต Analog Devices DS3231)
 * ทดสอบผ่านโค้ด MicroPython จริงบน Pico (rp2040js) อ่านขา INT/SQW ที่ต่อกับ GPIO — ไม่อ่านสถานะจากตัวแบบจำลองโดยตรง
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { Ds3231 } from '../src/mcu/i2c-devices';
import { LogicBuffer, measurePwm } from '../src/instruments/logic';
import { watchRig } from './watch-rig';
import { H, P, onTable } from './helpers';

const I2C = 'from machine import Pin, I2C\nimport time\ni2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)\nW = lambda r, b: i2c.writeto_mem(0x68, r, bytes(b))\nR = lambda r: i2c.readfrom_mem(0x68, r, 1)[0]\n';

function rig(code: string, extra?: (b: ReturnType<typeof watchRig>) => void) {
  const b = watchRig({ code, skip: ['oled', 'mpu', 'vib'] });
  const rtc = b.doc.parts.find((p) => p.id === 'RTC1')!;
  const pin = (n: string) => pinHolesFor(rtc).find((x) => x.pin === n)!.hole!;
  expect([pin('32K'), pin('SQW')]).toEqual(['j30', 'j31']);
  const pico = b.doc.parts.find((p) => p.id === 'PICO1')!;
  const gp14 = pinHolesFor(pico).find((x) => x.pin === 'GP14')!.hole!;
  b.wire(H('i31'), H(`j${gp14.slice(1)}`), 'wsqw', '#8e24aa');
  extra?.(b);
  return b;
}

function run(b: ReturnType<typeof watchRig>, seconds: number, dt = 0.1, onLogic?: (l: NonNullable<ReturnType<SimEngine['handle']>['logic']>) => void) {
  const e = new SimEngine(), built = buildNetlist(b.doc);
  let con = '';
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    if (!r.result.ok) throw new Error(r.result.error?.message);
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    if (r.logic) onLogic?.(r.logic);
  }
  return con;
}
const val = (con: string, k: string) => { const m = [...con.matchAll(new RegExp(`(?:^|>>> )R ${k} ([-\\w.]+)`, 'gm'))].at(-1); return m ? m[1] : undefined; };

describe('DS3231: นาฬิกาปลุกและขา INT/SQW ที่ GPIO ของ Pico อ่านได้', () => {
  it('ปลุก 1 (วินาที = 58) และปลุก 2 (ทุกนาที ที่วินาที 00): INT ต่ำเมื่อปลุกตรง (INTCN = 1, A1IE/A2IE) · ล้าง AxF → INT กลับสูง', { timeout: 300000 }, () => {
    const code = I2C + [
      'irq = Pin(14, Pin.IN)',
      'W(0x0E, [0x04]); W(0x0F, [0x08])',
      'print("R idle %d" % irq.value())',
      'W(0x00, [0x55, 0x00, 0x12])  # 12:00:55 (เขียนวินาที = เริ่มนับย่อยวินาทีใหม่)',
      'W(0x07, [0x58, 0x80, 0x80, 0x80])  # ปลุก 1: วินาทีตรง 58',
      'W(0x0B, [0x80, 0x80, 0x80])  # ปลุก 2: ทุกนาที',
      'W(0x0E, [0x05]); t0 = time.ticks_ms()',
      'while irq.value(): time.sleep_ms(5)',
      'print("R a1ms %d" % time.ticks_diff(time.ticks_ms(), t0)); print("R st1 %d" % (R(0x0F) & 3)); print("R sec1 %x" % R(0))',
      'W(0x0F, [0x08]); time.sleep_ms(20); print("R cleared %d" % irq.value())',
      'W(0x0E, [0x06])  # ปลุก 2 เท่านั้น',
      'while irq.value(): time.sleep_ms(5)',
      'print("R a2ms %d" % time.ticks_diff(time.ticks_ms(), t0)); print("R st2 %d" % (R(0x0F) & 3)); print("R min2 %x" % R(1)); print("R sec2 %x" % R(0))',
      'W(0x0F, [0x08]); W(0x0E, [0x04]); time.sleep_ms(20); print("R end %d" % irq.value())',
    ].join('\n') + '\n';
    const con = run(rig(code), 7.5);
    expect(val(con, 'idle')).toBe('1');
    expect(Math.abs(Number(val(con, 'a1ms')) - 3000)).toBeLessThan(60);
    expect(val(con, 'st1')).toBe('1');
    expect(val(con, 'sec1')).toBe('58');
    expect(val(con, 'cleared')).toBe('1');
    expect(Math.abs(Number(val(con, 'a2ms')) - 5000)).toBeLessThan(60);
    expect(val(con, 'st2')).toBe('2');
    expect(val(con, 'min2')).toBe('1');
    expect(val(con, 'sec2')).toBe('0');
    expect(val(con, 'end')).toBe('1');
  });

  it('INTCN = 0: คลื่นสี่เหลี่ยม 1 Hz (ต่ำครึ่งแรกหลังวินาทีเปลี่ยน สูง 500 ms หลังการอัปเดตวินาที) และ 1.024 kHz — นับขอบด้วย Pin.irq', { timeout: 300000 }, () => {
    const code = I2C + [
      'p = Pin(14, Pin.IN); n = [0]; ev = []',
      'def cb(x):',
      '    n[0] += 1',
      '    if len(ev) < 8: ev.append((time.ticks_ms(), x.value()))',
      'W(0x0E, [0x00]); W(0x00, [0x00])',
      'p.irq(cb, Pin.IRQ_FALLING | Pin.IRQ_RISING)',
      'time.sleep_ms(3000); p.irq(None)',
      'print("R edges %d" % n[0])',
      'print("R ev " + ",".join("%d:%d" % (t - ev[0][0], v) for t, v in ev))',
      'n[0] = 0; W(0x0E, [0x08])  # RS = 01 → 1.024 kHz',
      'def cnt(x):',
      '    n[0] += 1',
      'p.irq(cnt, Pin.IRQ_FALLING); time.sleep_ms(500); p.irq(None)',
      'print("R fast %d" % n[0])',
    ].join('\n') + '\n';
    const con = run(rig(code), 4.6);
    // 3 s ของคลื่น 1 Hz = 6 ขอบ (ขอบแรกขาลงตรงการเขียนวินาที)
    expect(Math.abs(Number(val(con, 'edges')) - 6)).toBeLessThanOrEqual(1);
    const ev = val(con, 'ev')!.split(',').map((s) => s.split(':').map(Number));
    // ขอบสลับขึ้น/ลง ห่างกัน ≈ 500 ms
    for (let i = 1; i < ev.length; i++) { expect(Math.abs(ev[i][0] - ev[i - 1][0] - 500)).toBeLessThan(25); expect(ev[i][1]).not.toBe(ev[i - 1][1]); }
    expect(Math.abs(Number(val(con, 'fast')) - 512)).toBeLessThan(15);
  });

  it('ขา 32K: คลื่น 32.768 kHz (EN32kHz = 1 หลังจ่ายไฟ) วัดด้วยเครื่องวิเคราะห์ลอจิก · เขียน EN32kHz = 0 → ขาสูงค้าง (ตัวต้านทานดึงขึ้นบนโมดูล)', { timeout: 300000 }, () => {
    const code = I2C + 'time.sleep_ms(400)\nW(0x0F, [0x00])\nprint("R off 1")\n';
    const b = rig(code, (bb) => { bb.part('logicanalyzer', onTable(-60, 60), 'LA1', {}).wire(P('LA1', 'CH0'), H('i30'), 'wla', '#fdd835').wire(P('LA1', 'GND'), H('bn60'), 'wlg', '#212121'); });
    const buf = new LogicBuffer();
    const con = run(b, 0.7, 0.05, (l) => { if (l.LA1) buf.push(l.LA1, 10); });
    expect(con).toContain('R off 1');
    const on = measurePwm(buf.ch[0], 0.05, 0.3);
    expect(Math.abs(on.freq! - 32768) / 32768).toBeLessThan(0.002);
    expect(Math.abs(on.duty! - 0.5)).toBeLessThan(0.02);
    const off = measurePwm(buf.ch[0], 0.55, 0.7);
    expect(off.freq).toBeNull();
    expect(off.level).toBe(1);
  });
});

describe('DS3231 ระดับรีจิสเตอร์ (เวลาจำลองควบคุมเอง)', () => {
  const mk = () => { const t = { v: 0 }; const d = new Ds3231(() => t.v, Date.UTC(2026, 0, 1, 12, 0, 0) / 1000); const w = (r: number, b: number[]) => { d.begin(false); d.write(r); for (const x of b) d.write(x); d.end(); }; const rd = (r: number) => { d.begin(false); d.write(r); d.end(); d.begin(true); const v = d.read(); d.end(); return v; }; return { t, d, w, rd }; };

  it('aging offset +127 (≈ +12.7 ppm ช้าลง) / −128 (เร็วขึ้น): หลัง 10⁶ s นาฬิกาต่าง ≈ 12.7 s / 12.8 s', () => {
    for (const [a, exp] of [[127, -12.7], [-128, 12.8]] as const) {
      const { t, d, w } = mk();
      const c0 = d.clock();
      w(0x10, [a & 0xff]);
      t.v = 1e6;
      expect(d.clock() - c0 - 1e6).toBeCloseTo(exp, 6);
    }
  });

  it('อุณหภูมิอัปเดตตามรอบการแปลง: อัตโนมัติทุก 64 s หรือสั่ง CONV (BSY = 1 ระหว่างแปลง 200 ms, CONV ค้างเป็น 1 จนเสร็จ)', () => {
    const { t, d, w, rd } = mk();
    d.temperature = 25; t.v = 0.3; expect(rd(0x11)).toBe(25);
    d.temperature = 31.25; t.v = 10;
    expect(rd(0x11)).toBe(25); // ยังไม่ถึงรอบแปลงถัดไป
    w(0x0e, [0x3c]); // CONV
    expect(rd(0x0e) & 0x20).toBe(0x20);
    expect(rd(0x0f) & 0x04).toBe(0x04);
    t.v = 10.1; expect(rd(0x11)).toBe(25);
    t.v = 10.25; expect(rd(0x11)).toBe(31); expect(rd(0x12)).toBe(0x40); expect(rd(0x0e) & 0x20).toBe(0); expect(rd(0x0f) & 0x04).toBe(0);
    d.temperature = 40; t.v = 63.9; expect(rd(0x11)).toBe(31);
    t.v = 64.1; expect(rd(0x0f) & 0x04).toBe(0x04);
    t.v = 64.3; expect(rd(0x11)).toBe(40);
  });

  it('ปลุก 1 ตรงวัน (DY/DT = 1) + ชั่วโมงแบบ 12 ชม. (PM) และ OSF/AxF ล้างได้ด้วยการเขียน 0 เท่านั้น', () => {
    const { t, d, w, rd } = mk(); // 2026-01-01 = วันพฤหัส (วันที่ 4 เมื่อ 1 = จันทร์)
    w(0x07, [0x05, 0x00, 0x40 | 0x20 | 0x12, 0x40 | 4]); // 12:00:05 PM ทุกวันพฤหัส (แบบ 12 ชม.)
    t.v = 4; d.poll(); expect(rd(0x0f) & 1).toBe(0);
    t.v = 5.01; d.poll(); expect(rd(0x0f) & 1).toBe(1);
    w(0x0f, [0x0b]); expect(rd(0x0f) & 1).toBe(1); // เขียน 1 ไม่ล้าง
    w(0x0f, [0x08]); expect(rd(0x0f) & 1).toBe(0);
    t.v = 5 + 86400; d.poll(); expect(rd(0x0f) & 1).toBe(0); // วันศุกร์ไม่ปลุก
    t.v = 5.01 + 7 * 86400; d.poll(); expect(rd(0x0f) & 1).toBe(1);
  });
});
