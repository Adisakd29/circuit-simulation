#include <SPI.h>
// Mega 2560 SPI master: ส่ง 0xA5 แล้วพิมพ์ไบต์ที่อ่านได้จาก MISO (D50)
void setup() {
  Serial.begin(9600);
  pinMode(53, OUTPUT);
  SPI.begin();
}
void loop() {
  digitalWrite(53, LOW);
  byte r = SPI.transfer(0xA5);
  digitalWrite(53, HIGH);
  Serial.print("rx=0x");
  Serial.println(r, HEX);
  delay(200);
}
