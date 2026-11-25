// CPU-bound: นับเลขต่อเนื่อง พิมพ์ทุก 1,000,000 รอบ
void setup() { Serial.begin(115200); Serial.println("boot"); }
volatile uint32_t x = 0;
void loop() {
  for (uint32_t i = 0; i < 1000000; i++) x += i;
  Serial.printf("t=%lu x=%lu\n", (unsigned long)micros(), (unsigned long)x);
}
