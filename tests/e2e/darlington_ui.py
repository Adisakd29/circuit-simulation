"""E2E: ทรานซิสเตอร์ดาร์ลิงตัน TIP120 ขับมอเตอร์ ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 38 (6 V, มอเตอร์ TT, ไดโอด 1N4007, RB 10 kΩ, S1 เปิด) → Run → มอเตอร์หยุด → ปิด S1 → มอเตอร์เร่ง ≈ 210 rpm ล้อหมุนในฉาก
แผงผล Q1 "อิ่มตัว" IB ≈ 0.45 mA → แลป 38 ข้อบังคับ → เปิด S1 หยุด → RB 100 kΩ (ช่องค่า) ปิด S1 → ไม่นำ → 6/6
→ ติดแผ่นระบายความร้อน (13 °C/W) → ป้ายขา "Q1 · ขา 1 B" → วาง TIP120 ใหม่จากคลัง
ใช้: python3 tests/e2e/darlington_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson38-darlington.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.Q1) return null; const x = s.analysis.parts.Q1.extra, m = s.analysis.parts.M1.extra;
  return { ic: x.ic, ib: x.ib, vbe: x.vbe, vce: x.vce, region: x.region, rth: x.rth, rpm: m ? m.rpm : null, ang: m ? m.angle : null }; })()"""

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
        check(f'{tag}: เปิดไฟล์แลป 38 (schema 35) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        s = wait_st(page, 's.rpm !== null')
        time.sleep(0.5); s = page.evaluate(ST)
        check(f'{tag}: Run (S1 เปิด) → TIP120 ไม่นำ มอเตอร์หยุด', s and s['ic'] < 1e-3 and abs(s['rpm']) < 1, str(s))
        toggle(page, mobile, 'S1')
        s = wait_st(page, 's.rpm > 190', 30000)
        a0 = s and s['ang']; time.sleep(0.5); s = page.evaluate(ST)
        check(f'{tag}: ปิด S1 → IB ≈ 0.45 mA ขับ IC ≈ 0.16 A มอเตอร์ ≈ 210 rpm ล้อหมุนในฉาก', s and 0.4e-3 < s['ib'] < 0.5e-3 and 0.14 < s['ic'] < 0.18 and 190 < s['rpm'] < 230 and s['ang'] != a0, str(s))
        open_props(page, mobile, 'Q1'); time.sleep(0.4)
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        check(f'{tag}: แผงผล Q1 แสดง "อิ่มตัว" VBE ≈ 1.4 V VCE < 1.2 V IC/IB > 100', s and 'อิ่มตัว' in txt and 'IC / IB' in txt and 1.2 < s['vbe'] < 1.6 and s['vce'] < 1.2, txt[txt.find('ย่านทำงาน'):][:160].replace('\n', ' | '))
        focus(page, 'c21', 16)
        page.screenshot(path=f'{OUT}/{tag}-tip-1-run.png')
        toggle(page, mobile, 'S1')
        s = wait_st(page, 'Math.abs(s.rpm) < 3', 30000)
        check(f'{tag}: เปิด S1 → IC ≈ 0 มอเตอร์หยุด', s and s['ic'] < 1e-3 and abs(s['rpm']) < 3, str(s))
        open_props(page, mobile, 'RB')
        fld = page.locator('#f-resistance'); fld.fill('100k'); fld.press('Enter'); time.sleep(0.4)
        if mobile: close_drawers(page)
        toggle(page, mobile, 'S1')
        time.sleep(1.5); s = page.evaluate(ST)
        check(f'{tag}: RB 100 kΩ (ช่องค่า) ปิด S1 → IB ≈ 50 µA ไหลผ่าน R ภายใน TIP120 ไม่นำ มอเตอร์ไม่หมุน', s and s['ic'] < 1e-2 and s['ib'] < 1e-4 and abs(s['rpm']) < 3, str(s))
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("TIP120")').count(): page.click('.lesson-card:has-text("TIP120")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 6", timeout=20000, polling=250)
        except Exception: pass
        g = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
        check(f'{tag}: แลป 38 ผ่านครบ 6 ข้อ (wiring/flyback/run/measure/off/minib)', len(g) == 6, str(g))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('TIP120') && s.innerHTML.includes('1N4007'); })()")
        check(f'{tag}: แลป 38 มีรูปวงจร (สัญลักษณ์ดาร์ลิงตัน TIP120, ไดโอด)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-tip-2-lesson.png')
        if mobile: close_drawers(page)
        open_props(page, mobile, 'Q1')
        page.click('#f-heatsink'); time.sleep(0.6)
        s = wait_st(page, 's.rth === 13')
        if mobile: close_drawers(page)
        check(f'{tag}: ติดแผ่นระบายความร้อน → ความต้านทานความร้อน 13 °C/W', s and s['rth'] == 13, str(s))
        page.click('#btn-stop'); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'c21', 8)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'Q1', 'pin': 'B'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขาซ้าย → ป้าย "Q1 · ขา 1 B"', t is not None and t.startswith('Q1 · ขา 1 B'), str(t))
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ดาร์ลิงตัน TIP120")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h6', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h6'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'darlington').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'darlington').map(p => p.placement.anchor)")
        check(f'{tag}: วาง TIP120 ตัวใหม่จากคลังที่ h6', len(n) == 2 and 'h6' in n, str(n))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
