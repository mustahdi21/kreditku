/**
 * numbering.ts — Penomoran dokumen (pelanggan, kontrak, kuitansi, pengajuan).
 *
 * Template menggunakan token yang diapit kurung kurawal:
 *
 *   {ORG}      → kode organisasi
 *   {YYYY}     → tahun 4 digit (dari tanggal dokumen)
 *   {YY}       → tahun 2 digit
 *   {MM}       → bulan 2 digit
 *   {DD}       → tanggal 2 digit
 *   {ROMAN}    → bulan dalam angka Romawi
 *   {SEQ}      → nomor urut, tanpa padding
 *   {SEQ:n}    → nomor urut dengan padding n digit, mis. {SEQ:5} → 00042
 *   {TYPE}     → kode tipe dokumen (mis. CTR)
 *
 * Contoh template default:
 *   Pelanggan : CUST-{YYYY}{MM}-{SEQ:5}
 *   Kontrak   : CTR-{YYYY}-{SEQ:5}
 *   Kuitansi  : KWT-{YYYYMMDD}-{SEQ:4}
 *
 * Validasi template dilakukan sebelum disimpan pada pengaturan sehingga
 * kesalahan konfigurasi terdeteksi lebih awal.
 */

export const DEFAULT_NUMBER_TEMPLATES = {
  customer: 'CUST-{YYYY}{MM}-{SEQ:5}',
  contract: 'CTR-{YYYY}-{SEQ:5}',
  receipt: 'KWT-{YYYYMMDD}-{SEQ:4}',
  application: 'APP-{YYYY}{MM}-{SEQ:5}',
  payment_reversal: 'RVS-{YYYYMMDD}-{SEQ:4}',
} as const;

export type NumberTemplateKey = keyof typeof DEFAULT_NUMBER_TEMPLATES;

export const NUMBER_TEMPLATE_LABELS: Record<NumberTemplateKey, string> = {
  customer: 'Nomor Pelanggan',
  contract: 'Nomor Kontrak',
  receipt: 'Nomor Kuitansi',
  application: 'Nomor Pengajuan',
  payment_reversal: 'Nomor Pembatalan Pembayaran',
};

const TOKEN_RE = /\{([A-Z]+)(?::(\d{1,2}))?\}/g;
const SIMPLE_TOKENS = ['ORG', 'YY', 'MM', 'DD', 'ROMAN', 'SEQ', 'TYPE'];

const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
] as const;

/**
 * True bila nama token adalah gabungan satuan tanggal,
 * mis. YYYYMMDD, YYYYMM, MMDD.
 */
export function isDateCompositeToken(name: string): boolean {
  if (name === 'YYYY') return true;
  if (!/^(?:YYYY|YY|MM|DD)+$/.test(name)) return false;
  return name.length > 0;
}

/** Memecah token gabungan menjadi satuannya, mis. "YYYYMMDD" → ["YYYY","MM","DD"]. */
function splitDateComposite(name: string): string[] {
  const units: string[] = [];
  let cursor = 0;
  while (cursor < name.length) {
    const unit = ['YYYY', 'YY', 'MM', 'DD'].find((candidate) => name.startsWith(candidate, cursor));
    if (!unit) throw new Error(`Token tanggal tidak dikenal: ${name}`);
    units.push(unit);
    cursor += unit.length;
  }
  return units;
}

/** Merender token gabungan tanggal menjadi nilainya. */
function renderDateComposite(name: string, parts: { year: string; month: string; day: string }): string {
  return splitDateComposite(name)
    .map((unit) => {
      switch (unit) {
        case 'YYYY':
          return parts.year;
        case 'YY':
          return parts.year.slice(2);
        case 'MM':
          return parts.month;
        case 'DD':
          return parts.day;
        default:
          return '';
      }
    })
    .join('');
}

/** Verifikasi format template penomoran. */
export function validateNumberTemplate(template: string): { valid: boolean; error?: string } {
  if (!template || template.trim().length === 0) {
    return { valid: false, error: 'Template nomor tidak boleh kosong.' };
  }
  if (template.length > 120) return { valid: false, error: 'Template nomor terlalu panjang (maksimum 120 karakter).' };
  if (!template.includes('{SEQ')) {
    return { valid: false, error: 'Template harus menyertakan token {SEQ} agar nomor unik.' };
  }

  const matches = [...template.matchAll(TOKEN_RE)];
  const found = matcherTokens(template);
  if (found.unknown.length > 0) {
    return { valid: false, error: `Token tidak dikenal: ${found.unknown.join(', ')}.` };
  }
  if (matches.length === 0) {
    return { valid: false, error: 'Template tidak mengandung token yang valid.' };
  }
  const seqToken = template.match(/\{SEQ(?::(\d{1,2}))?\}/);
  if (!seqToken) return { valid: false, error: 'Token {SEQ} tidak valid.' };
  const seqTokenCount = (template.match(/\{SEQ(?::\d{1,2})?\}/g) ?? []).length;
  if (seqTokenCount > 1) {
    return { valid: false, error: 'Template hanya boleh memiliki satu token {SEQ}.' };
  }
  if (seqToken[1] && Number(seqToken[1]) > 10) {
    return { valid: false, error: 'Padding {SEQ:n} maksimum 10 digit.' };
  }

  const rendered = template.replace(TOKEN_RE, '');
  if (/[{}]/.test(rendered)) return { valid: false, error: 'Terdapat kurung kurawal yang tidak berpasangan.' };

  return { valid: true };
}

