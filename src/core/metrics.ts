/**
 * metrics.ts — Definisi metrik dashboard dan laporan.
 *
 * DEFINISI METRIK (dipakai konsisten di seluruh aplikasi)
 * ------------------------------------------------------
 * Nilai pembiayaan disetujui : jumlah `principal` (pokok pembiayaan setelah uang muka)
 *                              dari pengajuan berstatus APPROVED pada periode filter.
 * Total pencairan            : jumlah pokok kontrak yang tanggal pencairannya
 *                              (`disbursed_at`) berada dalam periode filter.
 * Piutang berjalan           : Σ sisa tagihan seluruh cicilan yang belum lunas
 *                              pada kontrak berstatus ACTIVE/DELINQUENT/RESTRUCTURED.
 * Pembayaran diterima        : Σ nominal pembayaran berstatus POSTED (pembayaran yang
 *                              dibatalkan TIDAK dihitung) pada periode filter.
 * Tunggakan                  : Σ sisa tagihan cicilan yang melewati tanggal jatuh tempo.
 * Jatuh tempo hari ini       : Σ sisa tagihan cicilan yang jatuh tempo tepat hari ini.
 * Denda belum dibayar        : Σ (nominal denda − yang dibayar − yang dibebaskan)
 *                              untuk denda berstatus OPEN.
 * Tingkat tepat waktu        : cicilan yang dibayar penuh dengan tanggal pembayaran
 *                              ≤ tanggal jatuh tempo ÷ seluruh cicilan yang sudah lunas.
 * Rasio kredit bermasalah    : sisa tagihan cicilan yang terlambat > 90 hari ÷ piutang berjalan.
 * Arus kas                   : pembayaran POSTED − pembatalan (reversal) pada periode filter.
 * Pendapatan bunga           : Σ komponen BUNGA dari alokasi pembayaran pada periode filter.
 *                              BUKAN seluruh penerimaan kas.
 * Pendapatan administrasi    : Σ biaya administrasi pada kontrak yang dicairkan
 *                              dalam periode filter.
 *
 * PERINGATAN: seluruh penerimaan kas TIDAK sama dengan keuntungan. Pokok yang
 * kembali hanyalah pengembalian modal, bukan pendapatan.
 */

import { sumRupiah, type Rupiah, ZERO } from '@/lib/money';
import { compareIsoDate, daysBetweenIso, isWithinIsoRange } from '@/lib/date';
import {
  computeContractTotals,
  daysLate,
  installmentOutstanding,
  isInstallmentOverdue,
  resolveAgingBucket,
  type AgingBucket,
  type InstallmentLike,
} from '@/core/status';
import type { ContractStatus, PaymentStatus } from '@/core/types';

/** Data kontrak minimum untuk agregasi portofolio. */
export interface PortfolioContract {
  readonly id: string;
  readonly status: ContractStatus;
  readonly principal: Rupiah;
  readonly totalPayable: Rupiah;
  readonly totalPaid: Rupiah;
  readonly outstanding: Rupiah;
  readonly disbursedAt: string | null;
  readonly createdAt: string;
}

/** Data cicilan minimum untuk agregasi portofolio. */
export interface PortfolioInstallment extends InstallmentLike {
  readonly id: string;
  readonly contractId: string;
  readonly installmentNumber: number;
  readonly principal: Rupiah;
  readonly interest: Rupiah;
  readonly fees: Rupiah;
  /** Tanggal pembayaran terakhir (YYYY-MM-DD) atau null. */
  readonly lastPaymentDate?: string | null;
}

/** Data pembayaran minimum untuk agregasi kas. */
export interface PortfolioPayment {
  readonly id: string;
  readonly contractId: string;
  readonly amount: Rupiah;
  readonly status: PaymentStatus;
  /** Tanggal pembayaran (YYYY-MM-DD). */
  readonly paidDate: string;
  readonly method: string;
  readonly createdBy?: string | null;
}

/** Data pengajuan minimum untuk agregasi. */
export interface PortfolioApplication {
  readonly id: string;
  readonly status: string;
  readonly principal: Rupiah;
  readonly price: Rupiah;
  readonly downPayment: Rupiah;
  readonly createdAt: string;
  readonly decidedAt?: string | null;
  readonly decidedBy?: string | null;
  readonly createdBy?: string | null;
}

