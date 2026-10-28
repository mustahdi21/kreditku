/**
 * DashboardPage.tsx — Ringkasan operasional kredit.
 *
 * Isi halaman:
 *   * filter periode (preset + rentang kustom),
 *   * kartu statistik dari `rpc_dashboard_metrics`,
 *   * grafik arus pembayaran harian/bulanan, komposisi status kontrak, dan
 *     umur tunggakan,
 *   * daftar pekerjaan harian: pembayaran terbaru, jatuh tempo, tunggakan per
 *     pelanggan, pengajuan menunggu, dan aktivitas admin.
 *
 * Seluruh angka berasal dari `@/data/*`. Selama data belum tersedia setiap
 * bagian menampilkan kerangka pemuatan (bukan angka nol palsu), dan kegagalan
 * permintaan ditampilkan sebagai pesan dengan tombol coba lagi.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  FileText,
  HandCoins,
  History,
  ScrollText,
  TrendingDown,
  Users,
  Wallet,
} from 'lucide-react';
import { useDueToday, useOverdue, useUpcomingDue } from '@/data/credit';
import {
  useDashboardMetrics,
  useMonthlySeries,
  usePaymentSeries,
  usePendingApplications,
  useRecentActivity,
  useRecentPayments,
  type DateRange,
} from '@/data/reports';
import {
  DATE_RANGE_PRESET_LABELS,
  formatDateShortId,
  formatDateTimeId,
  isAfterIso,
  resolveDateRange,
  todayIso,
  type DateRangePreset,
} from '@/lib/date';
import { formatRupiah, subtractRupiah } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AGING_BUCKET_LABELS, type AgingBucket } from '@/core/status';
import { CONTRACT_STATUS_LABELS, type ContractStatus } from '@/core/types';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateInput,
  EmptyState,
  ErrorState,
  FormField,
  OptionsSelect,
  Skeleton,
  TableSkeleton,
} from '@/components/ui';
import {
  ApplicationStatusBadge,
  DateText,
  MoneyText,
  PaymentMethodBadge,
  StatCard,
} from '@/components/common/domain';
import { PageHeader } from '@/components/layout/AppShell';

/* -------------------------------------------------------------------------- */
/* Konstanta tampilan                                                         */
/* -------------------------------------------------------------------------- */

const PRESET_OPTIONS = (Object.keys(DATE_RANGE_PRESET_LABELS) as DateRangePreset[]).map((preset) => ({
  value: preset,
  label: DATE_RANGE_PRESET_LABELS[preset],
}));

const AGING_BUCKET_ORDER: readonly AgingBucket[] = ['CURRENT', 'D1_7', 'D8_30', 'D31_60', 'D61_90', 'D90_PLUS'];

const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  ACTIVE: '#4f46e5',
  DELINQUENT: '#dc2626',
  PAID_OFF: '#16a34a',
  RESTRUCTURED: '#f59e0b',
  CANCELLED: '#94a3b8',
};

const AGING_COLORS: Record<AgingBucket, string> = {
  CURRENT: '#4f46e5',
  D1_7: '#0ea5e9',
  D8_30: '#f59e0b',
  D31_60: '#f97316',
  D61_90: '#ef4444',
  D90_PLUS: '#991b1b',
};

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Membuat data',
  UPDATE: 'Memperbarui data',
  DELETE: 'Menghapus data',
  ARCHIVE: 'Mengarsipkan data',
  RESTORE: 'Memulihkan data',
  APPROVE: 'Menyetujui',
  REJECT: 'Menolak',
  CANCEL: 'Membatalkan',
  POST_PAYMENT: 'Mencatat pembayaran',
  REVERSE_PAYMENT: 'Membatalkan pembayaran',
  WAIVE_PENALTY: 'Membebaskan denda',
  LOGIN: 'Masuk',
  LOGOUT: 'Keluar',
  INVITE_USER: 'Mengundang pengguna',
  ACTIVATE_USER: 'Mengaktifkan pengguna',
  DEACTIVATE_USER: 'Menonaktifkan pengguna',
  SETTINGS_CHANGE: 'Mengubah pengaturan',
  EXPORT: 'Mengekspor data',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  customers: 'Pelanggan',
  credit_applications: 'Pengajuan',
  credit_contracts: 'Kontrak',
  payments: 'Pembayaran',
  installments: 'Cicilan',
  penalties: 'Denda',
  reminders: 'Pengingat',
  members: 'Anggota',
  profiles: 'Profil',
  settings: 'Pengaturan',
};

