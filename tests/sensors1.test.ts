import { describe, expect, it } from 'vitest';
import unoHex from './fixtures/uno/sensors1.hex?raw';
import unoSrc from './fixtures/uno/sensors1.ino?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setPartParams } from '../src/editor/ops';
import { catalogEntry, pinDefs } from '../src/model/catalog';
import { validateCircuit } from '../src/model/schema';
import { SUPPORT } from '../src/model/support';
import type { PartKind } from '../src/model/types';
import {
  FSR_TABLE, SENSOR_KINDS, fsrResistance, hallOn, magnetGauss, micPeak, mq2PpmFromRatio, mq2Ratio, reedClosed, waterRatio,
} from '../src/model/sensors';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { big, picoRig, unoRig } from './sensors1-rig';

/**
 * เซนเซอร์ชุด 1 (รอบ 87): ทดสอบทั้งสามระดับ
 * 1) ค่าแบบจำลองตรงแหล่งอ้างอิง (ตาราง FSR ของ Adafruit, เส้นโค้ง MQ-2, สนามแม่เหล็ก, ระดับน้ำ)
 * 2) วงจรภายในโมดูล LM393 (แหล่งจ่าย 5 V / 3.3 V): DO/AO, LED, กระแสฮีตเตอร์, คำเตือน
 * 3) ต่อกับบอร์ดแล้วรันโค้ดจริง: MicroPython บน Pico (3.3 V) และ C++ บน Uno (5 V คอมไพล์ด้วย avr-gcc → tests/fixtures/uno/sensors1.hex)
 */

function dcRig(kind: PartKind, params: Record<string, unknown>, V = 5) {
  const b = big().part('dcsupply', onTable(-40, 0), 'PS1', { voltage: V, currentLimit: 1 }).part(kind, onBoard('j10'), 'U1', params);
  b.wire(P('PS1', 'pos'), H('bp10'), 'w1').wire(P('PS1', 'neg'), H('bn11'), 'w2');
  if (kind === 'touch') b.wire(H('i10'), H('bn10'), 'a').wire(H('i11'), H('bp12'), 'b');
  else b.wire(H('i10'), H('bp9'), 'a').wire(H('i11'), H('bn9'), 'b');
  return b;
}
function dc(b: Builder, seconds = 0.01) {
  const built = buildNetlist(b.doc);
  const r = new SimEngine().handle({ seq: 1, netlist: built.netlist, advance: seconds, restart: true, watch: [], budgetMs: 1e9 });
  expect(r.result.ok).toBe(true);
  const an = analyze(b.doc, built, r.result, r.tones);
  return { an, x: an.parts.U1.extra!, i: an.parts.U1.current, d: an.diagnostics.filter((d) => d.partId === 'U1').map((d) => d.message).join(' | ') };
}

