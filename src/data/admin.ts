/**
 * admin.ts — Pengaturan organisasi, anggota, pengingat, notifikasi, dan audit log.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { unwrap, unwrapMaybe, pageRange, queryKeys, supabase } from '@/data/client';
import type {
  AppSettingsRow,
  AuditLogRow,
  ListResult,
  MemberRow,
  NotificationRow,
  OrganizationRow,
  ReminderRow,
  ReminderTemplateRow,
} from '@/data/types';
import type { MemberRole, ReminderChannel, ReminderOffset, ReminderStatus } from '@/core/types';
import { toAppError } from '@/lib/errors';

/* -------------------------------------------------------------------------- */
/* Organisasi & pengaturan                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchOrganization(organizationId: string): Promise<OrganizationRow> {
  const result = await supabase().from(TABLES.organizations).select('*').eq('id', organizationId).maybeSingle();
  const row = unwrapMaybe<OrganizationRow>(result, 'memuat organisasi');
  if (!row) throw toAppError({ code: 'P0002', message: 'Organisasi tidak ditemukan.' });
  return row;
}

export function useOrganization(organizationId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.organization, organizationId],
    queryFn: () => fetchOrganization(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export async function fetchSettings(organizationId: string): Promise<AppSettingsRow> {
  const result = await supabase().from(TABLES.settings).select('*').eq('organization_id', organizationId).maybeSingle();
  const row = unwrapMaybe<AppSettingsRow>(result, 'memuat pengaturan');
  if (!row) throw toAppError({ code: 'P0002', message: 'Pengaturan organisasi belum tersedia.' });
  return row;
}

export function useSettings(organizationId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.settings, organizationId],
    queryFn: () => fetchSettings(organizationId!),
    enabled: Boolean(organizationId),
  });
}

/**
 * Memperbarui satu bagian pengaturan.
 * Nilai divalidasi ulang dan dibatasi oleh fungsi server `rpc_update_settings`
 * (bagian integrasi hanya untuk Super Admin).
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      section: 'business' | 'numbering' | 'finance' | 'penalty' | 'integrations' | 'ui';
      value: Record<string, unknown>;
    }) => {
      const result = await supabase().rpc(RPC.updateSettings, {
        p_section: params.section,
        p_value: params.value,
      });
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.organization });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Anggota organisasi                                                         */
/* -------------------------------------------------------------------------- */

export async function fetchMembers(organizationId: string): Promise<MemberRow[]> {
  const result = await supabase()
    .from(TABLES.members)
    .select('*, profiles!organization_members_user_id_fkey (id, full_name, email, phone, is_active)')
    .eq('organization_id', organizationId)
    .order('created_at');
  return unwrap<MemberRow[]>(result as never, 'memuat anggota organisasi');
}

export function useMembers(organizationId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.members, organizationId],
    queryFn: () => fetchMembers(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { memberId: string; role: MemberRole; isActive: boolean }) => {
      const result = await supabase().rpc(RPC.updateMember, {
        p_member_id: params.memberId,
        p_role: params.role,
        p_is_active: params.isActive,
      });
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members });
    },
  });
}

/** Kinerja petugas (dari view). */
export async function fetchOfficerPerformance() {
  const result = await supabase().from(TABLES.officerPerformance).select('*').order('payments_amount', { ascending: false });
  return unwrap<
    {
      user_id: string;
      full_name: string;
      email: string;
      role: MemberRole;
      payments_count: number;
      payments_amount: number;
      applications_count: number;
      approvals_count: number;
      rejections_count: number;
    }[]
  >(result, 'memuat kinerja petugas');
}

export function useOfficerPerformance() {
  return useQuery({ queryKey: queryKeys.officerPerformance, queryFn: fetchOfficerPerformance });
}

/* -------------------------------------------------------------------------- */
/* Pengingat                                                                  */
/* -------------------------------------------------------------------------- */

export interface ReminderFilters {
  readonly statuses: readonly ReminderStatus[];
  readonly channels: readonly ReminderChannel[];
  readonly from: string | null;
  readonly to: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_REMINDER_FILTERS: ReminderFilters = {
  statuses: [],
  channels: [],
  from: null,
  to: null,
  page: 1,
  pageSize: 20,
};

export async function fetchReminders(filters: ReminderFilters): Promise<ListResult<ReminderRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.reminders)
    .select(
      '*, installments (installment_number, due_date), credit_contracts (contract_number), customers (full_name, phone)',
      { count: 'exact' },
    )
    .order('scheduled_for', { ascending: false })
    .range(from, to);

  if (filters.statuses.length > 0) query = query.in('status', filters.statuses as string[]);
  if (filters.channels.length > 0) query = query.in('channel', filters.channels as string[]);
  if (filters.from) query = query.gte('scheduled_for', filters.from);
  if (filters.to) query = query.lte('scheduled_for', filters.to);

  const result = await query;
  return { rows: unwrap<ReminderRow[]>(result as never, 'memuat pengingat'), total: result.count ?? 0 };
}

export function useReminders(filters: ReminderFilters) {
  return useQuery({
    queryKey: queryKeys.reminders(filters),
    queryFn: () => fetchReminders(filters),
    placeholderData: (previous) => previous,
  });
}

