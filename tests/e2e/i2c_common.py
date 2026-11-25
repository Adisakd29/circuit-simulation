"""ตัวช่วยร่วมของ e2e แลป 45/46 (บัส I²C)"""
import time

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
WORLD_TO_SCREEN = """([x, y, z]) => { const v = circuitLab.view; const w = v.camera.position.clone().set(x, y, z); v.camera.updateMatrixWorld(); const p = w.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""

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

def tool(page, label):
    for _ in range(4):
        try:
            page.click(f'.tool[aria-label="{label}"]', timeout=3000); return
        except Exception:
            time.sleep(0.4)
    page.click(f'.tool[aria-label="{label}"]')

def goals(page, mobile, card, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator(f'.lesson-card:has-text("{card}")').count(): page.click(f'.lesson-card:has-text("{card}")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

def tap_factory(page, mobile):
    def tap(x, y):
        if mobile: page.touchscreen.tap(x, y)
        else: page.mouse.click(x, y)
        time.sleep(0.2)
    def tap_hole(hole, dist=14):
        focus(page, hole, dist)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': hole}); tap(s['x'], s['y'])
    return tap, tap_hole

def screen_text(page):
    """ข้อความบนจอ OLED ตามแผงผลของจอ (อ่านจากหน่วยความจำจอที่จำลอง)"""
    return page.evaluate("""(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : ''; })()""")

def kv(page, label):
    return page.evaluate(f"""(() => {{ const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('{label}')); return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : ''; }})()""")
