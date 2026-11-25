"""gpiozero ชุดย่อยสำหรับ Circuit Lab 3D

เขียนขึ้นใหม่สำหรับแอปนี้ (ไม่ใช่โค้ดของไลบรารี gpiozero) ให้ชื่อคลาส/เมธอด/อาร์กิวเมนต์ตรงกับ gpiozero 2.0
เฉพาะส่วนที่ใช้กับวงจรในแอป — คลาสที่ไม่มีที่นี่จะ import ไม่ได้ (ImportError) แทนที่จะทำงานผิด ๆ

ต่างจากของจริง (บนบอร์ดจริงใช้เธรดเบื้องหลัง):
- callback (when_pressed ฯลฯ) ถูกเรียกเมื่อโปรแกรมหลักพัก (sleep/pause/wait_for_*/ลูปที่ไม่พักถูกพักให้ทุก ~2 ms)
- blink()/pulse()/PWM เป็นรูปคลื่นตามเวลาจำลองที่แม่นยำ (ของจริงเป็น PWM ซอฟต์แวร์ที่มีความสั่นของเวลา)
- MotionSensor/LineSensor อ่านค่าขาโดยตรง ไม่เฉลี่ยค่าในคิว (queue_len/sample_rate/threshold รับไว้แต่ไม่ใช้)
"""
import inspect
import json
import _pi
import _simrt

__version__ = '2.0.1-subset'

__all__ = [
    'Device', 'GPIODevice', 'OutputDevice', 'DigitalOutputDevice', 'PWMOutputDevice', 'LED', 'PWMLED', 'Buzzer',
    'RGBLED', 'Servo', 'AngularServo', 'InputDevice', 'DigitalInputDevice', 'Button', 'MotionSensor', 'LineSensor',
    'GPIOZeroError', 'DeviceClosed', 'BadEventHandler', 'BadWaitTime', 'GPIODeviceError', 'GPIOPinInUse',
    'GPIOPinMissing', 'PinError', 'PinInvalidPin', 'PinInvalidState', 'OutputDeviceBadValue', 'OutputDeviceError',
]


class GPIOZeroError(Exception):
    pass


class DeviceClosed(GPIOZeroError):
    pass


class BadEventHandler(GPIOZeroError, ValueError):
    pass


class BadWaitTime(GPIOZeroError, ValueError):
    pass


class GPIODeviceError(GPIOZeroError):
    pass


class GPIOPinInUse(GPIODeviceError):
    pass


class GPIOPinMissing(GPIODeviceError, ValueError):
    pass


class PinError(GPIOZeroError):
    pass


class PinInvalidPin(PinError, ValueError):
    pass


class PinInvalidState(PinError, ValueError):
    pass


class OutputDeviceError(GPIODeviceError):
    pass


class OutputDeviceBadValue(OutputDeviceError, ValueError):
    pass


# หัวต่อ J8 40 ขา: เลขขา (BOARD) → GPIO
_HEADER = {3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24, 19: 10, 21: 9, 22: 25,
           23: 11, 24: 8, 26: 7, 27: 0, 28: 1, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19, 36: 16, 37: 26, 38: 20, 40: 21}


def _parse_pin(spec):
    if isinstance(spec, bool):
        raise PinInvalidPin(f'{spec!r} is not a valid pin name')
    if isinstance(spec, int):
        n = spec
    elif isinstance(spec, str):
        s = spec.strip().upper()
        try:
            if s.startswith('GPIO'):
                n = int(s[4:])
            elif s.startswith('BCM'):
                n = int(s[3:])
            elif s.startswith('BOARD'):
                n = _HEADER[int(s[5:])]
            elif s.startswith('J8:'):
                n = _HEADER[int(s[3:])]
            elif s.isdigit():
                n = int(s)
            else:
                raise ValueError
        except (ValueError, KeyError):
            raise PinInvalidPin(f'{spec!r} is not a valid pin name') from None
    else:
        raise PinInvalidPin(f'{spec!r} is not a valid pin name')
    if not 0 <= n <= 27:
        raise PinInvalidPin(f'{spec!r} is not a valid pin name')
    return n


