"""E2E: โมดูลรีเลย์ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 19 (Pico GP15 → S, VBUS → +, GND → −, โหลด LED ผ่าน COM–NO) → Run → MicroPython สลับ GP15 ทุก 0.5 s
→ รีเลย์ดึง/ปล่อยสลับกัน, LED โหลดติด/ดับตาม, LED บนโมดูลสว่างเมื่อดึง → แลป 19 ผ่านครบ 4 ข้อ
→ ชี้/แตะขา S ของโมดูล → ป้ายชื่อขา → ย้ายสาย + ไป 3V3 → ไม่ดึง + คำเตือน VBUS → วางรีเลย์ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/relay_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson19-relay.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
STATE = """(() => { const s = circuitLab.freshSim; if (!s) return null; const k = s.analysis.parts['K1']; let led = -1;
  circuitLab.view.scene.traverse(o => { if (o.userData.relayLed) led = Math.max(led, o.userData.relayLed.emissiveIntensity); });
  return { on: k && k.extra ? k.extra.energized : -1, vcc: k && k.extra ? k.extra.vcc : 0, load: s.analysis.parts['LED1'].current, led }; })()"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'K1', pin: 'V'});
  v.controls.target.set(w.x + 4, 0, w.z); v.persp.position.set(w.x + 4, 30, w.z + 26); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""


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
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=20000, polling=250)
        seen = []
        t0 = time.time()
        while time.time() - t0 < 9:
            s = page.evaluate(STATE)
            if s: seen.append(s)
            if any(x['on'] == 1 for x in seen) and any(x['on'] == 0 for x in seen[3:]) and len(seen) > 10: break
            time.sleep(0.25)
        on = [x for x in seen if x['on'] == 1]
        off = [x for x in seen if x['on'] == 0]
        check(f'{tag}: MicroPython สลับ GP15 → รีเลย์ดึงและปล่อยสลับกัน', len(on) > 0 and len(off) > 0, f'on={len(on)} off={len(off)}')
        check(f'{tag}: ดึง → LED โหลด (COM–NO) ติด และ LED บนโมดูลสว่าง', on and all(x['load'] > 5e-3 for x in on) and max(x['led'] for x in on) > 0.5,
              str([(round(x['load'] * 1e3, 2), round(x['led'], 2)) for x in on[:3]]))
        check(f'{tag}: ปล่อย → LED โหลดดับ และ LED บนโมดูลดับ', off and min(x['load'] for x in off) < 1e-5 and min(x['led'] for x in off) < 0.05,
              str([(x['load'], round(x['led'], 2)) for x in off[:3]]))
        page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.parts['K1'].extra.energized === 1; })()", timeout=8000, polling=200)
        page.screenshot(path=f'{OUT}/{tag}-relay-1-on.png')
        # ชื่อขาเมื่อชี้/แตะ (มือถือ: พับแผงเวลาจำลองที่บังฉากก่อน)
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.4)
        page.evaluate(FOCUS); time.sleep(0.4)
        s = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'K1', 'pin': 'NO'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': s['x'], 'y': s['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(s['x'], s['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขั้ว NO → ป้าย "K1 · NO ..."', t is not None and t.startswith('K1 · NO'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-relay-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # แลป 19
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("รีเลย์")').count(): page.click('.lesson-card:has-text("รีเลย์")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 4", timeout=15000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 19 ผ่านครบ 4 ข้อ (power/control/load/follow)', page.locator('#lesson-goals .goal').count() == 4 and page.locator('#lesson-goals .goal.pass').count() == 4, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-relay-3-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close'); time.sleep(0.3)
        # ย้ายไฟเลี้ยงไป 3V3 (ขา 36 = a10 สำหรับ Pico ที่ h5) → ไม่ดึง + เตือน
        page.evaluate("""() => { const app = circuitLab; const pico = app.doc.parts.find(p => p.id === 'PICO1'); const ph = window.__cl.pinHolesFor(pico).find(x => x.pin === '3V3');
          const doc = JSON.parse(JSON.stringify(app.doc)); const w = doc.wires.find(w => w.a.kind === 'pin' && w.a.partId === 'K1' && w.a.pin === 'V'); w.b.hole = 'a' + ph.hole.slice(1);
          app.apply({ ok: true, doc, warnings: [] }, 'ย้ายสาย'); }""")
        time.sleep(1.5)
        st = page.evaluate(STATE)
        on_after, diag = page.evaluate("""(async () => { let n = 0, d = ''; for (let i = 0; i < 16; i++) { await new Promise(r => setTimeout(r, 250)); const s = circuitLab.freshSim; if (!s) continue;
          if (s.analysis.parts['K1'].extra.energized === 1) n++; const m = s.analysis.diagnostics.map(x => x.message).join(' | '); if (m.includes('VBUS')) d = m; } return [n, d]; })()""")
        check(f'{tag}: + ต่อ 3V3 → ไม่ดึงเลย และมีคำเตือนให้ใช้ VBUS', on_after == 0 and 'VBUS' in diag and abs(st['vcc'] - 3.3) < 0.2, f'on={on_after} vcc={st["vcc"]:.2f} {diag[:160]}')
        page.screenshot(path=f'{OUT}/{tag}-relay-4-3v3.png')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("รีเลย์")'); time.sleep(0.3)
        # เล็งกล้องไปที่พื้นโต๊ะว่างข้าง K1 (x +16 จากศูนย์กลาง K1) แล้วแตะ/คลิกจุดนั้น
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'K1', pin: 'V'});
          v.controls.target.set(w.x + 5.75 + 16, -2.4, w.z); v.persp.position.set(w.x + 5.75 + 16, 30, w.z + 26); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        s = page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'K1', pin: 'V'}).clone(); w.set(w.x + 5.75 + 16, -2.4, w.z);
          v.camera.updateMatrixWorld(); const p = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }""")
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'relay').map(p => [p.id, p.placement.kind])")
        check(f'{tag}: วางโมดูลรีเลย์ใหม่บนโต๊ะจากคลังอุปกรณ์', len(m) == 2 and all(k == 'table' for _, k in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-relay-5-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
