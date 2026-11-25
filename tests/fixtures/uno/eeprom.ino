#include <EEPROM.h>
// นับจำนวนครั้งที่บอร์ดเริ่มทำงาน เก็บใน EEPROM ที่อยู่ 0
void setup() {
  Serial.begin(9600);
  byte n = EEPROM.read(0);
  if (n == 255) n = 0;
  n++;
  EEPROM.update(0, n);
  Serial.print("boot ");
  Serial.println(n);
}
void loop() {}
