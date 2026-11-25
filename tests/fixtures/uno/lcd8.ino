// จอ LCD แบบขนาน โหมด 8 บิต (RS 12, RW 10, E 11, D0–D7 = 2–9) + ตัวอักษรเอง (CGRAM) + เลื่อนจอ
#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9);
byte heart[8] = { 0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000 };

void setup() {
  lcd.createChar(0, heart);
  lcd.begin(16, 2);
  lcd.print("8-bit ");
  lcd.write(byte(0));
  lcd.setCursor(3, 1);
  lcd.print("ABC");
  lcd.cursor();
}

void loop() {}
