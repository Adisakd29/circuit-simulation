import { describe, expect, it } from 'vitest';
import { LedPlayback } from '../src/render/led-playback';
import { ledBrightness } from '../src/instruments/measure';

/** ไฟกะพริบ 343 ms (ติด 171.5 / ดับ 171.5) ส่งเป็นช่วง ๆ ละ 25–50 ms ที่มาถึงไม่สม่ำเสมอ → ขอบที่แสดงต้องห่างเท่ากัน (±1 เฟรม) */
const wave = (t: number) => (Math.floor(t / 0.1715) % 2 === 0 ? 0.01 : 0);

describe('ตัวเล่นความสว่าง LED ตามเวลาจำลอง', () => {
  it('ช่วงคำนวณ 25/50 ms และเวลาที่ผลมาถึงแกว่ง ±15 ms → ขอบที่แสดงคลาดจากเวลาจริงไม่เกิน 1 เฟรม (16.7 ms)', () => {
    const pb = new LedPlayback(['L'], [0.02], 1);
    let t = 0, wall = 1000, seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const arrivals: Array<{ wall: number; t: number }> = [];
    while (t < 5) { const dt = rnd() < 0.5 ? 0.025 : 0.05; t += dt; arrivals.push({ t, wall: wall + t * 1000 + (rnd() - 0.5) * 30 }); }
    let k = 0, tPrevPush = 0;
    const edges: number[] = [];
    let last: boolean | null = null;
    for (let f = 1000; f < 1000 + 5000; f += 1000 / 60) {
      while (k < arrivals.length && arrivals[k].wall <= f) {
        const a = arrivals[k++];
        const samples = []; for (let s = tPrevPush; s <= a.t + 1e-9; s += 0.0002) samples.push({ t: s, i: [wave(s)] });
        pb.push(samples, a.t, a.wall, 1, false); tPrevPush = a.t;
      }
      const b = pb.frame(f, ledBrightness);
      if (!b) continue;
      const on = b[0] > 0.35;
      if (last !== null && on !== last) edges.push(f);
      last = on;
    }
    // ขอบแต่ละขอบคลาดจากตารางเวลาจริง (ห่าง 171.5 ms เท่ากัน) ไม่เกินหนึ่งเฟรม — ช่วงห่างระหว่างขอบจึงเป็น 150–183 ms ตามจังหวะเฟรม
    const e = edges.slice(2);
    const dev = e.map((x, k) => x - k * 171.5);
    const mid = [...dev].sort((a, b) => a - b)[dev.length >> 1];
    expect(e.length).toBeGreaterThan(20);
    for (const d of dev) expect(Math.abs(d - mid)).toBeLessThanOrEqual(1000 / 60 + 0.5);
  });
  it('PWM 1 kHz duty 25% → ความสว่างเฉลี่ยในเฟรมคงที่ (ไม่กะพริบแบบสุ่มจากการสุ่มตัวอย่าง)', () => {
    const pb = new LedPlayback(['L'], [0.02], 1);
    const samples = []; for (let s = 0; s <= 2; s += 0.0001) samples.push({ t: s, i: [(s % 0.001) < 0.00025 ? 0.02 : 0] });
    pb.push(samples, 2, 2000, 1, false);
    const vals: number[] = [];
    for (let f = 1200; f < 1900; f += 1000 / 60) vals.push(pb.frame(f, ledBrightness)![0]);
    const exp = ledBrightness(0.005, 0.02);
    for (const v of vals.slice(1)) expect(Math.abs(v - exp)).toBeLessThan(0.08); // ช่วงเฟรมตัดคาบ PWM ไม่ลงตัว
  });
});

describe('ตัวเล่น LED เมื่อตัวคำนวณช้ากว่าเวลาจริง', () => {
  it('เวลาจำลองที่แสดงไม่ย้อนกลับ แม้ส่วนต่างเวลาถูกตั้งใหม่', () => {
    const pb = new LedPlayback(['L'], [0.02], 1);
    const shown: number[] = [];
    let t = 0;
    // ทุก 50 ms จริง ได้เวลาจำลองเพิ่มเพียง 20 ms (ช้ากว่าเวลาจริง 2.5 เท่า)
    for (let w = 0; w < 4000; w += 50) {
      const s = []; for (let x = t; x <= t + 0.02; x += 0.001) s.push({ t: x, i: [x] });
      t += 0.02; pb.push(s, t, w, 1, false);
      for (let f = w; f < w + 50; f += 1000 / 60) { const b = pb.frame(f, (i) => i); if (b) shown.push(b[0]); }
    }
    for (let k = 1; k < shown.length; k++) expect(shown[k]).toBeGreaterThanOrEqual(shown[k - 1] - 0.0011);
  });
});
