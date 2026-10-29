import { describe, expect, it } from 'vitest';
import {
  applicationDecisionSchema,
  creditApplicationSchema,
  creditSimulationSchema,
  customerSchema,
  formatZodError,
  inviteUserSchema,
  loginSchema,
  mapZodErrors,
  paymentSchema,
  penaltyRuleSchema,
  resetPasswordSchema,
} from '@/core/validation';

describe('validation — autentikasi', () => {
  it('menerima login valid dan menolak email salah', () => {
    expect(loginSchema.safeParse({ email: 'admin@kreditku.id', password: 'rahasia123' }).success).toBe(true);
    const result = loginSchema.safeParse({ email: 'bukan-email', password: '123' });
    expect(result.success).toBe(false);
  });

  it('menolak password reset yang tidak memenuhi syarat keamanan', () => {
    expect(resetPasswordSchema.safeParse({ password: 'passwordku1', confirmPassword: 'passwordku1' }).success).toBe(
      true,
    );    expect(resetPasswordSchema.safeParse({ password: 'pendek', confirmPassword: 'pendek' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: 'tanpaangkaaa', confirmPassword: 'tanpaangkaaa' }).success).toBe(
      false,
    );
    expect(resetPasswordSchema.safeParse({ password: 'passwordku1', confirmPassword: 'lain' }).success).toBe(false);
  });
});

describe('validation — pelanggan', () => {
  const valid = {
    fullName: 'Budi Santoso',
    phone: '081234567890',
    status: 'ACTIVE' as const,
  };

  it('menerima data pelanggan minimal', () => {
    const result = customerSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.success && result.data.remindEnabled).toBe(true);
  });

  it('menolak nomor telepon tidak valid', () => {
    expect(customerSchema.safeParse({ ...valid, phone: 'abc' }).success).toBe(false);
    expect(customerSchema.safeParse({ ...valid, phone: '123' }).success).toBe(false);
  });

  it('mengubah email kosong menjadi null', () => {
    const result = customerSchema.safeParse({ ...valid, email: '' });
    expect(result.success && result.data.email).toBeNull();
  });

  it('menolak status yang tidak dikenal', () => {
    expect(customerSchema.safeParse({ ...valid, status: 'ENTAH' }).success).toBe(false);
  });
});

describe('validation — simulasi kredit', () => {
  const valid = {
    price: 12_000_000,
    downPayment: 2_000_000,
    tenor: 12,
    method: 'FLAT' as const,
    rateBp: 200,
    rateBasis: 'PER_MONTH' as const,
  };

  it('menerima simulasi valid', () => {
    expect(creditSimulationSchema.safeParse(valid).success).toBe(true);
  });

  it('menolak uang muka melebihi harga', () => {
    const result = creditSimulationSchema.safeParse({ ...valid, downPayment: 15_000_000 });
    expect(result.success).toBe(false);
    expect(formatZodError(result.error!)).toContain('Uang muka tidak boleh melebihi harga barang');
  });

  it('menolak tenor nol dan tarif negatif', () => {
    expect(creditSimulationSchema.safeParse({ ...valid, tenor: 0 }).success).toBe(false);
    expect(creditSimulationSchema.safeParse({ ...valid, rateBp: -1 }).success).toBe(false);
  });

  it('menolak tarif bunga pada metode tanpa bunga', () => {
    expect(
      creditSimulationSchema.safeParse({ ...valid, method: 'NONE', rateBp: 100 }).success,
    ).toBe(false);
  });

  it('menolak nominal yang bukan bilangan bulat', () => {
    expect(creditSimulationSchema.safeParse({ ...valid, price: 12_000_000.5 }).success).toBe(false);
  });
});

