# ดัดแปลงจาก MicroPython v1.24.1 ports/rp2/boards/ARDUINO_NANO_RP2040_CONNECT/manifest.py
# คงไดรเวอร์ IMU (lsm6dsox) และ time/logging · ตัด bundle-networking, espflash, senml, aioble (ต้องใช้ NINA-W102 ที่ไม่ได้จำลอง)
include("$(PORT_DIR)/boards/manifest.py")
require("lsm6dsox")
require("time")
require("logging")
