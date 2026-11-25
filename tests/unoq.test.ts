import { describe, expect, it } from 'vitest';
import adcHex from './fixtures/uno/unoq-adc.hex?raw';
import lcdHex from './fixtures/uno/unoq-lcdi2c.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { charLcdText } from '../src/mcu/i2c-sensors';
import { validateCircuit } from '../src/model/schema';
import { pinDefs } from '../src/model/catalog';
import { UNOQ_UNSUPPORTED } from '../server/compile.mjs';
import { Builder, H, P, onBoard, onTable } from './helpers';

const enc = (s: string) => [...new TextEncoder().encode(s)];

/** UNO Q บนโต๊ะ + LED แดง 220 Ω จากขา D13 (b5) ลง GND (tn) · ขา GND.1 → tn3 */
function rig(o: { hex?: string | null; vA0?: number; d2gnd?: boolean } = {}) {
  const b = new Builder().part('unoq', onTable(-50, -2), 'UNOQ1', { hex: o.hex ?? null, hexSrc: 'x', code: 'x' })
    .part('resistor', onBoard('a5'), 'R1', { resistance: 220, span: 3 }).part('led', onBoard('c8'), 'LED1')
    .wire(P('UNOQ1', 'D13'), H('b5'), 'w1', '#43a047').wire(H('e9'), H('tn9'), 'w2', '#212121').wire(P('UNOQ1', 'GND.1'), H('tn3'), 'w3', '#212121');
  if (o.vA0 !== undefined) {
    b.part('dcsupply', onTable(0, 0), 'PS1', { voltage: o.vA0, currentLimit: 0.1 })
      .wire(P('PS1', 'pos'), P('UNOQ1', 'A0'), 'wa', '#fdd835').wire(P('PS1', 'neg'), H('tn4'), 'wan', '#212121');
  }
  if (o.d2gnd) b.wire(P('UNOQ1', 'D2'), H('tn6'), 'wd2', '#212121');
  return b;
}

function run(b: Builder, seconds: number, dt = 0.05, cmds?: (k: number) => Record<string, unknown> | undefined) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  let con = '';
  let an!: ReturnType<typeof analyze>;
  let last!: ReturnType<SimEngine['handle']>;
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const extra = cmds?.(k);
    last = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(extra ? { mcu: extra as never } : {}) });
    con += last.mcu?.find((x) => x.id === 'UNOQ1')?.console ?? '';
    an = analyze(doc, built, last.result, last.tones);
  }
  return { con, an, r: last, built, doc };
}

