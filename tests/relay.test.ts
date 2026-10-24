import { describe, expect, it } from 'vitest';
import { analyze } from '../src/instruments/measure';
import { buildNetlist } from '../src/sim/netlist';
import { SimEngine } from '../src/sim/engine';
import { solveDC } from '../src/sim/solver';
import { parseProject, serializeProject } from '../src/storage/storage';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** K1 บนโต๊ะ: + → PS1 +, − → PS1 −, S → (ไฟบวก หรือ กราวด์) · โหลด: รางบวก → 330 Ω → LED → NO, COM → รางลบ; LED2 ที่ NC */
function circuit(sHigh: boolean, vcc = 5) {
  return new Builder()
    .part('dcsupply', onTable(-25, -6), 'PS1', { voltage: vcc, currentLimit: 1 })
    .part('dcsupply', onTable(-25, 6), 'PS2', { voltage: 5, currentLimit: 1 })
    .part('relay', onTable(30, 0), 'K1')
    .part('resistor', onBoard('tp10', 90), 'R1', { resistance: 330, span: 3 }) // → a10
    .part('led', onBoard('c10'), 'LED1') // A c10, K c11
    .part('resistor', onBoard('tp20', 90), 'R2', { resistance: 330, span: 3 }) // → a20
    .part('led', onBoard('c20'), 'LED2') // A c20, K c21
    .wire(P('PS2', 'pos'), H('tp2')).wire(P('PS2', 'neg'), H('tn2'))
    .wire(H('e11'), P('K1', 'NO')).wire(H('e21'), P('K1', 'NC')).wire(P('K1', 'COM'), H('tn26'))
    .wire(P('PS1', 'pos'), P('K1', 'V')).wire(P('PS1', 'neg'), P('K1', 'G'))
    .wire(sHigh ? P('PS1', 'pos') : P('PS1', 'neg'), P('K1', 'S'));
}
function engineRun(docs: CircuitDoc[], dt = 0.02) {
  const e = new SimEngine();
  const out: Array<ReturnType<typeof analyze>> = [];
  docs.forEach((doc, k) => {
    const built = buildNetlist(doc);
    let r = e.handle({ seq: k, netlist: built.netlist, advance: k === 0 ? 0 : 0, restart: k === 0, watch: [], budgetMs: 1e9 });
    r = e.handle({ seq: k + 100, netlist: built.netlist, advance: dt, restart: false, watch: [], budgetMs: 1e9 });
    out.push(analyze(doc, built, r.result));
  });
  return out;
}

describe('โมดูลรีเลย์ 5 V (SRD-05VDC-SL-C)', () => {
  it('S = HIGH: ขดลวด ≈ 5 V/70 Ω, ดึง, COM ต่อ NO (LED1 ติด LED2 ดับ), LED บนโมดูลติด', () => {
    const [a] = engineRun([circuit(true).doc]);
    const k = a.parts['K1'].extra!;
    expect(k.energized).toBe(1);
    expect(k.icoil).toBeGreaterThan(0.06);
    expect(k.icoil).toBeLessThan(0.072);
    expect(k.iled).toBeGreaterThan(1e-3);
    expect(a.parts['LED1'].current).toBeGreaterThan(5e-3);
    expect(Math.abs(a.parts['LED2'].current)).toBeLessThan(1e-6);
  });
  it('S = LOW: ปล่อย, COM ต่อ NC (LED2 ติด LED1 ดับ)', () => {
    const [a] = engineRun([circuit(false).doc]);
    expect(a.parts['K1'].extra!.energized).toBe(0);
    expect(Math.abs(a.parts['LED1'].current)).toBeLessThan(1e-6);
    expect(a.parts['LED2'].current).toBeGreaterThan(5e-3);
  });
  it('ไฟเลี้ยงโมดูล 3.3 V: ขดลวดได้ < 3.75 V ไม่ดึง และเตือนให้ใช้ 5 V (VBUS)', () => {
    const [a] = engineRun([circuit(true, 3.3).doc]);
    expect(a.parts['K1'].extra!.energized).toBe(0);
    expect(a.diagnostics.some((d) => d.partId === 'K1' && d.message.includes('VBUS'))).toBe(true);
  });
  it('hysteresis: ดึงที่ 5 V แล้วลดไฟเลี้ยงเหลือ 3 V ยังดึงอยู่ ลดเหลือ 0.6 V จึงปล่อย; เริ่มที่ 3 V ไม่ดึง', () => {
    const r = engineRun([circuit(true, 5).doc, circuit(true, 3).doc, circuit(true, 0.6).doc]);
    expect(r.map((a) => a.parts['K1'].extra!.energized)).toEqual([1, 1, 0]);
    const fresh = engineRun([circuit(true, 3).doc]);
    expect(fresh[0].parts['K1'].extra!.energized).toBe(0);
  });
  it('ตัด S: ไดโอดบนโมดูลจำกัดแรงดันกระชากที่คอลเลกเตอร์ไม่เกิน + ไฟเลี้ยง + 1 V', () => {
    const on = circuit(true).doc, off = circuit(false).doc;
    const builtOff = buildNetlist(off);
    const cn = builtOff.connectivity.nets.length + 1; // โหนดคอลเลกเตอร์ภายในโมดูล
    const g = builtOff.connectivity.netOf.get('K1:G')!;
    const e = new SimEngine();
    e.handle({ seq: 0, netlist: buildNetlist(on).netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    e.handle({ seq: 1, netlist: buildNetlist(on).netlist, advance: 0.02, restart: false, watch: [], budgetMs: 1e9 });
    const r = e.handle({ seq: 2, netlist: builtOff.netlist, advance: 0.01, restart: false, watch: [{ key: 'vc', kind: 'v', a: cn, b: g }], budgetMs: 1e9, sampleSpacing: 1e-6 });
    const peak = Math.max(...r.samples.map((s) => s.v[0] ?? 0));
    expect(peak).toBeGreaterThan(5.2); // ขดลวดดันกระแสต่อผ่านไดโอด
    expect(peak).toBeLessThan(6.0);
    expect(analyze(off, builtOff, r.result).parts['K1'].extra!.energized).toBe(0);
  });
  it('ไม่มี L ใน DC (solveDC ตรง): ผลสอดคล้อง และบันทึก/เปิดไฟล์ + schema 15', () => {
    const doc = circuit(true).doc;
    const res = solveDC(buildNetlist(doc).netlist);
    expect(res.ok).toBe(true);
    expect(res.relayStates!.K1).toBe(true);
    const v = parseProject(serializeProject('k', doc, emptyWork()));
    expect(v.errors).toEqual([]);
    expect(v.file!.circuit).toEqual(doc);
    const old = JSON.parse(serializeProject('o', new Builder().part('dcsupply', onTable(-25, 0), 'PS1').doc, emptyWork()));
    old.schemaVersion = 15;
    expect(parseProject(JSON.stringify(old)).ok).toBe(true);
  });
});
