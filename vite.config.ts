import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` สร้างไฟล์ HTML ไฟล์เดียว (ใช้แจกจ่าย/เปิดแบบออฟไลน์)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  worker: { format: 'es' },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}));
