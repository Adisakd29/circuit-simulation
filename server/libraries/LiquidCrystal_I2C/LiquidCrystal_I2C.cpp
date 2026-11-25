// LiquidCrystal_I2C — Circuit Lab 3D implementation (MIT License, see LICENSE)
#include "LiquidCrystal_I2C.h"
#include <Wire.h>

// HD44780 instruction set (Hitachi HD44780U datasheet, Table 6)
#define LCD_CLEAR 0x01
#define LCD_HOME 0x02
#define LCD_ENTRY 0x04
#define LCD_CONTROL 0x08
#define LCD_SHIFT 0x10
#define LCD_FUNCTION 0x20
#define LCD_CGRAM 0x40
#define LCD_DDRAM 0x80
// PCF8574 backpack bits
#define BIT_RS 0x01
#define BIT_E 0x04
#define BIT_BL 0x08

LiquidCrystal_I2C::LiquidCrystal_I2C(uint8_t addr, uint8_t cols, uint8_t rows)
  : _addr(addr), _cols(cols), _rows(rows), _bl(BIT_BL), _func(0), _ctrl(0), _mode(0) {}

void LiquidCrystal_I2C::init() { begin(_cols, _rows); }

void LiquidCrystal_I2C::begin(uint8_t cols, uint8_t rows, uint8_t charsize) {
  if (cols) _cols = cols;
  if (rows) _rows = rows;
  Wire.begin();
  _func = 0x00 | (_rows > 1 ? 0x08 : 0x00) | (charsize && _rows == 1 ? 0x04 : 0x00); // 4-bit, lines, font
  delay(50);                       // > 40 ms after VCC reaches 2.7 V
  expander(_bl);
  delay(1);
  // initialisation by instruction (datasheet Figure 24): 0x3 three times, then 0x2 → 4-bit mode
  write4(0x30); delayMicroseconds(4500);
  write4(0x30); delayMicroseconds(4500);
  write4(0x30); delayMicroseconds(150);
  write4(0x20);
  command(LCD_FUNCTION | _func);
  _ctrl = 0x04;                    // display on, cursor off, blink off
  command(LCD_CONTROL | _ctrl);
  clear();
  _mode = 0x02;                    // increment, no shift
  command(LCD_ENTRY | _mode);
  home();
}

void LiquidCrystal_I2C::clear() { command(LCD_CLEAR); delayMicroseconds(2000); }
void LiquidCrystal_I2C::home() { command(LCD_HOME); delayMicroseconds(2000); }

void LiquidCrystal_I2C::setCursor(uint8_t col, uint8_t row) {
  static const uint8_t base[4] = { 0x00, 0x40, 0x14, 0x54 };
  if (row >= _rows) row = _rows ? _rows - 1 : 0;
  if (row > 3) row = 3;
  command(LCD_DDRAM | (base[row] + col));
}

void LiquidCrystal_I2C::noDisplay() { _ctrl &= ~0x04; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::display() { _ctrl |= 0x04; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::noCursor() { _ctrl &= ~0x02; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::cursor() { _ctrl |= 0x02; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::noBlink() { _ctrl &= ~0x01; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::blink() { _ctrl |= 0x01; command(LCD_CONTROL | _ctrl); }
void LiquidCrystal_I2C::scrollDisplayLeft() { command(LCD_SHIFT | 0x08); }
void LiquidCrystal_I2C::scrollDisplayRight() { command(LCD_SHIFT | 0x08 | 0x04); }
void LiquidCrystal_I2C::leftToRight() { _mode |= 0x02; command(LCD_ENTRY | _mode); }
void LiquidCrystal_I2C::rightToLeft() { _mode &= ~0x02; command(LCD_ENTRY | _mode); }
void LiquidCrystal_I2C::autoscroll() { _mode |= 0x01; command(LCD_ENTRY | _mode); }
void LiquidCrystal_I2C::noAutoscroll() { _mode &= ~0x01; command(LCD_ENTRY | _mode); }

void LiquidCrystal_I2C::createChar(uint8_t location, const uint8_t charmap[]) {
  command(LCD_CGRAM | ((location & 0x07) << 3));
  for (uint8_t i = 0; i < 8; i++) write(charmap[i]);
}

void LiquidCrystal_I2C::noBacklight() { _bl = 0; expander(0); }
void LiquidCrystal_I2C::backlight() { _bl = BIT_BL; expander(0); }
void LiquidCrystal_I2C::setBacklight(uint8_t on) { if (on) backlight(); else noBacklight(); }

void LiquidCrystal_I2C::command(uint8_t value) { send(value, 0); }
size_t LiquidCrystal_I2C::write(uint8_t value) { send(value, BIT_RS); return 1; }

void LiquidCrystal_I2C::send(uint8_t value, uint8_t mode) {
  write4((value & 0xF0) | mode);
  write4(((value << 4) & 0xF0) | mode);
}

// one nibble on P4–P7 with an E pulse (falling edge latches the data); ≥ 37 µs execution time afterwards
void LiquidCrystal_I2C::write4(uint8_t data) {
  expander(data);
  expander(data | BIT_E);
  delayMicroseconds(1);
  expander(data & ~BIT_E);
  delayMicroseconds(50);
}

void LiquidCrystal_I2C::expander(uint8_t data) {
  Wire.beginTransmission(_addr);
  Wire.write(data | _bl);
  Wire.endTransmission();
}
