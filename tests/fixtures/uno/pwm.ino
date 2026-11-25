// PWM ที่ขา 9 = 64/255 และ LED ที่ขา 13 ติดค้าง
void setup() {
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
  analogWrite(9, 64);
}
void loop() {}
