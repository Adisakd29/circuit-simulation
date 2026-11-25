import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { motorRpm } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

export const HB_CODE = `from machine import Pin, PWM
import time
a1 = Pin(14, Pin.OUT)   # 1A
a2 = Pin(15, Pin.OUT)   # 2A
en = PWM(Pin(16))       # 1,2EN
en.freq(200)

def run(d1, d2, duty, t):
    a1.value(d1)
    a2.value(d2)
    en.duty_u16(duty)
    time.sleep(t)

while True:
    run(1, 0, 65535, 1.5)   # เดินหน้า
    run(0, 0, 65535, 0.5)   # เบรก
    run(0, 1, 65535, 1.5)   # ถอยหลัง
    run(0, 1, 30000, 1.5)   # ถอยหลังช้า
    run(0, 0, 0, 0.5)       # หยุด
`;

/**
 * Pico ที่ h1 (ขาล่างแถว h คอลัมน์ 1–20, ขาบนแถว c) · L293D ที่ f22: EN12 f22, 1A f23, 1Y f24, GND f25/f26, 2Y f27, 2A f28, VCC2 f29 / VCC1 e22
 * PS1 6 V → ราง bp/bn (ไฟมอเตอร์), VBUS (c1) → ราง tp (5 V ตรรกะ), GND Pico → bn, ราง tn ↔ bn
 * GP14 (h19) → 1A, GP15 (h20) → 2A, GP16 (c20) → EN12, มอเตอร์ A → 1Y, B → 2Y
 */
export function hbRig(o: { code?: string; vcc1?: 'VBUS' | '3V3' | 'none'; vm?: number; noVcc2?: boolean } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? HB_CODE, autorun: true })
    .part('dcsupply', onTable(-30, -22), 'PS1', { voltage: o.vm ?? 6, currentLimit: 3 })
    .part('hbridge', onBoard('f22'), 'U1')
    .part('motor', onTable(28, -26), 'M1')
    .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2')).wire(H('j18'), H('bn18')).wire(H('tn30'), H('bn30'))
    .wire(H('j26'), H('bn26')).wire(H('a22'), H('tp22'))
    .wire(H('j23'), H('j19')).wire(H('j28'), H('j20')).wire(H('j22'), H('a20'))
    .wire(P('M1', 'A'), H('i24')).wire(P('M1', 'B'), H('i27'));
  if (!o.noVcc2) b.wire(H('j29'), H('bp29'));
  const v1 = o.vcc1 ?? 'VBUS';
  if (v1 === 'VBUS') b.wire(H('a1'), H('tp2'));
  if (v1 === '3V3') b.wire(H('a5'), H('tp2'));
  return b;
}

