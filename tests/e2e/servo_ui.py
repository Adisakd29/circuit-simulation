"""E2E: เซอร์โว SG90 + Pico PWM ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 23 (VBUS/GND/GP15, โค้ดวนพัลส์ 0.5 / 1.45 / 2.4 ms ทุก 1 s) → Run → คาบ 20 ms, แขนไปที่ 0°, 90°, 180°
และแขนในฉาก 3 มิติหมุนตาม → ป้ายชื่อสายที่หัวต่อ → แลป 23 ผ่าน 4 ข้อหลัก → ย้ายไฟเลี้ยงไป 3V3 → ไม่หมุน + เตือน → วางเซอร์โวใหม่
ใช้: python3 tests/e2e/servo_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson23-servo.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
STATE = """(() => { const s = circuitLab.freshSim; if (!s) return null; const m = s.analysis.parts['M1']; let rot = null;
  circuitLab.view.scene.traverse(o => { if (o.userData.servoHorn && o.userData.partId === 'M1') rot = o.userData.servoHorn.rotation.y; });
  return m && m.extra ? Object.assign({ rot, diag: s.analysis.diagnostics.map(d => d.message).join(' | ') }, m.extra) : null; })()"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'V'});
  v.controls.target.set(w.x, 0, w.z - 4); v.persp.position.set(w.x, 26, w.z + 22); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""


def cam_still(page):
    """รอให้กล้องหยุดเลื่อน (OrbitControls มี damping — บนเครื่องที่วาดช้ากล้องยังเลื่อนต่อหลังตั้งตำแหน่ง)"""
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

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
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        page.evaluate(FOCUS); time.sleep(0.3)
        page.click('#btn-run')
        page.wait_for_function(f"(() => {{ const x = {STATE}; return !!x && x.period > 0; }})()", timeout=60000, polling=250)
        # เก็บมุมในหน้าเว็บจนเห็นครบ 0°, 90°, 180° (หยุดนิ่ง) หรือหมดเวลา
        seen = page.evaluate(f"""(async () => {{ const got = {{}}; const t0 = performance.now(); let per = 0, pwmax = 0, hornOk = true, n = 0;
          while (performance.now() - t0 < 90000) {{ const x = {STATE}; if (x) {{ per = x.period || per; pwmax = Math.max(pwmax, x.pw);
            if (!x.moving) for (const a of [0, 90, 180]) if (Math.abs(x.angle - a) < 2) got[a] = true;
            if (x.rot !== null) {{ n++; if (Math.abs(x.rot + x.angle * Math.PI / 180) > 1e-6) hornOk = false; }} }}
            if (got[0] && got[90] && got[180]) break; await new Promise(r => setTimeout(r, 80)); }}
          return {{ got, per, pwmax, hornOk, n }}; }})()""")
        check(f'{tag}: PWM คาบ 20 ms และพัลส์สูงสุด ≈ 2.4 ms', abs(seen['per'] - 0.02) < 5e-5 and abs(seen['pwmax'] - 2.4e-3) < 2e-5, f"per={seen['per']:.6f} pwmax={seen['pwmax']:.6f}")
        check(f'{tag}: แขนหยุดที่ 0°, 90° และ 180° ตามโค้ด', all(seen['got'].get(str(a)) for a in (0, 90, 180)), str(seen['got']))
        check(f'{tag}: แขนในฉาก 3 มิติหมุนตามมุมจากการจำลอง', seen['hornOk'] and seen['n'] > 5, f"n={seen['n']}")
        page.screenshot(path=f'{OUT}/{tag}-servo-1-run.png')
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate(FOCUS); time.sleep(0.4)
        s = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'M1', 'pin': 'SIG'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': s['x'], 'y': s['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(s['x'], s['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}หัวต่อขาสัญญาณ → ป้าย "M1 · สายส้ม ..."', t is not None and t.startswith('M1 · สายส้ม'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-servo-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("เซอร์โว")').count(): page.click('.lesson-card:has-text("เซอร์โว")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 4", timeout=30000, polling=500)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        n_ok = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 23 ผ่าน 4 ข้อหลัก (power/signal/pwm50/angles)', page.locator('#lesson-goals .goal').count() == 5 and n_ok >= 4, f'{n_ok} — ' + goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-servo-3-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible():
            page.locator('.panel.left .drawer-close').click(force=True); time.sleep(0.4)
        page.evaluate("""() => { const app = circuitLab; const pico = app.doc.parts.find(p => p.id === 'PICO1'); const ph = window.__cl.pinHolesFor(pico).find(x => x.pin === '3V3');
          const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => w.a.kind === 'pin' && w.a.partId === 'M1' && w.a.pin === 'V'); w.b.hole = 'a' + ph.hole.slice(1);
          app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        st = page.evaluate(f"""(async () => {{ let d = '', vcc = 0; for (let i = 0; i < 60; i++) {{ await new Promise(r => setTimeout(r, 250)); const x = {STATE}; if (!x) continue; vcc = x.vcc; if (x.diag.includes('VBUS')) {{ d = x.diag; break; }} }} return [vcc, d]; }})()""")
        check(f'{tag}: สายแดงย้ายไป 3V3 → ไฟเลี้ยง 3.3 V + เตือนให้ใช้ VBUS', abs(st[0] - 3.3) < 0.15 and 'VBUS' in st[1], f'vcc={st[0]:.2f} {st[1][:120]}')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("เซอร์โว")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'V'}).clone(); w.set(w.x + 18, -2.4, w.z - 6);
          v.controls.target.copy(w); v.persp.position.set(w.x, 30, w.z + 24); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        s = page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'V'}).clone(); w.set(w.x + 18, -2.4, w.z - 6);
          v.camera.updateMatrixWorld(); const q = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; }""")
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'servo').map(p => [p.id, p.placement.kind])")
        check(f'{tag}: วางเซอร์โวใหม่บนโต๊ะจากคลังอุปกรณ์', len(m) == 2 and all(k == 'table' for _, k in m), str(m) + ' ' + page.inner_text('#status-msg'))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