export async function fetchReminderTemplates(organizationId: string): Promise<ReminderTemplateRow[]> {
  const result = await supabase()
    .from(TABLES.reminderTemplates)
    .select('*')
    .eq('organization_id', organizationId)
    .order('offset_key');
  return unwrap<ReminderTemplateRow[]>(result, 'memuat template pengingat');
}

export function useReminderTemplates(organizationId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.reminderTemplates, organizationId],
    queryFn: () => fetchReminderTemplates(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export function useSaveReminderTemplate(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string | null;
      offset: ReminderOffset;
      channel: ReminderChannel;
      subject?: string | null;
      body: string;
      isActive: boolean;
    }) => {
      if (!organizationId) throw toAppError({ message: 'Organisasi aktif tidak ditemukan.' });
      const payload = {
        organization_id: organizationId,
        offset_key: input.offset,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        is_active: input.isActive,
      };
      const result = input.id
        ? await supabase().from(TABLES.reminderTemplates).update(payload).eq('id', input.id).select('*').single()
        : await supabase().from(TABLES.reminderTemplates).upsert(payload, { onConflict: 'organization_id,offset_key,channel' }).select('*').single();
      return unwrap<ReminderTemplateRow>(result as never, 'menyimpan template pengingat');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminderTemplates });
    },
  });
}

/** Membentuk antrean pengingat berdasarkan jadwal (idempoten). */
export function useEnqueueReminders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { asOf?: string } = {}) => {
      const result = await supabase().rpc(RPC.enqueueReminders, {
        p_org: null,
        p_as_of: params.asOf ?? null,
      });
      if (result.error) throw toAppError(result.error);
      return result.data as { inserted: number; as_of: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

/** Menandai hasil pengiriman pengingat (dipakai setelah pengiriman manual/proses berkala). */
export function useMarkReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { reminderId: string; status: ReminderStatus; error?: string | null }) => {
      const result = await supabase().rpc(RPC.markReminder, {
        p_reminder_id: params.reminderId,
        p_status: params.status,
        p_error: params.error ?? null,
      });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Notifikasi                                                                 */
/* -------------------------------------------------------------------------- */

export interface NotificationFilters {
  readonly unreadOnly: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export async function fetchNotifications(filters: NotificationFilters): Promise<ListResult<NotificationRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.notifications)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (filters.unreadOnly) query = query.eq('is_read', false);
  const result = await query;
  return { rows: unwrap<NotificationRow[]>(result, 'memuat notifikasi'), total: result.count ?? 0 };
}

export function useNotifications(filters: NotificationFilters) {
  return useQuery({
    queryKey: queryKeys.notifications(filters),
    queryFn: () => fetchNotifications(filters),
    placeholderData: (previous) => previous,
  });
}

export async function fetchUnreadCount(): Promise<number> {
  const result = await supabase()
    .from(TABLES.notifications)
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);
  if (result.error) throw toAppError(result.error);
  return result.count ?? 0;
}

/** Jumlah notifikasi belum dibaca (dipakai lencana pada topbar). */
export function useUnreadNotificationCount(): number {
  const query = useQuery({
    queryKey: queryKeys.notificationCount,
    queryFn: fetchUnreadCount,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return query.data ?? 0;
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const result = await supabase().rpc(RPC.markNotificationsRead, { p_ids: ids ?? null });
      if (result.error) throw toAppError(result.error);
      return Number(result.data ?? 0);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationCount });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export interface AuditFilters {
  readonly search: string;
  readonly action: string | null;
  readonly entityType: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  search: '',
  action: null,
  entityType: null,
  from: null,
  to: null,
  page: 1,
  pageSize: 20,
};

export async function fetchAuditLogs(filters: AuditFilters): Promise<ListResult<AuditLogRow>> {
  const { from, to } = pageRange(filters.page, filters.pageSize);
  let query = supabase()
    .from(TABLES.auditLogs)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.action) query = query.eq('action', filters.action);
  if (filters.entityType) query = query.eq('entity_type', filters.entityType);
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`);
  if (filters.search.trim()) {
    const term = filters.search.trim().replace(/[%,()*\\]/g, ' ').slice(0, 80);
    query = query.or(`summary.ilike.%${term}%,actor_email.ilike.%${term}%,entity_type.ilike.%${term}%`);
  }

  const result = await query;
  return { rows: unwrap<AuditLogRow[]>(result, 'memuat audit log'), total: result.count ?? 0 };
}

export function useAuditLogs(filters: AuditFilters) {
  return useQuery({
    queryKey: queryKeys.auditLogs(filters),
    queryFn: () => fetchAuditLogs(filters),
    placeholderData: (previous) => previous,
  });
}

/* -------------------------------------------------------------------------- */
/* Profil pengguna                                                            */
/* -------------------------------------------------------------------------- */

export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; fullName: string; phone: string | null }) => {
      const result = await supabase()
        .from(TABLES.profiles)
        .update({ full_name: params.fullName, phone: params.phone })
        .eq('id', params.userId)
        .select('*')
        .single();
      return unwrap<Record<string, unknown>>(result as never, 'memperbarui profil');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-profile'] });
    },
  });
}

export function useChangeOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await supabase().rpc(RPC.switchOrganization, { p_organization_id: organizationId });
      if (result.error) throw toAppError(result.error);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
