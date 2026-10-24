import { LedPlayback } from './render/led-playback';
import { ledBrightness } from './instruments/measure';
import { App } from './ui/app';
import { pinHolesFor } from './model/geometry';
import { pinDefs } from './model/catalog';
import { movePart } from './editor/ops';

/**
 * จุดเริ่มต้น
 * 1) สร้าง UI ทั้งหมด (คลังอุปกรณ์ แลป แถบเครื่องมือ) — ไม่ขึ้นกับ WebGL
 * 2) ให้เบราว์เซอร์วาดหน้าก่อน แล้วจึงสร้างพื้นที่ 3 มิติ (ถ้าสร้างไม่ได้ App แสดงสาเหตุ + ปุ่มลองใหม่เอง)
 * 3) ถ้าเกิดข้อผิดพลาดร้ายแรงตอนเริ่ม แสดงข้อความแทนหน้าที่กดอะไรไม่ได้
 */
function fail(e: unknown) {
  document.documentElement.dataset.boot = 'error';
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const el = document.getElementById('boot-status');
  if (el) {
    el.hidden = false;
    el.className = 'boot-status err';
    el.innerHTML = '<b>เริ่มแอปไม่สำเร็จ</b><p>เกิดข้อผิดพลาดขณะเริ่มโปรแกรม ลองโหลดหน้าใหม่ ถ้ายังไม่ได้ ให้แจ้งผู้ดูแลพร้อมข้อความด้านล่าง</p><pre></pre><button type="button" onclick="location.reload()">โหลดหน้าใหม่</button>';
    el.querySelector('pre')!.textContent = `${msg}\n${navigator.userAgent}`;
  }
  console.error(e);
}

performance.mark?.('cl:module');

function boot() {
  if (booted) return;
  booted = true;
  performance.mark?.('cl:boot');
  let app: App;
  try {
    app = new App();
    performance.mark?.('cl:ui');
    document.documentElement.dataset.boot = 'ui';
  } catch (e) { fail(e); return; }
  const status = document.getElementById('boot-status');
  if (status) status.textContent = 'กำลังเตรียมพื้นที่ทำงาน 3 มิติ…';
  // รอให้หน้าถูกวาดหนึ่งเฟรมก่อน (ผู้ใช้เห็นคลังอุปกรณ์/ปุ่มทันที) แล้วจึงสร้าง renderer ซึ่งอาจใช้เวลานานบนเครื่องช้า
  requestAnimationFrame(() => setTimeout(() => {
    try { app.initView(); } catch (e) { console.error(e); }
    performance.mark?.('cl:3d');
    (window as unknown as { circuitLab: App }).circuitLab = app; // สำหรับทดสอบ/ดีบัก (พร้อมใช้งานเต็มที่แล้ว)
    // ฟังก์ชันอ่านอย่างเดียวสำหรับสคริปต์ตรวจภาพ/ตำแหน่งขา (tests/visual)
    (window as unknown as { __cl: object }).__cl = { pinHolesFor, pinDefs, movePart, LedPlayback, ledBrightness };
    document.documentElement.dataset.boot = 'ok';
    status?.setAttribute('hidden', '');
  }, 0));
}

let booted = false;
// รอฟอนต์ไทยไม่เกิน 1.5 วินาที (ถ้าโหลดฟอนต์ไม่ได้ ใช้ฟอนต์สำรองของเครื่อง)
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(boot, boot);
