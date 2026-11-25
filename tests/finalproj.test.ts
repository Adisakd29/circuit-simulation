import { describe, expect, it } from 'vitest';
import dispHex from './fixtures/uno/unoq-dispenser.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { charLcdText } from '../src/mcu/i2c-sensors';
import { setPartParams } from '../src/editor/ops';
import { validateCircuit } from '../src/model/schema';
import { buildDispenser, bomFromDoc, DISPENSER_CODE, DISPENSER_PINS, FINAL_PROJECTS, wiringList } from '../src/projects/final-projects';
import type { CircuitDoc } from '../src/model/types';
import { SCHEMATICS } from '../src/lessons/schematics';
import { schematicSvg } from '../src/lessons/schematic';

interface Step { t: number; con: string; text: string[]; angle: Record<string, number>; q5v: number; an: ReturnType<typeof analyze> }

/** รันเครื่องจ่ายยาตามลำดับเหตุการณ์ (ฟังก์ชัน act แก้วงจร ณ เวลา t เหมือนผู้ใช้กดปุ่ม/ตั้งค่าในแผง) */
function runDispenser(seconds: number, act: (t: number, doc: CircuitDoc) => CircuitDoc | null, dt = 0.05) {
  let doc = buildDispenser();
  doc = { ...doc, parts: doc.parts.map((p) => (p.id === 'UNOQ1' ? { ...p, params: { ...p.params, hex: dispHex, hexSrc: DISPENSER_CODE } } : p)) } as CircuitDoc;
  const e = new SimEngine();
  let built = buildNetlist(doc);
  let con = '';
  const st: Step[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(4);
    const nd = act(t, doc);
    if (nd) { doc = nd; built = buildNetlist(doc); }
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'UNOQ1')?.console ?? '';
    const an = analyze(doc, built, r.result, r.tones);
    const angle: Record<string, number> = {};
    for (const s of ['SV1', 'SV2', 'SV3', 'SV4']) angle[s] = an.parts[s]?.extra?.angle ?? NaN;
    st.push({ t, con, text: charLcdText(r.result.i2c?.LCD1?.lcd), angle, q5v: Math.abs(r.result.elements['UNOQ1#5V']?.current ?? 0), an });
  }
  return { st, con, doc };
}

const press = (doc: CircuitDoc, id: string, pressed: boolean) => { const r = setPartParams(doc, id, { pressed } as never); if (!r.ok) throw new Error(r.errors.join()); return r.doc; };
const setIr = (doc: CircuitDoc, distance: number) => { const r = setPartParams(doc, 'IR1', { distance } as never); if (!r.ok) throw new Error(r.errors.join()); return r.doc; };
const at = (st: Step[], t: number) => st.find((s) => s.t >= t - 1e-9)!;

