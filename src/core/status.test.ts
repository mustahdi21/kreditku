import { describe, expect, it } from 'vitest';
import {
  computeContractTotals,
  daysLate,
  deriveContractStatus,
  deriveCustomerStatus,
  deriveInstallmentStatus,
  groupOverdueByAging,
  installmentOutstanding,
  isContractOpen,
  isInstallmentOverdue,
  resolveAgingBucket,
  type InstallmentLike,
} from '@/core/status';

const today = '2026-02-20';

const inst = (
  installmentNumber: number,
  dueDate: string,
  totalDue: number,
  paidAmount = 0,
  extra: Record<string, unknown> = {},
): InstallmentLike & { installmentNumber: number; principal: number; interest: number; fees: number } => ({
  installmentNumber,
  dueDate,
  totalDue,
  paidAmount,
  principal: totalDue,
  interest: 0,
  fees: 0,
  ...extra,
});

describe('status — status cicilan', () => {
  it('menandai cicilan yang belum jatuh tempo', () => {
    expect(deriveInstallmentStatus(inst(1, '2026-03-15', 1_000_000), today)).toBe('PENDING');
  });

  it('menandai cicilan yang jatuh tempo hari ini', () => {
    expect(deriveInstallmentStatus(inst(1, today, 1_000_000), today)).toBe('DUE_TODAY');
  });

  it('menandai cicilan terlambat', () => {
    expect(deriveInstallmentStatus(inst(1, '2026-01-15', 1_000_000), today)).toBe('OVERDUE');
  });

  it('menandai cicilan dibayar sebagian', () => {
    expect(deriveInstallmentStatus(inst(1, '2026-01-15', 1_000_000, 400_000), today)).toBe('PARTIAL');
  });

  it('menandai cicilan lunas meskipun terlambat dibayar', () => {
    expect(deriveInstallmentStatus(inst(1, '2026-01-15', 1_000_000, 1_000_000), today)).toBe('PAID');
  });

  it('mengunci status CANCELLED meski ada pembayaran', () => {
    expect(
      deriveInstallmentStatus(inst(1, '2026-01-15', 1_000_000, 1_000_000, { storedStatus: 'CANCELLED' }), today),
    ).toBe('CANCELLED');
  });

  it('menghitung sisa tagihan tanpa nilai negatif', () => {
    expect(installmentOutstanding({ totalDue: 1_000_000, paidAmount: 400_000 })).toBe(600_000);
    expect(installmentOutstanding({ totalDue: 1_000_000, paidAmount: 1_200_000 })).toBe(0);
  });

  it('mendeteksi keterlambatan hanya bila masih ada sisa', () => {
    expect(isInstallmentOverdue(inst(1, '2026-01-15', 1_000_000), today)).toBe(true);
    expect(isInstallmentOverdue(inst(1, '2026-01-15', 1_000_000, 1_000_000), today)).toBe(false);
    expect(isInstallmentOverdue(inst(1, '2026-03-15', 1_000_000), today)).toBe(false);
  });

  it('menghitung hari keterlambatan', () => {
    expect(daysLate({ dueDate: '2026-02-10' }, today)).toBe(10);
    expect(daysLate({ dueDate: '2026-02-25' }, today)).toBe(0);
  });
});

describe('status — ember umur tunggakan', () => {
  it('mengelompokkan sesuai batas default', () => {
    expect(resolveAgingBucket(0)).toBe('CURRENT');
    expect(resolveAgingBucket(1)).toBe('D1_7');
    expect(resolveAgingBucket(7)).toBe('D1_7');
    expect(resolveAgingBucket(8)).toBe('D8_30');
    expect(resolveAgingBucket(30)).toBe('D8_30');
    expect(resolveAgingBucket(31)).toBe('D31_60');
    expect(resolveAgingBucket(60)).toBe('D31_60');
    expect(resolveAgingBucket(61)).toBe('D61_90');
    expect(resolveAgingBucket(90)).toBe('D61_90');
    expect(resolveAgingBucket(91)).toBe('D90_PLUS');
  });

  it('mendukung batas yang dikonfigurasi', () => {
    expect(resolveAgingBucket(10, [14, 45, 90, 180])).toBe('D1_7');
    expect(resolveAgingBucket(40, [14, 45, 90, 180])).toBe('D8_30');
  });

  it('mengelompokkan tunggakan per ember', () => {
    const rows = [
      inst(1, '2026-02-18', 500_000),
      inst(2, '2026-01-30', 500_000),
      inst(3, '2025-12-01', 500_000),
      inst(4, '2026-03-15', 500_000),
      inst(5, '2026-02-15', 500_000, 500_000),
    ];
    const grouped = groupOverdueByAging(rows, today);
    expect(grouped.D1_7).toHaveLength(1);
    expect(grouped.D8_30).toHaveLength(1);
    expect(grouped.D61_90).toHaveLength(1);
    expect(grouped.D31_60).toHaveLength(0);
    expect(grouped.D90_PLUS).toHaveLength(0);
    expect(grouped.CURRENT).toHaveLength(0);
    expect(grouped.D61_90[0]!.lateDays).toBe(81);
  });
});

