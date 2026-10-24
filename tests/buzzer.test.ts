import { describe, expect, it } from 'vitest';
import { buzzerParamsFor } from '../src/model/catalog';
import { analyze } from '../src/instruments/measure';
import { buildNetlist } from '../src/sim/netlist';
import { SimEngine } from '../src/sim/engine';
import { ToneMeter } from '../src/sim/tone';
import type { SimResult } from '../src/sim/solver';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable, simulate } from './helpers';

/** BZ1 ที่ e10: ขา + e10, ขา − e13 · ไฟตรงจากแหล่งจ่าย (สลับขั้วได้) */
function dc(type: 'active' | 'passive', v: number, reversed = false) {
  return new Builder()
    .part('dcsupply', onTable(-25, 0), 'PS1', { voltage: v, currentLimit: 1 })
    .part('buzzer', onBoard('e10'), 'BZ1', buzzerParamsFor(type))
    .wire(P('PS1', 'pos'), H('tp2')).wire(P('PS1', 'neg'), H('tn2'))
    .wire(H(reversed ? 'a13' : 'a10'), H(reversed ? 'tp14' : 'tp10')).wire(H(reversed ? 'a10' : 'a13'), H(reversed ? 'tn10' : 'tn14'));
}
/** เครื่องกำเนิดสัญญาณขับบัซเซอร์ (OUT → ขา +, COM → ขา −) */
function fg(type: 'active' | 'passive', params: Record<string, unknown>) {
  return new Builder()
    .part('fgen', onTable(-25, 0), 'FG1', params)
    .part('buzzer', onBoard('e10'), 'BZ1', buzzerParamsFor(type))
    .wire(P('FG1', 'OUT'), H('a10')).wire(P('FG1', 'COM'), H('a13'));
}
function runEngine(b: Builder, seconds: number, ticks = 10) {
  const built = buildNetlist(b.doc);
  const e = new SimEngine();
  let r = e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  for (let k = 0; k < ticks; k++) r = e.handle({ seq: k + 1, netlist: built.netlist, advance: seconds / ticks, restart: false, watch: [], budgetMs: 1e9 });
  return { r, analysis: analyze(b.doc, built, r.result, r.tones) };
}

describe('ToneMeter', () => {
  it('ไซน์ 1.5 kHz ±10 mA บวก DC 5 mA: ความถี่ ±0.5%, ขนาดแกว่ง และค่าเฉลี่ยถูกต้อง', () => {
    const m = new ToneMeter(['X']);
    for (let k = 0; k <= 4000; k++) {
      const t = k * 1e-5;
      m.feed(t, { ok: true, elements: { X: { id: 'X', current: 0.005 + 0.01 * Math.sin(2 * Math.PI * 1500 * t), voltage: 0, power: 0 } } } as unknown as SimResult);
    }
    const r = m.read().X;
    expect(Math.abs(r.freq! / 1500 - 1)).toBeLessThan(5e-3);
    expect(Math.abs(r.iac - 0.01)).toBeLessThan(2e-4);
    expect(Math.abs(r.idc - 0.005)).toBeLessThan(3e-4);
  });
  it('ค่าคงที่: ไม่มีความถี่', () => {
    const m = new ToneMeter(['X']);
    for (let k = 0; k < 100; k++) m.feed(k * 1e-4, { ok: true, elements: { X: { id: 'X', current: 0.02, voltage: 0, power: 0 } } } as unknown as SimResult);
    expect(m.read().X.freq).toBeNull();
  });
});

describe('บัซเซอร์แบบมีวงจรในตัว (active)', () => {
  it('5 V: กระแส ≈ 30 mA และดังที่ 2.4 kHz', () => {
    const { analysis } = simulate(dc('active', 5).doc);
    const r = analysis.parts['BZ1'];
    expect(Math.abs(r.current / 0.03 - 1)).toBeLessThan(0.02);
    expect(r.extra!.sounding).toBe(1);
    expect(r.extra!.freq).toBe(2400);
  });
  it('ต่อกลับขั้ว: ไม่มีกระแส ไม่ดัง และเตือน', () => {
    const { analysis } = simulate(dc('active', 5, true).doc);
    expect(Math.abs(analysis.parts['BZ1'].current)).toBeLessThan(1e-6);
    expect(analysis.parts['BZ1'].extra!.sounding).toBe(0);
    expect(analysis.diagnostics.some((d) => d.partId === 'BZ1' && d.message.includes('กลับขั้ว'))).toBe(true);
  });
  it('3.3 V: ยังดัง (กระแสลดลง) · 2 V: เงียบและบอกว่าแรงดันต่ำ', () => {
    const a = simulate(dc('active', 3.3).doc).analysis.parts['BZ1'];
    expect(a.current).toBeLessThan(0.03);
    expect(a.extra!.sounding).toBe(1);
    const lo = simulate(dc('active', 2).doc).analysis;
    expect(lo.parts['BZ1'].extra!.sounding).toBe(0);
    expect(lo.diagnostics.some((d) => d.partId === 'BZ1' && d.message.includes('ต่ำกว่าช่วงทำงาน'))).toBe(true);
  });
});

