/**
 * AuditLogPage.tsx — Penelusuran audit log organisasi.
 *
 * Audit log bersifat HANYA TAMBAH (append-only): catatan tidak dapat diubah
 * maupun dihapus dari aplikasi. Halaman ini tidak menyediakan aksi tulis apa
 * pun — hanya pencarian, filter, dan pembacaan detail.
 */

import { useMemo, useState } from 'react';
import { Filter, History, Info, Lock } from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { DataTable, type Column } from '@/components/data/DataTable';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
  OptionsSelect,
  ScrollArea,
} from '@/components/ui';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { DEFAULT_AUDIT_FILTERS, useAuditLogs } from '@/data/admin';
import { TABLES } from '@/lib/supabase';
import { formatDateTimeId } from '@/lib/date';
import { AUDIT_ACTIONS } from '@/core/types';
import type { AuditLogRow } from '@/data/types';

/** Label Bahasa Indonesia untuk aksi audit (kunci tetap dari enum database). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Membuat',
  UPDATE: 'Memperbarui',
  DELETE: 'Menghapus',
  ARCHIVE: 'Mengarsipkan',
  RESTORE: 'Memulihkan',
  APPROVE: 'Menyetujui',
  REJECT: 'Menolak',
  CANCEL: 'Membatalkan',
  POST_PAYMENT: 'Mencatat Pembayaran',
  REVERSE_PAYMENT: 'Membatalkan Pembayaran',
  WAIVE_PENALTY: 'Membebaskan Denda',
  LOGIN: 'Masuk',
  LOGOUT: 'Keluar',
  INVITE_USER: 'Mengundang Pengguna',
  ACTIVATE_USER: 'Mengaktifkan Pengguna',
  DEACTIVATE_USER: 'Menonaktifkan Pengguna',
  SETTINGS_CHANGE: 'Mengubah Pengaturan',
  EXPORT: 'Mengekspor Data',
};

const ACTION_OPTIONS = [
  { value: 'ALL', label: 'Semua aksi' },
  ...AUDIT_ACTIONS.map((action) => ({ value: action, label: AUDIT_ACTION_LABELS[action] ?? action })),
];

/** Daftar entitas berasal dari konstanta tabel aplikasi (bukan tebakan). */
const ENTITY_OPTIONS = [
  { value: 'ALL', label: 'Semua entitas' },
  ...[...new Set(Object.values(TABLES))].sort().map((table) => ({ value: table, label: table })),
];

function JsonPane({ title, value }: { title: string; value: Record<string, unknown> | null }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ScrollArea className="h-64 rounded-md border bg-muted/30">
        <pre className="p-3 text-xs leading-relaxed">
          {value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : 'Tidak ada data.'}
        </pre>
      </ScrollArea>
    </div>
  );
}

