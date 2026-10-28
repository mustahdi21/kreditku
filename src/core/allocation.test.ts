import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildAllocationRecords,
  buildIdempotencyKey,
  isFullySettled,
  isValidIdempotencyKey,
  sortTargets,
  totalOpenLiability,
  validatePaymentAmount,
  validateReversal,
  type AllocationTarget,
} from '@/core/allocation';
import { MoneyError } from '@/lib/money';

const target = (
  installmentNumber: number,
  dueDate: string,
  totalDue: number,
  paidAmount = 0,
  penaltyOutstanding = 0,
): AllocationTarget => ({
  installmentId: `inst-${installmentNumber}`,
  installmentNumber,
  dueDate,
  totalDue,
  paidAmount,
  penaltyOutstanding,
});

const targets: AllocationTarget[] = [
  target(1, '2026-01-15', 1_000_000),
  target(2, '2026-02-15', 1_000_000),
  target(3, '2026-03-15', 1_000_000),
];

describe('allocation — urutan dan kewajiban terbuka', () => {
  it('menghitung total kewajiban terbuka termasuk denda', () => {
    expect(totalOpenLiability(targets)).toBe(3_000_000);
    expect(totalOpenLiability([target(1, '2026-01-15', 1_000_000, 400_000, 50_000)])).toBe(650_000);
  });

  it('mengurutkan dari yang paling lama (default)', () => {
    const reversed = [...targets].reverse();
    const sorted = sortTargets(reversed, 'OLDEST_FIRST');
    expect(sorted.map((item) => item.installmentNumber)).toEqual([1, 2, 3]);
  });

  it('mengurutkan dari yang paling baru bila diminta', () => {
    const sorted = sortTargets(targets, 'NEWEST_FIRST');
    expect(sorted.map((item) => item.installmentNumber)).toEqual([3, 2, 1]);
  });

  it('menghormati urutan manual', () => {
    const manual = [targets[2]!, targets[0]!, targets[1]!];
    expect(sortTargets(manual, 'MANUAL').map((item) => item.installmentNumber)).toEqual([3, 1, 2]);
  });

  it('mendeteksi kontrak yang sudah lunas', () => {
    expect(isFullySettled([target(1, '2026-01-15', 1_000_000, 1_000_000)])).toBe(true);
    expect(isFullySettled([target(1, '2026-01-15', 1_000_000, 1_000_000, 10_000)])).toBe(false);
  });
});

