/**
 * โปรไฟล์ชิป AVR สำหรับ AvrEmulator (avr8js, MIT) — ตำแหน่งรีจิสเตอร์ เวกเตอร์ interrupt และการจับคู่ขา Arduino → พอร์ต/บิต
 *
 * ที่อยู่ interrupt ของ avr8js = หมายเลขเวกเตอร์ × 2 (ตารางเวกเตอร์ใช้คำสั่ง JMP 2 word ต่อช่อง)
 *
 * ATmega328P (Uno/Nano): ค่ามาตรฐานของ avr8js (timer0/1/2, usart0, adc, spi, twi, eeprom, watchdog, พอร์ต B/C/D)
 *
 * ATmega2560 (Arduino Mega 2560) — อ้างอิง avr-libc iomxx0_1.h (ตารางเวกเตอร์และที่อยู่รีจิสเตอร์) และ
 *   ArduinoCore-avr 1.8.6 variants/mega/pins_arduino.h (ตารางขา digital_pin_to_port/bit/timer):
 *   - แฟลช 256 KB (PC 22 บิต — avr8js สลับเองเมื่อหน่วยความจำโปรแกรม > 128 KB), SRAM 8 KB (0x200–0x21FF), EEPROM 4 KB
 *   - พอร์ต A–L (ไม่มี I), INT0–3 = PD0–3 (EICRA), INT4–7 = PE4–7 (EICRB) · PCINT0 = PB0–7, PCINT1 = PE0 + PJ0–6, PCINT2 = PK0–7
 *   - Timer0/2 8 บิต, Timer1/3/4/5 16 บิตมีช่อง C (OCnC) · USART0–3 · ADC 16 ช่อง (MUX5 ใน ADCSRB เลือก ADC8–15)
 *   - SPI: SS = D53 (PB0), SCK = D52 (PB1), MOSI = D51 (PB2), MISO = D50 (PB3) · TWI: SDA = D20 (PD1), SCL = D21 (PD0)
 */
import {
  ADCMuxInputType, ADCReference, INT0, INT1, PCINT0, PCINT1, PCINT2, adcConfig, eepromConfig, portAConfig, portBConfig, portCConfig, portDConfig,
  portEConfig, portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig, spiConfig, timer0Config, timer1Config, timer2Config,
  twiConfig, usart0Config, watchdogConfig,
  type ADCConfig, type AVRPortConfig, type AVRTimerConfig, type AVREEPROMConfig as EEPROMConfig, type SPIConfig, type TWIConfig, type WatchdogConfig,
} from 'avr8js';

type USARTConfig = typeof usart0Config;

export interface AvrChip {
  name: string;
  flashBytes: number;
  /** SRAM (ไบต์) — ส่งให้ CPU ของ avr8js (พื้นที่ข้อมูล = 0x100 + ค่านี้) */
  sramBytes: number;
  eepromBytes: number;
  ports: Record<string, AVRPortConfig>;
  /** ขา Arduino ลำดับ i → [พอร์ต, บิต] */
  pins: Array<[string, number]>;
  timers: AVRTimerConfig[];
  /** USART0 = Serial (ต่อชิป USB-serial) · 1–3 = Serial1–3 */
  usarts: USARTConfig[];
  /** ขา [RX, TX] ของ USART แต่ละตัว (หมายเลขขา Arduino) */
  uartPins: Array<[number, number]>;
  adc: ADCConfig;
  adcChannels: number;
  /** ขา Arduino ของ ADC ช่อง 0 (A0) — ช่อง ch = ขา adcPin0 + ch */
  adcPin0: number;
  /** SPI/TWI ฮาร์ดแวร์ (ATtiny85 ไม่มี — ใช้ USI แทน ซึ่งยังไม่ได้ผูกกับวงจร) */
  spi?: SPIConfig;
  /** [MOSI, MISO, SCK, SS] */
  spiPins: [number, number, number, number];
  twi?: TWIConfig;
  /** [SDA, SCL] (−1 = ไม่มี) */
  twiPins: [number, number];
  /** ขา Arduino ของ ADC แต่ละช่อง (ไม่ระบุ = adcPin0 + ช่อง) — ATtiny85: ADC0 = PB5, ADC1 = PB2, ADC2 = PB4, ADC3 = PB3 */
  adcPins?: number[];
  /** ATtiny25/45/85: Timer/Counter1 แบบ 8 บิตของตระกูล ATtiny (avr8js ATtinyTimer1) */
  attinyTimer1?: boolean;
  /** ที่อยู่ CLKPR (ATmega328P 0x61, ATtiny85 0x46) */
  clkpr?: number;
  eeprom: EEPROMConfig;
  watchdog: WatchdogConfig;
  /** ขา LED บนบอร์ด (L) */
  led: number;
}

