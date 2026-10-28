/**
 * penalties.ts — Perhitungan denda keterlambatan.
 *
 * PRINSIP
 * -------
 * 1. Denda dihitung dari KONFIGURASI yang transparan (jenis, nominal/tarif,
 *    masa tenggang, batas maksimum) dan tidak pernah "diam-diam" mengubah data
 *    historis: satu cicilan hanya memiliki SATU catatan denda aktif
 *    (ditegakkan oleh unique constraint di database).
 * 2. Denda tidak boleh dikenakan dua kali untuk cicilan yang sama. Perhitungan
 *    ulang memperbarui catatan yang sama selama belum dibayar/dibebaskan.
 * 3. Denda tidak dihitung untuk cicilan yang sudah lunas atau dibatalkan.
 * 4. Seluruh hasil perhitungan mengembalikan jejak langkah agar dapat diaudit
 *    (hari terlambat, hari yang dikenakan, dasar perhitungan, apakah dibatasi).
 */

import { applyRate, assertRupiah, clampRupiah, MoneyError, type Rupiah, type RoundingMode, DEFAULT_ROUNDING, ZERO } from '@/lib/money';
import { daysBetweenIso } from '@/lib/date';
import type { PenaltyType } from '@/core/types';

/** Dasar perhitungan denda persentase. */
export const PENALTY_PERCENT_BASES = ['OUTSTANDING', 'TOTAL_DUE'] as const;
export type PenaltyPercentBase = (typeof PENALTY_PERCENT_BASES)[number];

export const PENALTY_PERCENT_BASE_LABELS: Record<PenaltyPercentBase, string> = {
  OUTSTANDING: 'Sisa tagihan cicilan saat ini',
  TOTAL_DUE: 'Total tagihan cicilan (pokok + bunga + biaya)',
};

/** Konfigurasi aturan denda. */
export interface PenaltyRule {
  /** Jenis denda. NONE berarti denda dinonaktifkan. */
  readonly type: PenaltyType;
  /**
   * Nominal dalam Rupiah untuk denda tetap, atau tarif dalam BASIS POINT
   * (1% = 100 bp) untuk denda persentase.
   */
  readonly amount: number;
  /** Masa tenggang dalam hari setelah jatuh tempo sebelum denda mulai berlaku. */
  readonly graceDays: number;
  /** Batas maksimum denda per cicilan. null berarti tanpa batas. */
  readonly maxAmount: Rupiah | null;
  /** Dasar perhitungan untuk denda persentase. */
  readonly percentBase?: PenaltyPercentBase;
  /** Mode pembulatan. */
  readonly rounding?: RoundingMode;
}

/** Aturan denda default: tanpa denda. */
export const DEFAULT_PENALTY_RULE: PenaltyRule = {
  type: 'NONE',
  amount: 0,
  graceDays: 0,
  maxAmount: null,
  percentBase: 'OUTSTANDING',
};

/** Parameter perhitungan denda untuk satu cicilan. */
export interface PenaltyCalculationInput {
  readonly installmentNumber: number;
  readonly dueDate: string;
  /** Tanggal acuan perhitungan (biasanya hari ini). */
  readonly asOf: string;
  /** Total tagihan cicilan. */
  readonly totalDue: Rupiah;
  /** Sisa tagihan cicilan saat ini. */
  readonly outstanding: Rupiah;
  /** Pokok cicilan (opsional, untuk dasar perhitungan tertentu). */
  readonly principal?: Rupiah;
  /** True bila cicilan sudah lunas — denda tidak dihitung. */
  readonly settled?: boolean;
  /** True bila cicilan dibatalkan — denda tidak dihitung. */
  readonly cancelled?: boolean;
  /** Aturan denda yang berlaku. */
  readonly rule: PenaltyRule;
}

/** Hasil perhitungan denda lengkap dengan jejak audit. */
export interface PenaltyCalculation {
  readonly installmentNumber: number;
  readonly dueDate: string;
  readonly asOf: string;
  readonly lateDays: number;
  readonly chargeableDays: number;
  readonly calculatedAmount: Rupiah;
  readonly amount: Rupiah;
  readonly capped: boolean;
  readonly applicable: boolean;
  readonly reason: string;
}

