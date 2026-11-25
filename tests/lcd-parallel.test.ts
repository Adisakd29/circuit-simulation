import { describe, expect, it } from 'vitest';
import { pinDefs } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { charLcdText } from '../src/mcu/i2c-sensors';
import { ParLcdHub, hd44780ExecTime } from '../src/mcu/hd44780-par';
import type { ParLcdPart } from '../src/model/types';
import { Builder, H, onBoard } from './helpers';
import { col, lcdRig, runLcd } from './lcd-rig';

/**
 * จอ LCD 16×2 แบบขนาน (HD44780) กับ Uno — รันไฟล์ .hex ที่คอมไพล์จริงจากไลบรารี LiquidCrystal 1.0.7 (tests/fixtures/uno/gen.ts)
 * จอเสียบแถว j คอลัมน์ 8–23: VSS 8, VDD 9, V0 10, RS 11, RW 12, E 13, D0–D7 14–21, A 22, K 23
 */
describe('จอ LCD 16×2 แบบขนาน: ขาและการวาง', () => {
  it('16 ขาแถวเดียว (VSS … K) ที่ anchor j8 = คอลัมน์ 8–23', () => {
    const b = new Builder().part('lcd1602p', onBoard('j8'), 'LCD1');
    const p = b.doc.parts[0] as ParLcdPart;
    expect(pinDefs(p).map((d) => d.name)).toEqual(['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']);
    expect(Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]))).toMatchObject({ VSS: 'j8', E: 'j13', D7: 'j21', K: 'j23' });
  });
});