describe('Arduino UNO Q — โหมดจำลองพฤติกรรม (ไฟฟ้าขา 3.3 V ของ STM32U585)', () => {
  it('ขาออก HIGH = 3.3 V (ไม่ใช่ 5 V แบบ Uno R3): LED แดง + 220 Ω ได้กระแสตามแรงดัน 3.3 V · ADC อ้างอิง 3.3 V · INPUT_PULLUP · Serial', { timeout: 60000 }, () => {
    // adc.ino: D13 = !D2 (D2 INPUT_PULLUP) · พิมพ์ analogRead(A0) ทุก 100 ms · echo Serial
    const lo = run(rig({ hex: adcHex, vA0: 1.65, d2gnd: true }), 0.8, 0.05, (k) => (k === 6 ? { UNOQ1: { serial: enc('hi\n') } } : undefined));
    const vals = [...lo.con.matchAll(/A0=(\d+)/g)].map((m) => Number(m[1]));
    expect(vals.length).toBeGreaterThanOrEqual(5);
    // 1.65 V / 3.3 V × 1023 ≈ 512 (บน Uno R3 จะได้ ≈ 338)
    expect(Math.abs(vals.at(-1)! - 512)).toBeLessThan(8);
    expect(lo.con).toContain('hi<ok>');
    const st = lo.r.mcu!.find((m) => m.id === 'UNOQ1')!;
    expect(st.pins[2]).toBe('in-pullup');
    expect(st.pins[13]).toBe('out-high');
    const i = lo.an.parts.LED1.current;
    // (3.3 − Vf≈1.9 V) / (220 + ≈50 Ω) ≈ 5 mA — บน Uno R3 (5 V) ได้ ≈ 12.5 mA
    expect(i).toBeGreaterThan(0.0035);
    expect(i).toBeLessThan(0.0065);
    // ขาเข้าลอย + pull-up → HIGH → LED ดับ
    const hi = run(rig({ hex: adcHex, vA0: 0.825 }), 0.5);
    expect(hi.r.mcu!.find((m) => m.id === 'UNOQ1')!.pins[13]).toBe('out-low');
    const v2 = [...hi.con.matchAll(/A0=(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.abs(v2.at(-1)! - 256)).toBeLessThan(8);
  });

  it('ตรวจแรงดันเกินตามขา: A0 ทนได้ 3.6 V (5 V = อันตราย) · D2 ทน 5 V (ไม่เตือน) · ไม่ทำให้บอร์ดอื่นเตือนผิด', { timeout: 30000 }, () => {
    const a0 = run(rig({ hex: adcHex, vA0: 5 }), 0.2);
    expect(a0.an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ขา A0') && d.message.includes('3.6 V'))).toBe(true);
    const ok = run(rig({ hex: adcHex, vA0: 3.3 }), 0.2);
    expect(ok.an.diagnostics.filter((d) => d.severity === 'danger')).toEqual([]);
    // 5 V ที่ D2 (ขาเข้าทน 5 V): ไม่มีคำเตือนแรงดันเกิน
    const b = rig({ hex: adcHex }).part('dcsupply', onTable(0, 0), 'PS2', { voltage: 5, currentLimit: 0.1 })
      .wire(P('PS2', 'pos'), P('UNOQ1', 'D2'), 'wd', '#fdd835').wire(P('PS2', 'neg'), H('tn4'), 'wdn', '#212121');
    const d2 = run(b, 0.2);
    expect(d2.an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ขา D2'))).toBe(false);
  });

  it('กระแสขาเกิน 20 mA (LED ไม่มีตัวต้านทาน) → อันตราย · ขาออกถูกจำกัดที่ 20 mA', { timeout: 30000 }, () => {
    const b = new Builder().part('unoq', onTable(-50, -2), 'UNOQ1', { hex: adcHex, hexSrc: 'x', code: 'x' }).part('led', onBoard('c8'), 'LED1')
      .wire(P('UNOQ1', 'D13'), H('a8'), 'w1').wire(H('e9'), H('tn9'), 'w2', '#212121').wire(P('UNOQ1', 'GND.1'), H('tn3'), 'w3', '#212121')
      .wire(P('UNOQ1', 'D2'), H('tn6'), 'wd2', '#212121');
    const r = run(b, 0.3);
    expect(r.an.parts.LED1.current).toBeLessThan(0.0201);
    expect(r.an.parts.LED1.current).toBeGreaterThan(0.015);
    expect(r.an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ขา D13') && d.message.includes('20 mA'))).toBe(true);
  });

  it('I²C: Wire ใช้หัวต่อ SDA/SCL — จอ LCD I²C ที่ SDA/SCL แสดงข้อความ · ต่อที่ A4/A5 แบบ Uno R3 = ไม่ตอบ (NACK) + คำเตือนให้ย้ายสาย', { timeout: 60000 }, () => {
    const lcd = (sda: string, scl: string) => new Builder().part('unoq', onTable(-50, -2), 'UNOQ1', { hex: lcdHex, hexSrc: 'x', code: 'x' })
      .part('lcd1602', onTable(0, -30), 'LCD1', { pullUps: true })
      .wire(P('LCD1', 'GND'), P('UNOQ1', 'GND.2'), 'wg', '#212121').wire(P('LCD1', 'VCC'), P('UNOQ1', '5V'), 'wv')
      .wire(P('LCD1', 'SDA'), P('UNOQ1', sda), 'wsda', '#1e88e5').wire(P('LCD1', 'SCL'), P('UNOQ1', scl), 'wscl', '#fdd835');
    const good = run(lcd('SDA', 'SCL'), 0.8, 0.1);
    expect(good.con).toContain('LCD ACK');
    expect(charLcdText(good.r.result.i2c?.LCD1?.lcd)[0]).toContain('UNO Q I2C');
    expect(good.an.diagnostics.filter((d) => d.severity === 'danger')).toEqual([]);
    const bad = run(lcd('A4', 'A5'), 0.8, 0.1);
    expect(bad.con).toContain('LCD NACK');
    expect(charLcdText(bad.r.result.i2c?.LCD1?.lcd).join('')).not.toContain('UNO Q');
    expect(bad.an.diagnostics.some((d) => d.severity === 'warn' && d.message.includes('หัวต่อ SDA/SCL'))).toBe(true);
  });

  it('RESET เริ่มสเก็ตช์ใหม่ · millis() เดินตามเวลาจำลอง · Serial ไม่ออกขา D0/D1 (D1 ไม่ถูกบังคับ HIGH แบบ Uno R3)', { timeout: 30000 }, () => {
    const r = run(rig({ hex: adcHex, vA0: 1 }), 1.0, 0.05, (k) => (k === 12 ? { UNOQ1: { reset: true } } : undefined));
    const st = r.r.mcu!.find((m) => m.id === 'UNOQ1')!;
    expect(st.pins[1]).not.toBe('out-high');
    // ทุก 100 ms: 0.6 s ก่อนรีเซ็ต + 0.4 s หลัง ≈ 9–11 บรรทัด
    const n = (r.con.match(/A0=/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(12);
  });

  it('ขาและไฟล์งาน: ชื่อขาเหมือน UNO (ใส่ shield ได้) + ป้ายบอกพิกัด · SDA/SCL แยกจาก A4/A5 · schema ตรวจ usbLimit', () => {
    const b = rig();
    const q = b.doc.parts.find((p) => p.id === 'UNOQ1')!;
    const defs = pinDefs(q);
    expect(defs.find((d) => d.name === 'A0')!.label).toContain('3.6');
    expect(defs.find((d) => d.name === 'SDA')!.label).toContain('D20');
    const nl = buildNetlist(b.doc).netlist;
    const m = nl.mcus![0];
    expect(m.board).toBe('unoq');
    expect(m.twi![0]).not.toBe(m.gp[18]);
    const errs: string[] = [], warns: string[] = [];
    expect(validateCircuit(b.doc, errs, warns)).not.toBeNull();
    expect(errs).toEqual([]);
    const bad = { ...b.doc, parts: b.doc.parts.map((p) => (p.id === 'UNOQ1' ? { ...p, params: { ...p.params, usbLimit: 9 } } : p)) };
    const e2: string[] = [];
    validateCircuit(bad, e2, []);
    expect(e2.some((e) => e.includes('usbLimit'))).toBe(true);
  });

  it('บริการคอมไพล์ปฏิเสธคำสั่งเฉพาะ UNO Q ที่ไม่ได้จำลอง (Bridge, LED matrix, Wire1/Wire2, Serial1, analogReadResolution)', () => {
    const src = ['Bridge.call("x");', '#include <Arduino_LED_Matrix.h>', 'Wire1.begin();', 'Wire2.begin();', 'Serial1.begin(9600);', 'analogReadResolution(14);'];
    for (const s of src) expect(UNOQ_UNSUPPORTED.some(([re]) => re.test(s)), s).toBe(true);
    for (const s of ['Wire.begin();', 'Serial.begin(115200);', 'analogRead(A0);']) expect(UNOQ_UNSUPPORTED.some(([re]) => re.test(s)), s).toBe(false);
  });
});
