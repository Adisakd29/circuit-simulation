/**
 * ออสซิลโลสโคป 2 ช่อง — เก็บตัวอย่างแรงดันตามเวลาจำลอง หาจุด trigger และคำนวณค่าที่วัดได้
 * แรงดันแต่ละช่อง = V(CHx) − V(GND) ของเครื่อง (ขาเข้า 1 MΩ อยู่ใน netlist จริง จึงโหลดวงจรเหมือนเครื่องจริง)
 * หน้าจอ 10 ช่องแนวนอน × 8 ช่องแนวตั้ง, จุด trigger อยู่ที่ช่องที่ 1 จากซ้าย
 */

export const DIV_X = 10;
export const DIV_Y = 8;
export const TRIGGER_DIV = 1;

/** ค่าตั้ง time/div และ V/div แบบ 1-2-5 */
export const TIME_DIVS = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1];
export const VOLT_DIVS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];

export interface ScopeSettings {
  timeDiv: number;
  vdiv1: number;
  vdiv2: number;
  ch1On: boolean;
  ch2On: boolean;
  trigSource: 'ch1' | 'ch2';
  trigLevel: number;
  trigSlope: 'rise' | 'fall';
  /** AC coupling: แสดงผลและ trigger เทียบค่าเฉลี่ย (ตัด DC) — ค่าที่วัดได้ (Vpp, ความถี่) ไม่เปลี่ยน */
  ac1?: boolean;
  ac2?: boolean;
}

export interface ChannelMeasure {
  vmax: number;
  vmin: number;
  vpp: number;
  vavg: number;
  vrms: number;
  /** ความถี่จากจุดตัดค่าเฉลี่ย (Hz) — null ถ้าไม่พบอย่างน้อย 2 คาบ */
  freq: number | null;
  /** ความชันขาขึ้นช่วง 10–90% ของ Vpp (V/s, ค่ามัธยฐานของขอบที่พบ) — null ถ้าไม่พบขอบขาขึ้นเต็มช่วง */
  slew: number | null;
  /** เวลาขาขึ้น 10–90% (s) */
  rise: number | null;
}

export interface ScopeFrame {
  t0: number;
  t1: number;
  triggered: boolean;
  trigTime: number | null;
  /** ข้อมูลภายในหน้าต่าง (รวมจุดข้างนอกขอบละหนึ่งจุดเพื่อวาดเส้นต่อเนื่อง) */
  t: number[];
  ch: [Array<number | null>, Array<number | null>];
  measure: [ChannelMeasure | null, ChannelMeasure | null];
}

export class ScopeBuffer {
  t: number[] = [];
  ch: [Array<number | null>, Array<number | null>] = [[], []];
  maxPoints = 40000;

  reset() { this.t = []; this.ch = [[], []]; }

  push(t: number, v1: number | null, v2: number | null) {
    const n = this.t.length;
    if (n && t <= this.t[n - 1]) return;
    this.t.push(t); this.ch[0].push(v1); this.ch[1].push(v2);
  }

  /** ตัดข้อมูลเก่ากว่า keep วินาทีจากจุดล่าสุด */
  trim(keep: number) {
    const n = this.t.length;
    if (!n) return;
    const cut = this.t[n - 1] - keep;
    let i = 0;
    while (i < n - 2 && this.t[i] < cut) i++;
    const drop = Math.max(i, n - this.maxPoints);
    if (drop > 0) { this.t.splice(0, drop); this.ch[0].splice(0, drop); this.ch[1].splice(0, drop); }
  }

  get last(): number { return this.t.length ? this.t[this.t.length - 1] : 0; }

  /** ระดับ DC ที่ตัดออกต่อช่อง (AC coupling) = ค่าเฉลี่ยช่วง 3 หน้าจอล่าสุด เหมือนตัวเก็บประจุกั้น DC ที่ชาร์จจนนิ่ง */
  offsets(s: ScopeSettings): [number, number] {
    const from = this.last - s.timeDiv * DIV_X * 3;
    const off = (c: 0 | 1, on?: boolean) => (on ? measure(this.t, this.ch[c], from)?.vavg ?? 0 : 0);
    return [off(0, s.ac1), off(1, s.ac2)];
  }

