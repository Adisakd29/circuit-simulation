import { describe, expect, it } from 'vitest';
import { netOfPin } from '../src/connectivity/connectivity';
import { opampParamsFor } from '../src/model/catalog';
import { buildNetlist } from '../src/sim/netlist';
import { evalOpamp, opampW, solveDC } from '../src/sim/solver';
import { advance, newTranState } from '../src/sim/transient';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * ออปแอมป์ตามเวลา: ขั้วเดียวของวงเปิด (GBW) และ slew rate
 * วงจร: ตามแรงดัน (voltage follower) LM741 ไฟ ±12 V — OUT ต่อกลับ IN−, สัญญาณเข้า IN+
 */
function follower(fg: Record<string, unknown>, model: 'LM741' | 'MCP6002' = 'LM741', supply = 12) {
  const b = new Builder()
    .part('dcsupply', onTable(-25, -10), 'PSP', { voltage: supply })
    .part('dcsupply', onTable(-25, -2), 'PSN', { voltage: supply })
    .part('opamp', onBoard('f10'), 'U1', opampParamsFor(model))
    .part('fgen', onTable(-25, 6), 'FG1', fg)
    .wire(P('PSP', 'pos'), H('a11')).wire(P('PSP', 'neg'), H('bn2'))
    .wire(P('PSN', 'pos'), H('bn3')).wire(P('PSN', 'neg'), H('j13'))
    .wire(H('c12'), H('h11')) // OUT → IN−
    .wire(P('FG1', 'OUT'), H('j12')).wire(P('FG1', 'COM'), H('bn4'));
  const built = buildNetlist(b.doc);
  const c = built.connectivity;
  const out = netOfPin(c, 'U1', 'OUT')!, gnd = netOfPin(c, 'FG1', 'COM')!, inp = netOfPin(c, 'U1', 'IN+')!;
  return { b, nl: built.netlist, out, gnd, inp };
}

/** เดินเวลาแล้วเก็บ (t, vout, vin) */
function trace(f: ReturnType<typeof follower>, tEnd: number, hMax: number) {
  const st = newTranState();
  const s: Array<[number, number, number]> = [];
  const r = advance(f.nl, st, tEnd, { hMax, maxSteps: 200000, onSample: (t, res) => {
    const v = (n: number) => (res.nodeVoltage[n] ?? 0) - (res.nodeVoltage[f.gnd] ?? 0);
    s.push([t, v(f.out), v(f.inp)]);
  } });
  expect(r.ok && r.reached).toBe(true);
  return s;
}
/** เวลาที่สัญญาณข้ามระดับ (ขาขึ้น) ครั้งแรกหลัง t0 — แทรกเชิงเส้น */
function cross(s: Array<[number, number, number]>, level: number, t0: number, k = 1) {
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1][0] < t0) continue;
    if (s[i - 1][k] < level && s[i][k] >= level) return s[i - 1][0] + ((level - s[i - 1][k]) / (s[i][k] - s[i - 1][k])) * (s[i][0] - s[i - 1][0]);
  }
  return NaN;
}

describe('ออปแอมป์: ฟังก์ชันพื้นฐาน', () => {
  const e = { type: 'OPAMP' as const, id: 'U', inp: 0, inn: 1, out: 2, vp: 3, vn: 4, A: 2e5, Rout: 75, headroom: 1.5, Rin: 2e6, Rq: 14e3, gbw: 1e6, sr: 0.5e6 };
  it('ไม่มีสถานะ (DC) = แบบเดิม: w = A·Vd', () => {
    expect(opampW(e, 1e-5, 10.5)).toEqual({ w: 2, dw: 2e5, slewing: false });
  });
  it('ก้าวเล็ก สัญญาณเล็ก: w เปลี่ยนตามขั้ว (BE) และอนุพันธ์ตรงผลต่างจำกัด', () => {
    const dyn = { wn: 0.1, h: 1e-8 };
    const tau = e.A / (2 * Math.PI * e.gbw), k = dyn.h / tau;
    const vd = 2e-6;
    const r = opampW(e, vd, 10.5, dyn);
    const ideal = (dyn.wn + k * e.A * vd) / (1 + k);
    expect(Math.abs(r.w - ideal) / Math.abs(ideal - dyn.wn)).toBeLessThan(0.02); // ยังไม่ถึงขีด slew
    const d = (opampW(e, vd + 1e-9, 10.5, dyn).w - opampW(e, vd - 1e-9, 10.5, dyn).w) / 2e-9;
    expect(Math.abs(r.dw - d) / d).toBeLessThan(1e-5);
  });
  it('Vd ใหญ่: การเปลี่ยนต่อก้าวไม่เกิน SR·h', () => {
    const dyn = { wn: 0, h: 1e-6 };
    const r = opampW(e, 1, 10.5, dyn);
    expect(r.slewing).toBe(true);
    expect(r.w).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(r.w).toBeGreaterThan(0.49);
  });
  it('Jacobian ของ evalOpamp แบบมีสถานะตรงผลต่างจำกัด', () => {
    const dyn = { wn: 2, h: 2e-7 };
    const V = [1e-6, 0, 2, 12, -12];
    const r = evalOpamp(e, V, dyn);
    for (let j = 0; j < 5; j++) {
      const p = V.slice(), m = V.slice(); const hh = j < 2 ? 1e-9 : 1e-6; p[j] += hh; m[j] -= hh;
      const d = (evalOpamp(e, p, dyn).I[2] - evalOpamp(e, m, dyn).I[2]) / (2 * hh);
      expect(Math.abs(r.J[2][j] - d)).toBeLessThan(1e-6 + 1e-4 * Math.abs(d));
    }
  });
});

