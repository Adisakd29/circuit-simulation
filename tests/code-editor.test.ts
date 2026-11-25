import { describe, expect, it } from 'vitest';
import { complete, highlight, suggestionsFor, wordBefore } from '../src/ui/code-editor';
import { UNO_DEFAULT_CODE, PICO_DEFAULT_CODE, RPI_BUTTON_CODE } from '../src/model/catalog';
import GPIOZERO_PY from '../src/mcu/pi/gpiozero.py?raw';

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

describe('ตัวแก้ไขโค้ด: ไฮไลต์ไวยากรณ์และเติมคำ', () => {
  it('ไฮไลต์คงข้อความเดิมทุกตัวอักษร (ชั้นสีต้องตรงกับ textarea) รวมสตริง/คอมเมนต์ที่ยังไม่ปิด', () => {
    for (const [code, lang] of [[UNO_DEFAULT_CODE, 'cpp'], [PICO_DEFAULT_CODE, 'micropython'], [RPI_BUTTON_CODE, 'gpiozero'], ['x = "abc\n/* not closed', 'cpp'], ["s = '''tri\nple", 'micropython'], ['a < b && c > d', 'cpp']] as const) {
      expect(strip(highlight(code, lang))).toBe(code);
    }
  });
  it('ระบายสีถูกชนิด: คีย์เวิร์ด, API ที่รองรับ, ค่าคงที่, สตริง, คอมเมนต์, #include · ชื่อที่สะกดผิด (digitalWrit) ไม่ถูกระบายเป็น API', () => {
    const h = highlight('#include <Wire.h>\nvoid loop() { digitalWrite(13, HIGH); digitalWrit(1); // c\n Serial.println("x"); }', 'cpp');
    expect(h).toContain('<span class="hl-pre">#include &lt;Wire.h&gt;</span>');
    expect(h).toContain('<span class="hl-kw">void</span>');
    expect(h).toContain('<span class="hl-api">digitalWrite</span>');
    expect(h).toContain('<span class="hl-const">HIGH</span>');
    expect(h).toContain('<span class="hl-com">// c</span>');
    expect(h).toContain('<span class="hl-str">"x"</span>');
    expect(h).toContain('digitalWrit(');
    expect(h).not.toContain('hl-api">digitalWrit<');
    const p = highlight('def f():\n    print("a")  # x\n@dec\nreturn None', 'micropython');
    expect(p).toContain('<span class="hl-kw">def</span>');
    expect(p).toContain('<span class="hl-bi">print</span>');
    expect(p).toContain('<span class="hl-dec">@dec</span>');
  });
  it('เติมคำ: Serial.pr → print/println · machine.P → PWM/Pin ใน MicroPython · ชื่อตัวแปรในโค้ด', () => {
    const c = 'void setup() {\n  Serial.pr';
    expect(wordBefore(c, c.length)).toBe('Serial.pr');
    expect(complete(c, c.length, 'cpp').map((s) => s.label).slice(0, 2)).toEqual(['Serial.print', 'Serial.println']);
    const m = 'import machine\nmachine.P';
    expect(complete(m, m.length, 'micropython').map((s) => s.label)).toEqual(expect.arrayContaining(['machine.PWM']));
    const own = 'int ledPin = 13;\nvoid loop() { digitalWrite(led';
    expect(complete(own, own.length, 'cpp').map((s) => s.label)).toContain('ledPin');
  });
  it('รายการเติมคำของ Pi 5 มีเฉพาะคลาสที่มีจริงในชุดย่อย gpiozero ของแอป (ไม่แนะนำ DistanceSensor ฯลฯ)', () => {
    const classes = suggestionsFor('gpiozero').map((s) => s.label).filter((l) => /^[A-Z]\w+$/.test(l));
    for (const k of classes) expect(GPIOZERO_PY, k).toMatch(new RegExp(`^class ${k}\\b`, 'm'));
    expect(complete('Dist', 4, 'gpiozero')).toEqual([]);
    expect(complete('from gpiozero import But', 24, 'gpiozero').map((s) => s.label)).toContain('Button');
  });
});
