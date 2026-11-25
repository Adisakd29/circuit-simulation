import { SimEngine, type EngineResponse } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { setBoardModel } from '../src/editor/ops';
import { RPI_BUTTON_CODE } from '../src/model/catalog';
import { piHost, setPyodideBase } from '../src/mcu/pi-python';
import { Builder, H, P, onBoard } from './helpers';

/** Python ของ Pi ต้องใช้ JSPI (Node ≥ 24 / Chrome ≥ 137) */
export const hasJspi = typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending === 'function';
setPyodideBase(new URL('../node_modules/pyodide/', import.meta.url).pathname);

/**
 * แลป 54: Raspberry Pi 5 บนโต๊ะหลังเบรดบอร์ด MB-102 · GND (ขา 14) → tn5
 * LED1 แดง: GPIO17 (ขา 11) → c20 · R1 330 Ω b20–b24 · LED a24/a25 · d25 → tn26
 * LED2 เขียว: GPIO18 (ขา 12) → c32 · R2 330 Ω b32–b36 · LED a36/a37 · d37 → tn38
 * SW1 f45 (1 f45, 2 e45, 3 f47, 4 e47): คอลัมน์ 45 → GND (a45 → tn45) · คอลัมน์ 47 → GPIO27 (ขา 13 → a47)
 */
export function rpiRig(o: { code?: string; autorun?: boolean; buttonPin?: string } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part('rpi5', { kind: 'table', x: -30, z: -44, rotation: 180 }, 'RPI1', { code: o.code ?? RPI_BUTTON_CODE, autorun: o.autorun ?? true });
  b.wire(P('RPI1', 'GND.3'), H('tn5'), 'wg', '#212121');
  for (const [gp, c, color, id, rid] of [[17, 20, 'red', 'LED1', 'R1'], [18, 32, 'green', 'LED2', 'R2']] as const) {
    b.wire(P('RPI1', `GPIO${gp}`), H(`c${c}`), `wl${gp}`, '#43a047');
    b.part('resistor', onBoard(`b${c}`), rid, { resistance: 330, span: 4 });
    b.part('led', onBoard(`a${c + 4}`), id, { color });
    b.wire(H(`d${c + 5}`), H(`tn${c + 6}`), `wk${gp}`, '#212121');
  }
  b.part('pushbutton', onBoard('f45'), 'SW1', {});
  b.wire(H('a45'), H('tn45'), 'wsg', '#212121').wire(P('RPI1', o.buttonPin ?? 'GPIO27'), H('a47'), 'wsb', '#1e88e5');
  return b;
}

let lastEngine: SimEngine | null = null;

export interface PiStep { t: number; con: string; r: EngineResponse; an: ReturnType<typeof analyze>; doc: Builder['doc']; built: ReturnType<typeof buildNetlist> }

/** รันทีละ dt ด้วย handleAsync (เหมือนใน worker) · cmd(t, b) คืน true เมื่อแก้วงจร · mcu(t) = คำสั่งถึงบอร์ด */
export async function runPi(b: Builder, seconds: number, dt = 0.05, cmd?: (t: number, b: Builder) => boolean | void, mcu?: (t: number) => Record<string, unknown> | undefined, e?: SimEngine) {
  if (!e) { lastEngine?.dispose(); e = new SimEngine(); e.piHost = piHost; lastEngine = e; }
  let built = buildNetlist(b.doc);
  let con = '';
  const st: PiStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = +((k + 1) * dt).toFixed(6);
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const m = mcu?.(t);
    const r = await e.handleAsync({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(m ? { mcu: m as never } : {}) });
    con += r.mcu?.find((x) => x.id === 'RPI1')?.console ?? '';
    st.push({ t, con, r, an: analyze(b.doc, built, r.result, r.tones), doc: b.doc, built });
  }
  return { con, st, built, e };
}

/** รอจน Python โหลดเสร็จ (ครั้งแรก ~ 2–4 s ใน Node) */
export async function waitPython() {
  piHost.ensureLoaded();
  for (let i = 0; i < 600 && piHost.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 50));
  if (piHost.state !== 'ready') throw new Error(piHost.error);
}
