/**
 * credit.ts — Akses data produk kredit, pengajuan, kontrak, dan cicilan.
 *
 * Aksi yang mengubah nilai finansial (persetujuan pengajuan, amandemen,
 * pembatalan) SELALU melalui fungsi RPC server-side agar validasi, transaksi,
 * dan audit log dijalankan di database.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { unwrap, unwrapMaybe, pageRange, queryKeys, sanitizeSearchTerm, supabase, todayIso } from '@/data/client';
import type {
  ApplicationHistoryRow,
  ApplicationWithRelations,
  ContractSummaryRow,
  CreditApplicationRow,
  CreditProductRow,
  InstallmentDetailRow,
  ListResult,
} from '@/data/types';
import type { ApplicationStatus, ContractStatus, InstallmentStatus } from '@/core/types';
import { toAppError } from '@/lib/errors';
import type { CreditApplicationInput } from '@/core/validation';

/* -------------------------------------------------------------------------- */
/* Produk kredit                                                              */
/* -------------------------------------------------------------------------- */

export async function fetchProducts(activeOnly = true): Promise<CreditProductRow[]> {
  let query = supabase().from(TABLES.products).select('*').order('name');
  if (activeOnly) query = query.eq('is_active', true);
  const result = await query;
  return unwrap<CreditProductRow[]>(result, 'memuat produk kredit');
}

export function useProducts(activeOnly = true) {
  return useQuery({ queryKey: [...queryKeys.products, activeOnly], queryFn: () => fetchProducts(activeOnly) });
}

/* -------------------------------------------------------------------------- */
/* Pengajuan kredit                                                           */
/* -------------------------------------------------------------------------- */

export interface ApplicationFilters {
  readonly search: string;
  readonly statuses: readonly ApplicationStatus[];
  readonly customerId?: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_APPLICATION_FILTERS: ApplicationFilters = {
  search: '',
  statuses: [],
  customerId: null,
  page: 1,
  pageSize: 20,
};

export async function fetchApplications(filters: ApplicationFilters): Promise<ListResult<ApplicationWithRelations>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.applications)
    .select(
      '*, customers (id, customer_number, full_name, phone), credit_products (id, name)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  const term = sanitizeSearchTerm(filters.search);
  if (term) query = query.or(`application_number.ilike.%${term}%,credit_type.ilike.%${term}%`);
  if (filters.statuses.length > 0) query = query.in('status', filters.statuses as string[]);
  if (filters.customerId) query = query.eq('customer_id', filters.customerId);

  const result = await query;
  return { rows: unwrap<ApplicationWithRelations[]>(result, 'memuat pengajuan'), total: result.count ?? 0 };
}

export function useApplications(filters: ApplicationFilters) {
  return useQuery({
    queryKey: queryKeys.applications(filters),
    queryFn: () => fetchApplications(filters),
    placeholderData: (previous) => previous,
  });
}

export async function fetchApplication(id: string): Promise<ApplicationWithRelations> {
  const result = await supabase()
    .from(TABLES.applications)
    .select('*, customers (id, customer_number, full_name, phone), credit_products (id, name)')
    .eq('id', id)
    .maybeSingle();
  const row = unwrapMaybe<ApplicationWithRelations>(result as never, 'memuat detail pengajuan');
  if (!row) throw toAppError({ code: 'P0002', message: 'Pengajuan tidak ditemukan.' });
  return row;
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.application(id ?? ''),
    queryFn: () => fetchApplication(id!),
    enabled: Boolean(id),
  });
}

export async function fetchApplicationHistory(id: string): Promise<ApplicationHistoryRow[]> {
  const result = await supabase()
    .from(TABLES.applicationHistory)
    .select('*, profiles (full_name, email)')
    .eq('application_id', id)
    .order('created_at', { ascending: false });
  return unwrap<ApplicationHistoryRow[]>(result as never, 'memuat riwayat pengajuan');
}

export function useApplicationHistory(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.applicationHistory(id ?? ''),
    queryFn: () => fetchApplicationHistory(id!),
    enabled: Boolean(id),
  });
}

