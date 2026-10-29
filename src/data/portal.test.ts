/**
 * portal.test.ts — Uji logika portal pelanggan yang murni.
 *
 * Dua hal diuji di sini karena keduanya menyangkut angka yang dilihat pelanggan:
 *
 *   1. Urutan tagihan. Yang terlambat harus muncul lebih dulu, karena itu yang
 *      paling mendesak — bukan yang paling awal jatuh temponya.
 *   2. Penyusunan QR pembayaran. Nominal yang tertanam di QR harus sama persis
 *      dengan yang dihitung server; QR dengan nominal berbeda berarti pelanggan
 *      membayar angka yang salah.
 */

import { describe, expect, it } from 'vitest';
import { crc16Ccitt, parseQris, verifyQrisCrc } from '@/core/qris';
import {
  buildPaymentQrPayload,
  contractOutstanding,
  formatRupiah,
  isOverdue,
  payableInstallments,
  totalOutstanding,
} from './portal';
import type { InstallmentDetailRow } from './types';

const STATIC_TAGS: ReadonlyArray<readonly [string, string]> = [
  ['00', '01'],
  ['01', '11'],
  ['53', '360'],
  ['58', 'ID'],
  ['59', 'TOKO CONTOH'],
  ['60', 'JAKARTA'],
];

const STATIC_QRIS = (() => {
  const body = STATIC_TAGS.map(([tag, value]) => `${tag}${value.length.toString().padStart(2, '0')}${value}`).join('');
  const withTemplate = `${body}6304`;
  return `${withTemplate}${crc16Ccitt(withTemplate)}`;
})();

function cicilan(overrides: Partial<InstallmentDetailRow>): InstallmentDetailRow {
  return {
    id: 'i-1',
    organization_id: 'o-1',
    contract_id: 'c-1',
    contract_number: 'K-1',
    installment_number: 1,
    base_due_date: '2026-01-01',
    due_date: '2026-01-01',
    principal: 500000,
    interest: 50000,
    fees: 0,
    total_due: 550000,
    paid_amount: 0,
    penalty_paid_amount: 0,
    outstanding: 550000,
    last_payment_date: null,
    stored_status: 'PENDING',
    status: 'PENDING',
    late_days: 0,
    aging_bucket: 'LANCAR',
    penalty_outstanding: 0,
    penalty_amount: 0,
    penalty_id: null,
    penalty_status: null,
    customer_id: 'cust-1',
    customer_number: 'C-1',
    customer_name: 'Pelanggan',
    customer_phone: '081200000000',
    remind_enabled: true,
    ...overrides,
  } as InstallmentDetailRow;
}

