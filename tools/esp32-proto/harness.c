// ตัวทดลอง: โหลด libqemu-xtensa.so (lcgamboa picsimlab-esp32) รับเหตุการณ์ขา + เวลาเสมือน
#include <dlfcn.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>
typedef struct { void (*write_pin)(int,int); void (*dir_pin)(int,int); int (*i2c)(const uint8_t,const uint8_t,const uint16_t); uint8_t (*spi)(const uint8_t,const uint16_t);
  void (*uart_tx)(const uint8_t,const uint8_t); const short *pinmap; void (*rmt)(const uint8_t,const uint32_t,const uint32_t); } cb_t;
static int64_t (*clk)(int);
static void (*set_pin)(int,int);
static void (*set_apin)(int,int);
static uint32_t *(*internals)(int);
static short pinmap[41];
static long nev[41];
static int64_t last[41];
static FILE *log;
static void wp(int slot, int v) {
  int g = pinmap[slot]; int64_t t = clk(1);
  nev[g]++;
  if (nev[g] <= 12 || g == 2) fprintf(log, "pin GPIO%d=%d t=%.6f ms\n", g, v, t / 1e6);
  if (g == 2) set_pin(16, v);   // loopback GPIO2 -> GPIO15 (slot 16) ทันทีในเธรด CPU
  last[g] = t;
}
static void dp(int slot, int d) { if (slot >= 0 && slot <= 40) fprintf(log, "dir GPIO%d=%d t=%.6f ms\n", pinmap[slot], d, clk(1) / 1e6); }
static int i2c(const uint8_t id, const uint8_t a, const uint16_t e) {
  static int nread = 0; int code = e & 0xff; int ret = 0;
  if (code <= 2) { nread = 0; ret = (a == 0x40) ? 0 : 1; if (a == 0x40 || a == 0x41) fprintf(log, "i2c%d START%s addr=0x%02X ack=%d t=%.3f ms\n", id, code == 0 ? "R" : "W", a, ret == 0, clk(1) / 1e6); }
  else if (code == 3) { if (a == 0x40) fprintf(log, "i2c%d STOP\n", id); }
  else if (code == 5) { if (a == 0x40) fprintf(log, "i2c%d WRITE 0x%02X\n", id, e >> 8); ret = a == 0x40 ? 0 : 1; }
  else if (code == 6) { ret = nread++ == 0 ? 0x12 : 0x34; if (a == 0x40) fprintf(log, "i2c%d READ -> 0x%02X\n", id, ret); }
  return ret;
}
static uint8_t spi(const uint8_t id, const uint16_t e) { return 0; }
static void utx(const uint8_t id, const uint8_t v) { static char line[256]; static int n; if (v == '\n' || n > 250) { line[n] = 0; fprintf(log, "uart%d t=%.3f ms: %s\n", id, clk(1) / 1e6, line); n = 0; } else if (v != '\r') line[n++] = v; }
static void rmt(const uint8_t c, const uint32_t a, const uint32_t b) {}
static void *poll(void *x) {
  sleep(10);
  float *duty = (float *)internals(6); uint32_t *freq = internals(5); uint32_t *conf = internals(4); uint32_t *osel = internals(2);
  for (int c = 0; c < 16; c++) if (duty[c] > 0 || conf[c]) fprintf(log, "ledc ch%d conf=0x%x duty=%.3f%%\n", c, conf[c], duty[c]);
  for (int t = 0; t < 8; t++) if (freq[t]) fprintf(log, "ledc timer%d freq=%u\n", t, freq[t]);
  fprintf(log, "gpio_out_sel[4]=%u t=%.3f ms\n", osel[4] & 0x1ff, clk(1) / 1e6);
  return 0;
}
int main(int argc, char **argv) {
  log = fopen("harness.log", "w"); setvbuf(log, NULL, _IOLBF, 0);
  void *h = dlopen("./qemu-src/build/libqemu-xtensa.so", RTLD_NOW | RTLD_GLOBAL);
  if (!h) { printf("dlopen: %s\n", dlerror()); return 1; }
  void (*reg)(void *) = dlsym(h, "qemu_picsimlab_register_callbacks");
  void (*qinit)(int, char **) = dlsym(h, "qemu_init");
  int (*qloop)(void) = dlsym(h, "qemu_main_loop");
  clk = dlsym(h, "qemu_clock_get_ns"); set_pin = dlsym(h, "qemu_picsimlab_set_pin"); set_apin = dlsym(h, "qemu_picsimlab_set_apin"); internals = dlsym(h, "qemu_picsimlab_get_internals");
  pinmap[0] = 40; for (int i = 1; i <= 40; i++) pinmap[i] = (i - 1 >= 6 && i - 1 <= 11) ? -1 : i - 1; // ขาแฟลช 6–11 ไม่ต่อ
  static cb_t cb; cb.write_pin = wp; cb.dir_pin = dp; cb.i2c = i2c; cb.spi = spi; cb.uart_tx = utx; cb.pinmap = pinmap; cb.rmt = rmt;
  reg(&cb);
  qinit(argc, argv);
  set_apin(6, 2048); // ADC1 ช่อง 6 = GPIO34
  pthread_t th; pthread_create(&th, 0, poll, 0);
  qloop();
  return 0;
}
