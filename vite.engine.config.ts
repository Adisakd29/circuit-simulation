import { defineConfig } from 'vite';

/** ตัวจำลองวงจรสำหรับเซิร์ฟเวอร์ (เซสชัน ESP32): bundle เป็น ESM ไฟล์เดียว รวม dependency (เซิร์ฟเวอร์ไม่มี node_modules) */
export default defineConfig({
  build: {
    ssr: 'src/server/esp32-worker.ts',
    outDir: 'server/engine',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { external: [/server\/esp32\/link\.mjs$/, /^node:/], output: { entryFileNames: 'esp32-worker.mjs', inlineDynamicImports: true, paths: (id: string) => (/server\/esp32\/link\.mjs$/.test(id) ? '../esp32/link.mjs' : id) } },
  },
  ssr: { noExternal: true },
});
