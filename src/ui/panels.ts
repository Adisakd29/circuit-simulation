import { describeNet, netLinked, netOfPin, netOfTerminal, terminalLabel } from '../connectivity/connectivity';
import { SCHEMATICS } from '../lessons/schematics';
import { schematicSvg } from '../lessons/schematic';
import { WIRE_COLORS, clearProbes, setPartLabel, setBoardModel, setPartParams, setProbe, updateWire } from '../editor/ops';
import { LESSONS, lessonById, type Lesson, type LessonTableRow } from '../lessons/lessons';
import { measuredTau } from '../lessons/checks';
import { potCode as potCodeText } from '../render/board-parts';
import { DMM_MODES, VOM_POSITIONS, vomPosition, type VomPosition, PC817_CTR, pc817TypCtr, HC595_OUTS, HC595_PINOUT, DIST_PRESETS, sonarEchoWidth, SONAR_MAX_CM, L293D_CHANNELS, L293D_PINOUT, TEMP_PRESETS, lm35Vout, CD4017_OUTS, CD4017_PINOUT, VREG_MODELS, vregParamsFor, transformerModel, LOGIC_FUNC, LOGIC_MODELS, LOGIC_PINOUT, logicGates, CATALOG, CATEGORIES, C_QUICK, DIODE_NAMES, MOSFET_NAMES, mosfetParamsFor, PICO_GPIO, E12_QUICK, L_QUICK, POT_VALUES, buzzerParamsFor, LUX_PRESETS, ldrResistance, ntcResistance, sevenSegParamsFor, SEG_NAMES, LED_NAMES, bjtParamsFor, catalogEntry, diodeParamsFor, ledParamsFor, opampParamsFor, pinDefs } from '../model/catalog';
import { BOARD_MODELS, BOARD_SPECS, boardSpec, groupLabel, holeInfo, holeLabel } from '../model/breadboard';
import { pinHolesFor } from '../model/geometry';
import { PARAM_LIMITS } from '../model/schema';
import type { DiodeModel, LedColor, Lm317Part, Part } from '../model/types';
import { formatSI, parseSI } from '../model/units';
import { MEASUREMENT_TOLERANCE } from '../instruments/measure';
import { dmmDisplay, fmtOhm, vomReadout } from '../instruments/meters';
import type { App } from './app';
import { $, h, svg } from './dom';
import { icon } from './icons';
import { fmtTime } from './chart';
import { measureBode } from '../instruments/bode';

/* ======================= คลังอุปกรณ์ ======================= */

export function renderLibrary(app: App) {
  const body = $('lib-body');
  const q = app.libQuery.trim().toLowerCase();
  let input = body.querySelector<HTMLInputElement>('#lib-search');
  if (!input) {
    input = h('input', { id: 'lib-search', type: 'search', placeholder: 'ค้นหาอุปกรณ์ เช่น LED, resistor', 'aria-label': 'ค้นหาอุปกรณ์' });
    input.addEventListener('input', () => { app.libQuery = input!.value; renderLibrary(app); });
    body.replaceChildren(h('div', { class: 'search' }, svg(icon('search')), input), h('div', { id: 'lib-list' }));
  }
  const list = $('lib-list');
  const match = (c: (typeof CATALOG)[number]) => !q || [c.name, c.nameEn, ...c.keywords].some((s) => s.toLowerCase().includes(q));
  const groups = Object.entries(CATEGORIES).map(([cat, label]) => {
    const items = CATALOG.filter((c) => c.category === cat && match(c));
    if (!items.length) return null;
    return h('div', { class: 'cat' },
      h('div', { class: 'cat-h' }, label),
      ...items.map((c) => {
        const active = app.tool.t === 'place' && app.tool.kind === c.kind;
        const btn = h('button', {
          class: 'lib-item', disabled: !c.supported, 'aria-pressed': String(active), 'data-kind': c.kind,
          title: c.supported ? `${c.description}\nลากมาวางในพื้นที่ทำงาน หรือแตะแล้วแตะตำแหน่งที่จะวาง` : c.description,
          onclick: () => {
            if (!c.supported) return;
            if (app.consumeLibClick()) return; // เพิ่งลากวางเสร็จ — ไม่ใช่การแตะเลือก
            if (!app.has3d) { app.status(app.no3dReason('วางอุปกรณ์'), 'err'); return; }
            app.setTool(active ? { t: 'select' } : { t: 'place', kind: c.kind as Part['kind'] });
            app.closeDrawers();
          },
        },
        h('span', { class: 'ic' }, svg(icon(c.supported ? c.kind : 'future'))),
        h('span', {},
          h('div', { class: 'nm' }, c.name, !c.supported ? h('span', { class: 'tag' }, 'ยังไม่รองรับ') : null),
          h('div', { class: 'en' }, c.supported ? `${c.nameEn} · ${c.mount === 'board' ? 'เสียบบอร์ดหรือวางบนโต๊ะ' : 'วางบนโต๊ะ'}` : c.description)));
        if (c.supported) btn.addEventListener('pointerdown', (e) => app.libPointerDown(e, c.kind as Part['kind'], btn));
        btn.addEventListener('contextmenu', (e) => e.preventDefault()); // แตะค้างบนมือถือ = เริ่มลาก ไม่ใช่เมนูของเบราว์เซอร์
        return btn;
      }));
  }).filter(Boolean) as HTMLElement[];
  list.replaceChildren(
    ...(groups.length ? groups : [h('p', { class: 'empty' }, `ไม่พบอุปกรณ์ที่ตรงกับ "${app.libQuery}"`)]),
    h('div', { class: 'note' }, app.has3d
      ? 'ลากอุปกรณ์มาวางบนเบรดบอร์ด (ขาจะเสียบรูเมื่อตรงรูเท่านั้น) หรือวางบนพื้นโต๊ะนอกบอร์ดแล้วต่อสายเข้าขา · หน้าจอสัมผัส: แตะค้างแล้วลาก หรือแตะเลือกแล้วแตะตำแหน่ง'
      : 'พื้นที่ 3 มิติใช้งานไม่ได้ในเบราว์เซอร์นี้ จึงวางอุปกรณ์ไม่ได้ — ดูรายการอุปกรณ์ เปิดแลป เปิดไฟล์ และจำลองวงจรที่มีอยู่ได้'),
  );
}

/* ======================= คุณสมบัติ ======================= */

let lastPropsKey = '';
let lastPropsDoc: unknown = null;

let propsRendering = false;

export function renderProps(app: App) {
  // การแทนที่แผงทำให้ช่องที่โฟกัสอยู่ blur → อาจเรียก renderProps ซ้อน: เลื่อนไปทำหลังรอบนี้
  if (propsRendering) { queueMicrotask(() => renderProps(app)); return; }
  propsRendering = true;
  try { renderPropsInner(app); } finally { propsRendering = false; }
}

function renderPropsInner(app: App) {
  const el = $('props');
  const key = JSON.stringify(app.selection) + '|' + app.tool.t;
  const sameDoc = lastPropsDoc === app.doc && lastPropsKey === key;
  if ((sameDoc || app.sliderGesture) && el.firstChild) { updateReadings(app); return; }
  lastPropsKey = key;
  lastPropsDoc = app.doc;
  const s = app.selection;
  $('right-title').textContent = s?.t === 'wire' ? 'สาย Jumper' : s?.t === 'terminal' ? 'จุดต่อ' : s?.t === 'board' ? 'เบรดบอร์ด' : 'คุณสมบัติ';
  if (s?.t === 'board') {
    const b = app.doc.breadboards.find((x) => x.id === s.id);
    if (b) {
      const onBoard = app.doc.parts.filter((p) => p.placement.kind === 'board' && p.placement.boardId === b.id).length;
      const holeWires = app.doc.wires.filter((w) => [w.a, w.b].some((t) => t.kind === 'hole' && t.boardId === b.id)).length;
      const sp = boardSpec(b.model);
      el.replaceChildren(
        h('div', { class: 'field' }, h('label', {}, 'รุ่นเบรดบอร์ด'),
          h('div', { class: 'chips', role: 'group', 'aria-label': 'รุ่นเบรดบอร์ด' }, ...BOARD_MODELS.map((m) => h('button', {
            class: 'chip', id: `f-board-${m}`, 'aria-pressed': String(b.model === m),
            onclick: () => { if (app.apply(setBoardModel(app.doc, b.id, m), `เปลี่ยนเบรดบอร์ดเป็น ${m}`) && app.has3d) app.view.resetView(); },
          }, `${BOARD_SPECS[m].name} · ${BOARD_SPECS[m].mm.w} × ${BOARD_SPECS[m].mm.h} mm`)))),
        h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'เปลี่ยนรุ่นได้ตลอด: ชื่อรู a1–j30 และรางไฟเหมือนเดิมทั้งสองรุ่น อุปกรณ์และสายที่เสียบอยู่ไม่ต้องย้าย · MB-102 รางไฟต่อเนื่องตลอดความยาว (บอร์ดบางยี่ห้อแบ่งรางเป็นสองช่วง — ตรวจด้วยมัลติมิเตอร์ก่อนใช้)'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'รุ่น'), h('dd', {}, `${b.model} (${sp.cols} คอลัมน์ · ${sp.tie} จุด · ราง ± 4 เส้น)`),
          h('dt', {}, 'ตำแหน่งบนโต๊ะ'), h('dd', {}, `x ${b.x}, z ${b.z} (หน่วย 2.54 mm)`),
          h('dt', {}, 'อุปกรณ์ที่เสียบ'), h('dd', {}, `${onBoard} ชิ้น`),
          h('dt', {}, 'สายที่เสียบรู'), h('dd', {}, `${holeWires} เส้น`)),
        h('p', { class: 'help' }, app.has3d ? 'ลากบอร์ดเพื่อย้ายทั้งแผ่น — อุปกรณ์และสายที่เสียบอยู่จะย้ายตาม การเชื่อมต่อไม่เปลี่ยน' : 'ย้ายบอร์ดได้เมื่อพื้นที่ 3 มิติทำงาน'));
      return;
    }
  }
  if (s?.t === 'part') {
    const part = app.doc.parts.find((p) => p.id === s.id);
    if (part) { el.replaceChildren(...partProps(app, part)); updateReadings(app); return; }
  }
  if (s?.t === 'wire') {
    const w = app.doc.wires.find((x) => x.id === s.id);
    if (w) { el.replaceChildren(...wireProps(app, w.id)); return; }
  }
  if (s?.t === 'terminal') { el.replaceChildren(...terminalProps(app)); return; }
  el.replaceChildren(...emptyProps(app));
}

function emptyProps(app: App): Node[] {
  const empty = !app.doc.parts.length;
  return [
    h('div', { class: 'empty' },
      empty ? h('p', {}, 'เริ่มต่อวงจรแรก:') : h('p', {}, 'แตะอุปกรณ์ สาย หรือรูบนบอร์ดเพื่อดูรายละเอียด รูที่เชื่อมถึงกันจะเรืองแสง'),
      empty ? h('ol', {},
        h('li', {}, 'ลาก "แหล่งจ่ายไฟ DC" จากคลังอุปกรณ์มาวางบนพื้นโต๊ะข้างบอร์ด (หรือแตะเลือกแล้วแตะตำแหน่ง)'),
        h('li', {}, 'ลาก "ตัวต้านทาน" มาวางบนรูบนบอร์ด — ขาจะเสียบรูเมื่อตรงรูเท่านั้น หรือวางบนโต๊ะแล้วต่อสายเข้าขาก็ได้'),
        h('li', {}, 'ใช้เครื่องมือต่อสาย แตะขั้ว + แล้วแตะขาตัวต้านทาน ทำซ้ำกับขั้ว −'),
        h('li', {}, 'กด Run แล้ววางโพรบแดง/ดำคร่อมตัวต้านทานเพื่อวัดแรงดัน'),
      ) : null),
    h('details', {},
      h('summary', {}, 'แบบจำลอง หน่วย และข้อจำกัด'),
      h('ul', { class: 'model-list' },
        h('li', {}, 'วิเคราะห์ DC operating point ด้วย Nodal Analysis + Newton–Raphson ใน Web Worker คำนวณใหม่เมื่อวงจรเปลี่ยน (ตรวจทุก 50 ms) แยกจากการวาดภาพ'),
        h('li', {}, 'ตัวต้านทาน/สวิตช์/แอมมิเตอร์: เชิงเส้นตามกฎของโอห์ม สาย jumper ความต้านทาน 0 Ω'),
        h('li', {}, 'แหล่งจ่าย: CV = V อนุกรม Rint, CC = จำกัดกระแสที่ Ilim (จำกัดได้ทั้งสองทิศ)'),
        h('li', {}, 'LED: ไดโอด Shockley + Rs ไม่จำลองการพังทลายย้อนกลับ ความสว่างเป็นค่าประมาณจากกระแส'),
        h('li', {}, 'วงจรที่มีตัวเก็บประจุ/ตัวเหนี่ยวนำ: จำลองตามเวลาด้วย trapezoidal (ก้าวแรกหลังเริ่ม/แก้วงจรใช้ backward Euler) ก้าวเวลาปรับอัตโนมัติ คลาดเคลื่อนจากคำตอบเชิงวิเคราะห์ของ RC/RL ต่ำกว่า 0.1%'),
        h('li', {}, 'โพรบวัดแรงดันมีความต้านทานเข้าเป็นอนันต์ (ไม่โหลดวงจร)'),
        h('li', {}, `ความคลาดเคลื่อนของ solver เทียบคำตอบเชิงวิเคราะห์ ≤ ${MEASUREMENT_TOLERANCE.solverRelative * 100}% · เกณฑ์ตรวจแลป ±${MEASUREMENT_TOLERANCE.lessonRelative * 100}%`),
        h('li', {}, 'จุดอ้างอิงภายใน solver เลือกเองในแต่ละวงจรย่อย ไม่ผูกกับขั้วลบแหล่งจ่าย — ค่าที่แสดงคือผลต่างแรงดันระหว่างสองจุดเท่านั้น'),
        h('li', {}, 'การแจ้งเกินพิกัด/ความเสียหายเป็นแบบจำลองเพื่อการสอน ไม่ใช่การรับรองความปลอดภัยของวงจรจริง'),
      )),
    h('details', {},
      h('summary', {}, 'การใช้งานเมาส์ / หน้าจอสัมผัส'),
      h('ul', { class: 'model-list' },
        h('li', {}, 'ลากพื้นที่ว่าง: หมุนกล้อง (มุมมองบน: เลื่อน) · คลิกขวา/สองนิ้ว: เลื่อน · ล้อเมาส์/บีบนิ้ว: ซูม · เครื่องมือ "กล้อง": ลากที่ใดก็หมุนกล้อง ไม่ย้ายอุปกรณ์'),
        h('li', {}, 'เมาส์: ลากอุปกรณ์เพื่อย้าย (ย้ายเข้า/ออกบอร์ดได้) · หน้าจอสัมผัส: แตะเลือกอุปกรณ์ก่อน แล้วลากด้วยนิ้วเดียว · สองนิ้ว: ซูม/เลื่อนกล้องเสมอ'),
        h('li', {}, 'คลังอุปกรณ์: ลากมาวาง (หน้าจอสัมผัส: แตะค้างแล้วลาก) หรือแตะเลือกแล้วแตะตำแหน่ง · Esc หรือปล่อยนอกพื้นที่ทำงานเพื่อยกเลิก'),
        h('li', {}, 'ย้ายเบรดบอร์ด: แตะขอบบอร์ดเพื่อเลือก (หรือแตะรูแล้วกด "เลือกเบรดบอร์ดทั้งแผ่น") แล้วลาก'),
        h('li', {}, 'ต่อสาย: เลือกเครื่องมือต่อสาย แตะขา/รูต้นทาง แล้วแตะปลายทาง'),
        h('li', {}, 'คีย์ลัด: R หมุน · Delete ลบ · Ctrl+D คัดลอก · Ctrl+Z / Ctrl+Y · W ต่อสาย · V เลือก · Esc ยกเลิก'),
      )),
  ];
}

function numField(app: App, part: Part, key: string, label: string, unit: string, help?: string): HTMLElement {
  const params = part.params as unknown as Record<string, number>;
  const lim = (PARAM_LIMITS as Record<string, readonly [number, number]>)[key];
  const input = h('input', { type: 'text', inputmode: 'decimal', value: fmtInput(params[key]), 'aria-label': label, id: `f-${key}` });
  const commit = () => {
    const v = parseSI(input.value);
    if (v === null || (lim && (v < lim[0] || v > lim[1]))) {
      input.classList.add('invalid');
      app.status(`${label}: ต้องเป็นตัวเลข${lim ? ` ช่วง ${formatSI(lim[0], unit)} – ${formatSI(lim[1], unit)}` : ''} (ใช้ k, M, m ได้ เช่น 4.7k)`, 'err');
      return;
    }
    input.classList.remove('invalid');
    // เทียบกับค่าปัจจุบันใน doc (ไม่ใช่ค่าตอนสร้างช่อง) — กันการบันทึกซ้ำเมื่อ blur หลังกด Enter
    const cur = app.doc.parts.find((p) => p.id === part.id)?.params as unknown as Record<string, number> | undefined;
    if (cur && v !== cur[key]) app.apply(setPartParams(app.doc, part.id, { [key]: v }), `ตั้ง ${label} ของ ${part.label} = ${formatSI(v, unit)}`);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  return h('div', { class: 'field' },
    h('label', { for: `f-${key}` }, label),
    h('div', { class: 'row' }, input, h('span', { class: 'unit' }, unit)),
    help ? h('div', { class: 'help' }, help) : null);
}

function spanField(app: App, part: Part): HTMLElement {
  const cur = (part.params as { span: number }).span;
  const span = h('select', { id: 'f-span', 'aria-label': 'ระยะขา' }, ...[1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n), selected: n === cur }, `${n} ช่อง`)));
  span.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { span: Number(span.value) }), `เปลี่ยนระยะขา ${part.label}`));
  return h('div', { class: 'field' }, h('label', { for: 'f-span' }, 'ระยะห่างขา (บนบอร์ด)'), h('div', { class: 'row' }, span));
}

