/**
 * NoAccessPage.tsx — Pengguna terautentikasi tanpa keanggotaan organisasi.
 */

import { UserX } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export function NoAccessPage(): JSX.Element {
  const { profile, signOut, refresh } = useAuth();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-warning" aria-hidden />
            Akun belum terhubung ke organisasi
          </CardTitle>
          <CardDescription>
            {profile?.email ? `${profile.email} belum terdaftar pada organisasi mana pun.` : 'Akun Anda belum terdaftar pada organisasi mana pun.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Mintalah Super Admin organisasi Anda untuk menambahkan akun ini melalui menu <strong>Pengaturan → Pengguna</strong>.
            Setelah ditambahkan, tekan muat ulang data di bawah.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void refresh()}>Muat ulang akses</Button>
            <Button variant="outline" onClick={() => void signOut()}>
              Keluar dari akun
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
