/**
 * PortalHistoryPage.tsx — Riwayat pembayaran pelanggan.
 *
 * Dua bagian: pembayaran yang sudah tercatat, dan permintaan QRIS beserta
 * statusnya. Setiap baris dapat dibuka untuk melihat rinciannya, karena daftar
 * hanya menampilkan nominal dan tanggal — sementara pertanyaan pelanggan
 * biasanya lebih dalam: "pembayaran ini dipakai untuk cicilan yang mana?" dan
 * "kenapa permintaan saya belum dianggap lunas?".
 *
 * Rinciannya muncul sebagai panel dari bawah, bukan halaman baru: portal dibuka
 * dari ponsel, dan kembali dari panel tidak menghilangkan posisi gulir daftar.
 *
 * Bagian permintaan penting bagi pelanggan yang sudah membayar tetapi tagihannya
 * belum berubah — dari situ ia melihat bahwa permintaannya masih menunggu
 * dicocokkan, bukan hilang.
 */

import { useState } from 'react';
import { ArrowDownRight, ChevronRight, History, Receipt, Wallet } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
} from '@/components/ui';
import {
  formatRupiah,
  useMyPayments,
  useMyQrisRequests,
  usePaymentAllocations,
  type QrisRequestRow,
} from '@/data/portal';
import { PAYMENT_METHOD_LABELS } from '@/core/types';
import type { PaymentRow } from '@/data/types';

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

type Terpilih =
  | { readonly jenis: 'pembayaran'; readonly baris: PaymentRow }
  | { readonly jenis: 'permintaan'; readonly baris: QrisRequestRow }
  | null;

