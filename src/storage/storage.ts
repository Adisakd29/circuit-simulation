import { makeProjectFile, validateProjectFile, type ValidationResult } from '../model/schema';
import type { CircuitDoc, StudentWork } from '../model/types';

/**
 * การบันทึกงาน
 * - Export/Import ไฟล์ JSON (มี format + schemaVersion) ตรวจความถูกต้องก่อนโหลดเสมอ
 * - บันทึกอัตโนมัติใน localStorage (เบราว์เซอร์เครื่องนี้)
 * - วงจร (circuit) และงานนักเรียน (studentWork) เก็บแยกฟิลด์กัน
 *   ส่วนโจทย์/เฉลยแลปอยู่ในโค้ด (src/lessons) ไม่ถูกบันทึกลงไฟล์ของนักเรียน
 */

export const AUTOSAVE_KEY = 'circuitlab3d.autosave.v1';

export function serializeProject(title: string, circuit: CircuitDoc, work: StudentWork): string {
  return JSON.stringify(makeProjectFile(title, circuit, work), null, 2);
}

export function parseProject(text: string): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`อ่าน JSON ไม่ได้: ${(e as Error).message}`], warnings: [] };
  }
  return validateProjectFile(json);
}

export function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__cl3d_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export function autosave(title: string, circuit: CircuitDoc, work: StudentWork): { ok: boolean; error?: string } {
  const s = safeStorage();
  if (!s) return { ok: false, error: 'เบราว์เซอร์ไม่อนุญาตให้บันทึกในเครื่อง (localStorage)' };
  try {
    s.setItem(AUTOSAVE_KEY, serializeProject(title, circuit, work));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` };
  }
}

export function loadAutosave(): ValidationResult | null {
  const s = safeStorage();
  const text = s?.getItem(AUTOSAVE_KEY);
  if (!text) return null;
  return parseProject(text);
}

/**
 * ดาวน์โหลดไฟล์ข้อความ
 * - เมื่อเปิดเป็น claude.ai Artifact: ใช้ capability `downloads` (ผู้ชมยืนยันก่อนบันทึก)
 * - เบราว์เซอร์ทั่วไป: ลิงก์ดาวน์โหลดจาก Blob
 * คืนค่าข้อความผลลัพธ์สำหรับแสดงสถานะ
 */
export async function downloadText(filename: string, text: string): Promise<{ ok: boolean; message: string }> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    const downloads = (await claude.use('downloads').catch(() => null)) as null | {
      save(r: { filename: string; data: string }): Promise<{ status: string }>;
    };
    if (downloads) {
      try {
        await downloads.save({ filename, data: text });
        return { ok: true, message: `บันทึกไฟล์ ${filename} แล้ว` };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'declined') return { ok: false, message: 'ยกเลิกการบันทึกไฟล์' };
        if (code === 'rate_limited') return { ok: false, message: 'มีหน้าต่างบันทึกเปิดอยู่ ลองใหม่อีกครั้งภายหลัง' };
        return { ok: false, message: 'ดาวน์โหลดในหน้านี้ไม่ได้ ใช้ปุ่มคัดลอก JSON แทน' };
      }
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, message: `บันทึกไฟล์ ${filename} แล้ว (ถ้าไม่มีไฟล์ปรากฏ ให้ใช้ปุ่มคัดลอก JSON)` };
}
