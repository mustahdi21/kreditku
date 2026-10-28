import { describe, expect, it } from 'vitest';
import { calculatePenalty, describePenaltyRule, summarizePenalties, type PenaltyRule } from '@/core/penalties';

const baseInput = {
  installmentNumber: 1,
  dueDate: '2026-01-15',
  totalDue: 1_000_000,
  outstanding: 1_000_000,
};

const rule = (overrides: Partial<PenaltyRule>): PenaltyRule => ({
  type: 'FIXED_PER_DAY',
  amount: 10_000,
  graceDays: 0,
  maxAmount: null,
  percentBase: 'OUTSTANDING',
  ...overrides,
});

describe('penalties — tanpa denda', () => {
  it('tidak menghitung denda bila aturan nonaktif', () => {
    const result = calculatePenalty({ ...baseInput, asOf: '2026-02-15', rule: rule({ type: 'NONE' }) });
    expect(result.amount).toBe(0);
    expect(result.applicable).toBe(false);
  });

  it('tidak menghitung denda untuk cicilan yang sudah lunas', () => {
    const result = calculatePenalty({
      ...baseInput,
      outstanding: 0,
      settled: true,
      asOf: '2026-02-15',
      rule: rule({}),
    });
    expect(result.amount).toBe(0);
    expect(result.reason).toContain('lunas');
  });

  it('tidak menghitung denda untuk cicilan yang dibatalkan', () => {
    const result = calculatePenalty({
      ...baseInput,
      cancelled: true,
      asOf: '2026-02-15',
      rule: rule({}),
    });
    expect(result.amount).toBe(0);
    expect(result.reason).toContain('dibatalkan');
  });
});

describe('penalties — masa tenggang', () => {
  it('tidak mengenakan denda selama masa tenggang', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-01-18',
      rule: rule({ graceDays: 5 }),
    });
    expect(result.lateDays).toBe(3);
    expect(result.chargeableDays).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('mulai menghitung setelah masa tenggang berakhir', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-01-21',
      rule: rule({ graceDays: 5 }),
    });
    expect(result.lateDays).toBe(6);
    expect(result.chargeableDays).toBe(1);
    expect(result.amount).toBe(10_000);
  });

  it('tidak menghitung sebelum jatuh tempo', () => {
    const result = calculatePenalty({ ...baseInput, asOf: '2026-01-10', rule: rule({}) });
    expect(result.lateDays).toBe(0);
    expect(result.amount).toBe(0);
  });
});

describe('penalties — rumus', () => {
  it('denda nominal per hari', () => {
    const result = calculatePenalty({ ...baseInput, asOf: '2026-01-25', rule: rule({}) });
    expect(result.lateDays).toBe(10);
    expect(result.amount).toBe(100_000);
  });

  it('denda nominal tetap per cicilan', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-02-15',
      rule: rule({ type: 'FIXED_PER_INSTALLMENT', amount: 50_000 }),
    });
    expect(result.amount).toBe(50_000);
  });

  it('denda persentase per hari dari sisa tagihan', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-01-25',
      rule: rule({ type: 'PERCENT_PER_DAY', amount: 50 }),
    });
    // 0,5% per hari × 10 hari × 1.000.000 = 50.000
    expect(result.amount).toBe(50_000);
  });

  it('denda persentase per bulan dihitung per 30 hari', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-02-14',
      rule: rule({ type: 'PERCENT_PER_MONTH', amount: 100 }),
    });
    // 30 hari terlambat → 1 bulan × 1% × 1.000.000
    expect(result.lateDays).toBe(30);
    expect(result.amount).toBe(10_000);
    const twoMonths = calculatePenalty({
      ...baseInput,
      asOf: '2026-03-16',
      rule: rule({ type: 'PERCENT_PER_MONTH', amount: 100 }),
    });
    expect(twoMonths.lateDays).toBe(60);
    expect(twoMonths.amount).toBe(20_000);
  });

  it('menggunakan total tagihan sebagai dasar bila dikonfigurasi', () => {
    const result = calculatePenalty({
      ...baseInput,
      outstanding: 400_000,
      asOf: '2026-01-25',
      rule: rule({ type: 'PERCENT_PER_DAY', amount: 50, percentBase: 'TOTAL_DUE' }),
    });
    expect(result.amount).toBe(50_000);
  });
});

describe('penalties — batas maksimum', () => {
  it('membatasi denda pada nilai maksimum', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-02-15',
      rule: rule({ amount: 10_000, maxAmount: 100_000 }),
    });
    expect(result.lateDays).toBe(31);
    expect(result.calculatedAmount).toBe(310_000);
    expect(result.amount).toBe(100_000);
    expect(result.capped).toBe(true);
  });

  it('tidak membatasi bila di bawah nilai maksimum', () => {
    const result = calculatePenalty({
      ...baseInput,
      asOf: '2026-01-18',
      rule: rule({ amount: 10_000, maxAmount: 100_000 }),
    });
    expect(result.amount).toBe(30_000);
    expect(result.capped).toBe(false);
  });
});

describe('penalties — ringkasan dan deskripsi', () => {
  it('meringkas denda dari beberapa cicilan', () => {
    const results = [
      calculatePenalty({ ...baseInput, asOf: '2026-01-25', rule: rule({}) }),
      calculatePenalty({ ...baseInput, installmentNumber: 2, asOf: '2026-01-01', rule: rule({}) }),
      calculatePenalty({ ...baseInput, installmentNumber: 3, asOf: '2026-03-15', rule: rule({ maxAmount: 50_000 }) }),
    ];
    const summary = summarizePenalties(results);
    expect(summary.totalApplied).toBe(100_000 + 0 + 50_000);
    expect(summary.affectedInstallments).toBe(2);
    expect(summary.cappedCount).toBe(1);
  });

  it('menjelaskan aturan denda dalam bahasa Indonesia', () => {
    expect(describePenaltyRule(rule({}))).toContain('per hari');
    expect(describePenaltyRule(rule({ type: 'NONE' }))).toBe(
      'Tanpa denda. Cicilan yang terlambat tidak dikenakan denda.',
    );
    expect(describePenaltyRule(rule({ type: 'PERCENT_PER_MONTH', amount: 100, graceDays: 3 }))).toContain(
      '1% per bulan',
    );
  });
});
