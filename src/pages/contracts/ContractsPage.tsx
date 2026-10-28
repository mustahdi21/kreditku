/**
 * ContractsPage.tsx — Daftar kontrak kredit.
 *
 * Penyaringan status (tab), pencarian, dan paginasi dijalankan di server
 * melalui `useContracts(filters)` pada `src/data/credit.ts`.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
import { ContractStatusBadge, DateText, MoneyText } from '@/components/common/domain';
import { useContracts, type ContractFilters } from '@/data/credit';
import type { ContractSummaryRow } from '@/data/types';
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABELS, type ContractStatus } from '@/core/types';
import {
  Button,
  Input,
  OptionsSelect,
  Progress,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function ContractsPage(): JSX.Element {
  const navigate = useNavigate();

  const [status, setStatus] = useState<ContractStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters = useMemo<ContractFilters>(
    () => ({
      search,
      statuses: status === 'ALL' ? [] : [status],
      customerId: null,
      page,
      pageSize,
    }),
    [page, pageSize, search, status],
  );

  const contracts = useContracts(filters);

  const rows = contracts.data?.rows ?? [];
  const total = contracts.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns: readonly Column<ContractSummaryRow>[] = [
    {
      key: 'contract_number',
      header: 'Nomor Kontrak',
      accessor: (row) => row.contract_number,
      cell: (row) => (
        <Link
          to={`/app/contracts/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.contract_number}
        </Link>
      ),
    },
    {
      key: 'customer_name',
      header: 'Pelanggan',
      accessor: (row) => row.customer_name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.customer_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.customer_number}</p>
        </div>
      ),
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
      key: 'total_payable',
      header: 'Total Kewajiban',
      align: 'right',
      accessor: (row) => row.total_payable,
      cell: (row) => <MoneyText value={row.total_payable} strong />,
    },
    {
      key: 'total_paid',
      header: 'Terbayar',
      align: 'right',
      accessor: (row) => row.total_paid,
      cell: (row) => <MoneyText value={row.total_paid} mutedWhenZero />,
    },
    {
      key: 'outstanding',
      header: 'Sisa Piutang',
      align: 'right',
      accessor: (row) => row.outstanding,
      cell: (row) => <MoneyText value={row.outstanding} mutedWhenZero strong />,
    },
    {
      key: 'progress_percent',
      header: 'Progres',
      align: 'right',
      hideOnMobile: true,
      accessor: (row) => row.progress_percent,
      cell: (row) => (
        <div className="ml-auto flex min-w-[8rem] items-center gap-2">
          <Progress
            value={row.progress_percent}
            label={`Progres pembayaran kontrak ${row.contract_number}`}
            className="w-16 shrink-0"
          />
          <span className="tabular text-xs text-muted-foreground">
            {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.progress_percent)}%
          </span>
        </div>
      ),
    },
    {
      key: 'next_due_date',
      header: 'Jatuh Tempo Berikutnya',
      hideOnMobile: true,
      accessor: (row) => row.next_due_date,
      cell: (row) => <DateText value={row.next_due_date} fallback="Tidak ada tagihan" />,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => CONTRACT_STATUS_LABELS[row.status],
      cell: (row) => <ContractStatusBadge status={row.status} />,
    },
    {
      key: 'max_days_late',
      header: 'Tunggakan',
      align: 'right',
      accessor: (row) => row.max_days_late,
      cell: (row) =>
        row.max_days_late > 0 ? (
          <span className="tabular font-medium text-destructive">{row.max_days_late} hari</span>
        ) : (
          <span className="text-xs text-muted-foreground">Tidak menunggak</span>
        ),
    },
  ];

  return (
    <RequirePermission permission="contracts.view">
      <PageHeader
        title="Kontrak Kredit"
        description="Seluruh kontrak beserta total kewajiban, sisa piutang, dan progres pembayaran. Kontrak berstatus Lunas hanya bila seluruh kewajiban telah terselesaikan."
        actions={
          <Button asChild>
            <Link to="/app/applications/new">
              <Plus aria-hidden />
              Pengajuan Baru
            </Link>
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="overflow-x-auto">
          <Tabs
            value={status}
            onValueChange={(value) => {
              setStatus(value as ContractStatus | 'ALL');
              setPage(1);
            }}
          >
            <TabsList className="w-max">
              <TabsTrigger value="ALL">Semua</TabsTrigger>
              {CONTRACT_STATUSES.map((item) => (
                <TabsTrigger key={item} value={item}>
                  {CONTRACT_STATUS_LABELS[item]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={contracts.isPending}
          error={contracts.error}
          onRetry={() => void contracts.refetch()}
          searchable={false}
          initialPageSize={pageSize}
          emptyTitle="Belum ada kontrak"
          emptyDescription="Kontrak dibuat otomatis saat pengajuan kredit disetujui."
          emptyAction={
            <Button asChild>
              <Link to="/app/applications">Lihat pengajuan</Link>
            </Button>
          }
          onRowClick={(row) => navigate(`/app/contracts/${row.id}`)}
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
                  placeholder="Cari nomor kontrak / pelanggan"
                  aria-label="Cari kontrak"
                  className="pl-9"
                />
              </div>
              <div>
                <label htmlFor="contract-page-size" className="sr-only">
                  Jumlah baris per halaman
                </label>
                <OptionsSelect
                  id="contract-page-size"
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
                Halaman {Math.min(page, totalPages)} dari {totalPages} • {total} kontrak
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
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
      </div>
    </RequirePermission>
  );
}
