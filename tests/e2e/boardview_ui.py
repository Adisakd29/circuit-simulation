"""E2E โมเดลบอร์ดจาก CAD + การต่อสายกับขาในโมเดล 3D + กล้อง (เดสก์ท็อป 1440×900, iPad 1024×1366 touch, มือถือ 390×844 touch)
- โมเดล UNO Q (GLB จากไฟล์ CAD ของผู้ผลิต) โหลดเสร็จ ไม่มีข้อผิดพลาด · หัวต่อในโมเดลสูงตรงกับจุดต่อสาย · จุดต่อสายทุกขาตรงกับวัตถุรับการแตะของขานั้น
- เปิดแม่แบบ → กล้องจัดให้เห็นทั้งวงจร (ไม่ถูกตัดขอบ) · โฟกัสอุปกรณ์ที่เลือก → เห็นทั้งบอร์ดเต็มจอ
- แตะ/ชี้ขา → ป้ายบอกชื่อขา พอร์ต และข้อจำกัด · ต่อสายด้วยการแตะขาในฉาก 3D จริง → สายเก็บชื่อขาถูก
- หมุน 90° และย้ายบอร์ด → สายยังอ้างขาเดิม ปลายสายตามตำแหน่งขาใหม่
- หน้าต่างตรวจดูรอบด้าน (มีมุมด้านล่าง) · สถานะการจำลอง 4 ด้าน · touch: ปัดเร็วบนบอร์ดที่เลือก = ไม่ย้าย · ไม่มี JavaScript error
ใช้: python3 tests/e2e/boardview_ui.py <out-dir> [url] [desktop,ipad,mobile]
"""
import os, sys, time, json
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,ipad,mobile').split(',')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

VP = {'desktop': (1440, 900, False), 'ipad': (1024, 1366, True), 'mobile': (390, 844, True)}

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.4)

def open_left(page):
    vis = page.evaluate("(() => { const r = document.getElementById('tab-lessons').getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth; })()")
    if not vis: page.click('#btn-left'); time.sleep(0.4)

