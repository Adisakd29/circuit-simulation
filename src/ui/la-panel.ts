import { setPartParams } from '../editor/ops';
import { STD_BAUDS, decodeI2c, decodeSpi, decodeUart, edgeIndex, guessBaud, i2cText, levelAt, measurePwm, spiText, uartText, type SpiFrame, type I2cFrame, type LogicBuffer, type LogicTrace, type PwmMeasure, type UartFrame } from '../instruments/logic';
import { TIME_DIVS } from '../instruments/scope';
import type { LogicAnalyzerPart } from '../model/types';
import { netOfPin } from '../connectivity/connectivity';
import type { App } from './app';
import { fmtTime } from './chart';
import { h } from './dom';

/**
 * แท็บ "เครื่องวิเคราะห์ลอจิก" ในแผงจำลอง: จอ 8 ช่อง (10 ช่องเวลา), ทริกเกอร์ขอบ, วัดความถี่/duty, ถอดรหัส UART และ I²C
 * ข้อมูลมาจาก LogicBuffer ที่แอปเก็บจากผลจำลอง (ดู src/instruments/logic.ts)
 */
export const LA_COLORS = ['#f2c94c', '#56ccf2', '#6fcf97', '#f2994a', '#bb6bd9', '#eb5757', '#2fd4b6', '#e0e0e0'];
const LA_DIVS = TIME_DIVS.filter((d) => d >= 1e-6 && d <= 1);
type P = LogicAnalyzerPart['params'];

/** ชื่อสิ่งที่ช่องต่ออยู่ (เช่น "UNO1 D9") */
export function laChannelNames(app: App, la: LogicAnalyzerPart): string[] {
  const c = app.conn();
  return Array.from({ length: 8 }, (_, k) => {
    const n = netOfPin(c, la.id, `CH${k}`);
    if (n === undefined) return '';
    const pins = c.nets[n].partPins.filter((pp) => pp.partId !== la.id);
    const pick = pins.find((pp) => { const p = app.doc.parts.find((x) => x.id === pp.partId); return p && ['uno', 'nano', 'unoq', 'mega', 'promini', 'attiny85', 'pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5'].includes(p.kind); }) ?? pins[0];
    if (!pick) return c.nets[n].groups.length ? 'บนเบรดบอร์ด' : '';
    const p = app.doc.parts.find((x) => x.id === pick.partId);
    return `${p?.label ?? pick.partId} ${pick.pin.replace(/\.\d+$/, '')}`;
  });
}

/** ช่วงเวลาที่แสดง: ต่อเนื่อง (ข้อมูลล่าสุด) หรือจากขอบทริกเกอร์ล่าสุดที่มีข้อมูลหลังขอบครบ 9 ช่อง */
export function laWindow(buf: LogicBuffer, p: P): { t0: number; t1: number; trig: boolean | null } {
  const W = p.timeDiv * 10;
  let t1 = buf.t1, t0 = t1 - W;
  if (p.trigCh < 0) return { t0, t1, trig: null };
  const tr = buf.ch[p.trigCh];
  const want = p.trigEdge === 'rise' ? 1 : 0;
  // ขอบทริกเกอร์ล่าสุดที่มีข้อมูลหลังขอบครบหน้าจอ — เลือกขอบแรกของชุดสัญญาณ (ก่อนหน้าสงบอย่างน้อย max(1 ช่อง, 2 ms) เช่น ต้นข้อความ UART) ถ้ามี
  const quiet = Math.max(p.timeDiv, 2e-3);
  let latest = -1;
  for (let i = edgeIndex(tr, buf.t1 - p.timeDiv * 9) - 1; i >= 0; i--) {
    const prev = i === 0 ? tr.lvl0 : tr.v[i - 1];
    if (tr.v[i] === want && prev === 1 - want) {
      if (latest < 0) latest = i;
      if (i === 0 || tr.t[i] - tr.t[i - 1] >= quiet) { latest = i; break; }
    }
    if (tr.t[i] < buf.t0 || (latest >= 0 && tr.t[latest] - tr.t[i] > W * 50)) break;
  }
  if (latest >= 0) { t0 = tr.t[latest] - p.timeDiv; t1 = t0 + W; return { t0, t1, trig: true }; }
  return { t0, t1, trig: false };
}