const range = (n: number, f: (i: number) => [string, number]) => Array.from({ length: n }, (_, i) => f(i));

export const AVR_328P: AvrChip = {
  name: 'ATmega328P', flashBytes: 0x8000, sramBytes: 2048, eepromBytes: 1024,
  ports: { B: portBConfig, C: portCConfig, D: portDConfig },
  pins: [...range(8, (i) => ['D', i]), ...range(6, (i) => ['B', i]), ...range(6, (i) => ['C', i])],
  timers: [timer0Config, timer1Config, timer2Config],
  usarts: [usart0Config], uartPins: [[0, 1]],
  adc: adcConfig, adcChannels: 8, adcPin0: 14,
  spi: spiConfig, spiPins: [11, 12, 13, 10], twi: twiConfig, twiPins: [18, 19],
  eeprom: eepromConfig, watchdog: watchdogConfig, led: 13,
};

// ---------- ATmega2560 ----------
const v = (n: number) => n * 2;
const ext = (index: number, EICR: number, iscOffset: number) => ({ EICR, EIMSK: 0x3d, EIFR: 0x3c, index, iscOffset, interrupt: v(index + 1) });
const INT2 = ext(2, 0x69, 4), INT3 = ext(3, 0x69, 6);
const INT4 = ext(4, 0x6a, 0), INT5 = ext(5, 0x6a, 2), INT6 = ext(6, 0x6a, 4), INT7 = ext(7, 0x6a, 6);
const PC0 = { ...PCINT0, pinChangeInterrupt: v(9) };
// PCINT1: PCINT8 = PE0 (บิต 0 ของ PCMSK1) · PCINT9–15 = PJ0–6 (บิต 1–7)
const PC1E = { ...PCINT1, pinChangeInterrupt: v(10), mask: 0x01, offset: 0 };
const PC1J = { ...PCINT1, pinChangeInterrupt: v(10), mask: 0x7f, offset: 1 };
const PC2 = { ...PCINT2, pinChangeInterrupt: v(11) };

const P = { A: portAConfig, B: portBConfig, C: portCConfig, D: portDConfig, E: portEConfig, F: portFConfig, G: portGConfig, H: portHConfig, J: portJConfig, K: portKConfig, L: portLConfig };
const ports2560: Record<string, AVRPortConfig> = {
  A: P.A, B: { ...P.B, pinChange: PC0 }, C: P.C, D: { ...P.D, pinChange: undefined, externalInterrupts: [{ ...INT0, interrupt: v(1) }, { ...INT1, interrupt: v(2) }, INT2, INT3] },
  E: { ...P.E, pinChange: PC1E, externalInterrupts: [null, null, null, null, INT4, INT5, INT6, INT7] }, F: P.F, G: P.G, H: P.H, J: { ...P.J, pinChange: PC1J }, K: { ...P.K, pinChange: PC2 }, L: P.L,
};

