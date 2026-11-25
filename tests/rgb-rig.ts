import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { rgbLedParamsFor } from '../src/model/catalog';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * แลป 44: Uno บนโต๊ะ · LED RGB ที่ c20 (R c20, COM c21, G c22, B c23) · ตัวต้านทาน 220 Ω ครึ่งล่าง f5–f8, f10–f13, f15–f18
 * D9 → j5, D10 → j10, D11 → j15 · g8 → a20 (R), g13 → a22 (G), g18 → a23 (B) · COM a21 → tn21 · GND.1 → tn3
 * (ปลายสายอยู่แถว a หลัง LED — ไม่บังเลนส์เมื่อมองจากด้านหน้า)
 * แอโนดร่วม (common: 'ca'): COM → tp21 และ 5V → tp3
 */
export function rgbRig(o: { hex?: string | null; code?: string; common?: 'cc' | 'ca'; r?: number; noRes?: string } = {}) {
  const ca = o.common === 'ca';
  const b = new Builder().part('uno', onTable(-70, -10), 'UNO1', { ...(o.code ? { code: o.code } : {}), hex: o.hex ?? null, hexSrc: o.code ?? '' })
    .part('rgbled', onBoard('c20'), 'LED1', rgbLedParamsFor(o.common ?? 'cc'));
  const ch: Array<[string, number, number, string]> = [['R', 5, 20, 'D9'], ['G', 10, 22, 'D10'], ['B', 15, 23, 'D11']];
  for (const [c, x, col, pin] of ch) {
    if (o.noRes === c) b.wire(P('UNO1', pin), H(`a${col}`), `wp${c}`, '#43a047');
    else b.part('resistor', onBoard(`f${x}`), `R${c}`, { resistance: o.r ?? 220, span: 3 })
      .wire(P('UNO1', pin), H(`j${x}`), `wp${c}`, '#43a047').wire(H(`g${x + 3}`), H(`a${col}`), `wl${c}`, '#fdd835');
  }
  b.wire(H('a21'), H(ca ? 'tp21' : 'tn21'), 'wc', ca ? '#e53935' : '#212121');
  if (ca) b.wire(P('UNO1', '5V'), H('tp3'), 'wv', '#e53935');
  else b.wire(P('UNO1', 'GND.1'), H('tn3'), 'wg', '#212121');
  return b;
}

export function runRgb(b: Builder, seconds: number, dt = 0.05) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  let con = '';
  const st: Array<{ t: number; i: [number, number, number]; con: string; diags: string[] }> = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((x) => x.id === 'UNO1')?.console ?? '';
    const an = analyze(doc, built, r.result, r.tones);
    const x = an.parts.LED1?.extra ?? {};
    st.push({ t: (k + 1) * dt, i: [x.i_R ?? 0, x.i_G ?? 0, x.i_B ?? 0], con, diags: an.diagnostics.map((d) => d.message) });
  }
  return { con, st, built, doc };
}
