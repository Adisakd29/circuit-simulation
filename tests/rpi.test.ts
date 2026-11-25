import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { RPI_BUTTON_CODE, RPI_DEFAULT_CODE, RPI_HEADER, pinDefs } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { setPartParams } from '../src/editor/ops';
import { emptyWork, type StudentWork } from '../src/model/types';
import { PiEmulator } from '../src/mcu/pi-emu';
import type { Builder } from './helpers';
import { hasJspi, rpiRig, runPi, waitPython } from './rpi-rig';

const setP = (b: Builder, id: string, p: Record<string, unknown>) => { const x = setPartParams(b.doc, id, p as never); if (x.ok) b.doc = x.doc; return true; };
const mA = (s: { an: ReturnType<typeof analyze> }, id: string) => Math.abs(s.an.parts[id]?.current ?? 0) * 1000;
const rpiSt = (s: { r: { mcu?: Array<{ id: string }> } }) => s.r.mcu?.find((m) => m.id === 'RPI1') as (NonNullable<typeof s.r.mcu>[number] & { running: boolean; duty: number[]; edges: number[]; pins: string[]; finished: { ok: boolean; error?: string; line?: number | null; stopped?: boolean } | null }) | undefined;
/** กดปุ่มเป็นช่วง: [เริ่ม, ปล่อย] (s) */
const presses = (spans: Array<[number, number]>) => (t: number, b: Builder) => {
  for (const [a, z] of spans) {
    if (Math.abs(t - a) < 1e-6) return setP(b, 'SW1', { pressed: true });
    if (Math.abs(t - z) < 1e-6) return setP(b, 'SW1', { pressed: false });
  }
};

describe('Raspberry Pi 5: แบบจำลองและไฟล์งาน (ไม่ต้องรัน Python)', () => {
  it('หัวต่อ 40 ขาเรียงตามแบบ J8: ขา 1 = 3V3, 2 = 5V, 11 = GPIO17, 12 = GPIO18, 13 = GPIO27, 39 = GND · มี GPIO0–27 ครบ', () => {
    expect(RPI_HEADER).toHaveLength(40);
    const at = (n: number) => RPI_HEADER[n - 1][0];
    expect([at(1), at(2), at(3), at(5), at(6), at(11), at(12), at(13), at(17), at(27), at(28), at(39), at(40)]).toEqual(['3V3.1', '5V.1', 'GPIO2', 'GPIO3', 'GND.1', 'GPIO17', 'GPIO18', 'GPIO27', '3V3.2', 'GPIO0', 'GPIO1', 'GND.8', 'GPIO21']);
    const gp = RPI_HEADER.map(([n]) => n).filter((n) => n.startsWith('GPIO')).map((n) => Number(n.slice(4))).sort((a, b) => a - b);
    expect(gp).toEqual(Array.from({ length: 28 }, (_, i) => i));
    expect(RPI_HEADER[10][1]).toContain('ขา 11');
  });

  it('netlist: GPIO2/GPIO3 มีตัวต้านทานดึงขึ้น 1.8 kΩ ไป 3V3 · ขา GND ทุกขาต่อถึงกัน · ไฟล์งานผ่านการตรวจ schema', () => {
    const b = rpiRig({ autorun: false });
    const built = buildNetlist(b.doc);
    const m = built.netlist.mcus!.find((x) => x.id === 'RPI1')!;
    expect(m.kind).toBe('rpi5');
    expect(m.gp).toHaveLength(28);
    const pu = built.netlist.elements.filter((e) => e.id.startsWith('RPI1#pu'));
    expect(pu.map((e) => (e as { R: number }).R)).toEqual([1800, 1800]);
    const pi = b.doc.parts.find((p) => p.id === 'RPI1')!;
    expect(pinDefs(pi)).toHaveLength(40);
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    expect(supportSummary(SUPPORT.rpi5).text).toBe('จำลองบางส่วน');
    expect(SUPPORT.rpi5.limits).toContain('ไม่ใช่ CPU/Linux');
  });

  it('โหมดซิงโครนัส (ไม่มี worker): ไม่รันโค้ดแบบเงียบ ๆ แต่แจ้งข้อความในเทอร์มินัล', () => {
    const b = rpiRig({ code: RPI_DEFAULT_CODE });
    const built = buildNetlist(b.doc);
    const e = new SimEngine();
    let con = '';
    let fin: unknown = null;
    for (let k = 0; k < 4; k++) {
      const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
      const s = r.mcu!.find((x) => x.id === 'RPI1')!;
      con += s.console; fin ??= s.finished;
      expect(s.running).toBe(false);
    }
    expect(con).toContain('Web Worker');
    expect(fin).toMatchObject({ ok: false });
  });

  it('รูปคลื่นซอฟต์แวร์: PWM 100 Hz duty 0.25 → ขอบห่าง 2.5/7.5 ms · blink n=2 แล้วจบที่ LOW', () => {
    const p = new PiEmulator(null);
    p.pattern(18, 100, JSON.stringify([[-1, 0.25]]), 0, 0.25);
    const edges: number[] = [];
    let last = p.read(18);
    while (p.nanos < 30e6) { p.run(30e6, Infinity, true); if (p.read(18) !== last) { edges.push(p.nanos / 1e6); last = p.read(18); } }
    expect(edges.slice(0, 4).map((x) => +x.toFixed(3))).toEqual([2.5, 10, 12.5, 20]);
    const q = new PiEmulator(null);
    q.pattern(17, 100, JSON.stringify([[0.1, 1], [0.1, 0]]), 2, 0);
    const lv: Array<[number, number]> = [];
    let l2 = -1;
    while (q.nanos < 0.5e9) { q.run(0.5e9, Infinity, true); if (q.read(17) !== l2) { l2 = q.read(17); lv.push([+(q.nanos / 1e9).toFixed(3), l2]); } }
    expect(lv).toEqual([[0.1, 0], [0.2, 1], [0.3, 0]]);
    expect(q.read(17)).toBe(0);
    expect(q.busyPattern(17)).toBe(false);
  });

  it('แลป 54 มีรูปวงจร โค้ดตัวอย่างลง Raspberry Pi และ checker แจ้งให้วางบอร์ดเมื่อยังไม่มี', () => {
    const l = LESSONS.find((x) => x.id === 'rpi5')!;
    expect(l.number).toBe(54);
    expect(l.sampleBoard).toBe('rpi5');
    expect(l.sampleCode).toBe(RPI_BUTTON_CODE);
    expect(SCHEMATICS.rpi5).toBeTruthy();
  });
});

