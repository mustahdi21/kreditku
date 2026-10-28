import { describe, expect, it } from 'vitest';
import {
  applyRate,
  bigDivRound,
  clampRupiah,
  formatRupiah,
  formatRupiahNumber,
  MoneyError,
  parseRupiahInput,
  percentToBp,
  reconcile,
  roundRupiah,
  roundToInt,
  splitEvenly,
  splitProportional,
  sumRupiah,
} from '@/lib/money';

describe('money — validasi & pembulatan', () => {
  it('menolak nilai yang bukan integer Rupiah', () => {
    expect(() => roundRupiah(1000.5)).not.toThrow();
    expect(() => sumRupiah([1000.25])).toThrow(MoneyError);
  });

  it('membulatkan setengah ke atas menjauhi nol (HALF_UP)', () => {
    expect(roundToInt(2.5, 'HALF_UP')).toBe(3);
    expect(roundToInt(-2.5, 'HALF_UP')).toBe(-3);
    expect(roundToInt(2.4, 'HALF_UP')).toBe(2);
  });

  it('mendukung mode pembulatan lain', () => {
    expect(roundToInt(2.5, 'FLOOR')).toBe(2);
    expect(roundToInt(2.1, 'CEIL')).toBe(3);
    expect(roundToInt(2.9, 'TRUNCATE')).toBe(2);
    expect(roundToInt(2.5, 'HALF_EVEN')).toBe(2);
    expect(roundToInt(3.5, 'HALF_EVEN')).toBe(4);
  });

  it('membagi BigInt dengan mode pembulatan yang benar', () => {
    expect(bigDivRound(10n, 4n)).toBe(3n);
    expect(bigDivRound(10n, 4n, 'FLOOR')).toBe(2n);
    expect(bigDivRound(10n, 4n, 'CEIL')).toBe(3n);
    expect(bigDivRound(10n, 4n, 'TRUNCATE')).toBe(2n);
  });
});

describe('money — persentase eksak', () => {
  it('menghitung persentase tanpa galat floating point', () => {
    // 1.500.000 × 2,5% = 37.500
    expect(applyRate(1_500_000, percentToBp(2.5))).toBe(37_500);
    // 10.000.000 × 1,25% = 125.000
    expect(applyRate(10_000_000, percentToBp(1.25))).toBe(125_000);
  });

  it('menghasilkan pembulatan yang konsisten pada pecahan', () => {
    // 10.000 × 0,005% = 0,5 → dibulatkan HALF_UP menjadi 1
    expect(applyRate(10_000, 0.5)).toBe(1);
    // 9.999 × 0,005% = 0,49995 → 0
    expect(applyRate(9_999, 0.5)).toBe(0);
  });

  it('mendukung pembagian periode (tarif tahunan ÷ 12)', () => {
    // 12.000.000 × 12% per tahun ÷ 12 = 120.000 per bulan
    expect(applyRate(12_000_000, percentToBp(12), 12)).toBe(120_000);
  });

  it('mengembalikan nol untuk tarif nol', () => {
    expect(applyRate(1_000_000, 0)).toBe(0);
  });
});

describe('money — distribusi', () => {
  it('membagi rata dengan sisa pada periode terakhir', () => {
    expect(splitEvenly(1000, 3)).toEqual([333, 333, 334]);
    expect(splitEvenly(10, 6)).toEqual([1, 1, 1, 1, 1, 5]);
    expect(sumRupiah(splitEvenly(1_000_000, 7))).toBe(1_000_000);
  });

  it('tidak pernah menghasilkan bagian negatif', () => {
    for (const total of [1, 5, 10, 99, 100]) {
      for (const periods of [2, 3, 6, 7, 12]) {
        const parts = splitEvenly(total, periods);
        expect(parts.every((part) => part >= 0)).toBe(true);
        expect(sumRupiah(parts)).toBe(total);
      }
    }
  });

  it('membagi proporsional dan menjaga total', () => {
    expect(splitProportional(1000, [1, 1, 3])).toEqual([200, 200, 600]);
    expect(sumRupiah(splitProportional(999_999, [3, 5, 7, 11]))).toBe(999_999);
  });

  it('menolak pembagian dengan periode tidak valid', () => {
    expect(() => splitEvenly(1000, 0)).toThrow(MoneyError);
    expect(() => splitProportional(1000, [])).toThrow(MoneyError);
  });

  it('melaporkan rekonsiliasi pembulatan', () => {
    const result = reconcile(1000, [333, 333, 334]);
    expect(result.delta).toBe(0);
    const mismatch = reconcile(1000, [333, 333, 333]);
    expect(mismatch.delta).toBe(1);
  });
});

describe('money — format dan parsing', () => {
  it('memformat Rupiah gaya Indonesia', () => {
    expect(formatRupiah(1_500_000)).toBe('Rp1.500.000');
    expect(formatRupiahNumber(1_234_567_890)).toBe('1.234.567.890');
    expect(formatRupiah(-50_000)).toBe('-Rp50.000');
    expect(formatRupiah(50_000, { signed: true })).toBe('+Rp50.000');
  });

  it('mengurai input pengguna dengan berbagai format', () => {
    expect(parseRupiahInput('1.500.000')).toBe(1_500_000);
    expect(parseRupiahInput('Rp 1.500.000')).toBe(1_500_000);
    expect(parseRupiahInput('1500000')).toBe(1_500_000);
    expect(parseRupiahInput('-25.000')).toBe(-25_000);
    expect(parseRupiahInput('abc')).toBeNull();
    expect(parseRupiahInput('')).toBeNull();
    expect(parseRupiahInput(null)).toBeNull();
  });

  it('membatasi nilai pada rentang', () => {
    expect(clampRupiah(500, 1000, 2000)).toBe(1000);
    expect(clampRupiah(2500, 1000, 2000)).toBe(2000);
    expect(clampRupiah(1500, 1000, 2000)).toBe(1500);
  });
});
