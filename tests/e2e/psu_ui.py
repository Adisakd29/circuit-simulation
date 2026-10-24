"""E2E: หม้อแปลง + แหล่งจ่ายไฟ DC ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 22 (T1 12-0-12 V → บริดจ์ 1N4007 × 4 → 1000 µF → L7805 → 100 Ω, สโคป CH1 แบบ AC ที่ตัวเก็บประจุ)
→ Run → ขาออก 5 V, ค่า rms ของหม้อแปลง, สโคปวัด ripple 100 Hz → สลับ DC/AC → ป้ายชื่อขั้ว CT → แลป 22 ผ่านข้อหลัก
→ ถอดปลั๊ก → ไม่มีไฟเข้า → วางหม้อแปลงใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/psu_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson22-psu.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
X = """(() => { const s = circuitLab.freshSim; if (!s) return null; const u = s.analysis.parts['U1'], t = s.analysis.parts['T1'];
  const sc = circuitLab.doc.parts.find(p => p.kind === 'scope'); const m = sc ? circuitLab.scope.frame(sc.params).measure[0] : null;
  return u && u.extra ? Object.assign({ t: s.t, diag: s.analysis.diagnostics.map(d => d.message).join(' | '), tr: t && t.extra, sc: m }, u.extra) : null; })()"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f9'});
  v.controls.target.set(w.x - 14, 0, w.z); v.persp.position.set(w.x - 14, 40, w.z + 34); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""

def wait_x(page, cond, timeout=15000):
    page.wait_for_function(f"(() => {{ const x = {X}; return !!x && ({cond}); }})()", timeout=timeout, polling=250)
    return page.evaluate(X)

def close_drawer(page, mobile, side):
    if not mobile: return
    time.sleep(0.4)  # รอแอนิเมชันเลื่อนเข้า
    loc = page.locator(f'.panel.{side} .drawer-close')
    bb = loc.bounding_box() if loc.is_visible() else None
    if bb and 0 <= bb['x'] < page.viewport_size['width'] and 0 <= bb['y'] < page.viewport_size['height']: loc.click(force=True); time.sleep(0.4)
    # ปุ่มปิดเลื่อนพ้นจอไปกับเนื้อหาลิ้นชัก (เลื่อนลงไปแก้ช่องล่าง ๆ): ปิดด้วยปุ่มเดียวกันผ่าน DOM
    if page.evaluate(f"document.querySelector('.panel.{side}').classList.contains('open')"):
        page.evaluate(f"document.querySelector('.panel.{side} .drawer-close').click()"); time.sleep(0.5)

def set_num(page, mobile, part, field, value):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.4)
    if mobile and not page.locator(f'#{field}').is_visible(): page.click('#btn-right'); time.sleep(0.4)
    page.fill(f'#{field}', value); page.press(f'#{field}', 'Enter'); time.sleep(0.3)
    close_drawer(page, mobile, 'right')


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
        x = wait_x(page, 'x.t > 0.3 && x.tr && x.tr.ready && x.sc && x.sc.freq', timeout=120000)
        check(f'{tag}: ขาออก 7805 = 5 V คงแรงดัน', abs(x['vout'] - 5) < 0.03 and x['regulating'] == 1, f"vin={x['vin']:.2f} vout={x['vout']:.4f}")
        tr = x['tr']
        check(f'{tag}: หม้อแปลง A–CT ≈ 13–14 V rms (โหลดเบา), CT–B ไม่มีโหลด ≈ 13.9 V rms, กระแสยอด > 3 เท่ากระแส DC', 12.8 < tr['vrmsA'] < 14.2 and 13.5 < tr['vrmsB'] < 14.2 and tr['ipk'] > 3 * 0.055, f"A={tr['vrmsA']:.2f} B={tr['vrmsB']:.2f} Irms={tr['irmsA']:.3f} ipk={tr['ipk']:.3f}")
        sc = x['sc']
        check(f'{tag}: สโคปวัด ripple 100 Hz ประมาณ 0.3–0.7 Vpp บน DC ≈ 16–17.5 V', abs(sc['freq'] - 100) < 5 and 0.3 < sc['vpp'] < 0.7 and 15.5 < sc['vavg'] < 17.5, f"f={sc['freq']:.1f} vpp={sc['vpp']:.3f} avg={sc['vavg']:.2f}")
        page.screenshot(path=f'{OUT}/{tag}-psu-1-run.png')
        # สลับ CH1 เป็น DC แล้วกลับเป็น AC (ปุ่มในแผงสโคป)
        if page.locator('#sc-ac1').is_visible():
            page.click('#sc-ac1'); time.sleep(0.3)
            dc = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'scope').params.ac1")
            page.click('#sc-ac1'); time.sleep(0.3)
            ac = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'scope').params.ac1")
            check(f'{tag}: ปุ่ม DC/AC ของ CH1 สลับค่าได้', dc is False and ac is True, f'{dc} {ac}')
        else:
            check(f'{tag}: ปุ่ม DC/AC ของ CH1 สลับค่าได้', False, 'ไม่เห็นปุ่ม #sc-ac1')
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'T1', pin: 'CT'});
          v.controls.target.copy(w); v.persp.position.set(w.x, w.y + 22, w.z + 20); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'T1', 'pin': 'CT'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขั้ว CT → ป้าย "T1 · CT แท็ปกลาง"', t is not None and t.startswith('T1 · CT'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-psu-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("แหล่งจ่ายไฟ DC")').count(): page.click('.lesson-card:has-text("แหล่งจ่ายไฟ DC")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 6", timeout=30000, polling=500)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        n_ok = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 22 ผ่าน 6 ข้อหลัก', page.locator('#lesson-goals .goal').count() == 7 and n_ok >= 6, f'{n_ok} — ' + goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-psu-3-lesson.png')
        close_drawer(page, mobile, 'left')
        # ถอดปลั๊ก
        page.evaluate("circuitLab.select({t: 'part', id: 'T1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.4)
        page.uncheck('#f-tr-on'); time.sleep(0.4)
        close_drawer(page, mobile, 'right')
        x = wait_x(page, 'x.tr && x.tr.on === 0', timeout=30000)
        check(f'{tag}: ถอดปลั๊ก → หม้อแปลงไม่มีไฟ + ข้อความ "ถอดปลั๊ก"', 'ถอดปลั๊ก' in x['diag'], x['diag'][:120])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("หม้อแปลง")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'T1', pin: 'CT'}).clone(); w.set(-36, -2.4, -26);
          v.controls.target.copy(w); v.persp.position.set(w.x, 40, w.z + 30); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        p = page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'T1', pin: 'CT'}).clone(); w.set(-36, -2.4, -26);
          v.camera.updateMatrixWorld(); const q = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; }""")
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'transformer').map(p => [p.id, p.placement.kind])")
        check(f'{tag}: วางหม้อแปลงใหม่บนโต๊ะจากคลังอุปกรณ์', len(m) == 2 and all(k == 'table' for _, k in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-psu-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
