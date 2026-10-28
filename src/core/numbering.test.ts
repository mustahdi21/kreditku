import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUMBER_TEMPLATES,
  extractSequence,
  formatDocumentNumber,
  nextSequenceFrom,
  validateNumberTemplate,
} from '@/core/numbering';

describe('numbering — validasi template', () => {
  it('menerima template default', () => {
    for (const template of Object.values(DEFAULT_NUMBER_TEMPLATES)) {
      expect(validateNumberTemplate(template).valid, template).toBe(true);
    }
  });

  it('menolak template tanpa token SEQ', () => {
    const result = validateNumberTemplate('CUST-{YYYY}{MM}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('{SEQ}');
  });

  it('menolak token yang tidak dikenal', () => {
    const result = validateNumberTemplate('CUST-{FOO}-{SEQ:4}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('{FOO}');
  });

  it('menolak template kosong dan padding berlebihan', () => {
    expect(validateNumberTemplate('').valid).toBe(false);
    expect(validateNumberTemplate('X-{SEQ:11}').valid).toBe(false);
  });

  it('menolak kurung kurawal tidak berpasangan', () => {
    expect(validateNumberTemplate('CUST-{YYYY-{SEQ:4}').valid).toBe(false);
  });
});

describe('numbering — pembentukan nomor', () => {
  it('membentuk nomor pelanggan', () => {
    const number = formatDocumentNumber({
      template: DEFAULT_NUMBER_TEMPLATES.customer,
      dateIso: '2026-03-15',
      sequence: 42,
    });
    expect(number).toBe('CUST-202603-00042');
  });

  it('membentuk nomor kontrak', () => {
    expect(
      formatDocumentNumber({
        template: DEFAULT_NUMBER_TEMPLATES.contract,
        dateIso: '2026-03-15',
        sequence: 1,
      }),
    ).toBe('CTR-2026-00001');
  });

  it('membentuk nomor kuitansi harian', () => {
    expect(
      formatDocumentNumber({
        template: DEFAULT_NUMBER_TEMPLATES.receipt,
        dateIso: '2026-03-15',
        sequence: 7,
      }),
    ).toBe('KWT-20260315-0007');
  });

  it('mendukung token ORG, TYPE, dan ROMAN', () => {
    expect(
      formatDocumentNumber({
        template: '{ORG}/{ROMAN}/{YY}-{TYPE}-{SEQ:3}',
        dateIso: '2026-03-15',
        sequence: 5,
        organizationCode: 'MAJU',
        documentType: 'CTR',
      }),
    ).toBe('MAJU/III/26-CTR-005');
  });

  it('menolak template tidak valid saat pembentukan', () => {
    expect(() =>
      formatDocumentNumber({ template: 'NO-SEQ', dateIso: '2026-03-15', sequence: 1 }),
    ).toThrow();
  });

  it('menolak nomor urut nol atau negatif', () => {
    expect(() =>
      formatDocumentNumber({ template: DEFAULT_NUMBER_TEMPLATES.contract, dateIso: '2026-03-15', sequence: 0 }),
    ).toThrow();
  });
});

describe('numbering — urutan berikutnya', () => {
  it('menghitung nomor urut berikutnya dari dokumen yang ada', () => {
    const existing = ['CTR-2026-00001', 'CTR-2026-00007', 'CTR-2025-00009'];
    expect(nextSequenceFrom(existing, DEFAULT_NUMBER_TEMPLATES.contract)).toBe(10);
  });

  it('mengambil kembali nomor urut dari sebuah nomor dokumen', () => {
    expect(extractSequence('KWT-20260315-0007', DEFAULT_NUMBER_TEMPLATES.receipt)).toBe(7);
    expect(extractSequence('tidak-valid', DEFAULT_NUMBER_TEMPLATES.receipt)).toBeNull();
  });

  it('memulai dari 1 bila belum ada dokumen', () => {
    expect(nextSequenceFrom([], DEFAULT_NUMBER_TEMPLATES.customer)).toBe(1);
  });
});
