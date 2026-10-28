/**
 * ReportsPage.tsx — Pusat laporan KreditKu.
 *
 * PRINSIP
 * -------
 * 1. Seluruh angka berasal dari view/RPC server (`@/data/*`), tidak ada data
 *    contoh. Bila data belum dimuat, yang tampil adalah kerangka pemuatan.
 * 2. Setiap laporan menampilkan periode, waktu pembuatan, dan pembuat laporan
 *    agar hasil ekspor dapat diaudit.
 * 3. Ekspor (CSV/XLSX/PDF) hanya untuk role dengan izin `exports.create`.
 *    Viewer/Auditor tetap dapat melihat tabel dan mencetaknya.
 *
 * CATATAN PENTING
 * ---------------
 * Seluruh penerimaan kas TIDAK sama dengan keuntungan. Pokok yang kembali
 * adalah pengembalian modal; pendapatan bunga dan biaya administrasi
 * dipisahkan pada laporan tersendiri (lihat Laporan Pendapatan Bunga).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Coins,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Printer,
  Receipt,
  ScrollText,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useCustomers } from '@/data/customers';
import { useApplications, useContracts, useOverdue } from '@/data/credit';
import { useAgingReport, usePenalties } from '@/data/payments';
import {
  METRIC_DEFINITIONS,
  useCollectionDaily,
  useCollectionReport,
  useDisbursements,
  useReceivables,
} from '@/data/reports';
import { useAuditLogs, useOfficerPerformance } from '@/data/admin';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateInput,
  ErrorState,
  OptionsSelect,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui';
import { ApplicationStatusBadge, ContractStatusBadge, MoneyText } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  exportCsv,
  exportPdf,
  exportXlsx,
  printHtml,
  type ExportColumn,
  type ExportMeta,
} from '@/lib/exports';
import { formatRupiah } from '@/lib/money';
import {
  DATE_RANGE_PRESET_LABELS,
  addPeriodsIso,
  daysBetweenIso,
  formatDateShortId,
  formatDateTimeId,
  formatMonthId,
  resolveDateRange,
  type DateRangePreset,
} from '@/lib/date';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type ApplicationStatus,
  type ContractStatus,
  type CustomerStatus,
  type PaymentMethod,
} from '@/core/types';

/* -------------------------------------------------------------------------- */
/* Definisi kolom laporan                                                     */
/* -------------------------------------------------------------------------- */

type FlatRow = Record<string, string>;

interface ReportColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right' | 'center';
  readonly hideOnMobile?: boolean;
  readonly accessor: (row: T) => string | number | null | undefined;
  readonly cell?: (row: T) => ReactNode;
  readonly exportValue?: (row: T) => string;
}

function flatValue<T>(column: ReportColumn<T>, row: T): string {
  if (column.exportValue) return column.exportValue(row);
  const value = column.accessor(row);
  return value === null || value === undefined ? '' : String(value);
}

function toTableColumns<T>(columns: readonly ReportColumn<T>[]): readonly Column<T>[] {
  return columns.map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    hideOnMobile: column.hideOnMobile,
    sortable: true,
    accessor: column.accessor,
    cell: column.cell,
  }));
}

function toExportRows<T>(rows: readonly T[], columns: readonly ReportColumn<T>[]): FlatRow[] {
  return rows.map((row) => {
    const entry: FlatRow = {};
    for (const column of columns) entry[column.header] = flatValue(column, row);
    return entry;
  });
}

function toExportColumns<T>(columns: readonly ReportColumn<T>[]): ExportColumn<FlatRow>[] {
  return columns.map((column) => ({
    key: column.header,
    header: column.header,
    align: column.align ?? 'left',
    width: column.align === 'right' ? 18 : 24,
  }));
}

function moneyColumn<T>(key: string, header: string, select: (row: T) => number): ReportColumn<T> {
  return {
    key,
    header,
    align: 'right',
    accessor: (row) => select(row),
    cell: (row) => <MoneyText value={select(row)} />,
    exportValue: (row) => formatRupiah(select(row)),
  };
}

/* -------------------------------------------------------------------------- */
/* Konteks & kerangka laporan                                                 */
/* -------------------------------------------------------------------------- */

interface ReportContext {
  readonly range: { from: string; to: string };
  readonly preset: DateRangePreset;
  readonly onPresetChange: (preset: DateRangePreset) => void;
  readonly onFromChange: (value: string | null) => void;
  readonly onToChange: (value: string | null) => void;
  readonly rangeInvalid: boolean;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly canExport: boolean;
}

const PRESET_OPTIONS = (Object.keys(DATE_RANGE_PRESET_LABELS) as DateRangePreset[]).map((preset) => ({
  value: preset,
  label: DATE_RANGE_PRESET_LABELS[preset],
}));

function DateRangeControls({ ctx }: { ctx: ReportContext }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-44">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Periode</p>
          <OptionsSelect
            value={ctx.preset}
            onValueChange={(value) => ctx.onPresetChange(value as DateRangePreset)}
            options={PRESET_OPTIONS}
          />
        </div>
        <div className="w-full sm:w-40">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Dari tanggal</p>
          <DateInput value={ctx.range.from} onChange={ctx.onFromChange} disabled={ctx.preset !== 'CUSTOM'} />
        </div>
        <div className="w-full sm:w-40">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Sampai tanggal</p>
          <DateInput value={ctx.range.to} onChange={ctx.onToChange} disabled={ctx.preset !== 'CUSTOM'} />
        </div>
      </div>
      {ctx.rangeInvalid ? (
        <p className="text-xs font-medium text-destructive">
          Tanggal awal melebihi tanggal akhir. Rentang dibalik otomatis agar query tetap valid.
        </p>
      ) : null}
    </div>
  );
}

