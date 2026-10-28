/**
 * ApplicationFormPage.tsx — Formulir pengajuan kredit baru.
 *
 * Menampilkan pratinjau simulasi langsung (tanpa menyimpan apa pun) memakai
 * perhitungan dari `src/core/interest.ts`, sehingga angka yang dilihat petugas
 * PERSIS sama dengan yang akan dihitung ulang oleh server saat pengajuan
 * disetujui. Metode bunga selalu dilabeli eksplisit agar angka flat dan
 * anuitas tidak pernah tercampur tanpa keterangan.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/AppShell';
import { DetailRow, MoneyText, SectionTitle } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { useCustomers, DEFAULT_CUSTOMER_FILTERS, type CustomerFilters } from '@/data/customers';
import { useCreateApplication } from '@/data/credit';
import { todayIso } from '@/data/client';
import { creditApplicationSchema, type CreditApplicationInput } from '@/core/validation';
import { describeInterestMethod, simulateCredit, type SimulationSummary } from '@/core/interest';
import {
  ADMIN_FEE_POSITIONS,
  DUE_DATE_ADJUSTMENTS,
  INTEREST_METHODS,
  INTEREST_METHOD_LABELS,
  PAYMENT_FREQUENCIES,
  PAYMENT_FREQUENCY_LABELS,
  RATE_BASES,
  RATE_BASIS_LABELS,
  type AdminFeePosition,
  type DueDateAdjustment,
} from '@/core/types';
import { addMonthsIso } from '@/lib/date';
import { bpToPercent, formatRupiah } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Label,
  MoneyInput,
  NumberInput,
  OptionsSelect,
  PercentInput,
  ScrollArea,
  Textarea,
} from '@/components/ui';

/** Jumlah baris jadwal yang ditampilkan pada pratinjau. */
const PREVIEW_ROWS = 12;

/** Label posisi biaya administrasi (belum tersedia di core/types). */
const ADMIN_FEE_POSITION_LABELS: Record<AdminFeePosition, string> = {
  UPFRONT: 'Dibayar di Muka',
  FIRST_INSTALLMENT: 'Digabung ke Cicilan Pertama',
  SPREAD: 'Dibagi ke Seluruh Cicilan',
};

/** Label kebijakan penyesuaian tanggal jatuh tempo (belum tersedia di core/types). */
const DUE_DATE_ADJUSTMENT_LABELS: Record<DueDateAdjustment, string> = {
  NONE: 'Tanpa Penyesuaian',
  PREVIOUS_BUSINESS_DAY: 'Mundur ke Hari Kerja Sebelumnya',
  NEXT_BUSINESS_DAY: 'Maju ke Hari Kerja Berikutnya',
};

/** Tarif basis point menjadi teks persen Indonesia. */
function formatRate(rateBp: number, rateBasis: string): string {
  const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(bpToPercent(rateBp));
  const basisLabel = RATE_BASIS_LABELS[rateBasis as keyof typeof RATE_BASIS_LABELS] ?? rateBasis;
  return `${percent}% ${basisLabel}`;
}

