/**
 * DHT11 ตามเอกสาร Aosong (2018): ค่าที่อ่านเป็นผลการวัดครั้งก่อน · เวลาตอบสนอง 1/e ความชื้น < 6 s อุณหภูมิ < 10 s · ห้ามสั่งงานภายใน 1 s หลังจ่ายไฟ
 * โค้ด MicroPython (โมดูล dht ในเฟิร์มแวร์ ถอดรหัสบิตเอง) อ่านจากบัสสายเดียวที่จำลอง
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { setPartParams } from '../src/editor/ops';
import { pinHolesFor } from '../src/model/geometry';
import { Builder, H, onBoard } from './helpers';

function rig(code: string) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code, autorun: true }).part('dht11', onBoard('j22'), 'U1', { temperature: 28, humidity: 60 });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H('f22'), H(`a${col('3V3')}`), 'wv').wire(H('f25'), H(`a${col('GND.38')}`), 'wg', '#212121').wire(H('g23'), H(`j${col('GP15')}`), 'wd', '#fdd835');
  b.part('resistor', onBoard('h23'), 'R1', { resistance: 10000, span: 4 }).wire(H('g27'), H('g22'), 'wpu');
  return b;
}

function run(b: Builder, seconds: number, change?: { at: number; t: number; h: number }) {
  const e = new SimEngine();
  let built = buildNetlist(b.doc), con = '', an!: ReturnType<typeof analyze>;
  const dt = 0.25;
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (change && Math.abs(t - change.at) < 1e-9) { b.doc = (setPartParams(b.doc, 'U1', { temperature: change.t, humidity: change.h }) as { doc: typeof b.doc }).doc; built = buildNetlist(b.doc); }
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.[0]?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
  }
  return { con, an };
}
const reads = (con: string) => [...con.matchAll(/(?:^|>>> )R (\d+) (\d+) (\d+)/gm)].map((m) => ({ ms: +m[1], t: +m[2], h: +m[3] }));

describe('DHT11: ผลการวัดครั้งก่อน + ความหน่วงของเซนเซอร์ + ช่วงหลังจ่ายไฟ', () => {
  it('อุณหภูมิกระโดด 28 → 40 °C, ความชื้น 60 → 80 %RH ที่ t = 3 s: การอ่านครั้งแรกหลังเปลี่ยนยังได้ค่าเดิม แล้วค่อย ๆ เข้าหาค่าใหม่ตามค่าคงที่เวลา 10 s / 6 s', { timeout: 300000 }, () => {
    const code = 'import dht, time\nfrom machine import Pin\ns = dht.DHT11(Pin(15))\ntime.sleep(1.2)\nt0 = time.ticks_ms()\nwhile True:\n    s.measure()\n    print("R %d %d %d" % (time.ticks_ms(), s.temperature(), s.humidity()))\n    time.sleep(1.5)\n';
    const { con, an } = run(rig(code), 16, { at: 3, t: 40, h: 80 });
    const r = reads(con);
    expect(r.length).toBeGreaterThanOrEqual(9);
    // ช่วงเวลาจริงของแต่ละการอ่าน (ms ของ ticks นับจากบูต ≈ เวลาจำลอง − เวลาบูต) — เทียบรูปแบบ ไม่ต้องรู้เวลาบูตแน่นอน
    const before = r.filter((x) => x.t === 28 && x.h === 60);
    const firstChanged = r.findIndex((x) => x.t !== 28 || x.h !== 60);
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(firstChanged).toBeGreaterThan(0);
    // ค่าเพิ่มขึ้นแบบไม่ลดลง และยังไม่ถึงค่าใหม่ทันที
    for (let i = 1; i < r.length; i++) { expect(r[i].t).toBeGreaterThanOrEqual(r[i - 1].t); expect(r[i].h).toBeGreaterThanOrEqual(r[i - 1].h); }
    const firstNew = r[firstChanged];
    expect(firstNew.t).toBeLessThan(36);
    expect(firstNew.h).toBeLessThan(78);
    // ค่าสุดท้าย (การวัดของรอบก่อนหน้า ≈ 10–11 s หลังเปลี่ยน): อุณหภูมิ ≈ 28 + 12(1 − e^(−t/10)), ความชื้น ≈ 60 + 20(1 − e^(−t/6))
    const last = r.at(-1)!;
    expect(last.t).toBeGreaterThanOrEqual(34); expect(last.t).toBeLessThanOrEqual(38);
    expect(last.h).toBeGreaterThanOrEqual(76); expect(last.h).toBeLessThanOrEqual(80);
    expect(an.diagnostics.filter((d) => d.partId === 'U1' && d.severity !== 'info')).toEqual([]);
  });

  it('อ่านทันทีหลังจ่ายไฟ (ไม่รอ 1 s): เซนเซอร์ไม่ตอบ → OSError ETIMEDOUT และแอปเตือน · อ่านอีกครั้งหลัง 1 s ได้ค่า', { timeout: 300000 }, () => {
    const code = 'import dht, time\nfrom machine import Pin\ns = dht.DHT11(Pin(15))\ntry:\n    s.measure(); print("R0 ok")\nexcept OSError as e:\n    print("R0 err", e)\ntime.sleep(1.2)\ns.measure()\nprint("R 0 %d %d" % (s.temperature(), s.humidity()))\n';
    const { con, an } = run(rig(code), 2.5);
    expect(con).toMatch(/R0 err .*(ETIMEDOUT|110)/);
    expect(reads(con)[0]).toMatchObject({ t: 28, h: 60 });
    expect(an.diagnostics.some((d) => d.partId === 'U1' && /1 วินาทีหลังจ่ายไฟ/.test(d.message))).toBe(true);
  });
});