/** Data denda minimum untuk agregasi. */
export interface PortfolioPenalty {
  readonly id: string;
  readonly installmentId: string;
  readonly amount: Rupiah;
  readonly paidAmount: Rupiah;
  readonly waivedAmount: Rupiah;
  readonly status: string;
  readonly createdAt: string;
}

/** Data pelanggan minimum untuk agregasi. */
export interface PortfolioCustomer {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
}

/** Parameter perhitungan metrik dashboard. */
export interface MetricsInput {
  readonly today: string;
  readonly range: { readonly from: string; readonly to: string };
  readonly contracts: readonly PortfolioContract[];
  readonly installments: readonly PortfolioInstallment[];
  readonly payments: readonly PortfolioPayment[];
  readonly applications: readonly PortfolioApplication[];
  readonly penalties: readonly PortfolioPenalty[];
  readonly customers: readonly PortfolioCustomer[];
}

/** Hasil perhitungan metrik dashboard. */
export interface DashboardMetrics {
  readonly activeCustomers: number;
  readonly newCustomersInRange: number;
  readonly applicationsInRange: number;
  readonly applicationsPending: number;
  readonly approvedFinancingInRange: Rupiah;
  readonly disbursedInRange: Rupiah;
  readonly activeContracts: number;
  readonly paidOffContracts: number;
  readonly delinquentContracts: number;
  readonly outstandingTotal: Rupiah;
  readonly overdueTotal: Rupiah;
  readonly dueTodayTotal: Rupiah;
  readonly dueTodayCount: number;
  readonly overdueCount: number;
  readonly penaltyOutstanding: Rupiah;
  readonly collectionsInRange: Rupiah;
  readonly reversalsInRange: Rupiah;
  readonly netCashInRange: Rupiah;
  readonly interestIncomeInRange: Rupiah;
  readonly principalRecoveredInRange: Rupiah;
  readonly onTimeRatePercent: number;
  readonly nplRatioPercent: number;
  readonly collectionRatePercent: number;
  readonly contractStatusDistribution: Record<ContractStatus, number>;
  readonly agingDistribution: Record<AgingBucket, { count: number; amount: Rupiah }>;
}

const OPEN_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'DELINQUENT', 'RESTRUCTURED'];