const tmr = (bits: 8 | 16, vec: { capt?: number; a: number; b: number; c?: number; ovf: number }, r: { TIFR: number; TIMSK: number; TCCRA: number; TCNT: number; OCRA: number; OCRB: number; OCRC?: number; ICR?: number },
  oc: Array<[AVRPortConfig, number]>, clk: [number, number], dividers: AVRTimerConfig['dividers']): AVRTimerConfig => ({
  ...timer1Config, bits, dividers,
  captureInterrupt: vec.capt ? v(vec.capt) : 0, compAInterrupt: v(vec.a), compBInterrupt: v(vec.b), compCInterrupt: vec.c ? v(vec.c) : 0, ovfInterrupt: v(vec.ovf),
  TIFR: r.TIFR, TIMSK: r.TIMSK, TCCRA: r.TCCRA, TCCRB: r.TCCRA + 1, TCCRC: bits === 16 ? r.TCCRA + 2 : 0, TCNT: r.TCNT, OCRA: r.OCRA, OCRB: r.OCRB, OCRC: r.OCRC ?? 0, ICR: r.ICR ?? 0,
  OCFC: r.OCRC ? 8 : 0, OCIEC: r.OCRC ? 8 : 0,
  compPortA: oc[0][0].PORT, compPinA: oc[0][1], compPortB: oc[1][0].PORT, compPinB: oc[1][1], compPortC: oc[2] ? oc[2][0].PORT : 0, compPinC: oc[2] ? oc[2][1] : 0,
  externalClockPort: clk[0], externalClockPin: clk[1],
});
const timers2560: AvrChip['timers'] = [
  tmr(8, { a: 21, b: 22, ovf: 23 }, { TIFR: 0x35, TIMSK: 0x6e, TCCRA: 0x44, TCNT: 0x46, OCRA: 0x47, OCRB: 0x48 }, [[P.B, 7], [P.G, 5]], [P.D.PORT, 7], timer0Config.dividers),
  tmr(16, { capt: 16, a: 17, b: 18, c: 19, ovf: 20 }, { TIFR: 0x36, TIMSK: 0x6f, TCCRA: 0x80, TCNT: 0x84, OCRA: 0x88, OCRB: 0x8a, OCRC: 0x8c, ICR: 0x86 }, [[P.B, 5], [P.B, 6], [P.B, 7]], [P.D.PORT, 6], timer1Config.dividers),
  tmr(8, { a: 13, b: 14, ovf: 15 }, { TIFR: 0x37, TIMSK: 0x70, TCCRA: 0xb0, TCNT: 0xb2, OCRA: 0xb3, OCRB: 0xb4 }, [[P.B, 4], [P.H, 6]], [0, 0], timer2Config.dividers),
  tmr(16, { capt: 31, a: 32, b: 33, c: 34, ovf: 35 }, { TIFR: 0x38, TIMSK: 0x71, TCCRA: 0x90, TCNT: 0x94, OCRA: 0x98, OCRB: 0x9a, OCRC: 0x9c, ICR: 0x96 }, [[P.E, 3], [P.E, 4], [P.E, 5]], [P.E.PORT, 6], timer1Config.dividers),
  tmr(16, { capt: 41, a: 42, b: 43, c: 44, ovf: 45 }, { TIFR: 0x39, TIMSK: 0x72, TCCRA: 0xa0, TCNT: 0xa4, OCRA: 0xa8, OCRB: 0xaa, OCRC: 0xac, ICR: 0xa6 }, [[P.H, 3], [P.H, 4], [P.H, 5]], [P.H.PORT, 7], timer1Config.dividers),
  tmr(16, { capt: 46, a: 47, b: 48, c: 49, ovf: 50 }, { TIFR: 0x3a, TIMSK: 0x73, TCCRA: 0x120, TCNT: 0x124, OCRA: 0x128, OCRB: 0x12a, OCRC: 0x12c, ICR: 0x126 }, [[P.L, 3], [P.L, 4], [P.L, 5]], [P.L.PORT, 2], timer1Config.dividers),
];
const usart = (base: number, rx: number): USARTConfig => ({ rxCompleteInterrupt: v(rx), dataRegisterEmptyInterrupt: v(rx + 1), txCompleteInterrupt: v(rx + 2), UCSRA: base, UCSRB: base + 1, UCSRC: base + 2, UBRRL: base + 4, UBRRH: base + 5, UDR: base + 6 });

const ch2560: ADCConfig['muxChannels'] = {};
for (let i = 0; i < 8; i++) { ch2560[i] = { type: ADCMuxInputType.SingleEnded, channel: i }; ch2560[0x20 + i] = { type: ADCMuxInputType.SingleEnded, channel: 8 + i }; }
ch2560[0x1e] = { type: ADCMuxInputType.Constant, voltage: 1.1 };
ch2560[0x1f] = { type: ADCMuxInputType.Constant, voltage: 0 };

