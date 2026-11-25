import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { ENCODER_COUNTER_CODE, KEYPAD_LOCK_CODE } from '../src/model/catalog';
import { tmText } from '../src/mcu/tm1637';
import type { EngineResponse } from '../src/sim/engine';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** ฐานร่วม: MB-102, Pico h1, ราง tp/bp = 3V3, tn/bn = GND, TM1637 j55 (CLK ← GP14, DIO ← GP15) */
function base(code: string) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part('pico', onBoard('h1'), 'PICO1', { code, autorun: code !== '' });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  b.part('tm1637', onBoard('j55'), 'DS1', {})
    .wire(H('i57'), H('bp57'), 'wtv', '#e53935').wire(H('i58'), H('bn58'), 'wtg', '#212121')
    .wire(H(`j${col('GP14')}`), H('g55'), 'wclk', '#8e24aa').wire(H(`i${col('GP15')}`), H('h56'), 'wdio', '#43a047');
  return { b, col };
}

/**
 * แลป 50 กุญแจรหัสผ่าน: แผ่นปุ่ม 4×4 บนโต๊ะด้านหน้า R1–R4 → GP6–GP9, C1–C4 → GP10–GP13 (สายเข้าแถว j)
 * LED เขียว: GP16 (b20) → c30 · R 330 Ω b30–b34 · LED a34/a35 · d35 → tn36 · LED แดง: GP17 (b19) → c40 · R b40–b44 · LED a44/a45 · d45 → tn46
 */
export function keypadRig(o: { code?: string; swapRows?: boolean } = {}) {
  const { b, col } = base(o.code ?? KEYPAD_LOCK_CODE);
  b.part('keypad', onTable(10, 42), 'KP1', {});
  const gps = o.swapRows ? [10, 11, 12, 13, 6, 7, 8, 9] : [6, 7, 8, 9, 10, 11, 12, 13];
  ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].forEach((p, i) => b.wire(P('KP1', p), H(`j${col(`GP${gps[i]}`)}`), `wk${i}`, i < 4 ? '#fb8c00' : '#1e88e5'));
  for (const [gp, c, color, id] of [[16, 30, 'green', 'LEDG'], [17, 40, 'red', 'LEDR']] as const) {
    b.wire(H(`b${col(`GP${gp}`)}`), H(`c${c}`), `wl${gp}`, '#43a047');
    b.part('resistor', onBoard(`b${c}`), `R${gp}`, { resistance: 330, span: 4 });
    b.part('led', onBoard(`a${c + 4}`), id, { color });
    b.wire(H(`d${c + 5}`), H(`tn${c + 6}`), `wk${gp}`, '#212121');
  }
  return b;
}

/**
 * แลป 51 ตัวนับ: จอยสติ๊ก j30 (GND30 +5V31 VRx32 VRy33 SW34) · encoder j40 (CLK40 DT41 SW42 +43 GND44)
 * VRx → GP26, VRy → GP27, SW จอย → GP19 · encoder SW → GP20, DT → GP21, CLK → GP22 (สายจากขาด้านขวาของ Pico แถว b)
 */
export function encoderRig(o: { code?: string; encVcc?: 'bp' | 'vbus' } = {}) {
  const { b, col } = base(o.code ?? ENCODER_COUNTER_CODE);
  b.part('joystick', onBoard('j30'), 'JS1', {}).part('encoder', onBoard('j40'), 'ENC1', {});
  b.wire(H('i30'), H('bn30'), 'wjg', '#212121').wire(H('i31'), H('bp32'), 'wjv', '#e53935');
  b.wire(H(`b${col('GP26')}`), H('h32'), 'wjx', '#fdd835').wire(H(`b${col('GP27')}`), H('g33'), 'wjy', '#fb8c00').wire(H(`b${col('GP19')}`), H('h34'), 'wjs', '#8e24aa');
  b.wire(H('i44'), H('bn45'), 'weg', '#212121');
  if (o.encVcc === 'vbus') b.wire(H(`a${col('VBUS')}`), H('g43'), 'wev', '#ff7043'); else b.wire(H('i43'), H('bp44'), 'wev', '#e53935');
  b.wire(H(`b${col('GP20')}`), H('h42'), 'wes', '#8e24aa').wire(H(`b${col('GP21')}`), H('g41'), 'wed', '#1e88e5').wire(H(`b${col('GP22')}`), H('h40'), 'wec', '#43a047');
  return b;
}

export interface InStep { t: number; con: string; text: string; r: EngineResponse; an: ReturnType<typeof analyze> }

/** รันทีละ dt · cmd(t, b) คืน true เมื่อแก้วงจร · turn(t) คืนจำนวนคลิก encoder ที่จะหมุน */
export function runInput(b: Builder, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void, turn?: (t: number) => Record<string, number> | undefined, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: InStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const enc = turn?.(t);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(enc ? { encoder: enc } : {}) });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    const an = analyze(b.doc, built, r.result, r.tones);
    st.push({ t, con, text: tmText(r.result.seg?.DS1), r, an });
  }
  return { con, st, built };
}
