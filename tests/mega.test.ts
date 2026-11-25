import { describe, expect, it } from 'vitest';
import blinkHex from './fixtures/uno/mega-blink.hex?raw';
import ioHex from './fixtures/uno/mega-io.hex?raw';
import intHex from './fixtures/uno/mega-int.hex?raw';
import uartHex from './fixtures/uno/mega-uart.hex?raw';
import eepromHex from './fixtures/uno/mega-eeprom.hex?raw';
import spiHex from './fixtures/uno/mega-spi.hex?raw';
import inaHex from './fixtures/uno/mega-ina219.hex?raw';
import watchdogHex from './fixtures/uno/mega-watchdog.hex?raw';
import servotoneHex from './fixtures/uno/mega-servotone.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { setPartParams } from '../src/editor/ops';
import { MEGA_DIGITAL, MEGA_PINOUT, UNO_DEFAULT_CODE, buzzerParamsFor, catalogEntry, internalLinks, pinDefs } from '../src/model/catalog';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { AVR_2560, b64ToBytes, bytesToB64, eepromOf } from '../src/mcu/avr-emu';
import { LogicBuffer, decodeUart, guessBaud, uartText } from '../src/instruments/logic';
import { validateCircuit } from '../src/model/schema';
import type { LogicAnalyzerPart } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * Arduino Mega 2560 (ATmega2560) — ทุกข้อรันไฟล์ .hex ที่คอมไพล์จริงเป็นบอร์ด Mega 2560 (avr-gcc + variant mega:
 * tests/fixtures/uno/gen.ts → mega-*.hex) บนตัวจำลอง CPU avr8js ที่ตั้งโปรไฟล์ชิป ATmega2560 (src/mcu/avr-chips.ts) ร่วมกับวงจร
 * ไม่มีข้อใดอ่านข้อความโค้ดแทนการรัน
 */
const ID = 'MEGA1';
type Mcu = Record<string, { reset?: boolean; serial?: number[] }>;
type Step = { t: number; con: string; an: ReturnType<typeof analyze>; r: ReturnType<SimEngine['handle']>; m: NonNullable<ReturnType<SimEngine['handle']>['mcu']>[number] | undefined };
function run(b: Builder, sec: number, cmd?: (t: number) => boolean | void, mcu?: (t: number) => Mcu | undefined, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: Step[] = [];
  const buf = new LogicBuffer();
  for (let k = 0; k < Math.round(sec / 0.05); k++) {
    const t = +((k + 1) * 0.05).toFixed(3);
    if (cmd?.(t)) built = buildNetlist(b.doc);
    const mc = mcu?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9, ...(mc ? { mcu: mc } : {}) });
    const m = r.mcu?.find((x) => x.id === ID);
    con += m?.console ?? '';
    if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
    st.push({ t, con, r, m, an: analyze(b.doc, built, r.result, r.tones) });
  }
  return { con, st, buf, built };
}
/** Mega บนโต๊ะ · LED1 + R1 220 Ω บนเบรดบอร์ด (ขา → b5, R a5–a8, LED c8/c9, K e9 → GND) */
function megaRig(hex: string | null, o: { pin?: string; r?: number } = {}) {
  return new Builder().part('mega', onTable(-90, -10), ID, { code: 'x', hex, hexSrc: 'x' })
    .part('resistor', onBoard('a5'), 'R1', { resistance: o.r ?? 220, span: 3 }).part('led', onBoard('c8'), 'LED1')
    .wire(P(ID, o.pin ?? 'D13'), H('b5'), 'w1', '#43a047').wire(H('e9'), H('tn9'), 'w2', '#212121').wire(P(ID, 'GND.1'), H('tn3'), 'w3', '#212121');
}
const press = (b: Builder, id: string, v: boolean) => { const x = setPartParams(b.doc, id, { pressed: v } as never); if (x.ok) b.doc = x.doc; return true; };

