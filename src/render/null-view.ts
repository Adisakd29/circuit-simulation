import type { SceneView } from './scene';

/**
 * ตัวแสดงผลสำรองเมื่อสร้างพื้นที่ 3 มิติไม่ได้ (ไม่มี WebGL / สร้าง renderer ไม่สำเร็จ / context หาย)
 * ทุกคำสั่งวาดเป็น no-op และคำสั่งถามตำแหน่งคืน null — ส่วนอื่นของแอป (คลังอุปกรณ์ แลป ไฟล์ การจำลอง)
 * จึงทำงานต่อได้ตามปกติ แทนที่จะหยุดทั้งหน้าเพราะ exception ตอนสร้าง renderer
 */
export function createNullView(): SceneView {
  const canvas = document.createElement('canvas');
  const state: Record<string | symbol, unknown> = {
    isNull: true,
    quality: 'eco',
    autoQuality: false,
    view: 'perspective',
    activeControls: { enabled: false },
    controls: { enabled: false },
    orthoControls: { enabled: false },
    renderer: { domElement: canvas },
    onAutoEco: () => {},
    onContextLost: () => {},
    onContextRestored: () => {},
    ledPlayback: null,
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined; // ไม่ใช่ Promise
      return () => null;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  }) as unknown as SceneView;
}

export type View3dFailure = 'webgl-unsupported' | 'renderer-failed' | 'context-lost';

export interface WebglProbe {
  webgl2: boolean;
  webgl1: boolean;
  /** ใช้ได้เฉพาะแบบ software/ช้ามาก (failIfMajorPerformanceCaveat) */
  majorCaveat: boolean;
  renderer?: string;
  vendor?: string;
  error?: string;
}

/** ตรวจว่าเบราว์เซอร์สร้าง WebGL ได้หรือไม่ (แยกจากการสร้าง renderer จริงของ three.js) */
export function probeWebgl(): WebglProbe {
  const out: WebglProbe = { webgl2: false, webgl1: false, majorCaveat: false };
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    out.webgl2 = !!gl2;
    const gl = gl2 ?? document.createElement('canvas').getContext('webgl');
    out.webgl1 = !!gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      out.vendor = String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      const strict = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true });
      out.majorCaveat = !strict;
      strict?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
