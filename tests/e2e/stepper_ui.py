"""E2E: ชุดสเต็ปเปอร์ 28BYJ-48 + ULN2003 + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 32 (GP10–GP13 → IN1–IN4, VBUS → +, GND → −) → Run → LED A–D บนบอร์ดติดตามเฟส (แสงในฉาก)
→ เดินหน้า 1024 สเต็ป: มุม 90.00° และแกนในฉากหมุนตาม → ถอยกลับ 512 สเต็ป: 45.00° → แผงผล → แลป 32 ผ่านข้อบังคับ 4 ข้อ
→ ชี้/แตะขา IN1 → ป้าย "M1 · IN1" → ย้าย + ไป 3V3 → เตือน → วางชุดสเต็ปเปอร์ใหม่บนโต๊ะจากคลังอุปกรณ์
ใช้: python3 tests/e2e/stepper_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson32-stepper.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.M1) return null; const x = s.analysis.parts.M1.extra; const g = circuitLab.view.partObjs.get('M1');
  return { angle: x.angle, pos: x.pos, posMax: x.posMax, missed: x.missed, vcc: x.vcc, rot: g && g.userData.stepShaft ? g.userData.stepShaft.rotation.y : null }; })()"""

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
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        # แสงสูงสุดของ LED A–D ระหว่างหมุน
        page.evaluate("""() => { window.__led = [0, 0, 0, 0]; window.__iv = setInterval(() => { const g = circuitLab.view.partObjs.get('M1'); const L = g && g.userData.stepLeds; if (L) L.forEach((m, k) => { window.__led[k] = Math.max(window.__led[k], m.emissiveIntensity); }); }, 30); }""")
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('ไป 90')", timeout=120000, polling=200)
        except Exception: pass
        time.sleep(0.4)
        s = page.evaluate(ST)
        check(f'{tag}: เดินหน้า 1024 ฮาล์ฟสเต็ป → ไปถึง 90° (ตำแหน่งสูงสุด 1024) ไม่หลุดสเต็ป', s and s['posMax'] == 1024 and s['missed'] == 0, str(s))
        led = page.evaluate("window.__led")
        check(f'{tag}: LED A–D บนบอร์ดขับติดตามเฟสครบทั้ง 4 ดวง (แสงในฉาก)', all(v > 0.3 for v in led), str([round(v, 2) for v in led]))
        focus(page, 'j20', 30)
        page.screenshot(path=f'{OUT}/{tag}-stepper-1-90.png')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('กลับ 45')", timeout=120000, polling=200)
        except Exception: pass
        time.sleep(0.4)
        s = page.evaluate(ST)
        check(f'{tag}: ถอยกลับ 512 สเต็ป → 45.00° และแกนในฉากหมุนตาม (−45°)', s and abs(s['angle'] - 45) < 0.01 and s['rot'] is not None and abs(s['rot'] + 3.14159265 / 4) < 0.01, str(s))
        page.evaluate("clearInterval(window.__iv)")
        open_props(page, mobile, 'M1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดงมุม 45.00° (512 ฮาล์ฟสเต็ป) และหลุดสเต็ป "ไม่มี"', '45.00° (512 ฮาล์ฟสเต็ป)' in txt and 'หลุดสเต็ป' in txt, txt[txt.find('มุมแกนออก'):][:120].replace('\n', ' | '))
        close_drawer(page, mobile, 'right')
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.right'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
            page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("28BYJ-48")').count(): page.click('.lesson-card:has-text("28BYJ-48")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 4", timeout=20000, polling=250)
        except Exception: pass
        goals = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal')].map(g => g.classList.contains('pass'))")
        check(f'{tag}: แลป 32 ผ่านข้อบังคับครบ 4 ข้อ (power/inputs/turn/reverse)', len(goals) == 5 and all(goals[:4]), str(goals))
        check(f'{tag}: แลป 32 มีรูปวงจร', page.locator('#lesson-schematic svg').count() == 1)
        page.screenshot(path=f'{OUT}/{tag}-stepper-2-lesson.png')
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.left'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'IN2'});
          v.controls.target.set(w.x, w.y, w.z); v.persp.position.set(w.x - 3, w.y + 7, w.z + 6); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }""")
        time.sleep(0.2); cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'M1', 'pin': 'IN1'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา IN1 → ป้าย "M1 · IN1 …"', t is not None and t.startswith('M1 · IN1'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-stepper-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # + ของบอร์ดขับย้ายไป 3V3
        page.evaluate("""() => { const app = circuitLab; const pico = app.doc.parts.find(p => p.id === 'PICO1'); const ph = window.__cl.pinHolesFor(pico).find(x => x.pin === '3V3');
          const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'pin' && t.partId === 'M1' && t.pin === 'V'));
          const e = [w.a, w.b].find(t => t.kind === 'hole'); e.hole = 'a' + ph.hole.slice(1); app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.partId === 'M1' && d.message.includes('VBUS')); })()", timeout=15000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'M1').map(d => d.severity + ':' + d.message).join(' | ')")
        check(f'{tag}: ย้าย + ไป 3V3 → เตือนไฟเลี้ยงต่ำ ให้ใช้ VBUS', 'VBUS' in d, d[:160])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("สเต็ปเปอร์")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(-42, -2.4, 22); v.persp.position.set(-42, 40, 52); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        s = page.evaluate("""() => { const v = circuitLab.view; v.camera.updateMatrixWorld(); const q = v.controls.target.clone().project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; }""")
        close_drawer(page, mobile, 'left')
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'stepper').map(p => [p.id, p.placement.kind])")
        check(f'{tag}: วางชุดสเต็ปเปอร์ใหม่บนโต๊ะจากคลังอุปกรณ์', len(m) == 2 and all(k == 'table' for _, k in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-stepper-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
