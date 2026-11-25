/// <reference lib="webworker" />
import { SimEngine, type EngineRequest } from './engine';
import { piHost, setPyodideBase } from '../mcu/pi-python';

/**
 * Simulation worker — คำนวณนอก UI thread และเก็บสถานะการจำลองตามเวลาไว้ในนี้
 * บอร์ด Raspberry Pi: Python (Pyodide) รันใน worker นี้ — คำขอที่มีบอร์ด Pi ประมวลผลแบบ async (Python พักด้วย JSPI)
 * main thread ส่งคำขอถัดไปหลังได้คำตอบเท่านั้น จึงไม่มีคำขอซ้อนกัน
 */
const engine = new SimEngine();
engine.piHost = piHost;
self.onmessage = async (ev: MessageEvent<EngineRequest>) => {
  try {
    if (ev.data.pyBase) setPyodideBase(ev.data.pyBase);
    (self as unknown as Worker).postMessage(await engine.handleAsync(ev.data));
  } catch (e) {
    (self as unknown as Worker).postMessage({ seq: ev.data.seq, crash: String((e as Error)?.message ?? e) });
  }
};
