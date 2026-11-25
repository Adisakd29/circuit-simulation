import { describe, expect, it } from 'vitest';
import blinkHex from './fixtures/uno/blink.hex?raw';
import pwmHex from './fixtures/uno/pwm.hex?raw';
import adcHex from './fixtures/uno/adc.hex?raw';
import blink9Hex from './fixtures/uno/blink9.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { emptyWork } from '../src/model/types';
import { parseIntelHex } from '../src/mcu/avr-emu';
import { UNO_DEFAULT_CODE } from '../src/model/catalog';
import { validateCircuit } from '../src/model/schema';
import { H, P, onBoard } from './helpers';
import { runUno, unoRig } from './uno-rig';

const enc = (s: string) => [...new TextEncoder().encode(s)];

describe('Arduino Uno R3 (avr8js) ร่วมกับวงจร', () => {
  it('อ่าน Intel HEX ถูกต้อง (เวกเตอร์ reset = jmp)', () => {
    const f = parseIntelHex(blinkHex);
    expect(f[0]).toBe(0x940c); // jmp
    expect(f.length).toBe(0x4000);
  });

  it('Blink: LED จริงบนเบรดบอร์ดสลับ ~12.5 mA / 0 ทุก 0.5 s และ Serial พิมพ์ LED ON/OFF', { timeout: 30000 }, () => {
    const r = runUno(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }), 2.5, 0.05);
    const on = r.st.filter((s) => s.led > 0.01), off = r.st.filter((s) => s.led < 1e-5);
    expect(on.length).toBeGreaterThan(15);
    expect(off.length).toBeGreaterThan(15);
    const iOn = Math.max(...r.st.map((s) => s.led));
    expect(iOn).toBeGreaterThan(0.0115);
    expect(iOn).toBeLessThan(0.0135);
    // จำนวนครั้งที่ LED ติดขึ้น ≈ 2.5 s / 1 s
    let rises = 0;
    for (let i = 1; i < r.st.length; i++) if (r.st[i].led > 0.01 && r.st[i - 1].led < 0.005) rises++;
    expect(rises).toBeGreaterThanOrEqual(2);
    expect(rises).toBeLessThanOrEqual(3);
    expect(r.con.match(/LED ON/g)?.length).toBe(3);
    expect(r.con.match(/LED OFF/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('ไม่มีโปรแกรม: ขาเป็นอินพุต LED ไม่ติด ไม่มีข้อความ', () => {
    const r = runUno(unoRig({ hex: null }), 0.5, 0.05);
    expect(Math.max(...r.st.map((s) => s.led))).toBeLessThan(1e-6);
    expect(r.con).toBe('');
  });

  it('PWM: analogWrite(9, 64) → กระแสเฉลี่ย ≈ 25% ของตอนติดเต็ม · D13 = HIGH', () => {
    const r = runUno(unoRig({ hex: pwmHex, code: 'x', pin: 'D9' }), 0.4, 0.05);
    const full = runUno(unoRig({ hex: pwmHex, code: 'x', pin: 'D13' }), 0.2, 0.05);
    const iFull = full.st.at(-1)!.led, iPwm = r.st.at(-1)!.led;
    expect(iFull).toBeGreaterThan(0.011);
    expect(iPwm / iFull).toBeGreaterThan(0.2);
    expect(iPwm / iFull).toBeLessThan(0.3);
    expect(full.st.at(-1)!.pins[13]).toBe('out-high');
  });

  it('ADC: โพเทนชิโอมิเตอร์ 0–5 V ที่ A0 → analogRead ≈ 1023·V/5 · INPUT_PULLUP · Serial รับข้อความ', () => {
    const rig = (pos: number, d2gnd: boolean) => {
      const b = unoRig({ hex: adcHex, code: 'x' }).part('potentiometer', onBoard('j22'), 'VR1', { resistance: 10000, position: pos })
        .wire(P('UNO1', 'GND.2'), H('f22'), 'wg', '#212121').wire(P('UNO1', '5V'), H('f24'), 'wv').wire(P('UNO1', 'A0'), H('f23'), 'wa', '#fdd835');
      if (d2gnd) b.wire(P('UNO1', 'D2'), H('j30'), 'wb').wire(H('f30'), H('tn20'), 'wbg', '#212121');
      return b;
    };
    const vals = (con: string) => [...con.matchAll(/A0=(\d+)/g)].map((m) => Number(m[1]));
    const half = runUno(rig(0.5, false), 0.6, 0.05, undefined, (k) => (k === 6 ? { UNO1: { serial: enc('hi\n') } } : undefined));
    const v = vals(half.con);
    expect(v.length).toBeGreaterThanOrEqual(5);
    expect(Math.abs(v.at(-1)! - 512)).toBeLessThan(12);
    expect(half.con).toContain('hi<ok>');
    expect(half.st.at(-1)!.pins[13]).toBe('out-low'); // D2 ลอย + pull-up → HIGH → LED ดับ
    const q = runUno(rig(0.25, true), 0.4, 0.05);
    expect(Math.abs(vals(q.con).at(-1)! - 256)).toBeLessThan(12);
    expect(q.st.at(-1)!.pins[2]).toBe('in-pullup');
    expect(q.st.at(-1)!.pins[13]).toBe('out-high'); // D2 ต่อ GND → LOW → LED ติด
  });

  it('คำสั่ง reset เริ่มโปรแกรมใหม่ (พิมพ์ LED ON ทันทีหลังรีเซ็ต)', () => {
    const r = runUno(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }), 1.0, 0.05, undefined, (k) => (k === 12 ? { UNO1: { reset: true } } : undefined));
    // รอบแรก: ON ที่ 0 s, OFF ที่ 0.5 s · รีเซ็ตที่ 0.6 s → ON อีกครั้ง (ไม่ต้องรอถึง 1.0 s)
    expect(r.con.match(/LED ON/g)?.length).toBe(2);
    expect(r.st[13].led).toBeGreaterThan(0.01);
  });

  it('อัปโหลดโปรแกรมใหม่ระหว่างจำลอง (เปลี่ยน params.hex) → โหลดใหม่ เวลาไม่ย้อน', () => {
    const b = unoRig({ hex: null });
    const e = new SimEngine();
    const u = b.doc.parts.find((p) => p.id === 'UNO1')!;
    let con = '', led = 0;
    for (let k = 0; k < 16; k++) {
      if (k === 6) (u.params as { hex: string | null }).hex = blinkHex;
      const built = buildNetlist(b.doc);
      const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
      con += r.mcu?.find((m) => m.id === 'UNO1')?.console ?? '';
      led = analyze(b.doc, built, r.result, r.tones).parts.LED1?.current ?? 0;
      if (k === 5) { expect(con).toBe(''); expect(led).toBeLessThan(1e-6); }
    }
    expect(con).toContain('LED ON');
    expect(led).toBeGreaterThan(0.01);
  });

  it('เอกสารที่มีโปรแกรม (.hex) ผ่าน validate · ตัวตรวจแลป 43 ผ่าน led/upload/blink · PWM ที่ขา 9 ผ่าน pwm · แก้โค้ดแล้วไม่อัปโหลด → upload ไม่ผ่าน', { timeout: 60000 }, () => {
    expect(LESSONS.find((l) => l.id === 'uno')?.number).toBe(43);
    const run = (b: ReturnType<typeof unoRig>, steps: number, dt = 0.05) => {
      const errs: string[] = [], warns: string[] = [];
      expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, warns), errs.join()).not.toBeNull();
      const work = emptyWork(); work.achieved.uno = {};
      const doc = b.doc, built = buildNetlist(doc), e = new SimEngine();
      let st: Record<string, { pass: boolean; detail?: string }> = {};
      for (let k = 0; k < steps; k++) {
        const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
        st = checkLesson('uno', { doc, built, result: r.result, analysis: analyze(doc, built, r.result, r.tones), work, mcu: r.mcu });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.uno[g] = true;
      }
      for (const g of Object.keys(work.achieved.uno).filter((k) => !k.startsWith('_'))) expect(st[g].pass, g).toBe(true);
      return st;
    };
    const st = run(unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex }), 24);
    expect(st.led.pass).toBe(true); expect(st.upload.pass).toBe(true); expect(st.blink.pass).toBe(true); expect(st.pwm.pass).toBe(false);
    const pw = run(unoRig({ code: 'x', hex: pwmHex, pin: 'D9' }), 6);
    expect(pw.pwm.pass).toBe(true); expect(pw.blink.pass).toBe(false);
    // Blink ที่ขา ~9 (ไม่มี PWM): ก้าวที่คร่อมจังหวะให้กระแสเฉลี่ยกลาง ๆ แต่ไม่นับเป็น PWM
    const bk = run(unoRig({ code: UNO_DEFAULT_CODE, hex: blink9Hex, pin: 'D9' }), 40, 0.07);
    expect(bk.blink.pass).toBe(true); expect(bk.pwm.pass).toBe(false);
    const b2 = unoRig({ code: UNO_DEFAULT_CODE, hex: blinkHex });
    (b2.doc.parts[0].params as { code: string }).code += '\n// แก้แล้ว';
    const s2 = run(b2, 2);
    expect(s2.upload.pass).toBe(false); expect(s2.upload.detail).toContain('อีกครั้ง');
    const s3 = run(unoRig({ hex: null }), 2);
    expect(s3.led.pass).toBe(true); expect(s3.upload.pass).toBe(false);
  });
});
