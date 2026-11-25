import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { Builder, H, P, onBoard, onTable } from './helpers';

/** Uno บนโต๊ะ · LED1 (A c10, K c11) + R1 220 Ω (a5–a8 → แถว a คอลัมน์ 8 ต่อขา A ผ่านสาย) — D13 → a5, K e11 → GND (tn) */
export function unoRig(o: { code?: string; hex?: string | null; pin?: string; r?: number } = {}) {
  const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { ...(o.code ? { code: o.code } : {}), hex: o.hex ?? null, hexSrc: o.code ?? '' })
    .part('resistor', onBoard('a5'), 'R1', { resistance: o.r ?? 220, span: 3 }).part('led', onBoard('c8'), 'LED1')
    .wire(P('UNO1', o.pin ?? 'D13'), H('b5'), 'w1', '#43a047').wire(H('e9'), H('tn9'), 'w2', '#212121').wire(P('UNO1', 'GND.1'), H('tn3'), 'w3', '#212121');
  return b;
}

export function runUno(b: Builder, seconds: number, dt = 0.05, onStep?: (t: number, an: ReturnType<typeof analyze>) => void, cmds?: (k: number) => Record<string, unknown> | undefined) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  let con = '';
  let an!: ReturnType<typeof analyze>;
  const st: Array<{ t: number; led: number; pins: string[] }> = [];
  for (let k = 0; k < seconds / dt; k++) {
    const extra = cmds?.(k);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(extra ? { mcu: extra as never } : {}) });
    const m = r.mcu?.find((x) => x.id === 'UNO1');
    con += m?.console ?? '';
    an = analyze(doc, built, r.result, r.tones);
    st.push({ t: (k + 1) * dt, led: an.parts.LED1?.current ?? 0, pins: m?.pins ?? [] });
    onStep?.((k + 1) * dt, an);
  }
  return { con, an, st, built, doc };
}