/** Validasi aturan denda. */
export function validatePenaltyRule(rule: PenaltyRule): void {
  if (rule.type === 'NONE') return;
  if (!Number.isFinite(rule.amount) || rule.amount < 0) {
    throw new MoneyError('Nominal/tarif denda tidak valid.');
  }
  if (!Number.isInteger(rule.graceDays) || rule.graceDays < 0) {
    throw new MoneyError('Masa tenggang harus bilangan bulat hari yang tidak negatif.');
  }
  if (rule.maxAmount !== null) {
    assertRupiah(rule.maxAmount, 'batas maksimum denda');
    if (rule.maxAmount < 0) throw new MoneyError('Batas maksimum denda tidak boleh negatif.');
  }
  if (rule.type === 'PERCENT_PER_DAY' || rule.type === 'PERCENT_PER_MONTH') {
    if (rule.amount > 10_000) throw new MoneyError('Tarif denda persentase melebihi 100%.');
    assertRupiah(rule.amount === 0 ? 0 : 1, 'validasi tarif');
  }
}

/** True bila aturan denda aktif. */
export function isPenaltyEnabled(rule: PenaltyRule): boolean {
  return rule.type !== 'NONE' && rule.amount > 0;
}

/**
 * Menghitung denda untuk satu cicilan.
 *
 * Langkah:
 *  1. Hitung hari terlambat = asOf − dueDate (minimum 0).
 *  2. Kurangi masa tenggang → hari yang dikenakan.
 *  3. Terapkan rumus sesuai jenis denda.
 *  4. Batasi dengan batas maksimum bila dikonfigurasi.
 */
export function calculatePenalty(input: PenaltyCalculationInput): PenaltyCalculation {
  const { installmentNumber, dueDate, asOf, totalDue, outstanding, settled, cancelled, rule } = input;
  const base: PenaltyCalculation = {
    installmentNumber,
    dueDate,
    asOf,
    lateDays: 0,
    chargeableDays: 0,
    calculatedAmount: ZERO,
    amount: ZERO,
    capped: false,
    applicable: false,
    reason: '',
  };

  if (cancelled) return { ...base, reason: 'Cicilan dibatalkan — denda tidak berlaku.' };
  if (settled || outstanding <= 0) {
    return { ...base, reason: 'Cicilan sudah lunas — denda tidak berlaku.' };
  }
  if (!isPenaltyEnabled(rule)) {
    return { ...base, reason: 'Aturan denda tidak aktif (tanpa denda).' };
  }

  validatePenaltyRule(rule);

  const lateDays = Math.max(0, daysBetweenIso(dueDate, asOf));
  const chargeableDays = Math.max(0, lateDays - rule.graceDays);
  if (chargeableDays <= 0) {
    return {
      ...base,
      lateDays,
      chargeableDays,
      reason:
        lateDays === 0
          ? 'Belum melewati tanggal jatuh tempo.'
          : `Masih dalam masa tenggang ${rule.graceDays} hari.`,
    };
  }

  const rounding = rule.rounding ?? DEFAULT_ROUNDING;
  const percentBaseAmount = resolvePercentBase(rule, { totalDue, outstanding, principal: input.principal });

  let calculated: Rupiah;
  switch (rule.type) {
    case 'FIXED_PER_DAY':
      calculated = roundProduct(rule.amount, chargeableDays);
      break;
    case 'FIXED_PER_INSTALLMENT':
      calculated = assertRupiah(Math.round(rule.amount), 'denda tetap per cicilan');
      break;
    case 'PERCENT_PER_DAY':
      calculated = applyRate(percentBaseAmount, rule.amount * chargeableDays, 1, rounding);
      break;
    case 'PERCENT_PER_MONTH': {
      const months = Math.ceil(chargeableDays / 30);
      calculated = applyRate(percentBaseAmount, rule.amount * months, 1, rounding);
      break;
    }
    case 'NONE':
    default:
      calculated = ZERO;
      break;
  }

  const capped = rule.maxAmount !== null && calculated > rule.maxAmount;
  const amount = rule.maxAmount !== null ? clampRupiah(calculated, ZERO, rule.maxAmount) : calculated;

  return {
    installmentNumber,
    dueDate,
    asOf,
    lateDays,
    chargeableDays,
    calculatedAmount: calculated,
    amount,
    capped,
    applicable: amount > 0,
    reason: capped
      ? `Dihitung ${calculated} lalu dibatasi maksimum ${rule.maxAmount}.`
      : `Dihitung dari ${chargeableDays} hari keterlambatan (tenggang ${rule.graceDays} hari).`,
  };
}

