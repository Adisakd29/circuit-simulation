import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync, createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ไฟล์ Python (Pyodide, MPL-2.0) ของบอร์ด Raspberry Pi — คัดลอกไปที่ dist/pyodide/ (เว็บที่ deploy เสิร์ฟเอง ไม่พึ่ง CDN)
 * หน้าเว็บแบบไฟล์เดียว (artifact) โหลดจาก cdn.jsdelivr.net แทน (ไฟล์ใหญ่เกินจะฝังได้)
 */
const PY_FILES = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const PY_SRC = 'node_modules/pyodide';
const PY_TYPES: Record<string, string> = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' };
function pyodideFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pyodide-files',
    configResolved(c) { outDir = c.build.outDir; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/pyodide\/([\w.-]+)$/.exec(req.url?.split('?')[0] ?? '');
        if (!m || !PY_FILES.includes(m[1])) return next();
        res.setHeader('Content-Type', PY_TYPES[m[1].slice(m[1].lastIndexOf('.'))] ?? 'application/octet-stream');
        createReadStream(join(PY_SRC, m[1])).pipe(res);
      });
    },
    writeBundle() {
      const dir = join(outDir, 'pyodide');
      mkdirSync(dir, { recursive: true });
      for (const f of PY_FILES) if (existsSync(join(PY_SRC, f))) copyFileSync(join(PY_SRC, f), join(dir, f));
      writeFileSync(join(dir, 'NOTICE.txt'), 'Pyodide 314.0.7 — Mozilla Public License 2.0\nSource: https://github.com/pyodide/pyodide\nUnmodified files from the npm package "pyodide". CPython is under the PSF License.\n');
    },
  };
}

// `--mode single` สร้างไฟล์ HTML ไฟล์เดียว (ใช้แจกจ่าย/เปิดแบบออฟไลน์)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [pyodideFiles()],
  worker: { format: 'es' },
  // โมเดลบอร์ด GLB (src/assets/models) — ไฟล์แยกในเว็บที่ deploy, ฝังในหน้าเว็บไฟล์เดียว
  assetsInclude: ['**/*.glb'],
  // บริการคอมไพล์ Arduino (server/server.mjs) ระหว่างพัฒนา: npm run serve:api แล้วหน้าเว็บเรียก /api ผ่าน proxy
  server: { proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8080}` } },
  preview: { proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8080}` } },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}));
