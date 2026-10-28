/**
 * Toaster.tsx — Notifikasi toast aplikasi (berbasis Sonner).
 * Semua pesan sukses/gagal operasi melewati helper di bawah agar konsisten.
 */

import { Toaster as SonnerToaster, toast } from 'sonner';
import { errorMessage } from '@/lib/errors';

export function AppToaster(): JSX.Element {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      richColors
      duration={4500}
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border bg-background text-foreground shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}

/** Menampilkan pesan sukses. */
export function notifySuccess(message: string, description?: string): void {
  toast.success(message, { description });
}

/** Menampilkan pesan informasi. */
export function notifyInfo(message: string, description?: string): void {
  toast.info(message, { description });
}

/** Menampilkan pesan peringatan (mis. fitur belum dikonfigurasi). */
export function notifyWarning(message: string, description?: string): void {
  toast.warning(message, { description });
}

/** Menampilkan pesan kegagalan dengan pesan yang sudah dinormalisasi. */
export function notifyError(error: unknown, fallback?: string): void {
  toast.error(fallback ?? 'Operasi gagal', { description: errorMessage(error) });
}

/** Menampilkan toast proses yang berjalan. */
export function notifyLoading(message: string): string | number {
  return toast.loading(message);
}

/** Menutup toast tertentu. */
export function dismissToast(id?: string | number): void {
  toast.dismiss(id);
}

export { toast };
