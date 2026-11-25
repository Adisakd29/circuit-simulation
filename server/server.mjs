/**
 * เซิร์ฟเวอร์ของ Circuit Lab 3D: เสิร์ฟหน้าเว็บ (dist/) + บริการคอมไพล์ Arduino
 *   POST /api/compile  { board: 'uno', source: '<sketch .ino>' } → { ok, hex, size, diagnostics }
 *   GET  /api/health   → รุ่นเครื่องมือ
 *   POST /api/sim/esp32 { sid, req } → ผลจำลองช่วงถัดไปของวงจรที่มี ESP32 (QEMU — ดู server/esp32/README.md) · POST /api/sim/esp32/stop { sid }
 * ไม่มี dependency นอกจาก Node ≥ 20 · พอร์ตจาก PORT (Railway ตั้งให้) · CORS เปิด (หน้า artifact เรียกข้ามโดเมนได้)
 * จำกัด: ทำพร้อมกันสูงสุด MAX_JOBS งาน คิวไม่เกิน MAX_QUEUE · ขนาดคำขอ ≤ 128 KB
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSketch, prebuild, toolchainInfo, MAX_SOURCE } from './compile.mjs';
import { esp32Info, esp32Step, esp32Stop, esp32StopAll } from './esp32/sessions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.STATIC_DIR ?? 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const MAX_JOBS = Number(process.env.MAX_JOBS ?? 2);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 16);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.zip': 'application/zip', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

let active = 0;
const queue = [];
function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const go = () => { active++; fn().then(resolve, reject).finally(() => { active--; queue.shift()?.(); }); };
    if (active < MAX_JOBS) go();
    else if (queue.length >= MAX_QUEUE) reject(Object.assign(new Error('busy'), { status: 503 }));
    else queue.push(go);
  });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(ROOT, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  try { if ((await stat(f)).isDirectory()) f = path.join(f, 'index.html'); } catch { f = path.join(ROOT, 'index.html'); }
  try {
    const data = await readFile(f);
    const hashed = /\/assets\//.test(f);
    // ไฟล์ Python (Pyodide ~12 MB) ไม่เปลี่ยนภายในรุ่นเดียวกัน: ให้เบราว์เซอร์เก็บไว้ 7 วัน
    const py = /[\\/]pyodide[\\/]/.test(f);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : py ? 'public, max-age=604800' : 'no-cache' });
    res.end(data);
  } catch { send(res, 404, 'not found', 'text/plain'); }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (req.url === '/api/health') return send(res, 200, { ok: true, ...(await toolchainInfo()), active, queued: queue.length, esp32: esp32Info() });
      if (req.url === '/api/sim/esp32' || req.url === '/api/sim/esp32/stop') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST เท่านั้น' });
        let body;
        try { body = JSON.parse(await readBody(req, 4 * 1024 * 1024)); } catch (e) { if (e.status) throw e; return send(res, 400, { ok: false, error: 'JSON ไม่ถูกต้อง' }); }
        if (req.url === '/api/sim/esp32/stop') { esp32Stop(body?.sid); return send(res, 200, { ok: true }); }
        try { return send(res, 200, await esp32Step(body?.sid, body?.req)); } catch (e) { return send(res, e.status ?? 500, { ok: false, error: String(e.message ?? e) }); }
      }
      if (req.url === '/api/compile') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST เท่านั้น' });
        let body;
        try { body = JSON.parse(await readBody(req, 2 * MAX_SOURCE + 4096)); } catch (e) { if (e.status) throw e; return send(res, 400, { ok: false, error: 'JSON ไม่ถูกต้อง' }); }
        if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'JSON ไม่ถูกต้อง' });
        if (typeof body.source !== 'string') return send(res, 400, { ok: false, error: 'ต้องมี source' });
        const t0 = Date.now();
        const r = await withSlot(() => compileSketch(body.source, typeof body.board === 'string' ? body.board : 'uno'));
        return send(res, 200, { ...r, log: undefined, ms: Date.now() - t0 });
      }
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
      send(res, 405, 'method not allowed', 'text/plain');
    } catch (e) {
      send(res, e.status ?? 500, { ok: false, error: e.status === 503 ? 'บริการคอมไพล์มีงานรออยู่มาก ลองใหม่อีกครั้ง' : e.status === 413 ? 'โค้ดใหญ่เกินไป' : String(e.message ?? e) });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  Promise.all([prebuild('uno'), prebuild('nano'), prebuild('mega'), prebuild('promini'), prebuild('promini3'), prebuild('attiny85')]).then(() => {
    process.on('SIGTERM', () => { esp32StopAll(); process.exit(0); });
    createServer().listen(PORT, () => console.log(`Circuit Lab 3D: http://0.0.0.0:${PORT} (static ${ROOT}) · /api/compile พร้อม`));
  }, (e) => { console.error('เตรียม Arduino core ไม่สำเร็จ', e); process.exit(1); });
}