function fmtInput(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 0.01 && a >= 1e-12) {
    // ค่าเล็กแสดงด้วยตัวคูณ SI ที่พิมพ์กลับได้ เช่น 100u, 4.7n
    for (const [scale, p] of [[1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p']] as const) {
      if (a >= scale * 0.9995) return `${Number((v / scale).toPrecision(6))}${p}`;
    }
  }
  if (a < 1e-6 || a >= 1e7) return v.toExponential(3);
  return String(Number(v.toPrecision(6)));
}

function partProps(app: App, part: Part): Node[] {
  const e = catalogEntry(part.kind)!;
  const nodes: Node[] = [];
  const labelIn = h('input', { type: 'text', value: part.label, 'aria-label': 'ชื่ออุปกรณ์', id: 'f-label', maxlength: '12' });
  labelIn.addEventListener('change', () => app.apply(setPartLabel(app.doc, part.id, labelIn.value), `เปลี่ยนชื่อเป็น ${labelIn.value}`));
  nodes.push(h('div', { class: 'part-head' }, h('span', { class: 'ic' }, svg(icon(part.kind))), h('div', {}, h('div', { style: 'font-weight:600' }, e.name), h('div', { class: 'sub' }, `${e.nameEn} · id ${part.id}`))));
  nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-label' }, 'ชื่อ (label)'), h('div', { class: 'row' }, labelIn)));

  switch (part.kind) {
    case 'dcsupply': {
      const on = h('input', { type: 'checkbox', checked: part.params.outputOn, id: 'f-on' });
      on.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { outputOn: on.checked }), `${on.checked ? 'เปิด' : 'ปิด'}เอาต์พุต ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, on, 'เปิดเอาต์พุต (Output ON)'));
      nodes.push(numField(app, part, 'voltage', 'แรงดันตั้ง (V set)', 'V', 'ช่วง 0–30 V'));
      nodes.push(numField(app, part, 'currentLimit', 'ขีดจำกัดกระแส (I limit)', 'A', 'เกินค่านี้แหล่งจ่ายเข้าโหมด CC และแรงดันขั้วลดลง'));
      nodes.push(h('details', {}, h('summary', {}, 'พารามิเตอร์แบบจำลอง'), numField(app, part, 'internalResistance', 'ความต้านทานภายใน (Rint) ในโหมด CV', 'Ω')));
      break;
    }
    case 'motor': {
      nodes.push(numField(app, part, 'loadTorque', 'แรงบิดโหลดที่แกนออก (0 = ไม่มีโหลด, หยุดค้าง ≈ 0.08 N·m ที่ 6 V)', 'N·m'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'สายแดง (A) บวกกว่าสายดำ (B) = หมุนเดินหน้า · 3–6 V: 6 V ไม่มีโหลด ≈ 250 rpm 0.16 A, เริ่มหมุน/หยุดค้าง ≈ 1.5 A · ต้องขับผ่านมอสเฟต/ทรานซิสเตอร์และมีไดโอดกันย้อนคร่อมมอเตอร์ — ห้ามต่อขา GPIO ตรง · จานสีแดง-ขาวบนแกนออกหมุนตามการจำลอง'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าวัดของ Adafruit #3777)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ขดลวด R + L อนุกรมแรงเคลื่อนไฟฟ้าย้อนกลับ E = ke·ω · J·dω/dt = ke·i − แรงเสียดทาน (จากกระแสไม่มีโหลด) − หนืด − โหลด · R, ke, แรงเสียดทาน fit จากค่าวัด (ไม่มีโหลด 6 V 250 rpm 0.16 A, 3 V 120 rpm 0.15 A, หยุดค้าง 6 V 1.5 A) · L, ความเฉื่อย, ประสิทธิภาพเฟืองเป็นค่าประมาณ · มอเตอร์แต่ละตัวต่างกันได้มาก'),
        numField(app, part, 'resistance', 'ความต้านทานขดลวด', 'Ω'),
        numField(app, part, 'inductance', 'ความเหนี่ยวนำ', 'H'),
        numField(app, part, 'ke', 'ke (V·s/rad ที่แกนมอเตอร์)', ''),
        numField(app, part, 'noLoadCurrent', 'กระแสไม่มีโหลด (แรงเสียดทาน)', 'A'),
        numField(app, part, 'inertia', 'ความเฉื่อยแกนมอเตอร์ (kg·m²)', ''),
        numField(app, part, 'gearRatio', 'อัตราทดเฟือง', ''),
        numField(app, part, 'gearEff', 'ประสิทธิภาพเฟือง (0–1)', '')));
      break;
    }
    case 'servo': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'สายน้ำตาล GND, แดง + (4.8–6 V — Pico ใช้ขา VBUS), ส้ม สัญญาณ: พัลส์ทุก 20 ms (PWM 50 Hz) กว้าง 0.5 ms = 0°, ≈ 1.45 ms = 90°, 2.4 ms = 180° · MicroPython: s = PWM(Pin(15)); s.freq(50); s.duty_ns(1450000) หรือ s.duty_u16(int(65535 * 1.45 / 20)) · ขณะหมุนกินกระแส 100–250 mA'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (เอกสาร SG90)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'วัดความกว้างพัลส์ที่ขาสัญญาณจากขอบขึ้น-ลงจริงในการจำลอง → มุมเป้าหมาย แล้วหมุนเข้าหาด้วยความเร็ว 0.1 s/60° ที่ 4.8 V (แปรตามไฟเลี้ยง) · dead band 10 µs · ไฟเลี้ยงต่ำกว่าค่าต่ำสุดไม่หมุน · ไม่จำลองแรงบิด/โหลดที่แขน และกระแสมอเตอร์ขณะหมุน (แสดงเฉพาะกระแสนิ่ง) · เซอร์โวแต่ละตัวช่วงพัลส์ต่างกันเล็กน้อย ปรับได้ด้านล่าง'),
        numField(app, part, 'pulseMin', 'ความกว้างพัลส์ที่ 0°', 's'),
        numField(app, part, 'pulseMax', 'ความกว้างพัลส์ที่ 180°', 's'),
        numField(app, part, 'speed', 'ความเร็วหมุนที่ 4.8 V (°/s)', ''),
        numField(app, part, 'vMin', 'ไฟเลี้ยงต่ำสุด', 'V'),
        numField(app, part, 'vMax', 'ไฟเลี้ยงสูงสุด', 'V'),
        numField(app, part, 'idleCurrent', 'กระแสนิ่ง', 'A')));
      break;
    }
    case 'transformer': {
      const pr = part.params;
      const on = h('input', { type: 'checkbox', checked: pr.on, id: 'f-tr-on' });
      on.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { on: on.checked }), `${on.checked ? 'เสียบปลั๊ก' : 'ถอดปลั๊ก'} ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, on, 'เสียบปลั๊ก / เปิดสวิตช์ (ไฟบ้าน 230 V)'));
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ความถี่ไฟบ้าน'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ความถี่ไฟบ้าน' },
          ...[50, 60].map((f) => h('button', { class: 'chip', id: `f-tr-${f}`, 'aria-pressed': String(pr.frequency === f), onclick: () => app.apply(setPartParams(app.doc, part.id, { frequency: f }), `ตั้งความถี่ ${part.label} = ${f} Hz`) }, `${f} Hz${f === 50 ? ' (ไทย)' : ''}`)))));
      const m = transformerModel(pr);
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ขั้ว A – CT – B: A–CT และ CT–B ได้ ${pr.vRated} V rms (ยอด ≈ ${(pr.vRated * Math.SQRT2).toFixed(1)} V) ที่กระแสพิกัด ${pr.iRated} A, A–B ได้ ${2 * pr.vRated} V rms · ขณะไม่มีโหลดสูงขึ้นเป็น ≈ ${m.vnl.toFixed(1)} V rms (regulation ${(pr.regulation * 100).toFixed(0)}%) · ด้านไฟบ้าน 230 V อันตรายถึงชีวิต — ในห้องปฏิบัติการจริงต้องมีฟิวส์ และให้ครูตรวจก่อนเสียบปลั๊กทุกครั้ง`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, `จำลองเฉพาะด้านทุติยภูมิ: แต่ละครึ่งขดเป็นแหล่งแรงดันไซน์ ${m.vnl.toFixed(2)} V rms ต่ออนุกรมความต้านทานขดลวดสมมูล ${m.rw.toFixed(2)} Ω (ให้แรงดันตกเหลือพิกัดที่กระแสพิกัด) · ไม่จำลองความเหนี่ยวนำรั่ว กระแสกระตุ้นแกน และความอิ่มตัวของแกน`),
        numField(app, part, 'vRated', 'แรงดันพิกัดต่อครึ่งขด', 'V'),
        numField(app, part, 'iRated', 'กระแสพิกัด', 'A'),
        numField(app, part, 'regulation', 'regulation (สัดส่วน เช่น 0.16)', '')));
      break;
    }
    case 'hbridge': {
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ต่อเป็น H-bridge: มอเตอร์ระหว่าง 1Y (ขา 3) กับ 2Y (ขา 6)'),
        h('table', { class: 'truth', style: 'border-collapse:collapse;font:600 13px/1.6 "IBM Plex Mono",monospace' },
          ...[['1,2EN', '1A', '2A', 'มอเตอร์'], ['1', '1', '0', 'หมุนทางหนึ่ง'], ['1', '0', '1', 'หมุนกลับทาง'], ['1', '0', '0', 'เบรก (ขั้วต่อกราวด์ทั้งคู่)'], ['1', '1', '1', 'เบรก (ขั้วต่อไฟบวกทั้งคู่)'], ['0', 'x', 'x', 'ปล่อยหมุนอิสระ (ขาออกลอย)']]
            .map((r, i) => h('tr', {}, ...r.map((c) => h(i === 0 ? 'th' : 'td', { style: 'border:1px solid var(--line);padding:0 8px;text-align:center' }, c)))))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ขาเรียงตามดาต้าชีต (รอยบากซ้าย): ${L293D_PINOUT.map((n, k) => `${k + 1} ${n.startsWith('GND') ? 'GND' : n === 'EN12' ? '1,2EN' : n === 'EN34' ? '3,4EN' : n}`).join(' · ')} · ขาเข้าระดับ TTL (≥ 2.3 V = 1) ขับจาก Pico 3.3 V ได้ · PWM ที่ขา EN ปรับความเร็ว · แรงดันตกในไอซีรวมราว 2–2.5 V (มอเตอร์ได้ไฟน้อยกว่า VCC2)`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ขาออกสูง/ต่ำเป็นแรงดันตกแบบไดโอดที่ fit กับ VOH = VCC2 − 1.4 V และ VOL = 1.2 V ที่ 0.6 A · ไดโอดกันย้อนในตัว (1.3 V ที่ 0.6 A) · สลับทันที (ไม่จำลองเวลาหน่วง ≈ 0.4–0.8 µs) · ไม่จำลองความร้อนและการตัดตัวเองเมื่อร้อนเกิน'),
        numField(app, part, 'maxOutputCurrent', 'กระแสต่อเนื่องสูงสุดต่อช่อง', 'A')));
      break;
    }
    case 'scr': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, '2N5060 (TO-92) มองหน้าแบน ขาลง: ซ้าย K แคโทด · กลาง G เกต · ขวา A แอโนด (แบบตัวถัง Style 10 — ดาต้าชีตบางฉบับเขียนลำดับต่างกัน ตรวจกับตัวจริงก่อนต่อ)'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ติด: กระแสเกต G → K ≥ IGT (200 µA) ขณะ A บวกกว่า K · ติดแล้วค้างแม้ปล่อยเกต · ดับ: กระแสแอโนดต่ำกว่า IH (5 mA) เช่น ตัดวงจรหรือลัด A–K · ควรมี RGK 1 kΩ จาก G ลง K'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'G–K เป็นไดโอด (VGK ≈ 0.74 V ที่ 200 µA) · A–K ขณะติดเป็นไดโอด (≈ 0.9 V ที่ 10 mA, ≈ 1.45 V ที่ 1.2 A ≤ VTM 1.7 V) ขณะดับรั่ว 1 GΩ · ใช้ IGT และ IH ค่าสูงสุดในดาต้าชีตเป็นเกณฑ์ (ตัวจริงส่วนใหญ่ไวกว่า) · ไม่จำลอง dv/dt เวลาเปิด/ปิด และอุณหภูมิ · แรงดัน A–K เกิน VDRM 30 V → นำเอง (breakover)'),
        numField(app, part, 'igt', 'IGT กระแสเกตที่ทำให้ติด', 'A'), numField(app, part, 'ih', 'IH กระแสค้าง', 'A')));
      break;
    }
    case 'lm35': {
      const t = part.params.temperature;
      const fmtT = (v: number) => `${+v.toFixed(1)} °C`;
      const setT = (v: number) => { const q = Math.round(v * 2) / 2; if (q !== part.params.temperature) app.apply(setPartParams(app.doc, part.id, { temperature: q }), `ตั้งอุณหภูมิที่ ${part.label} = ${fmtT(q)}`, { amend: true }); };
      const out = h('output', { id: 'f-temp-out', for: 'f-temp' }, `${fmtT(t)} → VOUT ≈ ${formatSI(lm35Vout(t), 'V', 3)}`);
      const slider = h('input', { type: 'range', id: 'f-temp', min: '-10', max: '150', step: '0.5', value: String(t), 'aria-label': 'อุณหภูมิที่ตัวเซนเซอร์', style: 'width:100%' }) as HTMLInputElement;
      slider.addEventListener('input', () => { const v = Number(slider.value); out.textContent = `${fmtT(v)} → VOUT ≈ ${formatSI(lm35Vout(v), 'V', 3)}`; });
      slider.addEventListener('change', () => setT(Number(slider.value)));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-temp' }, 'อุณหภูมิที่ตัวเซนเซอร์ '), out, slider,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'อุณหภูมิตัวอย่าง' }, ...TEMP_PRESETS.map(([v, name]) =>
          h('button', { class: 'chip', id: `f-temp-${v}`, 'aria-pressed': String(t === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { temperature: v }), `ตั้งอุณหภูมิที่ ${part.label} = ${name} (${fmtT(v)})`) }, `${name} ${fmtT(v)}`)))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'LM35DZ: VOUT = 10 mV × อุณหภูมิ (°C) เช่น 25 °C → 0.25 V · มองหน้าแบน ขาลง: ซ้าย +VS (4–30 V) กลาง VOUT ขวา GND · ต่อ VOUT เข้าขา ADC ของ Pico (GP26) แล้วแปลง: อุณหภูมิ = read_u16() × 3.3 / 65535 × 100'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ขาออกตามอุดมคติ 10 mV/°C (ของจริง LM35D คลาด ±0.6 °C ทั่วไปที่ 25 °C) · ไม่จำลองเวลาตอบสนองทางความร้อน (ในอากาศนิ่งเป็นนาที) และความร้อนในตัว (0.08 °C) · วงจรไฟเลี้ยงเดียววัดได้ 2–150 °C'),
        numField(app, part, 'quiescentCurrent', 'กระแสนิ่ง', 'A'),
        numField(app, part, 'rOut', 'ความต้านทานขาออก', 'Ω')));
      break;
    }
    case 'sonar': {
      const d = part.params.distance;
      const fmtD = (v: number) => (v > SONAR_MAX_CM ? 'ไม่มีวัตถุ (> 4 m)' : v >= 100 ? `${+(v / 100).toFixed(2)} m` : `${v} cm`);
      const echoTxt = (v: number) => { const w = sonarEchoWidth(v, part.params.temperature); return v > SONAR_MAX_CM ? `ECHO ≈ ${formatSI(w, 's', 2)} (หมดเวลา)` : `ECHO ≈ ${formatSI(w, 's', 3)}`; };
      const out = h('output', { id: 'f-dist-out', for: 'f-dist' }, `${fmtD(d)} → ${echoTxt(d)}`);
      const slider = h('input', { type: 'range', id: 'f-dist', min: '1', max: '500', step: '1', value: String(d), 'aria-label': 'ระยะวัตถุหน้าเซนเซอร์', style: 'width:100%' }) as HTMLInputElement;
      slider.addEventListener('input', () => { const v = Number(slider.value); out.textContent = `${fmtD(v)} → ${echoTxt(v)}`; });
      slider.addEventListener('change', () => { const v = Math.round(Number(slider.value)); if (v !== part.params.distance) app.apply(setPartParams(app.doc, part.id, { distance: v }), `ตั้งระยะวัตถุหน้า ${part.label} = ${fmtD(v)}`, { amend: true }); });
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-dist' }, 'ระยะวัตถุหน้าเซนเซอร์ '), out, slider,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ระยะตัวอย่าง' }, ...DIST_PRESETS.map(([v, name]) =>
          h('button', { class: 'chip', id: `f-dist-${v}`, 'aria-pressed': String(d === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { distance: v }), `ตั้งระยะวัตถุหน้า ${part.label} = ${name}`) }, name)))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'HC-SR04: ไฟเลี้ยง 5 V (ต่อ VBUS ของ Pico) · ส่งพัลส์ HIGH ≥ 10 µs เข้า TRIG → โมดูลยิงคลื่น 40 kHz แล้วให้ ECHO เป็น HIGH นานเท่าเวลาไป-กลับของเสียง · ระยะ (cm) = ความกว้าง ECHO (µs) × 0.0343 ÷ 2 ≈ µs ÷ 58 · วัดได้ 2–400 cm · ไม่มีวัตถุ ECHO ค้าง ≈ 38 ms'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--warn,#b45309)' }, 'ECHO ออกมา 5 V แต่ขา GPIO ของ Pico ทนได้ 3.3 V → ต้องลดแรงดันด้วยตัวต้านทานแบ่งแรงดัน เช่น ECHO —1 kΩ— GP15 —2 kΩ— GND (ได้ ≈ 3.3 V) · TRIG รับ 3.3 V จาก Pico ได้โดยตรง'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ความเร็วเสียง c = 331.3 + 0.606 × T (m/s) · หน่วงหลัง TRIG ลง ≈ 0.45 ms (ยิงคลื่น 8 ลูก — ค่าประมาณ ดาต้าชีตไม่ระบุ) · ECHO เป็นขาออก 5 V แบบ push-pull · ไม่จำลองมุมรับ (≈ 15°) วัตถุนุ่มดูดเสียง และเสียงสะท้อนหลายทาง · ระหว่างวัดกินกระแส ≈ 15 mA'),
        numField(app, part, 'temperature', 'อุณหภูมิอากาศ', '°C')));
      break;
    }
    case 'stepper': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'หัวเข็มบนบอร์ดขับ: IN1–IN4 → GPIO ของ Pico (เฟส A–D, สูง = ขดลวดเฟสนั้นมีไฟ), − → GND ของ Pico, + → VBUS (5 V) · ลำดับฮาล์ฟสเต็ป A, AB, B, BC, C, CD, D, DA · 4096 ฮาล์ฟสเต็ป = แกนออก 1 รอบ'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ความเร็วสูงสุด (ฮาล์ฟสเต็ป): ออกตัวจากหยุดนิ่ง ≤ 600 สเต็ป/วินาที (ดีเลย์ ≥ 1.7 ms) หมุนต่อเนื่อง ≤ 1000 สเต็ป/วินาที (≈ 15 rpm) · ฟูลสเต็ปขยับครั้งละ 2 ฮาล์ฟสเต็ป จึงเปลี่ยนเฟสได้ราวครึ่งหนึ่ง — ถี่กว่านี้มอเตอร์หลุดสเต็ป'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ไฟฟ้า: ขดลวดเป็นตัวต้านทาน 50 Ω ต่อเฟส (ไม่จำลองความเหนี่ยวนำและแรงดันย้อนกลับขณะหมุน) · ULN2003 ตามวงจรในดาต้าชีต (2.7 kΩ, 7.2 kΩ, 3 kΩ, ดาร์ลิงตัน, ไดโอดไป COM) · LED A–D + 1 kΩ คร่อมขดลวด'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'กลไก: ขดลวดที่มีกระแส ≥ 60 mA กำหนดตำแหน่งสนาม โรเตอร์ตามเมื่อขยับครั้งละ 1–2 ฮาล์ฟสเต็ป (หยุดนิ่งอยู่: ≤ 3) และไม่ถี่เกินพิกัด · ไม่จำลองแรงบิดโหลด ความเฉื่อย และการแกว่งของโรเตอร์ · ทิศ + คือไล่ IN1 → IN4 (ทิศจริงขึ้นกับการต่อสายในมอเตอร์)'),
        numField(app, part, 'coilResistance', 'ความต้านทานขดลวดต่อเฟส', 'Ω')));
      break;
    }
    case 'opto': {
      const pr = part.params;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'กลุ่ม CTR (รหัสท้ายรุ่น)'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'กลุ่ม CTR' }, ...(['A', 'B', 'C', 'D'] as const).map((rk) =>
          h('button', { class: 'chip', id: `f-rank-${rk}`, 'aria-pressed': String(pr.rank === rk), onclick: () => app.apply(setPartParams(app.doc, part.id, { rank: rk, ctr: pc817TypCtr(rk) }), `ตั้ง ${part.label} เป็น PC817${rk}`) },
            `${rk} ${PC817_CTR[rk][0] * 100}–${PC817_CTR[rk][1] * 100}%`)))));
      nodes.push(numField(app, part, 'ctr', 'CTR ที่ใช้จำลอง (IC ÷ IF, เท่า)', '×', 'ตัวจริงแต่ละตัวต่างกันได้ภายในกลุ่ม — ค่าเริ่มต้นเป็นค่ากลางของกลุ่ม'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขา (มองด้านบน จุดขา 1 ซ้ายล่าง): 1 แอโนด · 2 แคโทด (LED อินฟราเรดด้านขาเข้า) · 3 อิมิตเตอร์ · 4 คอลเลกเตอร์ (โฟโต้ทรานซิสเตอร์ด้านขาออก) — สองฝั่งไม่ต่อกันทางไฟฟ้า ใช้แยกกราวด์ของ Pico ออกจากวงจรแรงดันสูงกว่า'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขาเข้า: VF ≈ 1.2 V ใส่ตัวต้านทานจำกัด IF 5–20 mA (≤ 50 mA) · ขาออก: IC ≈ CTR × IF ในย่านขยาย ถ้าโหลดต้องการกระแสน้อยกว่านั้น ทรานซิสเตอร์อิ่มตัว VCE ≈ 0.1–0.2 V (ทำงานเป็นสวิตช์)'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'LED เป็นไดโอด (VF 1.20 V ที่ 20 mA) · กระแสแสงเป็นแหล่งกระแสที่ขึ้นกับ IF ป้อนเบสภายในของทรานซิสเตอร์ (β 500, βR 0.5 → VCE(sat) ≈ 0.1–0.2 V) · CTR คงที่ทุกค่า IF (ของจริงลดลงเมื่อ IF ต่ำหรือสูงมากและตามอุณหภูมิ) · ไม่จำลองเวลาตอบสนอง (tr/tf ≈ 4/3 µs) · ฉนวนระหว่างสองฝั่งสมบูรณ์')));
      break;
    }
    case 'shiftreg': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ส่งข้อมูลทีละบิต: ตั้ง SER (ขา 14) เป็น 0/1 แล้วให้ SRCLK (ขา 11) ขึ้น — บิตเลื่อนเข้า QA และบิตเดิมเลื่อนไป QB … QH · ส่งครบ 8 บิตแล้วให้ RCLK (ขา 12) ขึ้นหนึ่งครั้ง ขาออก QA–QH จึงเปลี่ยนพร้อมกัน (ระหว่างเลื่อน LED ไม่กะพริบ) · บิตที่ส่งก่อนไปอยู่ QH'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ขาเรียงตามดาต้าชีต (มองด้านบน รอยบากซ้าย): ${HC595_PINOUT.map((n, k) => `${k + 1} ${n === 'QH2' ? "QH′" : n}`).join(' · ')} · SRCLR (ขา 10) ต่อ VCC และ OE (ขา 13) ต่อ GND เมื่อไม่ใช้ · QH′ (ขา 9) ต่อ SER ของตัวถัดไปเพื่อขยายเป็น 16 บิต`));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ไฟเลี้ยง 2–6 V (ใช้ 3V3 ของ Pico ระดับสัญญาณจึงตรงกัน) · ขาออกจ่ายได้ราว 6 mA ต่อขา (สูงสุด 35 mA) และรวมทั้งตัวไม่เกิน 70 mA — LED ทุกดวงต้องมีตัวต้านทาน'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ทำงานที่ขอบสัญญาณตามตารางในดาต้าชีต (ไม่จำลองเวลาหน่วง ≈ 20 ns และ setup/hold time) · ขาเข้าตัดที่ VCC/2 (ของจริงรับประกัน ≥ 0.7 VCC เป็น 1, ≤ 0.3 VCC เป็น 0) · ขาออกเป็น MOSFET ที่ fit กับ VOH 4.3 V ที่ 6 mA (VCC 4.5 V) · เพิ่งจ่ายไฟทุกบิตเป็น 0 (ของจริงเป็นค่าสุ่ม)'),
        numField(app, part, 'maxOutputCurrent', 'กระแสต่อขาออกสูงสุด', 'A'),
        numField(app, part, 'maxSupplyCurrent', 'กระแสรวมขา VCC/GND สูงสุด', 'A')));
      break;
    }
    case 'counter': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'นับที่ขอบขาขึ้นของ CLK (ขา 14): Q0 → Q1 → … → Q9 → Q0 ขาออกสูงทีละขา · CARRY OUT (ขา 12) สูงเมื่อนับ 0–4 (ความถี่ = CLK ÷ 10) · RESET (ขา 15) สูง = กลับไป Q0 · CLOCK INHIBIT (ขา 13) สูง = หยุดนับ · ต่อ Qn เข้า RESET เพื่อนับแค่ 0 ถึง n−1'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ขาเรียงตามดาต้าชีต (มองด้านบน รอยบากซ้าย): ${CD4017_PINOUT.map((n, k) => `${k + 1} ${n === 'INH' ? 'CLK INH' : n === 'RST' ? 'RESET' : n}`).join(' · ')} · ไฟเลี้ยง 3–18 V · ขาออกจ่ายกระแสได้น้อย (ราว 1–3 mA ที่ 5 V, 5–10 mA ที่ 9–12 V)`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'นับทันทีที่ขอบสัญญาณ (ไม่จำลองเวลาหน่วง ≈ 0.3 µs) · ขา CLK เป็นชมิตต์ทริกเกอร์ (ขึ้นที่ 0.6 VDD ลงที่ 0.4 VDD) · ขาออกเป็น MOSFET ช่อง P/N กระแสอิ่มตัวขึ้นกับไฟเลี้ยง · เริ่มต้นที่ Q0 (ไอซีจริงตอนจ่ายไฟอาจเริ่มที่ขาใดก็ได้ ถ้าไม่มีวงจรรีเซ็ต)'),
        numField(app, part, 'kp', 'KP ทรานซิสเตอร์ขาออก', 'A/V²'),
        numField(app, part, 'vth', 'Vth ทรานซิสเตอร์ขาออก', 'V'),
        numField(app, part, 'maxOutputCurrent', 'กระแสขาออกสูงสุด', 'A')));
      break;
    }
    case 'logic': {
      const pr = part.params;
      const fn = LOGIC_FUNC[pr.model];
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'รุ่น (ชนิดเกต)'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'รุ่น' },
          ...LOGIC_MODELS.map((m) => h('button', { class: 'chip', id: `f-lg-${m}`, 'aria-pressed': String(pr.model === m), onclick: () => app.apply(setPartParams(app.doc, part.id, { model: m }), `ตั้ง ${part.label} เป็น ${m}`) }, `${m} ${LOGIC_FUNC[m].name}`)))));
      const rows: string[][] = fn.inputs === 1 ? [['A', 'Y'], ['0', '1'], ['1', '0']] : [['A', 'B', 'Y'], ...[[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => [String(a), String(b), fn.f(!!a, !!b) ? '1' : '0'])];
      nodes.push(h('div', { class: 'field' }, h('label', {}, `ตารางความจริง ${fn.name} (${fn.symbol})`),
        h('table', { class: 'truth', style: 'border-collapse:collapse;font:600 13px/1.6 "IBM Plex Mono",monospace' },
          ...rows.map((r, i) => h('tr', {}, ...r.map((c) => h(i === 0 ? 'th' : 'td', { style: 'border:1px solid var(--line);padding:0 10px;text-align:center' }, c)))))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ขาเรียงตามเอกสาร TI (มองจากด้านบน รอยบากซ้าย): ${LOGIC_PINOUT[pr.model].map((n, k) => `${k + 1} ${n}`).join(' · ')} · ขาเข้า > VCC/2 อ่านเป็น 1 · ขาเข้าที่ไม่ใช้ควรต่อ VCC หรือ GND · ขาออกจ่ายได้ราว 4–6 mA (LED ใช้ตัวต้านทาน ≥ 470 Ω)`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'เกตตอบสนองทันที (ไม่จำลองเวลาหน่วง ≈ 8–20 ns) · ขาออกเป็นสวิตช์ต่อ VCC หรือ GND ผ่านความต้านทาน · สถานะขาออกคงอยู่ระหว่างการคำนวณ จึงต่อวงจรความจำ (SR latch) ได้ · วงจรที่ขาออกย้อนกลับมาสั่นเอง (เช่น NOT วนตัวเอง) แจ้งเป็นข้อผิดพลาด'),
        numField(app, part, 'outputResistance', 'ความต้านทานขาออก', 'Ω'),
        numField(app, part, 'maxOutputCurrent', 'กระแสขาออกสูงสุด', 'A')));
      break;
    }
    case 'vreg': {
      const pr = part.params;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'รุ่น'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'รุ่น' },
          ...VREG_MODELS.map((m) => h('button', { class: 'chip', id: `f-vr-${m}`, 'aria-pressed': String(pr.model === m), onclick: () => app.apply(setPartParams(app.doc, part.id, vregParamsFor(m, pr.heatsink)), `ตั้ง ${part.label} เป็น ${m}`) }, `${m} (${vregParamsFor(m).vout} V)`)))));
      const hs = h('input', { type: 'checkbox', checked: pr.heatsink, id: 'f-heatsink' });
      hs.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { heatsink: hs.checked }), `${hs.checked ? 'ติด' : 'ถอด'}แผ่นระบายความร้อน ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, hs, 'ติดแผ่นระบายความร้อน (heatsink)'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `มองด้านหน้า (ตัวหนังสือ) ขาลง: ขา 1 IN, 2 GND (แผ่นโลหะ), 3 OUT · ขาเข้าต้องสูงกว่าขาออกอย่างน้อย ${pr.dropout} V (≥ ${pr.vout + pr.dropout} V) และไม่เกิน ${pr.maxInput} V · ตามเอกสารผู้ผลิตควรต่อ C 0.33 µF ที่ขาเข้าและ 0.1 µF ที่ขาออกใกล้ตัวไอซี · กำลังสูญเสีย ≈ (VIN − VOUT) × IOUT กลายเป็นความร้อน: ตัวเปล่า ≈ 50 °C/W, ติดแผ่นระบายความร้อนเล็ก ≈ 16 °C/W`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร ST L78)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'แรงดันอ้างอิง + วงขยายผิดพลาด (ตอบสนองทันที) ไฟเลี้ยงจากขา IN: ขาออกถูกจำกัดที่ IN − dropout · กระแสขาออกและกระแสนิ่งไหลเข้าทางขา IN กระแสนิ่งออกทางขา GND · ไม่จำลองการจำกัดกระแส (≈ 2.2 A) และการตัดเพราะความร้อน (แจ้งเตือนแทน), ripple rejection 62 dB, การเปลี่ยนแรงดันตามอุณหภูมิ'),
        numField(app, part, 'vout', 'แรงดันขาออก', 'V'),
        numField(app, part, 'dropout', 'dropout (IN − OUT ต่ำสุด)', 'V'),
        numField(app, part, 'quiescentCurrent', 'กระแสนิ่งขา GND', 'A'),
        numField(app, part, 'rOut', 'ความต้านทานขาออก', 'Ω'),
        numField(app, part, 'maxInput', 'แรงดันขาเข้าสูงสุด', 'V'),
        numField(app, part, 'maxLoad', 'กระแสขาออกสูงสุด', 'A')));
      break;
    }
    case 'lm317': {
      const pr = part.params;
      const hs = h('input', { type: 'checkbox', checked: pr.heatsink, id: 'f-heatsink' });
      hs.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { heatsink: hs.checked }), `${hs.checked ? 'ติด' : 'ถอด'}แผ่นระบายความร้อน ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, hs, 'ติดแผ่นระบายความร้อน (heatsink)'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `มองด้านหน้า (ตัวหนังสือ) ขาลง: ขา 1 ADJ, 2 OUT (แผ่นโลหะต่อกับ OUT — ระวังแผ่นระบายความร้อนแตะกราวด์), 3 IN · ต่อ R1 จาก OUT ไป ADJ (≤ 240 Ω เพื่อให้กระแสผ่านเกินกระแสโหลดต่ำสุด ${formatSI(pr.minLoad, 'A', 2)}) และ R2 จาก ADJ ลงกราวด์ → VOUT = ${pr.vref} V × (1 + R2/R1) + ${formatSI(pr.iadj, 'A', 2)} × R2 · ขาเข้าต้องสูงกว่าขาออก ≥ 3 V (คงแรงดันได้ถึง ≈ ${pr.dropout} V) และไม่เกิน ${pr.maxDiff} V · ตามเอกสารผู้ผลิตควรต่อ C 0.1 µF ที่ขาเข้าและ 1 µF ที่ขาออก`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร TI LM317)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'แหล่งอ้างอิง 1.25 V ลอยบนขา ADJ + วงขยายผิดพลาด (ตอบสนองทันที) ไฟเลี้ยงจากขา IN · ขาออกจ่ายกระแสได้ทางเดียว (ดูดกลับไม่ได้) · กระแสนิ่งไหลออกทางขา OUT จึงต้องมีกระแสโหลดต่ำสุด · ไม่จำลองการจำกัดกระแส (≈ 2.2 A) การตัดเพราะความร้อน ripple rejection และตัวเก็บประจุ CADJ (แจ้งเตือนแทน)'),
        numField(app, part, 'vref', 'แรงดันอ้างอิง OUT − ADJ', 'V'),
        numField(app, part, 'iadj', 'กระแสขา ADJ', 'A'),
        numField(app, part, 'minLoad', 'กระแสโหลดต่ำสุด', 'A'),
        numField(app, part, 'dropout', 'dropout (IN − OUT ต่ำสุด)', 'V'),
        numField(app, part, 'maxLoad', 'กระแสขาออกสูงสุด', 'A')));
      break;
    }
    case 'timer555': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'NE555 วางคร่อมร่องกลาง รอยบากอยู่ซ้าย: ขา 1 GND, 2 TRIG, 3 OUT, 4 RESET (แถวที่แตะ) · ขา 5 CTRL, 6 THR, 7 DIS, 8 VCC (อีกฝั่ง ขา 8 ตรงข้ามขา 1) · วงจร astable: RA จาก VCC ไปขา 7, RB จากขา 7 ไปขา 6, ต่อขา 2 กับขา 6, C จากขา 6 ลงกราวด์, RESET ต่อ VCC — f ≈ 1.44 / ((RA + 2RB)·C), duty = (RA + RB)/(RA + 2RB)'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร TI NE555)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'วงแบ่ง 3 × 5 kΩ ให้ ⅔ VCC (ขา 5) และ ⅓ VCC · TRIG < ⅓ → ขาออก HIGH (มีผลก่อน THR), THR > ⅔ → ขาออก LOW และทรานซิสเตอร์คายประจุ (ขา 7) นำ, RESET < 0.7 V → LOW · ขาออก HIGH เป็นดาร์ลิงตัน ≈ VCC − 1.2 V (100 mA → VCC − 1.7 V) · ไม่จำลองเวลาหน่วงภายใน (≈ 100 ns) จึงไม่เหมาะกับความถี่เกิน 100 kHz'),
        numField(app, part, 'outHighDrop', 'แรงดันตกขาออก HIGH ที่กระแสน้อย', 'V'),
        numField(app, part, 'outHighResistance', 'ความต้านทานขาออก HIGH (รวม)', 'Ω'),
        numField(app, part, 'outLowResistance', 'ความต้านทานขาออก LOW', 'Ω'),
        numField(app, part, 'dischargeResistance', 'ความต้านทานขาคายประจุขณะนำ', 'Ω'),
        numField(app, part, 'quiescentResistance', 'กระแสเลี้ยงตัวเอง (ความต้านทานเทียบเท่า)', 'Ω'),
        numField(app, part, 'maxOutputCurrent', 'กระแสขาออกสูงสุด', 'A')));
      break;
    }
    case 'relay': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'โมดูลรีเลย์ 1 ช่อง (ไม่มีออปโต้): ต่อ + เข้า 5 V (Pico ใช้ขา VBUS), − เข้า GND, S เข้าขา GPIO — S = HIGH (≥ ≈ 1 V) ทรานซิสเตอร์บนโมดูลนำ ขดลวดดึง ไฟ LED บนโมดูลติด และ COM ต่อกับ NO · S = LOW หรือไม่ต่อ: COM ต่อกับ NC · หน้าสัมผัสแยกจากวงจรควบคุม ใช้สวิตช์โหลดที่มีแหล่งจ่ายของตัวเองได้ · บนโมดูลมีไดโอดกันย้อนคร่อมขดลวดแล้ว'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลองและวงจรบนโมดูล'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'S → Rb → เบส NPN (β ≈ 200) · ขดลวด (R + L) จาก + ไปคอลเลกเตอร์ · 1N4148 คร่อมขดลวด · LED + 1 kΩ คร่อมขดลวด · หน้าสัมผัสดึงเมื่อแรงดันขดลวด ≥ แรงดันดึง และปล่อยเมื่อ ≤ แรงดันปล่อย (hysteresis) · ไม่จำลองเวลาดึง/ปล่อย (≈ 10 ms) และการเด้งของหน้าสัมผัส · ความเหนี่ยวนำขดลวดไม่มีในเอกสารผู้ผลิต (ค่าประมาณ)'),
        numField(app, part, 'coilResistance', 'ความต้านทานขดลวด', 'Ω'),
        numField(app, part, 'coilInductance', 'ความเหนี่ยวนำขดลวด (ประมาณ)', 'H'),
        numField(app, part, 'vPick', 'แรงดันดึง', 'V'),
        numField(app, part, 'vDrop', 'แรงดันปล่อย', 'V'),
        numField(app, part, 'contactResistance', 'ความต้านทานหน้าสัมผัส', 'Ω'),
        numField(app, part, 'contactRating', 'พิกัดกระแสหน้าสัมผัส', 'A'),
        numField(app, part, 'baseResistance', 'ตัวต้านทานเบสบนโมดูล', 'Ω')));
      break;
    }
    case 'sevenseg': {
      const c = part.params.common;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ชนิดขาร่วม'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ชนิดขาร่วม' },
          h('button', { class: 'chip', id: 'f-ss-cc', 'aria-pressed': String(c === 'cc'), onclick: () => app.apply(setPartParams(app.doc, part.id, sevenSegParamsFor('cc')), `ตั้ง ${part.label} เป็นแคโทดร่วม`) }, 'แคโทดร่วม (5161AS) — ขาร่วมต่อลบ'),
          h('button', { class: 'chip', id: 'f-ss-ca', 'aria-pressed': String(c === 'ca'), onclick: () => app.apply(setPartParams(app.doc, part.id, sevenSegParamsFor('ca')), `ตั้ง ${part.label} เป็นแอโนดร่วม`) }, 'แอโนดร่วม (5161BS) — ขาร่วมต่อบวก'))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `วางคร่อมร่องกลาง: ขา 1–5 แถวที่แตะ (เช่น h) จากซ้าย, ขา 6–10 แถว d จากขวา · ขา 1 E, 2 D, 3 ขาร่วม, 4 C, 5 DP, 6 B, 7 A, 8 ขาร่วม, 9 F, 10 G · ขาร่วม 3 และ 8 ต่อถึงกันภายใน · แต่ละส่วนเป็น LED สีแดง (Vf ≈ 2.1 V, ไม่เกิน 20 mA) ต้องมีตัวต้านทานของตัวเอง (เช่น 330 Ω ที่ 5 V, 220 Ω ที่ 3.3 V) ${c === 'cc' ? '· แคโทดร่วม: ป้อน + เข้าขาส่วนที่ต้องการให้ติด' : '· แอโนดร่วม: ดึงขาส่วนที่ต้องการให้ติดลง 0 V'}`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง LED ของแต่ละส่วน'),
        numField(app, part, 'Is', 'กระแสอิ่มตัว Is', 'A'), numField(app, part, 'n', 'ค่า ideality n', ''), numField(app, part, 'Rs', 'ความต้านทานอนุกรม Rs', 'Ω'),
        numField(app, part, 'ratedCurrent', 'กระแสที่ใช้เป็นสเกลความสว่าง', 'A'), numField(app, part, 'maxCurrent', 'กระแสสูงสุดต่อส่วน', 'A')));
      break;
    }
    case 'lm386': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'LM386N-1 วางคร่อมร่องกลาง รอยบากอยู่ซ้าย: ขา 1 GAIN, 2 −IN, 3 +IN, 4 GND (แถวที่แตะ) · ขา 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN (อีกฝั่ง ขา 8 ตรงข้ามขา 1) · ไฟเลี้ยง 4–12 V'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'อัตราขยาย 20 เท่าเมื่อขา 1–8 เปิด · ใส่ตัวเก็บประจุ 10 µF ระหว่างขา 1 (+) กับขา 8 → 200 เท่า · ขาเข้ามี 50 kΩ ลงกราวด์ภายใน (ต่อขา 2 ลงกราวด์ แล้วป้อนสัญญาณเข้าขา 3) · ขาออก DC ≈ VS/2 ต้องต่อ C 220–250 µF ไปลำโพง'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร TI LM386)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ภาคขยายแบบไม่กลับเฟสอ้างอิง VS/2: อัตราขยาย 1 + Rf/(Ra + Rb) = 20 และ 1 + Rf/Ra = 200 เมื่อ C ลัด Rb (1.35 kΩ ระหว่างขา 1–8) · แบนด์วิดท์ 300 kHz ที่อัตราขยาย 20 · ขาออกแกว่งได้ถึงไฟเลี้ยง − 0.7 V แต่ละข้าง · ไม่จำลองความเพี้ยน (THD 0.2%) สัญญาณรบกวน และความร้อน'),
        numField(app, part, 'rf', 'Rf ป้อนกลับภายใน', 'Ω'),
        numField(app, part, 'rb', 'Rb ระหว่างขา 1–8', 'Ω'),
        numField(app, part, 'headroom', 'ระยะขาออกห่างไฟเลี้ยง', 'V')));
      break;
    }
    case 'speaker': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ลำโพงไดนามิก Ø 57 mm ${part.params.impedance} Ω ${part.params.maxPower} W · สายแดง (+) สายดำ (−) ปลายเป็นขาตัวผู้ เสียบสายจัมเปอร์ได้ · ห้ามมีไฟตรงไหลผ่าน (ต่อผ่านตัวเก็บประจุคัปปลิ้ง) · มีเสียงออกลำโพงคอมพิวเตอร์ตามความถี่และกำลังที่ได้ (ปุ่มเสียงที่แถบล่าง)`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ความต้านทาน 8 Ω คงที่ (ไม่จำลองความเหนี่ยวนำของขดลวดและเรโซแนนซ์ของกรวย) · ความดัง ∝ √(กำลัง/พิกัด) · กำลัง = (กระแสยอด)² × R / 2'),
        numField(app, part, 'impedance', 'อิมพีแดนซ์', 'Ω'),
        numField(app, part, 'maxPower', 'พิกัดกำลัง', 'W')));
      break;
    }
    case 'darlington': {
      const pr = part.params;
      const hs = h('input', { type: 'checkbox', checked: pr.heatsink, id: 'f-heatsink' });
      hs.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { heatsink: hs.checked }), `${hs.checked ? 'ติด' : 'ถอด'}แผ่นระบายความร้อน ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, hs, 'ติดแผ่นระบายความร้อน (heatsink)'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'TIP120 มองด้านหน้า (ตัวหนังสือ) ขาลง: ขา 1 B, 2 C (แผ่นโลหะต่อกับ C — ระวังแผ่นระบายความร้อนแตะสายอื่น), 3 E · NPN ดาร์ลิงตัน hFE ≥ 1000 · VBE ≈ 1.2–1.5 V (สูงสุด 2.5 V ที่ 3 A) · VCE(sat) ≈ 0.7–1 V (สูงสุด 2 V ที่ 3 A) · 60 V 5 A · ตัวเปล่า ≈ 2 W (62.5 °C/W) · ขับขดลวดต้องมีไดโอดกันย้อนคร่อมโหลด'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร onsemi TIP120)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ทรานซิสเตอร์สองตัวแบบ Ebers–Moll ต่อดาร์ลิงตัน + R1 ≈ 8 kΩ, R2 ≈ 120 Ω ภายในตามแผนภาพในเอกสาร + ความต้านทานเนื้อสาร RC/RE · ค่า Is/hFE/RC/RE ปรับให้ VBE และ VCE(sat) อยู่ในค่าสูงสุดของเอกสาร (ประมาณ) · ไม่จำลองเวลาสวิตช์ การพังทลาย VCEO และการเปลี่ยน hFE ตามอุณหภูมิ'),
        numField(app, part, 'bf1', 'hFE ตัวขับ (Q1)', ''),
        numField(app, part, 'bf2', 'hFE ตัวกำลัง (Q2)', ''),
        numField(app, part, 'r1', 'ตัวต้านทานภายใน R1', 'Ω'),
        numField(app, part, 'r2', 'ตัวต้านทานภายใน R2', 'Ω'),
        numField(app, part, 'maxIc', 'IC สูงสุด', 'A')));
      break;
    }
    case 'comparator': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'LM393 วางคร่อมร่องกลาง รอยบากอยู่ซ้าย: ขา 1 OUTA, 2 INA−, 3 INA+, 4 GND (แถวที่แตะ) · ขา 5 INB+, 6 INB−, 7 OUTB, 8 VCC (อีกฝั่ง ขา 8 ตรงข้ามขา 1) · ไฟเลี้ยง 2–36 V'));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'IN− > IN+ → ขาออกดึงลง GND (LED จากไฟบวกติด) · IN+ > IN− → ขาออกลอย (open collector) ต้องมี pull-up · ขาเข้าใช้ได้ 0 ถึง VCC − 1.5 V · ช่องที่ไม่ใช้: ต่อขาเข้าทั้งสองลง GND · hysteresis: ตัวต้านทานค่าสูง (เช่น 100 kΩ) จากขาออกกลับไป IN+'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (ค่าจากเอกสาร ST LM393)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'เปรียบเทียบทันที (ไม่จำลองเวลาตอบสนอง 1.3 µs, offset 2 mV และกระแสไบอัส 25 nA) ไม่มี hysteresis ในตัว · ขาออกนำ = ความต้านทาน Ron ลง GND (VOL ≈ 0.25 V ที่ 4 mA) · กระแสนิ่ง 0.4 mA · ถ้าขาออกย้อนกลับมาที่ IN− (ป้อนกลับลบ) จะแจ้งว่าสั่น'),
        numField(app, part, 'ron', 'ความต้านทานขาออกขณะนำ', 'Ω'),
        numField(app, part, 'sinkMax', 'กระแสขาออกสูงสุด', 'A'),
        numField(app, part, 'quiescentCurrent', 'กระแสนิ่ง', 'A')));
      break;
    }
    case 'ntc': {
      const pr = part.params;
      const t = pr.temperature;
      const fmtT = (v: number) => `${+v.toFixed(1)} °C`;
      const setT = (v: number) => { const q = Math.round(v * 2) / 2; if (q !== pr.temperature) app.apply(setPartParams(app.doc, part.id, { temperature: q }), `ตั้งอุณหภูมิที่ ${part.label} = ${fmtT(q)}`, { amend: true }); };
      const rOf = (v: number) => formatSI(ntcResistance({ ...pr, temperature: v }), 'Ω', 3);
      const out = h('output', { id: 'f-ntc-out', for: 'f-ntc' }, `${fmtT(t)} → R ≈ ${rOf(t)}`);
      const slider = h('input', { type: 'range', id: 'f-ntc', min: '-20', max: '125', step: '0.5', value: String(t), 'aria-label': 'อุณหภูมิรอบเทอร์มิสเตอร์', style: 'width:100%' }) as HTMLInputElement;
      slider.addEventListener('input', () => { const v = Number(slider.value); out.textContent = `${fmtT(v)} → R ≈ ${rOf(v)}`; });
      slider.addEventListener('change', () => setT(Number(slider.value)));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-ntc' }, 'อุณหภูมิรอบเทอร์มิสเตอร์ '), out, slider,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'อุณหภูมิตัวอย่าง' }, ...TEMP_PRESETS.map(([v, name]) =>
          h('button', { class: 'chip', id: `f-ntc-${v}`, 'aria-pressed': String(t === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { temperature: v }), `ตั้งอุณหภูมิที่ ${part.label} = ${name} (${fmtT(v)})`) }, `${name} ${fmtT(v)}`)))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `MF52A ${formatSI(pr.r25, 'Ω', 3)} B${pr.beta} (ไม่มีขั้ว): ร้อนขึ้นความต้านทานลด — R = R25 × e^(B × (1/T − 1/298.15)) โดย T เป็นเคลวิน (°C + 273.15) · ต่อเป็นวงแบ่งแรงดันกับตัวต้านทาน ${formatSI(pr.r25, 'Ω', 3)}: ที่ 25 °C ได้ครึ่งหนึ่งของไฟเลี้ยง · ย้อนกลับ: T = 1 / (1/298.15 + ln(R/R25)/B) − 273.15`));
      const span = h('select', { id: 'f-span', 'aria-label': 'ระยะขา' }, ...[1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === pr.span }, `${n} ช่อง`)));
      span.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { span: Number(span.value) }), `เปลี่ยนระยะขา ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-span' }, 'ระยะห่างขา (บนบอร์ด)'), h('div', { class: 'row' }, span)));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (MF52A103F3950)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'สมการค่า B (คลาดจากตารางผู้ผลิตไม่เกิน ≈ 1 °C ในช่วง 0–100 °C) · ความคลาดเคลื่อน R25 ±1% ไม่ได้จำลอง · ความร้อนในตัว ΔT = P/δ แจ้งเตือนแต่ไม่ป้อนกลับ · ไม่จำลองเวลาตอบสนองทางความร้อน (τ ≈ 7 s ในอากาศนิ่ง) · δ ≈ 2 mW/°C เป็นค่าประมาณ'),
        numField(app, part, 'r25', 'ความต้านทานที่ 25 °C', 'Ω'),
        numField(app, part, 'beta', 'ค่า B', 'K'),
        numField(app, part, 'dissipation', 'ค่าคงที่การระบายความร้อน δ', 'W/°C'),
        numField(app, part, 'maxPower', 'พิกัดกำลัง', 'W')));
      break;
    }
    case 'ldr': {
      const lux = part.params.lux;
      const fmtLux = (v: number) => (v >= 1000 ? `${+(v / 1000).toPrecision(3)}k lx` : `${+v.toPrecision(3)} lx`);
      const setLux = (v: number) => {
        const q = v <= 0 ? 0 : +v.toPrecision(3);
        if (q !== part.params.lux) app.apply(setPartParams(app.doc, part.id, { lux: q }), `ตั้งแสงที่ ${part.label} = ${fmtLux(q)}`, { amend: true });
      };
      // แถบเลื่อนแบบลอการิทึม: 0 = มืดสนิท, 1..1000 → 0.1 lx .. 100k lx
      const toSlider = (v: number) => (v <= 0 ? 0 : Math.round(Math.min(1000, Math.max(1, (Math.log10(v) + 1) * 1000 / 6))));
      const fromSlider = (s: number) => (s <= 0 ? 0 : Math.pow(10, (s * 6) / 1000 - 1));
      const out = h('output', { id: 'f-lux-out', for: 'f-lux' }, `${fmtLux(lux)} → R ≈ ${formatSI(ldrResistance(part.params), 'Ω', 3)}`);
      const slider = h('input', { type: 'range', id: 'f-lux', min: '0', max: '1000', step: '1', value: String(toSlider(lux)), 'aria-label': 'ความสว่างที่ตกบน LDR', style: 'width:100%' }) as HTMLInputElement;
      slider.addEventListener('input', () => { const v = fromSlider(Number(slider.value)); out.textContent = `${fmtLux(v)} → R ≈ ${formatSI(ldrResistance({ ...part.params, lux: v }), 'Ω', 3)}`; });
      slider.addEventListener('change', () => setLux(fromSlider(Number(slider.value))));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-lux' }, 'ความสว่างที่ตกบน LDR (สเกลลอการิทึม) '), out, slider,
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ระดับแสงตัวอย่าง' }, ...LUX_PRESETS.map(([v, name]) =>
          h('button', { class: 'chip', id: `f-lux-${v}`, 'aria-pressed': String(lux === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { lux: v }), `ตั้งแสงที่ ${part.label} = ${name} (${fmtLux(v)})`) }, `${name} ${fmtLux(v)}`)))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'GL5528 (Ø5 mm, ไม่มีขั้ว): ยิ่งสว่าง ความต้านทานยิ่งลด — 10 lux ≈ 10–20 kΩ, มืดสนิท ≥ 1 MΩ · ใช้ร่วมกับตัวต้านทานคงที่เป็นวงแบ่งแรงดันเพื่อแปลงแสงเป็นแรงดัน'));
      const span = h('select', { id: 'f-span', 'aria-label': 'ระยะขา' }, ...[1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === part.params.span }, `${n} ช่อง`)));
      span.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { span: Number(span.value) }), `เปลี่ยนระยะขา ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-span' }, 'ระยะห่างขา (บนบอร์ด)'), h('div', { class: 'row' }, span)));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'R = R10·(lux/10)^(−γ) ขนานกับ R มืด · ไม่จำลองเวลาตอบสนอง (ของจริงราว 20–30 ms) และความไวต่อสีของแสง'),
        numField(app, part, 'r10', 'ความต้านทานที่ 10 lux', 'Ω'),
        numField(app, part, 'gamma', 'ค่าแกมมา γ', ''),
        numField(app, part, 'rdark', 'ความต้านทานในที่มืด', 'Ω'),
        numField(app, part, 'maxPower', 'พิกัดกำลัง', 'W')));
      break;
    }
    case 'buzzer': {
      const t = part.params.type;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ชนิด'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ชนิดบัซเซอร์' },
          h('button', { class: 'chip', id: 'f-bz-active', 'aria-pressed': String(t === 'active'), onclick: () => app.apply(setPartParams(app.doc, part.id, buzzerParamsFor('active')), `ตั้ง ${part.label} เป็นแบบมีวงจรในตัว`) }, 'มีวงจรในตัว (active) 5 V'),
          h('button', { class: 'chip', id: 'f-bz-passive', 'aria-pressed': String(t === 'passive'), onclick: () => app.apply(setPartParams(app.doc, part.id, buzzerParamsFor('passive')), `ตั้ง ${part.label} เป็นแบบไม่มีวงจร`) }, 'ไม่มีวงจร (passive) 42 Ω'))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, t === 'active'
        ? 'แบบมีวงจรกำเนิดเสียงในตัว (เทียบ TMB12A05): ป้อนไฟตรง 4–8 V ที่ขา + (ขายาว) จะดัง ≈ 2.4 kHz กินกระแส ≈ 30 mA ที่ 5 V · ต่อกลับขั้วไม่ดัง · ความถี่เปลี่ยนไม่ได้'
        : 'แบบไม่มีวงจร (เทียบ CEM-1203(42)): เป็นขดลวด 42 Ω ต้องป้อนคลื่นสี่เหลี่ยม/PWM จึงดัง ความถี่เสียง = ความถี่ที่ป้อน ดังที่สุดใกล้ 2.05 kHz · ป้อนไฟตรงแค่ดังแกร๊กตอนต่อ · ขับจากขา GPIO ควรผ่านทรานซิสเตอร์ (ขดลวดกินกระแสเกิน 12 mA)'));
      const snd = h('button', { class: `btn ${app.audio.enabled ? 'primary' : ''}`, id: 'f-sound', 'aria-pressed': String(app.audio.enabled), onclick: () => { app.audio.setEnabled(!app.audio.enabled); renderProps(app); } },
        app.audio.enabled ? '🔊 เสียงในแอป: เปิด' : '🔇 เสียงในแอป: ปิด');
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-sound' }, 'เล่นเสียงจริงขณะจำลอง (ทุกบัซเซอร์)'), snd));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, t === 'active'
          ? 'ไดโอดกันกลับขั้ว + ความต้านทานสมมูลให้ได้กระแสกำหนดที่แรงดันกำหนด · ดังเมื่อกระแส > 30% ของค่ากำหนด'
          : 'ความต้านทานขดลวด (ไม่รวมความเหนี่ยวนำ) · แอปวัดความถี่ของกระแสจากผลจำลองทุกก้าว (ย้อนหลัง 40 ms) ดังเมื่อกระแสแกว่ง ≥ 1 mA ในช่วง 20 Hz–20 kHz'),
        numField(app, part, 'ratedVoltage', 'แรงดันกำหนด', 'V'),
        numField(app, part, 'ratedCurrent', 'กระแสกำหนด', 'A'),
        numField(app, part, 'frequency', t === 'active' ? 'ความถี่เสียง' : 'ความถี่เรโซแนนซ์', 'Hz'),
        ...(t === 'passive' ? [numField(app, part, 'coilResistance', 'ความต้านทานขดลวด', 'Ω')] : [])));
      break;
    }
    case 'pushbutton': {
      const hold = h('button', { class: `btn ${part.params.pressed ? 'primary' : ''}`, id: 'f-press', style: 'width:100%;min-height:52px;touch-action:none;user-select:none', 'aria-pressed': String(part.params.pressed) },
        part.params.pressed ? 'กำลังกด — ปล่อยเพื่อปล่อยปุ่ม' : 'กดค้างที่นี่ = กดปุ่ม');
      // แผงถูกวาดใหม่ทันทีที่สถานะเปลี่ยน ปุ่มนี้จึงถูกแทนที่ระหว่างกด — การปล่อยจับจาก pointerup/keyup ของ window (App.onUp)
      hold.addEventListener('pointerdown', (e) => { e.preventDefault(); app.setButtonPressed(part.id, true, null); });
      hold.addEventListener('keydown', (e) => {
        if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
        e.preventDefault();
        app.setButtonPressed(part.id, true, null);
        window.addEventListener('keyup', () => app.setButtonPressed(part.id, false), { once: true });
      });
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-press' }, `สถานะ: ${part.params.pressed ? 'กดอยู่ (ขา 1–2 ต่อกับ 3–4)' : 'ปล่อย (ไม่ต่อ)'}`), hold));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ปุ่มกดติดปล่อยดับ 6 × 6 mm: วางคร่อมร่องกลาง (ขา 1, 3 แถวที่แตะ ขา 2, 4 อีกฝั่งร่อง) · ขา 1–2 และ 3–4 ต่อถึงกันภายในเสมอ กดปุ่มแล้วจึงต่อคู่ซ้ายกับคู่ขวา · ในฉาก 3 มิติ: แตะค้างที่ก้านปุ่ม = กด · การกดไม่ถูกบันทึกในประวัติ Undo'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'กด = ความต้านทานหน้าสัมผัสระหว่างขา 1 กับ 3 · ปล่อย = เปิดวงจร · ไม่จำลองการเด้งของหน้าสัมผัส (contact bounce)'),
        numField(app, part, 'contactResistance', 'ความต้านทานหน้าสัมผัสขณะกด', 'Ω'),
        numField(app, part, 'maxCurrent', 'พิกัดกระแสหน้าสัมผัส', 'A'),
        numField(app, part, 'maxVoltage', 'พิกัดแรงดัน', 'V')));
      break;
    }
    case 'potentiometer': {
      const { resistance: R, position: pos, endResistance: re } = part.params;
      const setPos = (v: number) => {
        const p = Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
        if (p !== part.params.position) app.apply(setPartParams(app.doc, part.id, { position: p }), `หมุน ${part.label} ไปที่ ${(p * 100).toFixed(1)}%`);
      };
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ค่าความต้านทานรวม (ขา 1–3) · รหัสบนตัว'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ค่า VR' }, ...POT_VALUES.map((v) => h('button', { class: 'chip', id: `f-pot-${v}`, 'aria-pressed': String(R === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { resistance: v }), `ตั้ง ${part.label} = ${formatSI(v, 'Ω')}`) }, `${formatSI(v, 'Ω')} (${potCodeText(v)})`)))));
      const out = h('output', { id: 'f-pos-out', for: 'f-pos' }, `${(pos * 100).toFixed(1)}%`);
      const slider = h('input', { type: 'range', id: 'f-pos', min: '0', max: '1000', step: '1', value: String(Math.round(pos * 1000)), 'aria-label': 'ตำแหน่งแกนกลาง (wiper)', style: 'width:100%' }) as HTMLInputElement;
      const segText = (p: number) => `R(1–2) ≈ ${formatSI(R * p + re, 'Ω', 3)} · R(2–3) ≈ ${formatSI(R * (1 - p) + re, 'Ω', 3)}`;
      const seg = h('p', { class: 'help', id: 'f-pos-seg', style: 'font-size:13px;margin:4px 0' }, segText(pos));
      slider.addEventListener('input', () => { const p = Number(slider.value) / 1000; out.textContent = `${(p * 100).toFixed(1)}%`; seg.textContent = segText(p); });
      slider.addEventListener('change', () => setPos(Number(slider.value) / 1000));
      const step = (d: number, label: string) => h('button', { class: 'btn', onclick: () => setPos(part.params.position + d), 'aria-label': `หมุน ${label}` }, label);
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-pos' }, 'ตำแหน่งแกนกลาง (หมุนสกรู) — 0% ชิดขา 1, 100% ชิดขา 3 ', out), slider,
        h('div', { class: 'btn-row' }, step(-0.1, '−10%'), step(-0.01, '−1%'), step(0.01, '+1%'), step(0.1, '+10%')), seg));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, `ทริมพอต 25 รอบ (แบบ 3296W): ขา 1–2–3 เรียงแถวเดียว ขา 2 กลาง = แกนกลาง (wiper) · ต่อขา 1 และ 3 คร่อมแหล่งจ่ายจะได้แรงดันที่ขา 2 ปรับได้ (วงแบ่งแรงดัน) · ต่อขา 1–2 หรือ 2–3 อย่างเดียวจะเป็นตัวต้านทานปรับค่า (rheostat) · 1% ของช่วง = ¼ รอบสกรู`));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (เชิงเส้น)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'R(1–2) = R·p + Rend, R(2–3) = R·(1 − p) + Rend · พิกัดกำลังใช้กับทั้งเส้น ส่วนที่ใช้เพียงบางส่วนทนได้ตามสัดส่วนความยาว · ไม่จำลองสัญญาณรบกวนจากหน้าสัมผัสและการเปลี่ยนค่าตามอุณหภูมิ'),
        numField(app, part, 'endResistance', 'ความต้านทานปลาย Rend', 'Ω'),
        numField(app, part, 'powerRating', 'พิกัดกำลัง (ทั้งเส้น)', 'W')));
      break;
    }
    case 'resistor': {
      nodes.push(numField(app, part, 'resistance', 'ความต้านทาน (R)', 'Ω', 'พิมพ์ได้ เช่น 220, 4.7k, 1M · แถบสีบนโมเดลเปลี่ยนตามค่า'));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ค่ามาตรฐาน' },
        ...E12_QUICK.map((v) => h('button', { class: 'chip', 'aria-pressed': String(part.params.resistance === v), onclick: () => app.apply(setPartParams(app.doc, part.id, { resistance: v }), `ตั้ง R ของ ${part.label} = ${formatSI(v, 'Ω')}`) }, formatSI(v, 'Ω')))));
      nodes.push(numField(app, part, 'powerRating', 'พิกัดกำลัง', 'W'));
      const span = h('select', { id: 'f-span', 'aria-label': 'ระยะขา' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => h('option', { value: String(n), selected: n === part.params.span }, `${n} ช่อง`)));
      span.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { span: Number(span.value) }), `เปลี่ยนระยะขา ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-span' }, 'ระยะห่างขา (บนบอร์ด)'), h('div', { class: 'row' }, span)));
      break;
    }
    case 'led': {
      const color = h('select', { id: 'f-color' }, ...(Object.keys(LED_NAMES) as LedColor[]).map((c) => h('option', { value: c, selected: c === part.params.color }, `${LED_NAMES[c]} (${c})`)));
      color.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, ledParamsFor(color.value as LedColor)), `เปลี่ยนสี ${part.label}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-color' }, 'สี (เปลี่ยนแล้วพารามิเตอร์ตั้งตามสี)'), h('div', { class: 'row' }, color)));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขา A (แอโนด, ขายาว) → ขา K (แคโทด, ด้านแบน) กระแสไหลได้เมื่อ A สูงกว่า K'));
      nodes.push(h('details', { open: true }, h('summary', {}, 'แบบจำลอง LED (Shockley + Rs)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'I = Is·(e^(Vd/(n·Vt)) − 1), Vt = 25.85 mV, แรงดันรวม = Vd + I·Rs'),
        numField(app, part, 'Is', 'กระแสอิ่มตัว Is', 'A'),
        numField(app, part, 'n', 'ค่า ideality n', ''),
        numField(app, part, 'Rs', 'ความต้านทานอนุกรม Rs', 'Ω'),
        numField(app, part, 'ratedCurrent', 'กระแสใช้งาน (สเกลความสว่าง)', 'A'),
        numField(app, part, 'maxCurrent', 'กระแสสูงสุดก่อนแจ้งเกินพิกัด', 'A'),
        numField(app, part, 'maxReverseVoltage', 'แรงดันย้อนสูงสุด', 'V')));
      break;
    }
    case 'switch': {
      nodes.push(h('div', { class: 'btn-row' },
        h('button', { class: `btn ${part.params.closed ? 'primary' : ''}`, onclick: () => app.apply(setPartParams(app.doc, part.id, { closed: !part.params.closed }), `${part.params.closed ? 'เปิด' : 'ปิด'}สวิตช์ ${part.label}`) },
          part.params.closed ? 'สถานะ: ปิดวงจร (ON) — แตะเพื่อเปิด' : 'สถานะ: เปิดวงจร (OFF) — แตะเพื่อปิด')));
      nodes.push(numField(app, part, 'onResistance', 'ความต้านทานขณะปิด', 'Ω'));
      break;
    }
    case 'fgen': {
      const on = h('input', { type: 'checkbox', checked: part.params.outputOn, id: 'f-fgon' });
      on.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { outputOn: on.checked }), `${on.checked ? 'เปิด' : 'ปิด'}เอาต์พุต ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, on, 'เปิดเอาต์พุต (Output ON)'));
      const waves: Array<[typeof part.params.wave, string]> = [['sine', 'ไซน์'], ['square', 'สี่เหลี่ยม'], ['triangle', 'สามเหลี่ยม'], ['dc', 'DC']];
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'รูปคลื่น'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'รูปคลื่น' }, ...waves.map(([w, name]) =>
          h('button', { class: 'chip', id: `f-wave-${w}`, 'aria-pressed': String(part.params.wave === w), onclick: () => app.apply(setPartParams(app.doc, part.id, { wave: w }), `ตั้งรูปคลื่น ${name}`) }, name)))));
      nodes.push(numField(app, part, 'frequency', 'ความถี่', 'Hz', 'พิมพ์ได้ เช่น 50, 1k, 10k'));
      nodes.push(numField(app, part, 'vpp', 'แอมพลิจูดยอดถึงยอด (Vpp, ขณะไม่มีโหลด)', 'V'));
      nodes.push(numField(app, part, 'offset', 'DC offset', 'V'));
      nodes.push(h('details', {}, h('summary', {}, 'พารามิเตอร์แบบจำลอง'), numField(app, part, 'outputImpedance', 'ความต้านทานขาออก', 'Ω', 'เครื่องจริงทั่วไป 50 Ω — แรงดันที่ขั้วลดลงเมื่อต่อโหลดค่าต่ำ')));
      break;
    }
    case 'scope': {
      nodes.push(h('p', { style: 'font-size:13px;color:var(--ink-2)' }, 'ต่อสายจากจุดที่ต้องการวัดเข้า CH1/CH2 และต่อ GND ของเครื่องเข้ากับจุดอ้างอิงของวงจร กด Run แล้วดูรูปคลื่นที่แผงออสซิลโลสโคปด้านล่าง'));
      nodes.push(numField(app, part, 'inputResistance', 'ความต้านทานขาเข้าแต่ละช่อง', 'Ω', 'ออสซิลโลสโคปทั่วไป 1 MΩ'));
      nodes.push(h('p', { style: 'font-size:12.5px;color:var(--ink-3)' }, 'ค่าตั้งหน้าเครื่อง (time/div, V/div, trigger) บันทึกไปกับไฟล์งาน · แสดงได้ทีละหนึ่งเครื่องในแผง'));
      break;
    }
    case 'capacitor': {
      nodes.push(numField(app, part, 'capacitance', 'ความจุ (C)', 'F', 'พิมพ์ได้ เช่น 100u, 4.7u, 10n (u = ไมโคร)'));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ค่าที่ใช้บ่อย' },
        ...C_QUICK.map((v) => h('button', { class: 'chip', 'aria-pressed': String(Math.abs(part.params.capacitance - v) < v * 1e-9), onclick: () => app.apply(setPartParams(app.doc, part.id, { capacitance: v }), `ตั้ง C ของ ${part.label} = ${formatSI(v, 'F')}`) }, formatSI(v, 'F')))));
      const pol = h('input', { type: 'checkbox', checked: part.params.polarized, id: 'f-pol' });
      pol.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { polarized: pol.checked }), `${pol.checked ? 'ตั้งเป็นอิเล็กโทรไลต์ (มีขั้ว)' : 'ตั้งเป็นแบบไม่มีขั้ว'} ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, pol, 'อิเล็กโทรไลต์ (มีขั้ว + / −)'));
      nodes.push(numField(app, part, 'ratedVoltage', 'พิกัดแรงดัน', 'V'));
      nodes.push(numField(app, part, 'initialVoltage', 'แรงดันเริ่มต้นเมื่อเริ่มเวลา', 'V', 'ใช้ตอนกด Run หรือ "เริ่มใหม่" — ค่า 0 = ตัวเก็บประจุว่าง'));
      nodes.push(spanField(app, part));
      nodes.push(h('p', { style: 'font-size:12.5px;color:var(--ink-3)' }, 'แบบจำลอง: ตัวเก็บประจุอุดมคติ i = C·dv/dt ไม่มีกระแสรั่วหรือ ESR'));
      break;
    }
    case 'inductor': {
      nodes.push(numField(app, part, 'inductance', 'ความเหนี่ยวนำ (L)', 'H', 'พิมพ์ได้ เช่น 10m, 100u'));
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'ค่าที่ใช้บ่อย' },
        ...L_QUICK.map((v) => h('button', { class: 'chip', 'aria-pressed': String(Math.abs(part.params.inductance - v) < v * 1e-9), onclick: () => app.apply(setPartParams(app.doc, part.id, { inductance: v }), `ตั้ง L ของ ${part.label} = ${formatSI(v, 'H')}`) }, formatSI(v, 'H')))));
      nodes.push(numField(app, part, 'resistance', 'ความต้านทานขดลวด (DCR)', 'Ω'));
      nodes.push(numField(app, part, 'ratedCurrent', 'พิกัดกระแส', 'A'));
      nodes.push(spanField(app, part));
      nodes.push(h('p', { style: 'font-size:12.5px;color:var(--ink-3)' }, 'แบบจำลอง: v = L·di/dt + DCR·i ไม่จำลองแกนอิ่มตัว'));
      break;
    }
    case 'diode': {
      const model = h('select', { id: 'f-dmodel' }, ...(Object.keys(DIODE_NAMES) as DiodeModel[]).map((m) => h('option', { value: m, selected: m === part.params.model }, DIODE_NAMES[m])));
      model.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { ...diodeParamsFor(model.value as DiodeModel), span: part.params.span }), `เปลี่ยนรุ่น ${part.label} เป็น ${model.value}`));
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-dmodel' }, 'รุ่น (เปลี่ยนแล้วพารามิเตอร์ตั้งตามรุ่น)'), h('div', { class: 'row' }, model)));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, part.params.model === 'Z5V1'
        ? 'ซีเนอร์ใช้งานแบบไบแอสกลับ: ขา K (ฝั่งแถบ) ต่อด้านบวก แรงดันคร่อมคงที่ราว Vz เมื่อมีกระแสย้อนพอ ต้องมีตัวต้านทานจำกัดกระแสเสมอ'
        : 'ขา A (แอโนด) → ขา K (แคโทด, ฝั่งแถบ) นำกระแสเมื่อ A สูงกว่า K ราว 0.6–0.7 V'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลองไดโอด (Shockley + Rs + พังทลายย้อนกลับ)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'I = Is·(e^(Vd/(n·Vt)) − 1) − Ibv·e^(−(Vd+Bv)/Vt), Vt = 25.85 mV'),
        numField(app, part, 'Is', 'กระแสอิ่มตัว Is', 'A'),
        numField(app, part, 'n', 'ค่า ideality n', ''),
        numField(app, part, 'Rs', 'ความต้านทานอนุกรม Rs', 'Ω'),
        numField(app, part, 'Bv', 'แรงดันพังทลาย Bv (ซีเนอร์ = Vz)', 'V'),
        numField(app, part, 'Ibv', 'กระแสที่แรงดัน Bv', 'A'),
        numField(app, part, 'maxCurrent', 'กระแสสูงสุด (เฉลี่ย)', 'A'),
        numField(app, part, 'maxPower', 'กำลังสูงสุด', 'W')));
      nodes.push(spanField(app, part));
      break;
    }
    case 'bjt': {
      const pol = part.params.polarity;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'ชนิด'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ชนิดทรานซิสเตอร์' }, ...(['npn', 'pnp'] as const).map((p) =>
          h('button', { class: 'chip', id: `f-pol-${p}`, 'aria-pressed': String(pol === p), onclick: () => app.apply(setPartParams(app.doc, part.id, bjtParamsFor(p)), `ตั้ง ${part.label} เป็น ${p === 'npn' ? 'NPN 2N3904' : 'PNP 2N3906'}`) }, p === 'npn' ? 'NPN (2N3904)' : 'PNP (2N3906)')))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขาเรียงจากซ้าย (มองด้านแบน): E – B – C · ' + (pol === 'npn' ? 'NPN นำกระแสเมื่อ B สูงกว่า E ราว 0.65 V' : 'PNP นำกระแสเมื่อ B ต่ำกว่า E ราว 0.65 V')));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง Ebers–Moll (transport)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'Ic = Is·(e^(Vbe/Vt) − e^(Vbc/Vt)) − (Is/βr)·(e^(Vbc/Vt) − 1) ไม่จำลอง Early effect และความจุภายใน'),
        numField(app, part, 'Is', 'กระแสอิ่มตัว Is', 'A'),
        numField(app, part, 'bf', 'อัตราขยายกระแส βF (hFE)', ''),
        numField(app, part, 'br', 'อัตราขยายย้อน βR', ''),
        numField(app, part, 'maxIc', 'กระแส Ic สูงสุด', 'A'),
        numField(app, part, 'maxVce', 'แรงดัน Vce สูงสุด', 'V'),
        numField(app, part, 'maxPower', 'กำลังสูงสุด', 'W')));
      break;
    }
    case 'mosfet': {
      const models = ['2N7000', 'IRLZ44N', 'IRF9540N'] as const;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'รุ่น'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'รุ่นมอสเฟต' }, ...models.map((m) =>
          h('button', { class: 'chip', id: `f-mos-${m}`, 'aria-pressed': String(part.params.model === m), onclick: () => app.apply(setPartParams(app.doc, part.id, mosfetParamsFor(m)), `ตั้ง ${part.label} เป็น ${m}`) }, MOSFET_NAMES[m])))));
      const n = part.params.polarity === 'n';
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' },
        (part.params.model === '2N7000' ? 'ขาเรียงจากซ้าย (มองด้านแบน): S – G – D · ' : 'ขาเรียงจากซ้าย (มองด้านหน้า แผ่นโลหะอยู่ด้านหลัง): G – D – S · แผ่นโลหะต่อกับ D · ') +
        (n ? `ช่อง N: นำกระแส D → S เมื่อ Vgs สูงกว่าขีดเริ่ม ${part.params.vth} V — ใช้เป็นสวิตช์ฝั่งกราวด์ (S ลงกราวด์ โหลดต่อระหว่างไฟบวกกับ D)` : `ช่อง P: นำกระแส S → D เมื่อเกตต่ำกว่า S เกิน ${part.params.vth} V — ใช้เป็นสวิตช์ฝั่งไฟบวก (S ต่อไฟบวก โหลดต่อระหว่าง D กับกราวด์)`) +
        ' · ควรมีตัวต้านทาน pull-down/pull-up ที่เกต'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลองระดับ 1 (Shichman–Hodges) + ไดโอดในตัว'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'อิ่มตัว: Id = KP/2·(Vgs − Vth)²·(1 + λVds) · เชิงเส้น: Id = KP·((Vgs − Vth)·Vds − Vds²/2)·(1 + λVds) · ใต้ขีดเริ่มกระแสลดแบบเอกซ์โพเนนเชียล · ไม่จำลองความจุเกตและเวลาสวิตช์'),
        numField(app, part, 'vth', 'แรงดันขีดเริ่ม |Vgs(th)|', 'V'),
        numField(app, part, 'kp', 'ค่าคงที่ความนำ KP', 'A/V²'),
        numField(app, part, 'lambda', 'λ (channel-length modulation)', '1/V'),
        numField(app, part, 'maxId', 'กระแสเดรนสูงสุด', 'A'),
        numField(app, part, 'maxVds', '|Vds| สูงสุด', 'V'),
        numField(app, part, 'maxVgs', '|Vgs| สูงสุด', 'V'),
        numField(app, part, 'maxPower', 'กำลังสูงสุด (ไม่มีฮีตซิงก์)', 'W')));
      break;
    }
    case 'opamp': {
      const models = ['LM741', 'MCP6002'] as const;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'รุ่น'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'รุ่นออปแอมป์' }, ...models.map((m) =>
          h('button', { class: 'chip', id: `f-op-${m}`, 'aria-pressed': String(part.params.model === m), onclick: () => app.apply(setPartParams(app.doc, part.id, opampParamsFor(m)), `ตั้ง ${part.label} เป็น ${m}`) }, m === 'LM741' ? 'LM741 (±5…±18 V, 1 MHz, 0.5 V/µs)' : 'MCP6002 (rail-to-rail ≤ 6 V, 1 MHz, 0.6 V/µs)')))));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'วางคร่อมร่องกลาง (ขา 1 แถว f, ขา 8 แถว e) รอยบากอยู่ฝั่งขา 1 มองจากด้านบนนับขาทวนเข็มนาฬิกา · ขา 2 IN−, 3 IN+, 4 V−, 6 OUT, 7 V+ · ต้องต่อไฟเลี้ยงทั้ง V+ และ V− ก่อนใช้งาน'));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลอง (มหภาค: อิ่มตัว + ขั้วเดียว + slew rate)'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'Vo = กลางไฟเลี้ยง + H·tanh(w/H), H = (V+ − V− − 2·headroom)/2 · DC: w = A·Vd · ตามเวลา: τ·dw/dt = A·Vd − w (ขั้วเดียว τ = A/(2π·GBW)) และขาออกเปลี่ยนเร็วได้ไม่เกิน slew rate · กราฟโบดใช้ A/(1 + jf·A/GBW) · ไม่จำลองแรงดันออฟเซ็ต การจำกัดกระแสขาออก และขั้วที่สอง'),
        numField(app, part, 'gain', 'อัตราขยายวงเปิด A', ''),
        numField(app, part, 'gbw', 'ผลคูณอัตราขยาย-แบนด์วิดท์ GBW', 'Hz'),
        numField(app, part, 'slewRate', 'Slew rate (V/s เช่น 0.5M = 0.5 V/µs)', 'V/s'),
        numField(app, part, 'outputResistance', 'ความต้านทานขาออก', 'Ω'),
        numField(app, part, 'headroom', 'ระยะห่างขาออกจากไฟเลี้ยง', 'V'),
        numField(app, part, 'inputResistance', 'ความต้านทานขาเข้า', 'Ω'),
        numField(app, part, 'quiescentResistance', 'ความต้านทานสมมูลกระแสนิ่ง', 'Ω'),
        numField(app, part, 'maxSupply', 'ไฟเลี้ยงสูงสุด (V+ − V−)', 'V')));
      break;
    }
    case 'pico': {
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'Raspberry Pi Pico (RP2040, micro-USB, ไม่มี Wi-Fi) แบบบัดกรีขา header · วางคร่อมร่องกลาง: ขา 1–20 อยู่แถวที่แตะ (เช่น h) ขา 21–40 ห่างไป 7 แถว (แถว c) ขา 1 อยู่ฝั่ง USB · ชื่อขาบนบอร์ดจริงพิมพ์ไว้ด้านล่าง แอปจึงแสดงป้ายชื่อขาข้างบอร์ดเมื่อเลือก · ขา GND ทุกขาต่อถึงกันภายในบอร์ด · GPIO ใช้ระดับ 3.3 V (ไม่ทน 5 V)'));
      const auto = h('input', { type: 'checkbox', checked: part.params.autorun, id: 'f-autorun' });
      auto.addEventListener('change', () => app.apply(setPartParams(app.doc, part.id, { autorun: auto.checked }), `${auto.checked ? 'เปิด' : 'ปิด'}การรันโค้ดอัตโนมัติ ${part.label}`));
      nodes.push(h('label', { class: 'toggle field' }, auto, 'รันโค้ดอัตโนมัติเมื่อบอร์ดเริ่มทำงาน (เหมือน main.py)'));
      const code = h('textarea', { id: 'f-code', class: 'pc-code', spellcheck: 'false', autocapitalize: 'off', wrap: 'off', 'aria-label': 'โค้ด MicroPython' }) as HTMLTextAreaElement;
      code.value = app.picoDraft?.id === part.id ? app.picoDraft.code : part.params.code;
      code.addEventListener('input', () => { app.picoDraft = { id: part.id, code: code.value }; });
      code.addEventListener('change', () => app.picoCommit(code.value));
      code.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end'); app.picoDraft = { id: part.id, code: code.value }; } });
      nodes.push(h('div', { class: 'field' }, h('label', { for: 'f-code' }, 'โค้ด MicroPython (แก้ได้ทั้งตอนหยุดและตอนจำลอง)'), code));
      nodes.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', id: 'f-run-code', onclick: () => { if (!app.running) { app.picoCommit(code.value); app.run(); } else app.picoRun(code.value); } }, svg(icon('run')), app.running ? 'รันโค้ดนี้' : 'Run (บูตบอร์ดแล้วรันโค้ด)')));
      nodes.push(h('details', {}, h('summary', {}, 'แบบจำลองไฟฟ้าของขา'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ขาออก = 3.3 V หรือ 0 V ผ่าน 80 Ω (กระแสลัดวงจรไม่เกิน 50 mA) · pull-up/pull-down ≈ 50 kΩ · ขาเข้าเป็น HIGH เมื่อ > 1.8 V, LOW เมื่อ < 1.4 V · ADC 0–3.3 V 12 บิต · ขา 3V3 จ่ายได้ 300 mA · VBUS 5 V จาก USB')));
      break;
    }
    case 'dmm': {
      const pr = part.params;
      nodes.push(h('div', { class: 'field' }, h('label', {}, 'สวิตช์เลือกย่าน (ปรับย่านอัตโนมัติ)'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'ย่านมัลติมิเตอร์ดิจิทัล' }, ...DMM_MODES.map((m) =>
          h('button', { class: 'chip', id: `f-dmm-${m.id}`, 'aria-pressed': String(pr.mode === m.id), title: m.label, onclick: () => app.apply(setPartParams(app.doc, part.id, { mode: m.id }), `หมุน ${part.label} ไปที่ ${m.dial}`) }, m.dial)))));
      nodes.push(h('p', { class: 'help', id: 'dmm-howto', style: 'font-size:13px;color:var(--ink-2)' }, DMM_HOWTO[pr.mode]));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขั้วเสียบ (ซ้าย → ขวา): 10 A · mA µA · COM (สายดำ) · VΩ — ต่อสายจากขั้วไปจิ้มรูบนบอร์ดด้วยเครื่องมือ "ต่อสาย" (ปลายสายเป็นปากกาโพรบ)'));
      nodes.push(h('details', {}, h('summary', {}, 'สเปกและแบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, `จอ 4000 count ย่าน V⎓/V~ 4 · 40 · 400 · 1000 V ขาเข้า ${formatSI(pr.inputResistance, 'Ω')} · ย่าน mV 400 mV ขาเข้า ${formatSI(pr.mvInputResistance, 'Ω')} · ย่าน Ω 400 Ω – 40 MΩ (แหล่งทดสอบ ${pr.ohmVoc} V ผ่าน ${formatSI(pr.ohmRs, 'Ω')}) · ย่าน mA 400 µA – 400 mA shunt ${formatSI(pr.shuntMa, 'Ω')} ฟิวส์ ${formatSI(pr.fuseMa, 'A')} · ย่าน A ถึง 10 A shunt ${formatSI(pr.shuntA, 'Ω')} ฟิวส์ ${formatSI(pr.fuseA, 'A')}`),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'ย่าน DC แสดงค่าเฉลี่ยตามเวลา (เช่น PWM 50% จาก 3.3 V อ่านได้ ≈ 1.65 V) · ย่าน AC ตัดไฟตรงออกแล้วแสดงค่า rms ของคลื่นไซน์ (ตอบสนองค่าเฉลี่ย — คลื่นสี่เหลี่ยม/สามเหลี่ยมอ่านคลาดจาก rms จริง) · ค่า shunt/ฟิวส์/แหล่งทดสอบ Ω เป็นค่าประมาณของเครื่องระดับนี้ · ฟิวส์ขาดเมื่อกระแสเกิน 1.5 เท่าของพิกัด (เริ่มจำลองใหม่ = ใส่ฟิวส์ใหม่)')));
      break;
    }
    case 'vom': {
      const pr = part.params, pos = vomPosition(pr.sel);
      const groups: Array<[string, VomPosition['mode'][]]> = [['ปิด / DCV (สเกลดำ)', ['off', 'dcv']], ['ACV (สเกลแดง)', ['acv']], ['DCA', ['dca']], ['Ω (สเกลเขียว)', ['ohm']]];
      for (const [title, modes] of groups) {
        nodes.push(h('div', { class: 'field' }, h('label', {}, title),
          h('div', { class: 'chips', role: 'group', 'aria-label': title }, ...VOM_POSITIONS.filter((q) => modes.includes(q.mode)).map((q) =>
            h('button', { class: 'chip', id: `f-vom-${q.id.replace('.', '_')}`, 'aria-pressed': String(pr.sel === q.id), onclick: () => app.apply(setPartParams(app.doc, part.id, { sel: q.id }), `หมุน ${part.label} ไปที่ ${q.label}`) }, q.mode === 'off' ? 'OFF' : q.dial)))));
      }
      nodes.push(h('p', { class: 'help', id: 'vom-howto', style: 'font-size:13px;color:var(--ink-2)' }, vomScaleHint(pos, pr.sensitivityDC, pr.sensitivityAC, pr.centerOhm)));
      nodes.push(h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' }, 'ขั้วเสียบ: + (สายแดง) ขวาล่าง · − COM (สายดำ) ซ้ายล่าง — เลือกย่านสูงไว้ก่อนเมื่อไม่รู้ค่า แล้วค่อยลดย่านให้เข็มตีเกินครึ่งสเกล · มองเข็มตรง ๆ ให้เงาในแถบกระจกซ้อนกับเข็ม (ลดพาราแลกซ์)'));
      nodes.push(h('details', {}, h('summary', {}, 'สเปกและแบบจำลอง'),
        h('p', { style: 'font-size:13px;margin:4px 0' }, `ความไว DCV ${pr.sensitivityDC / 1000} kΩ/V (ย่าน 250/1000 V และ ACV ${pr.sensitivityAC / 1000} kΩ/V) → ความต้านทานขาเข้า = ความไว × ย่าน เช่น ย่าน 10 V = ${formatSI(pr.sensitivityDC * 10, 'Ω')} · ย่าน DCA แรงดันตกเต็มสเกล 0.1 V (50 µA) และ 0.25 V (ย่านอื่น, ค่าประมาณ) · ย่าน Ω แบตเตอรี่ ${pr.battery} V ค่ากลางสเกล ${pr.centerOhm} Ω × ตัวคูณ (ค่าประมาณ) ปรับศูนย์ 0 Ω ไว้แล้ว · ฟิวส์ ${pr.fuse} A`),
        h('p', { style: 'font-size:13px;margin:4px 0' }, 'เข็มเคลื่อนแบบมวล-สปริงหน่วง (ถึงค่าในราว 0.4 วินาที) · ย่าน AC ตอบสนองค่าเฉลี่ยปรับเทียบ rms ของไซน์ · เข็มตีเกินสเกลหรือตีกลับจะชนหมุดกั้น')));
      break;
    }
    case 'ammeter': {
      nodes.push(h('p', { style: 'font-size:13px;color:var(--ink-2)' }, 'ต่ออนุกรมในเส้นทางกระแส: กระแสเข้าขั้ว A ออกขั้ว COM จะอ่านเป็นบวก'));
      nodes.push(numField(app, part, 'shuntResistance', 'ความต้านทานภายใน (shunt)', 'Ω', 'ค่าจริงของมิเตอร์มีผลต่อวงจรเล็กน้อย'));
      nodes.push(numField(app, part, 'range', 'ย่านวัด', 'A'));
      break;
    }
  }

  // ตำแหน่งขา
  const conn = app.conn();
  const pinsTable = h('table', { class: 'reading-table' }, h('tr', {}, h('th', {}, 'ขา'), h('th', {}, 'ตำแหน่ง'), h('th', {}, 'เน็ต')));
  const holes = pinHolesFor(part);
  for (const d of pinDefs(part)) {
    const ph = holes.find((x) => x.pin === d.name);
    const net = netOfPin(conn, part.id, d.name);
    const wires = app.doc.wires.filter((w) => [w.a, w.b].some((t) => t.kind === 'pin' && t.partId === part.id && t.pin === d.name)).length;
    const where = ph?.hole ? holeLabel(ph.hole) : part.placement.kind === 'table' ? (catalogEntry(part.kind)?.mount === 'board' ? 'บนโต๊ะ' : 'ขั้วบนเครื่อง') : '—';
    pinsTable.append(h('tr', {}, h('td', {}, d.label), h('td', {}, wires ? `${where} + สาย ${wires}` : where), h('td', {}, net !== undefined ? `N${net}` : '—')));
  }
  const boardKind = catalogEntry(part.kind)?.mount === 'board';
  nodes.push(h('h3', {}, 'การเชื่อมต่อ'));
  if (boardKind) nodes.push(h('p', { class: 'help', id: 'prop-mount' }, part.placement.kind === 'board'
      ? 'เสียบอยู่บนเบรดบอร์ด: ขาแต่ละขาเชื่อมกับกลุ่มรูที่เสียบ'
      : 'วางบนโต๊ะนอกเบรดบอร์ด: ขายังไม่ต่อกับอะไร จนกว่าจะต่อสายเข้าขา (เครื่องมือต่อสาย → แตะขา) การวางใกล้กันไม่ทำให้เกิดการเชื่อมต่อ'));
  nodes.push(pinsTable);
  nodes.push(h('div', { id: 'prop-readings' }));
  nodes.push(h('div', { class: 'btn-row' },
    h('button', { class: 'btn', onclick: () => app.rotateSelected() }, svg(icon('rotate')), 'หมุน 90°'),
    h('button', { class: 'btn', onclick: () => app.duplicateSelected() }, svg(icon('copy')), 'คัดลอก'),
    h('button', { class: 'btn danger', onclick: () => app.deleteSelected() }, svg(icon('trash')), 'ลบ')));
  return nodes;
}

function updateReadings(app: App) {
  const box = document.getElementById('prop-readings');
  const s = app.selection;
  if (!box || s?.t !== 'part') return;
  const sim = app.freshSim;
  const part = app.doc.parts.find((p) => p.id === s.id);
  if (!part) return;
  if (!app.running) { box.replaceChildren(); return; }
  if (part.kind === 'scope') { box.replaceChildren(h('h3', {}, 'ค่าจากการจำลอง'), h('p', { class: 'empty' }, 'ดูรูปคลื่นและค่าที่วัดได้ในแผงออสซิลโลสโคปด้านล่าง')); return; }
  if (part.kind === 'pico') {
    const m = app.mcu;
    const rows: Array<[string, string]> = [['สถานะ', !m ? 'รอการจำลอง' : !m.booted ? 'กำลังบูต' : m.running ? 'โปรแกรมกำลังทำงาน' : 'REPL พร้อม']];
    if (m) rows.push(['ความเร็ว', m.ratio >= 0.95 ? 'ทันเวลาจริง' : `ช้ากว่าเวลาจริง ${(1 / Math.max(m.ratio, 1e-3)).toFixed(1)} เท่า`], ['LED บนบอร์ด (GP25)', m.led > 0.5 ? 'ติด' : 'ดับ']);
    const conn = app.conn();
    const gnd = netOfPin(conn, part.id, 'GND');
    for (const pin of PICO_GPIO) {
      const net = netOfPin(conn, part.id, `GP${pin}`);
      if (net === undefined || !netLinked(conn, app.doc, net) || !sim?.result.ok) continue;
      const v = gnd === undefined ? null : (sim.result.nodeVoltage[net] ?? null) as number | null;
      const g = gnd === undefined ? null : (sim.result.nodeVoltage[gnd] ?? null) as number | null;
      const mode = m?.pins[pin] ?? '';
      rows.push([`GP${pin}`, `${v === null || g === null ? '—' : (v - g).toFixed(2) + ' V'} · ${mode.startsWith('out') ? 'ขาออก' : 'ขาเข้า'}${m && mode.startsWith('out') && m.duty[pin] > 0.02 && m.duty[pin] < 0.98 ? ` (HIGH ${(m.duty[pin] * 100).toFixed(0)}%)` : ''}`]);
    }
    box.replaceChildren(h('h3', {}, 'สถานะบอร์ด'), h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), h('p', { class: 'help', style: 'font-size:12.5px;color:var(--ink-3)' }, 'แรงดันขาเทียบ GND ของบอร์ด เฉลี่ยในช่วง 50 ms'));
    return;
  }
  const r = sim?.analysis.ok ? sim.analysis.parts[part.id] : undefined;
  if (!r) { box.replaceChildren(h('h3', {}, 'ค่าจากการจำลอง'), h('p', { class: 'empty' }, sim ? 'ไม่มีค่า (การจำลองล้มเหลว หรืออุปกรณ์ไม่ทำงาน)' : 'กำลังคำนวณ…')); return; }
  const rows: Array<[string, string]> = [
    ['แรงดันคร่อม', formatSI(r.voltage, 'V', 4)],
    ['กระแส', formatSI(r.current, 'A', 4)],
    ['กำลัง', formatSI(r.power, 'W', 3)],
  ];
  if (r.mode) rows.push(['โหมด', r.mode === 'CV' ? 'CV (แรงดันคงที่)' : 'CC (จำกัดกระแส)']);
  if (r.brightness !== undefined) rows.push(['ความสว่าง (ประมาณ)', `${Math.round(Math.min(1, r.brightness) * 100)}%`]);
  if (part.kind === 'bjt' && r.extra) {
    rows.length = 0;
    const REG = ['คัตออฟ (ไม่นำกระแส)', 'แอกทีฟ (ขยาย)', 'อิ่มตัว (สวิตช์ ON)', 'กลับทิศ'];
    rows.push(['Vbe', formatSI(r.extra.vbe, 'V', 4)], ['Vce', formatSI(r.voltage, 'V', 4)], ['Ib', formatSI(r.extra.ib, 'A', 4)], ['Ic', formatSI(r.current, 'A', 4)],
      ['Ic/Ib', Math.abs(r.extra.ib) > 1e-12 ? (r.current / r.extra.ib).toFixed(1) : '—'], ['ย่านทำงาน', REG[r.extra.region] ?? '—'], ['กำลัง', formatSI(r.power, 'W', 3)]);
  }
  if (part.kind === 'scr' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    const z = (v: number, lim: number) => (Math.abs(v) < lim ? 0 : v);
    rows.push(['สถานะ', x.on ? (Math.abs(x.ig) >= x.igt ? 'ติด (มีกระแสเกต)' : 'ติดค้าง (ล็อก)') : 'ดับ'], ['IA แอโนด', formatSI(z(x.ia, 1e-12), 'A', 4)], ['VAK', formatSI(x.vak, 'V', 4)],
      ['IG เกต', formatSI(z(x.ig, 1e-12), 'A', 4)], ['VGK', formatSI(z(x.vgk, 1e-9), 'V', 4)], ['IGT / IH (ดาต้าชีต)', `${formatSI(x.igt, 'A', 3)} / ${formatSI(x.ih, 'A', 3)}`], ['กำลัง', formatSI(r.power, 'W', 3)]);
  }
  if (part.kind === 'mosfet' && r.extra) {
    rows.length = 0;
    const REG = ['ตัด (OFF)', 'เปิดเต็ม (ย่านเชิงเส้น)', 'เปิดบางส่วน (ย่านอิ่มตัว)', 'กลับทิศ (S → D)'];
    const id = Math.abs(r.current);
    rows.push(['Vgs', formatSI(r.extra.vgs, 'V', 4)], ['Vds', formatSI(r.voltage, 'V', 4)], ['Id', formatSI(r.current, 'A', 4)],
      ['ย่านทำงาน', REG[r.extra.region] ?? '—'], ['Rds (Vds/Id)', id > 1e-6 ? formatSI(Math.abs(r.voltage) / id, 'Ω', 3) : '—'], ['กำลัง', formatSI(r.power, 'W', 3)]);
    if (Math.abs(r.extra.ibody ?? 0) > 1e-6) rows.push(['ไดโอดในตัว', formatSI(r.extra.ibody, 'A', 3)]);
  }
  if (part.kind === 'motor' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ความเร็วแกนออก', `${x.rpm.toFixed(1)} rpm${Math.abs(x.rpm) < 0.5 ? ' (หยุด)' : x.rpm < 0 ? ' (หมุนกลับ)' : ''}`], ['ความเร็วแกนมอเตอร์', `${x.motorRpm.toFixed(0)} rpm`],
      ['แรงดันคร่อม (A − B)', formatSI(r.voltage, 'V', 4)], ['กระแส', formatSI(r.current, 'A', 3)], ['แรงเคลื่อนไฟฟ้าย้อนกลับ', formatSI(x.emf, 'V', 3)],
      ['แรงบิดที่แกนออก', `${x.torque.toFixed(4)} N·m (${(x.torque / 0.0981).toFixed(2)} kg·cm)`], ['กำลังไฟฟ้า', formatSI(r.power, 'W', 3)]);
  }
  if (part.kind === 'servo' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['มุมแขน', `${x.angle.toFixed(1)}°${x.moving ? ` → ${x.target.toFixed(1)}° (กำลังหมุน)` : ''}`], ['ไฟเลี้ยง', formatSI(x.vcc, 'V', 3)],
      ['ความกว้างพัลส์', x.pw > 0 ? `${(x.pw * 1000).toFixed(3)} ms` : 'ไม่มีพัลส์'], ['คาบสัญญาณ', x.period > 0 ? `${(x.period * 1000).toFixed(2)} ms (${(1 / x.period).toFixed(1)} Hz)` : '—'],
      ['กระแส (ขณะนิ่ง)', formatSI(r.current, 'A', 3)]);
  }
  if (part.kind === 'transformer' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    if (!x.on) rows.push(['สถานะ', 'ถอดปลั๊กอยู่']);
    else {
      rows.push(['แรงดันขณะนี้ A–CT / CT–B', `${formatSI(x.vA, 'V', 3)} / ${formatSI(x.vB, 'V', 3)}`]);
      if (x.ready) rows.push(['A–CT (rms)', formatSI(x.vrmsA, 'V', 4)], ['CT–B (rms)', formatSI(x.vrmsB, 'V', 4)], ['กระแสขด A / B (rms)', `${formatSI(x.irmsA, 'A', 3)} / ${formatSI(x.irmsB, 'A', 3)}`], ['กระแสยอด', formatSI(x.ipk, 'A', 3)], ['กำลังปรากฏด้านทุติยภูมิ', `${x.va.toFixed(2)} VA`]);
      else rows.push(['ค่า rms', 'กำลังวัด (ต้องจำลองอย่างน้อย 5 คาบ = 0.1 s)']);
    }
  }
  if (part.kind === 'logic' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (ขา 14 − ขา 7)', formatSI(x.vcc, 'V', 3)]);
    for (const gt of logicGates(part.params.model)) {
      const ins = gt.inputs.map((p) => `${p}=${x[`b${p}`]}`).join(' ');
      rows.push([`เกต ${gt.n}`, `${ins} → ${gt.out}=${x[`q${gt.n}`]} (${x[`vo${gt.n}`].toFixed(2)} V${Math.abs(x[`io${gt.n}`]) > 1e-5 ? `, ${formatSI(x[`io${gt.n}`], 'A', 2)}` : ''})`]);
    }
  }
  if (part.kind === 'hbridge' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['VCC1 (ขา 16) / VCC2 (ขา 8)', `${formatSI(x.vcc1, 'V', 3)} / ${formatSI(x.vcc2, 'V', 3)}`]);
    for (const ch of L293D_CHANNELS) {
      const s = x[`s${ch.n}`];
      rows.push([`ช่อง ${ch.n} (${ch.y})`, `${s < 0 ? 'ลอย (EN ต่ำ)' : s ? 'สูง' : 'ต่ำ'} · ${x[`vy${ch.n}`].toFixed(2)} V${Math.abs(x[`iy${ch.n}`]) > 1e-4 ? ` · ${formatSI(Math.abs(x[`iy${ch.n}`]), 'A', 3)}` : ''}${Math.abs(x[`ik${ch.n}`]) > 1e-3 ? ` · ไดโอดกันย้อน ${formatSI(Math.abs(x[`ik${ch.n}`]), 'A', 2)}` : ''}`]);
    }
    rows.push(['กำลังสูญเสียในไอซี', `${x.pd.toFixed(2)} W`]);
  }
  if (part.kind === 'lm35' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['อุณหภูมิ', `${x.temp} °C`], ['ไฟเลี้ยง (+VS − GND)', formatSI(x.vs, 'V', 3)], ['VOUT', `${formatSI(x.vout, 'V', 4)} (ทฤษฎี ${formatSI(x.vexp, 'V', 4)})`],
      ['VOUT ÷ 10 mV', `${(x.vout * 100).toFixed(1)} °C`], ['กระแสนิ่ง', formatSI(x.iq, 'A', 3)]);
    if (Math.abs(x.iout) > 1e-7) rows.push(['กระแสขาออก', formatSI(x.iout, 'A', 3)]);
  }
  if (part.kind === 'sonar' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (VCC − GND)', formatSI(x.vcc, 'V', 3)], ['ระยะที่ตั้ง', x.set > SONAR_MAX_CM ? 'ไม่มีวัตถุ' : `${x.set} cm`],
      ['ECHO ตอนนี้', `${x.echo ? 'HIGH' : 'LOW'} (${x.vEcho.toFixed(2)} V)`], ['TRIG', `${x.vTrig.toFixed(2)} V`],
      ['พัลส์ ECHO ล่าสุด', x.count > 0 ? `${formatSI(x.width, 's', 4)}${x.dist > 0 ? ` → ${x.dist.toFixed(1)} cm` : ' (หมดเวลา ไม่มีวัตถุ)'}` : 'ยังไม่มี (ต้องส่งพัลส์ TRIG ≥ 10 µs)'],
      ['ทฤษฎี', formatSI(x.expect, 's', 4)], ['จำนวนครั้งที่วัด', String(x.count)]);
  }
  if (part.kind === 'stepper' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (+ − −)', formatSI(x.vcc, 'V', 3)]);
    rows.push(['มุมแกนออก', `${(x.angle as number).toFixed(2)}° (${x.pos} ฮาล์ฟสเต็ป)`]);
    rows.push(['ความเร็ว', x.stepRate > 0 ? `${(x.rpm as number).toFixed(2)} rpm · ${(x.stepRate as number).toFixed(0)} สเต็ป/วินาที (${Math.abs(x.lastStep) === 2 ? 'ฟูลสเต็ป' : 'ฮาล์ฟสเต็ป'})` : 'หยุดนิ่ง']);
    rows.push(['เฟสที่มีไฟ (LED)', ['A', 'B', 'C', 'D'].map((L, k) => (x.mask & (1 << k) ? `●${L}` : `○${L}`)).join(' ') + (x.holding ? '' : ' · ไม่มีแรงยึด')]);
    rows.push(['กระแสขดลวด A/B/C/D', [1, 2, 3, 4].map((k) => formatSI(x[`ic${k}`], 'A', 2)).join(' / ')]);
    if (x.vsat > 0) rows.push(['แรงดันตกใน ULN2003', formatSI(x.vsat, 'V', 3)]);
    rows.push(['หลุดสเต็ป', x.missed ? `${x.missed} ครั้ง` : 'ไม่มี']);
  }
  if (part.kind === 'opto' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ขาเข้า: IF (LED)', `${formatSI(x.iF, 'A', 3)} · VF ${formatSI(x.vF, 'V', 3)}`]);
    rows.push(['ขาออก: IC', `${formatSI(x.iC, 'A', 3)} · VCE ${formatSI(x.vce, 'V', 3)}`]);
    rows.push(['สถานะขาออก', x.iF < 1e-5 ? 'ไม่นำ (LED ดับ)' : x.sat ? 'อิ่มตัว (สวิตช์ปิดวงจร)' : 'ย่านขยาย (IC = CTR × IF)']);
    rows.push(['CTR ที่วัดได้ (IC ÷ IF)', x.iF > 1e-4 ? `${(x.ctrMeas * 100).toFixed(0)}%${x.sat ? ' (ต่ำกว่าค่าตั้งเพราะอิ่มตัว)' : ''} · ค่าตั้ง ${(x.ctr * 100).toFixed(0)}%` : '—']);
    rows.push(['สองฝั่งแยกกัน', x.shared ? 'ไม่แยก (มีจุดต่อร่วมกัน)' : 'แยกกัน (ฉนวน)']);
  }
  if (part.kind === 'shiftreg' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    const bits = (v: number) => HC595_OUTS.map((_, k) => ((v >> (7 - k)) & 1 ? '1' : '0')).join('');
    rows.push(['ไฟเลี้ยง (ขา 16 − ขา 8)', formatSI(x.vcc, 'V', 3)]);
    rows.push(['ขาออก QH…QA', `${bits(x.out)} (= ${x.out}, 0x${x.out.toString(16).toUpperCase().padStart(2, '0')})${x.oe ? ' · ปิดอยู่ (OE สูง)' : ''}`]);
    rows.push(['รีจิสเตอร์เลื่อน (ยังไม่ latch)', bits(x.sreg)]);
    rows.push(['ไฟขาออก', HC595_OUTS.map((_, k) => ((x.out >> k) & 1 && !x.oe ? '●' : '○')).join(' ') + '  (QA → QH)']);
    rows.push(['SER / SRCLK / RCLK', `${x.vser > x.vcc / 2 ? '1' : '0'} / ${x.sck ? 'สูง' : 'ต่ำ'} / ${x.rck ? 'สูง' : 'ต่ำ'}`]);
    rows.push(['กระแสรวมจาก VCC / ลง GND', `${formatSI(x.isrc, 'A', 3)} / ${formatSI(x.isink, 'A', 3)}`]);
  }
  if (part.kind === 'counter' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (ขา 16 − ขา 8)', formatSI(x.vdd, 'V', 3)]);
    rows.push(['นับได้', `${x.count} → ${CD4017_OUTS[x.count]} สูง (${x[`vQ${x.count}`].toFixed(2)} V${x[`iQ${x.count}`] > 1e-5 ? `, ${formatSI(x[`iQ${x.count}`], 'A', 2)}` : ''})`]);
    rows.push(['ลำดับ Q0–Q9', CD4017_OUTS.map((_, k) => (k === x.count ? '●' : '○')).join(' ')]);
    rows.push(['CLK (ขา 14)', `${x.clk ? 'สูง' : 'ต่ำ'} (${x.vclk.toFixed(2)} V)`]);
    rows.push(['RESET / CLK INH', `${x.rst ? 'สูง (รีเซ็ต)' : 'ต่ำ'} / ${x.inh ? 'สูง (หยุดนับ)' : 'ต่ำ'}`]);
    rows.push(['CARRY OUT (ขา 12)', `${x.count <= 4 ? 'สูง' : 'ต่ำ'} (${x.vCO.toFixed(2)} V)`]);
  }
  if (part.kind === 'vreg' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['สถานะ', x.regulating ? 'คงแรงดัน' : x.vin < 1 ? 'ไม่มีไฟเข้า' : 'ไม่คงแรงดัน (ขาเข้าต่ำเกิน — dropout)'],
      ['VIN (IN − GND)', formatSI(x.vin, 'V', 4)], ['VOUT (OUT − GND)', formatSI(x.vout, 'V', 4)], ['IN − OUT', formatSI(x.headroom, 'V', 3)],
      ['กระแสขาออก', formatSI(x.iout, 'A', 3)], ['กระแสขาเข้า', formatSI(x.iin, 'A', 3)], ['กระแสขา GND (กระแสนิ่ง)', formatSI(x.iq, 'A', 3)],
      ['กำลังสูญเสีย (ความร้อน)', formatSI(x.pd, 'W', 3)], ['อุณหภูมิรอยต่อโดยประมาณ (อากาศ 25 °C)', `${x.tj.toFixed(0)} °C (${x.rth} °C/W)`]);
  }
  if (part.kind === 'lm317' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['สถานะ', x.regulating ? 'คงแรงดัน' : x.vin < 1.5 ? 'ไม่มีไฟเข้า' : x.lowLoad ? 'ขาออกสูงเกิน (กระแสต่ำกว่ากระแสโหลดต่ำสุด)' : x.headroom < (part as Lm317Part).params.dropout ? 'ไม่คงแรงดัน (ขาเข้าต่ำเกิน — dropout)' : 'ไม่คงแรงดัน (ตรวจการต่อ ADJ)'],
      ['VIN (เทียบขั้วลบแหล่งจ่าย)', formatSI(x.vin, 'V', 4)], ['VOUT', formatSI(x.vout, 'V', 4)], ['VADJ', formatSI(x.vadj, 'V', 4)],
      ['OUT − ADJ (VREF)', formatSI(x.vref, 'V', 4)], ['IN − OUT', formatSI(x.headroom, 'V', 3)],
      ['กระแสขาออก (รวมผ่าน R1)', formatSI(x.iout, 'A', 3)], ['กระแสขา ADJ', formatSI(x.iadj, 'A', 3)],
      ['กำลังสูญเสีย (ความร้อน)', formatSI(x.pd, 'W', 3)], ['อุณหภูมิรอยต่อโดยประมาณ (อากาศ 25 °C)', `${x.tj.toFixed(0)} °C (${x.rth} °C/W)`]);
  }
  if (part.kind === 'timer555' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    const hz = (f: number) => (f >= 1000 ? `${formatSI(f, 'Hz', 4)}` : `${f.toPrecision(4)} Hz`);
    rows.push(['ขาออก (ขา 3)', `${x.q ? 'HIGH' : 'LOW'} · ${formatSI(x.vout, 'V', 3)}`], ['ไฟเลี้ยง VCC − GND', formatSI(x.vcc, 'V', 4)],
      ['THR (ขา 6)', formatSI(x.vthr, 'V', 4)], ['TRIG (ขา 2)', formatSI(x.vtrig, 'V', 4)], ['CTRL (ขา 5) ≈ ⅔ VCC', formatSI(x.vctl, 'V', 4)],
      ['กระแสขาออก', formatSI(x.iout, 'A', 3)]);
    rows.push(['ความถี่ที่วัดได้', x.freq > 0 ? hz(x.freq) : 'ยังไม่แกว่ง / ยังวัดไม่ได้ (ต้องเห็นอย่างน้อย 1 คาบ)']);
    if (x.freq > 0) rows.push(['duty cycle', `${(x.duty * 100).toFixed(1)}% (HIGH ${formatSI(x.tHigh, 's', 3)} · LOW ${formatSI(x.tLow, 's', 3)})`]);
    if (x.fth > 0) rows.push(['ทฤษฎี (RA ' + formatSI(x.ra, 'Ω', 3) + ', RB ' + formatSI(x.rb, 'Ω', 3) + ', C ' + formatSI(x.ct, 'F', 3) + ')', `${hz(x.fth)} · duty ${(x.dth * 100).toFixed(1)}%`]);
  }
  if (part.kind === 'relay' && r.extra) {
    rows.length = 0;
    rows.push(['สถานะ', r.extra.energized ? 'ดึงแล้ว: COM ต่อ NO' : 'ปล่อย: COM ต่อ NC'], ['ไฟเลี้ยงโมดูล (+ เทียบ −)', formatSI(r.extra.vcc, 'V', 3)], ['แรงดันขา S', formatSI(r.extra.vs, 'V', 3)],
      ['แรงดันขดลวด', formatSI(r.extra.vcoil, 'V', 3)], ['กระแสขดลวด', formatSI(r.extra.icoil, 'A', 3)], ['กระแสผ่านหน้าสัมผัส', formatSI(r.extra.icontact, 'A', 3)]);
  }
  if (part.kind === 'sevenseg' && r.extra) {
    rows.length = 0;
    const d = r.extra.digit;
    rows.push(['แสดงผล', d >= 0 ? `“${String.fromCharCode(d)}”${r.extra.dp ? ' + จุด' : ''}` : 'ไม่ใช่ตัวเลข/ตัวอักษรมาตรฐาน']);
    for (const s of SEG_NAMES) rows.push([`ส่วน ${s.toUpperCase()}`, Math.abs(r.extra[`i_${s}`]) > 1e-6 ? formatSI(r.extra[`i_${s}`], 'A', 3) : 'ดับ']);
    rows.push(['กระแสรวม', formatSI(r.current, 'A', 3)]);
  }
  if (part.kind === 'lm386' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (ขา 6 − ขา 4)', formatSI(x.vs, 'V', 4)], ['ขาออก (ขา 5) ขณะนี้', formatSI(x.vout, 'V', 4)],
      ['อัตราขยายตามการต่อ', `${x.gainTh.toFixed(0)} เท่า (${x.gain200 ? 'มีตัวเก็บประจุขา 1–8' : 'ขา 1–8 เปิด'})`],
      ['ขาออกถึงขีดจำกัด', x.sat ? 'ใช่ — ยอดคลื่นถูกตัด' : 'ไม่'], ['กระแสขาออก', formatSI(x.iout, 'A', 3)]);
  }
  if (part.kind === 'speaker' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['เสียง', x.sounding ? `${x.freq >= 999.5 ? (x.freq / 1000).toFixed(2) + ' kHz' : x.freq.toFixed(0) + ' Hz'} · ความดัง ${(x.level * 100).toFixed(0)}%` : 'เงียบ'],
      ['กำลังเสียง (ไฟสลับ)', formatSI(x.pac, 'W', 3)], ['กระแสยอด', formatSI(x.iac, 'A', 3)], ['กระแสตรงเฉลี่ย', formatSI(x.idc, 'A', 3)]);
  }
  if (part.kind === 'darlington' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ย่านทำงาน', ['ดับ (ไม่นำ)', 'ขยาย (active)', 'อิ่มตัว (สวิตช์ปิดวงจร)'][x.region] ?? '-'],
      ['IB เบส', formatSI(x.ib, 'A', 3)], ['IC คอลเลกเตอร์', formatSI(x.ic, 'A', 3)], ['IC / IB', x.ib > 1e-9 && x.ic > 1e-6 ? x.hfe.toFixed(0) : '-'],
      ['VBE', formatSI(x.vbe, 'V', 3)], ['VCE', formatSI(x.vce, 'V', 3)],
      ['กำลังสูญเสีย (ความร้อน)', formatSI(x.pd, 'W', 3)], ['อุณหภูมิรอยต่อโดยประมาณ (อากาศ 25 °C)', `${x.tj.toFixed(0)} °C (${x.rth} °C/W)`]);
  }
  if (part.kind === 'comparator' && r.extra) {
    rows.length = 0;
    const x = r.extra;
    rows.push(['ไฟเลี้ยง (ขา 8 − ขา 4)', formatSI(x.vcc, 'V', 4)]);
    for (const c of ['A', 'B'] as const) {
      if (!x[`used${c}`]) { rows.push([`ช่อง ${c}`, 'ไม่ใช้']); continue; }
      rows.push([`ช่อง ${c}: IN+ / IN−`, `${formatSI(x[`vp${c}`], 'V', 4)} / ${formatSI(x[`vn${c}`], 'V', 4)}`],
        [`ช่อง ${c}: ขาออก`, x[`on${c}`] ? `ดึงลง (IN− > IN+) · ${formatSI(x[`vo${c}`], 'V', 3)} · รับ ${formatSI(x[`i${c}`], 'A', 3)}` : `ลอย (IN+ > IN−) · ${formatSI(x[`vo${c}`], 'V', 3)}`]);
    }
  }
  if (part.kind === 'ntc' && r.extra) {
    rows.length = 0;
    rows.push(['อุณหภูมิรอบตัว', `${r.extra.temp} °C`], ['ความต้านทาน', formatSI(r.extra.resistance, 'Ω', 4)], ['แรงดันคร่อม', formatSI(r.voltage, 'V', 4)], ['กระแส', formatSI(r.current, 'A', 4)], ['กำลัง', formatSI(r.power, 'W', 3)],
      ['ความร้อนในตัว (P/δ)', `${r.extra.dT < 0.01 ? '< 0.01' : r.extra.dT.toFixed(2)} °C`]);
  }
  if (part.kind === 'ldr' && r.extra) {
    rows.length = 0;
    rows.push(['ความสว่าง', `${r.extra.lux} lx`], ['ความต้านทาน', formatSI(r.extra.resistance, 'Ω', 3)], ['แรงดันคร่อม', formatSI(r.voltage, 'V', 4)], ['กระแส', formatSI(r.current, 'A', 4)], ['กำลัง', formatSI(r.power, 'W', 3)]);
  }
  if (part.kind === 'buzzer' && r.extra) {
    rows.length = 0;
    rows.push(['สถานะ', r.extra.sounding ? `ดัง ${r.extra.freq >= 1000 ? (r.extra.freq / 1000).toFixed(2) + ' kHz' : r.extra.freq.toFixed(0) + ' Hz'} (ความดัง ${(r.extra.level * 100).toFixed(0)}%)` : 'เงียบ'],
      ['แรงดันคร่อม (+ เทียบ −)', formatSI(r.voltage, 'V', 4)], ['กระแส (ขณะนี้)', formatSI(r.current, 'A', 4)],
      ['กระแสเฉลี่ย', formatSI(r.extra.idc, 'A', 3)], ['กระแสแกว่ง (ครึ่งยอดถึงยอด)', formatSI(r.extra.iac, 'A', 3)]);
  }
  if (part.kind === 'pushbutton' && r.extra) {
    rows.length = 0;
    rows.push(['สถานะ', r.extra.pressed ? 'กดอยู่' : 'ปล่อย'], ['แรงดันคร่อม (ขา 1 − ขา 3)', formatSI(r.voltage, 'V', 4)], ['กระแสผ่านหน้าสัมผัส', formatSI(r.current, 'A', 4)]);
  }
  if (part.kind === 'potentiometer' && r.extra) {
    rows.length = 0;
    rows.push(['ตำแหน่งแกนกลาง', `${(r.extra.position * 100).toFixed(1)}%`], ['V(1–3)', formatSI(r.extra.v13, 'V', 4)], ['V(2–3) แกนกลางเทียบขา 3', formatSI(r.extra.v23, 'V', 4)],
      ['V(1–2)', formatSI(r.extra.v12, 'V', 4)], ['กระแสเข้าขา 1', formatSI(r.extra.i1, 'A', 4)], ['กระแสเข้าขา 2 (แกนกลาง)', formatSI(r.extra.iw, 'A', 4)], ['กำลังรวม', formatSI(r.power, 'W', 3)]);
  }
  if (part.kind === 'opamp' && r.extra) {
    rows.length = 0;
    rows.push(['Vout (เทียบขา V−)', formatSI(r.voltage, 'V', 4)], ['Vd = V(IN+) − V(IN−)', formatSI(r.extra.vd, 'V', 3)], ['กระแสขาออก', formatSI(r.current, 'A', 4)],
      ['ไฟเลี้ยง V+ − V−', formatSI(r.extra.vsupply, 'V', 4)], ['สถานะ', r.extra.saturated ? 'อิ่มตัว (ขาออกชนไฟเลี้ยง)' : r.extra.slewing ? 'ถูกจำกัดด้วย slew rate (ขาออกเปลี่ยนเร็วสุดแล้ว)' : 'เชิงเส้น'], ['กำลัง', formatSI(r.power, 'W', 3)]);
  }
  box.replaceChildren(h('h3', {}, 'ค่าจากการจำลอง'), h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
}

