import { bodeAt, fmtHz, type BodeData, type BodeMeasure } from '../instruments/bode';

/**
 * วาดกราฟโบดบน canvas: บน = ขนาด (dB), ล่าง = เฟส (องศา), แกนนอนความถี่แบบลอการิทึม
 * เส้นประแนวตั้ง = ความถี่ที่ตั้งบนเครื่องกำเนิดสัญญาณ, จุด = ความถี่ −3 dB, เส้นทึบบาง = เคอร์เซอร์
 */

export const BODE_COLORS = { mag: '#1f6fb2', phase: '#b4561d', marker: '#2e7d57', cursor: '#1d2723' };

export interface BodeLayout { L: number; R: number; pw: number; f0: number; f1: number }

export function bodeLayout(canvas: HTMLCanvasElement, d: BodeData): BodeLayout {
  const W = canvas.clientWidth;
  const L = 44, R = 12;
  return { L, R, pw: Math.max(10, W - L - R), f0: d.freqs[0] ?? 1, f1: d.freqs[d.freqs.length - 1] ?? 10 };
}

/** ความถี่จากตำแหน่ง x (px ใน canvas) */
export function freqAtX(lay: BodeLayout, px: number): number {
  const t = Math.min(1, Math.max(0, (px - lay.L) / lay.pw));
  return 10 ** (Math.log10(lay.f0) + t * (Math.log10(lay.f1) - Math.log10(lay.f0)));
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function drawBode(canvas: HTMLCanvasElement, d: BodeData | null, opts: { fgenF?: number; cursor?: number | null; measure?: BodeMeasure | null; message?: string; ink: string; grid: string }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  // canvas แบบซอฟต์แวร์ (willReadFrequently): วาดบ่อยระหว่างจำลอง — canvas ที่ใช้ GPU ต้องรอ GPU ว่างตอนส่งเฟรม
  // (เมื่อฉาก 3 มิติใช้ GPU เต็ม main thread จะค้างหลายร้อย ms ถึงหลายวินาที — พบใน trace: CanvasRenderingContext2D::FinalizeFrame / GPU backpressure)
  const x = canvas.getContext('2d', { willReadFrequently: true })!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  x.font = '11px "IBM Plex Sans Thai", sans-serif';
  if (!d || !d.ok || !d.freqs.length) {
    x.fillStyle = opts.ink;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    wrap(x, d?.error ?? opts.message ?? 'กำลังคำนวณ…', W / 2, H / 2, W - 40);
    return;
  }
  const lay = bodeLayout(canvas, d);
  const { L, pw, f0, f1 } = lay;
  const gap = 18, T = 8, B = 18;
  const ph = (H - T - B - gap) / 2;
  const X = (f: number) => L + ((Math.log10(f) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0))) * pw;

  const panel = (top: number, vals: Array<number | null>, color: string, unit: string, fixedStep?: number) => {
    const fin = vals.filter((v): v is number => v !== null && v > -300);
    let lo = fin.length ? Math.min(...fin) : -1, hi = fin.length ? Math.max(...fin) : 1;
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const step = fixedStep && (hi - lo) / fixedStep <= (ph < 110 ? 4 : 8) ? fixedStep : niceStep(hi - lo, ph < 110 ? 3 : 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    const Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
    // กริดแนวนอน + ป้ายแกน
    x.strokeStyle = opts.grid; x.lineWidth = 1; x.fillStyle = opts.ink;
    x.textAlign = 'right'; x.textBaseline = 'middle';
    for (let v = lo; v <= hi + step * 1e-6; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      x.beginPath(); x.moveTo(L, y); x.lineTo(L + pw, y); x.stroke();
      x.fillText(`${+v.toPrecision(4)}`, L - 5, y);
    }
    x.textAlign = 'left'; x.textBaseline = 'top';
    x.fillStyle = color;
    x.fillText(unit, 4, top);
    // กริดแนวตั้งที่ 1-2-5 ของแต่ละทศวรรษ
    x.strokeStyle = opts.grid;
    for (let e = Math.floor(Math.log10(f0)); e <= Math.ceil(Math.log10(f1)); e++) {
      for (const m of [1, 2, 5]) {
        const f = m * 10 ** e;
        if (f < f0 * 0.999 || f > f1 * 1.001) continue;
        const px = Math.round(X(f)) + 0.5;
        x.globalAlpha = m === 1 ? 1 : 0.45;
        x.beginPath(); x.moveTo(px, top); x.lineTo(px, top + ph); x.stroke();
      }
    }
    x.globalAlpha = 1;
    // เส้นข้อมูล
    x.save();
    x.beginPath(); x.rect(L, top, pw, ph); x.clip();
    x.strokeStyle = color; x.lineWidth = 2;
    x.beginPath();
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || v < -300) { pen = false; return; }
      const px = X(d.freqs[i]), py = Y(v);
      if (pen) x.lineTo(px, py); else { x.moveTo(px, py); pen = true; }
    });
    x.stroke();
    x.restore();
    return Y;
  };
  const Ym = panel(T, d.mag, BODE_COLORS.mag, 'dB');
  const Yp = panel(T + ph + gap, d.phase, BODE_COLORS.phase, 'องศา', 45);

  // แกนความถี่ (ล่างสุด)
  x.fillStyle = opts.ink; x.textAlign = 'center'; x.textBaseline = 'top';
  for (let e = Math.floor(Math.log10(f0)); e <= Math.ceil(Math.log10(f1)); e++) {
    const f = 10 ** e;
    if (f < f0 * 0.999 || f > f1 * 1.001) continue;
    x.fillText(fmtHz(f).replace(' ', ''), X(f), H - B + 4);
  }

  // ความถี่ที่ตั้งบนเครื่องกำเนิด
  const vline = (f: number, color: string, dash: number[]) => {
    if (!(f >= f0 && f <= f1)) return;
    const px = Math.round(X(f)) + 0.5;
    x.save(); x.strokeStyle = color; x.setLineDash(dash); x.lineWidth = 1;
    x.beginPath(); x.moveTo(px, T); x.lineTo(px, H - B); x.stroke(); x.restore();
  };
  if (opts.fgenF) vline(opts.fgenF, '#8a6d00', [4, 3]);
  // จุด −3 dB
  const m = opts.measure;
  if (m) {
    for (const f of [m.fLow, m.fHigh]) {
      if (f === null) continue;
      const px = X(f), py = Ym(m.peakDb - 3.0103);
      x.fillStyle = BODE_COLORS.marker;
      x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill();
      x.textAlign = 'left'; x.textBaseline = 'top';
      x.fillText(`−3 dB ${fmtHz(f)}`, Math.min(px + 6, L + pw - 90), py + 6);
    }
  }
  // เคอร์เซอร์
  if (opts.cursor && opts.cursor >= f0 && opts.cursor <= f1) {
    vline(opts.cursor, BODE_COLORS.cursor, []);
    const v = bodeAt(d, opts.cursor);
    x.fillStyle = BODE_COLORS.cursor;
    if (v.mag !== null) { x.beginPath(); x.arc(X(opts.cursor), Ym(v.mag), 3.5, 0, Math.PI * 2); x.fill(); }
    if (v.phase !== null) { x.beginPath(); x.arc(X(opts.cursor), Yp(v.phase), 3.5, 0, Math.PI * 2); x.fill(); }
  }
}

function wrap(x: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  lines.forEach((l, i) => x.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * 15));
}
