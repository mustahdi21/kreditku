/**
 * qris.test.ts — Bukti bahwa QRIS statis benar-benar dapat diubah menjadi dinamis.
 *
 * Instrumen di sini menyangkut uang, jadi dua hal diuji secara khusus:
 *
 *   1. Implementasi CRC diperiksa terhadap VEKTOR UJI STANDAR, bukan terhadap
 *      keluarannya sendiri. Tanpa itu, CRC yang salah akan konsisten dengan
 *      dirinya sendiri dan seluruh tes lain tetap lulus.
 *   2. Tag yang tidak dikelola harus utuh. Perubahan hanya boleh menyentuh tag
 *      01 (cara inisiasi), 54 (nominal), dan 63 (CRC).
 */

import { describe, expect, it } from 'vitest';
import {
  crc16Ccitt,
  formatQrisAmount,
  parseTags,
  parseQris,
  QrisError,
  toDynamicQris,
  toStaticQris,
  verifyQrisCrc,
} from './qris';

/** Menyusun payload TLV lengkap dengan CRC, mengikuti aturan EMVCo. */
function buildPayload(tags: ReadonlyArray<readonly [string, string]>): string {
  const body = tags.map(([tag, value]) => `${tag}${value.length.toString().padStart(2, '0')}${value}`).join('');
  const withTemplate = `${body}6304`;
  return `${withTemplate}${crc16Ccitt(withTemplate)}`;
}

/** QR statis merchant: tanpa tag 01 dinamis dan tanpa tag 54. */
const STATIC_TAGS: ReadonlyArray<readonly [string, string]> = [
  ['00', '01'],
  ['01', '11'],
  ['26', '0014ID.CO.QRIS.WWW0215ID10221111111110303UMI'],
  ['51', '0014ID.CO.QRIS.WWW0215ID10221111111110303UMI'],
  ['52', '5411'],
  ['53', '360'],
  ['58', 'ID'],
  ['59', 'TOKO CONTOH'],
  ['60', 'JAKARTA'],
  ['61', '51034'],
  ['62', '0703A01'],
];

const STATIC_QRIS = buildPayload(STATIC_TAGS);

describe('CRC-16/CCITT-FALSE', () => {
  it('cocok dengan vektor uji standar "123456789" = 0x29B1', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1');
  });

  it('mengembalikan nilai awal saat tidak ada masukan', () => {
    expect(crc16Ccitt('')).toBe('FFFF');
  });

  it('selalu empat digit heksadesimal huruf besar', () => {
    for (const input of ['', 'A', 'QRIS', '123456789', '000201010211']) {
      expect(crc16Ccitt(input)).toMatch(/^[0-9A-F]{4}$/);
    }
  });

  it('peka terhadap perubahan satu karakter', () => {
    expect(crc16Ccitt('000201010211')).not.toBe(crc16Ccitt('000201010212'));
  });
});

describe('parseTags', () => {
  it('membaca pasangan tag-panjang-nilai', () => {
    expect(parseTags('000201010211')).toEqual([
      { tag: '00', value: '01' },
      { tag: '01', value: '11' },
    ]);
  });

  it('menolak payload kosong', () => {
    expect(() => parseTags('')).toThrow(QrisError);
  });

  it('menolak panjang yang melebihi sisa payload', () => {
    expect(() => parseTags('0005ab')).toThrow(/meminta 5 karakter/);
  });

  it('menolak tag atau panjang yang bukan angka', () => {
    expect(() => parseTags('0X0201')).toThrow(/bukan angka/);
    expect(() => parseTags('00XX01')).toThrow(/bukan angka/);
  });

  it('menolak tag yang muncul dua kali', () => {
    expect(() => parseTags('0002010102110002AB')).toThrow(/lebih dari sekali/);
  });
});

describe('verifyQrisCrc', () => {
  it('menerima payload yang CRC-nya benar', () => {
    expect(verifyQrisCrc(STATIC_QRIS)).toBe(true);
  });

  it('menolak payload yang CRC-nya diubah', () => {
    expect(verifyQrisCrc(`${STATIC_QRIS.slice(0, -4)}0000`)).toBe(false);
  });

  it('menerima CRC huruf kecil', () => {
    const lower = `${STATIC_QRIS.slice(0, -4)}${STATIC_QRIS.slice(-4).toLowerCase()}`;
    expect(verifyQrisCrc(lower)).toBe(true);
  });

  it('menolak payload tanpa tag CRC', () => {
    expect(verifyQrisCrc('000201010211')).toBe(false);
  });
});

describe('parseQris — membaca QR merchant', () => {
  it('mengenali QR statis beserta identitas merchant', () => {
    const parsed = parseQris(STATIC_QRIS);
    expect(parsed.isDynamic).toBe(false);
    expect(parsed.hasAmount).toBe(false);
    expect(parsed.amount).toBeNull();
    expect(parsed.currency).toBe('360');
    expect(parsed.merchantName).toBe('TOKO CONTOH');
    expect(parsed.merchantCity).toBe('JAKARTA');
    expect(parsed.crcValid).toBe(true);
  });

  it('tidak melempar untuk CRC yang salah, hanya melaporkannya', () => {
    const parsed = parseQris(`${STATIC_QRIS.slice(0, -4)}0000`);
    expect(parsed.crcValid).toBe(false);
  });
});

