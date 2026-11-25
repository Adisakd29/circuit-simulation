import { describe, expect, it } from 'vitest';
import { SimEngine, type EngineResponse, type WatchItem } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import type { McuCommand } from '../src/mcu/cosim';
import { Builder, H, P, onBoard, onTable } from './helpers';
import { checkLesson } from '../src/lessons/checks';
import { analyze } from '../src/instruments/measure';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { validateProjectFile } from '../src/model/schema';

/** Pico ที่ h5: ขา 1–20 = แถว h คอลัมน์ 5–24, ขา 21–40 = แถว c คอลัมน์ 24–5 (เรียงทวนเข็มนาฬิกาเมื่อมองจากด้านบน) */
const hole = (b: Builder, pin: string) => pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!;
const col = (h: string) => Number(h.slice(1));
const above = (b: Builder, pin: string, row = 'j') => `${row}${col(hole(b, pin))}`; // แถวในกลุ่มเดียวกับขาแถว h (f–j)
const below = (b: Builder, pin: string, row = 'a') => `${row}${col(hole(b, pin))}`; // แถวในกลุ่มเดียวกับขาแถว c (a–e)

function pico(code: string, autorun = true) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code, autorun });
  return b;
}

class Run {
  e = new SimEngine();
  nl; watch: WatchItem[];
  t = 0;
  console = '';
  last!: EngineResponse;
  constructor(public b: Builder, watch: (c: ReturnType<typeof buildNetlist>['connectivity']) => WatchItem[] = () => []) {
    const built = buildNetlist(b.doc);
    this.nl = built.netlist;
    this.watch = watch(built.connectivity);
    this.step(0, true);
  }
  step(dt: number, restart = false, mcu?: Record<string, McuCommand>) {
    this.last = this.e.handle({ seq: 1, netlist: this.nl, advance: dt, restart, watch: this.watch, budgetMs: 1e9, mcu });
    this.t = this.last.t;
    for (const m of this.last.mcu ?? []) this.console += m.console;
    return this.last;
  }
  until(pred: () => boolean, maxS = 5, dt = 0.05) {
    for (let k = 0; k < maxS / dt && !pred(); k++) this.step(dt);
    return pred();
  }
}

