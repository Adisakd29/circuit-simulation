/**
 * Rotary encoder: การเด้งของหน้าสัมผัส (ดาต้าชีต Alps EC11B: bounce ≤ 2 ms, chattering ≤ 3 ms) — โค้ดที่นับทุกขอบนับเกิน, โค้ดถอดรหัสควอดราเจอร์นับถูก
 */
import { describe, expect, it } from 'vitest';
import { EncoderHub } from '../src/mcu/encoder';
import { setPartParams } from '../src/editor/ops';
import { encoderRig, runInput } from './input-rig';

describe('rotary encoder: หน้าสัมผัสเด้ง', () => {
  it('ระดับ hub: เด้ง 1 ms → หน้าสัมผัส A สลับกลับ 2 ครั้งภายใน 1 ms ก่อนนิ่ง · ไม่เด้ง (0) → เปลี่ยนครั้งเดียว · จำนวนคลิกนับเท่าเดิม', () => {
    // หน้าสัมผัส A เปลี่ยน 2 ครั้งต่อคลิก · เด้ง: แต่ละครั้ง = เปลี่ยน + (กลับ, ไป) × 2 = 5 ขอบ
    for (const [bounce, edgesA] of [[0, 2], [1, 10]] as const) {
      const h = new EncoderHub();
      h.sync([{ id: 'E', clk: 1, dt: 2, gnd: 0, R: 1, detentMs: 12, bounceMs: bounce }]);
      h.turn('E', 1, 0);
      let a = false, n = 0;
      for (let t = 0; t < 0.02; t += 1e-5) { h.advance(t); const s = h.snapshot().E; if (s.a !== a) { n++; a = s.a; } }
      expect(n).toBe(edgesA);
      expect(h.snapshot().E.count).toBe(1);
    }
  });

  it('Pico: หมุน 5 คลิก (เด้ง 1 ms) — นับขอบลงของ CLK ด้วย IRQ ได้เกิน 5 · ถอดรหัสควอดราเจอร์จากตาราง (A,B) ได้ 5 พอดี', { timeout: 300000 }, () => {
    const code = [
      'from machine import Pin', 'import time',
      'clk = Pin(22, Pin.IN); dt = Pin(21, Pin.IN)',
      'raw = [0]; pos = [0]; st = [(clk.value() << 1) | dt.value()]',
      'TAB = [0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0]',
      'def on_clk(p): raw[0] += 1',
      'def quad(p):',
      '    s = (clk.value() << 1) | dt.value(); pos[0] += TAB[(st[0] << 2) | s]; st[0] = s',
      'clk.irq(lambda p: (on_clk(p), quad(p)), Pin.IRQ_FALLING | Pin.IRQ_RISING)',
      'dt.irq(quad, Pin.IRQ_FALLING | Pin.IRQ_RISING)',
      'while True:',
      '    print("R %d %d" % (raw[0], pos[0])); time.sleep_ms(100)',
    ].join('\n') + '\n';
    const b = encoderRig({ code });
    b.doc = (setPartParams(b.doc, 'ENC1', { bounceMs: 1, detentMs: 40 }) as { doc: typeof b.doc }).doc;
    const r = runInput(b, 2.0, 0.1, undefined, (t) => (Math.abs(t - 0.6) < 1e-9 ? { ENC1: 5 } : undefined));
    const m = [...r.con.matchAll(/(?:^|>>> )R (\d+) (-?\d+)/gm)].at(-1)!;
    const raw = Number(m[1]), quad = Number(m[2]);
    // แต่ละคลิก CLK เปลี่ยน 2 ครั้ง (ลง/ขึ้น) × (1 + 2 การเด้ง × 2 ขอบ) → ขอบดิบมากกว่า 10 มาก
    expect(raw).toBeGreaterThan(20);
    // ตารางควอดราเจอร์: 4 สถานะต่อคลิก → 20 ขั้น (ขั้นที่เด้งไป-กลับหักล้างกัน)
    expect(Math.abs(quad)).toBe(20);
  });
});
