import { ledBrightness } from '../instruments/measure';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID_ROWS, RAILS, ROW_LETTERS, allHoles, boardSpec, holeAt, holeInfo, type BoardModel } from '../model/breadboard';
import { PICO_PINOUT, pinDefs, rotateOffset } from '../model/catalog';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MM, PICO_PIN_TOP_MM, SHARED_ENV, buildPinLabelOverlay, withEnv } from './pico-model';
import { BENCH_DIMS, BENCH_ROW_KINDS, TABLE_BOUNDS, boardRect, footprint, holeWorld, isBenchKind, isBoardKind, pinHolesFor, tablePinXZ, worldToGrid } from '../model/geometry';
import { DmmLcd, benchPinDir, vomNeedleAngle } from './bench';
import { dmmDisplay } from '../instruments/meters';
import type { Breadboard, CircuitDoc, Part, Rotation, TerminalRef, Wire } from '../model/types';
import { servoHornRotation } from './board-parts';
import { LedPlayback } from './led-playback';
import type { Analysis } from '../instruments/measure';
import { formatSI } from '../model/units';
import { LcdScreen, ScopeScreen, TABLE_Y, fgenLcd, buildPartModel, labelSprite, tablePinLocal } from './models';
import { drawScope } from '../ui/scope-draw';
import type { ScopeFrame, ScopeSettings } from '../instruments/scope';

/**
 * ตัวแสดงผล 3 มิติ — รับ CircuitDoc + ผลวิเคราะห์แล้ววาด
 * ไม่มีตรรกะไฟฟ้าในนี้; picking คืนค่าเป็นการอ้างอิงเชิงตรรกะ (รู/ขั้ว/อุปกรณ์/สาย)
 * วาดเฉพาะเมื่อมีการเปลี่ยนแปลง (on-demand) เพื่อประหยัดแบตเตอรี่บนแท็บเล็ต
 */

export type Pick =
  | { type: 'pin'; partId: string; pin: string; point: THREE.Vector3 }
  | { type: 'part'; partId: string; point: THREE.Vector3; plunger?: boolean }
  | { type: 'wire'; wireId: string; point: THREE.Vector3 }
  | { type: 'hole'; boardId: string; hole: string; point: THREE.Vector3 }
  | { type: 'board'; boardId: string; point: THREE.Vector3 }
  | { type: 'table'; point: THREE.Vector3 };

export type ViewMode = 'perspective' | 'top';

