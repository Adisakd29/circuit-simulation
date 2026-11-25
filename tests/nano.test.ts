import { describe, expect, it } from 'vitest';
import potHex from './fixtures/uno/nano-pot.hex?raw';
import blinkHex from './fixtures/uno/nano-blink.hex?raw';
import interruptHex from './fixtures/uno/nano-interrupt.hex?raw';
import unoInterruptHex from './fixtures/uno/interrupt.hex?raw';
import eepromHex from './fixtures/uno/nano-eeprom.hex?raw';
import watchdogHex from './fixtures/uno/nano-watchdog.hex?raw';
import inaHex from './fixtures/uno/nano-ina219.hex?raw';
import spiHex from './fixtures/uno/nano-spi.hex?raw';
import servotoneHex from './fixtures/uno/nano-servotone.hex?raw';
import { buzzerParamsFor } from '../src/model/catalog';
import { bytesToB64 } from '../src/mcu/avr-emu';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { addPart, setPartParams } from '../src/editor/ops';
import { NANO_POT_CODE, NANO_PINOUT, pinDefs } from '../src/model/catalog';
import { checkPlacement, coveredHoles, pinHolesFor } from '../src/model/geometry';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { eepromOf } from '../src/mcu/avr-emu';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork } from '../src/model/types';

/**
 * Arduino Nano (ATmega328P) เสียบคร่อมร่องกลางเบรดบอร์ด — ทุกข้อรันไฟล์ .hex ที่คอมไพล์จริงเป็นบอร์ด Nano
 * (avr-gcc + variant eightanaloginputs: tests/fixtures/uno/gen.ts → nano-*.hex) บน avr8js ร่วมกับวงจร
 * ขาของ Nano ที่ anchor h3: ขา 1–15 แถว h คอลัมน์ 3–17 · ขา 16–30 แถว d คอลัมน์ 17–3
 */
const ID = 'NANO1';
/** รูว่างที่ต่อกับขา (กลุ่มเดียวกัน): ขา 1–15 → แถว i/j, ขา 16–30 → แถว a/b/c */
function nh(pin: string, row?: string): string {
  const k = NANO_PINOUT.findIndex(([n]) => n === pin) + 1;
  if (k <= 0) throw new Error(pin);
  return k <= 15 ? `${row ?? 'j'}${2 + k}` : `${row ?? 'a'}${33 - k}`;
}
function nanoBase(hex: string, code = 'x') {
  return new Builder().part('nano', onBoard('h3'), ID, { code, hex, hexSrc: code })
    .wire(H(nh('GND.2')), H('tn4'), 'g1', '#212121').wire(H(nh('5V')), H('tp6'), 'p1', '#e53935').wire(H(nh('GND.1')), H('bn6'), 'g2', '#212121');
}
type Mcu = Record<string, { reset?: boolean; serial?: number[] }>;
function run(b: Builder, sec: number, cmd?: (t: number) => boolean | void, mcu?: (t: number) => Mcu | undefined) {
  const e = new SimEngine();
  let built = buildNetlist(b.doc);
  let con = '';
  const st: Array<{ t: number; con: string; an: ReturnType<typeof analyze>; m: NonNullable<ReturnType<SimEngine['handle']>['mcu']>[number] | undefined }> = [];
  for (let k = 0; k < Math.round(sec / 0.05); k++) {
    const t = +((k + 1) * 0.05).toFixed(3);
    if (cmd?.(t)) built = buildNetlist(b.doc);
    const mc = mcu?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9, ...(mc ? { mcu: mc } : {}) });
    const m = r.mcu?.find((x) => x.id === ID);
    con += m?.console ?? '';
    st.push({ t, con, an: analyze(b.doc, built, r.result, r.tones), m });
  }
  return { con, st };
}

