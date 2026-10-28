/**
 * allocation.ts — Alokasi pembayaran ke cicilan dan/atau denda.
 *
 * ATURAN
 * -----
 * 1. Pembayaran TIDAK PERNAH mengalokasikan lebih dari sisa kewajiban cicilan
 *    (kecuali kelebihan bayar diizinkan secara eksplisit oleh konfigurasi).
 * 2. Urutan alokasi ditentukan konfigurasi: OLDEST_FIRST (default),
 *    NEWEST_FIRST, atau MANUAL (urutan mengikuti daftar yang diberikan).
 * 3. Bila `penaltyFirst` aktif, denda cicilan dilunasi lebih dulu, baru tagihan.
 * 4. Hasil alokasi bersifat deterministik dan lengkap dengan sisa setelah alokasi,
 *    sehingga pemanggil dapat memverifikasi saldo hasil tanpa menghitung ulang.
 */

import { assertPositive, assertRupiah, MoneyError, sumRupiah, type Rupiah, ZERO } from '@/lib/money';
import { compareIsoDate } from '@/lib/date';
import type { AllocationOrder } from '@/core/types';

/** Informasi cicilan yang dapat menerima alokasi pembayaran. */
export interface AllocationTarget {
  readonly installmentId: string;
  readonly installmentNumber: number;
  readonly dueDate: string;
  /** Total tagihan cicilan. */
  readonly totalDue: Rupiah;
  /** Akumulasi pembayaran yang sudah teralokasi. */
  readonly paidAmount: Rupiah;
  /** Sisa denda yang belum dibayar untuk cicilan ini. */
  readonly penaltyOutstanding?: Rupiah;
}

/** Satu baris hasil alokasi. */
export interface AllocationLine {
  readonly installmentId: string;
  readonly installmentNumber: number;
  readonly dueDate: string;
  readonly toPenalty: Rupiah;
  readonly toInstallment: Rupiah;
  readonly total: Rupiah;
  readonly resultingPaidAmount: Rupiah;
  readonly resultingPenaltyOutstanding: Rupiah;
  readonly resultingOutstanding: Rupiah;
}

/** Hasil lengkap sebuah alokasi. */
export interface AllocationResult {
  readonly allocations: readonly AllocationLine[];
  readonly totalAllocated: Rupiah;
  readonly allocatedToPenalty: Rupiah;
  readonly allocatedToInstallment: Rupiah;
  readonly unallocated: Rupiah;
}

/** Parameter alokasi pembayaran. */
export interface AllocatePaymentInput {
  /** Nominal pembayaran yang akan dialokasikan. */
  readonly amount: Rupiah;
  /** Daftar cicilan yang menjadi kandidat alokasi. */
  readonly targets: readonly AllocationTarget[];
  /** Urutan alokasi. Default OLDEST_FIRST. */
  readonly order?: AllocationOrder;
  /** Lunasi denda cicilan lebih dulu. Default false. */
  readonly penaltyFirst?: boolean;
  /** Izinkan sisa yang tidak teralokasi (kelebihan bayar). Default false. */
  readonly allowOverpayment?: boolean;
}

/** Sisa tagihan cicilan. */
export function outstandingOf(target: AllocationTarget): Rupiah {
  const value = target.totalDue - target.paidAmount;
  return value > 0 ? value : ZERO;
}

/** Total kewajiban terbuka (tagihan + denda) dari daftar target. */
export function totalOpenLiability(targets: readonly AllocationTarget[]): Rupiah {
  return sumRupiah(targets.map((target) => outstandingOf(target) + (target.penaltyOutstanding ?? ZERO)));
}

/** True bila seluruh target sudah lunas (tagihan dan denda). */
export function isFullySettled(targets: readonly AllocationTarget[]): boolean {
  return totalOpenLiability(targets) === 0;
}

/** Mengurutkan target sesuai kebijakan alokasi. */
export function sortTargets(
  targets: readonly AllocationTarget[],
  order: AllocationOrder,
): AllocationTarget[] {
  const copy = [...targets];
  if (order === 'MANUAL') return copy;
  copy.sort((a, b) => {
    const byDate = compareIsoDate(a.dueDate, b.dueDate);
    if (byDate !== 0) return order === 'OLDEST_FIRST' ? byDate : -byDate;
    return order === 'OLDEST_FIRST'
      ? a.installmentNumber - b.installmentNumber
      : b.installmentNumber - a.installmentNumber;
  });
  return copy;
}

/**
 * Mengalokasikan pembayaran ke cicilan-cicilan target.
 * Melempar MoneyError bila masih ada sisa yang tidak teralokasi dan
 * kelebihan bayar tidak diizinkan.
 */
