import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { checkLesson } from '../src/lessons/checks';
import { LESSONS } from '../src/lessons/lessons';
import { SCHEMATICS } from '../src/lessons/schematics';
import { pinHolesFor } from '../src/model/geometry';
import { OLED_CODE, WATCH_CODE, pinDefs } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { validateCircuit } from '../src/model/schema';
import { emptyWork, type StudentWork } from '../src/model/types';
import { screenText } from '../src/mcu/i2c-bus';
import { Builder, H, onBoard } from './helpers';
import { watchRig } from './watch-rig';

/** Pico h1 + จอ OLED ที่ j22 (GND VCC SCL SDA = j22–j25) */
function oledRig(o: { code?: string; swap?: boolean; vcc?: '3V3' | 'VBUS' } = {}) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? OLED_CODE, autorun: true }).part('ssd1306', onBoard('j22'), 'OLED1');
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  b.wire(H(`j${col('GND.38')}`), H('i22'), 'wg', '#212121').wire(H(`a${col(o.vcc ?? '3V3')}`), H('i23'), 'wv')
    .wire(H(`j${col(o.swap ? 'GP4' : 'GP5')}`), H('i24'), 'wscl', '#fdd835').wire(H(`i${col(o.swap ? 'GP5' : 'GP4')}`), H('i25'), 'wsda', '#1e88e5');
  return b;
}

function runChecked(b: Builder, lesson: string, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void) {
  const work: StudentWork = emptyWork(); work.achieved[lesson] = {};
  let built = buildNetlist(b.doc);
  const e = new SimEngine();
  let st: Record<string, { pass: boolean; detail?: string }> = {}, con = '';
  const texts: string[][] = [];
  let maxVib = 0;
  let an!: ReturnType<typeof analyze>;
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    con += r.mcu?.find((m) => m.id === 'PICO1')?.console ?? '';
    an = analyze(b.doc, built, r.result, r.tones);
    st = checkLesson(lesson, { doc: b.doc, built, result: r.result, analysis: an, work, time: t, mcu: r.mcu });
    for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved[lesson][g] = true;
    texts.push(screenText(r.result.i2c?.OLED1));
    maxVib = Math.max(maxVib, Math.abs(an.parts.M1?.current ?? 0));
  }
  return { st, ach: work.achieved[lesson], con, texts, an, maxVib };
}

describe('แลป 45: บัส I²C + จอ OLED บน Pico (MicroPython จริง)', () => {
  it('scan พบ 0x3C · ข้อความบนจอมาจากหน่วยความจำจอ · ตัวนับเปลี่ยน · ตัวตรวจผ่าน 4 ข้อหลัก · ใส่ invert(1) ผ่านข้อเสริม', { timeout: 120000 }, () => {
    expect(LESSONS.find((l) => l.id === 'oled')?.number).toBe(45);
    expect(SCHEMATICS.oled).toBeDefined();
    const errs: string[] = [];
    const b = oledRig();
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const r = runChecked(b, 'oled', 3.0);
    expect(r.con).toContain("found: ['0x3c']");
    const last = r.texts.at(-1)!;
    expect(last.slice(0, 2)).toEqual(['Circuit Lab', 'Pico + OLED']);
    expect(last[2]).toMatch(/^count \d+$/);
    const counts = new Set(r.texts.map((t) => t[2]).filter(Boolean));
    expect(counts.size).toBeGreaterThanOrEqual(3);
    for (const g of ['wire', 'ack', 'text', 'update']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.ach.invert ?? false).toBe(false);
    const inv = runChecked(oledRig({ code: OLED_CODE.replace('oled = ssd1306.SSD1306_I2C(128, 64, i2c)   # 0x3C', 'oled = ssd1306.SSD1306_I2C(128, 64, i2c)\noled.invert(1)') }), 'oled', 2.0);
    expect(inv.ach.invert, inv.st.invert.detail).toBe(true);
    expect(inv.texts.at(-1)![0]).toBe('Circuit Lab');
  });

  it('สลับ SDA/SCL → scan ว่าง + OSError จากเฟิร์มแวร์ + คำเตือนสลับสาย · ไฟเลี้ยงจาก VBUS → สาย I²C ถูกดึงขึ้น ≈ 5 V เตือนอันตรายต่อขา Pico', { timeout: 120000 }, () => {
    const sw = runChecked(oledRig({ swap: true }), 'oled', 2.0);
    expect(sw.con).toContain('found: []');
    expect(sw.con).toMatch(/OSError: \[Errno (5|19|110)\]/);
    expect(sw.an.diagnostics.map((d) => d.message).join(' ')).toMatch(/สลับสาย SDA\/SCL/);
    expect(sw.ach.ack ?? false).toBe(false);
    expect(sw.st.wire.pass).toBe(false);
    const v5 = runChecked(oledRig({ vcc: 'VBUS' }), 'oled', 0.4);
    const msg = v5.an.diagnostics.map((d) => d.message).join(' ');
    expect(msg).toMatch(/สาย SDA ถูกดึงขึ้นถึง (4\.[5-9]|5\.\d) V/);
    expect(v5.st.wire.pass).toBe(false);
  });
});

