/**
 * money.ts — Aritmetika uang bertipe integer Rupiah dengan pembulatan terkendali.
 *
 * PRINSIP
 * -------
 * 1. Seluruh nominal uang direpresentasikan sebagai BILANGAN BULAT Rupiah (Rupiah = number).
 *    Tidak ada floating-point yang menyimpan pecahan sen di dalam domain bisnis.
 * 2. Operasi persentase dihitung melalui BigInt sehingga hasilnya eksak sebelum dibulatkan.
 * 3. Pembulatan selalu eksplisit dan dapat dikonfigurasi (default HALF_UP / "pembulatan
 *    setengah ke atas menjauhi nol", sesuai kebiasaan akuntansi di Indonesia).
 * 4. Setiap operasi yang dapat menghasilkan pecahan WAJIB memberi tahu pemanggil nilai
 *    pembulatan (rounding delta) bila hal itu relevan untuk rekonsiliasi.
 *
 * MODUL INI TIDAK BOLEH mengimpor apa pun dari React, Supabase, atau lapisan UI.
 * Modul ini adalah sumber kebenaran tunggal untuk seluruh perhitungan uang.
 */

/** Nominal uang dalam Rupiah bulat. Contoh: 1500000 = Rp1.500.000 */
export type Rupiah = number;

/** Batas aman integer Rupiah (± 9 kuadriliun). */
export const MAX_RUPIAH: Rupiah = Number.MAX_SAFE_INTEGER;

/** Nilai uang nol. */
export const ZERO: Rupiah = 0;

/** Mode pembulatan yang didukung. */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNCATE';

export const DEFAULT_ROUNDING: RoundingMode = 'HALF_UP';

/** Kesalahan domain uang — dipakai agar pemanggil dapat membedakan error validasi. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** True bila nilai adalah bilangan bulat Rupiah yang valid dan aman. */
export function isRupiah(value: unknown): value is Rupiah {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_RUPIAH
  );
}

/** Validasi ketat; melempar MoneyError bila tidak valid. */
export function assertRupiah(value: unknown, label = 'nilai'): Rupiah {
  if (!isRupiah(value)) {
    throw new MoneyError(`${label} harus berupa bilangan bulat Rupiah yang valid (diterima: ${String(value)}).`);
  }
  return value;
}

/** Validasi bahwa nominal tidak negatif. */
export function assertNonNegative(value: unknown, label = 'nominal'): Rupiah {
  const v = assertRupiah(value, label);
  if (v < 0) throw new MoneyError(`${label} tidak boleh negatif (diterima: ${v}).`);
  return v;
}

/** Validasi bahwa nominal positif (> 0). */
export function assertPositive(value: unknown, label = 'nominal'): Rupiah {
  const v = assertRupiah(value, label);
  if (v <= 0) throw new MoneyError(`${label} harus lebih besar dari nol (diterima: ${v}).`);
  return v;
}

/**
 * Pembagian BigInt dengan mode pembulatan eksplisit.
 * Menghindari galat floating-point pada operasi persentase.
 */
