// https://wiki.seeedstudio.com/XIAO-RP2040/
// ยกมาจาก MicroPython v1.28.0 ports/rp2/boards/SEEED_XIAO_RP2040/mpconfigboard.h (MIT) แล้วปรับสำหรับตัวจำลอง
#define MICROPY_HW_BOARD_NAME          "Seeed Studio XIAO RP2040 (Circuit Lab 3D emulator)"
#define MICROPY_HW_FLASH_STORAGE_BYTES (1408 * 1024)

// I2C0 (ค่าเดียวกับต้นฉบับ — GPIO6/7 เป็นขาของ I2C1 ในฮาร์ดแวร์ RP2040 จึงต้องสร้างด้วย I2C(1, ...) ตามตัวอย่างของ Seeed)
#define MICROPY_HW_I2C0_SCL  (7)
#define MICROPY_HW_I2C0_SDA  (6)

// SPI0
#define MICROPY_HW_SPI0_SCK  (2)
#define MICROPY_HW_SPI0_MOSI (3)
#define MICROPY_HW_SPI0_MISO (4)

// Circuit Lab 3D: REPL ทาง UART0 (GPIO0/1 = D6/D7) เพื่อเชื่อมกับ emulator, ปิด USB
#define MICROPY_HW_ENABLE_UART_REPL             (1)
#define MICROPY_HW_ENABLE_USBDEV                (0)
