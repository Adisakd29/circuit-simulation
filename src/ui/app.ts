import { BuzzerAudio } from './sound';
import { computeConnectivity, netOfPin, netOfTerminal, terminalLabel, type Connectivity } from '../connectivity/connectivity';
import { History } from '../editor/history';
import {
  WIRE_COLORS, addWire, deletePart, deleteWire, duplicatePart, insertPart, moveBoard, moveWireEnd, movePart,
  newId, nextLabel, setProbe, type OpResult,
} from '../editor/ops';
import { analyze, type Analysis } from '../instruments/measure';
import { checkLesson } from '../lessons/checks';
import { groupHoles, holeAt, holeInfo, holeLabel } from '../model/breadboard';
import { catalogEntry, defaultPart, pinDefs } from '../model/catalog';
import { BENCH_ROW_KINDS, boardRect, checkPlacement, footprint, holeOccupancy, holeWorld, isBenchKind, isBoardKind, overlaps, nextRotation, pinCenterOffset, pinHolesFor, worldToGrid } from '../model/geometry';
import { benchSlot } from '../model/bench';
import {
  emptyCircuit, emptyWork, terminalKey,
  type CircuitDoc, type Part, type PartKind, type Placement, type Rotation, type StudentWork, type TerminalRef,
} from '../model/types';
import { SimulationController, type SimUpdate } from '../sim/controller';
import { autosave, downloadText, loadAutosave, parseProject, serializeProject } from '../storage/storage';
import { SceneView, type Pick } from '../render/scene';
import { TABLE_Y } from '../render/models';
import { createNullView, probeWebgl, type View3dFailure, type WebglProbe } from '../render/null-view';
import { $, h, svg } from './dom';
import { icon } from './icons';
import { renderLessons, renderLibrary, renderMeters, renderProps, renderResults } from './panels';
import { DataLogger, type Channel } from '../instruments/logger';
import type { WatchItem } from '../sim/engine';
import type { BuiltNetlist } from '../sim/netlist';
import { renderLogger, updateLoggerLive } from './logger-panel';
import { LedPlayback } from '../render/led-playback';
import { ScopeBuffer, DIV_X } from '../instruments/scope';
import type { FgenPart, PicoPart, ScopePart } from '../model/types';
import type { McuStatus } from '../mcu/cosim';
import { setPartParams } from '../editor/ops';
import { AcRunner } from '../sim/ac-runner';
import { logSweep } from '../sim/ac';
import { buildNetlist } from '../sim/netlist';
import { toBode, type BodeData } from '../instruments/bode';

export type Tool =
  | { t: 'select' }
  | { t: 'camera' }
  | { t: 'wire' }
  | { t: 'probe'; which: 'red' | 'black' }
  | { t: 'place'; kind: PartKind }
  | { t: 'wireEnd'; wireId: string; end: 'a' | 'b' };

export type Selection =
  | { t: 'part'; id: string }
  | { t: 'wire'; id: string }
  | { t: 'terminal'; ref: TerminalRef }
  | { t: 'board'; id: string }
  | null;

/** สถานะการลาก: อุปกรณ์ที่มีอยู่ / อุปกรณ์ใหม่จากคลัง / เบรดบอร์ดทั้งแผ่น — ปล่อยแล้วบันทึกเป็นการแก้ไขเดียว (Undo ครั้งเดียว) */
interface Drag {
  pointerId: number;
  src: 'part' | 'lib' | 'board';
  partId?: string;
  part: Part | null;
  boardId?: string;
  rotation: Rotation;
  /** ตัวชี้ − จุดอ้างอิงของสิ่งที่ลาก (พิกัดโลก x/z) ตอนเริ่มลาก */
  grab: { dx: number; dz: number; px?: number; py?: number };
  candidate: Placement | null;
  boardPos?: { x: number; z: number };
  ok: boolean;
  errors: string[];
  moved: boolean;
  startX: number; startY: number; lastX: number; lastY: number;
  type: string;
}

export interface SimView extends SimUpdate {
  analysis: Analysis;
}

const TAP_PX = 9;
/** แตะค้างในคลังอุปกรณ์นานเท่านี้ (ms) จึงลากอุปกรณ์ออกมาได้ */
const LONG_PRESS_MS = 350;
/**
 * กดค้างได้ถึง 5 วินาทียังนับเป็นการแตะ (ในพื้นที่ทำงานไม่มีคำสั่งแบบกดค้าง)
 * เครื่องที่วาดภาพช้ามาก (วัดบน GPU ซอฟต์แวร์: เฟรมละ >1 วินาที) ส่ง pointerup ช้ากว่าที่นิ้วยกจริงได้เกิน 1.5 วินาที
 */
const TAP_MS = 5000;

/** ช่วงห่างขั้นต่ำของการอัปเดตมิเตอร์/กราฟระหว่างจำลองตามเวลา (ms) */
const LIVE_UI_MS = 100;

export class App {
  history = new History(emptyCircuit());
  /** เสียงบัซเซอร์ */
  audio = new BuzzerAudio();
  private relayState = new Map<string, boolean>();
  work: StudentWork = emptyWork();
  title = 'งานของฉัน';
  tool: Tool = { t: 'select' };
  selection: Selection = null;
  running = false;
  sim: SimView | null = null;
  pendingWire: TerminalRef | null = null;
  placeRotation: Rotation = 0;
  leftTab: 'lib' | 'lessons' = 'lib';
  libQuery = '';
  view: SceneView;
  simc = new SimulationController();
  private connCache: { doc: CircuitDoc; c: Connectivity } | null = null;
  private saveTimer: number | null = null;
  private wireColorIdx = 0;
  sliderGesture: string | null = null;
  logger = new DataLogger();
  scope = new ScopeBuffer();
  scopeFrozen = false;
  scopeSyncSpeed = true;
  dockTab: 'logger' | 'scope' | 'bode' | 'pico' = 'pico';
  /** ข้อความใน console ของ Pico (สะสมระหว่างจำลอง) */
  picoConsole = '';
  mcu: McuStatus | null = null;
  /** โค้ดที่กำลังแก้ในแผง Pico (ยังไม่บันทึกลงไฟล์งาน) */
  picoDraft: { id: string; code: string } | null = null;
  ac = new AcRunner();
  /** ผลกราฟโบดล่าสุด และวงจรที่ใช้คำนวณ (เทียบ identity กับ doc ปัจจุบันเพื่อรู้ว่าล้าสมัย) */
  bode: { doc: CircuitDoc; data: BodeData; ms: number } | null = null;
  private bodePending: CircuitDoc | null = null;
  bodeCursor: number | null = null;
  onBodeUpdate: () => void = () => {};
  loggerOpen = true;
  /** ซ่อนแผงเวลาจำลองทั้งแผง (เหลือปุ่มเล็กแสดงเวลา) */
  loggerHidden = false;
  private lastPanelRefresh = 0;
  private lastSimDoc: CircuitDoc | null = null;

  // สถานะ pointer
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private down: { id: number; x: number; y: number; t: number; type: string } | null = null;
  private drag: Drag | null = null;
  private multiTouch = false;

  /** พื้นที่ 3 มิติพร้อมใช้งาน (false = ใช้ตัวแสดงผลสำรอง: UI อื่นยังทำงาน) */
  has3d = false;
  view3dFailure: { kind: View3dFailure; error?: string; probe?: WebglProbe; at: string } | null = null;

  constructor() {
    // UI ทั้งหมดสร้างก่อน และไม่ขึ้นกับว่าสร้าง renderer 3 มิติได้หรือไม่
    this.view = createNullView();
    this.buildStatic();
    this.bindPointer();
    this.bindKeys();
    this.simc.onResult = (u) => this.onSimResult(u);
    this.simc.watchFor = (doc, built) => this.buildWatch(doc, built);
    this.restore();
    this.refreshAll();
    // พื้นที่ 3 มิติสร้างทีหลัง (main.ts เรียก initView หลังหน้าแสดงผลแล้ว) — เครื่องช้า/GPU แบบซอฟต์แวร์อาจใช้เวลาหลายวินาที
  }

  /** เหตุผลที่คำสั่งนี้ใช้ไม่ได้ตอนไม่มีพื้นที่ 3 มิติ */
  no3dReason(what: string): string {
    const k = this.view3dFailure?.kind;
    return `${what}ไม่ได้: ${k === 'context-lost' ? 'การแสดงผล 3 มิติหยุดชั่วคราว (กำลังกู้คืน)' : 'พื้นที่ทำงาน 3 มิติใช้งานไม่ได้ในเบราว์เซอร์นี้'} — ดูรายละเอียดและปุ่ม "ลองอีกครั้ง" ในพื้นที่ทำงาน`;
  }

  /** สร้าง (หรือสร้างใหม่) ตัวแสดงผล 3 มิติ — งานในวงจรอยู่ใน history จึงไม่หายเมื่อสร้างใหม่ */
  initView(): boolean {
    const old = this.view;
    if (this.drag) this.cancelDrag();
    const probe = probeWebgl();
    let view: SceneView | null = null;
    let failure: View3dFailure | null = null;
    let error: string | undefined;
    if (!probe.webgl1 && !probe.webgl2) { failure = 'webgl-unsupported'; error = probe.error; }
    else {
      try { if (!(old as unknown as { isNull?: boolean }).isNull) old.dispose(); } catch { /* ตัวเก่าเสียอยู่แล้ว */ }
      try { view = new SceneView($('stage')); performance.mark?.('cl:scene'); }
      catch (e) {
        failure = 'renderer-failed'; error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        $('stage').querySelectorAll('canvas.scene-canvas').forEach((c) => c.remove()); // ตัวที่สร้างค้างไว้ครึ่งทาง
      }
    }
    if (!view) {
      this.view = createNullView();
      this.setView3d(false, { kind: failure!, error, probe, at: new Date().toISOString() });
      return false;
    }
    this.view = view;
    view.onContextLost = () => {
      this.setView3d(false, { kind: 'context-lost', probe: undefined, at: new Date().toISOString() });
    };
    view.onContextRestored = () => { if (this.view === view) this.initView(); };
    try { const q = localStorage.getItem('cl3d.quality'); if (q === 'eco' || q === 'high') { view.autoQuality = false; view.setQuality(q); } } catch { /* ไม่มี storage */ }
    view.onAutoEco = () => { this.showQuality(); this.status('เครื่องนี้วาดภาพช้า จึงสลับเป็นภาพโหมดประหยัดอัตโนมัติ (กดปุ่ม "ภาพ" เพื่อเปลี่ยนกลับ)'); };
    view.setDoc(this.doc);
    performance.mark?.('cl:setdoc');
    view.setQuality(view.quality); // ผูกแสงสะท้อนโลหะกับ renderer ตัวใหม่ (วัสดุใช้ร่วมกันข้ามตัวแสดงผล)
    const wasLost = this.view3dFailure?.kind === 'context-lost';
    this.setView3d(true, null);
    if (wasLost) this.status('การแสดงผล 3 มิติกลับมาแล้ว — งานทั้งหมดยังอยู่ครบ');
    this.updateHighlight();
    view.resetView();
    return true;
  }

  private setView3d(ok: boolean, failure: App['view3dFailure']) {
    this.has3d = ok;
    this.view3dFailure = failure;
    document.documentElement.dataset.view3d = ok ? 'ok' : failure?.kind ?? 'off';
    this.renderStageNotice();
    this.renderTools();
    this.renderViewCtl();
    this.renderToolbar();
    renderLibrary(this);
    this.showQuality();
    if (!ok && failure?.kind === 'context-lost') this.status('การแสดงผล 3 มิติหยุดชั่วคราว (GPU ทิ้ง context) — งานยังอยู่ครบ กำลังรอกู้คืน', 'err');
  }

