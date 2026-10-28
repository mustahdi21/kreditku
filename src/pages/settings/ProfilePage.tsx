/**
 * ProfilePage.tsx — Profil pengguna yang sedang masuk.
 *
 * KEAMANAN: halaman ini tidak pernah menampilkan atau meminta rahasia apa pun
 * (password lama, token, service key). Perubahan password dilakukan melalui
 * Supabase Auth menggunakan sesi aktif pengguna.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { Building2, Clock, KeyRound, LogOut, Mail, Save, ShieldCheck, UserCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { RoleBadge } from '@/components/common/domain';
import { DetailRow } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  Input,
  Separator,
} from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { formatDateTimeId } from '@/lib/date';
import { ROLE_LABELS } from '@/core/types';
import {
  profileSchema,
  resetPasswordSchema,
  type ProfileInput,
  type ResetPasswordInput,
} from '@/core/validation';

export default function ProfilePage(): JSX.Element {
  const { profile, role, currentMembership, user, updateProfile, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const profileForm = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    values: {
      fullName: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
    },
  });

  const passwordForm = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const submitProfile = profileForm.handleSubmit(async (values) => {
    try {
      await updateProfile({
        fullName: values.fullName,
        phone: values.phone === '' || values.phone === undefined ? null : values.phone,
      });
      notifySuccess('Profil diperbarui.', 'Nama dan nomor telepon Anda telah disimpan.');
    } catch (error) {
      notifyError(error, 'Profil gagal diperbarui');
    }
  });

  const submitPassword = passwordForm.handleSubmit(async (values) => {
    try {
      await updatePassword(values.password);
      passwordForm.reset({ password: '', confirmPassword: '' });
      notifySuccess('Password diperbarui.', 'Gunakan password baru pada sesi login berikutnya.');
    } catch (error) {
      notifyError(error, 'Password gagal diperbarui');
    }
  });

  const displayName = profile?.full_name || profile?.email || 'Pengguna';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profil Saya"
        description="Kelola nama tampilan, nomor telepon, dan password akun Anda."
        badge={role ? <RoleBadge role={role} /> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" aria-hidden />
            Informasi Akun
          </CardTitle>
          <CardDescription>Data berikut dikelola oleh administrasi organisasi dan tidak dapat diubah di sini.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <DetailRow label="Nama tampilan">{displayName}</DetailRow>
            <DetailRow label="Email">
              <span className="inline-flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {profile?.email ?? user?.email ?? '-'}
              </span>
            </DetailRow>
            <DetailRow label="Role">
              {role ? <RoleBadge role={role} /> : <Badge variant="muted">Tidak ada role</Badge>}
            </DetailRow>
            <DetailRow label="Organisasi aktif">
              <span className="inline-flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {currentMembership?.organization?.name ?? '-'}
                {currentMembership?.organization?.code ? (
                  <Badge variant="outline">{currentMembership.organization.code}</Badge>
                ) : null}
              </span>
            </DetailRow>
            <DetailRow label="Login terakhir">
              <span className="inline-flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {formatDateTimeId(profile?.last_login_at)}
              </span>
            </DetailRow>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Email tidak dapat diubah sendiri karena dipakai sebagai identitas login dan penerima undangan. Hubungi Super
            Admin bila email perlu diganti. Role yang berlaku saat ini: {role ? ROLE_LABELS[role] : '-'}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ubah Nama dan Telepon</CardTitle>
          <CardDescription>Nama tampilan muncul pada kuitansi, laporan, dan jejak audit.</CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void submitProfile(event)}>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nama lengkap" htmlFor="profile-name" required error={profileForm.formState.errors.fullName?.message}>
              <Input id="profile-name" autoComplete="name" {...profileForm.register('fullName')} />
            </FormField>
            <FormField
              label="Nomor telepon"
              htmlFor="profile-phone"
              error={profileForm.formState.errors.phone?.message}
              hint="Boleh dikosongkan. Format: 08xx atau +62xx."
            >
              <Input id="profile-phone" inputMode="tel" autoComplete="tel" placeholder="0812xxxxxxx" {...profileForm.register('phone')} />
            </FormField>
          </CardContent>
          <CardFooter>
            <Button type="submit" loading={profileForm.formState.isSubmitting}>
              <Save aria-hidden />
              Simpan profil
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
            Ubah Password
          </CardTitle>
          <CardDescription>
            Minimal 10 karakter dan mengandung huruf serta angka. Password lama tidak perlu dimasukkan — sesi Anda
            sudah terautentikasi.
          </CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void submitPassword(event)}>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Password baru"
              htmlFor="profile-password"
              required
              error={passwordForm.formState.errors.password?.message}
            >
              <Input id="profile-password" type="password" autoComplete="new-password" {...passwordForm.register('password')} />
            </FormField>
            <FormField
              label="Ulangi password baru"
              htmlFor="profile-password-confirm"
              required
              error={passwordForm.formState.errors.confirmPassword?.message}
            >
              <Input
                id="profile-password-confirm"
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('confirmPassword')}
              />
            </FormField>
          </CardContent>
          <CardFooter>
            <Button type="submit" loading={passwordForm.formState.isSubmitting}>
              <ShieldCheck aria-hidden />
              Perbarui password
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesi</CardTitle>
          <CardDescription>Keluar akan mengakhiri sesi pada peramban ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator />
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => setConfirmSignOut(true)}>
            <LogOut aria-hidden />
            Keluar dari akun
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Keluar dari akun?"
        description="Anda akan diarahkan kembali ke halaman login dan perlu memasukkan email serta password untuk masuk lagi."
        confirmLabel="Ya, keluar"
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut().then(
            () => navigate('/login', { replace: true }),
            (error: unknown) => notifyError(error, 'Gagal keluar dari akun'),
          );
        }}
      />
    </div>
  );
}