export function bigDivRound(numerator: bigint, denominator: bigint, mode: RoundingMode = DEFAULT_ROUNDING): bigint {
  if (denominator === 0n) throw new MoneyError('Pembagi tidak boleh nol.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  if (remainder === 0n) return negative ? -quotient : quotient;

  let result: bigint;
  switch (mode) {
    case 'FLOOR':
      result = negative ? quotient + 1n : quotient;
      break;
    case 'CEIL':
      result = negative ? quotient : quotient + 1n;
      break;
    case 'TRUNCATE':
      result = quotient;
      break;
    case 'HALF_EVEN': {
      const twice = remainder * 2n;
      if (twice > d) result = quotient + 1n;
      else if (twice < d) result = quotient;
      else result = quotient % 2n === 0n ? quotient : quotient + 1n;
      break;
    }
    case 'HALF_UP':
    default: {
      const twice = remainder * 2n;
      result = twice >= d ? quotient + 1n : quotient;
      break;
    }
  }
  return negative ? -result : result;
}

/** Pembulatan nilai pecahan float ke integer dengan mode eksplisit. */
export function roundToInt(value: number, mode: RoundingMode = DEFAULT_ROUNDING): number {
  if (!Number.isFinite(value)) throw new MoneyError(`Nilai tidak terhingga tidak dapat dibulatkan: ${value}`);
  switch (mode) {
    case 'FLOOR':
      return Math.floor(value);
    case 'CEIL':
      return Math.ceil(value);
    case 'TRUNCATE':
      return Math.trunc(value);
    case 'HALF_EVEN': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'HALF_UP':
    default:
      return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  }
}

/** Membulatkan nilai uang secara aman (mengembalikan Rupiah bulat). */
export function roundRupiah(value: number, mode: RoundingMode = DEFAULT_ROUNDING): Rupiah {
  return assertRupiah(roundToInt(value, mode), 'hasil pembulatan');
}

/**
 * Menerapkan tarif persentase eksak ke sebuah nominal.
 *
 * @param amount       Nominal dasar dalam Rupiah.
 * @param rateBp       Tarif dalam basis point (1% = 100 bp). Boleh desimal, mis. 12.5% = 1250.
 * @param divisor      Pembagi periode (mis. 12 untuk tarif tahunan yang dibagi per bulan).
 * @param mode         Mode pembulatan.
 *
 * Rumus: round(amount × rateBp ÷ (10.000 × divisor))
 *
 * Menggunakan BigInt sehingga tidak ada galat floating-point pada hasil akhir.
 */
export function applyRate(
  amount: Rupiah,
  rateBp: number,
  divisor = 1,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Rupiah {
  assertRupiah(amount, 'nominal');
  if (!Number.isFinite(rateBp)) throw new MoneyError('Tarif bunga tidak valid.');
  if (!Number.isFinite(divisor) || divisor === 0) throw new MoneyError('Pembagi periode tidak valid.');
  if (rateBp === 0) return 0;

  // Skala 1e6 agar basis point desimal (mis. tarif tahunan ÷ 12) tetap presisi.
  const SCALE = 1_000_000;
  const rateScaled = BigInt(Math.round(rateBp * SCALE));
  const divisorScaled = BigInt(Math.round(divisor * SCALE));
  const numerator = BigInt(amount) * rateScaled;
  const denominator = 10_000n * divisorScaled;
  return Number(bigDivRound(numerator, denominator, mode));
}

/** Mengubah persen (2,5) menjadi basis point (250). */
export function percentToBp(percent: number): number {
  if (!Number.isFinite(percent)) throw new MoneyError('Persentase tidak valid.');
  return percent * 100;
}

/** Mengubah basis point (250) menjadi persen (2,5). */
export function bpToPercent(bp: number): number {
  if (!Number.isFinite(bp)) throw new MoneyError('Basis point tidak valid.');
  return bp / 100;
}

/** Penjumlahan nominal yang aman terhadap overflow. */
export function sumRupiah(values: readonly Rupiah[]): Rupiah {
  let total = 0;
  for (const value of values) {
    assertRupiah(value, 'elemen penjumlahan');
    total += value;
    if (!Number.isSafeInteger(total)) throw new MoneyError('Hasil penjumlahan melebihi batas aman integer.');
  }
  return total;
}

/** Selisih dua nominal (a - b) yang tetap aman terhadap overflow. */
export function subtractRupiah(a: Rupiah, b: Rupiah): Rupiah {
  assertRupiah(a, 'nilai a');
  assertRupiah(b, 'nilai b');
  const result = a - b;
  if (!Number.isSafeInteger(result)) throw new MoneyError('Hasil pengurangan melebihi batas aman integer.');
  return result;
}

/** Membatasi nominal pada rentang [min, max]. */
export function clampRupiah(value: Rupiah, min: Rupiah, max: Rupiah): Rupiah {
  assertRupiah(value, 'nilai');
  if (min > max) throw new MoneyError('Batas minimum tidak boleh melebihi maksimum.');
  return Math.min(Math.max(value, min), max);
}

/** Nilai maksimum dari daftar nominal. */
export function maxRupiah(values: readonly Rupiah[]): Rupiah {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => Math.max(acc, assertRupiah(v)), 0);
}

/** True bila kedua nominal sama (untuk komparasi saldo). */
export function equalsRupiah(a: Rupiah, b: Rupiah): boolean {
  return assertRupiah(a) === assertRupiah(b);
}

/**
 * Mendistribusikan total ke sejumlah periode sedemikian rupa sehingga
 * jumlah seluruh bagian TEPAT sama dengan total.
 *
 * Bagian untuk periode 1..n-1 dibulatkan KE BAWAH (FLOOR) dan sisa seluruhnya
 * diletakkan pada periode terakhir. Pendekatan ini dipilih karena:
 *   * tidak pernah menghasilkan bagian negatif (pembulatan ke atas bisa
 *     membuat periode terakhir bernilai negatif pada total kecil), dan
 *   * jumlah bagian selalu tepat sama dengan total.
 *
 * @example splitEvenly(1000, 3) => [333, 333, 334]
 * @example splitEvenly(10, 6)   => [1, 1, 1, 1, 1, 5]
 */
export function splitEvenly(total: Rupiah, periods: number, _mode: RoundingMode = DEFAULT_ROUNDING): Rupiah[] {
  assertRupiah(total, 'total');
  if (!Number.isInteger(periods) || periods <= 0) throw new MoneyError('Jumlah periode harus bilangan bulat positif.');
  if (periods === 1) return [total];

  const base = Math.floor(total / periods);
  const parts: Rupiah[] = new Array(periods).fill(base);
  parts[periods - 1] = assertRupiah(total - base * (periods - 1), 'bagian terakhir');
  if (parts[periods - 1]! < 0) {
    throw new MoneyError('Distribusi tidak valid: bagian terakhir bernilai negatif.');
  }
  return parts;
}

/**
 * Mendistribusikan total proporsional terhadap bobot, memastikan
 * penjumlahan hasil tepat sama dengan total.
 *
 * @example splitProportional(1000, [1, 1, 3]) => [200, 200, 600]
 */
export function splitProportional(
  total: Rupiah,
  weights: readonly number[],
  mode: RoundingMode = DEFAULT_ROUNDING,
): Rupiah[] {
  assertRupiah(total, 'total');
  if (weights.length === 0) throw new MoneyError('Bobot tidak boleh kosong.');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new MoneyError('Total bobot harus lebih besar dari nol.');

  const results: Rupiah[] = [];
  let allocated = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (i === weights.length - 1) {
      results.push(assertRupiah(total - allocated, 'bagian terakhir'));
      break;
    }
    const part = roundToInt((total * weights[i]!) / weightSum, mode);
    allocated += part;
    results.push(part);
  }
  return results;
}

