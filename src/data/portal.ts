/**
 * portal.ts — Akses data untuk portal pelanggan.
 *
 * Portal adalah permukaan TERPISAH dari aplikasi admin: yang masuk di sini
 * adalah pelanggan, bukan staf, dan mereka bukan anggota organisasi mana pun.
 * Karena itu seluruh pembatasan di lapisan ini bertumpu pada kebijakan Row Level
 * Security yang menempel pada akun pelanggan (lihat migrasi
 * 20260101000011_customer_portal.sql), bukan pada penyaringan di sisi klien.
 *
 * Konsekuensi yang perlu diingat saat mengubah berkas ini: query di sini TIDAK
 * boleh menambahkan penyaring organisasi sendiri. Yang membatasi adalah RLS.
 * Menambahkan penyaring buatan sendiri justru menyamarkan bila kebijakan di
 * database salah.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { supabase, todayIso, unwrap, unwrapMaybe } from '@/data/client';
import type {
  ContractSummaryRow,
  CustomerRow,
  InstallmentDetailRow,
  PaymentRow,
} from '@/data/types';
import { AppError, toAppError } from '@/lib/errors';
import { toDynamicQris } from '@/core/qris';

/** Satu permintaan pembayaran QRIS milik pelanggan. */
export interface QrisRequestRow {
  readonly id: string;
  readonly contract_id: string;
  readonly installment_id: string | null;
  readonly amount: number;
  readonly reference: string;
  readonly status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REVIEW';
  readonly created_at: string;
  readonly expires_at: string;
  readonly paid_at: string | null;
  readonly payment_id: string | null;
  readonly note: string | null;
  readonly confirmed_via: string | null;
}

/** Hasil pembuatan permintaan pembayaran dari server. */
export interface QrisRequestResult {
  readonly request_id: string;
  readonly reference: string;
  readonly amount: number;
  readonly contract_number: string;
  readonly installment_number: number;
  readonly due_date: string;
  readonly expires_at: string;
  readonly lanjutan: boolean;
}

/** Nominal berupa bilangan bulat rupiah; server tidak menerima pecahan untuk cicilan. */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    amount,
  );
}

export const portalKeys = {
  customer: ['portal', 'customer'] as const,
  contracts: ['portal', 'contracts'] as const,
  installments: ['portal', 'installments'] as const,
  payments: ['portal', 'payments'] as const,
  requests: ['portal', 'requests'] as const,
  qrisPayload: ['portal', 'qris-payload'] as const,
};

/**
 * Identitas pelanggan dari akun yang sedang login.
 *
 * Server yang menentukan: fungsi ini mengembalikan id baris pelanggan milik
 * pemanggil, atau null bila akun itu bukan akun pelanggan. Klien tidak pernah
 * mengirim id apa pun, sehingga akun tidak dapat menunjuk pelanggan lain.
 */
export async function fetchMyCustomerId(): Promise<string | null> {
  const result = await supabase().rpc('fn_current_customer_id');
  if (result.error) throw toAppError(result.error);
  return (result.data as string | null) ?? null;
}

/** Baris pelanggan milik akun ini; RLS memastikan hanya satu yang terlihat. */
export async function fetchMyCustomer(): Promise<CustomerRow | null> {
  const result = await supabase()
    .from(TABLES.customers)
    .select('*')
    .maybeSingle();
  return unwrapMaybe<CustomerRow>(result as never, 'memuat data pelanggan');
}

export async function fetchMyContracts(): Promise<ContractSummaryRow[]> {
  const result = await supabase()
    .from(TABLES.contractSummary)
    .select('*')
    .order('created_at', { ascending: false });
  return unwrap<ContractSummaryRow[]>(result as never, 'memuat kontrak');
}

export async function fetchMyInstallments(): Promise<InstallmentDetailRow[]> {
  const result = await supabase()
    .from(TABLES.installmentDetails)
    .select('*')
    .order('due_date', { ascending: true });
  return unwrap<InstallmentDetailRow[]>(result as never, 'memuat jadwal cicilan');
}

