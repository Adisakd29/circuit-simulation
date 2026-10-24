import { setPartParams } from '../editor/ops';
import { TIME_DIVS, VOLT_DIVS, autoSet, type ScopeFrame, type ScopeSettings } from '../instruments/scope';
import { downloadText } from '../storage/storage';
import type { App } from './app';
import { drawChart, fmtTime } from './chart';
import { $, h, svg } from './dom';
import { icon } from './icons';
import { SCOPE_COLORS, drawScope } from './scope-draw';
import { BODE_COLORS, bodeLayout, drawBode, freqAtX } from './bode-draw';
import { bodeAt, fmtHz, measureBode } from '../instruments/bode';
import type { PicoPart, ScopePart } from '../model/types';
import { netLinked, netOfPin } from '../connectivity/connectivity';

/**
 * แผงเครื่องมือตามเวลา (แสดงเมื่อจำลองวงจรที่มี C, L หรือเครื่องกำเนิดสัญญาณ)
 *  - ส่วนหัว: หยุด/เดินเวลา, เริ่มใหม่, เวลาจำลอง
 *  - แท็บ "กราฟบันทึกค่า": โวลต์มิเตอร์และแอมมิเตอร์ตามเวลา
 *  - แท็บ "ออสซิลโลสโคป": เมื่อมีออสซิลโลสโคปในวงจร
 * ความเร็ว = เวลาของวงจรต่อ 1 วินาทีจริง
 */

export const SPEEDS: Array<{ v: number; label: string }> = [
  { v: 10, label: '1 s จริง = 10 s' },
  { v: 1, label: '1 s จริง = 1 s (เวลาจริง)' },
  { v: 0.1, label: '1 s จริง = 100 ms' },
  { v: 0.01, label: '1 s จริง = 10 ms' },
  { v: 0.001, label: '1 s จริง = 1 ms' },
  { v: 0.0001, label: '1 s จริง = 100 µs' },
  { v: 0.00001, label: '1 s จริง = 10 µs' },
];

/** หน้าต่างเวลาของกราฟบันทึกค่า = ประวัติ 8 วินาทีจริง */
const WINDOW_REAL_S = 8;
let liveCount = 0;
let chartColors: { ink: string; grid: string; bg: string } | null = null;

function ensurePanel(): HTMLElement {
  let el = document.getElementById('logger');
  if (!el) {
    el = h('section', { class: 'logger', id: 'logger', 'aria-label': 'เวลาจำลอง กราฟบันทึกค่า และออสซิลโลสโคป', hidden: true });
    $('stage').append(el);
  }
  return el;
}

export function fmtDiv(v: number, unit: string): string {
  if (v >= 1) return `${v} ${unit}`;
  if (v >= 1e-3) return `${+(v * 1e3).toPrecision(3)} m${unit}`;
  return `${+(v * 1e6).toPrecision(3)} µ${unit}`;
}

