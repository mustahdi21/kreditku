/**
 * LoginPage.tsx — Halaman masuk email + password.
 *
 * * Tidak ada kredensial yang di-hardcode.
 * * Pesan kegagalan tidak membocorkan apakah email terdaftar atau tidak.
 * * Pembatasan percobaan login ditangani Supabase Auth di sisi server.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreditCard, Eye, EyeOff, LogIn } from 'lucide-react';
import { loginSchema, type LoginInput } from '@/core/validation';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { env } from '@/lib/env';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input } from '@/components/ui';
import { FormField } from '@/components/ui/form';

export function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      navigate('/app', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border bg-background shadow-sm lg:grid-cols-2">
        <div className="hidden flex-col justify-between bg-primary p-8 text-primary-foreground lg:flex">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
              <CreditCard className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-lg font-semibold">{env.appName}</span>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold leading-tight">Kelola kredit, cicilan, dan piutang dengan rapi.</h2>
            <p className="text-sm text-primary-foreground/80">
              Pencatatan pembayaran transaksional, jadwal cicilan otomatis, perhitungan denda transparan, dan laporan
              piutang yang dapat diaudit.
            </p>
          </div>
          <p className="text-xs text-primary-foreground/70">
            Akses dibatasi berdasarkan role dan organisasi. Seluruh aktivitas penting tercatat pada audit log.
          </p>
        </div>

        <Card className="border-0 shadow-none">
          <CardHeader>
            <CardTitle className="text-xl">Masuk ke akun Anda</CardTitle>
            <CardDescription>Gunakan email dan password yang diberikan administrator organisasi.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              {formError ? <ErrorState title="Gagal masuk" message={formError} /> : null}

              <FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message} required>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  aria-invalid={Boolean(form.formState.errors.email)}
                  {...form.register('email')}
                />
              </FormField>

              <FormField label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    aria-invalid={Boolean(form.formState.errors.password)}
                    className="pr-10"
                    {...form.register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>

              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                <LogIn aria-hidden />
                {form.formState.isSubmitting ? 'Memproses…' : 'Masuk'}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Link to="/forgot-password" className="text-primary hover:underline">
                  Lupa password?
                </Link>
                <span className="text-muted-foreground">Zona waktu: {env.timezone}</span>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
