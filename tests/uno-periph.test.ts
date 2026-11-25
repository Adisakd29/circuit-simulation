import { describe, expect, it } from 'vitest';
import interruptHex from './fixtures/uno/interrupt.hex?raw';
import eepromHex from './fixtures/uno/eeprom.hex?raw';
import watchdogHex from './fixtures/uno/watchdog.hex?raw';
import spiHex from './fixtures/uno/spi.hex?raw';
import servotoneHex from './fixtures/uno/servotone.hex?raw';
import blinkHex from './fixtures/uno/blink.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { setPartParams } from '../src/editor/ops';
import { buzzerParamsFor, UNO_DEFAULT_CODE } from '../src/model/catalog';
import { eepromOf } from '../src/mcu/avr-emu';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { unoRig } from './uno-rig';

/**
 * อุปกรณ์ภายใน ATmega328P ที่ตรวจในรอบ Audit (2026-10-29) — ทุกข้อคอมไพล์ sketch จริงด้วย avr-gcc (tests/fixtures/uno/*.ino → .hex ด้วย gen.ts)
 * แล้วรันบน avr8js ร่วมกับวงจร · ไม่มีข้อใดอ่านข้อความโค้ด
 */
type Mcu = Record<string, { reset?: boolean; serial?: number[] }>;
function run(b: Builder, sec: number, cmd?: (t: number) => boolean | void, mcu?: (t: number) => Mcu | undefined, e = new SimEngine(), id = 'UNO1') {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: Array<{ t: number; con: string; an: ReturnType<typeof analyze>; r: ReturnType<SimEngine['handle']> }> = [];
  for (let k = 0; k < Math.round(sec / 0.05); k++) {
    const t = +((k + 1) * 0.05).toFixed(3);
    if (cmd?.(t)) built = buildNetlist(b.doc);
    const m = mcu?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9, ...(m ? { mcu: m } : {}) });
    con += r.mcu?.find((x) => x.id === id)?.console ?? '';
    st.push({ t, con, r, an: analyze(b.doc, built, r.result, r.tones) });
  }
  return { con, st };
}
const press = (b: Builder, id: string, v: boolean) => { const x = setPartParams(b.doc, id, { pressed: v } as never); if (x.ok) b.doc = x.doc; return true; };
/** ปุ่ม SW1 f20 → D2 (a22) และ SW2 f26 → D4 (a28) อีกฝั่งลง GND · ใช้ INPUT_PULLUP */
function interruptRig() {
  const b = unoRig({ hex: interruptHex, code: 'x' });
  b.part('pushbutton', onBoard('f20'), 'SW1', {}).part('pushbutton', onBoard('f26'), 'SW2', {});
  b.wire(H('a20'), H('tn20'), 'g1', '#212121').wire(P('UNO1', 'D2'), H('a22'), 's1', '#1e88e5').wire(H('a26'), H('tn26'), 'g2', '#212121').wire(P('UNO1', 'D4'), H('a28'), 's2', '#8e24aa');
  return b;
}