describe('บัซเซอร์แบบไม่มีวงจร (passive)', () => {
  it('ไฟตรง 3.5 V: กระแส 3.5/42 แต่ไม่ดัง และบอกว่าต้องป้อนคลื่นสี่เหลี่ยม', () => {
    const { analysis } = simulate(dc('passive', 3.5).doc);
    expect(Math.abs(analysis.parts['BZ1'].current - 3.5 / 42) / (3.5 / 42)).toBeLessThan(0.01);
    expect(analysis.parts['BZ1'].extra!.sounding).toBe(0);
    expect(analysis.diagnostics.some((d) => d.partId === 'BZ1' && d.message.includes('คลื่นสี่เหลี่ยม'))).toBe(true);
  });
  it('เครื่องกำเนิดสี่เหลี่ยม 2 kHz 3 Vpp: ดังที่ 2 kHz (±1%) ใกล้เรโซแนนซ์ จึงดังมาก', () => {
    const { r, analysis } = runEngine(fg('passive', { wave: 'square', frequency: 2000, vpp: 3, offset: 1.5 }), 0.05);
    expect(Math.abs(r.tones!.BZ1.freq! / 2000 - 1)).toBeLessThan(0.01);
    const x = analysis.parts['BZ1'].extra!;
    expect(x.sounding).toBe(1);
    expect(x.level).toBeGreaterThan(0.5);
  });
  it('500 Hz: ยังดังที่ 500 Hz แต่เบากว่าที่เรโซแนนซ์', () => {
    const near = runEngine(fg('passive', { wave: 'square', frequency: 2000, vpp: 3, offset: 1.5 }), 0.05).analysis.parts['BZ1'].extra!;
    const { r, analysis } = runEngine(fg('passive', { wave: 'square', frequency: 500, vpp: 3, offset: 1.5 }), 0.06);
    expect(Math.abs(r.tones!.BZ1.freq! / 500 - 1)).toBeLessThan(0.01);
    expect(analysis.parts['BZ1'].extra!.level).toBeLessThan(near.level * 0.3);
  });
  it('บัซเซอร์แบบมีวงจรต่อเครื่องกำเนิด DC 5 V (ผ่านการจำลองตามเวลา) ก็ดัง', () => {
    const { analysis } = runEngine(fg('active', { wave: 'dc', frequency: 1000, vpp: 0, offset: 5 }), 0.02);
    expect(analysis.parts['BZ1'].extra!.sounding).toBe(1);
  });
  it('บันทึก/เปิดไฟล์ได้ และไฟล์ schema 12 เดิมยังเปิดได้', () => {
    const doc = dc('passive', 3.5).doc;
    const v = parseProject(serializeProject('bz', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 12;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});

import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';

describe('แลป 16: บัซเซอร์', () => {
  const check = (b: Builder, tran = false) => {
    const built = buildNetlist(b.doc);
    if (tran) {
      const { r, analysis } = runEngine(b, 0.05);
      return checkLesson('buzzer', { doc: b.doc, built, result: r.result, analysis, work: emptyWork() });
    }
    const { analysis, result } = simulate(b.doc);
    return checkLesson('buzzer', { doc: b.doc, built, result, analysis, work: emptyWork() });
  };
  it('บทเรียนมีอยู่และเป้าหมายครบ', () => {
    const l = LESSONS.find((x) => x.id === 'buzzer')!;
    expect(l.number).toBe(16);
    expect(l.goals.map((g) => g.id)).toEqual(['active', 'passiveDc', 'passiveAc', 'resonance']);
  });
  it('active 5 V ผ่าน; กลับขั้วไม่ผ่านพร้อมเหตุผล', () => {
    expect(check(dc('active', 5)).active.pass).toBe(true);
    const st = check(dc('active', 5, true));
    expect(st.active.pass).toBe(false);
    expect(st.active.detail).toMatch(/กลับขั้ว/);
  });
  it('passive ไฟตรงผ่าน passiveDc; คลื่นสี่เหลี่ยม 2 kHz ผ่าน passiveAc และ resonance; 500 Hz ไม่ผ่าน resonance', () => {
    expect(check(dc('passive', 3.5)).passiveDc.pass).toBe(true);
    const ac = check(fg('passive', { wave: 'square', frequency: 2000, vpp: 3, offset: 1.5 }), true);
    expect(ac.passiveAc.pass && ac.resonance.pass).toBe(true);
    const lo = check(fg('passive', { wave: 'square', frequency: 500, vpp: 3, offset: 1.5 }), true);
    expect(lo.passiveAc.pass).toBe(true);
    expect(lo.resonance.pass).toBe(false);
  });
});
