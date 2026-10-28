/**
 * client.ts — Utilitas akses data bersama: kunci query, pembungkus hasil,
 * dan pembantu paginasi/penyaringan.
 *
 * Seluruh akses data melewati berkas ini agar penanganan error dan pemetaan
 * hasil konsisten: setiap kegagalan Supabase diubah menjadi AppError dengan
 * pesan yang aman ditampilkan.
 */

import { getSupabaseClient } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';

/** Bentuk hasil standar Supabase yang kita butuhkan. */
interface SupabaseResult<T> {
  data: T | null;
  error: unknown;
  count?: number | null;
}

/** Mengubah hasil Supabase menjadi data, atau melempar AppError. */
export function unwrap<T>(result: SupabaseResult<T>, context: string): T {
  if (result.error) {
    const appError = toAppError(result.error);
    console.error(`[KreditKu] ${context}:`, result.error);
    throw appError;
  }
  return (result.data ?? []) as T;
}

/** Sama seperti unwrap, tetapi mengembalikan null alih-alih array kosong. */
export function unwrapMaybe<T>(result: SupabaseResult<T>, context: string): T | null {
  if (result.error) {
    const appError = toAppError(result.error);
    console.error(`[KreditKu] ${context}:`, result.error);
    throw appError;
  }
  return result.data;
}

/** Mengubah hasil berhitung menjadi jumlah baris. */
export function unwrapCount(result: SupabaseResult<unknown>): number {
  if (result.error) throw toAppError(result.error);
  return result.count ?? 0;
}

/** Kunci query React Query untuk seluruh aplikasi. */
export const queryKeys = {
  organization: ['organization'] as const,
  settings: ['settings'] as const,
  members: ['members'] as const,
  dashboard: (from: string, to: string) => ['dashboard', from, to] as const,
  paymentSeries: (from: string, to: string) => ['payment-series', from, to] as const,
  customers: (filters: unknown) => ['customers', filters] as const,
  customer: (id: string) => ['customer', id] as const,
  customerContracts: (id: string) => ['customer-contracts', id] as const,
  products: ['products'] as const,
  applications: (filters: unknown) => ['applications', filters] as const,
  application: (id: string) => ['application', id] as const,
  applicationHistory: (id: string) => ['application-history', id] as const,
  contracts: (filters: unknown) => ['contracts', filters] as const,
  contract: (id: string) => ['contract', id] as const,
  contractInstallments: (id: string) => ['contract-installments', id] as const,
  contractPayments: (id: string) => ['contract-payments', id] as const,
  contractAmendments: (id: string) => ['contract-amendments', id] as const,
  installments: (filters: unknown) => ['installments', filters] as const,
  installment: (id: string) => ['installment', id] as const,
  payments: (filters: unknown) => ['payments', filters] as const,
  payment: (id: string) => ['payment', id] as const,
  paymentAllocations: (id: string) => ['payment-allocations', id] as const,
  penalties: (filters: unknown) => ['penalties', filters] as const,
  aging: ['aging'] as const,
  receivables: (filters: unknown) => ['receivables', filters] as const,
  reminders: (filters: unknown) => ['reminders', filters] as const,
  reminderTemplates: ['reminder-templates'] as const,
  notifications: (filters: unknown) => ['notifications', filters] as const,
  notificationCount: ['notification-count'] as const,
  auditLogs: (filters: unknown) => ['audit-logs', filters] as const,
  officerPerformance: ['officer-performance'] as const,
  disbursements: (filters: unknown) => ['disbursements', filters] as const,
  collections: (filters: unknown) => ['collections', filters] as const,
};

/** Rentang halaman untuk Supabase `.range()`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, pageSize);
  return { from: (safePage - 1) * safeSize, to: safePage * safeSize - 1 };
}

/**
 * Menyusun istilah pencarian untuk kolom teks.
 * Karakter yang bermakna khusus pada filter PostgREST dibersihkan agar tidak
 * dapat mengubah struktur query.
 */
export function sanitizeSearchTerm(value: string): string {
  return value
    .trim()
    .replace(/[%,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Akses klien Supabase (melempar error ramah bila belum dikonfigurasi). */
export function supabase() {
  return getSupabaseClient();
}

/** Hari ini dalam format YYYY-MM-DD waktu lokal aplikasi. */
export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
