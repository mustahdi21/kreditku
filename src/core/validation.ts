/**
 * validation.ts — Skema validasi (Zod) untuk seluruh formulir dan aksi.
 *
 * Skema di sini adalah lapisan pertahanan PERTAMA, bukan satu-satunya.
 * Aturan bisnis yang sama juga ditegakkan di database (CHECK constraint,
 * trigger, dan RLS) karena validasi klien tidak dapat dipercaya.
 */

import { z } from 'zod';
import {
  ADMIN_FEE_POSITIONS,
  ALLOCATION_ORDERS,
  APPLICATION_STATUSES,
  CONTRACT_STATUSES,
  CUSTOMER_STATUSES,
  DUE_DATE_ADJUSTMENTS,
  INTEREST_METHODS,
  MEMBER_ROLES,
  PAYMENT_FREQUENCIES,
  PAYMENT_METHODS,
  PENALTY_TYPES,
  RATE_BASES,
  REMINDER_CHANNELS,
} from '@/core/types';
import { PENALTY_PERCENT_BASES } from '@/core/penalties';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), 'Tanggal tidak valid');

const optionalIsoDate = z.union([isoDate, z.literal(''), z.null(), z.undefined()]).transform((value) => (value ? value : null));

const rupiah = z
  .number({ invalid_type_error: 'Nominal harus berupa angka' })
  .int('Nominal harus bilangan bulat Rupiah')
  .min(0, 'Nominal tidak boleh negatif')
  .max(Number.MAX_SAFE_INTEGER, 'Nominal melebihi batas aman');

const positiveRupiah = rupiah.refine((value) => value > 0, 'Nominal harus lebih besar dari nol');

const phoneId = z
  .string()
  .trim()
  .min(8, 'Nomor telepon minimal 8 karakter')
  .max(20, 'Nomor telepon maksimal 20 karakter')
  .regex(/^[+]?[0-9\s-]{8,20}$/, 'Nomor telepon hanya boleh berisi angka, spasi, tanda hubung, dan awalan +');

