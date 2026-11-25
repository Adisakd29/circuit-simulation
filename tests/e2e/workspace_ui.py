"""E2E Workspace (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
1) มุมกล้องสำเร็จรูป: ปุ่มมุมกล้อง → ด้านหน้า / ด้านข้าง / ไอโซเมตริก / ด้านบน — ทิศกล้องถูกต้อง และมุมเบรดบอร์ด + อุปกรณ์อยู่ในจอ
2) ชื่อขาทั้งหมด: เปิด → ป้ายชื่อขาของ Uno/LED/ตัวต้านทานอยู่ในพื้นที่ทำงาน ไม่ทับกัน · ปิด → ไม่มีป้าย
3) หลายเบรดบอร์ด: เพิ่มบอร์ดแผ่นที่ 2 (ไม่ทับของเดิม) → วางตัวต้านทานจากคลังบนบอร์ดใหม่ → ต่อสายข้ามบอร์ด (เครื่องมือต่อสาย)
   → เน็ตเดียวกัน · ลบบอร์ดที่มีอุปกรณ์ไม่ได้ (บอกเหตุผล) · Undo กลับเป็นแผ่นเดียว · ไม่มี JavaScript error
ใช้: python3 tests/e2e/workspace_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, props, tool, cam_still

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

CAM = """(() => { const v = circuitLab.view; const c = v.camera.position, t = v.controls.target; const d = c.clone().sub(t).normalize();
  const boards = circuitLab.doc.breadboards; const S = { 'CL-400': [32.4, 19.6], 'MB-102': [65, 21.5] };
  const pts = []; for (const b of boards) { const [w, h] = S[b.model] || S['CL-400']; for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push(c.clone().set(b.x + sx * w / 2, 0, b.z + sz * h / 2)); }
  for (const p of circuitLab.doc.parts) if (p.placement.kind === 'table') pts.push(c.clone().set(p.placement.x, 0, p.placement.z));
  return { view: v.view, preset: v.preset, d: [d.x, d.y, d.z], inView: pts.every(p => v.inView(p, 1.0)) }; })()"""

def load(page, fx):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    page.set_input_files('#file-input', os.path.join(FIXD, fx)); time.sleep(1.0)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        tap = (lambda x, y: page.touchscreen.tap(x, y)) if mobile else (lambda x, y: page.mouse.click(x, y))

        # 1) มุมกล้อง
        load(page, 'lesson43-uno-start.json')
        if mobile: close_drawers(page)
        expect = {'front': lambda d: d[2] > 0.9 and abs(d[0]) < 0.05, 'side': lambda d: d[0] > 0.9 and abs(d[2]) < 0.05, 'iso': lambda d: d[0] > 0.45 and d[1] > 0.5 and d[2] > 0.45}
        for k, name in [('front', 'ด้านหน้า'), ('side', 'ด้านข้าง'), ('iso', 'ไอโซเมตริก')]:
            page.click('#btn-viewmenu'); time.sleep(0.2)
            page.click(f'#view-{k}'); time.sleep(0.4); cam_still(page)
            c = page.evaluate(CAM)
            menu_closed = page.locator('#view-menu').count() == 0
            check(f'{tag}: มุมกล้อง "{name}" → กล้อง perspective ทิศถูกต้อง เห็นมุมเบรดบอร์ดและอุปกรณ์ครบ · เมนูปิด', c['view'] == 'perspective' and c['preset'] == k and expect[k](c['d']) and c['inView'] and menu_closed, str(c))
            page.screenshot(path=f'{OUT}/{tag}-ws-view-{k}.png')
        page.click('#btn-viewmenu'); time.sleep(0.2)
        checked = page.evaluate("[...document.querySelectorAll('#view-menu [aria-checked=\"true\"]')].map(e => e.id)")
        page.click('#view-top'); time.sleep(0.4)
        check(f'{tag}: เมนูแสดงมุมที่เลือกอยู่ (ไอโซเมตริก) · "ด้านบน" → มุมมอง Top', checked == ['view-iso'] and page.evaluate("circuitLab.view.view") == 'top', str(checked))

        # 2) ชื่อขาทั้งหมด (มุมไอโซเมตริกทั้งโต๊ะ: ขาของ Uno · ซูมเข้าบอร์ด: ขา LED A/K และตัวต้านทาน)
        page.click('#btn-viewmenu'); time.sleep(0.2); page.click('#view-iso'); time.sleep(0.4); cam_still(page)
        page.click('#btn-pinlabels'); time.sleep(0.8)
        LABS = """(() => { const L = circuitLab.view.visiblePinLabels(); const r = circuitLab.view.renderer.domElement.getBoundingClientRect();
          const els = [...document.querySelectorAll('.pin-labels span')].map(e => e.getBoundingClientRect());
          let overlap = 0; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) overlap++; }
          return { n: L.length, parts: [...new Set(L.map(l => l.part))], pins: L.map(l => l.part + ':' + l.pin), inside: L.every(l => l.x >= 0 && l.y >= 0 && l.x <= r.width && l.y <= r.height), overlap, pressed: document.getElementById('btn-pinlabels').getAttribute('aria-pressed') }; })()"""
        labs = page.evaluate(LABS)
        check(f'{tag}: เปิดชื่อขาทั้งหมด (ทั้งโต๊ะ) → ป้ายขาของ Uno อยู่ในพื้นที่ทำงาน ไม่ทับกัน', labs['n'] >= (4 if mobile else 8) and 'UNO1' in labs['parts'] and labs['inside'] and labs['overlap'] == 0 and labs['pressed'] == 'true', str(labs)[:300])
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'c8'}); v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 12, w.z + 8); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }""")
        time.sleep(0.3); cam_still(page); time.sleep(0.3)
        labs2 = page.evaluate(LABS)
        check(f'{tag}: ซูมเข้าบอร์ด → ป้ายขา LED (A/K) และตัวต้านทาน (1/2) แสดงครบ ไม่ทับกัน', {'LED1:A', 'LED1:K', 'R1:1', 'R1:2'} <= set(labs2['pins']) and labs2['overlap'] == 0, str(labs2['pins']))
        page.screenshot(path=f'{OUT}/{tag}-ws-pinlabels.png')
        page.click('#btn-pinlabels'); time.sleep(0.4)
        check(f'{tag}: ปิดชื่อขา → ไม่มีป้าย', page.evaluate("document.querySelectorAll('.pin-labels span').length") == 0)

        # 3) หลายเบรดบอร์ด
        page.evaluate("circuitLab.select({t: 'board', id: 'bb1'})"); time.sleep(0.3)
        if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)
        page.locator('#f-board-add').scroll_into_view_if_needed(); page.click('#f-board-add'); time.sleep(0.8)
        bb = page.evaluate("circuitLab.doc.breadboards")
        sel = page.evaluate("circuitLab.selection")
        ov = page.evaluate("""(() => { const S = { 'CL-400': [32.4, 19.6], 'MB-102': [65, 21.5] }; const R = circuitLab.doc.breadboards.map(b => { const [w, h] = S[b.model]; return [b.x - w / 2, b.x + w / 2, b.z - h / 2, b.z + h / 2]; });
          const a = R[0], b = R[1]; return a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2]; })()""")
        check(f'{tag}: เพิ่มเบรดบอร์ด → มี bb1, bb2 ไม่ทับกัน · เลือกบอร์ดใหม่ · ปุ่ม "ลบเบรดบอร์ดนี้" ปรากฏ', [b['id'] for b in bb] == ['bb1', 'bb2'] and not ov and sel == {'t': 'board', 'id': 'bb2'} and page.locator('#f-board-del').count() == 1, f'{bb} {sel}')
        if mobile: close_drawers(page)
        cv = page.evaluate(CAM)
        check(f'{tag}: กล้องจัดใหม่ให้เห็นเบรดบอร์ดทั้งสองแผ่น', cv['inView'], str(cv))
        page.screenshot(path=f'{OUT}/{tag}-ws-2boards.png')
        # วางตัวต้านทานบน bb2
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.fill('#lib-search', 'ตัวต้านทาน'); time.sleep(0.3)
        page.click('.lib-item:has-text("ตัวต้านทาน")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb2', 'hole': 'c10'})
        tap(p['x'], p['y']); time.sleep(0.5)
        r2 = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'resistor' && p.placement.kind === 'board' && p.placement.boardId === 'bb2'); return p ? { id: p.id, a: p.placement.anchor } : null; })()")
        check(f'{tag}: วางตัวต้านทานจากคลังลงรู c10 ของเบรดบอร์ดแผ่นที่ 2', r2 is not None and r2['a'] == 'c10', str(r2))
        # สายข้ามบอร์ด: bb1 a28 → bb2 a10
        tool(page, 'ต่อสาย (W)'); time.sleep(0.2)
        for bid, hole in [('bb1', 'a28'), ('bb2', 'a10')]:
            q = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': bid, 'hole': hole}); tap(q['x'], q['y']); time.sleep(0.4)
        tool(page, 'เลือก / ย้าย (V)')
        w = page.evaluate("""(() => { const w = circuitLab.doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.boardId === 'bb2')); if (!w) return null;
          const c = circuitLab.conn(); const rid = circuitLab.doc.parts.find(p => p.kind === 'resistor' && p.placement.kind === 'board' && p.placement.boardId === 'bb2').id;
          const n = c.nets.find(n => n.partPins.some(pp => pp.partId === rid && pp.pin === '1'));
          return { a: w.a, b: w.b, joined: !!n && n.terminals.some(k => k.includes('bb1')) && n.terminals.some(k => k.includes('bb2')) }; })()""")
        check(f'{tag}: เครื่องมือต่อสาย: รู a28 (บอร์ด 1) → a10 (บอร์ด 2) → ขาตัวต้านทานบนบอร์ด 2 อยู่เน็ตเดียวกับบอร์ด 1', w and w['joined'], str(w))
        page.screenshot(path=f'{OUT}/{tag}-ws-crosswire.png')
        page.evaluate("circuitLab.select({t: 'board', id: 'bb2'})"); time.sleep(0.3)
        if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)
        page.locator('#f-board-del').scroll_into_view_if_needed(); page.click('#f-board-del'); time.sleep(0.4)
        status = page.inner_text('#status-msg')
        check(f'{tag}: ลบบอร์ดที่มีอุปกรณ์/สายไม่ได้ — บอกจำนวนที่ต้องย้ายออก', len(page.evaluate("circuitLab.doc.breadboards")) == 2 and 'อุปกรณ์ 1 ชิ้น' in status and 'สาย 1 เส้น' in status, status)
        if mobile: close_drawers(page)
        for _ in range(3): page.evaluate("circuitLab.undo()"); time.sleep(0.3)
        check(f'{tag}: Undo 3 ครั้ง → กลับเป็นเบรดบอร์ดแผ่นเดียว', [b['id'] for b in page.evaluate("circuitLab.doc.breadboards")] == ['bb1'])
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
