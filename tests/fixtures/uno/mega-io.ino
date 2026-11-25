// Mega 2560: PWM ทุก Timer (0–5) · ADC ช่อง 0–15 (MUX5) · Serial echo · GPIO พอร์ต A (D22–D29) และ C (D32–D37) · ขาเข้า D30 (pull-up) คุม D31
void setup() {
  Serial.begin(9600);
  analogWrite(4, 32);    // Timer0 B (PG5)
  analogWrite(11, 64);   // Timer1 A (PB5)
  analogWrite(10, 96);   // Timer2 A (PB4)
  analogWrite(5, 128);   // Timer3 A (PE3)
  analogWrite(8, 160);   // Timer4 C (PH5)
  analogWrite(44, 192);  // Timer5 C (PL5)
  analogWrite(46, 224);  // Timer5 A (PL3)
  for (int p = 22; p <= 29; p++) { pinMode(p, OUTPUT); digitalWrite(p, (p & 1) ? HIGH : LOW); }  // PORTA
  for (int p = 32; p <= 37; p++) { pinMode(p, OUTPUT); digitalWrite(p, (p & 1) ? LOW : HIGH); }  // PORTC
  pinMode(30, INPUT_PULLUP);
  pinMode(31, OUTPUT);
  Serial.println("MEGA READY");
}
unsigned long last = 0;
void loop() {
  digitalWrite(31, digitalRead(30) == LOW ? HIGH : LOW);
  if (millis() - last >= 100) {
    last = millis();
    Serial.print("A0="); Serial.print(analogRead(A0));
    Serial.print(" A8="); Serial.print(analogRead(A8));
    Serial.print(" A15="); Serial.println(analogRead(A15));
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') Serial.println("<ok>"); else Serial.write(c);
  }
}
