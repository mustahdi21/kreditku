/**
 * CustomerPortalAccountCard.tsx — Kartu pengelolaan akun portal pelanggan.
 *
 * Satu tempat untuk menjawab pertanyaan "apakah pelanggan ini sudah bisa masuk
 * portal?". Bila belum, admin membuat kode undangan di sini lalu menyampaikannya
 * langsung kepada pelanggan — lewat WhatsApp, misalnya. Pelanggan mendaftar
 * sendiri memakai kode itu, sehingga admin tidak perlu mengetik password siapa
 * pun.
 *
 * Kode yang ditampilkan hanya yang masih berlaku. Kode baru otomatis mencabut
 * kode lama yang belum dipakai, jadi yang tampil selalu kode yang benar-benar
 * dapat dipakai.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useCreateCustomerInvite, useRevokeCustomerInvite } from '@/data/customers';
import { supabase, unwrap } from '@/data/client';
import { TABLES } from '@/lib/supabase';
import { notifySuccess } from '@/components/common/Toaster';
import type { CustomerRow } from '@/data/types';

interface InviteRow {
  readonly id: string;
  readonly code: string;
  readonly created_at: string;
  readonly expires_at: string;
}

function useOpenInvites(customerId: string) {
  return useQuery({
    queryKey: ['customer-invites', customerId],
    queryFn: async () => {
      const result = await supabase()
        .from(TABLES.customerInvites)
        .select('id, code, created_at, expires_at')
        .eq('customer_id', customerId)
        .is('used_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      return unwrap<InviteRow[]>(result as never, 'memuat undangan portal');
    },
  });
}

function formatTanggal(value: string): string {
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function CustomerPortalAccountCard({ customer }: { readonly customer: CustomerRow }): JSX.Element {
  const invites = useOpenInvites(customer.id);
  const buat = useCreateCustomerInvite();
  const cabut = useRevokeCustomerInvite();
  const [tersalin, setTersalin] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  const sudahPunyaAkun = Boolean(customer.user_id);
  const kodeAktif = invites.data?.[0] ?? null;

  const salin = async (kode: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(kode);
      setTersalin(kode);
      window.setTimeout(() => setTersalin(null), 2000);
    } catch {
      setTersalin(null);
    }
  };

  const buatKode = async (): Promise<void> => {
    setGalat(null);
    try {
      const hasil = await buat.mutateAsync({ customerId: customer.id });
      await salin(hasil.code);
      notifySuccess('Kode undangan dibuat.', 'Kode disalin. Sampaikan kepada pelanggan untuk mendaftar di portal.');
      void invites.refetch();
    } catch (error) {
      setGalat(errorMessage(error));
    }
  };

  const cabutKode = async (inviteId: string): Promise<void> => {
    setGalat(null);
    try {
      await cabut.mutateAsync(inviteId);
      notifySuccess('Kode dicabut.', 'Kode itu tidak dapat dipakai lagi.');
      void invites.refetch();
    } catch (error) {
      setGalat(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" aria-hidden />
          Akun portal pelanggan
        </CardTitle>
        <CardDescription>
          Pelanggan dapat memantau tagihan dan membayar lewat portal setelah akunnya tertaut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {galat ? <p className="rounded-md bg-destructive/5 p-2 text-sm text-destructive">{galat}</p> : null}

        {sudahPunyaAkun ? (
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Akun portal sudah tertaut</p>
              <p className="text-muted-foreground">
                Pelanggan dapat masuk di portal memakai email akunnya
                {customer.email ? ` (${customer.email})` : ''}.
              </p>
            </div>
          </div>
        ) : invites.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : kodeAktif ? (
          <div className="space-y-3">
            <div className="space-y-1 rounded-md border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Kode undangan aktif</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl tracking-[0.3em]">{kodeAktif.code}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => void salin(kodeAktif.code)}
                  aria-label="Salin kode undangan"
                >
                  {tersalin === kodeAktif.code ? (
                    <Check className="h-3 w-3 text-success" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden />
                  )}
                  Salin
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Berlaku sampai {formatTanggal(kodeAktif.expires_at)}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="sm:flex-1"
                loading={buat.isPending}
                onClick={() => void buatKode()}
              >
                Buat kode baru
              </Button>
              <Button
                variant="ghost"
                className="sm:flex-1"
                loading={cabut.isPending}
                onClick={() => void cabutKode(kodeAktif.id)}
              >
                Cabut kode
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pelanggan membuka portal, memilih <span className="font-medium">Daftar akun portal</span>, lalu memasukkan
              kode di atas.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Belum ada akun portal. Buat kode undangan, lalu sampaikan kepada pelanggan — ia mendaftar sendiri tanpa
              perlu Anda membuatkan password.
            </p>
            <Button className="w-full gap-2" loading={buat.isPending} onClick={() => void buatKode()}>
              <KeyRound aria-hidden />
              Buat kode undangan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}