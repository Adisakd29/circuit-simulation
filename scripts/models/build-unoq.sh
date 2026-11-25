#!/bin/bash
# สร้าง src/assets/models/unoq.glb ใหม่จากไฟล์ CAD ของ Arduino (ดาวน์โหลดจาก docs.arduino.cc — CC BY-SA 4.0)
# ต้องมี: node 22+, python3 + Pillow + numpy + playwright (chromium)
set -euo pipefail
cd "$(dirname "$0")"
export CAD_DIR="$PWD/.cad/unoq"; mkdir -p "$CAD_DIR"/{svg,ras,out}
[ -d node_modules ] || npm install --no-audit --no-fund
if [ ! -f "$CAD_DIR/UNO Q simplified.stp" ]; then
  curl -sL -o "$CAD_DIR/step.zip" https://docs.arduino.cc/resources/models/ABX00162-step.zip
  curl -sL -o "$CAD_DIR/cad.zip" https://docs.arduino.cc/static/757d9262f8a7b1c02a77636ec1906780/ABX00162-cad-files.zip
  (cd "$CAD_DIR" && unzip -oq step.zip && unzip -oq cad.zip -x '__MACOSX/*')
fi
node gerb.cjs "$CAD_DIR/ABX00162-cad-files" "$CAD_DIR/svg"
python3 raster.py "$CAD_DIR/svg" "$CAD_DIR/ras" 53.34 68.58 2048 top,smt,bot,smb,pmt,pmb
node step-outline.cjs "$CAD_DIR/UNO Q simplified.stp" "$CAD_DIR/outline.json"
python3 parts.py "$CAD_DIR"/ABX00162-cad-files/*.ipc "$CAD_DIR/parts.json"
python3 unoq_tex.py
python3 unoq_atlas.py
node build-unoq.mjs "$CAD_DIR/out/unoq.glb"
cp "$CAD_DIR/out/unoq.opt.glb" ../../src/assets/models/unoq.glb
echo "→ src/assets/models/unoq.glb"
