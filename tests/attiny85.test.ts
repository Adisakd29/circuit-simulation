import { describe, expect, it } from 'vitest';
import blinkHex from './fixtures/uno/tiny-blink.hex?raw';
import pwmHex from './fixtures/uno/tiny-pwm.hex?raw';
import adcHex from './fixtures/uno/tiny-adc.hex?raw';
import intHex from './fixtures/uno/tiny-int.hex?raw';
import eewdtHex from './fixtures/uno/tiny-eewdt.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { setPartParams } from '../src/editor/ops';
import { ATTINY85_PINOUT, catalogEntry, pinDefs } from '../src/model/catalog';
import { checkPlacement, pinHolesFor } from '../src/model/geometry';
import { AVR_TINY85, eepromOf } from '../src/mcu/avr-emu';
import { LogicBuffer, decodeUart, uartText } from '../src/instruments/logic';
import { validateCircuit } from '../src/model/schema';
import type { LogicAnalyzerPart } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * ATtiny85 (DIP-8) — ทุกข้อรันไฟล์ .hex ที่คอมไพล์จริงเป็นบอร์ด attiny85 (avr-gcc + ArduinoCore-avr variant gemma, F_CPU 8 MHz:
 * tests/fixtures/uno/gen.ts → tiny-*.hex) บน avr8js ที่ตั้งโปรไฟล์ชิป ATtiny85 (src/mcu/avr-chips.ts) ร่วมกับวงจร
 * ชิปเสียบ anchor f10: ขา 1 RESET f10, 2 PB3 f11, 3 PB4 f12, 4 GND f13 · ขา 5 PB0 e13, 6 PB1 e12, 7 PB2 e11, 8 VCC e10
 * รูว่างกลุ่มเดียวกัน: ขา 1–4 → แถว g–j, ขา 5–8 → แถว a–d · ไฟเลี้ยงจากแหล่งจ่าย DC (ราง tp = +, bn = −)
 */
const ID = 'TINY1';
const COL: Record<string, number> = { PB5: 10, PB3: 11, PB4: 12, GND: 13, PB0: 13, PB1: 12, PB2: 11, VCC: 10 };
const th = (pin: string) => (['PB5', 'PB3', 'PB4', 'GND'].includes(pin) ? `j${COL[pin]}` : `a${COL[pin]}`);
type Mcu = Record<string, { reset?: boolean }>;
/** ชิป + แหล่งจ่าย PS1 (ค่าเริ่มต้น 5 V) · ไม่ต่อไฟ: power = false */
function base(hex: string | null, o: { v?: number; power?: boolean } = {}) {
  const b = new Builder().part('attiny85', onBoard('f10'), ID, { code: 'x', hex, hexSrc: 'x' })
    .part('dcsupply', onTable(60, 40), 'PS1', { voltage: o.v ?? 5, currentLimit: 0.5, outputOn: true })
    .wire(P('PS1', 'pos'), H('tp2'), 'p+', '#e53935').wire(P('PS1', 'neg'), H('bn2'), 'p-', '#212121').wire(H('tn3'), H('bn3'), 'gg', '#212121');
  return o.power === false ? b : b.wire(H(th('VCC')), H('tp10'), 'vcc', '#e53935').wire(H(th('GND')), H('bn14'), 'gnd', '#212121');
}
/** + LED1 ผ่าน 220 Ω ที่ PB0 (ขา 5): a13 → a20, R b20–b23, LED c23/c24, K → tn24 */
const withLed = (b: Builder) => b.wire(H(th('PB0')), H('a20'), 'l1', '#43a047').part('resistor', onBoard('b20'), 'R1', { resistance: 220, span: 3 }).part('led', onBoard('c23'), 'LED1').wire(H('e24'), H('tn24'), 'l2', '#212121');
/** + เครื่องวิเคราะห์ลอจิก CH0 ที่ขาที่กำหนด (ถอด UART) */
const withLa = (b: Builder, pin: string) => {
  b.part('logicanalyzer', onTable(-40, 45), 'LA1', {}).wire(P('LA1', 'CH0'), H(th(pin).replace(/^a/, 'b').replace(/^j/, 'i')), 'la0', '#fdd835').wire(P('LA1', 'GND'), H('bn20'), 'lag', '#212121');
  (b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart).params.decoders[0] = 'uart';
  return b;
};
function run(b: Builder, sec: number, cmd?: (t: number) => boolean | void, mcu?: (t: number) => Mcu | undefined) {
  const e = new SimEngine();
  let built = buildNetlist(b.doc);
  const buf = new LogicBuffer();
  const st: Array<{ t: number; an: ReturnType<typeof analyze>; r: ReturnType<SimEngine['handle']>; m: NonNullable<ReturnType<SimEngine['handle']>['mcu']>[number] | undefined }> = [];
  for (let k = 0; k < Math.round(sec / 0.05); k++) {
    const t = +((k + 1) * 0.05).toFixed(3);
    if (cmd?.(t)) built = buildNetlist(b.doc);
    const mc = mcu?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9, ...(mc ? { mcu: mc } : {}) });
    if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
    st.push({ t, an: analyze(b.doc, built, r.result, r.tones), r, m: r.mcu?.find((x) => x.id === ID) });
  }
  return { st, buf, built };
}
const ledI = (s: { an: ReturnType<typeof analyze> }) => s.an.parts.LED1?.current ?? 0;
const at = (_st: Array<{ t: number }>, t: number) => Math.round(t / 0.05) - 1;
const setP = (b: Builder, id: string, p: Record<string, unknown>) => { const x = setPartParams(b.doc, id, p as never); if (x.ok) b.doc = x.doc; return true; };

