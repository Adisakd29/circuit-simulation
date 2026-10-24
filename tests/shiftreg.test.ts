import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

const HEAD = 'from machine import Pin\nimport time\nser = Pin(2, Pin.OUT)\nsrclk = Pin(3, Pin.OUT)\nrclk = Pin(4, Pin.OUT)\n\ndef show(b):\n    # ส่งบิตสูงสุดก่อน (บิตที่ส่งก่อนไปอยู่ QH)\n    for i in range(8):\n        ser.value((b >> (7 - i)) & 1)\n        srclk.value(1)\n        srclk.value(0)\n    rclk.value(1)\n    rclk.value(0)\n\n';
export const SHIFT_CODE = HEAD + 'while True:\n    for i in range(8):\n        show(1 << i)  # ไฟวิ่ง QA → QH\n        time.sleep(0.15)\n    show(0b10101010)\n    time.sleep(0.4)\n    show(0b00001111)\n    time.sleep(0.4)\n';
/** แสดงค่าตามลำดับ ค่าละ 0.3 s แล้วหยุด */
export const seqCode = (vals: number[]) => HEAD + `for v in [${vals.join(', ')}]:\n    show(v)\n    print("V", v)\n    time.sleep(0.3)\n`;

/** LED(k+1) บิต k (QA = LED1): แอโนด h(9+2k), แคโทด h(10+2k), 330 Ω จาก j(10+2k) ลงราง bn */
const X = (k: number) => 9 + 2 * k;
/**
 * 74HC595 ที่ f1 (ขา 1 QB = f1 … ขา 8 GND = f8 · ขา 9 QH′ = e8 … ขา 16 VCC = e1) · Pico บนโต๊ะซ้ายของบอร์ด
 * VCC → 3V3, GND (j8) → bn8 → GND ของ Pico, SRCLR (a7) → VCC (a1), OE (b4) → GND (g8) · GP2 → SER, GP3 → SRCLK, GP4 → RCLK
 * QA (c2) → g9, QB…QH (i1…i7) → i11…i23
 */
export function shiftRig(o: { code?: string; vcc?: '3V3' | 'VBUS'; noRes?: boolean; oeHigh?: boolean; tie?: boolean; clrLow?: boolean } = {}) {
  const b = new Builder().part('pico', onTable(-40, 4), 'PICO1', { code: o.code ?? SHIFT_CODE, autorun: true })
    .part('shiftreg', onBoard('f1'), 'U1');
  const RED = '#e53935', BLK = '#212121', YEL = '#fbc02d', GRN = '#43a047', BLU = '#1e88e5', ORG = '#fb8c00';
  b.wire(P('PICO1', o.vcc ?? '3V3'), H('d1'), undefined, RED).wire(P('PICO1', 'GND.38'), H('bn2'), undefined, BLK).wire(H('j8'), H('bn8'), undefined, BLK)
    .wire(H('a7'), H(o.clrLow ? 'h8' : 'a1'), undefined, o.clrLow ? BLK : RED).wire(H('b4'), H(o.oeHigh ? 'b1' : 'g8'), undefined, o.oeHigh ? RED : BLK)
    .wire(P('PICO1', 'GP2'), H('d3'), undefined, YEL).wire(P('PICO1', 'GP3'), H('d6'), undefined, GRN).wire(P('PICO1', o.tie ? 'GP3' : 'GP4'), H('d5'), undefined, BLU);
  b.wire(H('c2'), H(`g${X(0)}`), undefined, ORG);
  for (let k = 1; k < 8; k++) b.wire(H(`i${k}`), H(`i${X(k)}`), undefined, ORG);
  for (let k = 0; k < 8; k++) {
    b.part('led', onBoard(`h${X(k)}`), `LED${k + 1}`);
    if (o.noRes) b.wire(H(`j${X(k) + 1}`), H(`bn${X(k) + 1}`));
    else b.part('resistor', onBoard(`j${X(k) + 1}`, 90), `R${k + 1}`, { resistance: 330, span: 2 });
  }
  return b;
}

