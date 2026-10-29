/**
 * PortalLoginPage.tsx — Halaman masuk portal pelanggan.
 *
 * Terpisah dari halaman masuk aplikasi admin karena yang masuk di sini adalah
 * pelanggan, dan setelah berhasil ia diarahkan ke portal — bukan ke aplikasi
 * admin. Kredensialnya sama: akun yang dibuatkan admin dan dihubungkan ke data
 * pelanggan.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn, Wallet } from 'lucide-react';
import { loginSchema, type LoginInput } from '@/core/validation';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { env } from '@/lib/env';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input } from '@/components/ui';
import { FormField } from '@/components/ui/form';

export function PortalLoginPage(): JSX.Element {
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
      navigate('/portal', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

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
          <CardTitle className="text-xl">Masuk ke akun Anda</CardTitle>
          <CardDescription>
            Gunakan email dan password yang diberikan admin {env.appName} kepada Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {formError ? <ErrorState title="Gagal masuk" message={formError} /> : null}

            <FormField label="Email" htmlFor="portal-email" error={form.formState.errors.email?.message} required>
              <Input
                id="portal-email"
                type="email"
                autoComplete="email"
                autoFocus
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
            </FormField>

            <FormField
              label="Password"
              htmlFor="portal-password"
              error={form.formState.errors.password?.message}
              required
            >
              <div className="relative">
                <Input
                  id="portal-password"
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

            <p className="text-center text-xs text-muted-foreground">
              Punya kode undangan dari admin?{' '}
              <Link to="/portal/daftar" className="text-primary hover:underline">
                Daftar akun portal
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
