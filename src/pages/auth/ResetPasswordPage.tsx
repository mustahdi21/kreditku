/**
 * ResetPasswordPage.tsx — Menetapkan password baru setelah pengguna membuka
 * tautan pemulihan dari email (sesi pemulihan dikelola Supabase Auth).
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { resetPasswordSchema, type ResetPasswordInput } from '@/core/validation';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input } from '@/components/ui';
import { FormField } from '@/components/ui/form';

export function ResetPasswordPage(): JSX.Element {
  const { updatePassword, status } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await updatePassword(values.password);
      setDone(true);
      setTimeout(() => navigate('/app', { replace: true }), 1500);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" aria-hidden />
            Password baru
          </CardTitle>
          <CardDescription>
            Gunakan minimal 10 karakter dengan kombinasi huruf dan angka. Hindari password yang mudah ditebak.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? <ErrorState title="Gagal menyimpan password" message={formError} /> : null}

          {status === 'unauthenticated' ? (
            <ErrorState
              title="Tautan tidak valid"
              message="Sesi pemulihan tidak ditemukan atau sudah kedaluwarsa. Ajukan tautan reset baru dari halaman lupa password."
            />
          ) : done ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
              Password berhasil diperbarui. Anda akan diarahkan ke dashboard.
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <FormField
                label="Password baru"
                htmlFor="new-password"
                error={form.formState.errors.password?.message}
                required
              >
                <Input id="new-password" type="password" autoComplete="new-password" {...form.register('password')} />
              </FormField>
              <FormField
                label="Ulangi password"
                htmlFor="confirm-password"
                error={form.formState.errors.confirmPassword?.message}
                required
              >
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirmPassword')}
                />
              </FormField>
              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                Simpan password baru
              </Button>
            </form>
          )}

          <Link to="/login" className="text-sm text-primary hover:underline">
            Kembali ke halaman masuk
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
