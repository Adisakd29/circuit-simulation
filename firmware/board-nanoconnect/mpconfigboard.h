// Board config for Arduino Nano RP2040 Connect — Circuit Lab 3D emulator
// ดัดแปลงจาก MicroPython v1.24.1 ports/rp2/boards/ARDUINO_NANO_RP2040_CONNECT/mpconfigboard.h (MIT):
//  - ไม่เปิด network/Bluetooth/NINA-W10 และขาภายนอกผ่าน NINA (EXT_GPIO: LED RGB, A4–A7 แบบแอนะล็อก) — ตัวจำลองไม่มีโมดูล NINA-W102
//  - REPL ทาง UART0 (GPIO0/1 = TX/RX) ปิด USB · ระบบไฟล์ 1408 KB ที่ offset 0xA0000 (ใช้อิมเมจ LittleFS เดียวกับ Pico; บอร์ดจริงใช้ 14 MB)
#define MICROPY_HW_BOARD_NAME           "Arduino Nano RP2040 Connect (Circuit Lab 3D emulator, no NINA-W102)"
#define MICROPY_HW_FLASH_STORAGE_BYTES  (1408 * 1024)
#define MICROPY_HW_FLASH_STORAGE_BASE   (0xA0000)

// UART 1 config (ค่าเดียวกับต้นฉบับ).
#define MICROPY_HW_UART1_TX             (8)
#define MICROPY_HW_UART1_RX             (9)
#define MICROPY_HW_UART1_CTS            (10)
#define MICROPY_HW_UART1_RTS            (11)

// SPI 1 config (non-default, ค่าเดียวกับต้นฉบับ).
#define MICROPY_HW_SPI1_SCK             (14)
#define MICROPY_HW_SPI1_MOSI            (11)
#define MICROPY_HW_SPI1_MISO            (8)

// I2C1 config (non-default, ค่าเดียวกับต้นฉบับ).
#define MICROPY_HW_I2C1_SCL             (27)
#define MICROPY_HW_I2C1_SDA             (26)

// Circuit Lab 3D: REPL ทาง UART0 เพื่อเชื่อมกับ emulator, ปิด USB
#define MICROPY_HW_ENABLE_UART_REPL     (1)
#define MICROPY_HW_ENABLE_USBDEV        (0)