const PX = 64; // พิกเซลต่อหน่วยรูของ texture บอร์ด

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls: OrbitControls;
  orthoControls: OrbitControls;
  view: ViewMode = 'perspective';
  private raycaster = new THREE.Raycaster();
  private partsRoot = new THREE.Group();
  private wiresRoot = new THREE.Group();
  private overlayRoot = new THREE.Group();
  private ghostRoot = new THREE.Group();
  private partObjs = new Map<string, THREE.Group>();
  private wireObjs = new Map<string, THREE.Object3D>();
  private doc: CircuitDoc | null = null;
  private highlightMesh: THREE.InstancedMesh;
  private pendingMarker: THREE.Mesh;
  private hoverMarker: THREE.Mesh;
  private selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xe0a526);
  private needsRender = true;
  /** การวาดใหม่จากผลจำลอง (ค่าในฉากเปลี่ยน) — จำกัดความถี่ไม่ให้แย่ง CPU จากตัวคำนวณบนเครื่องที่วาดภาพด้วยซอฟต์แวร์ */
  private simRenderPending = false;
  private lastRenderAt = 0;
  private renderCost = 0;
  /** ระยะห่างเฉลี่ยระหว่างเฟรมที่วาดติดกัน (ms) */
  private frameGap = 16.7;
  private lastLoopAt = 0;
  private renderedLastFrame = false;
  /** เวลาที่ผู้ใช้แตะ/คลิก/กดแป้นครั้งล่าสุด */
  private lastInputAt = -1e9;
  private boardMeshes: THREE.Object3D[] = [];
  private tableMesh: THREE.Mesh;
  private probeObjs: Record<'red' | 'black', THREE.Group>;
  private partSignature = new Map<string, string>();
  private wireSignature = new Map<string, string>();
  private boardObjs = new Map<string, THREE.Group>();
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;
  /** เรียกเมื่อ GPU/เบราว์เซอร์ทิ้ง WebGL context (เช่น แท็บถูกพักบนมือถือ) */
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'scene-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'พื้นที่ทำงาน 3 มิติ');
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.onContextRestored());
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x163f3a);
    // แสงสะท้อนจากสภาพแวดล้อม (ห้องจำลอง) ให้โลหะ เช่น ขา header จุดบัดกรี โล่ USB ดูเป็นโลหะจริง ไม่ดำทึบ
    performance.mark?.('cl:renderer');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    SHARED_ENV.tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    performance.mark?.('cl:pmrem');
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.5, 2400);
    this.ortho = new THREE.OrthographicCamera(-30, 30, 20, -20, 0.5, 2400);
    this.camera = this.persp;

    // ไฟ
    this.scene.add(new THREE.HemisphereLight(0xf2f6f0, 0x2a4a44, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-90, 200, 130); // ทิศเดิม (−18, 40, 26) แต่อยู่ไกลพอให้กล้องเงาครอบโต๊ะทั้งตัว
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // กล้องเงาครอบโต๊ะ ±200 × ±180 (เครื่องมือขนาดจริงอยู่แถวหลัง)
    Object.assign(sun.shadow.camera, { left: -215, right: 215, top: 200, bottom: -200, near: 20, far: 600 });
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    // โต๊ะ: แผ่นยางกันไฟฟ้าสถิต (ESD mat) พร้อมกริด
    this.tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * TABLE_BOUNDS.x + 40, 2 * TABLE_BOUNDS.z + 40), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.95 }));
    this.tableMesh.rotation.x = -Math.PI / 2;
    this.tableMesh.position.y = TABLE_Y;
    this.tableMesh.receiveShadow = true;
    this.tableMesh.userData.isTable = true;
    this.scene.add(this.tableMesh);

    this.scene.add(this.partsRoot, this.wiresRoot, this.overlayRoot, this.ghostRoot);

    this.highlightMesh = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.28, 0.46, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.95, depthWrite: false }),
      420,
    );
    this.highlightMesh.count = 0;
    this.highlightMesh.renderOrder = 5;
    this.overlayRoot.add(this.highlightMesh);

    this.pendingMarker = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3fd2ff, depthTest: false }));
    this.pendingMarker.visible = false;
    this.pendingMarker.renderOrder = 6;
    this.hoverMarker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.hoverMarker.visible = false;
    this.hoverMarker.renderOrder = 6;
    this.overlayRoot.add(this.pendingMarker, this.hoverMarker, this.selectionBox);
    this.selectionBox.visible = false;

    this.probeObjs = { red: probeModel(0xd63a2f), black: probeModel(0x2a2a2a) };
    this.overlayRoot.add(this.probeObjs.red, this.probeObjs.black);

    this.controls = new OrbitControls(this.persp, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4; // ซูมใกล้พอให้อ่านลายสกรีน/ตำแหน่งขาได้
    this.controls.maxDistance = 700;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());

    this.orthoControls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.orthoControls.enableRotate = false;
    this.orthoControls.screenSpacePanning = true;
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.orthoControls.minZoom = 0.04; // ต้องเห็นโต๊ะขนาดจริงทั้งตัวบนจอแนวตั้งได้
    this.orthoControls.maxZoom = 6;
    this.orthoControls.enabled = false;
    this.orthoControls.addEventListener('change', () => this.requestRender());

    this.resetView();
    const markInput = () => { this.lastInputAt = performance.now(); };
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(ev, markInput, { capture: true, passive: true });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      const active = this.view === 'top' ? this.orthoControls : this.controls;
      if (active.enabled) active.update();
      const now = performance.now();
      // ระยะห่างจริงระหว่างเฟรมที่วาดติดกัน (รวมเวลาที่ GPU/เบราว์เซอร์ใช้ ซึ่ง renderer.render() ไม่เห็น — Safari บน iPad
      // ส่งงานให้ GPU แล้วคืนทันที ถ้า GPU ไม่ทันเฟรมถัดไปจะมาช้า)
      if (this.renderedLastFrame) this.frameGap = this.frameGap * 0.8 + Math.min(now - this.lastLoopAt, 500) * 0.2;
      this.lastLoopAt = now;
      this.renderedLastFrame = false;
      // ผลจำลอง: วาดไม่เกิน ~30 ครั้ง/วินาที และไม่วาดสองเฟรมติดกัน (เหลือเฟรมว่างให้รับการแตะ/คลิก)
      // เครื่องวาดช้า (เวลาวาดหรือระยะเฟรม > 25 ms) วาดห่างอย่างน้อย 3 เท่า และไม่ต่ำกว่า 100 ms เพื่อไม่แย่งเวลาจากตัวคำนวณและการรับสัมผัส
      // ช่วง 250 ms หลังผู้ใช้แตะ/คลิก/กดแป้น ไม่วาดจากผลจำลอง ให้ main thread ว่างตอบสนองการกดก่อน
      const cost = Math.max(this.renderCost, this.frameGap - 17);
      const simGap = cost < 25 ? 33 : Math.max(100, 3 * cost);
      const quiet = now - this.lastInputAt > 250;
      // LED ที่เล่นตามเวลาจำลอง: เปลี่ยนเมื่อไรวาดเฟรมนั้นเลย (ขอบไฟกะพริบตรงจังหวะ) ยกเว้นเครื่องวาดช้า
      if (quiet && this.stepLedPlayback(now)) { if (cost < 25) this.needsRender = true; else this.simRenderPending = true; }
      if (this.needleAnimating && this.stepNeedles(now)) this.needsRender = true;
      const simDue = this.simRenderPending && now - this.lastRenderAt >= simGap && quiet;
      if (this.needsRender || simDue) {
        this.renderedLastFrame = true;
        this.needsRender = false; this.simRenderPending = false;
        const t0 = performance.now();
        this.renderer.render(this.scene, this.camera);
        const t1 = performance.now();
        this.renderCost = this.renderCost * 0.8 + (t1 - t0) * 0.2;
        this.lastRenderAt = t1;
        this.trackFrame(t1);
      }
    };
    loop();
  }

  /** เข็มมิเตอร์แบบเข็ม: ระบบมวล-สปริงหน่วงเกือบวิกฤต (ω ≈ 11 rad/s, ζ ≈ 0.65 — เข็มเคลื่อนถึงค่าในราว 0.4 s แกว่งเกินเล็กน้อยเหมือนของจริง) */
  private needleAnimating = false;
  private lastNeedleAt = 0;
  private stepNeedles(now: number): boolean {
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastNeedleAt || now)) / 1000));
    this.lastNeedleAt = now;
    let moving = false;
    for (const g of this.partObjs.values()) {
      const n = g.userData.vomNeedle as THREE.Object3D | undefined;
      if (!n) continue;
      const target = (g.userData.needleTarget as number | undefined) ?? vomNeedleAngle(0);
      const st = (g.userData.needleState ??= { a: target, v: 0 }) as { a: number; v: number };
      const w0 = 11, z = 0.65;
      for (let k = 0; k < 4; k++) { const h = dt / 4; const acc = w0 * w0 * (target - st.a) - 2 * z * w0 * st.v; st.v += acc * h; st.a += st.v * h; }
      // หมุดกั้นเข็มสองข้าง
      const lo = vomNeedleAngle(-1), hi = vomNeedleAngle(2);
      if (st.a < lo) { st.a = lo; st.v = Math.abs(st.v) * 0.2; }
      if (st.a > hi) { st.a = hi; st.v = -Math.abs(st.v) * 0.2; }
      n.rotation.y = -st.a;
      if (Math.abs(target - st.a) > 2e-4 || Math.abs(st.v) > 2e-3) moving = true;
    }
    if (!moving) { this.needleAnimating = false; this.lastNeedleAt = 0; }
    return true;
  }

  /** เลิกใช้ตัวแสดงผลนี้ (ใช้ตอนกู้คืนหลัง WebGL context หาย หรือกด "ลองอีกครั้ง") — ข้อมูลวงจรไม่ได้อยู่ในนี้ จึงไม่หาย */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObs?.disconnect();
    this.controls.dispose();
    this.orthoControls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** คุณภาพภาพ: high = แสงสะท้อนโลหะ (env map) + เงาจากแสงหลัก, eco = ปิดทั้งสอง (เหลือเงาสัมผัสแบบ texture) */
  quality: 'high' | 'eco' = 'high';
  onAutoEco: () => void = () => {};
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  autoQuality = true;
  setQuality(q: 'high' | 'eco') {
    this.quality = q;
    SHARED_ENV.enabled = q === 'high';
    this.renderer.shadowMap.enabled = q === 'high';
    // โหมดประหยัด: ลดความละเอียดพิกเซล (จอ Retina 2× → 1.25×) งาน GPU ลดราว 60%
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.25));
    this.resize();
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.userData.wantsEnv) {
          // โลหะที่ไม่มีแสงสะท้อนจากสภาพแวดล้อมจะดำ → โหมดประหยัดลดความเป็นโลหะลง ให้ดูเป็นโลหะด้านสีเทาจากไฟปกติ
          const sm = m as THREE.MeshStandardMaterial;
          sm.userData.metal ??= { metalness: sm.metalness, roughness: sm.roughness };
          sm.envMap = SHARED_ENV.enabled ? SHARED_ENV.tex : null;
          sm.metalness = SHARED_ENV.enabled ? sm.userData.metal.metalness : sm.userData.metal.metalness * 0.3;
          sm.roughness = SHARED_ENV.enabled ? sm.userData.metal.roughness : Math.max(0.45, sm.userData.metal.roughness);
        }
        m.needsUpdate = true;
      }
    });
    this.frameTimes = [];
    this.requestRender();
  }

  /** ถ้าหมุนกล้องแล้วเฟรมช้ากว่า ~22 fps ต่อเนื่อง ให้ลดเป็นโหมดประหยัดอัตโนมัติ (ครั้งเดียว) */
  private trackFrame(now: number) {
    if (!this.autoQuality || this.quality !== 'high') return;
    const dt = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (dt > 200) { this.frameTimes = []; return; } // ไม่ได้วาดต่อเนื่อง
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 45) { this.autoQuality = false; this.setQuality('eco'); this.onAutoEco(); }
  }

  get activeControls() { return this.view === 'top' ? this.orthoControls : this.controls; }

  requestRender() { this.needsRender = true; }
  /** ขอวาดใหม่เพราะผลจำลองเปลี่ยน (ถูกจำกัดความถี่) */
  requestSimRender() { this.simRenderPending = true; }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const halfH = 22, halfW = halfH * (w / h);
    Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
    this.requestRender();
  }

  setView(v: ViewMode) {
    this.view = v;
    this.camera = v === 'top' ? this.ortho : this.persp;
    this.controls.enabled = v === 'perspective';
    this.orthoControls.enabled = v === 'top';
    this.requestRender();
  }

  /** จุดนี้อยู่ในจอ (และอยู่หน้ากล้อง) หรือไม่ */
  inView(p: THREE.Vector3, margin = 0.92): boolean {
    this.camera.updateMatrixWorld();
    const q = p.clone().project(this.camera);
    return q.z < 1 && Math.abs(q.x) <= margin && Math.abs(q.y) <= margin;
  }

  /**
   * จัดกล้อง: 'work' (ค่าเริ่ม/รีเซ็ต) = บอร์ด อุปกรณ์ข้างบอร์ด และขั้วต่อของเครื่องมือขนาดจริงทุกขั้ว (รูบนบอร์ดยังใหญ่พอแตะ)
   * 'all' (ปุ่มพอดีจอ/F) = เห็นทุกอย่างบนโต๊ะรวมทั้งตัวเครื่องมือและจอแสดงผล
   */
  resetView(mode: 'work' | 'all' = 'work') {
    // เห็นทุกอย่างบนโต๊ะ: เบรดบอร์ดทุกแผ่น + อุปกรณ์ทุกชิ้น (รวมที่วางบนโต๊ะ)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (a: number, b: number, c: number, d: number) => { x0 = Math.min(x0, a); x1 = Math.max(x1, b); z0 = Math.min(z0, c); z1 = Math.max(z1, d); };
    const boards = this.doc?.breadboards ?? [{ x: 0, z: 0 }];
    // เว้นพื้นโต๊ะด้านซ้ายบอร์ดไว้เสมอ (ที่วางแหล่งจ่าย/เครื่องมือ)
    // (จอแนวตั้งแคบ: จัดบอร์ดไว้กลางจอแทน เพื่อให้รูใหญ่พอแตะได้ — เลื่อนกล้องไปดูพื้นโต๊ะด้านข้างได้)
    const portrait = this.container.clientWidth < this.container.clientHeight;
    /** จุด 3 มิติที่ต้องอยู่ในจอ (มุมบอร์ด/อุปกรณ์ ขั้วต่อของเครื่องมือ) — ตรวจหลังตั้งกล้อง ถ้าหลุดขอบ ถอยกล้องออก */
    const must: THREE.Vector3[] = [];
    const corners = (x0: number, x1: number, z0: number, z1: number, y: number) => { for (const x of [x0, x1]) for (const z of [z0, z1]) must.push(new THREE.Vector3(x, y, z)); };
    for (const b of boards) {
      const S = boardSpec((b as { model?: BoardModel }).model).size;
      add(b.x - S.w / 2 - (portrait ? 1 : 15), b.x + S.w / 2 + 1, b.z - S.h / 2 - 1, b.z + S.h / 2 + 1);
      corners(b.x - S.w / 2, b.x + S.w / 2, b.z - S.h / 2, b.z + S.h / 2, 0);
    }
    for (const p of this.doc?.parts ?? []) {
      // เครื่องมือขนาดจริง (แถวหลัง/ข้างบอร์ด): ให้เห็นขั้วต่อทุกขั้ว แต่ไม่ต้องเห็นทั้งเครื่อง (บอร์ดจะเล็กเกินไป)
      if (isBenchKind(p.kind) && p.placement.kind === 'table') {
        // จอแนวตั้ง: มิเตอร์วางหงายข้างบอร์ดไม่นับ (บอร์ดจะเล็กจนแตะรูยาก) — เลื่อนกล้องไปหามิเตอร์เอง
        if (portrait && !BENCH_ROW_KINDS.includes(p.kind)) continue;
        for (const d of pinDefs(p)) { const v = this.terminalWorld({ kind: 'pin', partId: p.id, pin: d.name }); if (v) { add(v.x - 4, v.x + 4, v.z - 6, v.z + 2); must.push(v); } }
        if (mode === 'all') {
          // ทั้งเครื่อง: มุมทั้ง 8 ของกล่องตัวเครื่อง
          const f = footprint(p)!, h = TABLE_Y + BENCH_DIMS[p.kind].h * MM;
          add(f.x0, f.x1, f.z0, f.z1);
          for (const x of [f.x0, f.x1]) for (const z of [f.z0, f.z1]) for (const y of [TABLE_Y, h]) must.push(new THREE.Vector3(x, y, z));
        }
        continue;
      }
      const f = footprint(p);
      if (f) { add(f.x0 - 1, f.x1 + 1, f.z0 - 1.5, f.z1 + 1); corners(f.x0, f.x1, f.z0, f.z1, TABLE_Y); }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0 + 4, bh = z1 - z0 + 4;
    const w = Math.max(1, this.container.clientWidth), hgt = Math.max(1, this.container.clientHeight);
    const aspect = w / hgt;
    const narrow = aspect < 1;
    // perspective
    const t = Math.tan(((this.persp.fov / 2) * Math.PI) / 180);
    let dist = Math.max(bh / 2 / t, bw / 2 / (t * aspect)) * (narrow ? 1.05 : 1.1);
    const dir = new THREE.Vector3(0, narrow ? 0.88 : 0.74, narrow ? 0.48 : 0.67).normalize();
    this.controls.target.set(cx, -1, cz);
    this.persp.position.copy(this.controls.target).addScaledVector(dir, dist);
    // มุมกล้องเอียง: ขอบใกล้กล้องกว้างกว่าขอบไกล — ตรวจจุดที่ต้องเห็นจริงหลังฉาย ถ้าหลุดขอบจอ ถอยกล้องออกทีละ 6%
    this.persp.aspect = aspect; this.persp.updateProjectionMatrix();
    // แถบเครื่องมือลอยทับพื้นที่ทำงาน: จอแนวตั้งอยู่ด้านบน (เว้น 15%) และแถบปุ่มของอุปกรณ์ที่เลือก/ป้ายแนะนำอยู่ด้านล่าง (เว้น 20%)
    // จอแนวนอนอยู่ชิดซ้าย/ขวา (เว้น 8%) — ขั้วต่อที่อยู่ใต้แถบเครื่องมือจะแตะไม่ได้
    const yMin = portrait ? -0.6 : -0.9, yMax = portrait ? 0.7 : 0.9, xMax = portrait ? 0.9 : 0.84;
    for (let k = 0; k < 40 && must.length; k++) {
      this.persp.lookAt(this.controls.target); this.persp.updateMatrixWorld();
      const q = must.map((v) => v.clone().project(this.persp));
      const ys = q.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
      if (Math.max(...q.map((p) => Math.abs(p.x))) > xMax || hi - lo > yMax - yMin) {
        dist *= 1.05; // ใหญ่เกินจอ → ถอยกล้อง
      } else {
        // พอดีแล้ว: เลื่อนเป้ากล้องตามแนว z ให้ช่วงที่ต้องเห็นอยู่กลางช่อง [yMin, yMax]
        const dy = (lo + hi) / 2 - (yMin + yMax) / 2;
        if (Math.abs(dy) < 0.02) break;
        this.controls.target.z -= dy * dist * t * 0.9;
      }
      this.persp.position.copy(this.controls.target).addScaledVector(dir, dist);
    }
    this.controls.maxDistance = Math.max(700, dist * 2);
    this.controls.update();
    // top (orthographic)
    // เว้นขอบที่แถบเครื่องมือลอยทับเหมือนมุมมองเอียง: ใช้เฉพาะแถบ [yMin, yMax] × [−xMax, xMax] ของจอ แล้ววางกลางแถบนั้น
    const halfH = 22, halfW = halfH * aspect;
    this.ortho.zoom = Math.min((2 * halfW * xMax) / bw, (2 * halfH * ((yMax - yMin) / 2)) / bh);
    const oz = cz + (((yMax + yMin) / 2) * halfH) / this.ortho.zoom; // จอด้านบน = −z
    this.ortho.position.set(cx, 400, oz + 0.001);
    this.ortho.updateProjectionMatrix();
    this.orthoControls.target.set(cx, 0, oz);
    this.orthoControls.update();
    this.requestRender();
  }

  /* ---------------- เบรดบอร์ด ---------------- */

  private ensureBoards(doc: CircuitDoc) {
    for (const b of doc.breadboards) {
      const existing = this.boardObjs.get(b.id);
      if (existing && existing.userData.model === b.model) { existing.position.set(b.x, 0, b.z); continue; }
      if (existing) {
        // เปลี่ยนรุ่นบอร์ด: สร้างใหม่ทั้งแผ่น
        this.scene.remove(existing);
        this.boardMeshes = this.boardMeshes.filter((m) => m !== existing);
        existing.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      }
      const spec = boardSpec(b.model), S = spec.size;
      const g = new THREE.Group();
      g.userData.model = b.model;
      // ตัวบอร์ดพลาสติกขอบมน (ผิวด้านบนเป็น texture แยก บางกว่าเล็กน้อยให้เห็นขอบโค้ง) · ความหนาตามรุ่น
      const T = spec.mm.t / 2.54;
      const body = new THREE.Mesh(new RoundedBoxGeometry(S.w, T, S.h, 3, 0.22), new THREE.MeshStandardMaterial({ color: 0xeeefe8, roughness: 0.78 }));
      body.position.y = -T / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      const tex = boardTexture(b.model);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(S.w - 0.3, S.h - 0.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      // texture ครอบคลุมทั้งบอร์ด → ตัดขอบ 0.15 หน่วยออกให้ตรงตำแหน่งรู
      tex.repeat.set((S.w - 0.3) / S.w, (S.h - 0.3) / S.h);
      tex.offset.set(0.15 / S.w, 0.15 / S.h);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.002;
      top.receiveShadow = true;
      g.add(body, top);
      g.position.set(b.x, 0, b.z);
      g.traverse((o) => { o.userData.boardId = b.id; });
      this.scene.add(g);
      this.boardMeshes.push(g);
      this.boardObjs.set(b.id, g);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }
  }

  /* ---------------- อัปเดตจาก doc ---------------- */

  setDoc(doc: CircuitDoc) {
    this.doc = doc;
    this.ensureBoards(doc);
    const seen = new Set<string>();
    const boardSig = JSON.stringify(doc.breadboards);
    for (const p of doc.parts) {
      seen.add(p.id);
      const sig = JSON.stringify([p.placement, p.params, p.label, p.placement.kind === 'board' ? boardSig : '']);
      if (this.partSignature.get(p.id) === sig) continue;
      this.removePart(p.id);
      const g = buildPartModel(p);
      this.placeModel(g, p, doc);
      this.addPinTargets(g, p);
      this.partsRoot.add(g);
      const label = g.userData.labelSprite as THREE.Sprite;
      this.partsRoot.add(label);
      g.userData.labelRef = label;
      this.positionLabel(label, p, doc, g);
      this.partObjs.set(p.id, g);
      this.partSignature.set(p.id, sig);
    }
    for (const id of [...this.partObjs.keys()]) if (!seen.has(id)) this.removePart(id);

    const seenW = new Set<string>();
    for (const w of doc.wires) {
      seenW.add(w.id);
      const sig = JSON.stringify([w, this.endpointSig(w.a, doc), this.endpointSig(w.b, doc), boardSig]);
      if (this.wireSignature.get(w.id) === sig) continue;
      this.removeWire(w.id);
      const obj = this.buildWire(w, doc);
      if (obj) { this.wiresRoot.add(obj); this.wireObjs.set(w.id, obj); this.wireSignature.set(w.id, sig); }
    }
    for (const id of [...this.wireObjs.keys()]) if (!seenW.has(id)) this.removeWire(id);

    this.updateProbes(doc);
    if (this.pinOverlay || this.selectedId) this.updatePinOverlay(this.selectedId);
    this.requestRender();
  }

  private endpointSig(t: TerminalRef, doc: CircuitDoc) {
    if (t.kind === 'hole') return '';
    return JSON.stringify(doc.parts.find((p) => p.id === t.partId)?.placement ?? null);
  }

  private removePart(id: string) {
    const g = this.partObjs.get(id);
    if (!g) return;
    this.partsRoot.remove(g);
    if (g.userData.labelRef) this.partsRoot.remove(g.userData.labelRef);
    disposeTree(g);
    this.partObjs.delete(id);
    this.partSignature.delete(id);
  }

  private removeWire(id: string) {
    const o = this.wireObjs.get(id);
    if (!o) return;
    this.wiresRoot.remove(o);
    disposeTree(o);
    this.wireObjs.delete(id);
    this.wireSignature.delete(id);
  }

  private boardOf(doc: CircuitDoc, id: string): Breadboard {
    return doc.breadboards.find((b) => b.id === id) ?? doc.breadboards[0];
  }

  /**
   * พื้นที่แตะขา (มองไม่เห็น ใหญ่กว่าขาจริง) สำหรับอุปกรณ์ชนิดเสียบบอร์ดที่วางบนโต๊ะ — แตะ/คลิกขาเพื่อต่อสายหรือดูชื่อขาได้
   * พิกัด local: ขา (dx, dy) ของกริดอยู่ที่ (dx, ·, dy) ก่อนหมุน
   */
  private addPinTargets(g: THREE.Group, p: Part) {
    if (p.placement.kind !== 'table' || !isBoardKind(p)) return;
    const r = p.kind === 'pico' ? 0.48 : 0.5;
    const geo = new THREE.SphereGeometry(r, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const lift = g.userData.tableLift as number;
    for (const d of pinDefs(p)) {
      const s = new THREE.Mesh(geo, mat);
      s.position.set(d.dx, this.pinLocalY(p, true) - (TABLE_Y + lift), d.dy);
      s.userData = { partId: p.id, pin: d.name, isPin: true, noPick: true };
      g.add(s);
    }
  }

  /** ระดับ y (โลก) ของจุดต่อสายเมื่อต่อเข้าขาอุปกรณ์ชนิดเสียบบอร์ดโดยตรง */
  private pinLocalY(p: Part, onTable: boolean): number {
    if (p.kind === 'pico') return (onTable ? TABLE_Y + 3 * MM : 0) + PICO_PIN_TOP_MM * MM;
    return onTable ? TABLE_Y + 0.3 : 0.3;
  }

  /** ระยะยกโมเดลขึ้นจากผิวโต๊ะ ให้ปลายขาแตะโต๊ะพอดี (โมเดลสร้างไว้สำหรับเสียบบอร์ด ปลายขาอยู่ใต้ y = 0) */
  private tableLift(g: THREE.Object3D, p: Part): number {
    if (p.kind === 'pico') return 3 * MM;
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const box = new THREE.Box3();
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noPick) { const b = new THREE.Box3().setFromObject(o).applyMatrix4(inv); box.union(b); } });
    return box.isEmpty() ? 0 : Math.max(0, -box.min.y);
  }

  placeModel(g: THREE.Object3D, p: Part, doc: CircuitDoc) {
    if (p.placement.kind === 'table' && isBoardKind(p)) {
      // อุปกรณ์ชนิดเสียบบอร์ดวางบนโต๊ะ: จุดอ้างอิง = ขาที่ 1 อยู่ที่ (x, z); ยกขึ้นให้ปลายขาวางบนโต๊ะ
      g.rotation.set(0, 0, 0);
      g.position.set(0, 0, 0);
      const lift = (g.userData.tableLift as number | undefined) ?? this.tableLift(g, p);
      g.userData.tableLift = lift;
      g.position.set(p.placement.x, TABLE_Y + lift, p.placement.z);
      g.rotation.y = -(p.placement.rotation * Math.PI) / 180;
      g.traverse((o) => { if (o.userData.contactShadow) o.position.y = -lift + 0.02; });
      return;
    }
    if (p.placement.kind === 'board') {
      const board = this.boardOf(doc, p.placement.boardId);
      const a = holeInfo(p.placement.anchor);
      const w = a ? holeWorld(board, p.placement.anchor)! : { x: 0, z: 0 };
      g.position.set(w.x, 0, w.z);
      // rotation: grid +y คือ world +z; หมุนตาม rotateOffset (x→z) = หมุนรอบแกน y ทิศลบ
      g.rotation.y = -(p.placement.rotation * Math.PI) / 180;
    } else {
      g.position.set(p.placement.x, TABLE_Y, p.placement.z);
      g.rotation.y = -(p.placement.rotation * Math.PI) / 180;
    }
  }

  private positionLabel(label: THREE.Sprite, p: Part, doc: CircuitDoc, g?: THREE.Object3D) {
    // โมเดลที่บอกความสูงตัวถัง (topY) และระยะไปด้านหลัง (back): ป้ายชื่ออยู่เหนือ-หลังตัวอุปกรณ์ ไม่บังตัวถัง/ตัวหนังสือบนตัว
    const topY = g?.userData.topY as number | undefined;
    if (topY !== undefined && isBoardKind(p)) {
      const onTable = p.placement.kind === 'table';
      const pts = onTable ? pinDefs(p).map((d) => tablePinXZ(p, d.name)!) : pinHolesFor(p).map((ph) => (ph.hole ? holeWorld(this.boardOf(doc, ph.boardId), ph.hole) : null)).filter(Boolean) as Array<{ x: number; z: number }>;
      const cx = pts.reduce((s, h) => s + h.x, 0) / Math.max(1, pts.length), cz = pts.reduce((s, h) => s + h.z, 0) / Math.max(1, pts.length);
      const base = onTable ? TABLE_Y + ((g!.userData.tableLift as number | undefined) ?? 0) : 0;
      label.position.set(cx, base + topY + 0.75, cz - ((g!.userData.back as number) ?? 1));
      return;
    }
    if (p.placement.kind === 'table' && isBoardKind(p)) {
      const pts = pinDefs(p).map((d) => tablePinXZ(p, d.name)!);
      const cx = pts.reduce((s, h) => s + h.x, 0) / pts.length, cz = pts.reduce((s, h) => s + h.z, 0) / pts.length;
      // ไอซี: ป้ายชื่ออยู่เหนือและเยื้องไปด้านหลังตัวถัง (ไม่บังข้อความบนตัวถัง)
      if (p.kind === 'opamp' || p.kind === 'timer555' || p.kind === 'logic' || p.kind === 'counter' || p.kind === 'hbridge' || p.kind === 'shiftreg' || p.kind === 'opto') { label.position.set(cx, TABLE_Y + 1.3 + 3.2, cz - 2.6); return; }
      label.position.set(cx, TABLE_Y + (p.kind === 'led' ? 3.6 : p.kind === 'pico' ? 3.2 : 2.6), cz - 0.6);
      return;
    }
    if (p.placement.kind === 'board') {
      const holes = pinHolesFor(p).map((ph) => (ph.hole ? holeWorld(this.boardOf(doc, ph.boardId), ph.hole) : null)).filter(Boolean) as Array<{ x: number; z: number }>;
      const cx = holes.reduce((s, h) => s + h.x, 0) / Math.max(1, holes.length);
      const cz = holes.reduce((s, h) => s + h.z, 0) / Math.max(1, holes.length);
      if (p.kind === 'opamp' || p.kind === 'timer555' || p.kind === 'logic') label.position.set(cx, 3.0, cz - 2.6); // เหนือ-หลังตัวถัง ไม่บังข้อความ LM741
      else label.position.set(cx, p.kind === 'led' ? 3.4 : 2.2, cz - 0.6);
    } else if (isBenchKind(p.kind)) {
      // เครื่องมือขนาดจริง: ป้ายชื่อเหนือมุมซ้ายด้านหน้าของตัวเครื่อง
      const d = BENCH_DIMS[p.kind], fp = footprint(p)!;
      const row = BENCH_ROW_KINDS.includes(p.kind);
      label.position.set(fp.x0 + (row ? 10 : 6), TABLE_Y + d.h * MM + (row ? 3 : 4), row ? fp.z1 - d.front * MM - 3 : fp.z0 + 6);
    } else {
      if (p.kind === 'relay') label.position.set(p.placement.x - 3, TABLE_Y + 8.2, p.placement.z - 3.5);
      else if (p.kind === 'transformer') label.position.set(p.placement.x - 8, TABLE_Y + 21.5, p.placement.z - 3);
      else if (p.kind === 'speaker') label.position.set(p.placement.x - 8, TABLE_Y + 12, p.placement.z - 10);
      else if (p.kind === 'motor') label.position.set(p.placement.x - 6, TABLE_Y + 11, p.placement.z - 4);
      else if (p.kind === 'servo') label.position.set(p.placement.x - 4, TABLE_Y + 13, p.placement.z - 3.5);
      else if (p.kind === 'stepper') label.position.set(p.placement.x - 7, TABLE_Y + 14, p.placement.z - 10);
      else label.position.set(p.placement.x - (p.kind === 'ammeter' ? 4.6 : 5.6), TABLE_Y + (p.kind === 'ammeter' ? 3.2 : 5), p.placement.z - 2.6);
    }
  }

  /** พิกัดโลกของจุดต่อ (ปลายสาย/โพรบ) */
  terminalWorld(t: TerminalRef, doc = this.doc!): THREE.Vector3 | null {
    if (t.kind === 'hole') {
      const w = holeWorld(this.boardOf(doc, t.boardId), t.hole);
      return w ? new THREE.Vector3(w.x, 0.02, w.z) : null;
    }
    const p = doc.parts.find((x) => x.id === t.partId);
    if (!p) return null;
    if (p.placement.kind === 'board') {
      // สายที่ต่อขาไว้ตั้งแต่อุปกรณ์อยู่บนโต๊ะ แล้วย้ายลงบอร์ด: ปลายสายตามขาไป (เหนือรูที่ขาเสียบ)
      const ph = pinHolesFor(p).find((x) => x.pin === t.pin);
      const w = ph?.hole ? holeWorld(this.boardOf(doc, ph.boardId), ph.hole) : null;
      return w ? new THREE.Vector3(w.x, this.pinLocalY(p, false), w.z) : null;
    }
    if (isBoardKind(p)) {
      const xz = tablePinXZ(p, t.pin);
      return xz ? new THREE.Vector3(xz.x, this.pinLocalY(p, true), xz.z) : null;
    }
    const v = tablePinLocal(p, t.pin);
    v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(p.placement.rotation * Math.PI) / 180);
    return v.add(new THREE.Vector3(p.placement.x, TABLE_Y, p.placement.z));
  }

  /**
   * สาย jumper แบบ Dupont ตัวผู้–ตัวผู้: สายหุ้มฉนวน PVC Ø 1.3 mm, หัวพลาสติกดำ 2.5 × 2.5 mm สูง 8 mm พร้อมขาโลหะเสียบลงรู
   * ต่อเข้าขั้วเครื่องมือบนโต๊ะ (binding post) เป็นปลายเปลือย
   */
  private buildWire(w: Wire, doc: CircuitDoc): THREE.Object3D | null {
    const a = this.terminalWorld(w.a, doc), b = this.terminalWorld(w.b, doc);
    if (!a || !b) return null;
    const ea = this.endKind(w.a, doc), eb = this.endKind(w.b, doc);
    if (ea.kind !== 'hole' && ea.kind !== 'bare' || eb.kind !== 'hole' && eb.kind !== 'bare') return this.buildBenchWire(w, a, b, ea, eb);
    const J = jumperParts();
    const lift = (p: THREE.Vector3, hole: boolean) => (hole ? p.clone().add(new THREE.Vector3(0, J.houseH - 0.35, 0)) : p);
    const curve = wireCurve(lift(a, w.a.kind === 'hole'), lift(b, w.b.kind === 'hole'), w.arc, w.bend, w.a.kind === 'hole' || w.b.kind === 'hole');
    const color = new THREE.Color(w.color);
    const g = new THREE.Group();
    const insul = new THREE.MeshStandardMaterial({ color, roughness: 0.38 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 56, WIRE_R, 10, false), insul);
    tube.castShadow = true;
    g.add(tube);
    // พื้นที่แตะที่ใหญ่กว่าสายจริง (มองไม่เห็น)
    const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.55, 6, false), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(hit);
    for (const [p, isHole] of [[a, w.a.kind === 'hole'], [b, w.b.kind === 'hole']] as const) {
      if (isHole) {
        const house = new THREE.Mesh(J.house, J.plastic);
        house.position.copy(p);
        house.castShadow = true;
        const pin = new THREE.Mesh(J.pin, J.metal);
        pin.position.copy(p);
        const boot = new THREE.Mesh(J.boot, insul);
        boot.position.copy(p).add(new THREE.Vector3(0, J.houseH, 0));
        g.add(house, pin, boot);
      } else {
        const tip = new THREE.Mesh(J.bare, J.metal);
        tip.position.copy(p).add(new THREE.Vector3(0, 0.2, 0));
        g.add(tip);
      }
    }
    g.traverse((o) => { o.userData.wireId = w.id; });
    return g;
  }

  /** ชนิดปลายสาย: รูบอร์ด / ขั้วหน้าเครื่อง (ยื่นตามทิศ dir) / รูเสียบมิเตอร์ (สายโพรบ) / BNC / ขาอุปกรณ์อื่น */
  private endKind(t: TerminalRef, doc: CircuitDoc): WireEnd {
    if (t.kind === 'hole') return { kind: 'hole' };
    const p = doc.parts.find((x) => x.id === t.partId);
    if (!p || p.placement.kind !== 'table') return { kind: 'bare' };
    if (p.kind === 'dmm' || p.kind === 'vom' || p.kind === 'ammeter') {
      // สายโพรบห้อยออกทางขอบเครื่องด้านผู้ใช้ (ไม่พาดทับหน้าเครื่อง): จุดผ่าน 2 จุดเหนือขอบและบนพื้นโต๊ะถัดออกมา
      const j = tablePinLocal(p, t.pin), edge = (BENCH_DIMS[p.kind].d / 2) * MM;
      const rot = -(p.placement.rotation * Math.PI) / 180, Y = new THREE.Vector3(0, 1, 0), base = new THREE.Vector3(p.placement.x, TABLE_Y, p.placement.z);
      const via = [new THREE.Vector3(j.x, j.y + 7, edge + 1.5), new THREE.Vector3(j.x, 1.2 * MM + 0.05, edge + 7)].map((v) => v.applyAxisAngle(Y, rot).add(base));
      return { kind: 'jack', red: t.pin !== 'COM', via };
    }
    if (BENCH_ROW_KINDS.includes(p.kind)) {
      const dir = benchPinDir(p).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(p.placement.rotation * Math.PI) / 180);
      if (p.kind === 'scope' && (t.pin === 'CH1' || t.pin === 'CH2')) return { kind: 'bnc', dir, ring: t.pin === 'CH1' ? 0xe8c21f : 0x31b5d6 };
      return { kind: 'post', dir };
    }
    return { kind: 'bare' };
  }

  /**
   * สายที่ต่อกับเครื่องมือขนาดจริง:
   * - สายโพรบมิเตอร์ (ซิลิโคน Ø 3.6 mm แดง/ดำตามขั้ว): หัวบานาน่าที่รูเสียบมิเตอร์ ปลายอีกด้านเป็นปากกาโพรบจิ้มรูบอร์ด (หรือบานาน่าเสียบขั้วเครื่องอื่น)
   * - สายสัญญาณเข้าสโคป (สายโคแอกซ์ดำ หัว BNC มีแถบสีช่อง)
   * - สาย jumper ที่ต่อขั้วหน้าเครื่อง: ออกจากขั้วตามแนวขั้ว แล้วห้อยลงพาดโต๊ะไปยังบอร์ด
   */
  private buildBenchWire(w: Wire, a: THREE.Vector3, b: THREE.Vector3, ea: WireEnd, eb: WireEnd): THREE.Object3D {
    const lead = ea.kind === 'jack' || eb.kind === 'jack';
    const coax = !lead && (ea.kind === 'bnc' || eb.kind === 'bnc');
    const r = lead ? 1.8 * MM : coax ? 2.2 * MM : WIRE_R;
    const jack = ea.kind === 'jack' ? ea : eb.kind === 'jack' ? eb : null;
    const color = lead ? (jack!.red ? 0xc8372d : 0x1f2124) : coax ? 0x2b2e31 : new THREE.Color(w.color).getHex();
    const g = new THREE.Group();
    const insul = new THREE.MeshStandardMaterial({ color, roughness: lead ? 0.55 : 0.38 });
    const J = jumperParts();
    const up = new THREE.Vector3(0, 1, 0);
    const end = (p: THREE.Vector3, e: WireEnd, other: THREE.Vector3): { s: THREE.Vector3; d: THREE.Vector3 } => {
      if (e.kind === 'jack') { const o = bananaPlug(color, up); o.position.copy(p); g.add(o); return { s: p.clone().addScaledVector(up, BANANA_LEN * MM), d: up }; }
      if (e.kind === 'post' && lead) { const o = bananaPlug(color, e.dir); o.position.copy(p); g.add(o); return { s: p.clone().addScaledVector(e.dir, BANANA_LEN * MM), d: e.dir }; }
      if (e.kind === 'post') { const tip = new THREE.Mesh(J.bare, J.metal); tip.quaternion.setFromUnitVectors(up, e.dir); tip.position.copy(p).addScaledVector(e.dir, 0.15); g.add(tip); return { s: p.clone().addScaledVector(e.dir, 0.4), d: e.dir }; }
      if (e.kind === 'bnc') { const o = bncPlug(e.ring, e.dir); o.position.copy(p); g.add(o); return { s: p.clone().addScaledVector(e.dir, BNC_PLUG_LEN * MM), d: e.dir }; }
      if (e.kind === 'hole' && lead) {
        // ปากกาโพรบเอียง 60° จากพื้น หันไปทางมิเตอร์ ปลายเข็มอยู่ในรู
        const hz = new THREE.Vector3(other.x - p.x, 0, other.z - p.z);
        if (hz.lengthSq() < 1e-6) hz.set(0, 0, -1);
        hz.normalize();
        const axis = hz.multiplyScalar(0.5).addScaledVector(up, Math.sqrt(3) / 2).normalize();
        const o = probePen(color, axis);
        o.position.copy(p).add(new THREE.Vector3(0, -0.25, 0));
        g.add(o);
        return { s: o.position.clone().addScaledVector(axis, PEN_LEN * MM), d: axis };
      }
      if (e.kind === 'hole') {
        const house = new THREE.Mesh(J.house, J.plastic); house.position.copy(p); house.castShadow = true;
        const pin = new THREE.Mesh(J.pin, J.metal); pin.position.copy(p);
        const boot = new THREE.Mesh(J.boot, coax ? new THREE.MeshStandardMaterial({ color: (ea.kind === 'bnc' ? ea : eb as Extract<WireEnd, { kind: 'bnc' }>).ring, roughness: 0.45 }) : insul);
        boot.position.copy(p).add(new THREE.Vector3(0, J.houseH, 0));
        g.add(house, pin, boot);
        return { s: p.clone().add(new THREE.Vector3(0, J.houseH + 0.1, 0)), d: up };
      }
      const tip = new THREE.Mesh(J.bare, J.metal); tip.position.copy(p).add(new THREE.Vector3(0, 0.2, 0)); g.add(tip);
      return { s: p.clone().add(new THREE.Vector3(0, 0.4, 0)), d: up };
    };
    const A = end(a, ea, b), B = end(b, eb, a);
    const curve = leadCurve(A.s, A.d, B.s, B.d, w.arc, w.bend, r, this.doc?.breadboards ?? [], ea.kind === 'jack' ? ea.via : [], eb.kind === 'jack' ? eb.via : []);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, r, lead || coax ? 12 : 10, false), insul);
    tube.castShadow = true;
    g.add(tube);
    const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, Math.max(0.55, r * 1.4), 6, false), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(hit);
    g.traverse((o) => { o.userData.wireId = w.id; });
    return g;
  }

  private updateProbes(doc: CircuitDoc) {
    for (const k of ['red', 'black'] as const) {
      const t = doc.probes[k];
      const obj = this.probeObjs[k];
      const p = t ? this.terminalWorld(t, doc) : null;
      obj.visible = !!p;
      if (p) obj.position.copy(p).add(new THREE.Vector3(k === 'red' ? -0.15 : 0.15, 0, 0));
    }
  }

  /* ---------------- ผลการจำลอง → ภาพ ---------------- */

  /** เล่นความสว่าง LED ตามเวลาจำลอง (จำลองตามเวลาเท่านั้น; null = ใช้ค่าจากผลล่าสุดใน setAnalysis) */
  ledPlayback: LedPlayback | null = null;
  private ledShown = new Map<string, number>();

  private setLedGlow(g: THREE.Object3D, b: number) {
    const lens = g.userData.lens as THREE.MeshPhysicalMaterial;
    lens.emissiveIntensity = b * 2.2;
    const glow = g.userData.glowSprite as THREE.Sprite;
    (glow.material as THREE.SpriteMaterial).opacity = Math.min(1, b * 0.9);
    glow.scale.setScalar(2.2 + b * 2.5);
  }

  /** อัปเดต LED จากตัวเล่น — คืน true ถ้าภาพเปลี่ยน (ต้องวาดใหม่) */
  private stepLedPlayback(now: number): boolean {
    const pb = this.ledPlayback;
    if (!pb) return false;
    const b = pb.frame(now, ledBrightness);
    if (!b) return false;
    let changed = false;
    pb.ids.forEach((id, k) => {
      const g = this.partObjs.get(id);
      if (!g) return;
      const prev = this.ledShown.get(id);
      if (prev !== undefined && Math.abs(prev - b[k]) < 0.01) return;
      this.ledShown.set(id, b[k]);
      this.setLedGlow(g, b[k]);
      changed = true;
    });
    return changed;
  }

  setLedPlayback(pb: LedPlayback | null) {
    this.ledPlayback = pb;
    this.ledShown.clear();
  }

  setAnalysis(doc: CircuitDoc, a: Analysis | null, running: boolean) {
    for (const p of doc.parts) {
      const g = this.partObjs.get(p.id);
      if (!g) continue;
      const r = a?.ok ? a.parts[p.id] : undefined;
      if (p.kind === 'led' && !(running && this.ledPlayback)) this.setLedGlow(g, running && r ? Math.min(1.25, r.brightness ?? 0) : 0);
      if (p.kind === 'speaker') {
        // กรวยลำโพงยุบ/ยื่นตามระดับเสียง (ภาพนิ่ง: แสดงเป็นการยื่นเล็กน้อย)
        const cone = g.userData.speakerCone as THREE.Object3D | undefined;
        if (cone) cone.position.y = running ? (r?.extra?.level ?? 0) * 1.2 : 0;
      }
      if (p.kind === 'motor') {
        const disc = g.userData.motorDisc as THREE.Object3D | undefined;
        if (disc) disc.rotation.z = r?.extra?.angle ?? 0;
      }
      if (p.kind === 'servo') {
        const horn = g.userData.servoHorn as THREE.Object3D | undefined;
        if (horn) horn.rotation.y = servoHornRotation(r?.extra?.angle ?? 90);
      }
      if (p.kind === 'stepper') {
        const sh = g.userData.stepShaft as THREE.Object3D | undefined;
        if (sh) sh.rotation.y = -(((r?.extra?.angle ?? 0) * Math.PI) / 180);
        const leds = g.userData.stepLeds as THREE.MeshStandardMaterial[] | undefined;
        if (leds) leds.forEach((m, k) => { m.emissiveIntensity = running ? Math.min(1.25, ledBrightness(r?.extra?.[`iled${k + 1}`] ?? 0, 0.003)) * 2.4 : 0; });
      }
      if (p.kind === 'relay') {
        const m = g.userData.relayLed as THREE.MeshStandardMaterial | undefined;
        if (m) m.emissiveIntensity = running ? Math.min(1.25, ledBrightness(r?.extra?.iled ?? 0, 0.003)) * 2.4 : 0;
      }
      if (p.kind === 'sevenseg') {
        const mats = g.userData.segMats as Record<string, THREE.MeshStandardMaterial> | undefined;
        if (mats) for (const [s, m] of Object.entries(mats)) {
          const bv = running ? Math.min(1.25, r?.extra?.[`b_${s}`] ?? 0) : 0;
          m.emissiveIntensity = bv * 2.4;
          m.color.setHex(bv > 0.05 ? 0xff5040 : 0x8c8580);
        }
      }
      if (p.kind === 'buzzer') {
        const on = running && !!r?.extra?.sounding;
        g.traverse((o) => {
          if (!o.userData.soundWave) return;
          o.visible = on;
          // ขนาดวงคลื่นตามความดัง
          const lv = Math.max(0.35, Math.min(1, r?.extra?.level ?? 0));
          o.scale.setScalar(0.7 + 0.3 * lv);
        });
      }
      const lcd = g.userData.lcd as LcdScreen | undefined;
      if (lcd) {
        if (p.kind === 'dcsupply') {
          if (!running) lcd.draw([`${p.params.voltage.toFixed(2)} V`, `${(p.params.currentLimit).toFixed(3)} A`], 'ตั้งค่า (SET)');
          else if (!r) lcd.draw(['-- . --', '-- . --'], a?.ok === false ? 'ERR' : '');
          else lcd.draw([`${r.voltage.toFixed(2)} V`, `${Math.abs(r.current).toFixed(3)} A`], p.params.outputOn ? (r.mode ?? 'CV') : 'OFF');
        } else if (p.kind === 'fgen') {
          const [lines, badge] = fgenLcd(p);
          lcd.draw(lines, badge);
        }
      }
      const dl = g.userData.dmmLcd as DmmLcd | undefined;
      if (dl && p.kind === 'dmm') dl.show(dmmDisplay(p, r, running && a?.ok !== false));
      else if (dl && p.kind === 'ammeter') {
        if (!running || !r) dl.show({ text: running && a?.ok === false ? '----' : '0.00', unit: 'mA', ann: 'DC', ol: false });
        else dl.show({ text: r.overRated ? 'OL' : (r.current * 1000).toFixed(Math.abs(r.current) < 0.1 ? 2 : 1), unit: 'mA', ann: 'DC', ol: !!r.overRated });
      }
      if (p.kind === 'vom' && g.userData.vomNeedle) {
        g.userData.needleTarget = running && r?.extra ? vomNeedleAngle(r.extra.frac) : vomNeedleAngle(0);
        this.needleAnimating = true;
      }
    }
    if (running) this.requestSimRender(); else this.requestRender();
  }

  /** LED บนบอร์ด Pico (GP25) ตามสัดส่วนเวลาที่เป็น HIGH */
  setMcuLeds(list: Array<{ id: string; led: number }>) {
    for (const s of list) {
      const g = this.partObjs.get(s.id);
      const m = g?.userData.picoLed as THREE.MeshStandardMaterial | undefined;
      if (!m) continue;
      const b = Math.max(0, Math.min(1, s.led));
      m.emissiveIntensity = b * 2.5;
      ((g!.userData.picoGlow as THREE.Sprite).material as THREE.SpriteMaterial).opacity = b * 0.85;
    }
    this.requestSimRender();
  }

  /** วาดรูปคลื่นลงจอบนโมเดลออสซิลโลสโคป */
  updateScopeScreen(partId: string, frame: ScopeFrame | null, s: ScopeSettings) {
    const g = this.partObjs.get(partId);
    const screen = g?.userData.scopeScreen as ScopeScreen | undefined;
    if (!screen) return;
    drawScope(screen.canvas, frame, s, { message: 'NO SIGNAL' });
    screen.texture.needsUpdate = true;
    this.requestSimRender();
  }

  /* ---------------- overlay ---------------- */

  setHighlightHoles(doc: CircuitDoc, keys: string[]) {
    let i = 0;
    const m = new THREE.Matrix4();
    for (const k of keys) {
      const [boardId, hole] = k.split('/');
      if (!hole) continue;
      const w = holeWorld(this.boardOf(doc, boardId), hole);
      if (!w || i >= 420) continue;
      m.makeTranslation(w.x, 0.05, w.z);
      this.highlightMesh.setMatrixAt(i++, m);
    }
    this.highlightMesh.count = i;
    this.highlightMesh.instanceMatrix.needsUpdate = true;
    this.requestRender();
  }

  setPendingMarker(p: THREE.Vector3 | null) {
    this.pendingMarker.visible = !!p;
    if (p) this.pendingMarker.position.copy(p).add(new THREE.Vector3(0, 0.25, 0));
    this.requestRender();
  }

  setHoverMarker(p: THREE.Vector3 | null, ok = true) {
    this.hoverMarker.visible = !!p;
    if (p) {
      this.hoverMarker.position.copy(p).add(new THREE.Vector3(0, 0.08, 0));
      (this.hoverMarker.material as THREE.MeshBasicMaterial).color.set(ok ? 0xffffff : 0xff6b5b);
    }
    this.requestRender();
  }

  private selectedId: string | null = null;
  setSelection(id: string | null) {
    this.selectedId = id;
    const obj = id ? this.partObjs.get(id) ?? this.wireObjs.get(id) ?? this.boardObjs.get(id) : null;
    this.updatePinOverlay(id);
    if (obj) {
      const box = new THREE.Box3();
      obj.updateMatrixWorld(true);
      obj.traverse((o) => { if (((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) && !o.userData.noPick && !o.userData.glow) box.expandByObject(o, false); });
      box.expandByScalar(0.2);
      this.selectionBox.box.copy(box);
      this.selectionBox.visible = true;
    } else this.selectionBox.visible = false;
    this.requestRender();
  }

  /** ป้ายชื่อขาข้างบอร์ด Pico (แสดงเมื่อเลือกบอร์ด) */
  private pinOverlay: { id: string; sig: string; obj: THREE.Object3D } | null = null;
  private updatePinOverlay(id: string | null) {
    const part = id && this.doc ? this.doc.parts.find((p) => p.id === id) : undefined;
    const g = id ? this.partObjs.get(id) : undefined;
    if (!part || part.kind !== 'pico' || !g) {
      if (this.pinOverlay) { this.overlayRoot.remove(this.pinOverlay.obj); disposeTree(this.pinOverlay.obj); this.pinOverlay = null; }
      return;
    }
    const sig = JSON.stringify(part.placement);
    if (this.pinOverlay?.id === id && this.pinOverlay.sig === sig) return;
    if (this.pinOverlay) { this.overlayRoot.remove(this.pinOverlay.obj); disposeTree(this.pinOverlay.obj); }
    const o = buildPinLabelOverlay(PICO_PINOUT);
    o.position.copy(g.position);
    o.rotation.copy(g.rotation);
    this.overlayRoot.add(o);
    this.pinOverlay = { id: part.id, sig, obj: o };
  }

  /** เงาอุปกรณ์ขณะวาง/ย้าย (เขียว = วางได้, แดง = วางไม่ได้) */
  setGhost(part: Part | null, ok: boolean, doc: CircuitDoc) {
    for (const c of [...this.ghostRoot.children]) { if (c === this.boardGhost) continue; this.ghostRoot.remove(c); disposeTree(c, true); }
    if (part) {
      const g = buildPartModel(part);
      // เขียว = เสียบลงบอร์ด, เหลือง = วางบนโต๊ะ (ขายังไม่ต่อ), แดง = วางไม่ได้
      const onTable = part.placement.kind === 'table' && isBoardKind(part);
      const material = new THREE.MeshBasicMaterial({ color: !ok ? 0xff5a4a : onTable ? 0xf2c94c : 0x5be38a, transparent: true, opacity: 0.55, depthWrite: false });
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && o.userData.noPick) o.visible = false;
        else if (mesh.isMesh && (mesh.material as THREE.Material).visible !== false) mesh.material = material;
        if ((o as THREE.Sprite).isSprite) o.visible = false;
      });
      this.placeModel(g, part, doc);
      this.ghostRoot.add(g);
      if (part.placement.kind === 'table' && isBoardKind(part)) {
        // จุดตำแหน่งขาบนพื้นโต๊ะ (ยังไม่ต่อกับอะไร)
        for (const d of pinDefs(part)) {
          const xz = tablePinXZ(part, d.name)!;
          const dot = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.38, 16).rotateX(-Math.PI / 2), material);
          dot.position.set(xz.x, TABLE_Y + 0.03, xz.z);
          this.ghostRoot.add(dot);
        }
      }
      if (part.placement.kind === 'board') {
        for (const ph of pinHolesFor(part)) {
          if (!ph.hole) continue;
          const w = holeWorld(this.boardOf(doc, ph.boardId), ph.hole)!;
          const dot = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), material);
          dot.position.set(w.x, 0.06, w.z);
          this.ghostRoot.add(dot);
        }
      }
    }
    this.requestRender();
  }

  /** สายที่ต่อกับขาของอุปกรณ์ที่กำลังลาก: วาดตามตำแหน่งใหม่ทันที (ซ่อนสายจริงไว้จนปล่อย) */
  private dragWires = new THREE.Group();
  private hiddenWires: string[] = [];
  setDragWires(tempDoc: CircuitDoc | null, partId: string | null) {
    for (const c of [...this.dragWires.children]) { this.dragWires.remove(c); disposeTree(c); }
    for (const id of this.hiddenWires) { const o = this.wireObjs.get(id); if (o) o.visible = true; }
    this.hiddenWires = [];
    if (!this.dragWires.parent) this.scene.add(this.dragWires);
    if (tempDoc && partId) {
      for (const w of tempDoc.wires) {
        if (!((w.a.kind === 'pin' && w.a.partId === partId) || (w.b.kind === 'pin' && w.b.partId === partId))) continue;
        const a = this.terminalWorld(w.a, tempDoc), b = this.terminalWorld(w.b, tempDoc);
        const real = this.wireObjs.get(w.id);
        if (real) { real.visible = false; this.hiddenWires.push(w.id); }
        if (!a || !b) continue;
        const J = jumperParts();
        const lift = (p: THREE.Vector3, hole: boolean) => (hole ? p.clone().add(new THREE.Vector3(0, J.houseH - 0.35, 0)) : p);
        const curve = wireCurve(lift(a, w.a.kind === 'hole'), lift(b, w.b.kind === 'hole'), w.arc, w.bend, w.a.kind === 'hole' || w.b.kind === 'hole');
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, WIRE_R, 8, false), new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.4, transparent: true, opacity: 0.85 }));
        m.raycast = () => {};
        this.dragWires.add(m);
      }
    }
    this.requestRender();
  }

  /** กรอบเงาเบรดบอร์ดขณะลากย้ายทั้งแผ่น */
  private boardGhost: THREE.Mesh | null = null;
  setBoardGhost(pos: { x: number; z: number } | null, ok: boolean, model: BoardModel = 'CL-400') {
    if (!pos) { if (this.boardGhost) this.boardGhost.visible = false; this.requestRender(); return; }
    if (this.boardGhost && this.boardGhost.userData.model !== model) { this.ghostRoot.remove(this.boardGhost); this.boardGhost.geometry.dispose(); this.boardGhost = null; }
    if (!this.boardGhost) {
      const S = boardSpec(model).size;
      this.boardGhost = new THREE.Mesh(new THREE.BoxGeometry(S.w, 2.4, S.h), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
      this.boardGhost.userData.model = model;
      this.boardGhost.raycast = () => {};
      this.ghostRoot.add(this.boardGhost);
    }
    this.boardGhost.visible = true;
    (this.boardGhost.material as THREE.MeshBasicMaterial).color.set(ok ? 0x5be38a : 0xff5a4a);
    this.boardGhost.position.set(pos.x, -1.15, pos.z);
    this.requestRender();
  }

  /** ซ่อน/แสดงโมเดลจริงระหว่างลากย้าย */
  setPartVisible(id: string, visible: boolean) {
    const g = this.partObjs.get(id);
    if (g) { g.visible = visible; if (g.userData.labelRef) g.userData.labelRef.visible = visible; }
    this.requestRender();
  }

  /* ---------------- picking ---------------- */

  private ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** พิกัดหน้าจอ (client px) ของจุดในโลก */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (!Number.isFinite(v.x)) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** จุดบนระนาบ y = h ใต้ตัวชี้ */
  planePoint(clientX: number, clientY: number, h: number): THREE.Vector3 | null {
    this.camera.updateMatrixWorld(); // กล้องอาจเพิ่งเปลี่ยนโดยยังไม่ได้วาด (เฟรมช้า) — ใช้ตำแหน่งล่าสุดเสมอ
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), hit) ? hit : null;
  }

  /** รูที่ใกล้ตัวชี้ที่สุดบนผิวบอร์ด */
  holeUnder(clientX: number, clientY: number, maxDist = 0.75): { boardId: string; hole: string; point: THREE.Vector3 } | null {
    if (!this.doc) return null;
    const p = this.planePoint(clientX, clientY, 0);
    if (!p) return null;
    for (const b of this.doc.breadboards) {
      const { gx, gy } = worldToGrid(b, p.x, p.z);
      let best: { hole: string; d: number } | null = null;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const h = holeAt(gx + dx, gy + dy, b.model);
        if (!h) continue;
        const w = holeWorld(b, h)!;
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d <= maxDist && (!best || d < best.d)) best = { hole: h, d };
      }
      if (best) {
        const w = holeWorld(b, best.hole)!;
        return { boardId: b.id, hole: best.hole, point: new THREE.Vector3(w.x, 0.02, w.z) };
      }
    }
    return null;
  }

  pick(clientX: number, clientY: number): Pick | null {
    this.camera.updateMatrixWorld(); // กล้องอาจเพิ่งเปลี่ยนโดยยังไม่ได้วาด (เฟรมช้า) — ใช้ตำแหน่งล่าสุดเสมอ
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects([this.partsRoot, this.wiresRoot], true)
      .filter((h) => !h.object.userData.isLabel && !(h.object as THREE.Sprite).isSprite);
    // ขั้วมีลำดับความสำคัญเหนือสาย (สายที่ต่ออยู่มักบังขั้วเมื่อจะต่อสายเส้นที่สอง)
    if (hits[0]?.object.userData.wireId) {
      const pinHit = hits.find((h) => h.object.userData.isPin);
      if (pinHit) return { type: 'pin', partId: pinHit.object.userData.partId, pin: pinHit.object.userData.pin, point: pinHit.point };
    }
    for (const h of hits) {
      const u = h.object.userData;
      if (u.isLabel || (h.object as THREE.Sprite).isSprite) continue;
      if (u.noPick && !u.isPin) continue; // ส่วนประกอบภาพ (กรวยแสง วงคลื่นเสียง) ไม่บังการคลิก
      if (u.isPin) return { type: 'pin', partId: u.partId, pin: u.pin, point: h.point };
      if (u.wireId) return { type: 'wire', wireId: u.wireId, point: h.point };
      if (u.partId) return { type: 'part', partId: u.partId, point: h.point, plunger: !!u.pushPlunger };
    }
    const hole = this.holeUnder(clientX, clientY);
    if (hole) return { type: 'hole', ...hole };
    const boardHit = this.raycaster.intersectObjects(this.boardMeshes, true)[0];
    if (boardHit) return { type: 'board', boardId: boardHit.object.userData.boardId, point: boardHit.point };
    const t = this.planePoint(clientX, clientY, TABLE_Y);
    return t ? { type: 'table', point: t } : null;
  }

  /** ทุกสิ่งใต้ตัวชี้ เรียงจากใกล้กล้อง (ไม่ซ้ำ) — ใช้ "แตะซ้ำที่เดิมเพื่อเลือกสิ่งที่อยู่ข้างใต้" */
  pickAll(clientX: number, clientY: number): Pick[] {
    this.camera.updateMatrixWorld(); // กล้องอาจเพิ่งเปลี่ยนโดยยังไม่ได้วาด (เฟรมช้า) — ใช้ตำแหน่งล่าสุดเสมอ
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const out: Pick[] = [];
    const seen = new Set<string>();
    for (const h of this.raycaster.intersectObjects([this.partsRoot, this.wiresRoot], true)) {
      const u = h.object.userData;
      if (u.isLabel || (h.object as THREE.Sprite).isSprite) continue;
      const p: Pick | null = u.isPin ? { type: 'pin', partId: u.partId, pin: u.pin, point: h.point }
        : u.wireId ? { type: 'wire', wireId: u.wireId, point: h.point }
          : u.partId ? { type: 'part', partId: u.partId, point: h.point } : null;
      if (!p) continue;
      const k = p.type === 'pin' ? `${p.partId}:${p.pin}` : p.type === 'wire' ? p.wireId : p.type === 'part' ? p.partId : '';
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    const hole = this.holeUnder(clientX, clientY);
    if (hole) out.push({ type: 'hole', ...hole });
    else {
      const boardHit = this.raycaster.intersectObjects(this.boardMeshes, true)[0];
      if (boardHit) out.push({ type: 'board', boardId: boardHit.object.userData.boardId, point: boardHit.point });
    }
    return out;
  }

  /** ขาของอุปกรณ์บนบอร์ดที่ใกล้จุดที่แตะที่สุด */
  nearestBoardPin(part: Part, point: THREE.Vector3): { pin: string; hole: string; boardId: string } | null {
    if (!this.doc || part.placement.kind !== 'board') return null;
    let best: { pin: string; hole: string; boardId: string; d: number } | null = null;
    for (const ph of pinHolesFor(part)) {
      if (!ph.hole) continue;
      const w = holeWorld(this.boardOf(this.doc, ph.boardId), ph.hole)!;
      const d = Math.hypot(w.x - point.x, w.z - point.z);
      if (!best || d < best.d) best = { pin: ph.pin, hole: ph.hole, boardId: ph.boardId, d };
    }
    return best;
  }
}

