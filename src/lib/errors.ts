/**
 * errors.ts — Normalisasi error agar pesan ke pengguna selalu aman dan jelas.
 *
 * PRINSIP
 * -------
 * Pesan detail internal (stack trace, nama kolom, detail Postgres) TIDAK BOLEH
 * ditampilkan ke pengguna akhir. Pesan asli tetap dicatat pada console untuk
 * keperluan debugging pengembang.
 */

export type AppErrorKind =
  | 'CONFIGURATION'
  | 'AUTH'
  | 'PERMISSION'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NETWORK'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail?: string;
  readonly context?: Record<string, unknown>;

  constructor(kind: AppErrorKind, message: string, detail?: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.detail = detail;
    this.context = context;
  }
}

interface PostgresLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/** Kode SQLSTATE yang dipetakan ke pesan ramah pengguna. */
const SQLSTATE_MESSAGES: Record<string, { kind: AppErrorKind; message: string }> = {
  '42501': { kind: 'PERMISSION', message: 'Anda tidak memiliki hak untuk melakukan tindakan ini.' },
  '23505': { kind: 'CONFLICT', message: 'Data sudah ada. Periksa kembali nomor atau kunci yang digunakan.' },
  '23503': { kind: 'CONFLICT', message: 'Data terkait tidak ditemukan atau masih digunakan.' },
  '23514': { kind: 'VALIDATION', message: 'Data yang dikirim tidak memenuhi aturan yang berlaku.' },
  '22023': { kind: 'VALIDATION', message: 'Parameter yang dikirim tidak valid.' },
  'P0002': { kind: 'NOT_FOUND', message: 'Data tidak ditemukan.' },
  '40001': { kind: 'CONFLICT', message: 'Terjadi konflik data. Silakan ulangi operasi.' },
  '40P01': { kind: 'CONFLICT', message: 'Terjadi konflik data. Silakan ulangi operasi.' },
  '57014': { kind: 'NETWORK', message: 'Permintaan memakan waktu terlalu lama. Coba lagi.' },
  '53300': { kind: 'NETWORK', message: 'Server sedang sibuk. Coba beberapa saat lagi.' },
};

/**
 * Mengubah error apa pun menjadi AppError dengan pesan yang aman ditampilkan.
 * Pesan dari fungsi bisnis server (RAISE EXCEPTION dengan pesan Bahasa Indonesia)
 * tetap diteruskan karena memang ditulis untuk pengguna.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (typeof error === 'string') {
    return new AppError('UNKNOWN', error);
  }

  const candidate = error as PostgresLikeError & { name?: string; status?: number };

  if (candidate && typeof candidate === 'object') {
    const code = candidate.code;
    if (code && SQLSTATE_MESSAGES[code]) {
      const mapped = SQLSTATE_MESSAGES[code]!;
      const raw = candidate.message ?? '';
      // Pesan dari fungsi bisnis kita sendiri ditulis dalam bahasa Indonesia dan
      // memang ditujukan untuk pengguna; pesan teknis Postgres diganti dengan
      // padanan yang aman.
      const isLocalizedMessage = raw.length > 0 && !/^(null value|duplicate key|violates|permission denied for|new row for relation|insert or update)/i.test(raw);
      return new AppError(
        mapped.kind,
        isLocalizedMessage ? raw : mapped.message,
        raw,
        { code },
      );
    }

    if (candidate.name === 'AuthApiError' || candidate.status === 400 || candidate.status === 401) {
      return new AppError('AUTH', humanizeAuthMessage(candidate.message ?? ''), candidate.message);
    }

    if (candidate.message?.includes('Failed to fetch') || candidate.message?.includes('NetworkError')) {
      return new AppError('NETWORK', 'Koneksi ke server gagal. Periksa jaringan Anda lalu coba lagi.', candidate.message);
    }

    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      return new AppError('UNKNOWN', candidate.message, candidate.details ?? candidate.hint);
    }
  }

  return new AppError('UNKNOWN', 'Terjadi kesalahan yang tidak terduga. Coba lagi atau hubungi administrator.');
}

/** Menerjemahkan pesan autentikasi Supabase ke bahasa Indonesia. */
export function humanizeAuthMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Email atau password salah.';
  if (normalized.includes('email not confirmed')) return 'Email belum dikonfirmasi. Periksa kotak masuk Anda.';
  if (normalized.includes('user already registered')) return 'Email ini sudah terdaftar.';
  if (normalized.includes('password should be at least')) return 'Password terlalu pendek.';
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return 'Terlalu banyak percobaan. Tunggu beberapa saat sebelum mencoba lagi.';
  }
  if (normalized.includes('jwt') || normalized.includes('token')) {
    return 'Sesi Anda tidak valid atau sudah berakhir. Silakan login kembali.';
  }
  if (normalized.includes('same password')) return 'Password baru tidak boleh sama dengan password lama.';
  return 'Proses autentikasi gagal. Periksa data yang Anda masukkan.';
}

/** True bila error menandakan masalah sesi/izin. */
export function isAuthError(error: unknown): boolean {
  const appError = toAppError(error);
  return appError.kind === 'AUTH' || appError.kind === 'PERMISSION';
}

/** Pesan siap tampil dari error apa pun. */
export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
