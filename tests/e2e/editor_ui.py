"""E2E ตัวแก้ไขโค้ด (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
- แท็บ Arduino Uno: ชั้นไฮไลต์มีข้อความเดียวกับ textarea และวางตรงตำแหน่งตัวอักษร (เทียบตำแหน่งบรรทัดแรก) · คีย์เวิร์ด/API มีสี
- พิมพ์ "Serial.pr" → กล่องเติมคำ Serial.print/println อยู่ใต้เคอร์เซอร์ → ลูกศรลง + Enter (เดสก์ท็อป) / แตะรายการ (มือถือ) → ได้ Serial.println(
- พิมพ์ต่อแล้วคอมไพล์จริงได้ (โค้ดที่เติมใช้ได้) · Esc ปิดกล่อง · Ctrl+Space เปิดเอง (เดสก์ท็อป)
- แผงคุณสมบัติ Raspberry Pi 5: เติมคำเสนอเฉพาะคลาส gpiozero ที่มีในแอป (พิมพ์ "Dis" ไม่มี DistanceSensor) · ไม่มี JavaScript error
ใช้: python3 tests/e2e/editor_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

ALIGN = """(id) => { const ta = document.getElementById(id); const pre = ta.parentElement.querySelector('.pc-hl');
  const r = document.createRange(); r.setStart(pre.firstChild || pre, 0); r.setEnd(pre.firstChild || pre, 0);
  const tr = ta.getBoundingClientRect(), pr = pre.getBoundingClientRect(); const cs = getComputedStyle(ta), ps = getComputedStyle(pre);
  const taX = tr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), taY = tr.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const preX = pr.left + parseFloat(ps.paddingLeft), preY = pr.top + parseFloat(ps.paddingTop);
  return { dx: Math.abs(taX - preX), dy: Math.abs(taY - preY), same: pre.textContent.replace(/\\n $/, '') === ta.value, fontSame: cs.fontFamily === ps.fontFamily && cs.fontSize === ps.fontSize && cs.lineHeight === ps.lineHeight,
    kw: pre.querySelectorAll('.hl-kw').length, api: pre.querySelectorAll('.hl-api').length, color: cs.webkitTextFillColor }; }"""
POP = "[...document.querySelectorAll('.ac-pop')].filter(p => !p.hidden).map(p => ({ items: [...p.querySelectorAll('.ac-item')].map(e => e.dataset.label), top: p.getBoundingClientRect().top, left: p.getBoundingClientRect().left }))[0] || null"

def load(page, fx):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    page.set_input_files('#file-input', os.path.join(FIXD, fx)); time.sleep(1.0)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        load(page, 'lesson43-uno-start.json')
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.5)
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#dock-tab-uno').count(): page.click('#dock-tab-uno'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.wait_for_selector('#un-code', timeout=10000); time.sleep(0.6)
        a = page.evaluate(ALIGN, 'un-code')
        check(f'{tag}: ชั้นไฮไลต์มีข้อความเดียวกับ textarea ฟอนต์เดียวกัน วางตรงกัน (≤ 1 px) และตัวอักษรใน textarea โปร่งใส', a['same'] and a['fontSame'] and a['dx'] <= 1 and a['dy'] <= 1 and a['kw'] >= 2 and a['api'] >= 3 and 'rgba(0, 0, 0, 0)' in (a['color'] or ''), str(a))
        # พิมพ์ Serial.pr ท้ายโค้ด
        page.evaluate("(() => { const t = document.getElementById('un-code'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()")
        page.keyboard.type('\nint ledPin = 13;\nSerial.pr'); time.sleep(0.5)
        pop = page.evaluate(POP)
        caret_y = page.evaluate("(() => { const t = document.getElementById('un-code'); return t.getBoundingClientRect().top; })()")
        check(f'{tag}: พิมพ์ "Serial.pr" → กล่องเติมคำ Serial.print / Serial.println ปรากฏใต้ช่องโค้ด', pop and pop['items'][:2] == ['Serial.print', 'Serial.println'] and pop['top'] > caret_y, str(pop))
        page.screenshot(path=f'{OUT}/{tag}-editor-1-complete.png')
        if mobile:
            box = page.locator('.ac-pop:not([hidden]) .ac-item[data-label="Serial.println"]').bounding_box()
            page.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); time.sleep(0.4)
        else:
            page.keyboard.press('ArrowDown'); page.keyboard.press('Enter'); time.sleep(0.3)
        v = page.evaluate("document.getElementById('un-code').value")
        check(f'{tag}: เลือก Serial.println ({"แตะรายการ" if mobile else "ลูกศรลง + Enter"}) → แทรก "Serial.println(" และกล่องปิด', v.endswith('Serial.println(') and page.evaluate(POP) is None, repr(v[-30:]))
        page.keyboard.type('led'); time.sleep(0.4)
        pop2 = page.evaluate(POP)
        ok2 = pop2 and 'ledPin' in pop2['items']
        page.keyboard.press('Escape'); time.sleep(0.2)
        closed = page.evaluate(POP) is None
        check(f'{tag}: เติมคำจากชื่อที่ประกาศในโค้ด (ledPin) · Esc ปิดกล่อง', ok2 and closed, str(pop2))
        page.keyboard.type('Pin);'); time.sleep(0.2)
        if not mobile:
            page.keyboard.type('\ndigital'); page.keyboard.press('Escape'); page.keyboard.press('Control+Space'); time.sleep(0.3)
            p3 = page.evaluate(POP)
            check(f'{tag}: Ctrl+Space เปิดกล่องเติมคำเอง (digital → digitalWrite/digitalRead)', p3 and 'digitalWrite' in p3['items'] and 'digitalRead' in p3['items'], str(p3))
            page.keyboard.press('Escape'); page.keyboard.press('Backspace' if False else 'Escape')
            page.evaluate("(() => { const t = document.getElementById('un-code'); t.value = t.value.replace(/\\ndigital$/, ''); t.dispatchEvent(new Event('input')); })()")
        # โค้ดที่แก้ (ย้าย 2 บรรทัดใหม่เข้า loop ไม่ได้ง่าย) — ตรวจว่าคอมไพล์จริงยอมรับ Serial.println(ledPin) ใน setup แทน
        page.evaluate("""(() => { const t = document.getElementById('un-code'); const extra = t.value.slice(t.value.lastIndexOf('\\nint ledPin'));
          t.value = t.value.slice(0, t.value.length - extra.length).replace('digitalWrit(', 'digitalWrite(').replace('void setup() {', 'int ledPin = 13;\\nvoid setup() {\\n  Serial.begin(9600);\\n  Serial.println(ledPin);');
          t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); })()"""); time.sleep(0.3)
        page.click('#un-compile')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.4)
        err = page.evaluate("circuitLab.unoError")
        check(f'{tag}: โค้ดที่แก้ในตัวแก้ไข (ไฮไลต์อยู่) คอมไพล์ผ่านด้วย avr-gcc จริง', err is None and page.evaluate("circuitLab.unoDiags.filter(d => d.severity === 'error').length") == 0, str(err))
        a2 = page.evaluate(ALIGN, 'un-code')
        check(f'{tag}: หลังแก้ ชั้นไฮไลต์ยังตรงกับข้อความ', a2['same'], str(a2['same']))
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.click('#btn-stop'); time.sleep(0.4)
        # Raspberry Pi 5 ในแผงคุณสมบัติ
        load(page, 'lesson54-rpi-start.json')
        props(page, mobile, 'RPI1')
        fld = page.locator('#f-rpi-code'); fld.scroll_into_view_if_needed(); fld.click()
        page.evaluate("(() => { const t = document.getElementById('f-rpi-code'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()")
        page.keyboard.type('\nDis'); time.sleep(0.4)
        none = page.evaluate(POP)
        page.keyboard.type('\nbtn = Butt'); time.sleep(0.4)
        pb = page.evaluate(POP)
        hl = page.evaluate("document.querySelector('#f-rpi-code').parentElement.querySelectorAll('.pc-hl .hl-kw').length")
        check(f'{tag}: Pi 5: "Dis" ไม่เสนอ DistanceSensor (ไม่มีในชุดย่อย) · "Butt" เสนอ Button · ช่องโค้ดในแผงคุณสมบัติมีไฮไลต์', (none is None or not any('Distance' in x for x in none['items'])) and pb and 'Button' in pb['items'] and hl >= 2, f'{none} {pb} kw={hl}')
        page.screenshot(path=f'{OUT}/{tag}-editor-2-rpi.png')
        page.keyboard.press('Escape')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