/** Format nominal Rupiah menjadi string Indonesia tanpa simbol (mis. "1.500.000"). */
export function formatRupiahNumber(value: Rupiah): string {
  assertRupiah(value, 'nominal');
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value);
}

/** Format nominal Rupiah lengkap dengan simbol (mis. "Rp1.500.000"). */
export function formatRupiah(value: Rupiah, options: { withSymbol?: boolean; signed?: boolean } = {}): string {
  const { withSymbol = true, signed = false } = options;
  assertRupiah(value, 'nominal');
  const negative = value < 0;
  const abs = Math.abs(value);
  const body = formatRupiahNumber(abs);
  const sign = negative ? '-' : signed ? '+' : '';
  return `${sign}${withSymbol ? 'Rp' : ''}${body}`;
}

/**
 * Mengurai input pengguna menjadi Rupiah bulat.
 * Menerima "1.500.000", "1500000", "1 500 000", "Rp 1.500.000", "-25.000".
 * Mengembalikan null bila tidak dapat diurai.
 */
export function parseRupiahInput(input: string | number | null | undefined): Rupiah | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isSafeInteger(input) ? input : null;
  const cleaned = input.trim().replace(/rp/gi, '').replace(/[\s._]/g, '').replace(/,/g, '.');
  if (cleaned === '' || cleaned === '-') return null;
  const normalized = /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
  if (normalized === null) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  return Number.isSafeInteger(numeric) ? numeric : null;
}

/** Ringkasan pembulatan: berguna untuk audit ketika total tidak habis dibagi. */
export interface RoundingReconciliation {
  readonly target: Rupiah;
  readonly computed: Rupiah;
  readonly delta: Rupiah;
}

/** Membuat ringkasan rekonsiliasi pembulatan. */
export function reconcile(target: Rupiah, parts: readonly Rupiah[]): RoundingReconciliation {
  const computed = sumRupiah(parts);
  return { target, computed, delta: subtractRupiah(target, computed) };
}
