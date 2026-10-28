/**
 * SimulatorPage.tsx — Kalkulator angsuran kredit mandiri.
 *
 * Halaman ini TIDAK menulis apa pun ke database: seluruh angka berasal dari
 * `simulateCredit()` pada `src/core/interest.ts`. Bila input belum lengkap
 * atau tidak konsisten, tidak ada satu pun angka yang ditampilkan (tidak
 * pernah NaN) — pengguna menerima pesan validasi berbahasa Indonesia.
 */

import { useState } from 'react';
import { Download, FileDown, FileSpreadsheet, Percent } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { PageHeader } from '@/components/layout/AppShell';
import { DetailRow, MoneyText, StatCard } from '@/components/common/domain';
import { notifyError } from '@/components/common/Toaster';
import { DataTable, type Column } from '@/components/data/DataTable';
import { describeInterestMethod, simulateCredit, type PlanRow, type SimulationSummary } from '@/core/interest';
import { creditSimulationSchema } from '@/core/validation';
import {
  ADMIN_FEE_POSITIONS,
  INTEREST_METHODS,
  INTEREST_METHOD_LABELS,
  PAYMENT_FREQUENCIES,
  PAYMENT_FREQUENCY_LABELS,
  RATE_BASES,
  RATE_BASIS_LABELS,
  type AdminFeePosition,
  type InterestMethod,
  type PaymentFrequency,
  type RateBasis,
} from '@/core/types';
import { exportCsv, exportPdf, exportXlsx, type ExportColumn, type ExportMeta } from '@/lib/exports';
import { bpToPercent, formatRupiah, formatRupiahNumber } from '@/lib/money';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  FormGrid,
  MoneyInput,
  NumberInput,
  OptionsSelect,
  PercentInput,
} from '@/components/ui';

const ADMIN_FEE_POSITION_LABELS: Record<AdminFeePosition, string> = {
  UPFRONT: 'Dibayar di Muka',
  FIRST_INSTALLMENT: 'Digabung ke Cicilan Pertama',
  SPREAD: 'Dibagi ke Seluruh Cicilan',
};

/** Baris ekspor jadwal (semua nilai sudah diformat sebagai teks). */
type ScheduleExportRow = {
  periode: number;
  pokok: string;
  bunga: string;
  biaya: string;
  total: string;
};

const SCHEDULE_COLUMNS: readonly ExportColumn<ScheduleExportRow>[] = [
  { key: 'periode', header: 'Periode', width: 10, align: 'right' },
  { key: 'pokok', header: 'Pokok (Rp)', width: 18, align: 'right' },
  { key: 'bunga', header: 'Bunga (Rp)', width: 18, align: 'right' },
  { key: 'biaya', header: 'Biaya (Rp)', width: 16, align: 'right' },
  { key: 'total', header: 'Total (Rp)', width: 18, align: 'right' },
];

/** Menjalankan simulasi dan menelan kegagalan domain agar UI tidak pecah. */
function trySimulate(input: Parameters<typeof simulateCredit>[0]): SimulationSummary | null {
  try {
    return simulateCredit(input);
  } catch (error) {
    console.error('[KreditKu] simulasi kredit gagal:', error);
    return null;
  }
}

