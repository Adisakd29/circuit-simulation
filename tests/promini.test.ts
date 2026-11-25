import { describe, expect, it } from 'vitest';
import blink5Hex from './fixtures/uno/promini-blink.hex?raw';
import blink3Hex from './fixtures/uno/promini3-blink.hex?raw';
import io5Hex from './fixtures/uno/promini-io.hex?raw';
import io3Hex from './fixtures/uno/promini3-io.hex?raw';
import ina3Hex from './fixtures/uno/promini3-ina219.hex?raw';
import wdt3Hex from './fixtures/uno/promini3-watchdog.hex?raw';
import int3Hex from './fixtures/uno/promini3-interrupt.hex?raw';
import ee3Hex from './fixtures/uno/promini3-eeprom.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { addPart, addWire, setPartParams } from '../src/editor/ops';
import { PROMINI_ROW_A, PROMINI_ROW_B, catalogEntry, internalLinks, pinDefs } from '../src/model/catalog';
import { checkPlacement, coveredHoles, footprint, pinHolesFor } from '../src/model/geometry';
import { computeConnectivity, netOfPin } from '../src/connectivity/connectivity';
import { eepromOf, avrClockOf } from '../src/mcu/avr-emu';
import { mcuRails } from '../src/mcu/rails';
import { LogicBuffer, decodeUart, guessBaud, uartText } from '../src/instruments/logic';
import { validateCircuit } from '../src/model/schema';
import { chunkOf, powerReport } from '../src/instruments/power';
import type { LogicAnalyzerPart } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * Arduino Pro Mini 328 — ทุกข้อรันไฟล์ .hex ที่คอมไพล์จริงด้วยบริการคอมไพล์ (บอร์ด promini = 5 V/16 MHz, promini3 = 3.3 V/8 MHz F_CPU 8000000L:
 * tests/fixtures/uno/gen.ts → promini*-*.hex) บน avr8js ที่ตั้งสัญญาณนาฬิกาตามรุ่นบอร์ด ร่วมกับวงจร
 * บอร์ดเสียบ anchor h3: แถว A (TXO RXI RST GND D2…D9) = h3–h14 · แถว B (RAW GND RST VCC A3 A2 A1 A0 D13 D12 D11 D10) = d3–d14
 * รูว่างกลุ่มเดียวกัน: แถว A → i/j, แถว B → a/b/c
 */
const ID = 'PM1';
function ph(pin: string, row?: string): string {
  const a = PROMINI_ROW_A.findIndex(([n]) => n === pin), b = PROMINI_ROW_B.findIndex(([n]) => n === pin);
  if (a >= 0) return `${row ?? 'j'}${3 + a}`;
  if (b >= 0) return `${row ?? 'a'}${3 + b}`;
  throw new Error(pin);
}
/** Pro Mini + ไฟ VCC → ราง tp, GND → ราง tn */
function base(hex: string | null, volt: 5 | 3.3) {
  return new Builder().part('promini', onBoard('h3'), ID, { code: 'x', hex, hexSrc: 'x', volt })
    .wire(H(ph('VCC')), H('tp6'), 'pv', '#e53935').wire(H(ph('GND.2')), H('tn4'), 'pg', '#212121');
}
/** + LED1 ผ่าน R 220 Ω ที่ D13: a11 → a18, R b18–b21, LED c21/c22, K → tn22 */
function ledRig(hex: string | null, volt: 5 | 3.3) {
  return base(hex, volt).wire(H(ph('D13', 'c')), H('a18'), 'l1', '#43a047')
    .part('resistor', onBoard('b18'), 'R1', { resistance: 220, span: 3 }).part('led', onBoard('c21'), 'LED1').wire(H('e22'), H('tn22'), 'l2', '#212121');
}
type Mcu = Record<string, { reset?: boolean; serial?: number[] }>;
function run(b: Builder, sec: number, cmd?: (t: number) => boolean | void, mcu?: (t: number) => Mcu | undefined) {
  const e = new SimEngine();
  let built = buildNetlist(b.doc);
  let con = '';
  const buf = new LogicBuffer();
  const st: Array<{ t: number; con: string; an: ReturnType<typeof analyze>; r: ReturnType<SimEngine['handle']>; m: NonNullable<ReturnType<SimEngine['handle']>['mcu']>[number] | undefined }> = [];
  for (let k = 0; k < Math.round(sec / 0.05); k++) {
    const t = +((k + 1) * 0.05).toFixed(3);
    if (cmd?.(t)) built = buildNetlist(b.doc);
    const mc = mcu?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9, ...(mc ? { mcu: mc } : {}) });
    const m = r.mcu?.find((x) => x.id === ID);
    con += m?.console ?? '';
    if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
    st.push({ t, con, an: analyze(b.doc, built, r.result, r.tones), r, m });
  }
  return { con, st, buf, built };
}
const ledI = (s: { an: ReturnType<typeof analyze> }) => s.an.parts.LED1?.current ?? 0;

