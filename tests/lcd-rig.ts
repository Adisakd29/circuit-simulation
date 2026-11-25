import lcdHex from './fixtures/uno/lcd.hex?raw';
import lcd8Hex from './fixtures/uno/lcd8.hex?raw';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { UNO_LCD_CODE } from '../src/model/catalog';
import type { PotentiometerPart } from '../src/model/types';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork } from '../src/model/types';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** วงจรแลป 57: จอ LCD แบบขนานเสียบแถว j คอลัมน์ 8–23 (VSS 8 … K 23) + Uno + VR ที่ V0 + 220 Ω ที่ไฟพื้นหลัง */
export const col = (pin: string) => 8 + ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'].indexOf(pin);
export function lcdRig(o: { hex?: string | null; mode?: 4 | 8; pot?: number; blRes?: boolean; rwGnd?: boolean; vdd?: boolean } = {}) {
  const hex = o.hex === undefined ? (o.mode === 8 ? lcd8Hex : lcdHex) : o.hex;
  const b = new Builder()
    .part('uno', onTable(-70, -10), 'UNO1', { code: UNO_LCD_CODE, hex, hexSrc: UNO_LCD_CODE })
    .part('lcd1602p', onBoard('j8'), 'LCD1')
    .part('potentiometer', onBoard('f3'), 'VR1')
    .wire(P('UNO1', '5V'), H('bp2'), 'p5', '#e53935').wire(P('UNO1', 'GND.1'), H('bn2'), 'g0', '#212121')
    .wire(H(`i${col('VSS')}`), H(`bn${col('VSS')}`), 'gss', '#212121')
    .wire(H(`h${col('K')}`), H(`bn${col('K')}`), 'gk', '#212121')
    .wire(H('g3'), H('bn3'), 'vr1', '#212121').wire(H('g5'), H('bp5'), 'vr3', '#e53935').wire(H('h4'), H(`h${col('V0')}`), 'v0', '#8e24aa');
  if (o.vdd !== false) b.wire(H(`i${col('VDD')}`), H(`bp${col('VDD')}`), 'pdd', '#e53935');
  if (o.blRes !== false) b.part('resistor', onBoard(`g${col('A')}`), 'R1', { resistance: 220, span: 4 }).wire(H(`h${col('A') + 4}`), H(`bp${col('A') + 4}`), 'pa', '#e53935');
  if (o.mode === 8) {
    // RS 12, RW 10, E 11, D0–D7 = D2–D9
    b.wire(P('UNO1', 'D12'), H(`g${col('RS')}`), 'rs', '#fb8c00').wire(P('UNO1', 'D10'), H(`g${col('RW')}`), 'rw', '#6d4c41').wire(P('UNO1', 'D11'), H(`g${col('E')}`), 'e', '#fdd835');
    for (let k = 0; k < 8; k++) b.wire(P('UNO1', `D${2 + k}`), H(`g${col(`D${k}`)}`), `d${k}`, '#1e88e5');
  } else {
    if (o.rwGnd !== false) b.wire(H(`i${col('RW')}`), H(`bn${col('RW')}`), 'grw', '#212121');
    b.wire(P('UNO1', 'D12'), H(`g${col('RS')}`), 'rs', '#fb8c00').wire(P('UNO1', 'D11'), H(`g${col('E')}`), 'e', '#fdd835');
    [5, 4, 3, 2].forEach((d, k) => b.wire(P('UNO1', `D${d}`), H(`g${col(`D${4 + k}`)}`), `d${4 + k}`, '#1e88e5'));
  }
  (b.doc.parts.find((p) => p.id === 'VR1') as PotentiometerPart).params.position = o.pot ?? 0.1;
  return b;
}

export function runLcd(b: Builder, sec: number) {
  const e = new SimEngine(), built = buildNetlist(b.doc);
  let r!: ReturnType<SimEngine['handle']>;
  for (let k = 0; k < Math.round(sec / 0.05); k++) r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.05, restart: k === 0, watch: [], budgetMs: 1e9 });
  const an = analyze(b.doc, built, r.result, r.tones);
  const goals = checkLesson('lcdpar', { doc: b.doc, built, result: r.result, analysis: an, work: emptyWork(), mcu: r.mcu });
  return { r, an, st: r.result.plcd?.LCD1, x: an.ok ? an.parts.LCD1?.extra : undefined, built, goals };
}

