/**
 * date.ts — Utilitas tanggal untuk KreditKu.
 *
 * ATURAN PENTING
 * --------------
 * Seluruh tanggal bisnis direpresentasikan sebagai string ISO tanggal-saja
 * ("YYYY-MM-DD") TANPA komponen waktu dan TANPA zona waktu. Ini mencegah
 * pergeseran hari akibat konversi UTC ↔ zona waktu lokal (masalah klasik
 * pada aplikasi keuangan).
 *
 * Waktu saat ini diperoleh melalui `todayIso()` yang menghormati zona waktu
 * aplikasi (default Asia/Jakarta).
 */

import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, isValid, parse } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import type { PaymentFrequency } from '@/core/types';

export const DEFAULT_TIMEZONE = 'Asia/Jakarta';
export const DEFAULT_LOCALE = 'id-ID';

/** Hari akhir pekan default (0 = Minggu, 6 = Sabtu). */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [0, 6];

/** Regex tanggal ISO sederhana. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True bila string berbentuk tanggal ISO tanggal-saja yang valid. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  return isValid(parse(value, 'yyyy-MM-dd', new Date()));
}

/** Validasi ketat; melempar Error bila bukan tanggal ISO valid. */
export function assertIsoDate(value: unknown, label = 'tanggal'): string {
  if (!isIsoDate(value)) throw new Error(`${label} harus berformat YYYY-MM-DD (diterima: ${String(value)}).`);
  return value;
}

/** Mengubah string ISO menjadi Date lokal pada tengah malam. */
export function parseIsoDate(value: string): Date {
  return parse(assertIsoDate(value), 'yyyy-MM-dd', new Date());
}

/** Mengubah Date menjadi string ISO tanggal-saja (menggunakan komponen lokal). */
export function toIsoDate(value: Date): string {
  if (!isValid(value)) throw new Error('Tanggal tidak valid.');
  return format(value, 'yyyy-MM-dd');
}

/**
 * Tanggal hari ini menurut zona waktu tertentu.
 * Menggunakan Intl agar tidak bergantung pada zona waktu mesin.
 */
export function todayIso(timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return toIsoDate(new Date());
  }
}

/** Tanggal + waktu saat ini dalam zona waktu tertentu (ISO 8601 lengkap). */
export function nowIsoWithOffset(timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());
    return `${parts.replace(' ', 'T')}`;
  } catch {
    return new Date().toISOString();
  }
}

/** Menambahkan sejumlah periode pada tanggal ISO. */
export function addPeriodsIso(dateIso: string, count: number, frequency: PaymentFrequency): string {
  const base = parseIsoDate(dateIso);
  switch (frequency) {
    case 'MONTHLY':
      return toIsoDate(addMonths(base, count));
    case 'BIWEEKLY':
      return toIsoDate(addWeeks(base, count * 2));
    case 'WEEKLY':
      return toIsoDate(addWeeks(base, count));
    case 'DAILY':
      return toIsoDate(addDays(base, count));
    default:
      throw new Error(`Frekuensi pembayaran tidak dikenal: ${String(frequency)}`);
  }
}

/** Menambahkan sejumlah hari pada tanggal ISO. */
export function addDaysIso(dateIso: string, days: number): string {
  return toIsoDate(addDays(parseIsoDate(dateIso), days));
}

/** Menambahkan sejumlah bulan pada tanggal ISO (dengan pembatasan akhir bulan). */
export function addMonthsIso(dateIso: string, months: number): string {
  return toIsoDate(addMonths(parseIsoDate(dateIso), months));
}

/** Selisih hari kalender (b − a). Hasil negatif bila b lebih awal. */
export function daysBetweenIso(a: string, b: string): number {
  return differenceInCalendarDays(parseIsoDate(b), parseIsoDate(a));
}

/** Perbandingan dua tanggal ISO: -1 bila a < b, 0 bila sama, 1 bila a > b. */
export function compareIsoDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** True bila a lebih awal dari b. */
export function isBeforeIso(a: string, b: string): boolean {
  return compareIsoDate(a, b) < 0;
}

/** True bila a setelah b. */
export function isAfterIso(a: string, b: string): boolean {
  return compareIsoDate(a, b) > 0;
}

/** True bila tanggal berada di antara rentang inklusif. */
export function isWithinIsoRange(dateIso: string, from: string, to: string): boolean {
  return compareIsoDate(dateIso, from) >= 0 && compareIsoDate(dateIso, to) <= 0;
}

