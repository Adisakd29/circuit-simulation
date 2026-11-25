import { describe, expect, it } from 'vitest';
import { checkSource, compileSketch, findFunctions, toolchainReady, parseDiagnostics, preprocessSketch } from '../server/compile.mjs';
import { createServer } from '../server/server.mjs';
import { NANO_POT_CODE, UNO_DEFAULT_CODE } from '../src/model/catalog';

const hasGcc = await toolchainReady();

describe('บริการคอมไพล์ Arduino: ส่วนที่ไม่ต้องใช้ avr-gcc', () => {
  it('หา prototype ของฟังก์ชันระดับบนสุด (ข้าม if/for/struct, ข้ามฟังก์ชันที่มีค่าเริ่มต้นของพารามิเตอร์ เหมือน Arduino IDE)', () => {
    const src = 'struct P { int x; };\nint led = 13;\nvoid setup() { blink(2); }\nvoid loop() { if (x) { } }\nvoid blink(int n, int ms = 100) {\n  for (;;) {}\n}\nconst char* name() { return "a"; }\n';
    const { protos, firstLine } = findFunctions(src);
    expect(protos).toEqual(['void setup();', 'void loop();', 'const char* name();']);
    expect(firstLine).toBe(2);
  });
  it('ISR(...) / SIGNAL(...) ไม่ถูกแยกเป็น prototype ผิด ๆ (เดิมได้ "I SR(PCINT2_vect);" คอมไพล์ไม่ผ่าน)', () => {
    const { protos } = findFunctions('volatile int n;\nISR(PCINT2_vect) { n++; }\nISR (TIMER1_COMPA_vect) {}\nvoid setup() {}\nunsigned long f(void) { return 1; }\n');
    expect(protos).toEqual(['void setup();', 'unsigned long f(void);']);
  });
  it('ใส่ prototype + #line ให้บรรทัดตรงกับ sketch.ino', () => {
    const { cpp } = preprocessSketch('int a;\nvoid setup() {}\nvoid loop() {}\n');
    const l = cpp.split('\n');
    expect(l[0]).toBe('#include <Arduino.h>');
    expect(l).toContain('#line 2 "sketch.ino"');
    expect(l.indexOf('void setup();')).toBeLessThan(l.indexOf('void setup() {}'));
  });
  it('ปฏิเสธ include ที่อ่านไฟล์นอกโปรเจกต์ / มาโคร / .incbin', () => {
    expect(checkSource('#include "../../etc/passwd"\n')[0].line).toBe(1);
    expect(checkSource('\n#include </etc/shadow>\n')[0].line).toBe(2);
    expect(checkSource('#define F <x.h>\n#include F\n')[0].line).toBe(2);
    expect(checkSource('asm(".incbin \\"/etc/passwd\\"");\n').length).toBe(1);
    expect(checkSource('#include <Servo.h>\n#include "Wire.h"\n')).toEqual([]);
    expect(checkSource('x'.repeat(70000)).length).toBe(1);
  });
  it('แยกข้อความคอมไพเลอร์เป็นบรรทัด/คอลัมน์', () => {
    const d = parseDiagnostics("/tmp/x/sketch.ino:6:3: error: 'digitalWrit' was not declared in this scope\nsketch.ino:6:3: note: suggested alternative: 'digitalWrite'\nfoo\n");
    expect(d).toEqual([
      { file: 'sketch.ino', line: 6, col: 3, severity: 'error', message: "'digitalWrit' was not declared in this scope" },
      { file: 'sketch.ino', line: 6, col: 3, severity: 'note', message: "suggested alternative: 'digitalWrite'" },
    ]);
  });
});

describe.skipIf(!hasGcc)('บริการคอมไพล์ Arduino: คอมไพล์จริงด้วย avr-gcc', () => {
  it('Blink ค่าเริ่มต้นคอมไพล์ผ่าน ได้ .hex และขนาดสมเหตุผล', async () => {
    const r = await compileSketch(UNO_DEFAULT_CODE);
    expect(r.ok).toBe(true);
    expect(r.hex).toMatch(/^:10000000/);
    expect(r.size?.flash).toBeGreaterThan(1000);
    expect(r.size?.flash).toBeLessThan(4000);
    expect(r.size?.maxFlash).toBe(32256);
  }, 60000);
  it('ข้อผิดพลาดชี้บรรทัดของ sketch.ino (พิมพ์ชื่อฟังก์ชันผิด + ลืม ;)', async () => {
    const src = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrit(13, HIGH);\n  delay(500)\n  digitalWrite(13, LOW);\n}\n';
    const r = await compileSketch(src);
    expect(r.ok).toBe(false);
    const errs = r.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.find((d) => d.message.includes('digitalWrit'))?.line).toBe(6);
    expect(errs.some((d) => d.line === 8 && d.message.includes("expected ';'"))).toBe(true);
  }, 60000);
  it('เรียกฟังก์ชันก่อนประกาศได้ และใช้ไลบรารี Servo/Wire ได้', async () => {
    const r = await compileSketch('#include <Servo.h>\n#include <Wire.h>\nServo s;\nvoid setup() { s.attach(9); Wire.begin(); go(); }\nvoid loop() {}\nvoid go() { s.write(90); }\n');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
  }, 60000);
  it('บอร์ด Nano: คอมไพล์ด้วย ARDUINO_AVR_NANO + variant eightanaloginputs (NUM_ANALOG_INPUTS = 8) แฟลชสูงสุด 30,720 ไบต์ · ค่าเดียวกันไม่ใช่ของบอร์ด Uno', async () => {
    const r = await compileSketch(NANO_POT_CODE, 'nano');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.size?.maxFlash).toBe(30720);
    const probe = '#if !defined(ARDUINO_AVR_NANO) || NUM_ANALOG_INPUTS != 8\n#error not nano\n#endif\nvoid setup() {}\nvoid loop() {}\n';
    expect((await compileSketch(probe, 'nano')).ok).toBe(true);
    const u = await compileSketch(probe, 'uno');
    expect(u.ok).toBe(false);
    expect(u.diagnostics.find((d) => d.severity === 'error')?.message).toContain('not nano');
  }, 60000);
  it('ลิงก์ไม่ผ่านเมื่อไม่มี loop() — แจ้งข้อผิดพลาด', async () => {
    const r = await compileSketch('void setup() {}\n');
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.message).join(' ')).toMatch(/loop/);
  }, 60000);
  it('เซิร์ฟเวอร์ HTTP: /api/health, /api/compile, ปฏิเสธ JSON ผิด, CORS', async () => {
    const srv = createServer().listen(0);
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const h = await (await fetch(`${base}/api/health`)).json();
      expect(h.ok).toBe(true);
      expect(h.avrGcc).toMatch(/7\.3/);
      const res = await fetch(`${base}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board: 'uno', source: UNO_DEFAULT_CODE }) });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      const c = await res.json();
      expect(c.ok).toBe(true);
      const bad = await fetch(`${base}/api/compile`, { method: 'POST', body: '{nope' });
      expect(bad.status).toBe(400);
      const pre = await fetch(`${base}/api/compile`, { method: 'OPTIONS' });
      expect(pre.status).toBeLessThan(300);
    } finally { srv.close(); }
  }, 60000);
});
