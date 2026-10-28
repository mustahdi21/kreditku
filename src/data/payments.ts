/**
 * payments.ts — Akses data pembayaran, alokasi, pembatalan, dan denda.
 *
 * Pencatatan pembayaran TIDAK PERNAH dilakukan dengan INSERT langsung ke tabel:
 * seluruhnya melalui RPC `rpc_post_payment` agar idempotensi, alokasi,
 * pembaruan saldo, dan audit log dijalankan secara transaksional di database.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { unwrap, unwrapMaybe, pageRange, queryKeys, sanitizeSearchTerm, supabase } from '@/data/client';
import type {
  InstallmentDetailRow,
  ListResult,
  PaymentAllocationRow,
  PaymentReversalRow,
  PaymentWithRelations,
  PenaltyRow,
} from '@/data/types';
import type { AllocationOrder, PaymentMethod, PenaltyStatus } from '@/core/types';
import { toAppError } from '@/lib/errors';

/* -------------------------------------------------------------------------- */
/* Daftar & detail pembayaran                                                 */
/* -------------------------------------------------------------------------- */

export interface PaymentFilters {
  readonly search: string;
  readonly methods: readonly PaymentMethod[];
  readonly status: 'POSTED' | 'REVERSED' | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly contractId?: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_PAYMENT_FILTERS: PaymentFilters = {
  search: '',
  methods: [],
  status: null,
  from: null,
  to: null,
  contractId: null,
  page: 1,
  pageSize: 20,
};

export async function fetchPayments(filters: PaymentFilters): Promise<ListResult<PaymentWithRelations>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.payments)
    .select(
      '*, credit_contracts (id, contract_number, customer_id, customers (full_name, customer_number)), profiles!payments_created_by_fkey (full_name, email)',
      { count: 'exact' },
    )
    .order('paid_at', { ascending: false })
    .range(from, to);

  const term = sanitizeSearchTerm(filters.search);
  if (term) query = query.or(`receipt_number.ilike.%${term}%,reference.ilike.%${term}%`);
  if (filters.methods.length > 0) query = query.in('method', filters.methods as string[]);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.from) query = query.gte('paid_date', filters.from);
  if (filters.to) query = query.lte('paid_date', filters.to);
  if (filters.contractId) query = query.eq('contract_id', filters.contractId);

  const result = await query;
  return { rows: unwrap<PaymentWithRelations[]>(result as never, 'memuat pembayaran'), total: result.count ?? 0 };
}

export function usePayments(filters: PaymentFilters) {
  return useQuery({
    queryKey: queryKeys.payments(filters),
    queryFn: () => fetchPayments(filters),
    placeholderData: (previous) => previous,
  });
}

export async function fetchPayment(id: string): Promise<PaymentWithRelations> {
  const result = await supabase()
    .from(TABLES.payments)
    .select(
      '*, credit_contracts (id, contract_number, customer_id, customers (full_name, customer_number)), profiles!payments_created_by_fkey (full_name, email)',
    )
    .eq('id', id)
    .maybeSingle();
  const row = unwrapMaybe<PaymentWithRelations>(result as never, 'memuat detail pembayaran');
  if (!row) throw toAppError({ code: 'P0002', message: 'Pembayaran tidak ditemukan.' });
  return row;
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payment(id ?? ''),
    queryFn: () => fetchPayment(id!),
    enabled: Boolean(id),
  });
}

export async function fetchPaymentAllocations(paymentId: string): Promise<PaymentAllocationRow[]> {
  const result = await supabase()
    .from(TABLES.allocations)
    .select('id, payment_id, installment_id, amount, penalty_amount, installments (installment_number, due_date, total_due)')
    .eq('payment_id', paymentId)
    .order('created_at');
  return unwrap<PaymentAllocationRow[]>(result as never, 'memuat alokasi pembayaran');
}

export function usePaymentAllocations(paymentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.paymentAllocations(paymentId ?? ''),
    queryFn: () => fetchPaymentAllocations(paymentId!),
    enabled: Boolean(paymentId),
  });
}

export async function fetchPaymentReversal(paymentId: string): Promise<PaymentReversalRow | null> {
  const result = await supabase()
    .from(TABLES.reversals)
    .select('*, profiles (full_name, email)')
    .eq('payment_id', paymentId)
    .maybeSingle();
  return unwrapMaybe<PaymentReversalRow>(result as never, 'memuat pembatalan pembayaran');
}

export function usePaymentReversal(paymentId: string | undefined) {
  return useQuery({
    queryKey: ['payment-reversal', paymentId ?? ''],
    queryFn: () => fetchPaymentReversal(paymentId!),
    enabled: Boolean(paymentId),
  });
}

/** Pembayaran pada satu kontrak. */
export async function fetchContractPayments(contractId: string): Promise<PaymentWithRelations[]> {
  const result = await supabase()
    .from(TABLES.payments)
    .select('*, credit_contracts (id, contract_number, customer_id, customers (full_name, customer_number)), profiles!payments_created_by_fkey (full_name, email)')
    .eq('contract_id', contractId)
    .order('paid_at', { ascending: false });
  return unwrap<PaymentWithRelations[]>(result as never, 'memuat pembayaran kontrak');
}

export function useContractPayments(contractId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.contractPayments(contractId ?? ''),
    queryFn: () => fetchContractPayments(contractId!),
    enabled: Boolean(contractId),
  });
}

/* -------------------------------------------------------------------------- */
/* Pencatatan pembayaran                                                      */
/* -------------------------------------------------------------------------- */

export interface PostPaymentInput {
  readonly contractId: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly paidAt: string;
  readonly idempotencyKey: string;
  readonly reference?: string | null;
  readonly notes?: string | null;
  readonly allocationOrder?: AllocationOrder;
  readonly penaltyFirst?: boolean;
  readonly allowOverpayment?: boolean;
  readonly manualInstallments?: string[];
  readonly proofPath?: string | null;
}

