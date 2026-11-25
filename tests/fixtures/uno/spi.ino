#include <SPI.h>
// SPI master: ส่ง 0xA5 แล้วพิมพ์ไบต์ที่อ่านได้จาก MISO (D12)
void setup() {
  Serial.begin(9600);
  pinMode(10, OUTPUT);
  SPI.begin();
}
void loop() {
  digitalWrite(10, LOW);
  byte r = SPI.transfer(0xA5);
  digitalWrite(10, HIGH);
  Serial.print("rx=0x");
  Serial.println(r, HEX);
  delay(200);
}