function formatTanggal(value: string | null): string {
  if (!value) return '-';
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

/** Baris daftar yang dapat dibuka; sengaja tombol, bukan div, agar dapat diakses. */
function BarisDaftar({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex w-full items-start justify-between gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function PanelPembayaran({ baris }: { readonly baris: PaymentRow }): JSX.Element {
  const alokasi = usePaymentAllocations(baris.id);
  const dibatalkan = baris.status !== 'POSTED';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{formatRupiah(baris.amount)}</p>
        <div className="flex items-center gap-2">
          {dibatalkan ? (
            <Badge variant="destructive">Dibatalkan</Badge>
          ) : (
            <Badge variant="success">Sah</Badge>
          )}
          <span className="text-xs text-muted-foreground">{formatTanggal(baris.paid_at)}</span>
        </div>
      </div>

      <Separator />

      <div className="divide-y">
        <DetailRow label="Nomor kuitansi" value={<span className="font-mono text-xs">{baris.receipt_number}</span>} />
        <DetailRow label="Metode" value={PAYMENT_METHOD_LABELS[baris.method] ?? baris.method} />
        <DetailRow label="Referensi" value={baris.reference ?? '-'} />
        {baris.notes ? <DetailRow label="Catatan" value={baris.notes} /> : null}
        {dibatalkan && baris.reversed_at ? (
          <DetailRow
            label="Dibatalkan pada"
            value={<span className="text-destructive">{formatTanggal(baris.reversed_at)}</span>}
          />
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Pembayaran ini menutup</p>
        {alokasi.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : alokasi.isError ? (
          <p className="text-sm text-muted-foreground">Rincian alokasi gagal dimuat.</p>
        ) : (alokasi.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada alokasi. Seluruh nominal tercatat sebagai kelebihan pembayaran.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {(alokasi.data ?? []).map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-3 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm">
                    Cicilan ke-{row.installments?.installment_number ?? '-'}
                  </p>
                  {row.installments?.due_date ? (
                    <p className="text-xs text-muted-foreground">Jatuh tempo {row.installments.due_date}</p>
                  ) : null}
                  {row.penalty_amount > 0 ? (
                    <p className="text-xs text-destructive">
                      Termasuk denda {formatRupiah(row.penalty_amount)}
                    </p>
                  ) : null}
                </div>
                <span className="text-sm tabular-nums">{formatRupiah(row.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {baris.unallocated > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-sm">
          <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Kelebihan {formatRupiah(baris.unallocated)}</p>
            <p className="text-muted-foreground">
              Nominal ini belum dialokasikan ke cicilan mana pun dan tercatat sebagai saldo lebih pada kontrak Anda.
              Hubungi admin bila ingin diperhitungkan ke cicilan berikutnya.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelPermintaan({
  baris,
  pembayaran,
}: {
  readonly baris: QrisRequestRow;
  readonly pembayaran: PaymentRow | null;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{formatRupiah(baris.amount)}</p>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[baris.status]}>{STATUS_LABEL[baris.status]}</Badge>
          <span className="text-xs text-muted-foreground">{formatTanggal(baris.created_at)}</span>
        </div>
      </div>

      <Separator />

      <div className="divide-y">
        <DetailRow label="Nomor referensi" value={<span className="font-mono text-xs">{baris.reference}</span>} />
        <DetailRow label="Berlaku sampai" value={formatTanggal(baris.expires_at)} />
        {baris.paid_at ? <DetailRow label="Dibayar pada" value={formatTanggal(baris.paid_at)} /> : null}
        {baris.confirmed_via ? (
          <DetailRow
            label="Dikonfirmasi oleh"
            value={baris.confirmed_via === 'MACRODROID' ? 'Otomatis dari notifikasi bank' : baris.confirmed_via}
          />
        ) : null}
      </div>

      {baris.note ? (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Catatan sistem</p>
          <p className="text-muted-foreground">{baris.note}</p>
        </div>
      ) : null}

      {baris.status === 'REVIEW' ? (
        <p className="text-sm text-muted-foreground">
          Pembayaran Anda sudah masuk dan sedang dicocokkan admin. Bila Anda memang sudah membayar, tidak perlu
          mengulang — tagihan akan diperbarui setelah dicocokkan.
        </p>
      ) : null}

      {baris.status === 'PENDING' ? (
        <p className="text-sm text-muted-foreground">
          Permintaan ini masih menunggu pembayaran. Buka kembali QR-nya lewat tombol Bayar pada cicilan yang sesuai di
          halaman Tagihan.
        </p>
      ) : null}

      {pembayaran ? (
        <div className="space-y-1 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          <p className="font-medium">Tercatat sebagai pembayaran</p>
          <p className="text-muted-foreground">
            Kuitansi <span className="font-mono text-xs">{pembayaran.receipt_number}</span> ·{' '}
            {formatTanggal(pembayaran.paid_at)} · {formatRupiah(pembayaran.amount)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PortalHistoryPage(): JSX.Element {
  const payments = useMyPayments();
  const requests = useMyQrisRequests();
  const [terpilih, setTerpilih] = useState<Terpilih>(null);

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

  const pembayaranTertaut =
    terpilih?.jenis === 'permintaan' && terpilih.baris.payment_id
      ? (daftarPembayaran.find((row) => row.id === terpilih.baris.payment_id) ?? null)
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" aria-hidden />
            Pembayaran tercatat
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {daftarPembayaran.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Belum ada pembayaran yang tercatat.</p>
          ) : (
            daftarPembayaran.map((baris) => (
              <BarisDaftar key={baris.id} onClick={() => setTerpilih({ jenis: 'pembayaran', baris })}>
                <div className="space-y-1">
                  <p className="text-sm font-medium tabular-nums">{formatRupiah(baris.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTanggal(baris.paid_at)} · {PAYMENT_METHOD_LABELS[baris.method] ?? baris.method}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{baris.receipt_number}</p>
                </div>
              </BarisDaftar>
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
        <CardContent className="divide-y">
          {daftarPermintaan.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5" aria-hidden />}
              title="Belum ada permintaan"
              description="Permintaan pembayaran akan tampil di sini setelah Anda membuka QR pembayaran."
            />
          ) : (
            daftarPermintaan.map((baris) => (
              <BarisDaftar key={baris.id} onClick={() => setTerpilih({ jenis: 'permintaan', baris })}>
                <div className="space-y-1">
                  <p className="text-sm font-medium tabular-nums">{formatRupiah(baris.amount)}</p>
                  <p className="text-xs text-muted-foreground">Dibuat {formatTanggal(baris.created_at)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{baris.reference}</p>
                  {baris.status === 'REVIEW' ? (
                    <p className="text-xs text-muted-foreground">
                      Pembayaran Anda sedang dicocokkan admin.
                    </p>
                  ) : null}
                </div>
                <Badge variant={STATUS_VARIANT[baris.status]} className="mt-0.5 shrink-0">
                  {STATUS_LABEL[baris.status]}
                </Badge>
              </BarisDaftar>
            ))
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(terpilih)} onOpenChange={(open) => (open ? undefined : setTerpilih(null))}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-md overflow-y-auto">
          <SheetTitle className="text-base">
            {terpilih?.jenis === 'pembayaran' ? 'Rincian pembayaran' : 'Rincian permintaan pembayaran'}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Rincian lengkap beserta keterangan status dan pemecahan pembayaran.
          </SheetDescription>

          {terpilih?.jenis === 'pembayaran' ? <PanelPembayaran baris={terpilih.baris} /> : null}
          {terpilih?.jenis === 'permintaan' ? (
            <PanelPermintaan baris={terpilih.baris} pembayaran={pembayaranTertaut} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