describe('Arduino Pro Mini: ขา หัวต่อ และการวางบนเบรดบอร์ด', () => {
  it('28 ขา: 2 แถว × 12 ขาคร่อมร่องกลาง (ระยะ 0.6") + รูบนบอร์ด A4–A7 ที่ไม่เสียบรู · บอร์ดปิดทับแถว e f g 12 คอลัมน์ · GND/RST ต่อกันบนบอร์ด', () => {
    const b = new Builder().part('promini', onBoard('h3'), ID, {});
    const p = b.doc.parts[0];
    expect(catalogEntry('promini')!.supported).toBe(true);
    expect(p.kind === 'promini' && p.params.volt).toBe(5);
    expect(pinDefs(p)).toHaveLength(28);
    const holes = Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]));
    expect(Object.keys(holes)).toHaveLength(24);
    expect(holes).toMatchObject({ D1: 'h3', D0: 'h4', 'RST.1': 'h5', 'GND.1': 'h6', D2: 'h7', D9: 'h14', RAW: 'd3', 'GND.2': 'd4', VCC: 'd6', A3: 'd7', A0: 'd10', D13: 'd11', D10: 'd14' });
    // A4–A7: ตำแหน่งตาม footprint (เศษส่วนของระยะรู) และไม่อยู่ในตารางรู
    const top = pinDefs(p).filter((d) => d.top).map((d) => d.name);
    expect(top).toEqual(['A5', 'A4', 'A7', 'A6']);
    for (const n of top) expect(holes[n]).toBeUndefined();
    expect(new Set(coveredHoles(p).map((h) => h[0]))).toEqual(new Set(['e', 'f', 'g']));
    expect(coveredHoles(p)).toHaveLength(12 * 3);
    expect(checkPlacement(b.doc, p).ok).toBe(true);
    expect(internalLinks(p)).toEqual([['GND.1', 'GND.2'], ['RST.1', 'RST.2']]);
    const c = computeConnectivity(b.doc);
    expect(new Set(pinDefs(p).map((d) => netOfPin(c, ID, d.name))).size).toBe(28 - 2);
    // วางผิดแถว → ขาอีกแถวตกร่องกลาง
    expect(addPart(new Builder().doc, 'promini', onBoard('c3'), 'X').ok).toBe(false);
    // ต่อสายเข้ารูบนบอร์ด (A4) ได้ด้วยสายที่ขาเท่านั้น
    const w = addWire(b.doc, P(ID, 'A4'), H('tp20'), '#1e88e5', 'a4');
    expect(w.ok).toBe(true);
    if (w.ok) { const c2 = computeConnectivity(w.doc); expect(c2.nets[netOfPin(c2, ID, 'A4')!].terminals).toContain('bb1/tp20'); expect(netOfPin(c2, ID, 'A5')).not.toBe(netOfPin(c2, ID, 'A4')); }
    // บนโต๊ะ: พื้นที่รวมตัวแปลง USB-serial ที่ยื่นออกจากหัว 6 ขา
    const t = new Builder().part('promini', onTable(-90, -10), 'PT', {});
    const f = footprint(t.doc.parts[0])!;
    expect(f.x0).toBeLessThan(-90 - 10);
    expect(f.x1).toBeGreaterThan(-90 + 11);
  });

  it('สัญญาณนาฬิกาและไฟตามรุ่น: 5 V = 16 MHz, VCC 5 V ≤ 500 mA · 3.3 V = 8 MHz, VCC 3.3 V (ค่าประมาณ 150 mA) · ตรวจไฟล์: volt ต้องเป็น 5 หรือ 3.3', () => {
    expect(avrClockOf('promini')).toEqual({ hz: 16e6, vcc: 5 });
    expect(avrClockOf('promini3')).toEqual({ hz: 8e6, vcc: 3.3 });
    expect(mcuRails('uno', 'promini')).toEqual([['VCC', 5, 0.1, 0.5]]);
    expect(mcuRails('uno', 'promini3')).toEqual([['VCC', 3.3, 0.2, 0.15]]);
    const b = base(null, 3.3);
    expect(buildNetlist(b.doc).netlist.mcus![0]).toMatchObject({ board: 'promini3', v33: -1, vsys: -1, vref: -1 });
    const doc = JSON.parse(JSON.stringify(b.doc));
    const errs: string[] = [];
    expect(validateCircuit(doc, errs, []), errs.join()).not.toBeNull();
    doc.parts[0].params.volt = 12;
    const e2: string[] = [];
    validateCircuit(doc, e2, []);
    expect(e2.join()).toContain('volt');
  });
});

