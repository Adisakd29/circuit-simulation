/**
 * แผงคุณสมบัติและค่าที่อ่านได้ของเซนเซอร์ชุด 1 (รอบ 87)
 * สภาพแวดล้อม (เปลวไฟ เสียง น้ำ แก๊ส พื้น แรงกด แม่เหล็ก มุมเอียง) ตั้งได้ในแผง → สร้าง netlist ใหม่ · ปุ่มชั่วขณะ (ปรบมือ เคาะ แตะ) คืนค่าเองหลังเวลาที่ระบุ
 */
import { setPartParams } from '../editor/ops';
import type { Part, SensorPart } from '../model/types';
import { formatSI } from '../model/units';
import { fsrResistance, hallOn, magnetGauss, micPeak, mq2Ratio, reedClosed, tiltClosed, waterRatio } from '../model/sensors';
import type { App } from './app';
import { h } from './dom';

type NumField = (app: App, part: Part, key: string, label: string, unit: string, help?: string) => HTMLElement;
const help = (t: string) => h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, t);

function slider(app: App, part: SensorPart, key: string, label: string, min: number, max: number, step: number, fmt: (v: number) => string, extra: (v: number) => Record<string, unknown> = () => ({})) {
  const v = (part.params as unknown as Record<string, number>)[key];
  const out = h('output', { id: `f-${key}-out`, for: `f-${key}` }, fmt(v));
  const sl = h('input', { type: 'range', id: `f-${key}`, min: String(min), max: String(max), step: String(step), value: String(v), 'aria-label': label, style: 'width:100%' }) as HTMLInputElement;
  sl.addEventListener('input', () => { out.textContent = fmt(Number(sl.value)); });
  sl.addEventListener('change', () => {
    const q = Number(sl.value);
    const cur = app.doc.parts.find((p) => p.id === part.id)?.params as unknown as Record<string, number> | undefined;
    if (cur && q !== cur[key]) app.apply(setPartParams(app.doc, part.id, { [key]: q, ...extra(q) }), `ตั้ง${label} ${part.label} = ${fmt(q)}`, { amend: true });
  });
  return h('div', { class: 'field' }, h('label', { for: `f-${key}` }, `${label} `), out, sl);
}
function check(app: App, part: SensorPart, key: string, label: string, on: string, off: string, extra: (v: boolean) => Record<string, unknown> = () => ({})) {
  const cb = h('input', { type: 'checkbox', checked: !!(part.params as unknown as Record<string, boolean>)[key], id: `f-${key}` }) as HTMLInputElement;
  cb.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { [key]: cb.checked, ...extra(cb.checked) }), `${cb.checked ? on : off} ${part.label}`));
  return h('label', { class: 'toggle field' }, cb, label);
}
/** ปุ่มชั่วขณะ: ตั้งค่า on แล้วคืน off หลัง ms (ถ้ายังเป็นค่าที่ตั้งไว้) */
function momentary(app: App, part: SensorPart, id: string, text: string, on: Record<string, unknown>, off: Record<string, unknown>, ms: number, msg: string) {
  return h('button', { class: 'btn', id, style: 'width:100%;min-height:44px', onclick: () => {
    app.apply(setPartParams(app.doc, part.id, on), `${msg} ${part.label}`);
    setTimeout(() => {
      const cur = app.doc.parts.find((p) => p.id === part.id)?.params as unknown as Record<string, unknown> | undefined;
      if (cur && Object.entries(on).every(([k, v]) => cur[k] === v)) app.apply(setPartParams(app.doc, part.id, off), `จบ${msg} ${part.label}`);
    }, ms);
  } }, text);
}
function thresholdField(app: App, part: SensorPart, fine = false) {
  return slider(app, part, 'threshold', 'จุดตัด (ทริมพอต) — สัดส่วนของ VCC', fine ? 0.45 : 0.02, fine ? 0.6 : 0.98, fine ? 0.001 : 0.01, (v) => `${(v * 100).toFixed(fine ? 1 : 0)}% (${(v * 5).toFixed(fine ? 3 : 2)} V ที่ 5 V · ${(v * 3.3).toFixed(fine ? 3 : 2)} V ที่ 3.3 V)`);
}

