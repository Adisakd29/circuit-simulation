import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { ALARM_CODE, PULLDOWN_CODE } from '../src/model/catalog';
import type { EngineResponse } from '../src/sim/engine';
import { Builder, H, onBoard } from './helpers';

function base(code: string, kind: 'pico' | 'picow' = 'pico') {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part(kind, onBoard('h1'), 'PICO1', { code, autorun: code !== '' });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  return { b, col };
}

/** LED จากขา GP ทางขวาของ Pico (แถว b): GP → c{c} · R 330 Ω b{c}–b{c+4} · LED a{c+4}/a{c+5} · d{c+5} → tn{c+6} */
function led(b: Builder, col: (p: string) => number, gp: number, c: number, color: string, id: string) {
  b.wire(H(`b${col(`GP${gp}`)}`), H(`c${c}`), `wl${gp}`, '#43a047');
  b.part('resistor', onBoard(`b${c}`), `R${gp}`, { resistance: 330, span: 4 });
  b.part('led', onBoard(`a${c + 4}`), id, { color });
  b.wire(H(`d${c + 5}`), H(`tn${c + 6}`), `wk${gp}`, '#212121');
}

/**
 * แลป 52: SW1 f30 (1 f30, 2 e30, 3 f32, 4 e32) — คอลัมน์ 30 ด้านบน → 3V3 (a30 → tp30) · คอลัมน์ 32 ด้านล่าง → GP14 (j19 → g32) + ดึงลง 10 kΩ i32–i36 → bn36
 * SW2 f40 — คอลัมน์ 40 ด้านบน → GND (a40 → tn40) · คอลัมน์ 42 ด้านล่าง → GP15 (j20 → g42) · LED1 GP16 (c44…) · LED2 GP17 (c52…)
 */
export function pulldownRig(o: { code?: string; noPulldown?: boolean; kind?: 'pico' | 'picow' } = {}) {
  const { b, col } = base(o.code ?? PULLDOWN_CODE, o.kind);
  b.part('pushbutton', onBoard('f30'), 'SW1', {}).part('pushbutton', onBoard('f40'), 'SW2', {});
  b.wire(H('a30'), H('tp30'), 'ws1v', '#e53935').wire(H(`j${col('GP14')}`), H('g32'), 'ws1', '#1e88e5');
  if (!o.noPulldown) b.part('resistor', onBoard('i32'), 'RPD', { resistance: 10000, span: 4 }).wire(H('j36'), H('bn36'), 'wpd', '#212121');
  b.wire(H('a40'), H('tn40'), 'ws2g', '#212121').wire(H(`j${col('GP15')}`), H('g42'), 'ws2', '#fb8c00');
  led(b, col, 16, 44, 'red', 'LED1');
  led(b, col, 17, 52, 'green', 'LED2');
  return b;
}

/**
 * แลป 53: PIR j30 (VCC30 OUT31 GND32) VCC ← VBUS (a1 → g30), OUT → GP14 (j19 → h31), GND → bn32
 * FC-51 j40 (OUT40 GND41 VCC42) OUT → GP15 (j20 → h40), GND → bn41, VCC → bp42
 * DHT11 j50 (VDD50 DATA51 NC52 GND53) VDD → bp50, GND → bn54, DATA → GP13 (j17 → h51) + ดึงขึ้น 10 kΩ f51–f55, i55 → bp56
 * LED แดง GP16 (c26…) · LED เหลือง GP17 (c36…)
 */
export function alarmRig(o: { code?: string; pirVcc?: '3V3' | 'VBUS'; obsVcc?: '3V3' | 'VBUS' } = {}) {
  const { b, col } = base(o.code ?? ALARM_CODE);
  b.part('pir', onBoard('j30'), 'PIR1', {}).part('irobstacle', onBoard('j40'), 'IR1', {}).part('dht11', onBoard('j50'), 'DHT1', {});
  b.wire(o.pirVcc === '3V3' ? H('i30') : H(`a${col('VBUS')}`), o.pirVcc === '3V3' ? H('bp30') : H('g30'), 'wpv', '#ff7043').wire(H(`j${col('GP14')}`), H('h31'), 'wpo', '#8e24aa').wire(H('i32'), H('bn32'), 'wpg', '#212121');
  b.wire(H(`j${col('GP15')}`), H('h40'), 'wio', '#1e88e5').wire(H('i41'), H('bn41'), 'wig', '#212121');
  if (o.obsVcc === 'VBUS') b.wire(H(`b${col('VBUS')}`), H('g42'), 'wiv', '#ff7043'); else b.wire(H('i42'), H('bp42'), 'wiv', '#e53935');
  b.wire(H('i50'), H('bp50'), 'wdv', '#e53935').wire(H('i53'), H('bn54'), 'wdg', '#212121').wire(H(`j${col('GP13')}`), H('h51'), 'wdd', '#fdd835');
  b.part('resistor', onBoard('f51'), 'RPU', { resistance: 10000, span: 4 }).wire(H('i55'), H('bp56'), 'wpu', '#e53935');
  led(b, col, 16, 26, 'red', 'LEDA');
  led(b, col, 17, 36, 'yellow', 'LEDD');
  return b;
}

export interface SStep { t: number; con: string; r: EngineResponse; an: ReturnType<typeof analyze> }
export function runSensor(b: Builder, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: SStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    st.push({ t, con, r, an: analyze(b.doc, built, r.result, r.tones) });
  }
  return { con, st, built };
}
