import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { WEATHER_CODE } from '../src/model/catalog';
import { charLcdText } from '../src/mcu/i2c-sensors';
import type { I2cDevState } from '../src/mcu/i2c-bus';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * แลป 48 (สถานีตรวจอากาศ) บน MB-102: Pico h1 · รางบน tp = 3V3, tn = GND · รางล่างต่อกับรางบน (bp = 3V3, bn = GND)
 * BMP280 j30 (VCC30 GND31 SCL32 SDA33 CSB34 SDO35) · BH1750 j40 (VCC40 GND41 SCL42 SDA43 ADDR44)
 * I2C0: GP4 = SDA → g33 → g43 · GP5 = SCL → h32 → h42 · จอ LCD บนโต๊ะด้านหน้าบอร์ด: GND → bn, VCC → VBUS, SDA → f33, SCL → f32
 */
export function weatherRig(o: { code?: string; lux?: number; temperature?: number; pressure?: number; lcdVcc?: '3V3' | 'VBUS'; pullUps?: boolean; addr?: number; skip?: string[] } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  const skip = new Set(o.skip ?? []);
  b.part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? WEATHER_CODE, autorun: o.code !== '' });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  if (!skip.has('bmp')) b.part('bmp280', onBoard('j30'), 'BMP1', { ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.pressure !== undefined ? { pressure: o.pressure } : {}) })
    .wire(H('i30'), H('bp30'), 'wbv', '#e53935').wire(H('i31'), H('bn32'), 'wbg', '#212121');
  if (!skip.has('bh')) b.part('bh1750', onBoard('j40'), 'BH1', { ...(o.lux !== undefined ? { lux: o.lux } : {}) })
    .wire(H('i40'), H('bp40'), 'whv', '#e53935').wire(H('i41'), H('bn41'), 'whg', '#212121');
  // บัส I²C0
  b.wire(H(`j${col('GP4')}`), H('g33'), 'wsda', '#1e88e5').wire(H('h33'), H('g43'), 'wsda2', '#1e88e5')
    .wire(H(`i${col('GP5')}`), H('h32'), 'wscl', '#fdd835').wire(H('g32'), H('h42'), 'wscl2', '#fdd835');
  if (!skip.has('lcd')) {
    b.part('lcd1602', onTable(22, 34), 'LCD1', { pullUps: o.pullUps ?? false, ...(o.addr !== undefined ? { addr: o.addr } : {}) })
      .wire(P('LCD1', 'GND'), H('bn26'), 'wlg', '#212121')
      .wire(P('LCD1', 'VCC'), o.lcdVcc === '3V3' ? H('bp27') : H(`a${col('VBUS')}`), 'wlv', '#ff7043')
      .wire(P('LCD1', 'SDA'), H('f33'), 'wlsda', '#1e88e5').wire(P('LCD1', 'SCL'), H('f32'), 'wlscl', '#fdd835');
  }
  return b;
}

export interface WeatherStep { t: number; con: string; i2c: Record<string, I2cDevState>; text: string[]; an: ReturnType<typeof analyze> }

export function runWeather(b: Builder, seconds: number, dt = 0.25, cmd?: (t: number, b: Builder) => boolean | void, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '';
  const st: WeatherStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    const an = analyze(b.doc, built, r.result, r.tones);
    const i2c = r.result.i2c ?? {};
    st.push({ t, con, i2c, text: charLcdText(i2c.LCD1?.lcd), an });
  }
  return { con, st, built };
}