export function runHb(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const built = buildNetlist(b.doc);
  const work = emptyWork(); work.achieved.hbridge = {};
  const trace: Array<{ t: number; rpm: number; s1: number; s2: number; an: ReturnType<typeof analyze> }> = [];
  for (let k = 0; k <= seconds / dt; k++) {
    const r = e.handle({ seq: k, netlist: built.netlist, advance: k ? dt : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
    const an = analyze(b.doc, built, r.result, r.tones);
    const st = checkLesson('hbridge', { doc: b.doc, built, result: r.result, analysis: an, work });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.hbridge[g] = true;
    const x = an.parts.U1?.extra;
    trace.push({ t: r.t, rpm: an.parts.M1?.extra?.rpm ?? 0, s1: x?.s1 ?? -2, s2: x?.s2 ?? -2, an });
  }
  return { trace, work };
}

describe('ไอซีขับมอเตอร์ L293D', () => {
  it('ผังขา DIP-16 ที่ f22 และ GND ทั้งสี่ขาต่อถึงกันภายใน', () => {
    const b = hbRig();
    const ph = Object.fromEntries(pinHolesFor(b.doc.parts.find((p) => p.id === 'U1')!).map((x) => [x.pin, x.hole]));
    expect(ph).toMatchObject({ EN12: 'f22', '1A': 'f23', '1Y': 'f24', GND: 'f25', 'GND.5': 'f26', '2Y': 'f27', '2A': 'f28', VCC2: 'f29', EN34: 'e29', '3A': 'e28', '3Y': 'e27', 'GND.12': 'e26', 'GND.13': 'e25', '4Y': 'e24', '4A': 'e23', VCC1: 'e22' });
    const nl = buildNetlist(b.doc);
    const net = (pin: string) => nl.connectivity.netOf.get(`U1:${pin}`);
    expect(new Set(['GND', 'GND.5', 'GND.12', 'GND.13'].map(net)).size).toBe(1);
  });
  it('DC: ตารางความจริง (EN=1: Y=A, EN=0: ลอย) และแรงดันตก VOH/VOL ที่ 0.6 A ตามดาต้าชีต (≈ 1.4 V / 1.2 V)', () => {
    // ขาเข้าจากราง: 1A = 5 V, 2A = 0 V, EN12 = 5 V · โหลด 15.7 Ω ระหว่าง 1Y–2Y ที่ VCC2 = 12 V → กระแส ≈ (12 − 1.4 − 1.2) / 15.7 ≈ 0.6 A
    const mk = (en: boolean, r = 15.7) => new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 12, currentLimit: 3 }).part('dcsupply', onTable(-25, 12), 'PS2', { voltage: 5 })
      .part('hbridge', onBoard('f10'), 'U1')
      .wire(P('PS1', 'pos'), H('bp2')).wire(P('PS1', 'neg'), H('bn2')).wire(P('PS2', 'pos'), H('tp2')).wire(P('PS2', 'neg'), H('tn2')).wire(H('tn30'), H('bn30'))
      .wire(H('j17'), H('bp17')).wire(H('a10'), H('tp10')).wire(H('j13'), H('bn14'))
      .wire(H('j11'), H('tp11')).wire(H('i16'), H('bn16')).wire(H('i10'), en ? H('tp12') : H('tn12'))
      .part('resistor', onTable(30, 0), 'RL', { resistance: r, powerRating: 10 }).wire(P('RL', '1'), H('h12')).wire(P('RL', '2'), H('h15')).doc;
    const on = simulate(mk(true)).analysis;
    const x = on.parts.U1.extra!;
    expect([x.s1, x.s2]).toEqual([1, 0]);
    expect(Math.abs(x.iy1)).toBeGreaterThan(0.55); expect(Math.abs(x.iy1)).toBeLessThan(0.65);
    expect(12 - x.vy1).toBeGreaterThan(1.3); expect(12 - x.vy1).toBeLessThan(1.5);
    expect(x.vy2).toBeGreaterThan(1.1); expect(x.vy2).toBeLessThan(1.3);
    const off = simulate(mk(false)).analysis.parts.U1.extra!;
    expect([off.s1, off.s2]).toEqual([-1, -1]);
    expect(Math.abs(off.iy1)).toBe(0);
    // 3 Ω → > 1.2 A อันตราย
    expect(simulate(mk(true, 3)).analysis.diagnostics.some((d) => d.partId === 'U1' && d.severity === 'danger')).toBe(true);
  });
  it('Pico ควบคุม: เดินหน้า → เบรก → ถอยหลัง → ถอยหลังช้า (PWM ที่ EN) — ทิศและความเร็วตามโค้ด, ไดโอดในตัวรับกระแสตอนตัด', () => {
    const { trace } = runHb(hbRig(), 5.6);
    const at = (t: number) => trace.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    const fwd = at(1.6), brake = at(2.1), rev = at(3.6), slow = at(5.1);
    expect(fwd.rpm).toBeGreaterThan(100); expect(fwd.rpm).toBeLessThan(200);
    expect(Math.abs(brake.rpm)).toBeLessThan(fwd.rpm * 0.3);
    expect(rev.rpm).toBeLessThan(-100);
    expect(slow.rpm).toBeLessThan(-20); expect(Math.abs(slow.rpm)).toBeLessThan(Math.abs(rev.rpm) - 10);
    expect([fwd.s1, fwd.s2]).toEqual([1, 0]);
    expect([rev.s1, rev.s2]).toEqual([0, 1]);
    // มอเตอร์ได้แรงดันน้อยกว่า 6 V (แรงดันตกในไอซี) — ความเร็วต่ำกว่าต่อตรง 6 V (≈ 250 rpm)
    expect(fwd.an.parts.U1.extra!.vy1 - fwd.an.parts.U1.extra!.vy2).toBeLessThan(4.2);
  }, 120000);
  it('VCC1 จาก 3V3 → วงจรตรรกะไม่ทำงาน (ขาออกลอย) + เตือน; ไม่ต่อ VCC2 → เตือน', () => {
    const { trace } = runHb(hbRig({ vcc1: '3V3' }), 1.0);
    const l = trace[trace.length - 1];
    expect([l.s1, l.s2]).toEqual([-1, -1]);
    expect(Math.abs(l.rpm)).toBeLessThan(1);
    expect(l.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('VCC1'))).toBe(true);
    const { trace: t2 } = runHb(hbRig({ noVcc2: true }), 0.8);
    expect(t2[t2.length - 1].an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('VCC2'))).toBe(true);
  }, 120000);
  it('แลป 28 ผ่านครบ; บันทึก/เปิดไฟล์ + schema 24', () => {
    expect(LESSONS.find((l) => l.id === 'hbridge')?.number).toBe(28);
    const { work } = runHb(hbRig(), 5.6);
    expect(work.achieved.hbridge).toMatchObject({ power: true, inputs: true, motor: true, forward: true, reverse: true, speed: true });
    const d = hbRig().doc;
    const v = parseProject(serializeProject('h', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 24;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
    void motorRpm;
  }, 120000);
});
