/**
 * ContractDetailPage.tsx — Detail kontrak kredit: ringkasan kewajiban, jadwal
 * cicilan, pembayaran, amandemen, dan snapshot dokumen.
 *
 * Prinsip yang ditampilkan jelas kepada pengguna:
 *   * Kontrak hanya berstatus LUNAS (PAID_OFF) bila SELURUH kewajiban
 *     (pokok + bunga + biaya) telah terselesaikan — bukan karena satu cicilan
 *     terbayar.
 *   * Pembatalan kontrak DITOLAK server bila sudah ada pembayaran.
 *   * Jadwal tidak dapat dibangun ulang (rebuild) bila sudah ada pembayaran.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Ban, CircleAlert, FileDown, Pencil, Printer, Wallet } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader, SummaryChip } from '@/components/layout/AppShell';
import {
  ContractStatusBadge,
  DateText,
  DetailRow,
  InstallmentStatusBadge,
  MoneyText,
  PaymentMethodBadge,
  PenaltyStatusBadge,
} from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { useAmendContract, useCancelContract, useCancelInstallment, useContract, useContractAmendments, useContractInstallments, type AmendmentRow } from '@/data/credit';
import { useContractPayments } from '@/data/payments';
import { useCustomer } from '@/data/customers';
import { useOrganization } from '@/data/admin';
import type {
  ContractSummaryRow,
  CustomerSummaryRow,
  InstallmentDetailRow,
  OrganizationRow,
  PaymentWithRelations,
} from '@/data/types';
import {
  CONTRACT_STATUS_LABELS,
  INTEREST_METHOD_LABELS,
  PAYMENT_FREQUENCY_LABELS,
  RATE_BASES,
  RATE_BASIS_LABELS,
  type AdminFeePosition,
  type DueDateAdjustment,
} from '@/core/types';
import { contractAmendmentSchema } from '@/core/validation';
import { todayIso } from '@/data/client';
import { exportPdf, printHtml, type ExportColumn, type ExportMeta } from '@/lib/exports';
import { formatDateId, formatDateShortId, formatDateTimeId } from '@/lib/date';
import { bpToPercent, formatRupiah, formatRupiahNumber } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Label,
  NumberInput,
  OptionsSelect,
  PercentInput,
  Progress,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';

const ADMIN_FEE_POSITION_LABELS: Record<AdminFeePosition, string> = {
  UPFRONT: 'Dibayar di Muka',
  FIRST_INSTALLMENT: 'Digabung ke Cicilan Pertama',
  SPREAD: 'Dibagi ke Seluruh Cicilan',
};

const DUE_DATE_ADJUSTMENT_LABELS: Record<DueDateAdjustment, string> = {
  NONE: 'Tanpa Penyesuaian',
  PREVIOUS_BUSINESS_DAY: 'Mundur ke Hari Kerja Sebelumnya',
  NEXT_BUSINESS_DAY: 'Maju ke Hari Kerja Berikutnya',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  POSTED: 'Tercatat',
  REVERSED: 'Dibatalkan',
};

const AUTOMATIC_AMENDMENT_FIELDS: readonly string[] = ['updated_at', 'created_at', 'snapshot', 'status'];

/** Baris jadwal untuk ekspor PDF. */
type SchedulePdfRow = {
  nomor: number;
  jatuhTempo: string;
  pokok: string;
  bunga: string;
  biaya: string;
  total: string;
  terbayar: string;
  sisa: string;
  status: string;
};

const SCHEDULE_PDF_COLUMNS: readonly ExportColumn<SchedulePdfRow>[] = [
  { key: 'nomor', header: 'No', width: 8, align: 'right' },
  { key: 'jatuhTempo', header: 'Jatuh Tempo', width: 20 },
  { key: 'pokok', header: 'Pokok (Rp)', width: 18, align: 'right' },
  { key: 'bunga', header: 'Bunga (Rp)', width: 16, align: 'right' },
  { key: 'biaya', header: 'Biaya (Rp)', width: 14, align: 'right' },
  { key: 'total', header: 'Total (Rp)', width: 18, align: 'right' },
  { key: 'terbayar', header: 'Terbayar (Rp)', width: 18, align: 'right' },
  { key: 'sisa', header: 'Sisa (Rp)', width: 18, align: 'right' },
  { key: 'status', header: 'Status', width: 18 },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRate(rateBp: number, rateBasis: string): string {
  const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(bpToPercent(rateBp));
  const basisLabel = RATE_BASIS_LABELS[rateBasis as keyof typeof RATE_BASIS_LABELS] ?? rateBasis;
  return `${percent}% ${basisLabel}`;
}

/** Nilai snapshot menjadi teks yang mudah dibaca (tanpa menampilkan objek mentah). */
function formatSnapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'number') {
    return /amount|fee|payable|principal|interest|penalty|paid|outstanding|price|down_payment|total/.test(key)
      ? formatRupiah(Math.round(value))
      : String(value);
  }
  if (typeof value === 'string') return value.length > 0 ? value : '-';
  return JSON.stringify(value);
}

