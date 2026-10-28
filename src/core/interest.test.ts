import { describe, expect, it } from 'vitest';
import {
  computeFinancedPrincipal,
  computeInterestPlan,
  describeInterestMethod,
  distributeAdminFee,
  simulateCredit,
  toAnnualRateBp,
  toRatePerPeriodBp,
} from '@/core/interest';
import { MoneyError } from '@/lib/money';

const base = {
  principal: 10_000_000,
  tenor: 12,
  rateBasis: 'PER_MONTH' as const,
  frequency: 'MONTHLY' as const,
};

describe('interest — konversi tarif', () => {
  it('menerjemahkan tarif bulanan ke periode mingguan secara proporsional', () => {
    // 2% per bulan → per minggu = 2% × 12 ÷ 52
    expect(toRatePerPeriodBp(200, 'PER_MONTH', 'WEEKLY')).toBeCloseTo(46.1538, 3);
  });

  it('menerjemahkan tarif tahunan ke periode bulanan', () => {
    expect(toRatePerPeriodBp(1200, 'PER_YEAR', 'MONTHLY')).toBeCloseTo(100, 6);
  });

  it('menghitung tarif tahunan dari tarif bulanan', () => {
    expect(toAnnualRateBp(200, 'PER_MONTH')).toBe(2400);
    expect(toAnnualRateBp(1500, 'PER_YEAR')).toBe(1500);
  });
});

describe('interest — metode NONE', () => {
  it('membagi pokok rata tanpa bunga', () => {
    const plan = computeInterestPlan({ ...base, method: 'NONE', rateBp: 0 });
    expect(plan.totalInterest).toBe(0);
    expect(plan.totalPayable).toBe(10_000_000);
    expect(plan.rows).toHaveLength(12);
    expect(plan.rows[11]!.principal).toBe(833_337);
    expect(plan.rows.reduce((acc, row) => acc + row.principal, 0)).toBe(10_000_000);
  });
});

describe('interest — metode FLAT', () => {
  it('menghitung bunga tetap dari pokok awal', () => {
    const plan = computeInterestPlan({ ...base, method: 'FLAT', rateBp: 200 });
    expect(plan.interestPerPeriod).toBe(200_000);
    expect(plan.totalInterest).toBe(2_400_000);
    expect(plan.totalPayable).toBe(12_400_000);
    expect(plan.rows[0]!.totalDue).toBe(1_033_333);
    expect(plan.rows.every((row) => row.interest === 200_000)).toBe(true);
  });

  it('tidak mengubah total ketika tenor diubah (proporsional)', () => {
    const plan24 = computeInterestPlan({ ...base, tenor: 24, method: 'FLAT', rateBp: 200 });
    expect(plan24.totalInterest).toBe(4_800_000);
  });
});

describe('interest — metode ANNUITY (bunga efektif)', () => {
  it('menjaga total pokok sama persis dengan pokok pembiayaan', () => {
    const plan = computeInterestPlan({ ...base, method: 'ANNUITY', rateBp: 100 });
    const totalPrincipal = plan.rows.reduce((acc, row) => acc + row.principal, 0);
    expect(totalPrincipal).toBe(10_000_000);
  });

  it('menghasilkan angsuran yang hampir seragam dan bunga menurun', () => {
    const plan = computeInterestPlan({ ...base, method: 'ANNUITY', rateBp: 100 });
    const totalPerPeriod = plan.rows.slice(0, -1).map((row) => row.totalDue);
    const first = totalPerPeriod[0]!;
    for (const value of totalPerPeriod) {
      expect(Math.abs(value - first)).toBeLessThanOrEqual(1);
    }
    expect(plan.rows[0]!.interest).toBeGreaterThan(plan.rows[1]!.interest);
    expect(plan.rows[11]!.interest).toBeLessThan(plan.rows[0]!.interest);
    expect(plan.rows[0]!.principal).toBeGreaterThan(0);
    expect(plan.rows[11]!.principal).toBeGreaterThan(0);
  });

  it('mendekati nilai anuitas teoretis', () => {
    const plan = computeInterestPlan({ ...base, method: 'ANNUITY', rateBp: 100 });
    const i = 0.01;
    const theoretical = (10_000_000 * i) / (1 - Math.pow(1 + i, -12));
    expect(plan.rows[0]!.totalDue).toBeCloseTo(theoretical, -1);
    expect(plan.totalPayable).toBeGreaterThan(10_600_000);
    expect(plan.totalPayable).toBeLessThan(10_700_000);
  });

  it('menangani tarif nol sebagai pembagian rata', () => {
    const plan = computeInterestPlan({ ...base, method: 'ANNUITY', rateBp: 0 });
    expect(plan.totalInterest).toBe(0);
    expect(plan.rows.reduce((acc, row) => acc + row.principal, 0)).toBe(10_000_000);
  });
});

