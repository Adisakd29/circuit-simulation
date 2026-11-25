/**
 * เมนู "โปรเจกต์จบ": รายการแม่แบบ + หน้ารายละเอียด (สถานะการจำลอง, รูปวงจร, BOM, ตารางจุดต่อ, โค้ด, การทดสอบ, ข้อจำกัด)
 * เปิดแม่แบบ = แทนวงจรในโต๊ะด้วยวงจรของแม่แบบผ่าน history (กด Undo กลับได้)
 */
import { FINAL_PROJECTS, wiringList, type FinalProject } from '../projects/final-projects';
import dispenserHex from '../projects/dispenser.hex?raw';
import wateringHex from '../projects/watering.hex?raw';
import motorHex from '../projects/motor.hex?raw';
import { SCHEMATICS } from '../lessons/schematics';
import { schematicSvg } from '../lessons/schematic';
import type { CircuitDoc } from '../model/types';
import type { App } from './app';
import { $, h } from './dom';

/** โปรแกรมที่คอมไพล์ไว้แล้วจากโค้ดของแม่แบบ (บริการคอมไพล์ของแอป บอร์ด unoq) — เปิดแม่แบบแล้วรันได้ทันทีแม้ไม่มีบริการคอมไพล์ */
export const PREBUILT: Record<string, { hex: string; flash: number; ram: number }> = {
  dispenser: { hex: dispenserHex, flash: 8256, ram: 691 },
  watering: { hex: wateringHex, flash: 7074, ram: 597 },
  motor: { hex: motorHex, flash: 7658, ram: 553 },
};

export function projectDoc(p: FinalProject): CircuitDoc | null {
  if (!p.build) return null;
  const doc = p.build();
  const pre = PREBUILT[p.id];
  if (!pre || !p.code) return doc;
  return { ...doc, parts: doc.parts.map((x) => (x.kind === 'unoq' ? { ...x, params: { ...x.params, hex: pre.hex, hexSrc: p.code!, flash: pre.flash, ram: pre.ram } } : x)) } as CircuitDoc;
}

export function projectCards(app: App): HTMLElement {
  return h('div', { class: 'proj-list', id: 'proj-list' },
    h('h3', {}, 'โปรเจกต์จบ (แม่แบบ)'),
    h('p', { class: 'help', style: 'font-size:12.5px;color:var(--ink-3)' }, 'แม่แบบพร้อมวงจร โค้ด รายการอุปกรณ์ จุดต่อ และผลทดสอบอัตโนมัติ · ระบุระดับการจำลองทุกแม่แบบ — "วางแผน" = ยังไม่มีวงจรและเทสต์'),
    ...FINAL_PROJECTS.map((p) => h('button', { class: `proj-card ${p.status}`, id: `proj-${p.id}`, onclick: () => openProject(app, p.id) },
      h('span', { class: 'no' }, `P${p.number}`),
      h('span', {}, h('div', { class: 't' }, p.title), h('div', { class: 'p' }, `${p.titleEn} · ${p.status === 'ready' ? 'พร้อม (จำลองพฤติกรรม)' : 'วางแผน'}`)))),
    h('h3', {}, 'แลป'));
}

