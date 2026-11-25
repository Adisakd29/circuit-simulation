/**
 * โมเดล GLB ของบอร์ดที่สร้างจากไฟล์ CAD ของผู้ผลิต (ดู scripts/models/README.md)
 * โหลดครั้งเดียวต่อไฟล์ (fetch → GLTFLoader.parse + MeshoptDecoder) แล้วโคลนให้แต่ละชิ้นในฉาก — เรขาคณิต/เท็กซ์เจอร์ใช้ร่วมกัน
 * ระหว่างโหลด ตัวสร้างโมเดลใส่ภาพแทนชั่วคราว (ไม่มีผลกับตำแหน่งขา — จุดต่อสายเป็นวัตถุแยกที่วางตามพิกัดขาจริงตั้งแต่แรก)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SHARED_ENV } from './pico-model';

const cache = new Map<string, Promise<THREE.Group>>();
const ready = new Map<string, THREE.Group>();
const listeners = new Set<() => void>();
/** จำนวนไฟล์ที่ยังโหลดไม่เสร็จ (ใช้ในเทสต์/ภาพตรวจรับ) */
export const GLB_STATE = { pending: 0, failed: [] as string[] };

/** ฟังก์ชันที่เรียกเมื่อโมเดลใดโหลดเสร็จ (ฉากขอวาดใหม่) */
export function onGlbLoaded(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

function load(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (p) return p;
  GLB_STATE.pending++;
  p = (async () => {
    // หน้าเว็บไฟล์เดียวฝังโมเดลเป็น data URL: ถอด base64 เอง (บางสภาพแวดล้อมห้าม fetch data: ตามนโยบายความปลอดภัย)
    let buf: ArrayBuffer;
    if (url.startsWith('data:')) { const b64 = url.slice(url.indexOf(',') + 1); const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; }
    else buf = await (await fetch(url)).arrayBuffer();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(buf, '');
    const scene = gltf.scene as THREE.Group;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.glb = true;
      const mt = m.material as THREE.MeshStandardMaterial;
      // แสงสะท้อนสภาพแวดล้อมแบบเดียวกับโมเดลอื่นในฉาก (ผิวโลหะ/ทอง)
      if (mt.metalness > 0.3 || mt.metalnessMap) { mt.userData.wantsEnv = true; mt.envMap = SHARED_ENV.enabled ? SHARED_ENV.tex : null; mt.envMapIntensity = SHARED_ENV.intensity; }
      if (mt.map) mt.map.anisotropy = 8;
    });
    ready.set(url, scene);
    return scene;
  })();
  p.then(() => { GLB_STATE.pending--; for (const f of listeners) f(); }, (e) => { GLB_STATE.pending--; GLB_STATE.failed.push(`${url}: ${e}`); });
  cache.set(url, p);
  return p;
}

/**
 * ใส่โมเดล GLB ลงในกลุ่ม (หน่วยในไฟล์ = mm) · placeholder ถูกซ่อนเมื่อโหลดเสร็จ
 * transform: ตำแหน่ง/การหมุนของกรอบไฟล์ในกรอบของกลุ่ม (mm)
 */
export function attachGlb(group: THREE.Group, url: string, offset: THREE.Vector3, placeholder?: THREE.Object3D) {
  const put = (src: THREE.Group) => {
    const c = src.clone(true);
    c.position.copy(offset);
    c.userData.glbRoot = true;
    group.add(c);
    // ให้การแตะบนตัวบอร์ดเลือกอุปกรณ์ได้เหมือนโมเดลเดิม (ตอนสร้าง models.ts ใส่ partId ให้ลูกทุกชิ้น — ชิ้นที่มาภายหลังต้องใส่เอง)
    let a: THREE.Object3D | null = group;
    while (a && !a.userData.partId) a = a.parent;
    if (a) { const pid = a.userData.partId; c.traverse((o) => { o.userData.partId = pid; }); }
    if (placeholder) placeholder.visible = false;
  };
  const r = ready.get(url);
  if (r) { put(r); return; }
  void load(url).then(put, () => { /* โหลดไม่ได้: คงภาพแทนไว้ (แจ้งใน GLB_STATE.failed) */ });
}

/** โหลดไว้ก่อน (เช่น ตอนเปิดหน้า) ให้วางบอร์ดครั้งแรกเห็นโมเดลจริงทันที */
export function preloadGlb(url: string) { void load(url).catch(() => undefined); }

// เทสต์ในเบราว์เซอร์รอให้โมเดลโหลดเสร็จก่อนถ่ายภาพ/ตรวจ (window.__glb.pending === 0)
(globalThis as unknown as { __glb: typeof GLB_STATE }).__glb = GLB_STATE;