/** ตาราง digital_pin_to_port/bit ของ variants/mega (D0–D69, A0–A15 = D54–D69) */
const MEGA_PORTS = 'EEEEGEHHHHBBBBJJHHDDDDAAAAAAAACCCCCCCCDGGGLLLLLLLLBBBBFFFFFFFFKKKKKKKK';
const MEGA_BITS = [0, 1, 4, 5, 5, 3, 3, 4, 5, 6, 4, 5, 6, 7, 1, 0, 1, 0, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0, 7, 2, 1, 0, 7, 6, 5, 4, 3, 2, 1, 0, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];

export const AVR_2560: AvrChip = {
  name: 'ATmega2560', flashBytes: 0x40000, sramBytes: 0x2100, eepromBytes: 4096,
  ports: ports2560,
  pins: MEGA_BITS.map((b, i) => [MEGA_PORTS[i], b]),
  timers: timers2560,
  usarts: [usart(0xc0, 25), usart(0xc8, 36), usart(0xd0, 51), usart(0x130, 54)],
  uartPins: [[0, 1], [19, 18], [17, 16], [15, 14]],
  adc: { ...adcConfig, adcInterrupt: v(29), numChannels: 16, muxInputMask: 0x3f, muxChannels: ch2560, adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Internal1V1, ADCReference.Internal2V56] },
  adcChannels: 16, adcPin0: 54,
  spi: { ...spiConfig, spiInterrupt: v(24) }, spiPins: [51, 50, 52, 53],
  twi: { ...twiConfig, twiInterrupt: v(39) }, twiPins: [20, 21],
  eeprom: { ...eepromConfig, eepromReadyInterrupt: v(30) }, watchdog: { ...watchdogConfig, watchdogInterrupt: v(12) }, led: 13,
};

// ---------- ATtiny85 ----------
/**
 * ATtiny25/45/85 — อ้างอิง avr-libc iotnx5.h (ที่อยู่ I/O + 0x20 = ที่อยู่ข้อมูล) และ datasheet Atmel-2586:
 *   - ตารางเวกเตอร์ใช้ RJMP 1 word ต่อช่อง → ที่อยู่ interrupt ของ avr8js = หมายเลขเวกเตอร์ (ไม่คูณ 2):
 *     1 INT0, 2 PCINT0, 3 TIM1_COMPA, 4 TIM1_OVF, 5 TIM0_OVF, 6 EE_RDY, 7 ANA_COMP, 8 ADC, 9 TIM1_COMPB, 10 TIM0_COMPA, 11 TIM0_COMPB, 12 WDT, 13 USI_START, 14 USI_OVF
 *   - พอร์ต B เท่านั้น (PB0–PB5) · PINB 0x36, DDRB 0x37, PORTB 0x38 · GIMSK 0x5B (INT0 บิต 6, PCIE บิต 5), GIFR 0x5A, MCUCR 0x55 (ISC01:00), PCMSK 0x35
 *   - Timer0: TCCR0A 0x4A, TCCR0B 0x53, TCNT0 0x52, OCR0A 0x49, OCR0B 0x48 · TIMSK 0x59 / TIFR 0x58 (TOIE0/TOV0 บิต 1, OCIE0A/OCF0A บิต 4, OCIE0B/OCF0B บิต 3) · OC0A = PB0, OC0B = PB1, T0 = PB2
 *   - Timer1 (8 บิต, ค่าเริ่มต้น OCR1C = 0xFF ตาม datasheet) ใช้ avr8js ATtinyTimer1 — OC1A = PB1, OC1B = PB4
 *   - ADC: ADMUX 0x27 (REFS1 REFS0 ADLAR REFS2 MUX3:0), ADCSRA 0x26, ADCH 0x25, ADCL 0x24, ADCSRB 0x23 · REFS1:0 = 00 → VCC, 01 → AREF (PB0), 10 → 1.1 V
 *     (2.56 V ใช้ REFS2 ที่บิต 4 — avr8js อ่าน REFS2 ที่บิต 3 จึงไม่เปิดตัวเลือกนี้: แสดงเป็น "สงวน")
 *   - EEPROM 512 ไบต์: EECR 0x3C, EEDR 0x3D, EEARL 0x3E, EEARH 0x3F · WDTCR 0x41, MCUSR 0x54 · CLKPR 0x46 · SRAM 512 ไบต์ (0x60–0x25F)
 *   ขา Arduino (ArduinoCore-avr variants/gemma): D0–D5 = PB0–PB5 · A1 = PB2, A2 = PB4, A3 = PB3 (A0 = PB5 = ขา RESET)
 */