describe('เซนเซอร์ชุด 1: ค่าแบบจำลองเทียบแหล่งอ้างอิง', () => {
  it('FSR 402 ตรงตาราง Adafruit ทุกจุด (0.2 N 30 kΩ · 1 N 6 kΩ · 10 N 1 kΩ · 100 N 250 Ω) · ไม่กด = เปิดวงจร · ระหว่างจุดลดลงทางเดียว', () => {
    for (const [f, r] of FSR_TABLE) expect(fsrResistance(f) / r).toBeCloseTo(1, 6);
    expect(fsrResistance(0)).toBeGreaterThan(1e7);
    let prev = Infinity;
    for (let f = 0.1; f <= 100; f *= 1.3) { const r = fsrResistance(f); expect(r).toBeLessThan(prev); prev = r; }
    // ตารางเดียวกัน: ตัวแบ่งแรงดันกับ 10 kΩ ที่ 5 V → 1.3 / 3.1 / 4.5 / 4.9 V
    const vOut = (f: number) => (5 * 10e3) / (10e3 + fsrResistance(f));
    expect(vOut(0.2)).toBeCloseTo(1.25, 1); expect(vOut(1)).toBeCloseTo(3.1, 1); expect(vOut(10)).toBeCloseTo(4.5, 1); expect(vOut(100)).toBeCloseTo(4.9, 1);
  });

  it('MQ-2: Rs/Ro ที่ 200 ppm = 10^y ตามเส้นโค้ง (LPG 1.62 · ควัน 3.39 · CO 5.25) · 10,000 ppm LPG = 10^−0.59 · อากาศสะอาด 9.83 · คำนวณกลับได้ ppm เดิม', () => {
    // จุดอ้างอิงของเส้นโค้งคือ x = 2.3 (≈ log10 200)
    expect(mq2Ratio('lpg', 10 ** 2.3)).toBeCloseTo(10 ** 0.21, 9);
    expect(mq2Ratio('smoke', 10 ** 2.3)).toBeCloseTo(10 ** 0.53, 9);
    expect(mq2Ratio('co', 10 ** 2.3)).toBeCloseTo(10 ** 0.72, 9);
    expect(mq2Ratio('lpg', 200)).toBeCloseTo(1.62, 2);
    expect(Math.log10(mq2Ratio('lpg', 10000))).toBeCloseTo(0.21 - 0.47 * (4 - 2.3), 6);
    expect(mq2Ratio('lpg', 0)).toBe(9.83);
    for (const p of [300, 1000, 5000]) expect(mq2PpmFromRatio('lpg', mq2Ratio('lpg', p))).toBeCloseTo(p, 3);
  });

  it('แม่เหล็ก Ø10 × 3 mm: สนามบนแกนลดลงตามระยะ (5 mm ≈ 845 G · 10 mm ≈ 234 G) · ขั้วเหนือติดลบ · A3144 มีฮิสเทอรีซิส · รีดทำงาน/ปล่อยตามระยะ', () => {
    expect(magnetGauss(5)).toBeCloseTo(845, -1);
    expect(magnetGauss(10)).toBeCloseTo(234, -1);
    expect(magnetGauss(5, 'N')).toBeLessThan(0);
    const h = { magnet: true, pole: 'S' as const, bop: 200, brp: 145 };
    // ระยะ 11 mm ≈ 186 G: อยู่ระหว่าง BRP และ BOP → คงสถานะเดิม
    expect(hallOn({ ...h, distance: 11, on: false })).toBe(false);
    expect(hallOn({ ...h, distance: 11, on: true })).toBe(true);
    expect(hallOn({ ...h, distance: 8, on: false })).toBe(true);
    expect(hallOn({ ...h, distance: 14, on: true })).toBe(false);
    expect(hallOn({ ...h, distance: 3, pole: 'N', on: false })).toBe(false);
    const r = { magnet: true, operate: 10, release: 14 };
    expect(reedClosed({ ...r, distance: 12, closed: false })).toBe(false);
    expect(reedClosed({ ...r, distance: 12, closed: true })).toBe(true);
    expect(reedClosed({ ...r, distance: 5, closed: false })).toBe(true);
    expect(reedClosed({ ...r, magnet: false, distance: 1, closed: true })).toBe(false);
  });

  it('ระดับน้ำ: แห้ง 0 · จุ่มเต็ม 0.51·VCC (≈ 521/1023 ที่ 5 V) · ไมค์ −48 dBV/Pa ที่ 94 dB SPL ยอดคลื่น ≈ 5.6 mV', () => {
    expect(waterRatio({ level: 0, fullRatio: 0.51 })).toBe(0);
    expect(waterRatio({ level: 100, fullRatio: 0.51 })).toBeCloseTo(0.51, 9);
    expect(waterRatio({ level: 50, fullRatio: 0.51 })).toBeGreaterThan(0.3);
    expect(micPeak({ level: 94, sensitivity: -48 })).toBeCloseTo(Math.SQRT2 * 10 ** (-48 / 20) * 1.0024, 4);
  });

  it('ทุกชนิดมีในคลัง ขาครบ ระดับการรองรับ "บางส่วน" ในพฤติกรรม (แบบจำลองเพื่อการสอน) และบันทึก/เปิดไฟล์ได้', () => {
    const b = big();
    SENSOR_KINDS.forEach((k, i) => {
      const e = catalogEntry(k)!;
      expect(e, k).toBeTruthy();
      expect(e.supported, k).toBe(true);
      expect(SUPPORT[k]?.behavior, k).toBe('partial');
      expect(SUPPORT[k]?.tested, k).toBe('full');
      b.part(k, onBoard(`${i < 6 ? "j" : "a"}${2 + (i % 6) * 10}`), `S${i}`);
      expect(pinDefs(b.doc.parts.at(-1)!).length, k).toBeGreaterThanOrEqual(2);
    });
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const bad = JSON.parse(JSON.stringify(b.doc));
    bad.parts.find((p: { kind: string }) => p.kind === 'mq2').params.gas = 'h2';
    const e2: string[] = [];
    validateCircuit(bad, e2, []);
    expect(e2.join()).toContain('gas');
  });
});