/* ---------------- helpers ---------------- */

/** รัศมีฉนวนสาย jumper (Ø 1.3 mm) */
const WIRE_R = 0.65 / 2.54;
let jumperCache: { house: THREE.BufferGeometry; pin: THREE.BufferGeometry; boot: THREE.BufferGeometry; bare: THREE.BufferGeometry; plastic: THREE.Material; metal: THREE.Material; houseH: number } | null = null;
/** ชิ้นส่วนหัว Dupont (ใช้ร่วมกันทุกสาย) */
function jumperParts() {
  if (jumperCache) return jumperCache;
  const mm = 1 / 2.54;
  const houseH = 8 * mm;
  // หัวพลาสติกเรียวขึ้นเล็กน้อย (สี่เหลี่ยมจัตุรัส 4 เหลี่ยมหมุน 45°)
  const house = new THREE.CylinderGeometry(1.15 * mm * Math.SQRT2 * 0.92, 1.27 * mm * Math.SQRT2, houseH, 4, 1).rotateY(Math.PI / 4);
  house.translate(0, houseH / 2 + 0.02, 0);
  const pin = new THREE.BoxGeometry(0.64 * mm, 2.6 * mm, 0.64 * mm);
  pin.translate(0, -0.8 * mm, 0);
  const boot = new THREE.CylinderGeometry(0.75 * mm, 0.9 * mm, 1.2 * mm, 12);
  boot.translate(0, 0.4 * mm, 0);
  const bare = new THREE.CylinderGeometry(0.3 * mm, 0.3 * mm, 0.5, 8);
  for (const g of [house, pin, boot, bare]) g.userData.shared = true;
  jumperCache = {
    house, pin, boot, bare, houseH,
    plastic: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.55 }),
    metal: withEnv(new THREE.MeshStandardMaterial({ color: 0xd8c38a, roughness: 0.3, metalness: 1 })),
  };
  return jumperCache;
}