describe('validation — pengajuan kredit', () => {
  const valid = {
    customerId: '11111111-1111-1111-1111-111111111111',
    creditType: 'Sepeda Motor',
    price: 20_000_000,
    downPayment: 4_000_000,
    tenor: 24,
    method: 'ANNUITY' as const,
    rateBp: 100,
    rateBasis: 'PER_MONTH' as const,
    firstDueDate: '2026-02-10',
    disbursementDate: '2026-02-01',
  };

  it('menerima pengajuan valid', () => {
    expect(creditApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('menolak cicilan pertama sebelum pencairan', () => {
    const result = creditApplicationSchema.safeParse({ ...valid, firstDueDate: '2026-01-15' });
    expect(result.success).toBe(false);
    expect(formatZodError(result.error!)).toContain('sebelum tanggal pencairan');
  });

  it('mewajibkan alasan pada keputusan pengajuan', () => {
    expect(
      applicationDecisionSchema.safeParse({
        applicationId: valid.customerId,
        decision: 'APPROVED',
        reason: 'ok',
      }).success,
    ).toBe(false);
    expect(
      applicationDecisionSchema.safeParse({
        applicationId: valid.customerId,
        decision: 'REJECTED',
        reason: 'Riwayat kredit macet pada periode sebelumnya',
      }).success,
    ).toBe(true);
  });
});

describe('validation — pembayaran', () => {
  const valid = {
    contractId: '11111111-1111-1111-1111-111111111111',
    amount: 1_000_000,
    method: 'CASH' as const,
    paidAt: '2026-02-10T08:30:00Z',
    idempotencyKey: 'abcdefghijklmnop1234',
  };

  it('menerima pembayaran valid', () => {
    const result = paymentSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.success && result.data.allocationOrder).toBe('OLDEST_FIRST');
  });

  it('menolak nominal nol atau negatif', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it('mewajibkan idempotency key', () => {
    expect(paymentSchema.safeParse({ ...valid, idempotencyKey: 'pendek' }).success).toBe(false);
  });
});

describe('validation — denda', () => {
  it('menerima aturan denda valid', () => {
    expect(
      penaltyRuleSchema.safeParse({ type: 'FIXED_PER_DAY', amount: 5_000, graceDays: 3, maxAmount: 100_000 }).success,
    ).toBe(true);
  });

  it('menolak tarif denda persentase di atas 100%', () => {
    expect(
      penaltyRuleSchema.safeParse({ type: 'PERCENT_PER_DAY', amount: 20_000, graceDays: 0 }).success,
    ).toBe(false);
  });

  it('menolak nominal pada aturan nonaktif', () => {
    expect(penaltyRuleSchema.safeParse({ type: 'NONE', amount: 5_000, graceDays: 0 }).success).toBe(false);
    expect(penaltyRuleSchema.safeParse({ type: 'NONE', amount: 0, graceDays: 0 }).success).toBe(true);
  });
});

describe('validation — utilitas error', () => {
  it('memetakan error Zod ke nama field', () => {
    const result = loginSchema.safeParse({ email: 'salah', password: '1' });
    expect(result.success).toBe(false);
    const mapped = mapZodErrors(result.error!);
    expect(Object.keys(mapped)).toContain('email');
    expect(Object.keys(mapped)).toContain('password');
  });
});

describe('validation — penambahan anggota', () => {
  const dasar = { email: 'staf@kreditku.id', fullName: 'Siti Rahmawati', role: 'CASHIER' as const };

  it('menerima penambahan anggota tanpa password awal', () => {
    expect(inviteUserSchema.safeParse(dasar).success).toBe(true);
    expect(inviteUserSchema.safeParse({ ...dasar, initialPassword: '' }).success).toBe(true);
  });

  it('menerima password awal yang memenuhi syarat', () => {
    expect(inviteUserSchema.safeParse({ ...dasar, initialPassword: 'RahasiaStaf2026' }).success).toBe(true);
  });

  it('menolak password awal yang terlalu pendek', () => {
    const result = inviteUserSchema.safeParse({ ...dasar, initialPassword: 'pendek1' });
    expect(result.success).toBe(false);
  });

  it('menolak password awal tanpa angka atau tanpa huruf', () => {
    expect(inviteUserSchema.safeParse({ ...dasar, initialPassword: 'hanyahurufpanjang' }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...dasar, initialPassword: '1234567890123' }).success).toBe(false);
  });

  it('tetap menolak email dan nama yang tidak sah', () => {
    expect(inviteUserSchema.safeParse({ ...dasar, email: 'bukan-email' }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...dasar, fullName: 'A' }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...dasar, role: 'PEMILIK' }).success).toBe(false);
  });
});