describe('เซนเซอร์ชุด 1: วงจรในโมดูล (แหล่งจ่าย DC)', () => {
  it('เปลวไฟ: ไม่มีไฟ AO = VCC DO สูง LED DO ดับ · ไฟ 30 cm (อ้างอิง 50 cm) AO = VCC/3.78 DO ต่ำ LED ติด · 80 cm ไม่ถึงจุดตัด · ใช้ 3.3 V ได้ผลตามสัดส่วน', () => {
    let r = dc(dcRig('flame', {}));
    expect(r.x.vao).toBeCloseTo(5, 2); expect(r.x.vdo).toBeCloseTo(5, 1); expect(r.x.ledDo).toBe(0); expect(r.x.ledPower).toBe(1);
    r = dc(dcRig('flame', { flame: true, distance: 30 }));
    expect(r.x.vao).toBeCloseTo(5 / (1 + (50 / 30) ** 2), 2); expect(r.x.vdo).toBeLessThan(0.4); expect(r.x.ledDo).toBe(1);
    r = dc(dcRig('flame', { flame: true, distance: 80 }));
    expect(r.x.low).toBe(0);
    r = dc(dcRig('flame', { flame: true, distance: 30 }, 3.3));
    expect(r.x.vao).toBeCloseTo(3.3 / (1 + (50 / 30) ** 2), 2); expect(r.x.low).toBe(1);
    // แดดจัด: ไม่มีไฟก็ตรวจผิดได้ (E = 4 → AO = VCC/5)
    r = dc(dcRig('flame', { sunlight: true }));
    expect(r.x.vao).toBeCloseTo(1, 2); expect(r.x.low).toBe(1);
  });

  it('MQ-2: ฮีตเตอร์ 29 Ω กิน 172 mA ที่ 5 V · อากาศสะอาด AO 0.24 V · 1,000 ppm 1.98 V ยังไม่ถึงจุดตัด 40% · 5,000 ppm 2.92 V DO ต่ำ · ใช้ 3.3 V → เตือนฮีตเตอร์', () => {
    let r = dc(dcRig('mq2', {}));
    expect(r.x.heater).toBeCloseTo(5 / 29, 2); expect(r.i).toBeGreaterThan(0.17); expect(r.x.vao).toBeCloseTo(0.242, 2);
    r = dc(dcRig('mq2', { ppm: 1000 }));
    expect(r.x.vao).toBeCloseTo(1.98, 1); expect(r.x.low).toBe(0);
    r = dc(dcRig('mq2', { ppm: 5000 }));
    expect(r.x.vao).toBeCloseTo(2.92, 1); expect(r.x.low).toBe(1); expect(r.x.ledDo).toBe(1);
    r = dc(dcRig('mq2', { ppm: 1000 }, 3.3));
    expect(r.d).toContain('ฮีตเตอร์ MQ-2 ต้องการ 5.0');
  });

  it('ฝน · ตรวจเส้น · สั่นสะเทือน: แห้ง/ขาว/นิ่ง และ เปียก/ดำ/สั่น ให้ DO ตามเอกสาร · LED อินฟราเรด TCRT5000 กินกระแสจริง', () => {
    expect(dc(dcRig('rainsensor', {})).x.low).toBe(0);
    const wet = dc(dcRig('rainsensor', { wet: 50 }));
    expect(wet.x.low).toBe(1); expect(wet.x.vao).toBeCloseTo((5 * 4000) / 14000, 2);
    const white = dc(dcRig('linetrack', { surface: 'white' }));
    expect(white.x.low).toBe(1); expect(white.x.ledIr).toBeGreaterThan(0.015);
    expect(dc(dcRig('linetrack', { surface: 'black' })).x.low).toBe(0);
    expect(dc(dcRig('linetrack', { surface: 'white', height: 15 })).x.low).toBe(0);
    expect(dc(dcRig('vibsensor', {})).x.low).toBe(1);
    expect(dc(dcRig('vibsensor', { vibrating: true })).x.low).toBe(0);
  });

  it('เสียง: เงียบ DO สูง · เสียง 110 dB 500 Hz → AO แกว่ง ±35.6 mV รอบ VCC/2 และ DO ต่ำเป็นพัลส์ตามคลื่นเสียง (≈ 500 ครั้ง/วินาที)', () => {
    const b = dcRig('soundsensor', { sound: true, level: 110, frequency: 500 });
    const built = buildNetlist(b.doc), e = new SimEngine();
    let lows = 0, prevLow = false, vmin = 9, vmax = 0;
    for (let k = 0; k < 200; k++) {
      const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.0001, restart: k === 0, watch: [], budgetMs: 1e9 });
      const x = analyze(b.doc, built, r.result, r.tones).parts.U1.extra!;
      if (x.low && !prevLow) lows++;
      prevLow = !!x.low; vmin = Math.min(vmin, x.vao); vmax = Math.max(vmax, x.vao);
    }
    // 20 ms ที่ 500 Hz = 10 คาบ → DO ลงต่ำ 10 ครั้ง (นับขอบ ± 1)
    expect(lows).toBeGreaterThanOrEqual(9); expect(lows).toBeLessThanOrEqual(11);
    expect(vmax - 2.5).toBeCloseTo(micPeak({ level: 110, sensitivity: -48 }), 3);
    expect(2.5 - vmin).toBeCloseTo(micPeak({ level: 110, sensitivity: -48 }), 3);
    expect(dc(dcRig('soundsensor', {})).x.low).toBe(0);
  });

  it('TTP223: โหมดเริ่มต้น แตะ = VCC · active-low กลับระดับ · โหมดสลับใช้สถานะ toggled · ใช้ไฟ 5 V แล้วต่อขา Pico → อันตราย', () => {
    expect(dc(dcRig('touch', {})).x.vout).toBeCloseTo(0, 3);
    expect(dc(dcRig('touch', { touched: true })).x.vout).toBeCloseTo(5, 2);
    expect(dc(dcRig('touch', { touched: true, activeLow: true })).x.vout).toBeCloseTo(0, 3);
    expect(dc(dcRig('touch', { toggleMode: true, toggled: true })).x.vout).toBeCloseTo(5, 2);
    expect(dc(dcRig('touch', { toggleMode: true, toggled: false, touched: true })).x.vout).toBeCloseTo(0, 3);
  });

  it('ต่อขาออกของโมดูลที่ใช้ไฟ 5 V เข้าขา Pico ตรงๆ → คำเตือนอันตราย (DO ดึงขึ้นถึง 5 V) · ใช้ไฟ 3V3 → ไม่เตือน', () => {
    for (const vcc of ['VBUS', '3V3'] as const) {
      const b = big().part('pico', onBoard('h1'), 'PICO1', { code: '', autorun: false }).part('flame', onBoard('j30'), 'U1', {});
      const col = (pin: string) => Number(pinHolesFor(b.doc.parts[0]).find((x) => x.pin === pin)!.hole!.slice(1));
      b.wire(H(`b${col(vcc)}`), H('g30'), 'wv').wire(H(`b${col('GND.23')}`), H('tn24'), 'wg').wire(H('tn23'), H('bn23'), 'wgg').wire(H('i31'), H('bn32'), 'wg2')
        .wire(H(`j${col('GP15')}`), H('h32'), 'wo');
      const r = dc(b, 0.05);
      if (vcc === 'VBUS') expect(r.an.diagnostics.some((d) => d.severity === 'danger' && d.partId === 'U1' && d.message.includes('GP15'))).toBe(true);
      else expect(r.an.diagnostics.filter((d) => d.partId === 'U1' && d.severity === 'danger')).toEqual([]);
    }
  });
});

