/**
 * CustomersPage.tsx — Daftar pelanggan dengan pencarian, filter status,
 * pengurutan, dan paginasi sisi server.
 *
 * Paginasi, pencarian, dan pengurutan dikerjakan oleh database melalui
 * `useCustomers(filters)`; `DataTable` hanya merender halaman yang sedang
 * aktif. Jumlah total baris ditampilkan pada teks footer bersama kendali
 * halaman.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownUp, Filter, Plus, X } from 'lucide-react';
import { DEFAULT_CUSTOMER_FILTERS, useCustomers, type CustomerFilters } from '@/data/customers';
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from '@/core/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Checkbox, Input, Label, OptionsSelect, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/DataTable';
import { CustomerStatusBadge, DateText, MoneyText } from '@/components/common/domain';
import { PageHeader } from '@/components/layout/AppShell';
import type { CustomerSummaryRow } from '@/data/types';

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Terbaru ditambahkan' },
  { value: 'full_name', label: 'Nama pelanggan' },
  { value: 'customer_number', label: 'Nomor pelanggan' },
  { value: 'outstanding', label: 'Piutang terbesar' },
];

const SEARCH_DEBOUNCE_MS = 300;

export default function CustomersPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('customers.manage');

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<CustomerFilters>({ ...DEFAULT_CUSTOMER_FILTERS });
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const customersQuery = useCustomers(filters);
  const rows = customersQuery.data?.rows ?? [];
  const total = customersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const firstRow = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const lastRow = Math.min(filters.page * filters.pageSize, total);

  const toggleStatus = (status: CustomerStatus, checked: boolean) => {
    setFilters((current) => {
      const statuses = checked
        ? [...current.statuses, status]
        : current.statuses.filter((item) => item !== status);
      return { ...current, statuses, page: 1 };
    });
  };

  const columns = useMemo<readonly Column<CustomerSummaryRow>[]>(
    () => [
      {
        key: 'customer_number',
        header: 'Nomor Pelanggan',
        accessor: (row) => row.customer_number,
        cell: (row) => <span className="tabular font-medium">{row.customer_number}</span>,
      },
      {
        key: 'full_name',
        header: 'Nama',
        accessor: (row) => row.full_name,
        cell: (row) => <span className="font-medium">{row.full_name}</span>,
      },
      {
        key: 'phone',
        header: 'Telepon',
        accessor: (row) => row.phone,
        hideOnMobile: true,
        cell: (row) => <span className="tabular">{row.phone}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (row) => row.status,
        cell: (row) => <CustomerStatusBadge status={row.status} />,
      },
      {
        key: 'active_contracts',
        header: 'Kontrak Aktif',
        align: 'right',
        accessor: (row) => row.active_contracts,
        hideOnMobile: true,
        cell: (row) => <span className="tabular">{row.active_contracts}</span>,
      },
      {
        key: 'outstanding',
        header: 'Total Piutang',
        align: 'right',
        accessor: (row) => row.outstanding,
        cell: (row) => <MoneyText value={row.outstanding} />,
      },
      {
        key: 'overdue_amount',
        header: 'Tunggakan',
        align: 'right',
        accessor: (row) => row.overdue_amount,
        cell: (row) =>
          row.overdue_amount > 0 ? (
            <MoneyText value={row.overdue_amount} className="text-destructive" />
          ) : (
            <MoneyText value={0} mutedWhenZero />
          ),
      },
      {
        key: 'next_due_date',
        header: 'Jatuh Tempo Berikutnya',
        hideOnMobile: true,
        cell: (row) => <DateText value={row.next_due_date} />,
      },
      {
        key: 'actions',
        header: 'Aksi',
        align: 'right',
        cell: (row) => (
          <div className="flex items-center justify-end gap-3">
            <Link
              to={`/app/customers/${row.id}`}
              className="text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              Detail
            </Link>
            {canManage ? (
              <Link
                to={`/app/customers/${row.id}/edit`}
                className="text-primary hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                Edit
              </Link>
            ) : null}
          </div>
        ),
      },
    ],
    [canManage],
  );

  const activeStatusCount = filters.statuses.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pelanggan"
        description="Kelola data pelanggan, kontrak aktif, dan piutang berjalan."
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/app/customers/new">
                <Plus aria-hidden />
                Tambah Pelanggan
              </Link>
            </Button>
          ) : null
        }
      />

      <DataTable<CustomerSummaryRow>
        key={filters.pageSize}
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        searchable={false}
        loading={customersQuery.isPending}
        error={customersQuery.isError ? customersQuery.error : undefined}
        onRetry={() => void customersQuery.refetch()}
        initialPageSize={filters.pageSize}
        emptyTitle="Belum ada pelanggan"
        emptyDescription={
          filters.search || activeStatusCount > 0
            ? 'Tidak ada pelanggan yang cocok dengan pencarian atau filter yang dipilih.'
            : 'Tambahkan pelanggan pertama untuk mulai mencatat pengajuan dan kontrak.'
        }
        onRowClick={(row) => navigate(`/app/customers/${row.id}`)}
        toolbar={
          <>
            <div className="w-full sm:max-w-xs">
              <Label htmlFor="customer-search" className="sr-only">
                Cari pelanggan
              </Label>
              <Input
                id="customer-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Cari nama, nomor pelanggan, atau telepon"
              />
            </div>

            <Popover open={statusOpen} onOpenChange={setStatusOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Filter status pelanggan">
                  <Filter aria-hidden />
                  Status{activeStatusCount > 0 ? ` (${activeStatusCount})` : ''}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status pelanggan</p>
                {CUSTOMER_STATUSES.map((status) => (
                  <div key={status} className="flex items-center gap-2">
                    <Checkbox
                      id={`customer-status-${status}`}
                      checked={filters.statuses.includes(status)}
                      onCheckedChange={(checked) => toggleStatus(status, checked === true)}
                    />
                    <Label htmlFor={`customer-status-${status}`} className="cursor-pointer font-normal">
                      {CUSTOMER_STATUS_LABELS[status]}
                    </Label>
                  </div>
                ))}
                {activeStatusCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFilters((current) => ({ ...current, statuses: [], page: 1 }))}
                  >
                    <X aria-hidden />
                    Hapus filter status
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2">
              <div className="w-48">
                <Label htmlFor="customer-sort" className="sr-only">
                  Urutkan pelanggan
                </Label>
                <OptionsSelect
                  id="customer-sort"
                  value={filters.sortBy}
                  onValueChange={(value) =>
                    setFilters((current) => ({ ...current, sortBy: value as CustomerFilters['sortBy'], page: 1 }))
                  }
                  options={SORT_OPTIONS}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    sortDir: current.sortDir === 'asc' ? 'desc' : 'asc',
                    page: 1,
                  }))
                }
                aria-label={filters.sortDir === 'asc' ? 'Urutkan menurun' : 'Urutkan menaikkan'}
                title={filters.sortDir === 'asc' ? 'Arah: menaikkan' : 'Arah: menurun'}
              >
                <ArrowDownUp aria-hidden />
              </Button>
            </div>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              Menampilkan {firstRow}–{lastRow} dari {total} pelanggan
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                disabled={filters.page <= 1}
              >
                Sebelumnya
              </Button>
              <span className="tabular">
                Halaman {filters.page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                disabled={filters.page >= totalPages}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        }
      />
    </div>
  );
}
