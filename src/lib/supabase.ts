/**
 * supabase.ts — Klien Supabase tunggal untuk seluruh aplikasi.
 *
 * Hanya anon/publishable key yang dipakai. Keamanan data sepenuhnya bersandar
 * pada Row Level Security di database (lihat supabase/migrations/*_rls.sql).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export type Database = Record<string, unknown>;

let client: SupabaseClient | null = null;

/** True bila konfigurasi Supabase tersedia. */
export function isSupabaseConfigured(): boolean {
  return env.isConfigured;
}

/**
 * Mengembalikan klien Supabase. Melempar error yang jelas bila konfigurasi
 * belum lengkap, sehingga UI dapat menampilkan panduan setup alih-alih
 * kegagalan yang membingungkan.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!env.isConfigured) {
    throw new Error('Supabase belum dikonfigurasi. Lengkapi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY pada berkas .env.');
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'kreditku.auth',
      },
      global: {
        headers: { 'x-application-name': 'kreditku' },
      },
    });
  }
  return client;
}

/** Klien opsional: null bila belum dikonfigurasi (dipakai saat mode setup). */
export function tryGetSupabaseClient(): SupabaseClient | null {
  if (!env.isConfigured) return null;
  return getSupabaseClient();
}

/** Nama tabel/view yang dipakai aplikasi (menghindari salah ketik). */
export const TABLES = {
  organizations: 'organizations',
  profiles: 'profiles',
  members: 'organization_members',
  customers: 'customers',
  customerSummary: 'v_customer_summary',
  products: 'credit_products',
  applications: 'credit_applications',
  applicationHistory: 'credit_application_status_history',
  applicationDocuments: 'credit_application_documents',
  contracts: 'credit_contracts',
  contractSummary: 'v_contract_summary',
  amendments: 'credit_contract_amendments',
  installments: 'installments',
  installmentDetails: 'v_installment_details',
  overdueInstallments: 'v_overdue_installments',
  dueToday: 'v_due_today',
  upcomingDue: 'v_upcoming_due',
  agingReport: 'v_aging_report',
  collectionDaily: 'v_collection_daily',
  collectionMonthly: 'v_collection_monthly',
  disbursementReport: 'v_disbursement_report',
  paymentBreakdown: 'v_payment_breakdown',
  officerPerformance: 'v_officer_performance',
  payments: 'payments',
  allocations: 'payment_allocations',
  reversals: 'payment_reversals',
  penalties: 'penalties',
  reminders: 'reminders',
  reminderTemplates: 'reminder_templates',
  notifications: 'notifications',
  auditLogs: 'audit_logs',
  settings: 'app_settings',
  documentTemplates: 'document_templates',
} as const;

/** Nama fungsi RPC yang tersedia (security definer di sisi database). */
export const RPC = {
  nextNumber: 'fn_next_number',
  submitApplication: 'rpc_submit_application',
  decideApplication: 'rpc_decide_application',
  cancelApplication: 'rpc_cancel_application',
  postPayment: 'rpc_post_payment',
  reversePayment: 'rpc_reverse_payment',
  applyPenalties: 'rpc_apply_penalties',
  waivePenalty: 'rpc_waive_penalty',
  enqueueReminders: 'rpc_enqueue_reminders',
  markReminder: 'rpc_mark_reminder',
  dashboardMetrics: 'rpc_dashboard_metrics',
  paymentSeries: 'rpc_payment_series',
  updateSettings: 'rpc_update_settings',
  registerMember: 'rpc_register_member',
  updateMember: 'rpc_update_member',
  switchOrganization: 'rpc_switch_organization',
  amendContract: 'rpc_amend_contract',
  cancelContract: 'rpc_cancel_contract',
  cancelInstallment: 'rpc_cancel_installment',
  markNotificationsRead: 'rpc_mark_notifications_read',
  touchLogin: 'fn_touch_login',
} as const;
