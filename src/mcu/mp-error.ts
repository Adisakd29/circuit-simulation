/**
 * หาบรรทัดที่ผิดจาก traceback ของ MicroPython — โค้ดที่รันผ่าน raw REPL ชื่อไฟล์ "<stdin>", การคอมไพล์ด้วยปุ่ม Compile ชื่อ "main.py"
 * คืนบรรทัดลึกสุดในโค้ดผู้ใช้ และข้อความบรรทัดสุดท้าย (ชนิดข้อผิดพลาด) · KeyboardInterrupt (กดหยุด) ไม่ถือเป็นข้อผิดพลาดของโค้ด
 */
export function parseMpError(err: string): { line: number | null; message: string } | null {
  const lines = err.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const message = lines[lines.length - 1];
  if (message.startsWith('KeyboardInterrupt')) return null;
  let line: number | null = null;
  for (const m of err.matchAll(/File "(?:<stdin>|main\.py)", line (\d+)/g)) line = Number(m[1]);
  return { line, message };
}

/** โค้ดที่ส่งให้บอร์ดคอมไพล์ด้วย compile() ของ MicroPython (ไม่รัน) — ข้อผิดพลาดจะชี้ File "main.py", line N */
export function compileWrapper(code: string): string {
  const src = code.replace(/\r\n?/g, '\n');
  return `compile(${JSON.stringify(src)}, "main.py", "exec")\nprint("คอมไพล์ผ่าน: ${src.split('\n').length} บรรทัด ไม่มีข้อผิดพลาดทางไวยากรณ์ (ยังไม่ได้รัน)")\n`;
}
