/// <reference lib="webworker" />
import { solveAC, type AcRequest } from './ac';

/** AC sweep worker — แยกจาก worker ของการจำลองตามเวลา เพื่อไม่ให้เวลาจำลองสะดุดระหว่าง sweep */
self.onmessage = (ev: MessageEvent<AcRequest & { id: number }>) => {
  const { id, ...req } = ev.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: solveAC(req) });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, result: { ok: false, error: `ตัวคำนวณขัดข้อง: ${String((e as Error)?.message ?? e)}`, freqs: req.freqs, values: {}, notes: [], ms: 0 } });
  }
};
