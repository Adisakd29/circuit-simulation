/**
 * เซสชันจำลองที่มี ESP32 บนเซิร์ฟเวอร์: หนึ่งเซสชัน = worker_thread หนึ่งตัว (server/engine/esp32-worker.mjs) + esp32-bridge/QEMU หนึ่งโปรเซสต่อบอร์ด
 *   POST /api/sim/esp32        { sid, req: EngineRequest }  → EngineResponse (หรือ { seq, crash })
 *   POST /api/sim/esp32/stop   { sid }                      → { ok }
 * จำกัด: พร้อมกันได้ ESP32_MAX_SESSIONS เซสชัน (ค่าเริ่ม 2 — แต่ละเซสชันใช้ ≈ 1 คอร์ + RAM ≈ 170 MB ต่อบอร์ด) · เซสชันที่ไม่มีคำขอเกิน ESP32_IDLE_S วินาที (120) ถูกปิด
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esp32PathsFromEnv } from './link.mjs';

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'esp32-worker.mjs');
const MAX = Number(process.env.ESP32_MAX_SESSIONS ?? 2);
const IDLE_MS = Number(process.env.ESP32_IDLE_S ?? 120) * 1000;
const sessions = new Map();

export function esp32Info() {
  const p = esp32PathsFromEnv();
  return { available: !!p && existsSync(WORKER), sessions: sessions.size, max: MAX };
}

function close(sid) {
  const s = sessions.get(sid);
  if (!s) return;
  sessions.delete(sid);
  clearTimeout(s.idle);
  s.w.postMessage({ stop: true });
  setTimeout(() => s.w.terminate(), 1500);
  for (const r of s.waiters) r.reject(Object.assign(new Error('session closed'), { status: 410 }));
}

function touch(sid) {
  const s = sessions.get(sid);
  if (!s) return;
  clearTimeout(s.idle);
  s.idle = setTimeout(() => close(sid), IDLE_MS);
}

/** ส่งคำขอของตัวจำลองไปยัง worker ของเซสชัน (สร้างเซสชันใหม่ถ้ายังไม่มี) */
export function esp32Step(sid, req) {
  if (typeof sid !== 'string' || !/^[\w-]{8,64}$/.test(sid)) return Promise.reject(Object.assign(new Error('sid ไม่ถูกต้อง'), { status: 400 }));
  if (!esp32Info().available) return Promise.reject(Object.assign(new Error('เซิร์ฟเวอร์นี้ไม่มีบริการจำลอง ESP32 (QEMU)'), { status: 503 }));
  let s = sessions.get(sid);
  if (!s) {
    if (sessions.size >= MAX) return Promise.reject(Object.assign(new Error(`บริการจำลอง ESP32 เต็ม (${MAX} เซสชันพร้อมกัน) — ลองใหม่ภายหลัง`), { status: 503 }));
    const w = new Worker(WORKER);
    s = { w, waiters: [], idle: null };
    w.on('message', (m) => { if (m && m.stopped) return; const r = s.waiters.shift(); r?.resolve(m); });
    w.on('error', (e) => { for (const r of s.waiters.splice(0)) r.reject(e); sessions.delete(sid); });
    sessions.set(sid, s);
  }
  touch(sid);
  return new Promise((resolve, reject) => { s.waiters.push({ resolve, reject }); s.w.postMessage({ req }); });
}

export function esp32Stop(sid) { close(sid); }
export function esp32StopAll() { for (const sid of [...sessions.keys()]) close(sid); }
