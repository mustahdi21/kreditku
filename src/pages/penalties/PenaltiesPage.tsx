/**
 * PenaltiesPage.tsx — Denda & tunggakan.
 *
 * Tiga hal yang ditegaskan halaman ini:
 *   1. Umur tunggakan (aging) dihitung server per ember hari keterlambatan.
 *   2. Daftar denda berasal dari catatan denda yang sudah dihitung, bukan
 *      taksiran di layar.
 *   3. Perhitungan ulang TIDAK PERNAH menggandakan denda: satu cicilan hanya
 *      memiliki satu catatan denda aktif, sehingga perhitungan ulang memperbarui
 *      catatan yang sama selama belum dibayar atau dibebaskan.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, RefreshCw, Scale } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { MoneyText, PenaltyStatusBadge, StatCard } from '@/components/common/domain';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader, SummaryChip } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  Input,
  MoneyInput,
  OptionsSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Textarea,
} from '@/components/ui';
import {
  DEFAULT_PENALTY_RULE,
  describePenaltyRule,
  type PenaltyRule,
} from '@/core/penalties';
import { AGING_BUCKET_LABELS } from '@/core/status';
import {
  PENALTY_STATUSES,
  PENALTY_STATUS_LABELS,
  PENALTY_TYPE_LABELS,
  type PenaltyStatus,
  type PenaltyType,
} from '@/core/types';
import { useOverdue } from '@/data/credit';
import { useSettings } from '@/data/admin';
import {
  DEFAULT_PENALTY_FILTERS,
  useAgingReport,
  useApplyPenalties,
  usePenalties,
  useWaivePenalty,
  type PenaltyFilters,
} from '@/data/payments';
import type { InstallmentDetailRow, PenaltyRow, PenaltySettings } from '@/data/types';
import { formatDateId, formatDateTimeId } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatRupiah } from '@/lib/money';

type AgingBucketKey = keyof typeof AGING_BUCKET_LABELS;

/** Ember tunggakan yang mungkin dihasilkan view (hanya yang sudah lewat jatuh tempo). */
const AGING_BUCKETS: readonly { key: AgingBucketKey; tone: 'warning' | 'destructive' }[] = [
  { key: 'D1_7', tone: 'warning' },
  { key: 'D8_30', tone: 'warning' },
  { key: 'D31_60', tone: 'destructive' },
  { key: 'D61_90', tone: 'destructive' },
  { key: 'D90_PLUS', tone: 'destructive' },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const PAGE_SIZE_OPTIONS_SET = PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size} / halaman` }));

const STATUS_FILTER_OPTIONS: readonly { value: PenaltyStatus; label: string }[] = PENALTY_STATUSES.map((status) => ({
  value: status,
  label: PENALTY_STATUS_LABELS[status],
}));

function bucketLabel(bucket: string | null | undefined): string {
  if (!bucket) return '-';
  return AGING_BUCKET_LABELS[bucket as AgingBucketKey] ?? bucket;
}

function openPenaltyAmount(row: PenaltyRow): number {
  return Math.max(0, row.amount - row.paid_amount - row.waived_amount);
}

/** Mengubah pengaturan denda tersimpan menjadi aturan denda yang dapat dijelaskan. */
function toPenaltyRule(settings: PenaltySettings | null | undefined): PenaltyRule {
  if (!settings) return DEFAULT_PENALTY_RULE;
  return {
    type: settings.type,
    amount: settings.amount,
    graceDays: settings.grace_days,
    maxAmount: settings.max_amount,
    percentBase: settings.percent_base === 'TOTAL_DUE' ? 'TOTAL_DUE' : 'OUTSTANDING',
  };
}

const outstandingColumns: Column<InstallmentDetailRow>[] = [
  {
    key: 'contract_number',
    header: 'Kontrak',
    accessor: (row) => row.contract_number,
    cell: (row) => (
      <Link to={`/app/contracts/${row.contract_id}`} className="tabular font-medium text-primary hover:underline">
        {row.contract_number}
      </Link>
    ),
  },
  {
    key: 'customer_name',
    header: 'Pelanggan',
    accessor: (row) => `${row.customer_name} ${row.customer_number}`,
    cell: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.customer_name}</p>
        <p className="tabular text-xs text-muted-foreground">{row.customer_phone}</p>
      </div>
    ),
  },
  {
    key: 'installment_number',
    header: 'Cicilan',
    align: 'center',
    accessor: (row) => row.installment_number,
    cell: (row) => <span className="tabular">ke-{row.installment_number}</span>,
  },
  {
    key: 'due_date',
    header: 'Jatuh Tempo',
    accessor: (row) => row.due_date,
    cell: (row) => <span className="tabular whitespace-nowrap">{formatDateId(row.due_date, 'd MMM yyyy')}</span>,
  },
  {
    key: 'late_days',
    header: 'Hari Terlambat',
    align: 'right',
    accessor: (row) => row.late_days,
    cell: (row) => (
      <Badge variant={row.late_days > 90 ? 'destructive' : 'warning'} className="tabular">
        {row.late_days} hari
      </Badge>
    ),
  },
  {
    key: 'aging_bucket',
    header: 'Ember Umur',
    hideOnMobile: true,
    accessor: (row) => row.aging_bucket,
    cell: (row) => <Badge variant="outline">{bucketLabel(row.aging_bucket)}</Badge>,
  },
  {
    key: 'principal',
    header: 'Pokok',
    align: 'right',
    hideOnMobile: true,
    accessor: (row) => row.principal,
    cell: (row) => <MoneyText value={row.principal} />,
  },
  {
    key: 'interest',
    header: 'Bunga',
    align: 'right',
    hideOnMobile: true,
    accessor: (row) => row.interest,
    cell: (row) => <MoneyText value={row.interest} mutedWhenZero />,
  },
  {
    key: 'fees',
    header: 'Biaya',
    align: 'right',
    hideOnMobile: true,
    accessor: (row) => row.fees,
    cell: (row) => <MoneyText value={row.fees} mutedWhenZero />,
  },
  {
    key: 'penalty_outstanding',
    header: 'Denda',
    align: 'right',
    accessor: (row) => row.penalty_outstanding,
    cell: (row) => <MoneyText value={row.penalty_outstanding} mutedWhenZero />,
  },
  {
    key: 'total_outstanding',
    header: 'Total Sisa',
    align: 'right',
    accessor: (row) => row.outstanding + row.penalty_outstanding,
    cell: (row) => <MoneyText value={row.outstanding + row.penalty_outstanding} strong />,
  },
  {
    key: 'actions',
    header: 'Aksi',
    align: 'right',
    cell: (row) => (
      <Button asChild variant="outline" size="sm">
        <Link to={`/app/payments/new?contractId=${row.contract_id}&installmentId=${row.id}`}>Catat Pembayaran</Link>
      </Button>
    ),
  },
];

export default function PenaltiesPage(): JSX.Element {
  const { can, organizationId } = useAuth();
  const canManage = can('penalties.manage');
  const canWaive = can('penalties.waive');

  const [filters, setFilters] = useState<PenaltyFilters>(DEFAULT_PENALTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [recalculateOpen, setRecalculateOpen] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<PenaltyRow | null>(null);
  const [waiveAmount, setWaiveAmount] = useState<number | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveError, setWaiveError] = useState<string | null>(null);

  const agingQuery = useAgingReport();
  const overdueQuery = useOverdue();
  const penaltiesQuery = usePenalties(filters);
  const settingsQuery = useSettings(organizationId);
  const applyPenalties = useApplyPenalties();
  const waivePenalty = useWaivePenalty();

  const penaltySettings = settingsQuery.data?.penalty ?? null;
  const penaltyRule = useMemo(() => toPenaltyRule(penaltySettings), [penaltySettings]);

  const agingByBucket = useMemo(() => {
    const map = new Map<string, { count: number; outstanding: number; penalty: number; contractCount: number; maxDaysLate: number | null }>();
    for (const row of agingQuery.data ?? []) {
      map.set(row.bucket, {
        count: Number(row.installment_count ?? 0),
        outstanding: Number(row.outstanding ?? 0),
        penalty: Number(row.penalty_outstanding ?? 0),
        contractCount: Number(row.contract_count ?? 0),
        maxDaysLate: row.max_days_late != null ? Number(row.max_days_late) : null,
      });
    }
    return map;
  }, [agingQuery.data]);

  const agingTotals = useMemo(() => {
    let count = 0;
    let outstanding = 0;
    let penalty = 0;
    for (const value of agingByBucket.values()) {
      count += value.count;
      outstanding += value.outstanding;
      penalty += value.penalty;
    }
    return { count, outstanding, penalty };
  }, [agingByBucket]);

  const overdueRows = overdueQuery.data ?? [];
  const overdueTotals = useMemo(
    () =>
      (overdueQuery.data ?? []).reduce(
        (totals, row) => ({
          principal: totals.principal + row.principal,
          interest: totals.interest + row.interest,
          fees: totals.fees + row.fees,
          outstanding: totals.outstanding + row.outstanding,
          penalty: totals.penalty + row.penalty_outstanding,
          total: totals.total + row.outstanding + row.penalty_outstanding,
        }),
        { principal: 0, interest: 0, fees: 0, outstanding: 0, penalty: 0, total: 0 },
      ),
    [overdueQuery.data],
  );

  const penaltyRows = penaltiesQuery.data?.rows ?? [];
  const penaltyTotal = penaltiesQuery.data?.total ?? 0;
  const penaltyTotalPages = Math.max(1, Math.ceil(penaltyTotal / filters.pageSize));

  const openWaiveDialog = (row: PenaltyRow) => {
    setWaiveTarget(row);
    setWaiveAmount(openPenaltyAmount(row));
    setWaiveReason('');
    setWaiveError(null);
  };

  const handleWaive = async () => {
    if (!waiveTarget) return;
    const open = openPenaltyAmount(waiveTarget);
    if (waiveAmount === null || waiveAmount <= 0) {
      setWaiveError('Nominal pembebasan harus lebih besar dari nol.');
      return;
    }
    if (waiveAmount > open) {
      setWaiveError(`Nominal tidak boleh melebihi sisa denda yang terbuka (${formatRupiah(open)}).`);
      return;
    }
    if (waiveReason.trim().length < 10) {
      setWaiveError('Alasan pembebasan wajib diisi minimal 10 karakter agar audit dapat dipertanggungjawabkan.');
      return;
    }
    setWaiveError(null);
    try {
      const result = await waivePenalty.mutateAsync({
        penaltyId: waiveTarget.id,
        amount: waiveAmount,
        reason: waiveReason.trim(),
      });
      notifySuccess(
        `Denda dibebaskan ${formatRupiah(result.waived)}`,
        'Pembebasan dicatat pada audit log beserta nama approver dan alasan yang Anda tulis.',
      );
      setWaiveTarget(null);
      setWaiveReason('');
      setWaiveAmount(null);
    } catch (error) {
      notifyError(error, 'Pembebasan denda gagal');
    }
  };

  const handleRecalculate = async () => {
    try {
      const result = await applyPenalties.mutateAsync({ organizationId, asOf: undefined });
      notifySuccess(
        'Perhitungan denda selesai',
        `${result.processed} cicilan diperiksa • ${result.created} denda dibuat • ${result.updated} denda diperbarui. Perhitungan ulang tidak menggandakan denda pada cicilan yang sama.`,
      );
      setRecalculateOpen(false);
    } catch (error) {
      notifyError(error, 'Perhitungan denda gagal');
    }
  };

  const penaltyColumns: Column<PenaltyRow>[] = [
    {
      key: 'calculated_at',
      header: 'Dihitung',
      accessor: (row) => row.calculated_at,
      cell: (row) => <span className="tabular whitespace-nowrap">{formatDateTimeId(row.calculated_at)}</span>,
    },
    {
      key: 'contract',
      header: 'Kontrak',
      accessor: (row) => row.installments?.credit_contracts?.contract_number ?? '',
      cell: (row) =>
        row.installments?.credit_contracts ? (
          <Link to={`/app/contracts/${row.contract_id}`} className="tabular text-primary hover:underline">
            {row.installments.credit_contracts.contract_number}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'installment',
      header: 'Cicilan',
      align: 'center',
      accessor: (row) => row.installments?.installment_number ?? 0,
      cell: (row) => <span className="tabular">ke-{row.installments?.installment_number ?? '-'}</span>,
    },
    {
      key: 'due_date',
      header: 'Jatuh Tempo',
      hideOnMobile: true,
      accessor: (row) => row.installments?.due_date ?? '',
      cell: (row) => (
        <span className="tabular whitespace-nowrap">
          {row.installments?.due_date ? formatDateId(row.installments.due_date, 'd MMM yyyy') : '-'}
        </span>
      ),
    },
    {
      key: 'rule',
      header: 'Dasar Hitung',
      hideOnMobile: true,
      accessor: (row) => row.rule_snapshot?.type ?? '',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.rule_snapshot?.type
            ? PENALTY_TYPE_LABELS[row.rule_snapshot.type as PenaltyType] ?? row.rule_snapshot.type
            : '-'}
        </span>
      ),
    },
    {
      key: 'late_days',
      header: 'Hari Terlambat',
      align: 'right',
      accessor: (row) => row.late_days,
      cell: (row) => <span className="tabular">{row.late_days} hari</span>,
    },
    {
      key: 'amount',
      header: 'Denda',
      align: 'right',
      accessor: (row) => row.amount,
      cell: (row) => <MoneyText value={row.amount} />,
    },
    {
      key: 'paid_amount',
      header: 'Dibayar',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.paid_amount,
      cell: (row) => <MoneyText value={row.paid_amount} mutedWhenZero />,
    },
    {
      key: 'waived_amount',
      header: 'Dibebaskan',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.waived_amount,
      cell: (row) => <MoneyText value={row.waived_amount} mutedWhenZero />,
    },
    {
      key: 'open_amount',
      header: 'Sisa Denda',
      align: 'right',
      accessor: (row) => openPenaltyAmount(row),
      cell: (row) => <MoneyText value={openPenaltyAmount(row)} strong={openPenaltyAmount(row) > 0} mutedWhenZero />,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => <PenaltyStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      cell: (row) => {
        const open = openPenaltyAmount(row);
        if (row.status !== 'OPEN' || open <= 0) {
          return <span className="text-xs text-muted-foreground">Tidak ada denda terbuka</span>;
        }
        if (!canWaive) {
          return <span className="text-xs text-muted-foreground">Hanya lihat</span>;
        }
        return (
          <Button variant="outline" size="sm" onClick={() => openWaiveDialog(row)}>
            Bebaskan Denda
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Denda & Tunggakan"
        description="Pantau umur tunggakan dan kelola denda keterlambatan. Denda hanya dihitung untuk cicilan yang melewati jatuh tempo dan masih memiliki sisa tagihan."
        actions={
          canManage ? (
            <Button onClick={() => setRecalculateOpen(true)} loading={applyPenalties.isPending}>
              <RefreshCw aria-hidden />
              Hitung Ulang Denda
            </Button>
          ) : null
        }
      />

      {/* Aturan denda yang berlaku */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" aria-hidden />
            Aturan denda yang berlaku
          </CardTitle>
          <CardDescription>
            Aturan ini dibaca dari pengaturan organisasi dan dipakai server saat menghitung denda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : settingsQuery.isError ? (
            <ErrorState
              message={`${errorMessage(settingsQuery.error)} Denda tetap dapat dihitung server, namun rinciannya tidak dapat ditampilkan di sini.`}
              onRetry={() => void settingsQuery.refetch()}
            />
          ) : (
            <>
              <p className="rounded-md border bg-muted/40 p-3 text-sm">{describePenaltyRule(penaltyRule)}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryChip
                  label="Masa tenggang"
                  value={penaltyRule.graceDays > 0 ? `${penaltyRule.graceDays} hari` : 'Tanpa masa tenggang'}
                />
                <SummaryChip
                  label="Batas maksimum per cicilan"
                  value={penaltyRule.maxAmount !== null ? formatRupiah(penaltyRule.maxAmount) : 'Tanpa batas'}
                />
                <SummaryChip label="Jenis denda" value={PENALTY_TYPE_LABELS[penaltyRule.type]} />
                <SummaryChip
                  label="Satu denda per cicilan"
                  value="Ya — tidak pernah digandakan"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Setiap cicilan hanya boleh memiliki satu catatan denda (ditegakkan oleh batas unik di database). Karena
                itu, perhitungan ulang memperbarui catatan yang sama dan tidak pernah menumpuk denda baru selama denda
                belum dibayar atau dibebaskan.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ember umur tunggakan */}
      <Card>
        <CardHeader>
          <CardTitle>Umur tunggakan</CardTitle>
          <CardDescription>
            Dikelompokkan per rentang hari keterlambatan. Nilai denda adalah denda yang belum dibayar (status terbuka).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {agingQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {AGING_BUCKETS.map((bucket) => (
                <Skeleton key={bucket.key} className="h-24 w-full" />
              ))}
            </div>
          ) : agingQuery.isError ? (
            <ErrorState message={errorMessage(agingQuery.error)} onRetry={() => void agingQuery.refetch()} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {AGING_BUCKETS.map((bucket) => {
                  const value = agingByBucket.get(bucket.key);
                  return (
                    <StatCard
                      key={bucket.key}
                      label={AGING_BUCKET_LABELS[bucket.key]}
                      value={formatRupiah(value?.outstanding ?? 0)}
                      hint={`${value?.count ?? 0} cicilan • ${value?.contractCount ?? 0} kontrak • denda ${formatRupiah(
                        value?.penalty ?? 0,
                      )}${value?.maxDaysLate ? ` • terlama ${value.maxDaysLate} hari` : ''}`}
                      tone={bucket.tone}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  Total tunggakan pada ember di atas: <MoneyText value={agingTotals.outstanding} strong />
                </span>
                <span className="text-muted-foreground">
                  Total denda terbuka: <MoneyText value={agingTotals.penalty} />
                </span>
                <span className="text-muted-foreground">Jumlah cicilan: {agingTotals.count}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Daftar tunggakan */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar tunggakan</CardTitle>
          <CardDescription>
            Seluruh cicilan yang melewati jatuh tempo dan masih memiliki sisa tagihan, diurutkan dari yang paling lama.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={overdueRows}
            columns={outstandingColumns}
            getRowId={(row) => row.id}
            loading={overdueQuery.isLoading}
            error={overdueQuery.isError ? overdueQuery.error : undefined}
            onRetry={() => void overdueQuery.refetch()}
            searchPlaceholder="Cari kontrak atau pelanggan…"
            initialPageSize={20}
            emptyTitle="Tidak ada tunggakan"
            emptyDescription="Semua cicilan berjalan masih dalam masa tenggang."
            footer={
              overdueRows.length > 0 ? (
                <span>
                  Total halaman ini: pokok {formatRupiah(overdueTotals.principal)} • bunga{' '}
                  {formatRupiah(overdueTotals.interest)} • biaya {formatRupiah(overdueTotals.fees)} • sisa tagihan{' '}
                  {formatRupiah(overdueTotals.outstanding)} • denda {formatRupiah(overdueTotals.penalty)} • total{' '}
                  {formatRupiah(overdueTotals.total)}
                </span>
              ) : null
            }
          />
        </CardContent>
      </Card>

      {/* Catatan denda */}
      <Card>
        <CardHeader>
          <CardTitle>Catatan denda</CardTitle>
          <CardDescription>
            Denda yang sudah dihitung server. Pembebasan hanya mengurangi nilai denda terbuka dan selalu memerlukan
            alasan tertulis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:max-w-xs">
              <Input
                value={searchDraft}
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  setFilters((previous) => ({ ...previous, search: event.target.value, page: 1 }));
                }}
                placeholder="Cari pada rincian perhitungan denda…"
                aria-label="Cari catatan denda"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Filter status denda">
                  Status denda
                  {filters.statuses.length > 0 ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {filters.statuses.length}
                    </Badge>
                  ) : null}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2">
                <div className="space-y-0.5">
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={filters.statuses.includes(option.value)}
                        onCheckedChange={(checked) =>
                          setFilters((previous) => ({
                            ...previous,
                            page: 1,
                            statuses:
                              checked === true
                                ? [...previous.statuses, option.value]
                                : previous.statuses.filter((value) => value !== option.value),
                          }))
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {filters.statuses.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 w-full"
                    onClick={() => setFilters((previous) => ({ ...previous, page: 1, statuses: [] }))}
                  >
                    Tampilkan semua status
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft('');
                setFilters(DEFAULT_PENALTY_FILTERS);
              }}
            >
              Reset filter
            </Button>
          </div>

          <DataTable
            data={penaltyRows}
            columns={penaltyColumns}
            getRowId={(row) => row.id}
            loading={penaltiesQuery.isLoading}
            error={penaltiesQuery.isError ? penaltiesQuery.error : undefined}
            onRetry={() => void penaltiesQuery.refetch()}
            searchable={false}
            initialPageSize={200}
            emptyTitle="Belum ada catatan denda"
            emptyDescription="Denda akan muncul setelah perhitungan denda dijalankan untuk cicilan yang melewati jatuh tempo."
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Halaman {filters.page} dari {penaltyTotalPages} • {penaltyTotal} catatan denda (paginasi server)
                </span>
                <div className="flex items-center gap-2">
                  <OptionsSelect
                    aria-label="Jumlah baris per halaman"
                    className="h-9 w-[120px]"
                    value={String(filters.pageSize)}
                    onValueChange={(value) =>
                      setFilters((previous) => ({ ...previous, page: 1, pageSize: Number(value) }))
                    }
                    options={PAGE_SIZE_OPTIONS_SET}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((previous) => ({ ...previous, page: Math.max(1, previous.page - 1) }))}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filters.page >= penaltyTotalPages}
                    onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            }
          />
        </CardContent>
      </Card>

      {/* Dialog pembebasan denda */}
      <Dialog
        open={waiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWaiveTarget(null);
            setWaiveReason('');
            setWaiveAmount(null);
            setWaiveError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bebaskan denda</DialogTitle>
            <DialogDescription>
              {waiveTarget
                ? `Cicilan ke-${waiveTarget.installments?.installment_number ?? '-'} • jatuh tempo ${
                    waiveTarget.installments?.due_date ? formatDateId(waiveTarget.installments.due_date) : '-'
                  } • sisa denda terbuka ${formatRupiah(openPenaltyAmount(waiveTarget))}.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormField
              label="Nominal yang dibebaskan"
              required
              error={waiveError && waiveAmount === null ? waiveError : null}
              hint="Tidak boleh melebihi sisa denda terbuka. Nominal 0 tidak diterima."
            >
              <div className="flex items-center gap-2">
                <MoneyInput
                  value={waiveAmount}
                  onChange={(value) => setWaiveAmount(value)}
                  max={waiveTarget ? openPenaltyAmount(waiveTarget) : undefined}
                />
                {waiveTarget ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWaiveAmount(openPenaltyAmount(waiveTarget))}
                  >
                    Seluruhnya
                  </Button>
                ) : null}
              </div>
            </FormField>

            <FormField
              label="Alasan pembebasan"
              required
              error={waiveError && waiveReason.trim().length < 10 ? waiveError : null}
              hint="Minimal 10 karakter. Alasan ini tersimpan pada audit log bersama nama Anda."
            >
              <Textarea
                value={waiveReason}
                onChange={(event) => setWaiveReason(event.target.value)}
                placeholder="Contoh: pelanggan sakit, kebijakan keringanan manajemen."
              />
            </FormField>

            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Pembebasan denda tercatat pada audit log lengkap dengan nama approver (Anda), nominal, dan alasan. Denda
              yang dibebaskan tidak dihitung sebagai penerimaan.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWaiveTarget(null);
                setWaiveReason('');
                setWaiveAmount(null);
                setWaiveError(null);
              }}
            >
              Batal
            </Button>
            <Button onClick={() => void handleWaive()} loading={waivePenalty.isPending}>
              Bebaskan denda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={recalculateOpen}
        onOpenChange={setRecalculateOpen}
        title="Hitung ulang denda sekarang?"
        description="Server akan memeriksa seluruh cicilan menunggak, membuat catatan denda untuk cicilan yang belum punya, dan memperbarui catatan yang belum dibayar atau dibebaskan."
        confirmLabel="Hitung ulang"
        loading={applyPenalties.isPending}
        onConfirm={() => void handleRecalculate()}
      >
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Perhitungan ulang bersifat idempoten untuk nilai hari berjalan: satu cicilan hanya memiliki satu catatan denda,
          sehingga denda tidak pernah digandakan. Denda yang sudah dibayar atau dibebaskan tidak diubah.
        </p>
      </ConfirmDialog>
    </div>
  );
}
