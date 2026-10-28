/**
 * customers.ts — Akses data pelanggan: daftar (dengan pencarian/filter),
 * detail beserta ringkasan piutang, pembuatan, pembaruan, dan pengarsipan.
 *
 * Penomoran pelanggan dibangkitkan server-side (`fn_next_number`) sehingga
 * selalu unik meskipun beberapa pengguna membuat data bersamaan.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { unwrap, unwrapMaybe, pageRange, queryKeys, sanitizeSearchTerm, supabase, todayIso } from '@/data/client';
import type { CustomerRow, CustomerSummaryRow, ListResult, PaymentRow } from '@/data/types';
import type { ContractSummaryRow, CreditContractRow } from '@/data/types';
import type { CustomerStatus } from '@/core/types';
import { toAppError } from '@/lib/errors';
import type { CustomerInput } from '@/core/validation';

export interface CustomerFilters {
  readonly search: string;
  readonly statuses: readonly CustomerStatus[];
  readonly page: number;
  readonly pageSize: number;
  readonly sortBy: 'created_at' | 'full_name' | 'customer_number' | 'outstanding';
  readonly sortDir: 'asc' | 'desc';
}

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = {
  search: '',
  statuses: [],
  page: 1,
  pageSize: 20,
  sortBy: 'created_at',
  sortDir: 'desc',
};

/** Daftar pelanggan dari view ringkasan (termasuk total piutang). */
export async function fetchCustomers(filters: CustomerFilters): Promise<ListResult<CustomerSummaryRow>> {
  const client = supabase();
  const { from, to } = pageRange(filters.page, filters.pageSize);

  let query = client
    .from(TABLES.customerSummary)
    .select('*', { count: 'exact' })
    .order(filters.sortBy, { ascending: filters.sortDir === 'asc' })
    .range(from, to);

  const term = sanitizeSearchTerm(filters.search);
  if (term) {
    query = query.or(
      `full_name.ilike.%${term}%,customer_number.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }
  if (filters.statuses.length > 0) {
    query = query.in('status', filters.statuses as string[]);
  }

  const result = await query;
  return { rows: unwrap<CustomerSummaryRow[]>(result, 'memuat pelanggan'), total: result.count ?? 0 };
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: queryKeys.customers(filters),
    queryFn: () => fetchCustomers(filters),
    placeholderData: (previous) => previous,
  });
}

/** Detail pelanggan. */
export async function fetchCustomer(id: string): Promise<CustomerSummaryRow> {
  const result = await supabase().from(TABLES.customerSummary).select('*').eq('id', id).maybeSingle();
  const row = unwrapMaybe<CustomerSummaryRow>(result, 'memuat detail pelanggan');
  if (!row) throw toAppError({ code: 'P0002', message: 'Pelanggan tidak ditemukan.' });
  return row;
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customer(id ?? ''),
    queryFn: () => fetchCustomer(id!),
    enabled: Boolean(id),
  });
}

/** Kontrak milik seorang pelanggan. */
export async function fetchCustomerContracts(customerId: string): Promise<ContractSummaryRow[]> {
  const result = await supabase()
    .from(TABLES.contractSummary)
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  return unwrap<ContractSummaryRow[]>(result, 'memuat kontrak pelanggan');
}

export function useCustomerContracts(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customerContracts(customerId ?? ''),
    queryFn: () => fetchCustomerContracts(customerId!),
    enabled: Boolean(customerId),
  });
}

/** Pembayaran terakhir pelanggan (maksimal 20). */
export async function fetchCustomerPayments(customerId: string, limit = 20): Promise<PaymentRow[]> {
  const contracts = await supabase().from(TABLES.contracts).select('id').eq('customer_id', customerId);
  const ids = unwrap<{ id: string }[]>(contracts, 'memuat kontrak pelanggan').map((row) => row.id);
  if (ids.length === 0) return [];
  const result = await supabase()
    .from(TABLES.payments)
    .select('*')
    .in('contract_id', ids)
    .order('paid_at', { ascending: false })
    .limit(limit);
  return unwrap<PaymentRow[]>(result, 'memuat pembayaran pelanggan');
}

/** Pengajuan milik pelanggan (dipakai pada halaman detail). */
export async function fetchCustomerApplications(customerId: string) {
  const result = await supabase()
    .from(TABLES.applications)
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  return unwrap<Record<string, unknown>[]>(result, 'memuat pengajuan pelanggan');
}

/* -------------------------------------------------------------------------- */
/* Mutasi                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateCustomerResult {
  readonly customer: CustomerRow;
  readonly customerNumber: string;
}

/** Membuat pelanggan baru beserta nomor pelanggan dari server. */
export async function createCustomer(
  input: CustomerInput,
  organizationId: string,
): Promise<CreateCustomerResult> {
  const client = supabase();
  const periodKey = todayIso().slice(0, 7).replace('-', '');

  const numberResult = await client.rpc(RPC.nextNumber, {
    p_key: 'customer',
    p_period_key: periodKey,
    p_doc_date: todayIso(),
    p_doc_type: 'CUST',
  });
  if (numberResult.error) throw toAppError(numberResult.error);
  const customerNumber = String(numberResult.data ?? '');

  const payload = {
    organization_id: organizationId,
    customer_number: customerNumber,
    full_name: input.fullName,
    identity_number: input.identityNumber ?? null,
    phone: input.phone,
    email: input.email ?? null,
    address: input.address ?? null,
    birth_date: input.birthDate ?? null,
    occupation: input.occupation ?? null,
    monthly_income: input.monthlyIncome ?? null,
    emergency_contact_name: input.emergencyContactName ?? null,
    emergency_contact_phone: input.emergencyContactPhone ?? null,
    notes: input.notes ?? null,
    status: input.status,
    remind_enabled: input.remindEnabled,
  };

  const insert = await client.from(TABLES.customers).insert(payload).select('*').single();
  const customer = unwrap<CustomerRow>(insert as never, 'membuat pelanggan');
  return { customer, customerNumber };
}

export function useCreateCustomer(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => {
      if (!organizationId) throw toAppError({ message: 'Organisasi aktif tidak ditemukan.' });
      return createCustomer(input, organizationId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; input: Partial<CustomerInput> }) => {
      const patch: Record<string, unknown> = {};
      const { input } = params;
      if (input.fullName !== undefined) patch.full_name = input.fullName;
      if (input.identityNumber !== undefined) patch.identity_number = input.identityNumber ?? null;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.email !== undefined) patch.email = input.email ?? null;
      if (input.address !== undefined) patch.address = input.address ?? null;
      if (input.birthDate !== undefined) patch.birth_date = input.birthDate ?? null;
      if (input.occupation !== undefined) patch.occupation = input.occupation ?? null;
      if (input.monthlyIncome !== undefined) patch.monthly_income = input.monthlyIncome ?? null;
      if (input.emergencyContactName !== undefined) patch.emergency_contact_name = input.emergencyContactName ?? null;
      if (input.emergencyContactPhone !== undefined) patch.emergency_contact_phone = input.emergencyContactPhone ?? null;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.status !== undefined) patch.status = input.status;
      if (input.remindEnabled !== undefined) patch.remind_enabled = input.remindEnabled;

      const result = await supabase().from(TABLES.customers).update(patch).eq('id', params.id).select('*').single();
      return unwrap<CustomerRow>(result as never, 'memperbarui pelanggan');
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customer(variables.id) });
    },
  });
}

/** Mengarsipkan pelanggan (data tidak dihapus permanen). */
export function useArchiveCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; archived: boolean }) => {
      const result = await supabase()
        .from(TABLES.customers)
        .update({
          status: params.archived ? 'ARCHIVED' : 'PROSPECT',
          archived_at: params.archived ? new Date().toISOString() : null,
        })
        .eq('id', params.id)
        .select('*')
        .single();
      return unwrap<CustomerRow>(result as never, 'mengarsipkan pelanggan');
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customer(variables.id) });
    },
  });
}

/** Kontrak aktif pelanggan untuk pemilih pada formulir pembayaran. */
export async function fetchOpenContracts(customerId?: string): Promise<CreditContractRow[]> {
  let query = supabase()
    .from(TABLES.contracts)
    .select('*')
    .in('status', ['ACTIVE', 'DELINQUENT', 'RESTRUCTURED'])
    .order('contract_number', { ascending: true })
    .limit(200);
  if (customerId) query = query.eq('customer_id', customerId);
  const result = await query;
  return unwrap<CreditContractRow[]>(result, 'memuat kontrak aktif');
}

export function useOpenContracts(customerId?: string) {
  return useQuery({
    queryKey: ['open-contracts', customerId ?? 'all'],
    queryFn: () => fetchOpenContracts(customerId),
  });
}