export function wireCurve(a: THREE.Vector3, b: THREE.Vector3, arc: number, bend: number, raised = false): THREE.CatmullRomCurve3 {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.hypot(dir.x, dir.z);
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  // ปลายที่ยกขึ้นด้วยหัว Dupont แล้ว ไม่ต้องโค้งสูงมาก (สายจริงห้อยลงตามน้ำหนัก)
  const k = raised ? 0.45 : 1;
  const lift = (0.5 + Math.min(arc, 0.4 + len * 0.25) * (arc > 0 ? 1 : 0)) * k;
  const top = Math.max(a.y, b.y) + lift;
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).add(perp.clone().multiplyScalar(bend));
  mid.y = top + (arc > 0 ? arc * 0.25 * k : 0);
  const rise = raised ? 0.35 : 0.9;
  const a1 = a.clone().add(new THREE.Vector3(0, rise, 0));
  const b1 = b.clone().add(new THREE.Vector3(0, rise, 0));
  const q1 = new THREE.Vector3().lerpVectors(a1, mid, 0.5); q1.y = (a1.y + mid.y) / 2 + lift * 0.3;
  const q2 = new THREE.Vector3().lerpVectors(mid, b1, 0.5); q2.y = (b1.y + mid.y) / 2 + lift * 0.3;
  return new THREE.CatmullRomCurve3([a.clone().add(new THREE.Vector3(0, 0.3, 0)), a1, q1, mid, q2, b1, b.clone().add(new THREE.Vector3(0, 0.3, 0))], false, 'centripetal');
}

