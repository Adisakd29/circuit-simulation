import { describe, expect, it } from 'vitest';
import waterHex from './fixtures/uno/unoq-watering.hex?raw';
import motorHex from './fixtures/uno/unoq-motor.hex?raw';
import dispHex from './fixtures/uno/unoq-dispenser.hex?raw';
import appDisp from '../src/projects/dispenser.hex?raw';
import appWater from '../src/projects/watering.hex?raw';
import appMotor from '../src/projects/motor.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { charLcdText } from '../src/mcu/i2c-sensors';
import { setPartParams } from '../src/editor/ops';
import { validateCircuit } from '../src/model/schema';
import { buildMotor, buildWatering, bomFromDoc, FINAL_PROJECTS, MOTOR_CODE, MOTOR_PINS, WATERING_CODE, WATERING_PINS, wiringList } from '../src/projects/final-projects';
import type { CircuitDoc } from '../src/model/types';
import { SCHEMATICS } from '../src/lessons/schematics';
import { schematicSvg } from '../src/lessons/schematic';

/**
 * โปรเจกต์จบ 2 (ระบบรดน้ำต้นไม้) และ 5 (ระบบควบคุมมอเตอร์) บน UNO Q — โค้ดคอมไพล์จริง (tests/fixtures/uno/gen.ts) รันร่วมกับวงจรทั้งชุด
 * เหตุการณ์ (กดปุ่ม/หมุน VR/ถอดปลั๊ก) แก้พารามิเตอร์ของวงจร ณ เวลาที่กำหนด เหมือนผู้ใช้ทำในแผงคุณสมบัติ
 */
interface Step { t: number; con: string; text: string[]; an: ReturnType<typeof analyze>; usb5v: number }

function run(doc0: CircuitDoc, hex: string, src: string, seconds: number, events: Record<string, Record<string, object>>, dt = 0.05) {
  let doc = { ...doc0, parts: doc0.parts.map((p) => (p.id === 'UNOQ1' ? { ...p, params: { ...p.params, hex, hexSrc: src } } : p)) } as CircuitDoc;
  const e = new SimEngine();
  let built = buildNetlist(doc);
  let con = '';
  const st: Step[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(4);
    const ev = events[t.toFixed(2)];
    if (ev) {
      for (const [id, v] of Object.entries(ev)) { const r = setPartParams(doc, id, v as never); if (!r.ok) throw new Error(r.errors.join()); doc = r.doc; }
      built = buildNetlist(doc);
    }
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'UNOQ1')?.console ?? '';
    st.push({ t, con, text: charLcdText(r.result.i2c?.LCD1?.lcd), an: analyze(doc, built, r.result, r.tones), usb5v: Math.abs(r.result.elements['UNOQ1#5V']?.current ?? 0) });
  }
  return st;
}
const at = (st: Step[], t: number) => st.find((s) => s.t >= t - 1e-9)!;
const extra = (s: Step, id: string, k: string) => s.an.parts[id]?.extra?.[k] ?? NaN;
const cur = (s: Step, id: string) => Math.abs(s.an.parts[id]?.current ?? 0);
const dangers = (st: Step[]) => st.flatMap((s) => s.an.diagnostics.filter((d) => d.severity === 'danger').map((d) => d.message));

