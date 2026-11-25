"""E2E แลป 48 สถานีตรวจอากาศ (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (Pico + LCD 16×2 I²C บนโต๊ะ + BMP280 + BH1750 — บอร์ด LCD ยังมีตัวต้านทานดึงขึ้นไป 5 V) → แลป 48 → "ใส่โค้ดตัวอย่างลง Pico" → Run
→ scan พบ 0x23 0x27 0x76 · แผงผลเตือนอันตราย SDA 5 V → ถอดตัวต้านทานดึงขึ้นในแผงจอ → SDA ≈ 3.3 V คำเตือนหาย
→ จอในฉากแสดงอักษร (พิกเซลสว่างบนพื้นน้ำเงิน) · ข้อความบนจอ = T 30.0°C / 300lx / 1008.0 hPa
→ ตั้งแสง BH1750 = 1000 lx → จอเปลี่ยน · ทริมพอต 30% → ตัวอักษรหาย · กลับ 90% · ถอดจัมเปอร์ไฟพื้นหลัง → พื้นมืด
→ แลป 48 ผ่านครบ 7 ข้อ มีรูปวงจร · ไม่มี JavaScript error
ใช้: python3 tests/e2e/weather_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props, goals, kv

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson48-weather-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

DIAG = "(() => { const s = circuitLab.freshSim; return s ? s.analysis.diagnostics.map(d => d.severity + ':' + d.message).join(' | ') : ''; })()"
# สัดส่วนพิกเซลสว่าง (ตัวอักษรขาว) และความสว่างเฉลี่ยของพื้นบนแคนวาสจอในฉาก
CANVAS = """(() => { const c = circuitLab.view.partObjs.get('LCD1').userData.lcdCanvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bright = 0, sum = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++; sum += d[i + 2]; }
  return { bright: bright / (d.length / 4), blue: sum / (d.length / 4) }; })()"""
WAIT_TEXT = "(re) => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความบนจอ')); return !!dt && new RegExp(re).test(dt.nextElementSibling.textContent); }"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        goals(page, mobile, 'สถานีตรวจอากาศ', 0, 1000)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed()
        page.click('#lesson-sample-code'); time.sleep(0.4)
        code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.code")
        check(f'{tag}: ปุ่มโค้ดตัวอย่างใส่โค้ดแลป 48 (I2cLcd + BMP280 + BH1750)', 'I2cLcd' in code and '0xF7' in code and 'BH' in code, f'{len(code)}')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.picoConsole && circuitLab.picoConsole.includes('I2C:')", timeout=90000, polling=400)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole")
        diag = page.evaluate(DIAG)
        check(f"{tag}: scan พบ ['0x23', '0x27', '0x76'] · ตัวต้านทานดึงขึ้นบนบอร์ด LCD (5 V) → เตือนอันตราย SDA เกิน 3.3 V", "I2C: ['0x23', '0x27', '0x76']" in con and 'danger:' in diag and 'ถอดตัวต้านทานดึงขึ้น' in diag, f'{con[-80:]!r} {diag[:160]!r}')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        # ถอดตัวต้านทานดึงขึ้น
        props(page, mobile, 'LCD1')
        page.locator('#f-pullups').scroll_into_view_if_needed()
        page.click('#f-pullups'); time.sleep(1.5)
        props(page, mobile, 'LCD1')
        vs = kv(page, 'แรงดัน SDA')
        diag = page.evaluate(DIAG)
        m = re.match(r'\s*([\d.]+)', vs or '')
        check(f'{tag}: ถอดตัวต้านทานดึงขึ้นบนบอร์ด LCD → SDA ≈ 3.3 V และไม่มีคำเตือนอันตราย', m and float(m[1]) < 3.4 and 'danger:' not in diag, f'{vs!r} {diag[:120]!r}')
        try: page.wait_for_function(WAIT_TEXT, arg='1008\\.0 hPa', timeout=30000, polling=300)
        except Exception: pass
        txt = kv(page, 'ข้อความบนจอ')
        if mobile: close_drawers(page)
        # จอในฉาก
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('LCD1'); const p = g.position; v.controls.target.set(p.x, 2, p.z); v.persp.position.set(p.x, 26, p.z + 18); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        cv = page.evaluate(CANVAS)
        check(f'{tag}: จอแสดง "T 30.0°C   300lx" และ "P  1008.0 hPa" (จาก DDRAM ที่จำลอง) · จอในฉากมีจุดอักษรสว่างบนพื้นน้ำเงิน', 'T 30.0°C   300lx' in (txt or '') and 'P  1008.0 hPa' in (txt or '') and cv['bright'] > 0.03 and cv['blue'] > 150, f'{txt!r} {cv}')
        page.screenshot(path=f'{OUT}/{tag}-weather-1-lcd.png')
        # แสง 1000 lx
        props(page, mobile, 'BH1')
        page.locator('#f-lux-1000').scroll_into_view_if_needed(); page.click('#f-lux-1000'); time.sleep(0.3)
        if mobile: close_drawers(page)
        props(page, mobile, 'LCD1')
        try: page.wait_for_function(WAIT_TEXT, arg='1000lx', timeout=30000, polling=300)
        except Exception: pass
        txt = kv(page, 'ข้อความบนจอ')
        check(f'{tag}: ตั้งแสงที่ BH1750 = 1000 lx → จอแสดง 1000lx', '1000lx' in (txt or ''), txt)
        # ทริมพอตความคมชัด 30% → หาย, 90% → กลับ
        page.locator('#f-contrast').scroll_into_view_if_needed()
        page.fill('#f-contrast', '30'); page.dispatch_event('#f-contrast', 'change'); time.sleep(1.0)
        low = page.evaluate(CANVAS)
        props(page, mobile, 'LCD1')
        page.locator('#f-contrast').scroll_into_view_if_needed()
        page.fill('#f-contrast', '90'); page.dispatch_event('#f-contrast', 'change'); time.sleep(1.0)
        hi = page.evaluate(CANVAS)
        check(f'{tag}: ทริมพอต 30% → ตัวอักษรหาย · 90% → กลับมา', low['bright'] < 0.002 and hi['bright'] > 0.03, f'{low} {hi}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'สถานีตรวจอากาศ', 7, 60000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('BMP280') && s.innerHTML.includes('LCD'); })()")
        check(f'{tag}: แลป 48 ผ่านครบ 7 ข้อ (wire bus text temp pressure lux update) และมีรูปวงจร', len(g) == 7 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-weather-2-lesson.png')
        if mobile: close_drawers(page)
        # ถอดจัมเปอร์ไฟพื้นหลัง
        props(page, mobile, 'LCD1')
        page.locator('#f-bljumper').scroll_into_view_if_needed()
        page.click('#f-bljumper'); time.sleep(1.0)
        if mobile: close_drawers(page)
        dark = page.evaluate(CANVAS)
        check(f'{tag}: ถอดจัมเปอร์ไฟพื้นหลัง → พื้นจอมืดลง', dark['blue'] < 110, str(dark))
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(8, 0, 14); v.persp.position.set(8, 55, 75); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-weather-3-overview.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
