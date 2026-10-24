import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { analyze } from '../src/instruments/measure';
import { emptyWork } from '../src/model/types';
import { LESSONS } from '../src/lessons/lessons';
import { Builder, H, P, onBoard, onTable } from './helpers';

const BLINK = 'from machine import Pin\nimport time\nk=Pin(15,Pin.OUT)\nwhile True:\n  k.toggle()\n  time.sleep(0.5)\n';
const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/** Pico h5 + โมดูลรีเลย์บนโต๊ะ · โหลด: PS1 5 V → 330 Ω (a26–a29) → LED (c29/c30) → NO, COM → PS1(−) */
function build(opts: { vccPin?: string; loadOn?: 'NO' | 'NC' } = {}) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code: BLINK, autorun: true });
  const vcc = opts.vccPin ?? 'VBUS';
  b.part('relay', onTable(0, -25), 'K1')
    .part('dcsupply', onTable(40, -25), 'PS1', { voltage: 5 })
    .part('resistor', onBoard('a26'), 'R1', { resistance: 330, span: 3 })
    .part('led', onBoard('c29'), 'LED1')
    .wire(P('K1', 'V'), H(`a${col(b, vcc)}`))
    .wire(P('K1', 'G'), H(`j${col(b, 'GND.18')}`))
    .wire(P('K1', 'S'), H(`j${col(b, 'GP15')}`))
    .wire(P('PS1', 'pos'), H('b26'))
    .wire(P(`K1`, opts.loadOn ?? 'NO'), H('a30'))
    .wire(P('K1', 'COM'), P('PS1', 'neg'));
  return b;
}

function session(b: Builder, seconds = 2.2) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  const work = emptyWork(); work.achieved.relay = {};
  const trace: { on: boolean; ic: number; iload: number; is: number; ps: string }[] = [];
  let st: Record<string, { pass: boolean; detail?: string }> = {};
  for (let k = 0; k < seconds / 0.05; k++) {
    const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
    const an = analyze(doc, built, r.result);
    const ex = an.parts['K1'].extra!;
    trace.push({ on: !!ex.energized, ic: ex.icoil, iload: an.parts['LED1'].current, is: Math.abs(an.parts['K1'].current ?? 0), ps: an.diagnostics.filter((d) => d.partId === 'PS1').map((d) => d.message).join(' ') });
    st = checkLesson('relay', { doc, built, result: r.result, analysis: an, work });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.relay[g] = true;
  }
  return { st, ach: work.achieved.relay, trace };
}

describe('แลป 19: Pico สั่งโมดูลรีเลย์', () => {
  it('บทเรียนมีอยู่และเลขแลป 19', () => {
    expect(LESSONS.find((l) => l.id === 'relay')?.number).toBe(19);
  });
  it('โค้ดกะพริบ GP15: รีเลย์ดึง/ปล่อยตาม, LED โหลดผ่าน COM–NO ติด/ดับ, ผ่านทุกเป้าหมาย', () => {
    const { ach, trace } = session(build());
    const on = trace.filter((t) => t.on), off = trace.filter((t) => !t.on);
    expect(on.length).toBeGreaterThan(5);
    expect(off.length).toBeGreaterThan(5);
    for (const t of on.slice(1)) { expect(t.ic).toBeGreaterThan(0.055); expect(t.iload).toBeGreaterThan(5e-3); }
    for (const t of off.slice(2)) { expect(t.iload).toBeLessThan(1e-5); expect(t.ps).toContain('หน้าสัมผัสรีเลย์'); }
    expect(ach.power && ach.control && ach.load && ach.follow).toBe(true);
  }, 60000);
  it('ไฟเลี้ยงโมดูลจาก 3V3: ไม่ดึง และเป้าหมายไฟเลี้ยงไม่ผ่าน', () => {
    const { ach, trace } = session(build({ vccPin: '3V3' }), 1.2);
    expect(trace.every((t) => !t.on)).toBe(true);
    expect(ach.power).toBeFalsy();
    expect(ach.load).toBeFalsy();
  }, 60000);
  it('โหลดที่ NC: ทำงานสลับกับ NO (ติดเมื่อรีเลย์ปล่อย)', () => {
    const { trace } = session(build({ loadOn: 'NC' }), 1.6);
    for (const t of trace.slice(2)) if (t.on) expect(t.iload).toBeLessThan(1e-5);
    expect(trace.some((t) => !t.on && t.iload > 5e-3)).toBe(true);
  }, 60000);
});
