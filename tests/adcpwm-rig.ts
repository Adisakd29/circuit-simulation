import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { analyze } from '../src/instruments/measure';
import { Builder, H, onBoard } from './helpers';

export const ADCPWM_CODE = [
  'from machine import ADC, Pin, PWM',
  'import time',
  'pot = ADC(26)',
  'led = PWM(Pin(15))',
  'led.freq(1000)',
  'while True:',
  '    v = pot.read_u16()',
  '    led.duty_u16(v)',
  '    print("ADC =", v, " V =", round(v * 3.3 / 65535, 2))',
  '    time.sleep(0.2)',
  '',
].join('\n');

const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * แลป 42: Pico h1 · VR1 10 kΩ ที่ j22 (ขา 1 j22, ขา 2 j23, ขา 3 j24) — ขา 1 → GND, ขา 3 → 3V3, ขา 2 (wiper) → GP26
 * LED: GP15 → d26 · R1 220 Ω (a26–a29) → LED (A c29, K c30) → e30 → GND
 */
export function adcRig(o: { code?: string; pos?: number; r?: number; adcPin?: string; noGnd?: boolean; vcc?: string } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? ADCPWM_CODE, autorun: true })
    .part('potentiometer', onBoard('j22'), 'VR1', { resistance: 10000, position: o.pos ?? 0.5 });
  if (!o.noGnd) b.wire(H('f22'), H(`a${col(b, 'GND.38')}`), 'wg', '#212121');
  b.wire(H('f24'), H(`a${col(b, o.vcc ?? '3V3')}`), 'wv').wire(H('f23'), H(`a${col(b, o.adcPin ?? 'GP26')}`), 'wa', '#fdd835');
  b.part('resistor', onBoard('a26'), 'R1', { resistance: o.r ?? 220, span: 3 }).part('led', onBoard('c29'), 'LED1')
    .wire(H(`j${col(b, 'GP15')}`), H('d26'), 'wl', '#43a047').wire(H('e30'), H(`b${col(b, 'GND.38')}`), 'wlg', '#212121');
  return b;
}

export function runAdc(b: Builder, seconds: number, dt = 0.1, onStep?: (t: number, an: ReturnType<typeof analyze>, result: import('../src/sim/solver').SimResult, built: ReturnType<typeof buildNetlist>) => void, e = new SimEngine(), restart = true) {
  const doc = b.doc, built = buildNetlist(doc);
  let con = '';
  let an!: ReturnType<typeof analyze>;
  let fin: { ok: boolean; error?: string } | null = null;
  for (let k = 0; k < seconds / dt; k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: restart && k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    if (r.mcu?.[0]?.finished) fin = r.mcu[0].finished;
    an = analyze(doc, built, r.result, r.tones);
    onStep?.((k + 1) * dt, an, r.result, built);
  }
  return { con, an, built, doc, fin, e };
}