export default function ApplicationFormPage(): JSX.Element {
  const navigate = useNavigate();
  const { organizationId } = useAuth();
  const [customerSearch, setCustomerSearch] = useState('');

  const form = useForm<CreditApplicationInput>({
    resolver: zodResolver(creditApplicationSchema),
    defaultValues: {
      customerId: '',
      productId: null,
      creditType: '',
      price: 0,
      downPayment: 0,
      tenor: 12,
      method: 'FLAT',
      rateBp: 0,
      rateBasis: 'PER_MONTH',
      frequency: 'MONTHLY',
      adminFee: 0,
      otherFeePerPeriod: 0,
      adminFeePosition: 'UPFRONT',
      disbursementDate: todayIso(),
      firstDueDate: addMonthsIso(todayIso(), 1),
      dueDateAdjustment: 'NONE',
      notes: '',
      submit: false,
    },
  });

  const { control, formState, handleSubmit, register, setValue, watch } = form;
  const errors = formState.errors;
  const values = watch();

  const customerFilters = useMemo<CustomerFilters>(
    () => ({ ...DEFAULT_CUSTOMER_FILTERS, search: customerSearch, page: 1, pageSize: 50 }),
    [customerSearch],
  );
  const customers = useCustomers(customerFilters);
  const customerOptions = useMemo(
    () =>
      (customers.data?.rows ?? []).map((customer) => ({
        value: customer.id,
        label: `${customer.full_name} • ${customer.customer_number} • ${customer.phone}`,
      })),
    [customers.data],
  );

  const createApplication = useCreateApplication(organizationId);

  /** Pratinjau dihitung ulang setiap kali input berubah; tidak menyimpan data. */
  const simulation: SimulationSummary | null = (() => {
    if (!Number.isFinite(values.price) || values.price <= 0) return null;
    if (!Number.isInteger(values.tenor) || values.tenor <= 0) return null;
    if (!Number.isFinite(values.downPayment) || values.downPayment < 0) return null;
    if (values.downPayment > values.price || values.price - values.downPayment <= 0) return null;
    try {
      return simulateCredit({
        price: values.price,
        downPayment: values.downPayment,
        tenor: values.tenor,
        method: values.method,
        rateBp: values.method === 'NONE' ? 0 : values.rateBp,
        rateBasis: values.rateBasis,
        frequency: values.frequency,
        adminFee: values.adminFee,
        adminFeePosition: values.adminFeePosition,
        otherFeePerPeriod: values.otherFeePerPeriod,
      });
    } catch (error) {
      console.error('[KreditKu] pratinjau simulasi pengajuan gagal:', error);
      return null;
    }
  })();

  const submitNow = values.submit === true;
  const noOrganization = !organizationId;

  const onSubmit = (input: CreditApplicationInput): void => {
    const payload: CreditApplicationInput = {
      ...input,
      productId: input.productId ?? null,
      notes: input.notes && input.notes.trim() ? input.notes.trim() : null,
    };
    createApplication.mutate(payload, {
      onSuccess: (application) => {
        notifySuccess(
          input.submit ? 'Pengajuan diajukan' : 'Draft pengajuan disimpan',
          `Nomor pengajuan ${application.application_number}.`,
        );
        navigate(`/app/applications/${application.id}`);
      },
      onError: (error) => notifyError(error, 'Pengajuan gagal disimpan'),
    });
  };

  return (
    <RequirePermission permission="applications.manage">
      <PageHeader
        title="Pengajuan Baru"
        description="Hitung rencana angsuran terlebih dahulu pada panel simulasi, lalu simpan sebagai draft atau ajukan langsung."
        breadcrumb={
          <Link to="/app/applications" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Kembali ke daftar pengajuan
          </Link>
        }
      />

      {noOrganization ? (
        <ErrorState
          title="Organisasi belum aktif"
          message="Akun Anda belum terhubung ke organisasi mana pun sehingga pengajuan tidak dapat disimpan. Hubungi Super Admin untuk mendapatkan undangan."
        />
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pelanggan & Produk</CardTitle>
              <CardDescription>Pilih pelanggan dan tentukan jenis kredit yang diajukan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Pelanggan"
                htmlFor="application-customer"
                required
                error={errors.customerId?.message}
                hint="Ketik untuk mencari nama, nomor pelanggan, atau nomor telepon. Pelanggan terpilih tetap tersimpan meski tidak tampil pada hasil pencarian."
              >
                <div className="space-y-2">
                  <Input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Cari pelanggan…"
                    aria-label="Cari pelanggan"
                    autoComplete="off"
                  />
                  <Controller
                    control={control}
                    name="customerId"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-customer"
                        value={field.value ?? ''}
                        onValueChange={field.onChange}
                        options={customerOptions}
                        placeholder={
                          customers.isPending
                            ? 'Memuat pelanggan…'
                            : customerOptions.length === 0
                              ? 'Tidak ada pelanggan yang cocok'
                              : 'Pilih pelanggan'
                        }
                        disabled={customers.isPending}
                        aria-invalid={Boolean(errors.customerId)}
                      />
                    )}
                  />
                </div>
              </FormField>

              <FormGrid>
                <FormField label="Jenis kredit" htmlFor="application-credit-type" required error={errors.creditType?.message}>
                  <Input
                    id="application-credit-type"
                    placeholder="Contoh: Sepeda Motor"
                    autoComplete="off"
                    aria-invalid={Boolean(errors.creditType)}
                    {...register('creditType')}
                  />
                </FormField>

                <FormField
                  label="Metode bunga"
                  htmlFor="application-method"
                  required
                  hint={
                    values.method === 'NONE'
                      ? 'Tarif diabaikan karena metode tanpa bunga.'
                      : 'Angka flat dan anuitas dihitung dengan rumus berbeda dan tidak pernah dicampur.'
                  }
                >
                  <Controller
                    control={control}
                    name="method"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-method"
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value === 'NONE') setValue('rateBp', 0, { shouldValidate: true });
                        }}
                        options={INTEREST_METHODS.map((method) => ({ value: method, label: INTEREST_METHOD_LABELS[method] }))}
                      />
                    )}
                  />
                </FormField>
              </FormGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rincian Pembiayaan</CardTitle>
              <CardDescription>Harga barang, uang muka, tenor, dan tarif bunga.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormGrid>
                <FormField label="Harga barang" htmlFor="application-price" required error={errors.price?.message}>
                  <Controller
                    control={control}
                    name="price"
                    render={({ field }) => (
                      <MoneyInput
                        id="application-price"
                        value={field.value}
                        onChange={(value) => field.onChange(value === null ? 0 : value)}
                        aria-invalid={Boolean(errors.price)}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Uang muka"
                  htmlFor="application-down-payment"
                  required
                  error={errors.downPayment?.message}
                  hint="Tidak boleh melebihi harga barang."
                >
                  <Controller
                    control={control}
                    name="downPayment"
                    render={({ field }) => (
                      <MoneyInput
                        id="application-down-payment"
                        value={field.value}
                        onChange={(value) => field.onChange(value === null ? 0 : value)}
                        max={values.price > 0 ? values.price : undefined}
                        aria-invalid={Boolean(errors.downPayment)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Tenor (periode)" htmlFor="application-tenor" required error={errors.tenor?.message}>
                  <Controller
                    control={control}
                    name="tenor"
                    render={({ field }) => (
                      <NumberInput
                        id="application-tenor"
                        value={field.value}
                        onChange={(value) => field.onChange(value === null ? 0 : value)}
                        min={1}
                        max={600}
                        aria-invalid={Boolean(errors.tenor)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Frekuensi pembayaran" htmlFor="application-frequency" required>
                  <Controller
                    control={control}
                    name="frequency"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-frequency"
                        value={field.value}
                        onValueChange={field.onChange}
                        options={PAYMENT_FREQUENCIES.map((frequency) => ({
                          value: frequency,
                          label: PAYMENT_FREQUENCY_LABELS[frequency],
                        }))}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Tarif bunga"
                  htmlFor="application-rate"
                  error={errors.rateBp?.message}
                  hint={values.method === 'NONE' ? 'Tidak dipakai pada metode tanpa bunga.' : 'Maksimal 100% per basis.'}
                >
                  <Controller
                    control={control}
                    name="rateBp"
                    render={({ field }) => (
                      <PercentInput
                        id="application-rate"
                        valueBp={field.value}
                        onChangeBp={field.onChange}
                        disabled={values.method === 'NONE'}
                        maxPercent={100}
                        aria-invalid={Boolean(errors.rateBp)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Basis tarif" htmlFor="application-rate-basis" required>
                  <Controller
                    control={control}
                    name="rateBasis"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-rate-basis"
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={values.method === 'NONE'}
                        options={RATE_BASES.map((basis) => ({ value: basis, label: RATE_BASIS_LABELS[basis] }))}
                      />
                    )}
                  />
                </FormField>
              </FormGrid>

              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {describeInterestMethod(values.method)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Biaya & Jadwal</CardTitle>
              <CardDescription>Biaya administrasi, jadwal jatuh tempo, dan catatan pengajuan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormGrid>
                <FormField label="Biaya administrasi" htmlFor="application-admin-fee" error={errors.adminFee?.message}>
                  <Controller
                    control={control}
                    name="adminFee"
                    render={({ field }) => (
                      <MoneyInput
                        id="application-admin-fee"
                        value={field.value}
                        onChange={(value) => field.onChange(value === null ? 0 : value)}
                        aria-invalid={Boolean(errors.adminFee)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Posisi biaya administrasi" htmlFor="application-admin-position" required>
                  <Controller
                    control={control}
                    name="adminFeePosition"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-admin-position"
                        value={field.value}
                        onValueChange={field.onChange}
                        options={ADMIN_FEE_POSITIONS.map((position) => ({
                          value: position,
                          label: ADMIN_FEE_POSITION_LABELS[position],
                        }))}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Biaya lain per periode"
                  htmlFor="application-other-fee"
                  error={errors.otherFeePerPeriod?.message}
                  hint="Mis. materai atau provisi yang dibebankan setiap periode."
                >
                  <Controller
                    control={control}
                    name="otherFeePerPeriod"
                    render={({ field }) => (
                      <MoneyInput
                        id="application-other-fee"
                        value={field.value}
                        onChange={(value) => field.onChange(value === null ? 0 : value)}
                        aria-invalid={Boolean(errors.otherFeePerPeriod)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Tanggal pencairan" htmlFor="application-disbursement" error={errors.disbursementDate?.message}>
                  <Controller
                    control={control}
                    name="disbursementDate"
                    render={({ field }) => (
                      <DateInput
                        id="application-disbursement"
                        value={field.value ?? null}
                        onChange={(value) => field.onChange(value)}
                        aria-invalid={Boolean(errors.disbursementDate)}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Tanggal cicilan pertama"
                  htmlFor="application-first-due"
                  required
                  error={errors.firstDueDate?.message}
                  hint="Tidak boleh sebelum tanggal pencairan."
                >
                  <Controller
                    control={control}
                    name="firstDueDate"
                    render={({ field }) => (
                      <DateInput
                        id="application-first-due"
                        value={field.value ?? null}
                        onChange={(value) => field.onChange(value === null ? '' : value)}
                        aria-invalid={Boolean(errors.firstDueDate)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Penyesuaian jatuh tempo" htmlFor="application-adjustment" required>
                  <Controller
                    control={control}
                    name="dueDateAdjustment"
                    render={({ field }) => (
                      <OptionsSelect
                        id="application-adjustment"
                        value={field.value}
                        onValueChange={field.onChange}
                        options={DUE_DATE_ADJUSTMENTS.map((adjustment) => ({
                          value: adjustment,
                          label: DUE_DATE_ADJUSTMENT_LABELS[adjustment],
                        }))}
                      />
                    )}
                  />
                </FormField>
              </FormGrid>

              <FormField label="Catatan" htmlFor="application-notes" error={errors.notes?.message}>
                <Textarea
                  id="application-notes"
                  rows={3}
                  placeholder="Catatan analisis, agunan, atau kesepakatan khusus."
                  aria-invalid={Boolean(errors.notes)}
                  {...register('notes')}
                />
              </FormField>

              <Controller
                control={control}
                name="submit"
                render={({ field }) => (
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id="application-submit-now"
                      checked={field.value === true}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor="application-submit-now" className="cursor-pointer">
                        Langsung ajukan
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Bila tidak dicentang, pengajuan disimpan sebagai draft dan dapat diajukan kemudian dari halaman
                        detail. Pengajuan hanya membuat jadwal cicilan setelah DISETUJUI.
                      </p>
                    </div>
                  </div>
                )}
              />
            </CardContent>
          </Card>

          {createApplication.error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage(createApplication.error)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={createApplication.isPending} disabled={noOrganization}>
              {submitNow ? <Send aria-hidden /> : <Save aria-hidden />}
              {submitNow ? 'Simpan & ajukan' : 'Simpan draft'}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/app/applications">Batal</Link>
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Simulasi Pratinjau</CardTitle>
              <CardDescription>
                Perhitungan pratinjau di sisi klien. Angka final tetap dihitung ulang oleh server saat pengajuan
                disetujui.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {simulation ? (
                <>
                  <dl className="space-y-1">
                    <DetailRow label="Pokok pembiayaan">
                      <MoneyText value={simulation.principal} strong />
                    </DetailRow>
                    <DetailRow
                      label={
                        simulation.method === 'FLAT'
                          ? 'Bunga per periode'
                          : simulation.method === 'ANNUITY'
                            ? 'Bunga periode pertama'
                            : 'Bunga'
                      }
                    >
                      <MoneyText value={simulation.method === 'NONE' ? 0 : (simulation.rows[0]?.interest ?? 0)} />
                    </DetailRow>
                    <DetailRow label="Total bunga">
                      <MoneyText value={simulation.totalInterest} />
                    </DetailRow>
                    <DetailRow label="Total biaya dalam jadwal">
                      <MoneyText value={simulation.otherFees} />
                    </DetailRow>
                    <DetailRow label="Total kewajiban pada jadwal">
                      <MoneyText value={simulation.totalPayable} strong />
                    </DetailRow>
                    {simulation.upfrontAmount > 0 ? (
                      <DetailRow label="Biaya admin dibayar di muka">
                        <MoneyText value={simulation.upfrontAmount} />
                      </DetailRow>
                    ) : null}
                    <DetailRow label="Total keseluruhan">
                      <MoneyText value={simulation.totalPayable + simulation.upfrontAmount} strong />
                    </DetailRow>
                    <DetailRow label="Estimasi cicilan">
                      <MoneyText value={simulation.installmentAmount} strong />
                    </DetailRow>
                  </dl>

                  {simulation.firstInstallmentAmount !== simulation.installmentAmount ||
                  simulation.lastInstallmentAmount !== simulation.installmentAmount ? (
                    <p className="text-xs text-muted-foreground">
                      Cicilan pertama {formatRupiah(simulation.firstInstallmentAmount)}; cicilan terakhir{' '}
                      {formatRupiah(simulation.lastInstallmentAmount)} karena penyesuaian biaya dan pembulatan.
                    </p>
                  ) : null}

                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {describeInterestMethod(simulation.method)}
                    {simulation.method === 'ANNUITY'
                      ? ' Porsi bunga menurun setiap periode meskipun total angsuran tetap.'
                      : ''}
                  </div>

                  <div className="space-y-2">
                    <SectionTitle
                      title="Rencana angsuran"
                      description={`Menampilkan ${Math.min(PREVIEW_ROWS, simulation.rows.length)} dari ${simulation.rows.length} periode.`}
                    />
                    <ScrollArea className="h-80 rounded-md border">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th scope="col" className="px-2 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">
                              #
                            </th>
                            <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                              Pokok
                            </th>
                            <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                              Bunga
                            </th>
                            <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                              Biaya
                            </th>
                            <th scope="col" className="px-2 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {simulation.rows.slice(0, PREVIEW_ROWS).map((row) => (
                            <tr key={row.installmentNumber} className="border-t">
                              <td className="px-2 py-1.5 tabular">{row.installmentNumber}</td>
                              <td className="px-2 py-1.5 text-right">
                                <MoneyText value={row.principal} />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <MoneyText value={row.interest} />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <MoneyText value={row.fees} mutedWhenZero />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <MoneyText value={row.totalDue} strong />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </ScrollArea>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Seluruh angka dibulatkan ke Rupiah penuh; periode terakhir menyerap selisih pembulatan.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  Lengkapi harga barang, uang muka (tidak melebihi harga), dan tenor untuk melihat simulasi. Tidak ada
                  angka yang ditampilkan sebelum input valid.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ringkasan input</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1">
                <DetailRow label="Metode bunga">{INTEREST_METHOD_LABELS[values.method]}</DetailRow>
                <DetailRow label="Tarif">
                  {values.method === 'NONE' ? 'Tanpa bunga' : formatRate(values.rateBp, values.rateBasis)}
                </DetailRow>
                <DetailRow label="Frekuensi">{PAYMENT_FREQUENCY_LABELS[values.frequency]}</DetailRow>
                <DetailRow label="Tenor">{values.tenor || 0} periode</DetailRow>
                <DetailRow label="Biaya administrasi">
                  <MoneyText value={values.adminFee || 0} mutedWhenZero />
                </DetailRow>
                <DetailRow label="Posisi biaya admin">{ADMIN_FEE_POSITION_LABELS[values.adminFeePosition]}</DetailRow>
              </dl>
            </CardContent>
          </Card>
        </div>
      </form>
    </RequirePermission>
  );
}