describe('Arduino Nano: ขาและการวางบนเบรดบอร์ด', () => {
  it('30 ขา: ขา 1–15 แถว h, ขา 16–30 แถว d ห่าง 0.6" · ขา 15 (D12) ตรงข้ามขา 16 (D13) · บอร์ดปิดทับแถว e f g', () => {
    const b = new Builder().part('nano', onBoard('h3'), ID, {});
    const p = b.doc.parts[0];
    const holes = Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]));
    expect(pinDefs(p)).toHaveLength(30);
    expect(holes).toMatchObject({ D1: 'h3', D0: 'h4', 'RST.1': 'h5', 'GND.1': 'h6', D2: 'h7', D12: 'h17', D13: 'd17', '3V3': 'd16', A0: 'd14', A7: 'd7', '5V': 'd6', 'GND.2': 'd4', VIN: 'd3' });
    expect(new Set(coveredHoles(p).map((h) => h[0]))).toEqual(new Set(['e', 'f', 'g']));
    expect(coveredHoles(p)).toHaveLength(15 * 3);
    // ขาสองแถวอยู่คนละฝั่งร่องกลาง → ไม่มีขาใดลัดกันเอง (GND.1–GND.2 และ RST ต่อกันบนบอร์ดเท่านั้น)
    const c = computeConnectivity(b.doc);
    const nets = new Set(pinDefs(p).map((d) => netOfPin(c, ID, d.name)));
    expect(nets.size).toBe(30 - 2);
    // วางผิดแถว (ขาอีกแถวตกร่องกลาง) / วางทับสายที่อยู่ใต้บอร์ด → ไม่ยอม
    const bad = addPart(new Builder().doc, 'nano', onBoard('j3'), 'N2');
    expect(bad.ok).toBe(false);
    const w = new Builder().wire(H('f10'), H('f20'), 'w1');
    const r = addPart(w.doc, 'nano', onBoard('h3'), 'N3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('ปิดทับ');
    expect(checkPlacement(b.doc, p).ok).toBe(true);
  });
});

