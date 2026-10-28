/**
 * schedule.ts — Pembentukan jadwal cicilan beserta tanggal jatuh tempo.
 *
 * Sumber angka = `interest.computeInterestPlan()` (murni).
 * Modul ini hanya menambahkan dimensi waktu (tanggal jatuh tempo) dan
 * kebijakan penyesuaian hari kerja / hari libur.
 */

import { addPeriodsIso, assertIsoDate, compareIsoDate, shiftToBusinessDay } from '@/lib/date';
import { sumRupiah, type Rupiah } from '@/lib/money';
import type { InterestPlan, PlanRow } from '@/core/interest';
import type { DueDateAdjustment, PaymentFrequency } from '@/core/types';
import { DEFAULT_WEEKEND_DAYS } from '@/lib/date';

/** Satu baris jadwal cicilan lengkap dengan tanggal. */
export interface ScheduleRow extends PlanRow {
  /** Tanggal jatuh tempo efektif setelah penyesuaian hari kerja. */
  readonly dueDate: string;
  /** Tanggal jatuh tempo sebelum penyesuaian; berguna untuk audit. */
  readonly baseDueDate: string;
  /** True bila tanggal jatuh tempo digeser karena kebijakan hari kerja. */
  readonly adjusted: boolean;
}

/** Parameter pembentukan jadwal. */
export interface BuildScheduleInput {
  /** Rencana angsuran hasil perhitungan bunga. */
  readonly plan: InterestPlan;
  /** Tanggal jatuh tempo cicilan pertama (YYYY-MM-DD). */
  readonly firstDueDate: string;
  /** Kebijakan penyesuaian tanggal jatuh tempo. Default NONE. */
  readonly dueDateAdjustment?: DueDateAdjustment;
  /** Daftar hari libur (YYYY-MM-DD) yang memengaruhi penyesuaian. */
  readonly holidays?: readonly string[];
  /** Hari akhir pekan menurut konfigurasi. Default Minggu & Sabtu. */
  readonly weekendDays?: readonly number[];
}

/** Membentuk jadwal cicilan berpasangan dengan tanggal jatuh tempo. */
export function buildInstallmentSchedule(input: BuildScheduleInput): ScheduleRow[] {
  const {
    plan,
    firstDueDate,
    dueDateAdjustment = 'NONE',
    holidays = [],
    weekendDays = DEFAULT_WEEKEND_DAYS,
  } = input;

  assertIsoDate(firstDueDate, 'tanggal jatuh tempo pertama');
  if (plan.rows.length === 0) throw new Error('Rencana angsuran tidak boleh kosong.');

  return plan.rows.map((row, index) => {
    const baseDueDate = index === 0 ? firstDueDate : addPeriodsIso(firstDueDate, index, plan.frequency);
    const dueDate = adjustDueDate(baseDueDate, dueDateAdjustment, holidays, weekendDays);
    return {
      ...row,
      baseDueDate,
      dueDate,
      adjusted: dueDate !== baseDueDate,
    };
  });
}

/** Menerapkan kebijakan penyesuaian tanggal jatuh tempo. */
export function adjustDueDate(
  baseDueDate: string,
  policy: DueDateAdjustment,
  holidays: readonly string[] = [],
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
): string {
  switch (policy) {
    case 'PREVIOUS_BUSINESS_DAY':
      return shiftToBusinessDay(baseDueDate, 'PREVIOUS', holidays, weekendDays);
    case 'NEXT_BUSINESS_DAY':
      return shiftToBusinessDay(baseDueDate, 'NEXT', holidays, weekendDays);
    case 'NONE':
    default:
      return baseDueDate;
  }
}

/** Ringkasan jadwal: total tagihan, rentang tanggal, dan deteksi anomali. */
export interface ScheduleSummary {
  readonly count: number;
  readonly totalDue: Rupiah;
  readonly totalPrincipal: Rupiah;
  readonly totalInterest: Rupiah;
  readonly totalFees: Rupiah;
  readonly firstDueDate: string;
  readonly lastDueDate: string;
  readonly installmentAmount: Rupiah;
  readonly anomalies: readonly string[];
}

/** Memeriksa konsistensi jadwal (monoton naik, total cocok, tidak ada nilai negatif). */
export function summarizeSchedule(rows: readonly ScheduleRow[]): ScheduleSummary {
  if (rows.length === 0) throw new Error('Jadwal cicilan kosong.');

  const anomalies: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.installmentNumber !== index + 1) {
      anomalies.push(`Nomor cicilan tidak berurutan pada baris ke-${index + 1}.`);
    }
    if (row.principal < 0 || row.interest < 0 || row.fees < 0) {
      anomalies.push(`Nilai negatif pada cicilan ke-${row.installmentNumber}.`);
    }
    if (row.totalDue !== row.principal + row.interest + row.fees) {
      anomalies.push(`Total tagihan tidak konsisten pada cicilan ke-${row.installmentNumber}.`);
    }
    if (index > 0 && compareIsoDate(rows[index - 1]!.dueDate, row.dueDate) >= 0) {
      anomalies.push(`Tanggal jatuh tempo tidak meningkat pada cicilan ke-${row.installmentNumber}.`);
    }
  }

  const totalDue = sumRupiah(rows.map((row) => row.totalDue));
  const totalPrincipal = sumRupiah(rows.map((row) => row.principal));
  const totalInterest = sumRupiah(rows.map((row) => row.interest));
  const totalFees = sumRupiah(rows.map((row) => row.fees));

  if (totalDue !== totalPrincipal + totalInterest + totalFees) {
    anomalies.push('Total keseluruhan tidak sama dengan penjumlahan komponen.');
  }

  return {
    count: rows.length,
    totalDue,
    totalPrincipal,
    totalInterest,
    totalFees,
    firstDueDate: rows[0]!.dueDate,
    lastDueDate: rows[rows.length - 1]!.dueDate,
    installmentAmount: rows.length > 1 ? rows[0]!.totalDue : rows[0]!.totalDue,
    anomalies,
  };
}

/**
 * Menghitung tanggal jatuh tempo terdekat yang masih memiliki sisa tagihan.
 * Bila seluruh kewajiban sudah lunas, mengembalikan null.
 * Cicilan yang sudah melewati jatuh tempo ikut diperhitungkan karena masih
 * merupakan kewajiban berjalan.
 */
export function nextDueDate(
  rows: readonly { dueDate: string; outstanding: Rupiah; status: string }[],
  _today: string,
): string | null {
  const open = rows
    .filter((row) => row.status !== 'CANCELLED' && row.outstanding > 0)
    .sort((a, b) => compareIsoDate(a.dueDate, b.dueDate));
  if (open.length === 0) return null;
  return open[0]!.dueDate;
}

/** Frekuensi → jumlah periode per tahun (duplikasi terkontrol dari interest.ts untuk UI). */
export function periodsPerYearFor(frequency: PaymentFrequency): number {
  const map: Record<PaymentFrequency, number> = {
    MONTHLY: 12,
    BIWEEKLY: 26,
    WEEKLY: 52,
    DAILY: 365,
  };
  return map[frequency];
}
