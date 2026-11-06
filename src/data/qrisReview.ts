/**
 * qrisReview.ts — Antrean tinjauan pembayaran QRIS untuk kasir.
 *
 * Notifikasi pembayaran yang tidak dapat dicocokkan dengan pasti SENGAJA tidak
 * dicatat otomatis: nominal yang sama pada dua tagihan tidak dapat dipastikan
 * milik siapa, dan menebak berarti mengkreditkan uang ke kontrak orang lain.
 * Modul ini yang menyediakan jalan keluarnya — manusia yang memutuskan, dan
 * keputusannya tercatat pada audit log.
 *
 * Kewenangan tidak diperiksa di sini: server yang menentukan, dan server menolak
 * peran yang tidak berwenang mencatat pembayaran.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { supabase, unwrap } from '@/data/client';
import { toAppError } from '@/lib/errors';

/** Konfirmasi yang belum diselesaikan kasir. */
export interface UnresolvedConfirmation {
  readonly id: string;
  readonly organization_id: string;
  readonly request_id: string | null;
  readonly source: string;
  readonly amount: number | null;
  readonly reference: string | null;
  readonly raw_text: string | null;
  readonly outcome: string;
  readonly detail: string | null;
  readonly created_at: string;
}

/** Permintaan yang diparkir menunggu keputusan kasir. */
export interface ReviewRequest {
  readonly id: string;
  readonly contract_id: string;
  readonly installment_id: string | null;
  readonly amount: number;
  readonly reference: string;
  readonly status: 'REVIEW';
  readonly note: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly credit_contracts: {
    readonly contract_number: string;
    readonly customers: { readonly full_name: string; readonly customer_number: string } | null;
  } | null;
}

/** Kandidat tagihan yang dapat dipilih saat mengaitkan konfirmasi. */
export interface CandidateRequest {
  readonly id: string;
  readonly amount: number;
  readonly reference: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly credit_contracts: {
    readonly contract_number: string;
    readonly customers: { readonly full_name: string; readonly customer_number: string } | null;
  } | null;
}

const SEBAB_TINJAUAN = ['AMBIGU', 'TIDAK_COCOK', 'NOMINAL_TIDAK_TERBACA', 'GAGAL_CATAT', 'BUKAN_QRIS'];

export const qrisReviewKeys = {
  confirmations: ['qris-review', 'confirmations'] as const,
  requests: ['qris-review', 'requests'] as const,
  candidates: (amount: number) => ['qris-review', 'candidates', amount] as const,
};

export async function fetchUnresolvedConfirmations(): Promise<UnresolvedConfirmation[]> {
  const result = await supabase()
    .from(TABLES.qrisConfirmations)
    .select('id, organization_id, request_id, source, amount, reference, raw_text, outcome, detail, created_at')
    .is('resolved_at', null)
    .in('outcome', SEBAB_TINJAUAN)
    .order('created_at', { ascending: false })
    .limit(50);
  return unwrap<UnresolvedConfirmation[]>(result as never, 'memuat konfirmasi yang perlu ditinjau');
}

export async function fetchReviewRequests(): Promise<ReviewRequest[]> {
  const result = await supabase()
    .from(TABLES.qrisRequests)
    .select('*, credit_contracts (contract_number, customers (full_name, customer_number))')
    .eq('status', 'REVIEW')
    .order('created_at', { ascending: false })
    .limit(50);
  return unwrap<ReviewRequest[]>(result as never, 'memuat permintaan yang perlu ditinjau');
}

/**
 * Tagihan terbuka dengan nominal tertentu.
 *
 * Inilah yang dipilih kasir. Yang ditampilkan hanya permintaan yang masih
 * menunggu dan belum kedaluwarsa — permintaan yang sudah lewat waktunya tidak
 * boleh dicatat sebagai pembayaran baru.
 */