describe('status — total kontrak', () => {
  const rows = [
    inst(1, '2026-01-15', 1_000_000, 1_000_000),
    inst(2, '2026-02-15', 1_000_000, 400_000),
    inst(3, '2026-03-15', 1_000_000),
  ];

  it('menghitung total tanpa menganggap lunas sebagian sebagai lunas', () => {
    const totals = computeContractTotals(rows, today);
    expect(totals.totalPayable).toBe(3_000_000);
    expect(totals.totalPaid).toBe(1_400_000);
    expect(totals.outstanding).toBe(1_600_000);
    expect(totals.settled).toBe(false);
    expect(totals.paidInstallments).toBe(1);
    expect(totals.partialInstallments).toBe(1);
    expect(totals.overdueInstallments).toBe(1);
    expect(totals.overdueAmount).toBe(600_000);
    expect(totals.nextDueDate).toBe('2026-02-15');
    expect(totals.maxDaysLate).toBe(5);
  });

  it('melaporkan progres pembayaran', () => {
    const totals = computeContractTotals(rows, today);
    expect(totals.progressPercent).toBeCloseTo(46.7, 1);
  });

  it('mengabaikan cicilan yang dibatalkan dari total', () => {
    const withCancelled = [...rows, inst(4, '2026-04-15', 1_000_000, 0, { storedStatus: 'CANCELLED' })];
    const totals = computeContractTotals(withCancelled, today);
    expect(totals.totalPayable).toBe(3_000_000);
  });

  it('menandai lunas hanya bila seluruh kewajiban selesai', () => {
    const settled = [
      inst(1, '2026-01-15', 1_000_000, 1_000_000),
      inst(2, '2026-02-15', 1_000_000, 1_000_000),
    ];
    const totals = computeContractTotals(settled, today);
    expect(totals.settled).toBe(true);
    expect(totals.outstanding).toBe(0);
    expect(totals.progressPercent).toBe(100);
  });

  it('menghitung jumlah jatuh tempo hari ini', () => {
    const withToday = [...rows, inst(4, today, 750_000)];
    const totals = computeContractTotals(withToday, today);
    expect(totals.dueTodayAmount).toBe(750_000);
  });
});

describe('status — status kontrak', () => {
  const active = [inst(1, '2026-03-15', 1_000_000)];
  const delinquent = [inst(1, '2026-01-15', 1_000_000)];
  const settled = [inst(1, '2026-01-15', 1_000_000, 1_000_000)];

  it('menandai kontrak aktif', () => {
    expect(deriveContractStatus({}, active, today)).toBe('ACTIVE');
  });

  it('menandai kontrak menunggak', () => {
    expect(deriveContractStatus({}, delinquent, today)).toBe('DELINQUENT');
  });

  it('menandai kontrak lunas', () => {
    expect(deriveContractStatus({}, settled, today)).toBe('PAID_OFF');
  });

  it('tidak menandai lunas bila satu cicilan dibayar dari tiga', () => {
    const partial = [
      inst(1, '2026-01-15', 1_000_000, 1_000_000),
      inst(2, '2026-02-15', 1_000_000),
      inst(3, '2026-03-15', 1_000_000),
    ];
    expect(deriveContractStatus({}, partial, today)).not.toBe('PAID_OFF');
  });

  it('menghormati status restrukturisasi', () => {
    expect(deriveContractStatus({ status: 'RESTRUCTURED' }, active, today)).toBe('RESTRUCTURED');
  });

  it('mengunci status dibatalkan', () => {
    expect(deriveContractStatus({ cancelledAt: '2026-02-01' }, delinquent, today)).toBe('CANCELLED');
  });

  it('menentukan kontrak berjalan', () => {
    expect(isContractOpen('ACTIVE')).toBe(true);
    expect(isContractOpen('DELINQUENT')).toBe(true);
    expect(isContractOpen('RESTRUCTURED')).toBe(true);
    expect(isContractOpen('PAID_OFF')).toBe(false);
    expect(isContractOpen('CANCELLED')).toBe(false);
  });
});

describe('status — status pelanggan turunan', () => {
  it('menandai prospek bila belum ada kontrak', () => {
    expect(deriveCustomerStatus({ contractStatuses: [], hasAnyContract: false })).toBe('PROSPECT');
  });

  it('menandai aktif bila ada kontrak berjalan tanpa tunggakan', () => {
    expect(deriveCustomerStatus({ contractStatuses: ['ACTIVE'], hasAnyContract: true })).toBe('ACTIVE');
  });

  it('menandai menunggak bila ada kontrak menunggak', () => {
    expect(
      deriveCustomerStatus({ contractStatuses: ['ACTIVE', 'DELINQUENT'], hasAnyContract: true }),
    ).toBe('DELINQUENT');
  });

  it('menandai lunas bila seluruh kontrak selesai', () => {
    expect(deriveCustomerStatus({ contractStatuses: ['PAID_OFF'], hasAnyContract: true })).toBe('PAID_OFF');
  });

  it('mempertahankan status diblokir', () => {
    expect(
      deriveCustomerStatus({ storedStatus: 'BLOCKED', contractStatuses: ['ACTIVE'], hasAnyContract: true }),
    ).toBe('BLOCKED');
  });
});