type WireEnd = { kind: 'hole' } | { kind: 'bare' } | { kind: 'post'; dir: THREE.Vector3 } | { kind: 'jack'; red: boolean; via: THREE.Vector3[] } | { kind: 'bnc'; dir: THREE.Vector3; ring: number };

/** ความยาวหัวบานาน่า (เหนือปากรู), ปากกาโพรบ (ปลายเข็มถึงท้ายปลอกสาย), หัว BNC — mm */
const BANANA_LEN = 46;
const PEN_LEN = 104;
const BNC_PLUG_LEN = 30;

const leadMats = new Map<number, THREE.Material>();
const leadMat = (c: number, metal = false) => {
  const k = metal ? -c - 1 : c;
  let m = leadMats.get(k);
  if (!m) { m = metal ? withEnv(new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 1 })) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }); leadMats.set(k, m); }
  return m;
};

/** หัวบานาน่าแบบมีปลอกกันนิ้ว (สร้างตามแกน +y แล้วหมุนไปตามทิศ dir) — ขาโลหะจมในรู */
function bananaPlug(color: number, dir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(MM);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 12), leadMat(0xc9ccd0, true)); pin.position.y = -2;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 6, 20), leadMat(color)); sleeve.position.y = 3;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.6, 26, 20), leadMat(color)); body.position.y = 6 + 13;
  const grip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 18, 0.8), leadMat(color), 10);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; m4.makeRotationY(a).setPosition(Math.sin(a) * 4.85, 19, Math.cos(a) * 4.85); grip.setMatrixAt(i, m4); }
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 4.4, BANANA_LEN - 32, 16), leadMat(color)); relief.position.y = 32 + (BANANA_LEN - 32) / 2;
  s.add(pin, sleeve, body, grip, relief);
  g.add(s);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return g;
}

