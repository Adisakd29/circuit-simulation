import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { setPartParams } from '../src/editor/ops';
import { parseProject, serializeProject } from '../src/storage/storage';
import { pc817TypCtr } from '../src/model/catalog';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

export const OPTO_CODE = 'from machine import Pin\nimport time\nsw = Pin(15, Pin.OUT)\nwhile True:\n    sw.toggle()\n    time.sleep(0.5)\n';
const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * Pico ที่ h1 · PC817 ที่ f24 (A f24, K f25, E e25, C e24) · 330 Ω (j20–j24) จาก GP15 ถึงขา 1 · ขา 2 (i25) → GND.18
 * ขาออก: PS1 12 V → ราง tp30/tn30 · 2.2 kΩ แนวตั้ง a28 → tp28 · LED c28/c29 · d29 → d24 (ขา 4) · b25 → tn26 (ขา 3)
 */
export function optoRig(o: { code?: string; rin?: number; shareGnd?: boolean; direct?: boolean; rank?: 'A' | 'B' | 'C' | 'D' } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? OPTO_CODE, autorun: true })
    .part('opto', onBoard('f24'), 'U1', o.rank ? { rank: o.rank, ctr: pc817TypCtr(o.rank) } : undefined)
    .part('dcsupply', onTable(42, -6), 'PS1', { voltage: 12 });
  const gp15 = col(b, 'GP15');
  if (o.direct) b.wire(H(`j${gp15}`), H('j24'), undefined, '#fbc02d');
  else b.part('resistor', onBoard(`j${gp15}`), 'R1', { resistance: o.rin ?? 330, span: 24 - gp15 });
  b.wire(H('i25'), H(`j${col(b, 'GND.18')}`), undefined, '#212121')
    .wire(P('PS1', 'pos'), H('tp30'), undefined, '#e53935').wire(P('PS1', 'neg'), H('tn30'), undefined, '#212121')
    .part('resistor', onBoard('a28', 270), 'R2', { resistance: 2200, span: 3 }).part('led', onBoard('c28'), 'LED1')
    .wire(H('d29'), H('d24'), undefined, '#fb8c00').wire(H('b25'), H('tn26'), undefined, '#212121');
  if (o.shareGnd) b.wire(H('tn2'), H(`a${col(b, 'GND.38')}`), undefined, '#212121');
  return b;
}

type Snap = { iF: number; iC: number; vce: number; sat: number; led: number; diags: string[]; x: Record<string, number> };
export function runOpto(b: Builder, dur: number, step = 0.05, mutate?: (d: CircuitDoc, t: number) => CircuitDoc) {
  const e = new SimEngine();
  const work = emptyWork(); work.achieved.opto = {};
  const snaps: Snap[] = [];
  let doc = b.doc, built = buildNetlist(doc);
  for (let i = 0; i <= dur / step; i++) {
    if (mutate) { const d2 = mutate(b.doc, i * step); if (d2 !== doc) { doc = d2; built = buildNetlist(doc); } }
    const r = e.handle({ seq: i, netlist: built.netlist, advance: i ? step : 0, restart: i === 0, watch: [], budgetMs: 1e9 });
    const an = analyze(doc, built, r.result, r.tones);
    const st = checkLesson('opto', { doc, built, result: r.result, analysis: an, work });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.opto[g] = true;
    const x = an.parts.U1.extra!;
    snaps.push({ iF: x.iF, iC: x.iC, vce: x.vce, sat: x.sat, led: an.parts.LED1?.current ?? 0, diags: an.diagnostics.filter((d) => d.partId === 'U1').map((d) => `${d.severity}:${d.message}`), x });
  }
  return { snaps, work };
}

