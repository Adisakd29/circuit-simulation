import type { CircuitDoc } from '../model/types';

/**
 * Undo/Redo แบบ snapshot ของ CircuitDoc ทั้งก้อน (doc มีขนาดเล็ก → เรียบง่ายและถูกต้องเสมอ)
 * ครอบคลุมอุปกรณ์ สาย ค่าพารามิเตอร์ และโพรบ เพราะทั้งหมดอยู่ใน doc
 */
export class History {
  private past: Array<{ doc: CircuitDoc; label: string }> = [];
  private future: Array<{ doc: CircuitDoc; label: string }> = [];
  constructor(private current: CircuitDoc, private limit = 200) {}

  get doc(): CircuitDoc { return this.current; }

  /** บันทึกการเปลี่ยนแปลง (doc ใหม่ต้องไม่ใช่ object เดียวกับของเดิม) */
  commit(next: CircuitDoc, label: string) {
    this.past.push({ doc: this.current, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
  }

  /** แทนที่ doc ปัจจุบันโดยรวมกับคำสั่งล่าสุด (ใช้กับการลากค่า slider ต่อเนื่อง) */
  amend(next: CircuitDoc, label: string): boolean {
    const last = this.past[this.past.length - 1];
    if (!last || last.label !== label || this.future.length) return false;
    this.current = next;
    return true;
  }

  /** เปลี่ยน doc ปัจจุบันโดยไม่บันทึกประวัติ (สถานะชั่วคราว เช่น กดปุ่มค้าง) — ประวัติเดิมทั้งหมดยังอยู่ */
  replace(next: CircuitDoc) {
    this.current = next;
  }

  undo(): string | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ doc: this.current, label: prev.label });
    this.current = prev.doc;
    return prev.label;
  }

  redo(): string | null {
    const nxt = this.future.pop();
    if (!nxt) return null;
    this.past.push({ doc: this.current, label: nxt.label });
    this.current = nxt.doc;
    return nxt.label;
  }

  reset(doc: CircuitDoc) {
    this.past = [];
    this.future = [];
    this.current = doc;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label; }
  get redoLabel() { return this.future[this.future.length - 1]?.label; }
}
