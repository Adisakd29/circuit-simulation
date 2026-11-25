import { describe, expect, it } from 'vitest';
import inaHex from './fixtures/uno/ina219.hex?raw';
import i2claHex from './fixtures/uno/i2cla.hex?raw';
import { UNO_I2C_LA_CODE } from '../src/model/catalog';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork, type LogicAnalyzerPart } from '../src/model/types';
import { laAnalyze, laWindow } from '../src/ui/la-panel';
import { I2cWave } from '../src/mcu/i2c-wave';
import { LogicBuffer, decodeI2c, i2cText, measurePwm, type LogicTrace } from '../src/instruments/logic';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * I²C ฮาร์ดแวร์: รูปคลื่น SDA/SCL ตามคาบ SCL ของชิป + ตัวถอดรหัส · Uno TWI ใช้เวลาเท่าบัสจริง (CPU ได้รับแจ้ง "เสร็จ" หลัง 9 คาบต่อไบต์)
 */
function traces(w: I2cWave): { sda: Pick<LogicTrace, 'lvl0' | 't' | 'v'>; scl: Pick<LogicTrace, 'lvl0' | 't' | 'v'> } {
  const sda = { lvl0: 1 as const, t: [] as number[], v: [] as Array<0 | 1> }, scl = { lvl0: 1 as const, t: [] as number[], v: [] as Array<0 | 1> };
  for (const e of w.take()) { const tr = e.line === 'sda' ? sda : scl; tr.t.push(e.t); tr.v.push(e.v); }
  return { sda, scl };
}

describe('รูปคลื่น I²C + ตัวถอดรหัส (ฟังก์ชันล้วน)', () => {
  it('S 0x40 W ACK · 0x00 ACK · Sr 0x40 R ACK · 0x12 ACK · 0x34 NACK · P — ถอดกลับได้ครบ · SDA เปลี่ยนเฉพาะตอน SCL ต่ำ', () => {
    const w = new I2cWave(), T = 10e-6;
    let t = 0;
    t += w.start(t, T); t += w.byte(t, T, 0x80, true); t += w.byte(t, T, 0x00, true);
    t += w.start(t, T); t += w.byte(t, T, 0x81, true); t += w.byte(t, T, 0x12, true); t += w.byte(t, T, 0x34, false); t += w.stop(t, T);
    expect(t).toBeCloseTo((0.5 + 9 + 9 + 1.5 + 9 + 9 + 9 + 1) * T, 12);
    const { sda, scl } = traces(w);
    const f = decodeI2c(sda, scl);
    expect(i2cText(f)).toBe('S 0x40 W ACK 0x00 ACK Sr 0x40 R ACK 0x12 ACK 0x34 NACK P\n');
    // SDA เปลี่ยนขณะ SCL สูง = START/STOP เท่านั้น (3 ครั้ง)
    const sclAt = (x: number) => { let v: number | null = 1; scl.t.forEach((tt, i) => { if (tt <= x) v = scl.v[i]; }); return v; };
    expect(sda.t.filter((x) => sclAt(x) === 1).length).toBe(3);
    // คาบ SCL ระหว่างไบต์ = T
    const m = measurePwm({ lvl0: 1, t: scl.t, v: scl.v }, 0, 18 * T);
    expect(m.period).toBeCloseTo(T, 12);
  });
});

describe('Uno TWI + เครื่องวิเคราะห์ลอจิก (ไฟล์ .hex จริงที่ใช้ Wire.h)', () => {
  const rig = () => new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: 'x', hex: inaHex, hexSrc: 'x' })
    .part('ina219', onBoard('j10'), 'INA1', {})
    .wire(P('UNO1', '5V'), H('f10'), 'a').wire(P('UNO1', 'GND.2'), H('f11'), 'b', '#212121').wire(P('UNO1', 'A5'), H('f12'), 'c').wire(P('UNO1', 'A4'), H('f13'), 'd')
    .wire(P('UNO1', 'IOREF'), H('f15'), 'e').part('resistor', onBoard('g14'), 'R1', { resistance: 220, span: 4 }).wire(H('h18'), P('UNO1', 'GND.3'), 'f', '#212121')
    .part('logicanalyzer', onTable(-40, 40), 'LA1', {})
    .wire(P('LA1', 'CH0'), H('g13'), 'la0', '#fdd835').wire(P('LA1', 'CH1'), H('g12'), 'la1', '#1e88e5').wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'lag', '#212121');
  it('ถอดรหัสได้: สแกนบัส (0x01… NACK, 0x40 ACK) · เขียน 0x05 = 4096 · อ่าน 0x02/0x04 · SCL 100 kHz (TWBR 72) · Serial ยังได้ค่าถูก', { timeout: 120000 }, () => {
    const b = rig(), e = new SimEngine(), built = buildNetlist(b.doc), buf = new LogicBuffer();
    let con = '';
    for (let k = 0; k < 12; k++) {
      const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
      if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
      con += r.mcu?.find((m) => m.id === 'UNO1')?.console ?? '';
    }
    expect(buf.ch[0].src).toBe('i2c');
    expect(buf.ch[1].src).toBe('i2c');
    const f = decodeI2c(buf.ch[0], buf.ch[1]);
    const txt = i2cText(f);
    expect(txt).toContain('S 0x01 W NACK P');
    expect(txt).toContain('S 0x40 W ACK P'); // สแกนพบ
    expect(txt).toContain('S 0x40 W ACK 0x05 ACK 0x10 ACK 0x00 ACK P'); // wr(0x05, 4096)
    expect(txt).toMatch(/S 0x40 W ACK 0x02 ACK P\nS 0x40 R ACK 0x[0-9A-F]{2} ACK 0x[0-9A-F]{2} NACK P/);
    const scan = f.filter((x) => x.kind === 'addr').slice(0, 126).map((x) => x.value);
    expect(scan).toEqual(Array.from({ length: 126 }, (_, i) => i + 1));
    const byte = f.find((x) => x.kind === 'data' && x.value === 0x05)!;
    const m = measurePwm(buf.ch[1], byte.t0 - 1e-6, byte.t1 + 1e-6); // คาบ SCL ภายในหนึ่งไบต์
    expect(m.freq! / 100e3).toBeGreaterThan(0.97);
    expect(m.freq! / 100e3).toBeLessThan(1.001);
    expect(con).toMatch(/V=4996 mV I=22\.7 mA/);
    // เวลาจริงของธุรกรรมเขียน 1 ไบต์: START ½ + ที่อยู่ 9 + ไบต์ 9 + STOP 1 คาบ ≈ 195 µs (เดิมเสร็จทันที)
    const s = f.findIndex((x) => x.kind === 'addr' && x.value === 0x40 && !x.read && f[f.indexOf(x) + 1]?.kind === 'data' && f[f.indexOf(x) + 1].value === 0x02);
    const st = f[s - 1], sp = f.slice(s).find((x) => x.kind === 'stop')!;
    expect(sp.t0 - st.t0).toBeGreaterThan(185e-6);
    expect(sp.t0 - st.t0).toBeLessThan(260e-6);
  });
});

