// Mega 2560: INT4 (D2), INT5 (D3), INT3 (D18), INT2 (D19) แบบ FALLING · PCINT16 (A8 = PK0) ทุกขอบ · PCINT9 (D15 = PJ0) ทุกขอบ
volatile unsigned int n2 = 0, n3 = 0, n18 = 0, n19 = 0, pk = 0, pj = 0;
void on2() { n2++; } void on3() { n3++; } void on18() { n18++; } void on19() { n19++; }
ISR(PCINT2_vect) { pk++; }
ISR(PCINT1_vect) { pj++; }
void setup() {
  Serial.begin(9600);
  const int ins[] = {2, 3, 18, 19, 15};
  for (int p : ins) pinMode(p, INPUT_PULLUP);
  pinMode(A8, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), on2, FALLING);
  attachInterrupt(digitalPinToInterrupt(3), on3, FALLING);
  attachInterrupt(digitalPinToInterrupt(18), on18, FALLING);
  attachInterrupt(digitalPinToInterrupt(19), on19, FALLING);
  PCICR |= _BV(PCIE2) | _BV(PCIE1);
  PCMSK2 |= _BV(PCINT16);
  PCMSK1 |= _BV(PCINT9);
  Serial.println("ready");
}
void loop() {
  static unsigned long last = 0;
  if (millis() - last >= 100) {
    last = millis();
    noInterrupts(); unsigned int a = n2, b = n3, c = n18, d = n19, e = pk, f = pj; interrupts();
    Serial.print("I "); Serial.print(a); Serial.print(' '); Serial.print(b); Serial.print(' '); Serial.print(c); Serial.print(' '); Serial.print(d);
    Serial.print(' '); Serial.print(e); Serial.print(' '); Serial.println(f);
  }
}