type Snap = { t: number; out: number; leds: number[]; con: string; diags: string[]; extra: Record<string, number> };
export function runShift(b: Builder, dur: number, step = 0.05) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  const work = emptyWork(); work.achieved.shiftreg = {};
  const snaps: Snap[] = [];
  let con = '';
  for (let i = 0; i <= dur / step; i++) {
    const r = e.handle({ seq: i, netlist: built.netlist, advance: i ? step : 0, restart: i === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    const an = analyze(doc, built, r.result, r.tones);
    const st = checkLesson('shiftreg', { doc, built, result: r.result, analysis: an, work });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.shiftreg[g] = true;
    const x = an.parts.U1.extra!;
    snaps.push({ t: i * step, out: x.out, leds: Array.from({ length: 8 }, (_, k) => an.parts[`LED${k + 1}`]?.current ?? 0), con, diags: an.diagnostics.filter((d) => d.partId === 'U1').map((d) => `${d.severity}:${d.message}`), extra: x });
  }
  return { snaps, work };
}

describe('ไอซีเลื่อนบิต 74HC595', () => {
  it('ผังขา DIP-16 ตามดาต้าชีต: QB–QH ขา 1–7, GND ขา 8, QH′ 9, SRCLR 10, SRCLK 11, RCLK 12, OE 13, SER 14, QA 15, VCC 16', () => {
    const ph = pinHolesFor(shiftRig().doc.parts.find((p) => p.id === 'U1')!);
    expect(ph.map((x) => [x.pin, x.hole])).toEqual([['QB', 'f1'], ['QC', 'f2'], ['QD', 'f3'], ['QE', 'f4'], ['QF', 'f5'], ['QG', 'f6'], ['QH', 'f7'], ['GND', 'f8'],
      ['QH2', 'e8'], ['SRCLR', 'e7'], ['SRCLK', 'e6'], ['RCLK', 'e5'], ['OE', 'e4'], ['SER', 'e3'], ['QA', 'e2'], ['VCC', 'e1']]);
  });
  it('Pico ส่งค่า 1, 5, 170, 255, 0 (MSB ก่อน) → ขาออกและ LED ตรงบิต, ขาสูง ≈ 3.2 V ที่ ≈ 3.7 mA', () => {
    const vals = [1, 5, 170, 255, 0];
    const { snaps } = runShift(shiftRig({ code: seqCode(vals) }), 2.4);
    for (const v of vals) {
      // ช่วงท้ายของค่านี้ (ก่อนพิมพ์ค่าถัดไป)
      const lastV = (c: string) => { const m = [...c.matchAll(/V (\d+)/g)]; return m.length ? Number(m[m.length - 1][1]) : null; };
      const at = snaps.filter((s) => lastV(s.con) === v);
      const s = at[at.length - 1];
      expect(s, `ค่า ${v}`).toBeTruthy();
      expect(s.out).toBe(v);
      for (let k = 0; k < 8; k++) if ((v >> k) & 1) expect(s.leds[k]).toBeGreaterThan(3e-3); else expect(s.leds[k]).toBeLessThan(1e-5);
      if (v === 255) { expect(s.extra.vQA).toBeGreaterThan(3.0); expect(s.extra.isrc).toBeGreaterThan(0.025); expect(s.extra.isrc).toBeLessThan(0.035); }
    }
  }, 120000);
  it('ต่อ RCLK กับ SRCLK ขาเดียวกัน → ขาออกช้ากว่ารีจิสเตอร์เลื่อนหนึ่งจังหวะ (ส่ง 128 ได้ QG)', () => {
    const { snaps } = runShift(shiftRig({ code: seqCode([128]), tie: true }), 0.4);
    const s = snaps[snaps.length - 1];
    expect(s.extra.sreg).toBe(128);
    expect(s.out).toBe(64);
    expect(s.leds[6]).toBeGreaterThan(3e-3);
  }, 60000);
  it('OE สูง → ขาออกปิด LED ดับ + แจ้ง; SRCLR ต่ำ → ล้างค้าง ขาออก 0', () => {
    const oe = runShift(shiftRig({ code: seqCode([255]), oeHigh: true }), 0.4).snaps.at(-1)!;
    expect(oe.out).toBe(255);
    expect(Math.max(...oe.leds)).toBeLessThan(1e-6);
    expect(oe.diags.some((d) => d.startsWith('info') && d.includes('OE'))).toBe(true);
    const clr = runShift(shiftRig({ code: seqCode([255]), clrLow: true }), 0.4).snaps.at(-1)!;
    expect(clr.out).toBe(0);
    expect(clr.diags.some((d) => d.includes('SRCLR'))).toBe(true);
  }, 60000);
  it('ไม่มีตัวต้านทาน + 255 → กระแสรวมเกิน 70 mA (อันตราย); ไฟเลี้ยง 5 V จาก VBUS → เตือนระดับขาเข้า 3.3 V', () => {
    const nr = runShift(shiftRig({ code: seqCode([255]), noRes: true }), 0.4).snaps.at(-1)!;
    expect(nr.extra.isrc).toBeGreaterThan(0.07);
    expect(nr.diags.some((d) => d.startsWith('danger') && d.includes('กระแสรวม'))).toBe(true);
    const v5 = runShift(shiftRig({ code: seqCode([5]), vcc: 'VBUS' }), 0.4).snaps.at(-1)!;
    expect(v5.out).toBe(5);
    expect(v5.diags.some((d) => d.startsWith('warn') && d.includes('VIH'))).toBe(true);
  }, 60000);
  it('แลป 30 ผ่านครบ 5 ข้อด้วยโค้ดไฟวิ่ง; ขาด OE → ไม่ผ่านไฟเลี้ยง; บันทึก/เปิดไฟล์ + schema 26', () => {
    expect(LESSONS.find((l) => l.id === 'shiftreg')?.number).toBe(30);
    const { work } = runShift(shiftRig(), 2.4);
    expect(work.achieved.shiftreg).toMatchObject({ power: true, control: true, leds: true, chaser: true, pattern: true });
    const bad = runShift(shiftRig({ code: seqCode([5]), oeHigh: true }), 0.2).work;
    expect(bad.achieved.shiftreg.power).toBeFalsy();
    const d = shiftRig().doc;
    const v = parseProject(serializeProject('t', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 26;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 120000);
});