describe('ATtiny85: ขา โปรไฟล์ชิป และการวาง', () => {
  it('DIP-8 คร่อมร่องกลาง: ขา 1–4 แถว f, 5–8 แถว e (ขา 8 ตรงข้ามขา 1) · โปรไฟล์ชิปตาม iotnx5.h (เวกเตอร์ RJMP, Timer0 0x4A–0x53, ADC 0x24–0x27, EEPROM 512 ไบต์)', () => {
    const b = new Builder().part('attiny85', onBoard('f10'), ID, {});
    const p = b.doc.parts[0];
    expect(catalogEntry('attiny85')!.supported).toBe(true);
    expect(pinDefs(p)).toHaveLength(8);
    expect(Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]))).toEqual({ PB5: 'f10', PB3: 'f11', PB4: 'f12', GND: 'f13', PB0: 'e13', PB1: 'e12', PB2: 'e11', VCC: 'e10' });
    expect(ATTINY85_PINOUT[0][1]).toContain('RESET');
    expect(checkPlacement(b.doc, p).ok).toBe(true);
    expect(AVR_TINY85.pins).toEqual([['B', 0], ['B', 1], ['B', 2], ['B', 3], ['B', 4], ['B', 5]]);
    expect(AVR_TINY85.timers[0]).toMatchObject({ TCCRA: 0x4a, TCCRB: 0x53, TCNT: 0x52, OCRA: 0x49, OCRB: 0x48, TIMSK: 0x59, TIFR: 0x58, ovfInterrupt: 5, compAInterrupt: 10, compBInterrupt: 11 });
    expect(AVR_TINY85.adc).toMatchObject({ ADMUX: 0x27, ADCSRA: 0x26, ADCH: 0x25, ADCL: 0x24, adcInterrupt: 8 });
    expect(AVR_TINY85.adcPins).toEqual([5, 2, 4, 3]);
    expect(AVR_TINY85.eepromBytes).toBe(512);
    expect(AVR_TINY85.usarts).toEqual([]);
    expect(AVR_TINY85.twi).toBeUndefined();
    const nl = buildNetlist(base(null).doc).netlist.mcus![0];
    expect(nl).toMatchObject({ board: 'attiny85', v33: -1, vbus: -1 });
    expect(nl.gp[5]).toBe(-1); // ขา 1 = RESET ไม่ใช่ I/O
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(base(blinkHex).doc)), errs, []), errs.join()).not.toBeNull();
  });
});

