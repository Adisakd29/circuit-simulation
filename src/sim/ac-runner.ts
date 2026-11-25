import { solveAC, type AcRequest, type AcResult } from './ac';
import AcWorker from './ac.worker?worker&inline';

/** เรียก AC sweep ใน Web Worker (fallback: main thread) — คำขอใหม่ทำให้ผลของคำขอเก่าถูกทิ้ง */
export class AcRunner {
  private worker: Worker | null = null;
  private id = 0;
  private waiting = new Map<number, (r: AcResult | null) => void>();

  constructor() {
    try {
      this.worker = new AcWorker();
      this.worker.onmessage = (ev: MessageEvent<{ id: number; result: AcResult }>) => {
        const cb = this.waiting.get(ev.data.id);
        this.waiting.delete(ev.data.id);
        cb?.(ev.data.id === this.id ? ev.data.result : null);
      };
      this.worker.onerror = () => { this.worker = null; for (const cb of this.waiting.values()) cb(null); this.waiting.clear(); };
    } catch {
      this.worker = null;
    }
  }

  /** คืน null ถ้าถูกแทนที่ด้วยคำขอใหม่กว่า */
  run(req: AcRequest): Promise<AcResult | null> {
    const id = ++this.id;
    if (!this.worker) return Promise.resolve(solveAC(req));
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ ...req, id });
    });
  }
}