export function allocatePayment(input: AllocatePaymentInput): AllocationResult {
  const { amount, targets, order = 'OLDEST_FIRST', penaltyFirst = false, allowOverpayment = false } = input;

  assertRupiah(amount, 'nominal pembayaran');
  if (amount < 0) throw new MoneyError('Nominal pembayaran tidak boleh negatif.');
  if (amount === 0) throw new MoneyError('Nominal pembayaran harus lebih besar dari nol.');

  const ordered = sortTargets(targets, order);
  let remaining = amount;

  const allocations: AllocationLine[] = [];

  for (const target of ordered) {
    if (remaining <= 0) break;

    const openInstallment = outstandingOf(target);
    const openPenalty = target.penaltyOutstanding ?? ZERO;
    if (openInstallment === 0 && openPenalty === 0) continue;

    let toPenalty = ZERO;
    let toInstallment = ZERO;

    const payPenalty = () => {
      if (remaining <= 0) return;
      const take = Math.min(remaining, openPenalty - toPenalty);
      if (take > 0) {
        toPenalty += take;
        remaining -= take;
      }
    };
    const payInstallment = () => {
      if (remaining <= 0) return;
      const take = Math.min(remaining, openInstallment - toInstallment);
      if (take > 0) {
        toInstallment += take;
        remaining -= take;
      }
    };

    if (penaltyFirst) {
      payPenalty();
      payInstallment();
    } else {
      payInstallment();
      payPenalty();
    }

    if (toPenalty === 0 && toInstallment === 0) continue;

    allocations.push({
      installmentId: target.installmentId,
      installmentNumber: target.installmentNumber,
      dueDate: target.dueDate,
      toPenalty,
      toInstallment,
      total: toPenalty + toInstallment,
      resultingPaidAmount: target.paidAmount + toInstallment,
      resultingPenaltyOutstanding: openPenalty - toPenalty,
      resultingOutstanding: openInstallment - toInstallment,
    });
  }

  const unallocated = remaining;
  if (unallocated > 0 && !allowOverpayment) {
    throw new MoneyError(
      `Nominal pembayaran melebihi total kewajiban terbuka. Kelebihan: ${unallocated}. ` +
        'Aktifkan kebijakan kelebihan bayar pada pengaturan bila hal ini disengaja.',
    );
  }

  return {
    allocations,
    totalAllocated: sumRupiah(allocations.map((line) => line.total)),
    allocatedToPenalty: sumRupiah(allocations.map((line) => line.toPenalty)),
    allocatedToInstallment: sumRupiah(allocations.map((line) => line.toInstallment)),
    unallocated,
  };
}

/**
 * Memvalidasi nominal pembayaran terhadap kewajiban terbuka.
 * Dipakai UI sebelum mengirim permintaan ke database.
 */
export function validatePaymentAmount(params: {
  readonly amount: Rupiah;
  readonly targets: readonly AllocationTarget[];
  readonly allowOverpayment?: boolean;
}): { valid: boolean; message?: string; excess: Rupiah } {
  const { amount, targets, allowOverpayment = false } = params;
  const liability = totalOpenLiability(targets);
  if (amount <= 0) return { valid: false, message: 'Nominal pembayaran harus lebih besar dari nol.', excess: ZERO };
  if (liability === 0) {
    return { valid: false, message: 'Tidak ada kewajiban terbuka pada kontrak ini.', excess: ZERO };
  }
  if (amount > liability) {
    const excess = amount - liability;
    return {
      valid: allowOverpayment,
      message: allowOverpayment
        ? `Kelebihan bayar ${excess} akan dicatat sebagai saldo titipan pelanggan.`
        : `Nominal melebihi total kewajiban terbuka (${liability}).`,
      excess,
    };
  }
  return { valid: true, excess: ZERO };
}

/** Nomor urut alokasi untuk disimpan bersama pembayaran. */
export function buildAllocationRecords(
  paymentId: string,
  result: AllocationResult,
): { payment_id: string; installment_id: string; amount: Rupiah; penalty_amount: Rupiah }[] {
  return result.allocations.map((line) => ({
    payment_id: paymentId,
    installment_id: line.installmentId,
    amount: line.toInstallment,
    penalty_amount: line.toPenalty,
  }));
}

/**
 * Memeriksa idempotency key.
 * Format yang diterima: string 16–128 karakter, hanya huruf, angka, tanda hubung
 * dan garis bawah. Kunci digunakan untuk mencegah pembayaran ganda saat tombol
 * disubmit berkali-kali.
 */
export function isValidIdempotencyKey(key: string | null | undefined): boolean {
  if (typeof key !== 'string') return false;
  return /^[A-Za-z0-9_-]{16,128}$/.test(key);
}

/** Menghasilkan idempotency key sederhana dari komponen yang tersedia. */
export function buildIdempotencyKey(parts: readonly (string | number)[]): string {
  const raw = parts.map((part) => String(part)).join('-');
  const normalized = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  if (normalized.length >= 16) return normalized;
  return `pay-${normalized}-${Date.now().toString(36)}`.slice(0, 128);
}

/** Validasi reversal: alasan wajib dan nominal tidak melebihi pembayaran asal. */
export function validateReversal(params: {
  readonly paymentAmount: Rupiah;
  readonly reason: string;
  readonly alreadyReversed?: boolean;
}): { valid: boolean; message?: string } {
  if (params.alreadyReversed) return { valid: false, message: 'Pembayaran ini sudah pernah dibatalkan.' };
  if (!params.reason || params.reason.trim().length < 5) {
    return { valid: false, message: 'Alasan pembatalan wajib diisi minimal 5 karakter.' };
  }
  assertPositive(params.paymentAmount, 'nominal pembayaran');
  return { valid: true };
}