describe('Arduino Nano: โปรแกรมที่คอมไพล์เป็นบอร์ด Nano รันกับวงจร', () => {
  /** VR 10 kΩ ที่ a22–a24 (ขา 1 → GND, ขา 3 → 5V, แกนกลาง → A7) · A6 ต่อ 3V3 · LED + 220 Ω ที่ D9 */
  const potRig = (pos: number) => nanoBase(potHex, NANO_POT_CODE)
    .part('potentiometer', onBoard('a22'), 'VR1', { resistance: 10000, position: pos })
    .wire(H('b22'), H('tn22'), 'v1', '#212121').wire(H('b24'), H('tp24'), 'v2', '#e53935').wire(H('c23'), H(nh('A7', 'b')), 'v3', '#fb8c00')
    .wire(H(nh('A6', 'b')), H(nh('3V3', 'b')), 'a6', '#8e24aa')
    .part('resistor', onBoard('j14'), 'R1', { resistance: 220, span: 5 }).part('led', onBoard('i19'), 'LED1', {})
    .wire(H('j20'), H('bn20'), 'k1', '#212121');
  it('analogRead(A7) ตามตำแหน่ง VR · A6 ต่อ 3V3 → ≈ 675 · digitalRead(A7) = 0 แม้ A7 = 5 V (A6/A7 ไม่มีวงจรขาดิจิทัล)', { timeout: 60000 }, () => {
    for (const pos of [0.25, 0.75, 1]) {
      const { con } = run(potRig(pos), 0.6);
      const last = con.trim().split('\n').pop()!.trim();
      const m = /^A6=(\d+) A7=(\d+) dA7=(\d)$/.exec(last);
      expect(m, last).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(672);
      expect(Number(m![1])).toBeLessThanOrEqual(678);
      expect(Math.abs(Number(m![2]) - Math.min(1023, pos * 1024))).toBeLessThanOrEqual(4);
      expect(m![3]).toBe('0');
    }
  });
  it('analogWrite(D9) หรี่ LED ตามค่า A7: กระแสเฉลี่ย ∝ duty · LED L บนบอร์ด (D13) ติดเมื่อ A7 > 512', { timeout: 60000 }, () => {
    const lo = run(potRig(0.25), 0.6), hi = run(potRig(0.75), 0.6);
    const iLo = Math.abs(lo.st.at(-1)!.an.parts.LED1.current), iHi = Math.abs(hi.st.at(-1)!.an.parts.LED1.current);
    expect(iLo).toBeGreaterThan(1e-3);
    expect(iHi / iLo).toBeGreaterThan(2.6);
    expect(iHi / iLo).toBeLessThan(3.4);
    expect(lo.st.at(-1)!.m!.led).toBeLessThan(0.05);
    expect(hi.st.at(-1)!.m!.led).toBeGreaterThan(0.95);
    // PWM จริง: ขา D9 เปลี่ยนระดับหลายครั้งในช่วง 50 ms
    expect(hi.st.at(-1)!.m!.edges![9]).toBeGreaterThan(20);
  });
  it('Blink (คอมไพล์เป็น Nano) กะพริบ LED ที่ต่อ D13 ทุก 0.5 s · ไม่มีโปรแกรม → LED ดับ', { timeout: 60000 }, () => {
    const rig = (hex: string | null) => new Builder().part('nano', onBoard('h3'), ID, { hex, hexSrc: 'x', code: 'x' })
      .wire(H(nh('GND.2')), H('tn4'), 'g1', '#212121').part('resistor', onBoard('b17'), 'R1', { resistance: 220, span: 5 }).part('led', onBoard('c22'), 'LED1', {}).wire(H('a23'), H('tn23'), 'k', '#212121');
    const { st, con } = run(rig(blinkHex), 1.2);
    const at = (t: number) => Math.abs(st.find((s) => Math.abs(s.t - t) < 1e-6)!.an.parts.LED1.current);
    expect(at(0.3)).toBeGreaterThan(5e-3);
    expect(at(0.8)).toBeLessThan(1e-5);
    expect(con).toContain('LED ON');
    const none = run(rig(null), 0.3);
    expect(Math.abs(none.st.at(-1)!.an.parts.LED1.current)).toBeLessThan(1e-6);
  });
  it('interrupt INT0 (D2) นับการกดปุ่ม 2 ครั้ง', { timeout: 60000 }, () => {
    const b = nanoBase(interruptHex).part('pushbutton', onBoard('f25'), 'SW1', {}).wire(H('a25'), H('tn24'), 'sg', '#212121').wire(H(nh('D2')), H('a27'), 's1', '#1e88e5');
    const press = (v: boolean) => { const x = setPartParams(b.doc, 'SW1', { pressed: v } as never); if (x.ok) b.doc = x.doc; return true; };
    const { con } = run(b, 1.4, (t) => {
      for (const [a, z] of [[0.4, 0.6], [0.9, 1.1]]) { if (Math.abs(t - a) < 1e-6) return press(true); if (Math.abs(t - z) < 1e-6) return press(false); }
    });
    expect(con).toContain('ready');
    expect(con.trim().split('\n').pop()!.trim()).toMatch(/^INT0=2 /);
  });
  it('EEPROM นับการบูตข้าม RESET · watchdog 250 ms รีเซ็ตบอร์ดเอง', { timeout: 60000 }, () => {
    eepromOf(ID).memory.fill(0xff);
    const e = run(nanoBase(eepromHex), 0.8, undefined, (t) => (Math.abs(t - 0.4) < 1e-6 ? { [ID]: { reset: true } } : undefined));
    expect(e.con.match(/boot \d+/g)).toEqual(['boot 1', 'boot 2']);
    eepromOf(ID).memory.fill(0xff);
    const w = run(nanoBase(watchdogHex), 1.6);
    expect(w.con.match(/start t=0/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('EEPROM จากไฟล์งาน (ไบต์ 0 = 7) → โปรแกรมอ่านได้ "boot 8"', { timeout: 60000 }, () => {
    const mem = new Uint8Array(1024).fill(0xff); mem[0] = 7;
    const b = nanoBase(eepromHex);
    const x = setPartParams(b.doc, ID, { eeprom: bytesToB64(mem) } as never); if (x.ok) b.doc = x.doc;
    expect(run(b, 0.4).con).toContain('boot 8');
    eepromOf(ID).memory.fill(0xff);
  });
  it('SPI.transfer(): MISO (D12) ต่อ 5V → 0xFF · ลอย → 0x0', { timeout: 60000 }, () => {
    expect(run(nanoBase(spiHex), 0.5).con).toContain('rx=0x0');
    expect(run(nanoBase(spiHex).wire(H(nh('D12')), H('tp18'), 'mi', '#e53935'), 0.5).con).toContain('rx=0xFF');
  });
  it('Servo (Timer1) ที่ D9: write(45) → พัลส์ ≈ 1.0 ms · tone(8, 440) → บัซเซอร์ 440 Hz', { timeout: 60000 }, () => {
    const b = nanoBase(servotoneHex).part('servo', onTable(-60, 30), 'SV1', {}).part('buzzer', onBoard('a25'), 'BZ1', buzzerParamsFor('passive'));
    b.wire(P('SV1', 'GND'), H('tn26'), 'sg', '#212121').wire(P('SV1', 'V'), H('tp26'), 'sv', '#e53935').wire(P('SV1', 'SIG'), H(nh('D9')), 'ss', '#fb8c00')
      .wire(H(nh('D8')), H('b25'), 'bz', '#43a047').wire(H('e28'), H('tn28'), 'bg', '#212121');
    const e = new SimEngine(), built = buildNetlist(b.doc);
    let tones: Record<string, { pw?: number; freq: number }> = {};
    for (let k = 0; k < 21; k++) tones = (e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 }).tones ?? {}) as never;
    expect(tones.SV1.pw! * 1000).toBeCloseTo(1.008, 2);
    expect(tones.BZ1.freq).toBeCloseTo(440, 0);
  });
  it('I²C (Wire) ที่ A4/A5 อ่าน INA219: 5 V / 220 Ω ≈ 22.7 mA', { timeout: 120000 }, () => {
    const b = nanoBase(inaHex).part('ina219', onBoard('j22'), 'INA1', {})
      .wire(H('tp22'), H('f22'), 'iv', '#e53935').wire(H('bn23'), H('f23'), 'ig', '#212121').wire(H(nh('A5', 'b')), H('f24'), 'scl', '#fdd835').wire(H(nh('A4', 'b')), H('f25'), 'sda', '#1e88e5')
      .wire(H('tp27'), H('f27'), 'vin', '#e53935').part('resistor', onBoard('g26'), 'R1', { resistance: 220, span: 4 }).wire(H('h30'), H('bn30'), 'rg', '#212121');
    const { con } = run(b, 1.0);
    expect(con).toContain('I2C: 0x40\r\n');
    expect(con).toMatch(/I=22\.[67] mA/);
  });
});

describe('Arduino Nano + Uno ในวงจรเดียว', () => {
  it('D13 ของ Nano (Blink) → D2 ของ Uno (INT0 FALLING) นับขอบลงทุก 1 s', { timeout: 60000 }, () => {
    const b = nanoBase(blinkHex).part('uno', onTable(-70, -10), 'UNO1', { code: 'x', hex: unoInterruptHex, hexSrc: 'x' })
      .wire(H(nh('D13', 'b')), P('UNO1', 'D2'), 'x1', '#1e88e5').wire(H('tn10'), P('UNO1', 'GND.1'), 'x2', '#212121');
    const e = new SimEngine(), built = buildNetlist(b.doc);
    let con = '';
    for (let k = 0; k < 52; k++) con += e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 }).mcu?.find((m) => m.id === 'UNO1')?.console ?? '';
    expect(con.trim().split('\n').pop()!.trim()).toMatch(/^INT0=3 /);
  });
});

