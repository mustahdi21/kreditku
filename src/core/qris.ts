/**
 * qris.ts — Konversi QRIS statis menjadi QRIS dinamis.
 *
 * LATAR
 * -----
 * QRIS mengikuti format EMVCo: rangkaian pasangan tag–panjang–nilai (TLV), dua
 * digit tag, dua digit panjang, lalu nilainya. Beberapa tag yang menentukan di
 * sini:
 *
 *   00  versi format, harus '01'
 *   01  cara inisiasi: '11' statis, '12' dinamis
 *   53  mata uang, '360' untuk rupiah
 *   54  nominal transaksi — TIDAK ada pada QR statis
 *   59  nama merchant
 *   60  kota merchant
 *   63  CRC, selalu tag terakhir dengan panjang 04
 *
 * QR statis yang dipajang di meja kas tidak memuat nominal, sehingga pemindai
 * meminta pelanggan mengetik jumlahnya sendiri. Mengubahnya menjadi dinamis
 * berarti menambahkan tag 54 berisi nominal, mengubah tag 01 menjadi '12', lalu
 * menghitung ulang CRC — karena CRC dihitung atas seluruh isi termasuk tag 54.
 *
 * CRC yang dipakai adalah CRC-16/CCITT-FALSE: polinomial 0x1021, nilai awal
 * 0xFFFF, tanpa pembalikan bit, tanpa XOR akhir, dihitung atas seluruh payload
 * ditambah template tag 63 ('6304'). Implementasinya diperiksa terhadap vektor
 * uji standar di qris.test.ts, bukan hanya terhadap keluaran dirinya sendiri.
 *
 * KEAMANAN
 * --------
 * Modul ini hanya menyusun data dan tidak pernah mengubah nominal yang sudah
 * ada tanpa diminta: nominal selalu berasal dari parameter, bukan dari QR
 * sumber. Payload masukan ditolak bila CRC-nya tidak sah, supaya salah ketik
 * pada QR merchant tidak menghasilkan QR yang tampak sah tetapi mengarah ke
 * rekening lain.
 */

/** Tag yang dikelola modul ini. */
const TAG_PAYLOAD_FORMAT = '00';
const TAG_POINT_OF_INITIATION = '01';
const TAG_TRANSACTION_AMOUNT = '54';
const TAG_CRC = '63';

const FORMAT_VERSION = '01';
const POINT_STATIC = '11';
const POINT_DYNAMIC = '12';
const CRC_LENGTH = 4;
const CRC_TEMPLATE = `${TAG_CRC}0${CRC_LENGTH}`;
const MAX_AMOUNT_LENGTH = 13;

export class QrisError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'QrisError';
    this.code = code;
  }
}

export interface QrisTag {
  readonly tag: string;
  readonly value: string;
}

export interface ParsedQris {
  readonly payload: string;
  readonly tags: readonly QrisTag[];
  readonly isDynamic: boolean;
  readonly hasAmount: boolean;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly merchantName: string | null;
  readonly merchantCity: string | null;
  readonly crcValid: boolean;
}

/** CRC-16/CCITT-FALSE atas seluruh payload ditambah template '6304'. */
export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(CRC_LENGTH, '0');
}

/** Memisahkan payload menjadi daftar tag, menolak bentuk yang tidak sah. */
export function parseTags(payload: string): QrisTag[] {
  const text = payload ?? '';
  if (text.length === 0) {
    throw new QrisError('EMPTY', 'Payload QRIS kosong.');
  }

  const tags: QrisTag[] = [];
  const seen = new Set<string>();
  let index = 0;

  while (index < text.length) {
    if (index + 4 > text.length) {
      throw new QrisError('TRUNCATED', `Payload terpotong pada posisi ${index}: tag dan panjang tidak lengkap.`);
    }
    const tag = text.slice(index, index + 2);
    const rawLength = text.slice(index + 2, index + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(rawLength)) {
      throw new QrisError('MALFORMED', `Tag atau panjang bukan angka pada posisi ${index}.`);
    }
    const length = Number(rawLength);
    const start = index + 4;
    if (start + length > text.length) {
      throw new QrisError(
        'TRUNCATED',
        `Nilai untuk tag ${tag} meminta ${length} karakter tetapi tersisa ${text.length - start}.`,
      );
    }
    if (seen.has(tag)) {
      throw new QrisError('DUPLICATE_TAG', `Tag ${tag} muncul lebih dari sekali.`);
    }
    seen.add(tag);
    tags.push({ tag, value: text.slice(start, start + length) });
    index = start + length;
  }

  return tags;
}

function findTag(tags: readonly QrisTag[], tag: string): string | null {
  return tags.find((entry) => entry.tag === tag)?.value ?? null;
}

function encodeTag(tag: string, value: string): string {
  if (value.length > 99) {
    throw new QrisError('VALUE_TOO_LONG', `Nilai tag ${tag} melebihi 99 karakter.`);
  }
  return `${tag}${value.length.toString().padStart(2, '0')}${value}`;
}

