/**
 * types.ts — Tipe domain KreditKu.
 *
 * Nilai union di bawah ini SAMA PERSIS dengan nama enum di PostgreSQL
 * (lihat supabase/migrations/0001_init.sql). Jangan mengubah salah satu
 * tanpa mengubah pasangannya, karena hasil query akan gagal dipetakan.
 */

export const MEMBER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'CASHIER', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CUSTOMER_STATUSES = [
  'PROSPECT',
  'ACTIVE',
  'DELINQUENT',
  'PAID_OFF',
  'BLOCKED',
  'ARCHIVED',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const INTEREST_METHODS = ['NONE', 'FLAT', 'ANNUITY'] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

export const RATE_BASES = ['PER_MONTH', 'PER_YEAR'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export const PAYMENT_FREQUENCIES = ['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY'] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const ADMIN_FEE_POSITIONS = ['UPFRONT', 'FIRST_INSTALLMENT', 'SPREAD'] as const;
export type AdminFeePosition = (typeof ADMIN_FEE_POSITIONS)[number];

export const CONTRACT_STATUSES = [
  'ACTIVE',
  'PAID_OFF',
  'DELINQUENT',
  'RESTRUCTURED',
  'CANCELLED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const INSTALLMENT_STATUSES = [
  'PENDING',
  'DUE_TODAY',
  'OVERDUE',
  'PARTIAL',
  'PAID',
  'CANCELLED',
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'QRIS', 'E_WALLET', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['POSTED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PENALTY_TYPES = [
  'NONE',
  'FIXED_PER_DAY',
  'FIXED_PER_INSTALLMENT',
  'PERCENT_PER_DAY',
  'PERCENT_PER_MONTH',
] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PENALTY_STATUSES = ['OPEN', 'SETTLED', 'WAIVED', 'CANCELLED'] as const;
export type PenaltyStatus = (typeof PENALTY_STATUSES)[number];

export const REMINDER_CHANNELS = ['WHATSAPP', 'EMAIL', 'IN_APP'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_OFFSETS = ['D_MINUS_7', 'D_MINUS_3', 'D_MINUS_1', 'DUE_DATE', 'AFTER_DUE'] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const NOTIFICATION_TYPES = [
  'APPLICATION_SUBMITTED',
  'APPLICATION_DECIDED',
  'INSTALLMENT_DUE',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'CONTRACT_OVERDUE',
  'CONTRACT_AMENDED',
  'ADMIN_ACTIVITY',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ALLOCATION_ORDERS = ['OLDEST_FIRST', 'NEWEST_FIRST', 'MANUAL'] as const;
export type AllocationOrder = (typeof ALLOCATION_ORDERS)[number];

export const DUE_DATE_ADJUSTMENTS = ['NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY'] as const;
export type DueDateAdjustment = (typeof DUE_DATE_ADJUSTMENTS)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'ARCHIVE',
  'RESTORE',
  'APPROVE',
  'REJECT',
  'CANCEL',
  'POST_PAYMENT',
  'REVERSE_PAYMENT',
  'WAIVE_PENALTY',
  'LOGIN',
  'LOGOUT',
  'INVITE_USER',
  'ACTIVATE_USER',
  'DEACTIVATE_USER',
  'SETTINGS_CHANGE',
  'EXPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Label bahasa Indonesia untuk seluruh enum yang tampil di UI. */
export const ROLE_LABELS: Record<MemberRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CREDIT_OFFICER: 'Petugas Kredit',
  CASHIER: 'Kasir',
  VIEWER: 'Viewer / Auditor',
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  PROSPECT: 'Prospek',
  ACTIVE: 'Aktif',
  DELINQUENT: 'Menunggak',
  PAID_OFF: 'Lunas',
  BLOCKED: 'Diblokir',
  ARCHIVED: 'Diarsipkan',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Diajukan',
  UNDER_REVIEW: 'Dalam Pemeriksaan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  PENDING: 'Belum Jatuh Tempo',
  DUE_TODAY: 'Jatuh Tempo Hari Ini',
  OVERDUE: 'Terlambat',
  PARTIAL: 'Dibayar Sebagian',
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: 'Aktif',
  PAID_OFF: 'Lunas',
  DELINQUENT: 'Menunggak',
  RESTRUCTURED: 'Restrukturisasi',
  CANCELLED: 'Dibatalkan',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Tunai',
  BANK_TRANSFER: 'Transfer Bank',
  QRIS: 'QRIS',
  E_WALLET: 'Dompet Digital',
  OTHER: 'Lainnya',
};

export const INTEREST_METHOD_LABELS: Record<InterestMethod, string> = {
  NONE: 'Tanpa Bunga',
  FLAT: 'Bunga Flat',
  ANNUITY: 'Bunga Efektif (Anuitas)',
};

export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  PER_MONTH: 'Per Bulan',
  PER_YEAR: 'Per Tahun',
};

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  MONTHLY: 'Bulanan',
  BIWEEKLY: 'Dua Mingguan',
  WEEKLY: 'Mingguan',
  DAILY: 'Harian',
};

export const PENALTY_TYPE_LABELS: Record<PenaltyType, string> = {
  NONE: 'Tanpa Denda',
  FIXED_PER_DAY: 'Denda Nominal per Hari',
  FIXED_PER_INSTALLMENT: 'Denda Nominal per Cicilan',
  PERCENT_PER_DAY: 'Denda Persentase per Hari',
  PERCENT_PER_MONTH: 'Denda Persentase per Bulan',
};

export const PENALTY_STATUS_LABELS: Record<PenaltyStatus, string> = {
  OPEN: 'Belum Dibayar',
  SETTLED: 'Sudah Dibayar',
  WAIVED: 'Dibebaskan',
  CANCELLED: 'Dibatalkan',
};

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  IN_APP: 'Notifikasi Aplikasi',
};

export const REMINDER_OFFSET_LABELS: Record<ReminderOffset, string> = {
  D_MINUS_7: 'H-7',
  D_MINUS_3: 'H-3',
  D_MINUS_1: 'H-1',
  DUE_DATE: 'Hari H',
  AFTER_DUE: 'Setelah Jatuh Tempo',
};