export interface PostPaymentResult {
  readonly duplicate: boolean;
  readonly payment_id: string;
  readonly receipt_number: string;
  readonly amount: number;
  readonly unallocated: number;
  readonly allocations?: { installment_id: string; installment_number: number; to_installment: number; to_penalty: number }[];
}

export function usePostPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostPaymentInput): Promise<PostPaymentResult> => {
      const result = await supabase().rpc(RPC.postPayment, {
        p_contract_id: input.contractId,
        p_amount: input.amount,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey,
        p_paid_at: input.paidAt,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
        p_allocation_order: input.allocationOrder ?? null,
        p_penalty_first: input.penaltyFirst ?? null,
        p_allow_overpayment: input.allowOverpayment ?? null,
        p_manual_installments: input.manualInstallments ?? null,
        p_proof_path: input.proofPath ?? null,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as PostPaymentResult;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contractPayments(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contract(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contractInstallments(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: ['installments'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['penalties'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Membatalkan (reversal) pembayaran yang sudah diposting. */
export function useReversePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { paymentId: string; reason: string }) => {
      const result = await supabase().rpc(RPC.reversePayment, {
        p_payment_id: params.paymentId,
        p_reason: params.reason,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as { payment_id: string; reversal_number: string; amount: number };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payment(variables.paymentId) });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['contract'] });
      void queryClient.invalidateQueries({ queryKey: ['contract-installments'] });
      void queryClient.invalidateQueries({ queryKey: ['installments'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Denda                                                                      */
/* -------------------------------------------------------------------------- */

export interface PenaltyFilters {
  readonly search: string;
  readonly statuses: readonly PenaltyStatus[];
  readonly contractId?: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_PENALTY_FILTERS: PenaltyFilters = {
  search: '',
  statuses: ['OPEN'],
  contractId: null,
  page: 1,
  pageSize: 20,
};

export async function fetchPenalties(filters: PenaltyFilters): Promise<ListResult<PenaltyRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.penalties)
    .select('*, installments (installment_number, due_date, total_due, paid_amount, contract_id, credit_contracts (contract_number, customer_id))', {
      count: 'exact',
    })
    .order('calculated_at', { ascending: false })
    .range(from, to);

  if (filters.statuses.length > 0) query = query.in('status', filters.statuses as string[]);
  if (filters.contractId) query = query.eq('contract_id', filters.contractId);
  const term = sanitizeSearchTerm(filters.search);
  if (term) query = query.ilike('rule_snapshot_text', `%${term}%`);

  const result = await query;
  return { rows: unwrap<PenaltyRow[]>(result as never, 'memuat denda'), total: result.count ?? 0 };
}

export function usePenalties(filters: PenaltyFilters) {
  return useQuery({
    queryKey: queryKeys.penalties(filters),
    queryFn: () => fetchPenalties(filters),
    placeholderData: (previous) => previous,
  });
}

/** Menjalankan perhitungan denda untuk seluruh cicilan menunggak. */
export function useApplyPenalties() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { organizationId?: string | null; asOf?: string; contractId?: string | null } = {}) => {
      const result = await supabase().rpc(RPC.applyPenalties, {
        p_org: params.organizationId ?? null,
        p_as_of: params.asOf ?? null,
        p_contract_id: params.contractId ?? null,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as { processed: number; created: number; updated: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['penalties'] });
      void queryClient.invalidateQueries({ queryKey: ['installments'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['aging'] });
    },
  });
}

/** Membebaskan denda (sebagian atau seluruh) dengan alasan wajib. */
export function useWaivePenalty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { penaltyId: string; amount: number; reason: string }) => {
      const result = await supabase().rpc(RPC.waivePenalty, {
        p_penalty_id: params.penaltyId,
        p_amount: params.amount,
        p_reason: params.reason,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as { penalty_id: string; waived: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['penalties'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Laporan umur tunggakan (aging) per ember. */
export async function fetchAgingReport() {
  const result = await supabase().from(TABLES.agingReport).select('*');
  return unwrap<
    {
      bucket: string;
      installment_count: number;
      contract_count: number;
      principal_amount: number;
      interest_amount: number;
      fees_amount: number;
      outstanding: number;
      penalty_outstanding: number;
      max_days_late: number | null;
    }[]
  >(result, 'memuat laporan umur piutang');
}

export function useAgingReport() {
  return useQuery({ queryKey: queryKeys.aging, queryFn: fetchAgingReport });
}

/** Ringkasan kewajiban terbuka sebuah kontrak (untuk validasi nominal). */
export async function fetchContractOpenLiability(contractId: string): Promise<{
  rows: InstallmentDetailRow[];
  totalOutstanding: number;
  totalPenalty: number;
}> {
  const result = await supabase()
    .from(TABLES.installmentDetails)
    .select('*')
    .eq('contract_id', contractId)
    .order('installment_number');
  const rows = unwrap<InstallmentDetailRow[]>(result, 'memuat kewajiban kontrak').filter((row) => row.status !== 'CANCELLED');
  const totalOutstanding = rows.reduce((total, row) => total + Math.max(0, row.outstanding), 0);
  const totalPenalty = rows.reduce((total, row) => total + Math.max(0, row.penalty_outstanding), 0);
  return { rows, totalOutstanding, totalPenalty };
}

export function useContractOpenLiability(contractId: string | undefined) {
  return useQuery({
    queryKey: ['contract-liability', contractId ?? ''],
    queryFn: () => fetchContractOpenLiability(contractId!),
    enabled: Boolean(contractId),
  });
}
