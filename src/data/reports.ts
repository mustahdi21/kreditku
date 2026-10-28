/**
 * reports.ts — Sumber data dashboard dan laporan.
 *
 * Angka ringkasan dihitung di server melalui `rpc_dashboard_metrics` sehingga
 * tetap konsisten dengan RLS dan tidak bergantung pada jumlah baris yang
 * diunduh klien. Deret waktu pembayaran memakai `rpc_payment_series`.
 */

import { useQuery } from '@tanstack/react-query';
import { RPC, TABLES } from '@/lib/supabase';
import { unwrap, queryKeys, supabase, todayIso } from '@/data/client';
import { buildMonthlyPaymentSeries } from '@/core/metrics';
import { lastNMonths, startOfMonthIso } from '@/lib/date';
import type { DashboardMetricsResult, PaymentSeriesRow } from '@/data/types';
import { toAppError } from '@/lib/errors';

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** Metrik dashboard dari server. */
export async function fetchDashboardMetrics(range: DateRange): Promise<DashboardMetricsResult> {
  const result = await supabase().rpc(RPC.dashboardMetrics, {
    p_from: range.from,
    p_to: range.to,
    p_org: null,
  });
  if (result.error) throw toAppError(result.error);
  return result.data as DashboardMetricsResult;
}

export function useDashboardMetrics(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard(range.from, range.to),
    queryFn: () => fetchDashboardMetrics(range),
  });
}

/** Deret pembayaran harian dari server. */
export async function fetchPaymentSeries(range: DateRange): Promise<PaymentSeriesRow[]> {
  const result = await supabase().rpc(RPC.paymentSeries, {
    p_from: range.from,
    p_to: range.to,
    p_org: null,
  });
  if (result.error) throw toAppError(result.error);
  return (result.data ?? []) as PaymentSeriesRow[];
}

export function usePaymentSeries(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.paymentSeries(range.from, range.to),
    queryFn: () => fetchPaymentSeries(range),
  });
}

/** Deret pembayaran bulanan (12 bulan terakhir) untuk grafik tren. */
export async function fetchMonthlySeries(months = 12) {
  const today = todayIso();
  const monthStarts = lastNMonths(today, months);
  const from = startOfMonthIso(monthStarts[0]!);
  const result = await supabase()
    .from(TABLES.paymentBreakdown)
    .select('paid_date, amount, status')
    .gte('paid_date', from)
    .lte('paid_date', today);

  const rows = unwrap<{ paid_date: string; amount: number; status: string }[]>(result, 'memuat deret pembayaran bulanan');
  return buildMonthlyPaymentSeries(
    rows.map((row) => ({
      id: row.paid_date,
      contractId: '',
      amount: row.amount,
      status: row.status === 'POSTED' ? 'POSTED' : 'REVERSED',
      paidDate: row.paid_date,
      method: '',
    })),
    monthStarts,
  );
}

export function useMonthlySeries(months = 12) {
  return useQuery({ queryKey: ['monthly-series', months], queryFn: () => fetchMonthlySeries(months) });
}

/** Laporan piutang berjalan (semua kontrak berjalan). */
export async function fetchReceivables() {
  const result = await supabase()
    .from(TABLES.contractSummary)
    .select(
      'id, contract_number, customer_name, customer_number, principal, total_payable, total_paid, outstanding, overdue_amount, penalty_outstanding, next_due_date, max_days_late, progress_percent, status, tenor',
    )
    .in('status', ['ACTIVE', 'DELINQUENT', 'RESTRUCTURED'])
    .gt('outstanding', 0)
    .order('outstanding', { ascending: false })
    .limit(2000);

  return unwrap<
    {
      id: string;
      contract_number: string;
      customer_name: string;
      customer_number: string;
      principal: number;
      total_payable: number;
      total_paid: number;
      outstanding: number;
      overdue_amount: number;
      penalty_outstanding: number;
      next_due_date: string | null;
      max_days_late: number;
      progress_percent: number;
      status: string;
      tenor: number;
    }[]
  >(result, 'memuat laporan piutang');
}

export function useReceivables() {
  return useQuery({ queryKey: queryKeys.receivables({}), queryFn: fetchReceivables });
}

/** Laporan pencairan dalam rentang tanggal. */
export async function fetchDisbursements(range: DateRange) {
  const result = await supabase()
    .from(TABLES.disbursementReport)
    .select('*')
    .gte('disbursement_date', range.from)
    .lte('disbursement_date', range.to)
    .order('disbursement_date', { ascending: false })
    .limit(2000);
  return unwrap<
    {
      contract_id: string;
      contract_number: string;
      disbursement_date: string | null;
      customer_name: string;
      customer_number: string;
      principal: number;
      upfront_amount: number;
      total_interest: number;
      total_fees: number;
      total_payable: number;
      tenor: number;
      method: string;
      rate_bp: number;
      status: string;
    }[]
  >(result, 'memuat laporan pencairan');
}

export function useDisbursements(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.disbursements(range),
    queryFn: () => fetchDisbursements(range),
  });
}

/** Laporan pembayaran (dengan rincian alokasi) dalam rentang tanggal. */
export async function fetchCollectionReport(range: DateRange) {
  const result = await supabase()
    .from(TABLES.paymentBreakdown)
    .select('*')
    .gte('paid_date', range.from)
    .lte('paid_date', range.to)
    .order('paid_date', { ascending: false })
    .limit(5000);
  return unwrap<
    {
      payment_id: string;
      contract_id: string;
      receipt_number: string;
      paid_date: string;
      amount: number;
      method: string;
      status: string;
      allocated_to_installments: number;
      allocated_to_penalties: number;
      unallocated: number;
      contract_number: string | null;
      customer_name: string | null;
      customer_number: string | null;
      officer_name: string | null;
    }[]
  >(result, 'memuat laporan pembayaran');
}