describe('ฮาร์ดแวร์ I²C ของ RP2040 (rp2040js + pico-sdk)', () => {
  it('เขียนไปที่อยู่ที่ไม่มีอุปกรณ์ → OSError EIO ทันที (ไม่ใช่ ETIMEDOUT) และธุรกรรมถัดไปทำงานปกติ — TX_EMPTY ต้องขึ้นหลัง abort เหมือนชิปจริง', { timeout: 60000 }, () => {
    const code = "from machine import Pin, I2C\ni2c = I2C(0, sda=Pin(4), scl=Pin(5))\nfor a in (0x50, 0x3c, 0x50, 0x3c):\n    try:\n        i2c.writeto(a, b'\\x80\\xaf')\n        print('ok', hex(a))\n    except OSError as e:\n        print('err', hex(a), e)\nprint('end')\n";
    const r = runChecked(oledRig({ code }), 'oled', 1.5);
    expect(r.con.replace(/\r/g, '')).toContain("err 0x50 [Errno 5] EIO\nok 0x3c\nerr 0x50 [Errno 5] EIO\nok 0x3c\nend");
  });
});

describe('แลป 46: Smart Watch บน Pico (OLED + DS3231 + MPU6050 + ปุ่ม + มอเตอร์สั่น)', () => {
  it('เดิน 100 ก้าว/นาที: scan พบ 4 ที่อยู่ · เวลาตรง DS3231 · ก้าวบนจอตรงก้าวจริง · สั่นทุก 10 ก้าว · กดปุ่มดูอุณหภูมิ → แลปผ่านครบ 5 ข้อ', { timeout: 200000 }, () => {
    expect(LESSONS.find((l) => l.id === 'watch')?.number).toBe(46);
    expect(SCHEMATICS.watch).toBeDefined();
    const b = watchRig({ motion: 'walk', spm: 100 });
    const errs: string[] = [];
    expect(validateCircuit(JSON.parse(JSON.stringify(b.doc)), errs, []), errs.join()).not.toBeNull();
    const r = runChecked(b, 'watch', 10.5, 0.1, (t, bb) => {
      const sw = bb.doc.parts.find((p) => p.id === 'SW1')!.params as { pressed: boolean };
      const want = t > 9.5 && t < 9.8;
      if (sw.pressed !== want) { sw.pressed = want; return true; }
    });
    expect(r.con).toContain("I2C: ['0x3c', '0x57', '0x68', '0x69']");
    expect(r.maxVib).toBeGreaterThan(0.04);
    expect(r.texts.some((t) => t.some((l) => /^Temp 25 C$/.test(l)))).toBe(true);
    for (const g of ['bus', 'clock', 'steps', 'temp', 'vibrate']) expect(r.ach[g], `${g}: ${r.st[g]?.detail}`).toBe(true);
    expect(r.an.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('ไม่ต่อ AD0 → DS3231 กับ MPU6050 ที่อยู่ 0x68 ซ้ำ (scan ไม่พบ 0x69) เตือนที่อยู่ซ้ำ · ลืมปลุก MPU6050 → ก้าวไม่เพิ่ม + คำแนะนำ', { timeout: 200000 }, () => {
    const c = runChecked(watchRig({ motion: 'walk', ad0: false, code: WATCH_CODE.replace('MPU = 0x69', 'MPU = 0x68') }), 'watch', 3.0);
    expect(c.con).toContain("I2C: ['0x3c', '0x57', '0x68']");
    expect(c.an.diagnostics.map((d) => d.message).join(' ')).toMatch(/ซ้ำกับอุปกรณ์อื่น/);
    expect(c.st.bus.pass).toBe(false);
    const s = runChecked(watchRig({ motion: 'walk', code: WATCH_CODE.replace('i2c.writeto_mem(MPU, 0x6B, b"\\x00")', 'pass') }), 'watch', 4.0);
    expect(s.texts.at(-1)!.join(' ')).toContain('Steps 0');
    expect(s.an.diagnostics.map((d) => d.message).join(' ')).toMatch(/ยังอยู่ในโหมดหลับ/);
    expect(s.ach.steps ?? false).toBe(false);
  });
});

describe('ESP32-S2-DevKitM-1 (เฉพาะโมเดล)', () => {
  it('ขาตามเอกสาร Espressif 2 × 21 ขา แถวห่าง 0.9" (c กับ j) · ไม่มีอุปกรณ์ไฟฟ้า · ระดับการรองรับ "เฉพาะโมเดล" · แจ้งเมื่อมีการต่อสาย', () => {
    const b = new Builder().part('esp32s2', onBoard('j5'), 'U1');
    const p = b.doc.parts[0];
    const holes = pinHolesFor(p);
    expect(pinDefs(p).length).toBe(42);
    expect(holes.find((h) => h.pin === 'IO18')?.hole).toBe('j5');
    expect(holes.find((h) => h.pin === 'GND.2')?.hole).toBe('j25');
    expect(holes.find((h) => h.pin === 'GND.1')?.hole).toBe('c5');
    expect(holes.find((h) => h.pin === '3V3')?.hole).toBe('c25');
    expect(holes.find((h) => h.pin === 'IO0')?.hole).toBe('c24');
    const built = buildNetlist(b.doc);
    expect(built.netlist.elements.length).toBe(0);
    expect(supportSummary(SUPPORT.esp32s2).text).toBe('เฉพาะโมเดล');
    const r = new SimEngine().handle({ seq: 1, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    expect(analyze(b.doc, built, r.result, r.tones).diagnostics.filter((d) => d.partId === 'U1')).toEqual([]);
    b.part('led', onBoard('a24'), 'LED1');
    const b2 = buildNetlist(b.doc), r2 = new SimEngine().handle({ seq: 1, netlist: b2.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    expect(analyze(b.doc, b2, r2.result, r2.tones).diagnostics.map((d) => d.message).join(' ')).toMatch(/เป็นโมเดลเท่านั้น/);
  });
});