describe('Arduino Mega 2560: ขา หัวต่อ และโปรไฟล์ชิป', () => {
  it('85 ขา: D0–D53, A0–A15, หัวต่อไฟเลี้ยง และหัวต่อคู่ 5V/GND · SDA = D20, SCL = D21, GND/5V ทุกขาต่อกันบนบอร์ด', () => {
    const b = new Builder().part('mega', onTable(-90, -10), ID, {});
    const p = b.doc.parts[0];
    expect(catalogEntry('mega')!.supported).toBe(true);
    expect(pinDefs(p)).toHaveLength(85);
    expect(MEGA_DIGITAL).toHaveLength(70);
    expect(MEGA_DIGITAL[54]).toBe('A0');
    expect(MEGA_DIGITAL[69]).toBe('A15');
    const c = computeConnectivity(b.doc);
    const n = (pin: string) => netOfPin(c, ID, pin);
    expect(n('SDA')).toBe(n('D20'));
    expect(n('SCL')).toBe(n('D21'));
    expect(new Set(['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5'].map(n)).size).toBe(1);
    expect(new Set(['5V', '5V.2', '5V.3', 'IOREF'].map(n)).size).toBe(1);
    expect(internalLinks(p).flat()).not.toContain('D13');
    // ป้ายขาบอกหน้าที่ตาม variants/mega
    const lab = Object.fromEntries(MEGA_PINOUT);
    expect(lab.D46).toContain('T5A');
    expect(lab.D19).toContain('RX1');
    expect(lab.D50).toContain('MISO');
    expect(lab.A15).toContain('D69');
  });

  it('โปรไฟล์ ATmega2560: ตารางขาตรง digital_pin_to_port/bit · SRAM 8 KB · EEPROM 4 KB · ADC 16 ช่อง · USART 4 ชุด', () => {
    expect(AVR_2560.pins).toHaveLength(70);
    expect(AVR_2560.pins[13]).toEqual(['B', 7]);
    expect(AVR_2560.pins[2]).toEqual(['E', 4]);
    expect(AVR_2560.pins[21]).toEqual(['D', 0]);
    expect(AVR_2560.pins[53]).toEqual(['B', 0]);
    expect(AVR_2560.pins[62]).toEqual(['K', 0]);
    expect(AVR_2560.sramBytes).toBe(0x2100);
    expect(AVR_2560.eepromBytes).toBe(4096);
    expect(AVR_2560.adcChannels).toBe(16);
    expect(AVR_2560.usarts.map((u) => u.UDR)).toEqual([0xc6, 0xce, 0xd6, 0x136]);
    // เวกเตอร์ interrupt (avr-libc iomxx0_1.h): TIMER0_OVF = 23, TWI = 39, USART3_RX = 54
    expect(AVR_2560.timers[0].ovfInterrupt).toBe(23 * 2);
    expect(AVR_2560.twi!.twiInterrupt).toBe(39 * 2);
    expect(AVR_2560.usarts[3].rxCompleteInterrupt).toBe(54 * 2);
  });
});