/** Dokumen kontrak siap cetak (Bahasa Indonesia). */
function buildContractDocument(params: {
  organization: OrganizationRow | undefined;
  contract: ContractSummaryRow;
  customer: CustomerSummaryRow | undefined;
  installments: readonly InstallmentDetailRow[];
  printedAt: string;
}): string {
  const { organization, contract, customer, installments, printedAt } = params;

  const rows = installments
    .filter((row) => row.status !== 'CANCELLED')
    .map(
      (row) => `<tr>
      <td class="right">${row.installment_number}</td>
      <td>${escapeHtml(formatDateShortId(row.due_date))}</td>
      <td class="right">${escapeHtml(formatRupiah(row.principal))}</td>
      <td class="right">${escapeHtml(formatRupiah(row.interest))}</td>
      <td class="right">${escapeHtml(formatRupiah(row.fees))}</td>
      <td class="right">${escapeHtml(formatRupiah(row.total_due))}</td>
    </tr>`,
    )
    .join('');

  return `
  <h1>Perjanjian Kredit</h1>
  <p class="muted">Nomor kontrak: <strong>${escapeHtml(contract.contract_number)}</strong> • Tanggal kontrak: ${escapeHtml(
    formatDateId(contract.contract_date),
  )}</p>

  <h2>Identitas Usaha</h2>
  <div class="grid">
    <div>Nama usaha</div><div><strong>${escapeHtml(organization?.name ?? '-')}</strong></div>
    <div>Kode organisasi</div><div>${escapeHtml(organization?.code ?? '-')}</div>
    <div>Alamat</div><div>${escapeHtml(organization?.address ?? '-')}</div>
    <div>Telepon</div><div>${escapeHtml(organization?.phone ?? '-')}</div>
    <div>Email</div><div>${escapeHtml(organization?.email ?? '-')}</div>
  </div>

  <h2>Identitas Pelanggan</h2>
  <div class="grid">
    <div>Nama</div><div><strong>${escapeHtml(customer?.full_name ?? contract.customer_name)}</strong></div>
    <div>Nomor pelanggan</div><div>${escapeHtml(customer?.customer_number ?? contract.customer_number)}</div>
    <div>Nomor identitas</div><div>${escapeHtml(customer?.identity_number ?? '-')}</div>
    <div>Telepon</div><div>${escapeHtml(customer?.phone ?? contract.customer_phone)}</div>
    <div>Alamat</div><div>${escapeHtml(customer?.address ?? '-')}</div>
  </div>

  <h2>Rincian Pembiayaan</h2>
  <div class="grid">
    <div>Harga barang</div><div>${escapeHtml(formatRupiah(contract.price))}</div>
    <div>Uang muka</div><div>${escapeHtml(formatRupiah(contract.down_payment))}</div>
    <div>Pokok pembiayaan</div><div>${escapeHtml(formatRupiah(contract.principal))}</div>
    <div>Tenor</div><div>${contract.tenor} periode (${escapeHtml(PAYMENT_FREQUENCY_LABELS[contract.frequency])})</div>
    <div>Metode bunga</div><div>${escapeHtml(INTEREST_METHOD_LABELS[contract.method])}</div>
    <div>Tarif</div><div>${escapeHtml(formatRate(contract.rate_bp, contract.rate_basis))}</div>
    <div>Biaya administrasi</div><div>${escapeHtml(formatRupiah(contract.admin_fee))} (${escapeHtml(
      ADMIN_FEE_POSITION_LABELS[contract.admin_fee_position],
    )})</div>
    <div>Biaya lain per periode</div><div>${escapeHtml(formatRupiah(contract.other_fee_per_period))}</div>
    <div>Total bunga</div><div>${escapeHtml(formatRupiah(contract.total_interest))}</div>
    <div>Total biaya</div><div>${escapeHtml(formatRupiah(contract.total_fees))}</div>
    <div>Total kewajiban</div><div><strong>${escapeHtml(formatRupiah(contract.total_payable))}</strong></div>
    <div>Tanggal pencairan</div><div>${escapeHtml(contract.disbursement_date ? formatDateId(contract.disbursement_date) : '-')}</div>
    <div>Cicilan pertama</div><div>${escapeHtml(formatDateId(contract.first_due_date))}</div>
    <div>Penyesuaian jatuh tempo</div><div>${escapeHtml(DUE_DATE_ADJUSTMENT_LABELS[contract.due_date_adjustment])}</div>
  </div>

  <h2>Jadwal Cicilan</h2>
  <table>
    <thead>
      <tr>
        <th>No</th><th>Jatuh Tempo</th><th class="right">Pokok</th><th class="right">Bunga</th>
        <th class="right">Biaya</th><th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">Belum ada jadwal cicilan.</td></tr>'}</tbody>
  </table>

  <div class="footer">
    <div class="grid" style="margin-top:24px;">
      <div>Pihak Pertama (Pemberi Pembiayaan)</div>
      <div>Pihak Kedua (Penerima Pembiayaan)</div>
      <div style="margin-top:64px;">__________________________</div>
      <div style="margin-top:64px;">__________________________</div>
      <div>${escapeHtml(organization?.name ?? '-')}</div>
      <div>${escapeHtml(customer?.full_name ?? contract.customer_name)}</div>
    </div>
    <p style="margin-top:24px;">Dokumen ini dihasilkan otomatis oleh sistem pada ${escapeHtml(
      formatDateId(printedAt),
    )} dan sah tanpa tanda tangan basah sepanjang tidak dinyatakan lain.</p>
  </div>`;
}

