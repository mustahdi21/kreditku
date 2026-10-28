/**
 * status.ts — Penentuan status cicilan, status kontrak, dan total piutang.
 *
 * Status yang bergantung waktu (jatuh tempo hari ini / terlambat) SELALU
 * dihitung ulang terhadap tanggal acuan, tidak pernah diambil mentah dari
 * database. Database menyimpan fakta (nominal, tanggal, jumlah terbayar),
 * sedangkan status adalah turunan.
 */

import { compareIsoDate, daysBetweenIso } from '@/lib/date';
import { sumRupiah, type Rupiah, ZERO } from '@/lib/money';
import type { ContractStatus, InstallmentStatus } from '@/core/types';

/** Data minimum sebuah cicilan untuk keperluan penentuan status. */
export interface InstallmentLike {
  /** Tanggal jatuh tempo efektif (YYYY-MM-DD). */
  readonly dueDate: string;
  /** Jumlah tagihan pokok + bunga + biaya. */
  readonly totalDue: Rupiah;
  /** Akumulasi pembayaran yang teralokasi ke cicilan ini. */
  readonly paidAmount: Rupiah;
  /** Status tersimpan; hanya CANCELLED yang dipercaya dari penyimpanan. */
  readonly storedStatus?: InstallmentStatus | null;
}

/** Sisa tagihan sebuah cicilan (tidak pernah negatif). */
export function installmentOutstanding(row: Pick<InstallmentLike, 'totalDue' | 'paidAmount'>): Rupiah {
  const outstanding = row.totalDue - row.paidAmount;
  return outstanding > 0 ? outstanding : ZERO;
}

/**
 * Menentukan status cicilan.
 *
 * Urutan pemeriksaan:
 *  1. CANCELLED (dibatalkan melalui prosedur resmi) — mengunci status.
 *  2. Lunas (sisa tagihan nol dan ada tagihan).
 *  3. Dibayar sebagian (ada pembayaran tetapi belum lunas).
 *  4. Terlambat (melewati tanggal jatuh tempo).
 *  5. Jatuh tempo hari ini.
 *  6. Belum jatuh tempo.
 */
export function deriveInstallmentStatus(row: InstallmentLike, today: string): InstallmentStatus {
  if (row.storedStatus === 'CANCELLED') return 'CANCELLED';

  const outstanding = installmentOutstanding(row);
  const hasCharge = row.totalDue > 0;

  if (hasCharge && outstanding === 0) return 'PAID';
  if (row.paidAmount > 0 && outstanding > 0) return 'PARTIAL';

  const diff = compareIsoDate(row.dueDate, today);
  if (diff < 0) return 'OVERDUE';
  if (diff === 0) return 'DUE_TODAY';
  return 'PENDING';
}

/** True bila cicilan melewati jatuh tempo dan masih memiliki sisa tagihan. */
export function isInstallmentOverdue(row: InstallmentLike, today: string): boolean {
  if (row.storedStatus === 'CANCELLED') return false;
  if (installmentOutstanding(row) === 0) return false;
  return compareIsoDate(row.dueDate, today) < 0;
}

/** Jumlah hari keterlambatan (0 bila belum lewat jatuh tempo). */
export function daysLate(row: Pick<InstallmentLike, 'dueDate'>, today: string): number {
  const diff = daysBetweenIso(row.dueDate, today);
  return diff > 0 ? diff : 0;
}

/** Ember umur tunggakan yang dapat dikonfigurasi. */
export const DEFAULT_AGING_BOUNDS: readonly number[] = [7, 30, 60, 90];

export const AGING_BUCKET_LABELS = {
  CURRENT: 'Belum Jatuh Tempo',
  D1_7: '1–7 hari',
  D8_30: '8–30 hari',
  D31_60: '31–60 hari',
  D61_90: '61–90 hari',
  D90_PLUS: 'Lebih dari 90 hari',
} as const;

export type AgingBucket = keyof typeof AGING_BUCKET_LABELS;

