/**
 * ApplicationDetailPage.tsx — Detail pengajuan kredit.
 *
 * Angka simulasi pada halaman ini DIHITUNG ULANG di sisi klien dari baris
 * pengajuan (`computeInterestPlan`/`simulateCredit`) dan diberi label jelas
 * sebagai "Simulasi (perhitungan pratinjau)" agar tidak disalahartikan sebagai
 * angka tersimpan. Seluruh aksi yang mengubah status dijalankan lewat RPC
 * server sehingga pembuatan kontrak + jadwal cicilan tetap transaksional.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Ban, CircleCheck, CircleX, Send } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/AppShell';
import {
  ApplicationStatusBadge,
  DateText,
  DetailRow,
  MoneyText,
  StatCard,
} from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  useApplication,
  useApplicationHistory,
  useCancelApplication,
  useDecideApplication,
  useSubmitApplication,
} from '@/data/credit';
import type { ApplicationWithRelations } from '@/data/types';
import {
  INTEREST_METHOD_LABELS,
  RATE_BASIS_LABELS,
  PAYMENT_FREQUENCY_LABELS,
  type AdminFeePosition,
  type ApplicationStatus,
  type DueDateAdjustment,
} from '@/core/types';
import { describeInterestMethod, simulateCredit, type SimulationSummary } from '@/core/interest';
import { formatDateTimeId } from '@/lib/date';
import { bpToPercent, formatRupiah } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Skeleton,
  Textarea,
} from '@/components/ui';

const DECIDABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'];
const CANCELLABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'];

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

function formatRate(rateBp: number, rateBasis: string): string {
  const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(bpToPercent(rateBp));
  const basisLabel = RATE_BASIS_LABELS[rateBasis as keyof typeof RATE_BASIS_LABELS] ?? rateBasis;
  return `${percent}% ${basisLabel}`;
}

/** Menghitung ulang pratinjau dari baris pengajuan; null bila data tidak konsisten. */
function buildSimulation(application: ApplicationWithRelations): SimulationSummary | null {
  try {
    return simulateCredit({
      price: application.price,
      downPayment: application.down_payment,
      tenor: application.tenor,
      method: application.method,
      rateBp: application.rate_bp,
      rateBasis: application.rate_basis,
      frequency: application.frequency,
      adminFee: application.admin_fee,
      adminFeePosition: application.admin_fee_position,
      otherFeePerPeriod: application.other_fee_per_period,
    });
  } catch (error) {
    console.error('[KreditKu] perhitungan pratinjau pengajuan gagal:', error);
    return null;
  }
}

export default function ApplicationDetailPage(): JSX.Element {
  return (
    <RequirePermission permission="applications.view">
      <ApplicationDetailContent />
    </RequirePermission>
  );
}

