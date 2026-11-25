/**
 * หน้าต่างตรวจดูอุปกรณ์รอบด้าน: โมเดลเดียวกับในฉาก (สร้างจาก buildPartModel) วางลอยบนพื้นหลังเรียบ
 * มองได้ทุกทิศรวมด้านล่าง (ในฉากหลักโต๊ะบังด้านล่างบอร์ด) · ปุ่มมุมสำเร็จรูป บน/ล่าง/หน้า/หลัง/ซ้าย/ขวา/เอียง + หมุน/ซูมด้วยนิ้วหรือเมาส์
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPartModel } from '../render/models';
import { onGlbLoaded } from '../render/glb';
import { catalogEntry } from '../model/catalog';
import type { Part } from '../model/types';
import { $, h } from './dom';

export type InspectView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';
const DIRS: Record<InspectView, [number, number, number]> = {
  top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0.18, 1], back: [0, 0.18, -1], left: [-1, 0.18, 0], right: [1, 0.18, 0], iso: [-0.75, 0.75, 0.9],
};
const NAMES: Record<InspectView, string> = { top: 'ด้านบน', bottom: 'ด้านล่าง', front: 'ด้านหน้า', back: 'ด้านหลัง', left: 'ด้านซ้าย', right: 'ด้านขวา', iso: 'มุมเอียง' };

/** สถานะสำหรับเทสต์: มุมปัจจุบัน และวาดแล้วกี่ครั้ง */
export const INSPECT_STATE = { open: false, view: 'iso' as InspectView, frames: 0 };

export function openInspector(part: Part) {
  const d = $('dialog') as HTMLDialogElement;
  const canvas = h('canvas', { id: 'insp-canvas', style: 'width:100%;height:100%;display:block;touch-action:none;border-radius:8px;background:#d9ddd8' }) as HTMLCanvasElement;
  const box = h('div', { class: 'insp-box', style: 'position:relative;width:100%;height:min(62vh,560px);min-height:260px' }, canvas);
  const note = h('p', { class: 'help', id: 'insp-note', style: 'font-size:12.5px;margin:6px 0 0' }, 'ลากเพื่อหมุน · หยิก/ล้อเมาส์เพื่อซูม · สองนิ้ว/คลิกขวาเพื่อเลื่อน');
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); } catch {
    d.replaceChildren(h('div', { class: 'dlg' }, h('p', {}, 'เปิดพื้นที่ 3 มิติไม่ได้ในเบราว์เซอร์นี้'), h('button', { class: 'btn', onclick: () => d.close() }, 'ปิด'))); d.showModal(); return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9ddd8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-1, 2, 1.4);
  // ไฟจากด้านล่างด้วย (หน้าต่างนี้ไม่มีโต๊ะ) ให้เห็นชิ้นส่วนใต้บอร์ดชัด
  const fill = new THREE.DirectionalLight(0xffffff, 1.1); fill.position.set(1, -2, -1);
  scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0xb8bcb8, 0.9));
  const model = buildPartModel(part);
  scene.add(model);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.screenSpacePanning = true;
  let need = true;
  const bounds = () => { model.updateMatrixWorld(true); const b = new THREE.Box3(); model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && (m.material as THREE.MeshBasicMaterial).visible !== false) b.expandByObject(m, false); }); return b; };
  const setView = (v: InspectView) => {
    INSPECT_STATE.view = v;
    const b = bounds(), c = b.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(...DIRS[v]).normalize();
    cam.up.set(0, 1, 0); if (v === 'top') cam.up.set(0, 0, -1); if (v === 'bottom') cam.up.set(0, 0, 1);
    // ถอยกล้องจนมุมทั้ง 8 ของกรอบอุปกรณ์อยู่ในจอ (เต็มจอที่สุดโดยไม่ถูกตัดขอบ)
    const corners: THREE.Vector3[] = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let dist = 0.5;
    for (let k = 0; k < 240; k++) {
      cam.position.copy(c).addScaledVector(dir, dist); cam.near = dist / 100; cam.far = dist * 20; cam.updateProjectionMatrix(); cam.lookAt(c); cam.updateMatrixWorld();
      if (corners.every((p) => { const q = p.clone().project(cam); return q.z > -1 && q.z < 1 && Math.abs(q.x) < 0.86 && Math.abs(q.y) < 0.86; })) break;
      dist *= 1.05;
    }
    ctl.target.copy(c); ctl.update();
    for (const [k] of Object.entries(DIRS)) document.getElementById(`insp-${k}`)?.setAttribute('aria-pressed', String(k === v));
    need = true;
  };
  const resize = () => { const w = box.clientWidth, hh = box.clientHeight; if (!w || !hh) return; renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); need = true; };
  ctl.addEventListener('change', () => { need = true; });
  const off = onGlbLoaded(() => { need = true; setView(INSPECT_STATE.view); });
  let raf = 0;
  const loop = () => { raf = requestAnimationFrame(loop); ctl.update(); if (need) { need = false; renderer.render(scene, cam); INSPECT_STATE.frames++; } };
  const ro = new ResizeObserver(resize);
  const e = catalogEntry(part.kind);
  d.replaceChildren(h('div', { class: 'dlg insp-dlg' },
    h('h2', {}, `ตรวจดูรอบด้าน: ${part.label}`), h('div', { class: 'help', style: 'margin-top:-6px' }, e?.name ?? part.kind),
    box,
    h('div', { class: 'btn-row insp-views', role: 'group', 'aria-label': 'มุมมอง' }, ...(Object.keys(DIRS) as InspectView[]).map((k) => h('button', { class: 'btn', id: `insp-${k}`, 'aria-pressed': 'false', onclick: () => setView(k) }, NAMES[k]))),
    note,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', id: 'insp-close', onclick: () => d.close() }, 'ปิด'))));
  d.classList.add('wide');
  d.addEventListener('close', () => {
    cancelAnimationFrame(raf); ro.disconnect(); off(); ctl.dispose(); pmrem.dispose(); renderer.dispose();
    d.classList.remove('wide'); INSPECT_STATE.open = false;
  }, { once: true });
  d.showModal();
  INSPECT_STATE.open = true; INSPECT_STATE.frames = 0;
  ro.observe(box); resize(); setView('iso'); loop();
}
