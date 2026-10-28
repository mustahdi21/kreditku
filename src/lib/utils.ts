import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Menggabungkan kelas Tailwind dengan resolve konflik yang benar. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Menunda eksekusi (dipakai untuk debounce pencarian). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Membatasi nilai angka pada rentang. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Inisial nama untuk avatar. */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]!.toUpperCase()).join('');
}

/** Memotong teks dengan elipsis. */
export function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** UUID v4 sederhana untuk kunci antarmuka (bukan untuk kriptografi). */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Persentase aman (menghindari pembagian nol). */
export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

/** Mengelompokkan array berdasarkan kunci. */
export function groupBy<T, K extends string | number>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Membuat salinan objek tanpa kunci bernilai undefined. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as Partial<T>;
}