export interface LaChannelInfo {
  k: number; name: string; m: PwmMeasure; baud: number | null; frames: UartFrame[]; text: string;
  /** I²C (ช่อง SDA): เฟรมที่ถอดได้ ช่อง SCL ที่จับคู่ และความถี่ SCL ที่วัดในไบต์ล่าสุด */
  i2c: I2cFrame[]; sclCh: number | null; scl: number | null;
  /** SPI (ช่องข้อมูล): ไบต์ที่ถอดได้ ช่อง SCK/CS ที่จับคู่ และความถี่ SCK ในไบต์ล่าสุด */
  spi: SpiFrame[]; sckCh: number | null; csCh: number | null; sck: number | null;
}

/** การวัดและการถอดรหัสของทุกช่องที่ต่ออยู่ (ใช้ทั้งในแผงและในการตรวจผลแลป) */
export function laAnalyze(buf: LogicBuffer, p: P, win: { t0: number; t1: number }, names: string[]): LaChannelInfo[] {
  const out: LaChannelInfo[] = [];
  buf.ch.forEach((tr, k) => {
    if (tr.src === 'none' && !tr.t.length) return;
    const m = measurePwm(tr, win.t0, win.t1);
    let baud: number | null = null, frames: UartFrame[] = [], text = '';
    let i2c: I2cFrame[] = [], sclCh: number | null = null, scl: number | null = null;
    let spi: SpiFrame[] = [], sckCh: number | null = null, csCh: number | null = null, sck: number | null = null;
    if (p.decoders[k] === 'uart') {
      baud = p.bauds[k] || guessBaud(tr);
      if (baud) { frames = decodeUart(tr, baud, buf.t0, buf.t1); text = uartText(frames); }
    } else if (p.decoders[k] === 'i2c-sda') {
      const s = p.decoders.findIndex((d, j) => d === 'i2c-scl' && j !== k);
      if (s >= 0) {
        sclCh = s;
        i2c = decodeI2c(tr, buf.ch[s], buf.t0, buf.t1);
        text = i2cText(i2c);
        // ความถี่ SCL: คาบของสัญญาณนาฬิกาภายในไบต์ล่าสุดที่ถอดได้ (ไม่รวมช่วงว่างระหว่างธุรกรรม)
        const last = [...i2c].reverse().find((f) => f.kind === 'addr' || f.kind === 'data');
        if (last) scl = measurePwm(buf.ch[s], last.t0 - 1e-9, last.t1 + 1e-9).freq;
      }
    } else if (p.decoders[k] === 'spi-data') {
      const s = p.decoders.findIndex((d, j) => d === 'spi-sck' && j !== k), c = p.decoders.findIndex((d, j) => d === 'spi-cs' && j !== k);
      if (s >= 0) {
        sckCh = s; csCh = c >= 0 ? c : null;
        spi = decodeSpi(buf.ch[s], tr, c >= 0 ? buf.ch[c] : null, p.spiMode ?? 0, buf.t0, buf.t1);
        text = spiText(spi);
        const last = spi.at(-1);
        if (last) sck = measurePwm(buf.ch[s], last.t0 - 1e-9, last.t1 + 1e-9).freq;
      }
    }
    out.push({ k, name: names[k], m, baud, frames, text, i2c, sclCh, scl, spi, sckCh, csCh, sck });
  });
  return out;
}

function fmtHz(f: number): string { return f >= 1e6 ? `${(f / 1e6).toPrecision(4)} MHz` : f >= 1e3 ? `${(f / 1e3).toPrecision(4)} kHz` : `${f.toPrecision(4)} Hz`; }

