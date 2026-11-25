// UNO Q: จอ LCD 16x2 I2C ที่ 0x27 ผ่าน Wire (หัวต่อ SDA/SCL ของ UNO Q)
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("UNO Q I2C");
  Wire.beginTransmission(0x27);
  Serial.println(Wire.endTransmission() == 0 ? "LCD ACK" : "LCD NACK");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  delay(200);
}