class Pin:
    """ข้อมูลขา (ส่วนที่ใช้บ่อยของ gpiozero.pins.Pin)"""

    def __init__(self, n):
        self.number = n

    @property
    def info(self):
        return self

    @property
    def name(self):
        return f'GPIO{self.number}'

    def __repr__(self):
        return f'GPIO{self.number}'


_devices = []
_reserved = {}


def _close_all():
    for d in list(_devices):
        try:
            d.close()
        except Exception:
            pass


def _callable_args(fn):
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return 0
    return sum(1 for p in sig.parameters.values()
               if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD))


def _wrap(dev, fn):
    if fn is None:
        return None
    if not callable(fn):
        raise BadEventHandler('value must be None or a callable')
    n = _callable_args(fn)
    if n == 0:
        return fn
    if n == 1:
        return lambda: fn(dev)
    raise BadEventHandler('value must be a callable which accepts up to one mandatory parameter')


class Device:
    def __init__(self):
        self._closed = False
        _devices.append(self)

    @property
    def closed(self):
        return self._closed

    def _check_open(self):
        if self._closed:
            raise DeviceClosed(f'{self.__class__.__name__} is closed or uninitialized')

    def close(self):
        self._closed = True
        if self in _devices:
            _devices.remove(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def is_active(self):
        return bool(self.value)

    @property
    def values(self):
        while True:
            try:
                yield self.value
            except DeviceClosed:
                break


class GPIODevice(Device):
    def __init__(self, pin=None, *, pin_factory=None):
        if pin is None:
            raise GPIOPinMissing('No pin given')
        n = _parse_pin(pin)
        if n in _reserved:
            raise GPIOPinInUse(f'pin GPIO{n} is already in use by {_reserved[n]!r}')
        super().__init__()
        self._pin = Pin(n)
        _reserved[n] = self

    @property
    def pin(self):
        return None if self._closed else self._pin

    def close(self):
        if self._closed:
            return
        n = self._pin.number
        if _reserved.get(n) is self:
            del _reserved[n]
        _pi.setup(n, 'down' if n > 8 else 'up')
        super().close()

    def __repr__(self):
        if self._closed:
            return f'<gpiozero.{self.__class__.__name__} object closed>'
        return f'<gpiozero.{self.__class__.__name__} object on pin GPIO{self._pin.number}, is_active={self.is_active}>'


# ---------------------------------------------------------------- เอาต์พุต

class SourceMixin:
    _source = None
    _source_delay = 0.01

    @property
    def source_delay(self):
        return self._source_delay

    @source_delay.setter
    def source_delay(self, v):
        if v < 0:
            raise BadWaitTime('source_delay must be 0 or greater')
        self._source_delay = float(v)

    @property
    def source(self):
        return self._source

    @source.setter
    def source(self, src):
        self._stop_source()
        self._source = src
        if src is None:
            return
        if isinstance(src, Device):
            # อุปกรณ์ขาเข้า: ตามค่าทันทีที่ขาเปลี่ยน (ของจริงอ่านทุก source_delay)
            dev = src
            self._apply_source(dev.value)
            pin = getattr(dev, '_pin', None)
            if pin is not None and isinstance(dev, InputDevice):
                def follow(level, t, dev=dev):
                    self._apply_source(dev.value)
                self._src_listen = (pin.number, follow)
                _simrt.listen(pin.number, follow)
                return
            src = dev.values
        it = iter(src)

        def tick():
            try:
                v = next(it)
            except StopIteration:
                self._src_timer = None
                return
            self._apply_source(v)
            self._src_timer = _simrt.add_timer(_pi.now() + max(self._source_delay, 1e-4), tick)
        tick()

    def _apply_source(self, v):
        self.value = v

    def _stop_source(self):
        t = getattr(self, '_src_timer', None)
        if t is not None:
            t.cancel()
            self._src_timer = None
        lst = getattr(self, '_src_listen', None)
        if lst is not None:
            _simrt.unlisten(*lst)
            self._src_listen = None
        self._source = None


class OutputDevice(SourceMixin, GPIODevice):
    def __init__(self, pin=None, *, active_high=True, initial_value=False, pin_factory=None):
        super().__init__(pin, pin_factory=pin_factory)
        self._active_high = bool(active_high)
        self._blink_end = None
        n = self._pin.number
        if initial_value is None:
            cur = _pi.read(n)
            _pi.write(n, cur)
        else:
            self._write(bool(initial_value))

    def _write(self, v):
        self._check_open()
        _pi.write(self._pin.number, 1 if bool(v) == self._active_high else 0)

    def _read(self):
        return (_pi.level(self._pin.number) == 1) == self._active_high

    def _stop_blink(self):
        self._blink_end = None

    @property
    def active_high(self):
        return self._active_high

    @active_high.setter
    def active_high(self, v):
        self._active_high = bool(v)

    def on(self):
        self._stop_blink()
        self._write(True)

    def off(self):
        self._stop_blink()
        self._write(False)

    def toggle(self):
        self.value = not self.value

    @property
    def value(self):
        self._check_open()
        return int(self._read())

    @value.setter
    def value(self, v):
        self._stop_blink()
        self._write(bool(v))

    def close(self):
        if not self._closed:
            self._stop_source()
        super().close()


def _play(dev, seq, n, background, end_value, freq=100.0):
    """เล่นลำดับ (ค่า 0–1, ระยะเวลา) บนขาของ dev ซ้ำ n รอบ (None = ไม่จำกัด) แล้วจบที่ end_value"""
    ah = dev._active_high
    segs = [[d, v if ah else 1 - v] for v, d in seq]
    end = end_value if ah else 1 - end_value
    _pi.pattern(dev._pin.number, freq, json.dumps(segs), 0 if n is None else int(n), end)
    total = None if n is None else n * sum(d for _, d in seq)
    dev._blink_end = float('inf') if total is None else _pi.now() + total
    if not background:
        if total is None:
            _simrt.pause()
        _simrt.sleep(total)
        dev._blink_end = None


class DigitalOutputDevice(OutputDevice):
    def __init__(self, pin=None, *, active_high=True, initial_value=False, pin_factory=None):
        super().__init__(pin, active_high=active_high, initial_value=initial_value, pin_factory=pin_factory)

    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._check_open()
        self._stop_source()
        _play(self, [(1, on_time), (0, off_time)], n, background, 0)


class LED(DigitalOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class Buzzer(DigitalOutputDevice):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self.blink(on_time, off_time, n, background)


class PWMOutputDevice(OutputDevice):
    def __init__(self, pin=None, *, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        self._frequency = float(frequency)
        self._value = 0.0
        super().__init__(pin, active_high=active_high, initial_value=None, pin_factory=pin_factory)
        self.value = initial_value

    def _write(self, v):
        self._check_open()
        v = float(v)
        if not 0 <= v <= 1:
            raise OutputDeviceBadValue('PWM value must be between 0 and 1')
        self._value = v
        d = v if self._active_high else 1 - v
        if d <= 0 or d >= 1:
            _pi.write(self._pin.number, 1 if d >= 1 else 0)
        else:
            _pi.pattern(self._pin.number, self._frequency, json.dumps([[-1, d]]), 0, d)

    @property
    def value(self):
        self._check_open()
        if self._blink_end is not None and _pi.now() < self._blink_end:
            d = _pi.duty(self._pin.number)
            if d >= 0:
                return d if self._active_high else 1 - d
        return self._value

    @value.setter
    def value(self, v):
        self._stop_blink()
        self._write(v)

    def on(self):
        self.value = 1

    def off(self):
        self.value = 0

    def toggle(self):
        self.value = 1 - self.value

    @property
    def is_active(self):
        return self.value != 0

    @property
    def frequency(self):
        return self._frequency

    @frequency.setter
    def frequency(self, f):
        self._frequency = float(f)
        self._write(self._value)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        self._check_open()
        self._stop_source()
        fps = 25
        seq = []
        if fade_in_time:
            seq += [(i * (1 / fps) / fade_in_time, 1 / fps) for i in range(int(fps * fade_in_time))]
        seq.append((1, on_time))
        if fade_out_time:
            seq += [(1 - (i * (1 / fps) / fade_out_time), 1 / fps) for i in range(int(fps * fade_out_time))]
        seq.append((0, off_time))
        self._value = 0.0
        _play(self, seq, n, background, 0, self._frequency)

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, n, background)


class PWMLED(PWMOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class RGBLED(SourceMixin, Device):
    def __init__(self, red=None, green=None, blue=None, *, active_high=True, initial_value=(0, 0, 0), pwm=True, pin_factory=None):
        if red is None or green is None or blue is None:
            raise GPIOPinMissing('red, green, and blue pins must be provided')
        cls = PWMLED if pwm else LED
        self._leds = ()
        self._leds = tuple(cls(p, active_high=active_high) for p in (red, green, blue))
        super().__init__()
        self._pwm = pwm
        self.value = initial_value

    @property
    def value(self):
        return tuple(l.value for l in self._leds)

    @value.setter
    def value(self, v):
        v = tuple(v)
        if len(v) != 3 or any(not 0 <= x <= 1 for x in v):
            raise OutputDeviceBadValue('each RGB color component must be between 0 and 1')
        if not self._pwm and any(x not in (0, 1) for x in v):
            raise OutputDeviceBadValue('each RGB color component must be 0 or 1 with non-PWM RGBLEDs')
        for l, x in zip(self._leds, v):
            l.value = x

    color = value

    @property
    def red(self):
        return self._leds[0].value

    @red.setter
    def red(self, v):
        self._leds[0].value = v

    @property
    def green(self):
        return self._leds[1].value

    @green.setter
    def green(self, v):
        self._leds[1].value = v

    @property
    def blue(self):
        return self._leds[2].value

    @blue.setter
    def blue(self, v):
        self._leds[2].value = v

    @property
    def is_active(self):
        return self.value != (0, 0, 0)

    is_lit = is_active

    def on(self):
        self.value = (1, 1, 1)

    def off(self):
        self.value = (0, 0, 0)

    def toggle(self):
        self.value = tuple(1 - x for x in self.value)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        fps = 25
        for k, l in enumerate(self._leds):
            a, b = off_color[k], on_color[k]
            seq = []
            if fade_in_time:
                seq += [(a + (b - a) * i * (1 / fps) / fade_in_time, 1 / fps) for i in range(int(fps * fade_in_time))]
            seq.append((b, on_time))
            if fade_out_time:
                seq += [(b + (a - b) * i * (1 / fps) / fade_out_time, 1 / fps) for i in range(int(fps * fade_out_time))]
            seq.append((a, off_time))
            _play(l, seq, n, True, a, getattr(l, '_frequency', 100.0))
        if not background:
            total = None if n is None else n * (on_time + off_time + fade_in_time + fade_out_time)
            if total is None:
                _simrt.pause()
            _simrt.sleep(total)

    def pulse(self, fade_in_time=1, fade_out_time=1, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, on_color, off_color, n, background)

    def close(self):
        for l in self._leds:
            l.close()
        super().close()

    def __repr__(self):
        return f'<gpiozero.RGBLED object on pins {", ".join(repr(l._pin) for l in self._leds)}>'


class Servo(SourceMixin, GPIODevice):
    def __init__(self, pin=None, *, initial_value=0.0, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        if min_pulse_width >= max_pulse_width:
            raise ValueError('min_pulse_width must be less than max_pulse_width')
        if max_pulse_width >= frame_width:
            raise ValueError('max_pulse_width must be less than frame_width')
        super().__init__(pin, pin_factory=pin_factory)
        self._min_pw, self._max_pw, self._frame = min_pulse_width, max_pulse_width, frame_width
        self._value = None
        _pi.write(self._pin.number, 0)
        self.value = initial_value

    @property
    def frame_width(self):
        return self._frame

    @property
    def min_pulse_width(self):
        return self._min_pw

    @property
    def max_pulse_width(self):
        return self._max_pw

    @property
    def pulse_width(self):
        if self._value is None:
            return None
        return self._min_pw + (self._value + 1) / 2 * (self._max_pw - self._min_pw)

    @pulse_width.setter
    def pulse_width(self, pw):
        if pw is None:
            self.value = None
        else:
            self.value = (pw - self._min_pw) / (self._max_pw - self._min_pw) * 2 - 1

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._check_open()
        n = self._pin.number
        if v is None:
            self._value = None
            _pi.write(n, 0)
            return
        v = float(v)
        if not -1 <= v <= 1:
            raise OutputDeviceBadValue('Servo value must be between -1 and 1, or None')
        self._value = v
        _pi.pattern(n, 1 / self._frame, json.dumps([[-1, self.pulse_width / self._frame]]), 0, 0)

    def min(self):
        self.value = -1

    def mid(self):
        self.value = 0

    def max(self):
        self.value = 1

    def detach(self):
        self.value = None

    @property
    def is_active(self):
        return self._value is not None

    def close(self):
        if not self._closed:
            self._stop_source()
        super().close()


class AngularServo(Servo):
    def __init__(self, pin=None, *, initial_angle=0.0, min_angle=-90, max_angle=90, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        self._min_angle, self._max_angle = min_angle, max_angle
        span = max_angle - min_angle
        iv = None if initial_angle is None else ((initial_angle - min_angle) / span) * 2 - 1
        super().__init__(pin, initial_value=iv, min_pulse_width=min_pulse_width, max_pulse_width=max_pulse_width, frame_width=frame_width, pin_factory=pin_factory)

    @property
    def min_angle(self):
        return self._min_angle

    @property
    def max_angle(self):
        return self._max_angle

    @property
    def angle(self):
        v = self.value
        if v is None:
            return None
        return self._min_angle + (v + 1) / 2 * (self._max_angle - self._min_angle)

    @angle.setter
    def angle(self, a):
        if a is None:
            self.value = None
        else:
            self.value = ((a - self._min_angle) / (self._max_angle - self._min_angle)) * 2 - 1


# ---------------------------------------------------------------- อินพุต

class InputDevice(GPIODevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, pin_factory=None):
        super().__init__(pin, pin_factory=pin_factory)
        n = self._pin.number
        if pull_up is None:
            if active_state is None:
                self.close()
                raise PinInvalidState(f'Pin GPIO{n} is defined as floating, but "active_state" is not defined')
            self._active_state = bool(active_state)
        else:
            if active_state is not None:
                self.close()
                raise PinInvalidState(f'Pin GPIO{n} is not floating, but "active_state" is not None')
            if n in (2, 3) and not pull_up:
                self.close()
                raise PinInvalidState(f'GPIO{n} has a physical pull-up resistor')
            self._active_state = not pull_up
        self._pull = None if pull_up is None else bool(pull_up)
        _pi.setup(n, 'none' if pull_up is None else ('up' if pull_up else 'down'))
        # ตัวดึงขึ้น/ลงมีผลทันทีบนบอร์ดจริง: ให้วงจรคำนวณใหม่ก่อนอ่านค่าแรก
        _simrt.settle()

    @property
    def pull_up(self):
        return self._pull

    @property
    def value(self):
        self._check_open()
        return int(_pi.read(self._pin.number) == (1 if self._active_state else 0))

    def __repr__(self):
        if self._closed:
            return super().__repr__()
        return (f'<gpiozero.{self.__class__.__name__} object on pin GPIO{self._pin.number}, '
                f'pull_up={self.pull_up}, is_active={self.is_active}>')


class EventsMixin:
    def _events_init(self, bounce_time=None):
        self._when_activated = None
        self._when_deactivated = None
        self._bounce = bounce_time
        self._last_edge = None
        self._state = bool(self.value)
        self._changed_at = _pi.now()
        self._listener = lambda level, t: self._edge(level, t)
        _simrt.listen(self._pin.number, self._listener)

    def _edge(self, level, t):
        if self._closed:
            return
        if self._bounce is not None and self._last_edge is not None and t - self._last_edge < self._bounce:
            return
        self._last_edge = t
        active = (level == 1) == self._active_state
        if active == self._state:
            return
        self._state = active
        self._changed_at = t
        if active:
            self._on_activated()
        else:
            self._on_deactivated()

    def _on_activated(self):
        if self._when_activated:
            self._when_activated()

    def _on_deactivated(self):
        if self._when_deactivated:
            self._when_deactivated()

    @property
    def when_activated(self):
        return self._when_activated

    @when_activated.setter
    def when_activated(self, fn):
        self._when_activated = _wrap(self, fn)

    @property
    def when_deactivated(self):
        return self._when_deactivated

    @when_deactivated.setter
    def when_deactivated(self, fn):
        self._when_deactivated = _wrap(self, fn)

    def wait_for_active(self, timeout=None):
        return _simrt.wait_for(lambda: self.is_active, timeout)

    def wait_for_inactive(self, timeout=None):
        return _simrt.wait_for(lambda: not self.is_active, timeout)

    @property
    def active_time(self):
        return _pi.now() - self._changed_at if self.is_active else None

    @property
    def inactive_time(self):
        return None if self.is_active else _pi.now() - self._changed_at

    def close(self):
        if not self._closed and getattr(self, '_listener', None):
            _simrt.unlisten(self._pin.number, self._listener)
        super().close()


class DigitalInputDevice(EventsMixin, InputDevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, bounce_time=None, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, pin_factory=pin_factory)
        self._events_init(bounce_time)


class Button(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, bounce_time=bounce_time, pin_factory=pin_factory)
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat
        self._when_held = None
        self._held_from = None
        self._hold_timer = None
        if self._state:
            self._arm_hold()

    def _arm_hold(self):
        if self._hold_timer:
            self._hold_timer.cancel()
        self._hold_timer = _simrt.add_timer(_pi.now() + self.hold_time, self._held)

    def _held(self):
        self._hold_timer = None
        if self._closed or not self._state:
            return
        if self._held_from is None:
            self._held_from = _pi.now()
        if self._when_held:
            self._when_held()
        if self.hold_repeat:
            self._arm_hold()

    def _on_activated(self):
        self._arm_hold()
        super()._on_activated()

    def _on_deactivated(self):
        if self._hold_timer:
            self._hold_timer.cancel()
            self._hold_timer = None
        self._held_from = None
        super()._on_deactivated()

    @property
    def when_held(self):
        return self._when_held

    @when_held.setter
    def when_held(self, fn):
        self._when_held = _wrap(self, fn)

    @property
    def is_held(self):
        return self._held_from is not None

    @property
    def held_time(self):
        return None if self._held_from is None else _pi.now() - self._held_from

    is_pressed = DigitalInputDevice.is_active
    pressed_time = DigitalInputDevice.active_time
    when_pressed = DigitalInputDevice.when_activated
    when_released = DigitalInputDevice.when_deactivated
    wait_for_press = DigitalInputDevice.wait_for_active
    wait_for_release = DigitalInputDevice.wait_for_inactive

    def close(self):
        if self._hold_timer:
            self._hold_timer.cancel()
        super().close()


class MotionSensor(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, queue_len=1, sample_rate=10, threshold=0.5, partial=False, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, pin_factory=pin_factory)

    motion_detected = DigitalInputDevice.is_active
    when_motion = DigitalInputDevice.when_activated
    when_no_motion = DigitalInputDevice.when_deactivated
    wait_for_motion = DigitalInputDevice.wait_for_active
    wait_for_no_motion = DigitalInputDevice.wait_for_inactive


class LineSensor(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, queue_len=5, sample_rate=100, threshold=0.5, partial=False, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, pin_factory=pin_factory)

    @property
    def line_detected(self):
        return not self.is_active

    when_line = DigitalInputDevice.when_deactivated
    when_no_line = DigitalInputDevice.when_activated
    wait_for_line = DigitalInputDevice.wait_for_inactive
    wait_for_no_line = DigitalInputDevice.wait_for_active
