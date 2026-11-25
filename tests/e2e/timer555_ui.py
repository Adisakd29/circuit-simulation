"""E2E: ไอซี NE555 ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 20 (astable RA 1 k, RB 10 k, C 47 µF, LED ที่ขาออก) → Run → LED กะพริบ, ความถี่ในแผงผลตรงทฤษฎี
→ ป้ายชื่อขาที่รู f11 (TRIG) → แก้ C เป็น 10 µF ในแผงคุณสมบัติ → ความถี่ใหม่ตรงทฤษฎี → แลป 20 ผ่านครบ 5 ข้อ
→ วาง 555 ใหม่จากคลังอุปกรณ์คร่อมร่อง
ใช้: python3 tests/e2e/timer555_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson20-555.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
X = "(() => { const s = circuitLab.freshSim; if (!s) return null; const u = s.analysis.parts['U1']; return u && u.extra ? Object.assign({ led: s.analysis.parts['LED1'].current }, u.extra) : null; })()"
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f12'});
  v.controls.target.set(w.x + 1, 0, w.z); v.persp.position.set(w.x + 1, 16, w.z + 13); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""

def sample(page, secs):
    # เก็บตัวอย่างในหน้าเว็บเอง (ทุก 60 ms) — เรียก evaluate ทีละครั้งช้าเกินเมื่อเรนเดอร์ด้วยซอฟต์แวร์
    return page.evaluate(f"""(async () => {{ const out = []; const t0 = performance.now();
      while (performance.now() - t0 < {secs * 1000}) {{ const x = {X}; if (x) out.push(x);
        if (out.filter(o => o.q === 1).length >= 2 && out.filter(o => o.q === 0).length >= 2) break; await new Promise(r => setTimeout(r, 60)); }} return out; }})()""")


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
        s = sample(page, 15)
        on = [x for x in s if x['q'] == 1]; off = [x for x in s if x['q'] == 0]
        check(f'{tag}: ขาออกสลับ HIGH/LOW และ LED ติด/ดับตาม', on and off and min(x['led'] for x in on) > 5e-3 and max(x['led'] for x in off) < 1e-5, f'on={len(on)} off={len(off)}')
        page.wait_for_function(f"(() => {{ const x = {X}; return x && x.freq > 0; }})()", timeout=15000, polling=250)
        x = page.evaluate(X)
        check(f'{tag}: ความถี่ที่วัดได้ตรงทฤษฎี ±5% (C 47 µF ≈ 1.46 Hz)', abs(x['freq'] / x['fth'] - 1) < 0.05 and abs(x['fth'] - 1.459) < 0.01, f"{x['freq']:.4f} vs {x['fth']:.4f} duty {x['duty']:.3f}")
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate(FOCUS); time.sleep(0.4)
        page.screenshot(path=f'{OUT}/{tag}-555-1-run.png')
        # ป้ายชื่อขาที่รู f11 (ขา 2 TRIG)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f11'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู f11 → ป้าย "U1 · ขา 2 TRIG ..."', t is not None and t.startswith('U1 · ขา 2 TRIG'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-555-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # แผงผลของ U1
        page.evaluate("circuitLab.select({t: 'part', id: 'U1'})"); time.sleep(0.5)
        if mobile: page.click('#btn-right'); time.sleep(0.4)
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดงความถี่ที่วัดได้ duty และค่าทฤษฎี', 'ความถี่ที่วัดได้' in txt and 'duty' in txt and 'ทฤษฎี' in txt, txt[txt.find('ค่าจากการจำลอง'):][:200].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-555-3-panel.png')
        # แก้ C1 เป็น 10 µF
        page.evaluate("circuitLab.select({t: 'part', id: 'C1'})"); time.sleep(0.4)
        page.fill('#f-capacitance', '10u'); page.press('#f-capacitance', 'Enter'); time.sleep(0.3)
        c = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'C1').params.capacitance")
        page.wait_for_function(f"(() => {{ const x = {X}; return x && Math.abs(x.fth - 6.857) < 0.01 && x.freq > 0 && Math.abs(x.freq / x.fth - 1) < 0.05; }})()", timeout=20000, polling=250)
        x = page.evaluate(X)
        check(f'{tag}: C = 10 µF → ความถี่ใหม่ ≈ 6.86 Hz ตรงทฤษฎี ±5%', abs(c - 10e-6) < 1e-12 and abs(x['freq'] / x['fth'] - 1) < 0.05, f"C={c} {x['freq']:.3f} vs {x['fth']:.3f}")
        if mobile and page.locator('.panel.right .drawer-close').is_visible(): page.click('.panel.right .drawer-close'); time.sleep(0.3)
        # แลป 20
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("555")').count(): page.click('.lesson-card:has-text("555")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=10000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 20 ผ่านครบ 5 ข้อ (power/network/oscillate/blink/change)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-555-4-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close'); time.sleep(0.3)
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ไทเมอร์ 555")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f23'});
          v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 14, w.z + 10); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f23'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'timer555').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง 555 ใหม่ที่ f23 คร่อมร่องจากคลังอุปกรณ์', len(m) == 2 and any(a == 'f23' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-555-5-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
