/**
 * QrisPaymentDialog.tsx — Menampilkan QR pembayaran untuk satu cicilan.
 *
 * DUA TAHAP, dan urutannya mengikuti aturan di server: nominal ditentukan lebih
 * dulu, baru QR dibuat. Nominal awal diisi sebesar tagihan cicilan, tetapi
 * pelanggan boleh mengubahnya — termasuk membayar sebagian.
 *
 * Batasnya ditegakkan server, bukan di sini: rpc_create_qris_request menolak
 * nominal nol, negatif, atau melebihi total tagihan kontrak. Pemeriksaan di
 * layar ini hanya supaya pelanggan tahu lebih awal, bukan sebagai pengaman.
 *
 * Yang TIDAK dilakukan di sini: mencatat pembayaran. Pencatatan terjadi ketika
 * notifikasi pembayaran masuk dan dicocokkan server (Edge Function qris-confirm),
 * atau ketika kasir mencatatnya manual.
 */

import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { AlertTriangle, Check, Copy, Download, PenLine, RefreshCw } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  Spinner,
} from '@/components/ui';
import { MoneyInput } from '@/components/ui/form';
import { errorMessage } from '@/lib/errors';
import type { Rupiah } from '@/lib/money';
import {
  buildPaymentQrPayload,
  formatRupiah,
  quickAmountsFor,
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
  /** Tagihan cicilan ini; dipakai sebagai nominal awal. */
  readonly defaultAmount: number;
  /** Seluruh tagihan kontrak; batas atas yang diizinkan server. */
  readonly maxAmount: number;
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
  defaultAmount,
  maxAmount,
}: QrisPaymentDialogProps): JSX.Element {
  const merchant = useMerchantQris();
  const createRequest = useCreateQrisRequest();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [nominal, setNominal] = useState<Rupiah | null>(null);
  const [permintaan, setPermintaan] = useState<QrisRequestResult | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatNominal, setGalatNominal] = useState<string | null>(null);
  const [tersalin, setTersalin] = useState(false);

  // Setiap dibuka, nominal kembali ke tagihan cicilan. Menutup dialog tidak
  // membatalkan permintaan yang sudah dibuat, sehingga QR yang terlanjur
  // ditampilkan tetap dapat dibayar.
  useEffect(() => {
    if (!open) {
      setPermintaan(null);
      setGalat(null);
      setGalatNominal(null);
      setTersalin(false);
      return;
    }
    setNominal(defaultAmount as Rupiah);
  }, [open, defaultAmount, installmentId]);

  const nilai = Number(nominal ?? 0);

  const buatPermintaan = async (): Promise<void> => {
    setGalat(null);
    setGalatNominal(null);

    if (!Number.isFinite(nilai) || nilai <= 0) {
      setGalatNominal('Nominal harus lebih besar dari nol.');
      return;
    }
    if (nilai > maxAmount) {
      setGalatNominal(
        `Nominal melebihi total tagihan kontrak (${formatRupiah(maxAmount)}). Kurangi nominalnya atau pilih Bayar seluruh tagihan.`,
      );
      return;
    }

    try {
      const hasil = await createRequest.mutateAsync({ contractId, installmentId, amount: nilai });
      setPermintaan(hasil);
    } catch (error) {
      setGalat(errorMessage(error));
    }
  };

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

  const sisaSetelahBayar = Math.max(maxAmount - nilai, 0);
  const nominalCepat = quickAmountsFor(maxAmount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>
            {permintaan ? `Bayar cicilan ${installmentLabel}` : `Nominal pembayaran cicilan ${installmentLabel}`}
          </DialogTitle>
          <DialogDescription>
            {permintaan
              ? 'Pindai QR di bawah dengan aplikasi bank atau dompet digital Anda. Nominalnya sudah terisi otomatis.'
              : 'Nominal awal sudah diisi sebesar tagihan cicilan ini. Anda boleh mengubahnya, termasuk membayar sebagian.'}
          </DialogDescription>
        </DialogHeader>

        {galat ? (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Permintaan pembayaran gagal dibuat
            </p>
            <p className="text-muted-foreground">{galat}</p>
          </div>
        ) : null}

        {/* Tahap 1: menentukan nominal */}
        {!permintaan ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tagihan cicilan ini</span>
                <span className="tabular-nums">{formatRupiah(defaultAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Seluruh tagihan kontrak</span>
                <span className="tabular-nums">{formatRupiah(maxAmount)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="qris-nominal" className="text-sm font-medium">
                Nominal yang akan dibayar
              </label>
              <MoneyInput id="qris-nominal" value={nominal} onChange={setNominal} max={maxAmount as Rupiah} />
              {galatNominal ? <p className="text-sm text-destructive">{galatNominal}</p> : null}
              {nilai > 0 && nilai <= maxAmount ? (
                <p className="text-xs text-muted-foreground">
                  Sisa tagihan kontrak setelah pembayaran ini: {formatRupiah(sisaSetelahBayar)}
                  {nilai < defaultAmount ? ' — cicilan ini akan tercatat sebagian.' : ''}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Sesuai tagihan</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setNominal(defaultAmount as Rupiah)}>
                  Bayar cicilan ini ({formatRupiah(defaultAmount)})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setNominal(Math.round(defaultAmount / 2) as Rupiah)}
                >
                  Setengahnya
                </Button>
                {maxAmount > defaultAmount ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setNominal(maxAmount as Rupiah)}>
                    Seluruh tagihan ({formatRupiah(maxAmount)})
                  </Button>
                ) : null}
              </div>

              {nominalCepat.length > 0 ? (
                <>
                  <p className="pt-1 text-xs font-medium text-muted-foreground">Nominal bulat</p>
                  <div className="flex flex-wrap gap-2">
                    {nominalCepat.map((nominal) => (
                      <Button
                        key={nominal}
                        type="button"
                        variant={nilai === nominal ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setNominal(nominal as Rupiah)}
                      >
                        {formatRupiah(nominal)}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Nominal yang melebihi total tagihan kontrak tidak ditampilkan, karena akan ditolak server.
                  </p>
                </>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Batal
              </Button>
              <Button className="gap-2" loading={createRequest.isPending} onClick={() => void buatPermintaan()}>
                <PenLine aria-hidden />
                Buat QR pembayaran
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {/* Tahap 2: QR */}
        {permintaan && !payloadQr && !galatQr ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner label="Menyiapkan QR" />
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
                Kontrak {permintaan.contract_number}
                {permintaan.amount < defaultAmount ? ' · pembayaran sebagian' : ''}
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
              <Button variant="secondary" className="gap-2 sm:flex-1" onClick={() => setPermintaan(null)}>
                <RefreshCw aria-hidden />
                Ubah nominal
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