/** Hari pertama bulan dari tanggal tertentu ("YYYY-MM-01"). */
export function startOfMonthIso(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/** Hari terakhir bulan dari tanggal tertentu. */
export function endOfMonthIso(dateIso: string): string {
  const date = parseIsoDate(dateIso);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return toIsoDate(last);
}

/** Rentang awal/akhir bulan berjalan. */
export function currentMonthRange(today: string): { from: string; to: string } {
  return { from: startOfMonthIso(today), to: endOfMonthIso(today) };
}

/** True bila tanggal jatuh pada akhir pekan menurut konfigurasi. */
export function isWeekendIso(dateIso: string, weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS): boolean {
  const day = parseIsoDate(dateIso).getDay();
  return weekendDays.includes(day);
}

/** True bila tanggal termasuk hari libur yang dikonfigurasi. */
export function isHolidayIso(dateIso: string, holidays: readonly string[] = []): boolean {
  return holidays.includes(dateIso);
}

/** True bila tanggal adalah hari kerja (bukan akhir pekan dan bukan hari libur). */
export function isBusinessDayIso(
  dateIso: string,
  holidays: readonly string[] = [],
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
): boolean {
  return !isWeekendIso(dateIso, weekendDays) && !isHolidayIso(dateIso, holidays);
}

/**
 * Menggeser tanggal ke hari kerja terdekat.
 * Mengembalikan tanggal yang sama bila bukan hari kerja tidak diperlukan.
 * Maksimum pergeseran dibatasi 30 hari untuk mencegah loop tak berujung.
 */
export function shiftToBusinessDay(
  dateIso: string,
  direction: 'PREVIOUS' | 'NEXT',
  holidays: readonly string[] = [],
  weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS,
): string {
  let current = dateIso;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (isBusinessDayIso(current, holidays, weekendDays)) return current;
    current = addDaysIso(current, direction === 'PREVIOUS' ? -1 : 1);
  }
  return dateIso;
}

/** Format tanggal Indonesia, mis. 28 Oktober 2026. */
export function formatDateId(dateIso: string | null | undefined, pattern = 'd MMMM yyyy'): string {
  if (!dateIso) return '-';
  if (!isIsoDate(dateIso)) return '-';
  return format(parseIsoDate(dateIso), pattern, { locale: idLocale });
}

/** Format tanggal ringkas, mis. 28 Okt 2026. */
export function formatDateShortId(dateIso: string | null | undefined): string {
  return formatDateId(dateIso, 'd MMM yyyy');
}

/** Format tanggal-angka Indonesia, mis. 28/10/2026. */
export function formatDateNumericId(dateIso: string | null | undefined): string {
  return formatDateId(dateIso, 'dd/MM/yyyy');
}

/** Format bulan Indonesia, mis. Oktober 2026. */
export function formatMonthId(dateIso: string | null | undefined): string {
  return formatDateId(dateIso, 'MMMM yyyy');
}

/** Nama hari Indonesia, mis. Rabu. */
export function formatDayNameId(dateIso: string): string {
  return formatDateId(dateIso, 'EEEE');
}

/** Format tanggal dan waktu dari timestamp ISO lengkap. */
export function formatDateTimeId(timestamp: string | null | undefined): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (!isValid(date)) return '-';
  return format(date, 'd MMM yyyy HH:mm', { locale: idLocale });
}

/** Format jam saja (HH:mm). */
export function formatTimeId(timestamp: string | null | undefined): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (!isValid(date)) return '-';
  return format(date, 'HH:mm', { locale: idLocale });
}

/** Label relatif singkat untuk keterlambatan, mis. "3 hari". */
export function describeDaysOffset(days: number): string {
  if (days === 0) return 'hari ini';
  if (days > 0) return `${days} hari lagi`;
  return `${Math.abs(days)} hari terlambat`;
}

/** Daftar bulan (ISO awal bulan) sebanyak n bulan ke belakang dari tanggal tertentu. */
export function lastNMonths(todayIsoDate: string, n: number): string[] {
  const result: string[] = [];
  for (let index = n - 1; index >= 0; index -= 1) {
    result.push(startOfMonthIso(addMonthsIso(todayIsoDate, -index)));
  }
  return result;
}

/** Rentang tanggal preset untuk filter laporan. */
export type DateRangePreset =
  | 'TODAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'LAST_YEAR'
  | 'CUSTOM';

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  TODAY: 'Hari Ini',
  LAST_7_DAYS: '7 Hari Terakhir',
  LAST_30_DAYS: '30 Hari Terakhir',
  THIS_MONTH: 'Bulan Ini',
  LAST_MONTH: 'Bulan Lalu',
  THIS_YEAR: 'Tahun Ini',
  LAST_YEAR: 'Tahun Lalu',
  CUSTOM: 'Kustom',
};

/** Menghitung rentang tanggal untuk sebuah preset. */
export function resolveDateRange(
  preset: DateRangePreset,
  today: string = todayIso(),
): { from: string; to: string } {
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'LAST_7_DAYS':
      return { from: addDaysIso(today, -6), to: today };
    case 'LAST_30_DAYS':
      return { from: addDaysIso(today, -29), to: today };
    case 'THIS_MONTH':
      return currentMonthRange(today);
    case 'LAST_MONTH': {
      const previousMonthDay = addMonthsIso(startOfMonthIso(today), -1);
      return currentMonthRange(previousMonthDay);
    }
    case 'THIS_YEAR':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'LAST_YEAR': {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case 'CUSTOM':
    default:
      return { from: today, to: today };
  }
}
