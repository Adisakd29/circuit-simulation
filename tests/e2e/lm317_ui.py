"""E2E: ไอซีคงแรงดันปรับค่าได้ LM317 ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 35 (15 V → IN · R1 240 Ω OUT–ADJ · ทริมพอต 2 kΩ ADJ → กราวด์ · โหลด 1 kΩ) → Run → ขาออกตามสูตร แผงผล "คงแรงดัน"
→ เลื่อนแถบพอตในแผงคุณสมบัติ → 5.0 V และ 9.0 V → ลดแหล่งจ่ายเหลือ 9 V → dropout มีคำเตือน → คืน 15 V
→ R1 2.2 kΩ (ช่องค่าในแผงคุณสมบัติ) + ลบโหลด → ขาออกสูงเกินสูตร มีคำเตือน "R1 ≤ 240 Ω"
→ แลป 35 ผ่านครบ 5 ข้อ มีรูปวงจร → ชี้/แตะขา ADJ → ป้าย "U1 · ขา 1 ADJ" → วาง LM317 ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/lm317_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson35-lm317.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.U1) return null; const x = s.analysis.parts.U1.extra;
  return { vout: x.vout, vin: x.vin, vref: x.vref, reg: x.regulating, low: x.lowLoad, iout: x.iout, diags: s.analysis.diagnostics.filter(d => d.partId === 'U1').map(d => d.message) }; })()"""
LM317VOUT = lambda r1, r2: 1.25 * (1 + r2 / r1) + 50e-6 * r2

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

def slider(page, mobile, val):
    open_props(page, mobile, 'VR1')
    page.evaluate(f"(() => {{ const s = document.getElementById('f-pos'); s.value = '{val}'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }})()"); time.sleep(0.3)
    if mobile: close_drawers(page)

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
        check(f'{tag}: เปิดไฟล์แลป 35 (schema 32) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        s = wait_st(page, 's.reg === 1')
        th = LM317VOUT(240, 2000 * 0.5 + 3)
        check(f'{tag}: Run → คงแรงดัน ขาออก ≈ {th:.2f} V ตามสูตร (พอต 50%) OUT − ADJ ≈ 1.25 V', s and s['reg'] == 1 and abs(s['vout'] - th) < 0.02 and abs(s['vref'] - 1.25) < 0.01, str(s))
        open_props(page, mobile, 'U1'); time.sleep(0.4)
        txt = page.inner_text('#props')
        check(f'{tag}: แผงผลของ LM317 แสดง "คงแรงดัน" VOUT และ OUT − ADJ', 'คงแรงดัน' in txt and 'OUT − ADJ (VREF)' in txt and 'กระแสขา ADJ' in txt, txt[txt.find('สถานะ'):][:140].replace('\n', ' | '))
        if mobile: close_drawers(page)
        focus(page, 'c21', 16)
        page.screenshot(path=f'{OUT}/{tag}-lm317-1-run.png')
        slider(page, mobile, 355)
        s = wait_st(page, 'Math.abs(s.vout - 5) < 0.05')
        check(f'{tag}: เลื่อนแถบพอตเป็น 35.5% → ขาออก 5.00 V (±0.03)', s and abs(s['vout'] - 5) < 0.03, str(s and s['vout']))
        slider(page, mobile, 735)
        s = wait_st(page, 'Math.abs(s.vout - 9) < 0.05')
        check(f'{tag}: เลื่อนแถบพอตเป็น 73.5% → ขาออก 9.00 V (±0.03)', s and abs(s['vout'] - 9) < 0.03, str(s and s['vout']))
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts.find(p => p.id === 'PS1').params.voltage = 9; app.apply({ ok: true, doc, warnings: [] }, 'PS 9 V'); }""")
        s = wait_st(page, 's.reg === 0')
        check(f'{tag}: แหล่งจ่าย 9 V (ต่ำกว่า 9 + dropout) → ไม่คงแรงดัน ขาออก ≈ 7.4 V มีคำเตือน dropout', s and s['reg'] == 0 and 7.1 < s['vout'] < 7.6 and any('dropout' in m for m in s['diags']), str(s))
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts.find(p => p.id === 'PS1').params.voltage = 15; app.apply({ ok: true, doc, warnings: [] }, 'PS 15 V'); }""")
        wait_st(page, 's.reg === 1')
        # R1 2.2 kΩ ผ่านช่องค่าในแผงคุณสมบัติ แล้วลบโหลด
        open_props(page, mobile, 'R1')
        fld = page.locator('#f-resistance')
        fld.fill('2.2k'); fld.press('Enter'); time.sleep(0.4)
        if mobile: close_drawers(page)
        page.evaluate("circuitLab.select({t: 'part', id: 'RL'})"); time.sleep(0.2)
        page.keyboard.press('Delete'); time.sleep(0.4)
        if page.evaluate("circuitLab.doc.parts.some(p => p.id === 'RL')"):
            page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts = doc.parts.filter(p => p.id !== 'RL'); app.apply({ ok: true, doc, warnings: [] }, 'ลบโหลด'); }""")
        s = wait_st(page, 's.low === 1')
        r1 = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'R1').params.resistance")
        th2 = LM317VOUT(2200, 2000 * 0.735 + 3)
        dg = page.evaluate("[...document.querySelectorAll('.diag')].map(e => e.textContent).join(' | ')")
        check(f'{tag}: R1 = 2.2 kΩ (ช่องค่า) + ลบโหลด → ขาออกสูงกว่าสูตร {th2:.2f} V และมีคำเตือน R1 ≤ 240 Ω', r1 == 2200 and s and s['low'] == 1 and s['vout'] > th2 + 0.5 and 'R1 ≤ 240 Ω' in dg, f"R1={r1} {s and s['vout']}")
        page.screenshot(path=f'{OUT}/{tag}-lm317-2-lowload.png')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("LM317")').count(): page.click('.lesson-card:has-text("LM317")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=20000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        npass = page.locator('#lesson-goals .goal.pass').count()
        passed = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
        check(f'{tag}: แลป 35 ผ่านครบ 5 ข้อ (wiring/formula/set5/set9/minload — formula จำไว้จากตอนต่อถูก)', npass == 5, f'{passed} · ' + goals[:240].replace('\n', ' | '))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('LM317') && s.innerHTML.includes('240'); })()")
        check(f'{tag}: แลป 35 มีรูปวงจร (LM317, R1 240 Ω)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-lm317-3-lesson.png')
        if mobile: close_drawers(page)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'c21', 7)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'ADJ'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขาซ้าย → ป้าย "U1 · ขา 1 ADJ"', t is not None and t.startswith('U1 · ขา 1 ADJ'), str(t))
        if not mobile: page.mouse.move(5, 450)
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("LM317")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h6', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h6'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'lm317').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'lm317').map(p => p.placement.anchor)")
        check(f'{tag}: วาง LM317 ตัวใหม่จากคลังที่ h6', len(n) == 2 and 'h6' in n, str(n))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
