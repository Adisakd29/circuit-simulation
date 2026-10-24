"""E2E: เซนเซอร์อุณหภูมิ LM35 + Pico ADC ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 27 (LM35: +VS → VBUS, VOUT → GP26, GND → GND · LED เตือนที่ GP15 · โวลต์มิเตอร์ที่ VOUT) → Run
→ MicroPython พิมพ์อุณหภูมิตรงค่าตั้ง (25 °C) → กดชิป 60 °C → ค่าพิมพ์ 60, LED เตือนติด (ผลจำลอง + แสงในฉาก), โวลต์มิเตอร์ 0.600 V
→ เลื่อนแถบเป็น 37 °C → พิมพ์ 37 → กลับ 25 °C → LED ดับ → แลป 27 ผ่านครบ 5 ข้อ
→ ชี้/แตะรู c26 → ป้าย "TS1 · +VS" → ย้าย +VS ไป 3V3 → คำเตือน VBUS → วาง LM35 ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/lm35_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson27-lm35.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
LAST_T = "(() => { const m = [...(circuitLab.picoConsole || '').matchAll(/T = (-?[\\d.]+)/g)]; return m.length ? Number(m[m.length - 1][1]) : null; })()"
STATE = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.TS1) return null; const g = circuitLab.view.partObjs.get('LED1'); const sp = g && g.userData.glowSprite;
  return { led: s.analysis.parts.LED1.current, glow: sp ? sp.material.opacity : -1, probe: s.analysis.probe.value, vout: s.analysis.parts.TS1.extra.vout }; })()"""

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

def wait_temp(page, t, timeout=30000):
    page.evaluate("circuitLab.picoConsole = ''")
    try: page.wait_for_function(f"(() => {{ const v = {LAST_T}; return v !== null && Math.abs(v - {t}) < 0.25; }})()", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate(LAST_T)

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
        try: page.wait_for_function(f"{LAST_T} !== null", timeout=60000, polling=300)
        except Exception: pass
        v = wait_temp(page, 25)
        check(f'{tag}: MicroPython อ่าน ADC แล้วพิมพ์อุณหภูมิ ≈ 25 °C', v is not None and abs(v - 25) < 0.25, str(v))
        s = page.evaluate(STATE)
        check(f'{tag}: 25 °C → LED เตือนดับ, โวลต์มิเตอร์ที่ VOUT 0.250 V', s['led'] < 1e-5 and s['probe'] is not None and abs(s['probe'] - 0.25) < 0.002, str(s))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        open_props(page, mobile, 'TS1')
        page.click('#f-temp-60'); time.sleep(0.3)
        close_drawer(page, mobile, 'right')
        v = wait_temp(page, 60)
        try: page.wait_for_function(f"(() => {{ const s = {STATE}; return s && s.led > 3e-3 && s.glow > 0.3; }})()", timeout=15000, polling=200)
        except Exception: pass
        s = page.evaluate(STATE)
        check(f'{tag}: กดชิป 60 °C → พิมพ์ ≈ 60, LED เตือนติด (ผลจำลอง + แสงในฉาก), โวลต์มิเตอร์ 0.600 V', v is not None and abs(v - 60) < 0.25 and s['led'] > 3e-3 and s['glow'] > 0.3 and abs(s['probe'] - 0.6) < 0.002, f'{v} {s}')
        focus(page, 'g28', 13)
        page.screenshot(path=f'{OUT}/{tag}-lm35-1-hot.png')
        # แถบเลื่อน 37 °C
        open_props(page, mobile, 'TS1')
        page.evaluate("() => { const el = document.getElementById('f-temp'); el.value = '37'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }"); time.sleep(0.3)
        out_txt = page.inner_text('#f-temp-out')
        close_drawer(page, mobile, 'right')
        v = wait_temp(page, 37)
        check(f'{tag}: เลื่อนแถบเป็น 37 °C → แผงแสดง VOUT ≈ 370 mV และพิมพ์ ≈ 37', v is not None and abs(v - 37) < 0.25 and '37' in out_txt and '370' in out_txt, f'{v} | {out_txt}')
        open_props(page, mobile, 'TS1')
        page.click('#f-temp-25'); time.sleep(0.3)
        close_drawer(page, mobile, 'right')
        wait_temp(page, 25)
        try: page.wait_for_function(f"(() => {{ const s = {STATE}; return s && s.led < 1e-5; }})()", timeout=15000, polling=200)
        except Exception: pass
        check(f'{tag}: กลับ 25 °C → LED เตือนดับ', page.evaluate(STATE)['led'] < 1e-5)
        open_props(page, mobile, 'TS1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดง VOUT และค่าแปลงเป็น °C', 'VOUT ÷ 10 mV' in txt and 'กระแสนิ่ง' in txt, txt[txt.find('อุณหภูมิ'):][:100].replace('\n', ' | '))
        close_drawer(page, mobile, 'right')
        # แลป 27
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("LM35")').count(): page.click('.lesson-card:has-text("LM35")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=10000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 27 ผ่านครบ 5 ข้อ (power/signal/measure/sweep/alarm)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-lm35-2-lesson.png')
        close_drawer(page, mobile, 'left')
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        focus(page, 'c27', 9)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'c26'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู c26 → ป้าย "TS1 · +VS ..."', t is not None and t.startswith('TS1 · +VS'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-lm35-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # +VS → 3V3
        page.evaluate("""() => { const app = circuitLab; const pico = app.doc.parts.find(p => p.id === 'PICO1'); const ph = window.__cl.pinHolesFor(pico).find(x => x.pin === '3V3');
          const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.hole === 'a26'));
          const e = [w.a, w.b].find(t => t.hole !== 'a26'); e.hole = 'a' + ph.hole.slice(1); app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.partId === 'TS1' && d.message.includes('VBUS')); })()", timeout=10000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'TS1').map(d => d.message).join(' | ')")
        check(f'{tag}: ย้าย +VS ไป 3V3 → เตือนต่ำกว่า 4 V ให้ใช้ VBUS', 'VBUS' in d and '4 V' in d, d[:160])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("เซนเซอร์อุณหภูมิ")'); time.sleep(0.3)
        focus(page, 'g27', 12)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'g26'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'lm35').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง LM35 ใหม่ที่ g26 จากคลังอุปกรณ์', len(m) == 2 and any(a == 'g26' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-lm35-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
