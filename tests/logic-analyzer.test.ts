import { describe, expect, it } from 'vitest';
import pwmHex from './fixtures/uno/pwm.hex?raw';
import blinkHex from './fixtures/uno/blink.hex?raw';
import laHex from './fixtures/uno/la.hex?raw';
import nanoBlinkHex from './fixtures/uno/nano-blink.hex?raw';
import { checkLesson } from '../src/lessons/checks';
import { laAnalyze, laWindow } from '../src/ui/la-panel';
import { emptyWork, type LogicAnalyzerPart } from '../src/model/types';
import { analyze } from '../src/instruments/measure';
import { UNO_LA_CODE } from '../src/model/catalog';
import { SimEngine, type EngineRequest } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { LogicBuffer, decodeUart, guessBaud, levelAt, measurePwm, uartFrameBits, uartText } from '../src/instruments/logic';
import { UNO_DEFAULT_CODE } from '../src/model/catalog';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** วงจร 555 astable เดียวกับ tests/timer555.test.ts (RA 1 kΩ, RB 10 kΩ, C 10 µF) */
function astable() {
  return new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5, currentLimit: 0.5 })
    .part('timer555', onBoard('f10'), 'U1')
    .part('resistor', onBoard('tp11', 90), 'RA', { resistance: 1000, span: 3 })
    .part('resistor', onBoard('c11'), 'RB', { resistance: 10000, span: 4 })
    .part('resistor', onBoard('i12'), 'R1', { resistance: 330, span: 4 })
    .part('led', onBoard('g16'), 'LED1')
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2')).wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2'))
    .wire(H('a10'), H('tp10')).wire(H('j10'), H('bn10'))
    .wire(H('b15'), H('b12')).wire(H('d12'), H('g11')).wire(H('j17'), H('bn17'))
    .part('capacitor', onBoard('j11', 90), 'C1', { capacitance: 10e-6, ratedVoltage: 16, polarized: true, initialVoltage: 0, span: 2 })
    .wire(H('j13'), H('bp14'));
}
import { astable555 } from '../src/model/catalog';
import { adcRig } from './adcpwm-rig';
import { pinHolesFor } from '../src/model/geometry';

/** รันวงจรแล้วรวมข้อมูลเครื่องวิเคราะห์ LA1 ลงบัฟเฟอร์ */
function capture(b: Builder, sec: number, dt = 0.05, mcu?: (k: number) => EngineRequest['mcu']) {
  const e = new SimEngine(), built = buildNetlist(b.doc), buf = new LogicBuffer();
  for (let k = 0; k < Math.round(sec / dt); k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(mcu?.(k) ? { mcu: mcu(k) } : {}) });
    if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
  }
  return buf;
}
const la = (b: Builder) => b.part('logicanalyzer', onTable(-40, 40), 'LA1', {});

describe('ตัวถอดรหัส/การวัด (ฟังก์ชันล้วน)', () => {
  it('เฟรม UART 8N1 ของ "A" (0x41): start 0 · 1000 0010 (LSB ก่อน) · stop 1 · ถอดกลับได้ไบต์เดิม และเดาบอดเรตได้', () => {
    expect(uartFrameBits(0x41)).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
    const T = 1 / 9600, tr = { lvl0: 1 as const, t: [] as number[], v: [] as Array<0 | 1> };
    let t = 0.001;
    for (const ch of 'Hi\n') for (const b of uartFrameBits(ch.charCodeAt(0))) { const last = tr.v.length ? tr.v[tr.v.length - 1] : 1; if (b !== last) { tr.t.push(t); tr.v.push(b); } t += T; }
    expect(guessBaud(tr)).toBe(9600);
    const f = decodeUart(tr, 9600);
    expect(f.map((x) => x.byte)).toEqual([0x48, 0x69, 0x0a]);
    expect(f.every((x) => x.ok)).toBe(true);
    expect(uartText(f)).toBe('Hi\n');
    // บอดเรตผิด (19200) → อ่านผิด/ framing error
    expect(uartText(decodeUart(tr, 19200))).not.toBe('Hi\n');
  });
  it('วัด PWM: 1 kHz duty 25% · ระดับคงที่ไม่มีความถี่', () => {
    const tr = { lvl0: 0 as const, t: [] as number[], v: [] as Array<0 | 1> };
    for (let k = 0; k < 20; k++) { tr.t.push(k * 1e-3, k * 1e-3 + 0.25e-3); tr.v.push(1, 0); }
    const m = measurePwm(tr, 0, 0.0195);
    expect(m.freq).toBeCloseTo(1000, 6);
    expect(m.duty).toBeCloseTo(0.25, 6);
    expect(measurePwm({ lvl0: 1, t: [], v: [] }, 0, 1)).toMatchObject({ freq: null, level: 1 });
    expect(levelAt(tr, 0.0101)).toBe(1);
    expect(levelAt(tr, 0.0103)).toBe(0);
  });
});

