/**
 * แท็บ "กำลังไฟฟ้า" ในแผงจำลอง: แหล่งจ่าย (แรงดัน กระแส กำลัง สัดส่วนของพิกัดกระแส) อุปกรณ์ที่ใช้กำลัง พลังงานสะสม และกราฟกำลังจ่ายรวมตามเวลา
 * ตัวเลขทุกตัวมาจาก PowerLog ของแอป (ค่าเฉลี่ยตามเวลาของผลคำนวณวงจร — ดู src/instruments/power.ts)
 */
import type { App } from './app';
import { formatSI } from '../model/units';
import { fmtTime } from './chart';
import { h } from './dom';
import type { PowerRow } from '../instruments/power';

export function pwBody(): HTMLElement {
  return h('div', { class: 'lg-body pw-body' },
    h('div', { class: 'pw-sum', id: 'pw-sum' }),
    h('div', { class: 'sc-screen pw-screen' }, h('canvas', { class: 'pw-canvas', id: 'pw-canvas', role: 'img', 'aria-label': 'กราฟกำลังที่แหล่งจ่ายรวมตามเวลา' })),
    h('h4', { class: 'pw-h' }, 'แหล่งจ่าย'),
    h('table', { class: 'pw-table', id: 'pw-src' }),
    h('h4', { class: 'pw-h' }, 'อุปกรณ์ที่ใช้กำลัง (ค่าเฉลี่ยตามเวลา)'),
    h('table', { class: 'pw-table', id: 'pw-load' }),
    h('p', { class: 'pw-note' }, 'คำนวณจากแรงดัน × กระแสของทุกอุปกรณ์ในการจำลอง เฉลี่ยตามเวลาในแต่ละช่วงคำนวณ (PWM จึงได้ค่าเฉลี่ยจริง) · ไม่รวมไฟเลี้ยงของบอร์ด/ชิปไมโครคอนโทรลเลอร์เอง และความสูญเสียภายในแหล่งจ่าย · ผลต่างระหว่างกำลังจ่ายกับกำลังใช้ = พลังงานที่ตัวเก็บประจุ/ขดลวดกำลังสะสมหรือคายออก'));
}

const W = (x: number) => formatSI(x, 'W', 3);
const J = (x: number) => `${formatSI(x, 'J', 3)}${x >= 3.6e-3 ? ` (${formatSI(x / 3600, 'Wh', 3)})` : ''}`;

function bar(frac: number, warn: boolean): HTMLElement {
  const f = Math.max(0, Math.min(1, frac));
  return h('span', { class: `pw-bar${warn ? ' warn' : ''}` }, h('span', { style: `width:${(f * 100).toFixed(1)}%` }));
}

let pwCount = 0;