describe('Raspberry Pi Pico: MicroPython จริงในตัวจำลอง CPU', () => {
  it('บูต MicroPython และรันโค้ดผ่าน REPL (print, ข้อผิดพลาด)', () => {
    const r = new Run(pico('print("hello", 6*7)\n'));
    expect(r.until(() => r.console.includes('hello 42'))).toBe(true);
    r.step(0.05, false, { PICO1: { run: 'x = 1/0\n' } });
    expect(r.until(() => r.console.includes('ZeroDivisionError'))).toBe(true);
    expect(r.console).not.toContain('raw REPL');
  });

  it('ไฟกะพริบ GP15 → 220 Ω → LED: กระแส LED สลับเปิด/ปิดทุก 0.5 s ตามเวลาจำลอง', () => {
    const b = pico('from machine import Pin\nimport time\nl=Pin(15,Pin.OUT)\nwhile True:\n  l.toggle()\n  time.sleep(0.5)\n');
    b.part('resistor', onBoard(above(b, 'GP15', 'j')), 'R1', { resistance: 220, span: 4 }) // a24–a28
      .part('led', onBoard('i28'), 'LED1') // A b28 K b29
      .wire(H('h29'), H('bn29')).wire(H(above(b, 'GND.18', 'j')), H('bn22'));
    const r = new Run(b);
    expect(r.until(() => Math.abs(r.last.result.elements['LED1']?.current ?? 0) > 1e-3, 5, 0.02)).toBe(true);
    const tOn = r.t;
    // อ่านกระแสหลังขาออกนิ่งหนึ่งช่วง (ช่วงแรกอาจจบตรงจังหวะตั้งค่าขา — โปรแกรมเริ่มเร็วขึ้นเมื่อส่งโค้ดตามจังหวะ UART จริง)
    r.step(0.02);
    const I = r.last.result.elements['LED1'].current;
    // GPIO 3.3 V, Rout 80 Ω + 220 Ω, LED แดง ≈ 1.8–2.0 V → ≈ 4.5–5 mA
    expect(I).toBeGreaterThan(3e-3);
    expect(I).toBeLessThan(6e-3);
    expect(r.until(() => Math.abs(r.last.result.elements['LED1'].current) < 1e-6, 2, 0.02)).toBe(true);
    const tOff = r.t;
    expect(Math.abs(tOff - tOn - 0.5)).toBeLessThan(0.03);
  });

  it('ปุ่มกด: GP14 pull-up + สวิตช์ลงกราวด์ อ่านได้ 0 เมื่อกด 1 เมื่อปล่อย', () => {
    const mk = (closed: boolean) => {
      const b = pico('from machine import Pin\nbtn=Pin(14,Pin.IN,Pin.PULL_UP)\nprint("BTN", btn.value())\n');
      return b.part('switch', onBoard(above(b, 'GP14', 'j')), 'S1', { closed }) // a23–a25
        .wire(H('i25'), H('bn26'));
    };
    // ขา GND ของ Pico ต้องอยู่กราวด์เดียวกับวงจร
    for (const [closed, want] of [[true, 'BTN 0'], [false, 'BTN 1']] as const) {
      const b = mk(closed).wire(H(above(pico(''), 'GND.18', 'i')), H('bn22'));
      const r = new Run(b);
      expect(r.until(() => r.console.includes('BTN'))).toBe(true);
      expect(r.console).toContain(want);
    }
  });

  it('ADC: วงแบ่งแรงดัน 10k/10k จาก 3V3 → GP26 อ่าน ≈ 32768 (±1%)', () => {
    const b = pico('from machine import ADC\nprint("ADC", ADC(26).read_u16())\n');
    // 3V3 (ขา 36) อยู่แถว h คอลัมน์ 9; GP26 (ขา 31) คอลัมน์ 14; GND.38 คอลัมน์ 7
    b.part('resistor', onBoard(below(b, '3V3', 'a')), 'R1', { resistance: 10000, span: 5 }) // j9–j14
      .part('resistor', onBoard(below(b, 'GP26', 'b')), 'R2', { resistance: 10000, span: 6 }) // i14–i20
      .wire(H('a20'), H('tn20')).wire(H(below(b, 'GND.38', 'a')), H('tn8'));
    const r = new Run(b);
    expect(r.until(() => r.console.includes('ADC'))).toBe(true);
    const v = Number(/ADC (\d+)/.exec(r.console)![1]);
    expect(Math.abs(v / 32768 - 1)).toBeLessThan(0.01);
  });

  it('PWM 25% ที่ 1 kHz: duty ที่วัดได้ ≈ 0.25 และกระแส LED เฉลี่ย ≈ 0.25 × กระแสขณะติด', () => {
    const b = pico('from machine import Pin, PWM\np=PWM(Pin(15))\np.freq(1000)\np.duty_u16(16384)\n');
    b.part('resistor', onBoard(above(b, 'GP15', 'j')), 'R1', { resistance: 220, span: 4 })
      .part('led', onBoard('i28'), 'LED1')
      .wire(H('h29'), H('bn29')).wire(H(above(b, 'GND.18', 'j')), H('bn22'));
    const r = new Run(b);
    expect(r.until(() => (r.last.mcu?.[0].duty[15] ?? 0) > 0.1, 5, 0.05)).toBe(true);
    r.step(0.05);
    const duty = r.last.mcu![0].duty[15];
    expect(Math.abs(duty - 0.25)).toBeLessThan(0.01);
    const Iavg = r.last.result.elements['LED1'].current;
    expect(Iavg).toBeGreaterThan(0.9e-3);
    expect(Iavg).toBeLessThan(1.5e-3);
  });

  it('สายต่อ GP2 → GP3: ขาออกถูกอ่านกลับที่ขาเข้าทันที (ไม่มีความหน่วง)', () => {
    const b = pico('from machine import Pin\no=Pin(2,Pin.OUT)\ni=Pin(3,Pin.IN)\nres=[]\nfor v in (1,0,1):\n  o.value(v)\n  res.append(i.value())\nprint("LOOP", res)\n');
    b.wire(H(above(b, 'GP2')), H(above(b, 'GP3')));
    const r = new Run(b);
    expect(r.until(() => r.console.includes('LOOP'))).toBe(true);
    expect(r.console).toContain('LOOP [1, 0, 1]');
  });

  it('วงจรมีตัวเก็บประจุ: GP15 → 10 kΩ → 1 µF, ADC วัดแรงดันหลัง 10 ms ตรงกับ 1 − e^(−t/RC) (±2%)', () => {
    const b = pico('from machine import Pin, ADC\nimport time\na=ADC(26)\np=Pin(15,Pin.OUT,value=0)\ntime.sleep_ms(50)\np.on()\ntime.sleep_ms(10)\nprint("VC", a.read_u16())\n');
    // GP15 (แถว c คอลัมน์ 24) → R a24–a28 → จุด X (คอลัมน์ 28 บน) → สายไป GP26 (แถว h คอลัมน์ 14) และ C b28–b30 → tn30
    b.part('resistor', onBoard(above(b, 'GP15', 'j')), 'R1', { resistance: 10000, span: 4 })
      .part('capacitor', onBoard('i28'), 'C1', { capacitance: 1e-6, polarized: false, span: 2 })
      .wire(H('h30'), H('bn30')).wire(H(above(b, 'GND.18', 'j')), H('bn22'))
      .wire(H('g28'), H(below(b, 'GP26', 'a')));
    const r = new Run(b);
    expect(r.until(() => r.console.includes('VC'), 5, 0.02)).toBe(true);
    const v = Number(/VC (\d+)/.exec(r.console)![1]) / 65535;
    const want = 1 - Math.exp(-0.010 / (10080 * 1e-6));
    expect(Math.abs(v / want - 1)).toBeLessThan(0.02);
  });

  it('หยุดโปรแกรม (Ctrl-C) → KeyboardInterrupt แล้วกลับ REPL', () => {
    const r = new Run(pico('import time\nwhile True:\n  time.sleep(0.1)\n'));
    r.step(0.5);
    r.step(0.1, false, { PICO1: { stop: true } });
    expect(r.until(() => r.console.includes('KeyboardInterrupt'))).toBe(true);
    const ok = r.until(() => r.console.trimEnd().endsWith('>>>'));
    expect(ok, JSON.stringify(r.console.slice(-200))).toBe(true);
  });
});

