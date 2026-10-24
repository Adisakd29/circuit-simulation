/**
 * เสียงบัซเซอร์ในแอป (Web Audio): หนึ่งเสียงต่อบัซเซอร์ที่กำลังดัง ความถี่ตามผลจำลอง ความดังตามกระแส
 * - สร้าง AudioContext เมื่อผู้ใช้แตะ/คลิกครั้งแรก (นโยบายเบราว์เซอร์ห้ามเล่นเสียงก่อนมีการโต้ตอบ)
 * - เปิด/ปิดได้ (จำค่าไว้ในเบราว์เซอร์ของผู้ใช้แต่ละคน) — ค่าเริ่มต้น: เปิด
 * - คลื่นสี่เหลี่ยมผ่านตัวกรองความถี่ต่ำ ให้คล้ายเสียงบัซเซอร์แม่เหล็ก และจำกัดความดังรวมไม่ให้แสบหู
 */
export interface Tone { id: string; freq: number; level: number }

type Voice = { osc: OscillatorNode; gain: GainNode; freq: number };

const KEY = 'cl:sound';

export class BuzzerAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  enabled = true;
  /** เสียงที่กำลังเล่น (สำหรับแสดงผล/ทดสอบ) */
  playing: Tone[] = [];
  /** เสียงล่าสุดที่แบบจำลองต้องการ (ก่อนกรองด้วยการเปิด/ปิด) — ใช้เล่นต่อทันทีเมื่อเปิดเสียงอีกครั้ง */
  private wanted: Tone[] = [];

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== '0'; } catch { /* ไม่มี storage */ }
  }

  /** เรียกจากการโต้ตอบของผู้ใช้ */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 6000;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(lp); lp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ไม่มี storage */ }
    this.unlock();
    this.update(this.wanted);
  }

  update(tones: Tone[]) {
    this.wanted = tones;
    const list = this.enabled && !this.hidden ? tones.filter((t) => t.freq >= 20 && t.freq <= 20000 && t.level > 0) : [];
    this.playing = list;
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const seen = new Set<string>();
    for (const t of list) {
      seen.add(t.id);
      let v = this.voices.get(t.id);
      if (!v) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain); gain.connect(master);
        osc.frequency.value = t.freq;
        osc.start();
        v = { osc, gain, freq: t.freq };
        this.voices.set(t.id, v);
      }
      if (Math.abs(v.freq - t.freq) > 0.5) { v.osc.frequency.setTargetAtTime(t.freq, now, 0.01); v.freq = t.freq; }
      v.gain.gain.setTargetAtTime(0.06 * Math.min(1, t.level) / Math.max(1, list.length), now, 0.01);
    }
    for (const [id, v] of this.voices) {
      if (seen.has(id)) continue;
      v.gain.gain.setTargetAtTime(0, now, 0.01);
      const osc = v.osc;
      setTimeout(() => { try { osc.stop(); osc.disconnect(); } catch { /* หยุดแล้ว */ } }, 120);
      this.voices.delete(id);
    }
  }

  stopAll() { this.update([]); }

  /** เสียงคลิกสั้น ๆ ของหน้าสัมผัสรีเลย์ */
  click() {
    if (!this.enabled || this.hidden) return;
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18)) * 0.6;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  }

  /** หน้าถูกซ่อน: เงียบชั่วคราวโดยจำเสียงที่ต้องการไว้ แล้วเล่นต่อเมื่อกลับมา */
  private hidden = false;
  setHidden(h: boolean) {
    this.hidden = h;
    this.update(this.wanted);
  }
}
