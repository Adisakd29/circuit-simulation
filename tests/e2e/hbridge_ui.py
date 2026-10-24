"""E2E: ไอซีขับมอเตอร์ L293D + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 28 (Pico GP14/15 → 1A/2A, GP16 PWM → 1,2EN, มอเตอร์ระหว่าง 1Y–2Y, VCC1 = VBUS, VCC2 = 6 V) → Run
→ โค้ดสั่งเดินหน้า (≈ 140 rpm, ช่อง 1 สูง ช่อง 2 ต่ำ, จานในฉากหมุน) → ถอยหลัง (ติดลบ) → ถอยหลังช้า (PWM)
→ แผงผลแสดงสถานะช่อง → แลป 28 ผ่าน 5 ข้อ → ชี้/แตะรู e24 → ป้าย "U1 · ขา 14 4Y" → ย้าย VCC1 ไป 3V3 → มอเตอร์หยุด + เตือน
→ ลบ U1 แล้ววาง L293D ใหม่ที่ f22 จากคลังอุปกรณ์
ใช้: python3 tests/e2e/hbridge_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson28-hbridge.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
STATE = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.U1 || !s.analysis.parts.M1) return null; const x = s.analysis.parts.U1.extra; const m = s.analysis.parts.M1;
  const d = circuitLab.view.partObjs.get('M1').userData.motorDisc; return { t: s.t, s1: x.s1, s2: x.s2, rpm: m.extra.rpm, disc: d ? d.rotation.z : null, vcc1: x.vcc1 }; })()"""

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def wait_state(page, cond, timeout=40000):
    try: page.wait_for_function(f"(() => {{ const x = {STATE}; return x && ({cond}); }})()", timeout=timeout, polling=100)
    except Exception: pass
    return page.evaluate(STATE)

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
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        f = wait_state(page, 'x.rpm > 100 && x.s1 === 1 && x.s2 === 0', 60000)
        time.sleep(0.4)
        f2 = page.evaluate(STATE)
        check(f'{tag}: เดินหน้า: ช่อง 1 สูง ช่อง 2 ต่ำ ความเร็ว 100–200 rpm (ต่ำกว่าต่อตรง 6 V เพราะแรงดันตกในไอซี)', f and 100 < f['rpm'] < 200 and f['s1'] == 1 and f['s2'] == 0, str(f))
        check(f'{tag}: จานมอเตอร์ในฉากหมุนตาม', f and f2 and f['disc'] is not None and abs(f2['disc'] - f['disc']) > 0.05, f"{f and f['disc']} → {f2 and f2['disc']}")
        focus(page, 'h26', 22)
        page.screenshot(path=f'{OUT}/{tag}-hb-1-forward.png')
        r = wait_state(page, 'x.rpm < -130 && x.s1 === 0 && x.s2 === 1', 30000)
        check(f'{tag}: ถอยหลัง: ช่อง 1 ต่ำ ช่อง 2 สูง ความเร็วติดลบ (≈ −140 rpm)', r and r['rpm'] < -130 and r['s1'] == 0 and r['s2'] == 1, str(r))
        sl = wait_state(page, 'x.rpm < -20 && x.rpm > -112', 30000)
        check(f'{tag}: PWM ที่ EN (duty 46%) → ถอยหลังช้าลง (≈ −100 rpm)', sl and -112 < sl['rpm'] < -20 and sl['t'] > r['t'], str(sl))
        page.evaluate("circuitLab.select({t: 'part', id: 'U1'})"); time.sleep(0.5)
        if mobile: page.click('#btn-right'); time.sleep(0.4)
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงคุณสมบัติ/ผลแสดงตารางทิศมอเตอร์และสถานะแต่ละช่อง', 'หมุนกลับทาง' in txt and 'ช่อง 1 (1Y)' in txt and 'กำลังสูญเสียในไอซี' in txt, txt[txt.find('ช่อง 1'):][:80].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-hb-2-panel.png')
        if mobile and page.locator('.panel.right .drawer-close').is_visible(): page.click('.panel.right .drawer-close', force=True); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("L293D")').count(): page.click('.lesson-card:has-text("L293D")')
        try: page.wait_for_function("[...document.querySelectorAll('#lesson-goals .goal')].filter(g => !g.textContent.includes('ไม่บังคับ')).every(g => g.classList.contains('pass'))", timeout=15000, polling=250)
        except Exception: pass
        req = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal')].filter(g => !g.textContent.includes('ไม่บังคับ')).map(g => g.classList.contains('pass'))")
        check(f'{tag}: แลป 28 ผ่านครบ 5 ข้อที่บังคับ (power/inputs/motor/forward/reverse)', len(req) == 5 and all(req), page.inner_text('#lesson-goals')[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-hb-3-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close', force=True); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)  # ซ่อนแผง Pico ที่บังฉาก
        focus(page, 'e24', 10)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'e24'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู e24 → ป้าย "U1 · ขา 14 4Y ..."', t is not None and t.startswith('U1 · ขา 14 4Y'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-hb-4-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # VCC1 → 3V3 (ขา 36 = c5 ของ Pico ที่ h1)
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc));
          const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.hole === 'a22')); const e = [w.a, w.b].find(t => t.hole !== 'a22'); e.hole = 'a5';
          app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        z = wait_state(page, 'x.s1 === -1 && x.s2 === -1 && Math.abs(x.rpm) < 1', 15000)
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'U1').map(d => d.message).join(' | ')")
        check(f'{tag}: VCC1 จาก 3V3 → ขาออกลอย มอเตอร์หยุด + เตือนให้ใช้ 5 V', z and z['s1'] == -1 and abs(z['rpm']) < 1 and 'VCC1' in d, f'{z} {d[:120]}')
        page.click('#btn-stop'); time.sleep(0.4)
        # ลบ U1 แล้ววางใหม่จากคลัง
        page.evaluate("circuitLab.select({t: 'part', id: 'U1'}); circuitLab.deleteSelected()"); time.sleep(0.3)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ขับมอเตอร์")'); time.sleep(0.3)
        focus(page, 'f25', 14)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f22'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'hbridge').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง L293D ใหม่ที่ f22 จากคลังอุปกรณ์', len(m) == 1 and m[0][1] == 'f22', str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-hb-5-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
