// ESP32 feasibility: GPIO2 toggle every 100 ms, GPIO4 PWM (LEDC 1 kHz, duty 64/256), read GPIO15 and ADC GPIO34
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(15, INPUT_PULLUP);
  ledcAttach(4, 1000, 8);
  ledcWrite(4, 64);
  Serial.println("boot");
}
int n = 0;
void loop() {
  digitalWrite(2, n & 1);
  Serial.printf("t=%lu n=%d in15=%d adc34=%d\n", (unsigned long)micros(), n, digitalRead(15), analogRead(34));
  n++;
  delay(100);
}