export function renderLogger(app: App, force = false) {
  const el = ensurePanel();
  const s = app.sim;
  const show = app.running && s?.mode === 'tran';
  el.hidden = !show;
  if (!show) return;
  const simc = app.simc;
  const sc = app.scopePart();
  const pc = app.picoPart();
  const tabs: Array<[App['dockTab'], string]> = [];
  if (pc) tabs.push(['pico', 'Pico (MicroPython)']);
  if (sc) tabs.push(['scope', 'ออสซิลโลสโคป'], ['bode', 'กราฟโบด']);
  tabs.push(['logger', 'กราฟบันทึกค่า']);
  const tab = tabs.some((t) => t[0] === app.dockTab) ? app.dockTab : tabs[0][0];
  // แท็บ Pico มีช่องพิมพ์โค้ด/REPL: ไม่สร้างใหม่ถ้าโครงสร้างเดิม (กันเสียโฟกัสและข้อความที่กำลังพิมพ์)
  // ไม่สร้างแผงใหม่ถ้าโครงสร้างเดิม: ผลจำลองมาทุก 50 ms และแผงถูกเรียกวาดซ้ำ ~4 ครั้ง/วินาที — ถ้าแทนที่ปุ่มทุกครั้ง
  // การแตะบนจอสัมผัส (iPad) ที่คร่อมจังหวะแทนที่จะหายไป และ select ที่เปิดอยู่จะปิดเอง (แท็บ Pico: กันเสียโฟกัสช่องพิมพ์โค้ดด้วย)
  const sc0 = sc && (tab === 'scope' || tab === 'bode') ? JSON.stringify(sc.params) : '';
  const sig = [tab, app.loggerOpen, app.loggerHidden, simc.paused, simc.speed, app.scopeSyncSpeed, app.scopeFrozen, sc0, pc?.id, tabs.map((t) => t[0]).join()].join('|');
  if (!force && el.dataset.sig === sig && el.firstChild && (tab !== 'pico' || !app.loggerOpen || app.loggerHidden || el.querySelector('#pc-code'))) {
    updateLoggerLive(app);
    if (tab === 'bode' && app.loggerOpen && !app.loggerHidden && app.bode?.doc !== app.doc) app.requestBode();
    return;
  }
  el.dataset.sig = sig;
  el.classList.toggle('min', app.loggerHidden);
  el.classList.toggle('collapsed', !app.loggerOpen && !app.loggerHidden);
  if (app.loggerHidden) {
    el.classList.remove('wide');
    el.replaceChildren(h('button', { class: 'lg-btn lg-show', id: 'lg-show', title: 'แสดงแผงเวลาจำลอง/กราฟ', 'aria-label': 'แสดงแผงเวลาจำลองและกราฟ', onclick: () => { app.loggerHidden = false; renderLogger(app); } },
      svg(icon('chevronUp')), h('span', { class: 'lg-time', id: 'lg-time' })));
    updateLoggerLive(app);
    return;
  }
  el.classList.toggle('wide', (tab === 'scope' || tab === 'bode' || tab === 'pico') && app.loggerOpen);
  app.onBodeUpdate = () => updateBodeView(app);
  const synced = !!sc && app.scopeSyncSpeed;
  const opts = [...SPEEDS];
  if (!opts.some((o) => Math.abs(o.v - simc.speed) < o.v * 1e-6)) opts.push({ v: simc.speed, label: `1 s จริง = ${fmtTime(simc.speed)}` });
  opts.sort((a, b) => b.v - a.v);
  const speed = h('select', { id: 'lg-speed', 'aria-label': 'ความเร็วเวลาจำลอง', disabled: synced, title: synced ? 'ความเร็วถูกตั้งตาม time/div ของออสซิลโลสโคป (ปิดได้ในแท็บออสซิลโลสโคป)' : 'ความเร็วเวลาจำลอง' },
    ...opts.map((o) => h('option', { value: String(o.v), selected: Math.abs(o.v - simc.speed) < o.v * 1e-6 }, o.label)));
  speed.addEventListener('change', () => app.setSpeed(Number(speed.value)));
  const body: HTMLElement[] = [];
  if (app.loggerOpen) {
    if (tabs.length > 1) {
      body.push(h('div', { class: 'tabs dock-tabs', role: 'tablist' },
        ...tabs.map(([id, label]) => h('button', { role: 'tab', id: `dock-tab-${id}`, 'aria-selected': String(tab === id), onclick: () => { app.dockTab = id; renderLogger(app); } }, label))));
    }
    body.push(tab === 'pico' && pc ? picoBody(app, pc) : tab === 'scope' && sc ? scopeBody(app, sc.id, sc.params) : tab === 'bode' && sc ? bodeBody(app, sc) : loggerBody(app, speed));
  }
  el.replaceChildren(
    h('div', { class: 'lg-head' },
      h('button', { class: 'lg-btn', id: 'lg-pause', onclick: () => app.togglePause(), title: simc.paused ? 'เดินเวลาต่อ' : 'หยุดเวลา', 'aria-label': simc.paused ? 'เดินเวลาต่อ' : 'หยุดเวลา' },
        svg(icon(simc.paused ? 'run' : 'pause')), h('span', { class: 'lg-lbl' }, simc.paused ? 'เดินต่อ' : 'หยุดเวลา')),
      h('button', { class: 'lg-btn', id: 'lg-restart', onclick: () => app.restartTime(), title: 'เริ่มเวลาใหม่ที่ 0 s', 'aria-label': 'เริ่มเวลาใหม่ที่ 0 s' }, svg(icon('resetView')), h('span', { class: 'lg-lbl' }, 'เริ่มใหม่')),
      h('span', { class: 'lg-time', id: 'lg-time' }),
      h('button', { class: 'lg-btn icon', id: 'lg-toggle', 'aria-expanded': String(app.loggerOpen), title: app.loggerOpen ? 'ย่อแผง' : 'ขยายแผง', onclick: () => { app.loggerOpen = !app.loggerOpen; renderLogger(app); } },
        svg(icon(app.loggerOpen ? 'chevronDown' : 'chevronUp'))),
      h('button', { class: 'lg-btn icon lg-hide', id: 'lg-hide', title: 'ซ่อนแผง (เหลือปุ่มเล็กมุมล่าง)', 'aria-label': 'ซ่อนแผงเวลาจำลอง', onclick: () => { app.loggerHidden = true; renderLogger(app); } },
        svg(icon('close'))),
    ),
    ...body,
  );
  updateLoggerLive(app);
  if (tab === 'bode') { if (app.bode?.doc === app.doc) updateBodeView(app); else app.requestBode(); }
}