  /** ข้อความในพื้นที่ทำงานเมื่อไม่มี 3 มิติ: สาเหตุ สิ่งที่ยังใช้ได้ ปุ่มลองใหม่ และรายละเอียดสำหรับแจ้งปัญหา */
  private renderStageNotice() {
    const old = document.getElementById('stage-notice');
    if (this.has3d || !this.view3dFailure) { old?.remove(); return; }
    const f = this.view3dFailure;
    const title = f.kind === 'webgl-unsupported' ? 'เบราว์เซอร์นี้ไม่รองรับ WebGL' : f.kind === 'renderer-failed' ? 'สร้างพื้นที่ 3 มิติไม่สำเร็จ' : 'การแสดงผล 3 มิติหยุดชั่วคราว';
    const why = f.kind === 'webgl-unsupported'
      ? 'เบราว์เซอร์หรืออุปกรณ์นี้ปิด/ไม่มี WebGL (เช่น ปิด hardware acceleration, ไดรเวอร์กราฟิกถูกบล็อก, เปิดในแอปที่ฝังเว็บแบบจำกัด) จึงวาดเบรดบอร์ด 3 มิติไม่ได้'
      : f.kind === 'renderer-failed'
        ? 'เบราว์เซอร์มี WebGL แต่สร้างตัววาดภาพไม่สำเร็จ (อาจเพราะหน่วยความจำกราฟิกไม่พอ หรือเปิดแท็บ 3 มิติไว้หลายแท็บ)'
        : 'GPU หรือเบราว์เซอร์ทิ้งการแสดงผลชั่วคราว (มักเกิดเมื่อสลับแอปบนมือถือ หรือไดรเวอร์รีเซ็ต) วงจรและงานทั้งหมดยังอยู่ครบ';
    const diag = this.diagnostics();
    const pre = h('pre', { class: 'diag' }, diag);
    const box = h('div', { id: 'stage-notice', class: 'stage-notice', role: 'alert' },
      h('h2', {}, title),
      h('p', {}, why),
      h('p', {}, 'ยังใช้ได้: ดูคลังอุปกรณ์ เปิดแลป เปิด/บันทึกไฟล์ Undo/Redo และกด Run เพื่อจำลองวงจรที่มีอยู่ (ดูค่าที่แผงผลการวัด) · ใช้ไม่ได้จนกว่า 3 มิติจะกลับมา: วาง/ย้ายอุปกรณ์ ต่อสาย วางโพรบ และมุมกล้อง'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', id: 'btn-retry-3d', onclick: () => { if (this.initView()) this.status('เปิดพื้นที่ 3 มิติได้แล้ว'); else this.status('ยังเปิดพื้นที่ 3 มิติไม่ได้ — ดูรายละเอียดด้านล่าง', 'err'); } }, svg(icon('retry')), 'ลองเปิด 3 มิติอีกครั้ง'),
        h('button', { class: 'btn', onclick: () => location.reload() }, 'โหลดหน้าใหม่')),
      h('p', { class: 'help' }, 'ถ้ายังไม่ได้: เปิดด้วย Chrome, Edge, Safari หรือ Firefox รุ่นล่าสุด และเปิด "ใช้การเร่งฮาร์ดแวร์ (hardware acceleration)" ในการตั้งค่าเบราว์เซอร์ งานที่ทำไว้บันทึกอัตโนมัติในเครื่องนี้'),
      h('details', {}, h('summary', {}, 'รายละเอียดสำหรับแจ้งปัญหา'), pre,
        h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(diag).then(() => this.status('คัดลอกรายละเอียดแล้ว'), () => this.status('คัดลอกอัตโนมัติไม่ได้ — เลือกข้อความเอง', 'err')); } }, svg(icon('copy')), 'คัดลอก')));
    if (old) old.replaceWith(box); else $('stage').append(box);
  }

  diagnostics(): string {
    const f = this.view3dFailure;
    const p = f?.probe ?? probeWebgl();
    return [
      `สาเหตุ: ${f?.kind ?? '—'}`,
      f?.error ? `ข้อผิดพลาด: ${f.error}` : null,
      `WebGL2: ${p.webgl2 ? 'มี' : 'ไม่มี'} · WebGL1: ${p.webgl1 ? 'มี' : 'ไม่มี'}${p.majorCaveat ? ' · ทำงานแบบ software (ช้า)' : ''}`,
      p.renderer ? `GPU: ${p.renderer} (${p.vendor ?? ''})` : null,
      `เบราว์เซอร์: ${navigator.userAgent}`,
      `จอ: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x · touch ${navigator.maxTouchPoints}`,
      `เวลา: ${f?.at ?? new Date().toISOString()}`,
    ].filter(Boolean).join('\n');
  }

  get doc(): CircuitDoc { return this.history.doc; }

  conn(doc = this.doc): Connectivity {
    if (this.connCache?.doc !== doc) this.connCache = { doc, c: computeConnectivity(doc) };
    return this.connCache.c;
  }

  /** ผลจำลองที่ตรงกับวงจรปัจจุบันเท่านั้น */
  get freshSim(): SimView | null {
    return this.running && this.sim && this.sim.doc === this.doc ? this.sim : null;
  }

  /* ================= สถานะ/ข้อความ ================= */

  status(msg: string, kind: 'ok' | 'err' = 'ok') {
    const el = $('status-msg');
    el.textContent = msg;
    el.classList.toggle('err', kind === 'err');
  }

  hint(text: string) { $('hint').textContent = text; }

  /* ================= คำสั่งแก้ไข ================= */

  apply(r: OpResult, label: string, opts: { amend?: boolean } = {}): boolean {
    if (!r.ok) { this.status(r.errors.join(' · '), 'err'); return false; }
    if (!(opts.amend && this.history.amend(r.doc, label))) this.history.commit(r.doc, label);
    if (r.warnings.length) this.status(r.warnings.join(' · '));
    else this.status(label);
    this.afterDocChange();
    return true;
  }

  /** ปุ่มกดที่กำลังถูกกดค้าง (ตัวชี้, id อุปกรณ์) */
  private pressHold: { pointerId: number | null; partId: string } | null = null;

  /** กด/ปล่อยปุ่มกด — สถานะชั่วคราว ไม่ลงประวัติ Undo (ปล่อยแล้วกลับเป็นปกติเหมือนปุ่มจริง) */
  setButtonPressed(partId: string, pressed: boolean, pointerId: number | null = null) {
    const part = this.doc.parts.find((p) => p.id === partId);
    if (!part || part.kind !== 'pushbutton') return;
    this.pressHold = pressed ? { pointerId, partId } : null;
    if (part.params.pressed === pressed) return;
    const r = setPartParams(this.doc, partId, { pressed });
    if (!r.ok) return;
    this.history.replace(r.doc);
    this.status(`${pressed ? 'กด' : 'ปล่อย'}ปุ่ม ${part.label}`);
    this.afterDocChange();
  }

  /** ปล่อยปุ่มที่กดค้างอยู่ (เมื่อยกนิ้ว/ปล่อยเมาส์ที่ใดก็ได้) */
  releaseHeldButton(pointerId?: number) {
    const h = this.pressHold;
    if (!h || (pointerId !== undefined && h.pointerId !== null && h.pointerId !== pointerId)) return;
    this.setButtonPressed(h.partId, false);
  }

  afterDocChange() {
    // ตรวจว่าสิ่งที่เลือกยังอยู่
    const s = this.selection;
    if (s?.t === 'part' && !this.doc.parts.some((p) => p.id === s.id)) this.selection = null;
    if (s?.t === 'wire' && !this.doc.wires.some((w) => w.id === s.id)) this.selection = null;
    if (s?.t === 'board' && !this.doc.breadboards.some((b) => b.id === s.id)) this.selection = null;
    if (this.tool.t === 'wireEnd' && !this.doc.wires.some((w) => w.id === (this.tool as { wireId: string }).wireId)) this.setTool({ t: 'select' });
    this.view.setDoc(this.doc);
    this.simc.invalidate(this.doc);
    this.scheduleSave();
    this.refreshPanels();
  }

  undo() {
    const l = this.history.undo();
    if (l) { this.status(`ย้อนกลับ: ${l}`); this.afterDocChange(); }
  }

  redo() {
    const l = this.history.redo();
    if (l) { this.status(`ทำซ้ำ: ${l}`); this.afterDocChange(); }
  }

  rotateSelected() {
    const d = this.drag;
    if (d && d.part) {
      d.rotation = nextRotation(d.rotation);
      if (d.src === 'lib') { const c = pinCenterOffset(d.part, d.rotation); d.grab = { dx: c.dx, dz: c.dz }; this.placeRotation = d.rotation; }
      if (d.moved) this.updateDrag(d.lastX, d.lastY);
      return;
    }
    if (this.tool.t === 'place') {
      this.placeRotation = nextRotation(this.placeRotation);
      this.hint(`หมุนเป็น ${this.placeRotation}° — แตะตำแหน่งเพื่อวาง`);
      return;
    }
    const s = this.selection;
    if (s?.t !== 'part') { this.status('เลือกอุปกรณ์ก่อน แล้วจึงหมุน', 'err'); return; }
    const part = this.doc.parts.find((p) => p.id === s.id)!;
    const pl = { ...part.placement, rotation: nextRotation(part.placement.rotation) } as Placement;
    this.apply(movePart(this.doc, part.id, pl), `หมุน ${part.label} 90°`);
  }

  duplicateSelected() {
    const s = this.selection;
    if (s?.t !== 'part') return;
    const part = this.doc.parts.find((p) => p.id === s.id)!;
    const cands: Placement[] = [];
    if (part.placement.kind === 'board') {
      const a = holeInfo(part.placement.anchor)!;
      const offsets = [[0, 1], [0, 2], [0, -1], [2, 0], [5, 0], [-5, 0], [0, 3], [0, 4], [6, 1], [-6, 1], [8, 0], [-8, 0], [0, 7], [0, -7]];
      for (const [dx, dy] of offsets) {
        const name = holeAt(a.x + dx, a.y + dy);
        if (name) cands.push({ ...part.placement, anchor: name });
      }
    } else {
      for (const [dx, dz] of [[0, 9], [0, -9], [-12, 0], [12, 0], [0, 18]]) cands.push({ ...part.placement, x: part.placement.x + dx, z: part.placement.z + dz });
    }
    const r = duplicatePart(this.doc, part.id, cands);
    if (this.apply(r, `คัดลอก ${part.label}`) && r.ok && r.createdId) this.select({ t: 'part', id: r.createdId });
  }

  deleteSelected() {
    const s = this.selection;
    if (s?.t === 'part') {
      const label = this.doc.parts.find((p) => p.id === s.id)?.label;
      this.apply(deletePart(this.doc, s.id), `ลบ ${label}`);
    } else if (s?.t === 'wire') this.apply(deleteWire(this.doc, s.id), 'ลบสาย');
  }

  /* ================= เครื่องมือ/การเลือก ================= */

  setTool(t: Tool) {
    this.tool = t;
    this.pendingWire = null;
    this.view.setPendingMarker(null);
    this.view.setGhost(null, true, this.doc);
    this.view.setHoverMarker(null);
    const coarse = matchMedia('(pointer: coarse)').matches;
    const hints: Record<string, string> = {
      select: coarse ? 'แตะอุปกรณ์เพื่อเลือก แล้วลากนิ้วเดียวเพื่อย้าย · ลากที่ว่าง = หมุนกล้อง · สองนิ้ว = ซูม/เลื่อน' : 'ลากอุปกรณ์เพื่อย้าย (เข้า/ออกบอร์ดได้) · ลากที่ว่าง = หมุนกล้อง · คลิกขวาลาก = เลื่อน · ล้อ = ซูม',
      camera: coarse ? 'โหมดกล้อง: นิ้วเดียวหมุน · สองนิ้วซูม/เลื่อน — อุปกรณ์จะไม่ถูกย้าย' : 'โหมดกล้อง: ลากหมุน · คลิกขวาลากเลื่อน · ล้อซูม — อุปกรณ์จะไม่ถูกย้าย',
      wire: 'แตะขาหรือรูต้นทาง แล้วแตะปลายทาง เพื่อสร้างสาย · ลากที่ว่างเพื่อหมุนกล้อง',
      probe: '',
      place: '',
      wireEnd: 'แตะรูหรือขั้วใหม่สำหรับปลายสาย',
    };
    let hint = hints[t.t];
    if (t.t === 'probe') hint = `แตะจุดที่จะวางโพรบ${t.which === 'red' ? 'แดง (+)' : 'ดำ (COM)'}`;
    if (t.t === 'place') {
      const e = catalogEntry(t.kind)!;
      hint = e.mount === 'board' ? `แตะรูบนเบรดบอร์ด (ขาที่ 1 ลงรูที่แตะ) หรือแตะพื้นโต๊ะเพื่อวาง${e.name} · "หมุน" หรือ R เพื่อหมุน · Esc ยกเลิก` : `แตะพื้นโต๊ะนอกบอร์ดเพื่อวาง${e.name} · Esc ยกเลิก`;
    }
    this.hint(hint);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (t.t === 'select' || t.t === 'camera') this.hintTimer = window.setTimeout(() => { if (this.tool.t === t.t && !this.drag) this.hint(''); }, 7000);
    this.renderViewCtl();
    this.renderTools();
    renderLibrary(this);
    this.renderQuick();
  }

  private hintTimer: number | null = null;

  select(sel: Selection) {
    this.selection = sel;
    this.updateHighlight();
    this.refreshPanels();
  }

  /** ไฮไลต์รูทั้งหมดที่เชื่อมถึงสิ่งที่เลือก */
  updateHighlight() {
    const s = this.selection;
    const c = this.conn();
    const nets = new Set<number>();
    if (s?.t === 'terminal') { const n = netOfTerminal(c, s.ref); if (n !== undefined) nets.add(n); }
    if (s?.t === 'part') {
      const p = this.doc.parts.find((x) => x.id === s.id);
      if (p) for (const d of pinDefs(p)) { const n = netOfPin(c, p.id, d.name); if (n !== undefined) nets.add(n); }
    }
    if (s?.t === 'wire') {
      const w = this.doc.wires.find((x) => x.id === s.id);
      if (w) { const n = netOfTerminal(c, w.a); if (n !== undefined) nets.add(n); }
    }
    if (this.pendingWire) { const n = netOfTerminal(c, this.pendingWire); if (n !== undefined) nets.add(n); }
    const keys: string[] = [];
    for (const n of nets) for (const t of c.nets[n].terminals) if (t.includes('/')) keys.push(t);
    this.view.setHighlightHoles(this.doc, keys);
    this.view.setSelection(s && (s.t === 'part' || s.t === 'wire' || s.t === 'board') ? s.id : null);
    this.renderViewCtl();
  }

  /* ================= การจำลอง ================= */

  run() {
    this.running = true;
    this.picoConsole = '';
    this.simc.start(this.doc);
    const reactive = this.doc.parts.some((p) => p.kind === 'capacitor' || p.kind === 'inductor');
    if (this.picoPart()) this.status('เริ่มจำลอง — บอร์ด Pico กำลังบูต MicroPython แล้วรันโค้ดอัตโนมัติ (ถ้าเปิดไว้)');
    else this.status(reactive
      ? 'เริ่มจำลองตามเวลา (มีตัวเก็บประจุ/ตัวเหนี่ยวนำ) — เวลาเริ่มที่ 0 s และตัวเก็บประจุเริ่มที่แรงดันเริ่มต้น'
      : 'เริ่มการจำลอง DC — แก้ไขวงจรได้ระหว่างจำลอง ผลจะคำนวณใหม่อัตโนมัติ');
    this.refreshPanels();
  }

  /** รายการค่าที่ worker ต้องบันทึกตามเวลา: โพรบ + แอมมิเตอร์ทุกตัว */
  private buildWatch(doc: CircuitDoc, built: BuiltNetlist): WatchItem[] {
    const c = built.connectivity;
    const w: WatchItem[] = [];
    if (doc.probes.red && doc.probes.black) w.push({ key: 'probe', kind: 'v', a: netOfTerminal(c, doc.probes.red), b: netOfTerminal(c, doc.probes.black) });
    for (const p of doc.parts) if (p.kind === 'ammeter') w.push({ key: `i:${p.id}`, kind: 'i', id: p.id });
    // กระแส LED ทุกดวง: ใช้เล่นความสว่างในฉากตามเวลาจำลองจริง (ไม่ใช่ช่องของกราฟบันทึกค่า)
    for (const p of doc.parts) if (p.kind === 'led') w.push({ key: `led:${p.id}`, kind: 'i', id: p.id });
    const sc = this.scopePart(doc);
    if (sc) {
      const g = netOfPin(c, sc.id, 'GND');
      w.push({ key: 'scope:ch1', kind: 'v', a: netOfPin(c, sc.id, 'CH1'), b: g });
      w.push({ key: 'scope:ch2', kind: 'v', a: netOfPin(c, sc.id, 'CH2'), b: g });
    }
    this.syncScopeTiming(doc);
    return w;
  }

  picoPart(doc = this.doc): PicoPart | undefined {
    return doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  }

  /** ส่งโค้ดไปรันบน Pico (บันทึกโค้ดลงไฟล์งานด้วย) */
  picoRun(code: string) {
    const p = this.picoPart();
    if (!p) return;
    if (code !== p.params.code) this.apply(setPartParams(this.doc, p.id, { code }), `แก้โค้ด ${p.label}`);
    if (!this.running) { this.status('กด Run เพื่อเปิดบอร์ดก่อน แล้วจึงรันโค้ด', 'err'); return; }
    this.picoConsole += '\n';
    this.simc.mcuCommand(p.id, { run: code });
    this.status(`ส่งโค้ด ${code.split('\n').length} บรรทัดไปรันบน ${p.label} (MicroPython)`);
  }

  /** บันทึกโค้ดลงไฟล์งาน (เมื่อออกจากช่องพิมพ์) */
  picoCommit(code: string) {
    const p = this.picoPart();
    if (p && code !== p.params.code) this.apply(setPartParams(this.doc, p.id, { code }), `แก้โค้ด ${p.label}`);
  }

  picoStop() {
    const p = this.picoPart();
    if (p && this.running) this.simc.mcuCommand(p.id, { stop: true });
  }

  picoSend(line: string) {
    const p = this.picoPart();
    if (!p || !this.running) return;
    this.simc.mcuCommand(p.id, { serial: [...new TextEncoder().encode(line), 13] });
  }

  /** เครื่องกำเนิดสัญญาณที่เปิดเอาต์พุต (แหล่งกระตุ้นของ AC sweep) */
  fgenPart(doc = this.doc): FgenPart | undefined {
    return doc.parts.find((p): p is FgenPart => p.kind === 'fgen' && p.params.outputOn);
  }

  /** คำนวณกราฟโบดใหม่ถ้าวงจรหรือค่าตั้งเปลี่ยน (คำนวณใน worker แยก ไม่รบกวนเวลาจำลอง) */
  requestBode(force = false) {
    const doc = this.doc;
    if (!force && (this.bode?.doc === doc || this.bodePending === doc)) return;
    const sc = this.scopePart(doc);
    const fg = this.fgenPart(doc);
    const fail = (error: string) => { this.bode = { doc, data: { ok: false, error, ref: 'ch1', freqs: [], mag: [], phase: [], notes: [] }, ms: 0 }; this.onBodeUpdate(); };
    if (!sc) return fail('วางออสซิลโลสโคปและต่อ CH2 ที่จุดที่ต้องการวัด');
    if (!fg) return fail('ต้องมีเครื่องกำเนิดสัญญาณที่เปิดเอาต์พุตเป็นแหล่งกระตุ้น');
    const built = buildNetlist(doc);
    const c = built.connectivity;
    const g = netOfPin(c, sc.id, 'GND');
    const p = sc.params;
    const freqs = logSweep(p.bodeStart, p.bodeStop, p.bodePpd);
    this.bodePending = doc;
    this.ac.run({ netlist: built.netlist, sourceId: fg.id, freqs, probes: [
      { key: 'ch1', a: netOfPin(c, sc.id, 'CH1'), b: g },
      { key: 'ch2', a: netOfPin(c, sc.id, 'CH2'), b: g },
    ] }).then((r) => {
      if (!r || this.bodePending !== doc) return;
      this.bodePending = null;
      this.bode = { doc, data: toBode(r, p.bodeRef), ms: r.ms };
      this.onBodeUpdate();
    });
  }

  /** ออสซิลโลสโคปเครื่องแรกในวงจร (แผงสโคปแสดงได้ทีละเครื่อง) */
  scopePart(doc = this.doc): ScopePart | undefined {
    return doc.parts.find((p): p is ScopePart => p.kind === 'scope');
  }

  /** ตั้งความถี่การเก็บตัวอย่าง และความเร็วเวลาให้เห็นราว 2 หน้าจอต่อวินาที (ถ้าเปิดซิงก์) */
  syncScopeTiming(doc = this.doc) {
    const sc = this.scopePart(doc);
    this.simc.sampleSpacing = sc ? sc.params.timeDiv / 40 : undefined;
    if (sc && this.scopeSyncSpeed) this.simc.speed = Math.min(10, Math.max(1e-5, sc.params.timeDiv * DIV_X * 2));
  }

  private channelsFor(doc: CircuitDoc, watch: WatchItem[]): Channel[] {
    const colors = ['#c8372d', '#b7791f', '#2c5fb8', '#2e7d57', '#8e24aa'];
    let ci = 1;
    return watch.filter((w) => !w.key.startsWith('scope:') && !w.key.startsWith('led:')).map((w) => w.kind === 'v'
      ? { key: w.key, label: 'โวลต์มิเตอร์ (โพรบ)', unit: 'V' as const, color: colors[0] }
      : { key: w.key, label: `แอมมิเตอร์ ${doc.parts.find((p) => p.id === w.id)?.label ?? ''}`, unit: 'mA' as const, color: colors[ci++ % colors.length] });
  }

  togglePause() {
    this.simc.setPaused(!this.simc.paused);
    this.status(this.simc.paused ? 'หยุดเวลาไว้ — แก้วงจรได้ ค่าจะคำนวณ ณ เวลาปัจจุบัน' : 'เวลาเดินต่อ');
    renderLogger(this);
  }

  restartTime() {
    this.simc.restartTime();
    this.scope.reset();
    if (this.picoPart()) {
      this.picoConsole += '\n--- รีเซ็ตบอร์ด ---\n';
      this.status('รีเซ็ตบอร์ด Pico (บูต MicroPython ใหม่) และเริ่มเวลาใหม่ที่ 0 s');
      return;
    }
    this.status('เริ่มเวลาใหม่ที่ 0 s — ตัวเก็บประจุกลับไปที่แรงดันเริ่มต้น ตัวเหนี่ยวนำกระแส 0');
  }

  setSpeed(v: number) {
    this.simc.speed = v;
    renderLogger(this);
  }

  stop() {
    this.running = false;
    this.audio.stopAll();
    this.simc.stop();
    this.sim = null;
    this.logger.reset(false);
    this.scope.reset();
    this.status('หยุดการจำลอง');
    if (this.mcu) this.view.setMcuLeds([{ id: this.mcu.id, led: 0 }]);
    this.mcu = null;
    if (this.view.ledPlayback) this.view.setLedPlayback(null);
    this.view.setAnalysis(this.doc, null, false);
    this.refreshPanels();
  }

  private onSimResult(u: SimUpdate) {
    const analysis = analyze(u.doc, u.built, u.result, u.tones);
    // เสียงคลิกเมื่อรีเลย์เปลี่ยนสถานะ
    for (const p of u.doc.parts) {
      if (p.kind !== 'relay') continue;
      const on = analysis.parts[p.id]?.extra?.energized === 1;
      const was = this.relayState.get(p.id);
      if (was !== undefined && was !== on && this.running) this.audio.click();
      this.relayState.set(p.id, on);
    }
    this.sim = { ...u, analysis };
    this.audio.update(this.running ? u.doc.parts.flatMap((p) => {
      const r = analysis.parts[p.id];
      return (p.kind === 'buzzer' || p.kind === 'speaker') && r?.extra?.sounding ? [{ id: p.id, freq: r.extra.freq, level: r.extra.level }] : [];
    }) : []);
    if (u.mode === 'tran') {
      // แยกตัวอย่าง: ช่องของกราฟบันทึกค่า กับช่องของออสซิลโลสโคป
      const logIdx = u.watch.map((w, i) => (w.key.startsWith('scope:') || w.key.startsWith('led:') ? -1 : i)).filter((i) => i >= 0);
      const s1 = u.watch.findIndex((w) => w.key === 'scope:ch1'), s2 = u.watch.findIndex((w) => w.key === 'scope:ch2');
      this.logger.setChannels(this.channelsFor(u.doc, u.watch), logIdx.map((i) => u.watch[i]));
      if (u.restarted) { this.logger.reset(true); this.scope.reset(); }
      // กราฟบันทึกค่าเก็บราว 2,000 จุดต่อหน้าต่าง 8 วินาทีจริง
      const minGap = (8 * this.simc.speed) / 2000;
      let lastT = this.logger.t.length ? this.logger.t[this.logger.t.length - 1] : -Infinity;
      const logSamples = u.samples.filter((s) => { if (s.t - lastT >= minGap) { lastT = s.t; return true; } return false; })
        .map((s) => ({ t: s.t, v: logIdx.map((i) => s.v[i]) }));
      this.logger.push(logSamples);
      const sc = this.scopePart(u.doc);
      if (sc && s1 >= 0 && !this.scopeFrozen) {
        for (const s of u.samples) this.scope.push(s.t, s.v[s1], s.v[s2]);
        this.scope.trim(sc.params.timeDiv * DIV_X * 3.2);
      }
    }
    if (u.mcu?.length) {
      const m = u.mcu[0];
      this.mcu = m;
      if (m.console) {
        this.picoConsole = (this.picoConsole + m.console).slice(-40000);
      }
      if (m.finished) this.status(m.finished.ok ? 'โปรแกรมทำงานจบ' : 'โปรแกรมหยุดด้วยข้อผิดพลาด — ดูข้อความใน console', m.finished.ok ? 'ok' : 'err');
      this.view.setMcuLeds(u.mcu);
    } else this.mcu = null;
    this.feedLedPlayback(u);
    this.view.setAnalysis(u.doc, analysis, true);
    // ตามเวลา: ผลมาทุก 50 ms — อัปเดตมิเตอร์/กราฟทุกครั้ง แต่แผงรายละเอียดอย่างมาก 4 ครั้ง/วินาที
    const now = performance.now();
    const docChanged = u.doc !== this.lastSimDoc;
    this.lastSimDoc = u.doc;
    if (u.mode === 'dc' || docChanged || u.restarted || now - this.lastPanelRefresh > 250) {
      this.lastPanelRefresh = now;
      this.refreshPanels();
    } else if (now - this.lastLiveUi >= LIVE_UI_MS) {
      this.liveUi();
    } else if (this.liveUiTimer === null) {
      // ผลจำลองมาถี่ (ทุก 20–50 ms) — มิเตอร์/กราฟอัปเดตไม่เกิน 10 ครั้ง/วินาที (DOM และการวาดกราฟบนแท็บเล็ตกินเวลา main thread
      // ถ้าทำทุกผลจะแย่งเวลากับการแตะปุ่ม) แต่ยังแสดงผลล่าสุดเสมอด้วยการอัปเดตตามหลัง
      this.liveUiTimer = window.setTimeout(() => { this.liveUiTimer = null; if (this.running) this.liveUi(); }, LIVE_UI_MS - (now - this.lastLiveUi));
    }
  }

  /** ส่งตัวอย่างกระแส LED ของช่วงนี้ให้ตัวเล่นในฉาก (จำลองตามเวลาเท่านั้น) */
  private feedLedPlayback(u: SimUpdate) {
    const idx = u.watch.map((w, i) => (w.key.startsWith('led:') ? i : -1)).filter((i) => i >= 0);
    if (u.mode !== 'tran' || !idx.length || !this.has3d) { if (this.view.ledPlayback) this.view.setLedPlayback(null); return; }
    const ids = idx.map((i) => u.watch[i].key.slice(4));
    let pb = this.view.ledPlayback;
    if (!pb || pb.ids.join() !== ids.join()) {
      const rated = ids.map((id) => { const p = u.doc.parts.find((x) => x.id === id); return p && p.kind === 'led' ? p.params.ratedCurrent : 0.02; });
      pb = new LedPlayback(ids, rated, this.simc.speed);
      this.view.setLedPlayback(pb);
    }
    const samples = u.samples.map((s) => ({ t: s.t, i: idx.map((i) => s.v[i] ?? 0) }));
    pb.push(samples, u.t, performance.now(), this.simc.speed, u.restarted);
  }

  private lastLiveUi = 0;
  private liveUiTimer: number | null = null;
  private liveUi() {
    this.lastLiveUi = performance.now();
    renderMeters(this);
    updateLoggerLive(this);
    this.renderToolbar();
  }

  /* ================= บันทึก ================= */

  scheduleSave() {
    $('save-status').textContent = 'มีการแก้ไข…';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const r = autosave(this.title, this.doc, this.work);
      const t = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      $('save-status').textContent = r.ok ? `บันทึกอัตโนมัติในเครื่องแล้ว ${t} น.` : r.error!;
    }, 700);
  }

  private restore() {
    const v = loadAutosave();
    if (v?.ok && v.file) {
      this.history.reset(v.file.circuit);
      this.work = v.file.studentWork;
      this.title = v.file.title;
      $('save-status').textContent = 'กู้คืนงานที่บันทึกอัตโนมัติไว้';
    } else if (v && !v.ok) {
      this.status(`งานที่บันทึกอัตโนมัติไว้เสียหาย จึงเริ่มงานใหม่ (${v.errors[0]})`, 'err');
    } else {
      $('save-status').textContent = 'ยังไม่มีงานบันทึก';
    }
    (document.getElementById('doc-title') as HTMLInputElement).value = this.title;
  }

  /**
   * Save: เปิดหน้าต่างที่มีทั้งปุ่มดาวน์โหลดไฟล์และปุ่มคัดลอก JSON
   * (บางสภาพแวดล้อม เช่น หน้าเว็บที่ฝังใน sandbox อาจไม่อนุญาตให้ดาวน์โหลด — คัดลอกไปวางในไฟล์เองได้)
   */
  saveFile() {
    const safe = this.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'circuit';
    const name = `${safe}.circuitlab.json`;
    const text = serializeProject(this.title, this.doc, this.work);
    const d = $('dialog') as HTMLDialogElement;
    const ta = h('textarea', { id: 'save-json', rows: '6', readonly: true, style: 'width:100%;font-size:12px;font-family:ui-monospace,monospace;border:1px solid var(--line);border-radius:6px;padding:6px' });
    ta.value = text;
    const note = h('p', { class: 'help', style: 'font-size:13px;color:var(--ink-2)' });
    d.replaceChildren(h('div', { class: 'dlg' },
      h('h2', {}, 'บันทึกเป็นไฟล์ JSON'),
      h('p', {}, `ไฟล์ ${name} เก็บวงจร ค่าอุปกรณ์ การเชื่อมต่อ และงานแลป (schema รุ่น 1) เปิดกลับมาได้ด้วยปุ่ม Open`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', id: 'save-download', onclick: async () => { const r = await downloadText(name, text); this.status(r.message, r.ok ? 'ok' : 'err'); note.textContent = r.message; } }, svg(icon('download')), 'ดาวน์โหลดไฟล์'),
        h('button', { class: 'btn', id: 'save-copy', onclick: () => {
          const done = () => { note.textContent = 'คัดลอก JSON แล้ว นำไปวางในไฟล์ข้อความแล้วตั้งชื่อลงท้าย .json'; this.status('คัดลอก JSON แล้ว'); };
          navigator.clipboard?.writeText(text).then(done, () => { ta.select(); note.textContent = 'คัดลอกอัตโนมัติไม่ได้ — เลือกข้อความไว้ให้แล้ว กด Ctrl+C / คัดลอก'; });
        } }, svg(icon('copy')), 'คัดลอก JSON'),
        h('button', { class: 'btn', onclick: () => d.close() }, 'ปิด')),
      note, ta));
    d.showModal();
  }

  async openFile(file: File) {
    const text = await file.text();
    const v = parseProject(text);
    if (!v.ok || !v.file) {
      this.dialog('เปิดไฟล์ไม่ได้', [`ไฟล์ "${file.name}" ไม่ผ่านการตรวจสอบ:`], v.errors);
      return;
    }
    if (this.running) this.stop();
    this.history.reset(v.file.circuit);
    this.work = v.file.studentWork;
    this.title = v.file.title;
    (document.getElementById('doc-title') as HTMLInputElement).value = this.title;
    this.selection = null;
    this.afterDocChange();
    this.updateHighlight();
    renderLessons(this);
    this.view.resetView();
    this.status(`เปิด "${v.file.title}" แล้ว${v.warnings.length ? ` (คำเตือน ${v.warnings.length} รายการ)` : ''}`);
    if (v.warnings.length) this.dialog('เปิดไฟล์แล้ว แต่มีคำเตือน', [], v.warnings);
  }

  newDoc() {
    const go = () => {
      if (this.running) this.stop();
      this.history.reset(emptyCircuit());
      this.work = emptyWork();
      this.title = 'งานของฉัน';
      (document.getElementById('doc-title') as HTMLInputElement).value = this.title;
      this.selection = null;
      this.afterDocChange();
      this.updateHighlight();
      renderLessons(this);
      this.status('เริ่มงานใหม่');
    };
    if (this.doc.parts.length || this.doc.wires.length) {
      this.dialog('เริ่มงานใหม่?', ['วงจรและงานแลปปัจจุบันจะถูกล้าง ถ้าต้องการเก็บไว้ ให้กด Save เพื่อบันทึกเป็นไฟล์ก่อน'], [], [{ label: 'เริ่มงานใหม่', primary: true, act: go }]);
    } else go();
  }

  dialog(title: string, paras: string[], items: string[] = [], actions: Array<{ label: string; primary?: boolean; act: () => void }> = []) {
    const d = $('dialog') as HTMLDialogElement;
    d.replaceChildren(h('div', { class: 'dlg' },
      h('h2', {}, title),
      ...paras.map((p) => h('p', {}, p)),
      items.length ? h('ul', {}, ...items.map((i) => h('li', {}, i))) : null,
      h('div', { class: 'btn-row' },
        ...actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''}`, onclick: () => { d.close(); a.act(); } }, a.label)),
        h('button', { class: 'btn', onclick: () => d.close() }, actions.length ? 'ยกเลิก' : 'ปิด'),
      )));
    d.showModal();
  }

  /* ================= งานนักเรียน ================= */

  updateWork(mut: (w: StudentWork) => void) {
    mut(this.work);
    this.scheduleSave();
  }

  /** ตรวจแลปปัจจุบันและจดจำเป้าหมายที่เคยผ่าน */
  lessonStatus() {
    const id = this.work.lessonId;
    if (!id) return {};
    const s = this.freshSim;
    const res = checkLesson(id, s ? { doc: s.doc, built: s.built, result: s.result, analysis: s.analysis, work: this.work, logger: s.mode === 'tran' ? this.logger : null, time: s.t, scopeMeasure: this.scopePart(s.doc) ? (() => { const f = this.scope.frame(this.scopePart(s.doc)!.params); return f.measure; })() : null, bode: this.bode?.doc === s.doc ? this.bode.data : null } : null);
    const ach = (this.work.achieved[id] ??= {});
    let changed = false;
    for (const [k, v] of Object.entries(res)) if (v.pass && !ach[k]) { ach[k] = true; changed = true; }
    if (changed) this.scheduleSave();
    return res;
  }

  /* ================= การโต้ตอบในฉาก ================= */

  private bindPointer() {
    const stage = $('stage');
    stage.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.showPinTip(null); });
    window.addEventListener('blur', () => this.releaseHeldButton());
    // เสียง: เปิดใช้ Web Audio เมื่อผู้ใช้โต้ตอบครั้งแรก, หยุดเสียงเมื่อซ่อนหน้า
    window.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));
    stage.addEventListener('pointerleave', () => { if (!this.drag) { this.view.setHoverMarker(null); if (this.tool.t === 'place') this.view.setGhost(null, true, this.doc); } });
    // ระหว่างลากจากคลังด้วยนิ้ว: กันไม่ให้รายการเลื่อน (ต้องเป็น non-passive จึงยกเลิกการเลื่อนได้)
    document.addEventListener('touchmove', (e) => { if (this.drag?.src === 'lib' || this.libPress?.armed) e.preventDefault(); }, { passive: false });
    // นิ้วที่สองแตะที่ไหนก็ตามระหว่างลาก = ยกเลิกการลาก (กลับไปเป็นซูม/เลื่อนกล้อง)
    window.addEventListener('pointerdown', (e) => {
      if (this.drag && e.pointerType === 'touch' && e.pointerId !== this.drag.pointerId && this.drag.src !== 'lib') this.cancelDrag('ใช้สองนิ้ว = ซูม/เลื่อนกล้อง (ยกเลิกการย้าย)');
    }, true);
        window.addEventListener('blur', () => { if (this.drag) this.cancelDrag('ยกเลิกการลาก (หน้าต่างเสียโฟกัส)'); this.cancelLibPress(); });
  }

  /* ---------- ลากจากคลังอุปกรณ์ ---------- */

  private libPress: { pointerId: number; kind: PartKind; x: number; y: number; t0: number; type: string; timer: number | null; armed: boolean; btn: HTMLElement } | null = null;
  private libClickSuppressUntil = 0;
  private libStale = false;

  /** คืน true ถ้า click นี้เป็นผลพลอยได้จากการลากวาง (ไม่ใช่การแตะเลือก) */
  consumeLibClick(): boolean {
    if (performance.now() < this.libClickSuppressUntil) { this.libClickSuppressUntil = 0; return true; }
    return false;
  }

  libPointerDown(e: PointerEvent, kind: PartKind, btn: HTMLElement) {
    if (!this.has3d || this.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.cancelLibPress();
    const press = { pointerId: e.pointerId, kind, x: e.clientX, y: e.clientY, t0: e.timeStamp, type: e.pointerType, timer: null as number | null, armed: false, btn };
    // นิ้ว: แตะค้าง ~0.35 วินาที (ไม่ขยับ) แล้วจึงลาก = ลากอุปกรณ์ · ขยับก่อนนั้น = เลื่อนรายการ
    // ตัดสินจากเวลาของ event เอง (ไม่ใช่เวลาที่ประมวลผล) — เครื่องช้าที่ส่ง event ตามมาทีหลังจะไม่เปลี่ยนการปัดเลื่อนเป็นการลาก
    // เมาส์/ปากกา: เริ่มเมื่อขยับเกิน 6 px
    if (e.pointerType === 'touch') {
      press.timer = window.setTimeout(() => { if (this.libPress === press) { press.armed = true; btn.classList.add('armed'); } }, LONG_PRESS_MS);
      btn.classList.add('pressing');
    }
    this.libPress = press;
  }

  private cancelLibPress() {
    if (!this.libPress) return;
    if (this.libPress.timer) clearTimeout(this.libPress.timer);
    this.libPress.btn.classList.remove('pressing', 'armed');
    this.libPress = null;
  }

  private beginLibDrag(pointerId: number, kind: PartKind, x: number, y: number, type: string) {
    const e = catalogEntry(kind)!;
    document.querySelectorAll('.lib-item.pressing').forEach((b) => b.classList.remove('pressing'));
    const part = defaultPart(kind, '__ghost', nextLabel(this.doc, e.labelPrefix), { kind: 'table', x: 0, z: 0, rotation: this.placeRotation });
    const c = pinCenterOffset(part, this.placeRotation);
    this.drag = { pointerId, src: 'lib', part, rotation: this.placeRotation, grab: { dx: c.dx, dz: c.dz }, candidate: null, ok: false, errors: [], moved: true, startX: x, startY: y, lastX: x, lastY: y, type };
    this.libClickSuppressUntil = performance.now() + 600;
    // ห้ามสร้างรายการคลังใหม่ระหว่างลาก: ปุ่มที่นิ้วแตะอยู่จะหายจาก DOM แล้วเบราว์เซอร์ยกเลิกการแตะ (pointercancel)
    if (this.tool.t !== 'select') {
      this.tool = { t: 'select' };
      this.pendingWire = null;
      this.view.setPendingMarker(null);
      this.renderTools();
      this.renderQuick();
      this.libStale = true;
    }
    this.closeDrawers();
    this.view.activeControls.enabled = false;
    document.body.classList.add('dragging');
    try { if (type === 'touch') navigator.vibrate?.(12); } catch { /* ไม่รองรับ */ }
    this.updateDrag(x, y);
  }

  /* ---------- pointer ในพื้นที่ทำงาน ---------- */

  private onDown(e: PointerEvent) {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    // นิ้วแรกของการแตะครั้งใหม่: ล้างนิ้วค้างที่ไม่ได้รับ pointerup (เช่น ระบบตัด gesture) ไม่ให้ถือว่าเป็นสองนิ้วตลอดไป
    if (e.isPrimary) this.pointers.clear();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (this.pointers.size > 1) {
      // นิ้วที่สอง = ซูม/เลื่อนกล้องเท่านั้น ยกเลิกการลากอุปกรณ์
      this.multiTouch = true;
      if (this.drag && this.drag.src !== 'lib') this.cancelDrag('ใช้สองนิ้ว = ซูม/เลื่อนกล้อง (ยกเลิกการย้าย)');
      this.down = null;
      return;
    }
    this.multiTouch = false;
    if (e.pointerType === 'mouse') this.showPinTip(null);
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, type: e.pointerType };
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.tool.t !== 'select' || !this.has3d) return;
    const pick = this.view.pick(e.clientX, e.clientY);
    const sel = this.selection;
    if (pick?.type === 'part' && pick.plunger && this.doc.parts.find((p) => p.id === pick.partId)?.kind === 'pushbutton') {
      // แตะค้างที่ก้านปุ่ม = กดปุ่ม (ไม่ย้ายอุปกรณ์/ไม่หมุนกล้อง) ปล่อยนิ้ว = ปล่อยปุ่ม
      this.view.activeControls.enabled = false;
      this.setButtonPressed(pick.partId, true, e.pointerId);
      return;
    }
    if (pick?.type === 'part' || pick?.type === 'pin') {
      const partId = pick.partId;
      // เมาส์: ลากอุปกรณ์ได้ทันที / touch: ต้องเลือกก่อน (กันการเลื่อนกล้องแล้วย้ายอุปกรณ์โดยไม่ตั้งใจ)
      const canDrag = e.pointerType === 'mouse' || (sel?.t === 'part' && sel.id === partId);
      if (!canDrag) return;
      const part = this.doc.parts.find((p) => p.id === partId)!;
      const ref = this.partRef(part);
      const pt = this.view.planePoint(e.clientX, e.clientY, part.placement.kind === 'board' ? 0 : TABLE_Y);
      if (!pt || !ref) return;
      this.view.activeControls.enabled = false;
      // เก็บระยะห่าง "บนหน้าจอ" ระหว่างตัวชี้กับขาอ้างอิง: เมื่อย้ายระหว่างโต๊ะ (ต่ำ) กับผิวบอร์ด (สูงกว่า 2.4 หน่วย)
      // ขาอ้างอิงยังอยู่ใต้ตำแหน่งเดิมบนจอ ไม่กระโดดตามมุมกล้อง
      const refScreen = this.view.worldToScreen(ref.x, part.placement.kind === 'board' ? 0 : TABLE_Y, ref.z);
      const grabPx = refScreen ? { px: e.clientX - refScreen.x, py: e.clientY - refScreen.y } : {};
      this.drag = { pointerId: e.pointerId, src: 'part', partId, part, rotation: part.placement.rotation, grab: { dx: pt.x - ref.x, dz: pt.z - ref.z, ...grabPx }, candidate: null, ok: false, errors: [], moved: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, type: e.pointerType };
      return;
    }
    // เลือกเบรดบอร์ดอยู่: ลากตรงไหนบนบอร์ดก็ย้ายทั้งแผ่น (แม้มีสายพาดอยู่ตรงนั้น) ยกเว้นจับโดนอุปกรณ์
    let boardPick: { boardId: string } | null = null;
    if (sel?.t === 'board') {
      if ((pick?.type === 'hole' || pick?.type === 'board') && pick.boardId === sel.id) boardPick = pick;
      else if (pick?.type === 'wire') boardPick = this.view.pickAll(e.clientX, e.clientY).find((p): p is Extract<Pick, { type: 'hole' | 'board' }> => (p.type === 'hole' || p.type === 'board') && p.boardId === sel.id) ?? null;
    }
    if (boardPick) {
      const b = this.doc.breadboards.find((x) => x.id === boardPick!.boardId)!;
      const pt = this.view.planePoint(e.clientX, e.clientY, 0);
      if (!pt) return;
      this.view.activeControls.enabled = false;
      this.drag = { pointerId: e.pointerId, src: 'board', boardId: b.id, part: null, rotation: 0, grab: { dx: pt.x - b.x, dz: pt.z - b.z }, candidate: null, ok: false, errors: [], moved: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, type: e.pointerType };
    }
  }

  /** จุดอ้างอิงของอุปกรณ์ในพิกัดโลก: ขาที่ 1 (อุปกรณ์ชนิดเสียบบอร์ด) หรือจุดกลางเครื่อง (เครื่องมือ) */
  private partRef(part: Part): { x: number; z: number } | null {
    if (part.placement.kind === 'board') {
      const b = this.doc.breadboards.find((x) => x.id === (part.placement as { boardId: string }).boardId) ?? this.doc.breadboards[0];
      return holeWorld(b, part.placement.anchor);
    }
    return { x: part.placement.x, z: part.placement.z };
  }

  private onMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    const lp = this.libPress;
    if (lp && lp.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - lp.x, e.clientY - lp.y);
      if (lp.type === 'touch') {
        const held = e.timeStamp - lp.t0 >= LONG_PRESS_MS;
        if (!held) { if (dist > 10) this.cancelLibPress(); } // นิ้วขยับก่อนครบเวลา = เลื่อนรายการ
        else if (dist > 4) { this.cancelLibPress(); this.beginLibDrag(e.pointerId, lp.kind, e.clientX, e.clientY, 'touch'); }
      } else if (dist > 6) { this.libPress = null; this.beginLibDrag(e.pointerId, lp.kind, e.clientX, e.clientY, lp.type); }
      return;
    }
    const d = this.drag;
    if (d && d.pointerId === e.pointerId) {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < TAP_PX) return;
      if (!d.moved) {
        d.moved = true;
        document.body.classList.add('dragging');
        if (d.partId) this.view.setPartVisible(d.partId, false);
      }
      this.updateDrag(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0 && e.target instanceof HTMLCanvasElement) this.hover(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    if (this.pressHold && (this.pressHold.pointerId === e.pointerId || this.pressHold.pointerId === null)) {
      this.releaseHeldButton(e.pointerId);
      if (this.down?.id === e.pointerId) this.down = null;
      if (!this.pointers.size) this.view.activeControls.enabled = this.cameraEnabled();
      return;
    }
    if (this.libPress?.pointerId === e.pointerId) this.cancelLibPress();
    const drag = this.drag;
    if (drag && drag.pointerId === e.pointerId) {
      if (this.down?.id === e.pointerId) this.down = null;
      this.finishDrag(drag, e.clientX, e.clientY, cancelled);
      return;
    }
    const d = this.down;
    if (!d || d.id !== e.pointerId) { if (!this.pointers.size && !this.drag) this.view.activeControls.enabled = this.cameraEnabled(); return; }
    this.down = null;
    this.view.activeControls.enabled = this.cameraEnabled();
    if (cancelled || this.multiTouch) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved <= TAP_PX && e.timeStamp - d.t <= TAP_MS && (d.type !== 'mouse' || e.button === 0)) {
      // จอสัมผัสไม่มี hover: แตะที่ขาแล้วแสดงชื่อขาชั่วครู่
      if (d.type !== 'mouse' && this.has3d && this.tool.t !== 'place' && this.tool.t !== 'camera') this.showPinTip(this.pinAt(this.view.pick(e.clientX, e.clientY), e.clientX, e.clientY), e.clientX, e.clientY, 2500);
      this.tap(e.clientX, e.clientY);
    }
  }

  private cameraEnabled() { return this.has3d; }

  private endDragVisuals(drag: Drag) {
    this.drag = null;
    document.body.classList.remove('dragging');
    this.view.activeControls.enabled = this.cameraEnabled();
    this.view.setGhost(null, true, this.doc);
    this.view.setBoardGhost(null, true);
    this.view.setDragWires(null, null);
    if (drag.partId) this.view.setPartVisible(drag.partId, true);
    this.dragTip(null);
    if (this.libStale) { this.libStale = false; renderLibrary(this); }
  }

  private finishDrag(drag: Drag, x: number, y: number, cancelled: boolean) {
    this.endDragVisuals(drag);
    if (!drag.moved) { if (!cancelled && drag.src !== 'lib') this.tap(x, y); return; }
    if (cancelled) { this.status('ยกเลิกการลาก — ตำแหน่งเดิมไม่เปลี่ยน'); this.hint(''); return; }
    if (!this.overStage(x, y)) { this.status(drag.src === 'lib' ? 'ยกเลิกการวาง (ปล่อยนอกพื้นที่ทำงาน)' : 'ยกเลิกการย้าย (ปล่อยนอกพื้นที่ทำงาน) — ตำแหน่งเดิมไม่เปลี่ยน'); this.hint(''); return; }
    if (!drag.candidate && !drag.boardPos) { this.status('ยกเลิก — ไม่มีตำแหน่งที่วางได้ตรงนั้น', 'err'); return; }
    if (!drag.ok) { this.status(`วางไม่ได้: ${drag.errors.join(' · ')} — ตำแหน่งเดิมไม่เปลี่ยน`, 'err'); return; }
    this.hint('');
    if (drag.src === 'board' && drag.boardPos && drag.boardId) {
      const b = this.doc.breadboards.find((x) => x.id === drag.boardId)!;
      if (b.x !== drag.boardPos.x || b.z !== drag.boardPos.z) this.apply(moveBoard(this.doc, drag.boardId, drag.boardPos.x, drag.boardPos.z), 'ย้ายเบรดบอร์ด');
      return;
    }
    const cand = drag.candidate!;
    if (drag.src === 'part' && drag.partId) {
      const part = this.doc.parts.find((x) => x.id === drag.partId)!;
      if (JSON.stringify(cand) === JSON.stringify(part.placement)) return;
      const wasBoard = part.placement.kind === 'board';
      const label = cand.kind === 'board' ? (wasBoard ? `ย้าย ${part.label}` : `เสียบ ${part.label} ลงเบรดบอร์ด`) : wasBoard ? `ยก ${part.label} ออกจากบอร์ดมาวางบนโต๊ะ` : `ย้าย ${part.label}`;
      const moved = this.apply(movePart(this.doc, drag.partId, cand), label);
      if (moved) this.select({ t: 'part', id: drag.partId });
      if (moved && wasBoard && cand.kind === 'table') {
        const holeWires = this.wiresNearPart(part);
        if (holeWires) this.status(`${label} — สาย ${holeWires} เส้นที่เสียบรูข้างขายังอยู่ในรูเดิม (ไม่ได้ต่อกับขาแล้ว)`);
      }
      return;
    }
    if (drag.src === 'lib' && drag.part) {
      const part = { ...drag.part, id: newId(drag.part.kind), placement: cand } as Part;
      if (this.apply(insertPart(this.doc, part), cand.kind === 'board' ? `วาง ${part.label} บนเบรดบอร์ด` : `วาง ${part.label} บนโต๊ะ`)) { this.select({ t: 'part', id: part.id }); this.revealBench(part); }
    }
  }

  /** เครื่องมือขนาดจริงที่เพิ่งวาง (เข้าแถวหลัง/ข้างบอร์ด): ถ้าขั้วต่อหลุดจอ จัดกล้องใหม่ให้เห็นขั้วต่อของเครื่องมือทุกชิ้น */
  private revealBench(part: Part) {
    if (!this.has3d || !isBenchKind(part.kind)) return;
    const hidden = pinDefs(part).some((d) => { const w = this.view.terminalWorld({ kind: 'pin', partId: part.id, pin: d.name }); return !w || !this.view.inView(w); });
    if (hidden) { this.view.resetView(); this.status(`วาง ${part.label} ในช่องบนโต๊ะ — ปรับมุมกล้องให้เห็นขั้วต่อ`); }
  }

  /** จำนวนสายที่เสียบรูกลุ่มเดียวกับขาของอุปกรณ์ (ก่อนยกออก) */
  private wiresNearPart(part: Part): number {
    const groups = new Set(pinHolesFor(part).filter((p) => p.hole).map((p) => `${p.boardId}#${holeInfo(p.hole!)!.group}`));
    return this.doc.wires.filter((w) => [w.a, w.b].some((t) => t.kind === 'hole' && groups.has(`${t.boardId}#${holeInfo(t.hole)!.group}`))).length;
  }

  cancelDrag(reason = 'ยกเลิกการลาก — ตำแหน่งเดิมไม่เปลี่ยน') {
    if (!this.drag) return;
    this.endDragVisuals(this.drag);
    this.down = null;
    this.status(reason);
    this.hint('');
  }

  /** ตัวชี้อยู่เหนือพื้นที่ทำงาน 3 มิติ (ไม่ใช่แผงด้านข้าง/แถบเครื่องมือที่ทับอยู่) */
  private overStage(x: number, y: number): boolean {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    const el = document.elementFromPoint(x, y);
    return !!el && !el.closest('.panel, .topbar, .bottombar, dialog, .logger, .tools, .viewctl, .quick');
  }

  /**
   * หาตำแหน่งวางของอุปกรณ์จากตำแหน่งตัวชี้
   * - อุปกรณ์ชนิดเสียบบอร์ด: ถ้าอยู่เหนือบอร์ดและ "ขาทุกขาลงรูได้จริง" → เสียบบอร์ด; ไม่เช่นนั้น → วางบนโต๊ะ (ถ้าไม่ทับอะไร)
   * - เครื่องมือ/แหล่งจ่าย: วางบนโต๊ะเท่านั้น
   * ไม่มีการเชื่อมต่อไฟฟ้าจากระยะใกล้ — การเชื่อมต่อมาจากรู/สายเท่านั้น
   */
  candidateFor(part: Part, x: number, y: number, grab: Drag['grab'], rotation: Rotation):
    { part: Part; placement: Placement; ok: boolean; errors: string[]; warnings: string[]; mode: 'board' | 'table' } | null {
    const test = (pl: Placement) => {
      const moved = { ...part, placement: pl } as Part;
      const doc = { ...this.doc, parts: [...this.doc.parts.filter((p) => p.id !== part.id), moved] };
      return { part: moved, placement: pl, ...checkPlacement(doc, moved) };
    };
    let boardFail: ReturnType<typeof test> | null = null;
    // จุดอ้างอิงบนระนาบสูง h: ถ้ามีระยะบนจอ ใช้ตำแหน่งจอของขาอ้างอิงยิงลงระนาบนั้นโดยตรง
    const refOn = (h: number) => {
      if (grab.px !== undefined && grab.py !== undefined) { const q = this.view.planePoint(x - grab.px, y - grab.py!, h); return q ? { x: q.x, z: q.z } : null; }
      const q = this.view.planePoint(x, y, h);
      return q ? { x: q.x - grab.dx, z: q.z - grab.dz } : null;
    };
    if (isBoardKind(part)) {
      const p0 = refOn(0);
      if (p0) {
        for (const b of this.doc.breadboards) {
          const { gx, gy } = worldToGrid(b, p0.x, p0.z);
          const anchor = holeAt(gx, gy, b.model);
          if (!anchor) continue;
          const r = test({ kind: 'board', boardId: b.id, anchor, rotation });
          if (r.ok) return { ...r, mode: 'board' };
          boardFail ??= r;
        }
      }
    }
    const pt = refOn(TABLE_Y);
    if (!pt) return boardFail ? { ...boardFail, mode: 'board' } : null;
    // เครื่องมือขนาดจริง: แหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคปเข้าแถวหลังบอร์ดเสมอ (ช่องที่ใกล้ตัวชี้ที่สุด)
    // มิเตอร์วางตรงไหนก็ได้ที่ว่าง ถ้าทับของอื่นจะเลื่อนไปช่องว่างที่ใกล้ที่สุด
    if (isBenchKind(part.kind)) {
      if (!BENCH_ROW_KINDS.includes(part.kind)) {
        const direct = test({ kind: 'table', x: Math.round(pt.x * 2) / 2, z: Math.round(pt.z * 2) / 2, rotation: 0 });
        if (direct.ok) return { ...direct, mode: 'table' };
      }
      const slot = benchSlot(this.doc, part, pt);
      if (slot) return { ...test({ kind: 'table', x: slot.x, z: slot.z, rotation: 0 }), mode: 'table' };
    }
    const r = test({ kind: 'table', x: Math.round(pt.x * 2) / 2, z: Math.round(pt.z * 2) / 2, rotation });
    // อยู่เหนือบอร์ดแต่เสียบไม่ได้ → บอกเหตุผลของบอร์ด (เช่น รูมีขาอื่นอยู่) แทน "ทับบอร์ด"
    const fp = footprint(r.part);
    const overBoard = !!fp && this.doc.breadboards.some((b) => overlaps(fp, boardRect(b)));
    if (r.ok || !boardFail || !overBoard) return { ...r, mode: 'table' };
    return { ...boardFail, mode: 'board' };
  }

  private updateDrag(x: number, y: number) {
    const drag = this.drag!;
    drag.lastX = x; drag.lastY = y;
    if (!this.overStage(x, y)) {
      drag.candidate = null; drag.ok = false;
      this.view.setGhost(null, true, this.doc);
      this.view.setBoardGhost(null, true);
      this.view.setDragWires(null, null);
      this.dragTip({ x, y, text: 'ลากมาปล่อยในพื้นที่ทำงาน (ปล่อยตรงนี้ = ยกเลิก)', kind: 'neutral' });
      return;
    }
    if (drag.src === 'board') {
      const pt = this.view.planePoint(x, y, 0);
      if (!pt) return;
      const nx = Math.round((pt.x - drag.grab.dx) * 2) / 2, nz = Math.round((pt.z - drag.grab.dz) * 2) / 2;
      const r = moveBoard(this.doc, drag.boardId!, nx, nz);
      drag.boardPos = { x: nx, z: nz };
      drag.ok = r.ok;
      drag.errors = r.ok ? [] : r.errors;
      this.view.setBoardGhost({ x: nx, z: nz }, r.ok, this.doc.breadboards.find((bb) => bb.id === drag.boardId)?.model);
      this.dragTip({ x, y, text: r.ok ? 'ปล่อยเพื่อย้ายเบรดบอร์ด (อุปกรณ์และสายบนบอร์ดย้ายตาม)' : r.errors[0], kind: r.ok ? 'ok' : 'err' });
      return;
    }
    const part = drag.part!;
    const r = this.candidateFor(part, x, y, drag.grab, drag.rotation);
    if (!r) { this.view.setGhost(null, true, this.doc); drag.candidate = null; drag.ok = false; this.dragTip({ x, y, text: 'ชี้ที่พื้นโต๊ะหรือเบรดบอร์ด', kind: 'neutral' }); return; }
    drag.candidate = r.placement;
    drag.ok = r.ok;
    drag.errors = r.errors;
    this.view.setGhost(r.part, r.ok, this.doc);
    // สายที่ต่อขาไว้วาดตามตำแหน่งใหม่ระหว่างลาก (ถ้าวางไม่ได้ แสดงที่ตำแหน่งเดิม)
    if (drag.src === 'part' && drag.partId) this.view.setDragWires(r.ok ? { ...this.doc, parts: this.doc.parts.map((p) => (p.id === drag.partId ? r.part : p)) } : null, r.ok ? drag.partId : null);
    let text: string;
    if (!r.ok) text = `วางไม่ได้: ${r.errors[0]}`;
    else if (r.mode === 'board') {
      const holes = pinHolesFor(r.part).map((ph) => holeLabel(ph.hole!));
      text = `ปล่อยเพื่อเสียบลงบอร์ด · ขาลงรู ${holes.length > 3 ? `${holes[0]} … ${holes[holes.length - 1]}` : holes.join(', ')}${r.warnings[0] ? ` · ${r.warnings[0]}` : ''}`;
    } else text = isBoardKind(part) ? 'ปล่อยเพื่อวางบนโต๊ะ · ขายังไม่ต่อกับวงจร (ต่อสายเข้าขาได้)' : 'ปล่อยเพื่อวางบนโต๊ะ';
    this.dragTip({ x, y, text, kind: !r.ok ? 'err' : r.mode === 'board' ? 'ok' : 'table' });
  }

  /** ป้ายข้อความเล็ก ๆ ข้างตัวชี้ระหว่างลาก (บนหน้าจอสัมผัสอยู่เหนือนิ้ว) */
  private dragTip(t: { x: number; y: number; text: string; kind: 'ok' | 'err' | 'table' | 'neutral' } | null) {
    let el = document.getElementById('drag-tip');
    if (!t) { if (el) el.hidden = true; return; }
    if (!el) { el = h('div', { id: 'drag-tip', class: 'drag-tip', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
    el.hidden = false;
    el.textContent = t.text;
    el.className = `drag-tip ${t.kind}`;
    const touch = this.drag?.type === 'touch';
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const vw = window.innerWidth;
    let left = touch ? t.x - w / 2 : t.x + 16;
    let top = touch ? t.y - hgt - 56 : t.y + 18;
    left = Math.max(8, Math.min(vw - w - 8, left));
    if (top < 8) top = t.y + 40;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  /** เมาส์ลอยเหนือฉาก: แสดงตำแหน่งที่จะวาง/รูที่จะต่อ */
  /** ขาอุปกรณ์ที่อยู่ใต้ตัวชี้: จุดต่อขา (บนโต๊ะ/เครื่องมือ), รูที่มีขาเสียบอยู่, หรือขาที่ใกล้จุดที่ชี้บนตัวอุปกรณ์ */
  pinAt(pick: Pick | null, x?: number, y?: number): { partId: string; pin: string; text: string } | null {
    if (!pick) return null;
    const label = (partId: string, pin: string) => {
      const part = this.doc.parts.find((p) => p.id === partId);
      const def = part ? pinDefs(part).find((d) => d.name === pin) : undefined;
      return part && def ? { partId, pin, text: `${part.label} · ${def.label}` } : null;
    };
    if (pick.type === 'pin') return label(pick.partId, pick.pin);
    if (pick.type === 'hole') {
      for (const part of this.doc.parts) {
        if (part.placement.kind !== 'board') continue;
        const ph = pinHolesFor(part).find((x) => x.boardId === pick.boardId && x.hole === pick.hole);
        if (ph) return label(part.id, ph.pin);
      }
      return null; // ชี้รูว่างตรง ๆ: ไม่แสดงชื่อขาข้างเคียง
    }
    if (x === undefined || y === undefined) return null;
    // ชี้ใกล้ขาใด ๆ (ขาอาจถูกตัวถัง สาย หรือรูข้าง ๆ บังในมุมเอียง): เลือกขาที่ใกล้ตัวชี้บนหน้าจอที่สุด
    // วัดระยะถึงเส้นขาตั้งแต่ปลายขา (รู/จุดต่อ) ขึ้นไป ≈ 2.3 mm · ไม่เกิน 12 px · อุปกรณ์ที่ถูกชี้อยู่ได้ระยะ 16 px
    let best: { partId: string; pin: string; d: number } | null = null;
    for (const part of this.doc.parts) {
      const lim = pick.type === 'part' && pick.partId === part.id ? 16 : 12;
      for (const d of pinDefs(part)) {
        const w = this.view.terminalWorld({ kind: 'pin', partId: part.id, pin: d.name });
        if (!w) continue;
        const p0 = this.view.worldToScreen(w.x, w.y, w.z), p1 = this.view.worldToScreen(w.x, w.y + 0.9, w.z);
        if (!p0 || !p1) continue;
        const vx = p1.x - p0.x, vy = p1.y - p0.y, L2 = vx * vx + vy * vy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - p0.x) * vx + (y - p0.y) * vy) / L2)) : 0;
        const dist = Math.hypot(p0.x + t * vx - x, p0.y + t * vy - y);
        if (dist < lim && (!best || dist < best.d)) best = { partId: part.id, pin: d.name, d: dist };
      }
    }
    if (best) return label(best.partId, best.pin);
    return null;
  }

  private pinTipEl: HTMLElement | null = null;
  private pinTipTimer: ReturnType<typeof setTimeout> | null = null;
  /** ป้ายชื่อขาใกล้ตัวชี้ (เมาส์: ตามการชี้, สัมผัส: แสดงชั่วครู่หลังแตะ) */
  showPinTip(info: { text: string } | null, x = 0, y = 0, holdMs = 0) {
    if (this.pinTipTimer) { clearTimeout(this.pinTipTimer); this.pinTipTimer = null; }
    if (!info) { if (this.pinTipEl) this.pinTipEl.hidden = true; return; }
    if (!this.pinTipEl) {
      this.pinTipEl = h('div', { id: 'pin-tip', role: 'tooltip', style: 'position:fixed;z-index:60;pointer-events:none;padding:4px 8px;border-radius:6px;background:rgba(20,26,24,0.92);color:#f2f5f0;font:600 13px/1.35 "IBM Plex Sans Thai","Chakra Petch",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis' });
      document.body.appendChild(this.pinTipEl);
    }
    const el = this.pinTipEl;
    el.textContent = info.text;
    el.hidden = false;
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14));
    const top = y - hgt - 12 < 8 ? y + 18 : y - hgt - 12;
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    if (holdMs > 0) this.pinTipTimer = setTimeout(() => { if (this.pinTipEl) this.pinTipEl.hidden = true; }, holdMs);
  }

  private hover(x: number, y: number) {
    if (this.tool.t !== 'place' && this.tool.t !== 'camera') this.showPinTip(this.pinAt(this.view.pick(x, y), x, y), x, y);
    else this.showPinTip(null);
    if (this.tool.t === 'place') {
      const cand = this.placementAt(this.tool.kind, x, y);
      if (!cand) { this.view.setGhost(null, true, this.doc); return; }
      this.view.setGhost(cand.part, cand.ok, this.doc);
      this.hint(cand.ok ? (cand.warnings[0] ?? (cand.mode === 'board' ? 'คลิกเพื่อเสียบลงบอร์ด · R หมุน · Esc ยกเลิก' : 'คลิกเพื่อวางบนโต๊ะ · R หมุน · Esc ยกเลิก')) : cand.errors[0]);
      return;
    }
    if (this.tool.t === 'wire' || this.tool.t === 'probe' || this.tool.t === 'wireEnd') {
      const pick = this.view.pick(x, y);
      const r = pick ? (this.tool.t === 'probe' ? this.resolveProbe(pick) : this.resolveWireEnd(pick)) : null;
      const pos = r && 'ref' in r ? this.view.terminalWorld(r.ref) : null;
      this.view.setHoverMarker(pos, true);
      const el = this.view.renderer.domElement;
      el.style.cursor = pos ? 'crosshair' : 'default';
      return;
    }
    if (this.tool.t === 'camera') { this.view.renderer.domElement.style.cursor = 'grab'; return; }
    const pick = this.view.pick(x, y);
    const sel = this.selection;
    const boardMove = sel?.t === 'board' && (pick?.type === 'hole' || pick?.type === 'board') && pick.boardId === sel.id;
    this.view.renderer.domElement.style.cursor = (pick && (pick.type === 'part' || pick.type === 'pin')) || boardMove ? 'grab' : pick?.type === 'wire' || pick?.type === 'hole' || pick?.type === 'board' ? 'pointer' : 'default';
  }

  /** ตำแหน่งวางของเครื่องมือ "วาง" (แตะ/คลิก): ขาที่ 1 อยู่ที่จุดที่แตะ */
  placementAt(kind: PartKind, x: number, y: number) {
    const e = catalogEntry(kind)!;
    const part = defaultPart(kind, '__ghost', nextLabel(this.doc, e.labelPrefix), { kind: 'table', x: 0, z: 0, rotation: this.placeRotation });
    const grab = isBoardKind(part) ? { dx: 0, dz: 0 } : { dx: 0, dz: 0 };
    return this.candidateFor(part, x, y, grab, this.placeRotation);
  }

  /** หาจุดต่อสำหรับปลายสาย (รองรับการแตะขาอุปกรณ์ → หารูว่างในกลุ่มเดียวกันให้) */
  resolveWireEnd(pick: Pick, ignoreWireId?: string): { ref: TerminalRef; note?: string } | { error: string } {
    const occ = holeOccupancy(this.doc, undefined, ignoreWireId);
    const freeInGroup = (boardId: string, hole: string, why: string) => {
      const info = holeInfo(hole)!;
      const free = groupHoles(info.group, this.doc.breadboards.find((b) => b.id === boardId)?.model)
        .filter((hn) => !occ.has(`${boardId}/${hn}`))
        .map((hn) => ({ hn, d: Math.abs(holeInfo(hn)!.x - info.x) + Math.abs(holeInfo(hn)!.y - info.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!free) return { error: `กลุ่มรูของ ${why} เต็มแล้ว` };
      return { ref: { kind: 'hole', boardId, hole: free.hn } as TerminalRef, note: `ต่อเข้ารู ${holeLabel(free.hn)} (กลุ่มเดียวกับ ${why})` };
    };
    switch (pick.type) {
      case 'pin': {
        const part = this.doc.parts.find((p) => p.id === pick.partId);
        // ขาที่เสียบบอร์ดอยู่: ต่อเข้ารูว่างในกลุ่มเดียวกัน (เหมือนบอร์ดจริง)
        if (part?.placement.kind === 'board') {
          const ph = pinHolesFor(part).find((x) => x.pin === pick.pin);
          if (ph?.hole) return freeInGroup(ph.boardId, ph.hole, `${part.label} ขา ${pick.pin}`);
        }
        return { ref: { kind: 'pin', partId: pick.partId, pin: pick.pin } };
      }
      case 'hole': {
        const key = `${pick.boardId}/${pick.hole}`;
        if (!occ.has(key)) return { ref: { kind: 'hole', boardId: pick.boardId, hole: pick.hole } };
        return freeInGroup(pick.boardId, pick.hole, occ.get(key)!);
      }
      case 'part': {
        const part = this.doc.parts.find((p) => p.id === pick.partId)!;
        if (part.placement.kind === 'board') {
          const np = this.view.nearestBoardPin(part, pick.point);
          if (!np) return { error: 'ไม่พบขา' };
          return freeInGroup(np.boardId, np.hole, `${part.label} ขา ${np.pin}`);
        }
        let best: { pin: string; d: number } | null = null;
        for (const d of pinDefs(part)) {
          const w = this.view.terminalWorld({ kind: 'pin', partId: part.id, pin: d.name });
          if (!w) continue;
          const dist = w.distanceTo(pick.point);
          if (!best || dist < best.d) best = { pin: d.name, d: dist };
        }
        return best ? { ref: { kind: 'pin', partId: part.id, pin: best.pin } } : { error: 'ไม่พบขั้ว' };
      }
      case 'wire': {
        // แตะใกล้ปลายสาย → ใช้จุดต่อเดียวกัน (ขั้ว) หรือรูว่างในกลุ่มเดียวกัน (รู)
        const w = this.doc.wires.find((x) => x.id === pick.wireId)!;
        const da = this.view.terminalWorld(w.a)!.distanceTo(pick.point), db = this.view.terminalWorld(w.b)!.distanceTo(pick.point);
        const end = da < db ? w.a : w.b;
        if (Math.min(da, db) > 3) return { error: 'แตะใกล้ปลายสาย รู หรือขั้ว เพื่อเลือกจุดต่อ' };
        if (end.kind === 'pin') return { ref: end };
        return freeInGroup(end.boardId, end.hole, `ปลายสาย`);
      }
      default: return { error: 'แตะที่รูบนเบรดบอร์ด ขาอุปกรณ์ หรือขั้วของเครื่องมือ' };
    }
  }

  /** โพรบแตะได้ทุกจุด รวมถึงรูที่มีขาเสียบอยู่ */
  resolveProbe(pick: Pick): { ref: TerminalRef } | { error: string } {
    if (pick.type === 'hole') return { ref: { kind: 'hole', boardId: pick.boardId, hole: pick.hole } };
    if (pick.type === 'pin') return { ref: { kind: 'pin', partId: pick.partId, pin: pick.pin } };
    if (pick.type === 'part') {
      const part = this.doc.parts.find((p) => p.id === pick.partId)!;
      if (part.placement.kind === 'board') {
        const np = this.view.nearestBoardPin(part, pick.point);
        if (np) return { ref: { kind: 'hole', boardId: np.boardId, hole: np.hole } };
      }
      const r = this.resolveWireEnd(pick);
      if ('ref' in r) return r;
    }
    if (pick.type === 'wire') {
      const w = this.doc.wires.find((x) => x.id === pick.wireId)!;
      const da = this.view.terminalWorld(w.a)!.distanceTo(pick.point), db = this.view.terminalWorld(w.b)!.distanceTo(pick.point);
      return { ref: da < db ? w.a : w.b };
    }
    return { error: 'แตะที่รู ขาอุปกรณ์ หรือขั้ว เพื่อวางโพรบ' };
  }

  private lastTap: { x: number; y: number; t: number } | null = null;

  private tap(x: number, y: number) {
    if (!this.has3d) return;
    let pick = this.view.pick(x, y);
    const tool = this.tool;
    if (tool.t === 'place') {
      const cand = this.placementAt(tool.kind, x, y);
      if (!cand) { this.status('แตะที่รูบนเบรดบอร์ดหรือพื้นโต๊ะ', 'err'); return; }
      if (!cand.ok) { this.status(`วางไม่ได้: ${cand.errors.join(' · ')}`, 'err'); return; }
      const part = { ...cand.part, id: newId(tool.kind) } as Part;
      const r = insertPart(this.doc, part);
      if (this.apply(r, cand.mode === 'board' ? `วาง ${part.label} บนเบรดบอร์ด` : `วาง ${part.label} บนโต๊ะ`)) {
        this.setTool({ t: 'select' });
        this.select({ t: 'part', id: part.id });
        this.revealBench(part);
      }
      return;
    }
    if (!pick) { this.select(null); return; }
    if (tool.t === 'wire' || tool.t === 'wireEnd') {
      const r = this.resolveWireEnd(pick, tool.t === 'wireEnd' ? tool.wireId : undefined);
      if ('error' in r) { this.status(r.error, 'err'); return; }
      if (tool.t === 'wireEnd') {
        if (this.apply(moveWireEnd(this.doc, tool.wireId, tool.end, r.ref), 'ย้ายปลายสาย')) { this.setTool({ t: 'select' }); this.select({ t: 'wire', id: tool.wireId }); }
        return;
      }
      if (!this.pendingWire) {
        this.pendingWire = r.ref;
        this.view.setPendingMarker(this.view.terminalWorld(r.ref));
        this.hint(`ต้นทาง: ${terminalLabel(this.doc, r.ref)} — แตะปลายทาง (แตะจุดเดิมเพื่อยกเลิก)`);
        if (r.note) this.status(r.note);
        this.updateHighlight();
        return;
      }
      if (terminalKey(this.pendingWire) === terminalKey(r.ref)) {
        this.pendingWire = null; this.view.setPendingMarker(null); this.setTool({ t: 'wire' }); this.updateHighlight(); return;
      }
      const color = WIRE_COLORS[this.wireColorIdx % WIRE_COLORS.length];
      const res = addWire(this.doc, this.pendingWire, r.ref, color);
      if (this.apply(res, `ต่อสาย ${terminalLabel(this.doc, this.pendingWire)} → ${terminalLabel(this.doc, r.ref)}`)) {
        this.wireColorIdx++;
        if (r.note) this.status(r.note);
      }
      this.pendingWire = null;
      this.view.setPendingMarker(null);
      this.hint('แตะขาหรือรูต้นทางของสายเส้นถัดไป · เลือกเครื่องมือ "เลือก" เมื่อเสร็จ');
      this.updateHighlight();
      return;
    }
    if (tool.t === 'probe') {
      const r = this.resolveProbe(pick);
      if ('error' in r) { this.status(r.error, 'err'); return; }
      this.apply(setProbe(this.doc, tool.which, r.ref), `วางโพรบ${tool.which === 'red' ? 'แดง' : 'ดำ'}ที่ ${terminalLabel(this.doc, r.ref)}`);
      return;
    }
    // เลือก (และเครื่องมือกล้อง: แตะเพื่อดูรายละเอียดได้ แต่ลากไม่ย้ายอะไร)
    // แตะซ้ำที่เดิม: เลือกสิ่งที่อยู่ถัดลงไป (เช่น สายพาดทับอุปกรณ์ — สำคัญบนจอสัมผัสที่ไม่มี hover)
    const now = performance.now();
    const last = this.lastTap;
    this.lastTap = { x, y, t: now };
    if (last && Math.hypot(x - last.x, y - last.y) < 14 && now - last.t < 2500) {
      const all = this.view.pickAll(x, y);
      const key = (p: Pick) => p.type === 'part' ? `part:${p.partId}` : p.type === 'wire' ? `wire:${p.wireId}` : p.type === 'pin' ? `part:${p.partId}` : p.type === 'board' || p.type === 'hole' ? `board:${p.boardId}` : '';
      const s = this.selection;
      const cur = s?.t === 'part' ? `part:${s.id}` : s?.t === 'wire' ? `wire:${s.id}` : s?.t === 'terminal' && s.ref.kind === 'pin' ? `part:${s.ref.partId}` : s?.t === 'board' ? `board:${s.id}` : '';
      // รูที่เลือกอยู่ แตะซ้ำ → เลือกเบรดบอร์ดทั้งแผ่น (เพื่อย้าย)
      if (s?.t === 'terminal' && s.ref.kind === 'hole' && pick.type === 'hole' && pick.hole === s.ref.hole) pick = { type: 'board', boardId: pick.boardId, point: pick.point };
      const i = all.findIndex((p) => key(p) === cur);
      if (i >= 0 && all.length > 1) {
        const nextPick = all.slice(i + 1).find((p) => key(p) !== cur);
        if (nextPick) pick = nextPick.type === 'hole' ? { type: 'board', boardId: nextPick.boardId, point: nextPick.point } : nextPick;
      }
    }
    switch (pick.type) {
      case 'part': this.select({ t: 'part', id: pick.partId }); break;
      case 'wire': this.select({ t: 'wire', id: pick.wireId }); break;
      case 'pin': this.select({ t: 'terminal', ref: { kind: 'pin', partId: pick.partId, pin: pick.pin } }); break;
      case 'hole': this.select({ t: 'terminal', ref: { kind: 'hole', boardId: pick.boardId, hole: pick.hole } }); break;
      case 'board': this.select({ t: 'board', id: pick.boardId }); this.status('เลือกเบรดบอร์ดแล้ว — ลากเพื่อย้ายทั้งแผ่น'); break;
      default: this.select(null);
    }
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tgt = e.target as HTMLElement;
      const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveFile(); return; }
      if (typing) return;
      if (e.key === 'Escape' && this.drag) { e.preventDefault(); this.cancelDrag(); return; }
      if (e.key === 'Escape' && this.libPress) { this.cancelLibPress(); return; }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelected(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      else if (e.key.toLowerCase() === 'r' && !mod) this.rotateSelected();
      else if (e.key === 'Escape') { if (this.tool.t !== 'select') this.setTool({ t: 'select' }); else this.select(null); }
      else if (e.key.toLowerCase() === 'w' && !mod) this.setTool({ t: 'wire' });
      else if (e.key.toLowerCase() === 'v' && !mod) this.setTool({ t: 'select' });
      else if (e.key.toLowerCase() === 'c' && !mod && this.has3d) this.setTool({ t: 'camera' });
      else if (e.key.toLowerCase() === 'f' && !mod && this.has3d) this.view.resetView(e.shiftKey ? 'all' : 'work');
    });
  }

  /* ================= UI คงที่ ================= */

  private buildStatic() {
    const set = (id: string, ic: string, label?: string) => { $(id).replaceChildren(svg(icon(ic)), ...(label ? [h('span', { class: 'lbl' }, label)] : [])); };
    set('btn-new', 'new', 'New'); set('btn-open', 'open', 'Open'); set('btn-save', 'save', 'Save');
    set('btn-undo', 'undo', 'Undo'); set('btn-redo', 'redo', 'Redo');
    set('btn-run', 'run', 'Run'); set('btn-stop', 'stop', 'Stop'); set('btn-reset', 'resetView', 'Reset view');
    set('btn-persp', 'perspective', 'Perspective'); set('btn-top', 'top', 'Top');
    set('btn-left', 'panelLeft'); set('btn-right', 'panelRight'); set('btn-more', 'menu');
    const topbar = document.querySelector('.topbar')!;
    $('btn-more').onclick = (e) => {
      e.stopPropagation();
      const open = !topbar.classList.contains('menu-open');
      topbar.classList.toggle('menu-open', open);
      $('btn-more').setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('#btn-more')) { topbar.classList.remove('menu-open'); $('btn-more').setAttribute('aria-expanded', 'false'); }
    });
    document.querySelectorAll('.drawer-close').forEach((b) => b.replaceChildren(svg(icon('close'))));

    // คุณภาพภาพ (จำไว้ในเบราว์เซอร์นี้)
    const qBtn = $('btn-quality');
    qBtn.onclick = () => {
      if (!this.has3d) { this.status(this.no3dReason('เปลี่ยนคุณภาพภาพ'), 'err'); return; }
      const q = this.view.quality === 'high' ? 'eco' : 'high';
      this.view.autoQuality = false;
      this.view.setQuality(q);
      try { localStorage.setItem('cl3d.quality', q); } catch { /* ไม่มี storage */ }
      this.showQuality();
      this.status(q === 'high' ? 'ภาพคุณภาพสูง: แสงสะท้อนโลหะและเงาจากแสงหลัก' : 'ภาพโหมดประหยัด: ปิดแสงสะท้อนและเงาจากแสงหลัก ให้หมุนกล้องลื่นขึ้น');
    };
    this.showQuality();

    $('btn-new').onclick = () => this.newDoc();
    $('btn-open').onclick = () => $('file-input').click();
    ($('file-input') as HTMLInputElement).onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void this.openFile(f);
      (e.target as HTMLInputElement).value = '';
    };
    $('btn-save').onclick = () => this.saveFile();
    $('btn-undo').onclick = () => this.undo();
    $('btn-redo').onclick = () => this.redo();
    $('btn-run').onclick = () => this.run();
    $('btn-stop').onclick = () => this.stop();
    const need3d = (what: string, f: () => void) => () => { if (!this.has3d) { this.status(this.no3dReason(what), 'err'); return; } f(); };
    $('btn-reset').onclick = need3d('รีเซ็ตมุมกล้อง', () => this.view.resetView());
    $('btn-persp').onclick = need3d('เปลี่ยนมุมมอง', () => { this.view.setView('perspective'); this.renderToolbar(); });
    $('btn-top').onclick = need3d('เปลี่ยนมุมมอง', () => { this.view.setView('top'); this.renderToolbar(); });
    const title = $('doc-title') as HTMLInputElement;
    title.onchange = () => { this.title = title.value.trim() || 'งานของฉัน'; this.scheduleSave(); };

    const drawer = (side: 'left' | 'right', open: boolean) => {
      $(side).classList.toggle('open', open);
      const any = $('left').classList.contains('open') || $('right').classList.contains('open');
      $('scrim').hidden = !any;
      document.querySelectorAll(`#btn-${side}`).forEach((b) => b.setAttribute('aria-pressed', String(open)));
    };
    // จอใหญ่: ปุ่มเดียวกันพับ/กางแผง (จำไว้ในเครื่อง) · จอเล็ก/แท็บเล็ตแนวตั้ง: เปิดลิ้นชัก
    const wide = () => matchMedia('(min-width: 1101px)').matches;
    const appEl = $('app');
    const syncToggles = () => {
      for (const side of ['left', 'right'] as const) {
        const b = $(`btn-${side}`);
        const shown = wide() ? !appEl.classList.contains(`collapse-${side}`) : $(side).classList.contains('open');
        b.setAttribute('aria-pressed', String(shown));
        b.title = wide() ? `${shown ? 'ซ่อน' : 'แสดง'}แผง${side === 'left' ? 'คลังอุปกรณ์/แลป' : 'คุณสมบัติ/ผลการวัด'}` : (b.getAttribute('aria-label') ?? '');
      }
    };
    try { for (const side of ['left', 'right']) if (localStorage.getItem(`cl3d.collapse-${side}`) === '1') appEl.classList.add(`collapse-${side}`); } catch { /* ไม่มี storage */ }
    const toggle = (side: 'left' | 'right') => {
      if (wide()) {
        const c = appEl.classList.toggle(`collapse-${side}`);
        try { localStorage.setItem(`cl3d.collapse-${side}`, c ? '1' : '0'); } catch { /* ไม่มี storage */ }
      } else drawer(side, true);
      syncToggles();
    };
    $('btn-left').onclick = () => toggle('left');
    $('btn-right').onclick = () => toggle('right');
    matchMedia('(min-width: 1101px)').addEventListener?.('change', () => { drawer('left', false); drawer('right', false); syncToggles(); });
    syncToggles();
    $('scrim').onclick = () => { drawer('left', false); drawer('right', false); };
    document.querySelectorAll<HTMLElement>('.drawer-close').forEach((b) => (b.onclick = () => drawer(b.dataset.close as 'left' | 'right', false)));
    this.closeDrawers = () => { drawer('left', false); drawer('right', false); };

    // แป้นพิมพ์บนจอสัมผัส: เลื่อนช่องที่กำลังพิมพ์ให้อยู่ในส่วนที่มองเห็น และเว้นที่ใต้แผงเท่าความสูงแป้นพิมพ์
    const vv = window.visualViewport;
    if (vv) {
      const onVV = () => {
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb', `${kb > 80 ? kb : 0}px`);
      };
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
    }
    document.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (!t.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select')) return;
      if (!matchMedia('(pointer: coarse)').matches) return;
      setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
    });
    // หมุนจอ/เปลี่ยนขนาด: งานไม่เปลี่ยน แค่จัดกล้องให้เห็นทั้งหมดอีกครั้ง
    window.addEventListener('orientationchange', () => setTimeout(() => { if (this.has3d && !this.drag) this.view.resetView(); }, 350));
    $('tab-lib').onclick = () => this.setLeftTab('lib');
    $('tab-lessons').onclick = () => this.setLeftTab('lessons');
  }

  closeDrawers: () => void = () => {};

  showQuality() {
    const qBtn = $('btn-quality');
    const high = this.has3d && this.view.quality === 'high';
    qBtn.replaceChildren(h('span', { class: 'lbl' }, !this.has3d ? 'ภาพ: —' : high ? 'ภาพ: สูง' : 'ภาพ: ประหยัด'));
    qBtn.setAttribute('aria-pressed', String(high));
    qBtn.setAttribute('aria-disabled', String(!this.has3d));
  }

  /** ปุ่มควบคุมมุมมองในพื้นที่ทำงาน: พอดีจอ (Fit all) และหมุน 90° */
  renderViewCtl() {
    let el = document.getElementById('viewctl');
    if (!el) { el = h('div', { id: 'viewctl', class: 'viewctl', role: 'group', 'aria-label': 'ควบคุมมุมมองและการหมุน' }); $('stage').append(el); }
    const canRotate = this.has3d && (this.selection?.t === 'part' || this.tool.t === 'place');
    el.replaceChildren(
      h('button', { class: 'tool', id: 'btn-fit', title: 'พอดีจอ: บอร์ดและขั้วต่อของเครื่องมือทุกชิ้น (F) · Shift+F = เห็นเครื่องมือทั้งเครื่อง', 'aria-label': 'พอดีจอ (Fit all)', disabled: !this.has3d, onclick: (e: Event) => this.view.resetView((e as MouseEvent).shiftKey ? 'all' : 'work') }, svg(icon('fit'))),
      h('button', { class: 'tool', id: 'btn-rot90', title: canRotate ? 'หมุนอุปกรณ์ 90° (R)' : 'เลือกอุปกรณ์ก่อนจึงหมุนได้', 'aria-label': 'หมุน 90 องศา', disabled: !canRotate, onclick: () => this.rotateSelected() }, svg(icon('rotate'))),
    );
  }

  setLeftTab(t: 'lib' | 'lessons') {
    this.leftTab = t;
    $('tab-lib').setAttribute('aria-selected', String(t === 'lib'));
    $('tab-lessons').setAttribute('aria-selected', String(t === 'lessons'));
    $('lib-body').hidden = t !== 'lib';
    $('lessons-body').hidden = t !== 'lessons';
    if (t === 'lessons') renderLessons(this);
  }

  renderTools() {
    const mk = (label: string, ic: string, tool: Tool, active: boolean, sw?: string) =>
      h('button', { class: 'tool', role: 'radio', 'aria-checked': String(active), title: label, 'aria-label': label, onclick: () => this.setTool(tool) },
        svg(icon(ic)), sw ? h('span', { class: 'sw', style: `background:${sw}` }) : null);
    const t = this.tool;
    const tools = $('tools');
    tools.replaceChildren(
      mk('เลือก / ย้าย (V)', 'select', { t: 'select' }, t.t === 'select' || t.t === 'place'),
      mk('กล้อง: หมุน/ซูม/เลื่อน ไม่ย้ายอุปกรณ์ (C)', 'orbit', { t: 'camera' }, t.t === 'camera'),
      mk('ต่อสาย (W)', 'wire', { t: 'wire' }, t.t === 'wire' || t.t === 'wireEnd'),
      mk('โพรบแดง (+)', 'probe', { t: 'probe', which: 'red' }, t.t === 'probe' && t.which === 'red', 'var(--red)'),
      mk('โพรบดำ (COM)', 'probe', { t: 'probe', which: 'black' }, t.t === 'probe' && t.which === 'black', 'var(--black)'),
    );
    tools.querySelectorAll('button').forEach((b) => {
      (b as HTMLButtonElement).disabled = !this.has3d;
      if (!this.has3d) b.title = `${b.getAttribute('aria-label')} — ใช้ไม่ได้: ไม่มีพื้นที่ 3 มิติ`;
    });
    const names: Record<string, string> = { select: 'เลือก/ย้าย', camera: 'กล้อง', wire: 'ต่อสาย', wireEnd: 'ย้ายปลายสาย', probe: 'โพรบ', place: 'วางอุปกรณ์' };
    tools.dataset.current = names[t.t];
  }

  /** ปุ่มด่วนมุมขวาล่าง (สำคัญบนมือถือ) */
  renderQuick() {
    const q = $('quick');
    const s = this.selection;
    // ไม่สร้างปุ่มใหม่ถ้าเหมือนเดิม (ระหว่างจำลองถูกเรียกหลายครั้งต่อวินาที — แทนที่ปุ่มแล้วการแตะบน iPad หาย)
    const sig = `${this.tool.t}|${JSON.stringify(s)}`;
    if (q.dataset.sig === sig) return;
    q.dataset.sig = sig;
    const items: HTMLElement[] = [];
    // ระหว่างต่อสาย/วางโพรบ/หมุนกล้อง ไม่แสดงปุ่มด่วนของอุปกรณ์ (ไม่ให้บังจุดที่จะแตะ)
    if (this.tool.t === 'wire' || this.tool.t === 'wireEnd' || this.tool.t === 'probe' || this.tool.t === 'camera') { q.replaceChildren(); return; }
    if (this.tool.t === 'place') {
      items.push(h('button', { onclick: () => this.rotateSelected() }, svg(icon('rotate')), 'หมุน'));
      items.push(h('button', { onclick: () => this.setTool({ t: 'select' }) }, svg(icon('close')), 'ยกเลิก'));
    } else if (s?.t === 'part') {
      items.push(h('button', { onclick: () => this.rotateSelected(), title: 'หมุน (R)' }, svg(icon('rotate')), 'หมุน'));
      items.push(h('button', { onclick: () => this.duplicateSelected(), title: 'คัดลอก (Ctrl+D)' }, svg(icon('copy')), 'คัดลอก'));
      items.push(h('button', { class: 'danger', onclick: () => this.deleteSelected(), title: 'ลบ (Delete)' }, svg(icon('trash')), 'ลบ'));
    } else if (s?.t === 'wire') {
      items.push(h('button', { class: 'danger', onclick: () => this.deleteSelected() }, svg(icon('trash')), 'ลบสาย'));
    }
    q.replaceChildren(...items);
  }

  renderToolbar() {
    ($('btn-undo') as HTMLButtonElement).disabled = !this.history.canUndo;
    ($('btn-redo') as HTMLButtonElement).disabled = !this.history.canRedo;
    $('btn-undo').title = this.history.canUndo ? `ย้อนกลับ: ${this.history.undoLabel} (Ctrl+Z)` : 'ย้อนกลับ (Undo)';
    $('btn-redo').title = this.history.canRedo ? `ทำซ้ำ: ${this.history.redoLabel} (Ctrl+Y)` : 'ทำซ้ำ (Redo)';
    ($('btn-run') as HTMLButtonElement).disabled = this.running;
    for (const id of ['btn-reset', 'btn-persp', 'btn-top']) { $(id).setAttribute('aria-disabled', String(!this.has3d)); $(id).classList.toggle('off', !this.has3d); }
    $('btn-run').classList.toggle('active', this.running);
    ($('btn-stop') as HTMLButtonElement).disabled = !this.running;
    $('btn-persp').setAttribute('aria-checked', String(this.view.view === 'perspective'));
    $('btn-top').setAttribute('aria-checked', String(this.view.view === 'top'));
    const st = $('sim-status');
    const s = this.sim;
    if (!this.running) { st.className = 'pill'; st.textContent = 'หยุดจำลอง'; st.title = ''; }
    else if (s && !s.result.ok) { st.className = 'pill error'; st.textContent = 'คำนวณไม่ได้'; st.title = s.result.error?.message ?? ''; }
    else {
      st.className = 'pill running';
      const tran = s?.mode === 'tran';
      st.textContent = !this.freshSim ? 'กำลังคำนวณ…' : tran ? (this.simc.paused ? 'จำลองตามเวลา · หยุดเวลา' : 'จำลองตามเวลา') : 'กำลังจำลอง · DC';
      st.title = s ? `${tran ? 'Transient (trapezoidal + backward Euler, ก้าวเวลาปรับอัตโนมัติ)' : 'DC operating point'} · Newton ${s.result.iterations} รอบ · ${s.result.solveMs.toFixed(1)} ms · ${this.simc.workerMode === 'worker' ? 'Web Worker' : 'main thread'} · tick ${this.simc.tickMs} ms` : '';
    }
    const banner = $('sim-banner');
    if (this.running && s && !s.result.ok && s.doc === this.doc) {
      banner.hidden = false;
      banner.replaceChildren(h('b', {}, s.result.error!.message), h('div', {}, `${s.result.error!.detail ?? ''} — ระบบหยุดแสดงค่าที่วัดได้จนกว่าวงจรจะคำนวณได้`));
    } else banner.hidden = true;
  }

  refreshPanels() {
    this.renderToolbar();
    renderProps(this);
    renderResults(this);
    renderMeters(this);
    this.renderQuick();
    if (this.leftTab === 'lessons') renderLessons(this, true);
    // ตรวจบทเรียนต่อแม้แท็บบทเรียนปิดอยู่ เพื่อจดจำเป้าหมายที่ผ่านระหว่างทาง (เช่น หมุน VR ครบ 3 ช่วง, กดสวิตช์)
    else if (this.work.lessonId) this.lessonStatus();
    renderLogger(this);
  }

  refreshAll() {
    this.view.setDoc(this.doc);
    this.renderTools();
    renderLibrary(this);
    this.setLeftTab(this.leftTab);
    this.refreshPanels();
    this.updateHighlight();
  }
}
