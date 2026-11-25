// INT0 (D2, FALLING) นับการกดปุ่ม · PCINT20 (D4, ทุกขอบ) นับการเปลี่ยนระดับ · LED D13 สลับทุกครั้งที่ INT0 ทำงาน
volatile unsigned int presses = 0;
volatile unsigned int changes = 0;
void onPress() { presses++; digitalWrite(13, !digitalRead(13)); }
ISR(PCINT2_vect) { changes++; }
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  pinMode(4, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onPress, FALLING);
  PCICR |= _BV(PCIE2);
  PCMSK2 |= _BV(PCINT20);
  Serial.println("ready");
}
void loop() {
  static unsigned int last = 0xFFFF, lastC = 0xFFFF;
  noInterrupts(); unsigned int p = presses, c = changes; interrupts();
  if (p != last || c != lastC) { Serial.print("INT0="); Serial.print(p); Serial.print(" PCINT="); Serial.println(c); last = p; lastC = c; }
}
