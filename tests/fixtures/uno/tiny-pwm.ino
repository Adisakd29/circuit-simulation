// ATtiny85: PWM ทั้งสามขา — PB0/PB1 = Timer0 (8 MHz/64/256 = 488 Hz), PB4 = Timer1 (8 MHz/4/(OCR1C+1) = 7812.5 Hz)
void setup() {
  analogWrite(0, 64);    // OC0A 25 %
  analogWrite(1, 128);   // OC0B 50 %
  analogWrite(4, 192);   // OC1B 75 %
}

void loop() {}
