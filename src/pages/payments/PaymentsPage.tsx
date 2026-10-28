/**
 * PaymentsPage.tsx — Daftar pembayaran (kuitansi).
 *
 * Filter (kata kunci, metode, status, rentang tanggal) dan paginasi dijalankan
 * di SERVER; tabel hanya menampilkan baris halaman aktif. Ekspor memakai filter
 * yang sama dan dibatasi 200 baris pertama.
 *
 * Pembayaran yang dibatalkan tetap tampil di sini beserta statusnya: catatan
 * aslinya tidak pernah dihapus agar jejak audit tetap lengkap.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
  Search,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifyInfo, notifySuccess } from '@/components/common/Toaster';
import { MoneyText, PaymentMethodBadge } from '@/components/common/domain';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DateInput,
  Input,
  Label,
  OptionsSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_STATUSES, type PaymentMethod } from '@/core/types';
import {
  DEFAULT_PAYMENT_FILTERS,
  fetchPayments,
  usePayments,
  type PaymentFilters,
} from '@/data/payments';
import type { PaymentWithRelations } from '@/data/types';
import {
  DATE_RANGE_PRESET_LABELS,
  formatDateShortId,
  formatDateTimeId,
  resolveDateRange,
  type DateRangePreset,
} from '@/lib/date';
import { exportCsv, exportPdf, exportXlsx, type ExportColumn } from '@/lib/exports';
import { formatRupiah } from '@/lib/money';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const EXPORT_LIMIT = 200;

const METHOD_FILTER_OPTIONS: readonly { value: PaymentMethod; label: string }[] = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}));

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Semua status' },
  ...PAYMENT_STATUSES.map((status) => ({
    value: status,
    label: status === 'POSTED' ? 'Diposting' : 'Dibatalkan',
  })),
];

const STATUS_LABELS: Record<string, string> = {
  POSTED: 'Diposting',
  REVERSED: 'Dibatalkan',
};

const EXPORT_COLUMNS: ExportColumn<Record<string, string>>[] = [
  { key: 'kuitansi', header: 'Nomor Kuitansi', width: 20 },
  { key: 'tanggal', header: 'Tanggal Bayar', width: 14 },
  { key: 'waktu', header: 'Waktu', width: 18 },
  { key: 'kontrak', header: 'Nomor Kontrak', width: 20 },
  { key: 'pelanggan', header: 'Pelanggan', width: 28 },
  { key: 'nomor_pelanggan', header: 'Nomor Pelanggan', width: 18 },
  { key: 'nominal', header: 'Nominal', width: 16, align: 'right' },
  { key: 'metode', header: 'Metode', width: 16 },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'petugas', header: 'Petugas', width: 24 },
  { key: 'referensi', header: 'Referensi', width: 20 },
];

function officerName(row: PaymentWithRelations): string {
  return row.profiles?.full_name || row.profiles?.email || '-';
}

function toExportRow(row: PaymentWithRelations): Record<string, string> {
  return {
    kuitansi: row.receipt_number,
    tanggal: row.paid_date,
    waktu: formatDateTimeId(row.paid_at),
    kontrak: row.credit_contracts?.contract_number ?? '-',
    pelanggan: row.credit_contracts?.customers?.full_name ?? '-',
    nomor_pelanggan: row.credit_contracts?.customers?.customer_number ?? '-',
    nominal: formatRupiah(row.amount),
    metode: PAYMENT_METHOD_LABELS[row.method] ?? row.method,
    status: STATUS_LABELS[row.status] ?? row.status,
    petugas: officerName(row),
    referensi: row.reference ?? '-',
  };
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
}): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
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

const columns: Column<PaymentWithRelations>[] = [
  {
    key: 'receipt_number',
    header: 'Nomor Kuitansi',
    accessor: (row) => row.receipt_number,
    cell: (row) => (
      <Link to={`/app/payments/${row.id}`} className="tabular font-medium text-primary hover:underline">
        {row.receipt_number}
      </Link>
    ),
  },
  {
    key: 'paid_date',
    header: 'Tanggal',
    accessor: (row) => row.paid_at,
    cell: (row) => <span className="tabular whitespace-nowrap">{formatDateShortId(row.paid_date)}</span>,
  },
  {
    key: 'contract',
    header: 'Kontrak',
    accessor: (row) => row.credit_contracts?.contract_number ?? '',
    cell: (row) =>
      row.credit_contracts ? (
        <Link to={`/app/contracts/${row.credit_contracts.id}`} className="tabular text-primary hover:underline">
          {row.credit_contracts.contract_number}
        </Link>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: 'customer',
    header: 'Pelanggan',
    accessor: (row) => row.credit_contracts?.customers?.full_name ?? '',
    cell: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.credit_contracts?.customers?.full_name ?? '-'}</p>
        <p className="tabular text-xs text-muted-foreground">
          {row.credit_contracts?.customers?.customer_number ?? '-'}
        </p>
      </div>
    ),
  },
  {
    key: 'amount',
    header: 'Nominal',
    align: 'right',
    accessor: (row) => row.amount,
    cell: (row) => <MoneyText value={row.amount} strong />,
  },
  {
    key: 'method',
    header: 'Metode',
    accessor: (row) => row.method,
    cell: (row) => <PaymentMethodBadge method={row.method} />,
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (row) => row.status,
    cell: (row) =>
      row.status === 'POSTED' ? (
        <Badge variant="success">Diposting</Badge>
      ) : (
        <Badge variant="destructive">Dibatalkan</Badge>
      ),
  },
  {
    key: 'officer',
    header: 'Petugas',
    hideOnMobile: true,
    accessor: (row) => officerName(row),
    cell: (row) => <span className="truncate">{officerName(row)}</span>,
  },
  {
    key: 'actions',
    header: 'Aksi',
    align: 'right',
    cell: (row) => (
      <Button asChild variant="outline" size="sm">
        <Link to={`/app/payments/${row.id}`}>Detail</Link>
      </Button>
    ),
  },
];

export default function PaymentsPage(): JSX.Element {
  const { can } = useAuth();
  const canCreate = can('payments.create');
  const canExport = can('exports.create');

  const [filters, setFilters] = useState<PaymentFilters>(DEFAULT_PAYMENT_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [preset, setPreset] = useState<DateRangePreset | ''>('');
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  const query = usePayments(filters);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) =>
        previous.search === searchDraft ? previous : { ...previous, search: searchDraft, page: 1 },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const shownFrom = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const shownTo = Math.min(filters.page * filters.pageSize, total);

  const summary = useMemo(() => {
    let posted = 0;
    let reversed = 0;
    let postedAmount = 0;
    for (const row of query.data?.rows ?? []) {
      if (row.status === 'POSTED') {
        posted += 1;
        postedAmount += row.amount;
      } else {
        reversed += 1;
      }
    }
    return { posted, reversed, postedAmount };
  }, [query.data]);

  const applyPreset = (value: string) => {
    const next = value as DateRangePreset;
    setPreset(next);
    const range = resolveDateRange(next);
    setFilters((previous) => ({ ...previous, page: 1, from: range.from, to: range.to }));
  };

  const handleExport = async (kind: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(kind);
    try {
      const result = await fetchPayments({ ...filters, page: 1, pageSize: EXPORT_LIMIT });
      if (result.rows.length === 0) {
        notifyInfo('Tidak ada data untuk diekspor', 'Sesuaikan filter terlebih dahulu.');
        return;
      }
      const exportRows = result.rows.map(toExportRow);
      const meta = {
        filename: `pembayaran-${filters.status ?? 'semua-status'}`,
        title: 'Daftar Pembayaran',
        subtitle: `${result.rows.length} baris sesuai filter • Total ${result.total} data`,
        generatedBy: 'KreditKu',
      };
      if (kind === 'csv') exportCsv(exportRows, EXPORT_COLUMNS, meta);
      else if (kind === 'xlsx') await exportXlsx(exportRows, EXPORT_COLUMNS, meta);
      else await exportPdf(exportRows, EXPORT_COLUMNS, meta);
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pembayaran"
        description="Seluruh kuitansi yang tercatat. Pembayaran yang dibatalkan tetap tampil agar jejak audit utuh, tetapi tidak dihitung sebagai penerimaan."
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/app/payments/new">
                <Plus aria-hidden />
                Catat Pembayaran
              </Link>
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="space-y-3 p-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="payment-search">Cari</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="payment-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Nomor kuitansi atau referensi"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium leading-none">Metode pembayaran</span>
              <MultiSelect
                label="Metode"
                options={METHOD_FILTER_OPTIONS}
                selected={filters.methods}
                onChange={(next) => setFilters((previous) => ({ ...previous, methods: next, page: 1 }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-status">Status</Label>
              <OptionsSelect
                id="payment-status"
                value={filters.status ?? 'ALL'}
                onValueChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    page: 1,
                    status: value === 'ALL' ? null : (value as 'POSTED' | 'REVERSED'),
                  }))
                }
                options={STATUS_FILTER_OPTIONS}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-preset">Rentang tanggal</Label>
              <OptionsSelect
                id="payment-preset"
                value={preset}
                onValueChange={applyPreset}
                placeholder="Pilih rentang cepat…"
                options={(Object.keys(DATE_RANGE_PRESET_LABELS) as DateRangePreset[])
                  .filter((key) => key !== 'CUSTOM')
                  .map((key) => ({ value: key, label: DATE_RANGE_PRESET_LABELS[key] }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateInput
              aria-label="Tanggal pembayaran dari"
              value={filters.from ?? null}
              onChange={(value) => {
                setPreset('');
                setFilters((previous) => ({ ...previous, page: 1, from: value }));
              }}
            />
            <span className="text-sm text-muted-foreground">sampai</span>
            <DateInput
              aria-label="Tanggal pembayaran sampai"
              value={filters.to ?? null}
              onChange={(value) => {
                setPreset('');
                setFilters((previous) => ({ ...previous, page: 1, to: value }));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft('');
                setPreset('');
                setFilters(DEFAULT_PAYMENT_FILTERS);
              }}
            >
              Reset filter
            </Button>
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

          {!query.isLoading && !query.isError ? (
            <p className="text-xs text-muted-foreground">
              Pada halaman ini: {summary.posted} pembayaran diposting senilai {formatRupiah(summary.postedAmount)}
              {summary.reversed > 0 ? ` • ${summary.reversed} pembayaran dibatalkan` : ''} • Total {total} kuitansi sesuai
              filter.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        searchable={false}
        initialPageSize={200}
        emptyTitle="Belum ada pembayaran"
        emptyDescription="Pembayaran yang dicatat melalui menu Pembayaran akan tampil di sini."
        emptyAction={
          canCreate ? (
            <Button asChild>
              <Link to="/app/payments/new">Catat Pembayaran</Link>
            </Button>
          ) : null
        }
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
                onValueChange={(value) => setFilters((previous) => ({ ...previous, page: 1, pageSize: Number(value) }))}
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
    </div>
  );
}
