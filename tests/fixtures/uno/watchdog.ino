#include <avr/wdt.h>
// watchdog 250 ms: เลี้ยงไว้ 1 วินาที แล้วหยุดเลี้ยง → บอร์ดรีเซ็ตเอง
void setup() {
  byte cause = MCUSR;
  MCUSR = 0;
  wdt_disable();
  Serial.begin(9600);
  Serial.print("start t=");
  Serial.println(cause);
  wdt_enable(WDTO_250MS);
}
void loop() {
  if (millis() < 1000) wdt_reset();
  delay(50);
}
