import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { ENCODER_COUNTER_CODE } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { setPartParams } from '../src/editor/ops';
import { emptyWork, type StudentWork } from '../src/model/types';
import { EncoderHub } from '../src/mcu/encoder';
import { tmText } from '../src/mcu/tm1637';
import type { Builder } from './helpers';
import { encoderRig, keypadRig } from './input-rig';

type Cmd = (t: number, b: Builder) => boolean | void;
function runChecked(lab: string, b: Builder, seconds: number, dt: number, cmd?: Cmd, turn?: (t: number) => Record<string, number> | undefined) {
  const work: StudentWork = emptyWork(); work.achieved[lab] = {};
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '', text = '';
  let an!: ReturnType<typeof analyze>;
  let enc: Record<string, { count: number }> | undefined;
  const texts: string[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const ev = turn?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(ev ? { encoder: ev } : {}) });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson(lab, { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved[lab][g] = true;
    text = tmText(r.result.seg?.DS1);
    texts.push(text);
    enc = r.result.enc;
  }
  return { st, ach: work.achieved[lab], con, an, text, texts, enc };
}
const setP = (b: Builder, id: string, p: Record<string, unknown>) => { const x = setPartParams(b.doc, id, p as never); if (x.ok) b.doc = x.doc; return true; };
/** กดปุ่มตามลำดับ: ปุ่มละ 0.2 s กด + 0.2 s ปล่อย เริ่มที่เวลา t0 */
const typing = (keys: string, t0: number): Cmd => (t, b) => {
  const k = Math.round((t - t0) * 10);
  if (k < 0 || k >= keys.length * 4 || k % 2) return;
  return setP(b, 'KP1', { pressed: k % 4 === 0 ? keys[k / 4] : '' });
};