export function laBody(app: App, la: LogicAnalyzerPart): HTMLElement {
  const p = la.params;
  const set = (patch: Partial<P>, label: string) => app.apply(setPartParams(app.doc, la.id, patch), label);
  const tdiv = h('select', { id: 'la-tdiv', 'aria-label': 'เวลาต่อช่อง (time/div)' }, ...LA_DIVS.map((v) => h('option', { value: String(v), selected: Math.abs(v - p.timeDiv) < v * 1e-9 }, `${fmtTime(v)}/div`)));
  tdiv.addEventListener('change', () => set({ timeDiv: Number(tdiv.value) }, `ตั้ง time/div ของ ${la.label}`));
  const tch = h('select', { id: 'la-trig', 'aria-label': 'ช่องทริกเกอร์' }, h('option', { value: '-1', selected: p.trigCh < 0 }, 'ไม่ใช้ทริกเกอร์'), ...Array.from({ length: 8 }, (_, k) => h('option', { value: String(k), selected: p.trigCh === k }, `Trig CH${k}`)));
  tch.addEventListener('change', () => set({ trigCh: Number(tch.value) }, 'ตั้งช่องทริกเกอร์'));
  const edge = h('select', { id: 'la-edge', 'aria-label': 'ขอบทริกเกอร์' }, h('option', { value: 'rise', selected: p.trigEdge === 'rise' }, 'ขอบขึ้น ↑'), h('option', { value: 'fall', selected: p.trigEdge === 'fall' }, 'ขอบลง ↓'));
  edge.addEventListener('change', () => set({ trigEdge: edge.value as 'rise' | 'fall' }, 'ตั้งขอบทริกเกอร์'));
  const names = laChannelNames(app, la);
  const rows = names.map((nm, k) => {
    if (!nm) return null;
    const dec = h('select', { id: `la-dec-${k}`, 'aria-label': `ตัวถอดรหัส CH${k}` }, h('option', { value: 'none', selected: p.decoders[k] === 'none' }, 'ไม่ถอดรหัส'), h('option', { value: 'uart', selected: p.decoders[k] === 'uart' }, 'UART (8N1)'),
      h('option', { value: 'i2c-sda', selected: p.decoders[k] === 'i2c-sda' }, 'I²C SDA'), h('option', { value: 'i2c-scl', selected: p.decoders[k] === 'i2c-scl' }, 'I²C SCL'),
      h('option', { value: 'spi-data', selected: p.decoders[k] === 'spi-data' }, 'SPI ข้อมูล (MOSI/MISO)'), h('option', { value: 'spi-sck', selected: p.decoders[k] === 'spi-sck' }, 'SPI SCK'), h('option', { value: 'spi-cs', selected: p.decoders[k] === 'spi-cs' }, 'SPI CS (ต่ำ = เลือก)'));
    dec.addEventListener('change', () => { const d = [...p.decoders]; d[k] = dec.value as P['decoders'][number]; set({ decoders: d }, `ตั้งตัวถอดรหัส CH${k}`); });
    const baud = h('select', { id: `la-baud-${k}`, 'aria-label': `บอดเรต CH${k}`, hidden: p.decoders[k] !== 'uart' }, h('option', { value: '0', selected: !p.bauds[k] }, 'บอดเรตอัตโนมัติ'), ...STD_BAUDS.map((b) => h('option', { value: String(b), selected: p.bauds[k] === b }, `${b}`)));
    baud.addEventListener('change', () => { const b = [...p.bauds]; b[k] = Number(baud.value); set({ bauds: b }, `ตั้งบอดเรต CH${k}`); });
    return h('div', { class: 'la-ch', id: `la-ch-${k}` }, h('b', { style: `color:${LA_COLORS[k]}` }, `CH${k}`), h('span', { class: 'la-name' }, nm), dec, baud, h('span', { class: 'la-meas', id: `la-m-${k}` }), h('pre', { class: 'la-text', id: `la-t-${k}`, hidden: p.decoders[k] !== 'uart' && p.decoders[k] !== 'i2c-sda' && p.decoders[k] !== 'spi-data' }));
  }).filter(Boolean) as HTMLElement[];
  const spiMode = h('select', { id: 'la-spimode', 'aria-label': 'โหมด SPI', hidden: !p.decoders.some((d) => d.startsWith('spi')) }, ...[0, 1, 2, 3].map((m) => h('option', { value: String(m), selected: (p.spiMode ?? 0) === m }, `SPI โหมด ${m} (CPOL ${m >> 1}, CPHA ${m & 1})`)));
  spiMode.addEventListener('change', () => set({ spiMode: Number(spiMode.value) }, 'ตั้งโหมด SPI'));
  return h('div', { class: 'lg-body' },
    h('div', { class: 'sc-screen' }, h('canvas', { class: 'la-canvas', id: 'la-canvas', role: 'img', 'aria-label': 'หน้าจอเครื่องวิเคราะห์ลอจิก' }), h('span', { class: 'sc-status', id: 'la-status' })),
    h('div', { class: 'sc-row' }, tdiv, tch, edge, spiMode,
      h('button', { class: 'lg-btn', id: 'la-run', 'aria-pressed': String(app.laFrozen), onclick: () => app.toggleLaFrozen() }, app.laFrozen ? 'Run (จอค้างอยู่)' : 'Stop (ค้างภาพ)')),
    rows.length ? h('div', { class: 'la-chs' }, ...rows) : h('p', { class: 'lg-note' }, 'ยังไม่ได้ต่อช่องใด — ต่อสายจากขา CH0–CH7 ของเครื่องวิเคราะห์ไปยังจุดที่ต้องการดู และต่อ GND กับกราวด์ของวงจร'),
    h('div', { class: 'lg-note', id: 'la-note' }, 'ขาเข้า LOW < 0.8 V / HIGH > 2.0 V · ขอบจากขาไมโครคอนโทรลเลอร์ได้เวลาตรงตามตัวจำลอง CPU · จุดอื่นได้ระดับตามก้าวคำนวณวงจร · ขา TX/RX ของ UART ฮาร์ดแวร์แสดงรูปคลื่นที่สร้างจากไบต์ที่ส่ง/รับตามบอดเรตของชิป · สาย SDA/SCL ของ I²C ฮาร์ดแวร์สร้างจากขั้นของธุรกรรมตามคาบ SCL ของชิป · สาย SCK/MOSI ของ SPI ฮาร์ดแวร์ (Pico) สร้างจากไบต์ที่ส่งตามความถี่และโหมดของชิป'));
}