describe('Arduino Uno: interrupt, timer, EEPROM, watchdog, SPI, Servo/tone (Audit)', () => {
  it('attachInterrupt(INT0, FALLING) นับครั้งที่กดปุ่มตรงจำนวน · PCINT20 (D4) นับทุกขอบ · LED D13 สลับใน ISR', { timeout: 60000 }, () => {
    const b = interruptRig();
    const spans: Array<[number, number]> = [[0.5, 0.7], [1.0, 1.2], [1.5, 1.6]];
    const { con, st } = run(b, 2.0, (t) => {
      for (const [a, z] of spans) { if (Math.abs(t - a) < 1e-6) return press(b, 'SW1', true); if (Math.abs(t - z) < 1e-6) return press(b, 'SW1', false); }
      if (Math.abs(t - 0.8) < 1e-6) return press(b, 'SW2', true);
      if (Math.abs(t - 0.9) < 1e-6) return press(b, 'SW2', false);
    });
    expect(con).toContain('ready');
    expect(con.trim().split('\n').pop()!.trim()).toBe('INT0=3 PCINT=2');
    expect(con).toContain('INT0=1 PCINT=0');
    // ปล่อยปุ่ม (ขอบขึ้น) ไม่นับ: หลังกดครั้งแรกจนก่อนกดครั้งที่สอง ค่ายัง 1
    const at = (t: number) => st.find((s) => Math.abs(s.t - t) < 1e-6)!;
    expect(at(0.95).con).not.toContain('INT0=2');
    // LED (D13) สลับ 3 ครั้ง → ติดค้างหลังกดครั้งที่ 1 และ 3
    const led = (t: number) => Math.abs(at(t).an.parts.LED1?.current ?? 0);
    expect(led(0.9)).toBeGreaterThan(5e-3);
    expect(led(1.4)).toBeLessThan(1e-5);
    expect(led(1.9)).toBeGreaterThan(5e-3);
  });

  it('ไม่ต่อสายปุ่ม INT0 → ไม่มี interrupt (ผลมาจากวงจร ไม่ใช่จากข้อความโค้ด)', { timeout: 60000 }, () => {
    const b = unoRig({ hex: interruptHex, code: 'x' });
    b.part('pushbutton', onBoard('f20'), 'SW1', {}).wire(H('a20'), H('tn20'), 'g1', '#212121');
    const { con } = run(b, 1.0, (t) => (Math.abs(t - 0.5) < 1e-6 ? press(b, 'SW1', true) : undefined));
    expect(con).toContain('INT0=0 PCINT=0');
    expect(con).not.toContain('INT0=1');
  });

  it('EEPROM: นับการบูต 1 → 2 (RESET) → 3 (RESET) → 4 (เริ่มจำลองใหม่ บอร์ดเดิม) — ค่าอยู่ใน EEPROM ไม่ใช่ RAM', { timeout: 60000 }, () => {
    eepromOf('UNO1').memory.fill(0xff);
    const b = unoRig({ hex: eepromHex, code: 'x' });
    const r1 = run(b, 1.0, undefined, (t) => (Math.abs(t - 0.4) < 1e-6 || Math.abs(t - 0.7) < 1e-6 ? { UNO1: { reset: true } } : undefined));
    expect(r1.con.match(/boot \d+/g)).toEqual(['boot 1', 'boot 2', 'boot 3']);
    const r2 = run(b, 0.3);
    expect(r2.con).toContain('boot 4');
    expect(eepromOf('UNO1').memory[0]).toBe(4);
    eepromOf('UNO1').memory.fill(0xff);
  });

  it('watchdog 250 ms: เลี้ยงไว้ 1 s แล้วหยุดเลี้ยง → บอร์ดรีเซ็ตเองหลัง ~1.25 s และเริ่มโปรแกรมใหม่ (MCUSR = 0 เหมือนหลังผ่าน optiboot)', { timeout: 60000 }, () => {
    const b = unoRig({ hex: watchdogHex, code: 'x' });
    const { st } = run(b, 2.0);
    const starts = st.filter((s, i) => (s.con.match(/start/g)?.length ?? 0) > (i ? st[i - 1].con.match(/start/g)?.length ?? 0 : 0)).map((s) => s.t);
    expect(starts[0]).toBeLessThan(0.1);
    expect(starts[1]).toBeGreaterThan(1.2);
    expect(starts[1]).toBeLessThan(1.4);
    expect(st[st.length - 1].con).toMatch(/start t=0\r?\n.*start t=0/s);
  });

  it('SPI.transfer() ไม่ค้าง · ไบต์ที่อ่าน = ระดับ MISO (D12): ลอย/ต่อ GND → 0x0 · ต่อ 5V → 0xFF', { timeout: 60000 }, () => {
    const low = run(unoRig({ hex: spiHex, code: 'x' }), 0.5);
    expect(low.con.match(/rx=0x0/g)!.length).toBeGreaterThanOrEqual(2);
    const b = unoRig({ hex: spiHex, code: 'x' }).wire(P('UNO1', 'D12'), P('UNO1', '5V'), 'w5', '#e53935');
    const high = run(b, 0.5);
    expect(high.con).toContain('rx=0xFF');
  });

  it('Servo (Timer1) 50 Hz: write(45) → พัลส์ ≈ 1.0 ms · write(135) → ≈ 1.94 ms · tone(8, 440) → บัซเซอร์แบบพาสซีฟ 440 Hz', { timeout: 60000 }, () => {
    const b = unoRig({ hex: servotoneHex, code: 'x' });
    b.part('servo', onTable(-60, 30), 'SV1', {}).part('buzzer', onBoard('a25'), 'BZ1', buzzerParamsFor('passive'));
    b.wire(P('SV1', 'GND'), H('tn12'), 'sg', '#212121').wire(P('SV1', 'V'), P('UNO1', '5V'), 'sv', '#e53935').wire(P('SV1', 'SIG'), P('UNO1', 'D9'), 'ss', '#fb8c00')
      .wire(P('UNO1', 'D8'), H('b25'), 'bz', '#43a047').wire(H('e28'), H('tn28'), 'bg', '#212121');
    const { st } = run(b, 2.5);
    const sv = (i: number) => st[i].r.tones!.SV1 as unknown as { pw: number; freq: number };
    expect(sv(20).pw * 1000).toBeCloseTo(1.008, 2);
    expect(sv(20).freq).toBeCloseTo(50, 0);
    expect(sv(48).pw * 1000).toBeCloseTo(1.936, 2);
    expect(st[20].r.tones!.BZ1.freq).toBeCloseTo(440, 0);
  });

  it('สองบอร์ดในวงจรเดียว: D13 ของ UNO1 (Blink) → D2 ของ UNO2 (INT0 FALLING) นับขอบลงทุก 1 s', { timeout: 60000 }, () => {
    const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: UNO_DEFAULT_CODE, hex: blinkHex, hexSrc: UNO_DEFAULT_CODE })
      .part('uno', onTable(-70, 30), 'UNO2', { code: 'x', hex: interruptHex, hexSrc: 'x' })
      .wire(P('UNO1', 'D13'), P('UNO2', 'D2'), 'w1', '#1e88e5').wire(P('UNO1', 'GND.1'), P('UNO2', 'GND.1'), 'w2', '#212121');
    const { con } = run(b, 2.6, undefined, undefined, new SimEngine(), 'UNO2');
    // Blink: ติด 0–0.5, ดับที่ 0.5, 1.5, 2.5 → ขอบลง 3 ครั้ง
    // (PCINT ของ UNO2 ไม่ตรวจ: บอร์ดรองรับค่าขาเข้าที่ตัวเองเปลี่ยนช้าได้ถึงหนึ่งช่วงคำนวณ — ข้อจำกัดที่บันทึกไว้)
    expect(con.trim().split('\n').pop()!.trim()).toMatch(/^INT0=3 /);
  });
});

