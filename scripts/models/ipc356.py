"""อ่าน IPC-D-356 (Allegro) → รายการแพด: net, ref, pin, x, y (mm), w, h, rot, side ('T'/'B'/'TH'), drill"""
import re, sys, json
def parse(path):
    out = []
    for l in open(path, errors='replace'):
        if l[:3] not in ('317', '327'): continue
        net = l[3:17].strip(); ref = l[20:26].strip(); pin = l[27:31].strip()
        m = re.search(r'(?:D(\d{4})([PU]))?A(\d\d)X([+-]\d{6})Y([+-]\d{6})X(\d{4})Y(\d{4})(?:R(\d{3}))?', l)
        if not m: continue
        d, pu, acc, x, y, w, h, r = m.groups()
        out.append({'net': net, 'ref': ref, 'pin': pin, 'x': int(x) / 1000, 'y': int(y) / 1000, 'w': int(w) / 1000, 'h': int(h) / 1000,
                    'rot': int(r or 0), 'acc': int(acc), 'drill': int(d) / 1000 if d else 0, 'thru': l[:3] == '317'})
    return out
if __name__ == '__main__':
    pads = parse(sys.argv[1])
    xs = [p['x'] for p in pads]; ys = [p['y'] for p in pads]
    print(len(pads), min(xs), max(xs), min(ys), max(ys))
    for p in pads:
        if p['ref'].startswith(('JDIGIT', 'JANALO')): print(p)
