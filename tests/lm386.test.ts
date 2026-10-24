import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { netOfPin } from '../src/connectivity/connectivity';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import type { ChannelMeasure } from '../src/instruments/scope';
import { checkLesson } from '../src/lessons/checks';

/**
 * วงจรขยายเสียง LM386 (แลป 39): 9 V (+ tp2, − tn2, สะพาน tp3 → bp3, tn4 → bn4)
 * LM386 ที่ f20: ขา 1 G1 f20, 2 IN− f21, 3 IN+ f22, 4 GND f23 · ขา 8 G8 e20, 7 BYP e21, 6 VS e22, 5 OUT e23
 * VS: tp22 → a22 · GND: j23 → bn23 · IN−: j21 → bn21 · สัญญาณ: เครื่องกำเนิด OUT → j22, COM → bn24
 * C คัปปลิ้ง 220 µF (+ b23, − b27) → ลำโพง + c27, − tn27 · (gain) 10 µF h16–h19 สาย g16 → g20, i19 → d20
 * สโคป CH1 → h22 (ขาเข้า), CH2 → d27 (ลำโพง), GND → bn26
 */
export function ampRig(o: { vpp?: number; gain200?: boolean; noCap?: boolean; v?: number; f?: number } = {}) {
  const b = new Builder()
    .part('dcsupply', onTable(-40, -60), 'PS1', { voltage: o.v ?? 9, currentLimit: 1 })
    .part('fgen', onTable(45, -60), 'FG1', { wave: 'sine', frequency: o.f ?? 1000, vpp: o.vpp ?? 0.02, offset: 0 })
    .part('scope', onTable(0, -90), 'SC1')
    .part('lm386', onBoard('f20'), 'U1')
    .part('speaker', onTable(-40, 30), 'LS1')
    .wire(P('PS1', 'pos'), H('tp2'), 'wp').wire(P('PS1', 'neg'), H('tn2'), 'wn', '#212121')
    .wire(H('tp3'), H('bp3'), 'w1').wire(H('tn4'), H('bn4'), 'w2', '#212121')
    .wire(H('tp22'), H('a22'), 'w3').wire(H('j23'), H('bn23'), 'w4', '#212121').wire(H('j21'), H('bn21'), 'w5', '#212121')
    .wire(P('FG1', 'OUT'), H('j22'), 'w6', '#fdd835').wire(P('FG1', 'COM'), H('bn24'), 'w7', '#212121')
    .wire(P('LS1', 'N'), H('tn27'), 'w9', '#212121')
    .wire(P('SC1', 'CH1'), H('h22'), 'wc1', '#fdd835').wire(P('SC1', 'CH2'), H('d27'), 'wc2', '#1e88e5').wire(P('SC1', 'GND'), H('bn26'), 'wc3', '#212121');
  if (o.noCap) b.wire(P('LS1', 'P'), H('c23'), 'w8');
  else b.part('capacitor', onBoard('b23'), 'C1', { capacitance: 220e-6, ratedVoltage: 16, polarized: true, span: 4 }).wire(P('LS1', 'P'), H('c27'), 'w8');
  if (o.gain200) b.part('capacitor', onBoard('h16'), 'CG', { capacitance: 10e-6, ratedVoltage: 16, polarized: true, span: 3 }).wire(H('g16'), H('g20'), 'wg1').wire(H('i19'), H('d20'), 'wg2');
  return b;
}

