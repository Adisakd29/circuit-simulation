// Board and hardware specific configuration
#define MICROPY_HW_BOARD_NAME                   "Raspberry Pi Pico (Circuit Lab 3D emulator)"
#define MICROPY_HW_FLASH_STORAGE_BYTES          (1408 * 1024)

// Circuit Lab 3D: REPL ทาง UART0 (GP0/GP1) เพื่อเชื่อมกับ emulator, ปิด USB
#define MICROPY_HW_ENABLE_UART_REPL             (1)
#define MICROPY_HW_ENABLE_USBDEV                (0)
