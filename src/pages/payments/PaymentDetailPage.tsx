/**
 * PaymentDetailPage.tsx — Detail kuitansi pembayaran.
 *
 * Halaman ini menegaskan tiga hal kepada pengguna:
 *   1. Ke cicilan dan denda mana uang dialokasikan (tabel alokasi).
 *   2. Pembatalan (reversal) TIDAK menghapus catatan asli; saldo dihitung ulang
 *      dan pembayaran yang dibatalkan tidak lagi dihitung sebagai penerimaan.
 *   3. Kuitansi dapat dicetak/di-PDF-kan lengkap dengan kop organisasi.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileText, Printer } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { DetailRow, MoneyText, PaymentMethodBadge } from '@/components/common/domain';
import { PageHeader, SummaryChip } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { PAYMENT_METHOD_LABELS } from '@/core/types';
import { useOrganization } from '@/data/admin';
import { usePayment, usePaymentAllocations, usePaymentReversal, useReversePayment } from '@/data/payments';
import type { PaymentAllocationRow, PaymentReversalRow, PaymentWithRelations } from '@/data/types';
import { formatDateTimeId, formatDateId } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { printHtml } from '@/lib/exports';
import { formatRupiah } from '@/lib/money';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function officerOf(payment: PaymentWithRelations): string {
  return payment.profiles?.full_name || payment.profiles?.email || '-';
}

function buildReceiptHtml(params: {
  organization: { name: string; address: string | null; phone: string | null; email: string | null } | null;
  payment: PaymentWithRelations;
  allocations: readonly PaymentAllocationRow[];
  reversal: PaymentReversalRow | null;
}): string {
  const { organization, payment, allocations, reversal } = params;
  const customerName = payment.credit_contracts?.customers?.full_name ?? '-';
  const customerNumber = payment.credit_contracts?.customers?.customer_number ?? '-';
  const contractNumber = payment.credit_contracts?.contract_number ?? '-';

  const rows = allocations
    .map((allocation) => {
      const installment = allocation.installments;
      return `<tr>
        <td>ke-${installment?.installment_number ?? '-'}</td>
        <td>${escapeHtml(installment?.due_date ?? '-')}</td>
        <td class="right">${escapeHtml(formatRupiah(allocation.amount))}</td>
        <td class="right">${escapeHtml(formatRupiah(allocation.penalty_amount))}</td>
        <td class="right">${escapeHtml(formatRupiah(allocation.amount + allocation.penalty_amount))}</td>
      </tr>`;
    })
    .join('');

  const totalInstallment = allocations.reduce((sum, item) => sum + item.amount, 0);
  const totalPenalty = allocations.reduce((sum, item) => sum + item.penalty_amount, 0);

  const reversalBlock =
    payment.status === 'REVERSED'
      ? `<h2>Pembatalan</h2>
         <p><strong>PEMBAYARAN INI DIBATALKAN DAN TIDAK BERLAKU SEBAGAI PENERIMAAN.</strong></p>
         <div class="grid">
           <div>Nomor pembatalan</div><div>${escapeHtml(reversal?.reversal_number ?? '-')}</div>
           <div>Alasan</div><div>${escapeHtml(reversal?.reason ?? '-')}</div>
           <div>Dibatalkan oleh</div><div>${escapeHtml(reversal?.profiles?.full_name ?? reversal?.profiles?.email ?? '-')}</div>
           <div>Waktu pembatalan</div><div>${escapeHtml(formatDateTimeId(reversal?.created_at))}</div>
         </div>`
      : '';

  return `
    <h1>${escapeHtml(organization?.name ?? 'KreditKu')}</h1>
    <p class="muted">${escapeHtml(organization?.address ?? '')}${
      organization?.phone ? ` • ${escapeHtml(organization.phone)}` : ''
    }${organization?.email ? ` • ${escapeHtml(organization.email)}` : ''}</p>
    <h2>Kuitansi Pembayaran</h2>
    <div class="grid">
      <div>Nomor kuitansi</div><div><strong>${escapeHtml(payment.receipt_number)}</strong></div>
      <div>Tanggal dan waktu</div><div>${escapeHtml(formatDateTimeId(payment.paid_at))}</div>
      <div>Pelanggan</div><div>${escapeHtml(customerName)} (${escapeHtml(customerNumber)})</div>
      <div>Nomor kontrak</div><div>${escapeHtml(contractNumber)}</div>
      <div>Metode pembayaran</div><div>${escapeHtml(PAYMENT_METHOD_LABELS[payment.method] ?? payment.method)}</div>
      <div>Status</div><div>${payment.status === 'POSTED' ? 'Diposting (sah)' : 'Dibatalkan'}</div>
      <div>Petugas</div><div>${escapeHtml(officerOf(payment))}</div>
      ${payment.reference ? `<div>Referensi</div><div>${escapeHtml(payment.reference)}</div>` : ''}
    </div>
    <h2>Rincian alokasi</h2>
    <table>
      <thead>
        <tr><th>Cicilan</th><th>Jatuh tempo</th><th class="right">Ke tagihan</th><th class="right">Ke denda</th><th class="right">Jumlah</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5">Tidak ada alokasi pada pembayaran ini.</td></tr>'}</tbody>
    </table>
    <p class="right"><strong>Total pembayaran: ${escapeHtml(formatRupiah(payment.amount))}</strong></p>
    <p class="muted">Alokasi: ${escapeHtml(formatRupiah(totalInstallment))} ke tagihan cicilan, ${escapeHtml(
      formatRupiah(totalPenalty),
    )} ke denda.${
      payment.unallocated > 0
        ? ` Kelebihan bayar ${escapeHtml(formatRupiah(payment.unallocated))} dicatat sebagai saldo titipan pelanggan.`
        : ''
    }</p>
    ${payment.notes ? `<p class="muted">Catatan: ${escapeHtml(payment.notes)}</p>` : ''}
    ${reversalBlock}
    <p class="footer">
      Kuitansi ini dicetak dari sistem KreditKu pada ${escapeHtml(formatDateId(new Date().toISOString().slice(0, 10)))}.
      Kuitansi hanya sah bila status pembayaran &ldquo;Diposting&rdquo;. Pembayaran yang dibatalkan tidak berlaku sebagai
      penerimaan dan tidak boleh dipakai sebagai bukti pembayaran.
    </p>
  `;
}

export default function PaymentDetailPage(): JSX.Element {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { can, organizationId } = useAuth();
  const canReverse = can('payments.reverse');

  const paymentQuery = usePayment(paymentId);
  const allocationsQuery = usePaymentAllocations(paymentId);
  const reversalQuery = usePaymentReversal(paymentId);
  const organizationQuery = useOrganization(organizationId);
  const reversePayment = useReversePayment();

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const payment = paymentQuery.data;
  const allocations = allocationsQuery.data ?? [];
  const reversal = reversalQuery.data ?? null;

  const totalInstallment = allocations.reduce((sum, item) => sum + item.amount, 0);
  const totalPenalty = allocations.reduce((sum, item) => sum + item.penalty_amount, 0);

  const handlePrint = () => {
    if (!payment) return;
    try {
      printHtml(
        `Kuitansi ${payment.receipt_number}`,
        buildReceiptHtml({
          organization: organizationQuery.data
            ? {
                name: organizationQuery.data.name,
                address: organizationQuery.data.address,
                phone: organizationQuery.data.phone,
                email: organizationQuery.data.email,
              }
            : null,
          payment,
          allocations,
          reversal,
        }),
      );
      notifySuccess('Dokumen kuitansi dibuka', 'Gunakan dialog cetak untuk menyimpan sebagai PDF.');
    } catch (error) {
      notifyError(error, 'Gagal membuka dokumen kuitansi');
    }
  };

  const handleReverse = async () => {
    if (!payment) return;
    if (reason.trim().length < 5) {
      setReasonError('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    setReasonError(null);
    try {
      const result = await reversePayment.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      notifySuccess(
        `Pembayaran dibatalkan (${result.reversal_number})`,
        'Catatan asli tetap tersimpan dan saldo cicilan sudah dihitung ulang.',
      );
      setReverseOpen(false);
      setReason('');
    } catch (error) {
      notifyError(error, 'Pembatalan gagal');
    }
  };

  if (paymentQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (paymentQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Detail Pembayaran" />
        <ErrorState message={errorMessage(paymentQuery.error)} onRetry={() => void paymentQuery.refetch()} />
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="space-y-4">
        <PageHeader title="Detail Pembayaran" />
        <EmptyState title="Pembayaran tidak ditemukan" description="Data mungkin sudah dipindahkan atau tautan tidak valid." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={payment.receipt_number}
        description={`Dibuat ${formatDateTimeId(payment.created_at)} oleh ${officerOf(payment)}.`}
        breadcrumb={
          <span>
            <Link to="/app/payments" className="text-primary hover:underline">
              Pembayaran
            </Link>{' '}
            / {payment.receipt_number}
          </span>
        }
        badge={
          payment.status === 'POSTED' ? (
            <Badge variant="success">Diposting</Badge>
          ) : (
            <Badge variant="destructive">Dibatalkan</Badge>
          )
        }
        actions={
          <>
            <Button variant="outline" onClick={handlePrint}>
              <Printer aria-hidden />
              Cetak / PDF kuitansi
            </Button>
            {payment.status === 'POSTED' && canReverse ? (
              <Button variant="destructive" onClick={() => setReverseOpen(true)}>
                <Ban aria-hidden />
                Batalkan Pembayaran
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryChip label="Nominal" value={<MoneyText value={payment.amount} strong />} />
        <SummaryChip label="Metode" value={<PaymentMethodBadge method={payment.method} />} />
        <SummaryChip label="Waktu bayar" value={<span className="tabular">{formatDateTimeId(payment.paid_at)}</span>} />
        <SummaryChip
          label="Tidak teralokasi"
          value={<MoneyText value={payment.unallocated} mutedWhenZero />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi pembayaran</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Nomor kuitansi">
                <span className="tabular">{payment.receipt_number}</span>
              </DetailRow>
              <DetailRow label="Status">
                {payment.status === 'POSTED' ? (
                  <Badge variant="success">Diposting</Badge>
                ) : (
                  <Badge variant="destructive">Dibatalkan</Badge>
                )}
              </DetailRow>
              <DetailRow label="Tanggal bayar">
                <span className="tabular">{formatDateTimeId(payment.paid_at)}</span>
              </DetailRow>
              <DetailRow label="Metode">
                <PaymentMethodBadge method={payment.method} />
              </DetailRow>
              <DetailRow label="Petugas pencatat">{officerOf(payment)}</DetailRow>
              <DetailRow label="Referensi">{payment.reference ?? '-'}</DetailRow>
              <DetailRow label="Urutan alokasi">
                {payment.allocation_order === 'OLDEST_FIRST'
                  ? 'Cicilan tertua lebih dulu'
                  : payment.allocation_order === 'NEWEST_FIRST'
                    ? 'Cicilan terbaru lebih dulu'
                    : 'Manual'}
              </DetailRow>
              <DetailRow label="Denda dilunasi lebih dulu">{payment.penalty_first ? 'Ya' : 'Tidak'}</DetailRow>
              <DetailRow label="Kunci idempotensi">
                <span className="tabular break-all text-xs text-muted-foreground">{payment.idempotency_key}</span>
              </DetailRow>
              <DetailRow label="Berkas bukti">
                {payment.proof_path ? (
                  <span className="break-all text-xs">{payment.proof_path}</span>
                ) : (
                  <span className="text-muted-foreground">Tidak ada</span>
                )}
              </DetailRow>
              <DetailRow label="Catatan">{payment.notes ?? '-'}</DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kontrak &amp; pelanggan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {payment.credit_contracts ? (
              <>
                <dl>
                  <DetailRow label="Nomor kontrak">
                    <Link
                      to={`/app/contracts/${payment.credit_contracts.id}`}
                      className="tabular text-primary hover:underline"
                    >
                      {payment.credit_contracts.contract_number}
                    </Link>
                  </DetailRow>
                  <DetailRow label="Pelanggan">
                    <Link
                      to={`/app/customers/${payment.credit_contracts.customer_id}`}
                      className="text-primary hover:underline"
                    >
                      {payment.credit_contracts.customers?.full_name ?? '-'}
                    </Link>
                  </DetailRow>
                  <DetailRow label="Nomor pelanggan">
                    <span className="tabular">{payment.credit_contracts.customers?.customer_number ?? '-'}</span>
                  </DetailRow>
                </dl>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/app/payments/new?contractId=${payment.credit_contracts.id}`}>Catat pembayaran kontrak ini</Link>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Kontrak terkait tidak dapat dimuat.</p>
            )}

            {payment.status === 'POSTED' ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Pembayaran ini berstatus Diposting sehingga dihitung sebagai penerimaan pada laporan arus kas.
              </p>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                Pembayaran ini sudah dibatalkan dan TIDAK dihitung sebagai penerimaan.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alokasi ke cicilan &amp; denda</CardTitle>
          <CardDescription>
            Setiap baris menampilkan bagian yang masuk ke tagihan cicilan dan bagian yang masuk ke denda pada cicilan
            tersebut.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {allocationsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : allocationsQuery.isError ? (
            <ErrorState message={errorMessage(allocationsQuery.error)} onRetry={() => void allocationsQuery.refetch()} />
          ) : allocations.length === 0 ? (
            <EmptyState
              title="Tidak ada alokasi"
              description="Pembayaran ini belum dialokasikan ke cicilan mana pun (misalnya seluruhnya tercatat sebagai saldo titipan)."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border scrollbar-thin">
                <table className="w-full caption-bottom text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cicilan
                      </th>
                      <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Jatuh tempo
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ke tagihan
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ke denda
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Jumlah
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((allocation) => (
                      <tr key={allocation.id} className="border-t">
                        <td className="px-3 py-2.5 tabular font-medium">
                          ke-{allocation.installments?.installment_number ?? '-'}
                        </td>
                        <td className="px-3 py-2.5 tabular">
                          {allocation.installments ? formatDateId(allocation.installments.due_date) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <MoneyText value={allocation.amount} mutedWhenZero />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <MoneyText value={allocation.penalty_amount} mutedWhenZero />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <MoneyText value={allocation.amount + allocation.penalty_amount} strong />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-muted-foreground">
                  Total ke tagihan: <MoneyText value={totalInstallment} />
                </span>
                <span className="text-muted-foreground">
                  Total ke denda: <MoneyText value={totalPenalty} />
                </span>
                <span className="text-muted-foreground">
                  Total pembayaran: <MoneyText value={payment.amount} strong />
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pembatalan pembayaran</CardTitle>
          <CardDescription>
            Pembatalan tidak menghapus catatan asli. Pembayaran tetap tersimpan sebagai riwayat dengan status
            &ldquo;Dibatalkan&rdquo;, sementara saldo cicilan dan denda dihitung ulang oleh server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {payment.status === 'REVERSED' ? (
            reversalQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="space-y-2">
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  Pembayaran ini sudah dibatalkan dan tidak lagi dihitung sebagai pendapatan maupun penerimaan kas.
                </p>
                <dl>
                  <DetailRow label="Nomor pembatalan">
                    <span className="tabular">{reversal?.reversal_number ?? '-'}</span>
                  </DetailRow>
                  <DetailRow label="Alasan">{reversal?.reason ?? '-'}</DetailRow>
                  <DetailRow label="Dibatalkan oleh">
                    {reversal?.profiles?.full_name || reversal?.profiles?.email || '-'}
                  </DetailRow>
                  <DetailRow label="Waktu pembatalan">
                    <span className="tabular">{formatDateTimeId(reversal?.created_at)}</span>
                  </DetailRow>
                </dl>
              </div>
            )
          ) : canReverse ? (
            <div className="space-y-2">
              <Button variant="destructive" onClick={() => setReverseOpen(true)}>
                <Ban aria-hidden />
                Batalkan Pembayaran
              </Button>
              <p className="text-xs text-muted-foreground">
                Gunakan hanya bila pembayaran dicatat keliru (mis. nominal salah atau uang batal diterima). Alasan
                pembatalan dicatat pada audit log.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Hanya role dengan izin membatalkan pembayaran (Admin/Super Admin) yang dapat melakukan pembatalan.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link to="/app/payments">
            <ArrowLeft aria-hidden />
            Daftar pembayaran
          </Link>
        </Button>
        <Button variant="outline" onClick={handlePrint}>
          <FileText aria-hidden />
          Cetak kuitansi
        </Button>
      </div>

      <ConfirmDialog
        open={reverseOpen}
        onOpenChange={(open) => {
          setReverseOpen(open);
          if (!open) {
            setReason('');
            setReasonError(null);
          }
        }}
        title="Batalkan pembayaran ini?"
        description="Catatan pembayaran asli tetap tersimpan dan tidak dihapus. Saldo cicilan, denda, serta status kontrak akan dihitung ulang tanpa pembayaran ini."
        confirmLabel="Batalkan pembayaran"
        cancelLabel="Tidak jadi"
        destructive
        loading={reversePayment.isPending}
        onConfirm={() => void handleReverse()}
      >
        <div className="space-y-1.5">
          <label htmlFor="reversal-reason" className="text-sm font-medium">
            Alasan pembatalan (wajib, minimal 5 karakter)
          </label>
          <Textarea
            id="reversal-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Contoh: pembayaran ganda, uang dikembalikan ke pelanggan."
            aria-invalid={Boolean(reasonError)}
          />
          {reasonError ? <p className="text-xs font-medium text-destructive">{reasonError}</p> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