function slider(app: App, key: string, label: string, min: number, max: number, step: number, value: number, onValue: (v: number, amend: boolean) => void): HTMLElement {
  const r = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), id: `f-${key}`, 'aria-label': label });
  r.addEventListener('input', () => {
    const amend = app.sliderGesture === key;
    app.sliderGesture = key;
    onValue(Number(r.value), amend);
  });
  r.addEventListener('change', () => { app.sliderGesture = null; app.refreshPanels(); });
  return h('div', { class: 'field' }, h('label', { for: `f-${key}` }, label), h('div', { class: 'row' }, r));
}

function wireProps(app: App, wireId: string): Node[] {
  const w = app.doc.wires.find((x) => x.id === wireId)!;
  const conn = app.conn();
  const net = netOfTerminal(conn, w.a);
  return [
    h('dl', { class: 'kv' },
      h('dt', {}, 'ปลาย A'), h('dd', {}, terminalLabel(app.doc, w.a)),
      h('dt', {}, 'ปลาย B'), h('dd', {}, terminalLabel(app.doc, w.b)),
      h('dt', {}, 'เน็ต'), h('dd', {}, net !== undefined ? `N${net}: ${describeNet(conn, app.doc, net)}` : '—'),
      h('dt', {}, 'id'), h('dd', {}, w.id)),
    h('div', { class: 'field' }, h('label', {}, 'สีสาย (ไม่มีผลทางไฟฟ้า)'),
      h('div', { class: 'chips' }, ...WIRE_COLORS.map((c) => h('button', { class: 'swatch', style: `background:${c}`, 'aria-label': `สี ${c}`, 'aria-pressed': String(w.color === c), onclick: () => app.apply(updateWire(app.doc, w.id, { color: c }), 'เปลี่ยนสีสาย') })))),
    slider(app, 'arc', 'ความโค้งสาย', 0, 8, 0.25, w.arc, (v, amend) => app.apply(updateWire(app.doc, w.id, { arc: v }), 'ปรับแนวสาย (โค้ง)', { amend })),
    slider(app, 'bend', 'เยื้องแนวสายไปด้านข้าง', -8, 8, 0.25, w.bend, (v, amend) => app.apply(updateWire(app.doc, w.id, { bend: v }), 'ปรับแนวสาย (เยื้อง)', { amend })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => app.setTool({ t: 'wireEnd', wireId: w.id, end: 'a' }) }, 'ย้ายปลาย A'),
      h('button', { class: 'btn', onclick: () => app.setTool({ t: 'wireEnd', wireId: w.id, end: 'b' }) }, 'ย้ายปลาย B'),
      h('button', { class: 'btn danger', onclick: () => app.deleteSelected() }, svg(icon('trash')), 'ลบสาย')),
  ];
}