function loggerBody(app: App, speed: HTMLSelectElement): HTMLElement {
  const csv = h('button', {
    class: 'lg-btn', id: 'lg-csv', title: 'บันทึกข้อมูลกราฟเป็น CSV',
    onclick: async () => {
      if (!app.logger.t.length) { app.status('ยังไม่มีข้อมูลในกราฟ', 'err'); return; }
      const r = await downloadText(`${app.title.replace(/[\\/:*?"<>|]+/g, '_') || 'circuit'}-logger.csv`, app.logger.toCSV());
      app.status(r.message, r.ok ? 'ok' : 'err');
    },
  }, svg(icon('download')), 'CSV');
  return h('div', { class: 'lg-body' },
    h('div', { class: 'lg-row' }, speed, csv),
    h('canvas', { class: 'lg-canvas', id: 'lg-canvas', role: 'img', 'aria-label': 'กราฟค่าที่วัดได้ตามเวลา' }),
    h('div', { class: 'lg-legend', id: 'lg-legend' }),
    h('div', { class: 'lg-note', id: 'lg-note' }));
}

function scopeBody(app: App, scopeId: string, p: ScopeSettings): HTMLElement {
  const set = (patch: Partial<ScopeSettings>, label: string) => app.apply(setPartParams(app.doc, scopeId, patch), label);
  const sel = (id: string, label: string, values: number[], cur: number, unit: string, on: (v: number) => void) => {
    const el = h('select', { id, 'aria-label': label, title: label }, ...values.map((v) => h('option', { value: String(v), selected: Math.abs(v - cur) < v * 1e-9 }, `${fmtDiv(v, unit)}/div`)));
    el.addEventListener('change', () => on(Number(el.value)));
    return el;
  };
  const chk = (id: string, label: string, color: string, checked: boolean, on: (v: boolean) => void) => {
    const el = h('input', { type: 'checkbox', id, checked });
    el.addEventListener('change', () => on(el.checked));
    return h('label', { class: 'sc-ch', for: id }, el, h('i', { style: `background:${color}` }), label);
  };
  /** ปุ่มสลับ DC/AC coupling ต่อช่อง */
  const cpl = (id: string, ch: string, ac: boolean, on: (v: boolean) => void) =>
    h('button', { class: 'lg-btn sc-cpl', id, 'aria-pressed': String(ac), title: `${ch}: ${ac ? 'AC coupling — ตัดระดับ DC แสดงเฉพาะส่วนที่แกว่ง (เช่น ripple)' : 'DC coupling — แสดงแรงดันจริงเทียบ GND'} (กดเพื่อสลับ)`, onclick: () => on(!ac) }, ac ? 'AC' : 'DC');
  const tsrc = h('select', { id: 'sc-tsrc', 'aria-label': 'แหล่ง trigger' }, h('option', { value: 'ch1', selected: p.trigSource === 'ch1' }, 'Trig CH1'), h('option', { value: 'ch2', selected: p.trigSource === 'ch2' }, 'Trig CH2'));
  tsrc.addEventListener('change', () => set({ trigSource: tsrc.value as 'ch1' | 'ch2' }, 'ตั้งแหล่ง trigger'));
  const slope = h('select', { id: 'sc-tslope', 'aria-label': 'ขอบ trigger' }, h('option', { value: 'rise', selected: p.trigSlope === 'rise' }, 'ขอบขึ้น ↑'), h('option', { value: 'fall', selected: p.trigSlope === 'fall' }, 'ขอบลง ↓'));
  slope.addEventListener('change', () => set({ trigSlope: slope.value as 'rise' | 'fall' }, 'ตั้งขอบ trigger'));
  const level = h('input', { type: 'number', id: 'sc-tlevel', step: '0.1', value: String(p.trigLevel), 'aria-label': 'ระดับ trigger (V)', title: 'ระดับ trigger (V)' });
  level.addEventListener('change', () => { const v = Number(level.value); if (isFinite(v)) set({ trigLevel: v }, `ตั้งระดับ trigger ${v} V`); });
  const sync = h('input', { type: 'checkbox', id: 'sc-sync', checked: app.scopeSyncSpeed });
  sync.addEventListener('change', () => { app.scopeSyncSpeed = sync.checked; app.syncScopeTiming(); renderLogger(app); });
  return h('div', { class: 'lg-body' },
    h('div', { class: 'sc-screen' },
      h('canvas', { class: 'sc-canvas', id: 'sc-canvas', role: 'img', 'aria-label': 'หน้าจอออสซิลโลสโคป' }),
      h('span', { class: 'sc-status', id: 'sc-status' })),
    h('div', { class: 'sc-row' },
      sel('sc-tdiv', 'เวลาต่อช่อง (time/div)', TIME_DIVS, p.timeDiv, 's', (v) => set({ timeDiv: v }, `ตั้ง time/div ${fmtDiv(v, 's')}`)),
      tsrc, slope, h('span', { class: 'sc-lv' }, level, 'V')),
    h('div', { class: 'sc-row' },
      chk('sc-ch1', 'CH1', SCOPE_COLORS.ch1, p.ch1On, (v) => set({ ch1On: v }, `${v ? 'เปิด' : 'ปิด'} CH1`)),
      sel('sc-v1', 'CH1 โวลต์ต่อช่อง', VOLT_DIVS, p.vdiv1, 'V', (v) => set({ vdiv1: v }, `ตั้ง CH1 ${fmtDiv(v, 'V')}/div`)),
      cpl('sc-ac1', 'CH1', !!p.ac1, (v) => set({ ac1: v }, `ตั้ง CH1 เป็น ${v ? 'AC' : 'DC'} coupling`)),
      chk('sc-ch2', 'CH2', SCOPE_COLORS.ch2, p.ch2On, (v) => set({ ch2On: v }, `${v ? 'เปิด' : 'ปิด'} CH2`)),
      sel('sc-v2', 'CH2 โวลต์ต่อช่อง', VOLT_DIVS, p.vdiv2, 'V', (v) => set({ vdiv2: v }, `ตั้ง CH2 ${fmtDiv(v, 'V')}/div`)),
      cpl('sc-ac2', 'CH2', !!p.ac2, (v) => set({ ac2: v }, `ตั้ง CH2 เป็น ${v ? 'AC' : 'DC'} coupling`))),
    h('div', { class: 'sc-row' },
      h('button', { class: 'lg-btn', id: 'sc-auto', title: 'ตั้ง time/div, V/div และระดับ trigger อัตโนมัติจากสัญญาณ', onclick: () => {
        const f = app.scope.frame(p);
        const patch = autoSet(f.measure[0], f.measure[1], p);
        if (!Object.keys(patch).length) { app.status('ยังไม่มีสัญญาณให้ตั้งอัตโนมัติ', 'err'); return; }
        set(patch, 'ตั้งออสซิลโลสโคปอัตโนมัติ (Auto)');
      } }, 'Auto'),
      h('button', { class: 'lg-btn', id: 'sc-run', 'aria-pressed': String(app.scopeFrozen), onclick: () => { app.scopeFrozen = !app.scopeFrozen; if (!app.scopeFrozen) app.scope.reset(); renderLogger(app); } }, app.scopeFrozen ? 'Run (จอค้างอยู่)' : 'Stop (ค้างภาพ)'),
      h('label', { class: 'sc-sync', for: 'sc-sync', title: 'ตั้งความเร็วเวลาให้เห็นราว 2 หน้าจอต่อวินาที' }, sync, 'ความเร็วตาม time/div')),
    h('div', { class: 'sc-meas', id: 'sc-meas' }),
    h('div', { class: 'lg-note', id: 'lg-note' }, 'ขาเข้าแต่ละช่อง 1 MΩ เทียบขั้ว GND ของเครื่อง · จอ 10 × 8 ช่อง · trigger อยู่ที่ช่องแรก'));
}

