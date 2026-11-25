import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { coveredHoles, footprint, pinHolesFor } from '../src/model/geometry';
import { catalogEntry, internalLinks, pinDefs, PICO_PINOUT } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { BOARD_PROFILES } from '../src/model/board-features';
import { validateCircuit } from '../src/model/schema';
import { isMicroPy, isPico } from '../src/model/types';
import { netOfPin } from '../src/connectivity/connectivity';
import { setBoardModel } from '../src/editor/ops';
import { Builder, H, P, onBoard, onTable } from './helpers';

function big(): Builder {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  return b;
}

/**
 * บอร์ดเฉพาะโมเดล (ไม่มีตัวจำลอง CPU): STM32F103C8T6 Blue Pill, Raspberry Pi Pico 2, Teensy 4.1
 * ตรวจ: ตำแหน่ง/ชื่อขาตามแหล่งอ้างอิง · ไม่มีอุปกรณ์ไฟฟ้าในวงจร · ป้าย "เฉพาะโมเดล" · ทุกฟังก์ชัน Unsupported · แจ้งเมื่อต่อสาย · บันทึก/เปิดไฟล์ได้
 * แหล่ง: stm32-base.org (Header 1/2), deskthority wiki (ขาติด USB = PB12 และ GND), ไฟล์ Fritzing (ระยะแถว 600 mil, ตำแหน่ง SWD)
 *        เอกสาร Raspberry Pi ("The pinout and board layout ... is the same as for Raspberry Pi Pico 2")
 *        สัญลักษณ์ Teensy4.1 ของ teensy_library (หมายเลขขา 1–48 แบบ DIP) + บัตรขา PJRC
 */
const KINDS = ['bluepill', 'pico2', 'teensy41'] as const;

