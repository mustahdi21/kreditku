/**
 * QrisPaymentDialog.tsx — Menampilkan QR pembayaran untuk satu cicilan.
 *
 * ALUR
 *   1. Permintaan pembayaran dibuat di server; nominal dihitung server dari
 *      tagihan yang benar-benar terbuka, bukan dikirim dari sini.
 *   2. QR statis merchant diubah menjadi dinamis dengan nominal itu, sehingga
 *      pelanggan tidak perlu mengetik jumlahnya sendiri.
 *   3. Pelanggan memindai QR tersebut, atau menyimpan gambarnya lalu membukanya
 *      di aplikasi bank — portal ini biasanya dibuka dari ponsel yang sama, jadi
 *      tombol simpan gambar bukan sekadar pelengkap.
 *
 * Yang TIDAK dilakukan di sini: mencatat pembayaran. Pencatatan terjadi ketika
 * notifikasi pembayaran masuk dan dicocokkan server (Edge Function qris-confirm),
 * atau ketika kasir mencatatnya manual. Dialog ini hanya menampilkan tagihan.
 */

import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { AlertTriangle, Check, Copy, Download, RefreshCw } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
  Spinner,
} from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import {
  buildPaymentQrPayload,
  formatRupiah,
  useCreateQrisRequest,
  useMerchantQris,
  type QrisRequestResult,
} from '@/data/portal';

interface QrisPaymentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly contractId: string;
  readonly installmentId: string;
  readonly installmentLabel: string;
}

function formatExpiry(value: string): string {
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function QrisPaymentDialog({
  open,
  onOpenChange,
  contractId,
  installmentId,
  installmentLabel,
}: QrisPaymentDialogProps): JSX.Element {
  const merchant = useMerchantQris();
  const createRequest = useCreateQrisRequest();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [permintaan, setPermintaan] = useState<QrisRequestResult | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [tersalin, setTersalin] = useState(false);

  const muatPermintaan = async (): Promise<void> => {
    setGalat(null);
    try {
      const hasil = await createRequest.mutateAsync({ contractId, installmentId });
      setPermintaan(hasil);
    } catch (error) {
      setGalat(errorMessage(error));
    }
  };

  useEffect(() => {
    if (!open) {
      setPermintaan(null);
      setGalat(null);
      setTersalin(false);
      return;
    }
    void muatPermintaan();
    // Permintaan dibuat sekali setiap dialog dibuka; menutup dialog tidak
    // membatalkannya, sehingga QR yang sudah ditampilkan tetap dapat dibayar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contractId, installmentId]);

  let payloadQr: string | null = null;
  let galatQr: string | null = null;
  if (permintaan && merchant.data?.payload) {
    try {
      payloadQr = buildPaymentQrPayload(merchant.data.payload, permintaan.amount);
    } catch (error) {
      galatQr = errorMessage(error);
    }
  }

  const simpanGambar = (): void => {
    const canvas = canvasRef.current;
    if (!canvas || !permintaan) return;
    const tautan = document.createElement('a');
    tautan.href = canvas.toDataURL('image/png');
    tautan.download = `qris-${permintaan.reference}.png`;
    tautan.click();
  };

  const salinReferensi = async (): Promise<void> => {
    if (!permintaan) return;
    try {
      await navigator.clipboard.writeText(permintaan.reference);
      setTersalin(true);
      window.setTimeout(() => setTersalin(false), 2000);
    } catch {
      setTersalin(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>Bayar cicilan {installmentLabel}</DialogTitle>
          <DialogDescription>
            Pindai QR di bawah dengan aplikasi bank atau dompet digital Anda. Nominalnya sudah terisi otomatis.
          </DialogDescription>
        </DialogHeader>

        {galat ? (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Permintaan pembayaran gagal dibuat
            </p>
            <p className="text-muted-foreground">{galat}</p>
            <Button variant="outline" size="sm" onClick={() => void muatPermintaan()}>
              <RefreshCw aria-hidden />
              Coba lagi
            </Button>
          </div>
        ) : null}

        {!permintaan && !galat ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner label="Menyiapkan tagihan" />
            <p className="text-xs text-muted-foreground">Nominal sedang dihitung di server…</p>
          </div>
        ) : null}

        {galatQr ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">QR belum dapat ditampilkan</p>
            <p className="text-muted-foreground">{galatQr}</p>
            <p className="text-muted-foreground">
              Hubungi admin usaha: QRIS merchant mungkin belum diatur dengan benar pada pengaturan integrasi.
            </p>
          </div>
        ) : null}

        {permintaan && payloadQr ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-white p-3">
              <div className="mx-auto w-fit">
                <QRCodeCanvas
                  ref={canvasRef}
                  value={payloadQr}
                  size={224}
                  level="M"
                  marginSize={1}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
              </div>
            </div>

            <div className="space-y-1 text-center">
              <p className="text-2xl font-semibold tabular-nums">{formatRupiah(permintaan.amount)}</p>
              <p className="text-xs text-muted-foreground">
                Kontrak {permintaan.contract_number} · jatuh tempo {permintaan.due_date}
              </p>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Nomor referensi</span>
                <button
                  type="button"
                  onClick={() => void salinReferensi()}
                  className="flex items-center gap-1 rounded px-1 font-mono text-xs hover:bg-muted"
                  aria-label="Salin nomor referensi"
                >
                  {permintaan.reference}
                  {tersalin ? <Check className="h-3 w-3 text-success" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Berlaku sampai</span>
                <span className="text-xs">{formatExpiry(permintaan.expires_at)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="gap-2 sm:flex-1" onClick={simpanGambar}>
                <Download aria-hidden />
                Simpan gambar QR
              </Button>
              <Button variant="secondary" className="gap-2 sm:flex-1" onClick={() => void muatPermintaan()}>
                <RefreshCw aria-hidden />
                Perbarui tagihan
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Bila portal ini Anda buka dari ponsel yang sama dengan aplikasi bank, simpan gambar QR di atas lalu buka
              gambarnya dari aplikasi bank Anda. Pembayaran tercatat otomatis setelah notifikasi dari bank diterima.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
