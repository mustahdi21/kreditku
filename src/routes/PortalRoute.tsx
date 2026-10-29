/**
 * PortalRoute.tsx — Penjaga rute portal pelanggan.
 *
 * Portal adalah permukaan terpisah dari aplikasi admin, dan pemisahnya bukan
 * sekadar tampilan: yang boleh masuk hanya akun yang terhubung ke sebuah baris
 * pelanggan. Akun staf — yang punya keanggotaan organisasi — justru ditolak di
 * sini, karena data yang ditampilkan portal adalah data satu pelanggan, bukan
 * data usaha.
 *
 * Penentuan identitas dilakukan server lewat fn_current_customer_id(). Klien
 * tidak pernah mengirim atau menebak id pelanggan, sehingga akun tidak dapat
 * menunjuk pelanggan lain. Penjagaan di berkas ini bersifat UX: keamanan
 * datanya tetap dijamin RLS dan kebijakan pada tabel.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LogOut, ShieldAlert, Store } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui';
import { ErrorState } from '@/components/ui';
import { useMyCustomerId } from '@/data/portal';

/** Hanya untuk pengguna yang belum masuk; dipakai halaman masuk portal. */
export function PortalPublicOnlyRoute({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();

  if (status === 'unconfigured') return <Navigate to="/setup" replace />;
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Memeriksa sesi" />
      </div>
    );
  }
  if (status === 'authenticated') return <Navigate to="/portal" replace />;

  return <>{children}</>;
}

export function PortalRoute({ children }: { children: ReactNode }): JSX.Element {
  const { status, error, signOut } = useAuth();
  const location = useLocation();
  const customerQuery = useMyCustomerId();

  if (status === 'unconfigured') return <Navigate to="/setup" replace />;

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Memuat sesi" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-md p-4">
        <ErrorState
          title="Sesi tidak dapat dimuat"
          message={error?.message ?? 'Terjadi kesalahan saat memuat profil pengguna.'}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/portal/masuk" replace state={{ from: location.pathname }} />;
  }

  if (customerQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Memeriksa akun pelanggan" />
      </div>
    );
  }

  if (customerQuery.isError) {
    return (
      <div className="mx-auto max-w-md p-4">
        <ErrorState
          title="Akun tidak dapat diperiksa"
          message="Koneksi ke server gagal saat memeriksa akun pelanggan. Coba muat ulang halaman."
          onRetry={() => void customerQuery.refetch()}
        />
      </div>
    );
  }

  // Akun ini sah, tetapi bukan akun pelanggan. Kemungkinan besar ini akun staf
  // yang membuka tautan portal; arahkan ke aplikasi admin alih-alih menampilkan
  // halaman kosong yang membingungkan.
  if (!customerQuery.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center p-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
              Bukan akun pelanggan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Akun ini belum terhubung ke data pelanggan mana pun, sehingga portal tidak dapat menampilkan tagihan.
            </p>
            <p className="text-sm text-muted-foreground">
              Bila Anda staf usaha, gunakan aplikasi admin. Bila Anda pelanggan, mintalah admin menghubungkan akun ini
              dengan data pelanggan Anda.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => void signOut()} className="gap-2">
                <LogOut className="h-4 w-4" aria-hidden />
                Keluar
              </Button>
              <Button asChild className="gap-2">
                <a href="#/app">
                  <Store className="h-4 w-4" aria-hidden />
                  Buka aplikasi admin
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
