/**
 * PortalHistoryPage.tsx — Riwayat pembayaran pelanggan.
 *
 * Dua bagian: pembayaran yang sudah tercatat, dan permintaan QRIS beserta
 * statusnya. Bagian kedua penting bagi pelanggan yang sudah membayar tetapi
 * tagihannya belum berubah — dari situ ia dapat melihat bahwa permintaannya
 * masih menunggu dicocokkan, bukan hilang.
 */

import { History, Receipt } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui';
import { formatRupiah, useMyPayments, useMyQrisRequests, type QrisRequestRow } from '@/data/portal';
import { PAYMENT_METHOD_LABELS } from '@/core/types';

const STATUS_LABEL: Record<QrisRequestRow['status'], string> = {
  PENDING: 'Menunggu dibayar',
  PAID: 'Sudah dibayar',
  EXPIRED: 'Kedaluwarsa',
  CANCELLED: 'Dibatalkan',
  REVIEW: 'Sedang ditinjau admin',
};

const STATUS_VARIANT: Record<QrisRequestRow['status'], 'default' | 'success' | 'warning' | 'muted'> = {
  PENDING: 'default',
  PAID: 'success',
  EXPIRED: 'muted',
  CANCELLED: 'muted',
  REVIEW: 'warning',
};

function formatTanggal(value: string | null): string {
  if (!value) return '-';
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function PortalHistoryPage(): JSX.Element {
  const payments = useMyPayments();
  const requests = useMyQrisRequests();

  if (payments.isLoading || requests.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (payments.isError || requests.isError) {
    return (
      <ErrorState
        title="Riwayat gagal dimuat"
        message="Koneksi ke server gagal. Periksa jaringan Anda lalu coba lagi."
        onRetry={() => {
          void payments.refetch();
          void requests.refetch();
        }}
      />
    );
  }

  const daftarPembayaran = payments.data ?? [];
  const daftarPermintaan = requests.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" aria-hidden />
            Pembayaran tercatat
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {daftarPembayaran.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Belum ada pembayaran yang tercatat.</p>
          ) : (
            daftarPembayaran.map((baris) => (
              <div key={baris.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium tabular-nums">{formatRupiah(baris.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTanggal(baris.paid_at)} · {PAYMENT_METHOD_LABELS[baris.method] ?? baris.method}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{baris.receipt_number}</p>
                </div>
                {baris.status === 'POSTED' ? (
                  <Badge variant="secondary" className="shrink-0">
                    Sah
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="shrink-0">
                    Dibatalkan
                  </Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" aria-hidden />
            Permintaan pembayaran QRIS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {daftarPermintaan.length === 0 ? (
            <EmptyState
              icon={<History className="h-5 w-5" aria-hidden />}
              title="Belum ada permintaan"
              description="Permintaan pembayaran akan tampil di sini setelah Anda membuka QR pembayaran."
            />
          ) : (
            daftarPermintaan.map((baris) => (
              <div key={baris.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium tabular-nums">{formatRupiah(baris.amount)}</p>
                  <p className="text-xs text-muted-foreground">Dibuat {formatTanggal(baris.created_at)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{baris.reference}</p>
                  {baris.status === 'REVIEW' ? (
                    <p className="text-xs text-muted-foreground">
                      Pembayaran Anda sedang dicocokkan admin. Bila sudah dibayar, tidak perlu mengulang.
                    </p>
                  ) : null}
                </div>
                <Badge variant={STATUS_VARIANT[baris.status]} className="shrink-0">
                  {STATUS_LABEL[baris.status]}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
