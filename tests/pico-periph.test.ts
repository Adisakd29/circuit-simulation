import { describe, expect, it } from 'vitest';
import { pulldownRig, runSensor } from './sensor-rig';

/** อุปกรณ์ภายใน RP2040 ที่ตรวจในรอบ Audit — รัน MicroPython จริงบน rp2040js */
describe('Raspberry Pi Pico: Timer และ watchdog (Audit)', () => {
  it('machine.Timer 10 Hz เรียก callback ≈ 10 ครั้งใน 1 วินาทีของเวลาจำลอง', { timeout: 60000 }, () => {
    const code = 'import machine, time\nn = [0]\ndef cb(t): n[0] += 1\ntm = machine.Timer()\ntm.init(freq=10, callback=cb)\ntime.sleep(1)\ntm.deinit()\nprint("timer", n[0])\n';
    const { con } = runSensor(pulldownRig({ code }), 1.6, 0.05);
    const n = Number(/timer (\d+)/.exec(con)?.[1]);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  it('machine.WDT(timeout=300) ไม่เลี้ยง → บอร์ดบูต MicroPython ใหม่ทุก ~0.35 s และ main รันใหม่ (เดิม: หน่วยความจำเต็ม worker ล่ม)', { timeout: 60000 }, () => {
    const code = 'import machine, time\nprint("boot")\nw = machine.WDT(timeout=300)\ntime.sleep(2)\nprint("never")\n';
    const { con, st } = runSensor(pulldownRig({ code }), 1.3, 0.05);
    expect(con.match(/\bboot\b/g)!.length).toBeGreaterThanOrEqual(3);
    expect(con).toContain('บอร์ดรีเซ็ต');
    expect(con).not.toContain('never');
    const fin = st.map((s) => s.r.mcu![0].finished).filter(Boolean);
    expect(fin[0]).toMatchObject({ ok: false });
  });

  it('เลี้ยง watchdog (w.feed()) → ไม่รีเซ็ต · machine.reset() → บูตใหม่ทันที', { timeout: 60000 }, () => {
    const fed = runSensor(pulldownRig({ code: 'import machine, time\nprint("boot")\nw = machine.WDT(timeout=300)\nfor i in range(10):\n    time.sleep(0.1)\n    w.feed()\nprint("fed ok")\nwhile True:\n    time.sleep(0.1)\n    w.feed()\n' }), 1.5, 0.05);
    expect(fed.con.match(/\bboot\b/g)!.length).toBe(1);
    expect(fed.con).toContain('fed ok');
    const rs = runSensor(pulldownRig({ code: 'import machine, time\nprint("boot")\ntime.sleep(0.3)\nmachine.reset()\n' }), 1.0, 0.05);
    expect(rs.con.match(/\bboot\b/g)!.length).toBeGreaterThanOrEqual(2);
  });
});