describe('interest — biaya administrasi', () => {
  it('membebankan biaya administrasi di muka', () => {
    const plan = computeInterestPlan({
      ...base,
      method: 'FLAT',
      rateBp: 200,
      adminFee: 300_000,
      adminFeePosition: 'UPFRONT',
    });
    expect(plan.upfrontAmount).toBe(300_000);
    expect(plan.totalFees).toBe(0);
    expect(plan.totalPayable).toBe(12_400_000);
  });

  it('membebankan biaya administrasi pada cicilan pertama', () => {
    const plan = computeInterestPlan({
      ...base,
      method: 'FLAT',
      rateBp: 200,
      adminFee: 300_000,
      adminFeePosition: 'FIRST_INSTALLMENT',
    });
    expect(plan.rows[0]!.fees).toBe(300_000);
    expect(plan.rows[1]!.fees).toBe(0);
    expect(plan.totalPayable).toBe(12_700_000);
  });

  it('menyebar biaya administrasi ke seluruh periode tanpa kehilangan 1 rupiah', () => {
    const plan = computeInterestPlan({
      ...base,
      method: 'NONE',
      rateBp: 0,
      adminFee: 100_000,
      adminFeePosition: 'SPREAD',
    });
    expect(plan.totalFees).toBe(100_000);
    expect(plan.rows.reduce((acc, row) => acc + row.fees, 0)).toBe(100_000);
  });

  it('menolak biaya administrasi negatif', () => {
    expect(() =>
      computeInterestPlan({ ...base, method: 'FLAT', rateBp: 200, adminFee: -1 }),
    ).toThrow(MoneyError);
  });

  it('distribusi biaya administrasi konsisten', () => {
    expect(distributeAdminFee(0, 'UPFRONT', 12)).toEqual({ upfront: 0, perPeriod: new Array(12).fill(0) });
    expect(distributeAdminFee(50_000, 'UPFRONT', 3).upfront).toBe(50_000);
    expect(distributeAdminFee(50_000, 'FIRST_INSTALLMENT', 3).perPeriod).toEqual([50_000, 0, 0]);
    expect(distributeAdminFee(50_000, 'SPREAD', 3).perPeriod).toEqual([16_666, 16_666, 16_668]);
  });
});

describe('interest — validasi input', () => {
  it('menolak tenor nol atau pecahan', () => {
    expect(() => computeInterestPlan({ ...base, tenor: 0, method: 'FLAT', rateBp: 200 })).toThrow(MoneyError);
    expect(() => computeInterestPlan({ ...base, tenor: 2.5, method: 'FLAT', rateBp: 200 })).toThrow(MoneyError);
  });

  it('menolak tarif negatif dan tarif di atas 100%', () => {
    expect(() => computeInterestPlan({ ...base, method: 'FLAT', rateBp: -1 })).toThrow(MoneyError);
    expect(() => computeInterestPlan({ ...base, method: 'FLAT', rateBp: 10_001 })).toThrow(MoneyError);
  });

  it('menghitung pokok pembiayaan dan menolak uang muka melebihi harga', () => {
    expect(computeFinancedPrincipal(12_000_000, 2_000_000)).toBe(10_000_000);
    expect(computeFinancedPrincipal(12_000_000, 12_000_000)).toBe(0);
    expect(() => computeFinancedPrincipal(12_000_000, 12_500_000)).toThrow(MoneyError);
  });
});

describe('interest — simulator kredit', () => {
  it('membentuk ringkasan simulasi yang konsisten', () => {
    const summary = simulateCredit({
      price: 12_000_000,
      downPayment: 2_000_000,
      tenor: 12,
      method: 'FLAT',
      rateBp: 200,
      rateBasis: 'PER_MONTH',
      frequency: 'MONTHLY',
      adminFee: 300_000,
      adminFeePosition: 'UPFRONT',
    });

    expect(summary.principal).toBe(10_000_000);
    expect(summary.totalInterest).toBe(2_400_000);
    expect(summary.totalPayable).toBe(12_400_000);
    expect(summary.upfrontAmount).toBe(300_000);
    expect(summary.rows).toHaveLength(12);
    expect(summary.installmentAmount).toBe(1_033_333);

    const totalRows = summary.rows.reduce((acc, row) => acc + row.totalDue, 0);
    expect(totalRows).toBe(summary.totalPayable);
  });

  it('memberikan penjelasan metode dalam bahasa Indonesia', () => {
    expect(describeInterestMethod('FLAT')).toContain('Bunga flat');
    expect(describeInterestMethod('ANNUITY')).toContain('anuitas');
    expect(describeInterestMethod('NONE')).toContain('Tanpa bunga');
  });
});