describe('แลป 12: ตรวจจากพฤติกรรมของวงจร', () => {
  const BUTTON = 'from machine import Pin\nimport time\nled=Pin(15,Pin.OUT)\nbtn=Pin(14,Pin.IN,Pin.PULL_UP)\nwhile True:\n  led.value(not btn.value())\n  time.sleep_ms(5)\n';
  const BLINK = 'from machine import Pin\nimport time\nl=Pin(15,Pin.OUT)\nwhile True:\n  l.toggle()\n  time.sleep(0.2)\n';
  const build = (code: string, closed: boolean) => {
    const b = pico(code);
    b.part('resistor', onBoard(above(b, 'GP15', 'j')), 'R1', { resistance: 220, span: 4 })
      .part('led', onBoard('i28'), 'LED1')
      .part('switch', onBoard(above(b, 'GP14', 'i')), 'S1', { closed }) // b23–b25 (แถว d–g อยู่ใต้ตัวบอร์ด)
      .wire(H('h29'), H('bn29')).wire(H(above(b, 'GND.18', 'j')), H('bn22')).wire(H('j25'), H('bn26'));
    return b.doc;
  };
  /** จำลองโดยเปลี่ยนสถานะสวิตช์ระหว่างทาง (บอร์ดตัวเดิม) และสะสมเป้าหมายที่เคยผ่านเหมือนในแอป */
  function session(code: string, states: boolean[]) {
    const e = new SimEngine();
    const work = emptyWork();
    work.achieved.pico = {};
    let first = true;
    let st: Record<string, { pass: boolean }> = {};
    for (const closed of states) {
      const doc: CircuitDoc = build(code, closed);
      const built = buildNetlist(doc);
      for (let k = 0; k < 12; k++) {
        const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0.05, restart: first, watch: [], budgetMs: 1e9 });
        first = false;
        st = checkLesson('pico', { doc, built, result: r.result, analysis: analyze(doc, built, r.result), work });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.pico[g] = true;
      }
    }
    return { st, ach: work.achieved.pico };
  }
  it('ไฟกะพริบ: ผ่าน wiring/on/off แต่ข้อ "ทำตามปุ่ม" ไม่ผ่าน', () => {
    const { ach } = session(BLINK, [false, false, true, true]);
    expect(ach.wiring && ach.on && ach.off && ach.button).toBe(true);
    expect(ach.follow).toBeFalsy();
  });
  it('โค้ดอ่านปุ่ม: กด → ติด, ปล่อย → ดับ → ผ่านข้อ "ทำตามปุ่ม"', () => {
    const { ach } = session(BUTTON, [false, false, true, true, false]);
    expect(ach.follow).toBe(true);
  });
  it('ใช้ปุ่มกด 6 × 6 mm คร่อมร่อง (f25): ตรวจผ่าน "ทำตามปุ่ม" เหมือนสวิตช์เลื่อน', () => {
    const buildBtn = (pressed: boolean) => {
      const b = pico(BUTTON);
      b.part('resistor', onBoard(above(b, 'GP15', 'j')), 'R1', { resistance: 220, span: 4 })
        .part('led', onBoard('i28'), 'LED1')
        .part('pushbutton', onBoard('f25'), 'SW1', { pressed }) // ขา 1 f25, 2 e25, 3 f27, 4 e27
        .wire(H('h29'), H('bn29')).wire(H(above(b, 'GND.18', 'j')), H('bn22'))
        .wire(H(above(b, 'GP14', 'j')), H('j25')).wire(H('j27'), H('bn27'));
      return b.doc;
    };
    const e = new SimEngine();
    const work = emptyWork(); work.achieved.pico = {};
    let first = true;
    const leds: number[] = [];
    for (const pressed of [false, false, true, true, false]) {
      const doc = buildBtn(pressed);
      const built = buildNetlist(doc);
      for (let k = 0; k < 12; k++) {
        const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0.05, restart: first, watch: [], budgetMs: 1e9 });
        first = false;
        const an = analyze(doc, built, r.result);
        if (k === 11) leds.push(an.parts['LED1'].current);
        const st = checkLesson('pico', { doc, built, result: r.result, analysis: an, work });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.pico[g] = true;
      }
    }
    expect(leds[1]).toBeLessThan(1e-5);
    expect(leds[3]).toBeGreaterThan(1e-3);
    expect(leds[4]).toBeLessThan(1e-5);
    expect(work.achieved.pico.button && work.achieved.pico.follow).toBe(true);
  });
});


