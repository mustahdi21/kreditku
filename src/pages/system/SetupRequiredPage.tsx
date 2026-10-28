/**
 * SetupRequiredPage.tsx — Ditampilkan ketika aplikasi belum dihubungkan ke
 * Supabase. Tidak pernah meminta password, token, atau service role key.
 */

import { AlertTriangle, ExternalLink, Terminal } from 'lucide-react';
import { env } from '@/lib/env';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

const STEPS = [
  {
    title: '1. Siapkan proyek Supabase',
    body: 'Buat proyek pada supabase.com, lalu buka Project Settings → API untuk mengambil Project URL dan anon/publishable key.',
  },
  {
    title: '2. Buat berkas .env',
    body: 'Salin .env.example menjadi .env pada akar proyek. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY dari langkah sebelumnya.',
  },
  {
    title: '3. Jalankan migrasi database',
    body: 'Jalankan `npm run setup` (wizard interaktif) atau tempel isi supabase/migrations ke SQL Editor proyek Supabase secara berurutan.',
  },
  {
    title: '4. Buat Super Admin pertama',
    body: 'Jalankan `npm run bootstrap:admin`. Skrip akan meminta email dan password secara lokal — jangan pernah mengirimkannya ke siapa pun.',
  },
  {
    title: '5. Muat ulang halaman ini',
    body: 'Setelah konfigurasi lengkap, jalankan ulang `npm run dev` dan muat ulang halaman.',
  },
];

export function SetupRequiredPage(): JSX.Element {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-muted/40 p-4 py-10">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
            Aplikasi belum dikonfigurasi
          </CardTitle>
          <CardDescription>
            KreditKu memerlukan koneksi Supabase (database PostgreSQL + autentikasi) sebelum dapat digunakan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Variabel lingkungan yang belum lengkap:</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {env.missingKeys.map((key) => (
                <li key={key}>
                  <code className="rounded bg-muted px-1 py-0.5">{key}</code>
                </li>
              ))}
            </ul>
          </div>

          <ol className="space-y-3">
            {STEPS.map((step) => (
              <li key={step.title} className="rounded-md border p-3">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs">
              <Terminal className="h-3.5 w-3.5" aria-hidden />
              npm run setup
            </span>
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href="https://supabase.com/docs/guides/getting-started/quickstarts/reactjs"
              target="_blank"
              rel="noreferrer noopener"
            >
              Dokumentasi Supabase
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            Keamanan: aplikasi ini tidak pernah meminta service role key, password database, atau token pribadi pada
            antarmuka. Seluruh rahasia hanya dibaca dari variabel lingkungan sisi server saat menjalankan skrip
            konfigurasi.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
