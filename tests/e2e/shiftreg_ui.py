"""E2E: ไอซีเลื่อนบิต 74HC595 + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 30 (Pico บนโต๊ะ, GP2 → SER, GP3 → SRCLK, GP4 → RCLK, LED 8 ดวงที่ QA–QH) → Run
→ ไฟวิ่งครบ 8 ตำแหน่ง (ค่าขาออก 1, 2, 4 … 128) → ค่า 170: LED2/4/6/8 ติดในฉาก LED1/3/5/7 ดับ → แผงผลแสดงเลขฐานสอง
→ แลป 30 ผ่านครบ 5 ข้อ → ชี้/แตะขา QA → ป้าย "U1 · ขา 15 QA" → ย้าย OE ไป VCC → LED ดับ + แจ้ง → วาง 74HC595 ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/shiftreg_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson30-shiftreg.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
OUTV = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.U1 ? s.analysis.parts.U1.extra.out : null; })()"
GLOW = "(() => Array.from({ length: 8 }, (_, k) => { const g = circuitLab.view.partObjs.get('LED' + (k + 1)); const sp = g && g.userData.glowSprite; return sp ? sp.material.opacity : -1; }))()"
CUR = "(() => { const s = circuitLab.freshSim; return s ? Array.from({ length: 8 }, (_, k) => s.analysis.parts['LED' + (k + 1)].current) : null; })()"

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
        # เก็บค่าขาออกที่เห็นระหว่างรัน (ไฟวิ่ง 8 ตำแหน่ง + 170 + 15)
        page.evaluate("""() => { window.__vals = new Set(); window.__iv = setInterval(() => { const s = circuitLab.freshSim; if (s && s.analysis.parts.U1) window.__vals.add(s.analysis.parts.U1.extra.out); }, 40); }""")
        try: page.wait_for_function("[1, 2, 4, 8, 16, 32, 64, 128, 170, 15].every(v => window.__vals.has(v))", timeout=90000, polling=300)
        except Exception: pass
        vals = page.evaluate("[...window.__vals].sort((a, b) => a - b)")
        check(f'{tag}: ไฟวิ่ง: ขาออกเป็น 1, 2, 4 … 128 ครบ และ 170, 15', all(v in vals for v in [1, 2, 4, 8, 16, 32, 64, 128, 170, 15]), str(vals))
        try: page.wait_for_function(f"(() => {{ if ({OUTV} !== 170) return false; const g = {GLOW}; return [1, 3, 5, 7].every(k => g[k] > 0.3) && [0, 2, 4, 6].every(k => g[k] < 0.1); }})()", timeout=30000, polling=50)
        except Exception: pass
        g, c, o = page.evaluate(GLOW), page.evaluate(CUR), page.evaluate(OUTV)
        check(f'{tag}: ค่า 170 (0b10101010) → LED2/4/6/8 ติดในฉาก (> 3 mA) LED1/3/5/7 ดับ', o == 170 and all(g[k] > 0.3 and c[k] > 3e-3 for k in (1, 3, 5, 7)) and all(g[k] < 0.1 and c[k] < 1e-4 for k in (0, 2, 4, 6)), f'{o} {[round(x, 2) for x in g]}')
        focus(page, 'h13', 22)
        page.screenshot(path=f'{OUT}/{tag}-shiftreg-1-run.png')
        open_props(page, mobile, 'U1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดงขาออกเป็นเลขฐานสองและรีจิสเตอร์เลื่อน', 'ขาออก QH…QA' in txt and 'รีจิสเตอร์เลื่อน' in txt and 'กระแสรวมจาก VCC' in txt, txt[txt.find('ขาออก QH'):][:120].replace('\n', ' | '))
        close_drawer(page, mobile, 'right')
        page.evaluate("clearInterval(window.__iv)")
        # แลป 30 (มือถือ: ปิดลิ้นชักขวาที่อาจยังค้างก่อน)
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.right'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
            page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("74HC595")').count(): page.click('.lesson-card:has-text("74HC595")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=20000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 30 ผ่านครบ 5 ข้อ (power/control/leds/chaser/pattern)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-shiftreg-2-lesson.png')
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.left'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'e3', 8)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'QA'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา QA → ป้าย "U1 · ขา 15 QA ..."', t is not None and t.startswith('U1 · ขา 15 QA'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-shiftreg-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # OE (ขา 13) ย้ายจาก GND ไป VCC → ขาออกปิด
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.hole === 'g8'));
          const e = [w.a, w.b].find(t => t.hole === 'g8'); e.hole = 'b1'; app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        try: page.wait_for_function(f"(() => {{ const s = circuitLab.freshSim; const c = {CUR}; return s && s.analysis.diagnostics.some(d => d.partId === 'U1' && d.message.includes('OE')) && c && Math.max(...c) < 1e-5; }})()", timeout=15000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'U1').map(d => d.severity + ':' + d.message).join(' | ')")
        c = page.evaluate(CUR)
        check(f'{tag}: ย้าย OE ไป VCC → LED ดับทั้งหมด + แจ้งให้ต่อ OE ลง GND', 'OE' in d and c is not None and max(c) < 1e-5, d[:160] + f' {c}')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("เลื่อนบิต")'); time.sleep(0.3)
        focus(page, 'f25', 14)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f22'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'shiftreg').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง 74HC595 ใหม่ที่ f22 จากคลังอุปกรณ์', len(m) == 2 and any(a == 'f22' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-shiftreg-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