const optionalEmail = z
  .union([z.string().trim().email('Format email tidak valid'), z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const nameField = z
  .string()
  .trim()
  .min(2, 'Nama minimal 2 karakter')
  .max(120, 'Nama maksimal 120 karakter')
  .regex(/^[\p{L}\p{N}\s.'\-()/&]+$/u, 'Nama mengandung karakter yang tidak diperbolehkan');

const notesField = z.string().trim().max(2000, 'Catatan maksimal 2000 karakter').optional().nullable();

/* -------------------------------------------------------------------------- */
/* Autentikasi                                                                */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  email: z.string().trim().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Format email tidak valid'),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

const strongPassword = z
  .string()
  .min(10, 'Password minimal 10 karakter')
  .regex(/[A-Za-z]/, 'Password harus mengandung huruf')
  .regex(/[0-9]/, 'Password harus mengandung angka');

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Konfirmasi password tidak sama',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const profileSchema = z.object({
  fullName: nameField,
  phone: z.union([phoneId, z.literal('')]).transform((value) => (value === '' ? null : value)).nullable().optional(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

/* -------------------------------------------------------------------------- */
/* Pengguna                                                                   */
/* -------------------------------------------------------------------------- */

export const inviteUserSchema = z.object({
  email: z.string().trim().email('Format email tidak valid'),
  fullName: nameField,
  role: z.enum(MEMBER_ROLES, { errorMap: () => ({ message: 'Role tidak valid' }) }),
  initialPassword: z.union([strongPassword, z.literal('')]).optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateMemberSchema = z.object({
  memberId: z.string().uuid('ID anggota tidak valid'),
  role: z.enum(MEMBER_ROLES),
  isActive: z.boolean(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/* -------------------------------------------------------------------------- */
/* Pelanggan                                                                  */
/* -------------------------------------------------------------------------- */

export const customerSchema = z.object({
  fullName: nameField,
  identityNumber: z.string().trim().max(40, 'Nomor identitas maksimal 40 karakter').optional().nullable(),
  phone: phoneId,
  email: optionalEmail,
  address: z.string().trim().max(500, 'Alamat maksimal 500 karakter').optional().nullable(),
  birthDate: optionalIsoDate,
  occupation: z.string().trim().max(120, 'Pekerjaan maksimal 120 karakter').optional().nullable(),
  monthlyIncome: z.union([rupiah, z.null(), z.undefined()]).optional(),
  emergencyContactName: z.string().trim().max(120).optional().nullable(),
  emergencyContactPhone: z
    .union([phoneId, z.literal('')])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  notes: notesField,
  status: z.enum(CUSTOMER_STATUSES).default('PROSPECT'),
  remindEnabled: z.boolean().default(true),
});
export type CustomerInput = z.infer<typeof customerSchema>;

/* -------------------------------------------------------------------------- */
/* Pengajuan & simulasi kredit                                                */
/* -------------------------------------------------------------------------- */

export const creditSimulationSchema = z
  .object({
    price: positiveRupiah,
    downPayment: rupiah,
    tenor: z.number().int('Tenor harus bilangan bulat').min(1, 'Tenor minimal 1 periode').max(600, 'Tenor maksimal 600 periode'),
    method: z.enum(INTEREST_METHODS),
    rateBp: z.number().min(0, 'Tarif tidak boleh negatif').max(10_000, 'Tarif maksimal 100% per basis'),
    rateBasis: z.enum(RATE_BASES),
    frequency: z.enum(PAYMENT_FREQUENCIES).default('MONTHLY'),
    adminFee: rupiah.default(0),
    otherFeePerPeriod: rupiah.default(0),
    adminFeePosition: z.enum(ADMIN_FEE_POSITIONS).default('UPFRONT'),
  })
  .refine((data) => data.downPayment <= data.price, {
    message: 'Uang muka tidak boleh melebihi harga barang',
    path: ['downPayment'],
  })
  .refine((data) => data.price - data.downPayment > 0, {
    message: 'Pokok pembiayaan harus lebih besar dari nol',
    path: ['downPayment'],
  })
  .refine((data) => data.method !== 'NONE' || data.rateBp === 0, {
    message: 'Metode tanpa bunga tidak boleh memiliki tarif bunga',
    path: ['rateBp'],
  });
export type CreditSimulationInput = z.infer<typeof creditSimulationSchema>;

export const creditApplicationSchema = z
  .object({
    customerId: z.string().uuid('Pelanggan tidak valid'),
    productId: z.string().uuid('Produk kredit tidak valid').nullable().optional(),
    creditType: z.string().trim().min(2, 'Jenis kredit minimal 2 karakter').max(80),
    price: positiveRupiah,
    downPayment: rupiah,
    tenor: z.number().int().min(1).max(600),
    method: z.enum(INTEREST_METHODS),
    rateBp: z.number().min(0).max(10_000),
    rateBasis: z.enum(RATE_BASES),
    frequency: z.enum(PAYMENT_FREQUENCIES).default('MONTHLY'),
    adminFee: rupiah.default(0),
    otherFeePerPeriod: rupiah.default(0),
    adminFeePosition: z.enum(ADMIN_FEE_POSITIONS).default('UPFRONT'),
    disbursementDate: optionalIsoDate,
    firstDueDate: isoDate,
    dueDateAdjustment: z.enum(DUE_DATE_ADJUSTMENTS).default('NONE'),
    notes: notesField,
    submit: z.boolean().default(false),
  })
  .refine((data) => data.downPayment <= data.price, {
    message: 'Uang muka tidak boleh melebihi harga barang',
    path: ['downPayment'],
  })
  .refine((data) => data.firstDueDate >= (data.disbursementDate ?? data.firstDueDate), {
    message: 'Tanggal cicilan pertama tidak boleh sebelum tanggal pencairan',
    path: ['firstDueDate'],
  });
export type CreditApplicationInput = z.infer<typeof creditApplicationSchema>;

export const applicationDecisionSchema = z
  .object({
    applicationId: z.string().uuid(),
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(5, 'Alasan keputusan wajib diisi minimal 5 karakter').max(1000),
    contractNumber: z.string().trim().max(60).optional().nullable(),
  })
  .strict();
export type ApplicationDecisionInput = z.infer<typeof applicationDecisionSchema>;

export const applicationStatusChangeSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(APPLICATION_STATUSES),
  note: z.string().trim().max(500).optional().nullable(),
});
export type ApplicationStatusChangeInput = z.infer<typeof applicationStatusChangeSchema>;

/* -------------------------------------------------------------------------- */
/* Kontrak                                                                    */
/* -------------------------------------------------------------------------- */

export const contractAmendmentSchema = z
  .object({
    contractId: z.string().uuid(),
    reason: z.string().trim().min(10, 'Alasan amandemen wajib diisi minimal 10 karakter').max(1000),
    newTenor: z.number().int().min(1).max(600),
    newRateBp: z.number().min(0).max(10_000),
    newRateBasis: z.enum(RATE_BASES),
    newFirstDueDate: isoDate,
    effectiveFrom: isoDate,
  })
  .strict();
export type ContractAmendmentInput = z.infer<typeof contractAmendmentSchema>;

export const contractStatusChangeSchema = z.object({
  contractId: z.string().uuid(),
  status: z.enum(CONTRACT_STATUSES),
  reason: z.string().trim().min(5, 'Alasan wajib diisi').max(1000),
});
export type ContractStatusChangeInput = z.infer<typeof contractStatusChangeSchema>;

/* -------------------------------------------------------------------------- */
/* Pembayaran                                                                 */
/* -------------------------------------------------------------------------- */

export const paymentSchema = z.object({
  contractId: z.string().uuid('Kontrak tidak valid'),
  amount: positiveRupiah,
  method: z.enum(PAYMENT_METHODS),
  paidAt: z.string().min(10, 'Waktu pembayaran tidak valid'),
  reference: z.string().trim().max(80, 'Referensi maksimal 80 karakter').optional().nullable(),
  notes: notesField,
  idempotencyKey: z.string().min(16).max(128),
  penaltyFirst: z.boolean().default(false),
  allocationOrder: z.enum(ALLOCATION_ORDERS).default('OLDEST_FIRST'),
  manualAllocations: z
    .array(z.object({ installmentId: z.string().uuid(), amount: positiveRupiah }))
    .optional(),
  proofPath: z.string().max(500).optional().nullable(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const paymentReversalSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().min(5, 'Alasan pembatalan wajib diisi minimal 5 karakter').max(1000),
});
export type PaymentReversalInput = z.infer<typeof paymentReversalSchema>;

/* -------------------------------------------------------------------------- */
/* Denda                                                                      */
/* -------------------------------------------------------------------------- */

export const penaltyRuleSchema = z
  .object({
    type: z.enum(PENALTY_TYPES),
    amount: z.number().min(0),
    graceDays: z.number().int().min(0).max(365),
    maxAmount: z.union([rupiah, z.null()]).default(null),
    percentBase: z.enum(PENALTY_PERCENT_BASES).default('OUTSTANDING'),
  })
  .refine((data) => data.type !== 'NONE' || data.amount === 0, {
    message: 'Aturan denda nonaktif harus bernilai 0',
    path: ['amount'],
  })
  .refine((data) => !data.type.startsWith('PERCENT') || data.amount <= 10_000, {
    message: 'Tarif denda persentase maksimal 100%',
    path: ['amount'],
  });
export type PenaltyRuleInput = z.infer<typeof penaltyRuleSchema>;

export const waivePenaltySchema = z.object({
  penaltyId: z.string().uuid(),
  amount: rupiah,
  reason: z.string().trim().min(10, 'Alasan pembebasan wajib diisi minimal 10 karakter').max(1000),
});
export type WaivePenaltyInput = z.infer<typeof waivePenaltySchema>;

/* -------------------------------------------------------------------------- */
/* Pengaturan organisasi                                                      */
/* -------------------------------------------------------------------------- */

export const businessSettingsSchema = z.object({
  businessName: z.string().trim().min(2, 'Nama usaha minimal 2 karakter').max(160),
  organizationCode: z
    .string()
    .trim()
    .min(2, 'Kode organisasi minimal 2 karakter')
    .max(12, 'Kode organisasi maksimal 12 karakter')
    .regex(/^[A-Z0-9]+$/, 'Kode organisasi hanya boleh huruf kapital dan angka'),
  logoUrl: z.string().trim().url('URL logo tidak valid').or(z.literal('')).nullable().optional(),
  address: z.string().trim().max(500).optional().nullable(),
  phone: z.union([phoneId, z.literal('')]).transform((value) => (value === '' ? null : value)).nullable().optional(),
  email: optionalEmail,
  currency: z.string().trim().length(3, 'Kode mata uang 3 huruf').default('IDR'),
  timezone: z.string().trim().min(3).default('Asia/Jakarta'),
  locale: z.string().trim().min(2).default('id-ID'),
});
export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

export const numberSettingsSchema = z.object({
  customerTemplate: z.string().trim().min(4).max(120),
  contractTemplate: z.string().trim().min(4).max(120),
  receiptTemplate: z.string().trim().min(4).max(120),
  applicationTemplate: z.string().trim().min(4).max(120),
});
export type NumberSettingsInput = z.infer<typeof numberSettingsSchema>;

export const financeSettingsSchema = z
  .object({
    defaultInterestMethod: z.enum(INTEREST_METHODS),
    defaultRateBp: z.number().min(0).max(10_000),
    defaultRateBasis: z.enum(RATE_BASES),
    defaultTenor: z.number().int().min(1).max(600),
    defaultAdminFee: rupiah,
    maxTenor: z.number().int().min(1).max(600),
    minDownPaymentPercent: z.number().min(0).max(100),
    allowOverpayment: z.boolean().default(false),
    allocationOrder: z.enum(ALLOCATION_ORDERS).default('OLDEST_FIRST'),
    penaltyFirst: z.boolean().default(false),
    requireSeparateApprover: z.boolean().default(true),
    dueDateAdjustment: z.enum(DUE_DATE_ADJUSTMENTS).default('NONE'),
    weekendDays: z.array(z.number().int().min(0).max(6)).default([0, 6]),
    holidays: z.array(isoDate).default([]),
    agingBounds: z.array(z.number().int().positive()).length(4).default([7, 30, 60, 90]),
  })
  .refine((data) => data.defaultTenor <= data.maxTenor, {
    message: 'Tenor default tidak boleh melebihi tenor maksimum',
    path: ['defaultTenor'],
  });
export type FinanceSettingsInput = z.infer<typeof financeSettingsSchema>;

export const integrationSettingsSchema = z.object({
  whatsappEnabled: z.boolean().default(false),
  whatsappProvider: z.enum(['WAHASENDER', 'CUSTOM']).default('WAHASENDER'),
  whatsappSenderName: z.string().trim().max(80).optional().nullable(),
  emailEnabled: z.boolean().default(false),
  emailFromName: z.string().trim().max(80).optional().nullable(),
  emailFromAddress: optionalEmail,
  reminderOffsets: z
    .array(z.enum(['D_MINUS_7', 'D_MINUS_3', 'D_MINUS_1', 'DUE_DATE', 'AFTER_DUE']))
    .min(1, 'Pilih minimal satu jadwal pengingat'),
  reminderChannels: z.array(z.enum(REMINDER_CHANNELS)).min(1, 'Pilih minimal satu kanal pengingat'),
  reminderSimulationMode: z.boolean().default(true),
});
export type IntegrationSettingsInput = z.infer<typeof integrationSettingsSchema>;

export const reminderTemplateSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  offset: z.enum(['D_MINUS_7', 'D_MINUS_3', 'D_MINUS_1', 'DUE_DATE', 'AFTER_DUE']),
  channel: z.enum(REMINDER_CHANNELS),
  subject: z.string().trim().max(160).optional().nullable(),
  body: z.string().trim().min(10, 'Isi template minimal 10 karakter').max(2000),
  isActive: z.boolean().default(true),
});
export type ReminderTemplateInput = z.infer<typeof reminderTemplateSchema>;

/* -------------------------------------------------------------------------- */
/* Filter & pencarian                                                         */
/* -------------------------------------------------------------------------- */

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(200).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const customerFilterSchema = z.object({
  search: z.string().trim().max(120).optional().default(''),
  status: z.array(z.enum(CUSTOMER_STATUSES)).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(200).default(20),
  sortBy: z.enum(['created_at', 'full_name', 'customer_number']).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type CustomerFilterInput = z.infer<typeof customerFilterSchema>;

export const dateRangeSchema = z.object({
  from: isoDate,
  to: isoDate,
}).refine((data) => data.from <= data.to, {
  message: 'Tanggal awal tidak boleh melebihi tanggal akhir',
  path: ['from'],
});
export type DateRangeInput = z.infer<typeof dateRangeSchema>;

/**
 * Membentuk pesan error siap tampil dari ZodError.
 * Dipakai untuk memetakan error ke field formulir.
 */
export function mapZodErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** Ringkasan pesan error dalam satu baris untuk notifikasi. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'form'}: ${issue.message}`).join('; ');
}
