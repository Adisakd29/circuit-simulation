// แปลง dist-single/index.html เป็นเนื้อหาหน้าเดียว (ไม่มี doctype/html/head/body) สำหรับเผยแพร่เป็น Artifact
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('dist-single/index.html', 'utf8');
const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1]
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
// ใช้แท็ก </body> ตัวสุดท้าย — โค้ดในหน้า (เช่น ตัวสร้างเอกสารส่งออก) อาจมีข้อความ "</body>" อยู่ในสตริง
const bStart = html.search(/<body>/i), bEnd = html.toLowerCase().lastIndexOf('</body>');
const body = html.slice(bStart + 6, bEnd);
const title = /<title>[\s\S]*?<\/title>/i.exec(head)[0];
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/index.html', `${title}\n${head.replace(title, '')}\n${body}`);
console.log('artifact/index.html', (readFileSync('artifact/index.html').length / 1024).toFixed(0), 'KB');
