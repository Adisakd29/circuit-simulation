# ตัวรันโปรแกรมของบอร์ด Raspberry Pi ใน Circuit Lab 3D (เขียนขึ้นสำหรับแอปนี้)
# - เวลา: time.sleep/time.time/time.monotonic ใช้ "เวลาจำลอง" ของวงจร (ไม่ใช่นาฬิกาจริง)
# - Python ทำงานไม่กินเวลาจำลองระหว่างจุดพัก: sleep()/pause()/wait_for_*() — ลูปที่ไม่พักเลย ถูกพักทุก ~2 ms ของเวลาจริง
#   และเดินเวลาจำลองเท่ากับเวลาที่ Python ใช้ในเบราว์เซอร์ (ไม่ใช่ความเร็วของ CPU บอร์ดจริง)
# - callback ของ gpiozero (when_pressed ฯลฯ) ถูกเรียกที่จุดพักของโปรแกรมหลัก (gpiozero จริงเรียกจากเธรดแยก)
import sys, time, json, heapq, linecache, traceback, signal
import _pi
from pyodide.ffi import run_sync


_timers = []
_seq = 0
_listeners = {}
_count = 0
_wall0 = 0.0
_orig_time = time.time


class _Timer:
    __slots__ = ('fn',)

    def __init__(self, fn):
        self.fn = fn

    def cancel(self):
        self.fn = None


def now():
    return _pi.now()


def add_timer(t, fn):
    """เรียก fn() เมื่อเวลาจำลองถึง t (วินาที) — คืนตัวจับที่ .cancel() ได้"""
    global _seq
    h = _Timer(fn)
    _seq += 1
    heapq.heappush(_timers, (t, _seq, h))
    return h


def listen(pin, fn):
    """fn(level, t) เมื่อขาเข้า pin เปลี่ยนระดับ"""
    _listeners.setdefault(pin, []).append(fn)
    _pi.watch(pin, 1)


def unlisten(pin, fn):
    lst = _listeners.get(pin)
    if lst and fn in lst:
        lst.remove(fn)
    if not lst:
        _listeners.pop(pin, None)
        _pi.watch(pin, 0)


def _run_timers():
    while _timers and _timers[0][0] <= _pi.now() + 1e-12:
        _, _, h = heapq.heappop(_timers)
        fn = h.fn
        if fn is not None:
            h.fn = None
            fn()


def _step(until):
    """พักหนึ่งครั้ง: จนถึง until หรือ timer ถัดไป หรือมีขอบสัญญาณ — แล้วเรียก callback ที่ค้าง"""
    _run_timers()
    t = _pi.now()
    if t >= until - 1e-12:
        return
    nxt = until
    while _timers and _timers[0][2].fn is None:
        heapq.heappop(_timers)
    if _timers and _timers[0][0] < nxt:
        nxt = _timers[0][0]
    global _slice_start
    r = run_sync(_pi.wait(nxt))
    _slice_start = _real()
    if r == 'STOP':
        raise KeyboardInterrupt
    if r != '[]':
        for pin, lvl, te in json.loads(r):
            for fn in list(_listeners.get(pin, ())):
                fn(lvl, te)
    _run_timers()


def settle():
    """พักโดยไม่เดินเวลา: ให้วงจรคำนวณใหม่ (เช่น หลังเปิดตัวต้านทานดึงขึ้น) ก่อนอ่านขาเข้า"""
    global _slice_start
    r = run_sync(_pi.wait(_pi.now()))
    _slice_start = _real()
    if r == 'STOP':
        raise KeyboardInterrupt


def wait_until(until):
    while _pi.now() < until - 1e-12:
        _step(until)
    _run_timers()


def wait_for(pred, timeout=None):
    """รอจน pred() เป็นจริง (คืน True) หรือหมดเวลา (คืน False)"""
    deadline = float('inf') if timeout is None else _pi.now() + max(0.0, timeout)
    while not pred():
        if _pi.now() >= deadline - 1e-12:
            return False
        _step(deadline)
    return True


def sleep(secs):
    if secs < 0:
        raise ValueError('sleep length must be non-negative')
    wait_until(_pi.now() + secs)


def pause():
    while True:
        _step(float('inf'))