export function useCollectionReport(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.collections(range),
    queryFn: () => fetchCollectionReport(range),
  });
}

/** Rekap pembayaran harian dari view. */
export async function fetchCollectionDaily(range: DateRange) {
  const result = await supabase()
    .from(TABLES.collectionDaily)
    .select('*')
    .gte('paid_date', range.from)
    .lte('paid_date', range.to)
    .order('paid_date', { ascending: false });
  return unwrap<
    { paid_date: string; payment_count: number; amount: number; reversal_amount: number; contract_count: number }[]
  >(result, 'memuat rekap pembayaran harian');
}

export function useCollectionDaily(range: DateRange) {
  return useQuery({
    queryKey: ['collection-daily', range.from, range.to],
    queryFn: () => fetchCollectionDaily(range),
  });
}

/** Pengajuan yang menunggu keputusan (dipakai dashboard & halaman pengajuan). */
export async function fetchPendingApplications() {
  const result = await supabase()
    .from(TABLES.applications)
    .select('id, application_number, credit_type, principal, tenor, status, created_at, customers (full_name, customer_number)')
    .in('status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'])
    .order('created_at', { ascending: true })
    .limit(20);
  return unwrap<
    {
      id: string;
      application_number: string;
      credit_type: string;
      principal: number;
      tenor: number;
      status: string;
      created_at: string;
      customers: { full_name: string; customer_number: string } | null;
    }[]
  >(result as never, 'memuat pengajuan menunggu');
}

export function usePendingApplications() {
  return useQuery({ queryKey: ['pending-applications'], queryFn: fetchPendingApplications });
}

/** Pembayaran terbaru untuk daftar pada dashboard. */
export async function fetchRecentPayments(limit = 8) {
  const result = await supabase()
    .from(TABLES.payments)
    .select('id, receipt_number, amount, method, paid_at, status, credit_contracts (contract_number, customers (full_name))')
    .order('paid_at', { ascending: false })
    .limit(limit);
  return unwrap<
    {
      id: string;
      receipt_number: string;
      amount: number;
      method: string;
      paid_at: string;
      status: string;
      credit_contracts: { contract_number: string; customers: { full_name: string } | null } | null;
    }[]
  >(result as never, 'memuat pembayaran terbaru');
}

export function useRecentPayments(limit = 8) {
  return useQuery({ queryKey: ['recent-payments', limit], queryFn: () => fetchRecentPayments(limit) });
}

/** Aktivitas admin terbaru dari audit log. */
export async function fetchRecentActivity(limit = 8) {
  const result = await supabase()
    .from(TABLES.auditLogs)
    .select('id, action, entity_type, entity_id, summary, actor_email, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap<
    {
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      summary: string | null;
      actor_email: string | null;
      created_at: string;
    }[]
  >(result, 'memuat aktivitas terbaru');
}

export function useRecentActivity(limit = 8) {
  return useQuery({ queryKey: ['recent-activity', limit], queryFn: () => fetchRecentActivity(limit) });
}

/** Definisi metrik keuangan untuk ditampilkan pada halaman laporan. */
export const METRIC_DEFINITIONS = [
  {
    key: 'outstanding_total',
    label: 'Piutang Berjalan',
    definition:
      'Jumlah seluruh sisa tagihan cicilan pada kontrak berstatus Aktif, Menunggak, atau Restrukturisasi. Nilai ini adalah kewajiban pelanggan yang belum tertagih.',
  },
  {
    key: 'collections_in_range',
    label: 'Pembayaran Diterima',
    definition:
      'Jumlah nominal pembayaran berstatus POSTED pada periode filter. Pembayaran yang dibatalkan (reversal) tidak dihitung.',
  },
  {
    key: 'reversals_in_range',
    label: 'Pembatalan Pembayaran',
    definition: 'Jumlah nominal pembayaran yang dibatalkan pada periode filter. Mengurangi arus kas bersih.',
  },
  {
    key: 'net_cash',
    label: 'Arus Kas Bersih',
    definition: 'Pembayaran diterima dikurangi pembatalan pembayaran pada periode filter.',
  },
  {
    key: 'disbursed_in_range',
    label: 'Pencairan',
    definition:
      'Jumlah POKOK pembiayaan kontrak yang tanggal pencairannya berada pada periode filter. Pencairan adalah pengeluaran kas (pemberian modal), bukan pendapatan.',
  },
  {
    key: 'approved_financing',
    label: 'Nilai Pembiayaan Disetujui',
    definition:
      'Jumlah pokok pembiayaan pada pengajuan yang disetujui (decided_at) dalam periode filter, termasuk kontrak yang belum dicairkan.',
  },
  {
    key: 'overdue_total',
    label: 'Tunggakan',
    definition:
      'Jumlah sisa tagihan cicilan yang telah melewati tanggal jatuh tempo, termasuk cicilan yang baru dibayar sebagian.',
  },
  {
    key: 'penalty_outstanding',
    label: 'Denda Belum Dibayar',
    definition: 'Denda yang sudah dihitung dan berstatus OPEN, yaitu nominal denda dikurangi pembayaran dan pembebasan.',
  },
  {
    key: 'on_time_rate',
    label: 'Tingkat Tepat Waktu',
    definition:
      'Cicilan yang lunas dengan tanggal pembayaran terakhir tidak melewati tanggal jatuh tempo, dibagi seluruh cicilan lunas.',
  },
  {
    key: 'npl_ratio',
    label: 'Rasio Kredit Bermasalah',
    definition:
      'Sisa tagihan cicilan yang terlambat lebih dari 90 hari dibagi total piutang berjalan. Indikator kualitas portofolio.',
  },
] as const;
