"""E2E: เบรดบอร์ดเต็มแผ่น MB-102 (830 จุด) ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดแลป 33 (บอร์ด CL-400 + DMM/VOM ข้างบอร์ด) → Run วัดค่า → เลือกบอร์ด → ชิป "MB-102" → บอร์ดยาว 165 mm มิเตอร์ถูกย้ายไม่ทับ ค่าวัดเท่าเดิม
→ วางตัวต้านทานจากคลังที่ a50 (คอลัมน์ที่ CL-400 ไม่มี) → เปลี่ยนกลับ CL-400 ไม่ได้ (บอกชื่ออุปกรณ์) → Undo กลับ CL-400 ได้ → ไม่มี JavaScript error
ใช้: python3 tests/e2e/board_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson33-meters.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; const b = circuitLab.doc.breadboards[0]; const parts = circuitLab.doc.parts;
  return { model: b.model, v: s && s.analysis.parts.R2 ? s.analysis.parts.R2.voltage : null, n: parts.length,
    tables: parts.filter(q => q.placement.kind === 'table').map(q => [q.id, q.placement.x, q.placement.z]) }; })()"""
OVERLAP = """(() => { const b = circuitLab.doc.breadboards[0]; const hw = b.model === 'MB-102' ? 165.1 / 2.54 / 2 : 32.4 / 2, hh = b.model === 'MB-102' ? 54.6 / 2.54 / 2 : 19.6 / 2;
  const v = circuitLab.view; const out = [];
  for (const [id, o] of v.partObjs) { const p = circuitLab.doc.parts.find(q => q.id === id); if (!p || p.placement.kind !== 'table') continue;
    o.updateMatrixWorld(true); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    o.traverse(m => { if (m.isMesh && m.geometry && m.visible && !m.userData.noPick && !m.userData.isWire) { m.geometry.computeBoundingBox(); const g = m.geometry.boundingBox;
      for (const cx of [g.min.x, g.max.x]) for (const cz of [g.min.z, g.max.z]) { const pt = m.localToWorld(g.min.clone().set(cx, g.min.y, cz)); x0 = Math.min(x0, pt.x); x1 = Math.max(x1, pt.x); z0 = Math.min(z0, pt.z); z1 = Math.max(z1, pt.z); } } });
    if (p.kind === 'dmm' || p.kind === 'vom') if (x0 < b.x + hw && x1 > b.x - hw && z0 < b.z + hh && z1 > b.z - hh) out.push(id); }
  return out; })()"""

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

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def toggle(page, mobile, sw):
    open_props(page, mobile, sw)
    page.click('#props .btn-row button'); time.sleep(0.3)
    if mobile: close_drawers(page)

def wait_st(page, cond, timeout=20000):
    try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && ({cond}); }})()", timeout=timeout, polling=100)
    except Exception: pass
    return page.evaluate(ST)

def select_board(page, mobile):
    page.evaluate("circuitLab.select({t: 'board', id: 'bb1'})"); time.sleep(0.4)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

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
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape'); time.sleep(0.3)
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.parts.R2", timeout=20000)
        except Exception: pass
        s0 = page.evaluate(ST)
        check(f'{tag}: เปิดแลป 33 บน CL-400 แล้ว Run วัดแรงดัน R2 ได้', s0['model'] == 'CL-400' and s0['v'] is not None and abs(s0['v']) > 1, str(s0))
        select_board(page, mobile)
        txt = page.inner_text('#props')
        check(f'{tag}: แผงเบรดบอร์ดมีชิปเลือกรุ่น CL-400 / MB-102 พร้อมขนาด mm', page.locator('#f-board-MB-102').count() == 1 and '165.1 × 54.6 mm' in txt and '82.3 × 49.8 mm' in txt, txt[:160].replace('\n', ' | '))
        page.click('#f-board-MB-102'); time.sleep(2.0)
        if mobile: close_drawers(page)
        try: page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.doc === circuitLab.doc", timeout=20000)
        except Exception: pass
        s1 = page.evaluate(ST); status = page.inner_text('#status-msg')
        check(f'{tag}: ชิป MB-102 → บอร์ดเป็น 830 จุด มิเตอร์ถูกย้ายออกข้างบอร์ด (แจ้งในแถบสถานะ)', s1['model'] == 'MB-102' and 'ย้าย' in status, f"{status} {s1['tables']}")
        ov = page.evaluate(OVERLAP)
        check(f'{tag}: มิเตอร์ทั้งสองไม่ทับบอร์ดที่ยาวขึ้น (ตรวจจากโมเดล 3 มิติจริง)', ov == [], str(ov))
        check(f'{tag}: วงจรเดิมทำงานเหมือนเดิม — แรงดัน R2 เท่าเดิม', s1['v'] is not None and abs(s1['v'] - s0['v']) < 1e-9, f"{s0['v']} → {s1['v']}")
        page.click('#btn-stop'); time.sleep(0.3)
        page.screenshot(path=f'{OUT}/{tag}-board-1-mb102.png')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ตัวต้านทาน")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'a52', 16)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'a50'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'resistor' && p.placement.anchor === 'a50')", timeout=5000)
        except Exception: pass
        rid = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'resistor' && p.placement.anchor === 'a50') || {}).label || null")
        check(f'{tag}: วางตัวต้านทานจากคลังที่ a50 (คอลัมน์ที่ CL-400 ไม่มี) ได้', rid is not None, str(rid))
        page.screenshot(path=f'{OUT}/{tag}-board-2-a50.png')
        select_board(page, mobile)
        page.click('#f-board-CL-400'); time.sleep(0.5)
        status = page.inner_text('#status-msg')
        if mobile: close_drawers(page)
        check(f'{tag}: เปลี่ยนกลับ CL-400 ไม่ได้ขณะมีอุปกรณ์ที่ a50 — บอกชื่ออุปกรณ์', page.evaluate("circuitLab.doc.breadboards[0].model") == 'MB-102' and rid and rid in status and 'คอลัมน์ 1–30' in status, status)
        page.evaluate("circuitLab.undo()"); time.sleep(0.4)
        page.evaluate("circuitLab.undo()"); time.sleep(0.6)
        check(f'{tag}: Undo สองครั้ง → กลับเป็น CL-400 และมิเตอร์กลับที่เดิม', page.evaluate("circuitLab.doc.breadboards[0].model") == 'CL-400' and page.evaluate(ST)['tables'] == s0['tables'], str(page.evaluate(ST)['tables']))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
