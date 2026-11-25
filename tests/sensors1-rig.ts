import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import type { PartKind } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** วงจรทดสอบเซนเซอร์ชุด 1 — ใช้ร่วมกันใน tests/sensors1.test.ts และไฟล์ตั้งต้น E2E (tests/e2e/fixtures/sensors1-start.json) */
export function big(): Builder {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  return b;
}
/** รูรางไฟ MB-102 ที่ใกล้คอลัมน์ c ที่สุดและยังว่าง (รางเว้นทุก 6 คอลัมน์ และมีถึงคอลัมน์ 60) */
export function railPicker() {
  const used = new Set<string>();
  return (row: 'bp' | 'bn' | 'tp' | 'tn', c: number) => {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const k = c + d;
      if (k < 2 || k > 60 || (k - 1) % 6 === 0 || used.has(row + k)) continue;
      used.add(row + k);
      return `${row}${k}`;
    }
    throw new Error(`ไม่มีรูราง ${row} ใกล้ ${c}`);
  };
}

export const PICO_SENSORS_CODE = `from machine import Pin, ADC
import time
fl = Pin(2, Pin.IN); tc = Pin(3, Pin.IN); hl = Pin(4, Pin.IN, Pin.PULL_UP)
rd = Pin(5, Pin.IN, Pin.PULL_UP); tl = Pin(6, Pin.IN, Pin.PULL_UP)
wp = Pin(7, Pin.OUT, value=0); sd = Pin(8, Pin.IN); vb = Pin(9, Pin.IN); ln = Pin(10, Pin.IN); rn = Pin(11, Pin.IN)
a_fl = ADC(26); a_w = ADC(27); a_f = ADC(28)
n = 0
def cnt(p):
    global n
    n += 1
sd.irq(trigger=Pin.IRQ_FALLING, handler=cnt)
while True:
    wp.value(1); time.sleep_ms(5); w = a_w.read_u16(); wp.value(0)
    print('F', fl.value(), a_fl.read_u16(), 'T', tc.value(), 'H', hl.value(), 'K', rd.value(), 'D', tl.value(), 'W', w, 'P', a_f.read_u16(), 'S', n, 'V', vb.value(), 'L', ln.value(), 'R', rn.value())
    n = 0
    time.sleep_ms(100)
`;

/**
 * Pico บน MB-102 (h1) · โมดูล 3.3 V จาก 3V3 (รางบน tp/tn ต่อถึงรางล่าง bp/bn) · Hall ใช้ VBUS 5 V (ขาออก open-collector + PULL_UP ภายใน 3.3 V)
 * แถว j: เปลวไฟ j24 (DO GP2, AO GP26) · TTP223 j29 (GND VCC IO → GP3) · Hall j33 (VCC ← VBUS, OUT → GP4) · รีด a24–a29 (GP5 ↔ GND) · เอียง a32–a33 (GP6 ↔ GND)
 * ระดับน้ำ j37 (S → GP27, + ← GP7, − GND) · FSR j41–j42 (3V3 → FSR → GP28 + 10 kΩ g42–g45 → GND) · เสียง j47 (DO GP8) · SW-420 j52 (DO GP9) · ตรวจเส้น j56 (DO GP10) · ฝน j60 (DO GP11)
 */
export function picoRig() {
  const b = big().part('pico', onBoard('h1'), 'PICO1', { code: PICO_SENSORS_CODE, autorun: true });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts[0]).find((x) => x.pin === pin)!.hole!.slice(1));
  const gp = (n: number) => (n <= 15 ? `j${col(`GP${n}`)}` : `b${col(`GP${n}`)}`);
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg').wire(H('tp2'), H('bp2'), 'wvv').wire(H('tn3'), H('bn3'), 'wgg');
  const rail = railPicker();
  for (const h of ['tp2', 'bp2', 'tn3', 'bn3', `tp${col('3V3')}`, `tn${col('GND.23')}`]) rail(h.slice(0, 2) as 'bp', Number(h.slice(2)));
  const mod = (kind: PartKind, c: number, id: string, pins: string[]) => {
    b.part(kind, onBoard(`j${c}`), id, {});
    pins.forEach((p, i) => {
      if (p === 'V') b.wire(H(`i${c + i}`), H(rail('bp', c + i)), `${id}v`);
      else if (p === 'G') b.wire(H(`i${c + i}`), H(rail('bn', c + i)), `${id}g`);
      else if (p.startsWith('GP')) b.wire(H(gp(Number(p.slice(2)))), H(`h${c + i}`), `${id}${p}`);
    });
  };
  mod('flame', 24, 'FL', ['V', 'G', 'GP2', 'GP26']);
  mod('touch', 29, 'TC', ['G', 'V', 'GP3']);
  b.part('hall', onBoard('j33'), 'HL', {}).wire(H(`a${col('VBUS')}`), H('i33'), 'HLv').wire(H('i34'), H(rail('bn', 34)), 'HLg').wire(H(gp(4)), H('h35'), 'HLo');
  b.part('reed', onBoard('a24'), 'RD', {}).wire(H(gp(5)), H('e24'), 'RDa').wire(H('e29'), H(rail('tn', 29)), 'RDb');
  b.part('tilt', onBoard('a32'), 'TL', {}).wire(H(gp(6)), H('e32'), 'TLa').wire(H('e33'), H(rail('tn', 33)), 'TLb');
  b.part('waterlevel', onBoard('j37'), 'WL', {}).wire(H(gp(27)), H('h37'), 'WLs').wire(H(gp(7)), H('h38'), 'WLv').wire(H('i39'), H(rail('bn', 39)), 'WLg');
  b.part('fsr', onBoard('j41'), 'FS', {}).wire(H('i41'), H(rail('bp', 41)), 'FSv').wire(H(gp(28)), H('h42'), 'FSo')
    .part('resistor', onBoard('g42'), 'RF', { resistance: 10000, span: 3 }).wire(H('i45'), H(rail('bn', 45)), 'RFg');
  mod('soundsensor', 47, 'SD', ['V', 'G', 'GP8', '']);
  mod('vibsensor', 52, 'VB', ['V', 'G', 'GP9']);
  mod('linetrack', 56, 'LN', ['V', 'G', 'GP10', '']);
  mod('rainsensor', 60, 'RN', ['V', 'G', 'GP11', '']);
  return b;
}