function picoBody(app: App, pc: PicoPart): HTMLElement {
  const draft = app.picoDraft?.id === pc.id ? app.picoDraft.code : pc.params.code;
  const code = h('textarea', { id: 'pc-code', class: 'pc-code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'โค้ด MicroPython', wrap: 'off' }) as HTMLTextAreaElement;
  code.value = draft;
  code.addEventListener('input', () => { app.picoDraft = { id: pc.id, code: code.value }; });
  code.addEventListener('change', () => app.picoCommit(code.value));
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const a = code.selectionStart, b = code.selectionEnd;
      code.setRangeText('    ', a, b, 'end');
      app.picoDraft = { id: pc.id, code: code.value };
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.picoRun(code.value); }
  });
  const input = h('input', { id: 'pc-input', class: 'pc-input', type: 'text', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', placeholder: 'พิมพ์คำสั่ง Python แล้วกด Enter (REPL)', 'aria-label': 'พิมพ์คำสั่งใน REPL' }) as HTMLInputElement;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); app.picoSend(input.value); input.value = ''; }
  });
  return h('div', { class: 'lg-body' },
    h('div', { class: 'sc-row' },
      h('button', { class: 'lg-btn primary', id: 'pc-run', title: 'ส่งโค้ดไปรันบนบอร์ด (Ctrl+Enter)', onclick: () => app.picoRun(code.value) }, svg(icon('run')), 'รันโค้ด'),
      h('button', { class: 'lg-btn', id: 'pc-stop', title: 'หยุดโปรแกรม (ส่ง Ctrl-C)', onclick: () => app.picoStop() }, svg(icon('stop')), 'หยุด'),
      h('button', { class: 'lg-btn', id: 'pc-reset', title: 'รีเซ็ตบอร์ด (บูตใหม่) และเริ่มเวลาใหม่', onclick: () => app.restartTime() }, svg(icon('resetView')), 'รีเซ็ตบอร์ด'),
      h('span', { class: 'pc-status', id: 'pc-status' })),
    h('div', { class: 'pc-grid' },
      h('div', { class: 'pc-col' }, h('div', { class: 'pc-lbl' }, `โค้ด (${pc.label}) — MicroPython v1.24.1`), code),
      h('div', { class: 'pc-col' }, h('div', { class: 'pc-lbl' }, 'Console (UART0 REPL)'), h('pre', { class: 'pc-console', id: 'pc-console', 'aria-live': 'polite' }), input)),
    h('div', { class: 'pc-pins', id: 'pc-pins' }),
    h('div', { class: 'lg-note' }, 'CPU ARM Cortex-M0+ จำลองทีละคำสั่ง (rp2040js) รันเฟิร์มแวร์ MicroPython จริง · เวลาของวงจรเดินตามนาฬิกา CPU · GP0/GP1 ใช้เป็น REPL'));
}