def props(page, touch, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if not page.evaluate("(() => { const e = document.getElementById('f-label'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth; })()") and page.locator('#btn-right').is_visible():
        page.click('#btn-right'); time.sleep(0.5)

# จุดต่อสาย (terminalWorld) เทียบกับตำแหน่งวัตถุรับการแตะของขา และผิวบนของหัวต่อในโมเดล GLB
CONSIST = """(() => {
  const v = circuitLab.view, g = v.partObjs.get('UNOQ1'); g.updateMatrixWorld(true);
  const hits = {}; g.traverse((o) => { if (o.userData.isPin) { const p = o.getWorldPosition(o.position.clone()); hits[o.userData.pin] = p; } });
  let worst = 0, n = 0;
  for (const d of __cl.pinDefs(circuitLab.doc.parts.find(p => p.id === 'UNOQ1'))) {
    const t = v.terminalWorld({ kind: 'pin', partId: 'UNOQ1', pin: d.name }); const h = hits[d.name];
    if (!t || !h) return { err: 'missing ' + d.name };
    worst = Math.max(worst, Math.hypot(t.x - h.x, t.z - h.z)); n++;
  }
  let hdrTop = null; g.traverse((o) => { if (o.isMesh && o.name === 'hdr') { const b = new o.geometry.boundingBox.constructor().setFromObject(o); hdrTop = b.max.y; } });
  const t0 = v.terminalWorld({ kind: 'pin', partId: 'UNOQ1', pin: 'D2' });
  return { worst, n, hdrTop, tipY: t0.y };
})()"""
SCREEN = "(pin) => { const v = circuitLab.view; const w = v.terminalWorld({ kind: 'pin', partId: 'UNOQ1', pin }); return v.worldToScreen(w.x, w.y, w.z); }"
INVIEW = """(() => { const v = circuitLab.view; const b = v.partBounds('UNOQ1'); const c = v.renderer.domElement.getBoundingClientRect(); let ok = true, pts = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const s = v.worldToScreen(x, y, z); pts.push(s); if (!s || s.x < c.left || s.x > c.right || s.y < c.top || s.y > c.bottom) ok = false; }
  const xs = pts.filter(Boolean).map(p => p.x); return { ok, frac: (Math.max(...xs) - Math.min(...xs)) / c.width }; })()"""

def run(mode):
    w, hgt, touch = VP[mode]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': w, 'height': hgt}, has_touch=touch, is_mobile=mode == 'mobile', device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if touch else None
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        def tap(x, y):
            if cdp:
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]}); time.sleep(0.06)
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.35)
            else:
                page.mouse.move(x, y); page.mouse.down(); time.sleep(0.05); page.mouse.up(); time.sleep(0.3)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_function('window.circuitLab !== undefined', timeout=30000); time.sleep(0.8)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        open_left(page)
        page.click('#tab-lessons'); time.sleep(0.3); page.click('#proj-dispenser'); time.sleep(0.5); page.click('#proj-open'); time.sleep(1.2)
        try: page.wait_for_function('window.__glb && window.__glb.pending === 0', timeout=60000)
        except Exception: pass
        st = page.evaluate('window.__glb')
        has_glb = page.evaluate("(() => { let n = 0; circuitLab.view.partObjs.get('UNOQ1').traverse((o) => { if (o.userData.glbRoot) n++; }); return n; })()")
        check(f'{mode}: โมเดล UNO Q จากไฟล์ CAD (GLB) โหลดเสร็จและแสดงในฉาก', st['pending'] == 0 and not st['failed'] and has_glb == 1, json.dumps(st))
        close_drawers(page); time.sleep(0.6)
        iv = page.evaluate(INVIEW)
        check(f'{mode}: เปิดแม่แบบแล้วกล้องจัดให้เห็นบอร์ดทั้งแผ่น (ไม่ถูกตัดขอบ)', iv['ok'], json.dumps(iv))
        page.screenshot(path=f'{OUT}/{mode}-1-work.png')
        c = page.evaluate(CONSIST)
        check(f'{mode}: จุดต่อสาย 32 ขาตรงกับวัตถุรับการแตะของขา (≤ 0.01) และอยู่ระดับผิวบนหัวต่อในโมเดล GLB', c.get('n') == 32 and c['worst'] < 0.01 and abs(c['hdrTop'] - c['tipY']) < 0.12, json.dumps(c))
        # โฟกัส
        props(page, touch, 'UNOQ1'); close_drawers(page)
        page.click('#btn-focus'); time.sleep(1.0)
        iv = page.evaluate(INVIEW)
        check(f'{mode}: โฟกัสอุปกรณ์ที่เลือก → เห็นทั้งบอร์ด ไม่ถูกตัดขอบ และใหญ่ขึ้น (≥ 40% ของความกว้าง)', iv['ok'] and iv['frac'] > 0.4, json.dumps(iv))
        page.screenshot(path=f'{OUT}/{mode}-2-focus.png')
        # ป้ายชื่อขาเมื่อแตะ/ชี้
        s = page.evaluate(SCREEN, 'A0')
        if touch:
            tap(s['x'], s['y'] - 4)
            try: page.wait_for_function("(() => { const t = document.getElementById('pin-tip'); return t && !t.hidden && t.textContent.includes('A0'); })()", timeout=4000)
            except Exception: pass
        else:
            page.mouse.move(s['x'], s['y'] - 4); time.sleep(0.4)
        tip = page.evaluate("(() => { const t = document.getElementById('pin-tip'); return t && !t.hidden ? t.textContent : ''; })()")
        check(f'{mode}: แตะ/ชี้ขา A0 → ป้ายบอกชื่อขา พอร์ต และข้อจำกัดแรงดัน', 'A0' in tip and 'PA4' in tip and '3.6 V' in tip, tip)
        # ต่อสายด้วยการแตะขาในฉาก
        page.evaluate("circuitLab.select(null)")
        n0 = page.evaluate('circuitLab.doc.wires.length')
        page.evaluate("circuitLab.setTool({ t: 'wire' })"); time.sleep(0.2)
        s = page.evaluate(SCREEN, 'A0'); tap(s['x'], s['y'] - 3)
        hole = page.evaluate("(() => { const v = circuitLab.view; const b = circuitLab.doc.breadboards[0]; const w = v.terminalWorld({ kind: 'hole', boardId: b.id, hole: 'j28' }); return v.worldToScreen(w.x, w.y, w.z); })()")
        if not page.evaluate("(() => { const c = circuitLab.view.renderer.domElement.getBoundingClientRect(); return true; })()"): pass
        page.evaluate("() => { const v = circuitLab.view; v.resetView('work'); v.requestRender(); }"); time.sleep(0.5)
        hole = page.evaluate("(() => { const v = circuitLab.view; const b = circuitLab.doc.breadboards[0]; const w = v.terminalWorld({ kind: 'hole', boardId: b.id, hole: 'j28' }); return v.worldToScreen(w.x, w.y, w.z); })()")
        tap(hole['x'], hole['y']); time.sleep(0.4)
        nw = page.evaluate("circuitLab.doc.wires.at(-1)")
        ok_w = page.evaluate('circuitLab.doc.wires.length') == n0 + 1 and any(e.get('kind') == 'pin' and e.get('partId') == 'UNOQ1' and e.get('pin') == 'A0' for e in [nw['a'], nw['b']])
        check(f'{mode}: แตะขา A0 ในโมเดล 3D แล้วแตะรูเบรดบอร์ด → สายต่อกับขา A0 ของ UNO Q จริง', ok_w, json.dumps(nw))
        page.evaluate("circuitLab.setTool({ t: 'select' })")
        wid = nw['id']
        # หมุนและย้ายบอร์ด: สายยังอ้างขาเดิม ปลายสายตามตำแหน่งขาใหม่
        before = page.evaluate("(() => { const t = circuitLab.view.terminalWorld({ kind: 'pin', partId: 'UNOQ1', pin: 'A0' }); return [t.x, t.z]; })()")
        page.evaluate("circuitLab.select({t: 'part', id: 'UNOQ1'})"); time.sleep(0.2)
        page.click('#btn-rot90'); time.sleep(0.6)
        rot = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'UNOQ1').placement")
        if rot['rotation'] == 0:
            # หมุนไม่ได้เพราะชน: ย้ายไปที่ว่างก่อนแล้วหมุน
            page.evaluate("() => { const d = circuitLab.doc; const q = d.parts.find(p => p.id === 'UNOQ1'); const r = __cl.movePart(d, 'UNOQ1', { ...q.placement, x: -60, z: -75 }); if (r.ok) circuitLab.apply(r, 'move'); }"); time.sleep(0.4)
            page.click('#btn-rot90'); time.sleep(0.6)
            rot = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'UNOQ1').placement")
        page.evaluate("() => { const d = circuitLab.doc; const q = d.parts.find(p => p.id === 'UNOQ1'); const r = __cl.movePart(d, 'UNOQ1', { ...q.placement, x: q.placement.x - 4 }); if (r.ok) circuitLab.apply(r, 'move'); }"); time.sleep(0.6)
        after = page.evaluate("(() => { const t = circuitLab.view.terminalWorld({ kind: 'pin', partId: 'UNOQ1', pin: 'A0' }); return [t.x, t.z]; })()")
        ww = page.evaluate(f"circuitLab.doc.wires.find(w => w.id === '{wid}')")
        still = ww and any(e.get('partId') == 'UNOQ1' and e.get('pin') == 'A0' for e in [ww['a'], ww['b']])
        c2 = page.evaluate(CONSIST)
        moved = abs(after[0] - before[0]) + abs(after[1] - before[1]) > 1
        check(f'{mode}: หมุน 90° + ย้ายบอร์ด → สายยังต่อขา A0 · จุดต่อย้ายตามขา · ยังตรงกับวัตถุขา', rot['rotation'] != 0 and still and moved and c2['worst'] < 0.01, f"rot={rot['rotation']} {before}→{after} worst={c2['worst']:.4f}")
        # touch: ปัดเร็วบนบอร์ดที่เลือก ไม่ย้าย
        if cdp:
            page.evaluate("circuitLab.select({t: 'part', id: 'UNOQ1'})"); close_drawers(page); time.sleep(0.2)
            pos0 = page.evaluate("JSON.stringify(circuitLab.doc.parts.find(p => p.id === 'UNOQ1').placement)")
            cc = page.evaluate("(() => { const v = circuitLab.view, b = v.partBounds('UNOQ1'); const m = b.getCenter(b.min.clone()); return v.worldToScreen(m.x, b.max.y - 0.5, m.z); })()")
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cc['x'], 'y': cc['y'], 'id': 0}]})
            for k in range(1, 6): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cc['x'] + k * 14, 'y': cc['y'] + k * 6, 'id': 0}]}); time.sleep(0.01)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
            pos1 = page.evaluate("JSON.stringify(circuitLab.doc.parts.find(p => p.id === 'UNOQ1').placement)")
            check(f'{mode}: ปัดนิ้วเร็วบนบอร์ดที่เลือก (กันลากโดยไม่ตั้งใจ) → บอร์ดไม่ย้าย', pos0 == pos1, f'{pos0} → {pos1}')
        # หน้าต่างตรวจดูรอบด้าน: ด้านล่าง
        page.evaluate("circuitLab.select({t: 'part', id: 'UNOQ1'})"); close_drawers(page)
        page.click('#btn-inspect'); time.sleep(1.0)
        page.click('#insp-bottom'); time.sleep(1.0)
        ins = page.evaluate("(() => { const c = document.getElementById('insp-canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); let dark = 0, n = 0; const px = new Uint8Array(4); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { g.readPixels(Math.floor(c.width * (0.5 + i * 0.07)), Math.floor(c.height * (0.5 + j * 0.07)), 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); n++; if (px[0] + px[1] + px[2] < 300) dark++; } return { pressed: document.getElementById('insp-bottom').getAttribute('aria-pressed'), dark, n }; })()")
        page.screenshot(path=f'{OUT}/{mode}-3-inspect-bottom.png')
        check(f'{mode}: ตรวจดูรอบด้าน → มุมด้านล่างแสดงใต้บอร์ด (พื้นที่กลางภาพ ≥ 15 จาก 25 จุดเป็นแผ่น PCB สีเข้ม ไม่ใช่พื้นหลัง)', ins['pressed'] == 'true' and ins['dark'] >= 15, json.dumps(ins))
        page.click('#insp-close'); time.sleep(0.3)
        # สถานะ 4 ด้าน
        props(page, touch, 'UNOQ1')
        rows = page.evaluate("[...document.querySelectorAll('#f-status4 .s4-row')].map(r => r.dataset.s4 + ':' + (r.querySelector('.tag') || {}).textContent)")
        check(f'{mode}: แผงคุณสมบัติแสดงสถานะ 4 ด้าน (Firmware ของ UNO Q = บางส่วน ไม่ใช่ครบ)', len(rows) == 4 and 'firmware:บางส่วน' in rows and any(r.startswith('unsupported:') for r in rows), str(rows))
        page.screenshot(path=f'{OUT}/{mode}-4-status4.png')
        check(f'{mode}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES: run(m)
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