describe('payableInstallments — apa yang perlu dibayar dan dalam urutan apa', () => {
  it('menyaring cicilan yang sudah lunas dan yang dibatalkan', () => {
    const rows = [
      cicilan({ id: 'lunas', outstanding: 0, penalty_outstanding: 0 }),
      cicilan({ id: 'batal', stored_status: 'CANCELLED', outstanding: 550000 }),
      cicilan({ id: 'bayar', outstanding: 550000 }),
    ];
    expect(payableInstallments(rows).map((row) => row.id)).toEqual(['bayar']);
  });

  it('tetap menampilkan cicilan yang hanya menyisakan denda', () => {
    const rows = [cicilan({ id: 'denda-saja', outstanding: 0, penalty_outstanding: 25000 })];
    expect(payableInstallments(rows).map((row) => row.id)).toEqual(['denda-saja']);
  });

  it('mendahulukan yang terlambat meski jatuh temponya paling akhir', () => {
    const rows = [
      cicilan({ id: 'dekat', due_date: '2026-02-01', late_days: 0 }),
      cicilan({ id: 'telat', due_date: '2026-01-01', late_days: 30 }),
    ];
    expect(payableInstallments(rows).map((row) => row.id)).toEqual(['telat', 'dekat']);
  });

  it('mengurutkan yang belum terlambat menurut jatuh tempo terdekat', () => {
    const rows = [
      cicilan({ id: 'maret', due_date: '2026-03-01' }),
      cicilan({ id: 'februari', due_date: '2026-02-01' }),
    ];
    expect(payableInstallments(rows).map((row) => row.id)).toEqual(['februari', 'maret']);
  });

  it('tidak mengubah larik masukan', () => {
    const rows = [cicilan({ id: 'b', due_date: '2026-03-01' }), cicilan({ id: 'a', due_date: '2026-02-01' })];
    payableInstallments(rows);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('totalOutstanding', () => {
  it('menjumlahkan pokok dan denda secara terpisah', () => {
    const rows = [
      cicilan({ outstanding: 550000, penalty_outstanding: 25000 }),
      cicilan({ outstanding: 550000, penalty_outstanding: 0 }),
    ];
    expect(totalOutstanding(rows)).toEqual({ pokok: 1100000, denda: 25000, total: 1125000 });
  });

  it('mengabaikan yang sudah lunas', () => {
    const rows = [cicilan({ outstanding: 0, penalty_outstanding: 0 }), cicilan({ outstanding: 100000 })];
    expect(totalOutstanding(rows)).toEqual({ pokok: 100000, denda: 0, total: 100000 });
  });

  it('mengembalikan nol untuk daftar kosong', () => {
    expect(totalOutstanding([])).toEqual({ pokok: 0, denda: 0, total: 0 });
  });
});

describe('contractOutstanding — batas nominal per kontrak', () => {
  it('hanya menghitung cicilan kontrak yang diminta', () => {
    const rows = [
      cicilan({ id: 'a1', contract_id: 'c-1', outstanding: 550000, penalty_outstanding: 0 }),
      cicilan({ id: 'a2', contract_id: 'c-1', outstanding: 300000, penalty_outstanding: 25000 }),
      cicilan({ id: 'b1', contract_id: 'c-2', outstanding: 900000, penalty_outstanding: 0 }),
    ];
    expect(contractOutstanding(rows, 'c-1')).toEqual({ pokok: 850000, denda: 25000, total: 875000 });
    expect(contractOutstanding(rows, 'c-2')).toEqual({ pokok: 900000, denda: 0, total: 900000 });
  });

  it('total seluruh tagihan tetap berbeda dari total satu kontrak', () => {
    const rows = [
      cicilan({ id: 'a1', contract_id: 'c-1', outstanding: 550000 }),
      cicilan({ id: 'b1', contract_id: 'c-2', outstanding: 900000 }),
    ];
    expect(totalOutstanding(rows).total).toBe(1450000);
    expect(contractOutstanding(rows, 'c-1').total).toBe(550000);
  });

  it('mengembalikan nol untuk kontrak yang tidak ada', () => {
    expect(contractOutstanding([], 'c-9')).toEqual({ pokok: 0, denda: 0, total: 0 });
  });
});

describe('isOverdue', () => {
  it('true hanya bila terlambat dan masih ada sisa', () => {
    expect(isOverdue(cicilan({ late_days: 5, due_date: '2020-01-01', outstanding: 1000 }))).toBe(true);
    expect(isOverdue(cicilan({ late_days: 0, due_date: '2020-01-01', outstanding: 1000 }))).toBe(false);
    expect(isOverdue(cicilan({ late_days: 5, due_date: '2020-01-01', outstanding: 0 }))).toBe(false);
  });
});

describe('formatRupiah', () => {
  it('menampilkan rupiah tanpa pecahan', () => {
    expect(formatRupiah(550000)).toContain('550.000');
    expect(formatRupiah(550000)).not.toContain(',00');
  });
});

describe('buildPaymentQrPayload — nominal di dalam QR', () => {
  it('menanamkan nominal tepat seperti yang diberikan', () => {
    const payload = buildPaymentQrPayload(STATIC_QRIS, 550000);
    const parsed = parseQris(payload);
    expect(parsed.amount).toBe(550000);
    expect(parsed.isDynamic).toBe(true);
    expect(verifyQrisCrc(payload)).toBe(true);
  });

  it('menghasilkan QR berbeda untuk nominal berbeda', () => {
    expect(buildPaymentQrPayload(STATIC_QRIS, 550000)).not.toBe(buildPaymentQrPayload(STATIC_QRIS, 551000));
  });

  it('mempertahankan identitas merchant', () => {
    const payload = buildPaymentQrPayload(STATIC_QRIS, 550000);
    expect(parseQris(payload).merchantName).toBe('TOKO CONTOH');
  });

  it('menolak QR merchant yang CRC-nya rusak, bukan menghasilkan QR yang tampak sah', () => {
    const rusak = `${STATIC_QRIS.slice(0, -4)}0000`;
    expect(() => buildPaymentQrPayload(rusak, 550000)).toThrow(/CRC payload sumber tidak sah/);
  });

  it('menolak nominal yang tidak masuk akal', () => {
    expect(() => buildPaymentQrPayload(STATIC_QRIS, 0)).toThrow();
    expect(() => buildPaymentQrPayload(STATIC_QRIS, -1000)).toThrow();
  });
});
