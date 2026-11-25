// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * esp32-bridge — โปรแกรมแยก (separate process) ที่โหลด libqemu-xtensa.so (QEMU สาขา picsimlab-esp32 ของ lcgamboa, GPL-2.0)
 * แล้วให้ Circuit Lab 3D ควบคุมผ่านท่อแบบ synchronous — โปรแกรมนี้เผยแพร่ภายใต้ GPL-2.0-or-later และไม่ได้ลิงก์กับโค้ดของแอป
 *
 * ใช้: esp32-bridge <libqemu-xtensa.so> <ctl-in fifo> <ctl-out fifo> <อาร์กิวเมนต์ของ QEMU ...>
 *
 * โปรโตคอล (บรรทัดข้อความ) — เวลาเป็น ns ของนาฬิกาเสมือน (QEMU_CLOCK_VIRTUAL, ใช้ -icount ให้กำหนดได้แน่นอน)
 *  จากแอป → bridge (อ่านเมื่อ CPU หยุดเท่านั้น):
 *    R <targetNs> <stopOnPin 0|1>   เดินต่อจนถึง targetNs หรือจนขาออกเปลี่ยน (ถ้า stopOnPin)
 *    P <gpio> <0|1>                 ระดับขาเข้า
 *    A <index> <raw 0–4095>         ค่า ADC (index 0–7 = ADC1_CH0–7, 8+n = ADC2_CHn)
 *    U <hex bytes>                  ไบต์เข้า UART0 (RX)
 *    L                              ขอสถานะ LEDC (PWM) และ GPIO matrix
 *    Q                              จบโปรแกรม
 *  bridge → แอป:
 *    G <gpio> <level> <tNs>         ขาออกเปลี่ยนระดับ
 *    D <gpio> <dir> <tNs>           ทิศทางขา (1 = ขาออก)
 *    T <uart> <byte> <tNs>          ไบต์ที่ UART ส่งออก
 *    I <bus> <addr> <event> <tNs>   ธุรกรรม I²C — รอคำตอบ "i <value>" ก่อน CPU ทำงานต่อ (ระหว่างรอรับคำสั่ง L ได้)
 *    O <text>                       ข้อมูลที่ขอด้วย L
 *    S <tNs> <t|p> <pu> <pd>        CPU หยุด (t = ถึงเวลาเป้าหมาย, p = ขาออกเปลี่ยน) + บิตแมสก์ (hex) ของ GPIO ที่เปิดตัวต้านทาน
 *                                   ดึงขึ้น/ดึงลงภายใน (บิต FUN_WPU = 8 / FUN_WPD = 7 ของรีจิสเตอร์ IO_MUX ของแต่ละขา) — หลังนี้รอคำสั่ง
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>

typedef struct {
  void (*write_pin)(int, int);
  void (*dir_pin)(int, int);
  int (*i2c)(const uint8_t, const uint8_t, const uint16_t);
  uint8_t (*spi)(const uint8_t, const uint16_t);
  void (*uart_tx)(const uint8_t, const uint8_t);
  const short *pinmap;
  void (*rmt)(const uint8_t, const uint32_t, const uint32_t);
} cb_t;

static int64_t (*clk)(int);
static void (*set_pin)(int, int);
static void (*set_apin)(int, int);
static void (*uart_rx)(const int, const uint8_t *, int);
static uint32_t *(*internals)(int);
static void (*timer_init_full)(void *, void *, int, int, int, void (*)(void *), void *);
static void (*timer_mod)(void *, int64_t);

/* ขา: ช่องที่ n (1–40) = GPIO n−1 · GPIO6–11 ต่อกับแฟลชภายใน (ไม่ออกขา) */
static short pinmap[41];
static FILE *cin, *cout;
static int64_t target = 0;
static int stop_on_pin = 0;
static char ctl_timer[256] __attribute__((aligned(16)));
#define VT() clk(1)

static void do_stop(char why);

static void wp(int slot, int v) {
  if (slot < 1 || slot > 40) return;
  int64_t t = VT();
  fprintf(cout, "G %d %d %lld\n", pinmap[slot], v, (long long)t);
  if (stop_on_pin && t < target) do_stop('p');
}
static void dp(int slot, int d) {
  if (slot < 1 || slot > 40) return;
  fprintf(cout, "D %d %d %lld\n", pinmap[slot], d, (long long)VT());
}
static void dump_regs(void);
static int i2c(const uint8_t bus, const uint8_t addr, const uint16_t ev) {
  fprintf(cout, "I %d %d %d %lld\n", bus, addr, ev, (long long)VT());
  fflush(cout);
  char line[256];
  for (;;) {
    if (!fgets(line, sizeof line, cin)) exit(0);
    if (line[0] == 'i') return atoi(line + 2);
    if (line[0] == 'L') dump_regs(); /* แอปขอดูว่าขาไหนต่อสัญญาณ I²C ก่อนตอบ */
    else if (line[0] == 'Q') exit(0);
  }
}
static uint8_t spi(const uint8_t id, const uint16_t ev) { (void)id; (void)ev; return 0xff; }
static void utx(const uint8_t id, const uint8_t b) { fprintf(cout, "T %d %d %lld\n", id, b, (long long)VT()); }
static void rmt(const uint8_t c, const uint32_t a, const uint32_t b) { (void)c; (void)a; (void)b; }