export async function fetchCandidateRequests(amount: number): Promise<CandidateRequest[]> {
  const result = await supabase()
    .from(TABLES.qrisRequests)
    .select('id, amount, reference, created_at, expires_at, credit_contracts (contract_number, customers (full_name, customer_number))')
    .eq('status', 'PENDING')
    .eq('amount', amount)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  return unwrap<CandidateRequest[]>(result as never, 'memuat kandidat tagihan');
}

async function rpcJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await supabase().rpc(name, args);
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}

export interface QrisPaymentResult {
  readonly status: string;
  readonly receipt_number?: string;
  readonly reference?: string;
  readonly alasan?: string;
}

/** Mengaitkan konfirmasi ke tagihan pilihan kasir. */
export async function resolveQrisConfirmation(
  confirmationId: string,
  requestId: string,
  note: string,
): Promise<QrisPaymentResult> {
  return rpcJson<QrisPaymentResult>(RPC.resolveQrisConfirmation, {
    p_confirmation_id: confirmationId,
    p_request_id: requestId,
    p_note: note.trim() === '' ? null : note.trim(),
  });
}

/** Mencatat permintaan berstatus tinjauan sebagai sudah dibayar. */
export async function confirmQrisRequestManual(requestId: string, note: string): Promise<QrisPaymentResult> {
  return rpcJson<QrisPaymentResult>(RPC.confirmQrisRequestManual, {
    p_request_id: requestId,
    p_note: note.trim() === '' ? null : note.trim(),
  });
}

export async function dismissQrisConfirmation(confirmationId: string, reason: string): Promise<void> {
  const result = await supabase().rpc(RPC.dismissQrisConfirmation, {
    p_confirmation_id: confirmationId,
    p_reason: reason.trim(),
  });
  if (result.error) throw toAppError(result.error);
}

export async function dismissQrisRequest(requestId: string, reason: string): Promise<void> {
  const result = await supabase().rpc(RPC.dismissQrisRequest, {
    p_request_id: requestId,
    p_reason: reason.trim(),
  });
  if (result.error) throw toAppError(result.error);
}

export function useUnresolvedConfirmations() {
  return useQuery({ queryKey: qrisReviewKeys.confirmations, queryFn: fetchUnresolvedConfirmations });
}

export function useReviewRequests() {
  return useQuery({ queryKey: qrisReviewKeys.requests, queryFn: fetchReviewRequests });
}

export function useCandidateRequests(amount: number | null) {
  return useQuery({
    queryKey: qrisReviewKeys.candidates(amount ?? 0),
    queryFn: async () => fetchCandidateRequests(amount as number),
    enabled: amount !== null && amount > 0,
  });
}

/** Menyegarkan seluruh antrean setelah satu keputusan diambil. */
function useRefreshQueue() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['qris-review'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['installments'] });
    void queryClient.invalidateQueries({ queryKey: ['contracts'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useResolveQrisConfirmation() {
  const refresh = useRefreshQueue();
  return useMutation({
    mutationFn: async (params: { confirmationId: string; requestId: string; note: string }) =>
      resolveQrisConfirmation(params.confirmationId, params.requestId, params.note),
    onSuccess: refresh,
  });
}

export function useConfirmQrisRequestManual() {
  const refresh = useRefreshQueue();
  return useMutation({
    mutationFn: async (params: { requestId: string; note: string }) =>
      confirmQrisRequestManual(params.requestId, params.note),
    onSuccess: refresh,
  });
}

export function useDismissQrisConfirmation() {
  const refresh = useRefreshQueue();
  return useMutation({
    mutationFn: async (params: { confirmationId: string; reason: string }) =>
      dismissQrisConfirmation(params.confirmationId, params.reason),
    onSuccess: refresh,
  });
}

export function useDismissQrisRequest() {
  const refresh = useRefreshQueue();
  return useMutation({
    mutationFn: async (params: { requestId: string; reason: string }) =>
      dismissQrisRequest(params.requestId, params.reason),
    onSuccess: refresh,
  });
}
