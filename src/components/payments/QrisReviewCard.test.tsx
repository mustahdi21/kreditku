/**
 * QrisReviewCard.test.tsx — Bukti bahwa antrean tinjauan dapat ditindaklanjuti.
 *
 * Yang dijaga:
 *   1. Antrean tidak muncul saat kosong, dan tidak muncul bagi peran yang tidak
 *      berwenang — menampilkannya hanya menimbulkan pertanyaan tanpa jalan keluar.
 *   2. Kasir MELIHAT kandidat tagihan dan harus memilih satu sebelum mencatat.
 *      Tombol yang aktif tanpa pilihan akan mencatat pembayaran ke tagihan yang
 *      tidak diketahui.
 *   3. Nominal tidak pernah diketik di sini; yang dipilih hanya tagihannya.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QrisReviewCard } from './QrisReviewCard';

const can = vi.fn(() => true);
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ can }) }));

const useUnresolvedConfirmations = vi.fn();
const useReviewRequests = vi.fn();
const useCandidateRequests = vi.fn();
const mutateAsync = vi.fn();

vi.mock('@/data/qrisReview', () => ({
  useUnresolvedConfirmations: () => useUnresolvedConfirmations(),
  useReviewRequests: () => useReviewRequests(),
  useCandidateRequests: (amount: number | null) => useCandidateRequests(amount),
  useResolveQrisConfirmation: () => ({ mutateAsync, isPending: false }),
  useConfirmQrisRequestManual: () => ({ mutateAsync, isPending: false }),
  useDismissQrisConfirmation: () => ({ mutateAsync, isPending: false }),
  useDismissQrisRequest: () => ({ mutateAsync, isPending: false }),
}));

const KONFIRMASI = {
  id: 'konf-1',
  organization_id: 'org-1',
  request_id: null,
  source: 'MACRODROID',
  amount: 550000,
  reference: 'QR-1',
  raw_text: 'pembayaran via qris statis diterima Rp550.000',
  outcome: 'AMBIGU',
  detail: 'Lebih dari satu tagihan bernominal sama',
  created_at: '2026-11-06T04:00:00Z',
};

const KANDIDAT = [
  {
    id: 'req-a',
    amount: 550000,
    reference: 'QR-A',
    created_at: '2026-11-06T03:00:00Z',
    expires_at: '2026-11-07T03:00:00Z',
    credit_contracts: {
      contract_number: 'K-A',
      customers: { full_name: 'Pelanggan A', customer_number: 'C-A' },
    },
  },
  {
    id: 'req-b',
    amount: 550000,
    reference: 'QR-B',
    created_at: '2026-11-06T03:05:00Z',
    expires_at: '2026-11-07T03:05:00Z',
    credit_contracts: {
      contract_number: 'K-B',
      customers: { full_name: 'Pelanggan B', customer_number: 'C-B' },
    },
  },
];

function siapkan(opsi: { konfirmasi?: unknown[]; permintaan?: unknown[]; kandidat?: unknown[] } = {}) {
  useUnresolvedConfirmations.mockReturnValue({
    data: opsi.konfirmasi ?? [KONFIRMASI],
    isLoading: false,
  });
  useReviewRequests.mockReturnValue({ data: opsi.permintaan ?? [], isLoading: false });
  useCandidateRequests.mockReturnValue({ data: opsi.kandidat ?? KANDIDAT, isLoading: false, isError: false });
}

describe('QrisReviewCard — antrean tinjauan kasir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockReturnValue(true);
    mutateAsync.mockResolvedValue({ status: 'DIBAYAR', receipt_number: 'KWT-1' });
    siapkan();
  });

  it('tidak tampil saat antrean kosong', () => {
    siapkan({ konfirmasi: [], permintaan: [] });
    const { container } = render(<QrisReviewCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tidak tampil bagi peran yang tidak berwenang mencatat pembayaran', () => {
    can.mockReturnValue(false);
    const { container } = render(<QrisReviewCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('menampilkan jumlah dan isi antrean', () => {
    render(<QrisReviewCard />);
    expect(screen.getByText('Perlu ditinjau (1)')).toBeInTheDocument();
    expect(screen.getAllByText(/550\.000/).length).toBeGreaterThan(0);
  });

  it('menampilkan kandidat tagihan dan menuntut pilihan sebelum mencatat', async () => {
    const pengguna = userEvent.setup();
    render(<QrisReviewCard />);

    await pengguna.click(screen.getByText('Notifikasi bank'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pilih tagihan yang dimaksud')).toBeInTheDocument();
    expect(within(dialog).getByText('Pelanggan A')).toBeInTheDocument();
    expect(within(dialog).getByText('Pelanggan B')).toBeInTheDocument();

    const tombolCatat = within(dialog).getByRole('button', { name: 'Catat pembayaran' });
    expect(tombolCatat).toBeDisabled();

    await pengguna.click(within(dialog).getByText('Pelanggan B'));
    await waitFor(() => expect(tombolCatat).toBeEnabled());

    await pengguna.click(tombolCatat);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ confirmationId: 'konf-1', requestId: 'req-b' }),
      ),
    );
  });

  it('meminta alasan sebelum mengabaikan', async () => {
    const pengguna = userEvent.setup();
    render(<QrisReviewCard />);

    await pengguna.click(screen.getByText('Notifikasi bank'));
    const dialog = await screen.findByRole('dialog');

    await pengguna.click(within(dialog).getByRole('button', { name: 'Abaikan' }));

    const tombolAbaikan = within(dialog).getByRole('button', { name: 'Abaikan konfirmasi' });
    expect(tombolAbaikan).toBeDisabled();
    await pengguna.type(within(dialog).getByLabelText('Alasan mengabaikan'), 'bukan QRIS usaha ini');
    await waitFor(() => expect(tombolAbaikan).toBeEnabled());
  });

  it('menyebut nominal tidak terbaca dan tidak menawarkan pencatatan', async () => {
    siapkan({ konfirmasi: [{ ...KONFIRMASI, amount: null, outcome: 'NOMINAL_TIDAK_TERBACA' }], kandidat: [] });
    const pengguna = userEvent.setup();
    render(<QrisReviewCard />);

    await pengguna.click(screen.getByText('Notifikasi bank'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Nominalnya tidak terbaca/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Pilih tagihan yang dimaksud')).not.toBeInTheDocument();
    // Tidak ada yang dapat dipilih, sehingga pencatatan tidak boleh dapat ditekan.
    expect(within(dialog).getByRole('button', { name: 'Catat pembayaran' })).toBeDisabled();
  });
});
