/**
 * client.test.ts — Menguji pembantu akses data yang bersifat murni.
 */

import { describe, expect, it } from 'vitest';
import { pageRange, sanitizeSearchTerm, todayIso } from '@/data/client';

describe('data/client — paginasi', () => {
  it('menghitung rentang halaman yang benar', () => {
    expect(pageRange(1, 20)).toEqual({ from: 0, to: 19 });
    expect(pageRange(2, 20)).toEqual({ from: 20, to: 39 });
    expect(pageRange(5, 10)).toEqual({ from: 40, to: 49 });
  });

  it('menormalkan halaman dan ukuran yang tidak valid', () => {
    expect(pageRange(0, 20)).toEqual({ from: 0, to: 19 });
    expect(pageRange(-3, 20)).toEqual({ from: 0, to: 19 });
    expect(pageRange(1, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('data/client — pembersihan istilah pencarian', () => {
  it('menghapus karakter yang bermakna khusus pada filter PostgREST', () => {
    expect(sanitizeSearchTerm('Budi Santoso')).toBe('Budi Santoso');
    expect(sanitizeSearchTerm('100%,google.com')).toBe('100 google.com');
    expect(sanitizeSearchTerm('nama(aneh)*')).toBe('nama aneh');
  });

  it('membatasi panjang istilah pencarian', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeSearchTerm(long).length).toBeLessThanOrEqual(80);
  });

  it('menangani nilai kosong', () => {
    expect(sanitizeSearchTerm('   ')).toBe('');
    expect(sanitizeSearchTerm('')).toBe('');
  });
});

describe('data/client — tanggal hari ini', () => {
  it('menghasilkan format YYYY-MM-DD', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