function AuditContent(): JSX.Element {
  const [search, setSearch] = useState(DEFAULT_AUDIT_FILTERS.search);
  const [action, setAction] = useState<string>('ALL');
  const [entityType, setEntityType] = useState<string>('ALL');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const filters = useMemo(
    () => ({
      search,
      action: action === 'ALL' ? null : action,
      entityType: entityType === 'ALL' ? null : entityType,
      from,
      to,
      page,
      pageSize: DEFAULT_AUDIT_FILTERS.pageSize,
    }),
    [action, entityType, from, page, search, to],
  );

  const query = useAuditLogs(filters);
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_AUDIT_FILTERS.pageSize));
  const safePage = Math.min(page, totalPages);

  const columns: readonly Column<AuditLogRow>[] = [
    {
      key: 'created_at',
      header: 'Waktu',
      accessor: (row) => row.created_at,
      sortable: true,
      cell: (row) => <span className="tabular whitespace-nowrap">{formatDateTimeId(row.created_at)}</span>,
    },
    {
      key: 'actor_email',
      header: 'Aktor',
      accessor: (row) => row.actor_email ?? 'Sistem',
      sortable: true,
    },
    {
      key: 'action',
      header: 'Aksi',
      accessor: (row) => row.action,
      sortable: true,
      cell: (row) => <Badge variant="secondary">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</Badge>,
    },
    {
      key: 'entity_type',
      header: 'Entitas',
      accessor: (row) => row.entity_type,
      sortable: true,
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="font-mono text-xs">{row.entity_type}</p>
          {row.entity_id ? <p className="truncate font-mono text-xs text-muted-foreground">{row.entity_id}</p> : null}
        </div>
      ),
    },
    {
      key: 'summary',
      header: 'Ringkasan',
      accessor: (row) => row.summary ?? '-',
      cell: (row) => <span className="text-sm">{row.summary ?? '-'}</span>,
    },
    {
      key: 'detail',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
          Detail
        </Button>
      ),
    },
  ];

  const resetFilters = () => {
    setSearch('');
    setAction('ALL');
    setEntityType('ALL');
    setFrom(null);
    setTo(null);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        description="Jejak seluruh perubahan data penting pada organisasi aktif."
        badge={
          <Badge variant="muted" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden />
            Hanya baca
          </Badge>
        }
      />

      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Audit log bersifat hanya-tambah (append-only).</p>
        <p>
          Catatan tidak dapat diedit maupun dihapus — baik dari antarmuka ini maupun dari aplikasi. Perubahan hanya
          dapat dilakukan langsung oleh administrator basis data sesuai kebijakan retensi organisasi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" aria-hidden />
            Filter
          </CardTitle>
          <CardDescription>Cari berdasarkan ringkasan/email, aksi, entitas, dan rentang waktu.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-64">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Pencarian</p>
              <Input
                value={search}
                placeholder="Cari ringkasan, email, atau entitas…"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                aria-label="Cari audit log"
              />
            </div>
            <div className="w-full sm:w-52">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Aksi</p>
              <OptionsSelect
                value={action}
                onValueChange={(value) => {
                  setAction(value);
                  setPage(1);
                }}
                options={ACTION_OPTIONS}
              />
            </div>
            <div className="w-full sm:w-52">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Entitas</p>
              <OptionsSelect
                value={entityType}
                onValueChange={(value) => {
                  setEntityType(value);
                  setPage(1);
                }}
                options={ENTITY_OPTIONS}
              />
            </div>
            <div className="w-full sm:w-40">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Dari tanggal</p>
              <DateInput
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-full sm:w-40">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Sampai tanggal</p>
              <DateInput
                value={to}
                onChange={(value) => {
                  setTo(value);
                  setPage(1);
                }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset filter
            </Button>
          </div>
          {from && to && from > to ? (
            <p className="text-xs font-medium text-destructive">
              Tanggal awal melebihi tanggal akhir sehingga hasil dapat kosong. Sesuaikan rentangnya.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {query.error ? (
            <ErrorState
              title="Audit log gagal dimuat"
              message="Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void query.refetch()}
            />
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={query.isLoading}
              searchable={false}
              initialPageSize={DEFAULT_AUDIT_FILTERS.pageSize}
              emptyTitle="Tidak ada catatan audit"
              emptyDescription="Tidak ada aktivitas yang cocok dengan filter terpilih."
              footer={
                total > DEFAULT_AUDIT_FILTERS.pageSize ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Halaman {safePage} dari {totalPages} • {total} catatan
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      >
                        Sebelumnya
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      >
                        Berikutnya
                      </Button>
                    </div>
                  </div>
                ) : null
              }
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" aria-hidden />
              Detail Aktivitas
            </DialogTitle>
            <DialogDescription>
              {selected ? `${AUDIT_ACTION_LABELS[selected.action] ?? selected.action} • ${selected.entity_type}` : ''}
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-4">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Waktu</dt>
                  <dd className="text-sm font-medium">{formatDateTimeId(selected.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Aktor</dt>
                  <dd className="text-sm font-medium">{selected.actor_email ?? 'Sistem'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">ID Entitas</dt>
                  <dd className="break-all font-mono text-xs">{selected.entity_id ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ringkasan</dt>
                  <dd className="text-sm">{selected.summary ?? '-'}</dd>
                </div>
              </dl>

              <div className="grid gap-4 lg:grid-cols-2">
                <JsonPane title="Data sebelum" value={selected.before_data} />
                <JsonPane title="Data sesudah" value={selected.after_data} />
              </div>

              <JsonPane title="Metadata" value={selected.metadata} />

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Nilai ditampilkan apa adanya dari catatan audit dan tidak dapat diubah dari halaman ini.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AuditLogPage(): JSX.Element {
  return (
    <RequirePermission permission="audit.view">
      <AuditContent />
    </RequirePermission>
  );
}
