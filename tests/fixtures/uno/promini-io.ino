// Pro Mini: millis/Serial/ADC/PWM — คอมไพล์ทั้งรุ่น 5 V/16 MHz (promini-io.hex) และ 3.3 V/8 MHz (promini3-io.hex)
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  analogWrite(9, 64);   // Timer1 prescaler 64: 16 MHz -> 490 Hz · 8 MHz -> 245 Hz
  analogWrite(5, 192);  // Timer0 prescaler 64: 16 MHz -> 977 Hz · 8 MHz -> 488 Hz
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last >= 250) {
    last = millis();
    Serial.print("t=");
    Serial.print(last);
    Serial.print(" A0=");
    Serial.print(analogRead(A0));
    Serial.print(" A7=");
    Serial.println(analogRead(A7));
    digitalWrite(13, !digitalRead(13));
  }
}
