import { describe, expect, it } from 'vitest';
import eepromIno from './fixtures/uno/eeprom.ino?raw';
import blinkHex from './fixtures/uno/blink.hex?raw';
import { buildProjectReport, reportHtml, toCsv, fmtSI } from '../src/export/project';
import { UNO_DEFAULT_CODE } from '../src/model/catalog';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { runUno, unoRig } from './uno-rig';
import { rpiRig } from './rpi-rig';
import { pulldownRig } from './sensor-rig';

describe('ส่งออกโครงงานสำหรับประกอบจริง (BOM, ตารางต่อขา, สาย, โค้ด, รายการตรวจ)', () => {
  it('Arduino Nano บนเบรดบอร์ด: ตำแหน่งขา → รู (ขา 1 h3, D13 d17) · ขั้นตอน Arduino IDE เลือกบอร์ด Nano + Old Bootloader · ไฟ 3V3 ≤ 50 mA', () => {
    const b = new Builder().part('nano', onBoard('h3'), 'NANO1', { code: UNO_DEFAULT_CODE }).part('resistor', onBoard('b17'), 'R1', { resistance: 220, span: 5 }).part('led', onBoard('c22'), 'LED1', {})
      .wire(H('a23'), H('tn23'), 'k', '#212121').wire(H('a4'), H('tn4'), 'g', '#212121');
    const r = buildProjectReport(b.doc, 'Nano');
    expect(r.bom.find((x) => x.item.startsWith('Arduino Nano'))!.qty).toBe(1);
    expect(r.place.find((p) => p.ref === 'NANO1')!.pins).toMatch(/D1 → h3/);
    expect(r.place.find((p) => p.ref === 'NANO1')!.pins).toMatch(/D13 → d17/);
    expect(r.pins.find((p) => p.pin === 'D13')!.to.some((t) => t.startsWith('R1'))).toBe(true);
    expect(r.code[0]).toMatchObject({ language: 'Arduino C/C++', filename: 'NANO1/NANO1.ino' });
    expect(r.code[0].upload.join()).toContain('Arduino Nano');
    expect(r.code[0].upload.join()).toContain('Old Bootloader');
    expect(r.power.join()).toContain('3V3 ≤ 50 mA');
    expect(r.limits.some((l) => l.item.includes('ความสามารถที่จำลองไม่ครบ'))).toBe(true);
  });

  it('Uno + R 220 Ω + LED: BOM นับจำนวนถูก · ตารางต่อขา D13 → R1 · GND → LED1 K · ตำแหน่งขา → รู · สาย 3 เส้น', () => {
    const b = unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex });
    const r = buildProjectReport(b.doc, 'ไฟกะพริบ');
    const row = (item: string) => r.bom.find((x) => x.item.startsWith(item));
    expect(row('Arduino Uno')!.qty).toBe(1);
    expect(row('ตัวต้านทาน')!.spec).toContain('220 Ω');
    expect(row('LED')!.spec).toContain('แดง');
    expect(row('สายจัมเปอร์ ผู้–ผู้')!.qty).toBe(3);
    expect(row('เบรดบอร์ด')!.qty).toBe(1);
    const d13 = r.pins.find((p) => p.pin === 'D13')!;
    expect(d13.to.some((t) => t.startsWith('R1'))).toBe(true);
    const gnd = r.pins.find((p) => p.pin === 'GND.1')!;
    expect(gnd.to.join()).toMatch(/LED1 K/);
    expect(gnd.net).toContain('GND');
    expect(r.place.find((p) => p.ref === 'LED1')!.pins).toMatch(/A → c8/);
    expect(r.wires).toHaveLength(3);
    expect(r.wires[0].from).toContain('UNO1 · D13');
    expect(r.code[0]).toMatchObject({ language: 'Arduino C/C++', filename: 'UNO1/UNO1.ino' });
    expect(r.code[0].upload.join()).toContain('Upload');
    expect(r.checklist.some((c) => c.text.includes('LED1') && c.text.includes('ขายาว'))).toBe(true);
    expect(r.checklist.some((c) => c.text.includes('R1') && c.text.includes('220'))).toBe(true);
    expect(r.limits[0].text).toContain('ไม่ได้รับรอง');
    expect(r.limits.some((l) => l.item.includes('ความสามารถที่จำลองไม่ครบ') && l.text.includes('SPI'))).toBe(true);
  });

  it('ไลบรารีจาก #include และ HTML escape โค้ด (<EEPROM.h>) · CSV มี BOM UTF-8 และ quote ช่องที่มี ,', () => {
    const b = unoRig({ code: eepromIno, hex: null });
    const r = buildProjectReport(b.doc, 'EEPROM <ทดสอบ>');
    expect(r.code[0].libraries[0]).toContain('EEPROM');
    const html = reportHtml(r, [{ caption: 'มุมบน', src: 'data:image/png;base64,AAAA' }]);
    expect(html).toContain('#include &lt;EEPROM.h&gt;');
    expect(html).toContain('EEPROM &lt;ทดสอบ&gt;');
    for (const s of ['รายการอุปกรณ์ (BOM)', 'ตารางต่อขาของบอร์ด', 'สายจัมเปอร์', 'Hardware Validation Checklist', 'ข้อจำกัดที่ยังไม่ได้ตรวจจากการจำลอง', 'ไม่ได้รับรองความปลอดภัย', 'ยังไม่ได้กด Run']) expect(html).toContain(s);
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"x,y","say ""hi"""');
    expect(fmtSI(4700, 'Ω')).toBe('4.7 kΩ');
    expect(fmtSI(1e-5, 'F')).toBe('10 µF');
  });

  it('Raspberry Pi 5: สายจากหัวต่อตัวผู้นับเป็นสายเมีย–ผู้ · ขั้นตอน python3 main.py · Pico: เฟิร์มแวร์ + Thonny', () => {
    const r = buildProjectReport(rpiRig().doc, 'pi');
    expect(r.bom.find((x) => x.item === 'สายจัมเปอร์ เมีย–ผู้')!.qty).toBe(4);
    expect(r.wires.filter((w) => w.type === 'เมีย–ผู้')).toHaveLength(4);
    expect(r.code[0].upload.join()).toContain('python3 main.py');
    expect(r.pins.find((p) => p.pin === 'GPIO17')!.label).toContain('ขา 11');
    expect(r.checklist.some((c) => c.text.includes('ไม่มีสายจาก 5V'))).toBe(true);
    const pc = buildProjectReport(pulldownRig().doc, 'pico');
    expect(pc.code[0].upload.join()).toMatch(/BOOTSEL.*Thonny/s);
    expect(pc.power.join()).toContain('3V3 ≤ 300 mA');
  });

  it('กราวด์ไม่ร่วม: Uno กับแหล่งจ่าย DC แยกกราวด์ → รายการตรวจเตือน · ต่อ GND แล้วหาย', () => {
    const b = unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }).part('dcsupply', onTable(-25, 30), 'PS1', { voltage: 9 })
      .part('resistor', onBoard('a20'), 'R9', { resistance: 1000, span: 3 }).wire(P('PS1', 'pos'), H('b20'), 'p1', '#e53935').wire(P('PS1', 'neg'), H('b23'), 'p2', '#212121');
    expect(buildProjectReport(b.doc, 'x').checklist.some((c) => c.text.startsWith('กราวด์ยังไม่ร่วมกัน'))).toBe(true);
    b.wire(H('c23'), H('tn23'), 'p3', '#212121');
    expect(buildProjectReport(b.doc, 'x').checklist.some((c) => c.text.startsWith('กราวด์ยังไม่ร่วมกัน'))).toBe(false);
  });

  it('คำเตือนจากการจำลองที่อันตรายถูกใส่ในรายการตรวจก่อนจ่ายไฟ (Uno: LED ไม่มีตัวต้านทาน → ขา D13 ถึง 40 mA)', { timeout: 30000 }, () => {
    const b = unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex, r: 0.01 });
    const { an } = runUno(b, 0.3, 0.05);
    const d = an.diagnostics.find((x) => x.partId === 'UNO1' && x.severity === 'danger');
    expect(d?.message).toContain('ขา D13');
    const r = buildProjectReport(b.doc, 'x', an.diagnostics);
    expect(r.checklist.some((c) => c.text.startsWith('แก้ก่อนจ่ายไฟ') && c.text.includes('D13'))).toBe(true);
  });

  it('Uno: กระแสขา 20–40 mA → เตือน (R 100 Ω ≈ 24 mA) · ตัวต้านทาน 220 Ω ไม่เตือน', { timeout: 30000 }, () => {
    const w = runUno(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex, r: 100 }), 0.3, 0.05).an.diagnostics.filter((x) => x.partId === 'UNO1');
    expect(w.some((x) => x.severity === 'warn' && x.message.includes('เกินค่าใช้งานที่แนะนำ 20 mA'))).toBe(true);
    const ok = runUno(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }), 0.3, 0.05).an.diagnostics.filter((x) => x.partId === 'UNO1');
    expect(ok).toEqual([]);
  });
});

describe('ตารางต่อขา: ขาที่ต่อถึงกันภายในบอร์ดเท่านั้นไม่นับ', () => {
  it('Uno + LED: มีแค่ D13 และ GND.1 (ไม่รวม GND.2/GND.3, A4/SDA, 5V/IOREF)', () => {
    const r = buildProjectReport(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }).doc, 'x');
    expect(r.pins.map((p) => p.pin)).toEqual(['D13', 'GND.1']);
  });
});