function roundProduct(amount: number, multiplier: number): Rupiah {
  if (!Number.isFinite(amount) || !Number.isFinite(multiplier)) {
    throw new MoneyError('Parameter denda tidak valid.');
  }
  const result = amount * multiplier;
  return assertRupiah(Math.round(result), 'denda');
}

function resolvePercentBase(
  rule: PenaltyRule,
  values: { totalDue: Rupiah; outstanding: Rupiah; principal?: Rupiah },
): Rupiah {
  switch (rule.percentBase ?? 'OUTSTANDING') {
    case 'TOTAL_DUE':
      return values.totalDue;
    case 'OUTSTANDING':
    default:
      return values.outstanding;
  }
}

/** Menghitung denda untuk banyak cicilan sekaligus. */
export function calculatePenalties(
  items: readonly PenaltyCalculationInput[],
): PenaltyCalculation[] {
  return items.map((item) => calculatePenalty(item));
}

/** Ringkasan denda sebuah kontrak. */
export interface PenaltySummary {
  readonly totalCalculated: Rupiah;
  readonly totalApplied: Rupiah;
  readonly affectedInstallments: number;
  readonly cappedCount: number;
}

/** Menyusun ringkasan dari hasil perhitungan denda. */
export function summarizePenalties(results: readonly PenaltyCalculation[]): PenaltySummary {
  let totalCalculated = ZERO;
  let totalApplied = ZERO;
  let affectedInstallments = 0;
  let cappedCount = 0;

  for (const result of results) {
    totalCalculated += result.calculatedAmount;
    totalApplied += result.amount;
    if (result.applicable) affectedInstallments += 1;
    if (result.capped) cappedCount += 1;
  }

  return { totalCalculated, totalApplied, affectedInstallments, cappedCount };
}

/** Menjelaskan aturan denda dalam bahasa Indonesia. */
export function describePenaltyRule(rule: PenaltyRule): string {
  if (!isPenaltyEnabled(rule)) return 'Tanpa denda. Cicilan yang terlambat tidak dikenakan denda.';
  const grace = rule.graceDays > 0 ? ` setelah masa tenggang ${rule.graceDays} hari` : '';
  const cap = rule.maxAmount !== null ? `, maksimum Rp${rule.maxAmount.toLocaleString('id-ID')} per cicilan` : '';
  switch (rule.type) {
    case 'FIXED_PER_DAY':
      return `Denda Rp${rule.amount.toLocaleString('id-ID')} per hari keterlambatan${grace}${cap}.`;
    case 'FIXED_PER_INSTALLMENT':
      return `Denda tetap Rp${rule.amount.toLocaleString('id-ID')} per cicilan terlambat${grace}${cap}.`;
    case 'PERCENT_PER_DAY':
      return `Denda ${rule.amount / 100}% per hari dari ${PENALTY_PERCENT_BASE_LABELS[rule.percentBase ?? 'OUTSTANDING']}${grace}${cap}.`;
    case 'PERCENT_PER_MONTH':
      return `Denda ${rule.amount / 100}% per bulan (dihitung per 30 hari) dari ${PENALTY_PERCENT_BASE_LABELS[rule.percentBase ?? 'OUTSTANDING']}${grace}${cap}.`;
    case 'NONE':
    default:
      return 'Tanpa denda.';
  }
}