describe('Arduino Mega 2560: รันโปรแกรมที่คอมไพล์จริงร่วมกับวงจร', () => {
  it('Blink: LED ที่ D13 ติด 0.5 s ดับ 0.5 s · Serial Monitor ได้ข้อความ · ไม่มีโปรแกรม = ขาลอย LED ดับ', { timeout: 60000 }, () => {
    const { con, st } = run(megaRig(blinkHex), 2.2);
    const led = (t: number) => Math.abs(st.find((s) => Math.abs(s.t - t) < 1e-6)!.an.parts.LED1?.current ?? 0);
    expect(led(0.3)).toBeGreaterThan(5e-3);
    expect(led(0.8)).toBeLessThan(1e-5);
    expect(led(1.3)).toBeGreaterThan(5e-3);
    expect(led(1.8)).toBeLessThan(1e-5);
    expect(con).toMatch(/LED ON/);
    expect(st[0].m!.pins).toHaveLength(70);
    const none = run(megaRig(null), 0.3);
    expect(Math.abs(none.st[5].an.parts.LED1?.current ?? 0)).toBeLessThan(1e-6);
  });

  it('PWM ทุก Timer (0–5): duty ตรงค่า analogWrite · Timer0 ≈ 977 Hz อื่น ≈ 490 Hz · พอร์ต A/C ตามโค้ด · ADC A0/A8/A15 (MUX5) จากแรงดันวงจร · INPUT_PULLUP D30 คุม D31 · Serial echo', { timeout: 120000 }, () => {
    const b = megaRig(ioHex)
      .wire(P(ID, 'A0'), P(ID, '5V'), 'a0', '#e53935').wire(P(ID, 'A8'), P(ID, 'GND.2'), 'a8', '#212121').wire(P(ID, 'A15'), P(ID, '3V3'), 'a15', '#ff9800')
      .wire(P(ID, 'D30'), P(ID, 'GND.4'), 'd30', '#212121');
    const { con, st } = run(b, 1.0, undefined, (t) => (Math.abs(t - 0.6) < 1e-6 ? { [ID]: { serial: [...new TextEncoder().encode('mega\n')] } } : undefined));
    expect(con).toContain('MEGA READY');
    const last = st[st.length - 1].m!;
    const want: Record<number, number> = { 4: 32, 11: 64, 10: 96, 5: 128, 8: 160, 44: 192, 46: 224 };
    for (const [pin, v] of Object.entries(want)) expect(Math.abs(last.duty[Number(pin)] - v / 255), `D${pin}`).toBeLessThan(0.012);
    // ความถี่จากจำนวนขอบในช่วง 50 ms: Timer0 fast PWM 16 MHz/64/256 = 976.6 Hz · Timer1–5 phase-correct 16 MHz/64/510 = 490.2 Hz
    expect(last.edges![4] / 2 / 0.05).toBeCloseTo(977, -1);
    for (const pin of [11, 10, 5, 8, 44, 46]) expect(Math.abs(last.edges![pin] / 2 / 0.05 - 490), `D${pin}`).toBeLessThan(25);
    for (let p = 22; p <= 29; p++) expect(last.pins[p]).toBe(p & 1 ? 'out-high' : 'out-low');
    for (let p = 32; p <= 37; p++) expect(last.pins[p]).toBe(p & 1 ? 'out-low' : 'out-high');
    expect(last.pins[31]).toBe('out-high');
    expect(last.pins[30]).toBe('in-pullup');
    const m = [...con.matchAll(/A0=(\d+) A8=(\d+) A15=(\d+)/g)].pop()!;
    expect(Number(m[1])).toBe(1023);
    expect(Number(m[2])).toBe(0);
    expect(Math.abs(Number(m[3]) - (3.3 / 5) * 1023)).toBeLessThan(4);
    expect(con).toContain('mega<ok>');
  });

  it('attachInterrupt INT4 (D2), INT5 (D3), INT3 (D18), INT2 (D19) แบบ FALLING นับตรงจำนวนกด · pin change PCINT16 (A8) และ PCINT9 (D15) นับทุกขอบ', { timeout: 120000 }, () => {
    const b = megaRig(intHex);
    const pins = ['D2', 'D3', 'D18', 'D19', 'A8', 'D15'];
    pins.forEach((pin, k) => {
      const c = 11 + k * 3;
      b.part('pushbutton', onBoard(`f${c}`), `SW${k}`, {}).wire(H(`a${c}`), H(`tn${c}`), `g${k}`, '#212121').wire(P(ID, pin), H(`a${c + 2}`), `s${k}`, '#1e88e5');
    });
    // กด: D2 ×2, D3 ×1, D18 ×3, D19 ×1, A8 ×1 (2 ขอบ), D15 ×1 (2 ขอบ)
    const plan: Array<[number, number]> = [[0, 0.3], [0, 0.6], [1, 0.9], [2, 1.2], [2, 1.5], [2, 1.8], [3, 2.1], [4, 2.4], [5, 2.7]];
    const { con } = run(b, 3.2, (t) => {
      for (const [k, at] of plan) { if (Math.abs(t - at) < 1e-6) return press(b, `SW${k}`, true); if (Math.abs(t - at - 0.1) < 1e-6) return press(b, `SW${k}`, false); }
    });
    expect(con).toContain('ready');
    expect(con.trim().split('\n').pop()!.trim()).toBe('I 2 1 3 1 2 2');
    // ระหว่างทาง: หลังกด D2 ครั้งแรก (ก่อนครั้งที่สอง) นับ 1
    expect(con).toContain('I 1 0 0 0 0 0');
  });

  it('Serial1–3 ส่งออกขา TX ของตัวเอง (D18/D16/D14) ตามบอดเรต — เครื่องวิเคราะห์ลอจิกถอดได้ · ไม่ปนใน Serial Monitor · ขา TX ว่างที่ HIGH', { timeout: 120000 }, () => {
    const b = megaRig(uartHex).part('logicanalyzer', onTable(-40, 45), 'LA1', {})
      .wire(P('LA1', 'CH0'), P(ID, 'D18'), 'l0', '#fdd835').wire(P('LA1', 'CH1'), P(ID, 'D16'), 'l1', '#1e88e5').wire(P('LA1', 'CH2'), P(ID, 'D14'), 'l2', '#8e24aa')
      .wire(P('LA1', 'GND'), P(ID, 'GND.3'), 'lg', '#212121');
    const la = b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart;
    la.params.decoders[0] = 'uart'; la.params.decoders[1] = 'uart'; la.params.decoders[2] = 'uart';
    const { con, st, buf } = run(b, 0.6);
    expect(con).toContain('uart ready');
    expect(con).not.toMatch(/S[123]/);
    const last = st[st.length - 1].m!;
    for (const p of [18, 16, 14, 1]) expect(last.pins[p]).toBe('out-high');
    expect([0, 1, 2].map((k) => buf.ch[k].src)).toEqual(['uart', 'uart', 'uart']);
    expect(guessBaud(buf.ch[0])).toBe(9600);
    expect(guessBaud(buf.ch[1])).toBe(19200);
    expect(guessBaud(buf.ch[2])).toBe(57600);
    expect(uartText(decodeUart(buf.ch[0], 9600))).toMatch(/S1S1S1/);
    expect(uartText(decodeUart(buf.ch[1], 19200))).toMatch(/S2S2S2/);
    expect(uartText(decodeUart(buf.ch[2], 57600))).toMatch(/S3S3S3/);
  });

  it('I²C (Wire) ที่ขา SDA/SCL (= D20/D21) อ่าน INA219: สแกนพบ 0x40 · 5 V / 220 Ω ≈ 22.7 mA · ต่อสายผิดที่ A4/A5 แบบ Uno → ไม่พบอุปกรณ์', { timeout: 120000 }, () => {
    const rig = (sda: string, scl: string) => new Builder().part('mega', onTable(-90, -10), ID, { code: 'x', hex: inaHex, hexSrc: 'x' })
      .wire(P(ID, '5V'), H('tp3'), 'p5', '#e53935').wire(P(ID, 'GND.1'), H('bn3'), 'pg', '#212121')
      .part('ina219', onBoard('j22'), 'INA1', {})
      .wire(H('tp22'), H('f22'), 'iv', '#e53935').wire(H('bn23'), H('f23'), 'ig', '#212121').wire(P(ID, scl), H('f24'), 'scl', '#fdd835').wire(P(ID, sda), H('f25'), 'sda', '#1e88e5')
      .wire(H('tp27'), H('f27'), 'vin', '#e53935').part('resistor', onBoard('g26'), 'R1', { resistance: 220, span: 4 }).wire(H('h30'), H('bn30'), 'rg', '#212121');
    const ok = run(rig('SDA', 'SCL'), 1.0).con;
    expect(ok).toContain('I2C: 0x40\r\n');
    expect(ok).toMatch(/I=22\.[67] mA/);
    expect(run(rig('D20', 'D21'), 0.6).con).toContain('I2C: 0x40\r\n');
    expect(run(rig('A4', 'A5'), 0.6).con).toContain('I2C:\r\n');
  });

  it('EEPROM 4 KB: นับการบูตที่ที่อยู่ 4000 (เกิน 1 KB ของ Uno) 1 → 2 → 3 ด้วย RESET · EEPROM.length() = 4096 · ส่งเนื้อหา 4 KB กลับไปบันทึกในไฟล์งาน', { timeout: 60000 }, () => {
    eepromOf(ID, 4096).memory.fill(0xff);
    const b = megaRig(eepromHex);
    const r1 = run(b, 1.0, undefined, (t) => (Math.abs(t - 0.4) < 1e-6 || Math.abs(t - 0.7) < 1e-6 ? { [ID]: { reset: true } } : undefined));
    expect(r1.con.match(/len \d+ boot \d+/g)).toEqual(['len 4096 boot 1', 'len 4096 boot 2', 'len 4096 boot 3']);
    expect(eepromOf(ID, 4096).memory[4000]).toBe(3);
    const sent = r1.st.map((s) => s.m!.eeprom).filter(Boolean) as string[];
    expect(b64ToBytes(sent[sent.length - 1]).length).toBe(4096);
    // เปิดไฟล์ที่มี EEPROM 4 KB (ไบต์ 4000 = 9) → ผ่านการตรวจไฟล์ → boot 10
    const mem = new Uint8Array(4096).fill(0xff); mem[4000] = 9;
    const c = megaRig(eepromHex);
    const x = setPartParams(c.doc, ID, { eeprom: bytesToB64(mem) } as never); if (x.ok) c.doc = x.doc;
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(c.doc)), errs, []), errs.join()).not.toBeNull();
    expect(run(c, 0.3).con).toContain('boot 10');
    eepromOf(ID, 4096).memory.fill(0xff);
  });

  it('SPI.transfer() ไม่ค้าง · ไบต์ที่อ่าน = ระดับ MISO (D50): ลอย → 0x0 · ต่อ 5V → 0xFF', { timeout: 60000 }, () => {
    expect(run(megaRig(spiHex), 0.5).con).toMatch(/rx=0x0\r?\n/);
    expect(run(megaRig(spiHex).wire(P(ID, 'D50'), P(ID, '5V.2'), 'mi', '#e53935'), 0.5).con).toContain('rx=0xFF');
  });

  it('watchdog 250 ms: หยุดเลี้ยงหลัง 1 s → บอร์ดรีเซ็ตเองที่ ≈ 1.25 s · Servo (ใช้ Timer5 บน Mega) write(45) ≈ 1.0 ms / write(135) ≈ 1.94 ms · tone(8, 440) = 440 Hz', { timeout: 120000 }, () => {
    const wd = run(megaRig(watchdogHex), 2.0).st;
    const starts = wd.filter((s, i) => (s.con.match(/start/g)?.length ?? 0) > (i ? wd[i - 1].con.match(/start/g)?.length ?? 0 : 0)).map((s) => s.t);
    expect(starts[0]).toBeLessThan(0.1);
    expect(starts[1]).toBeGreaterThan(1.2);
    expect(starts[1]).toBeLessThan(1.4);
    const b = megaRig(servotoneHex);
    b.part('servo', onTable(-60, 30), 'SV1', {}).part('buzzer', onBoard('a25'), 'BZ1', buzzerParamsFor('passive'));
    b.wire(P('SV1', 'GND'), H('tn12'), 'sg', '#212121').wire(P('SV1', 'V'), P(ID, '5V'), 'sv', '#e53935').wire(P('SV1', 'SIG'), P(ID, 'D9'), 'ss', '#fb8c00')
      .wire(P(ID, 'D8'), H('b25'), 'bz', '#43a047').wire(H('e28'), H('tn28'), 'bg', '#212121');
    const { st } = run(b, 2.5);
    const sv = (i: number) => st[i].r.tones!.SV1 as unknown as { pw: number; freq: number };
    expect(sv(20).pw * 1000).toBeCloseTo(1.008, 1);
    expect(sv(20).freq).toBeCloseTo(50, 0);
    expect(sv(48).pw * 1000).toBeCloseTo(1.936, 1);
    expect(st[20].r.tones!.BZ1.freq).toBeCloseTo(440, 0);
  });

  it('คำเตือนขาเกินพิกัดใช้ชื่อขา Mega: LED ไม่มีตัวต้านทานที่ D40 → อันตราย "ขา D40" · ตัวต้านทาน 220 Ω → ไม่เตือน', { timeout: 60000 }, () => {
    // ใช้ mega-io: D40 ไม่ได้ตั้งในโค้ด → ใช้ blink ที่ D13 แต่ต่อ LED ตรง (r = 1 Ω)
    const bad = run(megaRig(blinkHex, { r: 1 }), 0.4).st[7].an.diagnostics.filter((d) => d.partId === ID);
    expect(bad.some((d) => d.severity === 'danger' && d.message.includes('ขา D13') && d.message.includes('40 mA'))).toBe(true);
    const good = run(megaRig(blinkHex), 0.4).st[7].an.diagnostics.filter((d) => d.partId === ID && d.severity !== 'info');
    expect(good).toEqual([]);
  });

  it('สองบอร์ด: D13 ของ Mega (Blink) → D2 ของ Uno (INT0 FALLING) · เปลี่ยนชนิดบอร์ดเดียวกันจาก Uno เป็น Mega สร้างชิปใหม่', { timeout: 60000 }, async () => {
    const interruptHex = (await import('./fixtures/uno/interrupt.hex?raw')).default;
    const b = megaRig(blinkHex).part('uno', onTable(-70, 40), 'UNO1', { code: 'x', hex: interruptHex, hexSrc: 'x' })
      .wire(P(ID, 'D13'), P('UNO1', 'D2'), 'x1', '#1e88e5').wire(P(ID, 'GND.2'), P('UNO1', 'GND.1'), 'x2', '#212121');
    const e = new SimEngine(), built = buildNetlist(b.doc);
    let con = '';
    for (let k = 0; k < 52; k++) con += e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 }).mcu?.find((m) => m.id === 'UNO1')?.console ?? '';
    expect(con.trim().split('\n').pop()!.trim()).toMatch(/^INT0=3 /);
    // บอร์ด id เดียวกัน: Uno (20 ขา) → Mega (70 ขา) ในตัวจำลองเดิม
    const e2 = new SimEngine();
    const u = new Builder().part('uno', onTable(-90, -10), ID, { code: UNO_DEFAULT_CODE, hex: null, hexSrc: '' });
    expect(e2.handle({ seq: 1, netlist: buildNetlist(u.doc).netlist, advance: 0.05, restart: true, watch: [], budgetMs: 1e9 }).mcu![0].pins).toHaveLength(20);
    expect(e2.handle({ seq: 2, netlist: buildNetlist(megaRig(blinkHex).doc).netlist, advance: 0.05, restart: false, watch: [], budgetMs: 1e9 }).mcu![0].pins).toHaveLength(70);
  });
});
