"""IPC-356 → รายการชิ้นส่วน (ตำแหน่ง/ขนาดจากแพดจริง) สำหรับสร้างโมเดล: ref, side, cx, cy (mm กรอบ IPC), L, W (mm), ang (องศา), n (จำนวนแพด)"""
import os
import sys, json, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from ipc356 import parse
def parts(path):
    pads = parse(path); by = collections.defaultdict(list)
    for p in pads:
        if p['ref'] in ('VIA', '') or p['ref'].startswith('TP'): continue
        by[p['ref']].append(p)
    out = []
    for ref, ps in by.items():
        side = 'T' if all(p['acc'] == 1 for p in ps) else 'B' if all(p['acc'] == 8 for p in ps) else 'TH'
        if len(ps) == 2 and side != 'TH':
            a, b = ps; dx, dy = b['x'] - a['x'], b['y'] - a['y']; d = math.hypot(dx, dy)
            ang = math.degrees(math.atan2(dy, dx))
            # ขนาดแพดตามแนวแกนชิ้นส่วน (แพด w/h อ้างอิงทิศหมุนของแพด)
            pw = max(a['w'], a['h']); ph = min(a['w'], a['h'])
            along = a['w'] if (a['rot'] % 180 == 0) == (abs(dx) >= abs(dy)) else a['h']
            across = a['h'] if along == a['w'] else a['w']
            out.append({'ref': ref, 'side': side, 'cx': (a['x'] + b['x']) / 2, 'cy': (a['y'] + b['y']) / 2, 'L': d + along * 0.6, 'W': across * 0.9, 'ang': ang, 'n': 2, 'pitch': d})
        else:
            xs0 = [p['x'] - p['w'] / 2 for p in ps]; xs1 = [p['x'] + p['w'] / 2 for p in ps]
            ys0 = [p['y'] - p['h'] / 2 for p in ps]; ys1 = [p['y'] + p['h'] / 2 for p in ps]
            out.append({'ref': ref, 'side': side, 'cx': (min(xs0) + max(xs1)) / 2, 'cy': (min(ys0) + max(ys1)) / 2, 'L': max(xs1) - min(xs0), 'W': max(ys1) - min(ys0), 'ang': 0, 'n': len(ps),
                        'pads': [[round(p['x'], 3), round(p['y'], 3), round(p['w'], 3), round(p['h'], 3), p['pin'], p['net']] for p in ps] if ref.startswith(('J', 'Q', 'U', 'Y', 'L', 'D2', 'SW')) or len(ps) <= 20 else None})
    return out
if __name__ == '__main__':
    ps = parts(sys.argv[1]); json.dump(ps, open(sys.argv[2], 'w'), indent=0)
    c = collections.Counter((p['side'], ''.join(ch for ch in p['ref'] if ch.isalpha())[:4]) for p in ps)
    print(len(ps), sorted(c.items()))
    two = [p for p in ps if p['n'] == 2]
    print('pitch histogram', collections.Counter(round(p['pitch'], 1) for p in two).most_common(12))