function terminalProps(app: App): Node[] {
  const s = app.selection;
  if (s?.t !== 'terminal') return [];
  const conn = app.conn();
  const net = netOfTerminal(conn, s.ref);
  const info = s.ref.kind === 'hole' ? holeInfo(s.ref.hole) : undefined;
  const v = app.freshSim;
  let volt = '';
  if (v && v.result.ok && net !== undefined && app.doc.probes.black) {
    const nb = netOfTerminal(conn, app.doc.probes.black);
    if (nb !== undefined && v.result.component[net] >= 0 && v.result.component[net] === v.result.component[nb]) volt = formatSI((v.result.nodeVoltage[net] as number) - (v.result.nodeVoltage[nb] as number), 'V', 4);
  }
  const net0 = net !== undefined ? conn.nets[net] : undefined;
  const holeCount = net0 ? net0.terminals.filter((t) => t.includes('/')).length : 0;
  return [
    h('dl', { class: 'kv' },
      h('dt', {}, 'จุดต่อ'), h('dd', {}, terminalLabel(app.doc, s.ref)),
      info ? h('dt', {}, 'กลุ่มภายในบอร์ด') : null, info ? h('dd', {}, groupLabel(info.group)) : null,
      h('dt', {}, 'เน็ต'), h('dd', {}, net !== undefined ? `N${net}` : '—'),
      h('dt', {}, 'รูที่เชื่อมถึงกัน'), h('dd', {}, `${holeCount} รู (ไฮไลต์สีเหลือง)`),
      h('dt', {}, 'เชื่อมกับ'), h('dd', {}, net !== undefined ? describeNet(conn, app.doc, net) : '—'),
      volt ? h('dt', {}, 'แรงดันเทียบโพรบดำ') : null, volt ? h('dd', {}, volt) : null),
    ...(s.ref.kind === 'hole' ? [h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => app.select({ t: 'board', id: (s.ref as { boardId: string }).boardId }) }, 'เลือกเบรดบอร์ดทั้งแผ่น (เพื่อย้าย)'))] : []),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => app.apply(setProbe(app.doc, 'red', s.ref), `วางโพรบแดงที่ ${terminalLabel(app.doc, s.ref)}`) }, h('span', { class: 'dotr', style: 'width:10px;height:10px;border-radius:50%;display:inline-block' }), 'วางโพรบแดงที่นี่'),
      h('button', { class: 'btn', onclick: () => app.apply(setProbe(app.doc, 'black', s.ref), `วางโพรบดำที่ ${terminalLabel(app.doc, s.ref)}`) }, h('span', { class: 'dotb', style: 'width:10px;height:10px;border-radius:50%;display:inline-block' }), 'วางโพรบดำที่นี่')),
  ];
}

