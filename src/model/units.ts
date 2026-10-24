/** การจัดรูปแบบหน่วย SI และการอ่านค่าที่ผู้ใช้พิมพ์ เช่น "4.7k", "220", "1M", "20m" */

const PREFIX: Array<[number, string]> = [
  [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
];

export function formatSI(value: number, unit: string, digits = 3): string {
  if (!isFinite(value)) return '—';
  if (value === 0) return `0 ${unit}`;
  const abs = Math.abs(value);
  for (const [scale, p] of PREFIX) {
    if (abs >= scale * 0.9995) {
      const v = value / scale;
      return `${trim(v, digits)} ${p}${unit}`;
    }
  }
  const [scale, p] = PREFIX[PREFIX.length - 1];
  return `${trim(value / scale, digits)} ${p}${unit}`;
}

function trim(v: number, digits: number): string {
  const s = Number(v.toPrecision(digits));
  return String(s);
}

export function parseSI(text: string): number | null {
  const t = text.trim().replace(/\s*(Ω|ohms?|[vawfh])$/i, '').replace(',', '.').trim();
  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([GMkKmuµnp]?)$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12 };
  const r = n * mult[m[2]];
  return isFinite(r) ? r : null;
}
