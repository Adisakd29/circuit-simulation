// ATtiny85: อ่าน A1 (PB2) และ A3 (PB3) แล้วส่งค่าทาง SoftwareSerial (TX = PB4) 9600 baud ทุก 200 ms
#include <SoftwareSerial.h>
SoftwareSerial ss(0, 4);   // RX = PB0 (ไม่ใช้), TX = PB4

void setup() {
  ss.begin(9600);
}

void loop() {
  ss.print("A1=");
  ss.print(analogRead(A1));
  ss.print(" A3=");
  ss.println(analogRead(A3));
  delay(200);
}
