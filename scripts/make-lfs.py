"""สร้างอิมเมจ LittleFS ของ Pico ที่จำลอง (firmware/littlefs-blocks.bin) จากไฟล์ใน firmware/fs/ + รูปพื้นหลังเริ่มต้น bg.bin
ค่าเดียวกับที่ MicroPython v1.24.1 rp2 ใช้: block 4096 B × 352 บล็อก (1408 KB ที่ offset 0xA0000 ของแฟลช), prog 256 B, ชื่อไฟล์ ≤ 32 อักษร
(ตรวจแล้ว: อิมเมจว่างที่สร้างด้วยค่านี้ตรงกับอิมเมจว่างรุ่นแรกของโปรเจกต์ทุกไบต์)
ตัวจำลองยังเขียนแฟลชผ่าน SSI ไม่ได้ ไฟล์จึงต้องอยู่ในอิมเมจตั้งแต่ต้น — เหมือนนักเรียนคัดลอกไฟล์ลงบอร์ดจริงด้วย Thonny/mpremote

bg.bin = ภาพ 240×240 RGB565 เรียงไบต์สูงก่อน (115,200 ไบต์ ส่งเข้าจอ GC9A01 ได้ตรง ๆ) — ภาพเริ่มต้นสร้างด้วยโค้ดนี้ (ท้องฟ้าไล่สี ไม่มีลิขสิทธิ์ผู้อื่น)
ผู้ใช้เปลี่ยนรูปได้ในแอป: แอปแทนที่ข้อมูลของ bg.bin ในบล็อกเดิม (ข้อมูลไฟล์ใน LittleFS ไม่มี CRC — มีเฉพาะ metadata)
ตำแหน่งข้อมูลของไฟล์ในบล็อก (firmware/littlefs-bg-map.json) หาโดยสร้างอิมเมจซ้ำด้วยข้อมูลรูปแบบเฉพาะ แล้วตรวจว่าแทนที่แล้วได้อิมเมจเดียวกันทุกไบต์
ไฟล์ .py ใน COMPILE ถูกแปลงเป็น .mpy ด้วย mpy-cross v1.24.1 (ตัวเดียวกับเฟิร์มแวร์) — import เร็วขึ้นมากและใช้ RAM น้อยลง
(ไดรเวอร์ 37 KB คอมไพล์บนบอร์ดใช้เวลาเกือบ 0.5 s) · ซอร์สต้นฉบับยังอยู่ใน firmware/fs/
ใช้: pip install littlefs-python==0.19.0 numpy && MPY_CROSS=<micropython>/mpy-cross/build/mpy-cross python3 scripts/make-lfs.py
"""
import json, math, os, struct, subprocess, tempfile
import numpy as np
from littlefs import LittleFS

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'firmware')
BG_SIZE = 240 * 240 * 2


def default_bg() -> bytes:
    y, x = np.mgrid[0:240, 0:240].astype(np.float64)
    t = y / 239.0
    top, bot = np.array([46, 42, 110]), np.array([250, 170, 190])
    img = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    rng = np.random.default_rng(7)
    for _ in range(40):  # ดาว
        cx, cy, r = rng.uniform(20, 220), rng.uniform(15, 120), rng.uniform(0.6, 1.6)
        d = np.hypot(x - cx, y - cy)
        img += (np.clip(1 - d / r, 0, 1) ** 1.5)[..., None] * np.array([255, 250, 230]) * 0.9
    for cx, cy, r, c in [(60, 200, 70, (255, 200, 210)), (190, 215, 80, (255, 220, 200)), (125, 235, 60, (255, 235, 225))]:  # เนินเมฆ
        d = np.hypot(x - cx, y - cy)
        m = np.clip((r - d) / 3, 0, 1)[..., None]
        img = img * (1 - m) + np.array(c)[None, None, :] * m
    d1, d2 = np.hypot(x - 175, y - 62), np.hypot(x - 186, y - 55)  # จันทร์เสี้ยว
    m = (np.clip((22 - d1) / 1.5, 0, 1) * np.clip((d2 - 19) / 1.5, 0, 1))[..., None]
    img = img * (1 - m) + np.array([255, 236, 170])[None, None, :] * m
    # ดิทเธอร์แบบ ordered 4×4 ลดแถบสีของ RGB565
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 - 0.5
    d = bayer[(y.astype(int) % 4), (x.astype(int) % 4)]
    img = img + np.stack([d * 8, d * 4, d * 8], axis=-1)
    img = np.clip(np.round(img), 0, 255).astype(np.uint16)
    v = ((img[..., 0] >> 3) << 11) | ((img[..., 1] >> 2) << 5) | (img[..., 2] >> 3)
    return v.astype('>u2').tobytes()


COMPILE = {'gc9a01py.py', 'vga1_bold_16x32.py', 'vga1_8x16.py', 'lcd_api.py', 'machine_i2c_lcd.py', 'tm1637.py'}
MPY_CROSS = os.environ.get('MPY_CROSS', '/home/claude/fw/micropython/mpy-cross/build/mpy-cross')
TMP = tempfile.mkdtemp()