/** ปากกาโพรบ: ปลายเข็มโลหะ → ฉนวนกันนิ้ว → ด้ามจับ → ปลอกสาย (แกน +y, ปลายเข็มที่จุดกำเนิด) */
function probePen(color: number, dir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(MM);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.35, 14, 10), leadMat(0xd5d8dc, true)); tip.position.y = 7;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 2, 8, 18), leadMat(color)); nose.position.y = 14 + 4;
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 3, 24), leadMat(color)); guard.position.y = 22 + 1.5;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.2, 58, 20), leadMat(color)); grip.position.y = 25 + 29;
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 4.2, PEN_LEN - 83, 16), leadMat(color)); relief.position.y = 83 + (PEN_LEN - 83) / 2;
  s.add(tip, nose, guard, grip, relief);
  g.add(s);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return g;
}

/** หัว BNC ตัวผู้ (ปลอกนิกเกิลหมุนล็อก + ปลอกยางดำ + แถบสีช่อง) */
function bncPlug(ring: number, dir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(MM);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 12, 22), leadMat(0xc9ccd0, true)); shell.position.y = 6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 3, 20), leadMat(ring)); band.position.y = 13.5;
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 5, BNC_PLUG_LEN - 15, 18), leadMat(0x1d1f22)); boot.position.y = 15 + (BNC_PLUG_LEN - 15) / 2;
  s.add(shell, band, boot);
  g.add(s);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return g;
}