describe('allocation — pembayaran sebagian dan penuh', () => {
  it('mengalokasikan pembayaran sebagian ke cicilan terlama', () => {
    const result = allocatePayment({ amount: 400_000, targets });
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.installmentNumber).toBe(1);
    expect(result.allocations[0]!.toInstallment).toBe(400_000);
    expect(result.allocations[0]!.resultingOutstanding).toBe(600_000);
    expect(result.unallocated).toBe(0);
  });

  it('mengalokasikan pembayaran penuh dan melanjutkan ke cicilan berikutnya', () => {
    const result = allocatePayment({ amount: 2_500_000, targets });
    expect(result.allocations).toHaveLength(3);
    expect(result.allocations[0]!.toInstallment).toBe(1_000_000);
    expect(result.allocations[0]!.resultingPaidAmount).toBe(1_000_000);
    expect(result.allocations[1]!.toInstallment).toBe(1_000_000);
    expect(result.allocations[2]!.toInstallment).toBe(500_000);
    expect(result.allocations[2]!.resultingOutstanding).toBe(500_000);
    expect(result.totalAllocated).toBe(2_500_000);
  });

  it('melunasi seluruh kewajiban dan menyisakan nol', () => {
    const result = allocatePayment({ amount: 3_000_000, targets });
    expect(result.totalAllocated).toBe(3_000_000);
    expect(result.allocations.every((line) => line.resultingOutstanding === 0)).toBe(true);
  });

  it('melewati cicilan yang sudah lunas', () => {
    const partial = [target(1, '2026-01-15', 1_000_000, 1_000_000), target(2, '2026-02-15', 1_000_000)];
    const result = allocatePayment({ amount: 500_000, targets: partial });
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.installmentNumber).toBe(2);
  });

  it('tidak pernah mengalokasikan melebihi sisa tagihan cicilan', () => {
    const result = allocatePayment({ amount: 3_000_000, targets });
    for (const line of result.allocations) {
      expect(line.toInstallment).toBeLessThanOrEqual(1_000_000);
      expect(line.resultingOutstanding).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('allocation — denda', () => {
  it('melunasi denda lebih dulu bila dikonfigurasi', () => {
    const withPenalty = [target(1, '2026-01-15', 1_000_000, 0, 100_000)];
    const result = allocatePayment({ amount: 250_000, targets: withPenalty, penaltyFirst: true });
    expect(result.allocations[0]!.toPenalty).toBe(100_000);
    expect(result.allocations[0]!.toInstallment).toBe(150_000);
    expect(result.allocatedToPenalty).toBe(100_000);
    expect(result.allocations[0]!.resultingPenaltyOutstanding).toBe(0);
    expect(result.allocations[0]!.resultingOutstanding).toBe(850_000);
  });

  it('mengalokasikan ke tagihan lebih dulu bila denda tidak diprioritaskan', () => {
    const withPenalty = [target(1, '2026-01-15', 1_000_000, 0, 100_000)];
    const result = allocatePayment({ amount: 250_000, targets: withPenalty });
    expect(result.allocations[0]!.toInstallment).toBe(250_000);
    expect(result.allocations[0]!.toPenalty).toBe(0);
  });

  it('melanjutkan ke denda setelah tagihan cicilan lunas', () => {
    const withPenalty = [target(1, '2026-01-15', 1_000_000, 0, 100_000)];
    const result = allocatePayment({ amount: 1_100_000, targets: withPenalty });
    expect(result.allocations[0]!.toInstallment).toBe(1_000_000);
    expect(result.allocations[0]!.toPenalty).toBe(100_000);
    expect(result.unallocated).toBe(0);
  });

  it('hanya mengenakan denda pada cicilan yang bersangkutan', () => {
    const mixed = [target(1, '2026-01-15', 1_000_000, 0, 50_000), target(2, '2026-02-15', 1_000_000)];
    const result = allocatePayment({ amount: 1_050_000, targets: mixed });
    expect(result.allocations.find((line) => line.installmentNumber === 2)).toBeUndefined();
  });
});

describe('allocation — kelebihan bayar', () => {
  it('menolak kelebihan bayar secara default', () => {
    expect(() => allocatePayment({ amount: 5_000_000, targets })).toThrow(MoneyError);
  });

  it('mencatat sisa sebagai kelebihan bayar bila diizinkan', () => {
    const result = allocatePayment({ amount: 3_500_000, targets, allowOverpayment: true });
    expect(result.totalAllocated).toBe(3_000_000);
    expect(result.unallocated).toBe(500_000);
  });

  it('memvalidasi nominal terhadap kewajiban', () => {
    expect(validatePaymentAmount({ amount: 0, targets }).valid).toBe(false);
    expect(validatePaymentAmount({ amount: 1_000, targets: [] }).message).toContain('Tidak ada kewajiban');
    expect(validatePaymentAmount({ amount: 5_000_000, targets }).valid).toBe(false);
    expect(validatePaymentAmount({ amount: 5_000_000, targets, allowOverpayment: true }).valid).toBe(true);
    expect(validatePaymentAmount({ amount: 1_000_000, targets }).valid).toBe(true);
  });
});

describe('allocation — idempotency dan reversal', () => {
  it('memvalidasi idempotency key', () => {
    expect(isValidIdempotencyKey('abcdefghijklmnop')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has space in key 1234')).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
  });

  it('membentuk idempotency key yang valid', () => {
    const key = buildIdempotencyKey(['ctr-001', 1700000000000, 'cashier']);
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it('menghasilkan baris alokasi untuk disimpan', () => {
    const result = allocatePayment({ amount: 1_500_000, targets });
    const records = buildAllocationRecords('pay-1', result);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      payment_id: 'pay-1',
      installment_id: 'inst-1',
      amount: 1_000_000,
      penalty_amount: 0,
    });
  });

  it('menolak pembayaran bernilai nol atau negatif', () => {
    expect(() => allocatePayment({ amount: 0, targets })).toThrow(MoneyError);
    expect(() => allocatePayment({ amount: -1000, targets })).toThrow(MoneyError);
  });

  it('memvalidasi alasan pembatalan pembayaran', () => {
    expect(validateReversal({ paymentAmount: 100_000, reason: 'no' }).message).toContain('minimal 5');
    expect(validateReversal({ paymentAmount: 100_000, reason: 'salah nominal cicilan' }).valid).toBe(true);
    expect(validateReversal({ paymentAmount: 100_000, reason: 'salah nominal', alreadyReversed: true }).valid).toBe(
      false,
    );
  });
});
