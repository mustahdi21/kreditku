/**
 * QrisPaymentDialog.test.tsx — Bukti bahwa tampilannya berubah sendiri.
 *
 * Inilah perilaku yang diminta: setelah bank mengirim notifikasi dan server
 * mencatatnya, pelanggan TIDAK perlu memuat ulang — QR-nya berganti menjadi
 * "Pembayaran diterima" dengan sendirinya.
 *
 * Dua hal yang dijaga di sini karena menyangkut uang:
 *   1. QR tidak lagi ditampilkan setelah pembayaran tercatat, supaya pelanggan
 *      tidak terlanjur membayar dua kali.
 *   2. Permintaan yang perlu ditinjau TIDAK menawarkan pembayaran ulang —
 *      uangnya sudah masuk, yang kurang hanya pencocokan.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crc16Ccitt } from '@/core/qris';
import { QrisPaymentDialog } from './QrisPaymentDialog';

// QRCodeCanvas menggambar ke kanvas, yang tidak tersedia di jsdom.
vi.mock('qrcode.react', () => ({
  QRCodeCanvas: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

const QRIS_STATIS = (() => {
  const tags: ReadonlyArray<readonly [string, string]> = [
    ['00', '01'],
    ['01', '11'],
    ['53', '360'],
    ['58', 'ID'],
    ['59', 'TOKO CONTOH'],
    ['60', 'JAKARTA'],
  ];
  const body = tags.map(([tag, value]) => `${tag}${value.length.toString().padStart(2, '0')}${value}`).join('');
  const withTemplate = `${body}6304`;
  return `${withTemplate}${crc16Ccitt(withTemplate)}`;
})();

const mutateAsync = vi.fn();
const refresh = vi.fn();
const useQrisRequestStatus = vi.fn();

vi.mock('@/data/portal', async () => {
  const asli = await vi.importActual<typeof import('@/data/portal')>('@/data/portal');
  return {
    ...asli,
    useMerchantQris: () => ({ data: { payload: QRIS_STATIS, merchantName: 'TOKO CONTOH' } }),
    useCreateQrisRequest: () => ({ mutateAsync, isPending: false }),
    useQrisRequestStatus: (id: string | null) => useQrisRequestStatus(id),
    useRefreshPortalAfterPayment: () => refresh,
  };
});

const PERMINTAAN = {
  request_id: 'req-1',
  reference: 'QR261107-ABC123',
  amount: 550000,
  contract_number: 'K-1',
  installment_number: 1,
  due_date: '2026-11-07',
  expires_at: '2026-11-08T00:00:00Z',
  lanjutan: false,
  total_outstanding: 1100000,
};

function renderDialog() {
  return render(
    <QrisPaymentDialog
      open
      onOpenChange={vi.fn()}
      contractId="c-1"
      installmentId="i-1"
      installmentLabel="1"
      defaultAmount={550000}
      maxAmount={1100000}
    />,
  );
}

describe('QrisPaymentDialog — tampilan berubah sendiri saat dibayar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue(PERMINTAAN);
    useQrisRequestStatus.mockReturnValue({ data: { ...PERMINTAAN, status: 'PENDING' } });
  });

  it('menampilkan nominal yang dapat diubah sebelum QR dibuat', async () => {
    renderDialog();
    expect(screen.getByLabelText('Nominal yang akan dibayar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buat QR pembayaran/ })).toBeInTheDocument();
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
  });

  it('menampilkan QR setelah permintaan dibuat', async () => {
    const pengguna = userEvent.setup();
    renderDialog();

    await pengguna.click(screen.getByRole('button', { name: /Buat QR pembayaran/ }));

    await waitFor(() => expect(screen.getByTestId('qr')).toBeInTheDocument());
    expect(screen.getByText('QR261107-ABC123')).toBeInTheDocument();
    expect(useQrisRequestStatus).toHaveBeenCalledWith('req-1');
  });

  it('berganti menjadi "Pembayaran diterima" begitu statusnya PAID', async () => {
    const pengguna = userEvent.setup();
    const { rerender } = renderDialog();
    await pengguna.click(screen.getByRole('button', { name: /Buat QR pembayaran/ }));
    await waitFor(() => expect(screen.getByTestId('qr')).toBeInTheDocument());

    useQrisRequestStatus.mockReturnValue({
      data: { ...PERMINTAAN, status: 'PAID', paid_at: '2026-11-07T01:00:00Z', payment_id: 'pay-1' },
    });
    rerender(
      <QrisPaymentDialog
        open
        onOpenChange={vi.fn()}
        contractId="c-1"
        installmentId="i-1"
        installmentLabel="1"
        defaultAmount={550000}
        maxAmount={1100000}
      />,
    );

    await waitFor(() => expect(screen.getByText('Pembayaran diterima')).toBeInTheDocument());
    // QR harus HILANG supaya tidak ada pembayaran kedua.
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
    expect(screen.getByText(/Tagihan Anda sudah tercatat lunas/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('meminta tinjauan tanpa menawarkan pembayaran ulang', async () => {
    const pengguna = userEvent.setup();
    const { rerender } = renderDialog();
    await pengguna.click(screen.getByRole('button', { name: /Buat QR pembayaran/ }));
    await waitFor(() => expect(screen.getByTestId('qr')).toBeInTheDocument());

    useQrisRequestStatus.mockReturnValue({ data: { ...PERMINTAAN, status: 'REVIEW' } });
    rerender(
      <QrisPaymentDialog
        open
        onOpenChange={vi.fn()}
        contractId="c-1"
        installmentId="i-1"
        installmentLabel="1"
        defaultAmount={550000}
        maxAmount={1100000}
      />,
    );

    await waitFor(() => expect(screen.getByText('Pembayaran Anda sedang ditinjau')).toBeInTheDocument());
    expect(screen.getByText(/Tidak perlu membayar ulang/)).toBeInTheDocument();
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
  });

  it('menawarkan QR baru bila permintaan sudah kedaluwarsa', async () => {
    const pengguna = userEvent.setup();
    const { rerender } = renderDialog();
    await pengguna.click(screen.getByRole('button', { name: /Buat QR pembayaran/ }));
    await waitFor(() => expect(screen.getByTestId('qr')).toBeInTheDocument());

    useQrisRequestStatus.mockReturnValue({ data: { ...PERMINTAAN, status: 'EXPIRED' } });
    rerender(
      <QrisPaymentDialog
        open
        onOpenChange={vi.fn()}
        contractId="c-1"
        installmentId="i-1"
        installmentLabel="1"
        defaultAmount={550000}
        maxAmount={1100000}
      />,
    );

    await waitFor(() => expect(screen.getByText('QR ini sudah kedaluwarsa')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Buat QR baru/ })).toBeInTheDocument();
  });

  it('membatasi nominal pada tagihan kontrak, dan tidak pernah mengirim lebih', async () => {
    const pengguna = userEvent.setup();
    renderDialog();

    const isian = screen.getByLabelText('Nominal yang akan dibayar');
    await pengguna.clear(isian);
    await pengguna.type(isian, '2000000');

    // Kolomnya membatasi sendiri pada tagihan kontrak, sehingga nilai yang
    // melebihi batas tidak pernah sampai ke server.
    await waitFor(() => expect(isian).toHaveValue('1.100.000'));

    await pengguna.click(screen.getByRole('button', { name: /Buat QR pembayaran/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'c-1', installmentId: 'i-1', amount: 1100000 }),
    );
  });
});