describe('โปรเจกต์จบ 1: เครื่องจ่ายยาอัตโนมัติ (UNO Q + เซอร์โว 4 + LCD I²C + IR + บัซเซอร์ + ปุ่ม)', () => {
  it('แม่แบบประกอบจากคำสั่ง editor ได้ครบ · schema ผ่าน · BOM ตรงกับวงจร · ตารางจุดต่อสร้างจากสายจริง', () => {
    const doc = buildDispenser();
    const errs: string[] = [];
    expect(validateCircuit(doc, errs, [])).not.toBeNull();
    expect(errs).toEqual([]);
    const bom = bomFromDoc(doc);
    const count = (k: string) => doc.parts.filter((p) => p.kind === k).length;
    expect([count('unoq'), count('servo'), count('lcd1602'), count('irobstacle'), count('buzzer'), count('arcadebtn'), count('pushbtn16'), count('dcadapter'), count('servohub')]).toEqual([1, 4, 1, 1, 1, 4, 2, 1, 1]);
    expect(Object.values(bom).reduce((a, b) => a + b, 0)).toBe(doc.parts.length);
    const w = wiringList(doc);
    expect(w.length).toBe(doc.wires.length);
    expect(w.some((x) => x.from.startsWith('LCD1 SDA') && x.to.startsWith('UNO Q SDA'))).toBe(true);
    // ขาเซอร์โวผ่านแผ่นกระจายไฟ: S1–S4 ← D9 D10 D11 D6
    DISPENSER_PINS.servo.forEach((pin, k) => expect(w.some((x) => x.from.startsWith(`UNO Q ${pin}`) && x.to.startsWith(`HUB1 S${k + 1}`)), pin).toBe(true));
    const p = FINAL_PROJECTS.find((x) => x.id === 'dispenser')!;
    expect(p.status).toBe('ready');
    expect(p.bom.find((b) => b.item.startsWith('เซอร์โว'))!.qty).toBe(4);
    expect(FINAL_PROJECTS.length).toBe(6);
    const svg = schematicSvg(SCHEMATICS['proj-dispenser'], p.title);
    expect(svg).not.toMatch(/NaN|undefined/);
    for (const s of ['UNO Q', 'SV1', 'SV4', 'BTN1', 'PB2', 'FC-51', 'LCD I²C', '2N3904']) expect(svg, s).toContain(s);
    expect(FINAL_PROJECTS.filter((x) => x.status === 'planned').every((x) => (x.plannedWhy ?? '').length > 20)).toBe(true);
  });

  it('ทำงานสอดคล้องกันทั้งชุด: เริ่มระบบ → กดปุ่มขณะมีถ้วย → เซอร์โวช่องนั้นเปิด/ปิด · ไม่มีถ้วย → ไม่จ่าย · ปุ่มแสดงจำนวน · ไฟเซอร์โวมาจากอะแดปเตอร์', { timeout: 240000 }, () => {
    const { st, con } = runDispenser(7.2, (t, doc) => {
      if (Math.abs(t - 1.5) < 1e-6) return press(doc, 'BTN2', true);
      if (Math.abs(t - 1.7) < 1e-6) return press(doc, 'BTN2', false);
      if (Math.abs(t - 4.0) < 1e-6) return setIr(doc, 50);
      if (Math.abs(t - 4.2) < 1e-6) return press(doc, 'BTN4', true);
      if (Math.abs(t - 4.4) < 1e-6) return press(doc, 'BTN4', false);
      if (Math.abs(t - 6.0) < 1e-6) return press(doc, 'PB1', true);
      if (Math.abs(t - 6.2) < 1e-6) return press(doc, 'PB1', false);
      return null;
    });
    // เริ่มระบบ: จอแสดงข้อความจากโค้ด · เซอร์โวทั้ง 4 ไปที่ write(0) = พัลส์ 544 µs (ไลบรารี Servo) ≈ 4° ของ SG90 (0.5–2.4 ms)
    const boot = at(st, 1.4);
    expect(boot.text[0]).toContain('Medicine Box');
    expect(boot.text[1]).toContain('Ready');
    for (const s of ['SV1', 'SV2', 'SV3', 'SV4']) expect(boot.angle[s], s).toBeLessThan(6);
    expect(boot.con).toContain('READY');
    // กดปุ่ม 2 (มีถ้วย): SV2 หมุนไป 90° ช่องอื่นนิ่ง · จอ + Serial ตรงกัน
    const open = at(st, 2.2);
    expect(open.angle.SV2).toBeGreaterThan(85);
    for (const s of ['SV1', 'SV3', 'SV4']) expect(open.angle[s], s).toBeLessThan(6);
    expect(open.text[0]).toContain('Slot 2: OPEN');
    expect(open.con).toContain('DISPENSE 2');
    // ขณะเซอร์โวหมุน: กระแสมอเตอร์ไหลจากอะแดปเตอร์ (ไม่ใช่ขา 5V ของ UNO Q) · บัซเซอร์มีกระแสช่วง beep
    const moving = st.filter((s) => s.t > 1.5 && s.t < 3.0);
    const adpMax = Math.max(...moving.map((s) => Math.abs(s.an.parts.ADP1?.current ?? 0)));
    expect(adpMax).toBeGreaterThan(0.15);
    const q5v = Math.max(...moving.map((s) => s.q5v));
    expect(q5v).toBeLessThan(0.15);
    const bz = Math.max(...moving.map((s) => Math.abs(s.an.parts.BZ1?.current ?? 0)));
    expect(bz).toBeGreaterThan(0.015);
    // ปิดหลัง 1 s
    const closed = at(st, 3.6);
    expect(closed.angle.SV2).toBeLessThan(6);
    expect(closed.text[0]).toContain('Slot 2: CLOSED');
    expect(closed.text[1]).toContain('total 1');
    // ไม่มีถ้วย (IR 50 cm) + กดปุ่ม 4 → ไม่จ่าย จอเตือน
    const nocup = at(st, 5.0);
    expect(nocup.text[0]).toContain('No cup!');
    expect(nocup.con).toContain('NO CUP 4');
    expect(Math.max(...st.filter((s) => s.t > 4.2).map((s) => s.angle.SV4))).toBeLessThan(6);
    // ปุ่มแสดงจำนวน
    const cnt = at(st, 7.0);
    expect(cnt.text[0]).toContain('Count 1 2 3 4');
    expect(cnt.text[1]).toContain('0 1 0 0');
    expect(con).toContain('COUNT 0 1 0 0');
    // ตลอดการทำงาน: ไม่มีคำเตือนอันตราย
    const dangers = new Set(st.flatMap((s) => s.an.diagnostics.filter((d) => d.severity === 'danger').map((d) => d.message)));
    expect([...dangers]).toEqual([]);
  });

  it('ต่อผิดที่พบบ่อย: GND ของแผ่นกระจายไฟไม่ต่อกับบอร์ด → อันตราย (GND ไม่ร่วม) · เซอร์โวใช้ไฟจากขา 5V ของบอร์ด → เตือน', () => {
    const doc = buildDispenser();
    const noCommon = { ...doc, wires: doc.wires.filter((w) => w.id !== 'wcom') };
    const built = buildNetlist(noCommon);
    const e = new SimEngine();
    const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0.05, restart: true, watch: [], budgetMs: 1e9 });
    const an = analyze(noCommon, built, r.result, r.tones);
    expect(an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('GND ของเซอร์โวไม่ได้ต่อร่วม'))).toBe(true);
    // ย้ายไฟเซอร์โวไปขา 5V ของ UNO Q (ถอดอะแดปเตอร์ออกจากแผ่นกระจายไฟ)
    const onBoard5v = { ...doc, wires: [...doc.wires.filter((w) => w.id !== 'wadp'), { id: 'w5vhub', a: { kind: 'pin', partId: 'UNOQ1', pin: '5V' }, b: { kind: 'pin', partId: 'HUB1', pin: 'V+' }, color: '#e53935' }] } as CircuitDoc;
    const b2 = buildNetlist(onBoard5v);
    const r2 = new SimEngine().handle({ seq: 1, netlist: b2.netlist, advance: 0.05, restart: true, watch: [], budgetMs: 1e9 });
    const an2 = analyze(onBoard5v, b2, r2.result, r2.tones);
    expect(an2.diagnostics.some((d) => d.severity === 'warn' && d.message.includes('เซอร์โว 4 ตัว'))).toBe(true);
  });
});
