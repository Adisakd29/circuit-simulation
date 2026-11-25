#include <Servo.h>
// เซอร์โว D9 ไปที่ 45° แล้ว 135° · บัซเซอร์ D8 tone 440 Hz
Servo s;
void setup() {
  Serial.begin(9600);
  s.attach(9);
  s.write(45);
  tone(8, 440);
  Serial.println("45");
}
void loop() {
  if (millis() > 1500) { s.write(135); }
  delay(20);
}