/* ======================= ผลการวัด ======================= */

export function renderResults(app: App) {
  const el = $('results');
  if (!app.running) {
    el.replaceChildren(h('p', { class: 'empty' }, 'กด Run เพื่อคำนวณวงจรและแสดงค่าที่วัดได้'));
    return;
  }
  const sim = app.sim;
  if (!sim) { el.replaceChildren(h('p', { class: 'empty' }, 'กำลังคำนวณ…')); return; }
  const stale = sim.doc !== app.doc;
  const a = sim.analysis;
  const nodes: Node[] = [];
  if (!a.ok) {
    nodes.push(h('div', { class: 'diag danger' }, svg(icon('warn')), h('div', {}, h('b', {}, a.errorTitle ?? 'คำนวณไม่ได้'), h('div', {}, a.errorDetail ?? ''), h('div', {}, 'ไม่แสดงค่าที่วัดได้ เพื่อไม่ให้เข้าใจผิด'))));
  } else {
    const tbl = h('table', { class: 'reading-table', style: stale ? 'opacity:.45' : '' },
      h('tr', {}, h('th', {}, 'อุปกรณ์'), h('th', { style: 'text-align:right' }, 'V'), h('th', { style: 'text-align:right' }, 'I'), h('th', { style: 'text-align:right' }, 'P')));
    for (const p of sim.doc.parts) {
      const r = a.parts[p.id];
      if (!r || p.kind === 'pico') continue; // สถานะ Pico ดูในแผงคุณสมบัติ/แท็บ Pico
      tbl.append(h('tr', { class: r.overRated ? 'over' : '' },
        h('td', {}, p.label, r.mode ? ` (${r.mode})` : ''),
        h('td', { class: 'num' }, formatSI(r.voltage, 'V', 3)),
        h('td', { class: 'num' }, formatSI(r.current, 'A', 3)),
        h('td', { class: 'num' }, formatSI(r.power, 'W', 2))));
    }
    if (sim.doc.parts.length) nodes.push(tbl);
    nodes.push(h('p', { style: 'font-size:12px;color:var(--ink-3);margin:0 0 8px' }, sim.mode === 'tran' ? `ค่า ณ เวลา t = ${fmtTime(sim.t)} · ทิศกระแส: ขา 1→2, LED A→K, ตัวเก็บประจุ +→−, แหล่งจ่าย ออกจากขั้ว +` : 'ทิศกระแส: ตัวต้านทาน ขา 1→2, LED A→K, แหล่งจ่าย ออกจากขั้ว + · ค่าจาก solver คลาดเคลื่อน ≤ 1 ppm'));
  }
  const diags = a.diagnostics;
  if (diags.length) {
    nodes.push(...diags.map((d) => h('div', { class: `diag ${d.severity}` }, svg(icon(d.severity === 'info' ? 'info' : 'warn')), h('div', {}, d.message))));
  } else if (a.ok) nodes.push(h('div', { class: 'diag info' }, svg(icon('check')), h('div', {}, 'ไม่พบปัญหาในวงจร')));
  el.replaceChildren(...nodes);
}