def content(name: str):
    src = os.path.join(ROOT, 'fs', name)
    if name not in COMPILE:
        return name, open(src, 'rb').read()
    out = os.path.join(TMP, name[:-3] + '.mpy')
    if not os.path.exists(out):
        ver = subprocess.run([MPY_CROSS, '--version'], capture_output=True, text=True).stdout
        assert 'v1.24.1' in ver, ver
        subprocess.run([MPY_CROSS, '-o', out, src], check=True)
    return name[:-3] + '.mpy', open(out, 'rb').read()


def build(bg: bytes):
    fs = LittleFS(block_size=4096, block_count=352, read_size=32, prog_size=256, lookahead_size=32, name_max=32)
    names = sorted(n for n in os.listdir(os.path.join(ROOT, 'fs')) if os.path.isfile(os.path.join(ROOT, 'fs', n)))
    for name in names:
        fname, data = content(name)
        with fs.open(fname, 'wb') as out:
            out.write(data)
    with fs.open('bg.bin', 'wb') as out:
        out.write(bg)
    return bytearray(fs.context.buffer), fs


bg = default_bg()
img, fs = build(bg)
# ข้อมูลรูปแบบเฉพาะ: คำ 4 ไบต์ที่ offset k (k หาร 4 ลงตัว) = k ^ 0xA5A50000 → หา offset ของทุกช่วงในแฟลช
pat = b''.join(struct.pack('<I', k ^ 0xA5A50000) for k in range(0, BG_SIZE, 4))
img2, _ = build(pat)
diff = [i for i in range(len(img)) if img[i] != img2[i]]
segs = []  # [file offset, image offset, length]
i = 0
while i < len(diff):
    a = diff[i]
    # หาว่าเป็นข้อมูลไฟล์ส่วนไหน: อ่านคำที่ขอบ 4 ไบต์ใกล้ที่สุด
    j = i
    while j + 1 < len(diff) and diff[j + 1] == diff[j] + 1:
        j += 1
    b = diff[j] + 1
    segs.append([a, b])
    i = j + 1
# รวมช่วงที่ต่อกันในไฟล์: หา offset ในไฟล์จากคำที่อ่านได้ในอิมเมจรูปแบบเฉพาะ
out_segs = []
for a, b in segs:
    # ขยายเป็นขอบคำของไฟล์: ข้อมูลไฟล์เริ่มที่ตำแหน่งที่ (img2[p..p+4] ^ 0xA5A50000) = offset ที่หาร 4 ลงตัว
    start = None
    for p in range(max(0, a - 3), a + 4):
        k = struct.unpack('<I', bytes(img2[p:p + 4]))[0] ^ 0xA5A50000
        if k % 4 == 0 and k < BG_SIZE and pat[k:k + 4] == bytes(img2[p:p + 4]):
            start = (p, k)
            break
    assert start, (a, b)
    p0, k0 = start
    # ช่วงข้อมูลต่อเนื่องจาก p0 ตราบที่ตรงกับ pat
    n = 0
    while p0 + n < len(img2) and k0 + n < BG_SIZE and img2[p0 + n] == pat[k0 + n]:
        n += 1
    out_segs.append([k0, p0, n])
# รวมรายการซ้ำ เรียงตาม offset ไฟล์ และตรวจว่าครอบคลุมทั้งไฟล์
uniq = sorted({(k, p, n) for k, p, n in out_segs})
merged = []
for k, p, n in uniq:
    if merged and merged[-1][0] + merged[-1][2] >= k + n and merged[-1][1] - merged[-1][0] == p - k:
        continue
    merged.append([k, p, n])
cover = bytearray(BG_SIZE)
for k, p, n in merged:
    cover[k:k + n] = b'\x01' * n
assert all(cover), 'ช่วงข้อมูลไม่ครอบคลุมทั้งไฟล์'
# ตรวจ: แทนที่ข้อมูลในอิมเมจแรกด้วย pat ตามช่วงที่หาได้ → ต้องได้อิมเมจที่สองทุกไบต์
test = bytearray(img)
for k, p, n in merged:
    test[p:p + n] = pat[k:k + n]
assert test == img2, 'แทนที่ข้อมูลแล้วอิมเมจไม่ตรง'
with fs.open('bg.bin', 'rb') as f:
    assert f.read() == bg

out = bytearray()
used = []
for i in range(352):
    blk = img[i * 4096:(i + 1) * 4096]
    if blk != b'\xff' * 4096:
        out += i.to_bytes(4, 'little') + blk
        used.append(i)
with open(os.path.join(ROOT, 'littlefs-blocks.bin'), 'wb') as f:
    f.write(out)
# ตัวอย่างพิกเซลของรูปเริ่มต้น (ตาราง 20 × 20 จุด) — ตัวตรวจแลปเทียบกับภาพบนจอโดยไม่ต้องโหลดอิมเมจทั้งก้อน
samples = []
for gy in range(20):
    for gx in range(20):
        x, y = 6 + gx * 12, 6 + gy * 12
        i = y * 240 + x
        samples.append([i, (bg[i * 2] << 8) | bg[i * 2 + 1]])
with open(os.path.join(ROOT, 'bg-default-samples.json'), 'w') as f:
    json.dump(samples, f)
with open(os.path.join(ROOT, 'littlefs-bg-map.json'), 'w') as f:
    json.dump({'file': 'bg.bin', 'size': BG_SIZE, 'segments': merged}, f)
print('littlefs-blocks.bin', len(out), 'bytes, blocks', len(used), 'files:', fs.listdir('/'), 'bg segments', len(merged))
