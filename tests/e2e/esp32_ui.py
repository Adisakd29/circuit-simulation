"""E2E ESP32-DevKitC V4 (QEMU บนเซิร์ฟเวอร์) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch · ต้องรันเซิร์ฟเวอร์ API ที่ตั้งค่า ESP32_* แล้ว
1) คลังอุปกรณ์ → "ESP32-DevKitC V4" → แตะรู j3 → J2 ที่แถว j และ J3 ที่แถว b (บอร์ดกว้าง 1 นิ้ว)
2) เปิดวงจร ESP32 บนโต๊ะ + LED ที่ IO2 + ตัวต้านทานปรับค่าที่ IO34 → แผงคุณสมบัติ "จำลองบางส่วน" + บอกว่าทำงานบนเซิร์ฟเวอร์/ข้อจำกัด
   Run → (ตัวจำลองวงจร + QEMU บนเซิร์ฟเวอร์) banner MicroPython ESP32 · LED1 กะพริบ · ADC อ่านตัวต้านทานปรับค่ากลางช่วง ≈ 2048 · แท็บ "ESP32 (MicroPython · QEMU)"
3) หมุนตัวต้านทานปรับค่าไปปลาย 3.3 V ระหว่างจำลอง → ค่า ADC ที่โค้ดพิมพ์ขึ้นถึง ≈ 4095 · หยุด → เซิร์ฟเวอร์ปิดเซสชัน · ไม่มี JavaScript error
ใช้: python3 tests/e2e/esp32_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

LED = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.LED1 ? s.analysis.parts.LED1.current : null; })()"

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
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
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.25)

        # 1) วางจากคลัง
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'devkitc'); time.sleep(0.3)
        page.click('.lib-item[data-kind="esp32devkitc"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'j3', 26)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'j3'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'esp32devkitc')", timeout=5000)
        except Exception: pass
        m = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'esp32devkitc'); return p ? p.placement : null; })()")
        check(f'{tag}: คลังอุปกรณ์ → ESP32-DevKitC → แตะรู j3 → เสียบเบรดบอร์ด (J2 แถว j)', m and m.get('anchor') == 'j3', str(m))
        page.screenshot(path=f'{OUT}/{tag}-esp-1-placed.png')

        # 2) วงจรบนโต๊ะ + รันบนเซิร์ฟเวอร์
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'esp32-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'ESP1')
        note = page.inner_text('#f-esp-mode') if page.locator('#f-esp-mode').count() else ''
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกว่าจำลองด้วย QEMU บนเซิร์ฟเวอร์ และไม่จำลอง Wi-Fi/Bluetooth', 'จำลองบางส่วน' in st and 'QEMU' in note and 'เซิร์ฟเวอร์' in note and 'Wi-Fi/Bluetooth' in note, (st[:40] + ' | ' + note[:80]).replace('\n', ' '))
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('IO34 =')", timeout=120000, polling=500)
        except Exception: pass
        on = off = False; t0 = time.time()
        while time.time() - t0 < 8 and not (on and off):
            i = page.evaluate(LED)
            if i is not None: on = on or i > 1e-3; off = off or i < 1e-6
            time.sleep(0.15)
        con = page.evaluate("circuitLab.picoConsole || ''")
        tab = page.inner_text('#dock-tab-pico') if page.locator('#dock-tab-pico').count() else ''
        adc = [int(x) for x in re.findall(r'IO34 = (\d+)', con)]
        check(f'{tag}: Run → banner MicroPython ESP32 (QEMU บนเซิร์ฟเวอร์) · LED1 ที่ IO2 กะพริบ · ADC IO34 ≈ 2048 · แท็บ "ESP32 (MicroPython · QEMU)"',
              'Generic ESP32 module with ESP32' in con and on and off and adc and abs(adc[-1] - 2048) < 120 and 'ESP32' in tab, f'{on} {off} {adc[-3:]} {tab!r} {con[-80:]!r}')
        page.screenshot(path=f'{OUT}/{tag}-esp-2-run.png')

        # 3) หมุนตัวต้านทานปรับค่าระหว่างจำลอง
        page.evaluate("""() => { const a = circuitLab; const d = structuredClone(a.doc); d.parts.find(p => p.id === 'VR1').params.position = 1; a.apply({ ok: true, doc: d, warnings: [] }, 'หมุน VR1'); }""")
        n0 = len(adc)
        try: page.wait_for_function(f"(((circuitLab.picoConsole || '').match(/IO34 = \\d+/g)) || []).length >= {n0 + 4}", timeout=60000, polling=500)
        except Exception: pass
        adc2 = [int(x) for x in re.findall(r'IO34 = (\d+)', page.evaluate("circuitLab.picoConsole || ''"))][n0:]
        check(f'{tag}: หมุนตัวต้านทานปรับค่าไปปลาย 3.3 V ระหว่างจำลอง → ADC ที่ ESP32 อ่านขึ้นถึง ≈ 4095', adc2 and max(adc2) > 4000, str(adc2[:8]))
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(1.5)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
