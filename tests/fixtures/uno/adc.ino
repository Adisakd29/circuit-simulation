// อ่าน A0 ทุก 100 ms พิมพ์ค่า · ส่งข้อความกลับ (echo) ทาง Serial · ปุ่มที่ D2 (INPUT_PULLUP) คุม LED D13
void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}
unsigned long last = 0;
void loop() {
  digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW);
  if (millis() - last >= 100) {
    last = millis();
    Serial.print("A0=");
    Serial.println(analogRead(A0));
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') Serial.println("<ok>"); else Serial.write(c);
  }
}
