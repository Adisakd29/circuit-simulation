#include <Wire.h>
// สแกน I2C (SDA 21, SCL 22) แล้วอ่าน 2 ไบต์จาก 0x40 รีจิสเตอร์ 0x00
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Serial.print("I2C:");
  for (uint8_t a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) Serial.printf(" 0x%02X", a); }
  Serial.println();
  Wire.beginTransmission(0x40); Wire.write(0x00); Wire.endTransmission(false);
  Wire.requestFrom(0x40, 2);
  int hi = Wire.read(), lo = Wire.read();
  Serial.printf("reg0=0x%02X%02X\n", hi, lo);
  ledcAttach(4, 1000, 8); ledcWrite(4, 64);
}
void loop() { delay(1000); }