describe('เครื่องวิเคราะห์ลอจิกกับ Arduino Uno (โปรแกรมคอมไพล์จริง)', () => {
  it('analogWrite(9, 64): ความถี่ 490.2 Hz (16 MHz / 64 / 510 — Timer1 phase-correct) duty 64/255 จากขอบที่ตัวจำลอง CPU รายงาน · D13 ค้าง HIGH', { timeout: 60000 }, () => {
    const b = la(new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: 'x', hex: pwmHex, hexSrc: 'x' }))
      .wire(P('LA1', 'CH0'), P('UNO1', 'D9'), 'a', '#fdd835').wire(P('LA1', 'CH1'), P('UNO1', 'D13'), 'b', '#1e88e5').wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'g', '#212121');
    const buf = capture(b, 0.3);
    expect(buf.ch[0].src).toBe('mcu');
    const m = measurePwm(buf.ch[0], 0.1, 0.3);
    expect(m.freq!).toBeCloseTo(16e6 / 64 / 510, 1);
    expect(m.duty!).toBeCloseTo(64 / 255, 3);
    expect(levelAt(buf.ch[1], 0.25)).toBe(1);
    expect(buf.ch[2].src).toBe('none'); // ไม่ได้ต่อ
  });
  it('Serial 9600 (Blink): ขา TX (D1) มีรูปคลื่นเฟรม UART → ถอดได้ "LED ON" / "LED OFF" ตรงกับ Serial Monitor · บอดเรตที่วัด ≈ 9615 (UBRR = 207, U2X — คลาดเท่าชิปจริง)', { timeout: 60000 }, () => {
    const b = la(new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: UNO_DEFAULT_CODE, hex: blinkHex, hexSrc: UNO_DEFAULT_CODE }))
      .wire(P('LA1', 'CH0'), P('UNO1', 'D1'), 'a', '#fdd835').wire(P('LA1', 'CH1'), P('UNO1', 'D13'), 'b', '#1e88e5').wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'g', '#212121');
    const buf = capture(b, 1.2);
    expect(buf.ch[0].src).toBe('uart');
    expect(guessBaud(buf.ch[0])).toBe(9600);
    const text = uartText(decodeUart(buf.ch[0], 9600));
    expect(text).toContain('LED ON\n');
    expect(text).toContain('LED OFF\n');
    // บิตแคบที่สุดตรงกับ 2 MHz / 208 = 9615.4 baud
    let min = Infinity;
    for (let i = 1; i < buf.ch[0].t.length; i++) min = Math.min(min, buf.ch[0].t[i] - buf.ch[0].t[i - 1]);
    expect(1 / min).toBeCloseTo(16e6 / 8 / 208, 0);
    // "LED OFF" ถูกส่งที่เวลา ≈ 0.5 s พร้อมกับ D13 ลง
    const fr = decodeUart(buf.ch[0], 9600);
    const off = fr.find((f, i) => f.byte === 0x4c && fr[i + 4]?.byte === 0x4f && fr[i + 5]?.byte === 0x46)!;
    const d13fall = buf.ch[1].t.find((t, i) => buf.ch[1].v[i] === 0 && t > 0.3)!;
    expect(Math.abs(off.t0 - d13fall)).toBeLessThan(0.002);
  });
  it('ข้อความจาก Serial Monitor เข้าขา RX (D0): ถอดได้ข้อความเดียวกัน (เหมือนชิป USB-serial ขับขา D0)', { timeout: 60000 }, () => {
    const b = la(new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: UNO_DEFAULT_CODE, hex: blinkHex, hexSrc: UNO_DEFAULT_CODE }))
      .wire(P('LA1', 'CH2'), P('UNO1', 'D0'), 'a', '#fdd835').wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'g', '#212121');
    const buf = capture(b, 0.4, 0.05, (k) => (k === 2 ? { UNO1: { serial: [...'ok\n'].map((c) => c.charCodeAt(0)) } } : undefined));
    expect(buf.ch[2].src).toBe('uart');
    expect(uartText(decodeUart(buf.ch[2], 9600))).toBe('ok\n');
  });
});