describe('ออปโตคัปเปลอร์ PC817', () => {
  it('ผังขา DIP-4: ขา 1 A, 2 K แถว f · ขา 3 E, 4 C แถว e (ขา 4 ตรงข้ามขา 1)', () => {
    const ph = pinHolesFor(optoRig().doc.parts.find((p) => p.id === 'U1')!);
    expect(ph.map((x) => [x.pin, x.hole])).toEqual([['A', 'f24'], ['K', 'f25'], ['E', 'e25'], ['C', 'e24']]);
  });
  it('ตามดาต้าชีต: VF 1.20 V ที่ 20 mA; ย่านขยาย IC = CTR × IF; อิ่มตัว VCE 0.1–0.2 V ที่ IF 20 mA IC 1 mA; ไม่มีแสง IC ≈ 0', () => {
    const rig = (rin: number, rl: number, vin = 5) => new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: vin }).part('dcsupply', onTable(-25, 12), 'PS2', { voltage: 12 })
      .part('opto', onBoard('f10'), 'U1').part('resistor', onBoard('j3'), 'R1', { resistance: rin, span: 7 }).part('resistor', onBoard('a5'), 'R2', { resistance: rl, span: 5 })
      .wire(P('PS1', 'pos'), H('i3')).wire(H('g11'), P('PS1', 'neg')).wire(P('PS2', 'pos'), H('b5')).wire(H('d11'), P('PS2', 'neg')).doc;
    const vf = simulate(rig(190, 100)).analysis.parts.U1.extra!;
    expect(vf.iF).toBeGreaterThan(0.019); expect(vf.iF).toBeLessThan(0.0205);
    expect(vf.vF).toBeGreaterThan(1.17); expect(vf.vF).toBeLessThan(1.23);
    const lin = simulate(rig(680, 100)).analysis.parts.U1.extra!;
    expect(lin.sat).toBe(0);
    expect(Math.abs(lin.ctrMeas - pc817TypCtr('C')) / pc817TypCtr('C')).toBeLessThan(0.01);
    const sat = simulate(rig(190, 11000)).analysis.parts.U1.extra!; // IF ≈ 20 mA, IC ≈ 1 mA
    expect(sat.sat).toBe(1);
    expect(sat.vce).toBeGreaterThan(0.05); expect(sat.vce).toBeLessThan(0.2);
    const dark = simulate(rig(1e7, 1000, 0.5)).analysis.parts.U1.extra!;
    expect(dark.iC).toBeLessThan(1e-7);
    expect(dark.shared).toBe(0);
  });
  it('Pico กะพริบ GP15 → ขาออกอิ่มตัว/ดับตาม LED ฝั่ง 12 V ≈ 4.5 mA, IF ≈ 5.3 mA, สองฝั่งแยกกัน', () => {
    const { snaps } = runOpto(optoRig(), 2.1);
    const on = snaps.filter((s) => s.iF > 5e-3), off = snaps.filter((s) => s.iF < 1e-6);
    expect(on.length).toBeGreaterThan(5); expect(off.length).toBeGreaterThan(5);
    for (const s of on) { expect(s.sat).toBe(1); expect(s.vce).toBeLessThan(0.2); expect(s.led).toBeGreaterThan(4e-3); expect(s.led).toBeLessThan(5e-3); expect(s.iF).toBeLessThan(7.5e-3); expect(s.x.shared).toBe(0); }
    for (const s of off) expect(s.led).toBeLessThan(1e-6);
  }, 120000);
  it('กลุ่ม CTR: IF ≈ 0.22 mA (10 kΩ) ย่านขยาย IC ตามกลุ่ม A < B < C < D', () => {
    const ic = (['A', 'B', 'C', 'D'] as const).map((rk) => {
      const s = runOpto(optoRig({ rin: 10000, rank: rk, code: 'from machine import Pin\nPin(15, Pin.OUT).value(1)\n' }), 0.3).snaps.at(-1)!;
      expect(s.sat).toBe(0);
      expect(Math.abs(s.iC / s.iF - pc817TypCtr(rk)) / pc817TypCtr(rk)).toBeLessThan(0.02);
      return s.iC;
    });
    for (let k = 1; k < 4; k++) expect(ic[k]).toBeGreaterThan(ic[k - 1]);
  }, 120000);
  it('GPIO ต่อขา 1 ตรง → ไม่ผ่านข้อขาเข้า; ขาเข้าเกิน 50 mA จากแหล่งจ่าย → อันตราย; กราวด์ร่วม → ไม่แยก', () => {
    const dir = runOpto(optoRig({ direct: true }), 0.6).work;
    expect(dir.achieved.opto.input).toBeFalsy();
    const over = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: 5 }).part('opto', onBoard('f10'), 'U1').part('resistor', onBoard('j3'), 'R1', { resistance: 47, span: 7 })
      .wire(P('PS1', 'pos'), H('i3')).wire(H('g11'), P('PS1', 'neg')).doc;
    expect(simulate(over).analysis.diagnostics.some((d) => d.partId === 'U1' && d.severity === 'danger' && d.message.includes('กระแส LED'))).toBe(true);
    const sh = runOpto(optoRig({ shareGnd: true }), 0.6);
    expect(sh.snaps.at(-1)!.x.shared).toBe(1);
    expect(sh.work.achieved.opto.isolated).toBeFalsy();
  }, 120000);
  it('แลป 31 ผ่านครบ 5 ข้อ (เปลี่ยน 330 Ω → 10 kΩ ระหว่างรัน); บันทึก/เปิดไฟล์ + schema 27', () => {
    expect(LESSONS.find((l) => l.id === 'opto')?.number).toBe(31);
    const { work } = runOpto(optoRig(), 2.6, 0.05, (d, t) => (t < 1.6 ? d : (() => { const r = setPartParams(d, 'R1', { resistance: 10000 }); if (!r.ok) throw new Error(); return r.doc; })()));
    expect(work.achieved.opto).toMatchObject({ input: true, output: true, isolated: true, switching: true, ctr: true });
    const d = optoRig().doc;
    const v = parseProject(serializeProject('t', d, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(d);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 27;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  }, 120000);
});
