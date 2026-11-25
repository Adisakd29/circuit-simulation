import { DIV_X, DIV_Y, type ScopeFrame, type ScopeSettings } from '../instruments/scope';

export const SCOPE_COLORS = { ch1: '#e8c21f', ch2: '#31b5d6' };

/** วาดหน้าจอออสซิลโลสโคป: กริด 10×8 ช่อง, ศูนย์กลางแนวตั้ง = 0 V, เส้น CH1/CH2, เครื่องหมาย trigger */
export function drawScope(canvas: HTMLCanvasElement, f: ScopeFrame | null, s: ScopeSettings, opts: { css?: boolean; message?: string } = {}) {
  const dpr = opts.css ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const W = opts.css ? canvas.clientWidth : canvas.width;
  const H = opts.css ? canvas.clientHeight : canvas.height;
  if (!W || !H) return;
  if (opts.css) {
    if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  }
  // canvas แบบซอฟต์แวร์ (willReadFrequently): วาดบ่อยระหว่างจำลอง — canvas ที่ใช้ GPU ต้องรอ GPU ว่างตอนส่งเฟรม
  // (เมื่อฉาก 3 มิติใช้ GPU เต็ม main thread จะค้างหลายร้อย ms ถึงหลายวินาที — พบใน trace: CanvasRenderingContext2D::FinalizeFrame / GPU backpressure)
  const x = canvas.getContext('2d', { willReadFrequently: true })!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#0c1714';
  x.fillRect(0, 0, W, H);
  const dx = W / DIV_X, dy = H / DIV_Y;
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(160,200,185,0.20)';
  for (let i = 1; i < DIV_X; i++) { x.beginPath(); x.moveTo(Math.round(i * dx) + 0.5, 0); x.lineTo(Math.round(i * dx) + 0.5, H); x.stroke(); }
  for (let i = 1; i < DIV_Y; i++) { x.beginPath(); x.moveTo(0, Math.round(i * dy) + 0.5); x.lineTo(W, Math.round(i * dy) + 0.5); x.stroke(); }
  x.strokeStyle = 'rgba(160,200,185,0.45)';
  x.beginPath(); x.moveTo(0, Math.round(H / 2) + 0.5); x.lineTo(W, Math.round(H / 2) + 0.5); x.stroke();
  x.beginPath(); x.moveTo(Math.round(W / 2) + 0.5, 0); x.lineTo(Math.round(W / 2) + 0.5, H); x.stroke();
  if (!f || !f.t.length) {
    if (opts.message) { x.fillStyle = 'rgba(200,230,215,0.75)'; x.font = '600 14px "IBM Plex Sans Thai", sans-serif'; x.textAlign = 'center'; x.fillText(opts.message, W / 2, H / 2 - 10); }
    return;
  }
  const X = (t: number) => ((t - f.t0) / (f.t1 - f.t0)) * W;
  const chans: Array<[0 | 1, boolean, number, string]> = [[0, s.ch1On, s.vdiv1, SCOPE_COLORS.ch1], [1, s.ch2On, s.vdiv2, SCOPE_COLORS.ch2]];
  for (const [ci, on, vdiv, color] of chans) {
    if (!on) continue;
    const Y = (v: number) => H / 2 - (v / vdiv) * dy;
    x.strokeStyle = color;
    x.lineWidth = opts.css ? 1.8 : 2.5;
    x.beginPath();
    let pen = false;
    f.ch[ci].forEach((v, i) => {
      if (v === null) { pen = false; return; }
      const px = X(f.t[i]), py = Math.max(-2, Math.min(H + 2, Y(v)));
      if (pen) x.lineTo(px, py); else { x.moveTo(px, py); pen = true; }
    });
    x.stroke();
    // เครื่องหมายระดับ 0 V ของช่อง
    x.fillStyle = color;
    x.beginPath(); x.moveTo(0, H / 2 - 5 + ci * 0); x.lineTo(7, H / 2); x.lineTo(0, H / 2 + 5); x.fill();
  }
  // trigger: เส้นแนวตั้งที่จุด trigger และระดับ
  if (f.triggered && f.trigTime !== null) {
    const tx = X(f.trigTime);
    x.strokeStyle = 'rgba(255,140,90,0.8)';
    x.setLineDash([3, 3]);
    x.beginPath(); x.moveTo(tx, 0); x.lineTo(tx, H); x.stroke();
    x.setLineDash([]);
  }
  const tv = s.trigSource === 'ch1' ? s.vdiv1 : s.vdiv2;
  const ty = H / 2 - (s.trigLevel / tv) * dy;
  if (ty > 0 && ty < H) {
    x.fillStyle = 'rgba(255,140,90,0.95)';
    x.beginPath(); x.moveTo(W, ty - 5); x.lineTo(W - 8, ty); x.lineTo(W, ty + 5); x.fill();
  }
}
