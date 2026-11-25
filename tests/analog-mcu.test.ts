/**
 * อุปกรณ์แอนะล็อก/ลอจิก/กำลัง ทำงานร่วมกับโค้ดบนไมโครคอนโทรลเลอร์จริง (เฟิร์มแวร์ MicroPython บน rp2040js)
 * โค้ดสั่งขา/อ่าน ADC ผ่านวงจร แล้วเทียบผลกับสมการของวงจร — ทุกข้อไม่มีการอ่านค่าจากตัวแบบจำลองโดยตรง
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { holeInfo } from '../src/model/breadboard';
import { setBoardModel, setPartParams } from '../src/editor/ops';
import { buzzerParamsFor, ldrResistance, ntcResistance } from '../src/model/catalog';
import { PIN_ELEC } from '../src/mcu/cosim';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** Pico บน MB-102 (h1): ขา GP0–15 แถว h (ต่อสายที่แถว j/i), GP16–28 + ไฟ แถว c (ต่อที่แถว a/b) · ราง tp/bp = 3V3, tn/bn = GND */
function pico(code: string) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part('pico', onBoard('h1'), 'PICO1', { code, autorun: true });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  /** รูว่างของขา Pico (แถว a/b บน หรือ j/i ล่าง) */
  const pin = (n: string, alt = false) => { const c = col(n); const top = c <= 20 && pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === n)!.hole!.startsWith('c'); return H(`${top ? (alt ? 'b' : 'a') : (alt ? 'i' : 'j')}${c}`); };
  /** รูรางไฟที่ใช้ได้ใกล้คอลัมน์ c (บางคอลัมน์ของรางไม่มีรู) */
  const rail = (r: 'tp' | 'tn' | 'bp' | 'bn', c: number) => { for (let d = 0; d < 6; d++) for (const x of [c + d, c - d]) if (holeInfo(`${r}${x}`)) return H(`${r}${x}`); throw new Error(`no rail ${r}${c}`); };
  b.wire(pin('3V3'), rail('tp', 5), 'wv', '#e53935').wire(pin('GND.38'), rail('tn', 3), 'wg', '#212121')
    .wire(rail('tp', 2), rail('bp', 2), 'wvv', '#e53935').wire(rail('tn', 4), rail('bn', 4), 'wgg', '#212121');
  let k = 0;
  const w = (a: ReturnType<typeof H>, c: ReturnType<typeof H>, color = '#1e88e5') => { b.wire(a, c, `x${k++}`, color); };
  return { b, col, pin, rail, w };
}

function run(b: Builder, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void) {
  const e = new SimEngine();
  let built = buildNetlist(b.doc);
  let con = '';
  let an!: ReturnType<typeof analyze>;
  const st: Array<{ t: number; an: ReturnType<typeof analyze> }> = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    if (!r.result.ok) throw new Error(`t=${t}: ${r.result.error?.message}`);
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st.push({ t, an });
  }
  return { con, an, st };
}
/** ค่าที่โค้ดพิมพ์ "R ชื่อ ค่า" (ค่าล่าสุดของแต่ละชื่อ หรือทุกค่า) */
const vals = (con: string, name: string) => [...con.matchAll(new RegExp(`(?:^|>>> )R ${name} ([-\\d.]+)`, 'gm'))].map((m) => Number(m[1]));
const last = (con: string, name: string) => vals(con, name).at(-1)!;
const ADC = 'from machine import Pin, ADC, PWM\nimport time\n';
const vRead = (ch: number) => `def v${ch}():\n    a = ADC(${26 + ch}); s = 0\n    for _ in range(8): s += a.read_u16()\n    return s / 8 / 65535 * 3.3\n`;
const RO = PIN_ELEC.pico.rOut;