const tinyB: AVRPortConfig = {
  PIN: 0x36, DDR: 0x37, PORT: 0x38,
  pinChange: { PCIE: 5, PCICR: 0x5b, PCIFR: 0x5a, PCMSK: 0x35, pinChangeInterrupt: 2, mask: 0x3f, offset: 0 },
  externalInterrupts: [null, null, { EICR: 0x55, EIMSK: 0x5b, EIFR: 0x5a, index: 6, iscOffset: 0, interrupt: 1 }],
};
const tinyBits = { TOV: 1 << 1, OCFA: 1 << 4, OCFB: 1 << 3, OCFC: 0, TOIE: 1 << 1, OCIEA: 1 << 4, OCIEB: 1 << 3, OCIEC: 0 };
const tinyTimer0: AVRTimerConfig = {
  ...timer0Config, ...tinyBits, bits: 8, captureInterrupt: 0, compAInterrupt: 10, compBInterrupt: 11, compCInterrupt: 0, ovfInterrupt: 5,
  TIFR: 0x58, TIMSK: 0x59, TCCRA: 0x4a, TCCRB: 0x53, TCCRC: 0, TCNT: 0x52, OCRA: 0x49, OCRB: 0x48, OCRC: 0, ICR: 0,
  compPortA: 0x38, compPinA: 0, compPortB: 0x38, compPinB: 1, compPortC: 0, compPinC: 0, externalClockPort: 0x38, externalClockPin: 2,
};
const tinyCh: ADCConfig['muxChannels'] = {
  0: { type: ADCMuxInputType.SingleEnded, channel: 0 }, 1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
  2: { type: ADCMuxInputType.SingleEnded, channel: 2 }, 3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
  12: { type: ADCMuxInputType.Constant, voltage: 1.1 }, 13: { type: ADCMuxInputType.Constant, voltage: 0 }, 15: { type: ADCMuxInputType.Temperature },
};

export const AVR_TINY85: AvrChip = {
  name: 'ATtiny85', flashBytes: 0x2000, sramBytes: 0x160, eepromBytes: 512,
  ports: { B: tinyB },
  pins: range(6, (i) => ['B', i]),
  timers: [tinyTimer0], attinyTimer1: true, clkpr: 0x46,
  usarts: [], uartPins: [],
  adc: { ...adcConfig, ADMUX: 0x27, ADCSRA: 0x26, ADCSRB: 0x23, ADCL: 0x24, ADCH: 0x25, DIDR0: 0x34, adcInterrupt: 8, numChannels: 4, muxInputMask: 0xf, muxChannels: tinyCh,
    adcReferences: [ADCReference.AVCC, ADCReference.AREF, ADCReference.Internal1V1, ADCReference.Reserved] },
  adcChannels: 4, adcPin0: 0, adcPins: [5, 2, 4, 3],
  spiPins: [-1, -1, -1, -1], twiPins: [-1, -1],
  eeprom: { ...eepromConfig, eepromReadyInterrupt: 6, EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f }, watchdog: { ...watchdogConfig, watchdogInterrupt: 12, MCUSR: 0x54, WDTCSR: 0x41 }, led: -1,
};

export type AvrBoard = 'uno' | 'nano' | 'unoq' | 'mega' | 'promini' | 'promini3' | 'attiny85';
/**
 * สัญญาณนาฬิกาและไฟเลี้ยงของชิปตามบอร์ด (ArduinoCore-avr boards.txt): Pro Mini 3.3 V = ATmega328P 8 MHz (pro.menu.cpu.8MHzatmega328, F_CPU 8000000L)
 * บอร์ดอื่น 16 MHz 5 V · UNO Q ใช้ตัวจำลอง 5 V แล้วปรับสเกล ADC ใน cosim (โหมดจำลองพฤติกรรม)
 */
export function avrClockOf(board?: string): { hz: number; vcc: number } { return board === 'promini3' ? { hz: 8_000_000, vcc: 3.3 } : board === 'attiny85' ? { hz: 8_000_000, vcc: 5 } : { hz: 16_000_000, vcc: 5 }; }
export function avrChipOf(board?: string): AvrChip { return board === 'mega' ? AVR_2560 : board === 'attiny85' ? AVR_TINY85 : AVR_328P; }