/** Menentukan ember umur tunggakan dari jumlah hari keterlambatan. */
export function resolveAgingBucket(
  lateDays: number,
  bounds: readonly number[] = DEFAULT_AGING_BOUNDS,
): AgingBucket {
  const [b1 = 7, b2 = 30, b3 = 60, b4 = 90] = bounds;
  if (lateDays <= 0) return 'CURRENT';
  if (lateDays <= b1) return 'D1_7';
  if (lateDays <= b2) return 'D8_30';
  if (lateDays <= b3) return 'D31_60';
  if (lateDays <= b4) return 'D61_90';
  return 'D90_PLUS';
}

/** Rincian angka tunggakan yang dibutuhkan laporan umur piutang. */
export interface OverdueBreakdown {
  readonly installment: InstallmentLike & { readonly installmentNumber: number };
  readonly lateDays: number;
  readonly bucket: AgingBucket;
  readonly outstanding: Rupiah;
}

/** Mengelompokkan tunggakan berdasarkan ember umur. */
export function groupOverdueByAging(
  rows: readonly (InstallmentLike & { readonly installmentNumber: number })[],
  today: string,
  bounds: readonly number[] = DEFAULT_AGING_BOUNDS,
): Record<AgingBucket, OverdueBreakdown[]> {
  const result: Record<AgingBucket, OverdueBreakdown[]> = {
    CURRENT: [],
    D1_7: [],
    D8_30: [],
    D31_60: [],
    D61_90: [],
    D90_PLUS: [],
  };

  for (const row of rows) {
    if (!isInstallmentOverdue(row, today)) continue;
    const late = daysLate(row, today);
    const bucket = resolveAgingBucket(late, bounds);
    result[bucket].push({
      installment: row,
      lateDays: late,
      bucket,
      outstanding: installmentOutstanding(row),
    });
  }

  for (const key of Object.keys(result) as AgingBucket[]) {
    result[key].sort((a, b) => b.lateDays - a.lateDays);
  }
  return result;
}

/** Data minimum sebuah kontrak untuk keperluan penentuan status. */
export interface ContractLike {
  readonly status?: ContractStatus | null;
  readonly cancelledAt?: string | null;
  readonly restructuredAt?: string | null;
}

/** Total terhitung untuk sebuah kontrak. */
export interface ContractTotals {
  readonly totalPayable: Rupiah;
  readonly totalPrincipal: Rupiah;
  readonly totalInterest: Rupiah;
  readonly totalFees: Rupiah;
  readonly totalPaid: Rupiah;
  readonly outstanding: Rupiah;
  readonly overdueAmount: Rupiah;
  readonly dueTodayAmount: Rupiah;
  readonly paidInstallments: number;
  readonly partialInstallments: number;
  readonly overdueInstallments: number;
  readonly openInstallments: number;
  readonly progressPercent: number;
  readonly nextDueDate: string | null;
  readonly maxDaysLate: number;
  readonly settled: boolean;
}

