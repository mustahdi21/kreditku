/**
 * ApplicationsPage.tsx — Daftar pengajuan kredit.
 *
 * Penyaringan status dan pencarian dijalankan di server (React Query +
 * `useApplications(filters)`), begitu pula paginasinya: setiap halaman
 * mengambil potongan data terbaru dari `src/data/credit.ts`.
 *
 * Keputusan pengajuan (setujui/tolak) SELALU melalui RPC server sehingga
 * pembuatan kontrak dan jadwal cicilan terjadi di dalam satu transaksi.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleCheck, CircleX, Eye, Percent, Plus, Search } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
import { ApplicationStatusBadge, DateText, DetailRow, MoneyText } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { useApplications, useDecideApplication, type ApplicationFilters } from '@/data/credit';
import type { ApplicationWithRelations } from '@/data/types';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  INTEREST_METHOD_LABELS,
  RATE_BASIS_LABELS,
  type ApplicationStatus,
} from '@/core/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  OptionsSelect,
  Textarea,
} from '@/components/ui';
import { bpToPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';

/** Status yang masih boleh diputuskan (disetujui/ditolak). */
const DECIDABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface DecisionTarget {
  readonly row: ApplicationWithRelations;
  readonly decision: 'APPROVED' | 'REJECTED';
}

/** Format tarif basis point menjadi persen yang mudah dibaca. */
function formatRate(rateBp: number, rateBasis: string): string {
  const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(bpToPercent(rateBp));
  const basisLabel = RATE_BASIS_LABELS[rateBasis as keyof typeof RATE_BASIS_LABELS] ?? rateBasis;
  return `${percent}% ${basisLabel}`;
}