export function updatePwLive(app: App) {
  const sum = document.getElementById('pw-sum');
  if (!sum) return;
  const log = app.powerLog, rep = log.last;
  pwCount++;
  if (!rep) { sum.textContent = 'ยังไม่มีผลคำนวณ'; return; }
  const diff = rep.pIn - rep.pOut;
  sum.replaceChildren(
    h('span', { id: 'pw-in' }, h('small', {}, 'จ่ายรวม '), h('b', {}, W(rep.pIn))),
    h('span', { id: 'pw-out' }, h('small', {}, 'อุปกรณ์ใช้รวม '), h('b', {}, W(rep.pOut))),
    h('span', { id: 'pw-diff' }, h('small', {}, 'ผลต่าง '), W(diff)),
    h('span', { id: 'pw-energy' }, h('small', {}, `พลังงานตั้งแต่เริ่ม (${fmtTime(log.T)}) `), h('b', {}, J(log.eIn))),
    h('span', { id: 'pw-avg' }, h('small', {}, 'เฉลี่ย / สูงสุด '), `${W(log.avgIn)} / ${W(log.peak)}`),
  );
  const tot = rep.pOut > 0 ? rep.pOut : 1;
  const src = document.getElementById('pw-src');
  if (src) src.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'แหล่ง'), h('th', {}, 'แรงดัน'), h('th', {}, 'กระแส'), h('th', {}, 'กำลัง'), h('th', {}, 'ใช้กระแส / พิกัด'))),
    h('tbody', {}, ...(rep.sources.length ? rep.sources.map((r: PowerRow) => h('tr', { 'data-key': r.key, class: r.over ? 'warn' : '' },
      h('td', {}, r.label), h('td', {}, formatSI(r.v ?? 0, 'V', 3)), h('td', {}, formatSI(Math.abs(r.i ?? 0), 'A', 3)), h('td', {}, W(r.p)),
      h('td', {}, r.ilim ? h('span', { class: 'pw-cell' }, bar(Math.abs(r.i ?? 0) / r.ilim, !!r.over), `${Math.round((Math.abs(r.i ?? 0) / r.ilim) * 100)}% ของ ${formatSI(r.ilim, 'A', 2)}${r.over ? ' — ถึงขีดจำกัด' : ''}`) : '—')))
      : [h('tr', {}, h('td', { colspan: '5' }, 'ไม่มีแหล่งจ่ายที่กำลังจ่ายกำลัง'))])),
  );
  const load = document.getElementById('pw-load');
  if (load) load.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'อุปกรณ์'), h('th', {}, 'กำลัง'), h('th', {}, 'สัดส่วน'), h('th', {}, 'พลังงานสะสม'))),
    h('tbody', {}, ...(rep.loads.length ? rep.loads.map((r: PowerRow) => h('tr', { 'data-key': r.key, class: r.over ? 'warn' : '' },
      h('td', {}, r.label + (r.over ? ' ⚠ เกินพิกัด' : '')), h('td', {}, W(r.p)), h('td', {}, h('span', { class: 'pw-cell' }, bar(r.p / tot, !!r.over), `${((r.p / tot) * 100).toFixed(1)}%`)), h('td', {}, J(log.rows.get(r.key) ?? 0))))
      : [h('tr', {}, h('td', { colspan: '4' }, 'ยังไม่มีอุปกรณ์ที่ใช้กำลัง'))])),
  );
  const cv = document.getElementById('pw-canvas') as HTMLCanvasElement | null;
  if (cv && (pwCount % 2 === 0 || log.hist.length < 3)) drawPower(cv, log.hist);
}

function drawPower(cv: HTMLCanvasElement, hist: Array<[number, number]>) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 300, hh = cv.clientHeight || 90;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#10201a'; g.fillRect(0, 0, w, hh);
  if (hist.length < 2) { g.fillStyle = '#9fb5a8'; g.font = '12px sans-serif'; g.fillText('รอข้อมูล…', 8, 18); return; }
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0];
  const pmax = Math.max(1e-9, ...hist.map((x) => x[1])) * 1.15;
  const X = (t: number) => 34 + ((t - t0) / Math.max(1e-9, t1 - t0)) * (w - 42), Y = (p: number) => hh - 16 - (p / pmax) * (hh - 26);
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  for (let k = 0; k <= 2; k++) { const y = Y((pmax / 1.15) * (k / 2)); g.beginPath(); g.moveTo(34, y); g.lineTo(w - 8, y); g.stroke(); }
  g.fillStyle = '#9fb5a8'; g.font = '11px sans-serif';
  g.fillText(formatSI(pmax / 1.15, 'W', 2), 2, Y(pmax / 1.15) + 4);
  g.fillText(`${fmtTime(t0)} – ${fmtTime(t1)}`, 38, hh - 3);
  g.strokeStyle = '#ffd54f'; g.lineWidth = 2; g.beginPath();
  // ขั้นบันได: ค่าเฉลี่ยของแต่ละช่วงคงที่จนถึงจุดถัดไป
  hist.forEach(([t, p], k) => { if (k === 0) g.moveTo(X(t), Y(p)); else { g.lineTo(X(t), Y(hist[k - 1][1])); g.lineTo(X(t), Y(p)); } });
  g.stroke();
}