describe('Arduino Nano: ไฟเลี้ยงและคำเตือน', () => {
  it('ขา 3V3 จ่ายได้ ≤ 50 mA: โหลด 47 Ω (≈ 70 mA) → แรงดันตก + คำเตือนอันตราย · 150 Ω (≈ 22 mA) → ไม่เตือน', { timeout: 60000 }, () => {
    const rig = (r: number) => nanoBase(blinkHex).part('resistor', onBoard('b20'), 'RL', { resistance: r, span: 4 }).wire(H(nh('3V3', 'c')), H('c20'), 'l1', '#e53935').wire(H('c24'), H('tn24'), 'l2', '#212121');
    const heavy = run(rig(47), 0.2).st.at(-1)!.an;
    expect(Math.abs(heavy.parts.RL.current)).toBeLessThan(0.0505);
    expect(heavy.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('3V3') && d.message.includes('50 mA'))).toBe(true);
    const ok = run(rig(150), 0.2).st.at(-1)!.an;
    expect(Math.abs(ok.parts.RL.current)).toBeCloseTo(3.3 / 150 / (1 + 0.5 / 150), 3);
    expect(ok.diagnostics.some((d) => d.message.includes('3V3'))).toBe(false);
  });
  it('LED ไม่มีตัวต้านทานที่ D13 → กระแสขาถึง 40 mA → คำเตือนอันตราย (ชื่อขาของ Nano)', { timeout: 60000 }, () => {
    const b = nanoBase(blinkHex).part('led', onBoard('b17'), 'LED1', {}).wire(H('c18'), H('tn18'), 'k', '#212121');
    const an = run(b, 0.3).st.find((s) => s.t === 0.25)!.an;
    expect(an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('ขา D13'))).toBe(true);
  });
  it('ขาตามบอร์ด Nano (มี A6/A7 ไม่มี IOREF/SDA/SCL แยกแบบ Uno) · วางบนโต๊ะได้ (ขาไม่ต่อกับอะไรจนกว่าจะต่อสาย)', () => {
    const names = NANO_PINOUT.map(([n]) => n);
    expect(names).not.toContain('IOREF');
    expect(names).toContain('A7');
    const t = new Builder().part('nano', onTable(-60, 20), 'N9', {});
    expect(t.doc.parts[0].placement.kind).toBe('table');
  });
});