function ApplicationDetailContent(): JSX.Element {
  const { applicationId } = useParams<{ applicationId: string }>();
  const { can } = useAuth();

  const application = useApplication(applicationId);
  const history = useApplicationHistory(applicationId);
  const submitApplication = useSubmitApplication();
  const decideApplication = useDecideApplication();
  const cancelApplication = useCancelApplication();

  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reason, setReason] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [createdContract, setCreatedContract] = useState<{ id: string; number: string } | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const canManage = can('applications.manage');
  const canDecide = can('applications.decide');

  if (application.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (application.error) {
    return (
      <ErrorState
        title="Detail pengajuan gagal dimuat"
        message={errorMessage(application.error)}
        onRetry={() => void application.refetch()}
      />
    );
  }

  const app = application.data;
  if (!app) {
    return (
      <EmptyState
        title="Pengajuan tidak ditemukan"
        description="Data pengajuan tidak tersedia atau sudah dihapus."
        action={
          <Button asChild>
            <Link to="/app/applications">Kembali ke daftar pengajuan</Link>
          </Button>
        }
      />
    );
  }

  const simulation = buildSimulation(app);
  const decisionEntry = (history.data ?? []).find((entry) => entry.to_status === app.status && entry.profiles);
  const decidedByLabel = decisionEntry?.profiles?.full_name ?? app.decided_by ?? '-';

  const openDecision = (value: 'APPROVED' | 'REJECTED'): void => {
    setDecision(value);
    setReason('');
    setContractNumber('');
    setReasonError(null);
    setDecisionOpen(true);
  };

  const submitDecision = (): void => {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      setReasonError('Alasan keputusan wajib diisi minimal 5 karakter.');
      return;
    }
    decideApplication.mutate(
      {
        applicationId: app.id,
        decision,
        reason: trimmedReason,
        contractNumber: contractNumber.trim() ? contractNumber.trim() : null,
      },
      {
        onSuccess: (result) => {
          setDecisionOpen(false);
          setReason('');
          setContractNumber('');
          setReasonError(null);
          if (decision === 'APPROVED') {
            if (result.contract_id) {
              setCreatedContract({ id: result.contract_id, number: result.contract_number ?? '' });
            }
            notifySuccess(
              'Pengajuan disetujui',
              result.contract_number
                ? `Kontrak ${result.contract_number} beserta jadwal cicilan telah dibuat.`
                : 'Kontrak beserta jadwal cicilan telah dibuat.',
            );
          } else {
            notifySuccess('Pengajuan ditolak', 'Pengajuan ditolak tanpa membuat jadwal cicilan.');
          }
        },
        onError: (error) => notifyError(error, 'Keputusan pengajuan gagal disimpan'),
      },
    );
  };

  const submitCancel = (): void => {
    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 5) {
      setCancelError('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    cancelApplication.mutate(
      { applicationId: app.id, reason: trimmedReason },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
          setCancelError(null);
          notifySuccess('Pengajuan dibatalkan', 'Jadwal cicilan tidak dibuat untuk pengajuan yang dibatalkan.');
        },
        onError: (error) => notifyError(error, 'Pembatalan pengajuan gagal'),
      },
    );
  };

  return (
    <>
      <PageHeader
        title={`Pengajuan ${app.application_number}`}
        description={`${app.credit_type} • diajukan ${formatDateTimeId(app.created_at)}`}
        badge={<ApplicationStatusBadge status={app.status} />}
        breadcrumb={
          <Link to="/app/applications" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Kembali ke daftar pengajuan
          </Link>
        }
        actions={
          <>
            {canManage && app.status === 'DRAFT' ? (
              <Button
                variant="outline"
                loading={submitApplication.isPending}
                onClick={() =>
                  submitApplication.mutate(
                    { applicationId: app.id },
                    {
                      onSuccess: () => notifySuccess('Pengajuan diajukan', 'Status berubah menjadi Diajukan.'),
                      onError: (error) => notifyError(error, 'Pengajuan gagal diajukan'),
                    },
                  )
                }
              >
                <Send aria-hidden />
                Ajukan
              </Button>
            ) : null}

            {canDecide && DECIDABLE_STATUSES.includes(app.status) ? (
              <>
                <Button variant="outline" className="text-destructive" onClick={() => openDecision('REJECTED')}>
                  <CircleX aria-hidden />
                  Tolak
                </Button>
                <Button onClick={() => openDecision('APPROVED')}>
                  <CircleCheck aria-hidden />
                  Setujui
                </Button>
              </>
            ) : null}

            {canManage && CANCELLABLE_STATUSES.includes(app.status) ? (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  setCancelReason('');
                  setCancelError(null);
                  setCancelOpen(true);
                }}
              >
                <Ban aria-hidden />
                Batalkan
              </Button>
            ) : null}
          </>
        }
      />

      {createdContract ? (
        <Card className="mb-4 border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-5">
            <p className="text-sm">
              Kontrak berhasil dibuat{createdContract.number ? `: ${createdContract.number}` : ''}. Jadwal cicilan sudah
              tersedia pada halaman kontrak.
            </p>
            <Button asChild>
              <Link to={`/app/contracts/${createdContract.id}`}>Buka kontrak</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rincian Pengajuan</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                <DetailRow label="Nomor pengajuan">{app.application_number}</DetailRow>
                <DetailRow label="Pelanggan">
                  <Link to={`/app/customers/${app.customer_id}`} className="text-primary underline-offset-4 hover:underline">
                    {app.customers?.full_name ?? 'Pelanggan tidak ditemukan'}
                  </Link>
                </DetailRow>
                <DetailRow label="Nomor pelanggan">{app.customers?.customer_number ?? '-'}</DetailRow>
                <DetailRow label="Telepon">{app.customers?.phone ?? '-'}</DetailRow>
                <DetailRow label="Jenis kredit">{app.credit_type}</DetailRow>
                <DetailRow label="Produk">{app.credit_products?.name ?? 'Tanpa produk'}</DetailRow>
                <DetailRow label="Harga barang">
                  <MoneyText value={app.price} />
                </DetailRow>
                <DetailRow label="Uang muka">
                  <MoneyText value={app.down_payment} />
                </DetailRow>
                <DetailRow label="Pokok pembiayaan">
                  <MoneyText value={app.principal} strong />
                </DetailRow>
                <DetailRow label="Tenor">{app.tenor} periode</DetailRow>
                <DetailRow label="Metode bunga">{INTEREST_METHOD_LABELS[app.method]}</DetailRow>
                <DetailRow label="Tarif">
                  {app.method === 'NONE' ? 'Tanpa bunga' : formatRate(app.rate_bp, app.rate_basis)}
                </DetailRow>
                <DetailRow label="Frekuensi">{PAYMENT_FREQUENCY_LABELS[app.frequency]}</DetailRow>
                <DetailRow label="Biaya administrasi">
                  <MoneyText value={app.admin_fee} mutedWhenZero />
                </DetailRow>
                <DetailRow label="Posisi biaya admin">{ADMIN_FEE_POSITION_LABELS[app.admin_fee_position]}</DetailRow>
                <DetailRow label="Biaya lain per periode">
                  <MoneyText value={app.other_fee_per_period} mutedWhenZero />
                </DetailRow>
                <DetailRow label="Tanggal pencairan">
                  <DateText value={app.disbursement_date} />
                </DetailRow>
                <DetailRow label="Cicilan pertama">
                  <DateText value={app.first_due_date} />
                </DetailRow>
                <DetailRow label="Penyesuaian jatuh tempo">{DUE_DATE_ADJUSTMENT_LABELS[app.due_date_adjustment]}</DetailRow>
                <DetailRow label="Diajukan pada">{formatDateTimeId(app.submitted_at)}</DetailRow>
                <DetailRow label="Diputuskan pada">{formatDateTimeId(app.decided_at)}</DetailRow>
                <DetailRow label="Diputuskan oleh">{decidedByLabel}</DetailRow>
                <DetailRow label="Catatan" className="sm:col-span-2">
                  {app.notes ? app.notes : <span className="text-muted-foreground">Tanpa catatan.</span>}
                </DetailRow>
                <DetailRow label="Alasan keputusan" className="sm:col-span-2">
                  {app.decision_reason ? app.decision_reason : <span className="text-muted-foreground">Belum ada keputusan.</span>}
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat Status</CardTitle>
            </CardHeader>
            <CardContent>
              {history.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : history.error ? (
                <ErrorState
                  title="Riwayat gagal dimuat"
                  message={errorMessage(history.error)}
                  onRetry={() => void history.refetch()}
                />
              ) : (history.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada riwayat perubahan status.</p>
              ) : (
                <ol className="space-y-4">
                  {(history.data ?? []).map((entry) => (
                    <li key={entry.id} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {entry.from_status ? (
                            <>
                              <ApplicationStatusBadge status={entry.from_status} />
                              <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pengajuan dibuat</span>
                          )}
                          <ApplicationStatusBadge status={entry.to_status} />
                          <span className="text-xs text-muted-foreground">{formatDateTimeId(entry.created_at)}</span>
                        </div>
                        <p className="text-sm">{entry.note ?? 'Tanpa catatan.'}</p>
                        <p className="text-xs text-muted-foreground">
                          Oleh {entry.profiles?.full_name ?? entry.profiles?.email ?? 'Sistem'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Simulasi (perhitungan pratinjau)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {simulation ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <StatCard label="Pokok pembiayaan" value={formatRupiah(simulation.principal)} />
                    <StatCard label="Total bunga" value={formatRupiah(simulation.totalInterest)} tone="info" />
                    <StatCard label="Total kewajiban" value={formatRupiah(simulation.totalPayable)} tone="warning" />
                    <StatCard label="Estimasi cicilan" value={formatRupiah(simulation.installmentAmount)} tone="success" />
                  </div>
                  <dl className="space-y-1">
                    <DetailRow label="Biaya dalam jadwal">
                      <MoneyText value={simulation.otherFees} mutedWhenZero />
                    </DetailRow>
                    <DetailRow label="Biaya admin di muka">
                      <MoneyText value={simulation.upfrontAmount} mutedWhenZero />
                    </DetailRow>
                    <DetailRow label="Total keseluruhan">
                      <MoneyText value={simulation.totalPayable + simulation.upfrontAmount} strong />
                    </DetailRow>
                    <DetailRow label="Cicilan pertama">
                      <MoneyText value={simulation.firstInstallmentAmount} />
                    </DetailRow>
                    <DetailRow label="Cicilan terakhir">
                      <MoneyText value={simulation.lastInstallmentAmount} />
                    </DetailRow>
                  </dl>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {describeInterestMethod(simulation.method)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Angka di atas adalah perhitungan pratinjau dari data pengajuan, bukan angka tersimpan. Angka final
                    dihitung ulang server saat kontrak dibuat. Seluruh angka dibulatkan ke Rupiah penuh; periode
                    terakhir menyerap selisih pembulatan.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Pratinjau tidak dapat dihitung karena data pembiayaan pengajuan tidak konsisten.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pratinjau Angsuran</CardTitle>
            </CardHeader>
            <CardContent>
              {simulation ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="px-2 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">
                          #
                        </th>
                        <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Pokok
                        </th>
                        <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Bunga
                        </th>
                        <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulation.rows.slice(0, 12).map((row) => (
                        <tr key={row.installmentNumber} className="border-t">
                          <td className="px-2 py-1.5 tabular">{row.installmentNumber}</td>
                          <td className="px-2 py-1.5 text-right">
                            <MoneyText value={row.principal} />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <MoneyText value={row.interest} />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <MoneyText value={row.totalDue} strong />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Tidak ada jadwal pratinjau.</p>
              )}
              {simulation && simulation.rows.length > 12 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Menampilkan 12 dari {simulation.rows.length} periode. Jadwal lengkap dibuat server saat kontrak
                  diterbitkan.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status & Tindakan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Status saat ini: <ApplicationStatusBadge status={app.status} />
              </p>
              <p>
                Pengajuan hanya membuat kontrak dan jadwal cicilan ketika DISETUJUI. Pengajuan yang ditolak atau
                dibatalkan tidak pernah memiliki jadwal.
              </p>
              {!canManage && !canDecide ? (
                <p>Anda hanya dapat melihat data pengajuan ini (tanpa hak mengubah).</p>
              ) : null}
              {app.status === 'DRAFT' && !canManage ? (
                <p>Role Anda tidak dapat mengajukan pengajuan draft.</p>
              ) : null}
              {DECIDABLE_STATUSES.includes(app.status) && !canDecide ? (
                <p>Role Anda tidak memiliki hak untuk memutuskan pengajuan ini.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={decisionOpen}
        onOpenChange={(open) => {
          if (!open) setDecisionOpen(false);
        }}
      >
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>{decision === 'APPROVED' ? 'Setujui pengajuan' : 'Tolak pengajuan'}</DialogTitle>
            <DialogDescription>
              {app.application_number} • {app.customers?.full_name ?? 'Pelanggan tidak ditemukan'}
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-muted-foreground">
            {decision === 'APPROVED'
              ? 'Penyetujuan akan membuat kontrak kredit beserta JADWAL CICILAN secara otomatis dari data pengajuan ini. Nomor kontrak boleh dikosongkan agar sistem membuatnya otomatis.'
              : 'Penolakan mengubah status menjadi Ditolak dan TIDAK PERNAH membuat jadwal cicilan.'}
          </p>

          <FormField
            label="Alasan keputusan"
            htmlFor="detail-decision-reason"
            required
            error={reasonError}
            hint="Minimal 5 karakter; tercatat pada riwayat dan audit log."
          >
            <Textarea
              id="detail-decision-reason"
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              aria-invalid={reasonError !== null}
            />
          </FormField>

          <FormField label="Nomor kontrak (opsional)" htmlFor="detail-decision-contract">
            <Input
              id="detail-decision-contract"
              value={contractNumber}
              onChange={(event) => setContractNumber(event.target.value)}
              placeholder="Contoh: KRD/2026/0001"
              disabled={decision !== 'APPROVED'}
            />
          </FormField>

          {decideApplication.error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage(decideApplication.error)}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionOpen(false)} disabled={decideApplication.isPending}>
              Batal
            </Button>
            <Button
              variant={decision === 'APPROVED' ? 'default' : 'destructive'}
              onClick={submitDecision}
              loading={decideApplication.isPending}
            >
              {decision === 'APPROVED' ? 'Setujui pengajuan' : 'Tolak pengajuan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) {
            setCancelReason('');
            setCancelError(null);
          }
        }}
        title="Batalkan pengajuan?"
        description={`Pengajuan ${app.application_number} akan berstatus Dibatalkan dan tidak dapat diajukan lagi. Pembatalan tidak membuat jadwal cicilan apa pun.`}
        confirmLabel="Batalkan pengajuan"
        destructive
        loading={cancelApplication.isPending}
        onConfirm={submitCancel}
      >
        <FormField label="Alasan pembatalan" htmlFor="detail-cancel-reason" required error={cancelError}>
          <Textarea
            id="detail-cancel-reason"
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
    </>
  );
}