export default function ApplicationsPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [target, setTarget] = useState<DecisionTarget | null>(null);
  const [reason, setReason] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const filters = useMemo<ApplicationFilters>(
    () => ({
      search,
      statuses: status === 'ALL' ? [] : [status],
      customerId: null,
      page,
      pageSize,
    }),
    [page, pageSize, search, status],
  );

  const applications = useApplications(filters);
  const decide = useDecideApplication();

  const canDecide = can('applications.decide');
  const rows = applications.data?.rows ?? [];
  const total = applications.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const closeDecision = (): void => {
    setTarget(null);
    setReason('');
    setContractNumber('');
    setReasonError(null);
  };

  const openDecision = (row: ApplicationWithRelations, decision: 'APPROVED' | 'REJECTED'): void => {
    setTarget({ row, decision });
    setReason('');
    setContractNumber('');
    setReasonError(null);
  };

  const submitDecision = (): void => {
    if (!target) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      setReasonError('Alasan keputusan wajib diisi minimal 5 karakter.');
      return;
    }

    decide.mutate(
      {
        applicationId: target.row.id,
        decision: target.decision,
        reason: trimmedReason,
        contractNumber: contractNumber.trim() ? contractNumber.trim() : null,
      },
      {
        onSuccess: (result) => {
          const approved = target.decision === 'APPROVED';
          setTarget(null);
          setReason('');
          setContractNumber('');
          setReasonError(null);
          if (approved) {
            notifySuccess(
              'Pengajuan disetujui',
              result.contract_number
                ? `Kontrak ${result.contract_number} beserta jadwal cicilan telah dibuat.`
                : 'Kontrak beserta jadwal cicilan telah dibuat.',
            );
            if (result.contract_id) navigate(`/app/contracts/${result.contract_id}`);
          } else {
            notifySuccess('Pengajuan ditolak', 'Status pengajuan diubah menjadi Ditolak tanpa membuat jadwal cicilan.');
          }
        },
        onError: (error) => notifyError(error, 'Keputusan pengajuan gagal disimpan'),
      },
    );
  };

  const columns: readonly Column<ApplicationWithRelations>[] = [
    {
      key: 'application_number',
      header: 'Nomor Pengajuan',
      accessor: (row) => row.application_number,
      cell: (row) => (
        <Link
          to={`/app/applications/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.application_number}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Pelanggan',
      accessor: (row) => row.customers?.full_name ?? '',
      cell: (row) =>
        row.customers ? (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.customers.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.customers.customer_number}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">Pelanggan tidak ditemukan</span>
        ),
    },
    {
      key: 'credit_type',
      header: 'Jenis Kredit',
      accessor: (row) => row.credit_type,
      cell: (row) => <span className="truncate">{row.credit_type}</span>,
    },
    {
      key: 'principal',
      header: 'Pokok',
      align: 'right',
      accessor: (row) => row.principal,
      cell: (row) => <MoneyText value={row.principal} />,
    },
    {
      key: 'tenor',
      header: 'Tenor',
      align: 'right',
      accessor: (row) => row.tenor,
      cell: (row) => <span className="tabular">{row.tenor}×</span>,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => APPLICATION_STATUS_LABELS[row.status],
      cell: (row) => <ApplicationStatusBadge status={row.status} />,
    },
    {
      key: 'created_at',
      header: 'Tanggal',
      hideOnMobile: true,
      accessor: (row) => row.created_at,
      cell: (row) => <DateText value={row.created_at.slice(0, 10)} />,
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      className: 'whitespace-nowrap',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={`/app/applications/${row.id}`}
              aria-label={`Lihat detail pengajuan ${row.application_number}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Eye aria-hidden />
              Detail
            </Link>
          </Button>
          {canDecide && DECIDABLE_STATUSES.includes(row.status) ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-success hover:text-success"
                onClick={(event) => {
                  event.stopPropagation();
                  openDecision(row, 'APPROVED');
                }}
              >
                <CircleCheck aria-hidden />
                Setujui
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  openDecision(row, 'REJECTED');
                }}
              >
                <CircleX aria-hidden />
                Tolak
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <RequirePermission permission="applications.view">
      <PageHeader
        title="Pengajuan Kredit"
        description="Kelola pengajuan dari draft hingga keputusan. Persetujuan membuat kontrak beserta jadwal cicilan; penolakan tidak pernah membuat jadwal."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/simulator">
                <Percent aria-hidden />
                Simulator
              </Link>
            </Button>
            <Button asChild>
              <Link to="/app/applications/new">
                <Plus aria-hidden />
                Pengajuan Baru
              </Link>
            </Button>
          </>
        }
      />

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={applications.isPending}
        error={applications.error}
        onRetry={() => void applications.refetch()}
        searchable={false}
        initialPageSize={pageSize}
        emptyTitle="Belum ada pengajuan"
        emptyDescription="Buat pengajuan baru atau hitung rencana angsuran lebih dulu pada Simulator Kredit."
        emptyAction={
          <Button asChild>
            <Link to="/app/applications/new">
              <Plus aria-hidden />
              Pengajuan Baru
            </Link>
          </Button>
        }
        onRowClick={(row) => navigate(`/app/applications/${row.id}`)}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Cari nomor / jenis kredit"
                aria-label="Cari pengajuan"
                className="pl-9"
              />
            </div>
            <div>
              <label htmlFor="application-status-filter" className="sr-only">
                Filter status pengajuan
              </label>
              <OptionsSelect
                id="application-status-filter"
                value={status}
                onValueChange={(value) => {
                  setStatus(value as ApplicationStatus | 'ALL');
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: 'Semua status' },
                  ...APPLICATION_STATUSES.map((item) => ({ value: item, label: APPLICATION_STATUS_LABELS[item] })),
                ]}
                className="w-full sm:w-56"
              />
            </div>
            <div>
              <label htmlFor="application-page-size" className="sr-only">
                Jumlah baris per halaman
              </label>
              <OptionsSelect
                id="application-page-size"
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size} / halaman` }))}
                className="w-[140px]"
              />
            </div>
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              Halaman {Math.min(page, totalPages)} dari {totalPages} • {total} pengajuan
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        }
      />

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) closeDecision();
        }}
      >
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>{target?.decision === 'APPROVED' ? 'Setujui pengajuan' : 'Tolak pengajuan'}</DialogTitle>
            <DialogDescription>
              {target
                ? `Pengajuan ${target.row.application_number} • ${target.row.customers?.full_name ?? 'Pelanggan tidak diketahui'}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {target ? (
            <dl className="rounded-md border bg-muted/30 px-3 py-2">
              <DetailRow label="Pokok pembiayaan">
                <MoneyText value={target.row.principal} strong />
              </DetailRow>
              <DetailRow label="Tenor">{target.row.tenor} periode</DetailRow>
              <DetailRow label="Metode bunga">
                {INTEREST_METHOD_LABELS[target.row.method]} • {formatRate(target.row.rate_bp, target.row.rate_basis)}
              </DetailRow>
            </dl>
          ) : null}

          <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-muted-foreground">
            {target?.decision === 'APPROVED'
              ? 'Penyetujuan akan membuat kontrak kredit beserta JADWAL CICILAN secara otomatis, dihitung dari data pembiayaan pengajuan ini. Nomor kontrak boleh dikosongkan agar sistem membuatnya otomatis.'
              : 'Penolakan hanya mengubah status pengajuan menjadi Ditolak. Pengajuan yang ditolak atau dibatalkan TIDAK PERNAH membuat jadwal cicilan.'}
          </p>

          <FormField
            label="Alasan keputusan"
            htmlFor="application-decision-reason"
            required
            error={reasonError}
            hint="Alasan tercatat pada riwayat pengajuan dan audit log."
          >
            <Textarea
              id="application-decision-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              rows={3}
              placeholder="Contoh: analisis kelayakan terpenuhi, agunan lengkap."
              aria-invalid={reasonError !== null}
            />
          </FormField>

          <FormField
            label="Nomor kontrak (opsional)"
            htmlFor="application-decision-contract"
            hint={
              target?.decision === 'APPROVED'
                ? 'Kosongkan agar sistem membuat nomor kontrak otomatis.'
                : 'Nomor kontrak tidak dipakai pada penolakan.'
            }
          >
            <Input
              id="application-decision-contract"
              value={contractNumber}
              onChange={(event) => setContractNumber(event.target.value)}
              placeholder="Contoh: KRD/2026/0001"
              disabled={target?.decision !== 'APPROVED'}
            />
          </FormField>

          {decide.error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage(decide.error)}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDecision} disabled={decide.isPending}>
              Batal
            </Button>
            <Button
              variant={target?.decision === 'APPROVED' ? 'default' : 'destructive'}
              onClick={submitDecision}
              loading={decide.isPending}
            >
              {target?.decision === 'APPROVED' ? 'Setujui pengajuan' : 'Tolak pengajuan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RequirePermission>
  );
}