let laCount = 0;
export function updateLaLive(app: App) {
  const cv = document.getElementById('la-canvas') as HTMLCanvasElement | null;
  const la = app.laPart();
  if (!cv || !la) return;
  const buf = app.laBuffer(la.id);
  const p = la.params;
  const win = laWindow(buf, p);
  const names = laChannelNames(app, la);
  const info = laAnalyze(buf, p, win, names);
  drawLogic(cv, buf, p, win, info);
  const st = document.getElementById('la-status');
  if (st) {
    st.textContent = app.laFrozen ? 'STOP' : win.trig === null ? 'Auto' : win.trig ? "Trig'd" : 'รอทริกเกอร์';
    st.className = `sc-status ${app.laFrozen ? 'stop' : win.trig === false ? 'auto' : 'ok'}`;
  }
  laCount++;
  for (const c of info) {
    const m = document.getElementById(`la-m-${c.k}`);
    const tr = buf.ch[c.k];
    if (m) m.textContent = tr.src === 'none' || (tr.lvl0 === null && !tr.t.length) ? 'ไม่มีข้อมูล' : p.decoders[c.k] === 'i2c-sda' ? (c.sclCh === null
      ? 'I²C: ตั้งอีกช่องหนึ่ง (ที่ต่อสาย SCL) เป็น "I²C SCL"'
      : `I²C · SCL = CH${c.sclCh}${c.scl ? ` · ${fmtHz(c.scl)}` : ''} · ${c.i2c.filter((f) => f.kind === 'addr').length} ธุรกรรม · ${c.i2c.filter((f) => f.kind === 'data').length} ไบต์ข้อมูล${c.i2c.some((f) => f.kind === 'addr' && !f.ack) ? ` · ที่อยู่ไม่ตอบ (NACK) ${c.i2c.filter((f) => f.kind === 'addr' && !f.ack).length}` : ''}`)
      : p.decoders[c.k] === 'spi-data' ? (c.sckCh === null ? 'SPI: ตั้งอีกช่องหนึ่ง (ที่ต่อสาย SCK) เป็น "SPI SCK" (และ CS ถ้ามี)' : `SPI โหมด ${p.spiMode ?? 0} · SCK = CH${c.sckCh}${c.csCh !== null ? ` · CS = CH${c.csCh}` : ''}${c.sck ? ` · ${fmtHz(c.sck)}` : ''} · ${c.spi.length} ไบต์`)
      : p.decoders[c.k] === 'spi-sck' ? `SPI SCK${tr.src === 'spi' ? ' · รูปคลื่นจาก SPI ฮาร์ดแวร์' : ''}` : p.decoders[c.k] === 'spi-cs' ? 'SPI CS'
      : p.decoders[c.k] === 'i2c-scl' ? `I²C SCL (คู่กับช่อง SDA)${tr.src === 'i2c' ? ' · รูปคลื่นจาก I²C ฮาร์ดแวร์' : ''}` : p.decoders[c.k] === 'uart' ? (c.baud
      ? `UART ${c.baud} baud${p.bauds[c.k] ? '' : ' (อัตโนมัติ)'} · บิตละ ${fmtTime(1 / c.baud)} · ${c.frames.length} ไบต์${c.frames.some((f) => !f.ok) ? ` · เฟรมเสีย ${c.frames.filter((f) => !f.ok).length}` : ''}`
      : 'UART: เดาบอดเรตไม่ได้ (ยังไม่มีเฟรม หรือเลือกบอดเรตเอง)') : (c.m.freq !== null
      ? `f ${fmtHz(c.m.freq)} · duty ${c.m.duty !== null ? `${(c.m.duty * 100).toFixed(1)}%` : '—'} · HIGH ${c.m.high !== null ? fmtTime(c.m.high) : '—'}`
      : `ระดับ ${c.m.level === 1 ? 'HIGH' : c.m.level === 0 ? 'LOW' : 'ไม่ทราบ (ลอย/ยังไม่ต่อ GND)'}`) + (tr.over ? ' · ขอบถี่เกินเก็บได้ครบ' : '');
    const t = document.getElementById(`la-t-${c.k}`);
    if (t && p.decoders[c.k] === 'spi-data' && (laCount % 2 === 0 || app.laFrozen)) t.textContent = c.text.length > 600 ? '…' + c.text.slice(-600) : c.text;
    if (t && p.decoders[c.k] === 'i2c-sda' && (laCount % 2 === 0 || app.laFrozen)) {
      const txt = c.sclCh === null ? 'ยังไม่ได้เลือกช่อง SCL' : c.text.slice(-600) || '(ยังไม่มีธุรกรรม)';
      if (t.textContent !== txt) { t.textContent = txt; t.scrollTop = t.scrollHeight; }
    }
    if (t && p.decoders[c.k] === 'uart' && (laCount % 2 === 0 || app.laFrozen)) {
      const txt = c.baud ? (c.text.slice(-400) || '(ยังไม่มีเฟรม)') : 'เดาบอดเรตไม่ได้ — เลือกบอดเรตเอง';
      if (t.textContent !== txt) { t.textContent = txt; t.scrollTop = t.scrollHeight; }
    }
  }
}

