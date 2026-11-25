#!/bin/sh
# build QEMU (lcgamboa/qemu สาขา picsimlab-esp32, GPL-2.0) เป็น libqemu-xtensa.so + esp32-bridge (GPL-2.0-or-later)
# ใช้: sh server/esp32/build-qemu.sh <โฟลเดอร์ทำงาน> <โฟลเดอร์ผลลัพธ์>
# ต้องมี: git, gcc, ninja, python3-venv, pkg-config, libglib2.0-dev, libpixman-1-dev, libgcrypt20-dev, libslirp-dev, flex, bison
set -eu
WORK="$1"; OUT="$2"
QEMU_COMMIT=fac9a4689ba3e0aff149e2788dfdcba7ef6c7d3d
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$WORK" "$OUT"
cd "$WORK"
[ -d qemu-src ] || { git clone --filter=blob:none -b picsimlab-esp32 https://github.com/lcgamboa/qemu.git qemu-src; git -C qemu-src checkout -q "$QEMU_COMMIT"; }
cd qemu-src
flags="$(./configure --help | perl -ne 'print if s/^  ([a-z][\w-]*) .*/\1/' | tail -n +2 | awk '{print "--disable-"$1}' ORS=' ')"
./configure --target-list=xtensa-softmmu --extra-cflags=-fPIC $flags --enable-tcg --enable-system --disable-werror --enable-gcrypt --enable-slirp
cd build && ninja qemu-system-xtensa
# ลิงก์ใหม่เป็นไลบรารีแบบแชร์ (ไม่เอา main ของ QEMU) ให้ esp32-bridge โหลดด้วย dlopen
cmd=$(ninja -t commands qemu-system-xtensa | tail -1 | sed -E 's# -o qemu-system-xtensa # -shared -o libqemu-xtensa.so #; s# [^ ]*system_main\.c\.o##')
sh -c "$cmd"
cp libqemu-xtensa.so "$OUT/"
mkdir -p "$OUT/pc-bios"
cp ../pc-bios/esp32-v3-rom.bin ../pc-bios/esp32-v3-rom-app.bin "$OUT/pc-bios/"
gcc -O2 -Wall -o "$OUT/esp32-bridge" "$HERE/bridge.c" -ldl
echo "$QEMU_COMMIT" > "$OUT/QEMU_COMMIT"
