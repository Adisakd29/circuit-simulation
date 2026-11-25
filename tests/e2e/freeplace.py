"""
ทดสอบ end-to-end: ลากวางจากคลัง / วางอิสระบนโต๊ะ / ย้ายเข้า-ออกบอร์ด / สายตามขา / Undo-Redo / Save-Load
และโหมดล้มเหลว (ไม่มี WebGL, สร้าง renderer ไม่ได้, context หาย, โหลดฟอนต์/สคริปต์ไม่ได้)

สภาพแวดล้อม: Chromium headless (Playwright) + WebGL ซอฟต์แวร์ (SwiftShader) — เป็นการ "จำลอง viewport"
และจำลอง touch ด้วย CDP Input.dispatchTouchEvent ไม่ใช่อุปกรณ์จริง และไม่ใช่ Safari/WebKit

การกระทำของผู้ใช้ใช้ pointer/touch event จริงทั้งหมด; อ่านค่าจากแอป (window.circuitLab) เพื่อหาพิกัดหน้าจอและตรวจผลเท่านั้น

วิธีรัน:  npm run build && npx vite preview --port 4173 &  แล้ว  python3 tests/e2e/freeplace.py [out_dir]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('CL3D_URL', 'http://localhost:4173/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-free-out'
ONLY = os.environ.get('ONLY', '')
os.makedirs(OUT, exist_ok=True)
results = []
GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

def check(name, cond, detail=''):
    results.append({'name': name, 'pass': bool(cond), 'detail': str(detail)[:400]})
    print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

PROJ = """([x, y, z]) => {
  const v = window.circuitLab.view;
  const p = v.camera.position.clone().set(x, y, z); p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}"""
TERM = """(ref) => {
  const v = window.circuitLab.view; const p = v.terminalWorld(ref); if (!p) return null;
  p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}"""
HOLEW = "(h) => { const v = window.circuitLab.view; const p = v.terminalWorld({kind:'hole', boardId:'bb1', hole:h}); return [p.x, p.z]; }"
PART = "(id) => circuitLab.doc.parts.find(p => p.id === id)"
LAST = "() => circuitLab.doc.parts[circuitLab.doc.parts.length - 1]"
HIST = "() => [circuitLab.history.canUndo, circuitLab.history.undoLabel]"
NET_SAME = "([a, b]) => { const c = circuitLab.conn(); const k = (t) => t.kind === 'hole' ? `${t.boardId}/${t.hole}` : `${t.partId}:${t.pin}`; const na = c.netOf.get(k(a)), nb = c.netOf.get(k(b)); return na !== undefined && na === nb; }"

def H(h): return {'kind': 'hole', 'boardId': 'bb1', 'hole': h}
def P(p, pin): return {'kind': 'pin', 'partId': p, 'pin': pin}


class Driver:
    """การกระทำแบบเมาส์หรือนิ้ว (CDP touch) — ตัดสินจากชนิดอุปกรณ์ของ viewport"""
    def __init__(self, page, touch):
        self.page, self.touch = page, touch
        self.cdp = page.context.new_cdp_session(page) if touch else None

    def _t(self, typ, pts):
        self.cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})

    def tap(self, x, y):
        if self.touch:
            self._t('touchStart', [(x, y)]); time.sleep(0.05); self._t('touchEnd', [])
        else:
            self.page.mouse.click(x, y)
        time.sleep(0.2)

    def drag(self, x0, y0, x1, y1, steps=14, long_press=False, release=True, hold_end=0.0):
        if self.touch:
            self._t('touchStart', [(x0, y0)])
            time.sleep(0.5 if long_press else 0.05)
            for i in range(1, steps + 1):
                k = i / steps
                self._t('touchMove', [(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)]); time.sleep(0.03)
            time.sleep(hold_end)
            if release: self._t('touchEnd', [])
        else:
            m = self.page.mouse
            m.move(x0, y0); m.down(); time.sleep(0.05)
            for i in range(1, steps + 1):
                k = i / steps
                m.move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); time.sleep(0.02)
            time.sleep(hold_end)
            if release: m.up()
        time.sleep(0.3)

    def release(self, x, y):
        if self.touch: self._t('touchEnd', [])
        else: self.page.mouse.up()
        time.sleep(0.3)


def boot(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()')
    page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.8)


def lib_item_center(page, name, touch):
    narrow = page.evaluate('innerWidth <= 1100')
    if narrow and not page.evaluate("document.getElementById('left').classList.contains('open')"):
        page.click('#btn-left'); time.sleep(0.4)
    el = page.locator(f'.lib-item:has-text("{name}")').first
    el.scroll_into_view_if_needed(); time.sleep(0.1)
    b = el.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def visible_point(page, cands, y=-2.4, extent=(0, 0)):
    """จุดบนโต๊ะจุดแรกในรายการที่มองเห็นบนหน้าจอจริง (ไม่ถูกแผง/แถบเครื่องมือบัง) ทั้งจุดกลางและมุมทั้งสี่ของอุปกรณ์"""
    ex, ez = extent
    for (x, z) in cands:
        ok = True
        for (dx, dz) in [(0, 0), (-ex, -ez), (ex, -ez), (-ex, ez), (ex, ez)]:
            s = page.evaluate(PROJ, [x + dx, y, z + dz])
            if not page.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS' }", [s['x'], s['y']]):
                ok = False; break
        if ok: return (x, z), page.evaluate(PROJ, [x, y, z])
    raise RuntimeError(f'ไม่มีจุดที่มองเห็นในรายการ {cands}')


def layout_checks(page, tag):
    r = page.evaluate("""() => {
      const q = (s) => document.querySelector(s); const rect = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const tb = q('.topbar');
      const visBtns = [...document.querySelectorAll('.topbar > .tb-group button, .topbar > button, .topbar .tb-more button')].filter(b => b.offsetParent !== null);
      const blank = visBtns.filter(b => !b.querySelector('svg') && !b.textContent.trim()).map(b => b.id);
      const unlabeled = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !(b.getAttribute('aria-label') || b.title || b.textContent.trim())).map(b => b.id || b.className);
      return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, tbOverflow: tb.scrollWidth > tb.clientWidth + 1,
               tools: rect('#tools'), viewctl: rect('#viewctl'), stage: rect('#stage'), blank, unlabeled,
               libCount: document.querySelectorAll('.lib-item').length, w: innerWidth, h: innerHeight };
    }""")
    check(f'{tag}: ไม่มี scroll แนวนอนทั้งหน้า', not r['overflowX'], r['w'])
    check(f'{tag}: แถบเครื่องมือด้านบนไม่ล้น', not r['tbOverflow'])
    check(f'{tag}: ปุ่มที่มองเห็นทุกปุ่มมีไอคอน/ข้อความ', not r['blank'], r['blank'])
    check(f'{tag}: ปุ่มที่มองเห็นทุกปุ่มมีชื่อสำหรับผู้ใช้ (aria-label/title/ข้อความ)', not r['unlabeled'], r['unlabeled'])
    check(f'{tag}: คลังอุปกรณ์มีรายการ', r['libCount'] >= 10, r['libCount'])
    t, v, s = r['tools'], r['viewctl'], r['stage']
    inside = t and v and s and t[0] >= s[0] - 1 and t[2] <= s[2] + 1 and v[2] <= s[2] + 1 and v[0] >= s[0] - 1
    no_overlap = t and v and (t[2] <= v[0] or v[3] <= t[1] or t[3] <= v[1])
    check(f'{tag}: แถบเครื่องมือในพื้นที่ทำงานอยู่ในกรอบและไม่ทับกัน', inside and no_overlap, json.dumps([t, v, s]))


def scenario(pw, tag, vw, vh, touch, video=False):
    browser = pw.chromium.launch(args=GL)
    ctx_args = dict(viewport={'width': vw, 'height': vh}, has_touch=touch, is_mobile=touch and vw < 900, device_scale_factor=1, accept_downloads=True)
    if video: ctx_args['record_video_dir'] = f'{OUT}/video'; ctx_args['record_video_size'] = {'width': vw, 'height': vh}
    ctx = browser.new_context(**ctx_args)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    boot(page)
    d = Driver(page, touch)
    layout_checks(page, tag)
    # แท็บแลปตอบสนอง
    if page.evaluate("getComputedStyle(document.getElementById('btn-left')).display !== 'none' && innerWidth <= 1100"):
        page.click('#btn-left'); time.sleep(0.35)
    page.click('#tab-lessons'); time.sleep(0.3)
    check(f'{tag}: แท็บแลปแสดงรายการ', page.evaluate("document.getElementById('lessons-body').hidden === false && document.getElementById('lessons-body').textContent.length > 50"))
    page.click('#tab-lib'); time.sleep(0.2)
    if vw <= 1100 and page.evaluate("document.getElementById('left').classList.contains('open')"): page.click('#left .drawer-close')
    time.sleep(0.3)

    # ---------- 0) เลื่อนรายการคลังด้วยนิ้วต้องไม่เพิ่มอุปกรณ์ ----------
    if touch:
        lx, ly = lib_item_center(page, 'ตัวเก็บประจุ', touch)
        sc0 = page.evaluate("document.getElementById('lib-body').scrollTop")
        d._t('touchStart', [(lx, ly)]); time.sleep(0.04)
        for i in range(1, 9): d._t('touchMove', [(lx, ly - i * 30)]); time.sleep(0.016)
        d._t('touchEnd', []); time.sleep(0.6)
        sc1 = page.evaluate("document.getElementById('lib-body').scrollTop")
        check(f'{tag}: ปัดเลื่อนรายการคลังด้วยนิ้ว → รายการเลื่อน ไม่มีอุปกรณ์ถูกเพิ่ม/เริ่มลาก',
              page.evaluate('circuitLab.doc.parts.length') == 0 and not page.evaluate('!!circuitLab.drag') and page.evaluate('circuitLab.tool.t') == 'select',
              f"scrollTop {sc0}→{sc1} parts={page.evaluate('circuitLab.doc.parts.length')} tool={page.evaluate('circuitLab.tool.t')} status={page.inner_text('#status-msg')}")
        page.evaluate("document.getElementById('lib-body').scrollTop = 0")
        if vw <= 1100 and page.evaluate("document.getElementById('left').classList.contains('open')"): page.click('#left .drawer-close'); time.sleep(0.4)

    # ---------- 1) ลากตัวต้านทานจากคลังไปวางบนโต๊ะนอกบอร์ด ----------
    (tx, tz), target = visible_point(page, [(-4, 13), (-4, 12), (6, 12.5), (-4, -13), (6, -13), (0, 11.5), (0, -12)])
    lx, ly = lib_item_center(page, 'ตัวต้านทาน', touch)
    n0 = page.evaluate('circuitLab.doc.parts.length')
    if video: time.sleep(0.6)
    d.drag(lx, ly, target['x'], target['y'], steps=24, long_press=touch, release=False, hold_end=0.4)
    tip = page.evaluate("(() => { const e = document.getElementById('drag-tip'); return e && !e.hidden ? e.textContent : '' })()")
    page.screenshot(path=f'{OUT}/{tag}-1-drag-table.png')
    d.release(target['x'], target['y'])
    r1 = page.evaluate(LAST)
    ok1 = page.evaluate('circuitLab.doc.parts.length') == n0 + 1 and r1['kind'] == 'resistor' and r1['placement']['kind'] == 'table'
    check(f'{tag}: ลากตัวต้านทานจากคลังไปวางบนโต๊ะนอกบอร์ด', ok1, json.dumps(r1['placement']) + ' tip=' + tip)
    check(f'{tag}: ระหว่างลากมีป้ายบอกว่า "วางบนโต๊ะ"', 'โต๊ะ' in tip, tip)
    if ok1:
        pl = r1['placement']
        check(f'{tag}: ตำแหน่งที่ปล่อย = ตำแหน่งที่วาง (กึ่งกลางอุปกรณ์ห่างจุดปล่อย ≤ 1 ช่อง)', abs(pl['x'] + 2 - tx) <= 1.01 and abs(pl['z'] - tz) <= 1.01, json.dumps(pl) + f' drop=({tx},{tz})')
    check(f'{tag}: การลากหนึ่งครั้ง = Undo หนึ่งรายการ', page.evaluate(HIST)[1].startswith('วาง'), page.evaluate(HIST))
    rid = r1['id']

    # ---------- 2) แหล่งจ่ายบนโต๊ะ + ต่อสายเข้าขาตัวต้านทานบนโต๊ะ ----------
    _, target = visible_point(page, [(-26, -2), (-25, 3), (-24, -6), (24, -16), (-6, -17), (8, -17), (-6, 18)])
    lx, ly = lib_item_center(page, 'แหล่งจ่ายไฟ DC', touch)
    d.drag(lx, ly, target['x'], target['y'], steps=20, long_press=touch)
    ps = page.evaluate(LAST)
    check(f'{tag}: ลากแหล่งจ่ายมาวางบนโต๊ะ', ps['kind'] == 'dcsupply', json.dumps(ps['placement']))
    psid = ps['id']
    page.click('.tool[aria-label="ต่อสาย (W)"]'); time.sleep(0.2)
    a = page.evaluate(TERM, P(psid, 'pos')); d.tap(a['x'], a['y'] - 4)
    b = page.evaluate(TERM, P(rid, '1')); d.tap(b['x'], b['y'])
    a = page.evaluate(TERM, P(rid, '2')); d.tap(a['x'], a['y'])
    b = page.evaluate(TERM, H('j20')); d.tap(b['x'], b['y'])
    wires = page.evaluate('circuitLab.doc.wires')
    check(f'{tag}: ต่อสายจากขั้วแหล่งจ่ายเข้าขาตัวต้านทานบนโต๊ะ', any(w['a'] == P(psid, 'pos') and w['b'] == P(rid, '1') for w in wires), json.dumps(wires)[:300])
    check(f'{tag}: ต่อสายจากขาตัวต้านทานบนโต๊ะเข้ารูบนบอร์ด', any(w['a'] == P(rid, '2') and w['b'] == H('j20') for w in wires), page.inner_text('#status-msg'))
    check(f'{tag}: เน็ต: ขา R ขา 2 = รู f20 (สายเชื่อมจริง)', page.evaluate(NET_SAME, [P(rid, '2'), H('f20')]))
    page.click('.tool[aria-label="เลือก / ย้าย (V)"]'); time.sleep(0.2)

    # ---------- 3) ย้ายตัวต้านทาน (มีสาย) บนโต๊ะ → ปลายสายตามขา ----------
    if touch:
        c = page.evaluate(PROJ, [r1['placement']['x'] + 2, -2.4 + 0.9, r1['placement']['z']])
        d.tap(c['x'], c['y'])
        check(f'{tag}: แตะเลือกอุปกรณ์ก่อนลาก (touch)', page.evaluate('circuitLab.selection && circuitLab.selection.id') == rid, page.evaluate('JSON.stringify(circuitLab.selection)'))
    p0 = page.evaluate(PART, rid)['placement']
    c = page.evaluate(PROJ, [p0['x'] + 2, -2.4 + 0.9, p0['z']])
    t = page.evaluate(PROJ, [p0['x'] + 2 + 6, -2.4 + 0.9, p0['z']])
    d.drag(c['x'], c['y'], t['x'], t['y'])
    p1 = page.evaluate(PART, rid)['placement']
    moved = p1['kind'] == 'table' and (p1['x'] != p0['x'] or p1['z'] != p0['z'])
    check(f'{tag}: ลากตัวต้านทานที่มีสายไปที่ใหม่บนโต๊ะ', moved, f'{p0} → {p1}')
    wend = page.evaluate("(id) => { const v = circuitLab.view; const w = circuitLab.doc.wires.find(w => w.b.kind === 'pin' && w.b.partId === id); return w ? JSON.stringify(w.b) : null }", rid)
    check(f'{tag}: สายยังอ้างขาเดิม (pin id ไม่เปลี่ยน) หลังย้าย', wend == json.dumps(P(rid, '1')).replace(' ', ''), wend)
    gap = page.evaluate("""(id) => { const v = circuitLab.view; const pin = v.terminalWorld({kind:'pin', partId:id, pin:'1'});
       const p = circuitLab.doc.parts.find(p => p.id === id).placement; return Math.hypot(pin.x - p.x, pin.z - p.z); }""", rid)
    check(f'{tag}: ปลายสายวาดที่ตำแหน่งขาใหม่', gap is not None and gap < 0.01, gap)
    check(f'{tag}: เน็ตหลังย้ายยังถูกต้อง (+ ↔ ขา 1)', page.evaluate(NET_SAME, [P(psid, 'pos'), P(rid, '1')]))

    # ---------- 4) โต๊ะ → บอร์ด (เสียบรู) ----------
    hx, hz = page.evaluate(HOLEW, 'a8')
    p0 = page.evaluate(PART, rid)['placement']
    c = page.evaluate(PROJ, [p0['x'] + 2, -2.4 + 0.9, p0['z']])
    t = page.evaluate(PROJ, [hx + 2, 0, hz])  # ตัวชี้ที่กึ่งกลาง → ขา 1 ลง a8
    if touch: d.tap(c['x'], c['y'])
    d.drag(c['x'], c['y'], t['x'], t['y'], steps=20, release=False, hold_end=0.3)
    tip = page.evaluate("(() => { const e = document.getElementById('drag-tip'); return e && !e.hidden ? e.textContent : '' })()")
    page.screenshot(path=f'{OUT}/{tag}-4-drag-board.png')
    d.release(t['x'], t['y'])
    p1 = page.evaluate(PART, rid)['placement']
    check(f'{tag}: ลากจากโต๊ะไปเสียบบอร์ด (ขาลงรู)', p1['kind'] == 'board', json.dumps(p1) + ' tip=' + tip)
    check(f'{tag}: ระหว่างลากเหนือรูมีป้าย "เสียบลงบอร์ด"', 'เสียบ' in tip, tip)
    anchor = p1.get('anchor')
    if p1['kind'] == 'board':
        check(f'{tag}: สายที่ต่อขาไว้ยังต่อขาเดิมหลังเสียบบอร์ด + เน็ตรวมกลุ่มรู', page.evaluate(NET_SAME, [P(psid, 'pos'), H('e' + anchor[1:])]), anchor)
        page.evaluate("1"); page.screenshot(path=f'{OUT}/{tag}-4b-on-board.png')

    # ---------- 5) Undo / Redo ----------
    if touch: page.click('#btn-undo')
    else: page.keyboard.press('Control+z')
    time.sleep(0.3)
    check(f'{tag}: Undo การย้ายลงบอร์ด → กลับมาอยู่บนโต๊ะ', page.evaluate(PART, rid)['placement']['kind'] == 'table')
    page.click('#btn-redo'); time.sleep(0.3)
    check(f'{tag}: Redo → กลับไปอยู่บนบอร์ด', page.evaluate(PART, rid)['placement']['kind'] == 'board')

    # ---------- 6) บอร์ด → โต๊ะ: สายในรูไม่ตาม ----------
    # ต่อสายเพิ่มที่รูข้างขา 2 (คอลัมน์เดียวกัน)
    page.click('.tool[aria-label="ต่อสาย (W)"]'); time.sleep(0.2)
    col2 = int(anchor[1:]) + 4 if anchor else 12
    a = page.evaluate(TERM, H(f'c{col2}')); d.tap(a['x'], a['y'])
    b = page.evaluate(TERM, P(psid, 'neg')); d.tap(b['x'], b['y'] - 4)
    page.click('.tool[aria-label="เลือก / ย้าย (V)"]'); time.sleep(0.2)
    holewire = any(w['a'] == H(f'c{col2}') for w in page.evaluate('circuitLab.doc.wires'))
    check(f'{tag}: ต่อสายจากรูข้างขา 2 → ขั้วลบ', holewire, page.inner_text('#status-msg'))
    hx, hz = page.evaluate(HOLEW, anchor or 'a8')
    c = page.evaluate(PROJ, [hx + 2, 0.7, hz])
    _, t = visible_point(page, [(hx + 2, 13), (hx + 2, 12), (hx + 2, 14.5), (hx + 2, -13.5), (hx - 6, -14)])
    if touch:
        d.tap(c['x'], c['y'])
        if (page.evaluate('circuitLab.selection') or {}).get('id') != rid: time.sleep(0.3); d.tap(c['x'], c['y'])  # แตะซ้ำ = เลือกสิ่งที่อยู่ข้างใต้สาย
    sel6 = page.evaluate('JSON.stringify(circuitLab.selection)')
    d.drag(c['x'], c['y'], t['x'], t['y'], steps=20)
    p2 = page.evaluate(PART, rid)['placement']
    if p2['kind'] != 'table': page.screenshot(path=f'{OUT}/{tag}-6-fail.png'); print('selection before lift', sel6, page.inner_text('#status-msg'))
    check(f'{tag}: ยกจากบอร์ดออกมาวางบนโต๊ะ', p2['kind'] == 'table', json.dumps(p2))
    still = any(w['a'] == H(f'c{col2}') for w in page.evaluate('circuitLab.doc.wires'))
    check(f'{tag}: สายที่เสียบรูยังอยู่ในรูเดิม', still)
    check(f'{tag}: ขา 2 ไม่เชื่อมกับขั้วลบแล้ว (ยกออกแล้วตัดจริง)', not page.evaluate(NET_SAME, [P(rid, '2'), P(psid, 'neg')]))

    # ---------- 7) ยกเลิกการลาก (Esc / ปล่อยนอกพื้นที่) ----------
    h0 = page.evaluate(HIST)
    p_before = page.evaluate(PART, rid)['placement']
    c = page.evaluate(PROJ, [p_before['x'] + 2, -2.4 + 0.9, p_before['z']])
    t = page.evaluate(PROJ, [p_before['x'] + 8, -2.4, p_before['z'] + 4])
    if touch: d.tap(c['x'], c['y'])
    d.drag(c['x'], c['y'], t['x'], t['y'], release=False)
    if touch:
        # นิ้วที่สองแตะ = ยกเลิกการย้าย (เปลี่ยนเป็นซูม/เลื่อนกล้อง)
        d._t('touchStart', [(t['x'], t['y']), (t['x'] + 80, t['y'] + 40)]); time.sleep(0.1)
        d._t('touchMove', [(t['x'] - 10, t['y']), (t['x'] + 100, t['y'] + 50)]); time.sleep(0.2); d._t('touchEnd', []); time.sleep(0.3)
    else:
        page.keyboard.press('Escape'); time.sleep(0.2); page.mouse.up(); time.sleep(0.2)
    check(f'{tag}: ยกเลิกระหว่างลาก ({"นิ้วที่สอง" if touch else "Esc"}) → ตำแหน่งเดิม ไม่เพิ่ม Undo', page.evaluate(PART, rid)['placement'] == p_before and page.evaluate(HIST) == h0)
    # ลากจากคลังแล้วปล่อยบนแผงคลัง (นอกพื้นที่ทำงาน) = ยกเลิก — เฉพาะจอที่แผงคลังอยู่ข้างพื้นที่ทำงาน
    if vw > 1100:
        n0 = page.evaluate('circuitLab.doc.parts.length')
        lx, ly = lib_item_center(page, 'LED', touch)
        d.drag(lx, ly, lx + 30, ly + 120)
        check(f'{tag}: ลากจากคลังแล้วปล่อยนอกพื้นที่ทำงาน = ยกเลิก', page.evaluate('circuitLab.doc.parts.length') == n0, page.inner_text('#status-msg'))

    # ---------- 8) Pico วางข้างบอร์ด + ต่อ GP15 เข้ารู ----------
    page.click('#btn-fit'); time.sleep(0.5)  # ปุ่ม "พอดีจอ" จัดกล้องใหม่ (มุมกล้องอาจถูกหมุนจากขั้นก่อน)
    _, target = visible_point(page, [(-30, 14), (0, 23), (0, -25), (0, 21), (0, -21), (-26, 13.5), (20, 15.5), (24, -15.5), (-20, -15.5)], extent=(10.5, 4.5))
    lx, ly = lib_item_center(page, 'Raspberry Pi Pico', touch)
    d.drag(lx, ly, target['x'], target['y'], steps=24, long_press=touch)
    pico = page.evaluate(LAST)
    okp = pico['kind'] == 'pico' and pico['placement']['kind'] == 'table'
    check(f'{tag}: วาง Raspberry Pi Pico บนโต๊ะข้างบอร์ด', okp, json.dumps(pico['placement']) + ' ' + page.inner_text('#status-msg'))
    if okp:
        page.click('.tool[aria-label="ต่อสาย (W)"]'); time.sleep(0.2)
        a = page.evaluate(TERM, P(pico['id'], 'GP15')); d.tap(a['x'], a['y'])
        h1 = page.inner_text('#hint')
        b = page.evaluate(TERM, H('j26')); d.tap(b['x'], b['y'])
        if not page.evaluate(NET_SAME, [P(pico['id'], 'GP15'), H('f26')]):
            print('PICO WIRE DEBUG', a, b, h1, '|', page.inner_text('#hint'), '|', page.inner_text('#status-msg'), page.evaluate("([x,y]) => document.elementFromPoint(x,y).className", [b['x'], b['y']]))
            page.screenshot(path=f'{OUT}/{tag}-8-fail.png')
        page.click('.tool[aria-label="เลือก / ย้าย (V)"]'); time.sleep(0.2)
        check(f'{tag}: ต่อสาย Pico GP15 → รู j26 (เน็ตเดียวกับ f26)', page.evaluate(NET_SAME, [P(pico['id'], 'GP15'), H('f26')]), page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-8-pico-table.png')

    # ---------- 9) ย้ายเบรดบอร์ดทั้งแผ่น ----------
    bb0 = page.evaluate('circuitLab.doc.breadboards[0]')
    edge = page.evaluate(PROJ, [bb0['x'] + 0, 0, bb0['z'] - 9.6])  # ขอบบนของบอร์ด (ไม่มีรู)
    d.tap(edge['x'], edge['y'])
    selb = page.evaluate('circuitLab.selection')
    if not selb or selb.get('t') != 'board':
        # สำรอง: เลือกจากรู แล้วกดปุ่ม "เลือกเบรดบอร์ดทั้งแผ่น"
        hh = page.evaluate(TERM, H('c3')); d.tap(hh['x'], hh['y'])
        if vw <= 1100: page.click('#btn-right'); time.sleep(0.35)
        page.click('button:has-text("เลือกเบรดบอร์ดทั้งแผ่น")'); time.sleep(0.2)
        if vw <= 1100: page.click('#right .drawer-close'); time.sleep(0.4)
    check(f'{tag}: เลือกเบรดบอร์ดได้', (page.evaluate('circuitLab.selection') or {}).get('t') == 'board', json.dumps(selb))
    print('board sel', page.evaluate('JSON.stringify(circuitLab.selection)'))
    hw = page.evaluate(TERM, H('c4'))
    hw2 = page.evaluate(PROJ, [page.evaluate(HOLEW, 'c4')[0] + 3, 0, page.evaluate(HOLEW, 'c4')[1] - 1])
    d.drag(hw['x'], hw['y'], hw2['x'], hw2['y'])
    bb1 = page.evaluate('circuitLab.doc.breadboards[0]')
    if bb1 == bb0: page.screenshot(path=f'{OUT}/{tag}-9-fail.png'); print('board drag', hw, hw2)
    check(f'{tag}: ลากย้ายเบรดบอร์ดทั้งแผ่น', bb1['x'] != bb0['x'] or bb1['z'] != bb0['z'], f'{bb0} → {bb1} {page.inner_text("#status-msg")}')
    check(f'{tag}: หลังย้ายบอร์ด สาย Pico GP15 ยังเชื่อม f26', (not okp) or page.evaluate(NET_SAME, [P(pico['id'], 'GP15'), H('f26')]))

    # ---------- 10) Save → New → Open ----------
    before = page.evaluate('circuitLab.doc')
    if vw <= 1100: page.click('#btn-more'); time.sleep(0.2)
    page.click('#btn-save'); time.sleep(0.2)
    text = page.input_value('#save-json')
    page.click('dialog .btn:has-text("ปิด")')
    path = f'{OUT}/{tag}-saved.json'
    open(path, 'w').write(text)
    if vw <= 1100: page.click('#btn-more'); time.sleep(0.2)
    page.click('#btn-new'); time.sleep(0.2)
    page.click('dialog .btn.primary'); time.sleep(0.3)
    page.set_input_files('#file-input', path); time.sleep(0.8)
    after = page.evaluate('circuitLab.doc')
    check(f'{tag}: Save/Load: อุปกรณ์บนโต๊ะ บนบอร์ด สายทุกเส้น และตำแหน่งบอร์ดครบ', after == before,
          f"parts {len(before['parts'])}/{len(after['parts'])} wires {len(before['wires'])}/{len(after['wires'])}")

    # ---------- 11) แก้ค่าในแผงคุณสมบัติ (สัมผัส) ----------
    page.click('.tool[aria-label="เลือก / ย้าย (V)"]'); time.sleep(0.2)
    pr = page.evaluate(PART, rid)['placement']
    c = page.evaluate(PROJ, [pr['x'] + 2, -2.4 + 0.9, pr['z']])
    d.tap(c['x'], c['y']); time.sleep(0.3)
    if (page.evaluate('circuitLab.selection') or {}).get('id') != rid: time.sleep(0.5); d.tap(c['x'], c['y']); time.sleep(0.3)  # เครื่องช้า: แตะครั้งแรกอาจตกระหว่างกล้องยังขยับ
    if vw <= 1100: page.click('#btn-right'); time.sleep(0.4)
    fld = page.locator('#f-resistance')
    if not fld.count(): page.screenshot(path=f'{OUT}/{tag}-11-fail.png'); print('props fail', c, page.evaluate('JSON.stringify(circuitLab.selection)'), pr)
    if fld.count():
        fld.click(); fld.fill('2.2k'); fld.press('Enter'); time.sleep(0.4)
        vis = page.evaluate("(() => { const a = document.activeElement; const r = (a && a.getBoundingClientRect()); const vv = window.visualViewport; return r ? [r.top >= 0, r.bottom <= (vv ? vv.height : innerHeight)] : null })()")
        res = page.evaluate(PART, rid)['params']['resistance']
        check(f'{tag}: แก้ค่าความต้านทานในแผงคุณสมบัติ', abs(res - 2200) < 1e-6, res)
        check(f'{tag}: ช่องที่กำลังแก้อยู่ในส่วนที่มองเห็น', vis is None or all(vis), vis)
    else:
        check(f'{tag}: แก้ค่าความต้านทานในแผงคุณสมบัติ', False, 'ไม่พบช่องค่า')
    page.screenshot(path=f'{OUT}/{tag}-11-props.png')
    if vw <= 1100 and page.evaluate("document.getElementById('right').classList.contains('open')"): page.click('#right .drawer-close'); time.sleep(0.4)

    # ---------- 12) หมุนจอ (สลับกว้าง/สูง) งานไม่เปลี่ยน ----------
    doc_before = page.evaluate('circuitLab.doc')
    page.set_viewport_size({'width': vh, 'height': vw}); time.sleep(0.8)
    layout_checks(page, f'{tag}→หมุนจอ {vh}×{vw}')
    check(f'{tag}: หมุนจอแล้ววงจร/ตำแหน่ง/สายเหมือนเดิม', page.evaluate('circuitLab.doc') == doc_before)
    page.screenshot(path=f'{OUT}/{tag}-12-rotated.png')
    page.set_viewport_size({'width': vw, 'height': vh}); time.sleep(0.5)

    # ---------- 13) Run ทำงาน ----------
    st = page.evaluate("[circuitLab.running, document.getElementById('btn-run').disabled, document.querySelector('dialog').open, JSON.stringify(document.getElementById('btn-run').getBoundingClientRect())]")
    if st[0] or st[1] or st[2]: print('ก่อน Run:', st)
    try: page.click('#btn-run', timeout=8000)
    except Exception as e: print('RUN CLICK', str(e)[-900:]); raise
    try:
        page.wait_for_function('window.circuitLab.freshSim !== null', timeout=15000); okrun = True
    except Exception: okrun = False
    check(f'{tag}: Run จำลองได้', okrun, page.inner_text('#sim-status'))
    page.click('#btn-stop'); time.sleep(0.2)

    check(f'{tag}: ไม่มี JavaScript error', not errors, errors[:3])
    ctx.close()
    browser.close()


def failure_modes(pw):
    # ---- A) ไม่มี WebGL เลย ----
    for label, args in [('ไม่มี WebGL (--disable-webgl)', ['--disable-webgl', '--disable-webgl2']), ('ปิด 3D API (--disable-3d-apis)', ['--disable-3d-apis'])]:
        browser = pw.chromium.launch(args=args)
        page = browser.new_page(viewport={'width': 1366, 'height': 768})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.5)
        st = page.evaluate("""() => ({ v: document.documentElement.dataset.view3d, notice: !!document.getElementById('stage-notice'),
          title: document.querySelector('#stage-notice h2')?.textContent, lib: document.querySelectorAll('.lib-item').length,
          blank: [...document.querySelectorAll('.topbar button')].filter(b => b.offsetParent && !b.querySelector('svg') && !b.textContent.trim()).map(b => b.id),
          toolsDisabled: [...document.querySelectorAll('#tools button')].every(b => b.disabled), diag: document.querySelector('.diag')?.textContent })""")
        check(f'no-webgl [{label}]: แอปเริ่มได้ แสดงสาเหตุ "ไม่รองรับ WebGL"', st['v'] == 'webgl-unsupported' and st['notice'] and 'WebGL' in (st['title'] or ''), st['title'])
        check(f'no-webgl [{label}]: คลังอุปกรณ์ยังแสดงรายการ', st['lib'] >= 10, st['lib'])
        check(f'no-webgl [{label}]: ปุ่มแถบเครื่องมือมีไอคอน/ข้อความครบ', not st['blank'], st['blank'])
        check(f'no-webgl [{label}]: เครื่องมือ 3 มิติถูกปิดพร้อมเหตุผล', st['toolsDisabled'])
        check(f'no-webgl [{label}]: มีรายละเอียดวินิจฉัย', 'WebGL2: ไม่มี' in (st['diag'] or ''), (st['diag'] or '')[:120])
        page.click('#tab-lessons'); time.sleep(0.3)
        check(f'no-webgl [{label}]: แท็บแลปทำงาน', page.evaluate("document.getElementById('lessons-body').textContent.length > 50"))
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ตัวต้านทาน")'); time.sleep(0.2)
        check(f'no-webgl [{label}]: แตะอุปกรณ์ → บอกเหตุผลที่วางไม่ได้', 'ไม่ได้' in page.inner_text('#status-msg'), page.inner_text('#status-msg'))
        page.click('#btn-quality', force=True); time.sleep(0.2)  # aria-disabled: ยังกดได้และบอกเหตุผล
        check(f'no-webgl [{label}]: ปุ่มคุณภาพภาพตอบสนองพร้อมเหตุผล', '3 มิติ' in page.inner_text('#status-msg'), page.inner_text('#status-msg'))
        # เปิดไฟล์แล้ว Run ได้ (การจำลองไม่ขึ้นกับ 3 มิติ)
        page.set_input_files('#file-input', f'{OUT}/desktop-1366-saved.json') if os.path.exists(f'{OUT}/desktop-1366-saved.json') else None
        time.sleep(0.5)
        page.click('#btn-run')
        try:
            page.wait_for_function('window.circuitLab.freshSim !== null', timeout=15000); okrun = True
        except Exception: okrun = False
        check(f'no-webgl [{label}]: Run ทำงาน (จำลองวงจรได้โดยไม่มี 3 มิติ)', okrun, page.inner_text('#sim-status'))
        page.click('#btn-retry-3d'); time.sleep(0.4)
        check(f'no-webgl [{label}]: ปุ่ม "ลองอีกครั้ง" ทำงานและยังบอกสาเหตุ', page.evaluate("!!document.getElementById('stage-notice')") and 'ยังเปิด' in page.inner_text('#status-msg'), page.inner_text('#status-msg'))
        check(f'no-webgl [{label}]: ไม่มี JavaScript error', not errors, errors[:3])
        page.screenshot(path=f'{OUT}/fail-no-webgl-{"a" if "webgl)" in label else "b"}.png')
        browser.close()

    # ---- B) มี WebGL แต่สร้าง renderer ไม่สำเร็จ ----
    browser = pw.chromium.launch(args=GL)
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    page.add_init_script("""(() => { const orig = HTMLCanvasElement.prototype.getContext;
      window.__failRenderer = true;
      HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        if (window.__failRenderer && attrs && attrs.powerPreference) return null; // เฉพาะ three.js (probe ไม่ส่ง powerPreference)
        return orig.call(this, type, attrs); }; })()""")
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000); time.sleep(0.5)
    st = page.evaluate("[document.documentElement.dataset.view3d, document.querySelector('#stage-notice h2')?.textContent, document.querySelector('.diag')?.textContent]")
    check('renderer-failed: แยกสาเหตุ "สร้างพื้นที่ 3 มิติไม่สำเร็จ" ออกจาก "ไม่รองรับ WebGL"', st[0] == 'renderer-failed' and 'ไม่สำเร็จ' in (st[1] or ''), st[:2])
    check('renderer-failed: รายละเอียดมีข้อความ error จริง', 'ข้อผิดพลาด:' in (st[2] or ''), (st[2] or '')[:160])
    page.evaluate('window.__failRenderer = false')
    page.click('#btn-retry-3d'); time.sleep(1.0)
    check('renderer-failed: กด "ลองอีกครั้ง" หลังสาเหตุหายไป → เปิด 3 มิติได้โดยไม่ต้องโหลดหน้าใหม่', page.evaluate("document.documentElement.dataset.view3d === 'ok' && !document.getElementById('stage-notice') && circuitLab.has3d"))
    page.screenshot(path=f'{OUT}/fail-renderer-recovered.png')
    check('renderer-failed: ไม่มี JavaScript error ที่ไม่ได้จัดการ', not errors, errors[:3])
    browser.close()

    # ---- C) WebGL context หายระหว่างใช้งาน แล้วกลับมา ----
    browser = pw.chromium.launch(args=GL)
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    path = f'{OUT}/desktop-1366-saved.json'
    if os.path.exists(path): page.set_input_files('#file-input', path); time.sleep(0.6)
    doc0 = page.evaluate('circuitLab.doc')
    page.evaluate("window.__lc = circuitLab.view.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lc.loseContext()")
    time.sleep(0.5)
    st = page.evaluate("[document.documentElement.dataset.view3d, document.querySelector('#stage-notice h2')?.textContent]")
    check('context-lost: แจ้ง "การแสดงผล 3 มิติหยุดชั่วคราว"', st[0] == 'context-lost', st)
    page.screenshot(path=f'{OUT}/fail-context-lost.png')
    page.evaluate("window.__lc.restoreContext()")
    time.sleep(1.2)
    st2 = page.evaluate("[document.documentElement.dataset.view3d, !!document.getElementById('stage-notice'), circuitLab.doc.parts.length]")
    check('context-lost → restored: กลับมาแสดง 3 มิติเอง งานยังอยู่ครบ', st2[0] == 'ok' and not st2[1] and page.evaluate('circuitLab.doc') == doc0, st2)
    # ใช้งานต่อได้: ยังเลือก/วางได้
    page.click('.lib-item:has-text("ตัวต้านทาน")'); time.sleep(0.2)
    _, s = visible_point(page, [(10, 16), (4, 13), (-4, 13), (8, -14), (-6, -14)], extent=(2.5, 1))
    page.mouse.click(s['x'], s['y']); time.sleep(0.3)
    check('context-lost → restored: วางอุปกรณ์ต่อได้', page.evaluate('circuitLab.doc.parts.length') == len(doc0['parts']) + 1, page.inner_text('#status-msg'))
    check('context-lost: ไม่มี JavaScript error', not errors, errors[:3])
    browser.close()

    # ---- D) โหลดฟอนต์จาก Google Fonts ไม่ได้ ----
    browser = pw.chromium.launch(args=GL)
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    page.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    t0 = time.time()
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    check('ฟอนต์โหลดไม่ได้: แอปเริ่มได้ด้วยฟอนต์สำรอง', page.evaluate("document.querySelectorAll('.lib-item').length >= 10 && !!document.querySelector('#btn-run svg')"), f'{time.time() - t0:.1f}s')
    browser.close()

    # ---- E) โหลดสคริปต์หลักไม่ได้ ----
    browser = pw.chromium.launch(args=GL)
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    page.route('**/assets/*.js', lambda r: r.abort())
    page.goto(URL)
    st0 = page.evaluate("[document.getElementById('btn-run').textContent.trim(), document.getElementById('boot-status').textContent]")
    check('สคริปต์โหลดไม่ได้: ปุ่มมีข้อความสำรอง และมีข้อความ "กำลังโหลด"', st0[0] == 'Run' and 'กำลังโหลด' in st0[1], st0)
    time.sleep(16)
    msg = page.inner_text('#boot-status')
    check('สคริปต์โหลดไม่ได้: หลัง 15 วินาทีบอกว่าโหลดไม่สำเร็จ + ปุ่มโหลดใหม่', 'ไม่สำเร็จ' in msg and page.is_visible('#boot-status button'), msg[:80])
    page.screenshot(path=f'{OUT}/fail-script.png')
    browser.close()


VIEWPORTS = [
    ('desktop-1366', 1366, 768, False, True),
    ('desktop-1920', 1920, 1080, False, False),
    ('phone-390x844', 390, 844, True, False),
    ('phone-844x390', 844, 390, True, False),
    ('tablet-768x1024', 768, 1024, True, False),
    ('tablet-1024x768', 1024, 768, True, False),
    ('tablet-1024x768-mouse', 1024, 768, False, False),
]

with sync_playwright() as pw:
    for tag, w, h, touch, video in VIEWPORTS:
        if ONLY and ONLY not in tag: continue
        try:
            scenario(pw, tag, w, h, touch, video)
        except Exception as e:  # บันทึกเป็นความล้มเหลว แล้วทำ viewport ถัดไป
            import traceback; traceback.print_exc()
            check(f'{tag}: สถานการณ์ทำงานจนจบ', False, repr(e)[:300])
    if not ONLY or ONLY == 'fail':
        failure_modes(pw)

json.dump(results, open(f'{OUT}/results.json', 'w'), ensure_ascii=False, indent=1)
n = sum(r['pass'] for r in results)
print(f'\n{n}/{len(results)} passed')
