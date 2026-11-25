import { describe, expect, it } from 'vitest';
import rgbHex from './fixtures/uno/rgb.hex?raw';
import blink9Hex from './fixtures/uno/blink9.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { UNO_DEFAULT_CODE, UNO_RGB_CODE, pinDefs, rgbLedParamsFor } from '../src/model/catalog';
import { validateCircuit } from '../src/model/schema';
import { emptyWork } from '../src/model/types';
import { rgbColorName } from '../src/ui/panels';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { rgbRig, runRgb } from './rgb-rig';

const at = (st: ReturnType<typeof runRgb>['st'], t: number) => st.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
const mA = (v: number) => v * 1000;

describe('LED RGB 5 mm', () => {
  it('ขาเรียง R · COM · G · B ติดกัน 4 รู · ไดโอด Vf 2.0/3.2/3.2 V ที่ 20 mA (แหล่งจ่าย DC ผ่าน R)', () => {
    const b = new Builder().part('rgbled', onBoard('c20'), 'L1', rgbLedParamsFor('cc'));
    expect(pinDefs(b.doc.parts[0]).map((d) => d.name)).toEqual(['R', 'COM', 'G', 'B']);
    // ตั้งแหล่งจ่ายให้ได้ 20 mA พอดีถ้า Vf ตรงสเปก: V = Vf + 0.02·100
    for (const [ch, vf] of [['R', 2.0], ['G', 3.2], ['B', 3.2]] as const) {
      const d = new Builder().part('dcsupply', onTable(-25, 0), 'PS1', { voltage: vf + 2, currentLimit: 1 }).part('rgbled', onBoard('c20'), 'L1', rgbLedParamsFor('cc'))
        .part('resistor', onBoard('a10'), 'R1', { resistance: 100, span: 3 })
        .wire(P('PS1', 'pos'), H('b10')).wire(H('b13'), H(`d${{ R: 20, G: 22, B: 23 }[ch]}`)).wire(H('a21'), H('tn21')).wire(P('PS1', 'neg'), H('tn3'));
      const built = buildNetlist(d.doc), r = new SimEngine().handle({ seq: 1, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
      const ex = analyze(d.doc, built, r.result, r.tones).parts.L1.extra!;
      expect(mA(ex[`i_${ch}`]), ch).toBeGreaterThan(19);
      expect(mA(ex[`i_${ch}`]), ch).toBeLessThan(21);
      for (const o of ['R', 'G', 'B'].filter((c) => c !== ch)) expect(ex[`i_${o}`]).toBeLessThan(1e-9);
    }
  });

  it('Uno: setColor วนสี → กระแสแต่ละสีตามโค้ด (แดง ≈ 12.5 mA, เขียว/น้ำเงิน ≈ 7.5 mA, แดงหรี่ ≈ 25%) + Serial', { timeout: 60000 }, () => {
    const r = runRgb(rgbRig({ hex: rgbHex, code: UNO_RGB_CODE }), 3.6, 0.05);
    const names = ['red', 'green', 'blue', 'yellow', 'magenta', 'dim red', 'off'];
    for (const n of names) expect(r.con).toContain(n);
    const want: Array<[number, number, number]> = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0.25, 0, 0], [0, 0, 0]];
    const full = at(r.st, 0.3).i[0];
    expect(mA(full)).toBeGreaterThan(11.5); expect(mA(full)).toBeLessThan(13.5);
    const g = at(r.st, 0.8).i[1], bl = at(r.st, 1.3).i[2];
    for (const v of [g, bl]) { expect(mA(v)).toBeGreaterThan(6.5); expect(mA(v)).toBeLessThan(8.5); }
    const fullI = [full, g, bl];
    want.forEach((w, k) => {
      const s = at(r.st, 0.3 + k * 0.5);
      for (let c = 0; c < 3; c++) {
        const f = s.i[c] / fullI[c];
        if (w[c] === 1) expect(f, `${names[k]} ch${c}`).toBeGreaterThan(0.97);
        else if (w[c] === 0) expect(s.i[c], `${names[k]} ch${c}`).toBeLessThan(1e-6);
        else { expect(f, `${names[k]} ch${c}`).toBeGreaterThan(0.2); expect(f).toBeLessThan(0.3); }
      }
    });
    expect(at(r.st, 0.3).diags.join()).not.toMatch(/เกินพิกัด/);
  });

  it('แอโนดร่วม (ขาร่วม → 5V) กับโค้ดเดิม → สีกลับกัน (แดง → ฟ้า, ดับ → ขาว)', { timeout: 60000 }, () => {
    const r = runRgb(rgbRig({ hex: rgbHex, code: UNO_RGB_CODE, common: 'ca' }), 3.6, 0.05);
    const red = at(r.st, 0.3).i, off = at(r.st, 3.3).i;
    expect(red[0]).toBeLessThan(1e-6);
    expect(mA(red[1])).toBeGreaterThan(6.5); expect(mA(red[2])).toBeGreaterThan(6.5);
    for (const v of off) expect(mA(v)).toBeGreaterThan(6.5);
  });

  it('ไม่มีตัวต้านทานที่สีเขียว → กระแสถูกจำกัดโดยขา (≈ 40 mA) แจ้งเกินพิกัด · ขาร่วมต่อผิดชนิด → แจ้งไบแอสกลับ', { timeout: 60000 }, () => {
    const r = runRgb(rgbRig({ hex: rgbHex, code: UNO_RGB_CODE, noRes: 'G' }), 1.0, 0.05);
    const s = at(r.st, 0.8);
    expect(mA(s.i[1])).toBeGreaterThan(30);
    expect(s.diags.join()).toMatch(/สีเขียว \(ขา G\).*เกินพิกัด/);
    // ตั้งเป็นแคโทดร่วม แต่ขาร่วมต่อ 5V
    const b = rgbRig({ hex: rgbHex, code: UNO_RGB_CODE, common: 'ca' });
    (b.doc.parts.find((p) => p.id === 'LED1')!.params as { common: string }).common = 'cc';
    const w = runRgb(b, 3.6, 0.05);
    const o = at(w.st, 3.3);
    expect(Math.max(...o.i)).toBeLessThan(1e-6);
    expect(o.diags.join()).toMatch(/ไบแอสกลับ/);
  });

  it('ชื่อสีที่เห็นจากความสว่าง', () => {
    expect(rgbColorName(1, 0, 0)).toBe('แดง');
    expect(rgbColorName(1, 1, 0)).toBe('เหลือง');
    expect(rgbColorName(0.9, 0, 1)).toBe('ม่วงแดง (magenta)');
    expect(rgbColorName(1, 1, 1)).toBe('ขาว');
    expect(rgbColorName(0, 0, 0)).toBe('ดับ');
    expect(rgbColorName(1, 0.1, 0)).toBe('แดง');
  });

  it('แลป 44: วนสีผ่านครบ 6 ข้อ · Blink (ไม่มี PWM/ไม่มีสีอื่น) ไม่ผ่าน pwm/mix ถึงจังหวะเปลี่ยนจะทำให้ค่าเฉลี่ยอยู่ระหว่างกลาง · ไม่มีตัวต้านทานสีเขียว → wire ไม่ผ่าน', { timeout: 60000 }, () => {
    expect(LESSONS.find((l) => l.id === 'rgb')?.number).toBe(44);
    expect(SCHEMATICS.rgb).toBeDefined();
    const run = (b: ReturnType<typeof rgbRig>, secs: number) => {
      const errs: string[] = [];
      expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
      const work = emptyWork(); work.achieved.rgb = {};
      const doc = b.doc, built = buildNetlist(doc), e = new SimEngine();
      let st: Record<string, { pass: boolean; detail?: string }> = {};
      // ก้าว 0.07 s ไม่ลงจังหวะ 0.5 s — ก้าวที่คร่อมการเปลี่ยนสีมีค่าเฉลี่ยกลาง ๆ จริง
      for (let k = 0; k < Math.round(secs / 0.07); k++) {
        const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.07, restart: k === 0, watch: [], budgetMs: 1e9 });
        st = checkLesson('rgb', { doc, built, result: r.result, analysis: analyze(doc, built, r.result, r.tones), work, time: (k + 1) * 0.07, mcu: r.mcu });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.rgb[g] = true;
      }
      // แผงแลปแสดงสถานะปัจจุบัน: เป้าหมายที่เคยผ่านต้องยังแสดงว่าผ่าน
      for (const g of Object.keys(work.achieved.rgb)) expect(st[g].pass, g).toBe(true);
      return work.achieved.rgb;
    };
    const ok = run(rgbRig({ hex: rgbHex, code: UNO_RGB_CODE }), 3.6);
    for (const g of ['wire', 'red', 'green', 'blue', 'mix', 'pwm']) expect(ok[g], g).toBe(true);
    // Blink ที่ D9 (สีแดงกะพริบ) — ไม่มีการผสม/หรี่ แม้ก้าวที่คร่อมจังหวะจะให้ค่ากลาง
    const b2 = rgbRig({ hex: blink9Hex, code: UNO_DEFAULT_CODE });
    const blink = run(b2, 3.0);
    expect(blink.wire).toBe(true);
    expect(blink.red).toBe(true); // แดงติดเต็มสลับดับ
    // ยืนยันว่ามีก้าวที่ค่าเฉลี่ยอยู่กลาง ๆ จริง (ก้าวคร่อมจังหวะ) แต่ตัวตรวจไม่นับ
    const rr = runRgb(rgbRig({ hex: blink9Hex, code: UNO_DEFAULT_CODE }), 3.0, 0.07);
    const full = Math.max(...rr.st.map((s) => s.i[0]));
    expect(rr.st.some((s) => s.i[0] > 0.15 * full && s.i[0] < 0.75 * full)).toBe(true);
    expect(blink.pwm ?? false).toBe(false);
    expect(blink.mix ?? false).toBe(false);
    const nr = run(rgbRig({ hex: rgbHex, code: UNO_RGB_CODE, noRes: 'G' }), 0.3);
    expect(nr.wire ?? false).toBe(false);
  });
});
