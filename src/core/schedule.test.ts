import { describe, expect, it } from 'vitest';
import { buildInstallmentSchedule, adjustDueDate, summarizeSchedule, nextDueDate } from '@/core/schedule';
import { computeInterestPlan } from '@/core/interest';

const plan = computeInterestPlan({
  principal: 10_000_000,
  tenor: 6,
  method: 'FLAT',
  rateBp: 200,
  rateBasis: 'PER_MONTH',
  frequency: 'MONTHLY',
});

describe('schedule — pembentukan jadwal', () => {
  it('membentuk tanggal jatuh tempo bulanan berurutan', () => {
    const rows = buildInstallmentSchedule({ plan, firstDueDate: '2026-01-15' });
    expect(rows).toHaveLength(6);
    expect(rows[0]!.dueDate).toBe('2026-01-15');
    expect(rows[1]!.dueDate).toBe('2026-02-15');
    expect(rows[5]!.dueDate).toBe('2026-06-15');
    expect(rows[0]!.adjusted).toBe(false);
  });

  it('membatasi akhir bulan saat menambah bulan', () => {
    const rows = buildInstallmentSchedule({ plan, firstDueDate: '2026-01-31' });
    expect(rows[1]!.dueDate).toBe('2026-02-28');
    expect(rows[2]!.dueDate).toBe('2026-03-31');
  });

  it('mendukung jadwal mingguan dan dua mingguan', () => {
    const weekly = computeInterestPlan({
      principal: 1_000_000,
      tenor: 4,
      method: 'NONE',
      rateBp: 0,
      rateBasis: 'PER_MONTH',
      frequency: 'WEEKLY',
    });
    const rows = buildInstallmentSchedule({ plan: weekly, firstDueDate: '2026-01-05' });
    expect(rows.map((row) => row.dueDate)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
  });

  it('menjaga konsistensi total setelah tanggal ditambahkan', () => {
    const rows = buildInstallmentSchedule({ plan, firstDueDate: '2026-01-15' });
    const summary = summarizeSchedule(rows);
    expect(summary.totalDue).toBe(summary.totalPrincipal + summary.totalInterest + summary.totalFees);
    expect(summary.anomalies).toEqual([]);
    expect(summary.firstDueDate).toBe('2026-01-15');
    expect(summary.lastDueDate).toBe('2026-06-15');
  });
});

describe('schedule — kebijakan hari kerja', () => {
  it('menggeser ke hari kerja berikutnya bila jatuh pada akhir pekan', () => {
    // 2026-01-17 adalah hari Sabtu
    expect(adjustDueDate('2026-01-17', 'NEXT_BUSINESS_DAY')).toBe('2026-01-19');
  });

  it('menggeser ke hari kerja sebelumnya bila dikonfigurasi', () => {
    expect(adjustDueDate('2026-01-17', 'PREVIOUS_BUSINESS_DAY')).toBe('2026-01-16');
  });

  it('menghormati daftar hari libur', () => {
    const holidays = ['2026-01-19'];
    expect(adjustDueDate('2026-01-17', 'NEXT_BUSINESS_DAY', holidays)).toBe('2026-01-20');
  });

  it('tidak mengubah tanggal saat kebijakan NONE', () => {
    expect(adjustDueDate('2026-01-17', 'NONE')).toBe('2026-01-17');
  });

  it('menerapkan penyesuaian pada seluruh jadwal', () => {
    const rows = buildInstallmentSchedule({
      plan,
      firstDueDate: '2026-01-17',
      dueDateAdjustment: 'NEXT_BUSINESS_DAY',
    });
    expect(rows[0]!.baseDueDate).toBe('2026-01-17');
    expect(rows[0]!.dueDate).toBe('2026-01-19');
    expect(rows[0]!.adjusted).toBe(true);
  });
});

describe('schedule — jatuh tempo berikutnya', () => {
  it('mengambil tanggal jatuh tempo terbuka paling awal', () => {
    const rows = [
      { dueDate: '2026-01-15', outstanding: 0, status: 'PAID' },
      { dueDate: '2026-02-15', outstanding: 500_000, status: 'OVERDUE' },
      { dueDate: '2026-03-15', outstanding: 500_000, status: 'PENDING' },
    ];
    expect(nextDueDate(rows, '2026-02-20')).toBe('2026-02-15');
  });

  it('mengabaikan cicilan yang dibatalkan', () => {
    const rows = [
      { dueDate: '2026-01-15', outstanding: 100_000, status: 'CANCELLED' },
      { dueDate: '2026-02-15', outstanding: 100_000, status: 'PENDING' },
    ];
    expect(nextDueDate(rows, '2026-01-20')).toBe('2026-02-15');
  });

  it('mengembalikan null bila seluruh kewajiban lunas', () => {
    const rows = [{ dueDate: '2026-01-15', outstanding: 0, status: 'PAID' }];
    expect(nextDueDate(rows, '2026-01-20')).toBeNull();
  });
});