/** Membuat pengajuan baru (draft atau langsung diajukan). */
export function useCreateApplication(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreditApplicationInput) => {
      if (!organizationId) throw toAppError({ message: 'Organisasi aktif tidak ditemukan.' });
      const client = supabase();
      const periodKey = todayIso().slice(0, 7).replace('-', '');

      const numberResult = await client.rpc(RPC.nextNumber, {
        p_key: 'application',
        p_period_key: periodKey,
        p_doc_date: todayIso(),
        p_doc_type: 'APP',
      });
      if (numberResult.error) throw toAppError(numberResult.error);

      const principal = input.price - input.downPayment;
      const insert = await client
        .from(TABLES.applications)
        .insert({
          organization_id: organizationId,
          application_number: String(numberResult.data ?? ''),
          customer_id: input.customerId,
          product_id: input.productId ?? null,
          credit_type: input.creditType,
          price: input.price,
          down_payment: input.downPayment,
          principal,
          tenor: input.tenor,
          method: input.method,
          rate_bp: input.rateBp,
          rate_basis: input.rateBasis,
          frequency: input.frequency,
          admin_fee: input.adminFee,
          admin_fee_position: input.adminFeePosition,
          other_fee_per_period: input.otherFeePerPeriod,
          disbursement_date: input.disbursementDate ?? null,
          first_due_date: input.firstDueDate,
          due_date_adjustment: input.dueDateAdjustment,
          notes: input.notes ?? null,
          status: input.submit ? 'SUBMITTED' : 'DRAFT',
          submitted_at: input.submit ? new Date().toISOString() : null,
        })
        .select('*')
        .single();

      const application = unwrap<CreditApplicationRow>(insert as never, 'membuat pengajuan');
      return application;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useSubmitApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { applicationId: string; note?: string }) => {
      const result = await supabase().rpc(RPC.submitApplication, {
        p_application_id: params.applicationId,
        p_note: params.note ?? null,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.application(variables.applicationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicationHistory(variables.applicationId) });
    },
  });
}

/** Menyetujui atau menolak pengajuan. Persetujuan membuat kontrak + jadwal. */
export function useDecideApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      decision: 'APPROVED' | 'REJECTED';
      reason: string;
      contractNumber?: string | null;
    }) => {
      const result = await supabase().rpc(RPC.decideApplication, {
        p_application_id: params.applicationId,
        p_decision: params.decision,
        p_reason: params.reason,
        p_contract_number: params.contractNumber ?? null,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as {
        status: string;
        application_id: string;
        contract_id?: string;
        contract_number?: string;
        total_payable?: number;
        installments?: number;
      };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.application(variables.applicationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicationHistory(variables.applicationId) });
    },
  });
}

export function useCancelApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { applicationId: string; reason: string }) => {
      const result = await supabase().rpc(RPC.cancelApplication, {
        p_application_id: params.applicationId,
        p_reason: params.reason,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.application(variables.applicationId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Kontrak                                                                    */
/* -------------------------------------------------------------------------- */

export interface ContractFilters {
  readonly search: string;
  readonly statuses: readonly ContractStatus[];
  readonly customerId?: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_CONTRACT_FILTERS: ContractFilters = {
  search: '',
  statuses: [],
  customerId: null,
  page: 1,
  pageSize: 20,
};

export async function fetchContracts(filters: ContractFilters): Promise<ListResult<ContractSummaryRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.contractSummary)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  const term = sanitizeSearchTerm(filters.search);
  if (term) query = query.or(`contract_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_number.ilike.%${term}%`);
  if (filters.statuses.length > 0) query = query.in('status', filters.statuses as string[]);
  if (filters.customerId) query = query.eq('customer_id', filters.customerId);

  const result = await query;
  return { rows: unwrap<ContractSummaryRow[]>(result, 'memuat kontrak'), total: result.count ?? 0 };
}

export function useContracts(filters: ContractFilters) {
  return useQuery({
    queryKey: queryKeys.contracts(filters),
    queryFn: () => fetchContracts(filters),
    placeholderData: (previous) => previous,
  });
}

export async function fetchContract(id: string): Promise<ContractSummaryRow> {
  const result = await supabase().from(TABLES.contractSummary).select('*').eq('id', id).maybeSingle();
  const row = unwrapMaybe<ContractSummaryRow>(result, 'memuat detail kontrak');
  if (!row) throw toAppError({ code: 'P0002', message: 'Kontrak tidak ditemukan.' });
  return row;
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.contract(id ?? ''),
    queryFn: () => fetchContract(id!),
    enabled: Boolean(id),
  });
}

export async function fetchContractInstallments(contractId: string): Promise<InstallmentDetailRow[]> {
  const result = await supabase()
    .from(TABLES.installmentDetails)
    .select('*')
    .eq('contract_id', contractId)
    .order('installment_number', { ascending: true });
  return unwrap<InstallmentDetailRow[]>(result, 'memuat jadwal cicilan kontrak');
}

export function useContractInstallments(contractId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.contractInstallments(contractId ?? ''),
    queryFn: () => fetchContractInstallments(contractId!),
    enabled: Boolean(contractId),
  });
}

export interface AmendmentRow {
  id: string;
  contract_id: string;
  reason: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  effective_from: string;
  schedule_rebuilt: boolean;
  created_at: string;
  created_by: string | null;
}

export async function fetchContractAmendments(contractId: string): Promise<AmendmentRow[]> {
  const result = await supabase()
    .from(TABLES.amendments)
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false });
  return unwrap<AmendmentRow[]>(result, 'memuat riwayat amandemen');
}

export function useContractAmendments(contractId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.contractAmendments(contractId ?? ''),
    queryFn: () => fetchContractAmendments(contractId!),
    enabled: Boolean(contractId),
  });
}