describe('เครื่องวิเคราะห์ลอจิกกับ Arduino Nano', () => {
  it('Nano (Blink คอมไพล์เป็น Nano) ขา TX (ขา 1, รู j3) → ถอดได้ "LED ON" · D13 (ขา 16, รู a17) กะพริบ 1 Hz', { timeout: 60000 }, () => {
    const b = new Builder().part('nano', onBoard('h3'), 'NANO1', { code: UNO_DEFAULT_CODE, hex: nanoBlinkHex, hexSrc: UNO_DEFAULT_CODE }).wire(H('a4'), H('tn4'), 'g', '#212121');
    la(b).wire(P('LA1', 'CH0'), H('j3'), 'a', '#fdd835').wire(P('LA1', 'CH1'), H('a17'), 'b', '#1e88e5').wire(P('LA1', 'GND'), H('tn10'), 'lg', '#212121');
    const buf = capture(b, 1.2);
    expect(buf.ch[0].src).toBe('uart');
    expect(uartText(decodeUart(buf.ch[0], 9600))).toContain('LED ON\nLED OFF\n');
    expect(measurePwm(buf.ch[1], 0, 1.2).freq!).toBeCloseTo(1, 3);
  });
});

describe('เครื่องวิเคราะห์ลอจิกกับ Raspberry Pi Pico (MicroPython จริง)', () => {
  it('แลป 42 (VR 25%): GP15 PWM 1 kHz duty ≈ ค่า ADC · GP0 (UART0 115200) ถอดได้ข้อความ "ADC =" ที่โปรแกรมพิมพ์', { timeout: 180000 }, () => {
    const b = adcRig({ pos: 0.25 });
    const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
    b.part('logicanalyzer', onTable(-40, 45), 'LA1', {})
      .wire(P('LA1', 'CH0'), H(`i${col('GP15')}`), 'l0', '#fdd835').wire(P('LA1', 'CH1'), H(`i${col('GP0')}`), 'l1', '#1e88e5').wire(P('LA1', 'GND'), H(`i${col('GND')}`), 'lg', '#212121');
    const buf = capture(b, 4, 0.1);
    expect(buf.ch[0].src).toBe('mcu');
    const m = measurePwm(buf.ch[0], buf.t1 - 0.3, buf.t1);
    expect(m.freq!).toBeCloseTo(1000, 0);
    expect(Math.abs(m.duty! - 0.25)).toBeLessThan(0.02);
    expect(buf.ch[1].src).toBe('uart');
    expect(guessBaud(buf.ch[1])).toBe(115200);
    expect(uartText(decodeUart(buf.ch[1], 115200))).toMatch(/ADC = \d+ +V = 0\.8/);
  });
});

