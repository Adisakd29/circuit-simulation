import type { EncoderSpec, NetlistElement } from '../sim/netlist';

/**
 * Rotary encoder แบบกลไก (EC11 บนโมดูล KY-040, 20 คลิก/รอบ, 20 พัลส์/รอบ): ที่ตำแหน่งคลิก หน้าสัมผัส A และ B เปิดทั้งคู่ (สายสูงจากตัวดึงขึ้น)
 * หมุน 1 คลิกตามเข็ม: A ปิด → B ปิด → A เปิด → B เปิด (A นำ B 90°) · ทวนเข็ม: B ปิด → A ปิด → B เปิด → A เปิด
 * ผู้ใช้สั่งหมุนเป็นจำนวนคลิก → แต่ละคลิกใช้เวลา detentMs (ค่าเริ่ม 12 ms ≈ หมุนด้วยมือเร็วพอประมาณ) แบ่ง 4 ช่วงเท่ากัน
 * หน้าสัมผัสที่ปิดเป็นตัวต้านทานค่าต่ำระหว่างขา CLK/DT กับขา GND ของโมดูลในวงจรที่คำนวณ (co-simulation เพิ่มเข้าไปตามเวลา)
 * การเด้งของหน้าสัมผัส (bounceMs > 0): หลังหน้าสัมผัสเปลี่ยนสถานะ จะสลับกลับไปมา 2 ครั้งภายในเวลา bounceMs ก่อนนิ่ง (รูปแบบคงที่ ไม่สุ่ม —
 *   ดาต้าชีต Alps EC11B: bounce ≤ 2 ms, chattering ≤ 3 ms ที่ 360°/s) · ค่าเริ่ม 0 = หน้าสัมผัสในอุดมคติ
 */
interface Ev { t: number; a: boolean; b: boolean; d: number }
interface Enc { spec: EncoderSpec; a: boolean; b: boolean; count: number; q: Ev[]; tEnd: number; turnsCw: number; turnsCcw: number }

export interface EncoderState {
  /** จำนวนคลิกที่หมุนไปแล้วสุทธิ (ตามเข็ม +) */
  count: number;
  /** คลิกที่รอหมุน */
  pending: number;
  a: boolean;
  b: boolean;
  turnsCw: number;
  turnsCcw: number;
}

export class EncoderHub {
  private encs = new Map<string, Enc>();

  sync(specs: EncoderSpec[]) {
    for (const id of [...this.encs.keys()]) if (!specs.some((s) => s.id === id)) this.encs.delete(id);
    for (const s of specs) {
      const e = this.encs.get(s.id);
      if (e) e.spec = s;
      else this.encs.set(s.id, { spec: s, a: false, b: false, count: 0, q: [], tEnd: 0, turnsCw: 0, turnsCcw: 0 });
    }
  }
  reset() { this.encs.clear(); }
  get size() { return this.encs.size; }

  /** สั่งหมุน n คลิก (บวก = ตามเข็ม) เริ่มที่เวลา now (s) ต่อจากคลิกที่ยังค้างอยู่ */
  turn(id: string, n: number, now: number) {
    const e = this.encs.get(id);
    if (!e || !n) return;
    const T = e.spec.detentMs / 1000;
    let t = Math.max(now, e.tEnd) + 1e-4;
    const cw = n > 0;
    // เวลาเด้งไม่เกิน 80 % ของช่วงระหว่างการเปลี่ยนแต่ละครั้ง (หมุนเร็วมากจนหน้าสัมผัสยังไม่นิ่ง = จำกัดไว้)
    const B = Math.min((e.spec.bounceMs ?? 0) / 1000, 0.8 * T / 4);
    let prev: [boolean, boolean] = e.q.length ? [e.q[e.q.length - 1].a, e.q[e.q.length - 1].b] : [e.a, e.b];
    for (let k = 0; k < Math.abs(n); k++) {
      const seq: Array<[boolean, boolean]> = cw ? [[true, false], [true, true], [false, true], [false, false]] : [[false, true], [true, true], [true, false], [false, false]];
      seq.forEach(([a, b], i) => {
        const t0 = t + (i * T) / 4, d = i === 3 ? (cw ? 1 : -1) : 0;
        if (B > 0) {
          // สลับกลับไปสถานะเดิมสองครั้งระหว่างเด้ง (ที่ 25 % และ 60 % ของช่วงเด้ง) แล้วนิ่งที่ปลายช่วง
          e.q.push({ t: t0, a, b, d: 0 }, { t: t0 + 0.25 * B, a: prev[0], b: prev[1], d: 0 }, { t: t0 + 0.45 * B, a, b, d: 0 }, { t: t0 + 0.6 * B, a: prev[0], b: prev[1], d: 0 }, { t: t0 + B, a, b, d });
        } else e.q.push({ t: t0, a, b, d });
        prev = [a, b];
      });
      t += T;
    }
    e.tEnd = t;
  }

  /** เดินเหตุการณ์ถึงเวลา now — คืน true ถ้าสถานะหน้าสัมผัสเปลี่ยน */
  advance(now: number): boolean {
    let ch = false;
    for (const e of this.encs.values()) {
      while (e.q.length && e.q[0].t <= now + 1e-12) {
        const ev = e.q.shift()!;
        if (ev.a !== e.a || ev.b !== e.b) ch = true;
        e.a = ev.a; e.b = ev.b;
        if (ev.d) { e.count += ev.d; if (ev.d > 0) e.turnsCw++; else e.turnsCcw++; }
      }
    }
    return ch;
  }

  nextEvent(): number {
    let n = Infinity;
    for (const e of this.encs.values()) if (e.q.length) n = Math.min(n, e.q[0].t);
    return n;
  }

  /** ตัวต้านทานของหน้าสัมผัสที่ปิดอยู่ (เพิ่มเข้าวงจร) */
  elements(): NetlistElement[] {
    const out: NetlistElement[] = [];
    for (const [id, e] of this.encs) {
      if (e.a) out.push({ type: 'R', id: `${id}#a`, role: 'button', a: e.spec.clk, b: e.spec.gnd, R: e.spec.R });
      if (e.b) out.push({ type: 'R', id: `${id}#b`, role: 'button', a: e.spec.dt, b: e.spec.gnd, R: e.spec.R });
    }
    return out;
  }

  /** คีย์สถานะหน้าสัมผัส (รวมในคีย์แคชของวงจร) */
  key(): string { let k = ''; for (const e of this.encs.values()) k += (e.a ? 'A' : 'a') + (e.b ? 'B' : 'b'); return k; }

  snapshot(): Record<string, EncoderState> {
    const out: Record<string, EncoderState> = {};
    for (const [id, e] of this.encs) out[id] = { count: e.count, pending: Math.round(e.q.filter((x) => x.d).length), a: e.a, b: e.b, turnsCw: e.turnsCw, turnsCcw: e.turnsCcw };
    return out;
  }
}
