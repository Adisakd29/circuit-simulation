import { describe, expect, it } from 'vitest';
import pwmHex from './fixtures/uno/pwm.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { PowerAcc, PowerLog, chunkOf, powerReport } from '../src/instruments/power';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { unoRig } from './uno-rig';

/**
 * เครื่องวัดกำลังไฟฟ้า: ตัวเลขมาจากผลคำนวณวงจร — ตรวจกับสูตร P = VI, การอนุรักษ์พลังงาน (จ่าย = ใช้) และพลังงานที่สะสมตามเวลา
 */
type B = Builder;
function run(b: B, sec: number, dt = 0.05) {
  const e = new SimEngine(), built = buildNetlist(b.doc), log = new PowerLog();
  let r!: ReturnType<SimEngine['handle']>;
  const reps: ReturnType<typeof powerReport>[] = [];
  for (let k = 0; k < Math.max(1, Math.round(sec / dt)); k++) {
    r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    const rep = powerReport(b.doc, built.netlist.elements, r.power ?? chunkOf(r.result));
    reps.push(rep);
    log.push(rep, r.t);
  }
  return { r, rep: reps[reps.length - 1], reps, log };
}

describe('เครื่องวัดกำลังไฟฟ้า', () => {
  it('DC: แหล่งจ่าย 5 V → R 1 kΩ: จ่าย 25 mW = R ใช้ 25 mW (P = V²/R)', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 4), 'PS1', { voltage: 5 })
      .part('resistor', onBoard('j10'), 'R1', { resistance: 1000, span: 4 })
      .wire(P('PS1', 'pos'), H('h10')).wire(P('PS1', 'neg'), H('h14'));
    const { rep, r } = run(b, 0.05);
    expect(r.mode).toBe('dc');
    expect(rep.sources).toHaveLength(1);
    expect(rep.sources[0].label).toContain('PS1');
    expect(rep.sources[0].p).toBeCloseTo(0.025, 5);
    expect(rep.sources[0].i).toBeCloseTo(0.005, 6);
    expect(rep.loads.map((l) => l.partId)).toEqual(['R1']);
    expect(rep.loads[0].p).toBeCloseTo(0.025, 5);
    expect(Math.abs(rep.pIn - rep.pOut)).toBeLessThan(1e-9);
  });

  it('Uno: analogWrite(9, 64) → LED + 220 Ω · กำลังเฉลี่ยตามเวลา ≈ 25% ของตอนติดเต็ม (D13) · จ่าย = ใช้ ±1%', { timeout: 60000 }, () => {
    const pwm = run(unoRig({ hex: pwmHex, code: 'x', pin: 'D9' }), 0.4);
    const full = run(unoRig({ hex: pwmHex, code: 'x', pin: 'D13' }), 0.2);
    const sPwm = pwm.rep.sources.find((s) => s.key === 'UNO1#GP9')!, sFull = full.rep.sources.find((s) => s.key === 'UNO1#GP13')!;
    expect(sPwm.label).toBe('UNO1 ขา D9');
    expect(sFull.p).toBeGreaterThan(0.03); // ≈ 5 V × 13 mA
    // duty 64/255 ≈ 25.1% — ค่าขณะหนึ่ง (ผลคำนวณสุดท้าย) เป็นได้แค่ 0 หรือเต็ม แต่ค่าเฉลี่ยตามเวลาอยู่ราว 25%
    expect(sPwm.p / sFull.p).toBeGreaterThan(0.23);
    expect(sPwm.p / sFull.p).toBeLessThan(0.27);
    for (const x of [pwm.rep, full.rep]) {
      expect(x.loads.map((l) => l.partId).sort()).toEqual(['LED1', 'R1']);
      expect(Math.abs(x.pIn - x.pOut) / x.pIn).toBeLessThan(0.01);
    }
    // LED ใช้กำลังมากกว่าตัวต้านทาน (Vf ≈ 2 V × I เทียบ I²·220)
    const led = full.rep.loads.find((l) => l.partId === 'LED1')!, res = full.rep.loads.find((l) => l.partId === 'R1')!;
    expect(led.p).toBeGreaterThan(0.02);
    expect(res.p).toBeGreaterThan(0.03);
  });

  it('ขา LOW รับกระแส: LED จาก 5V ลงขา D13 ที่เป็น LOW → แหล่งคือขา 5V · ขา D13 แสดงเป็นผู้รับกำลัง', { timeout: 60000 }, () => {
    // D13 HIGH ใน pwm.hex จึงใช้ D9 ที่ duty 25%: ช่วง LOW ขา D9 รับกระแสจาก 5V ผ่าน LED
    const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: 'x', hex: pwmHex, hexSrc: 'x' })
      .part('resistor', onBoard('a5'), 'R1', { resistance: 220, span: 3 }).part('led', onBoard('c8'), 'LED1')
      .wire(P('UNO1', '5V'), H('b5'), 'w1', '#e53935').wire(H('e9'), P('UNO1', 'D9'), 'w2', '#43a047').wire(P('UNO1', 'GND.1'), H('tn3'), 'w3', '#212121');
    const { rep } = run(b, 0.3);
    const src = rep.sources.find((s) => s.key === 'UNO1#5V')!;
    expect(src).toBeTruthy();
    expect(src.ilim).toBe(0.5);
    const sink = rep.loads.find((l) => l.key === 'UNO1#GP9');
    expect(sink?.label).toContain('รับกระแสเข้า');
    // LED ติดช่วง D9 LOW ≈ 75% ของเวลา
    expect(Math.abs(rep.pIn - rep.pOut) / rep.pIn).toBeLessThan(0.01);
  });

  it('RC ตามเวลา: 5 V → 1 kΩ → 100 µF · พลังงานที่แหล่งจ่ายออกใน 0.3 s = CV²(1 − e^(−t/RC)) ±2%', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 4), 'PS1', { voltage: 5 })
      .part('resistor', onBoard('j10'), 'R1', { resistance: 1000, span: 4 })
      .part('capacitor', onBoard('i14'), 'C1', { capacitance: 100e-6, polarized: false, span: 3 })
      .wire(P('PS1', 'pos'), H('h10')).wire(P('PS1', 'neg'), H('h17'));
    const { log, r } = run(b, 0.3, 0.05);
    expect(r.mode).toBe('tran');
    const tau = 1000 * 100e-6, t = log.T;
    expect(t).toBeCloseTo(0.3, 3);
    const eTheory = 100e-6 * 25 * (1 - Math.exp(-t / tau));
    expect(Math.abs(log.eIn / eTheory - 1)).toBeLessThan(0.02);
    // ตัวต้านทานได้ ½CV²(1 − e^(−2t/τ))
    const eR = log.rows.get('R1')!, eRT = 0.5 * 100e-6 * 25 * (1 - Math.exp(-2 * t / tau));
    expect(Math.abs(eR / eRT - 1)).toBeLessThan(0.03);
    expect(log.hist.length).toBe(6);
  });

  it('PowerAcc: เฉลี่ยตามเวลาแบบขั้นบันได (ค่าคงที่จนถึงก้าวถัดไป) · ย้อนเวลา = เริ่มใหม่', () => {
    const acc = new PowerAcc();
    const res = (p: number) => ({ ok: true, elements: { X: { id: 'X', current: p / 2, voltage: 2, power: p } } }) as never;
    acc.feed(0, res(1)); acc.feed(0.75, res(0)); acc.feed(1, res(0));
    const c = acc.take()!;
    expect(c.dt).toBeCloseTo(1);
    expect(c.p.X).toBeCloseTo(0.75);
    expect(c.i.X).toBeCloseTo(0.375);
    acc.feed(0.5, res(3));
    expect(acc.take()!.p.X).toBe(3); // ไม่มีช่วงเวลา → ค่าล่าสุด
  });
});