  /** หาจุด trigger ล่าสุดที่ยังมีข้อมูลครบหนึ่งหน้าจอหลังจุดนั้น */
  findTrigger(s: ScopeSettings, offs: [number, number] = [0, 0]): number | null {
    const ci = s.trigSource === 'ch1' ? 0 : 1;
    const raw = this.ch[ci], o = offs[ci];
    const d = o ? raw.map((v) => (v === null ? null : v - o)) : raw;
    const span = s.timeDiv * DIV_X;
    const after = span - s.timeDiv * TRIGGER_DIV;
    const tEnd = this.last;
    for (let i = this.t.length - 1; i > 0; i--) {
      const a = d[i - 1], b = d[i];
      if (a === null || b === null) continue;
      const crosses = s.trigSlope === 'rise' ? a < s.trigLevel && b >= s.trigLevel : a > s.trigLevel && b <= s.trigLevel;
      if (!crosses) continue;
      const tc = this.t[i - 1] + ((s.trigLevel - a) / (b - a)) * (this.t[i] - this.t[i - 1]);
      if (tc + after <= tEnd + 1e-15) {
        if (tc - s.timeDiv * TRIGGER_DIV < this.t[0] - 1e-15) return null; // ไม่มีข้อมูลก่อนจุด trigger พอ
        return tc;
      }
    }
    return null;
  }

  frame(s: ScopeSettings): ScopeFrame {
    const span = s.timeDiv * DIV_X;
    const offs = this.offsets(s);
    const trig = this.findTrigger(s, offs);
    let t0: number, t1: number;
    if (trig !== null) { t0 = trig - s.timeDiv * TRIGGER_DIV; t1 = t0 + span; }
    else { t1 = Math.max(this.last, span); t0 = t1 - span; }
    let i0 = 0, i1 = this.t.length;
    while (i0 < this.t.length && this.t[i0] < t0) i0++;
    while (i1 > 0 && this.t[i1 - 1] > t1) i1--;
    const a = Math.max(0, i0 - 1), b = Math.min(this.t.length, i1 + 1);
    const t = this.t.slice(a, b);
    const sub = (c: 0 | 1) => { const x = this.ch[c].slice(a, b); return offs[c] ? x.map((v) => (v === null ? null : v - offs[c])) : x; };
    const ch: ScopeFrame['ch'] = [sub(0), sub(1)];
    return {
      t0, t1, triggered: trig !== null, trigTime: trig, t, ch,
      measure: [measure(this.t, this.ch[0], this.last - Math.max(span, 0) * 3), measure(this.t, this.ch[1], this.last - Math.max(span, 0) * 3)],
    };
  }
}

