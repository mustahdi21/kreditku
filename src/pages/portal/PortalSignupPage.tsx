/**
 * PortalSignupPage.tsx — Pendaftaran akun portal pelanggan.
 *
 * Dua langkah, dan urutannya disengaja: kode diperiksa lebih dulu, baru
 * formulir diisi. Dengan begitu pelanggan yang kodenya sudah kedaluwarsa atau
 * salah ketik tidak perlu mengisi nama, email, dan password terlebih dahulu
 * hanya untuk ditolak di akhir.
 *
 * Akun dibuat dengan email sudah terkonfirmasi sehingga tidak ada email
 * aktivasi yang perlu dikirim — kode undangan dari admin itu sendiri yang
 * menjadi bukti bahwa pendaftar berhak atas data pelanggan tersebut.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, KeyRound, UserPlus, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
} from '@/components/ui';
import { FormField } from '@/components/ui/form';
import { errorMessage } from '@/lib/errors';
import { checkInviteCode, registerCustomerAccount, type InvitePreview } from '@/data/portal';

function formatExpiry(value: string | null): string {
  if (!value) return '-';
  const tanggal = new Date(value);
  if (Number.isNaN(tanggal.getTime())) return value;
  return tanggal.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
}

export function PortalSignupPage(): JSX.Element {
  const navigate = useNavigate();

  const [kode, setKode] = useState('');
  const [pratinjau, setPratinjau] = useState<InvitePreview | null>(null);
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [sedangProses, setSedangProses] = useState(false);
  const [selesai, setSelesai] = useState(false);

  const periksaKode = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setGalat(null);
    setSedangProses(true);
    try {
      const hasil = await checkInviteCode(kode);
      setPratinjau(hasil);
      if (hasil.customerName) setNama(hasil.customerName);
    } catch (error) {
      setGalat(errorMessage(error));
      setPratinjau(null);
    } finally {
      setSedangProses(false);
    }
  };

  const daftar = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setGalat(null);
    setSedangProses(true);
    try {
      await registerCustomerAccount({ code: kode, fullName: nama, email, password });
      setSelesai(true);
    } catch (error) {
      setGalat(errorMessage(error));
    } finally {
      setSedangProses(false);
    }
  };

  if (selesai) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
              Akun portal dibuat
            </CardTitle>
            <CardDescription>
              Akun Anda sudah aktif dan tertaut ke tagihan Anda. Silakan masuk memakai email dan password yang baru
              Anda isi.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full gap-2" onClick={() => navigate('/portal/masuk', { replace: true })}>
              Masuk sekarang
              <ArrowRight aria-hidden />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-primary">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Wallet className="h-6 w-6" aria-hidden />
        </span>
        <span className="text-lg font-semibold">Portal Pelanggan</span>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Daftar akun portal</CardTitle>
          <CardDescription>
            Masukkan kode undangan yang diberikan admin usaha Anda, lalu lengkapi data akun.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {galat ? <ErrorState title="Pendaftaran tidak dapat dilanjutkan" message={galat} /> : null}

          {!pratinjau ? (
            <form className="space-y-4" onSubmit={(event) => void periksaKode(event)}>
              <FormField
                label="Kode undangan"
                htmlFor="daftar-kode"
                hint="Delapan huruf atau angka, contoh: 4XTK2F8V"
                required
              >
                <Input
                  id="daftar-kode"
                  value={kode}
                  onChange={(event) => setKode(event.target.value.toUpperCase())}
                  placeholder="XXXXXXXX"
                  className="font-mono tracking-widest"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={8}
                  autoFocus
                />
              </FormField>
              <Button type="submit" className="w-full gap-2" loading={sedangProses}>
                <KeyRound aria-hidden />
                Periksa kode
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void daftar(event)}>
              <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {pratinjau.customerName ? `Data pelanggan: ${pratinjau.customerName}` : 'Kode undangan sah'}
                  <Badge variant="success" className="ml-auto">
                    Sah
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">Berlaku sampai {formatExpiry(pratinjau.expiresAt)}</p>
              </div>

              <FormField label="Nama lengkap" htmlFor="daftar-nama" required>
                <Input
                  id="daftar-nama"
                  value={nama}
                  onChange={(event) => setNama(event.target.value)}
                  autoComplete="name"
                  placeholder="Nama Anda"
                />
              </FormField>

              <FormField label="Email" htmlFor="daftar-email" hint="Dipakai untuk masuk ke portal" required>
                <Input
                  id="daftar-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="nama@email.com"
                />
              </FormField>

              <FormField
                label="Password"
                htmlFor="daftar-password"
                hint="Minimal 10 karakter. Simpan di tempat yang aman."
                required
              >
                <Input
                  id="daftar-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </FormField>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="sm:flex-1"
                  onClick={() => {
                    setPratinjau(null);
                    setGalat(null);
                  }}
                >
                  Ganti kode
                </Button>
                <Button type="submit" className="gap-2 sm:flex-1" loading={sedangProses}>
                  <UserPlus aria-hidden />
                  Daftar
                </Button>
              </div>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Sudah punya akun?{' '}
            <Link to="/portal/masuk" className="text-primary hover:underline">
              Masuk di sini
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
