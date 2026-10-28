/**
 * InstallmentsPage.tsx — Jadwal cicilan.
 *
 * Isi halaman:
 *   1. "Semua" — tabel cicilan dengan pencarian, filter status, rentang jatuh
 *      tempo, dan pengurutan; paginasi dilakukan SERVER (bukan klien) sehingga
 *      tetap benar ketika data berjumlah puluhan ribu baris.
 *   2. "Jatuh Tempo Hari Ini", "7 Hari ke Depan", dan "Terlambat" — daftar siap
 *      pakai dari view khusus server.
 *   3. "Kalender" — kisi bulan: setiap hari menampilkan jumlah cicilan dan total
 *      sisa tagihan yang jatuh tempo pada hari itu; klik satu hari memfilter
 *      daftar pada tab "Semua".
 *
 * Ekspor (CSV/XLSX/PDF) memakai filter yang sama dengan daftar dan mengambil
 * maksimum 200 baris pertama agar permintaan tetap ringan.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifyInfo, notifySuccess } from '@/components/common/Toaster';
import { InstallmentStatusBadge, MoneyText } from '@/components/common/domain';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DateInput,
  ErrorState,
  Input,
  Label,
  OptionsSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { AGING_BUCKET_LABELS } from '@/core/status';
import { INSTALLMENT_STATUSES, INSTALLMENT_STATUS_LABELS, type InstallmentStatus } from '@/core/types';
import {
  DEFAULT_INSTALLMENT_FILTERS,
  fetchInstallments,
  useDueToday,
  useInstallments,
  useOverdue,
  useUpcomingDue,
  type InstallmentFilters,
} from '@/data/credit';
import type { InstallmentDetailRow } from '@/data/types';
import {
  addDaysIso,
  addMonthsIso,
  DATE_RANGE_PRESET_LABELS,
  daysBetweenIso,
  endOfMonthIso,
  formatDateId,
  formatMonthId,
  parseIsoDate,
  resolveDateRange,
  startOfMonthIso,
  todayIso,
  type DateRangePreset,
} from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { exportCsv, exportPdf, exportXlsx, type ExportColumn } from '@/lib/exports';
import { formatRupiah } from '@/lib/money';

type TabKey = 'all' | 'dueToday' | 'upcoming' | 'overdue' | 'calendar';

const WEEKDAY_LABELS: readonly string[] = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const ORDER_OPTIONS = [
  { value: 'due_date:asc', label: 'Jatuh tempo (terlama dulu)' },
  { value: 'due_date:desc', label: 'Jatuh tempo (terbaru dulu)' },
  { value: 'late_days:desc', label: 'Hari terlambat (terbanyak dulu)' },
  { value: 'late_days:asc', label: 'Hari terlambat (tersedikit dulu)' },
  { value: 'outstanding:desc', label: 'Sisa tagihan (terbesar dulu)' },
  { value: 'outstanding:asc', label: 'Sisa tagihan (terkecil dulu)' },
] as const;

const EXPORT_LIMIT = 200;

const EXPORT_COLUMNS: ExportColumn<Record<string, string>>[] = [
  { key: 'kontrak', header: 'Nomor Kontrak', width: 20 },
  { key: 'pelanggan', header: 'Pelanggan', width: 28 },
  { key: 'nomor_pelanggan', header: 'Nomor Pelanggan', width: 18 },
  { key: 'cicilan', header: 'Cicilan Ke', width: 10, align: 'center' },
  { key: 'jatuh_tempo', header: 'Jatuh Tempo', width: 14 },
  { key: 'pokok', header: 'Pokok', width: 16, align: 'right' },
  { key: 'bunga', header: 'Bunga', width: 16, align: 'right' },
  { key: 'biaya', header: 'Biaya', width: 14, align: 'right' },
  { key: 'tagihan', header: 'Tagihan', width: 16, align: 'right' },
  { key: 'dibayar', header: 'Dibayar', width: 16, align: 'right' },
  { key: 'sisa', header: 'Sisa Tagihan', width: 16, align: 'right' },
  { key: 'status', header: 'Status', width: 18 },
  { key: 'hari_terlambat', header: 'Hari Terlambat', width: 14, align: 'right' },
  { key: 'ember_umur', header: 'Ember Umur Tunggakan', width: 20 },
];

const STATUS_FILTER_OPTIONS: readonly { value: InstallmentStatus; label: string }[] = INSTALLMENT_STATUSES.map(
  (status) => ({ value: status, label: INSTALLMENT_STATUS_LABELS[status] }),
);

function agingLabel(bucket: string | null | undefined): string {
  if (!bucket) return '-';
  return AGING_BUCKET_LABELS[bucket as keyof typeof AGING_BUCKET_LABELS] ?? bucket;
}

function toExportRow(row: InstallmentDetailRow): Record<string, string> {
  return {
    kontrak: row.contract_number,
    pelanggan: row.customer_name,
    nomor_pelanggan: row.customer_number,
    cicilan: String(row.installment_number),
    jatuh_tempo: row.due_date,
    pokok: formatRupiah(row.principal),
    bunga: formatRupiah(row.interest),
    biaya: formatRupiah(row.fees),
    tagihan: formatRupiah(row.total_due),
    dibayar: formatRupiah(row.paid_amount),
    sisa: formatRupiah(row.outstanding),
    status: INSTALLMENT_STATUS_LABELS[row.status] ?? row.status,
    hari_terlambat: row.late_days > 0 ? String(row.late_days) : '0',
    ember_umur: agingLabel(row.aging_bucket),
  };
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label={label}>
          {label}
          {selected.length > 0 ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 ? (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Bersihkan pilihan
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function buildColumns(canCollectPayment: boolean): Column<InstallmentDetailRow>[] {
  return [
    {
      key: 'contract_number',
      header: 'Nomor Kontrak',
      accessor: (row) => row.contract_number,
      cell: (row) => (
        <Link to={`/app/contracts/${row.contract_id}`} className="tabular font-medium text-primary hover:underline">
          {row.contract_number}
        </Link>
      ),
    },
    {
      key: 'customer_name',
      header: 'Pelanggan',
      accessor: (row) => `${row.customer_name} ${row.customer_number}`,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.customer_name}</p>
          <p className="tabular text-xs text-muted-foreground">{row.customer_number}</p>
        </div>
      ),
    },
    {
      key: 'installment_number',
      header: 'Cicilan',
      align: 'center',
      accessor: (row) => row.installment_number,
      cell: (row) => <span className="tabular">ke-{row.installment_number}</span>,
    },
    {
      key: 'due_date',
      header: 'Jatuh Tempo',
      accessor: (row) => row.due_date,
      cell: (row) => <span className="tabular whitespace-nowrap">{formatDateId(row.due_date, 'd MMM yyyy')}</span>,
    },
    {
      key: 'principal',
      header: 'Pokok',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.principal,
      cell: (row) => <MoneyText value={row.principal} mutedWhenZero />,
    },
    {
      key: 'interest',
      header: 'Bunga',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.interest,
      cell: (row) => <MoneyText value={row.interest} mutedWhenZero />,
    },
    {
      key: 'fees',
      header: 'Biaya',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.fees,
      cell: (row) => <MoneyText value={row.fees} mutedWhenZero />,
    },
    {
      key: 'total_due',
      header: 'Tagihan',
      align: 'right',
      accessor: (row) => row.total_due,
      cell: (row) => <MoneyText value={row.total_due} />,
    },
    {
      key: 'paid_amount',
      header: 'Dibayar',
      align: 'right',
      accessor: (row) => row.paid_amount,
      cell: (row) => <MoneyText value={row.paid_amount} mutedWhenZero />,
    },
    {
      key: 'outstanding',
      header: 'Sisa',
      align: 'right',
      accessor: (row) => row.outstanding,
      cell: (row) => <MoneyText value={row.outstanding} strong={row.outstanding > 0} mutedWhenZero />,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => <InstallmentStatusBadge status={row.status} />,
    },
    {
      key: 'late_days',
      header: 'Hari Terlambat',
      align: 'right',
      accessor: (row) => row.late_days,
      cell: (row) =>
        row.late_days > 0 ? (
          <Badge variant="destructive" className="tabular">
            {row.late_days} hari
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      cell: (row) =>
        canCollectPayment ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/app/payments/new?contractId=${row.contract_id}&installmentId=${row.id}`}>
              Catat Pembayaran
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Hanya lihat</span>
        ),
    },
  ];
}

function ListTable({
  rows,
  columns,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  footer,
  toolbar,
}: {
  rows: readonly InstallmentDetailRow[];
  columns: readonly Column<InstallmentDetailRow>[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  footer?: ReactNode;
  toolbar?: ReactNode;
}): JSX.Element {
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      searchable={false}
      initialPageSize={200}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      toolbar={toolbar}
      footer={footer}
    />
  );
}

/** Kisi kalender bulanan: jumlah cicilan dan total sisa per hari jatuh tempo. */
function InstallmentCalendar({
  today,
  activeDay,
  onSelectDay,
}: {
  today: string;
  activeDay: string | null;
  onSelectDay: (day: string) => void;
}): JSX.Element {
  const [month, setMonth] = useState<string>(() => startOfMonthIso(today));
  const monthStart = startOfMonthIso(month);
  const monthEnd = endOfMonthIso(month);

  const filters = useMemo<InstallmentFilters>(
    () => ({
      ...DEFAULT_INSTALLMENT_FILTERS,
      page: 1,
      pageSize: 200,
      dueFrom: monthStart,
      dueTo: monthEnd,
      onlyOutstanding: true,
      orderBy: 'due_date',
      orderDir: 'asc',
    }),
    [monthStart, monthEnd],
  );

  const query = useInstallments(filters);

  const aggregates = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const row of query.data?.rows ?? []) {
      if (row.status === 'CANCELLED' || row.outstanding <= 0) continue;
      const current = map.get(row.due_date) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += row.outstanding;
      map.set(row.due_date, current);
    }
    return map;
  }, [query.data]);

  const cells = useMemo(() => {
    const leading = (parseIsoDate(monthStart).getDay() + 6) % 7;
    const dayCount = daysBetweenIso(monthStart, monthEnd) + 1;
    const result: (string | null)[] = [];
    for (let index = 0; index < leading; index += 1) result.push(null);
    for (let index = 0; index < dayCount; index += 1) result.push(addDaysIso(monthStart, index));
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [monthStart, monthEnd]);

  const monthTotals = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const value of aggregates.values()) {
      count += value.count;
      amount += value.amount;
    }
    return { count, amount };
  }, [aggregates]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonthsIso(monthStart, -1))}>
            <ChevronLeft />
          </Button>
          <p className="min-w-[10rem] text-center text-sm font-semibold">{formatMonthId(monthStart)}</p>
          <Button variant="outline" size="icon" aria-label="Bulan berikutnya" onClick={() => setMonth(addMonthsIso(monthStart, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonthIso(today))}>
            Bulan ini
          </Button>
          <Badge variant="secondary" className="tabular">
            {monthTotals.count} cicilan • {formatRupiah(monthTotals.amount)}
          </Badge>
        </div>
      </div>

      {query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <Card>
          <CardContent className="p-3 pt-3">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="py-1">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((date, index) => {
                if (!date) return <div key={`empty-${index}`} className="min-h-[64px] rounded-md bg-muted/30" />;
                const info = aggregates.get(date);
                const isToday = date === today;
                const isActive = date === activeDay;
                const isPast = date < today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onSelectDay(date)}
                    aria-label={`Lihat cicilan jatuh tempo ${formatDateId(date)}`}
                    className={`min-h-[64px] rounded-md border p-1.5 text-left transition-colors hover:border-primary ${
                      isActive ? 'border-primary bg-primary/5' : 'border-border'
                    } ${isToday ? 'ring-1 ring-primary' : ''} ${isPast && info ? 'bg-destructive/5' : ''}`}
                  >
                    <span className="flex items-center justify-between">
                      <span className={`tabular text-xs font-semibold ${isToday ? 'text-primary' : ''}`}>
                        {date.slice(8, 10)}
                      </span>
                      {query.isLoading ? (
                        <Skeleton className="h-4 w-5" />
                      ) : info ? (
                        <Badge variant={isPast ? 'destructive' : 'info'} className="px-1.5 py-0 text-[10px]">
                          {info.count}
                        </Badge>
                      ) : null}
                    </span>
                    {info ? (
                      <span className="mt-1 block truncate text-[10px] font-medium text-muted-foreground" title={formatRupiah(info.amount)}>
                        {formatRupiah(info.amount)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Angka pada kalender adalah sisa tagihan cicilan (belum termasuk denda). Klik satu hari untuk memfilter daftar pada
        tab &ldquo;Semua&rdquo;. Maksimum 200 cicilan dimuat per bulan.
      </p>
    </div>
  );
}

export default function InstallmentsPage(): JSX.Element {
  const { can } = useAuth();
  const today = todayIso();
  const canCollectPayment = can('payments.create');
  const canExport = can('exports.create');

  const [tab, setTab] = useState<TabKey>('all');
  const [filters, setFilters] = useState<InstallmentFilters>(DEFAULT_INSTALLMENT_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [preset, setPreset] = useState<DateRangePreset | ''>('');
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  const listQuery = useInstallments(filters);
  const columns = useMemo(() => buildColumns(canCollectPayment), [canCollectPayment]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) =>
        previous.search === searchDraft ? previous : { ...previous, search: searchDraft, page: 1 },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const shownFrom = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const shownTo = Math.min(filters.page * filters.pageSize, total);

  const applyPreset = (value: string) => {
    const next = value as DateRangePreset;
    setPreset(next);
    const range = resolveDateRange(next, today);
    setFilters((previous) => ({ ...previous, page: 1, dueFrom: range.from, dueTo: range.to }));
  };

  const clearDayFilter = () => {
    setActiveDay(null);
    setFilters((previous) => ({ ...previous, page: 1, dueFrom: null, dueTo: null }));
  };

  const handleExport = async (kind: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(kind);
    try {
      const result = await fetchInstallments({ ...filters, page: 1, pageSize: EXPORT_LIMIT });
      if (result.rows.length === 0) {
        notifyInfo('Tidak ada data untuk diekspor', 'Sesuaikan filter terlebih dahulu.');
        return;
      }
      const rows = result.rows.map(toExportRow);
      const meta = {
        filename: `jadwal-cicilan-${filters.statuses.length > 0 ? filters.statuses.join('-') : 'semua-status'}`,
        title: 'Jadwal Cicilan',
        subtitle: `${result.rows.length} baris sesuai filter • Total ${result.total} data`,
        generatedBy: 'KreditKu',
      };
      if (kind === 'csv') exportCsv(rows, EXPORT_COLUMNS, meta);
      else if (kind === 'xlsx') await exportXlsx(rows, EXPORT_COLUMNS, meta);
      else await exportPdf(rows, EXPORT_COLUMNS, meta);
      notifySuccess(
        `Ekspor ${kind.toUpperCase()} selesai`,
        result.total > result.rows.length
          ? `Maksimum ${EXPORT_LIMIT} baris pertama. Persempit filter untuk hasil lebih lengkap.`
          : `${result.rows.length} baris diekspor.`,
      );
    } catch (error) {
      notifyError(error, 'Ekspor gagal');
    } finally {
      setExporting(null);
    }
  };

  const dueTodayQuery = useDueToday();
  const upcomingQuery = useUpcomingDue();
  const overdueQuery = useOverdue();

  const tabLabel = (label: string, count: number | undefined) => (
    <span className="flex items-center gap-1.5">
      {label}
      {typeof count === 'number' ? (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {count}
        </Badge>
      ) : null}
    </span>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jadwal Cicilan"
        description="Pantau cicilan yang belum dibayar, jatuh tempo hari ini, dan tunggakan. Status dihitung ulang setiap hari oleh server, bukan disimpan manual."
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">
            <ListChecks className="h-4 w-4" aria-hidden />
            Semua
          </TabsTrigger>
          <TabsTrigger value="dueToday">
            <Clock className="h-4 w-4" aria-hidden />
            {tabLabel('Jatuh Tempo Hari Ini', dueTodayQuery.data?.length)}
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            <CalendarRange className="h-4 w-4" aria-hidden />
            {tabLabel('7 Hari ke Depan', upcomingQuery.data?.length)}
          </TabsTrigger>
          <TabsTrigger value="overdue">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {tabLabel('Terlambat', overdueQuery.data?.length)}
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays className="h-4 w-4" aria-hidden />
            Kalender
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 p-4 pt-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="installment-search">Cari</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id="installment-search"
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      placeholder="Nomor kontrak, nama, atau nomor pelanggan"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium leading-none">Status cicilan</span>
                  <MultiSelect
                    label="Status"
                    options={STATUS_FILTER_OPTIONS}
                    selected={filters.statuses}
                    onChange={(next) => setFilters((previous) => ({ ...previous, statuses: next, page: 1 }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="installment-order">Urutkan</Label>
                  <OptionsSelect
                    id="installment-order"
                    value={`${filters.orderBy ?? 'due_date'}:${filters.orderDir ?? 'asc'}`}
                    onValueChange={(value) => {
                      const [orderBy, orderDir] = value.split(':');
                      setFilters((previous) => ({
                        ...previous,
                        page: 1,
                        orderBy: orderBy as InstallmentFilters['orderBy'],
                        orderDir: orderDir as InstallmentFilters['orderDir'],
                      }));
                    }}
                    options={ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="installment-preset">Rentang jatuh tempo</Label>
                  <OptionsSelect
                    id="installment-preset"
                    value={preset}
                    onValueChange={applyPreset}
                    placeholder="Pilih rentang cepat…"
                    options={(Object.keys(DATE_RANGE_PRESET_LABELS) as DateRangePreset[])
                      .filter((key) => key !== 'CUSTOM')
                      .map((key) => ({ value: key, label: DATE_RANGE_PRESET_LABELS[key] }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium leading-none">Dari / sampai tanggal</span>
                  <div className="flex items-center gap-2">
                    <DateInput
                      aria-label="Jatuh tempo dari"
                      value={filters.dueFrom ?? null}
                      onChange={(value) => {
                        setPreset('');
                        setFilters((previous) => ({ ...previous, page: 1, dueFrom: value }));
                      }}
                    />
                    <DateInput
                      aria-label="Jatuh tempo sampai"
                      value={filters.dueTo ?? null}
                      onChange={(value) => {
                        setPreset('');
                        setFilters((previous) => ({ ...previous, page: 1, dueTo: value }));
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={filters.onlyOutstanding ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    setFilters((previous) => ({ ...previous, page: 1, onlyOutstanding: !previous.onlyOutstanding }))
                  }
                >
                  {filters.onlyOutstanding ? 'Hanya yang belum lunas' : 'Termasuk yang sudah lunas'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchDraft('');
                    setPreset('');
                    setActiveDay(null);
                    setFilters(DEFAULT_INSTALLMENT_FILTERS);
                  }}
                >
                  Reset filter
                </Button>
                {activeDay ? (
                  <Badge variant="info" className="gap-1">
                    Jatuh tempo {formatDateId(activeDay)}
                    <button type="button" onClick={clearDayFilter} aria-label="Hapus filter tanggal">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
                <span className="flex-1" />
                {canExport ? (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" loading={exporting === 'csv'} onClick={() => void handleExport('csv')}>
                      <Download aria-hidden />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" loading={exporting === 'xlsx'} onClick={() => void handleExport('xlsx')}>
                      <FileSpreadsheet aria-hidden />
                      XLSX
                    </Button>
                    <Button variant="outline" size="sm" loading={exporting === 'pdf'} onClick={() => void handleExport('pdf')}>
                      <FileText aria-hidden />
                      PDF
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <ListTable
            rows={listQuery.data?.rows ?? []}
            columns={columns}
            loading={listQuery.isLoading}
            error={listQuery.isError ? listQuery.error : undefined}
            onRetry={() => void listQuery.refetch()}
            emptyTitle="Tidak ada cicilan yang cocok"
            emptyDescription="Ubah kata kunci atau rentang tanggal, lalu coba lagi."
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Halaman {filters.page} dari {totalPages} • {shownFrom}–{shownTo} dari {total} data (paginasi server)
                </span>
                <div className="flex items-center gap-2">
                  <OptionsSelect
                    aria-label="Jumlah baris per halaman"
                    className="h-9 w-[120px]"
                    value={String(filters.pageSize)}
                    onValueChange={(value) =>
                      setFilters((previous) => ({ ...previous, page: 1, pageSize: Number(value) }))
                    }
                    options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size} / halaman` }))}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((previous) => ({ ...previous, page: Math.max(1, previous.page - 1) }))}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page >= totalPages}
                    onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="dueToday">
          <ListTable
            rows={dueTodayQuery.data ?? []}
            columns={columns}
            loading={dueTodayQuery.isLoading}
            error={dueTodayQuery.isError ? dueTodayQuery.error : undefined}
            onRetry={() => void dueTodayQuery.refetch()}
            emptyTitle="Tidak ada cicilan yang jatuh tempo hari ini"
            emptyDescription={`Semua cicilan pada ${formatDateId(today)} sudah tertangani.`}
          />
        </TabsContent>

        <TabsContent value="upcoming">
          <ListTable
            rows={upcomingQuery.data ?? []}
            columns={columns}
            loading={upcomingQuery.isLoading}
            error={upcomingQuery.isError ? upcomingQuery.error : undefined}
            onRetry={() => void upcomingQuery.refetch()}
            emptyTitle="Tidak ada cicilan dalam 7 hari ke depan"
            emptyDescription="Cicilan yang jatuh tempo dalam sepekan akan tampil di sini sebagai persiapan penagihan."
          />
        </TabsContent>

        <TabsContent value="overdue">
          <ListTable
            rows={overdueQuery.data ?? []}
            columns={columns}
            loading={overdueQuery.isLoading}
            error={overdueQuery.isError ? overdueQuery.error : undefined}
            onRetry={() => void overdueQuery.refetch()}
            emptyTitle="Tidak ada tunggakan"
            emptyDescription="Tidak ada cicilan yang melewati jatuh tempo dan masih memiliki sisa tagihan."
          />
        </TabsContent>

        <TabsContent value="calendar">
          <InstallmentCalendar
            today={today}
            activeDay={activeDay}
            onSelectDay={(day) => {
              setPreset('');
              setActiveDay(day);
              setFilters((previous) => ({ ...previous, page: 1, dueFrom: day, dueTo: day }));
              setTab('all');
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
