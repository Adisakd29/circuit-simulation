"""E2E Arduino Nano (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile
1) คลังอุปกรณ์ → Arduino Nano → แตะรู h3 → เสียบคร่อมร่องกลาง (ขา 1 = h3, D13 = d17, VIN = d3) · โมเดล 3 มิติมีชิป/หัว USB · ป้ายชื่อขาทั้งหมดแสดงขาของ Nano
2) แลป 55: ใส่โค้ดตัวอย่าง → คอมไพล์ + อัปโหลด (คอมไพล์เป็นบอร์ด Nano) → Run → แท็บ "Arduino Nano (C++)" · Serial Monitor แสดง A7 ตามตำแหน่ง VR และ dA7=0
3) หมุน VR 20% / 80% → LED หรี่/สว่าง · ตรวจผลแลปผ่าน place, pot, led, upload, pwm · ไม่มี JavaScript error
ใช้: python3 tests/e2e/nano_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props, goals

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def set_pos(page, mobile, v):
    props(page, mobile, 'VR1')
    page.evaluate(f"(() => {{ const s = document.getElementById('f-pos'); s.value = String({int(v * 1000)}); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }})()"); time.sleep(0.3)
    if mobile: close_drawers(page)

def last_a7(page):
    con = page.evaluate("circuitLab.unoConsole || ''")
    m = re.findall(r'A6=(\d+) A7=(\d+) dA7=(\d)', con)
    return m[-1] if m else None

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        # 1) วางจากคลังอุปกรณ์
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'nano'); time.sleep(0.3)
        page.click('.lib-item[data-kind="nano"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h9', 30)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'nano')", timeout=5000)
        except Exception: pass
        nano = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'nano'); return p ? { id: p.id, pl: p.placement } : null; })()")
        check(f'{tag}: คลังอุปกรณ์ → Arduino Nano → แตะรู h3 → เสียบคร่อมร่องกลาง (anchor h3)', nano and nano['pl'].get('anchor') == 'h3', str(nano))
        nid = nano['id'] if nano else 'NANO1'
        model = page.evaluate(f"""(() => {{ const g = circuitLab.view.partObjs.get('{nid}'); if (!g) return null; let n = 0, tips = []; g.traverse(o => {{ if (o.isMesh) n++; if (o.userData.leadTip) tips.push(o.userData.leadTip); }});
          return {{ meshes: n, tips: tips.length, d13: tips.includes('D13'), a7: tips.includes('A7'), led: !!g.userData.picoLed }}; }})()""")
        check(f'{tag}: โมเดล 3 มิติของ Nano: ขาโลหะ 30 ขา (ชื่อตรงกับขา) + LED L ที่สว่างตาม D13', model and model['tips'] == 30 and model['d13'] and model['a7'] and model['led'], str(model))
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')
        time.sleep(0.8)
        labs = page.evaluate("circuitLab.view.visiblePinLabels().map(l => l.pin)")
        check(f'{tag}: ปุ่มชื่อขาทั้งหมด → ป้ายชื่อขาของ Nano (เช่น D13, A7, 5V) บนพื้นที่ทำงาน', {'D13', 'A7', '5V'} <= set(labs), str(labs[:20]))
        page.screenshot(path=f'{OUT}/{tag}-nano-1-placed.png')
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')

        # 2) แลป 55
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'lesson55-nano-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("Arduino Nano")').count(): page.click('.lesson-card:has-text("Arduino Nano")'); time.sleep(0.3)
        page.click('#lesson-sample-code'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'NANO1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        up = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'NANO1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, a7: p.code.includes('analogRead(A7)'), flash: p.flash, err: circuitLab.unoError }; })()")
        txt = page.inner_text('#f-uno-prog') if page.locator('#f-uno-prog').count() else ''
        check(f'{tag}: ใส่โค้ดตัวอย่าง → คอมไพล์ + อัปโหลดเป็นบอร์ด Nano (แฟลชสูงสุด 30,720 ไบต์)', up['hex'] and up['fresh'] and up['a7'] and not up['err'] and '30,720' in txt, f"{up} {txt[:90]!r}")
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.0)
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        tab = page.inner_text('#dock-tab-uno') if page.locator('#dock-tab-uno').count() else ''
        if page.locator('#dock-tab-uno').count(): page.click('#dock-tab-uno'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        try: page.wait_for_function("/A7=\\d+/.test(circuitLab.unoConsole || '')", timeout=40000, polling=300)
        except Exception: pass
        time.sleep(0.6)
        r = last_a7(page)
        st = page.inner_text('#un-status') if page.locator('#un-status').count() else ''
        check(f'{tag}: แท็บ "Arduino Nano (C++)" (แฟลช / 30,720 ไบต์) · Serial Monitor: A7 ≈ 512 (VR 50%), A6 ลอย/0, dA7=0', 'Arduino Nano' in tab and '30,720' in st and r and abs(int(r[1]) - 512) <= 6 and r[2] == '0', f'{tab!r} {st!r} {r}')
        page.screenshot(path=f'{OUT}/{tag}-nano-2-run.png')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        res = {}
        for v in (0.2, 0.8):
            set_pos(page, mobile, v)
            try: page.wait_for_function(f"(() => {{ const m = [...(circuitLab.unoConsole || '').matchAll(/A7=(\\d+)/g)]; return m.length && Math.abs(Number(m[m.length - 1][1]) - {int(v * 1023)}) <= 8; }})()", timeout=20000, polling=200)
            except Exception: pass
            time.sleep(0.8)
            res[v] = (last_a7(page), page.evaluate("Math.abs(circuitLab.freshSim?.analysis?.parts?.LED1?.current ?? 0)"))
        ok = res[0.2][0] and res[0.8][0] and abs(int(res[0.2][0][1]) - 205) <= 8 and abs(int(res[0.8][0][1]) - 818) <= 8 and res[0.8][1] > 2.5 * res[0.2][1] > 0
        check(f'{tag}: หมุน VR 20% → A7 ≈ 205 · 80% → A7 ≈ 818 · กระแส LED เฉลี่ยมากขึ้นตาม duty', ok, str(res))
        g = goals(page, mobile, 'Arduino Nano', 5)
        check(f'{tag}: ตรวจผลแลป 55 ผ่าน place, pot, led, upload, pwm', {'place', 'pot', 'led', 'upload', 'pwm'} <= set(g), str(g))
        page.screenshot(path=f'{OUT}/{tag}-nano-3-goals.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