static int hexv(int c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }

/* CPU หยุด: แจ้งเหตุ แล้วรับคำสั่งจนได้ R */
static void do_stop(char why) {
  uint32_t *mux = internals(3);
  uint64_t pu = 0, pd = 0;
  for (int g = 0; g < 40; g++) { if (mux[g] & (1u << 8)) pu |= 1ull << g; if (mux[g] & (1u << 7)) pd |= 1ull << g; }
  fprintf(cout, "S %lld %c %llx %llx\n", (long long)VT(), why, (unsigned long long)pu, (unsigned long long)pd);
  fflush(cout);
  char line[8192];
  for (;;) {
    if (!fgets(line, sizeof line, cin)) exit(0);
    if (line[0] == 'R') {
      long long tg; int s;
      if (sscanf(line + 2, "%lld %d", &tg, &s) == 2) { target = tg; stop_on_pin = s; timer_mod(ctl_timer, target); }
      return;
    } else if (line[0] == 'P') {
      int g, v;
      if (sscanf(line + 2, "%d %d", &g, &v) == 2 && g >= 0 && g < 40 && pinmap[g + 1] >= 0) set_pin(g + 1, v);
    } else if (line[0] == 'A') {
      int ch, v;
      if (sscanf(line + 2, "%d %d", &ch, &v) == 2 && ch >= 0 && ch < 18) set_apin(ch, v);
    } else if (line[0] == 'U') {
      uint8_t buf[4096]; int n = 0;
      for (char *p = line + 2; p[0] && p[1] && p[0] != '\n' && n < (int)sizeof buf; p += 2) buf[n++] = (uint8_t)(hexv(p[0]) << 4 | hexv(p[1]));
      if (n) uart_rx(0, buf, n);
    } else if (line[0] == 'L') {
      dump_regs();
    } else if (line[0] == 'Q') {
      exit(0);
    }
  }
}
static void dump_regs(void) {
  float *duty = (float *)internals(6); uint32_t *freq = internals(5), *conf = internals(4), *osel = internals(2);
  fprintf(cout, "O ledc");
  for (int c = 0; c < 16; c++) fprintf(cout, " %u:%.4f", conf[c], duty[c]);
  fprintf(cout, " freq");
  for (int t = 0; t < 8; t++) fprintf(cout, " %u", freq[t]);
  fprintf(cout, " osel");
  for (int g = 0; g < 40; g++) fprintf(cout, " %u", osel[g] & 0x1ff);
  fprintf(cout, "\n");
  fflush(cout);
}
static void on_timer(void *opaque) { (void)opaque; do_stop('t'); }

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: esp32-bridge <libqemu.so> <ctl-in> <ctl-out> <qemu args...>\n"); return 2; }
  cin = fopen(argv[2], "r");
  cout = fopen(argv[3], "w");
  if (!cin || !cout) { perror("fifo"); return 2; }
  setvbuf(cout, NULL, _IOFBF, 1 << 16);
  void *h = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!h) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }
  void (*reg)(void *) = dlsym(h, "qemu_picsimlab_register_callbacks");
  void (*qinit)(int, char **) = dlsym(h, "qemu_init");
  int (*qloop)(void) = dlsym(h, "qemu_main_loop");
  clk = dlsym(h, "qemu_clock_get_ns");
  set_pin = dlsym(h, "qemu_picsimlab_set_pin");
  set_apin = dlsym(h, "qemu_picsimlab_set_apin");
  uart_rx = dlsym(h, "qemu_picsimlab_uart_receive");
  internals = dlsym(h, "qemu_picsimlab_get_internals");
  timer_init_full = dlsym(h, "timer_init_full");
  timer_mod = dlsym(h, "timer_mod");
  if (!reg || !qinit || !qloop || !clk || !set_pin || !set_apin || !uart_rx || !internals || !timer_init_full || !timer_mod) { fprintf(stderr, "missing symbol\n"); return 1; }
  pinmap[0] = 40;
  for (int i = 1; i <= 40; i++) pinmap[i] = (i - 1 >= 6 && i - 1 <= 11) ? -1 : i - 1;
  static cb_t cb;
  cb.write_pin = wp; cb.dir_pin = dp; cb.i2c = i2c; cb.spi = spi; cb.uart_tx = utx; cb.pinmap = pinmap; cb.rmt = rmt;
  reg(&cb);
  /* argv[4..] → อาร์กิวเมนต์ของ QEMU (argv[0] ของ QEMU = ชื่อโปรแกรม) */
  int qargc = argc - 3;
  char **qargv = calloc(qargc + 1, sizeof(char *));
  qargv[0] = argv[0];
  for (int i = 4; i < argc; i++) qargv[i - 3] = argv[i];
  qinit(qargc, qargv);
  timer_init_full(ctl_timer, NULL, 1 /* QEMU_CLOCK_VIRTUAL */, 1 /* SCALE_NS */, 0, on_timer, NULL);
  timer_mod(ctl_timer, 0);
  return qloop();
}