/* ======================= เครื่องมือวัด (แถบล่าง) ======================= */

export function renderMeters(app: App) {
  const el = $('meters');
  const sim = app.sim;
  const stale = !sim || sim.doc !== app.doc;
  const ok = app.running && sim && sim.analysis.ok;
  const nodes: HTMLElement[] = [];
  const d = app.doc;
  // โวลต์มิเตอร์ (โพรบสองจุด)
  const probe = ok ? sim!.analysis.probe : null;
  let lcd: HTMLElement;
  if (!app.running) lcd = h('div', { class: 'lcd off' }, '- . - - -', h('small', {}, 'V'));
  else if (sim && !sim.analysis.ok) lcd = h('div', { class: 'lcd err' }, 'คำนวณไม่ได้ — ไม่แสดงค่า');
  else if (!probe || probe.value === null) lcd = h('div', { class: `lcd ${probe?.reason ? 'err' : 'off'}` }, probe?.reason ?? 'กำลังคำนวณ…');
  else lcd = h('div', { class: `lcd ${stale ? 'off' : ''}` }, fmtMeter(probe.value), h('small', {}, 'V'));
  nodes.push(h('div', { class: 'meter', 'aria-label': 'โวลต์มิเตอร์ โพรบสองจุด' },
    h('div', { class: 'meter-h' }, 'โวลต์มิเตอร์ DC ', h('span', { class: 'dotr' }), '−', h('span', { class: 'dotb' })),
    lcd,
    h('div', { class: 'side' },
      h('div', {}, h('span', { class: 'dotr', style: 'width:8px;height:8px;border-radius:50%;display:inline-block' }), ' ', d.probes.red ? terminalLabel(d, d.probes.red) : 'ยังไม่วาง'),
      h('div', {}, h('span', { class: 'dotb', style: 'width:8px;height:8px;border-radius:50%;display:inline-block' }), ' ', d.probes.black ? terminalLabel(d, d.probes.black) : 'ยังไม่วาง'),
      (d.probes.red || d.probes.black) ? h('button', { class: 'back', style: 'font-size:12px', onclick: () => app.apply(clearProbes(app.doc), 'เก็บโพรบ') }, 'เก็บโพรบ') : null)));
  // แอมมิเตอร์
  for (const p of d.parts) {
    if (p.kind !== 'ammeter') continue;
    const r = ok ? sim!.analysis.parts[p.id] : undefined;
    let l: HTMLElement;
    if (!app.running) l = h('div', { class: 'lcd off' }, '- - . - -', h('small', {}, 'mA'));
    else if (sim && !sim.analysis.ok) l = h('div', { class: 'lcd err' }, 'คำนวณไม่ได้');
    else if (!r) l = h('div', { class: 'lcd off' }, '…', h('small', {}, 'mA'));
    else l = h('div', { class: `lcd ${stale ? 'off' : ''}` }, r.overRated ? 'OL' : fmtMeter(r.current * 1000), h('small', {}, 'mA'));
    nodes.push(h('div', { class: 'meter', 'aria-label': `แอมมิเตอร์ ${p.label}` },
      h('div', { class: 'meter-h' }, `แอมมิเตอร์ ${p.label} (ต่ออนุกรม)`), l,
      h('div', { class: 'side' }, `shunt ${formatSI(p.params.shuntResistance, 'Ω')} · ย่าน ${formatSI(p.params.range, 'A')}`)));
  }
  // มัลติมิเตอร์ดิจิทัล: ค่าบนจอ
  for (const p of d.parts) {
    if (p.kind !== 'dmm') continue;
    const r = ok ? sim!.analysis.parts[p.id] : undefined;
    const disp = dmmDisplay(p, r, !!ok && !stale);
    const mode = DMM_MODES.find((m) => m.id === p.params.mode)!;
    const l = p.params.mode === 'off' ? h('div', { class: 'lcd off' }, 'OFF')
      : !app.running ? h('div', { class: 'lcd off' }, '- . - - -', h('small', {}, disp.unit))
        : sim && !sim.analysis.ok ? h('div', { class: 'lcd err' }, 'คำนวณไม่ได้')
          : h('div', { class: `lcd ${stale ? 'off' : ''}`, id: `meter-${p.id}` }, disp.text, h('small', {}, `${disp.unit}${disp.ann.includes('AC') ? ' AC' : ''}`));
    nodes.push(h('div', { class: 'meter', 'aria-label': `มัลติมิเตอร์ดิจิทัล ${p.label}` },
      h('div', { class: 'meter-h' }, `มัลติมิเตอร์ดิจิทัล ${p.label}`), l,
      h('div', { class: 'side' }, `ย่าน ${mode.dial}${r?.extra?.blownMa || r?.extra?.blownA ? ' · ฟิวส์ขาด' : ''}`)));
  }
  // มัลติมิเตอร์แบบเข็ม: หน้าปัดย่อ + ค่าที่อ่านจากสเกล
  for (const p of d.parts) {
    if (p.kind !== 'vom') continue;
    const r = ok && !stale ? sim!.analysis.parts[p.id] : undefined;
    const pos = vomPosition(p.params.sel);
    const f = app.running ? r?.extra?.frac ?? 0 : 0;
    nodes.push(h('div', { class: 'meter', 'aria-label': `มัลติมิเตอร์แบบเข็ม ${p.label}` },
      h('div', { class: 'meter-h' }, `มัลติมิเตอร์แบบเข็ม ${p.label}`),
      h('div', { class: 'gauge', id: `meter-${p.id}`, 'data-frac': f.toFixed(4) }, svg(gaugeSvg(f, pos))),
      h('div', { class: 'side' }, `ย่าน ${pos.label}`, h('br'), app.running ? vomReadout(p, r) : 'หยุดจำลอง — เข็มอยู่ที่ 0')));
  }
  if (!d.parts.some((p) => p.kind === 'ammeter' || p.kind === 'dmm' || p.kind === 'vom')) nodes.push(h('div', { class: 'meter-empty' }, 'วัด V · I · R: วางมัลติมิเตอร์จากคลังอุปกรณ์ แล้วต่อสายโพรบเข้าวงจร'));
  el.replaceChildren(...nodes);
}

