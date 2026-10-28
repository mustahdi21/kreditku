/**
 * PaymentFormPage.tsx — Pencatatan pembayaran.
 *
 * Prinsip yang dipegang halaman ini:
 *   1. Alokasi ditampilkan LEBIH DULU sebelum disimpan, dihitung dengan fungsi
 *      `allocatePayment` yang sama logikanya dengan fungsi server, sehingga
 *      petugas melihat tepatnya ke cicilan mana uang akan jatuh.
 *   2. Nominal di atas total kewajiban terbuka DITOLAK, kecuali kebijakan
 *      kelebihan bayar diaktifkan secara sadar oleh Admin/Super Admin.
 *   3. Satu kunci idempotensi dipakai untuk seluruh sesi formulir ini: menekan
 *      tombol Simpan dua kali tidak akan membuat dua pembayaran.
 *
 * Catatan: unggah berkas bukti belum tersedia karena penyimpanan berkas belum
 * dikonfigurasi. Kolom bukti hanya mencatat lokasi/tautan berkas bila petugas
 * menyimpannya di tempat lain — halaman ini TIDAK mengunggah apa pun.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, Info, Receipt } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifyInfo, notifySuccess } from '@/components/common/Toaster';
import { MoneyText } from '@/components/common/domain';
import { PageHeader, SummaryChip } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  MoneyInput,
  OptionsSelect,
  Skeleton,
  SwitchRow,
  Textarea,
} from '@/components/ui';
import {
  allocatePayment,
  buildIdempotencyKey,
  totalOpenLiability,
  validatePaymentAmount,
  type AllocationLine,
  type AllocationResult,
  type AllocationTarget,
} from '@/core/allocation';
import {
  ALLOCATION_ORDERS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type AllocationOrder,
  type PaymentMethod,
} from '@/core/types';
import { paymentSchema, type PaymentInput } from '@/core/validation';
import { useContracts, type ContractFilters } from '@/data/credit';
import { useCustomer, useOpenContracts } from '@/data/customers';
import { useContractOpenLiability, usePostPayment } from '@/data/payments';
import type { ContractSummaryRow } from '@/data/types';
import { compareIsoDate, formatDateShortId, todayIso } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatRupiah } from '@/lib/money';

const ALLOCATION_ORDER_LABELS: Record<AllocationOrder, string> = {
  OLDEST_FIRST: 'Cicilan tertua lebih dulu (disarankan)',
  NEWEST_FIRST: 'Cicilan terbaru lebih dulu',
  MANUAL: 'Manual — pilih sendiri cicilan yang didahulukan',
};

const ALLOCATION_ORDER_OPTIONS = ALLOCATION_ORDERS.map((order) => ({
  value: order,
  label: ALLOCATION_ORDER_LABELS[order],
}));

const METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }));

function nowDateTimeLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function toIsoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export default function PaymentFormPage(): JSX.Element {
  const { can, user, organizationId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const contractIdParam = searchParams.get('contractId') ?? '';
  const customerIdParam = searchParams.get('customerId') ?? '';
  const installmentIdParam = searchParams.get('installmentId') ?? '';
  const today = todayIso();

  const canCollectPayment = can('payments.create');
  const canAllowOverpayment = can('payments.reverse');

  const initialKeyRef = useRef<string>(
    buildIdempotencyKey([contractIdParam || 'none', Date.now(), user?.id ?? 'anonim']),
  );
  const keyOwnerRef = useRef<string>(contractIdParam || 'none');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(initialKeyRef.current);

  const [penaltyFirstState, setPenaltyFirstState] = useState(false);
  const [allowOverpayment, setAllowOverpayment] = useState(false);
  const [manualAmounts, setManualAmounts] = useState<Record<string, number>>({});
  const [duplicate, setDuplicate] = useState<{ id: string; receiptNumber: string } | null>(null);

  const form = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      contractId: contractIdParam,
      amount: 0,
      method: 'CASH',
      paidAt: nowDateTimeLocal(),
      reference: '',
      notes: '',
      idempotencyKey: initialKeyRef.current,
      penaltyFirst: false,
      allocationOrder: 'OLDEST_FIRST',
      proofPath: '',
    },
  });

  const formValues = form.watch();
  const contractId = formValues.contractId ?? '';
  const amount = typeof formValues.amount === 'number' && Number.isFinite(formValues.amount) ? formValues.amount : 0;
  const method = (formValues.method ?? 'CASH') as PaymentMethod;
  const allocationOrder = (formValues.allocationOrder ?? 'OLDEST_FIRST') as AllocationOrder;
  const penaltyFirst = Boolean(penaltyFirstState);
  const errors = form.formState.errors;

  /* ---------------------------------------------------------------------- */
  /* Data kontrak & kewajiban terbuka                                        */
  /* ---------------------------------------------------------------------- */

  const openContractsQuery = useOpenContracts(customerIdParam || undefined);
  const customerQuery = useCustomer(customerIdParam || undefined);

  const summaryFilters = useMemo<ContractFilters>(
    () => ({
      search: '',
      statuses: ['ACTIVE', 'DELINQUENT', 'RESTRUCTURED'],
      customerId: customerIdParam || null,
      page: 1,
      pageSize: 200,
    }),
    [customerIdParam],
  );
  const summariesQuery = useContracts(summaryFilters);

  const summaryById = useMemo(() => {
    const map = new Map<string, ContractSummaryRow>();
    for (const row of summariesQuery.data?.rows ?? []) map.set(row.id, row);
    return map;
  }, [summariesQuery.data]);

  const contractOptions = useMemo(
    () =>
      (openContractsQuery.data ?? []).map((contract) => {
        const summary = summaryById.get(contract.id);
        const customerName = summary?.customer_name ?? customerQuery.data?.full_name ?? null;
        const parts = [contract.contract_number];
        if (customerName) parts.push(customerName);
        parts.push(`sisa ${formatRupiah(contract.outstanding)}`);
        if (summary) parts.push(`tunggakan ${formatRupiah(summary.overdue_amount)}`);
        return { value: contract.id, label: parts.join(' • ') };
      }),
    [openContractsQuery.data, summaryById, customerQuery.data],
  );

  const selectedContract = useMemo(
    () => (openContractsQuery.data ?? []).find((contract) => contract.id === contractId) ?? null,
    [openContractsQuery.data, contractId],
  );
  const selectedSummary = contractId ? summaryById.get(contractId) ?? null : null;

  const liabilityQuery = useContractOpenLiability(contractId || undefined);
  const liabilityRows = useMemo(() => liabilityQuery.data?.rows ?? [], [liabilityQuery.data]);

  const targets = useMemo<AllocationTarget[]>(
    () =>
      liabilityRows.map((row) => ({
        installmentId: row.id,
        installmentNumber: row.installment_number,
        dueDate: row.due_date,
        totalDue: row.total_due,
        paidAmount: row.paid_amount,
        penaltyOutstanding: row.penalty_outstanding,
      })),
    [liabilityRows],
  );

  const totalLiability = useMemo(() => totalOpenLiability(targets), [targets]);

  const overdueFromLiability = useMemo(
    () =>
      liabilityRows.reduce(
        (sum, row) => (row.outstanding > 0 && compareIsoDate(row.due_date, today) < 0 ? sum + row.outstanding : sum),
        0,
      ),
    [liabilityRows, today],
  );

  /* ---------------------------------------------------------------------- */
  /* Urutan manual & pratinjau alokasi                                       */
  /* ---------------------------------------------------------------------- */

  const manualIds = useMemo(
    () =>
      targets
        .filter((target) => (manualAmounts[target.installmentId] ?? 0) > 0)
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
        .map((target) => target.installmentId),
    [targets, manualAmounts],
  );

  const orderedTargets = useMemo(() => {
    if (allocationOrder !== 'MANUAL') return targets;
    return [...targets].sort((a, b) => {
      const indexA = manualIds.indexOf(a.installmentId);
      const indexB = manualIds.indexOf(b.installmentId);
      const rankA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
      const rankB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
      return rankA - rankB || a.installmentNumber - b.installmentNumber;
    });
  }, [targets, allocationOrder, manualIds]);

  const preview = useMemo<{ result: AllocationResult | null; error: string | null }>(() => {
    if (amount <= 0 || targets.length === 0) return { result: null, error: null };
    try {
      return {
        result: allocatePayment({
          amount,
          targets: orderedTargets,
          order: allocationOrder,
          penaltyFirst,
          allowOverpayment,
        }),
        error: null,
      };
    } catch (error) {
      return { result: null, error: errorMessage(error) };
    }
  }, [amount, targets, orderedTargets, allocationOrder, penaltyFirst, allowOverpayment]);

  const previewByInstallment = useMemo(() => {
    const map = new Map<string, AllocationLine>();
    for (const line of preview.result?.allocations ?? []) map.set(line.installmentId, line);
    return map;
  }, [preview.result]);

  const amountCheck = useMemo(
    () => validatePaymentAmount({ amount, targets, allowOverpayment }),
    [amount, targets, allowOverpayment],
  );

  const manualTotal = useMemo(
    () => manualIds.reduce((sum, id) => sum + (manualAmounts[id] ?? 0), 0),
    [manualIds, manualAmounts],
  );
  const manualMismatch = allocationOrder === 'MANUAL' && amount > 0 && manualTotal !== amount;
  const manualEmpty = allocationOrder === 'MANUAL' && manualIds.length === 0;

  /* ---------------------------------------------------------------------- */
  /* Kunci idempotensi: satu kunci per kontrak dalam sesi formulir ini       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const owner = contractId || 'none';
    if (keyOwnerRef.current === owner) return;
    keyOwnerRef.current = owner;
    const next = buildIdempotencyKey([owner, Date.now(), user?.id ?? 'anonim']);
    setIdempotencyKey(next);
    form.setValue('idempotencyKey', next);
  }, [contractId, user?.id, form]);

  useEffect(() => {
    form.setValue('idempotencyKey', idempotencyKey);
  }, [idempotencyKey, form]);

  /* ---------------------------------------------------------------------- */
  /* Simpan                                                                  */
  /* ---------------------------------------------------------------------- */

  const postPayment = usePostPayment();

  const onSubmit = form.handleSubmit(async (values) => {
    if (!values.contractId) {
      notifyError(new Error('Pilih kontrak terlebih dahulu.'), 'Data belum lengkap');
      return;
    }
    if (targets.length === 0) {
      notifyError(new Error('Kontrak ini tidak memiliki kewajiban terbuka.'), 'Tidak dapat mencatat pembayaran');
      return;
    }
    const paymentAmount = Number(values.amount ?? 0);
    const check = validatePaymentAmount({ amount: paymentAmount, targets, allowOverpayment });
    if (!check.valid) {
      notifyError(new Error(check.message ?? 'Nominal pembayaran tidak valid.'), 'Nominal ditolak');
      return;
    }
    if (allocationOrder === 'MANUAL' && manualIds.length === 0) {
      notifyError(
        new Error('Isi nominal pada minimal satu cicilan untuk alokasi manual.'),
        'Alokasi manual belum diisi',
      );
      return;
    }
    if (allocationOrder === 'MANUAL' && manualTotal !== paymentAmount) {
      notifyError(
        new Error(
          `Jumlah nominal manual (${formatRupiah(manualTotal)}) harus sama dengan total pembayaran (${formatRupiah(paymentAmount)}).`,
        ),
        'Alokasi manual tidak seimbang',
      );
      return;
    }

    try {
      const result = await postPayment.mutateAsync({
        contractId: values.contractId,
        amount: paymentAmount,
        method: values.method,
        paidAt: toIsoTimestamp(values.paidAt),
        idempotencyKey,
        reference: values.reference ? values.reference : null,
        notes: values.notes ? values.notes : null,
        allocationOrder,
        penaltyFirst,
        allowOverpayment: canAllowOverpayment ? allowOverpayment : false,
        manualInstallments: allocationOrder === 'MANUAL' ? manualIds : undefined,
        proofPath: values.proofPath && values.proofPath.trim() !== '' ? values.proofPath.trim() : null,
      });

      if (result.duplicate) {
        setDuplicate({ id: result.payment_id, receiptNumber: result.receipt_number });
        notifyInfo(
          'Pembayaran ini sudah tercatat sebelumnya',
          `Kuitansi ${result.receipt_number} dibuat pada percobaan pertama — tidak ada pembayaran kedua.`,
        );
        return;
      }

      notifySuccess(
        `Pembayaran ${result.receipt_number} tercatat`,
        result.unallocated > 0
          ? `Kelebihan bayar ${formatRupiah(result.unallocated)} dicatat sebagai saldo titipan pelanggan.`
          : 'Saldo cicilan dan denda sudah diperbarui.',
      );
      navigate(`/app/payments/${result.payment_id}`);
    } catch (error) {
      notifyError(error, 'Pembayaran gagal dicatat');
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  if (!canCollectPayment) {
    return (
      <div className="space-y-4">
        <PageHeader title="Catat Pembayaran" description="Role Anda tidak memiliki hak untuk mencatat pembayaran." />
        <EmptyState
          title="Akses ditolak"
          description="Hanya role dengan izin mencatat pembayaran (Kasir, Admin, Super Admin) yang dapat membuka formulir ini."
          action={
            <Button asChild variant="outline">
              <Link to="/app/payments">Kembali ke daftar pembayaran</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catat Pembayaran"
        description="Pilih kontrak, isi nominal, lalu periksa pratinjau alokasi sebelum menyimpan. Semua angka di bawah dihitung dari kewajiban terbuka kontrak."
        actions={
          <Button asChild variant="outline">
            <Link to="/app/payments">
              <ArrowLeft aria-hidden />
              Daftar pembayaran
            </Link>
          </Button>
        }
        breadcrumb={<span>Organisasi: {organizationId ? 'aktif' : 'belum ditentukan'}</span>}
      />

      {/* 1. Pilih kontrak */}
      <Card>
        <CardHeader>
          <CardTitle>1. Pilih kontrak</CardTitle>
          <CardDescription>
            Hanya kontrak berstatus Aktif, Menunggak, atau Restrukturisasi yang muncul di daftar ini.
            {customerIdParam ? ' Daftar disaring untuk pelanggan yang dipilih.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {openContractsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : openContractsQuery.isError ? (
            <ErrorState message={errorMessage(openContractsQuery.error)} onRetry={() => void openContractsQuery.refetch()} />
          ) : contractOptions.length === 0 ? (
            <EmptyState
              title="Tidak ada kontrak berjalan"
              description="Pelanggan ini tidak memiliki kontrak dengan sisa piutang yang dapat menerima pembayaran."
            />
          ) : (
            <FormField
              label="Kontrak"
              required
              error={errors.contractId?.message}
              hint="Daftar menampilkan nomor kontrak, pelanggan, sisa piutang, dan tunggakan."
            >
              <OptionsSelect
                value={contractId}
                onValueChange={(value) => form.setValue('contractId', value, { shouldValidate: true })}
                options={contractOptions}
                placeholder="Pilih kontrak…"
                aria-invalid={Boolean(errors.contractId)}
              />
            </FormField>
          )}

          {contractId && !selectedContract && !openContractsQuery.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Kontrak yang diminta tidak ada pada daftar kontrak berjalan. Periksa kembali tautan atau pilih kontrak lain.
            </p>
          ) : null}

          {selectedContract ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryChip label="Nomor kontrak" value={<span className="tabular">{selectedContract.contract_number}</span>} />
              <SummaryChip
                label="Pelanggan"
                value={selectedSummary?.customer_name ?? customerQuery.data?.full_name ?? 'Tidak tersedia'}
              />
              <SummaryChip label="Sisa piutang" value={<MoneyText value={selectedContract.outstanding} />} />
              <SummaryChip
                label="Tunggakan"
                value={
                  selectedSummary ? (
                    <MoneyText value={selectedSummary.overdue_amount} />
                  ) : (
                    <span className="text-muted-foreground">Tidak tersedia</span>
                  )
                }
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. Detail pembayaran */}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>2. Detail pembayaran</CardTitle>
            <CardDescription>
              Nominal maksimum mengikuti total kewajiban terbuka kontrak. Denda yang belum dibayar ikut dihitung sebagai
              kewajiban.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormGrid>
              <FormField label="Nominal pembayaran" required error={errors.amount?.message} hint="Contoh: 500.000">
                <MoneyInput
                  id="payment-amount"
                  value={amount > 0 ? amount : null}
                  onChange={(value) => form.setValue('amount', value ?? 0, { shouldValidate: false })}
                  aria-invalid={Boolean(errors.amount)}
                />
              </FormField>

              <FormField label="Metode pembayaran" required error={errors.method?.message}>
                <OptionsSelect
                  value={method}
                  onValueChange={(value) => form.setValue('method', value as PaymentMethod, { shouldValidate: true })}
                  options={METHOD_OPTIONS}
                />
              </FormField>

              <FormField
                label="Waktu pembayaran"
                required
                error={errors.paidAt?.message}
                hint="Waktu yang tercatat pada kuitansi. Sesuaikan bila pembayaran diterima lebih awal."
              >
                <Input
                  type="datetime-local"
                  className="tabular"
                  aria-invalid={Boolean(errors.paidAt)}
                  {...form.register('paidAt')}
                />
              </FormField>

              <FormField
                label="Referensi"
                error={errors.reference?.message}
                hint="Nomor transaksi bank, nomor QRIS, atau catatan referensi lain (opsional)."
              >
                <Input placeholder="Contoh: TRF-882913" aria-invalid={Boolean(errors.reference)} {...form.register('reference')} />
              </FormField>
            </FormGrid>

            <FormGrid>
              <FormField
                label="Urutan alokasi"
                hint="Menentukan cicilan mana yang dilunasi lebih dulu ketika nominal tidak cukup untuk semua cicilan."
              >
                <OptionsSelect
                  value={allocationOrder}
                  onValueChange={(value) => form.setValue('allocationOrder', value as AllocationOrder)}
                  options={ALLOCATION_ORDER_OPTIONS}
                />
              </FormField>

              <FormField
                label="Lokasi berkas bukti (opsional)"
                error={errors.proofPath?.message}
                hint="Unggah berkas belum tersedia karena penyimpanan berkas belum dikonfigurasi. Isi kolom ini hanya bila berkas sudah Anda simpan di tempat lain (mis. Google Drive)."
              >
                <Input placeholder="Contoh: arsip/2026/kwt-0001.jpg" {...form.register('proofPath')} />
              </FormField>
            </FormGrid>

            <SwitchRow
              id="penalty-first"
              label="Lunasi denda lebih dulu"
              description="Bila aktif, denda keterlambatan pada setiap cicilan dilunasi sebelum pokok, bunga, dan biaya."
              checked={penaltyFirst}
              onCheckedChange={(checked) => {
                setPenaltyFirstState(checked);
                form.setValue('penaltyFirst', checked);
              }}
            />

            {canAllowOverpayment ? (
              <SwitchRow
                id="allow-overpayment"
                label="Izinkan kelebihan bayar (Admin)"
                description="Nominal di atas total kewajiban terbuka akan diterima dan selisihnya dicatat sebagai saldo titipan pelanggan (kredit pelanggan), bukan pendapatan. Hanya Admin/Super Admin yang boleh mengaktifkan."
                checked={allowOverpayment}
                onCheckedChange={setAllowOverpayment}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Kebijakan kelebihan bayar hanya dapat diaktifkan oleh Admin/Super Admin. Nominal yang melebihi total
                kewajiban terbuka akan ditolak.
              </p>
            )}

            <FormField label="Catatan" error={errors.notes?.message}>
              <Textarea placeholder="Catatan internal (opsional), mis. nama penerima uang." {...form.register('notes')} />
            </FormField>

            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Info className="h-4 w-4 text-info" aria-hidden />
                Perhitungan ditampilkan lebih dulu
              </p>
              <p className="text-xs text-muted-foreground">
                Tabel pada bagian 3 menghitung alokasi secara lokal dengan aturan yang sama seperti server. Bila nominal
                melebihi kewajiban, penyimpanan akan ditolak tanpa mengubah data.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={postPayment.isPending} disabled={!contractId || targets.length === 0 || manualMismatch || manualEmpty}>
                <Receipt aria-hidden />
                Simpan pembayaran
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app/payments')}>
                Batal
              </Button>
              {manualMismatch ? (
                <span className="text-sm text-destructive">
                  Jumlah nominal manual {formatRupiah(manualTotal)} tidak sama dengan nominal pembayaran{' '}
                  {formatRupiah(amount)}.
                </span>
              ) : null}
              {errors.idempotencyKey ? (
                <span className="text-sm text-destructive">
                  Kunci idempotensi tidak valid: {errors.idempotencyKey.message}
                </span>
              ) : null}
            </div>

            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Perlindungan pembayaran ganda</p>
              <p className="mt-1">
                Formulir ini memakai satu kunci idempotensi{' '}
                <code className="tabular break-all rounded bg-muted px-1 py-0.5">{idempotencyKey}</code>. Kunci yang sama
                dikirim pada setiap percobaan penyimpanan untuk kontrak ini, sehingga menekan tombol Simpan dua kali tidak
                akan membuat dua pembayaran. Kunci baru dibuat otomatis bila Anda mengganti kontrak.
              </p>
            </div>

            {duplicate ? (
              <div className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">
                <p className="font-medium">Pembayaran ini sudah tercatat sebelumnya</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tidak ada pembayaran kedua yang dibuat. Kuitansi {duplicate.receiptNumber} dapat dilihat pada detail
                  pembayaran.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to={`/app/payments/${duplicate.id}`}>Lihat detail pembayaran</Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </form>

      {/* 3. Pratinjau alokasi */}
      <Card>
        <CardHeader>
          <CardTitle>3. Pratinjau alokasi</CardTitle>
          <CardDescription>
            Alokasi dihitung berurutan sesuai kebijakan urutan. Setiap baris berhenti tepat pada sisa kewajibannya,
            sehingga tidak ada cicilan yang dibayar melebihi tagihannya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {liabilityQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : liabilityQuery.isError ? (
            <ErrorState message={errorMessage(liabilityQuery.error)} onRetry={() => void liabilityQuery.refetch()} />
          ) : !contractId ? (
            <EmptyState title="Belum ada kontrak dipilih" description="Pilih kontrak pada bagian 1 untuk melihat pratinjau alokasi." />
          ) : targets.length === 0 ? (
            <EmptyState
              title="Tidak ada kewajiban terbuka"
              description="Seluruh cicilan kontrak ini sudah lunas dan tidak ada denda terbuka."
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryChip label="Total kewajiban terbuka" value={<MoneyText value={totalLiability} strong />} />
                <SummaryChip label="Tagihan + denda terbuka" value={<MoneyText value={totalLiability} />} />
                <SummaryChip label="Tunggakan (lewat jatuh tempo)" value={<MoneyText value={overdueFromLiability} />} />
                <SummaryChip
                  label="Nominal diisi"
                  value={<MoneyText value={amount} strong={amount > 0} mutedWhenZero />}
                />
              </div>

              {amount > 0 && !amountCheck.valid ? (
                <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {amountCheck.message}
                </p>
              ) : null}

              {amount > 0 && amountCheck.valid && amountCheck.excess > 0 ? (
                <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  {amountCheck.message} Kelebihan {formatRupiah(amountCheck.excess)} dicatat sebagai saldo titipan
                  pelanggan.
                </p>
              ) : null}

              {preview.error ? (
                <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {preview.error}
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-lg border scrollbar-thin">
                <table className="w-full caption-bottom text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cicilan
                      </th>
                      <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Jatuh tempo
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tagihan
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sisa tagihan
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Denda terbuka
                      </th>
                      {allocationOrder === 'MANUAL' ? (
                        <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Nominal manual
                        </th>
                      ) : null}
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ke tagihan
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ke denda
                      </th>
                      <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sisa setelah bayar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {liabilityRows.map((row) => {
                      const line = previewByInstallment.get(row.id);
                      const requested = manualAmounts[row.id] ?? 0;
                      const isTarget = installmentIdParam !== '' && installmentIdParam === row.id;
                      const adjusted =
                        allocationOrder === 'MANUAL' && requested > 0 && (!line || line.total !== requested);
                      return (
                        <tr key={row.id} className={isTarget ? 'border-t bg-primary/5' : 'border-t'}>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-2">
                              <span className="tabular font-medium">ke-{row.installment_number}</span>
                              {isTarget ? <Badge variant="info">Target</Badge> : null}
                              {adjusted ? (
                                <Badge
                                  variant="warning"
                                  title="Nominal yang diminta berbeda dari hasil alokasi otomatis. Server mengalokasikan berdasarkan urutan prioritas."
                                >
                                  disesuaikan
                                </Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="tabular px-3 py-2.5">{formatDateShortId(row.due_date)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText value={row.total_due} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText value={row.outstanding} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText value={row.penalty_outstanding} mutedWhenZero />
                          </td>
                          {allocationOrder === 'MANUAL' ? (
                            <td className="px-3 py-2.5">
                              <MoneyInput
                                aria-label={`Nominal manual cicilan ${row.installment_number}`}
                                max={row.outstanding + row.penalty_outstanding}
                                value={requested > 0 ? requested : null}
                                onChange={(value) =>
                                  setManualAmounts((previous) => ({ ...previous, [row.id]: value ?? 0 }))
                                }
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText value={line?.toInstallment ?? 0} mutedWhenZero />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText value={line?.toPenalty ?? 0} mutedWhenZero />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyText
                              value={(line?.resultingOutstanding ?? row.outstanding) + (line?.resultingPenaltyOutstanding ?? row.penalty_outstanding)}
                              strong={(line?.resultingOutstanding ?? row.outstanding) + (line?.resultingPenaltyOutstanding ?? row.penalty_outstanding) === 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {allocationOrder === 'MANUAL' ? (
                <p className="text-xs text-muted-foreground">
                  Alokasi manual: isi nominal pada cicilan yang ingin didahulukan. Cicilan yang diisi menjadi prioritas
                  pertama (berdasarkan urutan nomor cicilan), sisanya dialokasikan otomatis. Jumlah nominal manual harus
                  sama dengan nominal pembayaran, yaitu {formatRupiah(amount)} — saat ini {formatRupiah(manualTotal)}.
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryChip
                  label="Total dialokasikan"
                  value={<MoneyText value={preview.result?.totalAllocated ?? 0} strong />}
                />
                <SummaryChip label="Ke tagihan" value={<MoneyText value={preview.result?.allocatedToInstallment ?? 0} />} />
                <SummaryChip label="Ke denda" value={<MoneyText value={preview.result?.allocatedToPenalty ?? 0} />} />
                <SummaryChip
                  label="Tidak teralokasi"
                  value={<MoneyText value={preview.result?.unallocated ?? 0} mutedWhenZero />}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Penyimpanan dilakukan melalui fungsi server yang menyimpan pembayaran, alokasi cicilan, pembaruan saldo, dan audit
        log dalam satu transaksi. Bila terjadi kegagalan di tengah proses, tidak ada data yang tersimpan separuh.
      </p>
    </div>
  );
}
