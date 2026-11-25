import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { analyze } from '../src/instruments/measure';
import { Builder, H, onBoard } from './helpers';

export const DHT_CODE = [
  'import dht, time',
  'from machine import Pin',
  's = dht.DHT22(Pin(15))',
  'led = Pin(14, Pin.OUT)',
  'time.sleep(1)  # เอกสาร DHT: ห้ามสั่งงานภายใน 1 s หลังจ่ายไฟ',
  'while True:',
  '    try:',
  '        s.measure()',
  '        t = s.temperature()',
  '        h = s.humidity()',
  '        print("T =", t, "C  RH =", h, "%")',
  '        led.value(1 if t > 35 or h > 85 else 0)',
  '    except OSError as e:',
  '        print("read error", e)',
  '    time.sleep(2)',
  '',
].join('\n');

const col = (b: Builder, pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));

/**
 * แลป 41: Pico h1 · DHT22 j22 (VDD j22, DATA j23, NC j24, GND j25) ตะแกรงหันหน้า
 * สายเสียบแถว f/g (แถว i อยู่ใต้ตัวถังลึก 7.7 mm): VDD f22 → 3V3, GND f25 → GND.38, DATA g23 → GP15
 * ตัวต้านทานดึงขึ้น R1 10 kΩ h23–h27 + สาย g27 → g22 (DATA–VDD)
 * LED เตือน: GP14 → d26 · R2 330 Ω (a26–a29) → LED (A c29, K c30) → e30 → GND
 */
export function dhtRig(o: { code?: string; t?: number; h?: number; pullup?: number | null; vdd?: string; pullTo?: string } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? DHT_CODE, autorun: true })
    .part('dht22', onBoard('j22'), 'U1', { temperature: o.t ?? 30, humidity: o.h ?? 65 });
  b.wire(H('f22'), H(`a${col(b, o.vdd ?? '3V3')}`), 'wv').wire(H('f25'), H(`a${col(b, 'GND.38')}`), 'wg', '#212121').wire(H('g23'), H(`j${col(b, 'GP15')}`), 'wd', '#fdd835');
  if (o.pullup !== null) {
    b.part('resistor', onBoard('h23'), 'R1', { resistance: o.pullup ?? 10000, span: 4 });
    if (o.pullTo) b.wire(H('i27'), H(`b${col(b, o.pullTo)}`), 'wpu'); else b.wire(H('g27'), H('g22'), 'wpu');
  }
  b.part('resistor', onBoard('a26'), 'R2', { resistance: 330, span: 3 }).part('led', onBoard('c29'), 'LED1')
    .wire(H(`j${col(b, 'GP14')}`), H('d26'), 'wl').wire(H('e30'), H(`b${col(b, 'GND.38')}`), 'wlg', '#212121');
  return b;
}

export function runDht(b: Builder, seconds: number, dt = 0.25, onStep?: (t: number, an: ReturnType<typeof analyze>, result: import('../src/sim/solver').SimResult, built: ReturnType<typeof buildNetlist>) => void) {
  const e = new SimEngine();
  const doc = b.doc, built = buildNetlist(doc);
  let con = '';
  let an!: ReturnType<typeof analyze>;
  for (let k = 0; k < seconds / dt; k++) {
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    an = analyze(doc, built, r.result, r.tones);
    onStep?.((k + 1) * dt, an, r.result, built);
  }
  return { con, an, built, doc };
}