/**
 * แนวสายยาวที่ต่อกับเครื่องมือ: ออกจากหัวต่อตามแนวหัวต่อ แล้วห้อยลงพาดพื้นโต๊ะ (หรือผิวบอร์ด) ก่อนขึ้นไปยังปลายอีกด้าน
 * arc = ยกช่วงกลางขึ้น, bend = เยื้องด้านข้าง (เหมือนสายทั่วไป)
 */
export function leadCurve(a: THREE.Vector3, da: THREE.Vector3, b: THREE.Vector3, db: THREE.Vector3, arc: number, bend: number, r: number, boards: Array<{ x: number; z: number }> = [], viaA: THREE.Vector3[] = [], viaB: THREE.Vector3[] = []): THREE.CatmullRomCurve3 {
  const dist0 = Math.hypot(b.x - a.x, b.z - a.z);
  const k = Math.min(viaA.length ? 2 : 5, 1.2 + dist0 * 0.05), kb = Math.min(viaB.length ? 2 : 5, 1.2 + dist0 * 0.05);
  const a1 = a.clone().addScaledVector(da, k), b1 = b.clone().addScaledVector(db, kb);
  const a2 = viaA.length ? viaA[viaA.length - 1] : a1, b2 = viaB.length ? viaB[viaB.length - 1] : b1;
  const dist = Math.hypot(b2.x - a2.x, b2.z - a2.z);
  const perp = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x);
  if (perp.lengthSq() > 1e-9) perp.normalize();
  const floorAt = (p: THREE.Vector3) => {
    const onBoard = boards.some((bd) => { const R = boardRect(bd as Breadboard); return p.x > R.x0 - 1 && p.x < R.x1 + 1 && p.z > R.z0 - 1 && p.z < R.z1 + 1; });
    return (onBoard ? 0 : TABLE_Y) + r + 0.05;
  };
  const pts = [a.clone(), a1, ...viaA.map((v) => v.clone())];
  if (dist > 18) {
    for (const t of [0.3, 0.7]) {
      const m = new THREE.Vector3().lerpVectors(a2, b2, t).addScaledVector(perp, bend);
      m.y = floorAt(m) + arc * 0.5;
      pts.push(m);
    }
  } else {
    const m = new THREE.Vector3().lerpVectors(a2, b2, 0.5).addScaledVector(perp, bend);
    m.y = Math.max(floorAt(m), Math.min(a2.y, b2.y) - dist * 0.15) + arc * 0.4;
    pts.push(m);
  }
  pts.push(...[...viaB].reverse().map((v) => v.clone()), b1, b.clone());
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

