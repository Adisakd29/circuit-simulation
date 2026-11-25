// ATtiny85: นับการบูตใน EEPROM ที่อยู่ 0 · watchdog 250 ms เลี้ยงไว้ 1 วินาทีแล้วหยุด → รีเซ็ตเอง · ข้อความทาง SoftwareSerial (TX = PB3)
#include <EEPROM.h>
#include <SoftwareSerial.h>
#include <avr/wdt.h>
SoftwareSerial ss(1, 3);

void setup() {
  MCUSR = 0;
  wdt_disable();
  ss.begin(9600);
  byte n = EEPROM.read(0);
  if (n == 255) n = 0;
  n++;
  EEPROM.update(0, n);
  ss.print("boot ");
  ss.println(n);
  wdt_enable(WDTO_250MS);
}

void loop() {
  if (millis() < 1000) wdt_reset();
  delay(50);
}