export function sensorControls(app: App, part: SensorPart, numField: NumField): Node[] {
  const nodes: Node[] = [];
  switch (part.kind) {
    case 'flame': {
      const pr = part.params;
      nodes.push(check(app, part, 'flame', 'มีเปลวไฟหน้าเซนเซอร์', 'จุดไฟหน้า', 'ดับไฟหน้า'));
      nodes.push(slider(app, part, 'distance', 'ระยะเปลวไฟ', 5, 200, 1, (v) => `${v} cm → AO ≈ ${(100 / (1 + ((pr.flame ? (pr.refDistance / v) ** 2 : 0) + (pr.sunlight ? 4 : 0)))).toFixed(0)}% ของ VCC`));
      nodes.push(check(app, part, 'sunlight', 'แดดจัดส่องเซนเซอร์ (มีอินฟราเรดมาก — ของจริงตรวจผิดได้)', 'มีแดดส่อง', 'ไม่มีแดดส่อง'));
      nodes.push(thresholdField(app, part));
      nodes.push(numField(app, part, 'refDistance', 'ระยะอ้างอิง (AO = VCC/2) — ขึ้นกับขนาดเปลวไฟ', 'cm'));
      nodes.push(help('ขา VCC GND DO AO · ไม่มีไฟ: AO ≈ VCC, DO สูง · ไฟใกล้: AO ลดลง เมื่อต่ำกว่าจุดตัด DO ต่ำและ LED บนโมดูลติด · แบบจำลองเพื่อการสอน: รังสี ∝ 1/ระยะ² — ระยะอ้างอิงเป็นค่าตั้ง ไม่ใช่ค่าจากเอกสาร'));
      break;
    }
    case 'soundsensor': {
      const pr = part.params;
      nodes.push(momentary(app, part, 'f-clap', 'ปรบมือ (เสียงดัง 0.4 วินาที)', { sound: true }, { sound: false }, 400, 'ปรบมือหน้า'));
      nodes.push(check(app, part, 'sound', 'มีเสียงต่อเนื่อง', 'เปิดเสียงหน้า', 'ปิดเสียงหน้า'));
      nodes.push(slider(app, part, 'level', 'ระดับเสียงที่ไมค์', 60, 120, 1, (v) => `${v} dB SPL → ยอดคลื่น ≈ ${(micPeak({ level: v, sensitivity: pr.sensitivity }) * 1000).toFixed(1)} mV`));
      nodes.push(slider(app, part, 'frequency', 'ความถี่เสียง', 100, 2000, 50, (v) => `${v} Hz`));
      nodes.push(thresholdField(app, part, true));
      nodes.push(help('AO = ไบแอส VCC/2 + สัญญาณไมค์ (ไม่มีวงขยาย จึงมีขนาดเพียงมิลลิโวลต์) · DO ต่ำเฉพาะช่วงที่ยอดคลื่นสูงกว่าจุดตัด — กระพริบตามความถี่เสียง โค้ดควรจับขอบ (IRQ) หรืออ่านถี่ๆ แล้วนับ · ตั้งจุดตัดให้สูงกว่าไบแอสเล็กน้อย (ทริมพอตหลายรอบ) · ในแอปเสียงเป็นคลื่นไซน์ความถี่เดียว'));
      break;
    }
    case 'rainsensor': {
      nodes.push(slider(app, part, 'wet', 'ความเปียกของแผ่นตรวจ', 0, 100, 1, (v) => (v === 0 ? 'แห้ง' : `${v}%`)));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'สภาพตัวอย่าง' }, ...([[0, 'แห้ง'], [10, 'ฝนปรอย'], [60, 'ฝนตก'], [100, 'เปียกทั้งแผ่น']] as const).map(([w, t]) =>
        h('button', { class: 'chip', id: `f-rain-${w}`, 'aria-pressed': String(part.params.wet === w), onclick: () => app.apply(setPartParams(app.doc, part.id, { wet: w }), `ตั้ง${t}ที่ ${part.label}`) }, t))));
      nodes.push(thresholdField(app, part));
      nodes.push(help('ขา VCC GND DO AO ของโมดูล (แผ่นตรวจต่อด้วยสายสองเส้น ไม่มีขั้ว) · แห้ง: AO ≈ VCC DO สูง · เปียก: AO ลดลง DO ต่ำ · แบบจำลอง: แผ่นเปียกเต็ม ≈ 2 kΩ (ค่าประมาณ) · ของจริงลายทองแดงกัดกร่อนเมื่อจ่ายไฟตลอด'));
      break;
    }
    case 'mq2': {
      const pr = part.params;
      const gs = h('select', { id: 'f-gas' }, ...([['lpg', 'LPG (แก๊สหุงต้ม)'], ['smoke', 'ควัน'], ['co', 'คาร์บอนมอนอกไซด์ CO']] as const).map(([v, t]) => h('option', { value: v, selected: pr.gas === v }, t)));
      gs.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { gas: gs.value }), `ตั้งชนิดแก๊สที่ ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-gas' }, 'ชนิดแก๊สในอากาศ'), h('div', { class: 'row' }, gs)));
      nodes.push(slider(app, part, 'ppm', 'ความเข้มข้น', 0, 10000, 50, (v) => (v === 0 ? 'อากาศสะอาด (Rs/Ro = 9.83)' : `${v} ppm (Rs/Ro = ${mq2Ratio(pr.gas, v).toFixed(2)})`)));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ความเข้มข้นตัวอย่าง' }, ...([[0, 'อากาศสะอาด'], [500, '500 ppm'], [2000, '2,000 ppm'], [8000, '8,000 ppm']] as const).map(([v, t]) =>
        h('button', { class: 'chip', id: `f-ppm-${v}`, 'aria-pressed': String(pr.ppm === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { ppm: v }), `ตั้งแก๊ส ${t} ที่ ${part.label}`) }, t))));
      nodes.push(thresholdField(app, part));
      nodes.push(numField(app, part, 'ro', 'Ro (ความต้านทานตัวรับรู้ในอากาศสะอาด ÷ 9.83)', 'Ω'));
      nodes.push(help('ใช้ไฟ 5 V (ฮีตเตอร์ ≈ 170 mA — ต่อกับ 5V/VBUS ไม่ใช่ 3V3) · AO = VCC·RL/(RL + Rs) สูงขึ้นตามแก๊ส · DO ต่ำเมื่อ AO เกินจุดตัด — DO ถูกดึงขึ้นถึง 5 V ห้ามต่อตรงกับขา 3.3 V · ของจริงต้องอุ่นเครื่องและปรับเทียบ Ro (แอปไม่จำลองการอุ่นเครื่อง)'));
      break;
    }
    case 'linetrack': {
      const pr = part.params;
      const sf = h('select', { id: 'f-surface' }, ...([['white', 'พื้นขาว (สะท้อนมาก)'], ['black', 'เส้นดำ (ดูดกลืน)'], ['none', 'ยกขึ้น ไม่มีพื้น']] as const).map(([v, t]) => h('option', { value: v, selected: pr.surface === v }, t)));
      sf.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { surface: sf.value }), `ตั้งพื้นใต้ ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-surface' }, 'พื้นใต้เซนเซอร์'), h('div', { class: 'row' }, sf)));
      nodes.push(slider(app, part, 'height', 'ความสูงจากพื้น', 0.5, 20, 0.5, (v) => `${v} mm${v > 8 ? ' (เกินระยะใช้งาน 1–8 mm)' : ''}`));
      nodes.push(thresholdField(app, part));
      nodes.push(help('ขา VCC GND DO AO · ผิวขาว: แสงสะท้อนมาก AO ต่ำ DO ต่ำ LED ติด · เส้นดำ: DO สูง · ระยะใช้งาน 1–8 mm (โฟกัส 2.5 mm) · แบบจำลองเพื่อการสอน: ค่าการสะท้อน ขาว 0.9 ดำ 0.05'));
      break;
    }
    case 'vibsensor':
      nodes.push(momentary(app, part, 'f-knock', 'เคาะโต๊ะ (สั่น 0.5 วินาที)', { vibrating: true }, { vibrating: false }, 500, 'เคาะ'));
      nodes.push(check(app, part, 'vibrating', 'กำลังสั่นต่อเนื่อง', 'เริ่มสั่น', 'หยุดสั่น'));
      nodes.push(thresholdField(app, part));
      nodes.push(help('ขา VCC GND DO · SW-420 ปกติปิด: นิ่ง = DO ต่ำ (LED ติด) · สั่น = DO สูง · แบบจำลอง: ขณะสั่นหน้าสัมผัสเปิดค้าง (ของจริงเป็นพัลส์สั้นหลายครั้ง)'));
      break;
    case 'touch': {
      const pr = part.params;
      const tap = h('button', { class: 'btn', id: 'f-tap', style: 'width:100%;min-height:44px', onclick: () => {
        const cur = app.doc.parts.find((p) => p.id === part.id);
        if (cur?.kind !== 'touch') return;
        app.apply(setPartParams(app.doc, part.id, { touched: true, ...(cur.params.toggleMode ? { toggled: !cur.params.toggled } : {}) }), `แตะ ${part.label}`);
        setTimeout(() => { const c2 = app.doc.parts.find((p) => p.id === part.id); if (c2?.kind === 'touch' && c2.params.touched) app.apply(setPartParams(app.doc, part.id, { touched: false }), `ปล่อยนิ้วจาก ${part.label}`); }, 400);
      } }, 'แตะหนึ่งครั้ง (0.4 วินาที)');
      nodes.push(h('div', { class: 'field' }, tap));
      nodes.push(check(app, part, 'touched', 'แตะค้างไว้', 'แตะค้าง', 'ปล่อยนิ้วจาก', (v) => (v && pr.toggleMode ? { toggled: !pr.toggled } : {})));
      nodes.push(check(app, part, 'activeLow', 'จัมเปอร์ "ขาออก active-low" (แตะแล้วขาออกต่ำ)', 'บัดกรีจัมเปอร์ active-low ที่', 'ถอดจัมเปอร์ active-low ที่'));
      nodes.push(check(app, part, 'toggleMode', 'จัมเปอร์ "โหมดสลับ" (แตะหนึ่งครั้ง สถานะค้างจนแตะครั้งถัดไป)', 'บัดกรีจัมเปอร์โหมดสลับที่', 'ถอดจัมเปอร์โหมดสลับที่', () => ({ toggled: false })));
      nodes.push(help('ขา GND VCC I/O (2.0–5.5 V) · ขาออก CMOS ระดับเท่าไฟเลี้ยง — ต่อกับ Pico ใช้ไฟ 3V3 · ไม่ต้องมีตัวต้านทานดึงขึ้น/ลง · ตัวอักษร A/B ของจัมเปอร์ต่างกันตามผู้ผลิต ดูเอกสารของแผ่นที่ใช้ · ของจริงตอบสนองช้า ≈ 60–220 ms และปรับเทียบตัวเองตอนจ่ายไฟ (อย่าแตะขณะเสียบไฟ)'));
      break;
    }
    case 'hall': {
      const pr = part.params;
      const upd = (q: Record<string, unknown>) => { const np = { ...pr, ...q } as typeof pr; return { ...q, on: hallOn(np) }; };
      nodes.push(check(app, part, 'magnet', 'มีแม่เหล็ก Ø10 × 3 mm หน้าเซนเซอร์', 'วางแม่เหล็กหน้า', 'เอาแม่เหล็กออกจาก', (v) => upd({ magnet: v })));
      nodes.push(slider(app, part, 'distance', 'ระยะแม่เหล็กถึงหน้าเซนเซอร์', 0, 40, 0.5, (v) => `${v} mm → ${magnetGauss(v, pr.pole).toFixed(0)} G`, (v) => upd({ distance: v })));
      const pl = h('select', { id: 'f-pole' }, h('option', { value: 'S', selected: pr.pole === 'S' }, 'ขั้วใต้ (S) หันเข้าหน้ามีตัวอักษร'), h('option', { value: 'N', selected: pr.pole === 'N' }, 'ขั้วเหนือ (N) หันเข้า'));
      pl.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, upd({ pole: pl.value })), `กลับขั้วแม่เหล็กหน้า ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-pole' }, 'ขั้วแม่เหล็ก'), h('div', { class: 'row' }, pl)));
      nodes.push(numField(app, part, 'bop', 'จุดทำงาน BOP (เอกสาร 70–350)', 'G'), numField(app, part, 'brp', 'จุดปล่อย BRP (เอกสาร 50–330)', 'G'));
      nodes.push(help('มองด้านมีตัวอักษร ขาลง: 1 VCC (4.5–24 V) · 2 GND · 3 OUT · ขาออก open-collector: ต่อตัวต้านทานดึงขึ้น 10 kΩ ไป 3.3 V/5 V หรือใช้ Pin.PULL_UP / INPUT_PULLUP · ขั้วใต้ใกล้พอ → OUT ต่ำ · ห่างจนสนาม < BRP → ปล่อย (ระหว่างนั้นคงสถานะเดิม)'));
      break;
    }
    case 'reed': {
      const pr = part.params;
      const upd = (q: Record<string, unknown>) => { const np = { ...pr, ...q } as typeof pr; return { ...q, closed: reedClosed(np) }; };
      nodes.push(check(app, part, 'magnet', 'มีแม่เหล็กใกล้หลอด (เช่น แม่เหล็กติดบานประตู)', 'วางแม่เหล็กใกล้', 'เอาแม่เหล็กออกจาก', (v) => upd({ magnet: v })));
      nodes.push(slider(app, part, 'distance', 'ระยะแม่เหล็ก', 0, 40, 0.5, (v) => `${v} mm`, (v) => upd({ distance: v })));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ประตู' },
        h('button', { class: 'chip', id: 'f-door-close', onclick: () => app.apply(setPartParams(app.doc, part.id, upd({ magnet: true, distance: 3 })), `ปิดประตู (แม่เหล็กชิด ${part.label})`) }, 'ปิดประตู (3 mm)'),
        h('button', { class: 'chip', id: 'f-door-open', onclick: () => app.apply(setPartParams(app.doc, part.id, upd({ magnet: true, distance: 40 })), `เปิดประตู (แม่เหล็กห่าง ${part.label})`) }, 'เปิดประตู (40 mm)')));
      nodes.push(numField(app, part, 'operate', 'ระยะทำงาน (ต่อกันเมื่อใกล้กว่านี้)', 'mm'), numField(app, part, 'release', 'ระยะปล่อย (เปิดเมื่อห่างกว่านี้)', 'mm'));
      nodes.push(help('สวิตช์ 2 ขา ไม่มีขั้ว ปกติเปิด · ใช้แบบสวิตช์ปุ่มกด: ขาหนึ่งเข้าขา GPIO (PULL_UP) อีกขาลง GND → ปิดประตู = อ่านได้ 0 · ระยะทำงาน/ปล่อยขึ้นกับแม่เหล็ก ค่าเริ่มต้นเป็นค่าตั้งเพื่อการสอน'));
      break;
    }
    case 'tilt': {
      nodes.push(slider(app, part, 'angle', 'มุมเอียงจากแนวตั้ง (ขาชี้ลง = 0°)', 0, 180, 5, (v) => `${v}° → ${tiltClosed({ angle: v, onAngle: part.params.onAngle }) ? 'ต่อกัน' : 'เปิด'}`));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ท่าทาง' }, ...([[0, 'ตั้งตรง'], [60, 'เอียง 60°'], [90, 'ตะแคง'], [180, 'คว่ำ']] as const).map(([a, t]) =>
        h('button', { class: 'chip', id: `f-tilt-${a}`, 'aria-pressed': String(part.params.angle === a), onclick: () => app.apply(setPartParams(app.doc, part.id, { angle: a }), `${t} ${part.label}`) }, t))));
      nodes.push(help('2 ขา ไม่มีขั้ว · ตั้งตรง (ขาชี้ลง) ลูกบอลแตะสองขา = ต่อกัน · เอียงเกิน ≈ 45° หรือคว่ำ = เปิด · ต่อแบบสวิตช์: ขา GPIO (PULL_UP) + GND · ของจริงหน้าสัมผัสเด้ง ควรหน่วงเวลาในโค้ด'));
      break;
    }
    case 'waterlevel': {
      const pr = part.params;
      nodes.push(slider(app, part, 'level', 'ความลึกที่จุ่มน้ำ (สัดส่วนของลายทองแดง 40 mm)', 0, 100, 1, (v) => `${v}% (${(v * 0.4).toFixed(0)} mm) → S ≈ ${(waterRatio({ level: v, fullRatio: pr.fullRatio }) * 100).toFixed(0)}% ของ VCC`));
      nodes.push(help('ขา S + − · แห้ง S ≈ 0 · จุ่มลึกขึ้น S สูงขึ้น จุ่มเต็ม ≈ ครึ่งหนึ่งของไฟเลี้ยง · ค่าขึ้นกับน้ำ (ประปา/น้ำฝน/น้ำเกลือ) ต้องปรับเทียบในน้ำจริง · ต่อ + กับขาดิจิทัลแล้วจ่ายไฟเฉพาะตอนอ่าน ลดการกัดกร่อน'));
      break;
    }
    case 'fsr': {
      nodes.push(slider(app, part, 'force', 'แรงกดบนแผ่น', 0, 100, 0.1, (v) => (v < 0.1 ? 'ไม่กด (เปิดวงจร)' : `${v} N (≈ ${(v / 9.81 * 1000).toFixed(0)} g) → ${formatSI(fsrResistance(v), 'Ω', 3)}`)));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'แรงกดตัวอย่าง' }, ...([[0, 'ไม่กด'], [1, 'แตะเบา 1 N'], [10, 'กดนิ้ว 10 N'], [50, 'กดแรง 50 N']] as const).map(([f, t]) =>
        h('button', { class: 'chip', id: `f-force-${f}`, 'aria-pressed': String(part.params.force === f), onclick: () => app.apply(setPartParams(app.doc, part.id, { force: f }), `${t} ที่ ${part.label}`) }, t))));
      nodes.push(help('2 ขา ไม่มีขั้ว · ต่อเป็นตัวแบ่งแรงดัน: VCC → FSR → ขา ADC → 10 kΩ → GND (กดแรงขึ้น แรงดันสูงขึ้น) · ค่า R จากตารางค่าทั่วไป (0.2 N 30 kΩ, 1 N 6 kΩ, 10 N 1 kΩ, 100 N 250 Ω)'));
      break;
    }
  }
  return nodes;
}

/** แถว "ค่าจากการจำลอง" */
export function sensorReadingRows(part: SensorPart, x: Record<string, number>): Array<[string, string]> {
  const V = (v: number) => formatSI(v, 'V', 3);
  const lm = (): Array<[string, string]> => [['ไฟเลี้ยง VCC', V(x.vcc)], ['ขา DO', !x.powered ? 'ไม่มีไฟเลี้ยง' : `${V(x.vdo)} (${x.low ? 'ต่ำ — LED ติด' : 'สูง'})`], ['จุดตัด (ทริมพอต)', V(x.vth)]];
  switch (part.kind) {
    case 'flame': return [...lm(), ['ขา AO', V(x.vao)], ['ความเข้มรังสี (สัมพัทธ์)', x.irr.toFixed(2)]];
    case 'soundsensor': return [...lm(), ['ขา AO ขณะนี้', V(x.vao)], ['ยอดคลื่นจากไมค์', x.peak > 0 ? formatSI(x.peak, 'V', 3) : 'เงียบ']];
    case 'rainsensor': return [...lm(), ['ขา AO', V(x.vao)], ['ความต้านทานแผ่นตรวจ', x.rs >= 1e8 ? 'เปิดวงจร (แห้ง)' : formatSI(x.rs, 'Ω', 3)]];
    case 'mq2': return [...lm(), ['ขา AO', V(x.vao)], ['Rs / Rs÷Ro', `${formatSI(x.rs, 'Ω', 3)} / ${x.ratio.toFixed(2)}`], ['กระแสฮีตเตอร์', formatSI(x.heater, 'A', 3)]];
    case 'linetrack': return [...lm(), ['ขา AO', V(x.vao)], ['กระแส LED อินฟราเรด', formatSI(x.ledIr, 'A', 3)]];
    case 'vibsensor': return lm();
    case 'touch': return [['ไฟเลี้ยง VCC', V(x.vcc)], ['ขา I/O', `${V(x.vout)} (${x.high ? 'สูง' : 'ต่ำ'})`], ['สถานะ', x.active ? 'กำลังแตะ/สลับเปิด' : 'ไม่แตะ']];
    case 'hall': return [['ไฟเลี้ยง VCC', V(x.vcc)], ['สนามแม่เหล็ก', `${x.gauss.toFixed(0)} G`], ['ขา OUT', `${V(x.vout)} (${x.sinking ? 'นำลงกราวด์' : x.on ? 'สนามถึงแต่ไฟเลี้ยงไม่พอ' : 'ปล่อย'})`]];
    case 'reed': return [['หน้าสัมผัส', x.closed ? 'ต่อกัน' : 'เปิด'], ['แม่เหล็ก', x.magnet ? `${x.distance} mm` : 'ไม่มี']];
    case 'tilt': return [['หน้าสัมผัส', x.closed ? 'ต่อกัน' : 'เปิด'], ['มุมเอียง', `${x.angle}°`]];
    case 'waterlevel': return [['ไฟเลี้ยง', V(x.vcc)], ['ขา S', V(x.vs)], ['ระดับน้ำที่ตั้ง', `${x.level}%`]];
    case 'fsr': return [['แรงกด', x.force < 0.1 ? 'ไม่กด' : `${x.force} N`], ['ความต้านทาน', x.r >= 1e8 ? 'เปิดวงจร' : formatSI(x.r, 'Ω', 3)]];
  }
}