describe('การวาง Pico บนเบรดบอร์ด', () => {
  it('ขา 1–20 แถว c, ขา 21–40 แถว h; GND ทุกขาเป็นเน็ตเดียว; รูใต้ PCB (แถว d–g) เสียบไม่ได้', () => {
    const b = pico('');
    expect(hole(b, 'GP0')).toBe('h5');
    expect(hole(b, 'GP15')).toBe('h24');
    expect(hole(b, 'VBUS')).toBe('c5');
    expect(hole(b, 'GP16')).toBe('c24');
    const c = buildNetlist(b.doc).connectivity;
    const nets = new Set(['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38', 'AGND'].map((p) => c.netOf.get(`PICO1:${p}`)));
    expect(nets.size).toBe(1);
    expect(() => b.part('resistor', onBoard('f10'), 'R9')).toThrow(/ใต้ตัวบอร์ด/);
    expect(() => b.wire(H('e12'), H('bn12'))).toThrow(/ตัวบอร์ด/);
    expect(() => new Builder().part('resistor', onBoard('f10'), 'R9').part('pico', onBoard('h5'), 'PICO1')).toThrow(/ปิดทับ/);
  });
});

describe('schema 7: ลำดับขาตรงกับอุปกรณ์จริง', () => {
  it('มองจากด้านบน ขา Pico เรียงทวนเข็มนาฬิกา (ขา 1 → 20 → 21 → 40) และ DIP-8 ก็เช่นกัน', () => {
    // พิกัดกริด: x = คอลัมน์ (ขวา), y = แถว (a อยู่ไกล/บนจอ, j อยู่ใกล้/ล่างจอ) — ทวนเข็มนาฬิกาบนจอ = ผลคูณไขว้เป็นลบในระบบ y ชี้ลง
    const area = (pts: Array<[number, number]>) => pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0);
    const pos = (b: Builder, id: string, pin: string) => { const h = pinHolesFor(b.doc.parts.find((p) => p.id === id)!).find((x) => x.pin === pin)!.hole!; return [Number(h.slice(1)), 'abcdefghij'.indexOf(h[0])] as [number, number]; };
    const b = pico('').part('opamp', onBoard('f27'), 'U1');
    expect(area([pos(b, 'PICO1', 'GP0'), pos(b, 'PICO1', 'GP15'), pos(b, 'PICO1', 'GP16'), pos(b, 'PICO1', 'VBUS')])).toBeLessThan(0);
    expect(area([pos(b, 'U1', 'NC1'), pos(b, 'U1', 'V-'), pos(b, 'U1', 'NC5'), pos(b, 'U1', 'NC8')])).toBeLessThan(0);
  });
  it('ไฟล์รุ่น 6: ตัวอุปกรณ์อยู่ตำแหน่งเดิม (anchor ย้ายไปแถวอีกฝั่ง) พร้อมคำเตือนให้ตรวจสาย', () => {
    const b = pico('');
    const doc = JSON.parse(JSON.stringify(b.doc));
    doc.parts[0].placement.anchor = 'c5';
    doc.parts.push({ id: 'U1', label: 'U1', kind: 'opamp', placement: { kind: 'board', boardId: 'bb1', anchor: 'e27', rotation: 0 }, params: b.doc.parts[0].params && { model: 'LM741', gain: 2e5, outputResistance: 75, headroom: 1.5, maxSupply: 36, inputResistance: 2e6, quiescentResistance: 14e3 } });
    const r = validateProjectFile({ format: 'circuitlab3d', schemaVersion: 6, app: 't', savedAt: '', title: 't', circuit: doc, studentWork: emptyWork() });
    expect(r.ok, r.errors.join()).toBe(true);
    const parts = r.file!.circuit.parts;
    expect((parts.find((p) => p.id === 'PICO1')!.placement as { anchor: string }).anchor).toBe('h5');
    expect((parts.find((p) => p.id === 'U1')!.placement as { anchor: string }).anchor).toBe('f27');
    expect(r.warnings.join()).toMatch(/ลำดับขา/);
  });
});

