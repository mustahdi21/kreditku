import { describe, expect, it } from 'vitest';
import {
  buildDailyPaymentSeries,
  buildMonthlyPaymentSeries,
  buildOverdueDetails,
  buildReceivablesReport,
  buildUpcomingDue,
  computeDashboardMetrics,
  computeOfficerPerformance,
  type PortfolioApplication,
  type PortfolioContract,
  type PortfolioCustomer,
  type PortfolioInstallment,
  type PortfolioPayment,
  type PortfolioPenalty,
} from '@/core/metrics';

const today = '2026-02-20';
const range = { from: '2026-02-01', to: '2026-02-28' };

const contract = (overrides: Partial<PortfolioContract> = {}): PortfolioContract => ({
  id: 'ctr-1',
  status: 'ACTIVE',
  principal: 10_000_000,
  totalPayable: 12_400_000,
  totalPaid: 0,
  outstanding: 12_400_000,
  disbursedAt: '2026-02-01',
  createdAt: '2026-02-01',
  ...overrides,
});

const installment = (overrides: Partial<PortfolioInstallment> = {}): PortfolioInstallment => ({
  id: 'inst-1',
  contractId: 'ctr-1',
  installmentNumber: 1,
  dueDate: '2026-02-15',
  totalDue: 1_000_000,
  paidAmount: 0,
  principal: 900_000,
  interest: 100_000,
  fees: 0,
  lastPaymentDate: null,
  ...overrides,
});

const payment = (overrides: Partial<PortfolioPayment> = {}): PortfolioPayment => ({
  id: 'pay-1',
  contractId: 'ctr-1',
  amount: 1_000_000,
  status: 'POSTED',
  paidDate: '2026-02-10',
  method: 'CASH',
  createdBy: 'user-1',
  ...overrides,
});

const customer = (overrides: Partial<PortfolioCustomer> = {}): PortfolioCustomer => ({
  id: 'cus-1',
  status: 'ACTIVE',
  createdAt: '2026-01-05',
  ...overrides,
});

const application = (overrides: Partial<PortfolioApplication> = {}): PortfolioApplication => ({
  id: 'app-1',
  status: 'APPROVED',
  principal: 10_000_000,
  price: 12_000_000,
  downPayment: 2_000_000,
  createdAt: '2026-02-02',
  decidedAt: '2026-02-03',
  decidedBy: 'user-2',
  createdBy: 'user-1',
  ...overrides,
});

const penalty = (overrides: Partial<PortfolioPenalty> = {}): PortfolioPenalty => ({
  id: 'pen-1',
  installmentId: 'inst-1',
  amount: 50_000,
  paidAmount: 0,
  waivedAmount: 0,
  status: 'OPEN',
  createdAt: '2026-02-16',
  ...overrides,
});

