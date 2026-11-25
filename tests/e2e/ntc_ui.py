"""E2E: เทอร์มิสเตอร์ NTC 10 kΩ B3950 ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 36 (5 V → R1 10 kΩ → จุดกลาง → NTC → ลบ) โดยยังไม่มีโพรบ → แตะวางโพรบแดง/ดำด้วยเครื่องมือโพรบ → Run → จอ 2.500 V
→ เลือก NTC → ชิปอุณหภูมิ 0 / 60 / 100 °C และแถบเลื่อน 37 °C → แรงดันตามสูตรค่า B · มีรัศมีสีบอกอุณหภูมิในฉาก
→ แลป 36 ข้อบังคับผ่าน → R1 = 1 kΩ ที่ 100 °C → คำเตือนความร้อนในตัว → แลป 36 ผ่านครบ 5 ข้อ มีรูปวงจร
→ ชี้/แตะขา → ป้าย "TH1 · ขา 1" → วาง NTC ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/ntc_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson36-ntc.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.TH1) return null; const x = s.analysis.parts.TH1.extra;
  const g = circuitLab.view.partObjs.get('TH1'); let halo = null; if (g) g.traverse((o) => { if (o.userData.tempHalo) halo = o.material.color.getHexString(); });
  return { v: s.analysis.probe.value, t: x.temp, r: x.resistance, dT: x.dT, halo, diags: s.analysis.diagnostics.filter(d => d.partId === 'TH1').map(d => d.message) }; })()"""
import math
def vdiv(t, r=10000, v=5):
    rn = 10000 * math.exp(3950 * (1 / (t + 273.15) - 1 / 298.15)); return v * rn / (rn + r)

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

def tap_hole(page, mobile, hole):
    p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': hole})
    if mobile: page.touchscreen.tap(p['x'], p['y'])
    else: page.mouse.click(p['x'], p['y'])
    time.sleep(0.3)

def chip(page, mobile, sel):
    open_props(page, mobile, 'TH1')
    page.click(sel); time.sleep(0.3)
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
        check(f'{tag}: เปิดไฟล์แลป 36 (schema 33) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        # ถอดโพรบออก แล้ววางใหม่ด้วยเครื่องมือโพรบ
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.probes = { red: null, black: null }; app.apply({ ok: true, doc, warnings: [] }, 'ถอดโพรบ'); }""")
        focus(page, 'c14', 14)
        page.click('.tool[aria-label="โพรบแดง (+)"]'); time.sleep(0.2)
        tap_hole(page, mobile, 'c14')
        page.click('.tool[aria-label="โพรบดำ (COM)"]'); time.sleep(0.2)
        tap_hole(page, mobile, 'e16')
        page.click('.tool[aria-label="เลือก / ย้าย (V)"]'); time.sleep(0.2)
        pr = page.evaluate("circuitLab.doc.probes")
        check(f'{tag}: แตะวางโพรบแดงที่ c14 และโพรบดำที่ e16', (pr['red'] or {}).get('hole') == 'c14' and (pr['black'] or {}).get('hole') == 'e16', str(pr))
        page.click('#btn-run')
        s = wait_st(page, 's.v !== null && Math.abs(s.v - 2.5) < 0.01')
        time.sleep(0.3)
        lcd = page.inner_text('.meter .lcd')
        check(f'{tag}: Run ที่ 25 °C → โวลต์มิเตอร์ 2.500 V (ครึ่งหนึ่งของ 5 V) ไม่มีรัศมีอุณหภูมิ', s and abs(s['v'] - 2.5) < 1e-3 and lcd.strip().startswith('2.50') and s['halo'] is None, f'{lcd!r} {s}')
        ok = []
        for t, sel in [(0, '#f-ntc-0'), (60, '#f-ntc-60'), (100, '#f-ntc-100')]:
            chip(page, mobile, sel)
            s = wait_st(page, f's.t === {t}')
            ok.append((t, s and round(s['v'], 4), round(vdiv(t), 4), s and s['halo']))
        good = all(v is not None and abs(v - th) < 1e-3 for _, v, th, _ in ok) and ok[0][3] == '66b8ff' and ok[2][3] == 'ff6a2a'
        check(f'{tag}: ชิป 0 / 60 / 100 °C → VOUT ตามสูตรค่า B (3.854 / 0.996 / 0.326 V) รัศมีฟ้าที่ 0 °C ส้มแดงที่ 100 °C', good, str(ok))
        focus(page, 'c14', 9)
        page.screenshot(path=f'{OUT}/{tag}-ntc-1-hot.png')
        open_props(page, mobile, 'TH1')
        page.evaluate("(() => { const s = document.getElementById('f-ntc'); s.value = '37'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.3)
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        s = wait_st(page, 's.t === 37')
        check(f'{tag}: แถบเลื่อน 37 °C → R ≈ 6.0 kΩ VOUT ≈ {vdiv(37):.3f} V แผงแสดงอุณหภูมิและความร้อนในตัว', s and abs(s['v'] - vdiv(37)) < 1e-3 and 'ความร้อนในตัว (P/δ)' in txt and '37 °C' in txt, f"{s and s['v']} {txt[txt.find('อุณหภูมิรอบตัว'):][:80]!r}")
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("เทอร์มิสเตอร์ NTC")').count(): page.click('.lesson-card:has-text("เทอร์มิสเตอร์ NTC")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 4", timeout=20000, polling=250)
        except Exception: pass
        passed = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
        check(f'{tag}: แลป 36 ข้อบังคับผ่านครบ (wiring/probe/v25/sweep)', all(g in passed for g in ['wiring', 'probe', 'v25', 'sweep']), str(passed))
        if mobile: close_drawers(page)
        chip(page, mobile, '#f-ntc-100')
        open_props(page, mobile, 'R1')
        fld = page.locator('#f-resistance')
        fld.fill('1k'); fld.press('Enter'); time.sleep(0.4)
        if mobile: close_drawers(page)
        s = wait_st(page, 's.dT > 2')
        dg = page.evaluate("[...document.querySelectorAll('.diag')].map(e => e.textContent).join(' | ')")
        check(f'{tag}: R1 = 1 kΩ (ช่องค่า) ที่ 100 °C → ความร้อนในตัว ≈ 3 °C มีคำเตือน', s and 2.5 < s['dT'] < 3.5 and 'ความร้อนในตัว' in dg, f"{s and s['dT']} {dg[:120]!r}")
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("เทอร์มิสเตอร์ NTC")').count(): page.click('.lesson-card:has-text("เทอร์มิสเตอร์ NTC")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=20000, polling=250)
        except Exception: pass
        passed = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
        check(f'{tag}: แลป 36 ผ่านครบ 5 ข้อ (รวม selfheat)', len(passed) == 5, str(passed))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('TH1') && s.innerHTML.includes('−t°'); })()")
        check(f'{tag}: แลป 36 มีรูปวงจร (สัญลักษณ์ NTC −t°)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-ntc-2-lesson.png')
        if mobile: close_drawers(page)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'b15', 6)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'TH1', 'pin': '2'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขาเทอร์มิสเตอร์ → ป้าย "TH1 · ขา 2"', t is not None and t.startswith('TH1 · ขา 2'), str(t))
        if not mobile: page.mouse.move(5, 450)
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("เทอร์มิสเตอร์ NTC")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h6', 18)
        tap_hole(page, mobile, 'h6')
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'ntc').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'ntc').map(p => p.placement.anchor)")
        check(f'{tag}: วาง NTC ตัวใหม่จากคลังที่ h6', len(n) == 2 and 'h6' in n, str(n))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