describe('แลป 55 (Arduino Nano) ตรวจผลจากวงจรที่ต่อจริง', () => {
  /** วงจรตามขั้นตอนของแลป: VR ขา 1 → GND, ขา 3 → 5V, แกนกลาง → A7 · D9 → 220 Ω → LED → GND */
  const lab = (pos: number, o: { pin?: string; hex?: string | null } = {}) => nanoBase(o.hex === undefined ? potHex : o.hex ?? '', NANO_POT_CODE)
    .part('potentiometer', onBoard('a22'), 'VR1', { resistance: 10000, position: pos })
    .wire(H('b22'), H('tn22'), 'v1', '#212121').wire(H('b24'), H('tp24'), 'v2', '#e53935').wire(H('c23'), H(nh(o.pin ?? 'A7', 'b')), 'v3', '#fb8c00')
    .part('resistor', onBoard('j14'), 'R1', { resistance: 220, span: 5 }).part('led', onBoard('i19'), 'LED1', {}).wire(H('j20'), H('bn20'), 'k1', '#212121');
  const check = (b: Builder, sec = 0.6) => {
    const e = new SimEngine(), built = buildNetlist(b.doc);
    let r!: ReturnType<SimEngine['handle']>;
    for (let k = 0; k < sec / 0.05; k++) r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
    const analysis = analyze(b.doc, built, r.result, r.tones);
    return checkLesson('nano', { doc: b.doc, built, result: r.result, analysis, work: emptyWork(), mcu: r.mcu });
  };
  it('ต่อครบ + อัปโหลด + หมุน VR ต่ำ/สูง → ผ่านทุกข้อ (ต่ำและสูงเห็นในการรันแต่ละครั้ง)', { timeout: 60000 }, () => {
    const lo = check(lab(0.25)), hi = check(lab(0.8));
    for (const g of ['place', 'pot', 'led', 'upload']) { expect(lo[g].pass, `${g}: ${lo[g].detail}`).toBe(true); expect(hi[g].pass).toBe(true); }
    expect(lo._dim?.pass).toBe(true);
    expect(hi._bright?.pass).toBe(true);
  });
  it('แกนกลาง VR ต่อ A0 แทน A6/A7 → ข้อ pot ไม่ผ่าน · ไม่มีโปรแกรม → upload/pwm ไม่ผ่าน · Nano วางบนโต๊ะ → place ไม่ผ่าน', { timeout: 60000 }, () => {
    const a0 = check(lab(0.25, { pin: 'A0' }));
    expect(a0.pot.pass).toBe(false);
    expect(a0.pot.detail).toContain('A7');
    const none = check(lab(0.25, { hex: null }));
    expect(none.upload.pass).toBe(false);
    expect(none._dim).toBeUndefined();
    const t = new Builder().part('nano', onTable(-60, 20), ID, {});
    expect(check(t, 0.1).place.pass).toBe(false);
  });
});
