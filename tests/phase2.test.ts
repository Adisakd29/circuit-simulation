import { describe, expect, it } from 'vitest';
import { analyze } from '../src/instruments/measure';
import { DataLogger } from '../src/instruments/logger';
import { checkLesson, measuredTau } from '../src/lessons/checks';
import { validateProjectFile } from '../src/model/schema';
import { SCHEMA_VERSION, emptyWork } from '../src/model/types';
import { parseSI } from '../src/model/units';
import { SimEngine, type WatchItem } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { serializeProject } from '../src/storage/storage';
import { computeConnectivity, netOfTerminal } from '../src/connectivity/connectivity';
import { Builder, H, P, onBoard, onTable } from './helpers';

const rc = (R = 10000, C = 100e-6) => new Builder()
  .part('dcsupply', onTable(-25, 0), 'PS1')
  .part('resistor', onBoard('a5'), 'R1', { resistance: R })      // a5–a9
  .part('capacitor', onBoard('b9'), 'C1', { capacitance: C })     // + b9, − b11
  .wire(P('PS1', 'pos'), H('c5')).wire(H('c11'), P('PS1', 'neg'))
  .probe(H('d9'), H('d11'));

/** จำลองแบบเดียวกับแอป: engine + logger ทีละ tick */
function runLikeApp(b: Builder, seconds: number, tick = 0.05) {
  const built = buildNetlist(b.doc);
  const c = computeConnectivity(b.doc);
  const watch: WatchItem[] = [{ key: 'probe', kind: 'v', a: netOfTerminal(c, b.doc.probes.red!), b: netOfTerminal(c, b.doc.probes.black!) }];
  const engine = new SimEngine();
  const logger = new DataLogger();
  logger.setChannels([{ key: 'probe', label: 'V', unit: 'V', color: '#000' }], watch);
  let res = engine.handle({ seq: 1, netlist: built.netlist, advance: 0, restart: true, watch, budgetMs: 1e9 });
  logger.reset(true);
  logger.push(res.samples);
  for (let t = 0; t < seconds - 1e-9; t += tick) {
    res = engine.handle({ seq: 2, netlist: built.netlist, advance: tick, restart: false, watch, budgetMs: 1e9 });
    logger.push(res.samples);
  }
  const analysis = analyze(b.doc, built, res.result);
  return { built, res, logger, analysis };
}

describe('engine + logger: วัด τ จากกราฟเหมือนในแอป', () => {
  it('RC 10 kΩ × 100 µF: τ จากกราฟ ≈ 1.000 s (±1%)', () => {
    const { logger, res } = runLikeApp(rc(), 1.5);
    expect(res.mode).toBe('tran');
    const tau = measuredTau(logger, 5)!;
    expect(Math.abs(tau - 10000.01 * 100e-6) / 1.0).toBeLessThan(0.01);
  });

  it('แลป 6 ผ่านทุกเป้าหมายบังคับเมื่อรอครบ 5τ', () => {
    const b = rc(1000, 100e-6); // τ = 0.1 s
    const { built, res, logger, analysis } = runLikeApp(b, 0.6);
    const r = checkLesson('rc', { doc: b.doc, built, result: res.result, analysis, work: emptyWork(), logger, time: res.t });
    expect(r.series.pass).toBe(true);
    expect(r.tau.pass).toBe(true);
    expect(r.full.pass).toBe(true);
  });

  it('โพรบไม่คร่อมตัวเก็บประจุ → ไม่ผ่าน', () => {
    const b = rc(1000, 100e-6).probe(H('d5'), H('d11'));
    const { built, res, logger, analysis } = runLikeApp(b, 0.2);
    const r = checkLesson('rc', { doc: b.doc, built, result: res.result, analysis, work: emptyWork(), logger, time: res.t });
    expect(r.series.pass).toBe(false);
  });

  it('ตัวเก็บประจุอิเล็กโทรไลต์กลับขั้ว → เตือนอันตราย', () => {
    const b = new Builder()
      .part('dcsupply', onTable(-25, 0), 'PS1')
      .part('resistor', onBoard('a5'), 'R1', { resistance: 100 })
      .part('capacitor', onBoard('b11', 180), 'C1', { capacitance: 10e-6 }) // + b11, − b9
      .wire(P('PS1', 'pos'), H('c5')).wire(H('c11'), P('PS1', 'neg'))
      .probe(H('d9'), H('d11'));
    const { analysis } = runLikeApp(b, 0.05);
    expect(analysis.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('กลับขั้ว'))).toBe(true);
  });

  it('วงจรไม่มี C/L ยังใช้โหมด DC', () => {
    const b = new Builder().part('dcsupply', onTable(-25, 0), 'PS1').part('resistor', onBoard('a5'), 'R1')
      .wire(P('PS1', 'pos'), H('b5')).wire(H('b9'), P('PS1', 'neg'));
    const res = new SimEngine().handle({ seq: 1, netlist: buildNetlist(b.doc).netlist, advance: 0.05, restart: true, watch: [], budgetMs: 100 });
    expect(res.mode).toBe('dc');
  });
});

describe('ไฟล์ schema รุ่น 2', () => {
  it('อ่านไฟล์รุ่น 1 ได้ และบันทึก/เปิดวงจรที่มีตัวเก็บประจุ/ตัวเหนี่ยวนำ', () => {
    const v1 = JSON.parse(serializeProject('x', new Builder().part('resistor', onBoard('a5'), 'R1').doc, emptyWork()));
    v1.schemaVersion = 1;
    expect(validateProjectFile(v1).ok).toBe(true);
    const doc = rc().part('inductor', onBoard('f10'), 'L1').doc;
    const v = validateProjectFile(JSON.parse(serializeProject('x', doc, emptyWork())));
    expect(v.ok).toBe(true);
    expect(v.file!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(v.file!.circuit).toEqual(doc);
  });
  it('ปฏิเสธค่าความจุติดลบ', () => {
    const f = JSON.parse(serializeProject('x', rc().doc, emptyWork()));
    f.circuit.parts.find((p: { kind: string }) => p.kind === 'capacitor').params.capacitance = -1;
    expect(validateProjectFile(f).ok).toBe(false);
  });
});

describe('การอ่านค่าหน่วย', () => {
  it('รับ 100u, 100uF, 4.7k, 10mH, 1M', () => {
    expect(parseSI('100u')).toBeCloseTo(100e-6, 12);
    expect(parseSI('100uF')).toBeCloseTo(100e-6, 12);
    expect(parseSI('4.7k')).toBe(4700);
    expect(parseSI('10mH')).toBeCloseTo(0.01, 12);
    expect(parseSI('1M')).toBe(1e6);
    expect(parseSI('abc')).toBeNull();
  });
});