/** วิธีต่อสายตามย่านของมัลติมิเตอร์ดิจิทัล */
const DMM_HOWTO: Record<string, string> = {
  off: 'ปิดเครื่อง — หมุนสวิตช์ไปย่านที่ต้องการวัด',
  dcv: 'วัดแรงดันไฟตรง: สายแดงขั้ว VΩ สายดำขั้ว COM แตะคร่อมอุปกรณ์ (ต่อขนาน) — ค่าติดลบแปลว่าสายแดงอยู่ฝั่งศักย์ต่ำกว่า',
  acv: 'วัดแรงดันไฟสลับ (rms): สายแดงขั้ว VΩ สายดำขั้ว COM แตะคร่อม — ไม่สนใจขั้ว ส่วนไฟตรงถูกตัดออก',
  mv: 'วัดแรงดันต่ำ (≤ 400 mV) ละเอียด 0.1 mV: สายแดงขั้ว VΩ สายดำขั้ว COM — เกินย่านขึ้น OL',
  ohm: 'วัดความต้านทาน: ปิดไฟ/ถอดแหล่งจ่ายก่อน แล้วแตะคร่อมตัวต้านทาน (สายแดง VΩ สายดำ COM) — ปลายลอยขึ้น OL · ถ้าอุปกรณ์ยังต่ออยู่ในวงจร ทางขนานอื่นทำให้อ่านได้น้อยกว่าจริง',
  dca: 'วัดกระแสสูง (ถึง 10 A): ย้ายสายแดงไปขั้ว 10 A แล้ว "ตัดวงจร" ต่อมิเตอร์อนุกรมในเส้นทางกระแส — ห้ามแตะคร่อมแหล่งจ่าย',
  dcma: 'วัดกระแสต่ำ (ถึง 400 mA): ย้ายสายแดงไปขั้ว mA µA แล้วต่อมิเตอร์อนุกรมในเส้นทางกระแส — ห้ามแตะคร่อมแหล่งจ่าย (ฟิวส์ 440 mA ขาด)',
};