export function updatePicoLive(app: App) {
  const con = document.getElementById('pc-console');
  if (!con) return;
  if (con.textContent !== app.picoConsole) {
    const atEnd = con.scrollTop + con.clientHeight >= con.scrollHeight - 30;
    con.textContent = app.picoConsole;
    if (atEnd) con.scrollTop = con.scrollHeight;
  }
  const m = app.mcu;
  const st = document.getElementById('pc-status');
  if (st) {
    const state = !m ? 'รอการจำลอง…' : !m.booted ? 'กำลังบูต MicroPython…' : m.running ? 'โปรแกรมกำลังทำงาน' : 'REPL พร้อม (>>>)';
    const speed = m && m.ratio > 0 ? (m.ratio >= 0.95 ? 'ทันเวลาจริง' : `ช้ากว่าเวลาจริง ${(1 / m.ratio).toFixed(1)} เท่า`) : '';
    st.textContent = [state, speed, m ? `${m.mips.toFixed(1)} ล้านคำสั่ง/วินาที` : ''].filter(Boolean).join(' · ');
    st.className = `pc-status ${m?.running ? 'run' : ''}`;
  }
  const pins = document.getElementById('pc-pins');
  const pc = app.picoPart();
  if (pins && pc && m) {
    const conn = app.conn();
    const chips: HTMLElement[] = [];
    for (let i = 2; i <= 28; i++) {
      if (i >= 23 && i <= 25) continue;
      const net = netOfPin(conn, pc.id, `GP${i}`);
      const linked = net !== undefined && netLinked(conn, app.doc, net);
      const mode = m.pins[i];
      if (!linked && !mode.startsWith('out')) continue;
      const out = mode.startsWith('out');
      const duty = m.duty[i];
      const label = out ? (duty > 0.02 && duty < 0.98 ? `PWM/สลับ ${(duty * 100).toFixed(0)}%` : mode === 'out-high' ? 'ออก HIGH' : 'ออก LOW') : mode === 'in-pullup' ? 'เข้า (pull-up)' : mode === 'in-pulldown' ? 'เข้า (pull-down)' : 'เข้า';
      chips.push(h('span', { class: `pc-pin ${out ? (duty > 0.5 ? 'hi' : 'lo') : 'in'}` }, h('b', {}, `GP${i}`), label));
    }
    chips.push(h('span', { class: `pc-pin ${m.led > 0.5 ? 'hi' : 'lo'}` }, h('b', {}, 'LED บนบอร์ด (GP25)'), m.led > 0.02 && m.led < 0.98 ? `${(m.led * 100).toFixed(0)}%` : m.led > 0.5 ? 'ติด' : 'ดับ'));
    pins.replaceChildren(...chips);
  }
}