/** Payload tanpa tag CRC, dipakai saat menghitung ulang. */
function payloadWithoutCrc(tags: readonly QrisTag[]): string {
  return tags
    .filter((entry) => entry.tag !== TAG_CRC)
    .map((entry) => encodeTag(entry.tag, entry.value))
    .join('');
}

/** Menghitung CRC dan mengembalikan payload lengkap. */
function withCrc(tags: readonly QrisTag[]): string {
  const withoutCrc = payloadWithoutCrc(tags);
  return `${withoutCrc}${CRC_TEMPLATE}${crc16Ccitt(`${withoutCrc}${CRC_TEMPLATE}`)}`;
}

/** Menyisipkan atau mengganti tag sesuai urutan tag menaik. */
function upsertTag(tags: readonly QrisTag[], tag: string, value: string): QrisTag[] {
  const result: QrisTag[] = [];
  let inserted = false;

  for (const entry of tags) {
    if (entry.tag === tag) {
      result.push({ tag, value });
      inserted = true;
      continue;
    }
    if (!inserted && entry.tag > tag) {
      result.push({ tag, value });
      inserted = true;
    }
    result.push(entry);
  }

  if (!inserted) result.push({ tag, value });
  return result;
}

/** True bila tag 63 ada dan cocok dengan hasil hitung ulang. */
export function verifyQrisCrc(payload: string): boolean {
  let tags: QrisTag[];
  try {
    tags = parseTags(payload);
  } catch {
    return false;
  }
  const stored = findTag(tags, TAG_CRC);
  if (!stored || stored.length !== CRC_LENGTH) return false;
  return crc16Ccitt(`${payloadWithoutCrc(tags)}${CRC_TEMPLATE}`) === stored.toUpperCase();
}

/** Membaca isi payload QRIS. Tidak melempar untuk CRC yang salah. */
export function parseQris(payload: string): ParsedQris {
  const tags = parseTags(payload);
  const amountRaw = findTag(tags, TAG_TRANSACTION_AMOUNT);
  const amount = amountRaw === null ? null : Number(amountRaw);

  return {
    payload,
    tags,
    isDynamic: findTag(tags, TAG_POINT_OF_INITIATION) === POINT_DYNAMIC,
    hasAmount: amountRaw !== null,
    amount: amount === null || !Number.isFinite(amount) ? null : amount,
    currency: findTag(tags, '53'),
    merchantName: findTag(tags, '59'),
    merchantCity: findTag(tags, '60'),
    crcValid: verifyQrisCrc(payload),
  };
}

/**
 * Memformat nominal untuk tag 54.
 *
 * Aturannya ketat: pemisah desimal titik, tanpa pemisah ribuan, tanpa nol di
 * belakang koma, dan panjang total maksimal 13 karakter. Nominal rupiah pada
 * praktiknya bilangan bulat.
 */
export function formatQrisAmount(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new QrisError('AMOUNT_NOT_FINITE', 'Nominal bukan angka yang sah.');
  }
  if (amount <= 0) {
    throw new QrisError('AMOUNT_NOT_POSITIVE', 'Nominal harus lebih besar dari nol.');
  }

  const rounded = Math.round(amount * 100) / 100;
  const text = rounded.toFixed(2).replace(/\.?0+$/, '');
  if (text.length > MAX_AMOUNT_LENGTH) {
    throw new QrisError('AMOUNT_TOO_LONG', `Nominal melebihi ${MAX_AMOUNT_LENGTH} karakter.`);
  }
  return text;
}

/**
 * Mengubah QRIS statis menjadi dinamis dengan nominal tertentu.
 *
 * Tag 01 diubah menjadi '12' (bila belum ada, ditambahkan), tag 54 diisi
 * nominal, dan tag 63 dihitung ulang. Tag lain dipertahankan apa adanya.
 */
export function toDynamicQris(staticPayload: string, amount: number): string {
  const tags = parseTags(staticPayload);

  const format = findTag(tags, TAG_PAYLOAD_FORMAT);
  if (format !== FORMAT_VERSION) {
    throw new QrisError('UNSUPPORTED_VERSION', `Versi payload '${format ?? '-'}' tidak didukung; diharapkan '01'.`);
  }
  if (!verifyQrisCrc(staticPayload)) {
    throw new QrisError('CRC_INVALID', 'CRC payload sumber tidak sah. Periksa kembali QR merchant yang disalin.');
  }

  let result = tags.filter((entry) => entry.tag !== TAG_CRC);
  result = upsertTag(result, TAG_POINT_OF_INITIATION, POINT_DYNAMIC);
  result = upsertTag(result, TAG_TRANSACTION_AMOUNT, formatQrisAmount(amount));
  return withCrc(result);
}

/**
 * Menghapus nominal sehingga kembali menjadi QRIS statis.
 *
 * Dipakai untuk menguji dan untuk menampilkan kembali QR asal merchant.
 */
export function toStaticQris(dynamicPayload: string): string {
  const tags = parseTags(dynamicPayload).filter(
    (entry) => entry.tag !== TAG_CRC && entry.tag !== TAG_TRANSACTION_AMOUNT,
  );
  const withoutCrc = upsertTag(tags, TAG_POINT_OF_INITIATION, POINT_STATIC);
  return withCrc(withoutCrc);
}
