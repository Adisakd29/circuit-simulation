// LiquidCrystal_I2C — Circuit Lab 3D implementation (MIT License, see LICENSE)
// Written from scratch for the HD44780 + PCF8574 backpack (P0 RS, P1 RW, P2 E, P3 backlight, P4–P7 D4–D7).
// The public API matches the widely used LiquidCrystal_I2C library so common sketches compile unchanged;
// no code was taken from that library (its repository does not state a license).
#ifndef CIRCUITLAB_LIQUIDCRYSTAL_I2C_H
#define CIRCUITLAB_LIQUIDCRYSTAL_I2C_H
#include <Arduino.h>
#include <Print.h>

class LiquidCrystal_I2C : public Print {
public:
  LiquidCrystal_I2C(uint8_t addr, uint8_t cols, uint8_t rows);
  void init();
  void begin(uint8_t cols = 0, uint8_t rows = 0, uint8_t charsize = 0);
  void clear();
  void home();
  void setCursor(uint8_t col, uint8_t row);
  void noDisplay(); void display();
  void noCursor(); void cursor();
  void noBlink(); void blink();
  void scrollDisplayLeft(); void scrollDisplayRight();
  void leftToRight(); void rightToLeft();
  void autoscroll(); void noAutoscroll();
  void createChar(uint8_t location, const uint8_t charmap[]);
  void noBacklight(); void backlight();
  void setBacklight(uint8_t on);
  void command(uint8_t value);
  virtual size_t write(uint8_t value);
  using Print::write;
  // ชื่อเรียกแบบเก่าที่ตัวอย่างทั่วไปใช้
  void cursor_on() { cursor(); } void cursor_off() { noCursor(); }
  void blink_on() { blink(); } void blink_off() { noBlink(); }
  void printstr(const char *s) { print(s); }
private:
  void send(uint8_t value, uint8_t mode);
  void write4(uint8_t nibble);
  void expander(uint8_t data);
  uint8_t _addr, _cols, _rows, _bl, _func, _ctrl, _mode;
};
#endif
