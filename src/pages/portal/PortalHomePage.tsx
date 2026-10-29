/**
 * PortalHomePage.tsx — Tagihan yang perlu dibayar pelanggan.
 *
 * Urutan yang ditampilkan sengaja mendahulukan yang sudah terlambat, lalu yang
 * paling dekat jatuh temponya, karena itu yang paling mendesak bagi pelanggan.
 * Seluruh angka berasal dari view yang sudah dihitung server; halaman ini tidak
 * menjumlahkan apa pun sendiri selain menampilkan hasilnya.
 */

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui';
import { QrisPaymentDialog } from '@/components/portal/QrisPaymentDialog';
import {
  contractOutstanding,
  formatRupiah,
  isOverdue,
  payableInstallments,
  totalOutstanding,
  useMyInstallments,
  useMyQrisRequests,
} from '@/data/portal';

interface TargetBayar {
  readonly contractId: string;
  readonly installmentId: string;
  readonly label: string;
  /** Tagihan cicilan ini, dipakai sebagai nominal awal di dialog. */
  readonly defaultAmount: number;
  /** Seluruh tagihan kontrak, menjadi batas atas yang diizinkan server. */
  readonly maxAmount: number;
}

export function PortalHomePage(): JSX.Element {
  const installments = useMyInstallments();
  const requests = useMyQrisRequests();
  const [target, setTarget] = useState<TargetBayar | null>(null);

  if (installments.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (installments.isError) {
    return (
      <ErrorState
        title="Tagihan gagal dimuat"
        message="Koneksi ke server gagal. Periksa jaringan Anda lalu coba lagi."
        onRetry={() => void installments.refetch()}
      />
    );
  }

  const semua = installments.data ?? [];
  const harusDibayar = payableInstallments(semua);
  const ringkasan = totalOutstanding(semua);
  const menunggu = (requests.data ?? []).filter((row) => row.status === 'PENDING');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Total tagihan Anda</CardDescription>
          <CardTitle className="text-3xl tabular-nums">{formatRupiah(ringkasan.total)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pokok + bunga</span>
            <span className="tabular-nums">{formatRupiah(ringkasan.pokok)}</span>
          </div>
          {ringkasan.denda > 0 ? (
            <div className="flex items-center justify-between text-destructive">
              <span>Denda keterlambatan</span>
              <span className="tabular-nums">{formatRupiah(ringkasan.denda)}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {menunggu.length > 0 ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Ada {menunggu.length} permintaan pembayaran yang belum selesai</p>
              <p className="text-muted-foreground">
                Buka kembali QR-nya lewat tombol Bayar pada cicilan yang sesuai, atau lanjutkan pembayaran yang sudah
                Anda simpan.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Cicilan yang perlu dibayar</h2>

        {harusDibayar.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
            title="Tidak ada tagihan tertunggak"
            description="Semua cicilan Anda sudah lunas. Terima kasih atas ketertiban pembayarannya."
          />
        ) : (
          harusDibayar.map((baris) => {
            const telat = isOverdue(baris);
            const total = (baris.outstanding ?? 0) + (baris.penalty_outstanding ?? 0);
            const adaPermintaan = menunggu.some((row) => row.installment_id === baris.id);
            return (
              <Card key={baris.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">Cicilan ke-{baris.installment_number}</p>
                      <p className="text-xs text-muted-foreground">
                        Jatuh tempo {baris.due_date} · kontrak {baris.contract_number}
                      </p>
                    </div>
                    {telat ? (
                      <Badge variant="destructive" className="shrink-0 gap-1">
                        <AlertCircle className="h-3 w-3" aria-hidden />
                        Terlambat {baris.late_days} hari
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        Belum dibayar
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Sisa cicilan</span>
                      <span className="tabular-nums">{formatRupiah(baris.outstanding ?? 0)}</span>
                    </div>
                    {(baris.penalty_outstanding ?? 0) > 0 ? (
                      <div className="flex items-center justify-between text-destructive">
                        <span>Denda</span>
                        <span className="tabular-nums">{formatRupiah(baris.penalty_outstanding ?? 0)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between border-t pt-1 font-medium">
                      <span>Total dibayar</span>
                      <span className="tabular-nums">{formatRupiah(total)}</span>
                    </div>
                  </div>

                  <Button
                    className="w-full gap-2"
                    onClick={() =>
                      setTarget({
                        contractId: baris.contract_id,
                        installmentId: baris.id,
                        label: String(baris.installment_number),
                        defaultAmount: total,
                        maxAmount: contractOutstanding(semua, baris.contract_id).total,
                      })
                    }
                  >
                    <Wallet aria-hidden />
                    {adaPermintaan ? 'Lihat QR pembayaran' : 'Bayar dengan QRIS'}
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {target ? (
        <QrisPaymentDialog
          open={Boolean(target)}
          onOpenChange={(open) => {
            if (!open) {
              setTarget(null);
              void requests.refetch();
            }
          }}
          contractId={target.contractId}
          installmentId={target.installmentId}
          installmentLabel={target.label}
          defaultAmount={target.defaultAmount}
          maxAmount={target.maxAmount}
        />
      ) : null}
    </div>
  );
}