/** จำลองตามเวลา settle วินาที แล้วเก็บแรงดันขาเข้า/ขาออก (ลำโพง) อีก 3 คาบ */
export function runAmp(doc: CircuitDoc, settle = 0.3, f = 1000) {
  const e = new SimEngine();
  const built = buildNetlist(doc);
  const c = built.connectivity;
  e.handle({ seq: 0, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  let r = e.handle({ seq: 1, netlist: built.netlist, advance: settle, restart: false, watch: [], budgetMs: 1e9 });
  const nIn = netOfPin(c, 'U1', 'IN+')!, nSpk = netOfPin(c, 'LS1', 'P')!, nOut = netOfPin(c, 'U1', 'OUT')!;
  const vin: number[] = [], vsp: number[] = [], vout: number[] = [];
  const at = (n: number) => r.result.nodeVoltage[n] ?? 0;
  const dt = 1 / f / 40;
  for (let k = 0; k < 120; k++) {
    r = e.handle({ seq: k + 2, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    vin.push(at(nIn)); vsp.push(at(nSpk)); vout.push(at(nOut));
  }
  const pp = (a: number[]) => Math.max(...a) - Math.min(...a);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const meas = (a: number[]): ChannelMeasure => ({ vmax: Math.max(...a), vmin: Math.min(...a), vpp: pp(a), vavg: avg(a), vrms: 0, freq: f, slew: null, rise: null });
  return { ppIn: pp(vin), ppSpk: pp(vsp), dcOut: avg(vout), dcSpk: avg(vsp), an: analyze(doc, built, r.result, r.tones), r, built, scope: [meas(vin), meas(vsp)] as [ChannelMeasure, ChannelMeasure] };
}

describe('ไอซีขยายเสียง LM386 + ลำโพง 8 Ω', () => {
  it('ขา 1–8 เปิด: อัตราขยาย ≈ 20 (26 dB) ขาออก DC ≈ VS/2 ลำโพงไม่มีไฟตรง ดัง 1 kHz · ขา 1/7/8 ที่ปล่อยว่างไม่ถูกเตือน', { timeout: 30000 }, () => {
    const x = runAmp(ampRig().doc);
    expect(x.ppSpk / x.ppIn).toBeGreaterThan(19); expect(x.ppSpk / x.ppIn).toBeLessThan(21);
    expect(x.dcOut).toBeGreaterThan(4.4); expect(x.dcOut).toBeLessThan(4.6);
    expect(Math.abs(x.dcSpk)).toBeLessThan(0.01);
    const sp = x.an.parts.LS1.extra!;
    expect(sp.sounding).toBe(1); expect(Math.abs(sp.freq - 1000)).toBeLessThan(5);
    expect(x.an.diagnostics.filter((d) => d.partId === 'U1' || d.partId === 'LS1' || (d.message.includes('U1') && d.message.includes('ปลายเปิด')))).toEqual([]);
  });
  it('ใส่ 10 µF ขา 1–8: อัตราขยาย ≈ 200 (46 dB, ±5%) · 20 mVpp → ≈ 3.9 Vpp ลำโพง ≈ 0.24 W', { timeout: 30000 }, () => {
    const x = runAmp(ampRig({ gain200: true }).doc);
    expect(x.ppSpk / x.ppIn).toBeGreaterThan(190); expect(x.ppSpk / x.ppIn).toBeLessThan(210);
    expect(x.an.parts.U1.extra!.gainTh).toBeCloseTo(200, 0);
    expect(x.an.parts.LS1.extra!.pac).toBeGreaterThan(0.2); expect(x.an.parts.LS1.extra!.pac).toBeLessThan(0.28);
  });
  it('สัญญาณเข้า 60 mVpp ที่อัตราขยาย 200: ขาออกถูกตัดยอด ≈ VS − 1.4 Vpp และลำโพงเกินพิกัด 0.5 W', { timeout: 30000 }, () => {
    const x = runAmp(ampRig({ gain200: true, vpp: 0.06 }).doc);
    expect(x.ppSpk).toBeGreaterThan(7.3); expect(x.ppSpk).toBeLessThan(7.8);
    expect(x.ppSpk / x.ppIn).toBeLessThan(150);
    expect(x.an.diagnostics.some((d) => d.partId === 'LS1' && d.severity === 'danger')).toBe(true);
  });
  it('ลำโพงต่อตรงขาออก (ไม่มีตัวเก็บประจุ) → กระแสตรง ≈ 0.56 A ผ่านลำโพง เตือนทั้งที่ LM386 และลำโพง · ไฟเลี้ยง 15 V เกินพิกัด', { timeout: 30000 }, () => {
    const x = runAmp(ampRig({ noCap: true }).doc);
    expect(x.an.parts.LS1.extra!.idc).toBeGreaterThan(0.5);
    expect(x.an.diagnostics.some((d) => d.partId === 'LS1' && d.message.includes('กระแสตรง'))).toBe(true);
    expect(x.an.diagnostics.some((d) => d.partId === 'U1' && d.message.includes('คัปปลิ้ง'))).toBe(true);
    const y = runAmp(ampRig({ v: 15 }).doc, 0.05);
    expect(y.an.diagnostics.some((d) => d.partId === 'U1' && d.severity === 'danger')).toBe(true);
  });
  it('แลป 39: power/input/output/scope → gain20 → (ใส่ 10 µF) gain200 → (60 mVpp) clip', { timeout: 60000 }, () => {
    const work = { ...emptyWork(), lessonId: 'lm386' };
    const go = (doc: CircuitDoc) => {
      const x = runAmp(doc);
      const st = checkLesson('lm386', { doc, built: x.built, result: x.r.result, analysis: x.an, work, scopeMeasure: x.scope });
      work.achieved.lm386 ??= {};
      for (const [k, v] of Object.entries(st)) if (v.pass) work.achieved.lm386[k] = true;
      return st;
    };
    let st = go(ampRig().doc);
    expect([st.power.pass, st.input.pass, st.output.pass, st.scope.pass, st.gain20.pass]).toEqual([true, true, true, true, true]);
    expect(st.gain200.pass).toBe(false);
    st = go(ampRig({ gain200: true }).doc);
    expect(st.gain200.pass).toBe(true);
    expect(st.clip.pass).toBe(false);
    st = go(ampRig({ gain200: true, vpp: 0.06 }).doc);
    expect(st.clip.pass).toBe(true);
    const bad = checkLesson('lm386', { doc: ampRig({ noCap: true }).doc, built: buildNetlist(ampRig({ noCap: true }).doc), result: runAmp(ampRig({ noCap: true }).doc, 0.05).r.result, analysis: runAmp(ampRig({ noCap: true }).doc, 0.05).an, work: { ...emptyWork(), lessonId: 'lm386' } });
    expect(bad.output.detail).toContain('ตัวเก็บประจุ');
  });
});