/** วิธีอ่านสเกลของมัลติมิเตอร์แบบเข็มตามย่าน */
function vomScaleHint(pos: VomPosition, sDC: number, sAC: number, center: number): string {
  const rin = (s: number) => `ความต้านทานขาเข้า ${formatSI(s * pos.full, 'Ω')} (${s / 1000} kΩ/V × ${pos.full} V)`;
  switch (pos.mode) {
    case 'off': return 'ปิดเครื่อง (เก็บมิเตอร์ที่ OFF เสมอ ไม่ให้แบตเตอรี่หมดถ้าสายแตะกัน)';
    case 'dcv': {
      const sc = pos.full === 0.1 ? 'สเกลดำ 0–10 แล้ว × 0.01' : pos.full === 0.25 ? 'สเกลดำ 0–250 อ่านเป็น mV' : pos.full === 2.5 ? 'สเกลดำ 0–250 แล้ว ÷ 100' : pos.full === 1000 ? 'สเกลดำ 0–10 แล้ว × 100' : `สเกลดำ 0–${pos.full} อ่านได้ตรง ๆ`;
      return `DCV เต็มสเกล ${pos.full} V: ${sc} · ${rin(pos.full >= 250 ? sAC : sDC)} — ถ้าวงจรมีความต้านทานสูง มิเตอร์จะดึงแรงดันลง (อ่านได้น้อยกว่าจริง)`;
    }
    case 'acv': return `ACV เต็มสเกล ${pos.full} V: ${pos.full === 10 ? 'สเกลแดง 0–10' : `สเกลดำ 0–${pos.full === 750 ? '250 แล้ว × 3' : pos.full}`} (ค่า rms ของไซน์) · ${rin(sAC)}`;
    case 'dca': return `DCA เต็มสเกล ${formatSI(pos.full, 'A')}: สเกลดำ ${pos.full === 50e-6 ? '0–50 อ่านเป็น µA' : pos.full === 2.5e-3 ? '0–250 แล้ว ÷ 100 เป็น mA' : pos.full === 25e-3 ? '0–250 แล้ว ÷ 10 เป็น mA' : '0–250 อ่านเป็น mA'} · ต่ออนุกรมในเส้นทางกระแส (ตัดวงจรก่อน)`;
    case 'ohm': return `Ω ${pos.dial}: อ่านสเกลเขียวด้านบน (∞ ซ้าย → 0 ขวา ไม่เชิงเส้น) แล้วคูณ ${pos.full} · ค่ากลางสเกล = ${fmtOhm(center * pos.full)} อ่านแม่นที่สุดช่วงกลางสเกล · ขั้ว COM (สายดำ) เป็นบวกของแบตเตอรี่ภายใน — วัดไดโอดได้กระแสเมื่อสายดำอยู่ขาแอโนด`;
  }
}

/** หน้าปัดย่อของมิเตอร์แบบเข็ม (SVG) */
function gaugeSvg(frac: number, pos: VomPosition): string {
  const c = Math.max(-0.06, Math.min(1.08, frac));
  const a = (-45 + 90 * c) * (Math.PI / 180);
  const cx = 60, cy = 53, r = 44;
  const xy = (f: number, rr: number) => { const t = (-45 + 90 * f) * (Math.PI / 180); return [cx + Math.sin(t) * rr, cy - Math.cos(t) * rr].map((v) => v.toFixed(1)); };
  const pt = (f: number, rr: number) => xy(f, rr).join(',');
  let ticks = '';
  for (let i = 0; i <= 10; i++) { const [x1, y1] = xy(i / 10, r - (i % 5 ? 4 : 7)), [x2, y2] = xy(i / 10, r); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  const col = pos.mode === 'acv' ? '#c0392b' : pos.mode === 'ohm' ? '#1f6b3a' : '#1a1a1a';
  return `<svg viewBox="0 0 120 58" width="96" height="46" role="img" aria-label="เข็มชี้ ${(frac * 100).toFixed(0)}% ของสเกล"><rect x="1.5" y="1.5" width="117" height="55" rx="5" fill="#f4f1e6" stroke="#2a2d31"/><path d="M${pt(0, r)} A${r} ${r} 0 0 1 ${pt(1, r)}" fill="none" stroke="${col}" stroke-width="1.2"/><g stroke="${col}" stroke-width="1">${ticks}</g><line x1="${cx}" y1="${cy}" x2="${(cx + Math.sin(a) * (r + 2)).toFixed(1)}" y2="${(cy - Math.cos(a) * (r + 2)).toFixed(1)}" stroke="#d62d20" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="3" fill="#111"/></svg>`;
}

function fmtMeter(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 100 ? 1 : a >= 10 ? 2 : 3;
  return v.toFixed(digits);
}

/* ======================= แลป ======================= */

export function renderLessons(app: App, liveOnly = false) {
  const body = $('lessons-body');
  const lesson = lessonById(app.work.lessonId);
  if (liveOnly) {
    if (lesson && document.getElementById('lesson-goals')) { renderGoals(app, lesson); return; }
    if (!lesson && body.querySelector('.lesson-card')) return;
  }
  if (!lesson) {
    body.replaceChildren(
      h('p', { class: 'empty' }, 'เลือกแลป ระบบจะตรวจผลจากการเชื่อมต่อและค่าทางไฟฟ้าตาม tolerance โดยไม่บังคับตำแหน่งหรือสีสาย'),
      ...LESSONS.map((l) => {
        const ach = app.work.achieved[l.id] ?? {};
        const done = l.goals.filter((g) => !g.optional && ach[g.id]).length;
        const req = l.goals.filter((g) => !g.optional).length;
        return h('button', { class: 'lesson-card', onclick: () => { app.updateWork((w) => { w.lessonId = l.id; }); renderLessons(app); } },
          h('span', { class: 'no' }, String(l.number)),
          h('span', {}, h('div', { class: 't' }, l.title), h('div', { class: 'p' }, `${l.titleEn} · ผ่าน ${done}/${req} เป้าหมาย`)));
      }));
    return;
  }
  const answers = (app.work.answers[lesson.id] ??= {});
  const qa = (q: { id: string; q: string }, prefix: string) => {
    const ta = h('textarea', { id: `qa-${prefix}-${q.id}`, rows: '2' });
    ta.value = answers[`${prefix}-${q.id}`] ?? '';
    ta.addEventListener('input', () => app.updateWork(() => { answers[`${prefix}-${q.id}`] = ta.value; }));
    return h('div', { class: 'field' }, h('label', { for: ta.id }, q.q), ta);
  };
  body.replaceChildren(h('div', { class: 'lesson' },
    h('button', { class: 'back', onclick: () => { app.updateWork((w) => { w.lessonId = null; }); renderLessons(app); } }, '‹ แลปทั้งหมด'),
    h('h2', {}, `แลป ${lesson.number} ${lesson.title}`),
    h('div', { class: 'en' }, lesson.titleEn),
    h('h3', {}, 'จุดประสงค์'), h('ul', {}, ...lesson.objectives.map((o) => h('li', {}, o))),
    schematicBlock(app, lesson),
    h('h3', {}, 'ความรู้ก่อนทดลอง'), ...lesson.background.map((p) => h('p', {}, p)),
    h('h3', {}, 'คาดการณ์ผลก่อนทดลอง'), ...lesson.predictions.map((q) => qa(q, 'pred')),
    h('h3', {}, 'อุปกรณ์'), h('ul', {}, ...lesson.equipment.map((o) => h('li', {}, o))),
    h('h3', {}, 'ขั้นตอนการทดลอง'), h('ol', {}, ...lesson.steps.map((o) => h('li', {}, o))),
    h('h3', {}, 'ตรวจผล'), h('div', { id: 'lesson-goals' }),
    h('h3', {}, 'ตารางบันทึกผล'), recordTable(app, lesson),
    h('h3', {}, 'คำใบ้'), ...lesson.hints.map((t, i) => h('details', {}, h('summary', {}, `คำใบ้ ${i + 1}`), h('p', {}, t))),
    h('h3', {}, 'คำถามสรุป'), ...lesson.summary.map((q) => qa(q, 'sum')),
  ));
  renderGoals(app, lesson);
}

/** รูปวงจรของแลป: แสดงในแผง แตะเพื่อขยายเต็มจอ */
function schematicBlock(app: App, lesson: Lesson): HTMLElement | null {
  const sch = SCHEMATICS[lesson.id];
  if (!sch) return null;
  const title = `รูปวงจร แลป ${lesson.number}`;
  const fig = h('button', { class: 'schem', id: 'lesson-schematic', 'aria-label': `${title} (แตะเพื่อขยาย)`, title: 'แตะเพื่อขยาย' });
  fig.innerHTML = schematicSvg(sch, `${title} ${lesson.title}`);
  fig.addEventListener('click', () => {
    void app;
    const d = $('dialog') as HTMLDialogElement;
    const big = h('div', { class: 'schem big' });
    big.innerHTML = schematicSvg(sch, `${title} ${lesson.title}`);
    d.replaceChildren(h('div', { class: 'dlg schem-dlg' }, h('h2', {}, `${title}: ${lesson.title}`), big, sch.note ? h('p', { class: 'help' }, sch.note) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', id: 'schem-close', onclick: () => d.close() }, 'ปิด'))));
    d.classList.add('wide');
    d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
    d.showModal();
  });
  return h('div', {}, h('h3', {}, 'รูปวงจร'), fig, h('p', { class: 'schem-hint' }, 'แตะรูปเพื่อขยาย'), sch.note ? h('p', { class: 'help', style: 'font-size:12.5px;color:var(--ink-3)' }, sch.note) : null);
}

function renderGoals(app: App, lesson: Lesson) {
  const box = document.getElementById('lesson-goals');
  if (!box) return;
  const res = app.lessonStatus();
  const ach = app.work.achieved[lesson.id] ?? {};
  box.replaceChildren(...lesson.goals.map((g) => {
    const now = res[g.id];
    const pass = !!now?.pass;
    const before = !pass && ach[g.id];
    return h('div', { class: `goal ${pass ? 'pass' : 'fail'}`, 'data-goal': g.id },
      svg(icon(pass ? 'check' : 'dot')),
      h('div', {}, h('div', { class: 't' }, g.text, g.optional ? h('span', { class: 'tag' }, 'ไม่บังคับ') : null),
        now?.detail && !pass ? h('div', { class: 'd' }, now.detail) : null,
        before ? h('div', { class: 'd' }, 'เคยผ่านแล้ว (บันทึกไว้)') : null));
  }), !app.running ? h('p', { class: 'help', style: 'font-size:12.5px;color:var(--ink-3)' }, 'กด Run เพื่อให้ระบบตรวจผลจากวงจรของคุณ') : '');
}

function recordTable(app: App, lesson: Lesson): HTMLElement {
  const rec = (app.work.records[lesson.id] ??= {});
  const t = h('table', { class: 'rec' }, h('tr', {}, h('th', {}, 'รายการ'), h('th', {}, 'ค่าคำนวณ'), h('th', {}, 'ค่าจำลอง'), h('th', {}, '% ต่าง')));
  for (const row of lesson.table) {
    const r = (rec[row.id] ??= { calc: '', sim: '' });
    const calc = h('input', { type: 'text', inputmode: 'decimal', value: r.calc, 'aria-label': `${row.label} ค่าคำนวณ (${row.unit})` });
    const simIn = h('input', { type: 'text', inputmode: 'decimal', value: r.sim, 'aria-label': `${row.label} ค่าจำลอง (${row.unit})` });
    const diff = h('span', { class: 'diff' });
    const upd = () => {
      const c = parseFloat(calc.value), s = parseFloat(simIn.value);
      diff.textContent = isFinite(c) && isFinite(s) && c !== 0 ? `${(((s - c) / Math.abs(c)) * 100).toFixed(1)}%` : '—';
    };
    calc.addEventListener('input', () => { app.updateWork(() => { r.calc = calc.value; }); upd(); });
    simIn.addEventListener('input', () => { app.updateWork(() => { r.sim = simIn.value; }); upd(); });
    upd();
    const fill = row.source !== 'none' ? h('button', {
      class: 'fill', onclick: () => {
        const v = currentReading(app, row.source, row.unit);
        if (v === null && row.source === 'bdfc') { app.status('ยังไม่มีความถี่ −3 dB — กด Run เปิดแท็บกราฟโบด และตั้งช่วง sweep ให้ครอบคลุม fc', 'err'); return; }
        if (v === null && row.source.startsWith('sc')) { app.status('ยังไม่มีค่าจากออสซิลโลสโคป — กด Run ต่อ CH และ GND แล้วรอให้เห็นอย่างน้อย 2–3 คาบ', 'err'); return; }
        if (v === null) { app.status(row.source === 'tau' ? 'ยังวัด τ ไม่ได้ — วางโพรบคร่อมตัวเก็บประจุ กด "เริ่มใหม่" แล้วรอให้แรงดันเกิน 63%' : 'ยังไม่มีค่าที่วัดได้ — กด Run และตรวจว่าวาง' + (row.source === 'probe' ? 'โพรบครบสองจุด' : 'แอมมิเตอร์อนุกรมในวงจร'), 'err'); return; }
        simIn.value = v;
        app.updateWork(() => { r.sim = v; });
        upd();
        renderGoals(app, lesson);
      },
    }, row.source === 'probe' ? 'ใส่ค่าจากโพรบ' : row.source === 'tau' ? 'ใส่ค่า τ จากกราฟ' : row.source === 'bdfc' ? 'ใส่ค่าจากกราฟโบด' : row.source.startsWith('sc') ? 'ใส่ค่าจากสโคป' : row.source === 'dmm' ? 'ใส่ค่าจาก DMM' : row.source === 'vom' ? 'ใส่ค่าจาก VOM' : 'ใส่ค่าจากแอมมิเตอร์') : null;
    t.append(h('tr', {}, h('td', {}, `${row.label} (${row.unit})`), h('td', {}, calc), h('td', {}, simIn, fill), h('td', {}, diff)));
  }
  return t;
}

function currentReading(app: App, source: LessonTableRow['source'], unit: string): string | null {
  const sim = app.freshSim;
  if (!sim || !sim.analysis.ok) return null;
  if (source === 'bdfc') {
    const d = app.bode?.doc === app.doc ? app.bode.data : null;
    const m = d?.ok ? measureBode(d) : null;
    const f = m ? m.fHigh ?? m.fLow : null;
    return f === null ? null : f.toFixed(1);
  }
  if (source.startsWith('sc')) {
    const sc = app.scopePart(sim.doc);
    if (!sc) return null;
    const m = app.scope.frame(sc.params).measure[source.startsWith('sc2') ? 1 : 0];
    if (!m) return null;
    if (source === 'sc1f') return m.freq === null ? null : m.freq.toFixed(1);
    if (source.endsWith('max')) return m.vmax.toFixed(3);
    return m.vpp.toFixed(3);
  }
  if (source === 'tau') {
    const ps = sim.doc.parts.find((p) => p.kind === 'dcsupply');
    const t = ps && ps.kind === 'dcsupply' ? measuredTau(sim.mode === 'tran' ? app.logger : null, ps.params.voltage) : null;
    return t === null ? null : unit === 'ms' ? (t * 1000).toFixed(2) : t.toPrecision(5);
  }
  if (source === 'dmm' || source === 'vom') {
    // ค่าที่มิเตอร์ที่เลือก (หรือตัวแรก) แสดง แปลงเป็นหน่วยของแถว (เช่น kΩ, µA)
    const sel = app.selection;
    const ms = sim.doc.parts.filter((p) => p.kind === source);
    const m = ms.find((p) => sel?.t === 'part' && sel.id === p.id) ?? ms[0];
    const x = m ? sim.analysis.parts[m.id]?.extra : undefined;
    if (!m || !x || x.ol || x.blown || x.blownMa || x.blownA) return null;
    const ohmMode = source === 'vom' && m.kind === 'vom' && vomPosition(m.params.sel).mode === 'ohm';
    const v = ohmMode ? x.ohm : x.value;
    if (!Number.isFinite(v) || (ohmMode && v < 0)) return null; // เข็มไม่ขยับในย่าน Ω = ∞ อ่านค่าไม่ได้
    const pre: Record<string, number> = { µ: 1e-6, m: 1e-3, k: 1e3, M: 1e6 };
    const f = unit.length > 1 && pre[unit[0]] ? pre[unit[0]] : 1;
    return (v / f).toPrecision(4);
  }
  if (source === 'probe') {
    const v = sim.analysis.probe.value;
    return v === null ? null : v.toFixed(4);
  }
  const sel = app.selection;
  const meters = sim.doc.parts.filter((p) => p.kind === 'ammeter');
  const m = meters.find((p) => sel?.t === 'part' && sel.id === p.id) ?? meters[0];
  if (!m) return null;
  const I = sim.analysis.parts[m.id]?.current;
  if (I === undefined) return null;
  return unit === 'mA' ? (I * 1000).toFixed(4) : I.toFixed(6);
}
