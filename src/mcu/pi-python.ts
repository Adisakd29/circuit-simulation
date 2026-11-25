import { loadPyodide, version as PYODIDE_VERSION, type PyodideInterface } from 'pyodide';
import type { PiEmulator, PiFinish, PiHost } from './pi-emu';
import SIMRT_PY from './pi/simrt.py?raw';
import GPIOZERO_PY from './pi/gpiozero.py?raw';

/**
 * ตัวรัน Python ของบอร์ด Raspberry Pi: CPython (Pyodide, MPL-2.0) ใน WebAssembly — โหลดครั้งแรกเมื่อมีบอร์ด Pi ในวงจร (~12 MB)
 * ต้องใช้ JSPI (WebAssembly JavaScript Promise Integration) ให้ time.sleep() พัก Python ได้โดยไม่บล็อกการจำลอง
 */
export { PYODIDE_VERSION };
export const PY_DOWNLOAD_MB = 12;

let base = '';
/** ที่อยู่ไฟล์ Pyodide (pyodide.asm.mjs, .wasm, python_stdlib.zip, pyodide-lock.json) — ลงท้ายด้วย / */
export function setPyodideBase(url: string) { if (url) base = url.endsWith('/') ? url : `${url}/`; }
export function jspiSupported(): boolean {
  const W = (globalThis as unknown as { WebAssembly?: { Suspending?: unknown; promising?: unknown } }).WebAssembly;
  return !!W && typeof W.Suspending === 'function' && typeof W.promising === 'function';
}

class PyodideHost implements PiHost {
  state: PiHost['state'] = 'idle';
  error = '';
  busy: PiEmulator | null = null;
  private py: PyodideInterface | null = null;
  private dec = new TextDecoder();

  ensureLoaded() {
    if (this.state !== 'idle') return;
    if (!jspiSupported()) {
      this.state = 'failed';
      this.error = 'เบราว์เซอร์นี้ยังไม่รองรับ JSPI (WebAssembly JavaScript Promise Integration) ที่ใช้พัก Python ระหว่าง sleep() — ใช้ Chrome/Edge 137 ขึ้นไป, Firefox 153 ขึ้นไป หรือ Safari 27 ขึ้นไป';
      return;
    }
    if (!base) { this.state = 'failed'; this.error = 'ไม่ได้ตั้งที่อยู่ไฟล์ Python (Pyodide)'; return; }
    this.state = 'loading';
    this.load().then(() => { this.state = 'ready'; }, (e) => {
      this.state = 'failed';
      this.error = `โหลด Python (Pyodide ${PYODIDE_VERSION}) ไม่สำเร็จ: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    });
  }

  private async load() {
    const py = await loadPyodide({ indexURL: base, fullStdLib: false, checkAPIVersion: false } as Parameters<typeof loadPyodide>[0]);
    py.setStdout({ write: (buf: Uint8Array) => { this.busy?.out_(this.dec.decode(buf, { stream: true })); return buf.length; } });
    py.setStderr({ write: (buf: Uint8Array) => { this.busy?.out_(this.dec.decode(buf, { stream: true })); return buf.length; } });
    const self = this;
    const emu = () => { if (!self.busy) throw new Error('no board'); return self.busy; };
    py.registerJsModule('_pi', {
      now: () => emu().now(),
      setup: (pin: number, m: string) => emu().setup(pin, m),
      write: (pin: number, v: number) => emu().write(pin, v),
      read: (pin: number) => emu().read(pin),
      level: (pin: number) => emu().level(pin),
      duty: (pin: number) => emu().duty(pin),
      pattern: (pin: number, f: number, segs: string, n: number, end: number) => emu().pattern(pin, f, segs, n, end),
      watch: (pin: number, on: number) => emu().watch(pin, on),
      wait: (until: number) => emu().wait(until),
    });
    py.FS.mkdirTree('/sim');
    py.FS.writeFile('/sim/_simrt.py', SIMRT_PY);
    py.FS.writeFile('/sim/gpiozero.py', GPIOZERO_PY);
    await py.runPythonAsync("import sys\nsys.path.insert(0, '/sim')\nimport _simrt\n");
    this.py = py;
  }

  async start(emu: PiEmulator, code: string): Promise<PiFinish> {
    const py = this.py;
    if (!py) return { ok: false, error: this.error || 'Python ยังไม่พร้อม', line: null };
    this.busy = emu;
    try {
      py.globals.set('_main_src', code);
      const r = await py.runPythonAsync('_simrt.run_main(_main_src)');
      return JSON.parse(String(r)) as PiFinish;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      emu.out_(`\n${msg}\n`);
      return { ok: false, error: msg.trim().split('\n').pop() ?? msg, line: null };
    } finally {
      this.busy = null;
    }
  }
}

export const piHost = new PyodideHost();