export function drawLogic(canvas: HTMLCanvasElement, buf: LogicBuffer, p: P, win: { t0: number; t1: number }, info: LaChannelInfo[]) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  const x = canvas.getContext('2d', { willReadFrequently: true })!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#0d1312'; x.fillRect(0, 0, W, H);
  const L = 44, plotW = W - L - 4;
  x.strokeStyle = 'rgba(160,200,185,0.16)'; x.lineWidth = 1;
  for (let i = 0; i <= 10; i++) { const gx = Math.round(L + (i * plotW) / 10) + 0.5; x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
  const rows = info.length ? info : [];
  if (!rows.length) { x.fillStyle = 'rgba(200,230,215,0.75)'; x.font = '600 13px "IBM Plex Sans Thai", sans-serif'; x.textAlign = 'center'; x.fillText('ยังไม่ได้ต่อช่องใด', W / 2, H / 2); return; }
  const rh = Math.min(44, (H - 14) / rows.length);
  const X = (t: number) => L + ((t - win.t0) / (win.t1 - win.t0)) * plotW;
  rows.forEach((c, r) => {
    const tr: LogicTrace = buf.ch[c.k];
    const yHi = 6 + r * rh + rh * 0.18, yLo = 6 + r * rh + rh * 0.72;
    x.fillStyle = LA_COLORS[c.k]; x.font = '600 11px "IBM Plex Mono", monospace'; x.textAlign = 'left';
    x.fillText(`CH${c.k}`, 4, yLo - 2);
    x.strokeStyle = LA_COLORS[c.k]; x.lineWidth = 1.4;
    x.beginPath();
    const yOf = (v: 0 | 1 | null) => (v === 1 ? yHi : v === 0 ? yLo : (yHi + yLo) / 2);
    let lv = levelAt(tr, win.t0);
    let px = L;
    x.moveTo(px, yOf(lv));
    let lastPx = -1;
    for (let i = edgeIndex(tr, win.t0); i < tr.t.length && tr.t[i] <= win.t1; i++) {
      const ex = Math.round(X(tr.t[i]) * 2) / 2;
      if (ex === lastPx) { lv = tr.v[i]; x.lineTo(ex, yHi); x.lineTo(ex, yLo); continue; } // หลายขอบในพิกเซลเดียว: เส้นตั้ง
      x.lineTo(ex, yOf(lv));
      lv = tr.v[i];
      x.lineTo(ex, yOf(lv));
      lastPx = ex; px = ex;
    }
    x.lineTo(L + plotW, yOf(lv));
    x.stroke();
    // I²C ที่ถอดได้ (บนช่อง SDA): กล่องที่อยู่/ไบต์ (เขียว = ACK, ส้ม = NACK) และเครื่องหมาย S / Sr / P
    if (c.i2c.length) {
      x.font = '600 10px "IBM Plex Mono", monospace'; x.textAlign = 'center';
      for (const f of c.i2c) {
        if (f.t1 < win.t0 || f.t0 > win.t1) continue;
        if (f.kind === 'start' || f.kind === 'restart' || f.kind === 'stop') {
          const px2 = X(f.t0);
          x.fillStyle = f.kind === 'stop' ? '#eb5757' : '#6fcf97';
          x.fillText(f.kind === 'start' ? 'S' : f.kind === 'restart' ? 'Sr' : 'P', px2, yHi - 2);
          continue;
        }
        const a = Math.max(L, X(f.t0) + 1), b = Math.min(L + plotW, X(f.t1) - 1);
        if (b - a < 3) continue;
        x.fillStyle = f.ack ? 'rgba(111,207,151,0.25)' : 'rgba(242,153,74,0.35)';
        x.fillRect(a, yHi - 1, b - a, yLo - yHi + 2);
        if (b - a > 22) {
          x.fillStyle = '#ffffff';
          const hx = f.value.toString(16).toUpperCase().padStart(2, '0');
          x.fillText(f.kind === 'addr' ? `${hx}${f.read ? 'R' : 'W'}` : hx, (a + b) / 2, (yHi + yLo) / 2 + 4);
        }
      }
    }
    // เฟรม UART ที่ถอดได้: กล่องพร้อมอักขระ
    if (c.frames.length) {
      x.font = '600 10px "IBM Plex Mono", monospace'; x.textAlign = 'center';
      for (const f of c.frames) {
        if (f.t1 < win.t0 || f.t0 > win.t1) continue;
        const a = Math.max(L, X(f.t0) + 1), b = Math.min(L + plotW, X(f.t1) - 1);
        if (b - a < 3) continue;
        x.fillStyle = f.ok ? 'rgba(86,204,242,0.22)' : 'rgba(235,87,87,0.3)';
        x.fillRect(a, yHi - 1, b - a, yLo - yHi + 2);
        if (b - a > 14) {
          x.fillStyle = '#ffffff';
          const s = !f.ok ? '!' : f.byte >= 32 && f.byte < 127 ? String.fromCharCode(f.byte) : f.byte === 10 ? '\\n' : f.byte === 13 ? '\\r' : f.byte.toString(16).toUpperCase().padStart(2, '0');
          x.fillText(s, (a + b) / 2, (yHi + yLo) / 2 + 4);
        }
      }
    }
  });
  x.fillStyle = 'rgba(200,230,215,0.8)'; x.font = '11px "IBM Plex Sans Thai", sans-serif'; x.textAlign = 'right';
  x.fillText(`${fmtTime(p.timeDiv)}/div · ซ้ายสุด t = ${win.t0.toFixed(win.t1 - win.t0 < 0.01 ? 6 : 4)} s`, W - 6, H - 4);
}
