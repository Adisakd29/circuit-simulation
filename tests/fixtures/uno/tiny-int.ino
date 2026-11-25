// ATtiny85: INT0 (PB2, FALLING) นับการกด → LED ที่ PB0 สลับทุกครั้ง · ส่งจำนวนทาง SoftwareSerial (TX = PB3)
#include <SoftwareSerial.h>
SoftwareSerial ss(1, 3);   // RX = PB1 (ไม่ใช้), TX = PB3
volatile unsigned int presses = 0;
void onPress() { presses++; digitalWrite(0, !digitalRead(0)); }

void setup() {
  pinMode(0, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(0, onPress, FALLING);
  ss.begin(9600);
  ss.println("ready");
}

void loop() {
  static unsigned int last = 0xFFFF;
  noInterrupts(); unsigned int p = presses; interrupts();
  if (p != last) { ss.print("INT0="); ss.println(p); last = p; }
}
