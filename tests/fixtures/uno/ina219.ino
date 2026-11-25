// Uno + INA219 (A4 = SDA, A5 = SCL): สแกนบัส แล้วอ่านแรงดัน/กระแสทุก 200 ms
#include <Wire.h>
const uint8_t INA = 0x40;

void wr(uint8_t reg, uint16_t v) {
  Wire.beginTransmission(INA);
  Wire.write(reg); Wire.write(v >> 8); Wire.write(v & 0xFF);
  Wire.endTransmission();
}

int16_t rd(uint8_t reg) {
  Wire.beginTransmission(INA);
  Wire.write(reg);
  Wire.endTransmission();
  Wire.requestFrom(INA, (uint8_t)2);
  uint16_t hi = Wire.read(), lo = Wire.read();
  return (int16_t)((hi << 8) | lo);
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.print("I2C:");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.print(" 0x"); Serial.print(a, HEX); }
  }
  Serial.println();
  wr(0x05, 4096);
}

void loop() {
  long mv = (long)(rd(0x02) >> 3) * 4;
  int ma10 = rd(0x04);           // 0.1 mA ต่อบิต
  Serial.print("V="); Serial.print(mv); Serial.print(" mV I="); Serial.print(ma10 / 10); Serial.print('.'); Serial.print(abs(ma10 % 10)); Serial.println(" mA");
  delay(200);
}