describe('ATtiny85: ไฟเลี้ยงจากวงจร', () => {
  it('ไม่ต่อ VCC/GND → CPU ไม่ทำงาน (LED ดับ, ขาเป็นขาเข้า) + คำเตือน · ต่อ 5 V → กะพริบทุก 500 ms · ไฟ 2.0 V → ไม่ทำงาน · 3.3 V → ทำงาน LED หรี่ลง', { timeout: 120000 }, () => {
    const off = run(withLed(base(blinkHex, { power: false })), 0.6).st;
    expect(off.every((s) => ledI(s) < 1e-6)).toBe(true);
    expect(off[5].m!.pins.slice(0, 5).every((p) => p === 'in')).toBe(true);
    expect(off[5].m!.chip).toMatchObject({ powered: false });
    expect(off[5].an.diagnostics.some((d) => d.partId === ID && d.message.includes('ชิปไม่ทำงาน'))).toBe(true);
    for (const [v, lo, hi] of [[5, 0.011, 0.0135], [3.3, 0.003, 0.0065]] as const) {
      const { st } = run(withLed(base(blinkHex, { v })), 1.6);
      const on = (t: number) => ledI(st[at(st, t)]) > 1e-4;
      expect([0.1, 0.3, 0.45].every(on), `${v}`).toBe(true);
      expect([0.6, 0.8, 0.95].some(on), `${v}`).toBe(false);
      expect([1.1, 1.3].every(on), `${v}`).toBe(true);
      const i = ledI(st[2]);
      expect(i, `${v} V`).toBeGreaterThan(lo);
      expect(i, `${v} V`).toBeLessThan(hi);
      expect(st[2].m!.chip!.vcc).toBeCloseTo(v, 1);
      // กระแส LED ไหลผ่านขา VCC ของชิปจริง: แหล่งจ่ายเห็นกระแส ≈ กระแส LED
      expect(Math.abs(st[2].an.parts.PS1.current)).toBeCloseTo(i, 3);
    }
    const low = run(withLed(base(blinkHex, { v: 2.0 })), 0.4).st;
    expect(low.every((s) => ledI(s) < 1e-6)).toBe(true);
    expect(low[3].m!.chip).toMatchObject({ powered: false });
  });

  it('ปิดแหล่งจ่ายกลางทาง → CPU หยุด · เปิดใหม่ → เริ่มโปรแกรมจากต้น (LED ติดทันทีอีกครั้ง)', { timeout: 120000 }, () => {
    const b = withLed(base(blinkHex));
    const { st } = run(b, 2.0, (t) => {
      if (Math.abs(t - 0.7) < 1e-6) return setP(b, 'PS1', { outputOn: false });
      if (Math.abs(t - 1.2) < 1e-6) return setP(b, 'PS1', { outputOn: true });
    });
    expect(ledI(st[at(st, 0.3)])).toBeGreaterThan(1e-3);
    expect([0.8, 1.0, 1.15].every((t) => ledI(st[at(st, t)]) < 1e-6)).toBe(true);
    expect(st[at(st, 1.0)].m!.chip!.powered).toBe(false);
    // เริ่มใหม่ที่ ≈ 1.2 s: LED ติดช่วง 1.25–1.65 แล้วดับ
    expect([1.3, 1.5].every((t) => ledI(st[at(st, t)]) > 1e-3)).toBe(true);
    expect(ledI(st[at(st, 1.85)])).toBeLessThan(1e-6);
  });

  it('ขา RESET (ขา 1) ดึงลง GND ด้วยปุ่ม → CPU หยุดที่รีเซ็ต · ปล่อย → เริ่มใหม่ (ตัวดึงขึ้นภายใน)', { timeout: 120000 }, () => {
    const b = withLed(base(blinkHex)).part('pushbutton', onBoard('f25'), 'SW1', {}).wire(H('a25'), H('bn26'), 'sg', '#212121').wire(H('i10'), H('a27'), 'sr', '#1e88e5');
    const { st } = run(b, 1.8, (t) => {
      if (Math.abs(t - 0.2) < 1e-6) return setP(b, 'SW1', { pressed: true });
      if (Math.abs(t - 0.9) < 1e-6) return setP(b, 'SW1', { pressed: false });
    });
    expect(ledI(st[at(st, 0.1)])).toBeGreaterThan(1e-3);
    expect([0.3, 0.6, 0.85].every((t) => ledI(st[at(st, t)]) < 1e-6)).toBe(true);
    expect(st[at(st, 0.5)].m!.chip).toMatchObject({ powered: false, rst: true });
    expect([1.0, 1.3].every((t) => ledI(st[at(st, t)]) > 1e-3)).toBe(true);
    expect(ledI(st[at(st, 1.55)])).toBeLessThan(1e-6);
  });
});