describe('อุปกรณ์แอนะล็อกทำงานร่วมกับโค้ด MicroPython บน Pico (ตัวจำลอง RP2040)', () => {
  it('LDR และ NTC ในวงแบ่งแรงดัน → ADC อ่านได้ตามสมการ · เปลี่ยนแสง/อุณหภูมิระหว่างรัน โค้ดเห็นค่าใหม่', { timeout: 120000 }, () => {
    const code = ADC + vRead(0) + vRead(1) + 'while True:\n    print("R ldr %.4f" % v0()); print("R ntc %.4f" % v1())\n    time.sleep_ms(100)\n';
    const { b, pin, rail, w } = pico(code);
    // LDR: 3V3 – LDR (e30/e32) – โหนด 32 – 10 kΩ (c32–c36) – GND · ADC0 = โหนด 32
    b.part('ldr', onBoard('e30'), 'LDR1', { lux: 10 }).part('resistor', onBoard('c32'), 'R1', { resistance: 10000, span: 4 });
    w(H('a30'), rail('tp', 30), '#e53935'); w(H('a36'), rail('tn', 36), '#212121'); w(pin('GP26'), H('a32'));
    // NTC: 3V3 – NTC (e40/e42) – โหนด 42 – 10 kΩ – GND · ADC1
    b.part('ntc', onBoard('e40'), 'NTC1', { temperature: 25 }).part('resistor', onBoard('c42'), 'R2', { resistance: 10000, span: 4 });
    w(H('a40'), rail('tp', 40), '#e53935'); w(H('a46'), rail('tn', 46), '#212121'); w(pin('GP27'), H('a42'));
    const r = run(b, 3.0, 0.1, (t, bb) => {
      if (Math.abs(t - 1.5) < 1e-6) { bb.doc = (setPartParams(bb.doc, 'LDR1', { lux: 1000 }) as { doc: typeof bb.doc }).doc; bb.doc = (setPartParams(bb.doc, 'NTC1', { temperature: 60 }) as { doc: typeof bb.doc }).doc; return true; }
    });
    const lp = b.doc.parts.find((p) => p.id === 'LDR1')!.params as never, np = b.doc.parts.find((p) => p.id === 'NTC1')!.params as never;
    const dv = (R: number) => (3.3 * 10000) / (10000 + R);
    const lv = vals(r.con, 'ldr'), nv = vals(r.con, 'ntc');
    // ก่อนเปลี่ยน (ค่าก่อนหน้า t = 1.5 s) และหลังเปลี่ยน (ค่าสุดท้าย)
    const early = Math.floor(lv.length * 0.4);
    expect(Math.abs(lv[early] - dv(ldrResistance({ ...(lp as object), lux: 10 } as never)))).toBeLessThan(0.05);
    expect(Math.abs(lv.at(-1)! - dv(ldrResistance(lp)))).toBeLessThan(0.05);
    expect(lv.at(-1)!).toBeGreaterThan(lv[early] + 0.5);
    expect(Math.abs(nv[early] - dv(ntcResistance({ ...(np as object), temperature: 25 } as never)))).toBeLessThan(0.05);
    expect(Math.abs(nv.at(-1)! - dv(ntcResistance(np)))).toBeLessThan(0.05);
  });

  it('ตัวเก็บประจุ RC (10 kΩ × 100 µF, τ ≈ 1 s): GPIO ปล่อยไฟเข้า → ADC ที่ t = τ ≈ 63% ของไฟ (ตามเวลาจำลอง)', { timeout: 120000 }, () => {
    const code = ADC + vRead(1) + 'p = Pin(16, Pin.OUT); p.value(0); time.sleep_ms(300)\nprint("R v0 %.4f" % v1())\np.value(1); t0 = time.ticks_ms()\ntime.sleep_ms(1000)\nprint("R tau %.4f" % v1()); print("R dt %d" % time.ticks_diff(time.ticks_ms(), t0))\ntime.sleep_ms(4000)\nprint("R full %.4f" % v1())\n';
    const { b, pin, rail, w } = pico(code);
    b.part('resistor', onBoard('c30'), 'R1', { resistance: 10000, span: 4 }).part('capacitor', onBoard('e34'), 'C1', { capacitance: 100e-6 });
    w(pin('GP16'), H('a30')); w(pin('GP27'), H('a34')); w(H('a36'), rail('tn', 36), '#212121');
    const r = run(b, 6.5, 0.1);
    const tau = (10000 + RO) * 100e-6, t = last(r.con, 'dt') / 1000;
    expect(last(r.con, 'v0')).toBeLessThan(0.05);
    expect(Math.abs(last(r.con, 'tau') - 3.3 * (1 - Math.exp(-t / tau)))).toBeLessThan(0.08);
    expect(last(r.con, 'full')).toBeGreaterThan(3.2);
  });

  it('ตัวเหนี่ยวนำ (10 H, 1 Ω) อนุกรม 100 Ω: GPIO สลับเป็น HIGH → แรงดันคร่อมขดลวดลดแบบเอกซ์โพเนนเชียล τ = L/R', { timeout: 120000 }, () => {
    const code = ADC + vRead(2) + 'p = Pin(17, Pin.OUT); p.value(0); time.sleep_ms(200)\np.value(1); t0 = time.ticks_us()\ntime.sleep_ms(30)\nprint("R early %.4f" % v2()); print("R dt %d" % time.ticks_diff(time.ticks_us(), t0))\ntime.sleep_ms(800)\nprint("R late %.4f" % v2())\n';
    const { b, pin, rail, w } = pico(code);
    b.part('resistor', onBoard('c30'), 'R1', { resistance: 100, span: 4, powerRating: 1 }).part('inductor', onBoard('e34'), 'L1', { inductance: 10, resistance: 1, span: 3, ratedCurrent: 1 });
    w(pin('GP17'), H('a30')); w(pin('GP28'), H('a34')); w(H('a37'), rail('tn', 37), '#212121');
    const r = run(b, 1.5, 0.05);
    const Rs = 100 + RO, Rt = Rs + 1, tau = 10 / Rt, t = last(r.con, 'dt') / 1e6;
    const exp = 3.3 * (1 / Rt + (Rs / Rt) * Math.exp(-t / tau));
    expect(Math.abs(last(r.con, 'early') - exp) / exp).toBeLessThan(0.12);
    expect(last(r.con, 'late')).toBeLessThan(0.1);
  });

  it('ทรานซิสเตอร์ 2N3904 และดาร์ลิงตัน TIP120 เป็นสวิตช์: GPIO 0/1 → ขาคอลเลกเตอร์สูง/ต่ำ (TIP120 อิ่มตัวสูงกว่าเพราะ VBE สองชั้น)', { timeout: 120000 }, () => {
    const code = ADC + vRead(0) + vRead(1) + 'a = Pin(16, Pin.OUT); d = Pin(17, Pin.OUT)\nfor s in (0, 1, 0):\n    a.value(s); d.value(s); time.sleep_ms(200)\n    print("R q%d %.4f" % (s, v0())); print("R t%d %.4f" % (s, v1()))\n';
    const { b, pin, rail, w } = pico(code);
    // 2N3904: E e33 B e34 C e35 · เบส 10 kΩ (c30–c34) จาก GP16 · โหลด 1 kΩ (b35–b39) จาก 3V3 · ADC0 = คอลเลกเตอร์
    b.part('resistor', onBoard('c30'), 'RB1', { resistance: 10000, span: 4 }).part('bjt', onBoard('e33'), 'Q1').part('resistor', onBoard('b35'), 'RC1', { resistance: 1000, span: 4 });
    w(pin('GP16'), H('a30')); w(H('a33'), rail('tn', 33), '#212121'); w(H('a39'), rail('tp', 39), '#e53935'); w(pin('GP26'), H('a35'));
    // TIP120: B e46 C e47 E e48 · เบส 1 kΩ (c42–c46) จาก GP17 · โหลด 1 kΩ (b47–b51) · ADC1 = คอลเลกเตอร์
    b.part('resistor', onBoard('c42'), 'RB2', { resistance: 1000, span: 4 }).part('darlington', onBoard('e46'), 'Q2').part('resistor', onBoard('b47'), 'RC2', { resistance: 1000, span: 4 });
    w(pin('GP17'), H('a42')); w(H('a48'), rail('tn', 48), '#212121'); w(H('a51'), rail('tp', 51), '#e53935'); w(pin('GP27'), H('a47'));
    const r = run(b, 1.2, 0.1);
    const q0 = vals(r.con, 'q0'), q1 = last(r.con, 'q1'), t0 = vals(r.con, 't0'), t1 = last(r.con, 't1');
    expect(q0.length).toBe(2); expect(Math.min(...q0)).toBeGreaterThan(3.2); expect(q1).toBeLessThan(0.25);
    expect(Math.min(...t0)).toBeGreaterThan(3.2); expect(t1).toBeGreaterThan(0.55); expect(t1).toBeLessThan(1.3);
    expect(t1).toBeGreaterThan(q1 + 0.4);
  });

  it('SCR 2N5060: พัลส์เกตจาก GPIO → ติดค้าง (latch) แม้เกตกลับเป็น 0 · ตัดไฟแอโนดชั่วคราว → ดับ', { timeout: 120000 }, () => {
    const code = ADC + vRead(0) + 'g = Pin(16, Pin.OUT); a = Pin(17, Pin.OUT); g.value(0); a.value(1); time.sleep_ms(200)\nprint("R before %.4f" % v0())\ng.value(1); time.sleep_ms(20); g.value(0); time.sleep_ms(200)\nprint("R latched %.4f" % v0())\na.value(0); time.sleep_ms(50); a.value(1); time.sleep_ms(200)\nprint("R reset %.4f" % v0())\n';
    const { b, pin, rail, w } = pico(code);
    // K e30 G e31 A e32 · เกต 1 kΩ (c27–c31) จาก GP16 · แอโนดรับไฟจาก GP17 ผ่าน 100 Ω (c32–c36) · ADC0 = แอโนด
    b.part('scr', onBoard('e30'), 'SCR1').part('resistor', onBoard('c27'), 'RG', { resistance: 1000, span: 4 }).part('resistor', onBoard('b32'), 'RA', { resistance: 100, span: 4 });
    w(H('a30'), rail('tn', 30), '#212121'); w(pin('GP16'), H('a27')); w(pin('GP17'), H('a36')); w(pin('GP26'), H('a32'));
    const r = run(b, 1.2, 0.1);
    expect(last(r.con, 'before')).toBeGreaterThan(2.5);
    expect(last(r.con, 'latched')).toBeLessThan(1.3);
    expect(last(r.con, 'reset')).toBeGreaterThan(2.5);
  });

  it('74HC08 (AND) ตารางความจริงจากขาเข้า GPIO และอ่านขาออกด้วย GPIO · LM393 เปรียบเทียบกับ 1.65 V (ขาออก open collector + ดึงขึ้น)', { timeout: 120000 }, () => {
    const code = 'from machine import Pin\nimport time\nA = Pin(15, Pin.OUT); B = Pin(14, Pin.OUT); Y = Pin(13, Pin.IN); C = Pin(12, Pin.OUT); O = Pin(11, Pin.IN)\nfor a in (0, 1):\n    for bb in (0, 1):\n        A.value(a); B.value(bb); time.sleep_ms(30)\n        print("R and%d%d %d" % (a, bb, Y.value()))\nfor c in (0, 1, 0):\n    C.value(c); time.sleep_ms(30)\n    print("R cmp%d %d" % (c, O.value()))\n';
    const { b, pin, rail, w } = pico(code);
    // 74HC08 ที่ f30: 1A f30 1B f31 1Y f32 GND f36 · VCC e30
    b.part('logic', onBoard('f30'), 'U1', { model: '74HC08' });
    w(H('a30'), rail('tp', 30), '#e53935'); w(H('j36'), rail('bn', 36), '#212121');
    w(pin('GP15'), H('j30')); w(pin('GP14'), H('j31')); w(H('i32'), pin('GP13'));
    // LM393 ที่ f45: OUTA f45 INA- f46 INA+ f47 GND f48 · VCC e45 · INA- = 1.65 V (10 k/10 k) · INA+ = GP12 · OUTA ดึงขึ้น 10 kΩ → GP11
    b.part('comparator', onBoard('f45'), 'U2');
    w(H('a45'), rail('tp', 45), '#e53935'); w(H('j48'), rail('bn', 48), '#212121');
    b.part('resistor', onBoard('h52'), 'RA', { resistance: 10000, span: 4 }).part('resistor', onBoard('i56'), 'RB', { resistance: 10000, span: 4 });
    w(H('j52'), rail('bp', 52), '#e53935'); w(H('j60'), rail('bn', 60), '#212121'); w(H('g56'), H('g46'));
    w(pin('GP12'), H('h47'));
    b.part('resistor', onBoard('i41'), 'RP', { resistance: 10000, span: 4 });
    w(H('j41'), rail('bp', 41), '#e53935'); w(H('h45'), pin('GP11'));
    const r = run(b, 0.8, 0.1);
    expect([last(r.con, 'and00'), last(r.con, 'and01'), last(r.con, 'and10'), last(r.con, 'and11')]).toEqual([0, 0, 0, 1]);
    expect(vals(r.con, 'cmp0')).toEqual([0, 0]);
    expect(last(r.con, 'cmp1')).toBe(1);
  });

  it('CD4017 นับพัลส์นาฬิกาจาก GPIO: RST แล้ว Q0 → Q1 → Q2 → Q3 ทีละขั้น (อ่านขาออกด้วย GPIO)', { timeout: 120000 }, () => {
    const code = 'from machine import Pin\nimport time\nclk = Pin(16, Pin.OUT); rst = Pin(17, Pin.OUT); q = [Pin(13, Pin.IN), Pin(14, Pin.IN), Pin(15, Pin.IN)]\nclk.value(0); rst.value(1); time.sleep_ms(20); rst.value(0); time.sleep_ms(20)\nfor n in range(4):\n    print("R s%d %d%d%d" % (n, q[0].value(), q[1].value(), q[2].value()))\n    clk.value(1); time.sleep_ms(10); clk.value(0); time.sleep_ms(10)\n';
    const { b, pin, rail, w } = pico(code);
    // CD4017 ที่ f30: Q1 f31 Q0 f32 Q2 f33 VSS f37 · VDD e30 RST e31 CLK e32 INH e33
    b.part('counter', onBoard('f30'), 'U1');
    w(H('a30'), rail('tp', 30), '#e53935'); w(H('j37'), rail('bn', 37), '#212121'); w(H('a33'), rail('tn', 33), '#212121');
    w(pin('GP16'), H('a32')); w(pin('GP17'), H('a31'));
    w(H('j32'), pin('GP13')); w(H('j31'), pin('GP14')); w(H('j33'), pin('GP15'));
    const r = run(b, 0.6, 0.1);
    const s = [0, 1, 2, 3].map((n) => [...r.con.matchAll(new RegExp(`(?:^|>>> )R s${n} (\\d+)`, 'gm'))].at(-1)?.[1]);
    expect(s).toEqual(['100', '010', '001', '000']);
  });

  it('NE555 แบบ astable (1 kΩ, 10 kΩ, 10 µF ≈ 6.9 Hz) ที่ 5 V: GPIO คุมขา RESET · โค้ดนับขอบขาออก (ผ่านวงแบ่ง 10 k/20 k) ได้ความถี่ตามสูตร', { timeout: 240000 }, () => {
    const code = 'from machine import Pin\nimport time\nrst = Pin(15, Pin.OUT); o = Pin(14, Pin.IN)\ndef count(ms):\n    n = 0; last = o.value(); t0 = time.ticks_ms()\n    while time.ticks_diff(time.ticks_ms(), t0) < ms:\n        v = o.value()\n        if v and not last: n += 1\n        last = v; time.sleep_ms(2)\n    return n\nrst.value(0); print("R off %d" % count(1000))\nrst.value(1); time.sleep_ms(300); print("R on %d" % count(3000))\n';
    const { b, col, pin, rail, w } = pico(code);
    // 555 ที่ f30: GND f30 TRIG f31 OUT f32 RESET f33 · VCC e30 DIS e31 THR e32 CTRL e33
    b.part('timer555', onBoard('f30'), 'U1');
    w(H(`a${col('VBUS')}`), H('a30'), '#ff7043');
    b.part('resistor', onBoard('a35'), 'R1', { resistance: 1000, span: 5 }).part('resistor', onBoard('a42'), 'R2', { resistance: 10000, span: 5 }).part('capacitor', onBoard('a50'), 'C1', { capacitance: 10e-6 });
    w(H('d30'), H('c35'), '#ff7043'); w(H('d31'), H('c40')); w(H('b31'), H('b42')); w(H('d32'), H('b47')); w(H('c47'), H('c50')); w(H('b52'), rail('tn', 52), '#212121');
    w(H('g31'), H('c32')); w(H('j30'), rail('bn', 30), '#212121');
    w(pin('GP15'), H('j33'));
    b.part('resistor', onBoard('i32'), 'RD1', { resistance: 10000, span: 4 }).part('resistor', onBoard('h36'), 'RD2', { resistance: 20000, span: 4 });
    w(H('j40'), rail('bn', 40), '#212121'); w(H('g36'), pin('GP14'));
    const r = run(b, 5.0, 0.1);
    expect(last(r.con, 'off')).toBe(0);
    const f = 1.44 / ((1000 + 2 * 10000) * 10e-6);
    expect(Math.abs(last(r.con, 'on') / 3 - f) / f).toBeLessThan(0.15);
  });

  it('L7805 และ LM317 (9 V จากแหล่งจ่าย): โค้ดอ่านแรงดันขาออกด้วย ADC ตรงสูตร · ลดไฟเข้าต่ำกว่า dropout → โค้ดเห็นแรงดันตก', { timeout: 120000 }, () => {
    const code = ADC + vRead(0) + vRead(1) + 'while True:\n    print("R reg %.4f" % (v0() * 2)); print("R adj %.4f" % v1())\n    time.sleep_ms(100)\n';
    const { b, pin, rail, w } = pico(code);
    b.part('dcsupply', onTable(-60, 60), 'PS1', { voltage: 9, currentLimit: 1 });
    // L7805: IN e30 GND e31 OUT e32 · วงแบ่ง 10 k/10 k (a32–a36, b36–b40) → ADC0
    b.part('vreg', onBoard('e30'), 'U1').part('resistor', onBoard('a32'), 'RV1', { resistance: 10000, span: 4 }).part('resistor', onBoard('b36'), 'RV2', { resistance: 10000, span: 4 });
    b.wire(P('PS1', 'pos'), H('a30'), 'wps', '#e53935').wire(P('PS1', 'neg'), rail('tn', 20), 'wpn', '#212121');
    w(H('c31'), rail('tn', 31), '#212121'); w(H('d40'), rail('tn', 40), '#212121'); w(pin('GP26'), H('c36'));
    // LM317: ADJ e45 OUT e46 IN e47 · R1 240 Ω OUT→ADJ (b41–b46 + c41→d45) · R2 330 Ω ADJ→GND (a45–a49) · ADC1 = OUT
    b.part('lm317', onBoard('e45'), 'U2').part('resistor', onBoard('b41'), 'R1', { resistance: 240, span: 5 }).part('resistor', onBoard('a45'), 'R2', { resistance: 330, span: 4 });
    w(H('c41'), H('d45')); w(H('c49'), rail('tn', 49), '#212121'); w(pin('GP27'), H('d46'));
    b.wire(P('PS1', 'pos'), H('a47'), 'wps2', '#e53935');
    const r = run(b, 2.4, 0.1, (t, bb) => { if (Math.abs(t - 1.2) < 1e-6) { bb.doc = (setPartParams(bb.doc, 'PS1', { voltage: 5 }) as { doc: typeof bb.doc }).doc; return true; } });
    const reg = vals(r.con, 'reg'), adj = vals(r.con, 'adj'), mid = Math.floor(reg.length * 0.4);
    expect(Math.abs(reg[mid] - 5.0)).toBeLessThan(0.15);
    expect(Math.abs(adj[mid] - (1.25 * (1 + 330 / 240) + 50e-6 * 330))).toBeLessThan(0.08);
    // ไฟเข้า 5 V: 7805 dropout 2 V → ≈ 3 V · LM317 dropout 1.7 V → ≈ 3.3 V แต่ตั้งไว้ 2.99 V ยังคุมได้
    expect(reg.at(-1)!).toBeLessThan(3.5);
    expect(Math.abs(adj.at(-1)! - adj[mid])).toBeLessThan(0.1);
  });

  it('ลำโพง 8 Ω จาก PWM 440 Hz (ผ่าน 100 Ω) บัซเซอร์ active 5 V ผ่าน NPN และบัซเซอร์ passive จาก PWM 2 kHz: โค้ดเปิด/ปิดเสียงได้ · ความถี่ตาม PWM', { timeout: 240000 }, () => {
    const code = 'from machine import Pin, PWM\nimport time\ns = PWM(Pin(16)); s.freq(440); s.duty_u16(32768)\nbz = Pin(17, Pin.OUT); bz.value(1)\npb = PWM(Pin(18)); pb.freq(2000); pb.duty_u16(32768)\ntime.sleep_ms(600)\ns.duty_u16(0); bz.value(0); pb.duty_u16(0)\nprint("R off 1")\ntime.sleep_ms(2000)\n';
    const { b, col, pin, rail, w } = pico(code);
    b.part('speaker', onTable(60, -40), 'LS1').part('resistor', onBoard('c30'), 'RS', { resistance: 100, span: 4, powerRating: 0.5 });
    w(pin('GP16'), H('a30')); b.wire(H('a34'), P('LS1', 'P'), 'wsp', '#e53935').wire(P('LS1', 'N'), rail('tn', 34), 'wsn', '#212121');
    // บัซเซอร์: P e45 N e48 · P ← VBUS · N → คอลเลกเตอร์ NPN (E e50 B e51 C e52) · เบส 1 kΩ (c55… ) จาก GP17
    b.part('buzzer', onBoard('e45'), 'BZ1', { type: 'active' }).part('bjt', onBoard('e50'), 'Q1').part('resistor', onBoard('b51'), 'RB', { resistance: 1000, span: 4 });
    w(H(`a${col('VBUS')}`), H('a45'), '#ff7043'); w(H('a48'), H('a52')); w(H('a50'), rail('tn', 50), '#212121'); w(pin('GP17'), H('a55'));
    // บัซเซอร์ passive (ขดลวด 42 Ω ตามที่แอปตั้งเมื่อเลือกแบบ passive): P e58 N e61 · PWM 2 kHz จาก GP18 ต่อตรง (ขาออก GPIO จำกัดกระแสด้วยความต้านทานขาออก)
    b.part('buzzer', onBoard('e58'), 'BZ2', buzzerParamsFor('passive')); w(pin('GP18'), H('a58')); w(H('a61'), rail('tn', 61), '#212121');
    const r = run(b, 1.4, 0.1);
    const on = r.st.filter((s) => s.t > 0.25 && s.t < 0.55), off = r.st.filter((s) => s.t > 1.0);
    expect(on.every((s) => s.an.parts.LS1.extra?.sounding === 1)).toBe(true);
    expect(Math.abs((on.at(-1)!.an.parts.LS1.extra?.freq ?? 0) - 440)).toBeLessThan(5);
    expect(on.every((s) => s.an.parts.BZ1.extra?.sounding === 1)).toBe(true);
    expect(on.every((s) => s.an.parts.BZ2.extra?.sounding === 1)).toBe(true);
    expect(Math.abs((on.at(-1)!.an.parts.BZ2.extra?.freq ?? 0) - 2000)).toBeLessThan(20);
    expect(off.every((s) => s.an.parts.LS1.extra?.sounding === 0 && s.an.parts.BZ1.extra?.sounding === 0 && s.an.parts.BZ2.extra?.sounding === 0)).toBe(true);
    expect(r.con).toContain('R off 1');
  });

  it('LM386 ขยายสัญญาณ PWM 1 kHz ที่ถูกลดทอน (10 k/100 Ω) ไปลำโพงผ่าน 220 µF · โค้ดหยุด PWM → ลำโพงเงียบ', { timeout: 240000 }, () => {
    const code = 'from machine import Pin, PWM\nimport time\ns = PWM(Pin(15)); s.freq(1000); s.duty_u16(32768)\ntime.sleep_ms(700)\ns.duty_u16(0)\ntime.sleep_ms(2000)\n';
    const { b, col, pin, rail, w } = pico(code);
    // LM386 ที่ f30: G1 f30 IN- f31 IN+ f32 GND f33 · G8 e30 BYP e31 VS e32 OUT e33
    b.part('lm386', onBoard('f30'), 'U1');
    w(H('j33'), rail('bn', 33), '#212121'); w(H('j31'), rail('bn', 31), '#212121'); w(H(`a${col('VBUS')}`), H('a32'), '#ff7043');
    b.part('resistor', onBoard('i40'), 'RA', { resistance: 10000, span: 4 }).part('resistor', onBoard('h44'), 'RB', { resistance: 100, span: 4 });
    w(pin('GP15'), H('j40')); w(H('j48'), rail('bn', 48), '#212121'); w(H('g44'), H('g32'));
    b.part('capacitor', onBoard('b40'), 'C1', { capacitance: 220e-6, ratedVoltage: 16 }).part('speaker', onTable(60, -40), 'LS1');
    w(H('c33'), H('a40')); b.wire(H('a42'), P('LS1', 'P'), 'wsp', '#e53935').wire(P('LS1', 'N'), rail('tn', 42), 'wsn', '#212121');
    const r = run(b, 1.6, 0.1);
    const on = r.st.filter((s) => s.t > 0.35 && s.t < 0.65), off = r.st.filter((s) => s.t > 1.3);
    expect(on.every((s) => s.an.parts.LS1.extra?.sounding === 1)).toBe(true);
    expect(Math.abs((on.at(-1)!.an.parts.LS1.extra?.freq ?? 0) - 1000)).toBeLessThan(15);
    // อัตราขยาย 20: สัญญาณเข้ายอด ≈ 33 mV → ขาออก ≈ 0.65 V ยอด → กระแสลำโพงยอดหลายสิบ mA (มากกว่าขับตรงจาก 100 Ω/10 k)
    expect(on.at(-1)!.an.parts.LS1.extra!.iac).toBeGreaterThan(0.02);
    expect(off.every((s) => s.an.parts.LS1.extra?.sounding === 0)).toBe(true);
  });
});