export default function ContractDetailPage(): JSX.Element {
  return (
    <RequirePermission permission="contracts.view">
      <ContractDetailContent />
    </RequirePermission>
  );
}

function ContractDetailContent(): JSX.Element {
  const navigate = useNavigate();
  const { contractId } = useParams<{ contractId: string }>();
  const { can, organizationId } = useAuth();

  const contractQuery = useContract(contractId);
  const installmentsQuery = useContractInstallments(contractId);
  const paymentsQuery = useContractPayments(contractId);
  const amendmentsQuery = useContractAmendments(contractId);
  const organizationQuery = useOrganization(organizationId);

  const contract = contractQuery.data;
  const customerQuery = useCustomer(contract?.customer_id);

  const cancelContract = useCancelContract();
  const cancelInstallment = useCancelInstallment();

  const [amendOpen, setAmendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [installmentTarget, setInstallmentTarget] = useState<InstallmentDetailRow | null>(null);
  const [installmentReason, setInstallmentReason] = useState('');
  const [installmentError, setInstallmentError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const canAmend = can('contracts.amend');
  const canCancel = can('contracts.cancel');
  const canManageInstallments = can('installments.manage');

  const installments = useMemo(
    () => (installmentsQuery.data ?? []).filter((row) => row.status !== 'CANCELLED'),
    [installmentsQuery.data],
  );
  const payments = paymentsQuery.data ?? [];
  const hasPayments = payments.length > 0;

  const scheduleRows = useMemo<SchedulePdfRow[]>(
    () =>
      installments.map((row) => ({
        nomor: row.installment_number,
        jatuhTempo: formatDateShortId(row.due_date),
        pokok: formatRupiahNumber(row.principal),
        bunga: formatRupiahNumber(row.interest),
        biaya: formatRupiahNumber(row.fees),
        total: formatRupiahNumber(row.total_due),
        terbayar: formatRupiahNumber(row.paid_amount),
        sisa: formatRupiahNumber(Math.max(0, row.outstanding)),
        status: row.status,
      })),
    [installments],
  );

  if (contractQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (contractQuery.error) {
    return (
      <ErrorState
        title="Detail kontrak gagal dimuat"
        message={errorMessage(contractQuery.error)}
        onRetry={() => void contractQuery.refetch()}
      />
    );
  }

  if (!contract) {
    return (
      <EmptyState
        title="Kontrak tidak ditemukan"
        description="Data kontrak tidak tersedia atau bukan milik organisasi Anda."
        action={
          <Button asChild>
            <Link to="/app/contracts">Kembali ke daftar kontrak</Link>
          </Button>
        }
      />
    );
  }

  const customer = customerQuery.data ?? undefined;
  const paidInstallments = installments.filter((row) => row.status === 'PAID').length;
  const outstandingFromSchedule = installments.reduce((total, row) => total + Math.max(0, row.outstanding), 0);
  const penaltyOutstanding = installments.reduce((total, row) => total + Math.max(0, row.penalty_outstanding), 0);
  const progressPercent = contract.progress_percent;

  const handlePrint = (): void => {
    try {
      printHtml(
        `Kontrak ${contract.contract_number}`,
        buildContractDocument({
          organization: organizationQuery.data,
          contract,
          customer,
          installments,
          printedAt: todayIso(),
        }),
      );
    } catch (error) {
      notifyError(error, 'Cetak kontrak gagal');
    }
  };

  const handleExportSchedulePdf = async (): Promise<void> => {
    if (scheduleRows.length === 0) return;
    setExportingPdf(true);
    const meta: ExportMeta = {
      filename: `jadwal-cicilan-${contract.contract_number}`,
      title: `Jadwal Cicilan Kontrak ${contract.contract_number}`,
      subtitle: `${contract.customer_name} • Pokok ${formatRupiah(contract.principal)} • Total kewajiban ${formatRupiah(
        contract.total_payable,
      )}`,
    };
    try {
      await exportPdf(scheduleRows, SCHEDULE_PDF_COLUMNS, meta);
    } catch (error) {
      notifyError(error, 'Ekspor jadwal PDF gagal');
    } finally {
      setExportingPdf(false);
    }
  };

  const submitCancelContract = (): void => {
    const reason = cancelReason.trim();
    if (reason.length < 5) {
      setCancelError('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    if (hasPayments) {
      setCancelError('Kontrak tidak dapat dibatalkan karena sudah memiliki pembayaran.');
      return;
    }
    cancelContract.mutate(
      { contractId: contract.id, reason },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
          setCancelError(null);
          notifySuccess('Kontrak dibatalkan', 'Seluruh piutang kontrak ini tidak lagi ditagihkan.');
        },
        onError: (error) => notifyError(error, 'Pembatalan kontrak gagal'),
      },
    );
  };

  const submitCancelInstallment = (): void => {
    if (!installmentTarget) return;
    const reason = installmentReason.trim();
    if (reason.length < 5) {
      setInstallmentError('Alasan pembatalan cicilan wajib diisi minimal 5 karakter.');
      return;
    }
    cancelInstallment.mutate(
      { installmentId: installmentTarget.id, reason },
      {
        onSuccess: () => {
          setInstallmentTarget(null);
          setInstallmentReason('');
          setInstallmentError(null);
          notifySuccess('Cicilan dibatalkan', `Cicilan ke-${installmentTarget.installment_number} dibatalkan.`);
        },
        onError: (error) => notifyError(error, 'Pembatalan cicilan gagal'),
      },
    );
  };

  const scheduleColumns: readonly Column<InstallmentDetailRow>[] = [
    {
      key: 'installment_number',
      header: 'No',
      align: 'right',
      accessor: (row) => row.installment_number,
      cell: (row) => <span className="tabular">{row.installment_number}</span>,
    },
    {
      key: 'due_date',
      header: 'Jatuh Tempo',
      accessor: (row) => row.due_date,
      cell: (row) => <DateText value={row.due_date} />,
    },
    {
      key: 'principal',
      header: 'Pokok',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.principal,
      cell: (row) => <MoneyText value={row.principal} />,
    },
    {
      key: 'interest',
      header: 'Bunga',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.interest,
      cell: (row) => <MoneyText value={row.interest} />,
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
      cell: (row) => <MoneyText value={row.total_due} strong />,
    },
    {
      key: 'paid_amount',
      header: 'Terbayar',
      align: 'right',
      accessor: (row) => row.paid_amount,
      cell: (row) => <MoneyText value={row.paid_amount} mutedWhenZero />,
    },
    {
      key: 'outstanding',
      header: 'Sisa',
      align: 'right',
      accessor: (row) => row.outstanding,
      cell: (row) => <MoneyText value={Math.max(0, row.outstanding)} mutedWhenZero strong />,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => <InstallmentStatusBadge status={row.status} />,
    },
    {
      key: 'penalty',
      header: 'Denda',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.penalty_outstanding,
      cell: (row) =>
        row.penalty_status ? (
          <div className="flex flex-col items-end gap-1">
            <MoneyText value={row.penalty_outstanding} mutedWhenZero />
            <PenaltyStatusBadge status={row.penalty_status} />
          </div>
        ) : (
          <MoneyText value={row.penalty_outstanding} mutedWhenZero />
        ),
    },
    {
      key: 'late_days',
      header: 'Terlambat',
      align: 'right',
      accessor: (row) => row.late_days,
      cell: (row) =>
        row.late_days > 0 ? (
          <span className="tabular font-medium text-destructive">{row.late_days} hari</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      cell: (row) => {
        const cancellable = row.status !== 'PAID' && row.status !== 'CANCELLED';
        return (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={!cancellable || !canManageInstallments}
            onClick={() => {
              setInstallmentTarget(row);
              setInstallmentReason('');
              setInstallmentError(null);
            }}
          >
            <Ban aria-hidden />
            Batal
          </Button>
        );
      },
    },
  ];

  const paymentColumns: readonly Column<PaymentWithRelations>[] = [
    {
      key: 'receipt_number',
      header: 'Kuitansi',
      accessor: (row) => row.receipt_number,
      cell: (row) => <span className="font-medium">{row.receipt_number}</span>,
    },
    {
      key: 'paid_at',
      header: 'Waktu',
      accessor: (row) => row.paid_at,
      cell: (row) => <span className="tabular">{formatDateTimeId(row.paid_at)}</span>,
    },
    {
      key: 'method',
      header: 'Metode',
      hideOnMobile: true,
      accessor: (row) => row.method,
      cell: (row) => <PaymentMethodBadge method={row.method} />,
    },
    {
      key: 'amount',
      header: 'Jumlah',
      align: 'right',
      accessor: (row) => row.amount,
      cell: (row) => <MoneyText value={row.amount} strong />,
    },
    {
      key: 'unallocated',
      header: 'Belum Teralokasi',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.unallocated,
      cell: (row) => (
        <MoneyText value={row.unallocated} mutedWhenZero className={row.unallocated > 0 ? 'text-warning' : undefined} />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => (
        <span className={row.status === 'REVERSED' ? 'text-destructive' : 'text-muted-foreground'}>
          {PAYMENT_STATUS_LABELS[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: 'created_by',
      header: 'Dicatat oleh',
      hideOnMobile: true,
      accessor: (row) => row.profiles?.full_name ?? '',
      cell: (row) => <span className="truncate">{row.profiles?.full_name ?? 'Sistem'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={`Kontrak ${contract.contract_number}`}
        description={`${contract.customer_name} • ${INTEREST_METHOD_LABELS[contract.method]} • ${contract.tenor} periode ${
          PAYMENT_FREQUENCY_LABELS[contract.frequency]
        }`}
        badge={<ContractStatusBadge status={contract.status} />}
        breadcrumb={
          <Link to="/app/contracts" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Kembali ke daftar kontrak
          </Link>
        }
        actions={
          <>
            <Button variant="outline" onClick={handlePrint}>
              <Printer aria-hidden />
              Cetak Kontrak
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleExportSchedulePdf()}
              loading={exportingPdf}
              disabled={scheduleRows.length === 0}
            >
              <FileDown aria-hidden />
              Ekspor PDF
            </Button>
            <Button asChild>
              <Link to={`/app/payments/new?contractId=${contract.id}`}>
                <Wallet aria-hidden />
                Catat Pembayaran
              </Link>
            </Button>
            {canAmend ? (
              <Button variant="outline" onClick={() => setAmendOpen(true)}>
                <Pencil aria-hidden />
                Amandemen
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={hasPayments}
                title={hasPayments ? 'Kontrak dengan pembayaran tidak dapat dibatalkan.' : undefined}
                onClick={() => {
                  setCancelReason('');
                  setCancelError(null);
                  setCancelOpen(true);
                }}
              >
                <Ban aria-hidden />
                Batalkan Kontrak
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryChip label="Total kewajiban" value={<MoneyText value={contract.total_payable} strong />} />
            <SummaryChip label="Terbayar" value={<MoneyText value={contract.total_paid} />} />
            <SummaryChip label="Sisa piutang" value={<MoneyText value={contract.outstanding} strong />} />
            <SummaryChip label="Denda terbuka" value={<MoneyText value={penaltyOutstanding} mutedWhenZero />} />
            <SummaryChip
              label="Cicilan lunas"
              value={<span className="tabular">{`${paidInstallments} / ${installments.length}`}</span>}
            />
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Progres pembayaran:{' '}
                <span className="tabular font-medium text-foreground">
                  {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(progressPercent)}%
                </span>
              </span>
              <span className="text-muted-foreground">
                Jatuh tempo berikutnya: <DateText value={contract.next_due_date} fallback="Tidak ada tagihan" />
                {contract.max_days_late > 0 ? (
                  <span className="ml-2 font-medium text-destructive">Tunggakan {contract.max_days_late} hari</span>
                ) : null}
              </span>
            </div>
            <Progress value={progressPercent} label={`Progres pembayaran kontrak ${contract.contract_number}`} />
          </div>

          <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
            Kontrak berstatus <strong>Lunas (PAID_OFF)</strong> hanya setelah SELURUH kewajiban (pokok + bunga + biaya)
            terselesaikan — bukan karena satu cicilan terbayar. Status kontrak saat ini:{' '}
            <strong>{CONTRACT_STATUS_LABELS[contract.status]}</strong>.
          </p>

          {contract.status === 'PAID_OFF' && outstandingFromSchedule > 0 ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Status kontrak tercatat lunas, tetapi jadwal masih menunjukkan sisa piutang {formatRupiah(outstandingFromSchedule)}.
              Periksa kembali data pembayaran atau cicilan yang dibatalkan.
            </p>
          ) : null}

          {hasPayments ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Kontrak ini sudah memiliki {payments.length} pembayaran tercatat. Pembatalan kontrak akan DITOLAK dan
              jadwal tidak dapat dibangun ulang melalui amandemen.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Tabs defaultValue="schedule" className="w-full">
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="schedule">Jadwal Cicilan</TabsTrigger>
              <TabsTrigger value="payments">Pembayaran</TabsTrigger>
              <TabsTrigger value="amendments">Amandemen</TabsTrigger>
              <TabsTrigger value="documents">Snapshot/Dokumen</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="schedule">
            <Card>
              <CardHeader>
                <CardTitle>Jadwal Cicilan</CardTitle>
                <CardDescription>
                  Cicilan berstatus Lunas berarti tagihannya sudah habis; sisa piutang kontrak dihitung dari seluruh
                  cicilan aktif.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={installments}
                  columns={scheduleColumns}
                  getRowId={(row) => row.id}
                  loading={installmentsQuery.isPending}
                  error={installmentsQuery.error}
                  onRetry={() => void installmentsQuery.refetch()}
                  searchPlaceholder="Cari jatuh tempo / status"
                  initialPageSize={20}
                  emptyTitle="Belum ada jadwal cicilan"
                  emptyDescription="Jadwal dibuat otomatis saat kontrak diterbitkan dari pengajuan yang disetujui."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle>Pembayaran</CardTitle>
                <CardDescription>
                  Seluruh pembayaran kontrak ini. Pembayaran berstatus Dibatalkan (reversal) tidak mengurangi piutang.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={payments}
                  columns={paymentColumns}
                  getRowId={(row) => row.id}
                  loading={paymentsQuery.isPending}
                  error={paymentsQuery.error}
                  onRetry={() => void paymentsQuery.refetch()}
                  searchPlaceholder="Cari nomor kuitansi / referensi"
                  initialPageSize={20}
                  emptyTitle="Belum ada pembayaran"
                  emptyDescription="Catat pembayaran untuk mengurangi sisa piutang kontrak ini."
                  emptyAction={
                    <Button asChild>
                      <Link to={`/app/payments/new?contractId=${contract.id}`}>Catat Pembayaran</Link>
                    </Button>
                  }
                  onRowClick={(row) => navigate(`/app/payments/${row.id}`)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="amendments">
            <Card>
              <CardHeader>
                <CardTitle>Riwayat Amandemen</CardTitle>
                <CardDescription>
                  Amandemen mengubah tenor, tarif, dan tanggal jatuh tempo pertama. Jadwal hanya dibangun ulang bila
                  belum ada pembayaran.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {amendmentsQuery.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : amendmentsQuery.error ? (
                  <ErrorState
                    title="Riwayat amandemen gagal dimuat"
                    message={errorMessage(amendmentsQuery.error)}
                    onRetry={() => void amendmentsQuery.refetch()}
                  />
                ) : (amendmentsQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada amandemen pada kontrak ini.</p>
                ) : (
                  <ol className="space-y-3">
                    {(amendmentsQuery.data ?? []).map((amendment) => (
                      <li key={amendment.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            Berlaku sejak <DateText value={amendment.effective_from} />
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTimeId(amendment.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm">{amendment.reason}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {amendment.schedule_rebuilt
                            ? 'Jadwal cicilan dibangun ulang pada amandemen ini.'
                            : 'Jadwal cicilan tidak dibangun ulang (menyesuaikan kondisi kontrak).'}
                        </p>
                        <AmendmentDiff amendment={amendment} />
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>Snapshot/Dokumen</CardTitle>
                <CardDescription>
                  Snapshot adalah salinan parameter kontrak pada saat dokumen diterbitkan; dipakai untuk audit bila
                  pengaturan organisasi berubah.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-1 text-sm font-medium">Data kontrak</p>
                  <dl className="grid gap-x-6 sm:grid-cols-2">
                    <DetailRow label="Nomor kontrak">{contract.contract_number}</DetailRow>
                    <DetailRow label="Tanggal kontrak">
                      <DateText value={contract.contract_date} />
                    </DetailRow>
                    <DetailRow label="Tanggal pencairan">
                      <DateText value={contract.disbursement_date} />
                    </DetailRow>
                    <DetailRow label="Cicilan pertama">
                      <DateText value={contract.first_due_date} />
                    </DetailRow>
                    <DetailRow label="Pembayaran terakhir">
                      <span className="tabular">{formatDateTimeId(contract.last_payment_date)}</span>
                    </DetailRow>
                    <DetailRow label="Dibuat pada">
                      <span className="tabular">{formatDateTimeId(contract.created_at)}</span>
                    </DetailRow>
                    <DetailRow label="Direstrukturisasi">
                      <span className="tabular">{formatDateTimeId(contract.restructured_at)}</span>
                    </DetailRow>
                    <DetailRow label="Dibatalkan">
                      <span className="tabular">{formatDateTimeId(contract.cancelled_at)}</span>
                    </DetailRow>
                    <DetailRow label="Alasan pembatalan" className="sm:col-span-2">
                      {contract.cancel_reason ? contract.cancel_reason : <span className="text-muted-foreground">-</span>}
                    </DetailRow>
                    <DetailRow label="Catatan" className="sm:col-span-2">
                      {contract.notes ? contract.notes : <span className="text-muted-foreground">Tanpa catatan.</span>}
                    </DetailRow>
                    <DetailRow label="Pengajuan asal">
                      {contract.application_id ? (
                        <Link
                          to={`/app/applications/${contract.application_id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Lihat pengajuan
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Kontrak tidak berasal dari pengajuan.</span>
                      )}
                    </DetailRow>
                  </dl>
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium">Snapshot parameter</p>
                  {Object.keys(contract.snapshot ?? {}).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Snapshot tidak tersedia untuk kontrak ini.</p>
                  ) : (
                    <dl className="grid gap-x-6 sm:grid-cols-2">
                      {Object.entries(contract.snapshot)
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([key, value]) => (
                          <DetailRow key={key} label={key.replace(/_/g, ' ')}>
                            <span className="tabular break-all">{formatSnapshotValue(key, value)}</span>
                          </DetailRow>
                        ))}
                    </dl>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rincian Pembiayaan</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1">
                <DetailRow label="Pelanggan">
                  <Link
                    to={`/app/customers/${contract.customer_id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {contract.customer_name}
                  </Link>
                </DetailRow>
                <DetailRow label="Nomor pelanggan">{contract.customer_number}</DetailRow>
                <DetailRow label="Telepon">{contract.customer_phone}</DetailRow>
                <DetailRow label="Harga barang">
                  <MoneyText value={contract.price} />
                </DetailRow>
                <DetailRow label="Uang muka">
                  <MoneyText value={contract.down_payment} />
                </DetailRow>
                <DetailRow label="Pokok pembiayaan">
                  <MoneyText value={contract.principal} strong />
                </DetailRow>
                <DetailRow label="Tenor">
                  {contract.tenor} periode {PAYMENT_FREQUENCY_LABELS[contract.frequency]}
                </DetailRow>
                <DetailRow label="Metode bunga">{INTEREST_METHOD_LABELS[contract.method]}</DetailRow>
                <DetailRow label="Tarif">
                  {contract.method === 'NONE' ? 'Tanpa bunga' : formatRate(contract.rate_bp, contract.rate_basis)}
                </DetailRow>
                <DetailRow label="Total bunga">
                  <MoneyText value={contract.total_interest} />
                </DetailRow>
                <DetailRow label="Total biaya">
                  <MoneyText value={contract.total_fees} />
                </DetailRow>
                <DetailRow label="Dibayar di muka">
                  <MoneyText value={contract.upfront_amount} mutedWhenZero />
                </DetailRow>
                <DetailRow label="Total kewajiban">
                  <MoneyText value={contract.total_payable} strong />
                </DetailRow>
                <DetailRow label="Biaya administrasi">
                  <MoneyText value={contract.admin_fee} mutedWhenZero />
                </DetailRow>
                <DetailRow label="Posisi biaya admin">{ADMIN_FEE_POSITION_LABELS[contract.admin_fee_position]}</DetailRow>
                <DetailRow label="Penyesuaian jatuh tempo">
                  {DUE_DATE_ADJUSTMENT_LABELS[contract.due_date_adjustment]}
                </DetailRow>
                <DetailRow label="Tunggakan saat ini">
                  <MoneyText value={contract.overdue_amount} mutedWhenZero strong />
                </DetailRow>
                <DetailRow label="Cicilan menunggak">{contract.overdue_installments} periode</DetailRow>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Seluruh nilai dihitung dari jadwal cicilan aktif (cicilan yang dibatalkan tidak dihitung).
              </p>
            </CardContent>
          </Card>

          {!canAmend && !canCancel && !canManageInstallments ? (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                Role Anda hanya dapat melihat data kontrak ini. Hubungi administrator untuk perubahan kontrak atau
                pembatalan cicilan.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {amendOpen ? (
        <AmendmentDialog contract={contract} hasPayments={hasPayments} onClose={() => setAmendOpen(false)} />
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) {
            setCancelReason('');
            setCancelError(null);
          }
        }}
        title="Batalkan kontrak?"
        description={`Kontrak ${contract.contract_number} akan berstatus Dibatalkan dan sisa piutangnya tidak lagi ditagihkan. Pembatalan DITOLAK server bila kontrak sudah memiliki pembayaran.`}
        confirmLabel="Batalkan kontrak"
        destructive
        loading={cancelContract.isPending}
        onConfirm={submitCancelContract}
      >
        <FormField label="Alasan pembatalan" htmlFor="contract-cancel-reason" required error={cancelError}>
          <Textarea
            id="contract-cancel-reason"
            rows={3}
            value={cancelReason}
            onChange={(event) => {
              setCancelReason(event.target.value);
              if (cancelError) setCancelError(null);
            }}
            aria-invalid={cancelError !== null}
          />
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={installmentTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstallmentTarget(null);
            setInstallmentReason('');
            setInstallmentError(null);
          }
        }}
        title="Batalkan cicilan?"
        description={
          installmentTarget
            ? `Cicilan ke-${installmentTarget.installment_number} (jatuh tempo ${formatDateShortId(
                installmentTarget.due_date,
              )}, tagihan ${formatRupiah(installmentTarget.total_due)}) akan dibatalkan dan tidak ditagihkan lagi. Cicilan yang sudah dibayar tidak dapat dibatalkan.`
            : ''
        }
        confirmLabel="Batalkan cicilan"
        destructive
        loading={cancelInstallment.isPending}
        onConfirm={submitCancelInstallment}
      >
        <FormField label="Alasan pembatalan" htmlFor="installment-cancel-reason" required error={installmentError}>
          <Textarea
            id="installment-cancel-reason"
            rows={3}
            value={installmentReason}
            onChange={(event) => {
              setInstallmentReason(event.target.value);
              if (installmentError) setInstallmentError(null);
            }}
            aria-invalid={installmentError !== null}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

/** Perbandingan nilai sebelum/sesudah amandemen (hanya field yang berubah). */
function AmendmentDiff({ amendment }: { amendment: AmendmentRow }): JSX.Element | null {
  const changed = useMemo(() => {
    const before: Record<string, unknown> = amendment.before_snapshot ?? {};
    const after: Record<string, unknown> = amendment.after_snapshot ?? {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
      (key) => !AUTOMATIC_AMENDMENT_FIELDS.includes(key),
    );
    return keys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => ({
        key,
        before: formatSnapshotValue(key, before[key]),
        after: formatSnapshotValue(key, after[key]),
      }));
  }, [amendment.after_snapshot, amendment.before_snapshot]);

  if (changed.length === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">Tidak ada perubahan parameter yang tercatat.</p>;
  }

  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
      {changed.slice(0, 12).map((item) => (
        <li key={item.key}>
          <span className="font-medium text-foreground">{item.key.replace(/_/g, ' ')}</span>: {item.before} →{' '}
          {item.after}
        </li>
      ))}
      {changed.length > 12 ? <li>{changed.length - 12} perubahan lain tidak ditampilkan.</li> : null}
    </ul>
  );
}

const amendmentFormSchema = contractAmendmentSchema.omit({ contractId: true }).extend({ rebuildSchedule: z.boolean() });
type AmendmentFormValues = z.infer<typeof amendmentFormSchema>;

/** Dialog amandemen kontrak (tenor, tarif, jadwal). */
function AmendmentDialog({
  contract,
  hasPayments,
  onClose,
}: {
  contract: ContractSummaryRow;
  hasPayments: boolean;
  onClose: () => void;
}): JSX.Element {
  const amendContract = useAmendContract();

  const form = useForm<AmendmentFormValues>({
    resolver: zodResolver(amendmentFormSchema),
    defaultValues: {
      reason: '',
      newTenor: contract.tenor,
      newRateBp: contract.rate_bp,
      newRateBasis: contract.rate_basis,
      newFirstDueDate: contract.first_due_date,
      effectiveFrom: todayIso(),
      rebuildSchedule: !hasPayments,
    },
  });

  const { control, formState, handleSubmit, register } = form;
  const errors = formState.errors;

  const onSubmit = (values: AmendmentFormValues): void => {
    amendContract.mutate(
      {
        contractId: contract.id,
        reason: values.reason.trim(),
        newTenor: values.newTenor,
        newRateBp: values.newRateBp,
        newRateBasis: values.newRateBasis,
        newFirstDueDate: values.newFirstDueDate,
        effectiveFrom: values.effectiveFrom,
        rebuildSchedule: hasPayments ? false : values.rebuildSchedule,
      },
      {
        onSuccess: () => {
          notifySuccess('Amandemen tersimpan', 'Perubahan kontrak tercatat pada riwayat amandemen.');
          onClose();
        },
        onError: (error) => notifyError(error, 'Amandemen kontrak gagal'),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Amandemen kontrak {contract.contract_number}</DialogTitle>
          <DialogDescription>
            Amandemen mengubah tenor, tarif, dan tanggal jatuh tempo pertama. Perubahan berlaku sejak tanggal yang
            dipilih dan tercatat pada audit log.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            label="Alasan amandemen"
            htmlFor="amendment-reason"
            required
            error={errors.reason?.message}
            hint="Minimal 10 karakter; wajib untuk jejak audit."
          >
            <Textarea
              id="amendment-reason"
              rows={3}
              placeholder="Contoh: penyesuaian kemampuan bayar pelanggan setelah musim sepi."
              aria-invalid={Boolean(errors.reason)}
              {...register('reason')}
            />
          </FormField>

          <FormGrid>
            <FormField label="Tenor baru (periode)" htmlFor="amendment-tenor" required error={errors.newTenor?.message}>
              <Controller
                control={control}
                name="newTenor"
                render={({ field }) => (
                  <NumberInput
                    id="amendment-tenor"
                    value={field.value}
                    onChange={(value) => field.onChange(value === null ? 0 : value)}
                    min={1}
                    max={600}
                    aria-invalid={Boolean(errors.newTenor)}
                  />
                )}
              />
            </FormField>

            <FormField label="Tarif baru" htmlFor="amendment-rate" required error={errors.newRateBp?.message}>
              <Controller
                control={control}
                name="newRateBp"
                render={({ field }) => (
                  <PercentInput
                    id="amendment-rate"
                    valueBp={field.value}
                    onChangeBp={field.onChange}
                    maxPercent={100}
                    aria-invalid={Boolean(errors.newRateBp)}
                  />
                )}
              />
            </FormField>

            <FormField label="Basis tarif baru" htmlFor="amendment-rate-basis" required error={errors.newRateBasis?.message}>
              <Controller
                control={control}
                name="newRateBasis"
                render={({ field }) => (
                  <OptionsSelect
                    id="amendment-rate-basis"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={RATE_BASES.map((basis) => ({ value: basis, label: RATE_BASIS_LABELS[basis] }))}
                  />
                )}
              />
            </FormField>

            <FormField
              label="Jatuh tempo pertama baru"
              htmlFor="amendment-first-due"
              required
              error={errors.newFirstDueDate?.message}
            >
              <Controller
                control={control}
                name="newFirstDueDate"
                render={({ field }) => (
                  <DateInput
                    id="amendment-first-due"
                    value={field.value ?? null}
                    onChange={(value) => field.onChange(value === null ? '' : value)}
                    aria-invalid={Boolean(errors.newFirstDueDate)}
                  />
                )}
              />
            </FormField>

            <FormField label="Berlaku sejak" htmlFor="amendment-effective-from" required error={errors.effectiveFrom?.message}>
              <Controller
                control={control}
                name="effectiveFrom"
                render={({ field }) => (
                  <DateInput
                    id="amendment-effective-from"
                    value={field.value ?? null}
                    onChange={(value) => field.onChange(value === null ? '' : value)}
                    aria-invalid={Boolean(errors.effectiveFrom)}
                  />
                )}
              />
            </FormField>
          </FormGrid>

          <Controller
            control={control}
            name="rebuildSchedule"
            render={({ field }) => (
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="amendment-rebuild"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  disabled={hasPayments}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="amendment-rebuild" className="cursor-pointer">
                    Bangun ulang jadwal cicilan
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {hasPayments
                      ? 'Tidak dapat diaktifkan karena kontrak ini sudah memiliki pembayaran. Jadwal yang sudah dibayar tidak boleh dibangun ulang agar alokasi pembayaran tetap sah.'
                      : 'Bila dicentang, seluruh jadwal lama diganti jadwal baru sesuai tenor dan tarif baru. Bila tidak dicentang, jadwal lama dipertahankan.'}
                  </p>
                </div>
              </div>
            )}
          />

          {amendContract.error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage(amendContract.error)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={amendContract.isPending}>
              Batal
            </Button>
            <Button type="submit" loading={amendContract.isPending}>
              Simpan amandemen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