describe('metrics — metrik dashboard', () => {
  const baseInput = {
    today,
    range,
    contracts: [
      contract({ id: 'ctr-1', disbursedAt: '2026-02-01' }),
      contract({ id: 'ctr-2', status: 'DELINQUENT', disbursedAt: '2026-01-10' }),
      contract({ id: 'ctr-3', status: 'PAID_OFF', disbursedAt: '2025-12-01' }),
      contract({ id: 'ctr-4', status: 'CANCELLED', disbursedAt: null }),
    ],
    installments: [
      installment({ id: 'i-1', contractId: 'ctr-1', dueDate: '2026-02-15', totalDue: 1_000_000, paidAmount: 1_000_000, lastPaymentDate: '2026-02-14' }),
      installment({ id: 'i-2', contractId: 'ctr-1', installmentNumber: 2, dueDate: '2026-03-15', totalDue: 1_000_000 }),
      installment({ id: 'i-3', contractId: 'ctr-2', dueDate: '2026-01-10', totalDue: 2_000_000 }),
      installment({ id: 'i-4', contractId: 'ctr-2', installmentNumber: 2, dueDate: '2026-01-20', totalDue: 500_000, paidAmount: 500_000, lastPaymentDate: '2026-02-10' }),
      installment({ id: 'i-5', contractId: 'ctr-3', dueDate: '2026-01-05', totalDue: 500_000, paidAmount: 500_000, lastPaymentDate: '2026-01-05' }),
    ],
    payments: [
      payment({ id: 'p-1', amount: 1_000_000, paidDate: '2026-02-14' }),
      payment({ id: 'p-2', amount: 500_000, paidDate: '2026-02-05', status: 'REVERSED' }),
      payment({ id: 'p-3', amount: 300_000, paidDate: '2026-01-20' }),
    ],
    applications: [application({})],
    penalties: [penalty({})],
    customers: [customer({}), customer({ id: 'cus-2', status: 'DELINQUENT' }), customer({ id: 'cus-3', status: 'PAID_OFF' })],
  };

  it('menghitung metrik portofolio utama', () => {
    const metrics = computeDashboardMetrics(baseInput);

    expect(metrics.activeCustomers).toBe(2);
    expect(metrics.applicationsInRange).toBe(1);
    expect(metrics.approvedFinancingInRange).toBe(10_000_000);
    expect(metrics.disbursedInRange).toBe(10_000_000);
    expect(metrics.activeContracts).toBe(2);
    expect(metrics.paidOffContracts).toBe(1);
    expect(metrics.delinquentContracts).toBe(1);
    expect(metrics.collectionsInRange).toBe(1_000_000);
    expect(metrics.reversalsInRange).toBe(500_000);
    expect(metrics.netCashInRange).toBe(500_000);
    expect(metrics.penaltyOutstanding).toBe(50_000);
  });

  it('memisahkan tunggakan dari jatuh tempo hari ini', () => {
    const metrics = computeDashboardMetrics(baseInput);
    expect(metrics.overdueTotal).toBe(2_000_000);
    expect(metrics.overdueCount).toBe(1);
    expect(metrics.dueTodayTotal).toBe(0);
  });

  it('menghitung piutang berjalan hanya dari kontrak berjalan', () => {
    const metrics = computeDashboardMetrics(baseInput);
    // ctr-1 sisa 1.000.000 (cicilan 2) + ctr-2 sisa 2.000.000 = 3.000.000
    expect(metrics.outstandingTotal).toBe(3_000_000);
  });

  it('menghitung tingkat ketepatan waktu pembayaran', () => {
    const metrics = computeDashboardMetrics(baseInput);
    // 2 cicilan lunas: satu tepat waktu, satu terlambat → 50%
    expect(metrics.onTimeRatePercent).toBe(50);
  });

  it('menghitung rasio kredit bermasalah', () => {
    const metrics = computeDashboardMetrics(baseInput);
    expect(metrics.nplRatioPercent).toBe(0);
  });

  it('mendeteksi kredit bermasalah di atas 90 hari', () => {
    const metrics = computeDashboardMetrics({
      ...baseInput,
      installments: [
        ...baseInput.installments,
        installment({ id: 'i-9', contractId: 'ctr-2', installmentNumber: 3, dueDate: '2025-10-01', totalDue: 1_000_000 }),
      ],
    });
    expect(metrics.nplRatioPercent).toBeGreaterThan(0);
    expect(metrics.agingDistribution.D90_PLUS.count).toBe(1);
  });

  it('menyusun distribusi status kontrak', () => {
    const metrics = computeDashboardMetrics(baseInput);
    expect(metrics.contractStatusDistribution).toEqual({
      ACTIVE: 1,
      PAID_OFF: 1,
      DELINQUENT: 1,
      RESTRUCTURED: 0,
      CANCELLED: 1,
    });
  });

  it('mengabaikan pembayaran yang dibatalkan dari penerimaan', () => {
    const metrics = computeDashboardMetrics({
      ...baseInput,
      payments: [payment({ status: 'REVERSED' })],
    });
    expect(metrics.collectionsInRange).toBe(0);
  });
});

