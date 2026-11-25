import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { analyze } from '../src/instruments/measure';
import { Builder, H, P, onBoard, onTable } from './helpers';

export const FARM_CODE = [
  'from machine import ADC, Pin',
  'import time',
  's = ADC(26)',
  'pump = Pin(15, Pin.OUT)',
  'DRY = 30',
  'WET = 60',
  'while True:',
  '    v = s.read_u16() * 3.3 / 65535',
  '    m = (2.5 - v) / 1.25 * 100',
  '    print("moisture", round(m), "%")',
  '    if m < DRY:',
  '        pump.value(1)',
  '    elif m > WET:',
  '        pump.value(0)',
  '    time.sleep(0.2)',
  '',
].join('\n');

const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * ระบบรดน้ำอัตโนมัติ (แลป 40): Pico h5 · เซนเซอร์ MS1 (VCC 3V3, GND, AOUT → GP26) · โมดูลรีเลย์ K1 (V VBUS, G GND, S GP15)
 * ปั๊ม P1: VBUS → COM, NO → สายแดงปั๊ม, สายดำ → GND · สายยางปั๊ม → กระถางของ MS1
 */
export function farmRig(o: { code?: string; moisture?: number; dryRate?: number; target?: string; direct?: boolean; vcc?: string } = {}) {
  const b = new Builder().part('pico', onBoard('h5'), 'PICO1', { code: o.code ?? FARM_CODE, autorun: true });
  const vb = col(b, 'VBUS'), v3 = col(b, '3V3'), g18 = col(b, 'GND.18'), g38 = col(b, 'GND.38'), a0 = col(b, 'GP26'), gp = col(b, 'GP15');
  b.part('soilsensor', onTable(-60, 30), 'MS1', { moisture: o.moisture ?? 25, dryRate: o.dryRate ?? 0.5 })
    .part('relay', onTable(10, -28), 'K1')
    .part('pump', onTable(60, 30), 'P1', { target: o.target ?? 'MS1' })
    .wire(P('MS1', 'VCC'), H(`a${col(b, o.vcc ?? '3V3')}`), 'ws1')
    .wire(P('MS1', 'GND'), H(`a${g38}`), 'ws2', '#212121')
    .wire(P('MS1', 'AOUT'), H(`a${a0}`), 'ws3', '#fdd835')
    .wire(P('K1', 'V'), H(`b${vb}`), 'wk1')
    .wire(P('K1', 'G'), H(`j${g18}`), 'wk2', '#212121')
    .wire(P('K1', 'S'), H(`j${gp}`), 'wk3', '#43a047')
    .wire(P('P1', 'N'), H(`i${g18}`), 'wp2', '#212121');
  if (o.direct) b.wire(P('P1', 'P'), H(`i${gp}`), 'wp1');
  else b.wire(P('K1', 'COM'), H(`a${vb}`), 'wk4').wire(P('K1', 'NO'), P('P1', 'P'), 'wp1');
  void v3;
  return b;
}

export function runFarm(b: Builder, seconds: number, dt = 0.1, onStep?: (t: number, an: ReturnType<typeof analyze>, result: import('../src/sim/solver').SimResult, built: ReturnType<typeof buildNetlist>) => void) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  const tr: { t: number; m: number; on: boolean; flow: number; ip: number; vout: number }[] = [];
  let an!: ReturnType<typeof analyze>;
  for (let k = 0; k < seconds / dt; k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    an = analyze(doc, built, r.result, r.tones);
    const s = an.parts.MS1.extra!, p = an.parts.P1;
    tr.push({ t: (k + 1) * dt, m: s.moisture, on: !!an.parts.K1.extra!.energized, flow: p.extra!.flow, ip: Math.abs(p.current ?? 0), vout: s.vout });
    onStep?.((k + 1) * dt, an, r.result, built);
  }
  return { tr, an, built, doc };
}