describe('แลป 58 (ถอดรหัส I²C) ตรวจผลจากข้อมูลที่เครื่องวิเคราะห์เก็บได้', () => {
  const lab = (o: { hex?: string | null; swap?: boolean; dec?: boolean } = {}) => {
    const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { code: UNO_I2C_LA_CODE, hex: o.hex === undefined ? i2claHex : o.hex, hexSrc: UNO_I2C_LA_CODE })
      .part('bh1750', onBoard('j10'), 'U1', { lux: 500 })
      .wire(P('UNO1', '5V'), H('f10'), 'a').wire(P('UNO1', 'GND.2'), H('f11'), 'b', '#212121').wire(P('UNO1', o.swap ? 'A4' : 'A5'), H('f12'), 'c').wire(P('UNO1', o.swap ? 'A5' : 'A4'), H('f13'), 'd')
      .part('logicanalyzer', onTable(-40, 40), 'LA1', {})
      .wire(P('LA1', 'CH0'), H('g13'), 'la0', '#fdd835').wire(P('LA1', 'CH1'), H('g12'), 'la1', '#1e88e5').wire(P('LA1', 'GND'), P('UNO1', 'GND.1'), 'lag', '#212121');
    const p = b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart;
    if (o.dec !== false) { p.params.decoders[0] = 'i2c-sda'; p.params.decoders[1] = 'i2c-scl'; }
    return b;
  };
  const check = (b: Builder, sec = 0.6) => {
    const e = new SimEngine(), built = buildNetlist(b.doc), buf = new LogicBuffer();
    let r!: ReturnType<SimEngine['handle']>;
    let con = '';
    for (let k = 0; k < sec / 0.05; k++) { r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 }); if (r.logic?.LA1) buf.push(r.logic.LA1, 10); con += r.mcu?.find((m) => m.id === 'UNO1')?.console ?? ''; }
    const p = (b.doc.parts.find((x) => x.id === 'LA1') as LogicAnalyzerPart).params;
    const info = laAnalyze(buf, p, laWindow(buf, p), Array(8).fill(''));
    const logic = info.map((c) => ({ k: c.k, freq: c.m.freq, duty: c.m.duty, level: c.m.level, baud: c.baud, text: c.text, src: buf.ch[c.k].src, i2c: c.i2c, scl: c.scl }));
    return { st: checkLesson('i2cla', { doc: b.doc, built, result: r.result, analysis: analyze(b.doc, built, r.result, r.tones), work: emptyWork(), mcu: r.mcu, logic }), info, con };
  };
  it('ต่อครบ + อัปโหลด + ตั้งตัวถอดรหัส → ผ่านทุกข้อ · ไบต์ที่ถอดได้ตรงกับค่า raw ใน Serial (500 lx × 1.2 = 600 = 0x258)', { timeout: 60000 }, () => {
    const { st, info, con } = check(lab());
    for (const g of ['wire', 'upload', 'decode', 'scl']) expect(st[g].pass, `${g}: ${st[g].detail}`).toBe(true);
    const sda = info.find((c) => c.k === 0)!;
    expect(sda.scl! / 100e3).toBeCloseTo(1, 1);
    expect(sda.text).toContain('S 0x23 W ACK 0x20 ACK P');
    expect(sda.text).toContain('S 0x23 R ACK 0x02 ACK 0x58 NACK P');
    expect(con).toContain('raw=0x258 lux=500.00');
  });
  it('สลับ SDA/SCL → wire ไม่ผ่าน และอุปกรณ์ไม่ตอบ · ไม่ตั้งตัวถอดรหัส → decode ไม่ผ่าน · ไม่มีโปรแกรม → upload ไม่ผ่าน', { timeout: 60000 }, () => {
    const sw = check(lab({ swap: true }));
    expect(sw.st.wire.pass).toBe(false);
    expect(check(lab({ dec: false })).st.decode.pass).toBe(false);
    const nh = check(lab({ hex: null }));
    expect(nh.st.upload.pass).toBe(false);
    expect(nh.st.decode.pass).toBe(false);
  });
});