export function openProject(app: App, id: string) {
  const p = FINAL_PROJECTS.find((x) => x.id === id);
  if (!p) return;
  const d = $('dialog') as HTMLDialogElement;
  const close = h('button', { class: 'btn', id: 'proj-close', onclick: () => d.close() }, 'ปิด');
  const body: Array<HTMLElement | null> = [
    h('h2', {}, `โปรเจกต์ ${p.number}: ${p.title}`),
    h('p', { class: 'help', style: 'margin-top:-4px' }, p.titleEn),
  ];
  if (p.status === 'planned') {
    body.push(h('p', { class: 'proj-status planned', id: 'proj-status' }, 'สถานะ: วางแผน — ยังไม่มีวงจรแม่แบบและชุดทดสอบ'),
      h('p', {}, p.summary), h('p', { class: 'help' }, p.plannedWhy ?? ''), h('div', { class: 'btn-row' }, close));
    d.replaceChildren(h('div', { class: 'dlg proj-dlg' }, ...body));
    d.showModal();
    return;
  }
  const doc = projectDoc(p)!;
  const sch = SCHEMATICS[`proj-${p.id}`];
  const fig = h('div', { class: 'schem big', id: 'proj-schematic' });
  if (sch) fig.innerHTML = schematicSvg(sch, `รูปวงจร ${p.title}`);
  const wires = wiringList(doc);
  const open = h('button', { class: 'btn primary', id: 'proj-open', onclick: () => {
    d.close();
    if (app.running) app.stop();
    // โค้ดที่ยังไม่บันทึกในตัวแก้ของวงจรเดิมไม่เกี่ยวกับแม่แบบ (บอร์ดใช้ id เดียวกัน) — ล้างทิ้งให้ตัวแก้แสดงโค้ดของแม่แบบ
    app.picoDraft = null; app.rpiDraft = null; app.unoDraft = null;
    app.apply({ ok: true, doc, warnings: [] }, `เปิดแม่แบบโปรเจกต์ ${p.number}: ${p.title} (แทนวงจรเดิม — Undo เพื่อกลับ)`);
    // จัดกล้องให้เห็นวงจรทั้งชุด (เดิมคงมุมกล้องของวงจรก่อนหน้า บอร์ดที่อยู่นอกกรอบจึงถูกตัดขอบ — พบบน iPad/มือถือ)
    if (app.has3d) app.view.smoothCamera(() => app.view.resetView('work'));
  } }, 'เปิดแม่แบบ (แทนวงจรเดิม)');
  body.push(
    h('p', { class: 'proj-status ready', id: 'proj-status' }, `ระดับการจำลอง: ${p.simLevel}`),
    h('p', {}, p.summary),
    h('div', { class: 'btn-row' }, open, close),
    h('h3', {}, 'รูปวงจร'), sch ? fig : h('p', { class: 'help' }, 'ยังไม่มีรูปวงจร'), sch?.note ? h('p', { class: 'help', style: 'font-size:12.5px' }, sch.note) : null,
    h('h3', {}, 'รายการอุปกรณ์ (BOM)'),
    h('table', { class: 'reading-table', id: 'proj-bom' }, h('tr', {}, h('th', {}, 'อุปกรณ์'), h('th', {}, 'จำนวน'), h('th', {}, 'หมายเหตุ')),
      ...p.bom.map((b) => h('tr', {}, h('td', {}, b.item), h('td', {}, String(b.qty)), h('td', {}, b.note)))),
    h('h3', {}, `จุดต่อสาย (${wires.length} เส้น — สร้างจากวงจรแม่แบบ)`),
    h('table', { class: 'reading-table', id: 'proj-wires' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'จาก'), h('th', {}, 'ไป'), h('th', {}, 'สี')),
      ...wires.map((w, i) => h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, w.from), h('td', {}, w.to), h('td', {}, h('span', { class: 'wire-sw', style: `background:${w.color}` }))))),
    h('h3', {}, 'ขั้นตอนทดลองในแอป'), h('ol', {}, ...p.steps.map((s) => h('li', {}, s))),
    h('h3', {}, 'การทดสอบอัตโนมัติ'),
    ...p.tests.map((t) => h('div', {}, h('div', { style: 'font:600 13px var(--f-tech, monospace)' }, t.file), h('ul', {}, ...t.checks.map((c) => h('li', {}, c))))),
    h('h3', {}, 'ข้อจำกัด (อ่านก่อนสร้างจริง)'), h('ul', { id: 'proj-limits' }, ...p.limits.map((s) => h('li', {}, s))),
    p.code ? h('details', {}, h('summary', {}, 'โค้ด (sketch.ino)'), h('pre', { class: 'proj-code', id: 'proj-code' }, p.code)) : null,
  );
  d.replaceChildren(h('div', { class: 'dlg proj-dlg' }, ...body));
  d.classList.add('wide');
  d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
  d.showModal();
}