_real = time.perf_counter
_slice_start = 0.0
_TOOL = 4


def _slice():
    """โค้ดที่วนลูปโดยไม่พัก: ทุก ~2 ms ของเวลาจริงที่ Python ใช้ ให้พักและเดินเวลาจำลองเท่ากับเวลานั้น (สูงสุด 5 ms)"""
    global _count
    _count += 1
    if _count >= 64:
        _count = 0
        dt = _real() - _slice_start
        if dt >= 0.002:
            wait_until(_pi.now() + min(dt, 0.005))


def _on_jump(code, offset, dest):
    if code.co_filename != 'main.py':
        return sys.monitoring.DISABLE
    if dest < offset:
        _slice()


def _trace_local(frame, event, arg):
    if event == 'line':
        _slice()
    return _trace_local


def _trace(frame, event, arg):
    if frame.f_code.co_filename != 'main.py':
        return None
    return _trace_local


def _watch_on():
    """ตรวจจับลูปของ main.py: sys.monitoring (เฉพาะการกระโดดย้อนกลับ = รอบของลูป) ถ้ามี ไม่งั้นใช้ settrace"""
    m = getattr(sys, 'monitoring', None)
    if m is not None:
        try:
            if m.get_tool(_TOOL) is None:
                m.use_tool_id(_TOOL, 'circuitlab')
            m.register_callback(_TOOL, m.events.JUMP, _on_jump)
            m.set_events(_TOOL, m.events.JUMP)
            return
        except Exception:
            pass
    sys.settrace(_trace)


def _watch_off():
    m = getattr(sys, 'monitoring', None)
    if m is not None:
        try:
            m.set_events(_TOOL, 0)
        except Exception:
            pass
    sys.settrace(None)


def _patch():
    time.sleep = sleep
    time.time = lambda: _wall0 + _pi.now()
    time.time_ns = lambda: int((_wall0 + _pi.now()) * 1e9)
    time.monotonic = now
    time.monotonic_ns = lambda: int(_pi.now() * 1e9)
    time.perf_counter = now
    time.perf_counter_ns = lambda: int(_pi.now() * 1e9)
    signal.pause = pause


def _reset():
    global _timers, _listeners, _count
    _timers = []
    _listeners = {}
    _count = 0
    for name in [m for m in sys.modules if m == 'gpiozero' or m.startswith('gpiozero.')]:
        del sys.modules[name]
    sys.modules.pop('__main__sim', None)


def _close_all():
    gz = sys.modules.get('gpiozero')
    if gz is not None and hasattr(gz, '_close_all'):
        try:
            gz._close_all()
        except Exception:
            pass


def run_main(src):
    """รัน main.py — คืน JSON {ok, error, line, stopped}"""
    global _wall0, _slice_start
    _reset()
    _patch()
    _wall0 = _orig_time() - _pi.now()
    _slice_start = _real()
    linecache.cache['main.py'] = (len(src), None, src.splitlines(True), 'main.py')
    try:
        code = compile(src, 'main.py', 'exec')
    except SyntaxError as e:
        text = ''.join(traceback.format_exception_only(type(e), e))
        print(text, end='')
        return json.dumps({'ok': False, 'error': '%s: %s' % (type(e).__name__, e.msg), 'line': e.lineno})
    g = {'__name__': '__main__', '__file__': 'main.py', '__builtins__': __builtins__}
    _watch_on()
    try:
        exec(code, g)
        return json.dumps({'ok': True})
    except KeyboardInterrupt:
        _watch_off()
        print('\nKeyboardInterrupt')
        return json.dumps({'ok': True, 'stopped': True})
    except SystemExit as e:
        return json.dumps({'ok': e.code in (None, 0)})
    except BaseException as e:
        _watch_off()
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == 'main.py' or 'gpiozero' in f.filename]
        line = None
        for f in frames:
            if f.filename == 'main.py':
                line = f.lineno
        msg = ''.join(traceback.format_exception_only(type(e), e)).strip()
        print('Traceback (most recent call last):\n' + ''.join(traceback.format_list(frames)) + msg)
        return json.dumps({'ok': False, 'error': msg.splitlines()[-1] if msg else type(e).__name__, 'line': line})
    finally:
        _watch_off()
        _close_all()
