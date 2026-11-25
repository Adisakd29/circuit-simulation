"""E2E: แผงเวลาจำลอง (ด้านล่างซ้าย) บนแท็บเล็ตจอสัมผัส + ความสม่ำเสมอของไฟกะพริบ
ปัญหาที่พบบน iPad: ระหว่างจำลองแผงถูกสร้างใหม่ทุก 250 ms → การแตะ (นิ้วแตะค้าง ~0.1–0.3 s) ที่คร่อมจังหวะสร้างใหม่หายไป
จึงย่อ/ปิดแผงไม่ได้ และไฟกะพริบ 555 ติด/ดับไม่สม่ำเสมอ
ตรวจ: (1) ปุ่มในแผงและปุ่มด่วนไม่ถูกสร้างใหม่ระหว่างจำลอง (2) แตะค้าง 250 ms ที่ปุ่มย่อ/ซ่อน/แสดง ทำงานทุกครั้ง
(3) วัดจังหวะไฟกะพริบจากผลจำลองที่มาถึงหน้าเว็บ (ปิด WebGL เพื่อไม่ให้การวาดภาพด้วยซอฟต์แวร์แย่ง CPU ของเครื่องทดสอบ)
ตรวจเพิ่ม: แตะปุ่มหยุดจำลองระหว่างจำลอง และตัวเล่นความสว่าง LED ตามเวลาจำลอง
ใช้: python3 tests/e2e/dock_ui.py <out-dir> [url] [tablet,blink]
"""
import os, sys, time, statistics
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson20-555.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def slow_tap(page, cdp, sel, hold=0.25):
    bb = page.locator(sel).bounding_box()
    x, y = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
    time.sleep(hold)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    time.sleep(0.5)

def tablet(pw, w, h):
    tag = f'tablet-{w}x{h}'
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=1)
    page = ctx.new_page(); cdp = ctx.new_cdp_session(page)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.set_input_files('#file-input', FIX); time.sleep(1)
    page.evaluate("circuitLab.select({t: 'part', id: 'LED1'})"); time.sleep(0.3)
    page.click('#btn-run')
    page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.mode === 'tran' && circuitLab.freshSim.t > 0.3", timeout=30000, polling=200)
    page.evaluate("""() => { document.getElementById('lg-toggle').__mark = 1; document.getElementById('lg-speed').__mark = 1; const q = document.querySelector('#quick button'); if (q) q.__mark = 1; }""")
    time.sleep(1.5)
    same = page.evaluate("""() => [document.getElementById('lg-toggle').__mark, document.getElementById('lg-speed').__mark, (document.querySelector('#quick button') || {}).__mark]""")
    check(f'{tag}: ระหว่างจำลอง 1.5 s ปุ่มย่อแผง ช่องเลือกความเร็ว และปุ่มด่วน (หมุน/คัดลอก/ลบ) เป็นชิ้นเดิม ไม่ถูกสร้างใหม่', same == [1, 1, 1], str(same))
    t0 = page.evaluate('circuitLab.freshSim.t')
    slow_tap(page, cdp, '#lg-toggle')
    collapsed = page.evaluate("document.getElementById('lg-toggle').getAttribute('aria-expanded')") == 'false' and page.locator('#lg-canvas').count() == 0
    check(f'{tag}: แตะค้าง 250 ms ที่ปุ่มย่อ → แผงย่อเหลือแถบเวลา', collapsed)
    page.screenshot(path=f'{OUT}/{tag}-1-collapsed.png')
    slow_tap(page, cdp, '#lg-toggle')
    check(f'{tag}: แตะอีกครั้ง → ขยายกลับ มีกราฟ', page.locator('#lg-canvas').count() == 1)
    slow_tap(page, cdp, '#lg-hide')
    hid = page.locator('#lg-show').count() == 1 and page.locator('#lg-pause').count() == 0
    bb = page.locator('#logger').bounding_box()
    check(f'{tag}: แตะปุ่ม × → ซ่อนแผง เหลือปุ่มเล็กแสดงเวลา', hid and bb['width'] < 200 and bb['height'] < 60, f"{bb['width']:.0f}×{bb['height']:.0f} {page.inner_text('#logger')}")
    time.sleep(0.6)
    t1 = page.evaluate('circuitLab.freshSim.t')
    check(f'{tag}: ซ่อนแผงแล้วการจำลองยังเดินต่อ (เวลาบนปุ่มเล็กเพิ่มขึ้น)', t1 > t0 and 't =' in page.inner_text('#lg-show'), f'{t0:.2f} → {t1:.2f} s')
    page.screenshot(path=f'{OUT}/{tag}-2-hidden.png')
    slow_tap(page, cdp, '#lg-show')
    check(f'{tag}: แตะปุ่มเล็ก → แผงกลับมา', page.locator('#lg-pause').count() == 1 and page.locator('#lg-canvas').count() == 1)
    slow_tap(page, cdp, '#lg-pause')
    check(f'{tag}: แตะค้างที่ "หยุดเวลา" → หยุด', page.evaluate('circuitLab.simc.paused') is True)
    slow_tap(page, cdp, '#lg-pause')
    # ปุ่มหยุดจำลอง (■) บนแถบบน: แตะแล้วหยุดทันที (ภายใน 1 s) ระหว่างที่ผลจำลองมาต่อเนื่อง
    page.wait_for_function('!circuitLab.simc.paused && circuitLab.running', timeout=5000)
    t0 = time.time(); slow_tap(page, cdp, '#btn-stop', 0.15)
    try: page.wait_for_function('!circuitLab.running', timeout=5000, polling=50)
    except Exception: pass
    check(f'{tag}: แตะปุ่มหยุด (■) ระหว่างจำลอง → หยุดทันที', not page.evaluate('circuitLab.running'), f'{(time.time() - t0) * 1000:.0f} ms (รวมเวลาแตะ 150 ms + รอ 500 ms ในตัวช่วย)')
    check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
    b.close()

