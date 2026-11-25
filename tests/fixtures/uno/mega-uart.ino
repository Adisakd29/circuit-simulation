// Mega 2560: Serial1 (D18 TX), Serial2 (D16 TX), Serial3 (D14 TX) ส่งคนละข้อความคนละบอดเรต · Serial (USB) พิมพ์สถานะ
void setup() {
  Serial.begin(9600);
  Serial1.begin(9600);
  Serial2.begin(19200);
  Serial3.begin(57600);
  Serial.println("uart ready");
}
void loop() {
  Serial1.print("S1");
  Serial2.print("S2");
  Serial3.print("S3");
  delay(50);
}