function bodeBody(app: App, sc: ScopePart): HTMLElement {
  const p = sc.params;
  const set = (patch: Partial<ScopePart['params']>, label: string) => app.apply(setPartParams(app.doc, sc.id, patch), label);
  const fsel = (id: string, label: string, values: number[], cur: number, on: (v: number) => void) => {
    const el = h('select', { id, 'aria-label': label, title: label }, ...values.map((v) => h('option', { value: String(v), selected: Math.abs(v - cur) < v * 1e-9 }, fmtHz(v))));
    el.addEventListener('change', () => on(Number(el.value)));
    return el;
  };
  const starts = [0.1, 1, 10, 100, 1000];
  const stops = [1e3, 1e4, 1e5, 1e6];
  if (!starts.includes(p.bodeStart)) starts.push(p.bodeStart);
  if (!stops.includes(p.bodeStop)) stops.push(p.bodeStop);
  const start = fsel('bd-start', 'ความถี่เริ่ม', starts.sort((a, b) => a - b), p.bodeStart, (v) => {
    if (v >= p.bodeStop) { app.status('ความถี่เริ่มต้องต่ำกว่าความถี่สิ้นสุด', 'err'); renderLogger(app, true); return; }
    set({ bodeStart: v }, `ตั้งความถี่เริ่มของกราฟโบด ${fmtHz(v)}`);
  });
  const stop = fsel('bd-stop', 'ความถี่สิ้นสุด', stops.sort((a, b) => a - b), p.bodeStop, (v) => {
    if (v <= p.bodeStart) { app.status('ความถี่สิ้นสุดต้องสูงกว่าความถี่เริ่ม', 'err'); renderLogger(app, true); return; }
    set({ bodeStop: v }, `ตั้งความถี่สิ้นสุดของกราฟโบด ${fmtHz(v)}`);
  });
  const ppd = h('select', { id: 'bd-ppd', 'aria-label': 'จำนวนจุดต่อทศวรรษ' }, ...[10, 20, 50].map((n) => h('option', { value: String(n), selected: n === p.bodePpd }, `${n} จุด/ทศวรรษ`)));
  ppd.addEventListener('change', () => set({ bodePpd: Number(ppd.value) }, `ตั้งความละเอียดกราฟโบด ${ppd.value} จุด/ทศวรรษ`));
  const ref = h('select', { id: 'bd-ref', 'aria-label': 'อ้างอิงอัตราขยาย' },
    h('option', { value: 'ch1', selected: p.bodeRef === 'ch1' }, 'CH2 / CH1'),
    h('option', { value: 'source', selected: p.bodeRef === 'source' }, 'CH2 / แหล่ง'));
  ref.addEventListener('change', () => set({ bodeRef: ref.value as 'ch1' | 'source' }, 'เปลี่ยนอ้างอิงอัตราขยาย'));
  const canvas = h('canvas', { class: 'bd-canvas', id: 'bd-canvas', role: 'img', 'aria-label': 'กราฟโบด: ขนาด (dB) และเฟส (องศา) เทียบความถี่' }) as HTMLCanvasElement;
  const pick = (ev: PointerEvent) => {
    const d = app.bode?.data;
    if (!d?.ok) return;
    const r = canvas.getBoundingClientRect();
    app.bodeCursor = freqAtX(bodeLayout(canvas, d), ev.clientX - r.left);
    updateBodeView(app);
  };
  canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); pick(ev); });
  canvas.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'mouse') pick(ev); });
  canvas.style.touchAction = 'none';
  return h('div', { class: 'lg-body' },
    h('div', { class: 'sc-row' }, start, h('span', { class: 'bd-to' }, 'ถึง'), stop, ppd, ref),
    canvas,
    h('div', { class: 'sc-meas', id: 'bd-meas' }),
    h('div', { class: 'lg-note', id: 'bd-note' }, 'AC sweep: วิเคราะห์สัญญาณเล็กรอบจุดทำงาน DC (ไม่ขึ้นกับ Vpp ที่ตั้ง) · แตะ/ลากบนกราฟเพื่ออ่านค่า · เส้นประ = ความถี่ที่ตั้งบนเครื่องกำเนิด'));
}

