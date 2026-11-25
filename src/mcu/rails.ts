/**
 * ขาไฟเลี้ยงของบอร์ดไมโครคอนโทรลเลอร์ที่จ่ายให้วงจร (ใช้ทั้งตัวจำลองและเครื่องวัดกำลังไฟฟ้า)
 * [ชื่อขา, แรงดัน (V), ความต้านทานภายใน (Ω), กระแสสูงสุด (A)] — ที่มาของค่าอยู่ที่ pinElements ใน cosim.ts
 */
export type RailDef = readonly [name: string, v: number, rint: number, ilim: number];

export function mcuRails(kind: 'pico' | 'uno' | 'rpi5', board?: string, usbLimit?: number): RailDef[] {
  // Nano RP2040 Connect (datasheet ABX00053): 3.3V ออก ≤ 800 mA (รวมไอซีบนบอร์ด) · VUSB = 5 V จากพอร์ต USB (ใช้ 500 mA ตามมาตรฐาน USB 2.0)
  if (kind === 'pico' && board === 'nanoconnect') return [['3V3', 3.3, 0.05, 0.8], ['VBUS', 5, 0.1, 0.5]];
  // ESP32-DevKitC V4: 5V ต่อกับไฟ USB (500 mA) · 3V3 จากเรกูเลเตอร์ LDO บนบอร์ด — User Guide ไม่ระบุกระแสที่ดึงออกได้ ใช้ค่าประมาณ 0.5 A
  if (kind === 'pico' && board === 'esp32') return [['3V3', 3.3, 0.05, 0.5], ['VBUS', 5, 0.1, 0.5]];
  // UNO Q (datasheet ABX00162/173): 5V จาก USB-C ตามที่แหล่งจ่ายให้ได้ (สูงสุด 3 A) · 3V3 จากเรกูเลเตอร์บนบอร์ด — เอกสารไม่ระบุกระแสที่ดึงออกได้ ใช้ค่าประมาณ 0.5 A
  if (kind === 'uno' && board === 'unoq') return [['5V', 5, 0.05, usbLimit ?? 3], ['3V3', 3.3, 0.1, 0.5]];
  if (kind === 'rpi5') return [['5V', 5, 0.05, 1.6], ['3V3', 3.3, 0.1, 0.5]];
  // Pro Mini: VCC ต่อตรงกับขา VCC ของตัวแปลง USB-serial — 5 V จากพอร์ต USB (500 mA) · 3.3 V จากตัวคุมแรงดันของตัวแปลง (ขึ้นกับรุ่น ใช้ค่าประมาณ 150 mA)
  // ATtiny85 ชิปเดี่ยว: ไม่มีรางไฟออก (ไฟมาจากวงจรเข้าขา VCC)
  if (kind === 'uno' && board === 'attiny85') return [];
  if (kind === 'uno' && board === 'promini') return [['VCC', 5, 0.1, 0.5]];
  if (kind === 'uno' && board === 'promini3') return [['VCC', 3.3, 0.2, 0.15]];
  if (kind === 'uno') return [['5V', 5, 0.1, 0.5], board === 'nano' ? ['3V3', 3.3, 0.5, 0.05] : ['3V3', 3.3, 0.2, 0.15]];
  return [['3V3', 3.3, 0.05, 0.3], ['VBUS', 5, 0.1, 0.5], ['VSYS', 4.7, 0.2, 0.5], ['ADC_VREF', 3.3, 200, 0.05]];
}

/** กระแสสูงสุดต่อขา GPIO ที่ตัวจำลองใช้ (A) */
export const GPIO_ILIM = { pico: 0.05, uno: 0.04, rpi5: 0.016, unoq: 0.02 } as const;

/**
 * GPIO ภายในบอร์ด Seeed XIAO RP2040 (ไม่ออกขา — ตาม pins.csv ของนิยามบอร์ด SEEED_XIAO_RP2040 และ wiki ของ Seeed):
 * LED RGB ติดเมื่อขาเป็น LOW (R = GPIO17, G = GPIO16, B = GPIO25) · NeoPixel WS2812 ข้อมูล GPIO12 เปิดไฟเลี้ยงที่ GPIO11
 */
export const XIAO_LED = { r: 17, g: 16, b: 25, neo: 12, neoPower: 11 } as const;
