/**
 * QrisReviewCard.tsx — Antrean tinjauan pembayaran QRIS.
 *
 * Muncul di halaman Pembayaran HANYA bila ada yang perlu ditinjau, supaya tidak
 * menambah kebisingan pada hari yang tenang. Isinya dua jenis:
 *
 *   1. Konfirmasi notifikasi yang tidak dapat dicocokkan otomatis. Sistem tidak
 *      menebak karena nominal yang sama pada dua tagihan tidak dapat dipastikan
 *      milik siapa; kasir yang memilih tagihannya.
 *   2. Permintaan berstatus tinjauan yang perlu ditegaskan sudah dibayar atau
 *      tidak.
 *
 * Yang penting: aksi di sini TIDAK menetapkan nominal. Nominalnya diambil dari
 * permintaan yang sudah tersimpan di server, sehingga pilihan kasir hanya
 * menentukan tagihan MANA yang dimaksud — bukan berapa yang dicatat. Karena itu
 * keputusan kasir tidak dapat membuat jumlah uang yang masuk berubah.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Separator,
  Skeleton,
} from '@/components/ui';
import { MoneyText } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/auth/AuthProvider';
import {
  useCandidateRequests,
  useConfirmQrisRequestManual,
  useDismissQrisConfirmation,
  useDismissQrisRequest,
  useResolveQrisConfirmation,
  useReviewRequests,
  useUnresolvedConfirmations,
  type ReviewRequest,
  type UnresolvedConfirmation,
} from '@/data/qrisReview';

type Pilihan =
  | { readonly jenis: 'konfirmasi'; readonly baris: UnresolvedConfirmation }
  | { readonly jenis: 'permintaan'; readonly baris: ReviewRequest }
  | null;

const SEBAB: Record<string, string> = {
  AMBIGU: 'Nominal ini cocok dengan lebih dari satu tagihan',
  TIDAK_COCOK: 'Tidak ada tagihan terbuka dengan nominal ini',
  NOMINAL_TIDAK_TERBACA: 'Nominal tidak terbaca dari teks notifikasi',
  GAGAL_CATAT: 'Pencatatan otomatis gagal',
  BUKAN_QRIS: 'Teks tidak dikenali sebagai notifikasi QRIS',
};

function formatWaktu(value: string): string {
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function Baris({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex w-full items-start justify-between gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function DialogKonfirmasi({
  baris,
  onClose,
}: {
  readonly baris: UnresolvedConfirmation;
  readonly onClose: () => void;
}): JSX.Element {
  const kandidat = useCandidateRequests(baris.amount);
  const resolve = useResolveQrisConfirmation();
  const dismiss = useDismissQrisConfirmation();
  const [dipilih, setDipilih] = useState<string | null>(null);
  const [catatan, setCatatan] = useState('');
  const [alasan, setAlasan] = useState('');
  const [modusAbaikan, setModusAbaikan] = useState(false);

  const daftar = kandidat.data ?? [];
  const harusPilih = daftar.length > 0 && !modusAbaikan;

  const catat = async (): Promise<void> => {
    if (!dipilih) return;
    try {
      const hasil = await resolve.mutateAsync({ confirmationId: baris.id, requestId: dipilih, note: catatan });
      if (hasil.status === 'DIBAYAR') {
        notifySuccess('Pembayaran tercatat', `Kuitansi ${hasil.receipt_number ?? '-'}.`);
        onClose();
      } else {
        notifyError(
          new Error(hasil.alasan ?? 'Permintaan tidak dapat dicatat.'),
          'Pembayaran belum tercatat',
        );
      }
    } catch (error) {
      notifyError(error, 'Gagal mencatat pembayaran');
    }
  };

  const abaikan = async (): Promise<void> => {
    try {
      await dismiss.mutateAsync({ confirmationId: baris.id, reason: alasan });
      notifySuccess('Konfirmasi diabaikan', 'Tidak ada pembayaran yang dicatat dari notifikasi ini.');
      onClose();
    } catch (error) {
      notifyError(error, 'Gagal mengabaikan konfirmasi');
    }
  };

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1 rounded-md border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Teks notifikasi yang diterima</p>
          <p className="font-mono text-xs">{baris.raw_text ?? '(kosong)'}</p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Nominal yang terbaca</span>
          {baris.amount === null ? (
            <Badge variant="warning">Tidak terbaca</Badge>
          ) : (
            <MoneyText value={baris.amount} strong />
          )}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Diterima</span>
          <span className="text-xs">{formatWaktu(baris.created_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Sebab</span>
          <span className="text-right text-xs">{SEBAB[baris.outcome] ?? baris.outcome}</span>
        </div>
        {baris.detail ? <p className="text-xs text-muted-foreground">{baris.detail}</p> : null}
      </div>

      {!modusAbaikan ? (
        <>
          <Separator />

          <div className="space-y-2">
            {/* Judul hanya muncul bila memang ada yang dapat dipilih; menampilkan
                ajakan memilih di atas peringatan "nominal tidak terbaca" membuat
                kasir mencari pilihan yang tidak ada. */}
            {baris.amount !== null ? (
              <p className="text-sm font-medium">Pilih tagihan yang dimaksud</p>
            ) : null}

            {baris.amount === null ? (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                Nominalnya tidak terbaca, sehingga tagihan tidak dapat dicocokkan dari sini. Catat pembayarannya
                lewat formulir pembayaran biasa, lalu abaikan notifikasi ini.
              </p>
            ) : kandidat.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : kandidat.isError ? (
              <p className="text-sm text-destructive">Daftar tagihan gagal dimuat. {errorMessage(kandidat.error)}</p>
            ) : daftar.length === 0 ? (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                Tidak ada tagihan terbuka dengan nominal ini. Kemungkinan permintaannya sudah kedaluwarsa atau sudah
                dibayar; catat lewat formulir pembayaran bila uangnya memang masuk.
              </p>
            ) : (
              <div className="space-y-2">
                {daftar.map((kandidatBaris) => {
                  const terpilih = dipilih === kandidatBaris.id;
                  return (
                    <button
                      key={kandidatBaris.id}
                      type="button"
                      aria-pressed={terpilih}
                      onClick={() => setDipilih(kandidatBaris.id)}
                      className={`flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors ${
                        terpilih ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">
                          {kandidatBaris.credit_contracts?.customers?.full_name ?? 'Pelanggan tidak diketahui'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {kandidatBaris.credit_contracts?.customers?.customer_number ?? '-'} · kontrak{' '}
                          {kandidatBaris.credit_contracts?.contract_number ?? '-'}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{kandidatBaris.reference}</p>
                      </div>
                      <div className="text-right">
                        <MoneyText value={kandidatBaris.amount} strong />
                        {terpilih ? <CheckCircle2 className="ml-auto mt-1 h-4 w-4 text-primary" aria-hidden /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {daftar.length > 0 ? (
              <Input
                value={catatan}
                onChange={(event) => setCatatan(event.target.value)}
                placeholder="Catatan, mis. cocok dengan mutasi bank"
                aria-label="Catatan penyelesaian"
              />
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">Alasan mengabaikan</p>
            <Input
              value={alasan}
              onChange={(event) => setAlasan(event.target.value)}
              placeholder="mis. bukan pembayaran QRIS usaha ini"
              aria-label="Alasan mengabaikan"
            />
            <p className="text-xs text-muted-foreground">
              Tidak ada pembayaran yang dicatat. Notifikasi tetap tersimpan beserta alasan ini.
            </p>
          </div>
        </>
      )}

      <DialogFooter>
        {modusAbaikan ? (
          <>
            <Button variant="ghost" onClick={() => setModusAbaikan(false)}>
              Batal
            </Button>
            <Button
              variant="outline"
              loading={dismiss.isPending}
              disabled={alasan.trim().length === 0}
              onClick={() => void abaikan()}
            >
              Abaikan konfirmasi
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setModusAbaikan(true)}>
              Abaikan
            </Button>
            <Button loading={resolve.isPending} disabled={!harusPilih || !dipilih} onClick={() => void catat()}>
              Catat pembayaran
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

function DialogPermintaan({
  baris,
  onClose,
}: {
  readonly baris: ReviewRequest;
  readonly onClose: () => void;
}): JSX.Element {
  const konfirmasi = useConfirmQrisRequestManual();
  const dismiss = useDismissQrisRequest();
  const [catatan, setCatatan] = useState('');
  const [alasan, setAlasan] = useState('');
  const [modusAbaikan, setModusAbaikan] = useState(false);

  const catat = async (): Promise<void> => {
    try {
      const hasil = await konfirmasi.mutateAsync({ requestId: baris.id, note: catatan });
      if (hasil.status === 'DIBAYAR') {
        notifySuccess('Pembayaran tercatat', `Kuitansi ${hasil.receipt_number ?? '-'}.`);
        onClose();
      } else {
        notifyError(new Error(hasil.alasan ?? 'Permintaan tidak dapat dicatat.'), 'Pembayaran belum tercatat');
      }
    } catch (error) {
      notifyError(error, 'Gagal mencatat pembayaran');
    }
  };

  const abaikan = async (): Promise<void> => {
    try {
      await dismiss.mutateAsync({ requestId: baris.id, reason: alasan });
      notifySuccess('Permintaan dibatalkan', 'Tidak ada pembayaran yang dicatat untuk permintaan ini.');
      onClose();
    } catch (error) {
      notifyError(error, 'Gagal membatalkan permintaan');
    }
  };

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Nominal</span>
          <MoneyText value={baris.amount} strong />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pelanggan</span>
          <span className="text-right text-sm">
            {baris.credit_contracts?.customers?.full_name ?? '-'}
            <span className="block text-xs text-muted-foreground">
              {baris.credit_contracts?.customers?.customer_number ?? '-'} · kontrak{' '}
              {baris.credit_contracts?.contract_number ?? '-'}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Referensi</span>
          <span className="font-mono text-xs">{baris.reference}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Dibuat</span>
          <span className="text-xs">{formatWaktu(baris.created_at)}</span>
        </div>
        {baris.note ? (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium">Catatan sistem</p>
            <p className="text-muted-foreground">{baris.note}</p>
          </div>
        ) : null}
      </div>

      <Separator />

      {modusAbaikan ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Alasan membatalkan</p>
          <Input
            value={alasan}
            onChange={(event) => setAlasan(event.target.value)}
            placeholder="mis. pelanggan membayar tunai"
            aria-label="Alasan membatalkan permintaan"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">Tegaskan pembayaran</p>
          <Input
            value={catatan}
            onChange={(event) => setCatatan(event.target.value)}
            placeholder="Catatan, mis. dicek dari mutasi bank"
            aria-label="Catatan pencatatan"
          />
          <p className="text-xs text-muted-foreground">
            Nominal diambil dari permintaan yang tersimpan, bukan diketik di sini — Anda hanya menegaskan bahwa uangnya
            memang sudah masuk.
          </p>
        </div>
      )}

      <DialogFooter>
        {modusAbaikan ? (
          <>
            <Button variant="ghost" onClick={() => setModusAbaikan(false)}>
              Batal
            </Button>
            <Button
              variant="outline"
              loading={dismiss.isPending}
              disabled={alasan.trim().length === 0}
              onClick={() => void abaikan()}
            >
              Batalkan permintaan
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setModusAbaikan(true)}>
              Abaikan
            </Button>
            <Button loading={konfirmasi.isPending} onClick={() => void catat()}>
              Catat pembayaran
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

export function QrisReviewCard(): JSX.Element | null {
  const { can } = useAuth();
  const konfirmasi = useUnresolvedConfirmations();
  const permintaan = useReviewRequests();
  const [pilihan, setPilihan] = useState<Pilihan>(null);

  const bolehTinjau = can('payments.create');
  const daftarKonfirmasi = konfirmasi.data ?? [];
  const daftarPermintaan = permintaan.data ?? [];
  const jumlah = daftarKonfirmasi.length + daftarPermintaan.length;

  // Tanpa kewenangan mencatat pembayaran, antrean ini tidak dapat ditindaklanjuti
  // — menampilkannya hanya menimbulkan pertanyaan tanpa jalan keluar.
  if (!bolehTinjau) return null;
  if (konfirmasi.isLoading || permintaan.isLoading) return null;
  if (jumlah === 0) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileWarning className="h-4 w-4 text-warning" aria-hidden />
          Perlu ditinjau ({jumlah})
        </CardTitle>
        <CardDescription>
          Pembayaran yang belum dapat dicatat otomatis. Pilih tagihan yang benar agar uangnya masuk ke kontrak yang
          tepat.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {daftarKonfirmasi.map((baris) => (
          <Baris key={baris.id} onClick={() => setPilihan({ jenis: 'konfirmasi', baris })}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="warning">Notifikasi bank</Badge>
                {baris.amount === null ? (
                  <span className="text-xs text-muted-foreground">nominal tidak terbaca</span>
                ) : (
                  <MoneyText value={baris.amount} strong />
                )}
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{baris.raw_text}</p>
              <p className="text-xs text-muted-foreground">{formatWaktu(baris.created_at)}</p>
            </div>
          </Baris>
        ))}

        {daftarPermintaan.map((baris) => (
          <Baris key={baris.id} onClick={() => setPilihan({ jenis: 'permintaan', baris })}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="warning">Permintaan pelanggan</Badge>
                <MoneyText value={baris.amount} strong />
              </div>
              <p className="text-xs text-muted-foreground">
                {baris.credit_contracts?.customers?.full_name ?? '-'} · {baris.reference}
              </p>
              <p className="text-xs text-muted-foreground">{formatWaktu(baris.created_at)}</p>
            </div>
          </Baris>
        ))}

        {jumlah > 0 && daftarKonfirmasi.length === 0 && daftarPermintaan.length === 0 ? (
          <EmptyState
            icon={<RefreshCw className="h-5 w-5" aria-hidden />}
            title="Tidak ada yang perlu ditinjau"
            description="Antrean kosong."
          />
        ) : null}
      </CardContent>

      <Dialog open={Boolean(pilihan)} onOpenChange={(open) => (open ? undefined : setPilihan(null))}>
        <DialogContent size="default" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              {pilihan?.jenis === 'konfirmasi' ? 'Tinjau notifikasi pembayaran' : 'Tinjau permintaan pembayaran'}
            </DialogTitle>
            <DialogDescription>
              {pilihan?.jenis === 'konfirmasi'
                ? 'Sistem tidak menebak tagihan mana yang dimaksud. Pilih yang benar setelah mencocokkan dengan mutasi bank.'
                : 'Tegaskan apakah permintaan ini sudah dibayar, atau batalkan bila tidak.'}
            </DialogDescription>
          </DialogHeader>

          {pilihan?.jenis === 'konfirmasi' ? (
            <DialogKonfirmasi baris={pilihan.baris} onClose={() => setPilihan(null)} />
          ) : null}
          {pilihan?.jenis === 'permintaan' ? (
            <DialogPermintaan baris={pilihan.baris} onClose={() => setPilihan(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
