"""E2E: ไทริสเตอร์ SCR 2N5060 ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 34 (12 V → RL 1 kΩ → LED → A, K → ลบ · S1 → RG 10 kΩ → G, RGK 1 kΩ · S2 ลัด A–K) → Run → ดับ
→ ปิด S1 (แผงคุณสมบัติ) → ติด LED สว่างในฉาก → เปิด S1 → ยังติดค้าง แผงผล "ติดค้าง (ล็อก)" → ปิด/เปิด S2 → ดับ
→ แลป 34 ผ่านครบ 5 ข้อ มีรูปวงจร → ชี้/แตะขา G → ป้าย "SCR1 · ขา 2 G เกต" → โหลด 4.7 kΩ: ปล่อยเกตแล้วดับ
→ วาง SCR ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/scr_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson34-scr.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.SCR1) return null; const x = s.analysis.parts.SCR1.extra;
  const g = circuitLab.view.partObjs.get('LED1'); const sp = g && g.userData.glowSprite;
  return { on: x.on, ia: x.ia, ig: x.ig, vak: x.vak, led: s.analysis.parts.LED1.current, glow: sp ? sp.material.opacity : -1 }; })()"""

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

def wait_st(page, cond, timeout=20000):
    try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && ({cond}); }})()", timeout=timeout, polling=100)
    except Exception: pass
    return page.evaluate(ST)

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
        check(f'{tag}: เปิดไฟล์แลป 34 (schema 31) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        s = wait_st(page, 's.on === 0')
        check(f'{tag}: Run → SCR ดับ LED ไม่ติด (ยังไม่มีกระแสเกต)', s and s['on'] == 0 and s['led'] < 1e-6, str(s))
        toggle(page, mobile, 'S1')
        s = wait_st(page, 's.on === 1 && s.glow > 0.3')
        check(f'{tag}: ปิด S1 → กระแสเกต ≥ 200 µA SCR ติด LED ≈ 9 mA สว่างในฉาก VAK ≈ 0.9 V', s and s['on'] == 1 and s['ig'] > 2e-4 and 8e-3 < s['led'] < 10e-3 and 0.8 < s['vak'] < 1.0 and s['glow'] > 0.3, str(s))
        focus(page, 'c21', 18)
        page.screenshot(path=f'{OUT}/{tag}-scr-1-on.png')
        toggle(page, mobile, 'S1')
        s = wait_st(page, 's.ig < 1e-6')
        time.sleep(0.5); s = page.evaluate(ST)
        check(f'{tag}: เปิด S1 (ไม่มีกระแสเกต) → SCR ยังติดค้าง LED ยังติด', s and s['on'] == 1 and abs(s['ig']) < 1e-6 and s['led'] > 8e-3 and s['glow'] > 0.3, str(s))
        open_props(page, mobile, 'SCR1')
        time.sleep(0.4)
        txt = page.inner_text('#props')
        check(f'{tag}: แผงผลของ SCR แสดง "ติดค้าง (ล็อก)" IA และ IG', 'ติดค้าง (ล็อก)' in txt and 'IA แอโนด' in txt and 'IG เกต' in txt, txt[txt.find('สถานะ'):][:120].replace('\n', ' | '))
        if mobile: close_drawers(page)
        toggle(page, mobile, 'S2')
        s = wait_st(page, 's.on === 0')
        toggle(page, mobile, 'S2')
        time.sleep(0.8); s = page.evaluate(ST)
        check(f'{tag}: ปิด S2 (ลัด A–K) แล้วเปิด → SCR ดับ และไม่ติดเอง LED ดับในฉาก', s and s['on'] == 0 and s['led'] < 1e-6 and s['glow'] < 0.1, str(s))
        page.screenshot(path=f'{OUT}/{tag}-scr-2-off.png')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("ไทริสเตอร์ SCR")').count(): page.click('.lesson-card:has-text("ไทริสเตอร์ SCR")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=20000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 34 ผ่านครบ 5 ข้อ (circuit/gate/latch/off/rgk)', page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('SCR1') && s.innerHTML.includes('2N5060'); })()")
        check(f'{tag}: แลป 34 มีรูปวงจร (SCR1 2N5060)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-scr-3-lesson.png')
        if mobile: close_drawers(page)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'c21', 7)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'SCR1', 'pin': 'G'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขากลาง → ป้าย "SCR1 · ขา 2 G เกต"', t is not None and t.startswith('SCR1 · ขา 2 G เกต'), str(t))
        if not mobile: page.mouse.move(5, 450)
        # โหลดเบา 4.7 kΩ → IA ≈ 2 mA < IH: ติดเฉพาะตอนกดเกต
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts.find(p => p.id === 'RL').params.resistance = 4700; app.apply({ ok: true, doc, warnings: [] }, 'RL 4.7k'); }""")
        toggle(page, mobile, 'S1')
        s1 = wait_st(page, 's.on === 1')
        toggle(page, mobile, 'S1')
        s2 = wait_st(page, 's.on === 0')
        check(f'{tag}: โหลด 4.7 kΩ (IA < IH 5 mA) → ติดเฉพาะตอนปิด S1 ปล่อยแล้วดับ', s1 and s1['on'] == 1 and abs(s1['ia']) < 5e-3 and s2 and s2['on'] == 0, f'{s1} → {s2}')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ไทริสเตอร์ SCR")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h6', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h6'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'scr').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'scr').map(p => p.placement.anchor)")
        check(f'{tag}: วาง SCR ตัวใหม่จากคลังที่ h6', len(n) == 2 and 'h6' in n, str(n))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
