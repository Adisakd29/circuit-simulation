"""E2E LED RGB + Arduino Uno (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ (vite preview proxy → server/server.mjs)
เปิดวงจรเริ่มต้นแลป 44 (Uno + ตัวต้านทาน 3 ตัว + สาย, ยังไม่มี LED) → วาง LED RGB จากคลังที่ c20 → คอมไพล์ + อัปโหลดโค้ดวนสี → Run
→ เลนส์ในฉากเรืองสีแดง เขียว น้ำเงิน เหลือง ม่วงแดง และแดงหรี่ ตามกระแสที่จำลอง · แผงผลบอกกระแสแต่ละสี → แลป 44 ผ่านครบ 6 ข้อ มีรูปวงจร
→ เปลี่ยนชนิดเป็นแอโนดร่วม (ไม่ย้ายสาย) → ดับหมด + แจ้งไบแอสกลับ → Undo → กลับมาติด · ไม่มี JavaScript error
ใช้: python3 tests/e2e/rgb_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson44-rgb-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
# สีเรืองของเลนส์ในฉาก (จากวัสดุของโมเดล 3D) → ชื่อสี
LENS = """(() => { const id = (circuitLab.doc.parts.find(p => p.kind === 'rgbled') || {}).id; let m = null;
  circuitLab.view.scene.traverse(o => { if (!m && o.userData.lens && o.userData.partId === id) m = o.userData.lens; });
  if (!m) return null; const c = m.emissive; return { r: c.r, g: c.g, b: c.b, k: m.emissiveIntensity }; })()"""
CUR = "(() => { const s = circuitLab.freshSim; const l = circuitLab.doc.parts.find(p => p.kind === 'rgbled'); const x = s && l && s.analysis.parts[l.id] && s.analysis.parts[l.id].extra; return x ? [x.i_R, x.i_G, x.i_B] : null; })()"

def lens_name(l):
    if not l or l['k'] < 0.15: return 'off'
    on = [l['r'] > 0.5, l['g'] > 0.5, l['b'] > 0.5]
    n = {(1, 0, 0): 'red', (0, 1, 0): 'green', (0, 0, 1): 'blue', (1, 1, 0): 'yellow', (1, 0, 1): 'magenta', (0, 1, 1): 'cyan', (1, 1, 1): 'white'}.get(tuple(int(v) for v in on), 'mix')
    if n == 'red' and l['k'] < 0.75: n = 'dim red'  # เรืองแสง = ความสว่าง × 1.1 (เต็ม ≈ 1.1, ค่า 64 ≈ 0.44)
    return n

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def goals(page, mobile, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("LED RGB")').count(): page.click('.lesson-card:has-text("LED RGB")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.2)
        # 1) วาง LED RGB จากคลัง
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.fill('#lib-search', 'rgb'); time.sleep(0.3)
        sup = page.inner_text('.lib-item[data-kind="rgbled"] .nm')
        page.click('.lib-item[data-kind="rgbled"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'c21', 16)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'c20'}); tap(s['x'], s['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'rgbled')", timeout=5000)
        except Exception: pass
        led = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'rgbled') || {})")
        check(f'{tag}: วาง LED RGB จากคลังที่ c20 (แคโทดร่วม, ป้าย "จำลองครบ")', led.get('placement', {}).get('anchor') == 'c20' and led['params']['common'] == 'cc' and 'จำลองครบ' in sup, f"{led.get('placement')} {sup}")
        lid = led.get('id')
        page.screenshot(path=f'{OUT}/{tag}-rgb-1-placed.png')
        # 2) อัปโหลด + Run
        props(page, mobile, 'UNO1')
        page.click('#f-uno-upload')
        page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200); time.sleep(0.3)
        up = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'UNO1').params; return !!p.hex && p.hexSrc === p.code; })()")
        check(f'{tag}: คอมไพล์ + อัปโหลดโค้ดวนสีผ่าน', up, str(page.evaluate("circuitLab.unoError")))
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.unoConsole || '').includes('red')", timeout=60000, polling=200)
        except Exception: pass
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'pin', partId: '{lid}', pin: 'COM'}}); v.controls.target.set(w.x, 1, w.z); v.persp.position.set(w.x + 4, 12, w.z + 12); v.controls.update(); v.requestRender(); }}""")
        seen, shots, maxI = set(), {}, [0, 0, 0]
        t0 = time.time()
        while time.time() - t0 < 25 and not {'red', 'green', 'blue', 'yellow', 'magenta', 'dim red', 'off'} <= seen:
            l = page.evaluate(LENS); n = lens_name(l); seen.add(n)
            c = page.evaluate(CUR)
            if c: maxI = [max(a, b) for a, b in zip(maxI, c)]
            if n in ('red', 'yellow', 'magenta') and n not in shots:
                page.screenshot(path=f'{OUT}/{tag}-rgb-2-{n}.png'); shots[n] = 1
            time.sleep(0.08)
        check(f'{tag}: เลนส์ในฉากเรืองสีตามกระแสที่จำลอง: แดง เขียว น้ำเงิน เหลือง ม่วงแดง แดงหรี่ ดับ', {'red', 'green', 'blue', 'yellow', 'magenta', 'dim red', 'off'} <= seen, str(sorted(seen)))
        check(f'{tag}: กระแสสูงสุด แดง ≈ 12.5 mA เขียว/น้ำเงิน ≈ 7.5 mA (Vf ต่างกัน)', 11.5e-3 < maxI[0] < 13.5e-3 and all(6.5e-3 < v < 8.5e-3 for v in maxI[1:]), str([round(v * 1000, 2) for v in maxI]))
        # 2b) หยุดเวลาขณะแดงหรี่ → ยังหรี่อยู่ (คงค่าเฉลี่ย PWM ไม่ใช่สถานะขาชั่วขณะ)
        # กดปุ่มหยุดเวลาจากในหน้าเว็บทันทีที่กระแสแดงอยู่ในช่วงหรี่ 2 ครั้งติดกัน (การคลิกจาก Python ช้ากว่าช่วงสี 0.5 s)
        if page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        page.evaluate("window.__dimN = 0")
        try: page.wait_for_function(f"""(() => {{ const c = {CUR}; const ok = c && c[0] > 2.5e-3 && c[0] < 3.8e-3 && c[1] < 1e-6 && c[2] < 1e-6;
          window.__dimN = ok ? window.__dimN + 1 : 0; if (window.__dimN >= 2) {{ document.getElementById('lg-pause').click(); return true; }} return false; }})()""", timeout=40000, polling=60)
        except Exception: pass
        time.sleep(1.2)
        names = []
        for _ in range(6): names.append(lens_name(page.evaluate(LENS))); time.sleep(0.2)
        ip = page.evaluate(CUR)
        page.click('#lg-pause'); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        check(f'{tag}: กดหยุดเวลาขณะแดงหรี่ (PWM 64) → เลนส์ยังหรี่ กระแสเฉลี่ย ≈ 3 mA (ไม่กลายเป็นติดเต็ม/ดับ)', all(n == 'dim red' for n in names) and ip and 2.5e-3 < ip[0] < 3.8e-3, f'{names} {ip}')
        # 3) แลป 44
        g = goals(page, mobile, 6, 40000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('~D10') && s.innerHTML.includes('COM'); })()")
        check(f'{tag}: แลป 44 ผ่านครบ 6 ข้อ และมีรูปวงจร', len(g) == 6 and svg_ok, f'{g} {svg_ok} ach={page.evaluate("JSON.stringify(circuitLab.work.achieved.rgb)")} id={page.evaluate("circuitLab.work.lessonId")}')
        page.screenshot(path=f'{OUT}/{tag}-rgb-3-lesson.png')
        if mobile: close_drawers(page)
        # 4) เปลี่ยนชนิดเป็นแอโนดร่วมโดยไม่ย้ายสาย → ไม่ติด + คำเตือน → Undo
        props(page, mobile, lid)
        rows = page.inner_text('#props')
        page.select_option('#f-common', 'ca'); time.sleep(0.3)
        if mobile: close_drawers(page)
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.message.includes('ไบแอสกลับ')); })()", timeout=20000, polling=200)
        except Exception: pass
        diag = page.evaluate("(() => { const s = circuitLab.freshSim; return s ? s.analysis.diagnostics.map(d => d.message).filter(m => m.includes('ไบแอสกลับ')).join(' ') : ''; })()")
        dark = all(lens_name(page.evaluate(LENS)) == 'off' for _ in range(5) if time.sleep(0.15) is None)
        check(f'{tag}: แผงคุณสมบัติบอกกระแสแต่ละสี · เปลี่ยนเป็นแอโนดร่วมโดยไม่ย้ายสาย → ไม่ติด + แจ้งไบแอสกลับ', 'กระแสสีเขียว (G)' in rows and 'สีที่เห็น' in rows and dark and 'แอโนดร่วม' in diag, f'{dark} {diag[:80]!r}')
        page.evaluate("circuitLab.undo()"); time.sleep(0.3)
        back = page.evaluate(f"circuitLab.doc.parts.find(p => p.id === '{lid}').params.common")
        lit = False; t0 = time.time()
        while time.time() - t0 < 6 and not lit:
            lit = lens_name(page.evaluate(LENS)) != 'off'; time.sleep(0.1)
        check(f'{tag}: Undo → กลับเป็นแคโทดร่วม LED ติดอีกครั้ง', back == 'cc' and lit, f'{back} {lit}')
        page.click('#btn-stop')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
