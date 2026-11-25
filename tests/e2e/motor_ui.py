"""E2E: มอเตอร์ DC เกียร์ TT + มอสเฟต + Pico PWM ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 24 (GP15 → IRLZ44N, 1N4007 กันย้อน, แหล่งจ่าย 6 V แยก, โค้ดวน duty 100% / 40% / 0% ที่ 200 Hz) → Run
→ มอเตอร์หมุนเต็ม > 200 rpm, ช้าลงที่ 40%, หยุดที่ 0% และจานในฉากหมุนตามมุม → ป้ายชื่อสาย → แลป 24 ผ่าน 4 ข้อหลัก
→ ลบไดโอด → เตือน → วางมอเตอร์ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/motor_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson24-motor.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
STATE = """(() => { const s = circuitLab.freshSim; if (!s) return null; const m = s.analysis.parts['M1']; let rot = null;
  circuitLab.view.scene.traverse(o => { if (o.userData.motorDisc && o.userData.partId === 'M1') rot = o.userData.motorDisc.rotation.z; });
  return m && m.extra ? Object.assign({ rot, i: m.current, diag: s.analysis.diagnostics.map(d => d.message).join(' | ') }, m.extra) : null; })()"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'A'});
  v.controls.target.set(w.x + 10, 0, w.z - 6); v.persp.position.set(w.x + 10, 30, w.z + 26); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""


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
        seen = page.evaluate(f"""(async () => {{ const t0 = performance.now(); let maxr = 0, low = null, stop = false, ipk = 0, discOk = true, n = 0, phase = 0;
          while (performance.now() - t0 < 150000) {{ const x = {STATE}; if (x) {{ ipk = Math.max(ipk, x.i); if (x.rpm > maxr) maxr = x.rpm;
            if (maxr > 150 && phase === 0) phase = 1;
            if (phase === 1 && x.rpm < 0.85 * maxr && x.rpm > 20) {{ low = Math.min(low ?? Infinity, x.rpm); }}
            if (phase === 1 && low !== null && Math.abs(x.rpm) < 1) stop = true;
            if (x.rot !== null) {{ n++; if (Math.abs(x.rot - x.angle) > 1e-9) discOk = false; }} }}
            if (stop) break; await new Promise(r => setTimeout(r, 80)); }}
          return {{ maxr, low, stop, ipk, discOk, n }}; }})()""")
        check(f'{tag}: duty 100% → หมุนเร็วสุด 200–270 rpm และมีกระแสไหล (> 0.12 A)', 200 < seen['maxr'] < 270 and seen['ipk'] > 0.12, f"max={seen['maxr']:.1f} ipk={seen['ipk']:.2f}")
        check(f'{tag}: duty 40% → ช้าลง แล้ว 0% → หยุด', seen['low'] is not None and seen['low'] < 0.85 * seen['maxr'] and seen['stop'], f"low={seen['low']} stop={seen['stop']}")
        check(f'{tag}: จานบอกการหมุนในฉาก 3 มิติหมุนตรงกับมุมแกนออก', seen['discOk'] and seen['n'] > 5, f"n={seen['n']}")
        page.screenshot(path=f'{OUT}/{tag}-motor-1-run.png')
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'A'});
          v.controls.target.copy(w); v.persp.position.set(w.x, w.y + 18, w.z + 16); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        s = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'M1', 'pin': 'A'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': s['x'], 'y': s['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(s['x'], s['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ปลายสายแดง → ป้าย "M1 · สายแดง ..."', t is not None and t.startswith('M1 · สายแดง'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-motor-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("มอเตอร์ DC")').count(): page.click('.lesson-card:has-text("มอเตอร์ DC")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 4", timeout=60000, polling=500)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        n_ok = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 24 ผ่าน 4 ข้อหลัก (driver/flyback/power/speed)', page.locator('#lesson-goals .goal').count() == 5 and n_ok >= 4, f'{n_ok} — ' + goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-motor-3-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible():
            page.locator('.panel.left .drawer-close').click(force=True); time.sleep(0.4)
        # ลบไดโอดกันย้อน
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts = doc.parts.filter(p => p.id !== 'D1');
          app.apply({ ok: true, doc, warnings: [] }, 'ลบ D1'); }""")
        st = page.evaluate(f"""(async () => {{ for (let i = 0; i < 120; i++) {{ await new Promise(r => setTimeout(r, 250)); const x = {STATE}; if (x && x.diag.includes('ไดโอดกันย้อน')) return x.diag; }} return ''; }})()""")
        check(f'{tag}: ลบไดโอด → เตือน "ไม่มีไดโอดกันย้อน"', 'ไดโอดกันย้อน' in st, st[:140])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("มอเตอร์ DC")'); time.sleep(0.3)
        tgt = "const w = v.terminalWorld({kind: 'pin', partId: 'M1', pin: 'A'}).clone(); w.set(-34, -2.4, 26);"
        page.evaluate(f"""() => {{ const v = circuitLab.view; {tgt} v.controls.target.copy(w); v.persp.position.set(w.x, 34, w.z + 24); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}"""); time.sleep(0.4)
        s = page.evaluate(f"""() => {{ const v = circuitLab.view; {tgt} v.camera.updateMatrixWorld(); const q = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return {{ x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }}; }}""")
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'motor').map(p => [p.id, p.placement.kind])")
        check(f'{tag}: วางมอเตอร์ใหม่บนโต๊ะจากคลังอุปกรณ์', len(m) == 2 and all(k == 'table' for _, k in m), str(m) + ' ' + page.inner_text('#status-msg'))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