describe('formatQrisAmount', () => {
  it('menulis nominal bulat tanpa pemisah ribuan', () => {
    expect(formatQrisAmount(150000)).toBe('150000');
    expect(formatQrisAmount(1500)).toBe('1500');
  });

  it('memakai titik sebagai pemisah desimal dan membuang nol di belakang', () => {
    expect(formatQrisAmount(1500.5)).toBe('1500.5');
    expect(formatQrisAmount(1500.46)).toBe('1500.46');
    expect(formatQrisAmount(0.5)).toBe('0.5');
  });

  it('membulatkan ke dua angka di belakang koma', () => {
    expect(formatQrisAmount(1500.456)).toBe('1500.46');
    expect(formatQrisAmount(1500.004)).toBe('1500');
  });

  it('menolak nominal nol, negatif, dan bukan angka', () => {
    expect(() => formatQrisAmount(0)).toThrow(/lebih besar dari nol/);
    expect(() => formatQrisAmount(-1)).toThrow(/lebih besar dari nol/);
    expect(() => formatQrisAmount(Number.NaN)).toThrow(/bukan angka/);
    expect(() => formatQrisAmount(Number.POSITIVE_INFINITY)).toThrow(/bukan angka/);
  });

  it('menolak nominal yang melebihi 13 karakter', () => {
    expect(() => formatQrisAmount(99999999999999)).toThrow(/melebihi 13 karakter/);
  });
});

describe('toDynamicQris — menambahkan nominal', () => {
  const dynamic = toDynamicQris(STATIC_QRIS, 150000);

  it('menghasilkan CRC yang sah', () => {
    expect(verifyQrisCrc(dynamic)).toBe(true);
  });

  it('menandai QR sebagai dinamis dan memuat nominalnya', () => {
    const parsed = parseQris(dynamic);
    expect(parsed.isDynamic).toBe(true);
    expect(parsed.amount).toBe(150000);
    expect(parsed.hasAmount).toBe(true);
  });

  it('mempertahankan identitas merchant dan tag lain apa adanya', () => {
    const parsed = parseQris(dynamic);
    expect(parsed.merchantName).toBe('TOKO CONTOH');
    expect(parsed.merchantCity).toBe('JAKARTA');
    expect(parsed.currency).toBe('360');
    for (const tag of ['26', '51', '52', '58', '61', '62']) {
      const before = parseQris(STATIC_QRIS).tags.find((entry) => entry.tag === tag);
      const after = parsed.tags.find((entry) => entry.tag === tag);
      expect(after, `tag ${tag}`).toEqual(before);
    }
  });

  it('menyisipkan tag 54 pada urutan yang benar', () => {
    const tags = parseQris(dynamic).tags.map((entry) => entry.tag);
    expect(tags).toEqual([...tags].sort());
    expect(tags).toContain('54');
    expect(tags.indexOf('54')).toBeGreaterThan(tags.indexOf('53'));
    expect(tags.indexOf('54')).toBeLessThan(tags.indexOf('58'));
  });

  it('menempatkan tag 63 sebagai tag terakhir', () => {
    const tags = parseQris(dynamic).tags;
    expect(tags.at(-1)?.tag).toBe('63');
    expect(tags.at(-1)?.value).toHaveLength(4);
  });

  it('memuat nominal yang dapat dibaca ulang', () => {
    expect(parseQris(dynamic).tags.find((entry) => entry.tag === '54')?.value).toBe('150000');
  });

  it('mengganti nominal bila dikonversi ulang, bukan menambah tag baru', () => {
    const lagi = toDynamicQris(dynamic, 275000);
    const tags = parseQris(lagi).tags.filter((entry) => entry.tag === '54');
    expect(tags).toHaveLength(1);
    expect(parseQris(lagi).amount).toBe(275000);
    expect(verifyQrisCrc(lagi)).toBe(true);
  });

  it('menambahkan tag 01 bila QR sumber tidak memilikinya', () => {
    const tanpa01 = buildPayload([['00', '01'], ['53', '360'], ['59', 'TOKO CONTOH'], ['60', 'BANDUNG']]);
    const hasil = toDynamicQris(tanpa01, 10000);
    const parsed = parseQris(hasil);
    expect(parsed.isDynamic).toBe(true);
    expect(parsed.amount).toBe(10000);
    expect(verifyQrisCrc(hasil)).toBe(true);
  });

  it('menolak QR sumber yang CRC-nya tidak sah', () => {
    expect(() => toDynamicQris(`${STATIC_QRIS.slice(0, -4)}0000`, 150000)).toThrow(/CRC payload sumber tidak sah/);
  });

  it('menolak versi payload yang tidak didukung', () => {
    const versiLain = buildPayload([['00', '02'], ['01', '11'], ['53', '360']]);
    expect(() => toDynamicQris(versiLain, 1000)).toThrow(/tidak didukung/);
  });

  it('menolak nominal yang tidak sah sebelum menyentuh payload', () => {
    expect(() => toDynamicQris(STATIC_QRIS, 0)).toThrow(QrisError);
    expect(() => toDynamicQris(STATIC_QRIS, -5)).toThrow(QrisError);
  });

  it('menghasilkan payload yang berbeda untuk nominal berbeda', () => {
    expect(toDynamicQris(STATIC_QRIS, 10000)).not.toBe(toDynamicQris(STATIC_QRIS, 20000));
  });
});

describe('toStaticQris — kembali ke QR merchant', () => {
  it('mengembalikan QR tanpa nominal dengan CRC yang sah', () => {
    const kembali = toStaticQris(toDynamicQris(STATIC_QRIS, 150000));
    const parsed = parseQris(kembali);
    expect(parsed.hasAmount).toBe(false);
    expect(parsed.amount).toBeNull();
    expect(parsed.isDynamic).toBe(false);
    expect(parsed.crcValid).toBe(true);
  });

  it('menghasilkan ulang payload merchant yang setara', () => {
    const kembali = toStaticQris(toDynamicQris(STATIC_QRIS, 150000));
    expect(parseQris(kembali).tags).toEqual(parseQris(STATIC_QRIS).tags);
  });
});
