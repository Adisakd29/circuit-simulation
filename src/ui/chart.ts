import type { DataLogger } from '../instruments/logger';

/** วาดกราฟบันทึกค่าบน canvas: แกนซ้าย = แรงดัน (V), แกนขวา = กระแส (mA), แกนนอน = เวลาจำลอง */

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function niceRange(min: number, max: number): [number, number] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (max - min < 1e-9) { max += 1; }
  const step = niceStep(max - min, 4);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export function fmtTime(t: number): string {
  const a = Math.abs(t);
  if (a === 0) return '0';
  if (a < 1e-3) return `${+(t * 1e6).toPrecision(3)} µs`;
  if (a < 1) return `${+(t * 1e3).toPrecision(3)} ms`;
  return `${+t.toPrecision(3)} s`;
}

function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toFixed(0);
  return String(+v.toPrecision(3));
}

export function drawChart(canvas: HTMLCanvasElement, log: DataLogger, windowSec: number, colors: { ink: string; grid: string; bg: string }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  // canvas แบบซอฟต์แวร์ (willReadFrequently): วาดบ่อยระหว่างจำลอง — canvas ที่ใช้ GPU ต้องรอ GPU ว่างตอนส่งเฟรม
  // (เมื่อฉาก 3 มิติใช้ GPU เต็ม main thread จะค้างหลายร้อย ms ถึงหลายวินาที — พบใน trace: CanvasRenderingContext2D::FinalizeFrame / GPU backpressure)
  const x = canvas.getContext('2d', { willReadFrequently: true })!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = colors.bg;
  x.fillRect(0, 0, W, H);
  const hasV = log.channels.some((c) => c.unit === 'V');
  const hasI = log.channels.some((c) => c.unit === 'mA');
  const L = hasV ? 40 : 10, R = hasI ? 46 : 10, T = 8, B = 20;
  const pw = W - L - R, ph = H - T - B;
  const tEnd = log.t.length ? log.t[log.t.length - 1] : 0;
  const t1 = Math.max(tEnd, windowSec);
  const t0 = t1 - windowSec;
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * pw;

  const range = (unit: 'V' | 'mA') => {
    let mn = Infinity, mx = -Infinity;
    log.channels.forEach((c, ci) => {
      if (c.unit !== unit) return;
      log.data[ci].forEach((v, i) => { if (v !== null && log.t[i] >= t0) { mn = Math.min(mn, v); mx = Math.max(mx, v); } });
    });
    return niceRange(mn, mx);
  };
  const [v0, v1] = range('V');
  const [i0, i1] = range('mA');
  const YV = (v: number) => T + ph - ((v - v0) / (v1 - v0)) * ph;
  const YI = (v: number) => T + ph - ((v - i0) / (i1 - i0)) * ph;

  // กริดและแกน
  x.strokeStyle = colors.grid;
  x.lineWidth = 1;
  x.fillStyle = colors.ink;
  x.font = '11px "IBM Plex Sans Thai", sans-serif';
  x.textBaseline = 'middle';
  const yRef = hasV ? [v0, v1, YV] as const : [i0, i1, YI] as const;
  const ys = niceStep(yRef[1] - yRef[0], 4);
  for (let v = yRef[0]; v <= yRef[1] + ys * 0.01; v += ys) {
    const y = yRef[2](v);
    x.beginPath(); x.moveTo(L, Math.round(y) + 0.5); x.lineTo(L + pw, Math.round(y) + 0.5); x.stroke();
    if (hasV) { x.textAlign = 'right'; x.fillText(fmtNum(v), L - 5, y); }
  }
  if (hasI) {
    const is = niceStep(i1 - i0, 4);
    x.textAlign = 'left';
    for (let v = i0; v <= i1 + is * 0.01; v += is) x.fillText(fmtNum(v), L + pw + 5, YI(v));
  }
  const ts = niceStep(t1 - t0, 5);
  x.textAlign = 'center';
  x.textBaseline = 'top';
  for (let t = Math.ceil(t0 / ts) * ts; t <= t1 + ts * 0.001; t += ts) {
    const px = X(t);
    x.beginPath(); x.moveTo(Math.round(px) + 0.5, T); x.lineTo(Math.round(px) + 0.5, T + ph); x.stroke();
    x.fillText(fmtTime(t), px, T + ph + 4);
  }
  x.textBaseline = 'alphabetic';
  if (hasV) { x.textAlign = 'left'; x.fillText('V', 4, T + 9); }
  if (hasI) { x.textAlign = 'right'; x.fillText('mA', W - 4, T + 9); }

  // เส้นข้อมูล
  x.save();
  x.beginPath(); x.rect(L, T, pw, ph); x.clip();
  log.channels.forEach((c, ci) => {
    const Y = c.unit === 'V' ? YV : YI;
    x.strokeStyle = c.color;
    x.lineWidth = 2;
    x.beginPath();
    let pen = false;
    log.data[ci].forEach((v, i) => {
      if (log.t[i] < t0) return;
      if (v === null) { pen = false; return; }
      const px = X(log.t[i]), py = Y(v);
      if (pen) x.lineTo(px, py); else { x.moveTo(px, py); pen = true; }
    });
    x.stroke();
  });
  x.restore();
}