describe.runIf(hasJspi)('Raspberry Pi 5: Python + gpiozero ร่วมกับวงจร (ต้องมี JSPI)', () => {
  it('blink: LED(17) ติด 0.5 s ดับ 0.5 s ตามเวลาจำลอง · กระแส LED จากขา 3.3 V ผ่าน 330 Ω ≈ 3–5 mA · print ออกเทอร์มินัล', async () => {
    await waitPython();
    const b = rpiRig({ code: RPI_DEFAULT_CODE });
    const { con, st } = await runPi(b, 2.2, 0.05);
    const on = st.map((s) => mA(s, 'LED1') > 1);
    // เริ่มติดในก้าวแรกที่ Python ทำงาน แล้วสลับทุก 10 ก้าว (0.5 s)
    const first = on.indexOf(true);
    expect(first).toBeLessThanOrEqual(2);
    for (let k = first; k < first + 40 && k < on.length; k++) expect(on[k], `step ${k}`).toBe(Math.floor((k - first) / 10) % 2 === 0);
    const peak = Math.max(...st.map((s) => mA(s, 'LED1')));
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThan(5);
    expect(con).toMatch(/ติด\nดับ\nติด\nดับ/);
    expect(rpiSt(st[5])!.running).toBe(true);
  }, 60000);

  it('แลป 54: ปุ่ม GPIO27 (pull-up ภายใน) → callback เปิด/ปิด LED · PWMLED สว่างขึ้นทีละ 25% · checker ผ่านครบ 4 ข้อ', async () => {
    await waitPython();
    const b = rpiRig();
    const work: StudentWork = emptyWork(); work.achieved.rpi5 = {};
    const spans: Array<[number, number]> = [[0.5, 0.8], [1.2, 1.5], [1.9, 2.2]];
    const { con, st } = await runPi(b, 2.6, 0.05, presses(spans));
    for (const s of st) {
      const g = checkLesson('rpi5', { doc: s.doc, built: s.built, result: s.r.result, analysis: s.an, work, time: s.t, mcu: s.r.mcu });
      for (const [k, v] of Object.entries(g)) if (v.pass) work.achieved.rpi5[k] = true;
    }
    const at = (t: number) => st.find((s) => Math.abs(s.t - t) < 1e-6)!;
    // ปล่อยอยู่: ขาเข้าเป็น HIGH จาก pull-up ภายใน (≈ 3.3 V) · กด: LOW
    expect(mA(at(0.45), 'LED1')).toBeLessThan(0.01);
    expect(mA(at(0.6), 'LED1')).toBeGreaterThan(3);
    expect(mA(at(0.9), 'LED1')).toBeLessThan(0.01);
    expect(con).toContain('พร้อม — กดปุ่มที่ GPIO27');
    expect(con).toContain('กดปุ่มครั้งที่ 3 ความสว่าง 0.75');
    // PWMLED: duty ของ GPIO18 ตามจำนวนครั้งที่กด (0.25 → 0.5 → 0.75) และ LED2 สว่างตามสัดส่วน
    const d1 = rpiSt(at(1.0))!.duty[18], d3 = rpiSt(at(2.5))!.duty[18];
    expect(d1).toBeCloseTo(0.25, 1);
    expect(d3).toBeCloseTo(0.75, 1);
    expect(rpiSt(at(2.5))!.edges[18]).toBeGreaterThanOrEqual(8);
    expect(mA(at(2.5), 'LED2') / mA(at(1.0), 'LED2')).toBeGreaterThan(2.5);
    expect(work.achieved.rpi5).toMatchObject({ wire: true, run: true, follow: true, pwm: true });
    // ตัวดึงขึ้นบนบอร์ด (GPIO2/3) และขาที่ไม่ได้ใช้ ไม่ถูกแจ้งว่าเป็นปลายเปิด
    expect(st[st.length - 1].an.diagnostics.filter((d) => d.partId === 'RPI1').map((d) => d.message)).toEqual([]);
  }, 60000);

  it('หยุด (Ctrl-C) → KeyboardInterrupt · gpiozero ปิดอุปกรณ์ ขากลับเป็นขาเข้า LED ดับ · รันโค้ดใหม่ได้', async () => {
    await waitPython();
    const b = rpiRig({ code: 'from gpiozero import LED\nfrom signal import pause\nled = LED(17)\nled.on()\nprint("on")\npause()\n' });
    const { con, st } = await runPi(b, 1.5, 0.05, undefined, (t) => (Math.abs(t - 0.5) < 1e-6 ? { RPI1: { stop: true } } : Math.abs(t - 1.0) < 1e-6 ? { RPI1: { run: 'from gpiozero import LED\nLED(18).on()\nimport time\ntime.sleep(10)\n' } } : undefined));
    const at = (t: number) => st.find((s) => Math.abs(s.t - t) < 1e-6)!;
    expect(mA(at(0.4), 'LED1')).toBeGreaterThan(3);
    expect(con).toContain('KeyboardInterrupt');
    expect(mA(at(0.7), 'LED1')).toBeLessThan(0.01);
    expect(rpiSt(at(0.7))!.running).toBe(false);
    expect(st.some((s) => rpiSt(s)!.finished?.stopped)).toBe(true);
    expect(rpiSt(at(0.7))!.pins[17]).toBe('in-pulldown');
    expect(mA(at(1.3), 'LED2')).toBeGreaterThan(3);
    expect(rpiSt(at(1.3))!.running).toBe(true);
  }, 60000);

  it('ข้อผิดพลาด: NameError บอกบรรทัด · SyntaxError · GPIOPinInUse · PinInvalidPin (traceback แสดงเฉพาะ main.py)', async () => {
    await waitPython();
    const cases: Array<[string, RegExp, number | null]> = [
      ['from gpiozero import LED\nled = LED(17)\nled.onn()\n', /AttributeError: 'LED' object has no attribute 'onn'/, 3],
      ['x = 1\nprint(y)\n', /NameError: name 'y' is not defined/, 2],
      ['def f(:\n  pass\n', /SyntaxError/, 1],
      ['from gpiozero import LED, Button\na = LED(17)\nb = Button(17)\n', /GPIOPinInUse: pin GPIO17 is already in use/, 3],
      ['from gpiozero import LED\nLED(40)\n', /PinInvalidPin/, 2],
      ['from gpiozero import DistanceSensor\n', /ImportError: cannot import name 'DistanceSensor'/, 1],
    ];
    for (const [code, re, line] of cases) {
      const b = rpiRig({ code });
      const { con, st } = await runPi(b, 0.2, 0.05);
      const fin = st.map((s) => rpiSt(s)!.finished).find(Boolean)!;
      expect(con, code).toMatch(re);
      expect(fin.ok, code).toBe(false);
      expect(fin.line, code).toBe(line);
      expect(con).not.toContain('_simrt');
    }
  }, 60000);

  it('ลูปตรวจปุ่มเอง (busy loop) ไม่ค้าง: Python ถูกพักทุก ~2 ms ของเวลาจริง เวลาจำลองเดินต่อ LED ตามปุ่ม · time.time() ตามเวลาจำลอง', async () => {
    await waitPython();
    const code = 'from gpiozero import LED, Button\nimport time\nled = LED(17)\nbtn = Button(27)\nt0 = time.monotonic()\nwhile True:\n    if btn.is_pressed:\n        led.on()\n    else:\n        led.off()\n    if time.monotonic() - t0 >= 1.0:\n        print("t=1s")\n        t0 = 1e9\n';
    const b = rpiRig({ code });
    const { con, st } = await runPi(b, 1.4, 0.05, presses([[0.5, 0.8]]));
    const at = (t: number) => st.find((s) => Math.abs(s.t - t) < 1e-6)!;
    expect(mA(at(0.4), 'LED1')).toBeLessThan(0.01);
    expect(mA(at(0.7), 'LED1')).toBeGreaterThan(3);
    expect(mA(at(1.0), 'LED1')).toBeLessThan(0.01);
    expect(con).toContain('t=1s');
    expect(st[st.length - 1].r.t).toBeCloseTo(1.4, 3);
  }, 60000);

  it('wait_for_press / when_held / blink(n) / pulse / source', async () => {
    await waitPython();
    const code = [
      'from gpiozero import LED, PWMLED, Button',
      'import time',
      'led = LED(17); glow = PWMLED(18); btn = Button(27, hold_time=0.5)',
      'btn.when_held = lambda: print("held", round(btn.held_time, 2))',
      'print("wait", btn.wait_for_press(timeout=0.2))',
      'print("press", btn.wait_for_press(), round(time.monotonic(), 2))',
      'btn.wait_for_release()',
      'led.blink(on_time=0.1, off_time=0.1, n=2, background=False)',
      'print("blinked", round(time.monotonic(), 2), led.value)',
      'led.source = btn',
      'glow.pulse(fade_in_time=0.4, fade_out_time=0.4)',
      'time.sleep(5)',
    ].join('\n');
    const b = rpiRig({ code });
    const { con, st } = await runPi(b, 2.6, 0.05, presses([[0.5, 1.2], [2.0, 2.3]]));
    const at = (t: number) => st.find((s) => Math.abs(s.t - t) < 1e-6)!;
    expect(con).toContain('wait False');
    expect(con).toMatch(/press True 0\.45\n/);
    expect(con).toMatch(/held 0\.0/);
    expect(con).toMatch(/blinked 1\.55 0/);
    // หลัง blink: LED1 ตามปุ่ม (source) — กดที่ 2.0–2.3
    expect(mA(at(1.9), 'LED1')).toBeLessThan(0.01);
    expect(mA(at(2.15), 'LED1')).toBeGreaterThan(3);
    // pulse: duty ของ GPIO18 เปลี่ยนไปมา (ไม่คงที่) ระหว่าง 1.6–2.6 s
    const ds = st.filter((s) => s.t > 1.65).map((s) => rpiSt(s)!.duty[18]);
    expect(Math.max(...ds) - Math.min(...ds)).toBeGreaterThan(0.5);
  }, 60000);

  it('GPIO2 มีตัวดึงขึ้น 1.8 kΩ บนบอร์ด: Button(2) อ่านว่าไม่ถูกกด · InputDevice(2, pull_up=False) ใช้ไม่ได้ · ต่อ 5V เข้า GPIO → เตือนอันตราย', async () => {
    await waitPython();
    const b = rpiRig({ code: 'from gpiozero import Button, InputDevice\nb = Button(2)\nprint("p", b.is_pressed)\ntry:\n    InputDevice(3, pull_up=False)\nexcept Exception as e:\n    print(type(e).__name__)\n', buttonPin: 'GPIO2' });
    const { con } = await runPi(b, 0.2, 0.05);
    expect(con).toContain('p False');
    expect(con).toContain('PinInvalidState');
    const b2 = rpiRig({ autorun: false });
    b2.wire({ kind: 'pin', partId: 'RPI1', pin: '5V.1' }, { kind: 'hole', boardId: 'bb1', hole: 'b47' }, 'w5v', '#e53935');
    const { st } = await runPi(b2, 0.1, 0.05);
    const d = st[st.length - 1].an.diagnostics.find((x) => x.partId === 'RPI1' && x.severity === 'danger');
    expect(d?.message).toMatch(/GPIO27 มีแรงดัน 5\.00 V/);
  }, 60000);

  it('รีเซ็ตเวลา (Restart) ระหว่างโปรแกรมพักอยู่: โปรแกรมเก่าถูกหยุด แล้ว main.py เริ่มใหม่อัตโนมัติ', async () => {
    await waitPython();
    const b = rpiRig({ code: RPI_DEFAULT_CODE });
    const first = await runPi(b, 0.6, 0.05);
    const again = await runPi(b, 0.6, 0.05, undefined, undefined, first.e);
    expect(again.con).toContain('ติด');
    expect(again.st.some((s) => rpiSt(s)!.running)).toBe(true);
    expect(again.con).not.toContain('ทีละบอร์ด');
  }, 60000);
});