/* -------------------------------------------------------------------------- */
/* Pembantu format                                                            */
/* -------------------------------------------------------------------------- */

const COUNT_FORMATTER = new Intl.NumberFormat('id-ID');

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatPercent1(value: number): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1).replace('.', ',')}%`;
}

/** Nominal Rupiah dari nilai grafik yang mungkin bertipe longgar. */
function graphRupiah(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return formatRupiah(value);
  const numeric = typeof value === 'string' ? Number(value) : NaN;
  return formatRupiah(Number.isSafeInteger(numeric) ? numeric : 0);
}

/** Nilai tooltip grafik uang (tipe longgar mengikuti Recharts). */
function moneyTooltipValue(value: number | string): string {
  return graphRupiah(value);
}

/** Nilai tooltip grafik jumlah kontrak. */
function countTooltipValue(value: number | string): string {
  return `${String(value)} kontrak`;
}

/** Ringkasan nominal untuk label sumbu grafik. */
function compactRupiah(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '';
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (abs >= 1_000) return `${Math.round(numeric / 1_000)} rb`;
  return String(numeric);
}

function labelFromMap(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/* -------------------------------------------------------------------------- */
/* Komponen kecil                                                             */
/* -------------------------------------------------------------------------- */

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

function ListRow({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <li className={cn('flex items-start justify-between gap-3 border-b py-2 last:border-b-0 last:pb-0', className)}>
      {children}
    </li>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }): JSX.Element {
  return <TableSkeleton rows={rows} columns={3} />;
}

function SectionEmpty({ title, description }: { title: string; description?: string }): JSX.Element {
  return <EmptyState title={title} description={description} className="p-6" />;
}

function SectionError({ error, onRetry }: { error: unknown; onRetry: () => void }): JSX.Element {
  return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
}

/* -------------------------------------------------------------------------- */
/* Halaman                                                                    */
/* -------------------------------------------------------------------------- */

export default function DashboardPage(): JSX.Element {
  const today = todayIso();
  const [preset, setPreset] = useState<DateRangePreset>('THIS_MONTH');
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => currentMonthRangeFallback(today));

  const customValid = !isAfterIso(custom.from, custom.to);
  const range: DateRange = useMemo(() => {
    if (preset === 'CUSTOM') {
      return customValid ? { from: custom.from, to: custom.to } : currentMonthRangeFallback(today);
    }
    return resolveDateRange(preset, today);
  }, [custom.from, custom.to, customValid, preset, today]);

  const metricsQuery = useDashboardMetrics(range);
  const dailySeriesQuery = usePaymentSeries(range);
  const monthlySeriesQuery = useMonthlySeries();
  const recentPaymentsQuery = useRecentPayments(8);
  const pendingApplicationsQuery = usePendingApplications();
  const recentActivityQuery = useRecentActivity(8);
  const dueTodayQuery = useDueToday();
  const upcomingDueQuery = useUpcomingDue();
  const overdueQuery = useOverdue();

  const metrics = metricsQuery.data;
  const metricsLoading = metricsQuery.isPending;

  const collections = metrics?.collections_in_range ?? 0;
  const reversals = metrics?.reversals_in_range ?? 0;
  const netCash = subtractRupiah(collections, reversals);

  const outstandingTotal = metrics?.outstanding_total ?? 0;
  const longOverdue = metrics?.long_overdue_outstanding ?? 0;
  const paidInstallments = metrics?.total_paid_installments ?? 0;
  const onTimePaid = metrics?.on_time_paid ?? 0;

  const onTimeRate = paidInstallments > 0 ? (onTimePaid / paidInstallments) * 100 : 0;
  const nplRatio = outstandingTotal > 0 ? (longOverdue / outstandingTotal) * 100 : 0;

  const statusChartData = useMemo(() => {
    const distribution = metrics?.status_distribution ?? {};
    return (Object.keys(CONTRACT_STATUS_LABELS) as ContractStatus[])
      .map((status) => ({
        status,
        name: CONTRACT_STATUS_LABELS[status],
        value: distribution[status] ?? 0,
        fill: CONTRACT_STATUS_COLORS[status],
      }))
      .filter((item) => item.value > 0);
  }, [metrics]);

  const agingChartData = useMemo(() => {
    const aging = metrics?.aging ?? {};
    return AGING_BUCKET_ORDER.map((bucket) => ({
      bucket,
      label: AGING_BUCKET_LABELS[bucket],
      amount: aging[bucket]?.amount ?? 0,
      count: aging[bucket]?.count ?? 0,
      fill: AGING_COLORS[bucket],
    }));
  }, [metrics]);

  const dailyChartData = useMemo(
    () =>
      (dailySeriesQuery.data ?? []).map((row) => ({
        label: `${row.period.slice(8, 10)}/${row.period.slice(5, 7)}`,
        amount: row.amount,
        count: row.count,
      })),
    [dailySeriesQuery.data],
  );

  const monthlyChartData = useMemo(
    () =>
      (monthlySeriesQuery.data ?? []).map((point) => ({
        label: point.label,
        amount: point.amount,
        count: point.count,
      })),
    [monthlySeriesQuery.data],
  );

  const overdueByCustomer = useMemo(() => {
    const map = new Map<string, { customerId: string; name: string; outstanding: number; maxLateDays: number; count: number }>();
    for (const row of overdueQuery.data ?? []) {
      const existing = map.get(row.customer_id);
      if (existing) {
        existing.outstanding += row.outstanding;
        existing.maxLateDays = Math.max(existing.maxLateDays, row.late_days);
        existing.count += 1;
      } else {
        map.set(row.customer_id, {
          customerId: row.customer_id,
          name: row.customer_name,
          outstanding: row.outstanding,
          maxLateDays: row.late_days,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.outstanding - a.outstanding).slice(0, 8);
  }, [overdueQuery.data]);

  const dueTodayRows = (dueTodayQuery.data ?? []).slice(0, 6);
  const upcomingDueRows = (upcomingDueQuery.data ?? []).slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Ringkasan portofolio, arus pembayaran, dan pekerjaan harian."
        breadcrumb={`Periode laporan: ${formatDateShortId(range.from)} – ${formatDateShortId(range.to)}`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Periode" htmlFor="dashboard-preset" className="w-44">
              <OptionsSelect
                id="dashboard-preset"
                value={preset}
                onValueChange={(value) => setPreset(value as DateRangePreset)}
                options={PRESET_OPTIONS}
              />
            </FormField>
            {preset === 'CUSTOM' ? (
              <>
                <FormField label="Dari" htmlFor="dashboard-from" className="w-40">
                  <DateInput
                    id="dashboard-from"
                    value={custom.from}
                    onChange={(value) => setCustom((current) => ({ ...current, from: value ?? current.from }))}
                  />
                </FormField>
                <FormField
                  label="Sampai"
                  htmlFor="dashboard-to"
                  className="w-40"
                  error={customValid ? null : 'Tanggal awal melewati tanggal akhir'}
                >
                  <DateInput
                    id="dashboard-to"
                    value={custom.to}
                    onChange={(value) => setCustom((current) => ({ ...current, to: value ?? current.to }))}
                  />
                </FormField>
              </>
            ) : null}
          </div>
        }
      />

      {metricsQuery.isError ? (
        <SectionError error={metricsQuery.error} onRetry={() => void metricsQuery.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard
            label="Pelanggan Aktif"
            value={formatCount(metrics?.active_customers ?? 0)}
            hint={metricsLoading ? undefined : `${formatCount(metrics?.new_customers ?? 0)} pelanggan baru pada periode ini`}
            icon={<Users className="h-4 w-4" aria-hidden />}
            tone="info"
            loading={metricsLoading}
          />
          <StatCard
            label="Pengajuan Menunggu"
            value={formatCount(metrics?.applications_pending ?? 0)}
            hint={metricsLoading ? undefined : `${formatCount(metrics?.applications_in_range ?? 0)} pengajuan pada periode ini`}
            icon={<FileText className="h-4 w-4" aria-hidden />}
            tone="warning"
            loading={metricsLoading}
          />
          <StatCard
            label="Kontrak Aktif"
            value={formatCount(metrics?.active_contracts ?? 0)}
            hint={metricsLoading ? undefined : `${formatCount(metrics?.delinquent_contracts ?? 0)} kontrak menunggak`}
            icon={<ScrollText className="h-4 w-4" aria-hidden />}
            loading={metricsLoading}
          />
          <StatCard
            label="Piutang Berjalan"
            value={formatRupiah(outstandingTotal)}
            hint="Sisa tagihan seluruh kontrak berjalan"
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            tone="info"
            loading={metricsLoading}
          />
          <StatCard
            label="Tunggakan"
            value={formatRupiah(metrics?.overdue_total ?? 0)}
            hint={metricsLoading ? undefined : `${formatCount(metrics?.overdue_count ?? 0)} cicilan terlambat`}
            icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
            tone="destructive"
            loading={metricsLoading}
          />
          <StatCard
            label="Jatuh Tempo Hari Ini"
            value={formatRupiah(metrics?.due_today_total ?? 0)}
            hint={metricsLoading ? undefined : `${formatCount(metrics?.due_today_count ?? 0)} cicilan jatuh tempo`}
            icon={<CalendarClock className="h-4 w-4" aria-hidden />}
            tone="warning"
            loading={metricsLoading}
          />
          <StatCard
            label="Pembayaran Periode Ini"
            value={formatRupiah(collections)}
            hint={metricsLoading ? undefined : `Dibatalkan: ${formatRupiah(reversals)}`}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="success"
            loading={metricsLoading}
          />
          <StatCard
            label="Denda Belum Dibayar"
            value={formatRupiah(metrics?.penalty_outstanding ?? 0)}
            hint="Denda berstatus belum dibayar"
            icon={<CircleDollarSign className="h-4 w-4" aria-hidden />}
            tone="destructive"
            loading={metricsLoading}
          />
          <StatCard
            label="Tingkat Tepat Waktu"
            value={formatPercent1(onTimeRate)}
            hint={metricsLoading ? undefined : `Dari ${formatCount(paidInstallments)} cicilan lunas`}
            icon={<CalendarDays className="h-4 w-4" aria-hidden />}
            tone="success"
            loading={metricsLoading}
          />
          <StatCard
            label="Rasio Kredit Bermasalah"
            value={formatPercent1(nplRatio)}
            hint={metricsLoading ? undefined : `Tunggakan > 90 hari: ${formatRupiah(longOverdue)}`}
            icon={<TrendingDown className="h-4 w-4" aria-hidden />}
            tone="destructive"
            loading={metricsLoading}
          />
          <StatCard
            label="Arus Kas Bersih"
            value={formatRupiah(netCash)}
            hint={metricsLoading ? undefined : 'Pembayaran diterima dikurangi pembatalan'}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={netCash < 0 ? 'destructive' : 'success'}
            loading={metricsLoading}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pembayaran Harian" description="Nominal pembayaran diterima per hari pada periode terpilih.">
          {dailySeriesQuery.isPending ? (
            <Skeleton className="h-full w-full" />
          ) : dailySeriesQuery.isError ? (
            <SectionError error={dailySeriesQuery.error} onRetry={() => void dailySeriesQuery.refetch()} />
          ) : dailyChartData.length === 0 ? (
            <SectionEmpty title="Belum ada pembayaran" description="Tidak ada pembayaran tercatat pada periode ini." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={compactRupiah} />
                <RechartsTooltip formatter={moneyTooltipValue} labelFormatter={(label: unknown) => `Tanggal ${String(label)}`} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name="Pembayaran"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  fill="#4f46e5"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Pembayaran Bulanan" description="Nominal pembayaran diterima selama 12 bulan terakhir.">
          {monthlySeriesQuery.isPending ? (
            <Skeleton className="h-full w-full" />
          ) : monthlySeriesQuery.isError ? (
            <SectionError error={monthlySeriesQuery.error} onRetry={() => void monthlySeriesQuery.refetch()} />
          ) : monthlyChartData.length === 0 ? (
            <SectionEmpty title="Belum ada data bulanan" description="Data pembayaran bulanan belum tersedia." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={compactRupiah} />
                <RechartsTooltip formatter={moneyTooltipValue} cursor={{ fill: 'rgba(79, 70, 229, 0.08)' }} />
                <Bar dataKey="amount" name="Pembayaran" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Komposisi Status Kontrak" description="Jumlah kontrak pada setiap status.">
          {metricsLoading ? (
            <Skeleton className="h-full w-full" />
          ) : statusChartData.length === 0 ? (
            <SectionEmpty title="Belum ada kontrak" description="Belum ada kontrak yang tercatat pada organisasi ini." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {statusChartData.map((item) => (
                    <Cell key={item.status} fill={item.fill} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <RechartsTooltip formatter={countTooltipValue} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Umur Tunggakan" description="Nominal sisa tagihan cicilan yang telah melewati jatuh tempo.">
          {metricsLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={compactRupiah} />
                <RechartsTooltip formatter={moneyTooltipValue} cursor={{ fill: 'rgba(79, 70, 229, 0.08)' }} />
                <Bar dataKey="amount" name="Tunggakan" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {agingChartData.map((item) => (
                    <Cell key={item.bucket} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Pembayaran Terbaru"
          description="Delapan pembayaran terakhir yang tercatat."
          action={
            <Link to="/app/payments" className="text-sm text-primary hover:underline">
              Lihat semua
            </Link>
          }
        >
          {recentPaymentsQuery.isPending ? (
            <ListSkeleton />
          ) : recentPaymentsQuery.isError ? (
            <SectionError error={recentPaymentsQuery.error} onRetry={() => void recentPaymentsQuery.refetch()} />
          ) : (recentPaymentsQuery.data ?? []).length === 0 ? (
            <SectionEmpty title="Belum ada pembayaran" description="Pembayaran yang dicatat akan muncul di sini." />
          ) : (
            <ul>
              {(recentPaymentsQuery.data ?? []).map((payment) => (
                <ListRow key={payment.id}>
                  <div className="min-w-0 space-y-0.5">
                    <Link to={`/app/payments/${payment.id}`} className="text-sm font-medium text-primary hover:underline">
                      {payment.receipt_number}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {payment.credit_contracts?.customers?.full_name ?? 'Pelanggan tidak diketahui'} •{' '}
                      {payment.credit_contracts?.contract_number ?? '-'}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTimeId(payment.paid_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyText value={payment.amount} strong />
                    <PaymentMethodBadge method={payment.method} />
                  </div>
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Jatuh Tempo Hari Ini"
          description="Cicilan yang harus ditagih hari ini."
          action={
            <Link to="/app/installments" className="text-sm text-primary hover:underline">
              Lihat jadwal
            </Link>
          }
        >
          {dueTodayQuery.isPending ? (
            <ListSkeleton />
          ) : dueTodayQuery.isError ? (
            <SectionError error={dueTodayQuery.error} onRetry={() => void dueTodayQuery.refetch()} />
          ) : dueTodayRows.length === 0 ? (
            <SectionEmpty title="Tidak ada jatuh tempo hari ini" description="Seluruh cicilan hari ini sudah tertangani." />
          ) : (
            <ul>
              {dueTodayRows.map((row) => (
                <ListRow key={row.id}>
                  <div className="min-w-0 space-y-0.5">
                    <Link to={`/app/contracts/${row.contract_id}`} className="text-sm font-medium text-primary hover:underline">
                      {row.contract_number}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.customer_name} • cicilan ke-{row.installment_number}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyText value={row.outstanding} strong />
                    <DateText value={row.due_date} className="text-xs" />
                  </div>
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Cicilan Mendekati Jatuh Tempo" description="Jatuh tempo dalam 7 hari ke depan.">
          {upcomingDueQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : upcomingDueQuery.isError ? (
            <SectionError error={upcomingDueQuery.error} onRetry={() => void upcomingDueQuery.refetch()} />
          ) : upcomingDueRows.length === 0 ? (
            <SectionEmpty title="Belum ada tagihan mendatang" description="Tidak ada cicilan yang jatuh tempo dalam 7 hari." />
          ) : (
            <ul>
              {upcomingDueRows.map((row) => (
                <ListRow key={row.id}>
                  <div className="min-w-0 space-y-0.5">
                    <Link to={`/app/contracts/${row.contract_id}`} className="text-sm font-medium text-primary hover:underline">
                      {row.contract_number}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.customer_name} • cicilan ke-{row.installment_number}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyText value={row.outstanding} strong />
                    <DateText value={row.due_date} className="text-xs" />
                  </div>
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pelanggan Menunggak"
          description="Delapan pelanggan dengan tunggakan terbesar."
          action={
            <Link to="/app/penalties" className="text-sm text-primary hover:underline">
              Lihat tunggakan
            </Link>
          }
        >
          {overdueQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : overdueQuery.isError ? (
            <SectionError error={overdueQuery.error} onRetry={() => void overdueQuery.refetch()} />
          ) : overdueByCustomer.length === 0 ? (
            <SectionEmpty title="Tidak ada tunggakan" description="Seluruh cicilan berjalan tepat waktu." />
          ) : (
            <ul>
              {overdueByCustomer.map((entry) => (
                <ListRow key={entry.customerId}>
                  <div className="min-w-0 space-y-0.5">
                    <Link
                      to={`/app/customers/${entry.customerId}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatCount(entry.count)} cicilan tertunggak • maksimum {entry.maxLateDays} hari
                    </p>
                  </div>
                  <MoneyText value={entry.outstanding} strong className="shrink-0 text-destructive" />
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Pengajuan Menunggu Keputusan"
          description="Pengajuan berstatus draft, diajukan, atau dalam pemeriksaan."
          action={
            <Link to="/app/applications" className="text-sm text-primary hover:underline">
              Lihat pengajuan
            </Link>
          }
        >
          {pendingApplicationsQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : pendingApplicationsQuery.isError ? (
            <SectionError error={pendingApplicationsQuery.error} onRetry={() => void pendingApplicationsQuery.refetch()} />
          ) : (pendingApplicationsQuery.data ?? []).length === 0 ? (
            <SectionEmpty title="Tidak ada pengajuan menunggu" description="Seluruh pengajuan sudah diputuskan." />
          ) : (
            <ul>
              {(pendingApplicationsQuery.data ?? []).map((application) => (
                <ListRow key={application.id}>
                  <div className="min-w-0 space-y-0.5">
                    <Link
                      to={`/app/applications/${application.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {application.application_number}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {application.customers?.full_name ?? 'Pelanggan tidak diketahui'} • {application.credit_type} •{' '}
                      {application.tenor} periode
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyText value={application.principal} strong />
                    <ApplicationStatusBadge status={application.status} />
                  </div>
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Aktivitas Admin Terbaru"
          description="Delapan catatan audit terakhir."
          action={
            <Link to="/app/settings/audit" className="text-sm text-primary hover:underline">
              Lihat audit log
            </Link>
          }
        >
          {recentActivityQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : recentActivityQuery.isError ? (
            <SectionError error={recentActivityQuery.error} onRetry={() => void recentActivityQuery.refetch()} />
          ) : (recentActivityQuery.data ?? []).length === 0 ? (
            <SectionEmpty title="Belum ada aktivitas" description="Aktivitas pengguna akan tercatat di sini." />
          ) : (
            <ul>
              {(recentActivityQuery.data ?? []).map((activity) => (
                <ListRow key={activity.id}>
                  <div className="flex min-w-0 items-start gap-2">
                    <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm">
                        <span className="font-medium">
                          {labelFromMap(ACTIVITY_ACTION_LABELS, activity.action)}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {labelFromMap(ENTITY_TYPE_LABELS, activity.entity_type)}
                        </span>
                      </p>
                      {activity.summary ? (
                        <p className="truncate text-xs text-muted-foreground">{activity.summary}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {activity.actor_email ?? 'Sistem'} • {formatDateTimeId(activity.created_at)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted" className="shrink-0">
                    {activity.action}
                  </Badge>
                </ListRow>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** Rentang bulan berjalan sebagai nilai awal filter kustom. */
function currentMonthRangeFallback(today: string): { from: string; to: string } {
  return resolveDateRange('THIS_MONTH', today);
}