describe('จอ LCD แบบขนาน + Uno (LiquidCrystal จริง)', () => {
  it('โหมด 4 บิต (ตัวอย่างแลป 57): แถวบน "Hello, World!" แถวล่างเวลาเป็นวินาที · ความคมชัดจาก VDD − V0 · ไฟพื้นหลังผ่าน 220 Ω', { timeout: 60000 }, () => {
    const { st, x } = runLcd(lcdRig(), 1.3);
    expect(st?.powered).toBe(true);
    expect(st?.dl8).toBe(false);
    const t = charLcdText(st!.lcd);
    expect(t[0]).toBe('Hello, World!   ');
    expect(t[1]).toMatch(/^t = 1 s {9}$/);
    expect(st!.dropped).toBe(0);
    expect(x!.vlcd).toBeGreaterThan(3.9);
    expect(x!.contrast).toBeGreaterThan(0.5);
    // LED ไฟพื้นหลัง Vf ≈ 3 V + 100 Ω บนแผ่น + 220 Ω → ≈ 6 mA
    expect(x!.bl).toBeGreaterThan(0.004);
    expect(x!.bl).toBeLessThan(0.008);
  });
  it('โหมด 8 บิต (D0–D7 + ขา RW ต่อ Uno) · ตัวอักษรเอง (CGRAM) · เคอร์เซอร์', { timeout: 60000 }, () => {
    const { st } = runLcd(lcdRig({ mode: 8 }), 0.4);
    expect(st?.dl8).toBe(true);
    const t = charLcdText(st!.lcd);
    expect(t[0]).toBe('8-bit ▮         ');
    expect(t[1]).toBe('   ABC          ');
    expect(st!.lcd.cgram.slice(0, 8)).toEqual([0, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0, 0]);
    expect(st!.lcd.cursor).toBe(true);
    expect(st!.lcd.ac).toBe(0x46);
    expect(st!.reads).toBe(0);
  });
  it('ความคมชัด: VR หมุนให้ V0 สูง → ตัวอักษรจาง (แจ้งเตือน) · V0 = 0 V → เห็นกล่องจุดทุกช่อง', { timeout: 60000 }, () => {
    const faint = runLcd(lcdRig({ pot: 0.6 }), 0.3);
    expect(faint.x!.contrast).toBeLessThan(0.25);
    expect(faint.an.ok && faint.an.diagnostics.some((d) => d.partId === 'LCD1' && d.message.includes('ตัวอักษรจาง'))).toBe(true);
    const dark = runLcd(lcdRig({ pot: 0 }), 0.3);
    expect(dark.x!.ghost).toBeGreaterThan(0.25);
  });
  it('ไม่มีตัวต้านทาน (และโมดูลไม่มีตัวต้านทานบนแผ่น) → ไฟพื้นหลังกระแสเกิน · ไม่ต่อ VDD → จอดับ ไม่มีข้อความ', { timeout: 60000 }, () => {
    const b = lcdRig({ blRes: false });
    (b.doc.parts.find((p) => p.id === 'LCD1') as ParLcdPart).params.blR = 0;
    b.wire(H(`h${col('A')}`), H(`bp${col('A')}`), 'pa0', '#e53935');
    const over = runLcd(b, 0.2);
    expect(over.x!.bl).toBeGreaterThan(0.1);
    expect(over.an.ok && over.an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ไฟพื้นหลัง'))).toBe(true);
    const off = runLcd(lcdRig({ vdd: false }), 0.4);
    expect(off.st?.powered).toBe(false);
    expect(off.st?.chars).toBe(0);
  });
  it('RW ลอย (ตัวดึงขึ้นภายใน = อ่าน) → จอไม่รับข้อมูล แจ้งให้ต่อ RW กับ GND', { timeout: 60000 }, () => {
    const { st, an } = runLcd(lcdRig({ rwGnd: false }), 0.4);
    expect(st!.reads).toBeGreaterThan(10);
    expect(st!.chars).toBe(0);
    expect(an.ok && an.diagnostics.some((d) => d.message.includes('RW'))).toBe(true);
  });
});

describe('แลป 57 ตรวจผลจากวงจรและจอที่จำลอง', () => {
  it('ต่อครบตามขั้นตอน + อัปโหลด → ผ่านทุกข้อ · VR สูงเกิน → contrast ไม่ผ่าน · ไม่มีโปรแกรม → upload/text ไม่ผ่าน · RW ลอย → power ไม่ผ่าน', { timeout: 90000 }, () => {
    const ok = runLcd(lcdRig(), 0.4).goals;
    for (const g of ['power', 'wire', 'upload', 'text', 'contrast', 'backlight']) expect(ok[g].pass, `${g}: ${ok[g].detail}`).toBe(true);
    const faint = runLcd(lcdRig({ pot: 0.6 }), 0.4).goals;
    expect(faint.text.pass).toBe(true);
    expect(faint.contrast.pass).toBe(false);
    const nohex = runLcd(lcdRig({ hex: null }), 0.2).goals;
    expect(nohex.upload.pass).toBe(false);
    expect(nohex.text.pass).toBe(false);
    const rw = runLcd(lcdRig({ rwGnd: false }), 0.2).goals;
    expect(rw.power.pass).toBe(false);
    expect(rw.power.detail).toContain('RW');
  });
});

describe('HD44780 แบบขนาน: เวลาประมวลผล (busy)', () => {
  /** ขับขาด้วยตัวแปร (แทน MCU) */
  const rig = () => {
    let t = 0;
    const lv: Record<number, boolean | null> = {};
    const hub = new ParLcdHub(() => t);
    hub.levels = { v: (net) => (net === 1 ? 5 : net === 0 ? 0 : null) };
    hub.drive = (net) => lv[net] ?? null;
    hub.sync([{ id: 'L', vdd: 1, vss: 0, rs: 2, rw: 3, e: 4, d: [10, 11, 12, 13, 14, 15, 16, 17], vMin: 2.7, vMax: 5.5 }]);
    hub.check(0);
    lv[3] = false;
    const send = (rs: boolean, byte: number, at: number) => {
      lv[2] = rs;
      for (let k = 0; k < 8; k++) lv[10 + k] = ((byte >> k) & 1) === 1;
      t = at; lv[4] = true; hub.check(0); lv[4] = false; t = at + 1e-6; hub.check(0);
    };
    return { send, snap: () => hub.snapshot(0).L };
  };
  it('ส่งตัวอักษรห่างกัน ≥ 41 µs รับครบ · หลัง Clear ต้องรอ 1.52 ms ไม่งั้นข้อมูลถูกทิ้ง', () => {
    expect(hd44780ExecTime(0x01)).toBeCloseTo(1.52e-3);
    expect(hd44780ExecTime(0x0c)).toBeCloseTo(37e-6);
    const a = rig();
    a.send(false, 0x38, 0); a.send(false, 0x0c, 100e-6); a.send(false, 0x01, 200e-6);
    a.send(true, 0x41, 300e-6); // ยังอยู่ระหว่าง Clear → ทิ้ง
    a.send(true, 0x42, 2e-3); a.send(true, 0x43, 2.02e-3); // ห่าง 20 µs → ตัวที่สองถูกทิ้ง
    a.send(true, 0x44, 2.1e-3);
    const s = a.snap();
    expect(s.dropped).toBe(2);
    expect(charLcdText(s.lcd)[0]).toBe('BD              ');
  });
});