describe('ตัวควบคุมการจำลอง: คำสั่งถึงบอร์ด', () => {
  it('ปุ่ม RESET ของ Uno ส่งคำสั่ง reset ถึงตัวจำลองจริง (เดิมคำสั่งหายระหว่างรวมคำสั่ง ปุ่มจึงไม่มีผล)', async () => {
    const { SimulationController } = await import('../src/sim/controller');
    const c = new SimulationController();
    c.mcuCommand('UNO1', { reset: true });
    c.mcuCommand('UNO1', { serial: [65] });
    expect((c as unknown as { mcuCmds: Record<string, unknown> }).mcuCmds.UNO1).toEqual({ reset: true, serial: [65] });
  });
});

describe('EEPROM ของ Uno บันทึกลงไฟล์งาน', () => {
  it('เปิดไฟล์ที่มี EEPROM (ไบต์ 0 = 7) → โปรแกรมอ่านได้ "boot 8" · ตัวจำลองส่งเนื้อหาใหม่กลับ (ไบต์ 0 = 8) ครั้งเดียวต่อการเขียน', { timeout: 60000 }, async () => {
    const { bytesToB64, b64ToBytes, eepromOf: eo } = await import('../src/mcu/avr-emu');
    const { validateCircuit } = await import('../src/model/schema');
    const mem = new Uint8Array(1024).fill(0xff); mem[0] = 7;
    const b = unoRig({ hex: eepromHex, code: 'x' });
    const x = setPartParams(b.doc, 'UNO1', { eeprom: bytesToB64(mem) } as never); if (x.ok) b.doc = x.doc;
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const { con, st } = run(b, 0.4);
    expect(con).toContain('boot 8');
    const sent = st.map((s) => s.r.mcu!.find((m) => m.id === 'UNO1')!.eeprom).filter(Boolean) as string[];
    expect(sent).toHaveLength(1);
    expect(b64ToBytes(sent[0])[0]).toBe(8);
    expect(b64ToBytes(sent[0]).length).toBe(1024);
    // เปิดไฟล์อื่นที่ไม่มี EEPROM (บอร์ด id เดียวกัน) → EEPROM ว่าง → boot 1
    const c = unoRig({ hex: eepromHex, code: 'x' });
    expect(run(c, 0.3).con).toContain('boot 1');
    eo('UNO1').memory.fill(0xff);
  });
});