describe('ออปแอมป์ตามเวลา (วงจรตามแรงดัน LM741 ±12 V)', () => {
  it('slew rate: คลื่นสี่เหลี่ยม ±5 V ขาออกขึ้นเป็นทางลาด 0.5 V/µs (เวลา 10–90% ≈ 16 µs)', () => {
    const f = follower({ wave: 'square', frequency: 5000, vpp: 10 });
    const s = trace(f, 3e-4, 2e-7);
    const t0 = 1e-4; // ขอบขาขึ้นที่ t = 0.2 ms
    const ta = cross(s, -4, t0), tb = cross(s, 4, t0);
    const slope = 8 / (tb - ta);
    expect(Math.abs(slope / 0.5e6 - 1)).toBeLessThan(0.03);
    // ขาเข้าเปลี่ยนทันที ขาออกตามทีหลัง: ที่กลางทางลาด ขาเข้า = +5 แล้ว
    const mid = s.find((x) => x[0] > (ta + tb) / 2)!;
    expect(mid[2]).toBeGreaterThan(4.5);
    // หลังทางลาด ขาออกตามขาเข้าได้ใกล้ +5 V
    const settled = s.find((x) => x[0] > tb + 10e-6)!;
    expect(Math.abs(settled[1] - 5)).toBeLessThan(0.02);
  });
  it('สัญญาณเล็ก (สี่เหลี่ยม 20 mVpp): ไม่ถึงขีด slew — ขึ้นแบบเอกซ์โพเนนเชียล τ = 1/(2π·GBW) ≈ 159 ns', () => {
    const f = follower({ wave: 'square', frequency: 20000, vpp: 0.02 });
    const s = trace(f, 5.5e-5, 5e-9);
    const t0 = 5e-5; // ขอบขาขึ้นที่ t = 50 µs
    // 10–90% ของ −10 → +10 mV
    const ta = cross(s, -0.008, t0), tb = cross(s, 0.008, t0);
    const tau = 1 / (2 * Math.PI * 1e6);
    expect(Math.abs((tb - ta) / (tau * Math.log(9)) - 1)).toBeLessThan(0.05);
  });
  it('full-power bandwidth: ไซน์ 20 Vpp 50 kHz ขาออกถูกจำกัดเป็นสามเหลี่ยม แอมพลิจูดลดลง', () => {
    const f = follower({ wave: 'sine', frequency: 50000, vpp: 20 });
    const s = trace(f, 1e-4, 1e-7).filter((x) => x[0] > 6e-5);
    const vmax = Math.max(...s.map((x) => x[1])), vmin = Math.min(...s.map((x) => x[1]));
    // ความชันสูงสุดที่ต้องการ 2π·50k·10 = 3.1 V/µs ≫ 0.5 V/µs → ทางลาด 0.5 V/µs ครึ่งคาบ 10 µs → ≈ 5 Vpp
    expect(vmax - vmin).toBeLessThan(5.5);
    expect(vmax - vmin).toBeGreaterThan(4);
    let maxSlope = 0;
    for (let i = 1; i < s.length; i++) maxSlope = Math.max(maxSlope, Math.abs((s[i][1] - s[i - 1][1]) / (s[i][0] - s[i - 1][0])));
    expect(maxSlope).toBeLessThan(0.5e6 * 1.05);
  });
  it('ความถี่ต่ำ (1 kHz ไซน์ 2 Vpp): ขาออก = ขาเข้า (ผลของขั้วเล็กมาก)', () => {
    const f = follower({ wave: 'sine', frequency: 1000, vpp: 2 });
    const s = trace(f, 2e-3, 2e-6).filter((x) => x[0] > 1e-3);
    for (const [, vo, vi] of s) expect(Math.abs(vo - vi)).toBeLessThan(0.003);
  });
  it('ผล DC (ไม่มีสถานะ) ไม่เปลี่ยน: ตามแรงดันที่ 3 V', () => {
    const f = follower({ wave: 'dc', frequency: 1000, vpp: 2, offset: 3 });
    const r = solveDC(f.nl);
    expect(Math.abs((r.nodeVoltage[f.out]! - r.nodeVoltage[f.gnd]!) - 3)).toBeLessThan(1e-3);
  });
  it('ไฟล์ schema 9 (ไม่มี GBW/slew) เปิดได้และได้ค่าตามรุ่น', () => {
    const f = follower({ wave: 'sine', frequency: 1000, vpp: 2 }, 'MCP6002', 2.5);
    const raw = JSON.parse(serializeProject('o', f.b.doc, emptyWork()));
    raw.schemaVersion = 9;
    for (const p of raw.circuit.parts) if (p.kind === 'opamp') { delete p.params.gbw; delete p.params.slewRate; }
    const v = parseProject(JSON.stringify(raw));
    expect(v.errors).toEqual([]);
    const u = v.file!.circuit.parts.find((p) => p.kind === 'opamp')!;
    expect((u.params as { gbw: number; slewRate: number }).gbw).toBe(1e6);
    expect((u.params as { gbw: number; slewRate: number }).slewRate).toBe(0.6e6);
  });
});