describe('โมเดล 3 มิติของ Pico ตรงกับขาที่ใช้คำนวณ', () => {
  it('ตำแหน่งขาในโมเดล (mm ตามแบบบอร์ดจริง) ÷ 2.54 = ระยะรูของ pinDefs ทุกขา', async () => {
    const { picoPinUV } = await import('../src/render/pico-model');
    const { pinDefs } = await import('../src/model/catalog');
    const b = pico('');
    const defs = pinDefs(b.doc.parts[0]);
    defs.forEach((d, k) => {
      const [u, v] = picoPinUV(k + 1);
      // พิกัดโลกของโมเดล: x = v − 1.37, z = 1.61 − u (mm) → หน่วยรู
      expect(Math.abs((v - 1.37) / 2.54 - d.dx)).toBeLessThan(1e-9);
      expect(Math.abs((1.61 - u) / 2.54 - d.dy)).toBeLessThan(1e-9);
    });
    // ระยะระหว่างแถว 17.78 mm = 7 รู, บอร์ดกว้าง 21 mm ยาว 51 mm
    expect(picoPinUV(40)[0] - picoPinUV(1)[0]).toBeCloseTo(17.78, 6);
  });
});

describe('Pico ADC อ่านแรงดันจาก VR', () => {
  it('VR 10 kΩ คร่อม 3V3–GND แกนกลางเข้า GP26: read_u16 ≈ 65535·V(แกนกลาง)/3.3 ทุกตำแหน่ง (±1%)', () => {
    for (const p of [0.2, 0.5, 0.8]) {
      const b = pico('from machine import ADC\nimport time\ntime.sleep_ms(20)\nprint("ADC", ADC(26).read_u16())\n');
      b.part('potentiometer', onBoard('e26'), 'VR1', { resistance: 10000, position: p }) // ขา 1 e26, 2 e27, 3 e28
        .wire(H(below(b, '3V3', 'a')), H('a26')).wire(H('a28'), H(below(b, 'GND.38', 'a'))).wire(H('a27'), H(below(b, 'GP26', 'a')));
      const r = new Run(b);
      expect(r.until(() => r.console.includes('ADC'))).toBe(true);
      const v = Number(/ADC (\d+)/.exec(r.console)![1]);
      r.step(0.1); r.step(0.1); // ผลที่แสดงเป็นค่าเฉลี่ยตามเวลาของช่วงล่าสุด — ให้พ้นช่วงบูตที่ขายังมี pull-down ตามค่าเริ่มต้นของ RP2040
      const built = buildNetlist(b.doc);
      const an = analyze(b.doc, built, r.last.result);
      const vw = an.parts['VR1'].extra!.v23; // ขา 3 = GND
      expect(Math.abs(vw / an.parts['VR1'].extra!.v13 - (1 - p))).toBeLessThan(0.001); // 3V3 ของบอร์ดตกเล็กน้อยตามโหลด
      expect(Math.abs(v / 65535 - vw / 3.3)).toBeLessThan(0.01);
    }
  });
});