/** Menghitung seluruh total kontrak dari daftar cicilan. */
export function computeContractTotals(
  rows: readonly (InstallmentLike & { readonly installmentNumber: number })[],
  today: string,
): ContractTotals {
  const active = rows.filter((row) => row.storedStatus !== 'CANCELLED');
  const totalPayable = sumRupiah(active.map((row) => row.totalDue));
  const totalPaid = sumRupiah(active.map((row) => row.paidAmount));
  const outstanding = sumRupiah(active.map((row) => installmentOutstanding(row)));

  let overdueAmount = ZERO;
  let dueTodayAmount = ZERO;
  let paidInstallments = 0;
  let partialInstallments = 0;
  let overdueInstallments = 0;
  let openInstallments = 0;
  let maxDaysLate = 0;
  let nextDueDate: string | null = null;
  let totalPrincipal = ZERO;
  let totalInterest = ZERO;
  let totalFees = ZERO;

  const extended = active as readonly (InstallmentLike & {
    readonly installmentNumber: number;
    readonly principal?: Rupiah;
    readonly interest?: Rupiah;
    readonly fees?: Rupiah;
  })[];

  for (const row of extended) {
    totalPrincipal += row.principal ?? ZERO;
    totalInterest += row.interest ?? ZERO;
    totalFees += row.fees ?? ZERO;

    const status = deriveInstallmentStatus(row, today);
    const open = installmentOutstanding(row);

    if (status === 'PAID') {
      paidInstallments += 1;
    } else {
      openInstallments += 1;
      if (status === 'PARTIAL') partialInstallments += 1;
      if (status === 'DUE_TODAY') dueTodayAmount += open;

      // Tunggakan dihitung dari TANGGAL + SISA TAGIHAN, bukan dari label status,
      // sehingga cicilan yang dibayar sebagian dan sudah lewat jatuh tempo tetap
      // tercatat sebagai tunggakan (sisa tagihannya nyata dan harus ditagih).
      if (open > 0 && compareIsoDate(row.dueDate, today) < 0) {
        overdueInstallments += 1;
        overdueAmount += open;
        const late = daysLate(row, today);
        if (late > maxDaysLate) maxDaysLate = late;
      }
    }

    if (open > 0) {
      if (nextDueDate === null || compareIsoDate(row.dueDate, nextDueDate) < 0) {
        nextDueDate = row.dueDate;
      }
    }
  }

  const progressPercent = totalPayable > 0 ? Math.round((totalPaid / totalPayable) * 1000) / 10 : 0;

  return {
    totalPayable,
    totalPrincipal,
    totalInterest,
    totalFees,
    totalPaid,
    outstanding,
    overdueAmount,
    dueTodayAmount,
    paidInstallments,
    partialInstallments,
    overdueInstallments,
    openInstallments,
    progressPercent,
    nextDueDate,
    maxDaysLate,
    settled: active.length > 0 && outstanding === 0,
  };
}

/**
 * Menentukan status kontrak.
 *
 * Aturan:
 *  - Dibatalkan melalui prosedur resmi → CANCELLED.
 *  - Ditandai restrukturisasi → RESTRUCTURED.
 *  - Tidak ada sisa kewajiban → PAID_OFF.
 *  - Ada cicilan melewati jatuh tempo → DELINQUENT.
 *  - Selain itu → ACTIVE.
 *
 * Kontrak TIDAK PERNAH dianggap lunas hanya karena satu cicilan terbayar;
 * keputusan selalu berdasarkan sisa kewajiban seluruh cicilan.
 */
export function deriveContractStatus(
  contract: ContractLike,
  rows: readonly (InstallmentLike & { readonly installmentNumber: number })[],
  today: string,
): ContractStatus {
  if (contract.status === 'CANCELLED' || contract.cancelledAt) return 'CANCELLED';
  const totals = computeContractTotals(rows, today);
  if (totals.settled) return 'PAID_OFF';
  if (contract.status === 'RESTRUCTURED' || contract.restructuredAt) return 'RESTRUCTURED';
  if (totals.overdueInstallments > 0) return 'DELINQUENT';
  return 'ACTIVE';
}

/** Status kontrak yang dianggap masih berjalan (masih memiliki piutang). */
export const OPEN_CONTRACT_STATUSES: readonly ContractStatus[] = [
  'ACTIVE',
  'DELINQUENT',
  'RESTRUCTURED',
];

/** True bila kontrak masih memiliki piutang berjalan. */
export function isContractOpen(status: ContractStatus): boolean {
  return OPEN_CONTRACT_STATUSES.includes(status);
}

/** Menentukan status pelanggan otomatis dari kondisi kontrak-kontraknya. */
export type DerivedCustomerStatus = 'PROSPECT' | 'ACTIVE' | 'DELINQUENT' | 'PAID_OFF' | 'BLOCKED';

export function deriveCustomerStatus(params: {
  readonly storedStatus?: string | null;
  readonly contractStatuses: readonly ContractStatus[];
  readonly hasAnyContract: boolean;
}): DerivedCustomerStatus {
  if (params.storedStatus === 'BLOCKED') return 'BLOCKED';
  if (params.storedStatus === 'ARCHIVED') {
    return params.contractStatuses.some((status) => status === 'DELINQUENT') ? 'DELINQUENT' : 'PAID_OFF';
  }
  if (!params.hasAnyContract) return 'PROSPECT';
  if (params.contractStatuses.some((status) => status === 'DELINQUENT')) return 'DELINQUENT';
  if (params.contractStatuses.some((status) => isContractOpen(status))) return 'ACTIVE';
  return 'PAID_OFF';
}