/** Menghitung seluruh metrik dashboard dari data mentah. */
export function computeDashboardMetrics(input: MetricsInput): DashboardMetrics {
  const { today, range, contracts, installments, payments, applications, penalties, customers } = input;

  const openContractIds = new Set(
    contracts.filter((contract) => OPEN_STATUSES.includes(contract.status)).map((contract) => contract.id),
  );

  const openInstallments = installments.filter((row) => openContractIds.has(row.contractId));

  let outstandingTotal = ZERO;
  let overdueTotal = ZERO;
  let dueTodayTotal = ZERO;
  let dueTodayCount = 0;
  let overdueCount = 0;
  let longOverdueOutstanding = ZERO;
  let onTimePaid = 0;
  let totalPaidInstallments = 0;

  const agingDistribution: Record<AgingBucket, { count: number; amount: Rupiah }> = {
    CURRENT: { count: 0, amount: ZERO },
    D1_7: { count: 0, amount: ZERO },
    D8_30: { count: 0, amount: ZERO },
    D31_60: { count: 0, amount: ZERO },
    D61_90: { count: 0, amount: ZERO },
    D90_PLUS: { count: 0, amount: ZERO },
  };

  for (const row of openInstallments) {
    const outstanding = installmentOutstanding(row);
    if (outstanding > 0) outstandingTotal += outstanding;

    // Tunggakan ditentukan oleh TANGGAL + SISA TAGIHAN sehingga cicilan yang
    // dibayar sebagian dan sudah lewat jatuh tempo tetap masuk sebagai tunggakan.
    if (isInstallmentOverdue(row, today)) {
      overdueTotal += outstanding;
      overdueCount += 1;
      const late = daysLate(row, today);
      const bucket = resolveAgingBucket(late);
      agingDistribution[bucket].count += 1;
      agingDistribution[bucket].amount += outstanding;
      if (late > 90) longOverdueOutstanding += outstanding;
    } else if (outstanding > 0) {
      if (compareIsoDate(row.dueDate, today) === 0) {
        dueTodayTotal += outstanding;
        dueTodayCount += 1;
      }
      agingDistribution.CURRENT.count += 1;
      agingDistribution.CURRENT.amount += outstanding;
    }

    if (row.paidAmount >= row.totalDue && row.totalDue > 0) {
      totalPaidInstallments += 1;
      if (row.lastPaymentDate && compareIsoDate(row.lastPaymentDate, row.dueDate) <= 0) onTimePaid += 1;
    }
  }

  const penaltyOutstanding = sumRupiah(
    penalties
      .filter((penalty) => penalty.status === 'OPEN')
      .map((penalty) => Math.max(0, penalty.amount - penalty.paidAmount - penalty.waivedAmount)),
  );

  const postedInRange = payments.filter(
    (payment) => payment.status === 'POSTED' && isWithinIsoRange(payment.paidDate, range.from, range.to),
  );
  const reversedInRange = payments.filter(
    (payment) => payment.status === 'REVERSED' && isWithinIsoRange(payment.paidDate, range.from, range.to),
  );

  const collectionsInRange = sumRupiah(postedInRange.map((payment) => payment.amount));
  const reversalsInRange = sumRupiah(reversedInRange.map((payment) => payment.amount));

  const disbursedInRange = sumRupiah(
    contracts
      .filter((contract) => contract.disbursedAt && isWithinIsoRange(contract.disbursedAt, range.from, range.to))
      .map((contract) => contract.principal),
  );

  const applicationsInRange = applications.filter((application) =>
    isWithinIsoRange(application.createdAt.slice(0, 10), range.from, range.to),
  );
  const approvedFinancingInRange = sumRupiah(
    applicationsInRange.filter((application) => application.status === 'APPROVED').map((a) => a.principal),
  );

  const contractStatusDistribution: Record<ContractStatus, number> = {
    ACTIVE: 0,
    PAID_OFF: 0,
    DELINQUENT: 0,
    RESTRUCTURED: 0,
    CANCELLED: 0,
  };
  for (const contract of contracts) contractStatusDistribution[contract.status] += 1;

  const onTimeRatePercent =
    totalPaidInstallments > 0 ? round1((onTimePaid / totalPaidInstallments) * 100) : 0;
  const nplRatioPercent = outstandingTotal > 0 ? round1((longOverdueOutstanding / outstandingTotal) * 100) : 0;

  const dueInRange = sumRupiah(
    openInstallments
      .filter((row) => isWithinIsoRange(row.dueDate, range.from, range.to))
      .map((row) => row.totalDue),
  );
  const collectionRatePercent = dueInRange > 0 ? round1((collectionsInRange / dueInRange) * 100) : 0;

  return {
    activeCustomers: customers.filter((customer) => ['ACTIVE', 'DELINQUENT'].includes(customer.status)).length,
    newCustomersInRange: customers.filter((customer) =>
      isWithinIsoRange(customer.createdAt.slice(0, 10), range.from, range.to),
    ).length,
    applicationsInRange: applicationsInRange.length,
    applicationsPending: applications.filter((application) =>
      ['SUBMITTED', 'UNDER_REVIEW', 'DRAFT'].includes(application.status),
    ).length,
    approvedFinancingInRange,
    disbursedInRange,
    activeContracts: contractStatusDistribution.ACTIVE + contractStatusDistribution.DELINQUENT + contractStatusDistribution.RESTRUCTURED,
    paidOffContracts: contractStatusDistribution.PAID_OFF,
    delinquentContracts: contractStatusDistribution.DELINQUENT,
    outstandingTotal,
    overdueTotal,
    dueTodayTotal,
    dueTodayCount,
    overdueCount,
    penaltyOutstanding,
    collectionsInRange,
    reversalsInRange,
    netCashInRange: collectionsInRange - reversalsInRange,
    interestIncomeInRange: ZERO,
    principalRecoveredInRange: ZERO,
    onTimeRatePercent,
    nplRatioPercent,
    collectionRatePercent,
    contractStatusDistribution,
    agingDistribution,
  };
}