function probeModel(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.8, roughness: 0.3 }));
  tip.rotation.x = Math.PI;
  tip.position.y = 0.45;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 3.2, 14), m);
  body.position.y = 2.5;
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 14), m);
  guard.position.y = 1.2;
  g.add(tip, body, guard);
  g.rotation.z = 0.25;
  g.visible = false;
  return g;
}

function disposeTree(o: THREE.Object3D, keepShared = false) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    if (!keepShared && (c as THREE.Sprite).isSprite) {
      const sm = (c as THREE.Sprite).material as THREE.SpriteMaterial;
      if (sm.map && sm.map !== null && !c.userData.glow) sm.map.dispose();
      sm.dispose();
    }
  });
}

function matTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1f5f57';
  x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(214,236,226,0.10)';
  x.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke();
  }
  x.strokeStyle = 'rgba(214,236,226,0.05)';
  x.lineWidth = 1;
  for (let i = 0; i <= 512; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((2 * TABLE_BOUNDS.x + 40) / 16, (2 * TABLE_BOUNDS.z + 40) / 16);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** texture ผิวบอร์ด: รู, ร่องกลาง, เส้นรางไฟ, ตัวเลขคอลัมน์, ตัวอักษรแถว */
function boardTexture(model: BoardModel): THREE.Texture {
  const spec = boardSpec(model), COLS = spec.cols;
  const W = Math.round(spec.size.w * PX), H = Math.round(spec.size.h * PX);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  // วาดด้วย CPU (willReadFrequently): มีการอ่านพิกเซลกลับ (จุดรบกวน) และวาดรูเล็ก ๆ 400 รู — บนเครื่องที่ canvas ใช้ GPU ช้า/ซอฟต์แวร์
  // การวาดแบบ GPU ทีละรูช้ามาก (วัดได้ ~7 วินาทีบน SwiftShader) แบบ CPU ใช้เวลาเพียงเสี้ยววินาที
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#f4f4ee';
  x.fillRect(0, 0, W, H);
  // ผิวพลาสติก ABS: จุดรบกวนละเอียดมาก ๆ (ไม่ให้ดูเป็นสีเรียบแบน)
  const noise = x.getImageData(0, 0, W, H);
  for (let i = 0; i < noise.data.length; i += 4) { const n = (Math.random() - 0.5) * 6; noise.data[i] += n; noise.data[i + 1] += n; noise.data[i + 2] += n; }
  x.putImageData(noise, 0, 0);
  const toPx = (gx: number, gy: number) => [W / 2 + (gx - (COLS + 1) / 2) * PX, H / 2 + (gy - (GRID_ROWS - 1) / 2) * PX];
  // ร่องกลาง
  const [, gy0] = toPx(0, 8.5);
  // ร่องกลาง: เงาไล่ระดับให้เห็นเป็นร่องลึก
  const gg = x.createLinearGradient(0, gy0 - PX * 0.45, 0, gy0 + PX * 0.45);
  gg.addColorStop(0, '#b9bbb3'); gg.addColorStop(0.18, '#d3d5cd'); gg.addColorStop(0.82, '#dfe1d9'); gg.addColorStop(1, '#c9cbc3');
  x.fillStyle = gg;
  x.fillRect(0, gy0 - PX * 0.45, W, PX * 0.9);
  // ร่องตื้นแยกรางไฟออกจากพื้นที่หลัก
  for (const yy of [2.0, 15.0]) {
    const [, py] = toPx(0, yy);
    x.fillStyle = 'rgba(0,0,0,0.07)';
    x.fillRect(0, py - PX * 0.06, W, PX * 0.12);
  }
  // เส้นรางไฟ
  for (const r of RAILS) {
    const [, py] = toPx(0, r.y);
    const lineY = r.prefix === 'tp' ? py - PX * 0.62 : r.prefix === 'tn' ? py + PX * 0.62 : r.prefix === 'bn' ? py - PX * 0.62 : py + PX * 0.62;
    x.strokeStyle = r.polarity === '+' ? '#d03a2f' : '#2c5fb8';
    x.lineWidth = PX * 0.09;
    const [x0] = toPx(1.4, 0), [x1] = toPx(COLS + 0.6, 0);
    x.beginPath(); x.moveTo(x0, lineY); x.lineTo(x1, lineY); x.stroke();
    x.fillStyle = x.strokeStyle;
    x.font = `700 ${PX * 0.62}px "Chakra Petch", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const sym = r.polarity === '+' ? '+' : '−';
    x.fillText(sym, toPx(0.6, 0)[0], py);
    x.fillText(sym, toPx(COLS + 1.4, 0)[0], py);
  }
  // รู
  x.fillStyle = '#3b403d';
  // รูสี่เหลี่ยมขนาด ≈ 1 mm: ขอบลาดเอียง (bevel) สว่างด้านบน-ซ้าย มืดด้านล่าง-ขวา และก้นรูมีหน้าสัมผัสโลหะจาง ๆ
  for (const h of allHoles(model)) {
    const [px, py] = toPx(h.x, h.y);
    const s = PX * 0.36, b = PX * 0.07;
    x.fillStyle = '#d6d8d0';
    x.fillRect(px - s / 2 - b, py - s / 2 - b, s + 2 * b, s + 2 * b);
    x.fillStyle = '#ffffff';
    x.fillRect(px + s / 2, py - s / 2 - b, b, s + 2 * b);
    x.fillRect(px - s / 2 - b, py + s / 2, s + 2 * b, b);
    const gr = x.createLinearGradient(px - s / 2, py - s / 2, px + s / 2, py + s / 2);
    gr.addColorStop(0, '#1c1f1d'); gr.addColorStop(1, '#3a3f3b');
    x.fillStyle = gr;
    x.fillRect(px - s / 2, py - s / 2, s, s);
    x.fillStyle = 'rgba(190,180,140,0.35)';
    x.fillRect(px - s * 0.12, py - s * 0.32, s * 0.24, s * 0.64);
  }
  // ตัวเลขคอลัมน์
  x.fillStyle = '#4a5450';
  x.font = `600 ${PX * 0.4}px "Chakra Petch", sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (let col = 1; col <= COLS; col++) {
    if (col !== 1 && col % 5 !== 0) continue;
    x.fillText(String(col), toPx(col, 2)[0], toPx(col, 2)[1]);
    x.fillText(String(col), toPx(col, 15)[0], toPx(col, 15)[1]);
  }
  // ตัวอักษรแถว
  for (const r of ROW_LETTERS) {
    const info = holeInfo(`${r}1`)!;
    x.fillText(r, toPx(0.25, info.y)[0], toPx(0, info.y)[1]);
    x.fillText(r, toPx(COLS + 1.75, info.y)[0], toPx(0, info.y)[1]);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function rotatedPinOffsets(part: Part, rot: Rotation) {
  return pinDefs(part).map((p) => rotateOffset(p.dx, p.dy, rot));
}

export { labelSprite, formatSI };