describe('เครื่องวิเคราะห์ลอจิกกับวงจรที่ไม่มีไมโครคอนโทรลเลอร์', () => {
  it('NE555 astable (แลป 20): ระดับขา OUT จากแรงดันที่คำนวณทุกก้าว — ความถี่/duty ตรงกับสูตร (±3%)', { timeout: 120000 }, () => {
    const b = astable();
    b.part('logicanalyzer', onTable(-40, 45), 'LA1', {}).wire(P('LA1', 'CH0'), H('h12'), 'la0', '#fdd835').wire(P('LA1', 'GND'), H('bn20'), 'lag', '#212121');
    const buf = capture(b, 1.5);
    expect(buf.ch[0].src).toBe('analog');
    const m = measurePwm(buf.ch[0], 0.3, 1.5);
    const exp = astable555(1000, 10000, 10e-6);
    expect(Math.abs(m.freq! / exp.f - 1)).toBeLessThan(0.03);
    expect(Math.abs(m.duty! - exp.duty)).toBeLessThan(0.03);
  });
});

describe('แลป 56 (เครื่องวิเคราะห์ลอจิก) ตรวจผลจากข้อมูลที่เครื่องวิเคราะห์เก็บได้', () => {
  const lab = (o: { hex?: string | null; tx?: boolean; gnd?: boolean; uart?: boolean } = {}) => {
    const b = la(new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: UNO_LA_CODE, hex: o.hex === undefined ? laHex : o.hex, hexSrc: UNO_LA_CODE }))
      .wire(P('LA1', 'CH0'), P('UNO1', 'D9'), 'a', '#fdd835');
    if (o.tx !== false) b.wire(P('LA1', 'CH1'), P('UNO1', 'D1'), 'b', '#1e88e5');
    if (o.gnd !== false) b.wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'g', '#212121');
    const p = b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart;
    if (o.uart !== false) p.params.decoders[1] = 'uart';
    return b;
  };
  const check = (b: Builder, sec = 0.6) => {
    const e = new SimEngine(), built = buildNetlist(b.doc), buf = new LogicBuffer();
    let r!: ReturnType<SimEngine['handle']>;
    for (let k = 0; k < sec / 0.05; k++) { r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 }); if (r.logic?.LA1) buf.push(r.logic.LA1, 10); }
    const p = (b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart).params;
    const logic = laAnalyze(buf, p, laWindow(buf, p), Array(8).fill('')).map((c) => ({ k: c.k, freq: c.m.freq, duty: c.m.duty, level: c.m.level, baud: c.baud, text: c.text, src: buf.ch[c.k].src }));
    return { st: checkLesson('analyzer', { doc: b.doc, built, result: r.result, analysis: analyze(b.doc, built, r.result, r.tones), work: emptyWork(), mcu: r.mcu, logic }), logic };
  };
  it('ต่อครบ + อัปโหลด + ตัวถอดรหัส UART ที่ CH1 → ผ่านทุกข้อ · ข้อความที่ถอดได้ตรงกับที่โปรแกรมพิมพ์', { timeout: 60000 }, () => {
    const { st, logic } = check(lab());
    for (const g of ['wire', 'upload', 'pwm', 'uart']) expect(st[g].pass, `${g}: ${st[g].detail}`).toBe(true);
    expect(logic.find((c) => c.k === 1)!.text).toMatch(/HELLO 0\nHELLO 1\n/);
    expect(logic.find((c) => c.k === 0)!.duty!).toBeCloseTo(64 / 255, 3);
  });
  it('ไม่ต่อ GND → wire ไม่ผ่าน และวัดไม่ได้ · ไม่ตั้งตัวถอดรหัส → uart ไม่ผ่าน · ไม่มีโปรแกรม → upload ไม่ผ่าน', { timeout: 60000 }, () => {
    const ng = check(lab({ gnd: false }));
    expect(ng.st.wire.pass).toBe(false);
    expect(ng.st.wire.detail).toContain('GND');
    expect(ng.logic.find((c) => c.k === 0)!.freq).toBeNull();
    expect(check(lab({ uart: false })).st.uart.pass).toBe(false);
    const nh = check(lab({ hex: null }));
    expect(nh.st.upload.pass).toBe(false);
    expect(nh.st.pwm.pass).toBe(false);
  });
});