/* ======================= Pico + MicroPython ======================= */

function runMcu(b: Builder, id: string, seconds: number, dt: number, cmd?: (t: number) => Record<string, Record<string, unknown>> | void) {
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let con = '';
  const marks: Array<{ t: number; at: number }> = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    const ch = cmd?.(t);
    if (ch) {
      for (const [pid, prm] of Object.entries(ch)) { const r = setPartParams(b.doc, pid, prm); if (!r.ok) throw new Error(r.errors.join()); b.doc = r.doc; }
      built = buildNetlist(b.doc);
      marks.push({ t, at: con.length });
    }
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === id)?.console ?? '';
  }
  return { con, marks, built };
}
const lines = (s: string) => s.split('\n').filter((l) => /^F \d/.test(l.trim()));
const field = (l: string, k: string, n = 1) => { const t = l.trim().split(/\s+/); const i = t.indexOf(k); return t.slice(i + 1, i + 1 + n).map(Number); };

describe('เซนเซอร์ชุด 1 ร่วมกับโค้ด', () => {
  it('Pico + MicroPython: อ่านเซนเซอร์ 11 ตัวพร้อมกัน (ดิจิทัล, ADC, IRQ นับพัลส์เสียง, จ่ายไฟเซนเซอร์น้ำจากขา GPIO) ก่อน/หลังเปลี่ยนสภาพแวดล้อม', { timeout: 900000 }, () => {
    const b = picoRig();
    {
      const errs: string[] = [];
      expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
      const built = buildNetlist(b.doc);
      const r = new SimEngine().handle({ seq: 1, netlist: built.netlist, advance: 0.02, restart: true, watch: [], budgetMs: 1e9 });
      const an = analyze(b.doc, built, r.result, r.tones);
      expect(an.diagnostics.filter((d) => d.severity === 'danger')).toEqual([]);
    }
    const on = { FL: { flame: true, distance: 30 }, TC: { touched: true }, HL: { magnet: true, distance: 5, on: true }, RD: { magnet: true, distance: 3, closed: true }, TL: { angle: 90 },
      WL: { level: 100 }, FS: { force: 10 }, SD: { sound: true, level: 110, frequency: 500 }, VB: { vibrating: true }, LN: { surface: 'black' }, RN: { wet: 60 } };
    const { con, marks } = runMcu(b, 'PICO1', 3.2, 0.1, (t) => (t === 1.6 ? on : undefined));
    const before = lines(con.slice(0, marks[0].at)), after = lines(con.slice(marks[0].at));
    expect(before.length, con.slice(-400)).toBeGreaterThanOrEqual(3);
    expect(after.length, con.slice(-400)).toBeGreaterThanOrEqual(3);
    const b0 = before.at(-1)!, a0 = after.at(-1)!;
    // ก่อน: ไม่มีไฟ ไม่แตะ ไม่มีแม่เหล็ก ตั้งตรง แห้ง ไม่กด เงียบ นิ่ง พื้นขาว แห้ง
    expect(field(b0, 'F', 2)[0]).toBe(1); expect(field(b0, 'F', 2)[1]).toBeGreaterThan(64000);
    expect(field(b0, 'T')[0]).toBe(0); expect(field(b0, 'H')[0]).toBe(1); expect(field(b0, 'K')[0]).toBe(1); expect(field(b0, 'D')[0]).toBe(0);
    expect(field(b0, 'W')[0]).toBeLessThan(600); expect(field(b0, 'P')[0]).toBeLessThan(600); expect(field(b0, 'S')[0]).toBe(0);
    expect(field(b0, 'V')[0]).toBe(0); expect(field(b0, 'L')[0]).toBe(0); expect(field(b0, 'R')[0]).toBe(1);
    // หลัง: AO เปลวไฟ = 65535/3.78 ≈ 17,340 · น้ำเต็ม ≈ 0.51 · FSR 10 N (1 kΩ / 10 kΩ) ≈ 0.909 · เสียง 500 Hz ในหน้าต่าง ≈ 0.1 s ขึ้นไป → นับพัลส์ได้หลายสิบ
    expect(field(a0, 'F', 2)[0]).toBe(0); expect(Math.abs(field(a0, 'F', 2)[1] - 65535 / (1 + (50 / 30) ** 2))).toBeLessThan(800);
    expect(field(a0, 'T')[0]).toBe(1); expect(field(a0, 'H')[0]).toBe(0); expect(field(a0, 'K')[0]).toBe(0); expect(field(a0, 'D')[0]).toBe(1);
    expect(Math.abs(field(a0, 'W')[0] - 0.51 * 65535)).toBeLessThan(1500);
    expect(Math.abs(field(a0, 'P')[0] - (65535 * 10) / 11)).toBeLessThan(1000);
    expect(field(a0, 'S')[0]).toBeGreaterThan(20);
    expect(field(a0, 'V')[0]).toBe(1); expect(field(a0, 'L')[0]).toBe(1); expect(field(a0, 'R')[0]).toBe(0);
  });

  it('Uno + C++ (avr-gcc): โมดูล 5 V ทั้งหมดรวม MQ-2 · analogRead ตรงค่าที่คำนวณ · นับพัลส์เสียงด้วย attachInterrupt · INPUT_PULLUP กับ Hall/รีด/สวิตช์เอียง', { timeout: 900000 }, () => {
    expect(unoSrc).toContain('attachInterrupt');
    const b = unoRig(unoSrc, unoHex);
    {
      const errs: string[] = [];
      expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    }
    const on = { FL: { flame: true, distance: 30 }, TC: { touched: true }, HL: { magnet: true, distance: 5, on: true }, RD: { magnet: true, distance: 3, closed: true }, TL: { angle: 90 },
      WL: { level: 100 }, FS: { force: 10 }, SD: { sound: true, level: 110, frequency: 500 }, VB: { vibrating: true }, LN: { surface: 'black' }, RN: { wet: 60 }, MQ: { ppm: 5000 } };
    const { con, marks } = runMcu(b, 'UNO1', 1.6, 0.05, (t) => (t === 0.8 ? on : undefined));
    const before = lines(con.slice(0, marks[0].at)), after = lines(con.slice(marks[0].at));
    expect(before.length, con.slice(-300)).toBeGreaterThanOrEqual(3);
    expect(after.length, con.slice(-300)).toBeGreaterThanOrEqual(3);
    const b0 = before.at(-1)!, a0 = after.at(-1)!;
    expect(field(b0, 'F', 2)).toEqual([1, 1023]);
    expect(field(b0, 'R', 2)).toEqual([1, 1023]);
    expect(field(b0, 'G', 2)[0]).toBe(1); expect(Math.abs(field(b0, 'G', 2)[1] - Math.round((1023 * 1000) / (1000 + 2000 * 9.83)))).toBeLessThanOrEqual(3);
    expect(field(b0, 'L', 2)[0]).toBe(0); expect(Math.abs(field(b0, 'L', 2)[1] - 102)).toBeLessThanOrEqual(3);
    expect(field(b0, 'V')[0]).toBe(0); expect(field(b0, 'S')[0]).toBe(0); expect(field(b0, 'T')[0]).toBe(0); expect(field(b0, 'H')[0]).toBe(1);
    expect(field(b0, 'K')[0]).toBe(1); expect(field(b0, 'D')[0]).toBe(0); expect(field(b0, 'W')[0]).toBe(0); expect(field(b0, 'P')[0]).toBe(0);
    // หลัง: MQ-2 5,000 ppm AO = 1023/(1 + 0.3568·2) ≈ 597 DO ต่ำ · ฝน 60% R = 3.33 kΩ → 1023·3.33/13.33 ≈ 256 · ดำ AO ≈ 1023·0.666 ≈ 681
    expect(field(a0, 'F', 2)[0]).toBe(0); expect(Math.abs(field(a0, 'F', 2)[1] - 1023 / (1 + (50 / 30) ** 2))).toBeLessThanOrEqual(4);
    expect(field(a0, 'R', 2)[0]).toBe(0); expect(Math.abs(field(a0, 'R', 2)[1] - (1023 * 3333.3) / 13333.3)).toBeLessThanOrEqual(4);
    expect(field(a0, 'G', 2)[0]).toBe(0); expect(Math.abs(field(a0, 'G', 2)[1] - 1023 / (1 + mq2Ratio('lpg', 5000) * 2))).toBeLessThanOrEqual(4);
    expect(field(a0, 'L', 2)[0]).toBe(1); expect(Math.abs(field(a0, 'L', 2)[1] - (1023 * 19960) / 29960)).toBeLessThanOrEqual(4);
    expect(field(a0, 'V')[0]).toBe(1); expect(field(a0, 'S')[0]).toBeGreaterThan(20); expect(field(a0, 'T')[0]).toBe(1); expect(field(a0, 'H')[0]).toBe(0);
    expect(field(a0, 'K')[0]).toBe(0); expect(field(a0, 'D')[0]).toBe(1);
    expect(Math.abs(field(a0, 'W')[0] - 0.51 * 1023)).toBeLessThanOrEqual(5);
    expect(Math.abs(field(a0, 'P')[0] - (1023 * 10) / 11)).toBeLessThanOrEqual(4);
  });
});