describe('Arduino Pro Mini: โปรแกรมจริงบน 16 MHz และ 8 MHz', () => {
  it('Blink: รุ่น 5 V (คอมไพล์ 16 MHz) และรุ่น 3.3 V (คอมไพล์ 8 MHz) สลับทุก 500 ms เท่ากัน · LED 220 Ω: 5 V ≈ 12 mA, 3.3 V ≈ 5 mA · Serial "LED ON/OFF"', { timeout: 120000 }, () => {
    for (const [hex, volt, lo, hi] of [[blink5Hex, 5, 0.011, 0.0135], [blink3Hex, 3.3, 0.0035, 0.0065]] as const) {
      const { st, con } = run(ledRig(hex, volt), 2.0);
      const on = (t: number) => ledI(st[Math.round(t / 0.05) - 1]) > 1e-4;
      expect([0.1, 0.3, 0.45].every(on), `${volt} V on`).toBe(true);
      expect([0.6, 0.8, 0.95].some(on), `${volt} V off`).toBe(false);
      expect([1.1, 1.3].every(on), `${volt} V on2`).toBe(true);
      const i = ledI(st[5]);
      expect(i, `${volt} V I`).toBeGreaterThan(lo);
      expect(i, `${volt} V I`).toBeLessThan(hi);
      expect(con.match(/LED ON/g)!.length).toBe(2);
      expect(con.match(/LED OFF/g)!.length).toBe(2);
    }
  });

  it('เลือก Processor ผิด: โปรแกรมที่คอมไพล์เป็น 16 MHz บนบอร์ด 3.3 V/8 MHz ช้าลงครึ่งหนึ่ง (LED ค้าง ≈ 1 s) — เหมือนบอร์ดจริง', { timeout: 60000 }, () => {
    const { st } = run(ledRig(blink5Hex, 3.3), 2.2);
    const on = (t: number) => ledI(st[Math.round(t / 0.05) - 1]) > 1e-4;
    expect([0.3, 0.6, 0.9].every(on)).toBe(true);
    expect([1.1, 1.4, 1.8].some(on)).toBe(false);
  });

  it('millis/ADC/PWM: 3.3 V — A0 (แบ่งครึ่ง VCC) ≈ 512, A7 (รูบนบอร์ด ต่อ VCC) = 1023, D9 (Timer1) ≈ 245 Hz, D5 (Timer0) ≈ 488 Hz · 5 V — 490/977 Hz · millis ตรงเวลาจำลอง', { timeout: 180000 }, () => {
    for (const [hex, volt, f9, f5] of [[io3Hex, 3.3, 245, 488], [io5Hex, 5, 490, 977]] as const) {
      const b = base(hex, volt).wire(H(ph('A0', 'c')), H('c20'), 'a0', '#fdd835')
        .part('resistor', onBoard('a20'), 'R1', { resistance: 10000, span: 4 }).wire(H('e24'), H('tp24'), 'r1', '#e53935')
        .part('resistor', onBoard('b16'), 'R2', { resistance: 10000, span: 4 }).wire(H('e16'), H('tn16'), 'r2', '#212121')
        .wire(P(ID, 'A7'), H('tp28'), 'a7', '#e53935')
        .part('resistor', onBoard('i20'), 'R3', { resistance: 1000, span: 3 }).wire(H(ph('D9', 'i')), H('j20'), 'd9', '#1e88e5').wire(H('j23'), H('bn23'), 'r3', '#212121')
        .part('resistor', onBoard('i26'), 'R4', { resistance: 1000, span: 3 }).wire(H(ph('D5', 'i')), H('j26'), 'd5', '#8e24aa').wire(H('j29'), H('bn29'), 'r4', '#212121')
        .wire(H('tn2'), H('bn2'), 'gg', '#212121');
      const { con, st } = run(b, 1.3);
      const lines = con.split('\n').filter((l) => l.startsWith('t='));
      expect(lines.length, `${volt}`).toBeGreaterThanOrEqual(4);
      const last = lines[lines.length - 1];
      const m = /t=(\d+) A0=(\d+) A7=(\d+)/.exec(last)!;
      expect(Number(m[1]), `${volt} millis`).toBeGreaterThanOrEqual(1000);
      expect(Number(m[1]), `${volt} millis`).toBeLessThanOrEqual(1300);
      expect(Math.abs(Number(m[2]) - 512), `${volt} A0 ${m[2]}`).toBeLessThan(8);
      expect(Number(m[3]), `${volt} A7`).toBeGreaterThanOrEqual(1020);
      const s = st[st.length - 1].m!;
      expect(Math.abs(s.edges![9] / 2 / 0.05 - f9), `${volt} D9 ${s.edges![9]}`).toBeLessThan(f9 * 0.06);
      expect(Math.abs(s.edges![5] / 2 / 0.05 - f5), `${volt} D5 ${s.edges![5]}`).toBeLessThan(f5 * 0.06);
      expect(Math.abs(s.duty[9] - 64 / 255)).toBeLessThan(0.02);
      expect(Math.abs(s.duty[5] - 192 / 255)).toBeLessThan(0.02);
    }
  });

  it('Serial ที่ 8 MHz: เครื่องวิเคราะห์ลอจิกที่ขา TXO ถอดรหัส 9600 baud ได้ข้อความเดียวกับ Serial Monitor', { timeout: 120000 }, () => {
    const b = base(io3Hex, 3.3).part('logicanalyzer', onTable(-40, 45), 'LA1', {})
      .wire(P('LA1', 'CH0'), H(ph('D1')), 'l0', '#fdd835').wire(P('LA1', 'GND'), H(ph('GND.1')), 'lg', '#212121');
    const la = b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart;
    la.params.decoders[0] = 'uart';
    const { con, buf } = run(b, 0.8);
    expect(con).toMatch(/t=25\d A0=\d+/);
    expect(buf.ch[0].src).toBe('uart');
    expect(guessBaud(buf.ch[0])).toBe(9600);
    expect(uartText(decodeUart(buf.ch[0], 9600))).toMatch(/t=25\d A0=\d+ A7=\d+/);
  });

  it('I²C ที่รูบนบอร์ด A4 (SDA)/A5 (SCL) รุ่น 3.3 V: สแกนพบ INA219 0x40 · 3.3 V / 220 Ω ≈ 15 mA · ไม่ต่อ A4/A5 → ไม่พบอุปกรณ์', { timeout: 120000 }, () => {
    const rig = (wired: boolean) => {
      const b = base(ina3Hex, 3.3).wire(H('tn2'), H('bn2'), 'gg', '#212121')
        .part('ina219', onBoard('j22'), 'INA1', {})
        .wire(H('tp22'), H('f22'), 'iv', '#e53935').wire(H('bn23'), H('f23'), 'ig', '#212121')
        .wire(H('tp27'), H('f27'), 'vin', '#e53935').part('resistor', onBoard('g26'), 'R1', { resistance: 220, span: 4 }).wire(H('h30'), H('bn30'), 'rg', '#212121');
      return wired ? b.wire(P(ID, 'A5'), H('f24'), 'scl', '#fdd835').wire(P(ID, 'A4'), H('f25'), 'sda', '#1e88e5') : b;
    };
    const ok = run(rig(true), 1.0).con;
    expect(ok).toContain('I2C: 0x40\r\n');
    expect(ok).toMatch(/V=3[23]\d\d mV I=1[45]\.\d mA/);
    expect(run(rig(false), 0.6).con).toContain('I2C:\r\n');
  });

  it('รุ่น 3.3 V: watchdog 250 ms รีเซ็ตที่ ≈ 1.25 s (ฐานเวลา 128 kHz ไม่ขึ้นกับ 8 MHz) · INT0 นับการกด 2 ครั้ง · EEPROM นับการบูตข้าม RESET', { timeout: 120000 }, () => {
    const wd = run(base(wdt3Hex, 3.3), 2.0).st;
    const starts = wd.filter((s, i) => (s.con.match(/start/g)?.length ?? 0) > (i ? wd[i - 1].con.match(/start/g)?.length ?? 0 : 0)).map((s) => s.t);
    expect(starts[0]).toBeLessThan(0.1);
    expect(starts[1]).toBeGreaterThan(1.2);
    expect(starts[1]).toBeLessThan(1.4);
    const b = base(int3Hex, 3.3).part('pushbutton', onBoard('f25'), 'SW1', {}).wire(H('a25'), H('tn24'), 'sg', '#212121').wire(H(ph('D2')), H('a27'), 's1', '#1e88e5');
    const press = (v: boolean) => { const x = setPartParams(b.doc, 'SW1', { pressed: v } as never); if (x.ok) b.doc = x.doc; return true; };
    const { con } = run(b, 1.4, (t) => {
      for (const [a, z] of [[0.4, 0.6], [0.9, 1.1]]) { if (Math.abs(t - a) < 1e-6) return press(true); if (Math.abs(t - z) < 1e-6) return press(false); }
    });
    expect(con.trim().split('\n').pop()!.trim()).toMatch(/^INT0=2 /);
    eepromOf(ID).memory.fill(0xff);
    const e = run(base(ee3Hex, 3.3), 0.8, undefined, (t) => (Math.abs(t - 0.4) < 1e-6 ? { [ID]: { reset: true } } : undefined));
    expect(e.con.match(/boot \d+/g)).toEqual(['boot 1', 'boot 2']);
    eepromOf(ID).memory.fill(0xff);
  });
});