/** Satu titik data deret waktu pembayaran. */
export interface PaymentSeriesPoint {
  readonly period: string;
  readonly label: string;
  readonly amount: Rupiah;
  readonly count: number;
  readonly reversalAmount: Rupiah;
}

/** Membentuk deret pembayaran harian antara dua tanggal (inklusif). */
export function buildDailyPaymentSeries(
  payments: readonly PortfolioPayment[],
  from: string,
  to: string,
): PaymentSeriesPoint[] {
  const buckets = new Map<string, { amount: Rupiah; count: number; reversalAmount: Rupiah }>();
  let cursor = from;
  let guard = 0;
  while (compareIsoDate(cursor, to) <= 0 && guard < 400) {
    buckets.set(cursor, { amount: ZERO, count: 0, reversalAmount: ZERO });
    cursor = shiftOneDay(cursor);
    guard += 1;
  }

  for (const payment of payments) {
    const bucket = buckets.get(payment.paidDate);
    if (!bucket) continue;
    if (payment.status === 'POSTED') {
      bucket.amount += payment.amount;
      bucket.count += 1;
    } else {
      bucket.reversalAmount += payment.amount;
    }
  }

  return [...buckets.entries()].map(([period, value]) => ({
    period,
    label: period.slice(8, 10) + '/' + period.slice(5, 7),
    amount: value.amount,
    count: value.count,
    reversalAmount: value.reversalAmount,
  }));
}

