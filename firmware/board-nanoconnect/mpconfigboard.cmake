# cmake file for Arduino Nano RP2040 Connect (Circuit Lab 3D emulator)
# ดัดแปลงจาก MicroPython v1.24.1 ports/rp2/boards/ARDUINO_NANO_RP2040_CONNECT — ปิด NINA-W102 (Wi-Fi/Bluetooth) เพราะตัวจำลองไม่มีโมดูลนี้
set(PICO_BOARD "arduino_nano_rp2040_connect")
set(PICO_PLATFORM "rp2040")
set(MICROPY_FROZEN_MANIFEST ${MICROPY_BOARD_DIR}/manifest.py)
