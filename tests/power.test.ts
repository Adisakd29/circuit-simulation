import { describe, expect, it } from 'vitest';
import inaHex from './fixtures/uno/ina219.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { POWER_METER_CODE } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { setPartParams } from '../src/editor/ops';
import { emptyWork, type StudentWork } from '../src/model/types';
import { ina219ConvTime, Ina219 } from '../src/mcu/i2c-sensors';
import { tmLedCurrent, Tm1637Hub, tmText, tmDuty } from '../src/mcu/tm1637';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { runUno } from './uno-rig';
import { powerRig } from './power-rig';

function runChecked(b: Builder, seconds: number, dt = 0.25, cmd?: (t: number, b: Builder) => boolean | void) {
  const work: StudentWork = emptyWork(); work.achieved.powermeter = {};
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '';
  let an!: ReturnType<typeof analyze>;
  let text = '', iTrue = 0;
  let seg: ReturnType<typeof e.handle>['result']['seg'];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson('powermeter', { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.powermeter[g] = true;
    seg = r.result.seg;
    text = tmText(seg?.DS1);
    iTrue = Math.abs(r.result.elements['INA1#shunt']?.current ?? 0) * 1000;
  }
  return { st, ach: work.achieved.powermeter, con, an, text, iTrue, seg };
}

/** ส่งไบต์ TM1637 ทีละขอบ (ลำดับเดียวกับไลบรารี mcauser: บิตต่ำก่อน, คล็อกที่ 9 = ACK) */
function tmBus(stepS = 1e-6) {
  const hub = new Tm1637Hub();
  let now = 0;
  hub.levels = { v: (net) => (net === 1 ? 3.3 : 0) };
  let clk = true, dio = true;
  hub.drive = (net) => (net === 10 ? clk : net === 11 ? dio : null);
  hub.sync([{ id: 'T', vcc: 1, gnd: 0, clk: 10, dio: 11, vMin: 3, vMax: 5.5 }]);
  const set = (c: boolean, d: boolean) => { clk = c; dio = d; now += stepS; hub.check(0, now); };
  set(true, true);
  const start = () => { set(true, false); set(false, false); };
  const stop = () => { set(false, false); set(true, false); set(true, true); };
  const byte = (b: number) => {
    for (let i = 0; i < 8; i++) { const d = !!((b >> i) & 1); set(false, d); set(true, d); set(false, d); }
    set(true, dio); set(false, dio);
  };
  const frame = (...bytes: number[]) => { start(); for (const b of bytes) byte(b); stop(); };
  return { hub, frame, start, stop, byte, set, st: () => hub.snapshot(0).T };
}

describe('TM1637: อ่านปุ่ม · กระแส LED · เวลาของสัญญาณ (ดาต้าชีต V2.4)', () => {
  it('อ่านปุ่ม (0x42) บนโมดูลที่ไม่มีปุ่ม: ไบต์ข้อมูลปุ่ม = 1111_1111 (DIO ไม่ถูกดึงลงระหว่าง 8 บิต) แล้วยังรับคำสั่งถัดไปได้', () => {
    const t = tmBus(3e-6);
    t.start(); t.byte(0x42);
    let got = 0;
    for (let i = 0; i < 8; i++) { t.set(false, true); t.set(true, true); if (t.hub.driven(11, 0) !== false) got |= 1 << i; }
    t.set(false, true); t.set(true, true); t.set(false, true); t.stop();
    expect(got).toBe(0xff);
    expect(t.st().keyReads).toBe(1);
    t.frame(0x40); t.frame(0xc0, 0x3f); t.frame(0x8f);
    expect(tmText(t.st()).startsWith('0')).toBe(true);
  });
  it('กระแส LED = ส่วนที่ติด × 30 mA × duty ÷ 6: "88:88" ความสว่างสูงสุด (14/16) = 29 ส่วน → ≈ 127 mA · ความสว่าง 0 (1/16) ≈ 9 mA · จอปิด = 0', () => {
    expect(tmLedCurrent(true, 7, [0x7f, 0xff, 0x7f, 0x7f, 0, 0])).toBeCloseTo((29 * 0.03 * 14 / 16) / 6, 9);
    expect(tmLedCurrent(true, 0, [0x7f, 0xff, 0x7f, 0x7f, 0, 0])).toBeCloseTo((29 * 0.03 / 16) / 6, 9);
    expect(tmLedCurrent(false, 7, [0x7f, 0xff, 0x7f, 0x7f, 0, 0])).toBe(0);
    const t = tmBus();
    t.frame(0x40); t.frame(0xc0, 0x06, 0x5b, 0x4f, 0x66); t.frame(0x8f);
    expect(t.st().ledCurrent).toBeCloseTo(tmLedCurrent(true, 7, [0x06, 0x5b, 0x4f, 0x66, 0, 0]), 9);
    expect(t.hub.elements(0).length).toBe(1);
  });
  it('พัลส์ CLK 200 ns (สั้นกว่า 400 ns ตามดาต้าชีต) → บันทึกไว้ให้แอปเตือน · 1 µs ไม่เตือน', () => {
    const fast = tmBus(200e-9); fast.frame(0x40);
    expect(fast.st().minPulse).toBeLessThan(400e-9);
    const ok = tmBus(1e-6); ok.frame(0x40);
    expect(ok.st().minPulse).toBeGreaterThanOrEqual(1e-6 - 1e-12);
  });
});

describe('INA219 (รีจิสเตอร์ตามดาต้าชีต TI SBOS448)', () => {
  // เวลาจำลองเดินเอง: ค่าเริ่ม 12 บิตทั้งสองช่อง = 532 µs + 532 µs ต่อรอบ — ทุกคำสั่ง wr รอให้แปลงเสร็จหนึ่งรอบ (2 ms)
  const dev = (shunt: number, bus: number) => {
    const clk = { t: 0 };
    const d = new Ina219(() => ({ shunt, bus }), () => clk.t);
    clk.t = 0.002;
    const wr = (reg: number, v: number) => { d.begin(false); d.write(reg); d.write(v >> 8); d.write(v & 0xff); d.end(); clk.t += 0.002; };
    const rd = (reg: number) => { d.begin(false); d.write(reg); d.end(); d.begin(true); const hi = d.read(), lo = d.read(); d.end(); return (hi << 8) | lo; };
    return { d, wr, rd, clk };
  };
  it('ค่าเริ่ม config 0x399F · calibration 0 → กระแส/กำลัง 0 · cal 4096 → 0.1 mA ต่อบิต, 2 mW ต่อบิต · บัส 4 mV ต่อบิต + CNVR', () => {
    const { wr, rd } = dev(2e-3, 4.996);
    expect(rd(0)).toBe(0x399f);
    expect(rd(1)).toBe(200);
    expect(rd(4)).toBe(0);
    const bus = rd(2);
    expect(bus >> 3).toBe(1249);
    expect(bus & 2).toBe(2);
    expect(rd(3)).toBe(0);
    expect(rd(2) & 2).toBe(0); // อ่านรีจิสเตอร์ Power ล้าง CNVR (ดาต้าชีต 8.6.3.2)
    wr(5, 4096);
    expect(rd(5)).toBe(4096);
    expect(rd(4)).toBe(200);                  // 200 × 0.1 mA = 20 mA
    expect(rd(3)).toBe(Math.trunc((200 * 1249) / 5000)); // 49 × 2 mW ≈ 98 mW
    wr(5, 4097);
    expect(rd(5)).toBe(4096);                 // บิต 0 ของ calibration เป็น 0 เสมอ
  });
  it('shunt กลับทาง = ค่าลบ (two’s complement) · เกินช่วง PGA → ค้างที่ค่าสูงสุด + OVF · PGA ÷1 (±40 mV) · บิตรีเซ็ต', () => {
    const neg = dev(-5e-3, 3);
    neg.wr(5, 4096);
    expect((neg.rd(1) << 16) >> 16).toBe(-500);
    expect((neg.rd(4) << 16) >> 16).toBe(-500);
    const big = dev(0.5, 12);
    expect(big.rd(1)).toBe(32000);
    expect(big.rd(2) & 1).toBe(1);
    big.wr(0, 0x399f & ~0x1800);             // PGA = /1 (±40 mV)
    expect(big.rd(1)).toBe(4000);
    big.wr(0, 0x8000);
    expect(big.rd(0)).toBe(0x399f);
  });
});

describe('INA219 เวลาแปลงและโหมด (TI SBOS448 Table 4–5)', () => {
  const mk = (shunt: number) => {
    const clk = { t: 0 }, v = { shunt, bus: 5 };
    const d = new Ina219(() => v, () => clk.t);
    const wr = (reg: number, x: number) => { d.begin(false); d.write(reg); d.write(x >> 8); d.write(x & 0xff); d.end(); };
    const rd = (reg: number) => { d.begin(false); d.write(reg); d.end(); d.begin(true); const hi = d.read(), lo = d.read(); d.end(); return (hi << 8) | lo; };
    return { d, wr, rd, clk, v };
  };
  it('เวลาแปลงตามตาราง: 9–12 บิต 84/148/276/532 µs · เฉลี่ย 2–128 ครั้ง 1.06–68.10 ms', () => {
    expect([0, 1, 2, 3, 8].map(ina219ConvTime)).toEqual([84e-6, 148e-6, 276e-6, 532e-6, 532e-6]);
    expect([9, 10, 11, 12, 13, 14, 15].map(ina219ConvTime)).toEqual([1.06e-3, 2.13e-3, 4.26e-3, 8.51e-3, 17.02e-3, 34.05e-3, 68.10e-3]);
  });
  it('ต่อเนื่อง ADC เฉลี่ย 128 ครั้ง (ทั้งสองช่อง ≈ 136 ms/รอบ): ค่า shunt ใหม่เห็นหลังรอบถัดไปจบ · CNVR ตั้งเมื่อจบรอบ', () => {
    const { wr, rd, clk, v } = mk(1e-3);
    wr(0, 0x399f | (0xf << 7) | (0xf << 3)); // BADC = SADC = 128 ครั้ง, shunt+bus ต่อเนื่อง
    clk.t = 0.130; expect(rd(1)).toBe(0); expect(rd(2) & 2).toBe(0);
    clk.t = 0.137; expect(rd(1)).toBe(100); expect(rd(2) & 2).toBe(2);
    v.shunt = 2e-3; clk.t = 0.200; expect(rd(1)).toBe(100);
    clk.t = 0.273; expect(rd(1)).toBe(200);
  });
  it('triggered (shunt+bus): เขียน config เริ่มแปลงหนึ่งครั้ง (12 บิต 1.064 ms) แล้วค่าค้าง · เขียน config ซ้ำ = สั่งแปลงใหม่ · power-down ค่าเดิมยังอ่านได้', () => {
    const { wr, rd, clk, v } = mk(1e-3);
    wr(0, (0x399f & ~7) | 3);
    clk.t = 0.0010; expect(rd(2) & 2).toBe(0);
    clk.t = 0.0011; expect(rd(1)).toBe(100); expect(rd(2) & 2).toBe(2);
    v.shunt = 3e-3; clk.t = 1.0; expect(rd(1)).toBe(100); // ไม่แปลงเองอีก
    wr(0, (0x399f & ~7) | 3); expect(rd(2) & 2).toBe(0);
    clk.t = 1.0011; expect(rd(1)).toBe(300);
    wr(0, 0x399f & ~7); clk.t = 2; expect(rd(1)).toBe(300);
  });
});

describe('TM1637 (ถอดรหัสจากระดับขา CLK/DIO)', () => {
  it('คำสั่งตั้งข้อมูล + ที่อยู่ + ข้อมูล 4 หลัก + ควบคุมจอ → ตัวเลขบนจอ, โคลอน, ความสว่าง · ACK ดึง DIO ลงที่คล็อกที่ 9', () => {
    const t = tmBus();
    t.frame(0x40);
    t.frame(0xc0, 0x06, 0x5b | 0x80, 0x4f, 0x66);
    expect(t.st().on).toBe(false);
    expect(tmText(t.st())).toBe('');
    t.frame(0x88 | 3);
    expect(t.st()).toMatchObject({ powered: true, on: true, brightness: 3, cmds: 3, dataBytes: 4, partial: 0 });
    expect(tmText(t.st())).toBe('12:34');
    expect(tmDuty(3)).toBeCloseTo(10 / 16);
    // ACK: หลังขอบลงของคล็อกที่ 8 ชิปดึง DIO ลง (ขา MCU ปล่อยเป็นขาเข้า)
    t.start();
    for (let i = 0; i < 8; i++) { t.set(false, true); t.set(true, true); t.set(false, true); }
    expect(t.hub.driven(11, 0)).toBe(false);
    t.set(true, true); t.set(false, true);
    expect(t.hub.driven(11, 0)).toBeNull();
    t.stop();
  });
  it('ที่อยู่คงที่ (0x44) เขียนหลักเดียว · ไบต์ถูกตัดกลางคันนับไว้ · ปิดจอ (0x80) · ไม่มีไฟเลี้ยง = ดับและล้างหน่วยความจำ', () => {
    const t = tmBus();
    t.frame(0x40); t.frame(0xc0, 0x3f, 0x3f, 0x3f, 0x3f); t.frame(0x8f);
    expect(tmText(t.st())).toBe('0000');
    t.frame(0x44); t.frame(0xc2, 0x06, 0x5b);
    expect(tmText(t.st())).toBe('0020'); // ที่อยู่ไม่เลื่อน: ไบต์ที่สองทับหลักที่ 3
    t.start(); for (let i = 0; i < 3; i++) { t.set(false, true); t.set(true, true); t.set(false, true); } t.stop();
    expect(t.st().partial).toBe(1);
    t.frame(0x80);
    expect(t.st().on).toBe(false);
    t.hub.levels = { v: () => 0 };
    t.hub.check(0);
    expect(t.st()).toMatchObject({ powered: false, on: false });
    t.hub.levels = { v: (net) => (net === 1 ? 3.3 : 0) };
    t.hub.check(0);
    expect(t.st().ram).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('แลป 49 เครื่องวัดกำลังไฟฟ้า (Pico + INA219 + TM1637)', () => {
  it('คลัง/ระดับการรองรับ/รูปวงจร/บันทึกไฟล์', () => {
    const l = LESSONS.find((x) => x.id === 'powermeter')!;
    expect(l.number).toBe(49);
    expect(l.sampleCode).toBe(POWER_METER_CODE);
    expect(SCHEMATICS.powermeter).toBeDefined();
    for (const k of ['ina219', 'tm1637']) expect(supportSummary(SUPPORT[k]).text, k).toBe('จำลองครบ');
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(powerRig().doc)), errs, []), errs.join()).not.toBeNull();
  });

  it('โค้ดตัวอย่าง: scan พบ 0x40 · Serial แสดง V/I/P · จอแสดงกระแสตรงกับกระแสจริง · เปลี่ยน R เป็น 330 Ω → ค่าใหม่ · ผ่านครบ 5 ข้อ', { timeout: 300000 }, () => {
    const r = runChecked(powerRig(), 5, 0.25, (t, b) => {
      if (Math.abs(t - 2.75) < 1e-6) { const x = setPartParams(b.doc, 'R1', { resistance: 330 }); if (x.ok) b.doc = x.doc; return true; }
    });
    expect(r.con).toContain("I2C: ['0x40']");
    const m = /V=(\d+\.\d+) V  I=(\d+\.\d) mA  P=(\d+) mW  Vshunt=(\d+\.\d+) mV/.exec(r.con)!;
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(4.996, 2);
    expect(Number(m[2])).toBeGreaterThan(19);
    expect(Number(m[3])).toBeCloseTo(Number(m[1]) * Number(m[2]), -1);
    expect(Number(m[4])).toBeCloseTo(Number(m[2]) * 0.1, 1);
    expect(r.iTrue).toBeGreaterThan(8);
    expect(r.iTrue).toBeLessThan(10.5);
    expect(Number(r.text.trim())).toBe(Math.round(r.iTrue));
    for (const g of ['wire', 'bus', 'display', 'current', 'change']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(r.seg?.DS1.brightness).toBe(5);
  });

  it('ลืม calibration → กระแส 0 + แจ้ง · สลับ VIN+/VIN− → ค่าลบ + แจ้ง · ไม่ต่อไฟเลี้ยง INA219 → ไม่ตอบ (OSError) · ไม่ต่อ TM1637 → display ไม่ผ่าน', { timeout: 300000 }, () => {
    const nocal = runChecked(powerRig({ code: POWER_METER_CODE.replace('wr(0x05, 4096)', 'pass') }), 2);
    expect(nocal.con).toContain('I=0.0 mA');
    expect(nocal.text.trim()).toBe('0');
    expect(nocal.an.diagnostics.some((d) => d.partId === 'INA1' && d.message.includes('calibration'))).toBe(true);
    expect(nocal.ach.bus ?? false).toBe(false);
    // สลับ VIN+/VIN−: แหล่งจ่ายเข้า VIN− (ย้ายสาย VBUS ไป g34 และสายโหลดไป h35)
    const b = powerRig();
    b.doc = { ...b.doc, wires: b.doc.wires.map((w) => (w.id === 'wvbus' ? { ...w, b: H('g34') } : w.id === 'wload' ? { ...w, a: H('h35') } : w)) };
    const rev = runChecked(b, 2);
    expect(rev.con).toMatch(/I=-\d+\.\d mA/);
    expect(rev.an.diagnostics.some((d) => d.partId === 'INA1' && d.message.includes('กลับทาง'))).toBe(true);
    const nov = runChecked(powerRig({ inaVcc: 'none' }), 2);
    expect(nov.con).toContain('I2C: []');
    expect(nov.con).toMatch(/OSError/);
    const notm = runChecked(powerRig({ skip: ['tm'] }), 2);
    expect(notm.st.wire.detail).toContain('TM1637');
  });
});

describe('Uno: I²C ผ่าน TWI (A4 = SDA, A5 = SCL)', () => {
  const rig = (ina: boolean) => {
    const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: 'x', hex: inaHex, hexSrc: 'x' });
    if (ina) b.part('ina219', onBoard('j10'), 'INA1', {})
      .wire(P('UNO1', '5V'), H('f10'), 'a').wire(P('UNO1', 'GND.2'), H('f11'), 'b', '#212121').wire(P('UNO1', 'A5'), H('f12'), 'c').wire(P('UNO1', 'A4'), H('f13'), 'd')
      .wire(P('UNO1', 'IOREF'), H('f15'), 'e').part('resistor', onBoard('g14'), 'R1', { resistance: 220, span: 4 }).wire(H('h18'), P('UNO1', 'GND.3'), 'f', '#212121');
    return b;
  };
  it('Wire.h สแกนพบ 0x40 แล้วอ่านแรงดันบัส/กระแสจาก INA219 ตรงกับวงจร (5 V / 220 Ω ≈ 22.7 mA) · ไม่มีอุปกรณ์ → สแกนไม่พบ', { timeout: 120000 }, () => {
    const r = runUno(rig(true), 1.0, 0.05);
    expect(r.con).toContain('I2C: 0x40\r\n');
    expect(r.con).toMatch(/V=4996 mV I=22\.7 mA/);
    const none = runUno(rig(false), 0.5, 0.05);
    expect(none.con).toContain('I2C:\r\n');
    expect(none.con).not.toContain('22.7');
  });
});