/** Membentuk deret pembayaran bulanan. */
export function buildMonthlyPaymentSeries(
  payments: readonly PortfolioPayment[],
  months: readonly string[],
): PaymentSeriesPoint[] {
  const buckets = new Map<string, { amount: Rupiah; count: number; reversalAmount: Rupiah }>();
  for (const month of months) buckets.set(month, { amount: ZERO, count: 0, reversalAmount: ZERO });

  for (const payment of payments) {
    const key = `${payment.paidDate.slice(0, 7)}-01`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (payment.status === 'POSTED') {
      bucket.amount += payment.amount;
      bucket.count += 1;
    } else {
      bucket.reversalAmount += payment.amount;
    }
  }

  return [...buckets.entries()].map(([period, value]) => ({
    period,
    label: MONTH_LABELS[Number(period.slice(5, 7)) - 1] ?? period.slice(0, 7),
    amount: value.amount,
    count: value.count,
    reversalAmount: value.reversalAmount,
  }));
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/** Kinerja seorang petugas. */
/**
 * Kinerja seorang petugas.
 * Field tidak ditandai readonly karena struktur ini dipakai sebagai akumulator
 * selama agregasi, lalu dikembalikan sebagai hasil akhir.
 */
export interface OfficerPerformance {
  officerId: string;
  paymentsCount: number;
  paymentsAmount: Rupiah;
  applicationsCount: number;
  approvalsCount: number;
  rejectionsCount: number;
  approvalRatePercent: number;
}

/** Menghitung kinerja petugas dari pembayaran dan keputusan pengajuan. */
export function computeOfficerPerformance(
  payments: readonly PortfolioPayment[],
  applications: readonly PortfolioApplication[],
): OfficerPerformance[] {
  const map = new Map<string, OfficerPerformance>();

  const ensure = (id: string): OfficerPerformance => {
    const existing = map.get(id);
    if (existing) return existing;
    const created: OfficerPerformance = {
      officerId: id,
      paymentsCount: 0,
      paymentsAmount: ZERO,
      applicationsCount: 0,
      approvalsCount: 0,
      rejectionsCount: 0,
      approvalRatePercent: 0,
    };
    map.set(id, created);
    return created;
  };

  for (const payment of payments) {
    if (payment.status !== 'POSTED' || !payment.createdBy) continue;
    const entry = ensure(payment.createdBy);
    entry.paymentsCount += 1;
    entry.paymentsAmount += payment.amount;
  }

  for (const application of applications) {
    if (application.createdBy) {
      const entry = ensure(application.createdBy);
      entry.applicationsCount += 1;
    }
    if (application.decidedBy && ['APPROVED', 'REJECTED'].includes(application.status)) {
      const entry = ensure(application.decidedBy);
      if (application.status === 'APPROVED') entry.approvalsCount += 1;
      else entry.rejectionsCount += 1;
    }
  }

  for (const entry of map.values()) {
    const decisions = entry.approvalsCount + entry.rejectionsCount;
    entry.approvalRatePercent = decisions > 0 ? round1((entry.approvalsCount / decisions) * 100) : 0;
  }

  return [...map.values()].sort((a, b) => b.paymentsAmount - a.paymentsAmount);
}

/** Ringkasan laporan piutang per kontrak. */
export interface ReceivableRow {
  readonly contractId: string;
  readonly outstanding: Rupiah;
  readonly overdueAmount: Rupiah;
  readonly paidAmount: Rupiah;
  readonly totalPayable: Rupiah;
  readonly progressPercent: number;
  readonly nextDueDate: string | null;
  readonly maxDaysLate: number;
}

/** Membentuk laporan piutang per kontrak dari daftar cicilan. */
export function buildReceivablesReport(
  contracts: readonly PortfolioContract[],
  installments: readonly PortfolioInstallment[],
  today: string,
): ReceivableRow[] {
  const byContract = new Map<string, PortfolioInstallment[]>();
  for (const row of installments) {
    const list = byContract.get(row.contractId);
    if (list) list.push(row);
    else byContract.set(row.contractId, [row]);
  }

  return contracts
    .map((contract) => {
      const rows = byContract.get(contract.id) ?? [];
      const totals = computeContractTotals(rows, today);
      return {
        contractId: contract.id,
        outstanding: totals.outstanding,
        overdueAmount: totals.overdueAmount,
        paidAmount: totals.totalPaid,
        totalPayable: totals.totalPayable,
        progressPercent: totals.progressPercent,
        nextDueDate: totals.nextDueDate,
        maxDaysLate: totals.maxDaysLate,
      };
    })
    .filter((row) => row.totalPayable > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

/** Daftar tunggakan dengan detail umur, untuk tabel penagihan. */
export interface OverdueDetailRow {
  readonly contractId: string;
  readonly installmentId: string;
  readonly installmentNumber: number;
  readonly dueDate: string;
  readonly lateDays: number;
  readonly bucket: AgingBucket;
  readonly principal: Rupiah;
  readonly interest: Rupiah;
  readonly fees: Rupiah;
  readonly outstanding: Rupiah;
}

/** Menyusun daftar tunggakan dari seluruh cicilan. */
export function buildOverdueDetails(
  installments: readonly PortfolioInstallment[],
  today: string,
): OverdueDetailRow[] {
  return installments
    .filter((row) => isInstallmentOverdue(row, today))
    .map((row) => {
      const late = daysLate(row, today);
      return {
        contractId: row.contractId,
        installmentId: row.id,
        installmentNumber: row.installmentNumber,
        dueDate: row.dueDate,
        lateDays: late,
        bucket: resolveAgingBucket(late),
        principal: row.principal,
        interest: row.interest,
        fees: row.fees,
        outstanding: installmentOutstanding(row),
      };
    })
    .sort((a, b) => b.lateDays - a.lateDays);
}

/** Daftar cicilan yang akan jatuh tempo dalam n hari ke depan. */
export function buildUpcomingDue(
  installments: readonly PortfolioInstallment[],
  today: string,
  withinDays = 7,
): OverdueDetailRow[] {
  return installments
    .filter((row) => {
      if (installmentOutstanding(row) <= 0) return false;
      const diff = daysBetweenIso(today, row.dueDate);
      return diff >= 0 && diff <= withinDays;
    })
    .map((row) => ({
      contractId: row.contractId,
      installmentId: row.id,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      lateDays: 0,
      bucket: 'CURRENT' as AgingBucket,
      principal: row.principal,
      interest: row.interest,
      fees: row.fees,
      outstanding: installmentOutstanding(row),
    }))
    .sort((a, b) => compareIsoDate(a.dueDate, b.dueDate));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function shiftOneDay(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`);
  date.setDate(date.getDate() + 1);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