def blink(pw):
    """ตัวเล่นความสว่าง LED ตามเวลาจำลอง (เหมือนในฉาก 3 มิติ) บนหน้าเว็บจริง: ป้อนผลจำลองที่มาถึงทีละช่วง แล้วอ่านทุกเฟรม (rAF)
    ปิด WebGL เพื่อให้เฟรมเดินสม่ำเสมอบนเครื่องทดสอบ (การวาดด้วยซอฟต์แวร์ทำให้เฟรมช้าจนวัดไม่ได้)"""
    b = pw.chromium.launch(args=['--disable-webgl', '--disable-3d-apis'])
    page = b.new_page(viewport={'width': 1180, 'height': 820})
    page.goto(URL); page.wait_for_function('window.circuitLab !== undefined && window.__cl', timeout=30000)
    page.set_input_files('#file-input', FIX); time.sleep(1)
    page.evaluate("""() => { const c = circuitLab.simc; const orig = c.onResult; window.__arr = []; window.__edges = []; let pb = null, last = null;
      c.onResult = (u) => { orig(u); if (u.mode !== 'tran') return; const k = u.watch.findIndex(w => w.key === 'led:LED1'); if (k < 0) return;
        const s = circuitLab.freshSim; if (s) window.__arr.push([performance.now(), s.analysis.parts.LED1.current > 1e-3]);
        if (!pb) pb = new window.__cl.LedPlayback(['LED1'], [0.02], c.speed);
        pb.push(u.samples.map(x => ({ t: x.t, i: [x.v[k] ?? 0] })), u.t, performance.now(), c.speed, u.restarted); };
      const loop = () => { requestAnimationFrame(loop); if (!pb) return; const v = pb.frame(performance.now(), window.__cl.ledBrightness); if (!v) return;
        const on = v[0] > 0.35; if (last !== null && on !== last) window.__edges.push([performance.now(), on]); last = on; };
      requestAnimationFrame(loop); }""")
    page.click('#btn-run'); time.sleep(10)
    def spread(ev):
        ev = ev[3:]
        d = [(ev[i + 1][0] - ev[i][0], ev[i][1]) for i in range(len(ev) - 1)]
        dev = 0
        for state in (True, False):
            xs = sorted(x for x, s in d if s == state)
            if xs: med = xs[len(xs) // 2]; dev = max(dev, max(abs(x - med) for x in xs))
        return len(d), dev, ' '.join(str(round(x)) for x, _ in d[:14])
    arr = page.evaluate('window.__arr'); arr_t = []
    for i in range(1, len(arr)):
        if arr[i][1] != arr[i - 1][1]: arr_t.append(arr[i])
    n0, dev0, s0 = spread(arr_t)
    n1, dev1, s1 = spread(page.evaluate('window.__edges'))
    print(f'  (ข้อมูล) สถานะตอนท้ายแต่ละช่วงที่มาถึง: ช่วงติด/ดับคลาดจากค่ากลางสูงสุด {dev0:.0f} ms · {s0}', flush=True)
    check('ไฟกะพริบ 555: ตัวเล่นตามเวลาจำลอง ช่วงติด/ดับคลาดจากค่ากลางไม่เกิน 1 เฟรม + 4 ms (≤ 21 ms)', n1 > 15 and dev1 <= 21, f'{n1} ช่วง คลาดสูงสุด {dev1:.0f} ms · {s1}')
    b.close()

with sync_playwright() as pw:
    parts = (sys.argv[3] if len(sys.argv) > 3 else 'tablet,blink').split(',')
    if 'blink' in parts: blink(pw)  # วัดก่อน: ไม่ให้เบราว์เซอร์ที่วาดด้วยซอฟต์แวร์ของรอบก่อนแย่ง CPU
    if 'tablet' in parts:
        for w, h in [(820, 1180), (1180, 820)]: tablet(pw, w, h)
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
