// เซนเซอร์ชุด 1 บน Uno (5 V): พิมพ์ทุก 100 ms
// F = เปลวไฟ DO(D12),AO(A0) · R = ฝน D3,A1 · G = MQ-2 D4,A2 · L = ตรวจเส้น D5,A3 · V = SW-420 D6
// S = จำนวนพัลส์ DO ของโมดูลเสียง (D2, attachInterrupt FALLING) · T = TTP223 D8 · H = Hall D10 (INPUT_PULLUP)
// K = สวิตช์รีด D9 (INPUT_PULLUP) · D = สวิตช์เอียง D11 (INPUT_PULLUP) · W = ระดับน้ำ A4 · P = FSR + 10 kΩ A5
volatile unsigned int pulses = 0;
void onSound() { pulses++; }
void setup() {
  Serial.begin(115200);
  const int ins[] = {3, 4, 5, 6, 8, 12};
  for (int p : ins) pinMode(p, INPUT);
  pinMode(9, INPUT_PULLUP);
  pinMode(10, INPUT_PULLUP);
  pinMode(11, INPUT_PULLUP);
  pinMode(2, INPUT);
  attachInterrupt(digitalPinToInterrupt(2), onSound, FALLING);
}
unsigned long last = 0;
void loop() {
  if (millis() - last < 100) return;
  last = millis();
  noInterrupts(); unsigned int s = pulses; pulses = 0; interrupts();
  Serial.print("F "); Serial.print(digitalRead(12)); Serial.print(' '); Serial.print(analogRead(A0));
  Serial.print(" R "); Serial.print(digitalRead(3)); Serial.print(' '); Serial.print(analogRead(A1));
  Serial.print(" G "); Serial.print(digitalRead(4)); Serial.print(' '); Serial.print(analogRead(A2));
  Serial.print(" L "); Serial.print(digitalRead(5)); Serial.print(' '); Serial.print(analogRead(A3));
  Serial.print(" V "); Serial.print(digitalRead(6));
  Serial.print(" S "); Serial.print(s);
  Serial.print(" T "); Serial.print(digitalRead(8));
  Serial.print(" H "); Serial.print(digitalRead(10));
  Serial.print(" K "); Serial.print(digitalRead(9));
  Serial.print(" D "); Serial.print(digitalRead(11));
  Serial.print(" W "); Serial.print(analogRead(A4));
  Serial.print(" P "); Serial.println(analogRead(A5));
}