/**
 * Uno บนโต๊ะ + MB-102: เซนเซอร์ 12 ตัวใช้ไฟ 5 V (รวม MQ-2) — ขาตามไฟล์ tests/fixtures/uno/sensors1.ino
 * D12/A0 เปลวไฟ · D3/A1 ฝน · D4/A2 MQ-2 · D5/A3 ตรวจเส้น · D6 SW-420 · D2 เสียง (INT0) · D8 TTP223 · D10 Hall · D11 เอียง · A4 น้ำ · A5 FSR · D9 รีด
 */
export function unoRig(code: string, hex: string | null) {
  const b = big().part('uno', onTable(-75, -10), 'UNO1', { code, hex, hexSrc: code });
  const rail = railPicker();
  for (const h of ['bp58', 'bn58', 'bp59', 'tp59', 'bn59', 'tn59']) rail(h.slice(0, 2) as 'bp', Number(h.slice(2)));
  b.wire(P('UNO1', '5V'), H('bp58'), 'w5').wire(P('UNO1', 'GND.1'), H('bn58'), 'wg').wire(H('bp59'), H('tp59'), 'wtp').wire(H('bn59'), H('tn59'), 'wtn');
  const mod = (kind: PartKind, c: number, id: string, pins: string[]) => {
    b.part(kind, onBoard(`j${c}`), id, {});
    pins.forEach((p, i) => {
      if (p === 'V') b.wire(H(`i${c + i}`), H(rail('bp', c + i)), `${id}v`);
      else if (p === 'G') b.wire(H(`i${c + i}`), H(rail('bn', c + i)), `${id}g`);
      else if (p) b.wire(P('UNO1', p), H(`h${c + i}`), `${id}${p}`);
    });
  };
  mod('flame', 2, 'FL', ['V', 'G', 'D12', 'A0']);
  mod('rainsensor', 8, 'RN', ['V', 'G', 'D3', 'A1']);
  mod('mq2', 14, 'MQ', ['V', 'G', 'D4', 'A2']);
  mod('linetrack', 20, 'LN', ['V', 'G', 'D5', 'A3']);
  mod('vibsensor', 26, 'VB', ['V', 'G', 'D6']);
  mod('soundsensor', 32, 'SD', ['V', 'G', 'D2', '']);
  mod('touch', 38, 'TC', ['G', 'V', 'D8']);
  mod('hall', 42, 'HL', ['V', 'G', 'D10']);
  b.part('tilt', onBoard('j47'), 'TL', {}).wire(P('UNO1', 'D11'), H('h47'), 'TLa').wire(H('i48'), H(rail('bn', 48)), 'TLb');
  mod('waterlevel', 51, 'WL', ['A4', 'V', 'G']);
  b.part('fsr', onBoard('j56'), 'FS', {}).wire(H('i56'), H(rail('bp', 56)), 'FSv').wire(P('UNO1', 'A5'), H('h57'), 'FSo')
    .part('resistor', onBoard('g57'), 'RF', { resistance: 10000, span: 3 }).wire(H('i60'), H(rail('bn', 60)), 'RFg');
  b.part('reed', onBoard('a2'), 'RD', {}).wire(P('UNO1', 'D9'), H('e2'), 'RDa').wire(H('e7'), H(rail('tn', 8)), 'RDb');
  return b;
}