export async function fetchMyPayments(): Promise<PaymentRow[]> {
  const result = await supabase()
    .from(TABLES.payments)
    .select('*')
    .order('paid_at', { ascending: false })
    .limit(100);
  return unwrap<PaymentRow[]>(result as never, 'memuat riwayat pembayaran');
}

export async function fetchMyQrisRequests(): Promise<QrisRequestRow[]> {
  const result = await supabase()
    .from(TABLES.qrisRequests)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  return unwrap<QrisRequestRow[]>(result as never, 'memuat permintaan pembayaran');
}

/** Payload QRIS statis merchant, beserta nama usaha untuk kepala halaman. */
export async function fetchMerchantQris(): Promise<{ payload: string; merchantName: string | null }> {
  const result = await supabase().rpc(RPC.portalQrisPayload);
  if (result.error) throw toAppError(result.error);
  const data = result.data as { payload?: string; merchant_name?: string | null } | null;
  return { payload: data?.payload ?? '', merchantName: data?.merchant_name ?? null };
}

/**
 * Membuat permintaan pembayaran untuk satu cicilan.
 *
 * Nominal TIDAK dikirim dari sini: server yang menghitungnya dari tagihan yang
 * benar-benar terbuka. Klien hanya menyebutkan cicilan mana yang ingin dibayar.
 */
export async function createQrisRequest(contractId: string, installmentId: string | null): Promise<QrisRequestResult> {
  const result = await supabase().rpc(RPC.createQrisRequest, {
    p_contract_id: contractId,
    p_installment_id: installmentId,
  });
  if (result.error) throw toAppError(result.error);
  return result.data as QrisRequestResult;
}

export async function cancelQrisRequest(requestId: string): Promise<void> {
  const result = await supabase().rpc(RPC.cancelQrisRequest, { p_request_id: requestId });
  if (result.error) throw toAppError(result.error);
}

/**
 * Menyusun payload QR dinamis dari QR statis merchant dan nominal tagihan.
 *
 * Fungsi konversinya murni dan sudah diuji terpisah (src/core/qris.ts), termasuk
 * terhadap QR merchant sungguhan. Bila payload merchant salah ketik, konversi
 * ini yang menolaknya lebih dulu — bukan pelanggan yang menemukannya saat gagal
 * membayar.
 */
export function buildPaymentQrPayload(staticPayload: string, amount: number): string {
  return toDynamicQris(staticPayload, amount);
}

/* -------------------------------------------------------------------------- */
/* Hook React Query                                                           */
/* -------------------------------------------------------------------------- */

export function useMyCustomer() {
  return useQuery({ queryKey: portalKeys.customer, queryFn: fetchMyCustomer });
}

/** Identitas pelanggan; null berarti akun ini bukan akun pelanggan. */
export function useMyCustomerId() {
  return useQuery({ queryKey: [...portalKeys.customer, 'id'] as const, queryFn: fetchMyCustomerId });
}

export function useMyContracts() {
  return useQuery({ queryKey: portalKeys.contracts, queryFn: fetchMyContracts });
}

export function useMyInstallments() {
  return useQuery({ queryKey: portalKeys.installments, queryFn: fetchMyInstallments });
}

export function useMyPayments() {
  return useQuery({ queryKey: portalKeys.payments, queryFn: fetchMyPayments });
}

export function useMyQrisRequests() {
  return useQuery({ queryKey: portalKeys.requests, queryFn: fetchMyQrisRequests });
}

export function useMerchantQris() {
  return useQuery({ queryKey: portalKeys.qrisPayload, queryFn: fetchMerchantQris, staleTime: 60 * 60 * 1000 });
}

