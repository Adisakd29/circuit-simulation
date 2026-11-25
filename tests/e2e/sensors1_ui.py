"""E2E เซนเซอร์ชุด 1 (รอบ 87) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
1) คลังอุปกรณ์: ค้นหาแต่ละชนิด (12 ชนิด) → แตะรู → เสียบได้ · โมเดล 3 มิติมีปลายขาครบและชื่อตรงกับข้อมูลขา
2) เปิดไฟล์ตั้งต้น (Pico + เซนเซอร์ 11 ตัว + โค้ด MicroPython) → Run → ค่าเริ่มต้นในคอนโซลถูกต้อง
3) ใช้แผงคุณสมบัติ: จุดไฟหน้าโมดูลเปลวไฟ, แตะ TTP223, ปรบมือหน้าโมดูลเสียง, วางแม่เหล็กหน้า Hall, ปิดประตู (รีด), ตะแคงสวิตช์เอียง, เปียก, กด FSR
   → ค่าในคอนโซลของ Pico เปลี่ยนตาม · LED DO บนโมดูล 3 มิติติด · แถว "ค่าจากการจำลอง" แสดงขา DO
4) ไม่มี JavaScript error
ใช้: python3 tests/e2e/sensors1_ui.py <out-dir> [url] [desktop,mobile]
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

KINDS = [  # kind, คำค้น, รูที่แตะ
    ('flame', 'เปลวไฟ', 'j10'), ('soundsensor', 'ky-038', 'j10'), ('rainsensor', 'น้ำฝน', 'j10'), ('mq2', 'mq-2', 'j10'),
    ('linetrack', 'tcrt5000', 'j10'), ('vibsensor', 'sw-420', 'j10'), ('touch', 'ttp223', 'j10'), ('hall', 'a3144', 'j10'),
    ('reed', 'reed', 'c10'), ('tilt', 'sw-520d', 'c10'), ('waterlevel', 'ระดับน้ำ', 'j10'), ('fsr', 'fsr', 'j10'),
]

M4 = ['VCC', 'GND', 'DO', 'AO']
PINS = {'flame': M4, 'soundsensor': M4, 'rainsensor': M4, 'mq2': M4, 'linetrack': M4, 'vibsensor': ['VCC', 'GND', 'DO'], 'touch': ['GND', 'VCC', 'IO'],
        'hall': ['VCC', 'GND', 'OUT'], 'reed': ['1', '2'], 'tilt': ['1', '2'], 'waterlevel': ['S', '+', '-'], 'fsr': ['1', '2']}

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def console_lines(page):
    txt = page.evaluate("circuitLab.picoConsole || ''") or ''
    return [l for l in txt.split('\n') if re.match(r'^F \d', l.strip())]

def field(line, k, n=1):
    t = line.strip().split()
    i = t.index(k)
    return [int(x) for x in t[i + 1:i + 1 + n]]

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

        # 1) วางจากคลังทีละชนิด
        for kind, q, hole in KINDS:
            fresh(page)
            if mobile: page.click('#btn-left'); time.sleep(0.3)
            page.fill('#lib-search', q); time.sleep(0.3)
            loc = page.locator(f'.lib-item[data-kind="{kind}"]')
            name = loc.first.inner_text().split('\n')[0] if loc.count() else ''
            if loc.count(): loc.first.click(); time.sleep(0.3)
            if mobile:
                try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
                except Exception: close_drawers(page)
                time.sleep(0.4)
            focus(page, hole, 22)
            p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': hole})
            tap(p['x'], p['y'])
            try: page.wait_for_function(f"circuitLab.doc.parts.some(p => p.kind === '{kind}')", timeout=5000)
            except Exception: pass
            m = page.evaluate("""(kind) => { const p = circuitLab.doc.parts.find(p => p.kind === kind); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id);
              const tips = []; g.traverse((o) => { if (typeof o.userData.leadTip === 'string') tips.push(o.userData.leadTip); });
              return { anchor: p.placement.anchor, tips: tips.sort().join(',') }; }""", kind)
            want = ','.join(sorted(PINS[kind]))
            ok = bool(m) and m['anchor'] == hole and m['tips'] == want
            check(f'{tag}: คลัง "{q}" → {kind} ({name.strip()[:34]}) → แตะรู {hole} → เสียบได้ · ปลายขาในโมเดลตรงข้อมูลขา', ok, str(m) + f' want={want}')
            if kind in ('flame', 'mq2', 'touch', 'hall', 'reed', 'fsr'): page.screenshot(path=f'{OUT}/{tag}-sensors1-1-{kind}.png')

        # 2) เปิดไฟล์ตั้งต้น + Run
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'sensors1-start.json')); time.sleep(1.5)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(() => { const t = circuitLab.picoConsole || ''; return (t.match(/\\nF \\d/g) || []).length >= 2; })()", timeout=120000)
        except Exception: pass
        L = console_lines(page)
        b0 = L[-1] if L else ''
        ok0 = bool(b0) and field(b0, 'F', 2)[0] == 1 and field(b0, 'T')[0] == 0 and field(b0, 'H')[0] == 1 and field(b0, 'K')[0] == 1 and field(b0, 'D')[0] == 0 and field(b0, 'R')[0] == 1 and field(b0, 'P')[0] < 1000
        check(f'{tag}: เปิดไฟล์ Pico + เซนเซอร์ 11 ตัว → Run → ค่าเริ่มต้นในคอนโซล (ไม่มีไฟ ไม่แตะ ไม่มีแม่เหล็ก แห้ง ไม่กด)', ok0, b0)
        an = page.evaluate("(() => circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics.filter(d => d.severity === 'danger').map(d => d.message) : null)()")
        check(f'{tag}: ไม่มีคำเตือนอันตรายในวงจรตั้งต้น', an == [], str(an))
        page.screenshot(path=f'{OUT}/{tag}-sensors1-2-run.png')

        # 3) ใช้แผงคุณสมบัติ
        def act(pid, sel, kind='click'):
            props(page, mobile, pid)
            try:
                page.locator(sel).first.scroll_into_view_if_needed(timeout=3000)
                if kind == 'check': page.locator(sel).first.check()
                else: page.locator(sel).first.click()
            except Exception as e: errors.append(f'{pid} {sel}: {e}')
            time.sleep(0.3)
            if mobile: close_drawers(page)
        act('FL', '#f-flame', 'check')
        act('TC', '#f-touched', 'check')
        act('HL', '#f-magnet', 'check')
        act('RD', '#f-door-close')
        act('TL', '#f-tilt-90')
        act('RN', '#f-rain-60')
        act('FS', '#f-force-10')
        act('SD', '#f-sound', 'check')
        # Hall: ระยะเริ่มต้น 20 mm (≈ 40 G) ไม่ถึงจุดทำงาน → เลื่อนเข้า 5 mm ผ่านแถบเลื่อน
        props(page, mobile, 'HL')
        page.evaluate("(() => { const s = document.getElementById('f-distance'); s.value = '5'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()")
        time.sleep(0.3)
        if mobile: close_drawers(page)
        n0 = len(console_lines(page))
        try: page.wait_for_function(f"(() => {{ const t = circuitLab.picoConsole || ''; return (t.match(/\\nF \\d/g) || []).length >= {n0 + 3}; }})()", timeout=180000)
        except Exception: pass
        L = console_lines(page)
        a0 = L[-1] if L else ''
        st = {k: field(a0, k)[0] for k in ['T', 'H', 'K', 'D', 'R', 'S']} if a0 else {}
        fl = field(a0, 'F', 2) if a0 else [None, None]
        ok1 = bool(a0) and fl[0] == 0 and abs(fl[1] - 65535 / (1 + (50 / 30) ** 2)) < 1500 and st['T'] == 1 and st['H'] == 0 and st['K'] == 0 and st['D'] == 1 and st['R'] == 0 and st['S'] > 5 and abs(field(a0, 'P')[0] - 65535 * 10 / 11) < 1500
        check(f'{tag}: แผงคุณสมบัติ (ไฟ แตะ แม่เหล็ก ปิดประตู ตะแคง ฝน กด เสียง) → ค่าในคอนโซล Pico เปลี่ยนตามทั้งหมด', ok1, a0)
        leds = page.evaluate("""(() => { const o = (id, k) => { const g = circuitLab.view.partObjs.get(id); const m = g && g.userData[k]; return m ? m.emissiveIntensity : -1; };
          return { flDo: o('FL', 'ledDo'), flPow: o('FL', 'ledPower'), rnDo: o('RN', 'ledDo'), tc: o('TC', 'touchLed'), vbDo: o('VB', 'ledDo') }; })()""")
        check(f'{tag}: โมเดล 3 มิติ: LED ไฟเลี้ยงและ LED DO ของโมดูลเปลวไฟ/ฝนติด · LED TTP223 ติด · SW-420 นิ่ง (LED DO ติดตามวงจรจริง)', leds['flDo'] > 0 and leds['flPow'] > 0 and leds['rnDo'] > 0 and leds['tc'] > 0 and leds['vbDo'] > 0, str(leds))
        props(page, mobile, 'FL')
        rd = page.inner_text('#prop-readings') if page.locator('#prop-readings').count() else ''
        check(f'{tag}: แถวค่าจากการจำลองของโมดูลเปลวไฟแสดง ขา DO ต่ำ + ขา AO', 'ขา DO' in rd and 'ต่ำ' in rd and 'ขา AO' in rd, rd[:160].replace('\n', ' '))
        page.screenshot(path=f'{OUT}/{tag}-sensors1-3-props.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