describe('Pico PWM ขับบัซเซอร์แบบไม่มีวงจร', () => {
  it('PWM 1 kHz 50% ที่ GP15 → บัซเซอร์ 42 Ω: ดังที่ 1 kHz (±1%) จากเหตุการณ์ขาเปลี่ยนสถานะ', async () => {
    const { buzzerParamsFor } = await import('../src/model/catalog');
    const b = pico('from machine import Pin, PWM\np=PWM(Pin(15))\np.freq(1000)\np.duty_u16(32768)\n');
    b.part('buzzer', onBoard(above(b, 'GP15', 'j')), 'BZ1', buzzerParamsFor('passive')) // + j24, − j27
      .wire(H('i27'), H('bn27')).wire(H(above(b, 'GND.18', 'j')), H('bn22'));
    const r = new Run(b);
    expect(r.until(() => (r.last.mcu?.[0].duty[15] ?? 0) > 0.3, 5, 0.05)).toBe(true);
    r.step(0.05); r.step(0.05);
    const t = r.last.tones!.BZ1;
    expect(Math.abs(t.freq! / 1000 - 1)).toBeLessThan(0.01);
    const an = analyze(b.doc, buildNetlist(b.doc), r.last.result, r.last.tones);
    expect(an.parts['BZ1'].extra!.sounding).toBe(1);
    // กระแสขณะ HIGH ≈ 3.3 / (80 + 42) — เกินที่ขา GPIO ควรจ่าย
    expect(t.iac * 2).toBeGreaterThan(0.024);
  });
});

describe('Pico ขับตัวแสดงผล 7 ส่วน', () => {
  it('GP2–GP6 → 220 Ω → ส่วน a, b, c, d, g (แคโทดร่วม ที่ h25): แสดงเลข 3 และแลป 18 ผ่าน common/resistor/digit', async () => {
    const { sevenSegParamsFor } = await import('../src/model/catalog');
    const b = pico('from machine import Pin\nfor p in (2,3,4,5,6):\n  Pin(p, Pin.OUT, value=1)\nprint("OK")\n');
    // ขา DS1: E h25, D h26, COM h27, C h28, DP h29 · B d29, A d28, COM d27, F d26, G d25
    b.part('sevenseg', onBoard('h25'), 'DS1', sevenSegParamsFor('cc'))
      .wire(H('j27'), H(above(b, 'GND.8', 'j')));
    const segs: Array<[string, string, string]> = [['GP2', 'RA', 'a28'], ['GP3', 'RB', 'a29'], ['GP4', 'RC', 'j28'], ['GP5', 'RD', 'j26'], ['GP6', 'RG', 'a25']];
    segs.forEach(([gp, id, hole], k) => {
      b.part('resistor', onTable(-12, 20 + k * 3), id, { resistance: 220, span: 4 })
        .wire(H(above(b, gp, 'j')), P(id, '1')).wire(P(id, '2'), H(hole));
    });
    const r = new Run(b);
    expect(r.until(() => r.console.includes('OK'))).toBe(true);
    r.step(0.05); r.step(0.05);
    const built = buildNetlist(b.doc);
    const an = analyze(b.doc, built, r.last.result);
    const x = an.parts['DS1'].extra!;
    expect(String.fromCharCode(x.digit)).toBe('3');
    expect(x.i_a).toBeGreaterThan(3e-3);
    expect(x.i_a).toBeLessThan(6e-3);
    const st = checkLesson('sevenseg', { doc: b.doc, built, result: r.last.result, analysis: an, work: emptyWork() });
    for (const k of ['common', 'resistor', 'digit']) expect(st[k].pass, `${k}: ${st[k].detail}`).toBe(true);
  });
});
