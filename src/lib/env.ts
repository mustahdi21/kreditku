/**
 * env.ts — Pembacaan konfigurasi lingkungan dengan validasi.
 *
 * CATATAN KEAMANAN
 * ----------------
 * Seluruh variabel VITE_ ter-embed ke bundle publik. Hanya kunci *publishable*
 * (anon key) yang boleh berada di sini. Service role key, password database,
 * token WhatsApp, dan password SMTP TIDAK BOLEH dan tidak pernah dibaca dari
 * frontend.
 */

export interface AppEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly basePath: string;
  readonly appName: string;
  readonly currency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly isConfigured: boolean;
  readonly missingKeys: readonly string[];
}

const PLACEHOLDER_PATTERNS = [
  /xxxxxxxx/i,
  /^your[-_]/i,
  /^<.*>$/,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function read(key: string, fallback = ''): string {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed === '' || isPlaceholder(trimmed)) return fallback;
  return trimmed;
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * JWT publik Supabase berbentuk tiga segmen base64url.
 * Divalidasi bentuknya saja — bukan tanda tangan (itu tugas server).
 */
function looksLikeSupabaseKey(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 8);
}

const rawUrl = read('VITE_SUPABASE_URL');
const rawKey = read('VITE_SUPABASE_ANON_KEY');

const missingKeys: string[] = [];
if (!rawUrl) missingKeys.push('VITE_SUPABASE_URL');
else if (!isValidSupabaseUrl(rawUrl)) missingKeys.push('VITE_SUPABASE_URL (format tidak valid)');
if (!rawKey) missingKeys.push('VITE_SUPABASE_ANON_KEY');
else if (!looksLikeSupabaseKey(rawKey)) missingKeys.push('VITE_SUPABASE_ANON_KEY (format tidak valid)');

const basePathRaw = read('VITE_BASE_PATH', '/');
const basePath = basePathRaw.endsWith('/') ? basePathRaw : `${basePathRaw}/`;

export const env: AppEnv = {
  supabaseUrl: rawUrl,
  supabaseAnonKey: rawKey,
  basePath,
  appName: read('VITE_APP_NAME', 'KreditKu'),
  currency: read('VITE_DEFAULT_CURRENCY', 'IDR'),
  timezone: read('VITE_DEFAULT_TIMEZONE', 'Asia/Jakarta'),
  locale: read('VITE_DEFAULT_LOCALE', 'id-ID'),
  isConfigured: missingKeys.length === 0,
  missingKeys,
};

/** Pesan bantuan bila konfigurasi belum lengkap. */
export function configurationHelp(): string {
  return [
    'Aplikasi belum terhubung ke Supabase.',
    `Variabel yang belum diisi: ${env.missingKeys.join(', ')}.`,
    'Salin .env.example menjadi .env, isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY',
    'dari dashboard Supabase (Project Settings → API), lalu jalankan ulang aplikasi.',
  ].join(' ');
}
