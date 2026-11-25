/**
 * worker_thread หนึ่งตัวต่อหนึ่งเซสชันจำลองที่มี ESP32 (เซิร์ฟเวอร์) — รันตัวจำลองวงจร (SimEngine ชุดเดียวกับหน้าเว็บ)
 * คู่กับ QEMU ผ่าน esp32-bridge แบบ lockstep · การอ่านท่อแบบ synchronous บล็อกเฉพาะ worker นี้ ไม่บล็อกเซิร์ฟเวอร์หลัก
 * รับ: { req: EngineRequest } หรือ { stop: true } · ตอบ: EngineResponse หรือ { seq, crash }
 * build: npm run build:engine → server/engine/esp32-worker.mjs (รวม dependency ทั้งหมด ยกเว้น server/esp32/link.mjs)
 */
import { parentPort } from 'node:worker_threads';
import { SimEngine, type EngineRequest } from '../sim/engine';
import { setEsp32LinkFactory } from '../mcu/esp32-emu';
import { esp32PathsFromEnv, openEsp32Link } from '../../server/esp32/link.mjs';

const paths = esp32PathsFromEnv();
const links: Array<{ close(): void }> = [];
if (paths) setEsp32LinkFactory(() => { const l = openEsp32Link(paths); links.push(l); return l; });
const engine = new SimEngine();

parentPort!.on('message', (m: { req?: EngineRequest; stop?: boolean }) => {
  if (m.stop) {
    engine.dispose();
    for (const l of links) l.close();
    parentPort!.postMessage({ stopped: true });
    return;
  }
  const req = m.req!;
  try {
    parentPort!.postMessage(engine.handle(req));
  } catch (e) {
    parentPort!.postMessage({ seq: req.seq, crash: String((e as Error)?.message ?? e) });
  }
});
