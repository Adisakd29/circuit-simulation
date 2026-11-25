/**
 * HD44780 อ่านกลับ (RW = 1): busy flag + AC และข้อมูลใน DDRAM — จอแบบขนานต่อ Pico โดยตรง (โหมด 4 บิต) และแบบ I²C ผ่าน PCF8574
 * โค้ด MicroPython ขยับขา/ส่งไบต์เองทั้งหมด (ไม่ใช้ไลบรารี) — ค่าที่อ่านได้มาจากจอที่จำลองผ่านขาเท่านั้น
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { holeInfo } from '../src/model/breadboard';
import { weatherRig, runWeather } from './weather-rig';
import { Builder, H, onBoard } from './helpers';

const val = (con: string, k: string) => Number([...con.matchAll(new RegExp(`(?:^|>>> )R ${k} (-?\\d+)`, 'gm'))].at(-1)?.[1]);

describe('HD44780 อ่านกลับ', () => {
  it('แบบขนาน 4 บิต + Pico (ไฟ 3.3 V): เขียน "Hi" → อ่าน AC = 2 · ตั้ง AC = 0 แล้วอ่านข้อมูลได้ "H", "i" · หลัง Clear อ่าน BF = 1 ทันที และ 0 หลัง 2 ms', { timeout: 300000 }, () => {
    const code = [
      'from machine import Pin', 'import time',
      'rs = Pin(16, Pin.OUT, value=0); rw = Pin(17, Pin.OUT, value=0); e = Pin(18, Pin.OUT, value=0)',
      'D = [Pin(p, Pin.OUT, value=0) for p in (19, 20, 21, 22)]',
      'def pulse():', '    e.value(1); time.sleep_us(2); e.value(0); time.sleep_us(2)',
      'def nib(n):', '    for i in range(4): D[i].init(Pin.OUT); D[i].value((n >> i) & 1)', '    pulse()',
      'def cmd(b, r=0, wait=60):', '    rs.value(r); rw.value(0); nib(b >> 4); nib(b & 15); time.sleep_us(wait)',
      'def rd(r):', '    for d in D: d.init(Pin.IN)', '    rs.value(r); rw.value(1); v = 0',
      '    for sh in (4, 0):', '        e.value(1); time.sleep_us(2); n = 0', '        for i in range(4): n |= D[i].value() << i',
      '        e.value(0); time.sleep_us(2); v |= n << sh', '    rw.value(0)', '    return v',
      'time.sleep_ms(20)', 'for _ in range(3):', '    nib(3); time.sleep_ms(5)', 'nib(2); time.sleep_ms(1)',
      'cmd(0x28); cmd(0x0C); cmd(0x01, 0, 2000); cmd(0x06)', 'cmd(ord("H"), 1); cmd(ord("i"), 1)',
      'print("R ac %d" % (rd(0) & 0x7F))', 'cmd(0x80)', 'print("R c1 %d" % rd(1))', 'print("R c2 %d" % rd(1))', 'print("R ac2 %d" % (rd(0) & 0x7F))',
      'cmd(0x01, 0, 0)', 'print("R bf1 %d" % (rd(0) >> 7))', 'time.sleep_ms(2)', 'print("R bf2 %d" % (rd(0) >> 7))',
    ].join('\n') + '\n';
    const b = new Builder();
    b.doc = (setBoardModel(b.doc, 'bb1', 'MB-102') as { doc: typeof b.doc }).doc;
    b.part('pico', onBoard('h1'), 'PICO1', { code, autorun: true }).part('lcd1602p', onBoard('j40'), 'LCD1');
    const ph = pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!);
    const hole = (pin: string) => { const x = ph.find((q) => q.pin === pin)!.hole!; return H(`${x.startsWith('c') ? 'a' : 'j'}${x.slice(1)}`); };
    const c = (pin: string) => 40 + ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'].indexOf(pin);
    const rail = (r: string, c: number) => { for (let d = 0; d < 6; d++) for (const x of [c + d, c - d]) if (holeInfo(`${r}${x}`)) return H(`${r}${x}`); throw new Error(r); };
    b.wire(hole('3V3'), rail('tp', 5), 'v', '#e53935').wire(hole('GND.38'), rail('tn', 3), 'g', '#212121').wire(rail('tp', 2), rail('bp', 2), 'vv', '#e53935').wire(rail('tn', 4), rail('bn', 4), 'gg', '#212121');
    b.wire(H(`i${c('VSS')}`), rail('bn', c('VSS')), 'lg', '#212121').wire(H(`i${c('VDD')}`), rail('bp', c('VDD')), 'lv', '#e53935').wire(H(`i${c('V0')}`), rail('bn', c('V0') + 2), 'l0', '#212121');
    ([['RS', 'GP16'], ['RW', 'GP17'], ['E', 'GP18'], ['D4', 'GP19'], ['D5', 'GP20'], ['D6', 'GP21'], ['D7', 'GP22']] as const).forEach(([l, p], k) => b.wire(hole(p), H(`h${c(l)}`), `d${k}`, '#1e88e5'));
    const e = new SimEngine(), built = buildNetlist(b.doc);
    let con = '', st: NonNullable<ReturnType<SimEngine['handle']>['result']['plcd']>['LCD1'] | undefined;
    for (let k = 0; k < 20; k++) { const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: 0.1, restart: k === 0, watch: [], budgetMs: 1e9 }); con += r.mcu?.[0]?.console ?? ''; st = r.result.plcd?.LCD1; }
    expect(val(con, 'ac')).toBe(2);
    expect([val(con, 'c1'), val(con, 'c2')]).toEqual(['H'.charCodeAt(0), 'i'.charCodeAt(0)]);
    expect(val(con, 'ac2')).toBe(2);
    expect([val(con, 'bf1'), val(con, 'bf2')]).toEqual([1, 0]);
    expect(st?.dropped).toBe(0);
  });

  it('I²C (PCF8574): เขียนพอร์ตโดยตั้ง RW = 1 + D7–D4 = 1 แล้วยก E → อ่านพอร์ตได้นิบเบิลจากจอ (BF + AC) · ส่งข้อมูลระหว่าง busy (หลัง Clear) → ถูกทิ้งและแอปเตือน', { timeout: 300000 }, () => {
    const code = [
      'from machine import Pin, I2C', 'import time',
      'i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000); A = 0x27', 'BL = 0x08',
      'def w(v): i2c.writeto(A, bytes([v | BL]))',
      'def nib(n, rs):', '    w((n << 4) | rs | 0x04); w((n << 4) | rs)',
      'def send(b, rs=0): nib(b >> 4, rs); nib(b & 15, rs); time.sleep_us(100)',
      'def rd():', '    v = 0', '    for sh in (4, 0):', '        w(0xF0 | 0x02 | 0x04); n = i2c.readfrom(A, 1)[0] >> 4; w(0xF0 | 0x02); v |= n << sh', '    return v',
      'time.sleep_ms(20)', 'for _ in range(3):', '    nib(3, 0); time.sleep_ms(5)', 'nib(2, 0); time.sleep_ms(1)',
      'send(0x28); send(0x0C); send(0x01); time.sleep_ms(2); send(0x06)', 'for ch in b"OK": send(ch, 1)',
      'print("R ac %d" % (rd() & 0x7F))',
      'send(0x01); send(ord("X"), 1)  # ส่งตามหลัง Clear ทันที (< 1.52 ms)',
      'time.sleep_ms(3); print("R ac2 %d" % (rd() & 0x7F))',
    ].join('\n') + '\n';
    const r = runWeather(weatherRig({ code, skip: ['bmp', 'bh'] }), 1.5);
    expect(val(r.con, 'ac')).toBe(2);
    expect(val(r.con, 'ac2')).toBe(0); // 'X' ถูกทิ้ง AC ยังเป็น 0
    const last = r.st.at(-1)!;
    expect(last.i2c.LCD1?.lcdDropped).toBeGreaterThan(0);
    expect(last.an.diagnostics.some((d) => d.partId === 'LCD1' && /busy/.test(d.message))).toBe(true);
  });
});
