import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { setPartParams } from '../src/editor/ops';
import { LESSONS } from '../src/lessons/lessons';
import { CATALOG, pinDefs, picoFunctions } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { compileWrapper, parseMpError } from '../src/mcu/mp-error';
import { emptyWork, type CircuitDoc } from '../src/model/types';
import { P } from './helpers';
import { ADCPWM_CODE, adcRig, runAdc } from './adcpwm-rig';

const lastAdc = (con: string) => { const m = [...con.matchAll(/ADC = (\d+) {2}V = ([\d.]+)/g)]; return m.length ? [Number(m[m.length - 1][1]), Number(m[m.length - 1][2])] : null; };

describe('ชุดแรก Pico: VR → ADC → PWM, คอมไพล์/ชี้บรรทัด, ขาและระดับการรองรับ', () => {
  it('ADC อ่านตามตำแหน่ง VR และกระแสเฉลี่ย LED แปรตาม duty (PWM 1 kHz)', { timeout: 200000 }, () => {
    const rows = [0.2, 0.5, 0.9].map((pos) => { const x = runAdc(adcRig({ pos }), 1.5); return { pos, adc: lastAdc(x.con), i: x.an.parts.LED1.current! }; });
    for (const r of rows) {
      expect(Math.abs(r.adc![0] / 65535 - r.pos)).toBeLessThan(0.01);
      expect(Math.abs(r.adc![1] - r.pos * 3.3)).toBeLessThan(0.02);
    }
    const k = rows[2].i / rows[2].pos;
    for (const r of rows) expect(Math.abs(r.i / (r.pos * k) - 1)).toBeLessThan(0.05);
    expect(rows[2].i).toBeGreaterThan(3.5e-3); expect(rows[2].i).toBeLessThan(5.5e-3);
  });
  it('ข้อผิดพลาดขณะรันชี้บรรทัด: ADC(15) → ValueError บรรทัด 3 · คอมไพล์ด้วยเฟิร์มแวร์: ลืม : → SyntaxError บรรทัด 6 · โค้ดถูก → ผ่าน', { timeout: 200000 }, () => {
    const a = runAdc(adcRig({ code: ADCPWM_CODE.replace('ADC(26)', 'ADC(15)') }), 1.5);
    expect(a.fin?.ok).toBe(false);
    expect(parseMpError(a.fin!.error!)).toEqual({ line: 3, message: "ValueError: Pin doesn't have ADC capabilities" });
    const bad = ADCPWM_CODE.replace('while True:', 'while True');
    const b = runAdc(adcRig({ code: compileWrapper(bad) }), 1.5);
    expect(b.fin?.ok).toBe(false);
    expect(parseMpError(b.fin!.error!)).toEqual({ line: 6, message: 'SyntaxError: invalid syntax' });
    const c = runAdc(adcRig({ code: compileWrapper(ADCPWM_CODE) }), 1.5);
    expect(c.fin?.ok).toBe(true);
    expect(c.con).toContain('คอมไพล์ผ่าน: 11 บรรทัด');
    expect(c.an.parts.LED1.current ?? 0).toBeLessThan(1e-6); // คอมไพล์อย่างเดียว ไม่รัน — LED ไม่ติด
    expect(parseMpError('Traceback (most recent call last):\r\n  File "<stdin>", line 8, in <module>\r\nKeyboardInterrupt: \r\n')).toBeNull();
  });
  it('แลป 42: VR 20% → 80% พร้อมโพรบที่แกนกลาง ผ่านครบ 5 ข้อ · VR ต่อ VBUS → ไม่ผ่านพร้อมเหตุผล', { timeout: 200000 }, () => {
    expect(LESSONS.find((l) => l.id === 'adcpwm')?.number).toBe(42);
    const doc0 = adcRig({ pos: 0.2 }).probe(P('VR1', '2'), P('PICO1', 'GND.38')).doc;
    const e = new SimEngine();
    const work = emptyWork(); work.achieved.adcpwm = {};
    let k = 0;
    for (const pos of [0.2, 0.8]) {
      const r0 = setPartParams(doc0, 'VR1', { position: pos }); if (!r0.ok) throw new Error();
      const doc: CircuitDoc = r0.doc, built = buildNetlist(doc);
      for (let i = 0; i < 15; i++) {
        const r = e.handle({ seq: ++k, netlist: built.netlist, advance: 0.1, restart: k === 1, watch: [], budgetMs: 1e9 });
        const an = analyze(doc, built, r.result, r.tones);
        const st = checkLesson('adcpwm', { doc, built, result: r.result, analysis: an, work });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.adcpwm[g] = true;
      }
    }
    for (const g of ['pot', 'adc', 'led', 'measure', 'pwm']) expect(work.achieved.adcpwm[g], g).toBe(true);
    const v = adcRig({ vcc: 'VBUS' });
    let st: Record<string, { pass: boolean; detail?: string }> = {};
    runAdc(v, 0.3, 0.1, (_t, an, result, built) => { st = checkLesson('adcpwm', { doc: v.doc, built, result, analysis: an, work: emptyWork() }); });
    expect(st.pot.pass).toBe(false); expect(st.pot.detail).toContain('VBUS');
  });
  it('ขา Pico แสดงหน้าที่ตามตาราง function select ของ RP2040 (ตรวจกับแผนภาพขา) · ระดับการรองรับครบทุกชนิดในคลัง', () => {
    // ตรวจกับตารางขาของ Pico (pinout): GP15 = SPI1 TX / I2C1 SCL / UART0 RTS / PWM7 B, GP20 = SPI0 RX / I2C0 SDA / UART1 TX / PWM2 A,
    // GP22 = SPI0 SCK / I2C1 SDA / UART1 CTS / PWM3 A, GP26 = ADC0 / SPI1 SCK / I2C1 SDA / UART1 CTS / PWM5 A, GP28 = ADC2 / SPI1 RX / I2C0 SDA / UART0 TX / PWM6 A
    expect(picoFunctions(15)).toEqual(['PWM7B', 'I2C1 SCL', 'SPI1 TX', 'UART0 RTS']);
    expect(picoFunctions(20)).toEqual(['PWM2A', 'I2C0 SDA', 'SPI0 RX', 'UART1 TX']);
    expect(picoFunctions(22)).toEqual(['PWM3A', 'I2C1 SDA', 'SPI0 SCK', 'UART1 CTS']);
    expect(picoFunctions(26)).toEqual(['ADC0', 'PWM5A', 'I2C1 SDA', 'SPI1 SCK', 'UART1 CTS']);
    expect(picoFunctions(28)).toEqual(['ADC2', 'PWM6A', 'I2C0 SDA', 'SPI1 RX', 'UART0 TX']);
    expect(picoFunctions(12)).toEqual(['PWM6A', 'I2C0 SDA', 'SPI1 RX', 'UART0 TX']);
    const defs = pinDefs({ kind: 'pico', id: 'P', label: 'P', placement: { kind: 'table', x: 0, z: 0, rotation: 0 }, params: {} } as never);
    expect(defs.find((d) => d.name === 'GP15')!.label).toBe('ขา 20 GP15 (PWM7B · I2C1 SCL · SPI1 TX · UART0 RTS)');
    expect(defs.find((d) => d.name === 'GP0')!.label).toContain('REPL');
    for (const c of CATALOG) expect(SUPPORT[c.kind], c.kind).toBeDefined();
    expect(supportSummary(SUPPORT.esp32).text).toBe('ยังไม่รองรับ');
    expect(supportSummary(SUPPORT.sonar).text).toBe('จำลองครบ');
    expect(supportSummary(SUPPORT.soilsensor).text).toBe('จำลองบางส่วน');
  });
  it('โค้ดวนไม่สิ้นสุด (while True: pass) ไม่ทำให้คำขอค้าง: แต่ละรอบคืนผลภายในงบเวลา · หยุด (Ctrl-C) → KeyboardInterrupt ไม่ถือเป็นข้อผิดพลาดของโค้ด → REPL กลับมา', { timeout: 120000 }, () => {
    const b = adcRig({ code: 'x = 0\nwhile True:\n    x += 1\n' });
    const e = new SimEngine(); const built = buildNetlist(b.doc);
    let con = '', fin: { ok: boolean; error?: string } | null = null, worst = 0;
    for (let k = 0; k < 40; k++) {
      const t0 = performance.now();
      const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 40, ...(k === 30 ? { mcu: { PICO1: { stop: true } } } : {}) });
      if (k > 5) worst = Math.max(worst, performance.now() - t0);
      con += r.mcu?.[0]?.console ?? '';
      if (r.mcu?.[0]?.finished) fin = r.mcu[0].finished;
    }
    expect(worst).toBeLessThan(400); // งบ 40 ms + โอเวอร์เฮด — ไม่วนค้างในคำขอ
    expect(fin?.ok).toBe(false);
    expect(fin?.error).toContain('KeyboardInterrupt');
    expect(parseMpError(fin!.error!)).toBeNull();
    expect(con.trimEnd().endsWith('>>>')).toBe(true);
  });
});