/** Membuat permintaan pembayaran; menyegarkan daftar permintaan setelahnya. */
export function useCreateQrisRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { contractId: string; installmentId: string | null }) =>
      createQrisRequest(params.contractId, params.installmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portalKeys.requests });
    },
  });
}

export function useCancelQrisRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => cancelQrisRequest(requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portalKeys.requests });
    },
  });
}

/**
 * Cicilan yang perlu dibayar, diurutkan dari yang paling mendesak.
 *
 * Dipakai portal untuk menonjolkan tagihan berikutnya; cicilan yang belum jatuh
 * tempo tetap tampil agar pelanggan dapat membayar lebih awal.
 */
export function payableInstallments(rows: readonly InstallmentDetailRow[]): InstallmentDetailRow[] {
  return rows
    .filter((row) => row.stored_status !== 'CANCELLED' && (row.outstanding ?? 0) + (row.penalty_outstanding ?? 0) > 0)
    .sort((a, b) => {
      const aLate = (a.late_days ?? 0) > 0 ? 0 : 1;
      const bLate = (b.late_days ?? 0) > 0 ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;
      return a.due_date.localeCompare(b.due_date);
    });
}

/** Total yang harus dibayar hari ini: seluruh tagihan terbuka. */
export function totalOutstanding(rows: readonly InstallmentDetailRow[]): {
  readonly pokok: number;
  readonly denda: number;
  readonly total: number;
} {
  let pokok = 0;
  let denda = 0;
  for (const row of payableInstallments(rows)) {
    pokok += row.outstanding ?? 0;
    denda += row.penalty_outstanding ?? 0;
  }
  return { pokok, denda, total: pokok + denda };
}

/** Tanggal hari ini dalam bentuk ISO, dipakai untuk menandai keterlambatan. */
export function isOverdue(row: InstallmentDetailRow): boolean {
  return (row.late_days ?? 0) > 0 && (row.outstanding ?? 0) > 0 && row.due_date < todayIso();
}

/* -------------------------------------------------------------------------- */
/* Pendaftaran akun portal                                                     */
/* -------------------------------------------------------------------------- */

export interface InvitePreview {
  readonly customerName: string | null;
  readonly expiresAt: string | null;
}

export interface SignupInput {
  readonly code: string;
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
}

interface SignupResponse {
  readonly ok?: boolean;
  readonly mode?: 'PERIKSA' | 'DAFTAR';
  readonly message?: string;
  readonly customer_name?: string | null;
  readonly expires_at?: string | null;
}

/**
 * Memanggil Edge Function customer-signup.
 *
 * Fungsi itu menjawab galat sebagai nilai beserta status HTTP 4xx, sedangkan
 * supabase-js menggantinya dengan pesan umum "Edge Function returned a non-2xx
 * status code". Karena itu badan balasannya dibaca langsung dari konteks galat;
 * tanpa itu pendaftar hanya melihat pesan umum dan tidak tahu apa yang salah.
 */
async function invokeCustomerSignup(body: Record<string, unknown>): Promise<SignupResponse> {
  const { data, error } = await supabase().functions.invoke('customer-signup', { body });

  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const parsed = (await context.json()) as SignupResponse | null;
        if (parsed?.message) throw new AppError('VALIDATION', parsed.message);
      } catch (inner) {
        if (inner instanceof AppError) throw inner;
      }
    }
    throw toAppError(error);
  }

  return (data ?? {}) as SignupResponse;
}

/** Memeriksa kode undangan; tidak mengubah apa pun. */
export async function checkInviteCode(code: string): Promise<InvitePreview> {
  const hasil = await invokeCustomerSignup({ code });
  return { customerName: hasil.customer_name ?? null, expiresAt: hasil.expires_at ?? null };
}

/** Mendaftarkan akun portal memakai kode undangan. */
export async function registerCustomerAccount(input: SignupInput): Promise<{ customerName: string | null }> {
  const hasil = await invokeCustomerSignup({ ...input });
  return { customerName: hasil.customer_name ?? null };
}