function TotalsStrip({ items }: { items: readonly { label: string; value: ReactNode }[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-muted/40 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
          <div className="text-sm font-semibold tabular">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

interface ExportBarProps {
  readonly rows: readonly FlatRow[];
  readonly columns: readonly ExportColumn<FlatRow>[];
  readonly meta: ExportMeta;
  readonly canExport: boolean;
  readonly printHtmlContent: string;
}

function ExportBar({ rows, columns, meta, canExport, printHtmlContent }: ExportBarProps): JSX.Element {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  const handleCsv = () => {
    try {
      exportCsv(rows, columns, meta);
      notifySuccess('Berkas CSV dibuat.');
    } catch (error) {
      notifyError(error, 'Ekspor CSV gagal');
    }
  };

  const handleXlsx = async () => {
    setBusy('xlsx');
    try {
      await exportXlsx(rows, columns, meta);
      notifySuccess('Berkas XLSX dibuat.');
    } catch (error) {
      notifyError(error, 'Ekspor XLSX gagal');
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    setBusy('pdf');
    try {
      await exportPdf(rows, columns, meta);
      notifySuccess('Berkas PDF dibuat.');
    } catch (error) {
      notifyError(error, 'Ekspor PDF gagal');
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = () => {
    try {
      printHtml(meta.title ?? 'Laporan', printHtmlContent);
    } catch (error) {
      notifyError(error, 'Pencetakan gagal');
    }
  };

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={!canExport} onClick={handleCsv}>
        <Download aria-hidden />
        CSV
      </Button>
      <Button variant="outline" size="sm" disabled={!canExport} loading={busy === 'xlsx'} onClick={() => void handleXlsx()}>
        <FileSpreadsheet aria-hidden />
        XLSX
      </Button>
      <Button variant="outline" size="sm" disabled={!canExport} loading={busy === 'pdf'} onClick={() => void handlePdf()}>
        <FileText aria-hidden />
        PDF
      </Button>
      <Button variant="ghost" size="sm" onClick={handlePrint}>
        <Printer aria-hidden />
        Cetak
      </Button>
    </div>
  );

  if (canExport) return buttons;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttons}</TooltipTrigger>
      <TooltipContent>
        Role Anda memiliki akses lihat saja: izin «exports.create» diperlukan untuk mengunduh CSV/XLSX/PDF. Tabel dan
        tombol Cetak tetap tersedia.
      </TooltipContent>
    </Tooltip>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintHtml(
  title: string,
  subtitle: string,
  columns: readonly ExportColumn<FlatRow>[],
  rows: readonly FlatRow[],
  totals: readonly { label: string; value: string }[],
): string {
  const head = columns.map((column) => `<th class="${column.align === 'right' ? 'right' : ''}">${escapeHtml(column.header)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map(
            (column) =>
              `<td class="${column.align === 'right' ? 'right' : ''}">${escapeHtml(row[column.key] ?? '')}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const totalsHtml = totals.length
    ? `<div class="grid">${totals.map((item) => `<div><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(item.value)}</div>`).join('')}</div>`
    : '';
  return `<h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p>${totalsHtml}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p class="footer">Dokumen ini dihasilkan oleh KreditKu. Angka bersumber dari basis data organisasi aktif.</p>`;
}

interface ReportFrameProps {
  readonly title: string;
  readonly description: string;
  readonly ctx: ReportContext;
  readonly filename: string;
  readonly showRange?: boolean;
  readonly extraFilters?: ReactNode;
  readonly totals?: ReactNode;
  readonly totalsForPrint?: readonly { label: string; value: string }[];
  readonly exportRows: readonly FlatRow[];
  readonly exportColumns: readonly ExportColumn<FlatRow>[];
  readonly exportSubtitle: string;
  readonly note?: ReactNode;
  readonly loading?: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}

function ReportFrame({
  title,
  description,
  ctx,
  filename,
  showRange = true,
  extraFilters,
  totals,
  totalsForPrint = [],
  exportRows,
  exportColumns,
  exportSubtitle,
  note,
  loading,
  error,
  onRetry,
  children,
}: ReportFrameProps): JSX.Element {
  const subtitle = `${showRange ? `Periode ${formatDateShortId(ctx.range.from)} – ${formatDateShortId(ctx.range.to)}` : 'Posisi terkini'} • Dibuat ${ctx.generatedAt} oleh ${ctx.generatedBy}`;
  const meta: ExportMeta = {
    filename,
    title,
    subtitle: [exportSubtitle, subtitle].filter(Boolean).join(' • '),
    generatedBy: ctx.generatedBy,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>
              Periode:{' '}
              {showRange
                ? `${formatDateShortId(ctx.range.from)} – ${formatDateShortId(ctx.range.to)}`
                : 'posisi terkini'}
            </p>
            <p>
              Dibuat: {ctx.generatedAt} • Oleh: {ctx.generatedBy}
            </p>
            <p>{exportRows.length} baris</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showRange ? <DateRangeControls ctx={ctx} /> : null}
        {extraFilters ? <div className="flex flex-wrap items-end gap-2">{extraFilters}</div> : null}
        {totals}
        {note}
        <ExportBar
          rows={exportRows}
          columns={exportColumns}
          meta={meta}
          canExport={ctx.canExport}
          printHtmlContent={buildPrintHtml(title, subtitle, exportColumns, exportRows, totalsForPrint)}
        />
        {error ? <ErrorState message="Data laporan gagal dimuat." onRetry={onRetry} /> : null}
        {children}
        {!error && loading === false && exportRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tidak ada data pada periode ini. Ubah rentang tanggal atau filter untuk melihat hasil lain.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* a. Laporan Pelanggan                                                       */
/* -------------------------------------------------------------------------- */

function CustomersReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const [status, setStatus] = useState<string>('ALL');
  const query = useCustomers({
    search: '',
    statuses: status === 'ALL' ? [] : [status as CustomerStatus],
    page: 1,
    pageSize: 200,
    sortBy: 'outstanding',
    sortDir: 'desc',
  });

  const rows = useMemo(
    () => (query.data?.rows ?? []).filter((row) => row.created_at.slice(0, 10) >= ctx.range.from && row.created_at.slice(0, 10) <= ctx.range.to),
    [ctx.range.from, ctx.range.to, query.data],
  );

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'customer_number', header: 'Nomor Pelanggan', accessor: (row) => row.customer_number },
    { key: 'full_name', header: 'Nama Pelanggan', accessor: (row) => row.full_name },
    { key: 'phone', header: 'Telepon', accessor: (row) => row.phone, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      exportValue: (row) => row.status,
    },
    { key: 'total_contracts', header: 'Total Kontrak', align: 'right', accessor: (row) => row.total_contracts },
    { key: 'active_contracts', header: 'Kontrak Aktif', align: 'right', accessor: (row) => row.active_contracts, hideOnMobile: true },
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Tagihan', (row) => row.total_payable),
    moneyColumn<(typeof rows)[number]>('total_paid', 'Sudah Dibayar', (row) => row.total_paid),
    moneyColumn<(typeof rows)[number]>('outstanding', 'Sisa Piutang', (row) => row.outstanding),
    moneyColumn<(typeof rows)[number]>('overdue_amount', 'Tunggakan', (row) => row.overdue_amount),
    {
      key: 'next_due_date',
      header: 'Jatuh Tempo Berikutnya',
      accessor: (row) => row.next_due_date,
      exportValue: (row) => formatDateShortId(row.next_due_date),
      hideOnMobile: true,
    },
  ];

  const totalPiutang = rows.reduce((total, row) => total + row.outstanding, 0);
  const totalTunggakan = rows.reduce((total, row) => total + row.overdue_amount, 0);

  return (
    <ReportFrame
      title="Laporan Pelanggan"
      description="Daftar pelanggan pada rentang tanggal pembuatan, lengkap dengan total tagihan, piutang, dan tunggakan."
      ctx={ctx}
      filename="laporan-pelanggan"
      extraFilters={
        <div className="w-full sm:w-52">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Status pelanggan</p>
          <OptionsSelect value={status} onValueChange={setStatus} options={STATUS_FILTERS} />
        </div>
      }
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah pelanggan', value: rows.length },
            { label: 'Total piutang', value: <MoneyText value={totalPiutang} /> },
            { label: 'Tunggakan', value: <MoneyText value={totalTunggakan} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah pelanggan', value: String(rows.length) },
        { label: 'Total piutang', value: formatRupiah(totalPiutang) },
        { label: 'Tunggakan', value: formatRupiah(totalTunggakan) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle={`${STATUS_FILTERS.find((option) => option.value === status)?.label ?? ''} • Rentang berdasarkan tanggal pembuatan pelanggan`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada pelanggan"
        emptyDescription="Tidak ada pelanggan yang dibuat pada periode dan filter terpilih."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* b. Laporan Pengajuan Kredit                                                */
/* -------------------------------------------------------------------------- */

function ApplicationsReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const [status, setStatus] = useState<string>('ALL');
  const query = useApplications({
    search: '',
    statuses: status === 'ALL' ? [] : [status as ApplicationStatus],
    page: 1,
    pageSize: 200,
  });

  const rows = useMemo(
    () => (query.data?.rows ?? []).filter((row) => row.created_at.slice(0, 10) >= ctx.range.from && row.created_at.slice(0, 10) <= ctx.range.to),
    [ctx.range.from, ctx.range.to, query.data],
  );

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'application_number', header: 'Nomor Pengajuan', accessor: (row) => row.application_number },
    { key: 'customer', header: 'Pelanggan', accessor: (row) => row.customers?.full_name ?? '-', exportValue: (row) => row.customers?.full_name ?? '' },
    { key: 'credit_type', header: 'Jenis Kredit', accessor: (row) => row.credit_type },
    moneyColumn<(typeof rows)[number]>('price', 'Harga Barang', (row) => row.price),
    moneyColumn<(typeof rows)[number]>('down_payment', 'Uang Muka', (row) => row.down_payment),
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Pembiayaan', (row) => row.principal),
    { key: 'tenor', header: 'Tenor', align: 'right', accessor: (row) => row.tenor },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => APPLICATION_STATUS_LABELS[row.status],
      exportValue: (row) => APPLICATION_STATUS_LABELS[row.status],
      cell: (row) => <ApplicationStatusBadge status={row.status} />,
    },
    {
      key: 'created_at',
      header: 'Diajukan',
      accessor: (row) => row.created_at.slice(0, 10),
      exportValue: (row) => formatDateShortId(row.created_at.slice(0, 10)),
      hideOnMobile: true,
    },
    {
      key: 'decided_at',
      header: 'Diputuskan',
      accessor: (row) => row.decided_at?.slice(0, 10) ?? null,
      exportValue: (row) => formatDateShortId(row.decided_at?.slice(0, 10) ?? null),
      hideOnMobile: true,
    },
  ];

  const totalPrincipal = rows.reduce((total, row) => total + row.principal, 0);
  const approvedPrincipal = rows.filter((row) => row.status === 'APPROVED').reduce((total, row) => total + row.principal, 0);

  return (
    <ReportFrame
      title="Laporan Pengajuan Kredit"
      description="Pengajuan pada rentang tanggal dibuat, difilter berdasarkan status keputusan."
      ctx={ctx}
      filename="laporan-pengajuan"
      extraFilters={
        <div className="w-full sm:w-56">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Status pengajuan</p>
          <OptionsSelect value={status} onValueChange={setStatus} options={APPLICATION_STATUS_FILTERS} />
        </div>
      }
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah pengajuan', value: rows.length },
            { label: 'Nilai pokok diajukan', value: <MoneyText value={totalPrincipal} /> },
            { label: 'Pokok disetujui', value: <MoneyText value={approvedPrincipal} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah pengajuan', value: String(rows.length) },
        { label: 'Nilai pokok diajukan', value: formatRupiah(totalPrincipal) },
        { label: 'Pokok disetujui', value: formatRupiah(approvedPrincipal) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Rentang berdasarkan tanggal pengajuan dibuat"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada pengajuan"
        emptyDescription="Tidak ada pengajuan pada periode dan filter terpilih."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* c. Laporan Kredit Aktif                                                    */
/* -------------------------------------------------------------------------- */

const OPEN_CONTRACT_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'DELINQUENT', 'RESTRUCTURED'];

function ActiveContractsReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const [status, setStatus] = useState<string>('ALL');
  const query = useContracts({
    search: '',
    statuses: status === 'ALL' ? OPEN_CONTRACT_STATUSES : [status as ContractStatus],
    page: 1,
    pageSize: 200,
  });

  const rows = useMemo(
    () =>
      (query.data?.rows ?? []).filter(
        (row) => row.contract_date >= ctx.range.from && row.contract_date <= ctx.range.to,
      ),
    [ctx.range.from, ctx.range.to, query.data],
  );

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    { key: 'contract_date', header: 'Tanggal Kontrak', accessor: (row) => row.contract_date, exportValue: (row) => formatDateShortId(row.contract_date), hideOnMobile: true },
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Pembiayaan', (row) => row.principal),
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Tagihan', (row) => row.total_payable),
    moneyColumn<(typeof rows)[number]>('total_paid', 'Sudah Dibayar', (row) => row.total_paid),
    moneyColumn<(typeof rows)[number]>('outstanding', 'Sisa Piutang', (row) => row.outstanding),
    moneyColumn<(typeof rows)[number]>('overdue_amount', 'Tunggakan', (row) => row.overdue_amount),
    moneyColumn<(typeof rows)[number]>('penalty_outstanding', 'Denda Belum Dibayar', (row) => row.penalty_outstanding),
    { key: 'paid_installments', header: 'Cicilan Lunas', align: 'right', accessor: (row) => row.paid_installments, hideOnMobile: true },
    { key: 'overdue_installments', header: 'Cicilan Terlambat', align: 'right', accessor: (row) => row.overdue_installments, hideOnMobile: true },
    {
      key: 'progress_percent',
      header: 'Progres',
      align: 'right',
      accessor: (row) => row.progress_percent,
      exportValue: (row) => `${row.progress_percent.toFixed(1)}%`,
    },
    {
      key: 'next_due_date',
      header: 'Jatuh Tempo Berikutnya',
      accessor: (row) => row.next_due_date,
      exportValue: (row) => formatDateShortId(row.next_due_date),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => <ContractStatusBadge status={row.status} />,
    },
  ];

  const totalOutstanding = rows.reduce((total, row) => total + row.outstanding, 0);
  const totalOverdue = rows.reduce((total, row) => total + row.overdue_amount, 0);

  return (
    <ReportFrame
      title="Laporan Kredit Aktif"
      description="Kontrak berjalan (Aktif, Menunggak, Restrukturisasi) yang tanggal kontraknya berada pada periode."
      ctx={ctx}
      filename="laporan-kredit-aktif"
      extraFilters={
        <div className="w-full sm:w-56">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Status kontrak</p>
          <OptionsSelect value={status} onValueChange={setStatus} options={CONTRACT_STATUS_FILTERS} />
        </div>
      }
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah kontrak', value: rows.length },
            { label: 'Sisa piutang', value: <MoneyText value={totalOutstanding} /> },
            { label: 'Tunggakan', value: <MoneyText value={totalOverdue} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah kontrak', value: String(rows.length) },
        { label: 'Sisa piutang', value: formatRupiah(totalOutstanding) },
        { label: 'Tunggakan', value: formatRupiah(totalOverdue) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Hanya kontrak berjalan (Aktif, Menunggak, Restrukturisasi)"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada kontrak berjalan"
        emptyDescription="Tidak ada kontrak berjalan pada periode dan filter terpilih."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* d. Laporan Pencairan                                                       */
/* -------------------------------------------------------------------------- */

function DisbursementsReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useDisbursements(ctx.range);
  const rows = query.data ?? [];

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    {
      key: 'disbursement_date',
      header: 'Tanggal Pencairan',
      accessor: (row) => row.disbursement_date,
      exportValue: (row) => formatDateShortId(row.disbursement_date),
    },
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    { key: 'customer_number', header: 'Nomor Pelanggan', accessor: (row) => row.customer_number, hideOnMobile: true },
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Dicairkan', (row) => row.principal),
    moneyColumn<(typeof rows)[number]>('upfront_amount', 'Dibayar di Muka', (row) => row.upfront_amount),
    moneyColumn<(typeof rows)[number]>('total_interest', 'Bunga Kontrak', (row) => row.total_interest),
    moneyColumn<(typeof rows)[number]>('total_fees', 'Biaya', (row) => row.total_fees),
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Tagihan', (row) => row.total_payable),
    { key: 'tenor', header: 'Tenor', align: 'right', accessor: (row) => row.tenor },
    {
      key: 'method',
      header: 'Metode Bunga',
      accessor: (row) => row.method,
      hideOnMobile: true,
    },
  ];

  const totalPrincipal = rows.reduce((total, row) => total + row.principal, 0);
  const totalInterest = rows.reduce((total, row) => total + row.total_interest, 0);
  const totalFees = rows.reduce((total, row) => total + row.total_fees, 0);

  return (
    <ReportFrame
      title="Laporan Pencairan"
      description="Pencairan (pemberian modal) berdasarkan tanggal pencairan. Pencairan adalah pengeluaran kas, bukan pendapatan."
      ctx={ctx}
      filename="laporan-pencairan"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah pencairan', value: rows.length },
            { label: 'Total pokok dicairkan', value: <MoneyText value={totalPrincipal} /> },
            { label: 'Bunga dikontrakkan', value: <MoneyText value={totalInterest} /> },
            { label: 'Biaya dikontrakkan', value: <MoneyText value={totalFees} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah pencairan', value: String(rows.length) },
        { label: 'Total pokok dicairkan', value: formatRupiah(totalPrincipal) },
        { label: 'Bunga dikontrakkan', value: formatRupiah(totalInterest) },
        { label: 'Biaya dikontrakkan', value: formatRupiah(totalFees) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Berdasarkan tanggal pencairan kontrak (v_disbursement_report)"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.contract_id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada pencairan"
        emptyDescription="Tidak ada kontrak yang dicairkan pada periode ini."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* e. Laporan Piutang                                                         */
/* -------------------------------------------------------------------------- */

function ReceivablesReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useReceivables();
  const rows = query.data ?? [];

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    { key: 'customer_number', header: 'Nomor Pelanggan', accessor: (row) => row.customer_number, hideOnMobile: true },
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Pembiayaan', (row) => row.principal),
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Tagihan', (row) => row.total_payable),
    moneyColumn<(typeof rows)[number]>('total_paid', 'Sudah Dibayar', (row) => row.total_paid),
    moneyColumn<(typeof rows)[number]>('outstanding', 'Sisa Piutang', (row) => row.outstanding),
    moneyColumn<(typeof rows)[number]>('overdue_amount', 'Tunggakan', (row) => row.overdue_amount),
    moneyColumn<(typeof rows)[number]>('penalty_outstanding', 'Denda Belum Dibayar', (row) => row.penalty_outstanding),
    {
      key: 'progress_percent',
      header: 'Progres',
      align: 'right',
      accessor: (row) => row.progress_percent,
      exportValue: (row) => `${row.progress_percent.toFixed(1)}%`,
      hideOnMobile: true,
    },
    { key: 'max_days_late', header: 'Hari Terlambat Maks.', align: 'right', accessor: (row) => row.max_days_late, hideOnMobile: true },
    {
      key: 'next_due_date',
      header: 'Jatuh Tempo Berikutnya',
      accessor: (row) => row.next_due_date,
      exportValue: (row) => formatDateShortId(row.next_due_date),
      hideOnMobile: true,
    },
    { key: 'status', header: 'Status', accessor: (row) => row.status, cell: (row) => <ContractStatusBadge status={row.status} /> },
  ];

  const totalOutstanding = rows.reduce((total, row) => total + row.outstanding, 0);
  const totalOverdue = rows.reduce((total, row) => total + row.overdue_amount, 0);
  const totalPenalty = rows.reduce((total, row) => total + row.penalty_outstanding, 0);

  return (
    <ReportFrame
      title="Laporan Piutang"
      description="Seluruh kontrak berjalan dengan sisa tagihan lebih dari nol, diurutkan dari piutang terbesar."
      ctx={ctx}
      filename="laporan-piutang"
      showRange={false}
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah kontrak', value: rows.length },
            { label: 'Total piutang berjalan', value: <MoneyText value={totalOutstanding} /> },
            { label: 'Tunggakan', value: <MoneyText value={totalOverdue} /> },
            { label: 'Denda belum dibayar', value: <MoneyText value={totalPenalty} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah kontrak', value: String(rows.length) },
        { label: 'Total piutang berjalan', value: formatRupiah(totalOutstanding) },
        { label: 'Tunggakan', value: formatRupiah(totalOverdue) },
        { label: 'Denda belum dibayar', value: formatRupiah(totalPenalty) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Posisi terkini (bukan rentang tanggal)"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada piutang berjalan"
        emptyDescription="Seluruh kontrak sudah lunas atau belum ada kontrak berjalan."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* f. Laporan Pembayaran                                                      */
/* -------------------------------------------------------------------------- */

function CollectionsReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const [method, setMethod] = useState<string>('ALL');
  const detailQuery = useCollectionReport(ctx.range);
  const dailyQuery = useCollectionDaily(ctx.range);

  const allRows = useMemo(() => detailQuery.data ?? [], [detailQuery.data]);
  const rows = useMemo(
    () => (method === 'ALL' ? allRows : allRows.filter((row) => row.method === method)),
    [allRows, method],
  );
  const daily = dailyQuery.data ?? [];

  const columns: ReportColumn<(typeof allRows)[number]>[] = [
    { key: 'paid_date', header: 'Tanggal Bayar', accessor: (row) => row.paid_date, exportValue: (row) => formatDateShortId(row.paid_date) },
    { key: 'receipt_number', header: 'Nomor Kuitansi', accessor: (row) => row.receipt_number },
    {
      key: 'contract_id',
      header: 'ID Kontrak',
      accessor: (row) => row.contract_id,
      exportValue: (row) => row.contract_id,
      hideOnMobile: true,
    },
    moneyColumn<(typeof allRows)[number]>('amount', 'Nominal', (row) => row.amount),
    {
      key: 'method',
      header: 'Metode',
      accessor: (row) => row.method,
      exportValue: (row) => PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method,
    },
    { key: 'status', header: 'Status', accessor: (row) => row.status, exportValue: (row) => (row.status === 'POSTED' ? 'Diposting' : 'Dibatalkan') },
    moneyColumn<(typeof allRows)[number]>('allocated_to_installments', 'Dialokasikan ke Cicilan', (row) => row.allocated_to_installments),
    moneyColumn<(typeof allRows)[number]>('allocated_to_penalties', 'Dialokasikan ke Denda', (row) => row.allocated_to_penalties),
    moneyColumn<(typeof allRows)[number]>('unallocated', 'Belum Dialokasikan', (row) => row.unallocated),
  ];

  const dailyColumns: ReportColumn<(typeof daily)[number]>[] = [
    { key: 'paid_date', header: 'Tanggal', accessor: (row) => row.paid_date, exportValue: (row) => formatDateShortId(row.paid_date) },
    { key: 'payment_count', header: 'Jumlah Pembayaran', align: 'right', accessor: (row) => row.payment_count },
    moneyColumn<(typeof daily)[number]>('amount', 'Nominal Diterima', (row) => row.amount),
    moneyColumn<(typeof daily)[number]>('reversal_amount', 'Pembatalan', (row) => row.reversal_amount),
    {
      key: 'net',
      header: 'Bersih',
      align: 'right',
      accessor: (row) => row.amount - row.reversal_amount,
      cell: (row) => <MoneyText value={row.amount - row.reversal_amount} />,
      exportValue: (row) => formatRupiah(row.amount - row.reversal_amount),
    },
    { key: 'contract_count', header: 'Jumlah Kontrak', align: 'right', accessor: (row) => row.contract_count, hideOnMobile: true },
  ];

  const posted = rows.filter((row) => row.status === 'POSTED');
  const totalPosted = posted.reduce((total, row) => total + row.amount, 0);
  const totalReversed = rows
    .filter((row) => row.status === 'REVERSED')
    .reduce((total, row) => total + row.amount, 0);
  const totalUnallocated = posted.reduce((total, row) => total + row.unallocated, 0);

  return (
    <ReportFrame
      title="Laporan Pembayaran"
      description="Rincian pembayaran dan rekap harian. Nominal yang dibatalkan (reversal) tidak dihitung sebagai penerimaan."
      ctx={ctx}
      filename="laporan-pembayaran"
      extraFilters={
        <div className="w-full sm:w-52">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Metode pembayaran</p>
          <OptionsSelect value={method} onValueChange={setMethod} options={PAYMENT_METHOD_FILTERS} />
        </div>
      }
      totals={
        <TotalsStrip
          items={[
            { label: 'Pembayaran diterima', value: <MoneyText value={totalPosted} /> },
            { label: 'Pembatalan', value: <MoneyText value={totalReversed} /> },
            { label: 'Bersih', value: <MoneyText value={totalPosted - totalReversed} /> },
            { label: 'Belum dialokasikan', value: <MoneyText value={totalUnallocated} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Pembayaran diterima', value: formatRupiah(totalPosted) },
        { label: 'Pembatalan', value: formatRupiah(totalReversed) },
        { label: 'Bersih', value: formatRupiah(totalPosted - totalReversed) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Berdasarkan tanggal pembayaran (v_payment_breakdown)"
      loading={detailQuery.isLoading}
      error={detailQuery.error}
      onRetry={() => void detailQuery.refetch()}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Rincian pembayaran</h3>
          <DataTable
            data={rows}
            columns={toTableColumns(columns)}
            getRowId={(row) => row.payment_id}
            loading={detailQuery.isLoading}
            initialPageSize={20}
            emptyTitle="Tidak ada pembayaran"
            emptyDescription="Tidak ada pembayaran pada periode dan filter terpilih."
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Rekap harian</h3>
          <DataTable
            data={daily}
            columns={toTableColumns(dailyColumns)}
            getRowId={(row) => row.paid_date}
            loading={dailyQuery.isLoading}
            error={dailyQuery.error}
            onRetry={() => void dailyQuery.refetch()}
            searchable={false}
            initialPageSize={10}
            emptyTitle="Tidak ada rekap harian"
            emptyDescription="Belum ada pembayaran pada periode ini."
          />
        </div>
      </div>
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* g. Laporan Cicilan Terlambat                                               */
/* -------------------------------------------------------------------------- */

function OverdueReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useOverdue();
  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (row) => row.due_date >= ctx.range.from && row.due_date <= ctx.range.to,
      ),
    [ctx.range.from, ctx.range.to, query.data],
  );

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    { key: 'customer_phone', header: 'Telepon', accessor: (row) => row.customer_phone, hideOnMobile: true },
    { key: 'installment_number', header: 'Cicilan Ke-', align: 'right', accessor: (row) => row.installment_number },
    { key: 'due_date', header: 'Jatuh Tempo', accessor: (row) => row.due_date, exportValue: (row) => formatDateShortId(row.due_date) },
    { key: 'late_days', header: 'Hari Terlambat', align: 'right', accessor: (row) => row.late_days },
    { key: 'aging_bucket', header: 'Ember Umur', accessor: (row) => row.aging_bucket },
    moneyColumn<(typeof rows)[number]>('total_due', 'Total Tagihan', (row) => row.total_due),
    moneyColumn<(typeof rows)[number]>('paid_amount', 'Dibayar', (row) => row.paid_amount),
    moneyColumn<(typeof rows)[number]>('outstanding', 'Sisa Tagihan', (row) => row.outstanding),
    moneyColumn<(typeof rows)[number]>('penalty_outstanding', 'Denda', (row) => row.penalty_outstanding),
  ];

  const totalOutstanding = rows.reduce((total, row) => total + row.outstanding, 0);
  const totalPenalty = rows.reduce((total, row) => total + row.penalty_outstanding, 0);

  return (
    <ReportFrame
      title="Laporan Cicilan Terlambat"
      description="Cicilan yang melewati jatuh tempo dan belum lunas, dengan umur tunggakan per ember aging."
      ctx={ctx}
      filename="laporan-cicilan-terlambat"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah cicilan', value: rows.length },
            { label: 'Total sisa tagihan', value: <MoneyText value={totalOutstanding} /> },
            { label: 'Denda terkait', value: <MoneyText value={totalPenalty} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah cicilan', value: String(rows.length) },
        { label: 'Total sisa tagihan', value: formatRupiah(totalOutstanding) },
        { label: 'Denda terkait', value: formatRupiah(totalPenalty) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Rentang berdasarkan tanggal jatuh tempo cicilan"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada tunggakan"
        emptyDescription="Tidak ada cicilan terlambat pada periode ini."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* h. Laporan Denda                                                           */
/* -------------------------------------------------------------------------- */

function PenaltiesReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const penaltyQuery = usePenalties({ search: '', statuses: ['OPEN'], contractId: null, page: 1, pageSize: 200 });
  const agingQuery = useAgingReport();

  const allRows = useMemo(() => penaltyQuery.data?.rows ?? [], [penaltyQuery.data]);
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        const created = row.calculated_at.slice(0, 10);
        return created >= ctx.range.from && created <= ctx.range.to;
      }),
    [allRows, ctx.range.from, ctx.range.to],
  );
  const aging = agingQuery.data ?? [];

  const penaltyColumns: ReportColumn<(typeof allRows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.installments?.credit_contracts?.contract_number ?? '-', exportValue: (row) => row.installments?.credit_contracts?.contract_number ?? '' },
    { key: 'installment_number', header: 'Cicilan Ke-', align: 'right', accessor: (row) => row.installments?.installment_number ?? null },
    {
      key: 'due_date',
      header: 'Jatuh Tempo',
      accessor: (row) => row.installments?.due_date ?? null,
      exportValue: (row) => formatDateShortId(row.installments?.due_date ?? null),
      hideOnMobile: true,
    },
    { key: 'late_days', header: 'Hari Terlambat', align: 'right', accessor: (row) => row.late_days },
    { key: 'chargeable_days', header: 'Hari Kena Denda', align: 'right', accessor: (row) => row.chargeable_days, hideOnMobile: true },
    moneyColumn<(typeof allRows)[number]>('amount', 'Nominal Denda', (row) => row.amount),
    moneyColumn<(typeof allRows)[number]>('paid_amount', 'Sudah Dibayar', (row) => row.paid_amount),
    moneyColumn<(typeof allRows)[number]>('waived_amount', 'Dibebaskan', (row) => row.waived_amount),
    {
      key: 'outstanding',
      header: 'Denda Belum Dibayar',
      align: 'right',
      accessor: (row) => Math.max(0, row.amount - row.paid_amount - row.waived_amount),
      cell: (row) => <MoneyText value={Math.max(0, row.amount - row.paid_amount - row.waived_amount)} />,
      exportValue: (row) => formatRupiah(Math.max(0, row.amount - row.paid_amount - row.waived_amount)),
    },
    {
      key: 'calculated_at',
      header: 'Dihitung Pada',
      accessor: (row) => row.calculated_at.slice(0, 10),
      exportValue: (row) => formatDateShortId(row.calculated_at.slice(0, 10)),
      hideOnMobile: true,
    },
  ];

  const agingColumns: ReportColumn<(typeof aging)[number]>[] = [
    { key: 'bucket', header: 'Ember Umur', accessor: (row) => row.bucket },
    { key: 'installment_count', header: 'Jumlah Cicilan', align: 'right', accessor: (row) => row.installment_count },
    { key: 'contract_count', header: 'Jumlah Kontrak', align: 'right', accessor: (row) => row.contract_count, hideOnMobile: true },
    moneyColumn<(typeof aging)[number]>('principal_amount', 'Pokok', (row) => row.principal_amount),
    moneyColumn<(typeof aging)[number]>('interest_amount', 'Bunga', (row) => row.interest_amount),
    moneyColumn<(typeof aging)[number]>('fees_amount', 'Biaya', (row) => row.fees_amount),
    moneyColumn<(typeof aging)[number]>('outstanding', 'Sisa Tagihan', (row) => row.outstanding),
    moneyColumn<(typeof aging)[number]>('penalty_outstanding', 'Denda', (row) => row.penalty_outstanding),
  ];

  const totalPenalty = rows.reduce((total, row) => total + row.amount, 0);
  const totalOutstanding = rows.reduce((total, row) => total + Math.max(0, row.amount - row.paid_amount - row.waived_amount), 0);
  const totalAging = aging.reduce((total, row) => total + row.outstanding, 0);

  return (
    <ReportFrame
      title="Laporan Denda"
      description="Denda yang masih terbuka (status Belum Dibayar) pada periode perhitungan, dilengkapi laporan umur piutang."
      ctx={ctx}
      filename="laporan-denda"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah denda terbuka', value: rows.length },
            { label: 'Nominal denda', value: <MoneyText value={totalPenalty} /> },
            { label: 'Denda belum dibayar', value: <MoneyText value={totalOutstanding} /> },
            { label: 'Piutang menunggak (aging)', value: <MoneyText value={totalAging} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah denda terbuka', value: String(rows.length) },
        { label: 'Nominal denda', value: formatRupiah(totalPenalty) },
        { label: 'Denda belum dibayar', value: formatRupiah(totalOutstanding) },
      ]}
      exportRows={toExportRows(rows, penaltyColumns)}
      exportColumns={toExportColumns(penaltyColumns)}
      exportSubtitle="Denda berstatus Belum Dibayar • rentang berdasarkan waktu perhitungan"
      loading={penaltyQuery.isLoading}
      error={penaltyQuery.error}
      onRetry={() => void penaltyQuery.refetch()}
    >
      <div className="space-y-6">
        <DataTable
          data={rows}
          columns={toTableColumns(penaltyColumns)}
          getRowId={(row) => row.id}
          loading={penaltyQuery.isLoading}
          initialPageSize={20}
          emptyTitle="Tidak ada denda terbuka"
          emptyDescription="Tidak ada denda belum dibayar pada periode ini."
        />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Laporan umur piutang (aging)</h3>
          <p className="text-xs text-muted-foreground">
            Ember umur mengikuti batas aging pada pengaturan keuangan organisasi.
          </p>
          <DataTable
            data={aging}
            columns={toTableColumns(agingColumns)}
            getRowId={(row) => row.bucket}
            loading={agingQuery.isLoading}
            error={agingQuery.error}
            onRetry={() => void agingQuery.refetch()}
            searchable={false}
            initialPageSize={10}
            emptyTitle="Tidak ada data umur piutang"
          />
        </div>
      </div>
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* i. Laporan Pelunasan                                                       */
/* -------------------------------------------------------------------------- */

function PaidOffReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useContracts({ search: '', statuses: ['PAID_OFF'], page: 1, pageSize: 200 });
  const rows = useMemo(
    () =>
      (query.data?.rows ?? []).filter(
        (row) =>
          row.last_payment_date !== null &&
          row.last_payment_date >= ctx.range.from &&
          row.last_payment_date <= ctx.range.to,
      ),
    [ctx.range.from, ctx.range.to, query.data],
  );

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    { key: 'contract_date', header: 'Tanggal Kontrak', accessor: (row) => row.contract_date, exportValue: (row) => formatDateShortId(row.contract_date), hideOnMobile: true },
    { key: 'tenor', header: 'Tenor', align: 'right', accessor: (row) => row.tenor },
    { key: 'paid_installments', header: 'Cicilan Lunas', align: 'right', accessor: (row) => row.paid_installments },
    {
      key: 'last_payment_date',
      header: 'Pembayaran Terakhir',
      accessor: (row) => row.last_payment_date,
      exportValue: (row) => formatDateShortId(row.last_payment_date),
    },
    {
      key: 'expected_final_due',
      header: 'Jadwal Cicilan Terakhir',
      accessor: (row) => expectedFinalDueDate(row),
      exportValue: (row) => formatDateShortId(expectedFinalDueDate(row)),
      hideOnMobile: true,
    },
    {
      key: 'settlement',
      header: 'Ketepatan Penyelesaian',
      accessor: (row) => settlementLabel(row),
      exportValue: (row) => settlementLabel(row),
    },
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Pembiayaan', (row) => row.principal),
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Dibayar', (row) => row.total_payable),
    moneyColumn<(typeof rows)[number]>('total_paid', 'Total Tercatat', (row) => row.total_paid),
  ];

  const totalPaid = rows.reduce((total, row) => total + row.total_paid, 0);
  const faster = rows.filter((row) => (settlementDays(row) ?? 0) > 0).length;
  const later = rows.filter((row) => (settlementDays(row) ?? 0) < 0).length;

  return (
    <ReportFrame
      title="Laporan Pelunasan"
      description="Kontrak yang sudah lunas pada periode, termasuk info apakah diselesaikan lebih cepat atau lebih lambat dari jadwal cicilan terakhir."
      ctx={ctx}
      filename="laporan-pelunasan"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah kontrak lunas', value: rows.length },
            { label: 'Selesai lebih cepat', value: faster },
            { label: 'Selesai lebih lambat', value: later },
            { label: 'Total pembayaran tercatat', value: <MoneyText value={totalPaid} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah kontrak lunas', value: String(rows.length) },
        { label: 'Selesai lebih cepat', value: String(faster) },
        { label: 'Selesai lebih lambat', value: String(later) },
        { label: 'Total pembayaran tercatat', value: formatRupiah(totalPaid) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Rentang berdasarkan tanggal pembayaran terakhir"
      note={
        <p className="text-xs text-muted-foreground">
          Kolom «Ketepatan Penyelesaian» membandingkan tanggal pembayaran terakhir dengan jatuh tempo cicilan terakhir
          yang dihitung dari tanggal jatuh tempo pertama ditambah (tenor − 1) periode sesuai frekuensi kontrak.
        </p>
      }
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada pelunasan"
        emptyDescription="Tidak ada kontrak lunas pada periode ini."
      />
    </ReportFrame>
  );
}

type PaidOffRow = {
  first_due_date: string;
  tenor: number;
  frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'DAILY';
  last_payment_date: string | null;
};

function expectedFinalDueDate(row: PaidOffRow): string | null {
  try {
    return addPeriodsIso(row.first_due_date, Math.max(0, row.tenor - 1), row.frequency);
  } catch {
    return null;
  }
}

/** Positif = lebih cepat dari jadwal; negatif = lebih lambat. */
function settlementDays(row: PaidOffRow): number | null {
  const expected = expectedFinalDueDate(row);
  if (!expected || !row.last_payment_date) return null;
  return daysBetweenIso(expected, row.last_payment_date);
}

function settlementLabel(row: PaidOffRow): string {
  const diff = settlementDays(row);
  if (diff === null) return 'Tidak dapat dihitung';
  if (diff === 0) return 'Tepat jadwal';
  if (diff > 0) return `Lebih cepat ${diff} hari`;
  return `Terlambat ${Math.abs(diff)} hari`;
}

/* -------------------------------------------------------------------------- */
/* j. Laporan Arus Kas                                                        */
/* -------------------------------------------------------------------------- */

function CashflowReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useCollectionDaily(ctx.range);
  const daily = useMemo(() => query.data ?? [], [query.data]);

  const monthly = useMemo(() => {
    const buckets = new Map<string, { amount: number; reversal: number; count: number }>();
    for (const row of daily) {
      const key = row.paid_date.slice(0, 7);
      const bucket = buckets.get(key) ?? { amount: 0, reversal: 0, count: 0 };
      bucket.amount += row.amount;
      bucket.reversal += row.reversal_amount;
      bucket.count += row.payment_count;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .map(([month, value]) => ({ month, ...value, net: value.amount - value.reversal }))
      .sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [daily]);

  const dailyColumns: ReportColumn<(typeof daily)[number]>[] = [
    { key: 'paid_date', header: 'Tanggal', accessor: (row) => row.paid_date, exportValue: (row) => formatDateShortId(row.paid_date) },
    moneyColumn<(typeof daily)[number]>('amount', 'Kas Masuk', (row) => row.amount),
    moneyColumn<(typeof daily)[number]>('reversal_amount', 'Kas Keluar (Pembatalan)', (row) => row.reversal_amount),
    {
      key: 'net',
      header: 'Arus Kas Bersih',
      align: 'right',
      accessor: (row) => row.amount - row.reversal_amount,
      cell: (row) => <MoneyText value={row.amount - row.reversal_amount} signed />,
      exportValue: (row) => formatRupiah(row.amount - row.reversal_amount),
    },
    { key: 'payment_count', header: 'Jumlah Pembayaran', align: 'right', accessor: (row) => row.payment_count, hideOnMobile: true },
    { key: 'contract_count', header: 'Jumlah Kontrak', align: 'right', accessor: (row) => row.contract_count, hideOnMobile: true },
  ];

  const monthlyColumns: ReportColumn<(typeof monthly)[number]>[] = [
    { key: 'month', header: 'Bulan', accessor: (row) => row.month, exportValue: (row) => formatMonthId(`${row.month}-01`) },
    moneyColumn<(typeof monthly)[number]>('amount', 'Kas Masuk', (row) => row.amount),
    moneyColumn<(typeof monthly)[number]>('reversal', 'Kas Keluar (Pembatalan)', (row) => row.reversal),
    {
      key: 'net',
      header: 'Arus Kas Bersih',
      align: 'right',
      accessor: (row) => row.net,
      cell: (row) => <MoneyText value={row.net} signed />,
      exportValue: (row) => formatRupiah(row.net),
    },
    { key: 'count', header: 'Jumlah Pembayaran', align: 'right', accessor: (row) => row.count, hideOnMobile: true },
  ];

  const kasMasuk = daily.reduce((total, row) => total + row.amount, 0);
  const kasKeluar = daily.reduce((total, row) => total + row.reversal_amount, 0);

  return (
    <ReportFrame
      title="Laporan Arus Kas"
      description="Kas masuk dari pembayaran dikurangi pembatalan pembayaran, disajikan per hari dan per bulan."
      ctx={ctx}
      filename="laporan-arus-kas"
      totals={
        <TotalsStrip
          items={[
            { label: 'Kas masuk', value: <MoneyText value={kasMasuk} /> },
            { label: 'Kas keluar (pembatalan)', value: <MoneyText value={kasKeluar} /> },
            { label: 'Arus kas bersih', value: <MoneyText value={kasMasuk - kasKeluar} signed /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Kas masuk', value: formatRupiah(kasMasuk) },
        { label: 'Kas keluar (pembatalan)', value: formatRupiah(kasKeluar) },
        { label: 'Arus kas bersih', value: formatRupiah(kasMasuk - kasKeluar) },
      ]}
      exportRows={toExportRows(daily, dailyColumns)}
      exportColumns={toExportColumns(dailyColumns)}
      exportSubtitle="Berdasarkan tanggal pembayaran (v_collection_daily)"
      note={
        <p className="text-xs text-muted-foreground">
          Arus kas ini belum memperhitungkan pencairan (pengeluaran modal). Lihat Laporan Pencairan untuk kas keluar
          berupa pemberian pembiayaan.
        </p>
      }
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Arus kas per hari</h3>
          <DataTable
            data={daily}
            columns={toTableColumns(dailyColumns)}
            getRowId={(row) => row.paid_date}
            loading={query.isLoading}
            initialPageSize={20}
            emptyTitle="Tidak ada arus kas"
            emptyDescription="Tidak ada pembayaran pada periode ini."
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Arus kas per bulan</h3>
          <DataTable
            data={monthly}
            columns={toTableColumns(monthlyColumns)}
            getRowId={(row) => row.month}
            searchable={false}
            initialPageSize={12}
            emptyTitle="Tidak ada arus kas bulanan"
          />
        </div>
      </div>
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* k. Laporan Pendapatan Bunga                                                */
/* -------------------------------------------------------------------------- */

function InterestReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useDisbursements(ctx.range);
  const rows = query.data ?? [];

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'contract_number', header: 'Nomor Kontrak', accessor: (row) => row.contract_number },
    { key: 'customer_name', header: 'Pelanggan', accessor: (row) => row.customer_name },
    {
      key: 'disbursement_date',
      header: 'Tanggal Pencairan',
      accessor: (row) => row.disbursement_date,
      exportValue: (row) => formatDateShortId(row.disbursement_date),
    },
    moneyColumn<(typeof rows)[number]>('principal', 'Pokok Pembiayaan', (row) => row.principal),
    moneyColumn<(typeof rows)[number]>('total_interest', 'Pendapatan Bunga', (row) => row.total_interest),
    moneyColumn<(typeof rows)[number]>('total_fees', 'Biaya Administrasi', (row) => row.total_fees),
    moneyColumn<(typeof rows)[number]>('upfront_amount', 'Diterima di Muka', (row) => row.upfront_amount),
    moneyColumn<(typeof rows)[number]>('total_payable', 'Total Tagihan', (row) => row.total_payable),
    { key: 'tenor', header: 'Tenor', align: 'right', accessor: (row) => row.tenor, hideOnMobile: true },
  ];

  const totalInterest = rows.reduce((total, row) => total + row.total_interest, 0);
  const totalFees = rows.reduce((total, row) => total + row.total_fees, 0);
  const totalPrincipal = rows.reduce((total, row) => total + row.principal, 0);

  return (
    <ReportFrame
      title="Laporan Pendapatan Bunga"
      description="Bunga dan biaya administrasi yang dikontrakkan pada kontrak yang dicairkan dalam periode ini."
      ctx={ctx}
      filename="laporan-pendapatan-bunga"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah kontrak', value: rows.length },
            { label: 'Pendapatan bunga', value: <MoneyText value={totalInterest} /> },
            { label: 'Biaya administrasi', value: <MoneyText value={totalFees} /> },
            { label: 'Pokok dicairkan (bukan pendapatan)', value: <MoneyText value={totalPrincipal} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah kontrak', value: String(rows.length) },
        { label: 'Pendapatan bunga', value: formatRupiah(totalInterest) },
        { label: 'Biaya administrasi', value: formatRupiah(totalFees) },
        { label: 'Pokok dicairkan (bukan pendapatan)', value: formatRupiah(totalPrincipal) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Rumus: Σ total_interest kontrak dengan tanggal pencairan pada rentang"
      note={
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Cara pembacaan (penting)</p>
          <p>
            <strong>Rumus:</strong> Pendapatan bunga = Σ <code>total_interest</code> untuk seluruh kontrak yang
            tanggal pencairannya berada pada rentang. Biaya administrasi dihitung terpisah dari{' '}
            <code>total_fees</code>. Kolom pokok ditampilkan sebagai pengingat bahwa pokok yang kembali adalah
            pengembalian modal, <strong>bukan</strong> pendapatan.
          </p>
          <p className="mt-1">
            Angka ini adalah nilai yang <em>dikontrakkan</em> pada periode pencairan, bukan bunga yang sudah
            benar-benar diterima sebagai kas. Bunga yang terealisasi mengikuti alokasi pembayaran pada Laporan
            Pembayaran.
          </p>
        </div>
      }
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.contract_id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada kontrak dicairkan"
        emptyDescription="Tidak ada pencairan pada periode ini sehingga tidak ada bunga yang dikontrakkan."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* l. Laporan Kinerja Petugas                                                 */
/* -------------------------------------------------------------------------- */

function OfficersReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useOfficerPerformance();
  const rows = query.data ?? [];

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    { key: 'full_name', header: 'Nama Petugas', accessor: (row) => row.full_name || row.email },
    { key: 'email', header: 'Email', accessor: (row) => row.email, hideOnMobile: true },
    { key: 'role', header: 'Role', accessor: (row) => row.role, cell: (row) => <Badge variant="secondary">{row.role}</Badge> },
    { key: 'payments_count', header: 'Jumlah Pembayaran', align: 'right', accessor: (row) => row.payments_count },
    moneyColumn<(typeof rows)[number]>('payments_amount', 'Total Pembayaran Diterima', (row) => row.payments_amount),
    { key: 'applications_count', header: 'Pengajuan Dibuat', align: 'right', accessor: (row) => row.applications_count, hideOnMobile: true },
    { key: 'approvals_count', header: 'Disetujui', align: 'right', accessor: (row) => row.approvals_count },
    { key: 'rejections_count', header: 'Ditolak', align: 'right', accessor: (row) => row.rejections_count },
    {
      key: 'approval_rate',
      header: 'Rasio Persetujuan',
      align: 'right',
      accessor: (row) => {
        const decisions = row.approvals_count + row.rejections_count;
        return decisions > 0 ? Math.round((row.approvals_count / decisions) * 1000) / 10 : 0;
      },
      exportValue: (row) => {
        const decisions = row.approvals_count + row.rejections_count;
        return decisions > 0 ? `${Math.round((row.approvals_count / decisions) * 1000) / 10}%` : '-';
      },
      hideOnMobile: true,
    },
  ];

  const totalPayments = rows.reduce((total, row) => total + row.payments_amount, 0);
  const totalCount = rows.reduce((total, row) => total + row.payments_count, 0);

  return (
    <ReportFrame
      title="Laporan Kinerja Petugas"
      description="Rekap pembayaran yang dicatat dan keputusan pengajuan per petugas (posisi terkini, tanpa filter tanggal)."
      ctx={ctx}
      filename="laporan-kinerja-petugas"
      showRange={false}
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah petugas', value: rows.length },
            { label: 'Pembayaran dicatat', value: totalCount },
            { label: 'Total nominal', value: <MoneyText value={totalPayments} /> },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah petugas', value: String(rows.length) },
        { label: 'Pembayaran dicatat', value: String(totalCount) },
        { label: 'Total nominal', value: formatRupiah(totalPayments) },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Berdasarkan pembayaran yang dicatat dan keputusan pengajuan (v_officer_performance)"
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.user_id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Belum ada aktivitas petugas"
        emptyDescription="Belum ada pembayaran atau keputusan pengajuan yang tercatat."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* m. Laporan Audit Aktivitas                                                 */
/* -------------------------------------------------------------------------- */

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Membuat',
  UPDATE: 'Memperbarui',
  DELETE: 'Menghapus',
  ARCHIVE: 'Mengarsipkan',
  RESTORE: 'Memulihkan',
  APPROVE: 'Menyetujui',
  REJECT: 'Menolak',
  CANCEL: 'Membatalkan',
  POST_PAYMENT: 'Mencatat Pembayaran',
  REVERSE_PAYMENT: 'Membatalkan Pembayaran',
  WAIVE_PENALTY: 'Membebaskan Denda',
  LOGIN: 'Masuk',
  LOGOUT: 'Keluar',
  INVITE_USER: 'Mengundang Pengguna',
  ACTIVATE_USER: 'Mengaktifkan Pengguna',
  DEACTIVATE_USER: 'Menonaktifkan Pengguna',
  SETTINGS_CHANGE: 'Mengubah Pengaturan',
  EXPORT: 'Mengekspor Data',
};

function AuditReport({ ctx }: { ctx: ReportContext }): JSX.Element {
  const query = useAuditLogs({
    search: '',
    action: null,
    entityType: null,
    from: ctx.range.from,
    to: ctx.range.to,
    page: 1,
    pageSize: 200,
  });
  const rows = query.data?.rows ?? [];

  const columns: ReportColumn<(typeof rows)[number]>[] = [
    {
      key: 'created_at',
      header: 'Waktu',
      accessor: (row) => row.created_at,
      exportValue: (row) => formatDateTimeId(row.created_at),
    },
    { key: 'actor_email', header: 'Aktor', accessor: (row) => row.actor_email ?? '-' },
    {
      key: 'action',
      header: 'Aksi',
      accessor: (row) => row.action,
      exportValue: (row) => AUDIT_ACTION_LABELS[row.action] ?? row.action,
      cell: (row) => <Badge variant="secondary">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</Badge>,
    },
    { key: 'entity_type', header: 'Entitas', accessor: (row) => row.entity_type },
    { key: 'entity_id', header: 'ID Entitas', accessor: (row) => row.entity_id ?? '-', hideOnMobile: true },
    { key: 'summary', header: 'Ringkasan', accessor: (row) => row.summary ?? '-' },
  ];

  return (
    <ReportFrame
      title="Laporan Audit Aktivitas"
      description="Jejak aktivitas administrator pada periode terpilih. Audit log bersifat hanya-tambah (append-only)."
      ctx={ctx}
      filename="laporan-audit-aktivitas"
      totals={
        <TotalsStrip
          items={[
            { label: 'Jumlah aktivitas', value: rows.length },
            { label: 'Total tercatat (server)', value: query.data?.total ?? '-' },
          ]}
        />
      }
      totalsForPrint={[
        { label: 'Jumlah aktivitas', value: String(rows.length) },
        { label: 'Total tercatat (server)', value: String(query.data?.total ?? '-') },
      ]}
      exportRows={toExportRows(rows, columns)}
      exportColumns={toExportColumns(columns)}
      exportSubtitle="Diambil maksimum 200 catatan terbaru pada rentang"
      note={
        <p className="text-xs text-muted-foreground">
          Audit log tidak dapat diubah atau dihapus. Untuk penelusuran lebih rinci (perbandingan data sebelum dan
          sesudah), gunakan halaman Audit Log pada menu Pengaturan.
        </p>
      }
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <DataTable
        data={rows}
        columns={toTableColumns(columns)}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        initialPageSize={20}
        emptyTitle="Tidak ada aktivitas"
        emptyDescription="Tidak ada aktivitas tercatat pada periode ini."
      />
    </ReportFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Daftar filter                                                              */
/* -------------------------------------------------------------------------- */

const STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'ALL', label: 'Semua status' },
  { value: 'PROSPECT', label: 'Prospek' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'DELINQUENT', label: 'Menunggak' },
  { value: 'PAID_OFF', label: 'Lunas' },
  { value: 'BLOCKED', label: 'Diblokir' },
  { value: 'ARCHIVED', label: 'Diarsipkan' },
];

const APPLICATION_STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'ALL', label: 'Semua status' },
  ...APPLICATION_STATUSES.map((status) => ({ value: status, label: APPLICATION_STATUS_LABELS[status] })),
];

const CONTRACT_STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'ALL', label: 'Semua status berjalan' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'DELINQUENT', label: 'Menunggak' },
  { value: 'RESTRUCTURED', label: 'Restrukturisasi' },
];

const PAYMENT_METHOD_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'ALL', label: 'Semua metode' },
  ...PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] })),
];

/* -------------------------------------------------------------------------- */
/* Registri laporan                                                           */
/* -------------------------------------------------------------------------- */

type ReportKey =
  | 'customers'
  | 'applications'
  | 'contracts'
  | 'disbursements'
  | 'receivables'
  | 'collections'
  | 'overdue'
  | 'penalties'
  | 'paid_off'
  | 'cashflow'
  | 'interest'
  | 'officers'
  | 'audit';

interface ReportDefinition {
  readonly key: ReportKey;
  readonly label: string;
  readonly icon: ReactNode;
}

const REPORTS: readonly ReportDefinition[] = [
  { key: 'customers', label: 'Pelanggan', icon: <Users className="h-4 w-4" aria-hidden /> },
  { key: 'applications', label: 'Pengajuan Kredit', icon: <FileText className="h-4 w-4" aria-hidden /> },
  { key: 'contracts', label: 'Kredit Aktif', icon: <ScrollText className="h-4 w-4" aria-hidden /> },
  { key: 'disbursements', label: 'Pencairan', icon: <Banknote className="h-4 w-4" aria-hidden /> },
  { key: 'receivables', label: 'Piutang', icon: <Wallet className="h-4 w-4" aria-hidden /> },
  { key: 'collections', label: 'Pembayaran', icon: <Receipt className="h-4 w-4" aria-hidden /> },
  { key: 'overdue', label: 'Cicilan Terlambat', icon: <CalendarClock className="h-4 w-4" aria-hidden /> },
  { key: 'penalties', label: 'Denda', icon: <AlertTriangle className="h-4 w-4" aria-hidden /> },
  { key: 'paid_off', label: 'Pelunasan', icon: <ListChecks className="h-4 w-4" aria-hidden /> },
  { key: 'cashflow', label: 'Arus Kas', icon: <TrendingUp className="h-4 w-4" aria-hidden /> },
  { key: 'interest', label: 'Pendapatan Bunga', icon: <Coins className="h-4 w-4" aria-hidden /> },
  { key: 'officers', label: 'Kinerja Petugas', icon: <Users className="h-4 w-4" aria-hidden /> },
  { key: 'audit', label: 'Audit Aktivitas', icon: <FileSpreadsheet className="h-4 w-4" aria-hidden /> },
];

function ReportBody({ report, ctx }: { report: ReportKey; ctx: ReportContext }): JSX.Element {
  switch (report) {
    case 'customers':
      return <CustomersReport ctx={ctx} />;
    case 'applications':
      return <ApplicationsReport ctx={ctx} />;
    case 'contracts':
      return <ActiveContractsReport ctx={ctx} />;
    case 'disbursements':
      return <DisbursementsReport ctx={ctx} />;
    case 'receivables':
      return <ReceivablesReport ctx={ctx} />;
    case 'collections':
      return <CollectionsReport ctx={ctx} />;
    case 'overdue':
      return <OverdueReport ctx={ctx} />;
    case 'penalties':
      return <PenaltiesReport ctx={ctx} />;
    case 'paid_off':
      return <PaidOffReport ctx={ctx} />;
    case 'cashflow':
      return <CashflowReport ctx={ctx} />;
    case 'interest':
      return <InterestReport ctx={ctx} />;
    case 'officers':
      return <OfficersReport ctx={ctx} />;
    case 'audit':
      return <AuditReport ctx={ctx} />;
    default:
      return <CustomersReport ctx={ctx} />;
  }
}

/* -------------------------------------------------------------------------- */
/* Halaman                                                                    */
/* -------------------------------------------------------------------------- */

export default function ReportsPage(): JSX.Element {
  const { can, profile } = useAuth();
  const [report, setReport] = useState<ReportKey>('customers');
  const [preset, setPreset] = useState<DateRangePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState<string>(() => resolveDateRange('THIS_MONTH').from);
  const [customTo, setCustomTo] = useState<string>(() => resolveDateRange('THIS_MONTH').to);

  const generatedAt = useMemo(() => formatDateTimeId(new Date().toISOString()), []);
  const generatedBy = profile?.full_name || profile?.email || 'Pengguna tidak dikenal';

  const range = useMemo(() => {
    const resolved = preset === 'CUSTOM' ? { from: customFrom, to: customTo } : resolveDateRange(preset);
    if (resolved.from > resolved.to) return { from: resolved.to, to: resolved.from };
    return resolved;
  }, [customFrom, customTo, preset]);

  const ctx: ReportContext = {
    range,
    preset,
    onPresetChange: setPreset,
    onFromChange: (value) => setCustomFrom(value ?? ''),
    onToChange: (value) => setCustomTo(value ?? ''),
    rangeInvalid: preset === 'CUSTOM' && customFrom > customTo,
    generatedAt,
    generatedBy,
    canExport: can('exports.create'),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Laporan"
        description="Seluruh laporan operasional dan keuangan organisasi aktif. Pilih jenis laporan, atur periode, lalu ekspor bila diperlukan."
        badge={ctx.canExport ? undefined : <Badge variant="muted">Akses lihat saja</Badge>}
      />

      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm">
        <p className="font-medium">Penerimaan kas bukan keuntungan</p>
        <p className="text-muted-foreground">
          Pokok pembiayaan yang kembali adalah pengembalian modal, bukan pendapatan. Pendapatan bunga dan biaya
          administrasi dilaporkan terpisah pada Laporan Pendapatan Bunga. Rinciannya ada pada bagian «Definisi Metrik»
          di bawah.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Jenis laporan">
        {REPORTS.map((definition) => (
          <button
            key={definition.key}
            type="button"
            role="tab"
            aria-selected={report === definition.key}
            onClick={() => setReport(definition.key)}
            className={
              report === definition.key
                ? 'inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                : 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
            }
          >
            {definition.icon}
            {definition.label}
          </button>
        ))}
      </div>

      <ReportBody report={report} ctx={ctx} />

      <Card>
        <CardHeader>
          <CardTitle>Definisi Metrik</CardTitle>
          <CardDescription>
            Setiap metrik dihitung di server dengan definisi tetap berikut agar laporan konsisten dengan dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Seluruh penerimaan kas TIDAK sama dengan keuntungan.</p>
            <p className="text-muted-foreground">
              Pokok yang kembali adalah pengembalian modal. Hanya pendapatan bunga dan biaya administrasi yang
              merupakan pendapatan, dan keduanya dipisahkan dari arus kas.
            </p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {METRIC_DEFINITIONS.map((metric) => (
              <AccordionItem key={metric.key} value={metric.key}>
                <AccordionTrigger>{metric.label}</AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground">{metric.definition}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
