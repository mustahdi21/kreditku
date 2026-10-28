/**
 * DataTable.tsx — Tabel data dengan pencarian, pengurutan, paginasi, dan
 * keadaan kosong/pemuatan yang jelas.
 *
 * Komponen ini tidak mengambil data sendiri: pemanggil memberikan baris dan
 * kolom. Penyaringan/pengurutan/paginasi dilakukan di sisi klien untuk dataset
 * halaman tunggal. Untuk dataset besar, pemanggil mengirim data yang sudah
 * dipaginasi server (`manualPagination`).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, EmptyState, ErrorState, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TableSkeleton } from '@/components/ui';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  /** Sel yang dirender. Bila kosong, nilai dari `accessor` ditampilkan apa adanya. */
  readonly cell?: (row: T) => ReactNode;
  readonly accessor?: (row: T) => string | number | null | undefined;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'right' | 'center';
  readonly className?: string;
  readonly headerClassName?: string;
  /** Sembunyikan pada layar kecil untuk menjaga keterbacaan di ponsel. */
  readonly hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  readonly data: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly getRowId: (row: T) => string;
  readonly loading?: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  readonly searchPlaceholder?: string;
  readonly searchable?: boolean;
  readonly initialPageSize?: number;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: ReactNode;
  readonly toolbar?: ReactNode;
  readonly onRowClick?: (row: T) => void;
  readonly footer?: ReactNode;
  /**
   * Mode paginasi manual: pemanggil mengendalikan pencarian, pengurutan, dan
   * halaman (biasanya melalui query server). Komponen hanya menampilkan baris
   * yang diberikan. Indikator "menampilkan x–y" tetap dirender dengan
   * `totalRows` sebagai acuan.
   */
  readonly manualPagination?: boolean;
  /** Jumlah total baris di server (hanya untuk `manualPagination`). */
  readonly totalRows?: number;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading = false,
  error,
  onRetry,
  searchPlaceholder = 'Cari…',
  searchable = true,
  initialPageSize = 20,
  emptyTitle = 'Belum ada data',
  emptyDescription,
  emptyAction,
  toolbar,
  onRowClick,
  footer,
  manualPagination = false,
  totalRows,
}: DataTableProps<T>): JSX.Element {
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...data];
    return data.filter((row) =>
      columns.some((column) => {
        const value = column.accessor?.(row);
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(needle);
      }),
    );
  }, [columns, data, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.accessor) return filtered;
    const accessor = column.accessor;
    return [...filtered].sort((a, b) => {
      const left = accessor(a);
      const right = accessor(b);
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === 'number' && typeof right === 'number') {
        return sort.direction === 'asc' ? left - right : right - left;
      }
      const comparison = String(left).localeCompare(String(right), 'id-ID');
      return sort.direction === 'asc' ? comparison : -comparison;
    });
  }, [columns, filtered, sort]);

  const totalPages = manualPagination ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = manualPagination ? 1 : Math.min(page, totalPages);
  const rows = useMemo(
    () => (manualPagination ? sorted : sorted.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [manualPagination, pageSize, safePage, sorted],
  );

  const toggleSort = (key: string) => {
    setSort((previous) => {
      if (previous?.key !== key) return { key, direction: 'asc' };
      if (previous.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  if (error) {
    return <ErrorState message="Data gagal dimuat." onRetry={onRetry} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && !manualPagination ? (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={searchPlaceholder}
              aria-label="Cari pada tabel"
              className="pl-9"
            />
          </div>
        ) : null}
        {toolbar}
      </div>

      {loading ? (
        <TableSkeleton rows={Math.min(pageSize, 6)} columns={Math.min(columns.length, 5)} />
      ) : sorted.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <div className="overflow-x-auto rounded-lg border scrollbar-thin">
          <table className="w-full caption-bottom text-sm">
            <thead className="bg-muted/50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'h-11 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.hideOnMobile && 'hidden md:table-cell',
                      column.headerClassName,
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn('inline-flex items-center gap-1 hover:text-foreground', column.align === 'right' && 'flex-row-reverse')}
                        aria-label={`Urutkan berdasarkan ${column.header}`}
                      >
                        {column.header}
                        {sort?.key === column.key ? (
                          sort.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={getRowId(row)}
                  className={cn('border-t transition-colors hover:bg-muted/40', onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3 py-2.5 align-middle',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                        column.hideOnMobile && 'hidden md:table-cell',
                        column.className,
                      )}
                    >
                      {column.cell ? column.cell(row) : renderDefault(column.accessor?.(row))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}

      {manualPagination && totalRows !== undefined ? (
        <p className="text-sm text-muted-foreground">
          Menampilkan {rows.length} dari {totalRows} data
          {query ? ' (hasil pencarian)' : ''}
        </p>
      ) : null}

      {!manualPagination && sorted.length > 0 && !loading ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Menampilkan {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} dari {sorted.length} data
            {query ? ' (hasil pencarian)' : ''}
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-[110px]" aria-label="Jumlah baris per halaman">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} / halaman
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>
              Sebelumnya
            </Button>
            <span className="tabular text-sm text-muted-foreground">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderDefault(value: string | number | null | undefined): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">-</span>;
  return value;
}
