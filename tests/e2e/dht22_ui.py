"""E2E: DHT22 (AM2302) อุณหภูมิ/ความชื้นอากาศ + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดแลป 41 → Run → โค้ด MicroPython (โมดูล dht) พิมพ์ 30.0 °C 65.0 %RH ทุก 2 s · แผงผล (ค่าที่ส่ง, ตัวต้านทานดึงขึ้น)
→ ปุ่ม "ร้อนชื้น" 37 °C 90 % → อ่านตาม LED เตือนติด → "เย็นแห้ง" → LED ดับ → "ปกติ" → แลป 41 ครบ 7 ข้อ มีรูปวงจร
→ ถอดตัวต้านทานดึงขึ้น → read error + คำเตือน → Undo อ่านได้อีก → ป้ายขา "U1 · ขา 2 DATA" → วาง DHT22 ใหม่จากคลัง · ไม่มี JavaScript error
ใช้: python3 tests/e2e/dht22_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson41-dht22.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def toggle(page, mobile, sw):
    open_props(page, mobile, sw)
    page.click('#props .btn-row button'); time.sleep(0.3)
    if mobile: close_drawers(page)

LAST = """(() => { const m = [...(circuitLab.picoConsole || '').matchAll(/T = (-?[\\d.]+) C {2}RH = ([\\d.]+) %/g)]; return m.length ? [Number(m[m.length - 1][1]), Number(m[m.length - 1][2])] : null; })()"""
LED = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.LED1 ? s.analysis.parts.LED1.current : null; })()"

def wait_read(page, t, h, timeout=90000):
    try: page.wait_for_function(f"(() => {{ const r = {LAST}; return !!r && r[0] === {t} && r[1] === {h}; }})()", timeout=timeout, polling=300)
    except Exception: pass
    return page.evaluate(LAST)

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile: page.click('#btn-right'); time.sleep(0.5)

def preset(page, mobile, t):
    props(page, mobile, 'U1')
    page.click(f'#f-dht-{t}'); time.sleep(0.3)
    if mobile: close_drawers(page)

def goals(page, mobile, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("DHT22")').count(): page.click('.lesson-card:has-text("DHT22")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if mobile else None
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        check(f'{tag}: เปิดไฟล์แลป 41 (schema 39) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0 and page.evaluate("circuitLab.doc.parts.some(p => p.kind === 'dht22')"), page.inner_text('#status-msg'))
        goals(page, mobile, 0, 1000)  # เปิดแลป 41 ก่อน Run
        if mobile: close_drawers(page)
        page.click('#btn-run')
        r = wait_read(page, 30, 65)
        check(f'{tag}: Run → Pico อ่าน DHT22 ได้ 30.0 °C 65.0 %RH (โมดูล dht ของ MicroPython)', r == [30, 65], str(r) + ' | ' + page.evaluate("(circuitLab.picoConsole || '').slice(-80)").replace('\n', ' | '))
        props(page, mobile, 'U1')
        try: page.wait_for_function("document.getElementById('props').innerText.includes('ค่าที่ส่งล่าสุด')", timeout=15000, polling=250)
        except Exception: pass
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        k = txt.find('ค่าที่ส่งล่าสุด')
        check(f'{tag}: แผงผลแสดงค่าที่ส่ง 30.0 °C · 65.0 %RH และตัวต้านทานดึงขึ้น 10 kΩ', k >= 0 and '30.0 °C · 65.0 %RH' in txt and re.search(r'ตัวต้านทานดึงขึ้น DATA\s+10', txt) is not None, txt[k:k + 200].replace('\n', ' | '))
        preset(page, mobile, 37)
        r = wait_read(page, 37, 90)
        try: page.wait_for_function(f"(() => {{ const i = {LED}; return i !== null && i > 1e-3; }})()", timeout=20000, polling=300)
        except Exception: pass
        led = page.evaluate(LED)
        check(f'{tag}: ปุ่ม "ร้อนชื้น" → อ่านได้ 37 °C 90 %RH และ LED เตือนติด', r == [37, 90] and led is not None and led > 1e-3, f'{r} {led}')
        focus(page, 'j22', 12)
        page.screenshot(path=f'{OUT}/{tag}-dht-1-hot.png')
        preset(page, mobile, 20)
        r = wait_read(page, 20, 40)
        try: page.wait_for_function(f"(() => {{ const i = {LED}; return i !== null && i < 1e-5; }})()", timeout=20000, polling=300)
        except Exception: pass
        led = page.evaluate(LED)
        check(f'{tag}: ปุ่ม "เย็นแห้ง" → อ่านได้ 20 °C 40 %RH และ LED ดับ', r == [20, 40] and led is not None and led < 1e-5, f'{r} {led}')
        preset(page, mobile, 28)
        r = wait_read(page, 28, 60)
        g = goals(page, mobile, 7)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('DHT22') && s.innerHTML.includes('10 kΩ'); })()")
        check(f'{tag}: ปุ่ม "ปกติ" → แลป 41 ผ่านครบ 7 ข้อ มีรูปวงจร (DHT22, R1 10 kΩ)', r == [28, 60] and len(g) == 7 and svg_ok, f'{r} {g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-dht-2-lesson.png')
        if mobile: close_drawers(page)
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts = doc.parts.filter(p => p.id !== 'R1'); doc.wires = doc.wires.filter(w => w.id !== 'wpu'); app.apply({ ok: true, doc, warnings: [] }, 'ถอดตัวต้านทานดึงขึ้น'); }""")
        try: page.wait_for_function("(circuitLab.picoConsole || '').split('read error').length > 1 && circuitLab.freshSim && circuitLab.freshSim.analysis.diagnostics.some(d => d.partId === 'U1' && d.message.includes('ดึงขึ้น'))", timeout=60000, polling=300)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole || ''")
        dg = page.evaluate("circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics.filter(d => d.partId === 'U1').map(d => d.message.slice(0, 50)) : []")
        check(f'{tag}: ถอดตัวต้านทานดึงขึ้น → console "read error" และคำเตือนไม่มีตัวต้านทานดึงขึ้น', 'read error' in con and any('ดึงขึ้น' in d for d in dg), f"{con[-60:]!r} {dg}")
        n0 = page.evaluate("(circuitLab.picoConsole || '').length")
        page.evaluate("circuitLab.undo()")
        try: page.wait_for_function(f"/T = 28\\.0 C {{2}}RH = 60\\.0 %/.test((circuitLab.picoConsole || '').slice({n0}))", timeout=60000, polling=300)
        except Exception: pass
        ok = page.evaluate(f"/T = 28\\.0 C {{2}}RH = 60\\.0 %/.test((circuitLab.picoConsole || '').slice({n0}))")
        check(f'{tag}: Undo (ใส่ตัวต้านทานคืน) → อ่านได้อีก', ok and page.evaluate("circuitLab.doc.parts.some(p => p.id === 'R1')"), str(ok))
        page.click('#btn-stop'); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'U1', pin: 'DATA'}); v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 9, w.z + 12); v.controls.update(); v.requestRender(); }""")
        cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'DATA'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา 2 → ป้าย "U1 · ขา 2 DATA"', t is not None and t.startswith('U1 · ขา 2 DATA'), str(t))
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("DHT22")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'j26', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'j26'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'dht22').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'dht22').map(p => p.placement.anchor)")
        check(f'{tag}: วาง DHT22 ตัวใหม่จากคลังที่ j26', len(n) == 2 and 'j26' in n, f"{n} {page.inner_text('#status-msg')}")
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
