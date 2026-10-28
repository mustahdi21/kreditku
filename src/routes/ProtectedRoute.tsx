/**
 * ProtectedRoute.tsx — Penjaga rute berbasis status autentikasi dan izin.
 *
 * Catatan: penjagaan di sini bersifat UX (mengarahkan pengguna ke halaman
 * yang tepat). Keamanan data tetap dijamin oleh RLS dan fungsi server.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import type { Permission } from '@/auth/permissions';
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui';
import { ErrorState } from '@/components/ui';

/** Hanya untuk pengguna yang belum login (halaman login, dsb). */
export function PublicOnlyRoute({ children }: { children: ReactNode }): JSX.Element {
  const { status, needsInvitation } = useAuth();

  if (status === 'unconfigured') return <Navigate to="/setup" replace />;
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Memeriksa sesi" />
      </div>
    );
  }
  if (status === 'authenticated') return <Navigate to={needsInvitation ? '/no-access' : '/app'} replace />;

  return <>{children}</>;
}

/** Untuk seluruh halaman di dalam kerangka aplikasi. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { status, needsInvitation, error } = useAuth();
  const location = useLocation();

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
      <div className="mx-auto max-w-xl p-6">
        <ErrorState
          title="Sesi tidak dapat dimuat"
          message={error?.message ?? 'Terjadi kesalahan saat memuat profil pengguna.'}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (needsInvitation) return <Navigate to="/no-access" replace />;

  return <>{children}</>;
}

/** Menampilkan pesan terkunci bila pengguna tidak memiliki izin halaman. */
export function RequirePermission({
  permission,
  children,
  title = 'Akses ditolak',
}: {
  permission: Permission;
  children: ReactNode;
  title?: string;
}): JSX.Element {
  const { can, role } = useAuth();

  if (!can(permission)) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Role Anda saat ini ({role ?? '-'}) tidak memiliki hak untuk membuka halaman ini. Hubungi administrator
            organisasi bila Anda memerlukan akses.
          </p>
          <Button variant="outline" onClick={() => window.history.back()}>
            Kembali
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