export function updateBodeView(app: App) {
  const canvas = document.getElementById('bd-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const b = app.bode;
  const stale = !b || b.doc !== app.doc;
  const d = b?.data ?? null;
  const m = d?.ok ? measureBode(d) : null;
  const fg = app.fgenPart();
  const css = getComputedStyle(document.documentElement);
  drawBode(canvas, d, {
    fgenF: fg?.params.frequency, cursor: app.bodeCursor, measure: m, message: 'กำลังคำนวณ…',
    ink: css.getPropertyValue('--ink-2').trim() || '#4e5b55', grid: css.getPropertyValue('--panel-3').trim() || '#d7ded7',
  });
  const meas = document.getElementById('bd-meas');
  if (!meas) return;
  if (!d?.ok) { meas.replaceChildren(); return; }
  const rows: HTMLElement[] = [];
  const val = (f: number) => { const v = bodeAt(d, f); return v.mag === null ? '—' : `${v.mag.toFixed(2)} dB, ${v.phase === null ? '—' : v.phase.toFixed(1) + '°'}`; };
  if (app.bodeCursor) rows.push(h('div', { class: 'sc-m', id: 'bd-cursor' }, h('b', { style: `color:${BODE_COLORS.cursor}` }, `เคอร์เซอร์ ${fmtHz(app.bodeCursor)}`), h('span', {}, val(app.bodeCursor))));
  if (m) {
    const cut = [m.fLow !== null ? `ต่ำ ${fmtHz(m.fLow)}` : null, m.fHigh !== null ? `สูง ${fmtHz(m.fHigh)}` : null].filter(Boolean).join(' · ') || 'ไม่ตกถึง −3 dB ในช่วงที่ sweep';
    rows.push(h('div', { class: 'sc-m', id: 'bd-peak' }, h('b', { style: `color:${BODE_COLORS.mag}` }, 'ขนาดสูงสุด'), h('span', {}, `${m.peakDb.toFixed(2)} dB ที่ ${fmtHz(m.peakF)}`)));
    rows.push(h('div', { class: 'sc-m', id: 'bd-cut' }, h('b', { style: `color:${BODE_COLORS.marker}` }, 'ความถี่ −3 dB'), h('span', {}, cut)));
  }
  if (fg) rows.push(h('div', { class: 'sc-m' }, h('b', { style: 'color:#8a6d00' }, `ที่ ${fmtHz(fg.params.frequency)} (เครื่องกำเนิด)`), h('span', {}, val(fg.params.frequency))));
  rows.push(h('div', { class: 'sc-m' }, h('b', {}, d.ref === 'ch1' ? 'H = CH2 / CH1' : 'H = CH2 / แหล่ง'), h('span', {}, `${d.freqs.length} จุด · คำนวณ ${b!.ms.toFixed(0)} ms${stale ? ' · กำลังคำนวณใหม่…' : ''}`)));
  for (const n of d.notes) rows.push(h('div', { class: 'sc-m warn' }, n));
  meas.replaceChildren(...rows);
}

function fmtV(v: number): string {
  const a = Math.abs(v);
  if (a < 1e-3) return `${+(v * 1e6).toPrecision(3)} µV`;
  if (a < 1) return `${+(v * 1e3).toPrecision(3)} mV`;
  return `${+v.toPrecision(4)} V`;
}

function fmtF(f: number | null): string {
  if (f === null) return '—';
  if (f >= 1e3) return `${+(f / 1e3).toPrecision(4)} kHz`;
  return `${+f.toPrecision(4)} Hz`;
}

export function updateLoggerLive(app: App) {
  const s = app.sim;
  if (!s || s.mode !== 'tran') return;
  updatePicoLive(app);
  const time = document.getElementById('lg-time');
  if (time) {
    time.textContent = `t = ${fmtTime(s.t)}`;
    time.classList.toggle('lag', !s.reached && !app.simc.paused);
    time.title = !s.reached && !app.simc.paused ? 'คำนวณไม่ทันความเร็วที่ตั้ง เวลาจำลองเดินช้ากว่าที่เลือก' : 'เวลาจำลอง';
  }
  liveCount++;
  const sc = app.scopePart();
  if (sc && app.dockTab === 'bode' && document.getElementById('bd-canvas')) {
    if (app.bode?.doc !== app.doc) app.requestBode();
    else if (liveCount % 8 === 0) updateBodeView(app); // วาดซ้ำเป็นระยะ (เช่น หลังขนาดแผงเปลี่ยน)
  }
  let frame: ScopeFrame | null = null;
  if (sc) {
    frame = app.scope.frame(sc.params);
    // จอบนโมเดล 3D อัปเดตราว 5 ครั้ง/วินาที
    if (liveCount % 4 === 0 || app.scopeFrozen) app.view.updateScopeScreen(sc.id, frame, sc.params);
  }
  const scCanvas = document.getElementById('sc-canvas') as HTMLCanvasElement | null;
  if (scCanvas && sc && frame) {
    drawScope(scCanvas, frame, sc.params, { css: true, message: 'ไม่มีสัญญาณ — ต่อ CH1/CH2 และ GND เข้ากับวงจร' });
    const st = document.getElementById('sc-status')!;
    st.textContent = app.scopeFrozen ? 'STOP' : frame.triggered ? "Trig'd" : 'Auto';
    st.className = `sc-status ${app.scopeFrozen ? 'stop' : frame.triggered ? 'ok' : 'auto'}`;
    st.title = app.scopeFrozen ? 'ค้างภาพไว้' : frame.triggered ? 'พบจุด trigger' : 'ไม่พบจุดที่สัญญาณข้ามระดับ trigger — แสดงข้อมูลล่าสุด';
    const meas = document.getElementById('sc-meas')!;
    const fmtSlew = (sv: number) => (sv >= 1e5 ? `${+(sv / 1e6).toPrecision(3)} V/µs` : sv >= 100 ? `${+(sv / 1e3).toPrecision(3)} V/ms` : `${+sv.toPrecision(3)} V/s`);
    const row = (name: string, color: string, on: boolean, m: ScopeFrame['measure'][0], vdiv: number) => !on ? null : h('div', { class: 'sc-m' },
      h('b', { style: `color:${color === SCOPE_COLORS.ch1 ? '#9a7b00' : '#167f99'}` }, `${name} ${fmtDiv(vdiv, 'V')}/div`),
      m ? h('span', {}, `Vpp ${fmtV(m.vpp)} · Vrms ${fmtV(m.vrms)} · เฉลี่ย ${fmtV(m.vavg)} · f ${fmtF(m.freq)}${m.rise !== null && m.slew !== null ? ` · ขาขึ้น 10–90% ${fmtTime(m.rise)} (${fmtSlew(m.slew)})` : ''}`) : h('span', {}, 'วัดไม่ได้ (จุดลอยหรือไม่มีข้อมูล)'));
    meas.replaceChildren(...[
      row('CH1', SCOPE_COLORS.ch1, sc.params.ch1On, frame.measure[0], sc.params.vdiv1),
      row('CH2', SCOPE_COLORS.ch2, sc.params.ch2On, frame.measure[1], sc.params.vdiv2),
      h('div', { class: 'sc-m' }, h('b', {}, `${fmtDiv(sc.params.timeDiv, 's')}/div`), h('span', {}, `จอกว้าง ${fmtTime(sc.params.timeDiv * 10)} · ความเร็ว 1 s จริง = ${fmtTime(app.simc.speed)}${!s.reached && !app.simc.paused ? ' · คำนวณไม่ทัน เวลาเดินช้ากว่าที่ตั้ง' : ''}`)),
    ].filter(Boolean) as HTMLElement[]);
  }
  const canvas = document.getElementById('lg-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const legend = document.getElementById('lg-legend')!;
  const note = document.getElementById('lg-note')!;
  const log = app.logger;
  if (!log.channels.length) {
    legend.replaceChildren();
    note.textContent = 'วางโพรบแดง/ดำ หรือแอมมิเตอร์ แล้วค่าจะถูกบันทึกในกราฟนี้';
  } else {
    legend.replaceChildren(...log.channels.map((c, i) => {
      const d = log.data[i];
      const last = d.length ? d[d.length - 1] : null;
      return h('span', { class: 'lg-ch' }, h('i', { style: `background:${c.color}` }), `${c.label}: `, h('b', {}, last === null ? '—' : `${+last.toPrecision(4)} ${c.unit}`));
    }));
    note.textContent = !s.reached && !app.simc.paused ? 'คำนวณไม่ทันความเร็วที่ตั้ง เวลาจำลองจึงเดินช้ากว่าที่เลือก — ลองลดความเร็ว' : 'กราฟบันทึกค่าตามเวลาจำลอง';
  }
  // อ่านสีจาก CSS ครั้งเดียว (getComputedStyle หลังแก้ DOM บังคับให้เบราว์เซอร์คำนวณสไตล์ใหม่ — ช้าบนแท็บเล็ตเมื่อทำทุกผลจำลอง)
  if (!chartColors) {
    const css = getComputedStyle(document.documentElement);
    chartColors = { ink: css.getPropertyValue('--ink-2').trim() || '#4e5b55', grid: css.getPropertyValue('--panel-3').trim() || '#d7ded7', bg: '#ffffff' };
  }
  drawChart(canvas, log, WINDOW_REAL_S * app.simc.speed, chartColors);
}