describe('metrics — deret waktu', () => {
  it('membentuk deret harian dengan jumlah hari yang benar', () => {
    const series = buildDailyPaymentSeries(
      [payment({ paidDate: '2026-02-02', amount: 100_000 }), payment({ paidDate: '2026-02-04', amount: 250_000 })],
      '2026-02-01',
      '2026-02-07',
    );
    expect(series).toHaveLength(7);
    expect(series[1]!.amount).toBe(100_000);
    expect(series[3]!.amount).toBe(250_000);
    expect(series[0]!.label).toBe('01/02');
  });

  it('membentuk deret bulanan sesuai daftar bulan', () => {
    const series = buildMonthlyPaymentSeries(
      [payment({ paidDate: '2026-01-15', amount: 500_000 }), payment({ paidDate: '2026-02-15', amount: 700_000 })],
      ['2026-01-01', '2026-02-01'],
    );
    expect(series).toHaveLength(2);
    expect(series[0]!.label).toBe('Jan');
    expect(series[0]!.amount).toBe(500_000);
    expect(series[1]!.amount).toBe(700_000);
  });

  it('memisahkan pembayaran yang dibatalkan pada deret', () => {
    const series = buildDailyPaymentSeries(
      [payment({ paidDate: '2026-02-03', amount: 400_000, status: 'REVERSED' })],
      '2026-02-01',
      '2026-02-03',
    );
    expect(series[2]!.amount).toBe(0);
    expect(series[2]!.reversalAmount).toBe(400_000);
  });
});

describe('metrics — laporan piutang & tunggakan', () => {
  it('menyusun laporan piutang per kontrak', () => {
    const report = buildReceivablesReport(
      [contract({ id: 'ctr-1' }), contract({ id: 'ctr-2' })],
      [
        installment({ id: 'i-1', contractId: 'ctr-1', dueDate: '2026-01-15', totalDue: 1_000_000, paidAmount: 250_000 }),
        installment({ id: 'i-2', contractId: 'ctr-2', dueDate: '2026-03-15', totalDue: 500_000 }),
      ],
      today,
    );
    expect(report).toHaveLength(2);
    expect(report[0]!.contractId).toBe('ctr-1');
    expect(report[0]!.outstanding).toBe(750_000);
    expect(report[0]!.overdueAmount).toBe(750_000);
    expect(report[0]!.maxDaysLate).toBe(36);
  });

  it('menyusun daftar tunggakan terurut dari yang paling lama', () => {
    const details = buildOverdueDetails(
      [
        installment({ id: 'i-1', dueDate: '2026-02-15' }),
        installment({ id: 'i-2', installmentNumber: 2, dueDate: '2026-01-01' }),
        installment({ id: 'i-3', installmentNumber: 3, dueDate: '2026-03-01' }),
      ],
      today,
    );
    expect(details).toHaveLength(2);
    expect(details[0]!.installmentId).toBe('i-2');
    expect(details[0]!.bucket).toBe('D31_60');
  });

  it('menyusun daftar jatuh tempo mendatang', () => {
    const upcoming = buildUpcomingDue(
      [
        installment({ id: 'i-1', dueDate: '2026-02-22' }),
        installment({ id: 'i-2', installmentNumber: 2, dueDate: '2026-03-10' }),
        installment({ id: 'i-3', installmentNumber: 3, dueDate: '2026-02-21', paidAmount: 1_000_000 }),
      ],
      today,
      7,
    );
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.installmentId).toBe('i-1');
  });
});

describe('metrics — kinerja petugas', () => {
  it('menghitung jumlah dan nilai pembayaran per petugas', () => {
    const performance = computeOfficerPerformance(
      [
        payment({ id: 'p-1', amount: 100_000, createdBy: 'user-1' }),
        payment({ id: 'p-2', amount: 250_000, createdBy: 'user-1' }),
        payment({ id: 'p-3', amount: 300_000, createdBy: 'user-2', status: 'REVERSED' }),
      ],
      [
        application({ id: 'a-1', status: 'APPROVED', decidedBy: 'user-2' }),
        application({ id: 'a-2', status: 'REJECTED', decidedBy: 'user-2' }),
      ],
    );
    const officer1 = performance.find((row) => row.officerId === 'user-1');
    expect(officer1?.paymentsCount).toBe(2);
    expect(officer1?.paymentsAmount).toBe(350_000);

    const officer2 = performance.find((row) => row.officerId === 'user-2');
    expect(officer2?.paymentsCount).toBe(0);
    expect(officer2?.approvalsCount).toBe(1);
    expect(officer2?.rejectionsCount).toBe(1);
  });
});
