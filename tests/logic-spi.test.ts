/**
 * เครื่องวิเคราะห์ลอจิก: ถอดรหัส SPI (โหมด 0–3, CS) — ฟังก์ชันล้วน และสัญญาณจริงจาก SPI ฮาร์ดแวร์/SoftSPI ของ MicroPython บน Pico
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { LogicBuffer, decodeSpi, measurePwm, spiByteEdges } from '../src/instruments/logic';
import { Builder, H, P, onBoard, onTable } from './helpers';

const tr = (lvl0: 0 | 1, ev: Array<[number, 0 | 1]>) => { const t: number[] = [], v: Array<0 | 1> = []; let l = lvl0; for (const [a, b] of [...ev].sort((x, y) => x[0] - y[0])) { if (b !== l) { t.push(a); v.push(b); l = b; } } return { lvl0, t, v }; };

describe('ตัวถอดรหัส SPI (ฟังก์ชันล้วน)', () => {
  it('ทุกโหมด 0–3: ไบต์ที่สร้างตามโหมด (ขอบ SCK และจังหวะเปลี่ยนข้อมูลตาม CPOL/CPHA) ถอดกลับได้ตรง', () => {
    for (let mode = 0; mode < 4; mode++) {
      const bytes = [0xa5, 0x3c, 0x00, 0xff, 0x81];
      const sck: Array<[number, 0 | 1]> = [], d: Array<[number, 0 | 1]> = [];
      bytes.forEach((b, i) => { const e = spiByteEdges(1e-3 + i * 10e-6, 1e-6, b, mode); sck.push(...e.sck); d.push(...e.data); });
      const cpol = ((mode >> 1) & 1) as 0 | 1;
      const f = decodeSpi(tr(cpol, sck), tr(0, d), null, mode);
      expect(f.map((x) => x.value)).toEqual(bytes);
    }
  });
  it('CS: ไบต์ขณะ CS สูงไม่นับ · CS ขึ้นกลางไบต์ทิ้งบิตที่ค้าง', () => {
    const sck: Array<[number, 0 | 1]> = [], d: Array<[number, 0 | 1]> = [];
    [0x11, 0x22, 0x33].forEach((b, i) => { const e = spiByteEdges(1e-3 + i * 10e-6, 1e-6, b, 0); sck.push(...e.sck); d.push(...e.data); });
    // CS ต่ำเฉพาะไบต์ที่สอง
    const cs = tr(1, [[1.009e-3, 0], [1.019e-3, 1]]);
    expect(decodeSpi(tr(0, sck), tr(0, d), cs, 0).map((x) => x.value)).toEqual([0x22]);
    const cs2 = tr(1, [[0.9e-3, 0], [1.004e-3, 1], [1.009e-3, 0]]);
    expect(decodeSpi(tr(0, sck), tr(0, d), cs2, 0).map((x) => x.value)).toEqual([0x22, 0x33]);
  });
});

function rig(code: string, ch: Record<string, string>) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code, autorun: true }).part('logicanalyzer', onTable(-40, 40), 'LA1', {});
  const ph = pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!);
  const hole = (pin: string) => { const x = ph.find((q) => q.pin === pin)!.hole!; return H(`${x.startsWith('c') ? 'a' : 'j'}${x.slice(1)}`); };
  for (const [c, pin] of Object.entries(ch)) b.wire(P('LA1', c), hole(pin), `w${c}`, '#fdd835');
  b.wire(P('LA1', 'GND'), hole('GND.38'), 'wg', '#212121');
  return b;
}
function capture(b: Builder, sec: number, dt = 0.05) {
  const e = new SimEngine(), built = buildNetlist(b.doc), buf = new LogicBuffer();
  let con = '';
  for (let k = 0; k < Math.round(sec / dt); k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    if (r.logic?.LA1) buf.push(r.logic.LA1, 10);
  }
  return { buf, con };
}

describe('SPI จาก MicroPython บน Pico → เครื่องวิเคราะห์ลอจิก', () => {
  it('SPI ฮาร์ดแวร์ (SPI0: SCK GP18, MOSI GP19, CS = GP17 แบบ GPIO) 1 MHz โหมด 0 และโหมด 3: ถอดได้ไบต์ที่เขียน · ความถี่ SCK ≈ 1 MHz', { timeout: 300000 }, () => {
    for (const [pol, pha] of [[0, 0], [1, 1]]) {
      const code = `from machine import Pin, SPI\nimport time\ncs = Pin(17, Pin.OUT, value=1)\nspi = SPI(0, baudrate=1000000, polarity=${pol}, phase=${pha}, sck=Pin(18), mosi=Pin(19), miso=Pin(16))\ntime.sleep_ms(50)\ncs.value(0); spi.write(b'\\xa5\\x3c\\x42'); cs.value(1)\nprint("sent")\n`;
      const { buf, con } = capture(rig(code, { CH0: 'GP18', CH1: 'GP19', CH2: 'GP17' }), 0.8);
      expect(con).toContain('sent');
      expect(buf.ch[0].src).toBe('spi');
      const f = decodeSpi(buf.ch[0], buf.ch[1], buf.ch[2], pol * 2 + pha);
      expect(f.map((x) => x.value)).toEqual([0xa5, 0x3c, 0x42]);
      const m = measurePwm(buf.ch[0], f[0].t0 - 1e-9, f[0].t1 + 1e-9);
      expect(Math.abs(m.freq! - 1e6) / 1e6).toBeLessThan(0.02);
    }
  });

  it('SoftSPI (ขยับขาเองด้วยซอฟต์แวร์) โหมด 1: ถอดได้ไบต์ที่เขียน (ขอบจากตัวจำลอง CPU)', { timeout: 300000 }, () => {
    const code = `from machine import Pin, SoftSPI\nspi = SoftSPI(baudrate=20000, polarity=0, phase=1, sck=Pin(10), mosi=Pin(11), miso=Pin(12))\nspi.write(b'\\x81\\x7e')\nprint("sent")\n`;
    const { buf, con } = capture(rig(code, { CH0: 'GP10', CH1: 'GP11' }), 0.6);
    expect(con).toContain('sent');
    expect(decodeSpi(buf.ch[0], buf.ch[1], null, 1).map((x) => x.value)).toEqual([0x81, 0x7e]);
  });
});