export function useAmendContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      contractId: string;
      reason: string;
      newTenor: number;
      newRateBp: number;
      newRateBasis: 'PER_MONTH' | 'PER_YEAR';
      newFirstDueDate: string;
      effectiveFrom: string;
      rebuildSchedule: boolean;
    }) => {
      const result = await supabase().rpc(RPC.amendContract, {
        p_contract_id: params.contractId,
        p_reason: params.reason,
        p_new_tenor: params.newTenor,
        p_new_rate_bp: params.newRateBp,
        p_new_rate_basis: params.newRateBasis,
        p_new_first_due: params.newFirstDueDate,
        p_effective_from: params.effectiveFrom,
        p_rebuild_schedule: params.rebuildSchedule,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contract(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contractInstallments(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contractAmendments(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useCancelContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { contractId: string; reason: string }) => {
      const result = await supabase().rpc(RPC.cancelContract, {
        p_contract_id: params.contractId,
        p_reason: params.reason,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contract(variables.contractId) });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Cicilan                                                                    */
/* -------------------------------------------------------------------------- */

export interface InstallmentFilters {
  readonly search: string;
  readonly statuses: readonly InstallmentStatus[];
  readonly contractId?: string | null;
  readonly dueFrom?: string | null;
  readonly dueTo?: string | null;
  readonly onlyOutstanding?: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly orderBy?: 'due_date' | 'late_days' | 'outstanding';
  readonly orderDir?: 'asc' | 'desc';
}

export const DEFAULT_INSTALLMENT_FILTERS: InstallmentFilters = {
  search: '',
  statuses: [],
  contractId: null,
  dueFrom: null,
  dueTo: null,
  onlyOutstanding: true,
  page: 1,
  pageSize: 20,
  orderBy: 'due_date',
  orderDir: 'asc',
};

export async function fetchInstallments(filters: InstallmentFilters): Promise<ListResult<InstallmentDetailRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.installmentDetails)
    .select('*', { count: 'exact' })
    .order(filters.orderBy ?? 'due_date', { ascending: (filters.orderDir ?? 'asc') === 'asc' })
    .range(from, to);

  const term = sanitizeSearchTerm(filters.search);
  if (term) query = query.or(`contract_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_number.ilike.%${term}%`);
  if (filters.statuses.length > 0) query = query.in('status', filters.statuses as string[]);
  if (filters.contractId) query = query.eq('contract_id', filters.contractId);
  if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom);
  if (filters.dueTo) query = query.lte('due_date', filters.dueTo);
  if (filters.onlyOutstanding) query = query.gt('outstanding', 0);

  const result = await query;
  return { rows: unwrap<InstallmentDetailRow[]>(result, 'memuat cicilan'), total: result.count ?? 0 };
}

export function useInstallments(filters: InstallmentFilters) {
  return useQuery({
    queryKey: queryKeys.installments(filters),
    queryFn: () => fetchInstallments(filters),
    placeholderData: (previous) => previous,
  });
}

/** Cicilan yang jatuh tempo hari ini. */
export async function fetchDueToday(): Promise<InstallmentDetailRow[]> {
  const result = await supabase().from(TABLES.dueToday).select('*').order('due_date').limit(500);
  return unwrap<InstallmentDetailRow[]>(result, 'memuat cicilan jatuh tempo hari ini');
}

export function useDueToday() {
  return useQuery({ queryKey: ['installments', 'due-today'], queryFn: fetchDueToday });
}

/** Cicilan yang akan jatuh tempo dalam 7 hari. */
export async function fetchUpcomingDue(): Promise<InstallmentDetailRow[]> {
  const result = await supabase().from(TABLES.upcomingDue).select('*').order('due_date').limit(500);
  return unwrap<InstallmentDetailRow[]>(result, 'memuat cicilan mendatang');
}

export function useUpcomingDue() {
  return useQuery({ queryKey: ['installments', 'upcoming'], queryFn: fetchUpcomingDue });
}

/** Cicilan yang terlambat. */
export async function fetchOverdue(): Promise<InstallmentDetailRow[]> {
  const result = await supabase().from(TABLES.overdueInstallments).select('*').order('late_days', { ascending: false }).limit(1000);
  return unwrap<InstallmentDetailRow[]>(result, 'memuat tunggakan');
}

export function useOverdue() {
  return useQuery({ queryKey: ['installments', 'overdue'], queryFn: fetchOverdue });
}

/** Membatalkan cicilan yang belum dibayar (prosedur resmi). */
export function useCancelInstallment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { installmentId: string; reason: string }) => {
      const result = await supabase().rpc(RPC.cancelInstallment, {
        p_installment_id: params.installmentId,
        p_reason: params.reason,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['installments'] });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

/** Pratinjau nomor dokumen berikutnya (tanpa menyimpan). */
export async function previewNumber(key: string, docType: string): Promise<string> {
  const result = await supabase().rpc(RPC.nextNumber, {
    p_key: key,
    p_period_key: todayIso().replace(/-/g, '').slice(0, 6),
    p_doc_date: todayIso(),
    p_doc_type: docType,
  });
  if (result.error) throw toAppError(result.error);
  return String(result.data ?? '');
}
