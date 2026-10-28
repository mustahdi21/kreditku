/**
 * ForgotPasswordPage.tsx — Pengajuan tautan reset password.
 * Selalu menampilkan pesan netral agar keberadaan akun tidak dapat ditebak.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/core/validation';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input } from '@/components/ui';
import { FormField } from '@/components/ui/form';

export function ForgotPasswordPage(): JSX.Element {
  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>
            Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat password baru.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? <ErrorState title="Permintaan gagal" message={formError} /> : null}

          {sent ? (
            <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
              <MailCheck className="mt-0.5 h-4 w-4 text-success" aria-hidden />
              <div>
                <p className="font-medium">Tautan telah dikirim bila email terdaftar.</p>
                <p className="text-muted-foreground">
                  Periksa kotak masuk dan folder spam Anda. Tautan berlaku terbatas sesuai konfigurasi Supabase Auth.
                </p>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <FormField label="Email" htmlFor="reset-email" error={form.formState.errors.email?.message} required>
                <Input id="reset-email" type="email" autoComplete="email" {...form.register('email')} />
              </FormField>
              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                Kirim tautan reset
              </Button>
            </form>
          )}

          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Kembali ke halaman masuk
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
