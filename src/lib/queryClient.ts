/**
 * queryClient.ts — Konfigurasi React Query untuk seluruh aplikasi.
 *
 * Kebijakan:
 *   * Data dianggap basi setelah 30 detik (data keuangan harus segar).
 *   * Tidak ada refetch otomatis saat jendela kembali fokus (menghemat kuota
 *     dan menghindari beban server pada aplikasi internal).
 *   * Satu kali percobaan ulang untuk kegagalan jaringan, tanpa mengulang
 *     kegagalan validasi/izin.
 */

import { QueryClient } from '@tanstack/react-query';
import { toAppError } from '@/lib/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const appError = toAppError(error);
        if (['PERMISSION', 'VALIDATION', 'AUTH', 'NOT_FOUND', 'CONFIGURATION'].includes(appError.kind)) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
