import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { POWER_METER_CODE } from '../src/model/catalog';
import { tmText } from '../src/mcu/tm1637';
import type { I2cDevState } from '../src/mcu/i2c-bus';
import type { Tm1637State } from '../src/mcu/tm1637';
import { Builder, H, onBoard } from './helpers';

/**
 * แลป 49 (เครื่องวัดกำลังไฟฟ้า) บน MB-102: Pico h1 · รางบน tp = 3V3, tn = GND · รางล่าง bp = 3V3, bn = GND
 * INA219 j30 (VCC30 GND31 SCL32 SDA33 VIN−34 VIN+35) · TM1637 j55 (CLK55 DIO56 VCC57 GND58)
 * โหลด: VBUS (5 V) → VIN+ (g35) · VIN− (h34) → h38 · R1 f38–f42 · LED A g42 K g43 → bn44
 * I2C0: GP4 = SDA → g33 · GP5 = SCL → h32 · GP14 → CLK g55 · GP15 → DIO h56
 */
export function powerRig(o: { code?: string; resistance?: number; skip?: string[]; inaVcc?: 'bp' | 'none' } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  const skip = new Set(o.skip ?? []);
  b.part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? POWER_METER_CODE, autorun: o.code !== '' });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  b.part('ina219', onBoard('j30'), 'INA1', {});
  if (o.inaVcc !== 'none') b.wire(H('i30'), H('bp30'), 'wiv', '#e53935');
  b.wire(H('i31'), H('bn32'), 'wig', '#212121');
  b.wire(H(`j${col('GP4')}`), H('g33'), 'wsda', '#1e88e5').wire(H(`i${col('GP5')}`), H('h32'), 'wscl', '#fdd835');
  // โหลด
  b.wire(H(`a${col('VBUS')}`), H('g35'), 'wvbus', '#ff7043').wire(H('h34'), H('h38'), 'wload', '#ff7043');
  b.part('resistor', onBoard('f38'), 'R1', { resistance: o.resistance ?? 150, span: 4 });
  b.part('led', onBoard('g42'), 'LED1', {});
  b.wire(H('h43'), H('bn44'), 'wlk', '#212121');
  if (!skip.has('tm')) {
    b.part('tm1637', onBoard('j55'), 'DS1', {})
      .wire(H('i57'), H('bp57'), 'wtv', '#e53935').wire(H('i58'), H('bn58'), 'wtg', '#212121')
      .wire(H(`j${col('GP14')}`), H('g55'), 'wclk', '#8e24aa').wire(H(`i${col('GP15')}`), H('h56'), 'wdio', '#43a047');
  }
  return b;
}

export interface PowerStep { t: number; con: string; i2c: Record<string, I2cDevState>; seg: Record<string, Tm1637State>; text: string; an: ReturnType<typeof analyze>; iTrue: number }

export function runPower(b: Builder, seconds: number, dt = 0.25, cmd?: (t: number, b: Builder) => boolean | void, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: PowerStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    const an = analyze(b.doc, built, r.result, r.tones);
    const seg = r.result.seg ?? {};
    st.push({ t, con, i2c: r.result.i2c ?? {}, seg, text: tmText(seg.DS1), an, iTrue: Math.abs(r.result.elements?.['INA1#shunt']?.current ?? 0) });
  }
  return { con, st, built };
}
