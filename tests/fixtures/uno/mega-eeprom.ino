#include <EEPROM.h>
// Mega 2560 EEPROM 4 KB: นับจำนวนครั้งที่เริ่มทำงานที่ที่อยู่ 4000 (เกิน 1 KB ของ Uno) · พิมพ์ EEPROM.length()
void setup() {
  Serial.begin(9600);
  byte n = EEPROM.read(4000);
  if (n == 255) n = 0;
  n++;
  EEPROM.update(4000, n);
  Serial.print("len "); Serial.print(EEPROM.length());
  Serial.print(" boot "); Serial.println(n);
}
void loop() {}
