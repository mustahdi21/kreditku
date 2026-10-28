/**
 * errors.test.ts — Penjaga pembedaan "fungsi belum di-deploy" dari "jaringan gagal".
 *
 * Keduanya tampak serupa bagi pengguna, tetapi tindakan yang harus diambil
 * berbeda jauh. Sebelumnya pesan jaringan dari supabase-js ikut dianggap sebagai
 * penanda fungsi yang tidak ada, sehingga gangguan koneksi sekilas menampilkan
 * instruksi deploy yang menyesatkan.
 */

import { describe, expect, it } from 'vitest';
import { AppError, isEdgeFunctionMissing, toAppError } from './errors';

describe('isEdgeFunctionMissing', () => {
  it('mengenali status 404', () => {
    expect(isEdgeFunctionMissing('apa pun', 404)).toBe(true);
  });

  it('mengenali penolakan platform yang menyatakan fungsi tidak ada', () => {
    expect(isEdgeFunctionMissing('Requested function was not found')).toBe(true);
    expect(isEdgeFunctionMissing('Function not found')).toBe(true);
    expect(
      isEdgeFunctionMissing('This endpoint relates to a function that was not deployed'),
    ).toBe(true);
  });

  it('TIDAK menganggap kegagalan jaringan sebagai fungsi yang tidak ada', () => {
    expect(isEdgeFunctionMissing('Failed to send a request to the Edge Function')).toBe(false);
    expect(isEdgeFunctionMissing('TypeError: Failed to fetch')).toBe(false);
    expect(isEdgeFunctionMissing('NetworkError when attempting to fetch resource.')).toBe(false);
  });

  it('TIDAK terpicu oleh angka 404 di dalam pesan bebas', () => {
    expect(isEdgeFunctionMissing('Permintaan gagal dengan kode 404 dari proksi')).toBe(false);
    expect(isEdgeFunctionMissing('Undangan gagal dikirim: 404 not found di penyedia email')).toBe(false);
  });

  it('TIDAK menganggap galat dari dalam fungsi sebagai fungsi yang tidak ada', () => {
    expect(isEdgeFunctionMissing('Undangan gagal dikirim: Email rate limit exceeded')).toBe(false);
    expect(isEdgeFunctionMissing('Hanya Super Admin yang boleh mengundang pengguna.')).toBe(false);
    expect(
      isEdgeFunctionMissing('Konfigurasi server tidak lengkap (SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY).'),
    ).toBe(false);
  });

  it('menerima objek error, bukan hanya teks', () => {
    const fetchError = Object.assign(new Error('Failed to send a request to the Edge Function'), {
      name: 'FunctionsFetchError',
    });
    expect(isEdgeFunctionMissing(fetchError)).toBe(false);
    expect(isEdgeFunctionMissing(new AppError('NETWORK', 'Koneksi ke server gagal.'))).toBe(false);
    expect(isEdgeFunctionMissing(null)).toBe(false);
    expect(isEdgeFunctionMissing(undefined)).toBe(false);
  });

  it('status eksplisit menang atas bentuk lain', () => {
    expect(isEdgeFunctionMissing(new Error('galat lain'), 404)).toBe(true);
  });
});

describe('toAppError tetap berperilaku seperti semula', () => {
  it('meneruskan pesan Bahasa Indonesia dari fungsi bisnis', () => {
    const error = toAppError({ code: '42501', message: 'Sesi tidak valid. Silakan login kembali.' });
    expect(error.kind).toBe('PERMISSION');
    expect(error.message).toBe('Sesi tidak valid. Silakan login kembali.');
  });

  it('mengganti pesan teknis PostgreSQL dengan padanan yang aman', () => {
    const error = toAppError({ code: '42501', message: 'permission denied for table customers' });
    expect(error.kind).toBe('PERMISSION');
    expect(error.message).toBe('Anda tidak memiliki hak untuk melakukan tindakan ini.');
  });
});
