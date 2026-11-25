"""E2E: โมดูลวัดระยะอัลตราโซนิก HC-SR04 + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 29 (Vcc → VBUS, Trig → GP14, Echo —1k— GP15 —2k— GND) → Run → MicroPython (time_pulse_us) พิมพ์ระยะ ≈ 20 cm
→ แผงผลแสดงความกว้าง Echo ≈ 1.15 ms → กดชิป 1 m → พิมพ์ ≈ 100 → เลื่อนแถบ 50 cm → พิมพ์ ≈ 50 → ชิป "ไม่มีวัตถุ" → พิมพ์ "ไม่มีวัตถุ"
→ แลป 29 ผ่านครบ 5 ข้อ → ชี้/แตะหัวเข็ม → ป้าย "US1 · ..." → ต่อ Echo ตรงเข้า GP15 → อันตราย → วางโมดูลใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/sonar_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson29-sonar.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
LAST_D = "(() => { const ls = (circuitLab.picoConsole || '').split('\\n').filter(Boolean); const l = ls[ls.length - 1] || ''; if (l.includes('ไม่มีวัตถุ')) return -1; const m = l.match(/D = (-?[\\d.]+)/); return m ? Number(m[1]) : null; })()"
STATE = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.US1 ? s.analysis.parts.US1.extra : null; })()"

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def close_drawer(page, mobile, side):
    if not mobile: return
    time.sleep(0.4)
    loc = page.locator(f'.panel.{side} .drawer-close')
    bb = loc.bounding_box() if loc.is_visible() else None
    if bb and 0 <= bb['x'] < page.viewport_size['width'] and 0 <= bb['y'] < page.viewport_size['height']: loc.click(force=True); time.sleep(0.4)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile:
        # ลิ้นชักขวา: ดูจากคลาส open (ตำแหน่งกล่องระหว่างแอนิเมชันเลื่อนออกยังอยู่ในจอ ทำให้เข้าใจผิดว่าเปิดอยู่)
        if not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def wait_dist(page, d, tol, timeout=30000):
    page.evaluate("circuitLab.picoConsole = ''")
    try: page.wait_for_function(f"(() => {{ const v = {LAST_D}; return v !== null && Math.abs(v - ({d})) <= {tol}; }})()", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate(LAST_D)

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
        page.click('#btn-run')
        try: page.wait_for_function(f"{LAST_D} !== null", timeout=60000, polling=300)
        except Exception: pass
        v = wait_dist(page, 20, 0.4)
        check(f'{tag}: MicroPython (time_pulse_us) พิมพ์ระยะ ≈ 20 cm', v is not None and abs(v - 20) <= 0.4, str(v))
        s = page.evaluate(STATE)
        check(f'{tag}: 20 cm → พัลส์ Echo ≈ 1.155 ms, Vcc ≈ 5 V', s and s['count'] > 0 and abs(s['width'] - 1.1546e-3) < 1e-5 and abs(s['vcc'] - 5) < 0.3, str(s and {k: s[k] for k in ('width', 'count', 'vcc')}))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        open_props(page, mobile, 'US1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดงพัลส์ Echo และระยะที่คำนวณ', 'พัลส์ ECHO ล่าสุด' in txt and 'cm' in txt and 'จำนวนครั้งที่วัด' in txt, txt[txt.find('ไฟเลี้ยง'):][:160].replace('\n', ' | '))
        page.click('#f-dist-100'); time.sleep(0.3)
        close_drawer(page, mobile, 'right')
        v = wait_dist(page, 100, 1.5)
        check(f'{tag}: กดชิป 1 m → Pico พิมพ์ ≈ 100 cm', v is not None and abs(v - 100) <= 1.5, str(v))
        focus(page, 'e18', 26)
        page.screenshot(path=f'{OUT}/{tag}-sonar-1-run.png')
        open_props(page, mobile, 'US1')
        page.evaluate("() => { const el = document.getElementById('f-dist'); el.value = '50'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }"); time.sleep(0.3)
        out_txt = page.inner_text('#f-dist-out')
        close_drawer(page, mobile, 'right')
        v = wait_dist(page, 50, 0.8)
        check(f'{tag}: เลื่อนแถบเป็น 50 cm → แผงแสดง ECHO ≈ 2.89 ms และพิมพ์ ≈ 50', v is not None and abs(v - 50) <= 0.8 and '50 cm' in out_txt and '2.89' in out_txt, f'{v} | {out_txt}')
        open_props(page, mobile, 'US1')
        page.click('#f-dist-500'); time.sleep(0.3)
        close_drawer(page, mobile, 'right')
        v = wait_dist(page, -1, 0)
        check(f'{tag}: ชิป "ไม่มีวัตถุ" → Pico พิมพ์ "ไม่มีวัตถุ" (time_pulse_us หมดเวลา)', v == -1, str(v))
        # แลป 29 (มือถือ: ปิดลิ้นชักขวาที่อาจยังค้างก่อน ไม่ให้ฉากหลังบังปุ่ม)
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.right'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
            page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("HC-SR04")').count(): page.click('.lesson-card:has-text("HC-SR04")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=10000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 29 ผ่านครบ 5 ข้อ (power/trigger/divider/echo/sweep)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-sonar-2-lesson.png')
        close_drawer(page, mobile, 'left')
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'i22', 9)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'US1', 'pin': 'TRIG'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา Trig → ป้าย "US1 · TRIG ..."', t is not None and t.startswith('US1 · TRIG'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-sonar-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # Echo ต่อตรงเข้า GP15 (ย้ายปลายสายจากคอลัมน์ 27 มาคอลัมน์ 23)
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.hole === 'i27'));
          const e = [w.a, w.b].find(t => t.hole === 'i27'); e.hole = 'g23'; app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.partId === 'US1' && d.severity === 'danger'); })()", timeout=10000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'US1').map(d => d.severity + ':' + d.message).join(' | ')")
        check(f'{tag}: ต่อ Echo ตรงเข้า GP15 → แจ้งอันตราย (5 V เกิน 3.3 V) แนะนำตัวแบ่งแรงดัน', 'danger:' in d and 'GP15' in d and 'ตัวแบ่งแรงดัน' in d, d[:200])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("อัลตราโซนิก")'); time.sleep(0.3)
        focus(page, 'a26', 14)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'a25'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'sonar').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง HC-SR04 ใหม่ที่ a25 จากคลังอุปกรณ์', len(m) == 2 and any(a == 'a25' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-sonar-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
