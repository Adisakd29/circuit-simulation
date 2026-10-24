/// <reference lib="webworker" />
import { SimEngine, type EngineRequest } from './engine';

/** Simulation worker — คำนวณนอก UI thread และเก็บสถานะการจำลองตามเวลาไว้ในนี้ */
const engine = new SimEngine();
self.onmessage = (ev: MessageEvent<EngineRequest>) => {
  try {
    (self as unknown as Worker).postMessage(engine.handle(ev.data));
  } catch (e) {
    (self as unknown as Worker).postMessage({ seq: ev.data.seq, crash: String((e as Error)?.message ?? e) });
  }
};