function run(b: Builder) {
  const built = buildNetlist(b.doc);
  const r = new SimEngine().handle({ seq: 1, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
  return { built, an: analyze(b.doc, built, r.result, r.tones) };
}

describe('บอร์ดเฉพาะโมเดล: Blue Pill · Pico 2 · Teensy 4.1', () => {
  it('Blue Pill: 40 ขา แถวห่าง 0.6" (i กับ e) · มองด้านบน USB ซ้าย แถวหน้า B12 … 5V G 3.3 แถวหลัง G G 3.3 R B11 … C13 VB · ป้ายขาระบุขาที่ไม่ทน 5 V ตาม datasheet ST', () => {
    const p = new Builder().part('bluepill', onBoard('i5'), 'U1').doc.parts[0];
    const d = pinDefs(p);
    expect(d).toHaveLength(40);
    const hole = Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]));
    expect(hole).toMatchObject({ PB12: 'i5', PA9: 'i10', PB9: 'i21', '5V': 'i22', 'GND.3': 'i23', '3V3.3': 'i24', 'GND.1': 'e5', NRST: 'e8', PA0: 'e20', PC13: 'e23', VBAT: 'e24' });
    expect([...new Set(coveredHoles(p).map((h) => h[0]))].sort().join('')).toBe('fgh');
    const label = (n: string) => d.find((x) => x.name === n)!.label;
    for (const n of ['PA0', 'PA7', 'PB0', 'PB1', 'PB5', 'PC13', 'PC14', 'PC15']) expect(label(n), n).toContain('ไม่ทน 5 V');
    for (const n of ['PA9', 'PA10', 'PB6', 'PB7', 'PB10', 'PB11', 'PB12', 'PA15']) expect(label(n), n).not.toContain('ไม่ทน 5 V');
    expect(label('PC13')).toContain('LED');
    expect(internalLinks(p)).toEqual([['GND.1', 'GND.2', 'GND.3'], ['3V3.1', '3V3.2', '3V3.3']]);
  });

  it('Teensy 4.1: ขาขอบนอก 48 ขา ตามลำดับ DIP ของสัญลักษณ์ KiCad (ขา 1 = GND ติด USB) · แถวหน้า GND 0 … 12 3.3V 24 … 32 · แถวหลัง VIN GND 3.3V 23 … 13 GND 41 … 33', () => {
    const p = new Builder().part('teensy41', onBoard('i5'), 'U1').doc.parts[0];
    const d = pinDefs(p);
    expect(d).toHaveLength(48);
    const front = d.filter((x) => x.dy === 0).sort((a, b) => a.dx - b.dx).map((x) => x.name);
    const back = d.filter((x) => x.dy === -6).sort((a, b) => a.dx - b.dx).map((x) => x.name);
    expect(front).toEqual(['GND.1', ...Array.from({ length: 13 }, (_, i) => `D${i}`), '3V3.1', ...Array.from({ length: 9 }, (_, i) => `D${24 + i}`)]);
    expect(back).toEqual(['VIN', 'GND.2', '3V3.2', ...Array.from({ length: 11 }, (_, i) => `D${23 - i}`), 'GND.3', ...Array.from({ length: 9 }, (_, i) => `D${41 - i}`)]);
    // DIP: ขา k (1–24) แถวหน้าจาก USB, ขา 25–48 แถวหลังจากปลายไกลกลับมา USB → ขา 48 = VIN ตรงข้ามขา 1
    const dip = [...front, ...[...back].reverse()];
    expect([dip[0], dip[1], dip[13], dip[14], dip[15], dip[23], dip[24], dip[33], dip[34], dip[44], dip[45], dip[46], dip[47]])
      .toEqual(['GND.1', 'D0', 'D12', '3V3.1', 'D24', 'D32', 'D33', 'GND.3', 'D13', 'D23', '3V3.2', 'GND.2', 'VIN']);
    const label = (n: string) => d.find((x) => x.name === n)!.label;
    expect(label('D13')).toContain('LED');
    expect(label('D18')).toContain('SDA');
    expect(label('D19')).toContain('SCL');
    // อนาล็อก 18 ขา: A0–A13 = 14–27, A14–A17 = 38–41
    expect(d.filter((x) => /\bA\d+\b/.test(x.label)).map((x) => x.name).sort()).toEqual([...Array.from({ length: 14 }, (_, i) => `D${14 + i}`), 'D38', 'D39', 'D40', 'D41'].sort());
    expect([...new Set(coveredHoles(p).map((h) => h[0]))].sort().join('')).toBe('fgh');
  });

  it('Pico 2: ขาและตำแหน่งเหมือน Pico ทุกขา แต่ไม่ใช่บอร์ดที่รันโค้ด (isPico/isMicroPy เป็นเท็จ)', () => {
    const b = big().part('pico2', onBoard('h5'), 'U1').part('pico', onBoard('h30'), 'U2');
    const [p2, p1] = b.doc.parts;
    expect(isPico(p2)).toBe(false);
    expect(isMicroPy(p2)).toBe(false);
    expect(pinDefs(p2).map((x) => [x.name, x.dx, x.dy])).toEqual(pinDefs(p1).map((x) => [x.name, x.dx, x.dy]));
    expect(pinDefs(p2).map((x) => x.name)).toEqual(PICO_PINOUT);
    expect(pinDefs(p2).find((x) => x.name === 'GP26')!.label).toContain('ADC0');
    expect(coveredHoles(p2).length).toBe(coveredHoles(p1).length);
  });

  it('ทั้งสามบอร์ด: ป้าย "เฉพาะโมเดล" · ไม่มีอุปกรณ์ไฟฟ้า · ไม่มีภาษา/ฟังก์ชันใด Supported/Partial · ทุกขาเขียนว่าไม่ทำงาน · บนโต๊ะครอบพื้นที่ทั้งแผ่น', () => {
    for (const k of KINDS) {
      expect(catalogEntry(k)!.name, k).toContain('เฉพาะโมเดล');
      expect(supportSummary(SUPPORT[k]).text, k).toBe('เฉพาะโมเดล');
      expect(SUPPORT[k].code, k).toBe('none');
      const prof = BOARD_PROFILES.find((x) => x.kind === k)!;
      expect(prof.engine, k).toMatch(/^ไม่มี/);
      expect(prof.features.every((f) => f.level === 'unsupported'), k).toBe(true);
      expect(prof.languages.every((l) => l.level === 'unsupported'), k).toBe(true);
      const b = new Builder().part(k, onBoard('i5'), 'U1');
      const p = b.doc.parts[0];
      expect(pinDefs(p).every((x) => x.label.includes('ไม่ทำงาน (เฉพาะโมเดล)')), k).toBe(true);
      const { built, an } = run(b);
      expect(built.netlist.elements, k).toHaveLength(0);
      expect(built.netlist.mcus ?? [], k).toHaveLength(0);
      expect(an.diagnostics.filter((x) => x.partId === 'U1'), k).toEqual([]);
      const t = new Builder().part(k, onTable(20, 20), 'U1').doc.parts[0];
      const f = footprint(t)!;
      expect(f.x1 - f.x0, k).toBeGreaterThan(k === 'teensy41' ? 23 : 19);
      expect(f.z1 - f.z0, k).toBeGreaterThan(k === 'pico2' ? 7 : 6);
    }
  });

  it('ต่อ LED + ตัวต้านทานเข้าขา GPIO และขา 3.3 V: ไม่มีไฟ ไม่มีกระแส + แจ้งว่าเป็นโมเดลเท่านั้น (ไม่จำลองแทนด้วยบอร์ดอื่น) · ขา GND ต่อถึงกันภายในบอร์ด', () => {
    const cases: Array<[typeof KINDS[number], string, string, string]> = [['bluepill', 'PC13', '3V3.1', 'GND.1'], ['pico2', 'GP15', '3V3', 'GND'], ['teensy41', 'D13', '3V3.2', 'GND.2']];
    for (const [k, gpio, v33, gnd] of cases) {
      const b = big().part(k, onTable(10, 40), 'U1');
      b.part('resistor', onBoard('b30'), 'R1', { resistance: 330, span: 4 }).part('led', onBoard('c34'), 'LED1', { color: 'red' });
      b.wire(P('U1', gpio), H('a30'), 'w1').wire(H('a35'), P('U1', gnd), 'w2').wire(P('U1', v33), H('a40'), 'w3');
      b.part('led', onBoard('c40'), 'LED2', { color: 'green' }).wire(H('a41'), H('tn41'), 'w4');
      const { built, an } = run(b);
      expect(an.parts.LED1?.current ?? 0, k).toBeLessThan(1e-9);
      expect(an.parts.LED2?.current ?? 0, k).toBeLessThan(1e-9);
      expect(an.diagnostics.filter((x) => x.partId === 'U1').map((x) => x.message).join(' '), k).toMatch(/เป็นโมเดลเท่านั้น — ยังไม่มีตัวจำลอง CPU/);
      const gnds = pinDefs(b.doc.parts[0]).filter((x) => x.name.startsWith('GND')).map((x) => netOfPin(built.connectivity, 'U1', x.name));
      expect(new Set(gnds).size, k).toBe(1);
    }
  });

  it('บันทึก/เปิดไฟล์ได้ (schema) และค่า model ผิดถูกปฏิเสธ', () => {
    const b = new Builder();
    KINDS.forEach((k, i) => b.part(k, onTable(10 + i * 40, 30), `U${i + 1}`));
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const bad = JSON.parse(JSON.stringify(b.doc));
    bad.parts[0].params.model = 'STM32F401 Black Pill';
    const e2: string[] = [];
    validateCircuit(bad, e2, []);
    expect(e2.join()).toContain('STM32F103C8T6 Blue Pill');
  });
});