/** วัดค่าจากข้อมูลตั้งแต่ tFrom ถึงจุดล่าสุด (ถ่วงน้ำหนักตามช่วงเวลา) */
export function measure(t: number[], v: Array<number | null>, tFrom: number): ChannelMeasure | null {
  let i0 = 0;
  while (i0 < t.length && t[i0] < tFrom) i0++;
  let vmax = -Infinity, vmin = Infinity, area = 0, area2 = 0, dur = 0;
  for (let i = Math.max(i0, 1); i < t.length; i++) {
    const a = v[i - 1], b = v[i];
    if (a === null || b === null) continue;
    const dt = t[i] - t[i - 1];
    area += ((a + b) / 2) * dt;
    area2 += ((a * a + a * b + b * b) / 3) * dt;
    dur += dt;
    vmax = Math.max(vmax, a, b);
    vmin = Math.min(vmin, a, b);
  }
  if (!(dur > 0)) return null;
  const vavg = area / dur;
  // ความถี่: ช่วงห่างของจุดตัดค่ากลาง (ขาขึ้น) พร้อม hysteresis 10% ของ Vpp
  const mid = (vmax + vmin) / 2, hyst = (vmax - vmin) * 0.1;
  const rises: number[] = [];
  let armed = false;
  for (let i = Math.max(i0, 1); i < t.length; i++) {
    const a = v[i - 1], b = v[i];
    if (a === null || b === null) continue;
    if (b < mid - hyst) armed = true;
    if (armed && a < mid && b >= mid) {
      rises.push(t[i - 1] + ((mid - a) / (b - a)) * (t[i] - t[i - 1]));
      armed = false;
    }
  }
  const freq = rises.length >= 3 && vmax - vmin > 1e-6 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : null;
  // ขอบขาขึ้น: ข้ามระดับ 10% แล้วข้ามระดับ 90% โดยไม่ตกกลับต่ำกว่า 10% (แทรกเชิงเส้นระหว่างจุดตัวอย่าง)
  const lo = vmin + 0.1 * (vmax - vmin), hi = vmin + 0.9 * (vmax - vmin);
  const rs: number[] = [];
  let t10: number | null = null;
  // สัญญาณที่แทบคงที่ (ระลอกเล็กกว่า 0.1% ของระดับ) ไม่นับเป็นขอบ
  const edgeOk = vmax - vmin > Math.max(1e-6, 1e-3 * Math.max(Math.abs(vmax), Math.abs(vmin)));
  for (let i = Math.max(i0, 1); i < t.length && edgeOk; i++) {
    const a = v[i - 1], b = v[i];
    if (a === null || b === null) { t10 = null; continue; }
    const at = (lv: number) => t[i - 1] + ((lv - a) / (b - a)) * (t[i] - t[i - 1]);
    if (a < lo && b >= lo) t10 = at(lo);
    else if (b < lo) t10 = null;
    if (t10 !== null && a < hi && b >= hi) { rs.push(at(hi) - t10); t10 = null; }
  }
  rs.sort((p, q) => p - q);
  const rise = rs.length ? rs[rs.length >> 1] : null;
  const slew = rise !== null && rise > 0 ? (0.8 * (vmax - vmin)) / rise : null;
  return { vmax, vmin, vpp: vmax - vmin, vavg, vrms: Math.sqrt(Math.max(0, area2 / dur)), freq, slew, rise };
}

/** เลือก time/div และ V/div ให้เห็นรูปคลื่นราว 3 คาบ และสูงราว 6 ช่อง (ปุ่ม Auto) */
export function autoSet(m1: ChannelMeasure | null, m2: ChannelMeasure | null, cur: ScopeSettings): Partial<ScopeSettings> {
  const out: Partial<ScopeSettings> = {};
  const f = m1?.freq ?? m2?.freq ?? null;
  if (f) out.timeDiv = TIME_DIVS.find((d) => d * DIV_X >= 3 / f) ?? TIME_DIVS[TIME_DIVS.length - 1];
  const pick = (m: ChannelMeasure | null, ac?: boolean) => {
    if (!m || m.vpp < 1e-3 && Math.max(Math.abs(m.vmax), Math.abs(m.vmin)) < 1e-3) return undefined; // ไม่มีสัญญาณ: คงค่าเดิม
    // ครึ่งจอ = 4 ช่อง เผื่อขอบ · AC coupling: ใช้ระยะห่างจากค่าเฉลี่ย
    const need = (ac ? Math.max(m.vmax - m.vavg, m.vavg - m.vmin) : Math.max(Math.abs(m.vmax), Math.abs(m.vmin))) / 3;
    return VOLT_DIVS.find((d) => d >= need) ?? VOLT_DIVS[VOLT_DIVS.length - 1];
  };
  const v1 = pick(m1, cur.ac1), v2 = pick(m2, cur.ac2);
  if (v1) out.vdiv1 = v1;
  if (v2) out.vdiv2 = v2;
  // ระดับ trigger = กลางสัญญาณ ปัดเป็นทศนิยม 2 ตำแหน่ง (อ่านง่าย)
  const mid = (m: ChannelMeasure, ac?: boolean) => Math.round(((m.vmax + m.vmin) / 2 - (ac ? m.vavg : 0)) * 100) / 100 || 0;
  if (m1 && cur.trigSource === 'ch1') out.trigLevel = mid(m1, cur.ac1);
  if (m2 && cur.trigSource === 'ch2') out.trigLevel = mid(m2, cur.ac2);
  return out;
}