describe('อุปกรณ์อินพุต: ปุ่ม 4×4 / rotary encoder / จอยสติ๊ก', () => {
  it('encoder: ตามเข็ม A ปิดก่อน B · ทวนเข็ม B ก่อน A · นับเมื่อครบคลิก · หน้าสัมผัสเป็นตัวต้านทานลง GND', () => {
    const h = new EncoderHub();
    h.sync([{ id: 'E', clk: 1, dt: 2, gnd: 0, R: 1, detentMs: 12 }]);
    h.turn('E', 1, 0);
    const seq: string[] = [];
    while (isFinite(h.nextEvent())) { h.advance(h.nextEvent()); seq.push(h.key()); }
    expect(seq).toEqual(['Ab', 'AB', 'aB', 'ab']);
    expect(h.snapshot().E.count).toBe(1);
    h.turn('E', -2, 1);
    h.advance(1.0005);
    expect(h.key()).toBe('aB');
    expect(h.elements()).toEqual([{ type: 'R', id: 'E#b', role: 'button', a: 2, b: 0, R: 1 }]);
    h.advance(2);
    expect(h.snapshot().E).toMatchObject({ count: -1, turnsCw: 1, turnsCcw: 2, pending: 0 });
  });

  it('netlist: ปุ่ม 5 = R2–C2 · จอยสติ๊กแบ่งแรงดันตามตำแหน่ง · ระดับการรองรับ · รูปวงจร · บันทึกไฟล์', () => {
    const b = keypadRig({ code: '' });
    setP(b, 'KP1', { pressed: '5' });
    const el = buildNetlist(b.doc).netlist.elements.find((e) => e.id === 'KP1')!;
    expect(el).toMatchObject({ type: 'R', R: 200 });
    expect(supportSummary(SUPPORT.keypad).text).toBe('จำลองครบ');
    expect(supportSummary(SUPPORT.joystick).text).toBe('จำลองครบ');
    expect(supportSummary(SUPPORT.encoder).text).toBe('จำลองครบ');
    for (const [id, n] of [['keypad', 50], ['encoder', 51]] as const) {
      const l = LESSONS.find((x) => x.id === id)!;
      expect(l.number).toBe(n);
      expect(SCHEMATICS[id]).toBeDefined();
    }
    for (const r of [keypadRig(), encoderRig()]) { const errs: string[] = []; expect(validateCircuit(JSON.parse(JSON.stringify(r.doc)), errs, []), errs.join()).not.toBeNull(); }
  });

  it('แลป 50: พิมพ์ 2580# → จอแสดง 2580 แล้ว LED เขียว · * ล้าง · 1111# → LED แดง · ผ่านครบ 4 ข้อ', { timeout: 300000 }, () => {
    const a = typing('2580#', 2), w = typing('*1111#', 5);
    const r = runChecked('keypad', keypadRig(), 8, 0.1, (t, b) => a(t, b) || w(t, b));
    expect(r.con).toMatch(/key: 2\r\nkey: 5\r\nkey: 8\r\nkey: 0\r\nkey: #\r\nOPEN/);
    expect(r.con).toMatch(/key: 1\r\nkey: #\r\nWRONG/);
    expect(r.texts).toContain('2580');
    expect(r.texts).toContain('111-');
    for (const g of ['wire', 'scan', 'open', 'wrong']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(Math.abs(r.an.parts.LEDR.current)).toBeGreaterThan(2e-3);
  });

  it('แลป 50 แก้ข้อผิดพลาด: สลับสายแถว/คอลัมน์ → กด 6 ได้ 8 · ต่อสายไม่ครบ → แจ้ง', { timeout: 300000 }, () => {
    // ปุ่ม 6 = R2 × C3 · สลับสาย: R2 → GP11 (โค้ดถือเป็นคอลัมน์ 2), C3 → GP8 (โค้ดถือเป็นแถว 3) → อ่านได้ปุ่ม 8
    const r = runChecked('keypad', keypadRig({ swapRows: true }), 3, 0.1, typing('6', 2));
    expect(r.con).toContain('key: 8');
    expect(r.con).not.toContain('key: 6');
    const b = keypadRig({ code: '' });
    b.doc = { ...b.doc, wires: b.doc.wires.filter((x) => x.id !== 'wk7') };
    const an = analyze(b.doc, buildNetlist(b.doc), new SimEngine().handle({ seq: 1, netlist: buildNetlist(b.doc).netlist, advance: 0.01, restart: true, watch: [], budgetMs: 1e9 }).result);
    expect(an.diagnostics.some((d) => d.partId === 'KP1' && d.message.includes('7/8'))).toBe(true);
  });

  it('แลป 51: ตามเข็ม 5 → 5 · ทวนเข็ม 2 → 3 · ดันก้านขึ้น → เพิ่มทีละ 10 · กดลูกบิด → 0 · ผ่านครบ 5 ข้อ', { timeout: 300000 }, () => {
    const r = runChecked('encoder', encoderRig(), 6, 0.1, (t, b) => {
      if (Math.abs(t - 3.5) < 1e-6) return setP(b, 'JS1', { y: 1 });
      if (Math.abs(t - 4.0) < 1e-6) return setP(b, 'JS1', { y: 0.5 });
      if (Math.abs(t - 4.8) < 1e-6) return setP(b, 'ENC1', { pressed: true });
      if (Math.abs(t - 5.2) < 1e-6) return setP(b, 'ENC1', { pressed: false });
    }, (t) => (Math.abs(t - 2) < 1e-6 ? { ENC1: 5 } : Math.abs(t - 2.8) < 1e-6 ? { ENC1: -2 } : undefined));
    expect(r.con).toContain('value: 5 ');
    expect(r.con).toContain('value: 3 ');
    expect(r.con).toMatch(/value: 23 .*y: 65\d\d\d/);
    expect(r.con).toMatch(/x: 327\d\d/);
    expect(r.enc?.ENC1.count).toBe(3);
    expect(r.text).toBe('   0');
    for (const g of ['wire', 'cw', 'ccw', 'stick', 'reset']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('แลป 51 แก้ข้อผิดพลาด: ต่อ + ของ encoder กับ VBUS → อันตราย (ดึงขึ้น 5 V เข้าขา Pico) · ไม่มีอินเทอร์รัปต์ → ไม่นับ', { timeout: 300000 }, () => {
    const hv = runChecked('encoder', encoderRig({ encVcc: 'vbus' }), 1, 0.1);
    expect(hv.an.diagnostics.some((d) => d.severity === 'danger' && d.partId === 'ENC1' && d.message.includes('3V3'))).toBe(true);
    const noirq = runChecked('encoder', encoderRig({ code: ENCODER_COUNTER_CODE.replace('clk.irq(trigger=Pin.IRQ_FALLING, handler=on_clk)', 'pass') }), 3, 0.1, undefined, (t) => (Math.abs(t - 2) < 1e-6 ? { ENC1: 4 } : undefined));
    expect(noirq.enc?.ENC1.count).toBe(4);
    expect(noirq.text).toBe('   0');
  });
});