export default function SimulatorPage(): JSX.Element {
  const [price, setPrice] = useState<number | null>(null);
  const [downPayment, setDownPayment] = useState<number | null>(null);
  const [tenor, setTenor] = useState<number | null>(12);
  const [method, setMethod] = useState<InterestMethod>('FLAT');
  const [rateBp, setRateBp] = useState(0);
  const [rateBasis, setRateBasis] = useState<RateBasis>('PER_MONTH');
  const [frequency, setFrequency] = useState<PaymentFrequency>('MONTHLY');
  const [adminFee, setAdminFee] = useState<number | null>(null);
  const [adminFeePosition, setAdminFeePosition] = useState<AdminFeePosition>('UPFRONT');
  const [otherFeePerPeriod, setOtherFeePerPeriod] = useState<number | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);

  const hasBaseInput = price !== null && price > 0 && tenor !== null && tenor > 0;

  const parsed = hasBaseInput
    ? creditSimulationSchema.safeParse({
        price,
        downPayment: downPayment ?? 0,
        tenor,
        method,
        rateBp: method === 'NONE' ? 0 : rateBp,
        rateBasis,
        frequency,
        adminFee: adminFee ?? 0,
        otherFeePerPeriod: otherFeePerPeriod ?? 0,
        adminFeePosition,
      })
    : null;

  const issues = parsed && !parsed.success ? Array.from(new Set(parsed.error.issues.map((issue) => issue.message))) : [];

  const simulation =
    parsed && parsed.success
      ? trySimulate({
          price: parsed.data.price,
          downPayment: parsed.data.downPayment,
          tenor: parsed.data.tenor,
          method: parsed.data.method,
          rateBp: parsed.data.rateBp,
          rateBasis: parsed.data.rateBasis,
          frequency: parsed.data.frequency,
          adminFee: parsed.data.adminFee,
          otherFeePerPeriod: parsed.data.otherFeePerPeriod,
          adminFeePosition: parsed.data.adminFeePosition,
        })
      : null;

  const exportRows: ScheduleExportRow[] = (simulation?.rows ?? []).map((row) => ({
    periode: row.installmentNumber,
    pokok: formatRupiahNumber(row.principal),
    bunga: formatRupiahNumber(row.interest),
    biaya: formatRupiahNumber(row.fees),
    total: formatRupiahNumber(row.totalDue),
  }));

  const canExport = exportRows.length > 0;

  const exportMeta: ExportMeta = {
    filename: 'simulasi-jadwal-angsuran',
    title: 'Simulasi Jadwal Angsuran',
    subtitle: simulation
      ? `${INTEREST_METHOD_LABELS[simulation.method]} • Tenor ${simulation.tenor} periode • Pokok ${formatRupiah(
          simulation.principal,
        )} • Estimasi cicilan ${formatRupiah(simulation.installmentAmount)}`
      : 'Simulasi tanpa penyimpanan data',
  };

  const handleExportCsv = (): void => {
    if (!canExport) return;
    try {
      exportCsv(exportRows, SCHEDULE_COLUMNS, exportMeta);
    } catch (error) {
      notifyError(error, 'Ekspor CSV gagal');
    }
  };

  const handleExportXlsx = async (): Promise<void> => {
    if (!canExport) return;
    setExporting('xlsx');
    try {
      await exportXlsx(exportRows, SCHEDULE_COLUMNS, exportMeta);
    } catch (error) {
      notifyError(error, 'Ekspor Excel gagal');
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!canExport) return;
    setExporting('pdf');
    try {
      await exportPdf(exportRows, SCHEDULE_COLUMNS, exportMeta);
    } catch (error) {
      notifyError(error, 'Ekspor PDF gagal');
    } finally {
      setExporting(null);
    }
  };

  const scheduleColumns: readonly Column<PlanRow>[] = [
    {
      key: 'installmentNumber',
      header: 'Periode',
      align: 'right',
      accessor: (row) => row.installmentNumber,
      cell: (row) => <span className="tabular">{row.installmentNumber}</span>,
    },
    {
      key: 'principal',
      header: 'Pokok',
      align: 'right',
      accessor: (row) => row.principal,
      cell: (row) => <MoneyText value={row.principal} />,
    },
    {
      key: 'interest',
      header: 'Bunga',
      align: 'right',
      accessor: (row) => row.interest,
      cell: (row) => <MoneyText value={row.interest} />,
    },
    {
      key: 'fees',
      header: 'Biaya',
      align: 'right',
      accessor: (row) => row.fees,
      cell: (row) => <MoneyText value={row.fees} mutedWhenZero />,
    },
    {
      key: 'totalDue',
      header: 'Total Angsuran',
      align: 'right',
      accessor: (row) => row.totalDue,
      cell: (row) => <MoneyText value={row.totalDue} strong />,
    },
  ];

  const totalBiaya = simulation ? simulation.adminFee + simulation.otherFees : 0;

  return (
    <RequirePermission permission="applications.view">
      <PageHeader
        title="Simulator Kredit"
        description="Hitung pokok pembiayaan, bunga, biaya, dan jadwal angsuran tanpa menyimpan data apa pun. Angka yang sah dapat diekspor ke CSV, Excel, atau PDF."
        badge={
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Percent className="h-3.5 w-3.5" aria-hidden />
            Tanpa penyimpanan data
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Parameter Simulasi</CardTitle>
            <CardDescription>Isi harga barang dan tenor terlebih dahulu; sisanya boleh dibiarkan default.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormGrid>
              <FormField label="Harga barang" htmlFor="simulator-price" required>
                <MoneyInput id="simulator-price" value={price} onChange={setPrice} />
              </FormField>

              <FormField label="Uang muka" htmlFor="simulator-down-payment" hint="Tidak boleh melebihi harga barang.">
                <MoneyInput id="simulator-down-payment" value={downPayment} onChange={setDownPayment} />
              </FormField>

              <FormField label="Tenor (periode)" htmlFor="simulator-tenor" required>
                <NumberInput id="simulator-tenor" value={tenor} onChange={setTenor} min={1} max={600} />
              </FormField>

              <FormField
                label="Metode bunga"
                htmlFor="simulator-method"
                required
                hint={method === 'NONE' ? 'Tarif diabaikan karena metode tanpa bunga.' : describeInterestMethod(method)}
              >
                <OptionsSelect
                  id="simulator-method"
                  value={method}
                  onValueChange={(value) => {
                    const next = value as InterestMethod;
                    setMethod(next);
                    if (next === 'NONE') setRateBp(0);
                  }}
                  options={INTEREST_METHODS.map((item) => ({ value: item, label: INTEREST_METHOD_LABELS[item] }))}
                />
              </FormField>

              <FormField
                label="Tarif bunga"
                htmlFor="simulator-rate"
                hint={method === 'NONE' ? 'Tidak dipakai.' : 'Maksimal 100% per basis.'}
              >
                <PercentInput
                  id="simulator-rate"
                  valueBp={rateBp}
                  onChangeBp={setRateBp}
                  disabled={method === 'NONE'}
                  maxPercent={100}
                />
              </FormField>

              <FormField label="Basis tarif" htmlFor="simulator-rate-basis" required>
                <OptionsSelect
                  id="simulator-rate-basis"
                  value={rateBasis}
                  onValueChange={(value) => setRateBasis(value as RateBasis)}
                  disabled={method === 'NONE'}
                  options={RATE_BASES.map((basis) => ({ value: basis, label: RATE_BASIS_LABELS[basis] }))}
                />
              </FormField>

              <FormField label="Frekuensi pembayaran" htmlFor="simulator-frequency" required>
                <OptionsSelect
                  id="simulator-frequency"
                  value={frequency}
                  onValueChange={(value) => setFrequency(value as PaymentFrequency)}
                  options={PAYMENT_FREQUENCIES.map((item) => ({
                    value: item,
                    label: PAYMENT_FREQUENCY_LABELS[item],
                  }))}
                />
              </FormField>

              <FormField label="Biaya administrasi" htmlFor="simulator-admin-fee">
                <MoneyInput id="simulator-admin-fee" value={adminFee} onChange={setAdminFee} />
              </FormField>

              <FormField label="Posisi biaya administrasi" htmlFor="simulator-admin-position" required>
                <OptionsSelect
                  id="simulator-admin-position"
                  value={adminFeePosition}
                  onValueChange={(value) => setAdminFeePosition(value as AdminFeePosition)}
                  options={ADMIN_FEE_POSITIONS.map((position) => ({
                    value: position,
                    label: ADMIN_FEE_POSITION_LABELS[position],
                  }))}
                />
              </FormField>

              <FormField
                label="Biaya lain per periode"
                htmlFor="simulator-other-fee"
                hint="Mis. materai atau provisi yang dibebankan setiap periode."
              >
                <MoneyInput id="simulator-other-fee" value={otherFeePerPeriod} onChange={setOtherFeePerPeriod} />
              </FormField>
            </FormGrid>

            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Seluruh angka dibulatkan ke Rupiah penuh; periode terakhir menyerap selisih pembulatan.
            </p>

            {issues.length > 0 ? (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Periksa kembali input berikut:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {issues.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {simulation ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="Pokok pembiayaan" value={formatRupiah(simulation.principal)} />
                <StatCard
                  label={
                    simulation.method === 'FLAT'
                      ? 'Bunga per periode'
                      : simulation.method === 'ANNUITY'
                        ? 'Bunga periode pertama'
                        : 'Bunga'
                  }
                  value={formatRupiah(simulation.method === 'NONE' ? 0 : (simulation.rows[0]?.interest ?? 0))}
                  tone="info"
                />
                <StatCard label="Total bunga" value={formatRupiah(simulation.totalInterest)} tone="info" />
                <StatCard label="Total biaya" value={formatRupiah(totalBiaya)} tone="warning" />
                <StatCard label="Total kewajiban" value={formatRupiah(simulation.totalPayable)} tone="warning" />
                <StatCard label="Estimasi cicilan" value={formatRupiah(simulation.installmentAmount)} tone="success" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Rincian Perhitungan</CardTitle>
                  <CardDescription>{INTEREST_METHOD_LABELS[simulation.method]}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  <DetailRow label="Harga barang">
                    <MoneyText value={simulation.price} />
                  </DetailRow>
                  <DetailRow label="Uang muka">
                    <MoneyText value={simulation.downPayment} />
                  </DetailRow>
                  <DetailRow label="Pokok pembiayaan">
                    <MoneyText value={simulation.principal} strong />
                  </DetailRow>
                  <DetailRow label="Tarif tahunan efektif">
                    <span className="tabular">
                      {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(
                        bpToPercent(simulation.annualRateBp),
                      )}
                      % per tahun
                    </span>
                  </DetailRow>
                  <DetailRow label="Total bunga">
                    <MoneyText value={simulation.totalInterest} />
                  </DetailRow>
                  <DetailRow label="Biaya administrasi">
                    <MoneyText value={simulation.adminFee} mutedWhenZero />
                  </DetailRow>
                  <DetailRow label="Biaya lain (seluruh periode)">
                    <MoneyText value={simulation.otherFees} mutedWhenZero />
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
                  <DetailRow label="Cicilan pertama">
                    <MoneyText value={simulation.firstInstallmentAmount} />
                  </DetailRow>
                  <DetailRow label="Cicilan terakhir">
                    <MoneyText value={simulation.lastInstallmentAmount} />
                  </DetailRow>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Catatan Perhitungan</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <p>{describeInterestMethod(simulation.method)}</p>
                  <p>
                    Seluruh angka dibulatkan ke Rupiah penuh; periode terakhir menyerap selisih pembulatan sehingga
                    jumlah komponen selalu sama dengan total yang dijanjikan.
                  </p>
                  {simulation.firstInstallmentAmount !== simulation.installmentAmount ||
                  simulation.lastInstallmentAmount !== simulation.installmentAmount ? (
                    <p>
                      Cicilan pertama dan terakhir berbeda dari estimasi karena pembebanan biaya dan penyesuaian
                      pembulatan: cicilan pertama {formatRupiah(simulation.firstInstallmentAmount)}, cicilan terakhir{' '}
                      {formatRupiah(simulation.lastInstallmentAmount)}.
                    </p>
                  ) : null}
                  <p>
                    Frekuensi {PAYMENT_FREQUENCY_LABELS[frequency]} mengubah konversi tarif per periode; tarif tidak
                    pernah dicampur antar metode.
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                Isi harga barang dan tenor untuk melihat hasil simulasi. Selama input belum valid, tidak ada angka yang
                ditampilkan agar tidak menyesatkan.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Jadwal Angsuran Lengkap</CardTitle>
          <CardDescription>
            {simulation
              ? `${simulation.rows.length} periode • ${INTEREST_METHOD_LABELS[simulation.method]}`
              : 'Belum ada jadwal untuk diekspor.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportCsv} disabled={!canExport}>
              <Download aria-hidden />
              Ekspor CSV
            </Button>
            <Button variant="outline" onClick={() => void handleExportXlsx()} loading={exporting === 'xlsx'} disabled={!canExport}>
              <FileSpreadsheet aria-hidden />
              Ekspor Excel (XLSX)
            </Button>
            <Button variant="outline" onClick={() => void handleExportPdf()} loading={exporting === 'pdf'} disabled={!canExport}>
              <FileDown aria-hidden />
              Ekspor PDF
            </Button>
          </div>

          <DataTable
            data={simulation?.rows ?? []}
            columns={scheduleColumns}
            getRowId={(row) => String(row.installmentNumber)}
            searchable={false}
            initialPageSize={20}
            emptyTitle="Belum ada jadwal angsuran"
            emptyDescription="Lengkapi parameter simulasi yang valid untuk membentuk jadwal angsuran."
          />

          <p className="text-xs text-muted-foreground">
            Tanggal jatuh tempo tidak ditampilkan pada simulator karena penentuan tanggal dilakukan saat kontrak
            dibuat (mengikuti tanggal cicilan pertama dan kebijakan penyesuaian hari kerja).
          </p>
        </CardContent>
      </Card>
    </RequirePermission>
  );
}