describe('โปรเจกต์จบ 2 และ 5: โครงสร้างแม่แบบ', () => {
  it('ประกอบจากคำสั่ง editor ได้ · schema ผ่าน · BOM/ตารางจุดต่อ/รูปวงจรตรงกับวงจร · โปรแกรมที่ฝังในแอปตรงกับที่คอมไพล์ในเทสต์', () => {
    const count = (d: CircuitDoc, k: string) => d.parts.filter((p) => p.kind === k).length;
    const w = buildWatering(), m = buildMotor();
    for (const d of [w, m]) {
      const errs: string[] = [];
      expect(validateCircuit(JSON.parse(JSON.stringify(d)), errs, [])).not.toBeNull();
      expect(errs).toEqual([]);
      expect(Object.values(bomFromDoc(d)).reduce((a, b) => a + b, 0)).toBe(d.parts.length);
      expect(wiringList(d).length).toBe(d.wires.length);
    }
    expect(['unoq', 'soilsensor', 'relay', 'pump', 'dcadapter', 'lcd1602', 'pushbtn16'].map((k) => count(w, k))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(w.parts.find((p) => p.kind === 'pump')!.params).toMatchObject({ target: 'SOIL1' });
    expect(['unoq', 'hbridge', 'motor', 'stepper', 'potentiometer', 'pushbtn16', 'dcadapter', 'lcd1602'].map((k) => count(m, k))).toEqual([1, 1, 1, 1, 1, 2, 1, 1]);
    const ww = wiringList(w), mw = wiringList(m);
    expect(ww.some((x) => x.from.startsWith('SOIL1 AOUT') && x.to.startsWith(`UNO Q ${WATERING_PINS.soil}`))).toBe(true);
    expect(ww.some((x) => x.from.startsWith('RLY1 S') && x.to.startsWith(`UNO Q ${WATERING_PINS.relay}`))).toBe(true);
    MOTOR_PINS.coils.forEach((pin, k) => expect(mw.some((x) => x.from.startsWith(`UNO Q ${pin}`) && x.to.startsWith(`ST1 IN${k + 1}`)), pin).toBe(true));
    for (const [id, labels] of [['watering', ['UNO Q', 'SOIL1', 'ADP1', 'PMP1', 'PB1', 'LCD I²C', 'โมดูลรีเลย์']], ['motor', ['UNO Q', 'L293D', 'ULN2003', 'M1', 'VR1', 'PB1', 'PB2', 'ADP1', 'LCD I²C']]] as const) {
      const p = FINAL_PROJECTS.find((x) => x.id === id)!;
      expect(p.status).toBe('ready');
      expect(p.code && p.build && p.bom.length > 5 && p.limits.length > 3 && p.tests.length === 2).toBeTruthy();
      const svg = schematicSvg(SCHEMATICS[`proj-${id}`], p.title);
      expect(svg).not.toMatch(/NaN|undefined/);
      for (const s of labels) expect(svg, `${id}: ${s}`).toContain(s);
    }
    expect(FINAL_PROJECTS.find((x) => x.id === 'watering')!.code).toBe(WATERING_CODE);
    expect(FINAL_PROJECTS.find((x) => x.id === 'motor')!.code).toBe(MOTOR_CODE);
    // โปรแกรมที่ฝังในแอป (เปิดแม่แบบแล้วรันได้ทันที) ต้องเป็นไฟล์เดียวกับที่เทสต์ใช้ — ป้องกันโค้ดกับ .hex ไม่ตรงกัน
    expect(appDisp).toBe(dispHex);
    expect(appWater).toBe(waterHex);
    expect(appMotor).toBe(motorHex);
    expect(FINAL_PROJECTS.filter((x) => x.status === 'planned').map((x) => x.number)).toEqual([3, 4, 6]);
  });
});

describe('โปรเจกต์จบ 2: ระบบรดน้ำต้นไม้อัตโนมัติ (UNO Q + เซนเซอร์ความชื้นดิน + รีเลย์ + ปั๊ม + LCD)', () => {
  it('ดินแห้ง 25% → ปั๊มทำงาน (ไฟจากอะแดปเตอร์) จนถึง 60% แล้วหยุดเอง · ดินแห้งลงอีก → รดน้ำซ้ำเอง · จอ/Serial ตามโค้ด', { timeout: 300000 }, () => {
    const st = run(buildWatering(), waterHex, WATERING_CODE, 12, { '6.00': { SOIL1: { dryRate: 6 } } });
    const pumping = at(st, 2.0);
    console.log('W', pumping.text, cur(pumping, 'PMP1'), cur(pumping, 'ADP1'), pumping.usb5v, extra(pumping, 'SOIL1', 'moisture'), extra(pumping, 'PMP1', 'flow'));
    expect(pumping.text[1]).toContain('Watering (auto)');
    expect(cur(pumping, 'PMP1')).toBeGreaterThan(0.12);
    expect(cur(pumping, 'ADP1')).toBeGreaterThan(0.12);
    expect(pumping.usb5v).toBeLessThan(0.15); // ขา 5V ของบอร์ดจ่ายแค่ขดลวดรีเลย์ + LCD ไม่ใช่ปั๊ม
    const stop = st.find((s) => s.t > 2 && cur(s, 'PMP1') < 1e-3)!;
    console.log('W stop', stop.t, extra(stop, 'SOIL1', 'moisture'), stop.text);
    expect(stop.t).toBeLessThan(6);
    expect(extra(stop, 'SOIL1', 'moisture')).toBeGreaterThanOrEqual(59);
    const idle = at(st, 5.8);
    expect(idle.text[1]).toContain('Idle');
    expect(idle.text[0]).toMatch(/Soil\s+(59|6\d)%/);
    // หลังเพิ่มอัตราดินแห้ง: ต่ำกว่า 30% → เปิดปั๊มอีกครั้ง
    const again = st.find((s) => s.t > 6 && cur(s, 'PMP1') > 0.1)!;
    console.log('W again', again?.t, again && extra(again, 'SOIL1', 'moisture'));
    expect(again).toBeTruthy();
    const con = st[st.length - 1].con;
    expect(con).toContain('READY');
    expect(con.match(/PUMP ON dry/g)?.length).toBe(2);
    expect(con).toContain('PUMP OFF wet');
    expect(dangers(st)).toEqual([]);
  });

  it('ถอดปลั๊กอะแดปเตอร์ (น้ำไม่ไหล) → 15 วินาทีแล้วหยุดปั๊ม "CHECK WATER!" · เสียบกลับ + กดปุ่ม → รดน้ำต่อ · ปุ่มเมื่อว่าง = รดน้ำเอง 3 วินาที', { timeout: 300000 }, () => {
    const st = run(buildWatering(), waterHex, WATERING_CODE, 27, {
      '0.05': { ADP1: { plugged: false } },
      '17.00': { ADP1: { plugged: true } }, '17.50': { PB1: { pressed: true } }, '17.70': { PB1: { pressed: false } },
      '24.00': { PB1: { pressed: true } }, '24.20': { PB1: { pressed: false } },
    });
    const dry = at(st, 10);
    expect(cur(dry, 'PMP1')).toBeLessThan(1e-3); // รีเลย์ดึงแต่ไม่มีไฟปั๊ม
    expect(dry.text[1]).toContain('Watering (auto)');
    expect(extra(dry, 'SOIL1', 'moisture')).toBeLessThan(25);
    const fault = at(st, 16.5);
    console.log('F', fault.text, fault.con.slice(-80));
    expect(fault.text[1]).toContain('CHECK WATER!');
    expect(fault.con).toContain('PUMP OFF timeout');
    const tf = st.find((s) => s.con.includes('PUMP OFF timeout'))!.t;
    expect(tf).toBeGreaterThan(15); expect(tf).toBeLessThan(16.2);
    const back = at(st, 19.5);
    expect(back.con).toContain('PUMP OFF reset');
    expect(cur(back, 'PMP1')).toBeGreaterThan(0.12);
    const full = st.find((s) => s.t > 18 && s.con.split('PUMP OFF wet').length === 2)!;
    expect(full.t).toBeLessThan(24);
    const manual = at(st, 25.5);
    console.log('M', manual.text, cur(manual, 'PMP1'), manual.con.slice(-60));
    expect(manual.text[1]).toContain('Watering (btn)');
    expect(cur(manual, 'PMP1')).toBeGreaterThan(0.12);
    expect(st[st.length - 1].con).toContain('PUMP OFF manual done');
    expect(dangers(st)).toEqual([]);
  });
});

describe('โปรเจกต์จบ 5: ระบบควบคุมมอเตอร์ (UNO Q + L293D + มอเตอร์ TT + 28BYJ-48/ULN2003 + VR + LCD)', () => {
  it('VR 75% → เดินหน้า · ปุ่มกลับทิศ → ถอยหลัง · VR 0 → หยุด · ปุ่มสเต็ปเปอร์ → หมุน 90° แล้วปล่อยขดลวด · ไฟมอเตอร์จากอะแดปเตอร์', { timeout: 600000 }, () => {
    const st = run(buildMotor(), motorHex, MOTOR_CODE, 5.8, {
      '1.20': { PB1: { pressed: true } }, '1.40': { PB1: { pressed: false } },
      '2.20': { VR1: { position: 0 } },
      '2.40': { PB2: { pressed: true } }, '2.60': { PB2: { pressed: false } },
    });
    const fwd = at(st, 1.1);
    console.log('FWD', fwd.text, extra(fwd, 'M1', 'rpm'), cur(fwd, 'M1'), fwd.an.parts.M1?.voltage, cur(fwd, 'ADP1'), fwd.usb5v);
    expect(fwd.text[0]).toContain('DC  74% FWD');
    expect(extra(fwd, 'M1', 'rpm')).toBeGreaterThan(50);
    expect(cur(fwd, 'ADP1')).toBeGreaterThan(0.1);
    expect(fwd.usb5v).toBeLessThan(0.1);
    const rev = at(st, 2.15);
    console.log('REV', rev.text, extra(rev, 'M1', 'rpm'));
    expect(rev.text[0]).toContain('REV');
    expect(extra(rev, 'M1', 'rpm')).toBeLessThan(-50);
    expect(rev.con).toContain('DIR REV');
    const stopped = at(st, 2.6);
    console.log('STOP', stopped.text, extra(stopped, 'M1', 'rpm'));
    expect(stopped.text[0]).toContain('DC   0%');
    expect(Math.abs(extra(stopped, 'M1', 'rpm'))).toBeLessThan(5);
    // ระหว่างอัปเดตจอ I²C (ทุก 250 ms) ลูปไม่ได้เดินสเต็ป → อัตราจริงต่ำกว่า 500 ครึ่งสเต็ป/วินาที (เหมือนบอร์ดจริง): 90° ใช้ ≈ 2.8 วินาที
    const tDone = st.find((s) => s.con.includes('STEP DONE'))!.t;
    console.log('STEP DONE at', tDone);
    expect(tDone).toBeGreaterThan(4.4); expect(tDone).toBeLessThan(5.7);
    const end = st[st.length - 1];
    console.log('END', end.text, extra(end, 'ST1', 'angle'), extra(end, 'ST1', 'mask'), extra(end, 'ST1', 'missed'), end.con.slice(-60));
    expect(Math.abs(extra(end, 'ST1', 'angle') - 90)).toBeLessThan(0.5);
    expect(extra(end, 'ST1', 'missed')).toBe(0);
    expect(extra(end, 'ST1', 'mask')).toBe(0);
    expect(end.con).toContain('STEP DONE 90');
    expect(end.text[1]).toContain('Step  90 deg');
    expect(dangers(st)).toEqual([]);
  });
});
