# ESP32 prototype (evaluation only — not part of the app)

These are the scripts behind the measurements in `docs/ESP32-EVAL.md`. **None of this ships in the app or on the Railway server.**

| File | Purpose |
|---|---|
| `build.sh` | Builds `qemu-system-xtensa` from [lcgamboa/qemu, branch `picsimlab-esp32`](https://github.com/lcgamboa/qemu/tree/picsimlab-esp32). Only TCG, system, gcrypt and slirp are enabled. Build time is about 4.5 minutes on 2 CPUs. After building, `libqemu-xtensa.so` is linked from the final ninja command with `-shared` and without `system_main.c.o`. |
| `harness.c` | Loads `libqemu-xtensa.so` with `dlopen` and registers the callbacks for pins, I²C and UART. It logs events with QEMU virtual time, loops GPIO2 back to GPIO15, injects ADC on GPIO34, answers I²C as a fake device at address 0x40, and reads LEDC registers through `qemu_picsimlab_get_internals`. |
| `runq.py` | Runs `qemu-system-xtensa` directly and measures wall time, CPU, RSS and loop period across `-icount shift` values. |
| `sketches/*.ino` | Test sketches. Compile them with `arduino-cli compile -b esp32:esp32:esp32:FlashSize=4M,FlashMode=dio --export-binaries`. Use DIO, because QIO does not boot in QEMU. Copy `*.merged.bin` to `flash.bin`. |
| `harness-i2c.log` | Real log from running the `i2c` sketch: I²C transactions, LEDC duty 25.098% at 1000 Hz, and `gpio_out_sel[4]=71`. |

Build the harness with `gcc -O1 harness.c -o harness -ldl -lpthread`, then run it:

```
./harness -M esp32-picsimlab -nographic -L qemu-src/pc-bios \
  -drive file=flash.bin,if=mtd,format=raw -serial null -monitor none -icount shift=2,sleep=off
```

**License:** QEMU and the lcgamboa fork are GPL-2.0. A program that links `libqemu` into one process must be distributed under GPL-compatible terms. If this is ever deployed for real, the emulator must run as a separate process with its own source published, so it stays separate from the app's code. The ROM files in `pc-bios/esp32*-rom*.bin` come from Espressif, and we have not yet found their license terms (see `docs/ESP32-EVAL.md` §5).