describe('ATtiny85: อุปกรณ์ภายในชิป', () => {
  it('PWM: PB0/PB1 (Timer0) ≈ 488 Hz duty 25/50 % · PB4 (Timer1, TOP = OCR1C = 255) ≈ 7812 Hz duty 75 % — ตามสูตร datasheet ไม่ใช่ phase correct', { timeout: 120000 }, () => {
    const b = base(pwmHex)
      .part('resistor', onBoard('a26'), 'R1', { resistance: 1000, span: 3 }).wire(H(th('PB0').replace('a', 'b')), H('b26'), 'w0', '#1e88e5').wire(H('e29'), H('tn29'), 'g0', '#212121')
      .part('resistor', onBoard('g26'), 'R2', { resistance: 1000, span: 3 }).wire(H(th('PB4').replace('j', 'i')), H('h26'), 'w4', '#8e24aa').wire(H('j29'), H('bn29'), 'g4', '#212121')
      .wire(H(th('PB1').replace('a', 'c')), H('c17'), 'w1', '#43a047').part('resistor', onBoard('a17'), 'R3', { resistance: 1000, span: 3 }).wire(H('e20'), H('tn20'), 'g1', '#212121');
    const { st } = run(b, 0.3);
    const m = st[st.length - 1].m!;
    expect(Math.abs(m.edges![0] / 2 / 0.05 - 488.3)).toBeLessThan(15);
    expect(Math.abs(m.edges![1] / 2 / 0.05 - 488.3)).toBeLessThan(15);
    expect(Math.abs(m.edges![4] / 2 / 0.05 - 7812.5)).toBeLessThan(80);
    expect(Math.abs(m.duty[0] - 64 / 256)).toBeLessThan(0.02);
    expect(Math.abs(m.duty[1] - 128 / 256)).toBeLessThan(0.02);
    expect(Math.abs(m.duty[4] - 192 / 256)).toBeLessThan(0.02);
  });

  it('ADC อ้างอิง VCC ที่จ่ายจริง: A1 = 2.0 V จากแหล่งจ่ายแยก → VCC 5 V ได้ ≈ 409, VCC 4 V ได้ ≈ 512 · A3 แบ่งครึ่ง VCC ≈ 512 ทั้งสองแบบ · SoftwareSerial 9600 baud ถอดได้ที่ PB4', { timeout: 180000 }, () => {
    for (const [v, a1] of [[5, 409], [4, 512]] as const) {
      const b = withLa(base(adcHex, { v }), 'PB4')
        .part('dcsupply', onTable(60, 90), 'PS2', { voltage: 2, currentLimit: 0.1, outputOn: true }).wire(P('PS2', 'pos'), H('b11'), 'a1', '#fdd835').wire(P('PS2', 'neg'), H('bn22'), 'a1g', '#212121')
        .part('resistor', onBoard('h16'), 'R1', { resistance: 10000, span: 3 }).wire(H('i11'), H('i16'), 'a3', '#1e88e5').wire(H('j19'), H('bn18'), 'r1g', '#212121')
        .part('resistor', onBoard('g16'), 'R2', { resistance: 10000, span: 4 }).wire(H('j20'), H('tp20'), 'r2v', '#e53935');
      const { buf } = run(b, 0.8);
      const txt = uartText(decodeUart(buf.ch[0], 9600));
      const m = /A1=(\d+) A3=(\d+)/.exec(txt.split('\n').filter((l) => /A1=\d+ A3=\d+/.test(l)).pop() ?? '');
      expect(m, `${v} V: ${txt.slice(-80)}`).not.toBeNull();
      expect(Math.abs(Number(m![1]) - a1), `${v} V A1 ${m![1]}`).toBeLessThan(6);
      expect(Math.abs(Number(m![2]) - 512), `${v} V A3 ${m![2]}`).toBeLessThan(6);
    }
  });

  it('INT0 (PB2, FALLING, INPUT_PULLUP) นับการกด 2 ครั้ง → LED ที่ PB0 สลับ ติด → ดับ · ข้อความ "INT0=2"', { timeout: 120000 }, () => {
    const b = withLa(withLed(base(intHex)), 'PB3').part('pushbutton', onBoard('f25'), 'SW1', {}).wire(H('a25'), H('bn26'), 'sg', '#212121').wire(H('c11'), H('a27'), 's1', '#1e88e5');
    const { st, buf } = run(b, 1.4, (t) => {
      for (const [a, z] of [[0.4, 0.6], [0.9, 1.1]]) { if (Math.abs(t - a) < 1e-6) return setP(b, 'SW1', { pressed: true }); if (Math.abs(t - z) < 1e-6) return setP(b, 'SW1', { pressed: false }); }
    });
    expect(ledI(st[at(st, 0.3)])).toBeLessThan(1e-6);
    expect(ledI(st[at(st, 0.7)])).toBeGreaterThan(1e-3);
    expect(ledI(st[at(st, 1.3)])).toBeLessThan(1e-6);
    const txt = uartText(decodeUart(buf.ch[0], 9600));
    expect(txt).toContain('ready');
    expect(txt.trim().split('\n').pop()!.trim()).toBe('INT0=2');
  });

  it('EEPROM 512 ไบต์นับการบูตข้ามการรีเซ็ต · watchdog 250 ms รีเซ็ตเองที่ ≈ 1.25 s (boot 1 → boot 2)', { timeout: 120000 }, () => {
    eepromOf(ID, 512).memory.fill(0xff);
    const { buf } = run(withLa(base(eewdtHex), 'PB3'), 1.7);
    const fr = decodeUart(buf.ch[0], 9600);
    expect(uartText(fr).match(/boot \d+/g)).toEqual(['boot 1', 'boot 2']);
    const t2 = fr.find((f, i) => i > 0 && f.byte === 0x62 && uartText(fr.slice(i, i + 6)).startsWith('boot 2'))?.t0 ?? 0;
    expect(t2).toBeGreaterThan(1.2);
    expect(t2).toBeLessThan(1.4);
    expect(eepromOf(ID, 512).memory[0]).toBe(2);
    eepromOf(ID, 512).memory.fill(0xff);
  });
});

describe('ATtiny85: คำเตือน', () => {
  it('VCC 7 V → อันตราย "เกินพิกัดสูงสุด 6.0 V" · LED ไม่มีตัวต้านทานที่ PB0 → อันตราย 40 mA', { timeout: 60000 }, () => {
    const hv = run(base(blinkHex, { v: 7 }), 0.2).st[2].an.diagnostics.filter((d) => d.partId === ID && d.severity === 'danger');
    expect(hv.some((d) => d.message.includes('6.0 V'))).toBe(true);
    const b = base(blinkHex).wire(H(th('PB0')), H('a20'), 'l1', '#43a047').part('resistor', onBoard('b20'), 'R1', { resistance: 1, span: 3 }).part('led', onBoard('c23'), 'LED1').wire(H('e24'), H('tn24'), 'l2', '#212121');
    const d = run(b, 0.2).st[2].an.diagnostics.filter((x) => x.partId === ID && x.severity === 'danger');
    expect(d.some((x) => x.message.includes('ขา PB0') && x.message.includes('40 mA'))).toBe(true);
  });
});
