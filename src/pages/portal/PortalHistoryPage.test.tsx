/**
 * PortalHistoryPage.test.tsx — Bukti bahwa riwayat dapat dibuka.
 *
 * Yang dijaga di sini bukan tampilannya, melainkan dua hal yang menentukan bagi
 * pelanggan:
 *
 *   1. Setiap baris riwayat benar-benar dapat dibuka. Daftar hanya menyebut
 *      nominal dan tanggal; jawaban atas "pembayaran ini dipakai untuk apa" dan
 *      "kenapa permintaan saya belum lunas" ada di panelnya.
 *   2. Panel permintaan menampilkan catatan sistem. Di situlah alasan sebuah
 *      pembayaran berstatus ditinjau dijelaskan — tanpa itu pelanggan hanya
 *      melihat status tanpa tahu sebabnya.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalHistoryPage } from './PortalHistoryPage';
import type { PaymentAllocationRow, PaymentRow } from '@/data/types';
import type { QrisRequestRow } from '@/data/portal';

const useMyPayments = vi.fn();
const useMyQrisRequests = vi.fn();
const usePaymentAllocations = vi.fn();

vi.mock('@/data/portal', async () => {
  const asli = await vi.importActual<typeof import('@/data/portal')>('@/data/portal');
  return {
    ...asli,
    useMyPayments: () => useMyPayments(),
    useMyQrisRequests: () => useMyQrisRequests(),
    usePaymentAllocations: (id: string | null) => usePaymentAllocations(id),
  };
});

const PEMBAYARAN: PaymentRow = {
  id: 'pay-1',
  organization_id: 'org-1',
  contract_id: 'c-1',
  receipt_number: 'KWT-20261029-0001',
  amount: 550000,
  method: 'QRIS',
  paid_at: '2026-10-29T04:00:00Z',
  paid_date: '2026-10-29',
  reference: 'QR261029-ABC123',
  notes: 'Pembayaran QRIS terkonfirmasi otomatis',
  proof_path: null,
  status: 'POSTED',
  idempotency_key: 'qris:QR261029-ABC123',
  penalty_first: false,
  allocation_order: 'OLDEST_FIRST',
  unallocated: 0,
  reversed_at: null,
  created_at: '2026-10-29T04:00:00Z',
  created_by: null,
} as PaymentRow;

const ALOKASI: PaymentAllocationRow = {
  id: 'al-1',
  payment_id: 'pay-1',
  installment_id: 'i-1',
  amount: 550000,
  penalty_amount: 0,
  installments: { installment_number: 2, due_date: '2026-11-01', total_due: 550000 },
} as PaymentAllocationRow;

const PERMINTAAN: QrisRequestRow = {
  id: 'req-1',
  contract_id: 'c-1',
  installment_id: 'i-1',
  amount: 550000,
  reference: 'QR261029-XYZ789',
  status: 'REVIEW',
  created_at: '2026-10-29T03:00:00Z',
  expires_at: '2026-10-30T03:00:00Z',
  paid_at: null,
  payment_id: null,
  note: 'Lebih dari satu tagihan bernominal sama: QR-1, QR-2',
  confirmed_via: 'MACRODROID',
};

function siapkan(opsi: {
  pembayaran?: PaymentRow[];
  permintaan?: QrisRequestRow[];
  alokasi?: PaymentAllocationRow[];
} = {}) {
  useMyPayments.mockReturnValue({
    data: opsi.pembayaran ?? [PEMBAYARAN],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useMyQrisRequests.mockReturnValue({
    data: opsi.permintaan ?? [PERMINTAAN],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  usePaymentAllocations.mockReturnValue({
    data: opsi.alokasi ?? [ALOKASI],
    isLoading: false,
    isError: false,
  });
}

describe('PortalHistoryPage — riwayat dapat dibuka', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    siapkan();
  });

  it('menampilkan pembayaran dan permintaan pada daftar', () => {
    render(<PortalHistoryPage />);
    expect(screen.getByText('KWT-20261029-0001')).toBeInTheDocument();
    expect(screen.getByText('QR261029-XYZ789')).toBeInTheDocument();
    expect(screen.getByText('Sedang ditinjau admin')).toBeInTheDocument();
  });

  it('membuka rincian pembayaran beserta alokasinya', async () => {
    const pengguna = userEvent.setup();
    render(<PortalHistoryPage />);

    await pengguna.click(screen.getByText('KWT-20261029-0001'));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Pembayaran ini menutup')).toBeInTheDocument();
    expect(within(panel).getByText('Cicilan ke-2')).toBeInTheDocument();
    expect(within(panel).getByText('Pembayaran QRIS terkonfirmasi otomatis')).toBeInTheDocument();
    expect(usePaymentAllocations).toHaveBeenCalledWith('pay-1');
  });

  it('membuka rincian permintaan beserta catatan sistemnya', async () => {
    const pengguna = userEvent.setup();
    render(<PortalHistoryPage />);

    await pengguna.click(screen.getByText('QR261029-XYZ789'));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Catatan sistem')).toBeInTheDocument();
    expect(within(panel).getByText(/Lebih dari satu tagihan bernominal sama/)).toBeInTheDocument();
    expect(within(panel).getByText(/sedang dicocokkan admin/)).toBeInTheDocument();
    expect(within(panel).getByText('Otomatis dari notifikasi bank')).toBeInTheDocument();
  });

  it('tidak memuat alokasi sebelum ada baris yang dibuka', () => {
    render(<PortalHistoryPage />);
    expect(usePaymentAllocations).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('menampilkan kelebihan pembayaran bila ada', async () => {
    siapkan({ pembayaran: [{ ...PEMBAYARAN, unallocated: 25000 }] });
    const pengguna = userEvent.setup();
    render(<PortalHistoryPage />);

    await pengguna.click(screen.getByText('KWT-20261029-0001'));

    const panel = await screen.findByRole('dialog');
    await waitFor(() => expect(within(panel).getByText(/Kelebihan/)).toBeInTheDocument());
    expect(within(panel).getByText(/25\.000/)).toBeInTheDocument();
  });

  it('menautkan permintaan yang sudah dibayar ke kuitansinya', async () => {
    siapkan({
      permintaan: [{ ...PERMINTAAN, status: 'PAID', payment_id: 'pay-1', paid_at: '2026-10-29T04:00:00Z' }],
    });
    const pengguna = userEvent.setup();
    render(<PortalHistoryPage />);

    await pengguna.click(screen.getByText('QR261029-XYZ789'));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Tercatat sebagai pembayaran')).toBeInTheDocument();
    expect(within(panel).getByText(/KWT-20261029-0001/)).toBeInTheDocument();
  });

  it('menampilkan keadaan kosong tanpa riwayat', () => {
    siapkan({ pembayaran: [], permintaan: [] });
    render(<PortalHistoryPage />);
    expect(screen.getByText('Belum ada pembayaran yang tercatat.')).toBeInTheDocument();
    expect(screen.getByText('Belum ada permintaan')).toBeInTheDocument();
  });
});