describe('Arduino Pro Mini: ไฟฟ้าและคำเตือน', () => {
  it('รุ่น 3.3 V: ต่อ 5 V จากแหล่งจ่ายเข้า D2 → อันตราย "เกิน VCC + 0.5 V" · รุ่น 5 V ต่อแบบเดียวกัน → ไม่เตือน', { timeout: 60000 }, () => {
    const rig = (volt: 5 | 3.3) => base(blink5Hex, volt).part('dcsupply', onTable(60, 40), 'PS1', { voltage: 5, currentLimit: 0.1, outputOn: true })
      .wire(P('PS1', 'pos'), H(ph('D2')), 'p+', '#e53935').wire(P('PS1', 'neg'), H('tn10'), 'p-', '#212121');
    const d3 = run(rig(3.3), 0.2).st[3].an.diagnostics.filter((d) => d.partId === ID && d.severity === 'danger');
    expect(d3.some((d) => d.message.includes('ขา D2') && d.message.includes('VCC + 0.5 V'))).toBe(true);
    const d5 = run(rig(5), 0.2).st[3].an.diagnostics.filter((d) => d.partId === ID && d.severity === 'danger');
    expect(d5).toEqual([]);
  });

  it('ไฟ VCC จากตัวแปลง USB-serial: LED 220 Ω ต่อจาก VCC → ตารางกำลังไฟฟ้ามีแหล่ง "ขา VCC" · ลัด VCC ลง GND → เตือนเกินกระแสตัวแปลง', { timeout: 60000 }, () => {
    for (const volt of [5, 3.3] as const) {
      const b = base(null, volt).part('resistor', onBoard('b18'), 'R1', { resistance: 220, span: 3 }).part('led', onBoard('c21'), 'LED1')
        .wire(H('a18'), H('tp18'), 'v', '#e53935').wire(H('e22'), H('tn22'), 'g', '#212121');
      const { st, built } = run(b, 0.1);
      const s = st[st.length - 1];
      const rep = powerReport(b.doc, built.netlist.elements, s.r.power ?? chunkOf(s.r.result));
      const src = rep.sources.find((x) => x.label.includes('ขา VCC'));
      expect(src, `${volt}`).toBeDefined();
      expect(src!.v).toBeCloseTo(volt, 0);
      const sh = base(null, volt).part('resistor', onBoard('b4'), 'RS', { resistance: 1, span: 2 });
      const dg = run(sh, 0.1).st[1].an.diagnostics.filter((d) => d.partId === ID && d.severity === 'danger');
      expect(dg.some((d) => d.message.includes('ขา VCC') && d.message.includes('ตัวแปลง USB-serial')), `${volt}`).toBe(true);
    }
  });
});