function matcherTokens(template: string): { used: string[]; unknown: string[] } {
  const used: string[] = [];
  const unknown: string[] = [];
  const raw = template.match(/\{([^}]*)\}/g) ?? [];
  for (const token of raw) {
    const inner = token.slice(1, -1);
    const name = inner.split(':')[0] ?? '';
    if (SIMPLE_TOKENS.includes(name) || isDateCompositeToken(name)) {
      if (!used.includes(name)) used.push(name);
    } else {
      unknown.push(token);
    }
  }
  return { used, unknown };
}

/** Parameter pembentukan nomor dokumen. */
export interface FormatDocumentNumberInput {
  readonly template: string;
  /** Tanggal dokumen dalam format YYYY-MM-DD. */
  readonly dateIso: string;
  /** Nomor urut (>= 1). */
  readonly sequence: number;
  /** Kode organisasi, mis. "PTM" untuk PT Maju. */
  readonly organizationCode?: string;
  /** Kode tipe dokumen, mis. "CTR". */
  readonly documentType?: string;
}

/** Membentuk nomor dokumen dari template. */
export function formatDocumentNumber(input: FormatDocumentNumberInput): string {
  const validation = validateNumberTemplate(input.template);
  if (!validation.valid) throw new Error(validation.error ?? 'Template nomor tidak valid.');
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error('Nomor urut harus bilangan bulat minimal 1.');
  }
  const [year, month, day] = input.dateIso.split('-');
  if (!year || !month || !day) throw new Error('Tanggal dokumen tidak valid.');
  const parts = { year, month, day };

  return input.template.replace(TOKEN_RE, (_full, token: string, padding?: string) => {
    switch (token) {
      case 'ORG':
        return input.organizationCode ?? 'ORG';
      case 'ROMAN':
        return ROMAN_MONTHS[Number(month) - 1] ?? '';
      case 'TYPE':
        return input.documentType ?? '';
      case 'SEQ': {
        const width = padding ? Number(padding) : 0;
        return width > 0 ? String(input.sequence).padStart(width, '0') : String(input.sequence);
      }
      default:
        if (isDateCompositeToken(token)) return renderDateComposite(token, parts);
        return '';
    }
  });
}

/**
 * Menghitung nomor urut berikutnya berdasarkan dokumen yang sudah ada.
 * Berguna untuk pratinjau di UI; penomoran sebenarnya dilakukan atomik di
 * database melalui fungsi `next_document_number()`.
 */
export function nextSequenceFrom(existing: readonly string[], template: string): number {
  let max = 0;
  for (const value of existing) {
    const sequence = extractSequence(value, template);
    if (sequence !== null && sequence > max) max = sequence;
  }
  return max + 1;
}

/** Menerjemahkan token template menjadi pola regex. */
function tokenPattern(token: string, padding?: string): string {
  switch (token) {
    case 'ORG':
      return '[A-Za-z0-9]+?';
    case 'ROMAN':
      return '(?:X|IX|VIII|VII|VI|V|IV|III|II|I)';
    case 'TYPE':
      return '[A-Za-z0-9]+?';
    case 'SEQ': {
      const width = padding ? Number(padding) : 0;
      return width > 0 ? `(?<seq>\\d{${width}})` : '(?<seq>\\d+)';
    }
    default:
      if (isDateCompositeToken(token)) {
        return splitDateComposite(token)
          .map((unit) => (unit === 'YYYY' ? '\\d{4}' : '\\d{2}'))
          .join('');
      }
      return '.*';
  }
}

/**
 * Menyusun regex dari template penomoran.
 * Setiap token menjadi pola dengan panjang yang diketahui sehingga nomor
 * dokumen dapat diverifikasi dan diurai kembali.
 */
export function compileNumberTemplate(template: string): RegExp {
  const tokenRe = /\{([A-Z]+)(?::(\d{1,2}))?\}/g;
  const parts: string[] = [];
  let cursor = 0;
  let match = tokenRe.exec(template);
  while (match !== null) {
    parts.push(escapeRegex(template.slice(cursor, match.index)));
    parts.push(tokenPattern(match[1]!, match[2]));
    cursor = match.index + match[0].length;
    match = tokenRe.exec(template);
  }
  parts.push(escapeRegex(template.slice(cursor)));
  return new RegExp(`^${parts.join('')}$`);
}

/** Mengambil kembali nomor urut dari sebuah nomor dokumen. */
export function extractSequence(value: string, template: string): number | null {
  const match = compileNumberTemplate(template).exec(value);
  const sequence = match?.groups?.seq;
  if (!sequence) return null;
  const parsed = Number(sequence);
  return Number.isInteger(parsed) ? parsed : null;
}

/** True bila nomor dokumen sesuai dengan template yang diberikan. */
export function matchesNumberTemplate(value: string, template: string): boolean {
  return compileNumberTemplate(template).test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
