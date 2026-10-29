/**
 * CustomerDetailPage.tsx — Detail pelanggan: ringkasan piutang, data pribadi,
 * kontrak, pengajuan, dan pembayaran.
 *
 * Catatan privasi: nomor identitas termasuk data pribadi sehingga ditandai
 * secara eksplisit dan hanya ditampilkan pada bagian "Data Pribadi" yang
 * diberi penanda akses terbatas.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowLeft, Lock, Pencil, Wallet } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { CustomerPortalAccountCard } from '@/components/customer/CustomerPortalAccountCard';
import {
  fetchCustomerApplications,
  fetchCustomerPayments,
  useArchiveCustomer,
  useCustomer,
  useCustomerContracts,
} from '@/data/customers';
import type { ContractSummaryRow, PaymentRow } from '@/data/types';
import { errorMessage } from '@/lib/errors';
import { formatDateShortId, formatDateTimeId } from '@/lib/date';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { DataTable, type Column } from '@/components/data/DataTable';
import {
  ApplicationStatusBadge,
  ContractStatusBadge,
  CustomerStatusBadge,
  DateText,
  DetailRow,
  MoneyText,
  PaymentMethodBadge,
} from '@/components/common/domain';
import { PageHeader, SummaryChip } from '@/components/layout/AppShell';

/* -------------------------------------------------------------------------- */
/* Pembantu pembacaan nilai longgar                                           */
/* -------------------------------------------------------------------------- */

function readRecord(source: unknown): Record<string, unknown> {
  return source !== null && typeof source === 'object' ? (source as Record<string, unknown>) : {};
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

interface DetailEntry {
  readonly label: string;
  readonly value: ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Halaman                                                                    */
/* -------------------------------------------------------------------------- */

export default function CustomerDetailPage(): JSX.Element {
  const { customerId } = useParams<{ customerId: string }>();
  const { can } = useAuth();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const customerQuery = useCustomer(customerId);
  const contractsQuery = useCustomerContracts(customerId);
  const archiveMutation = useArchiveCustomer();

  const applicationsQuery = useQuery({
    queryKey: ['customer-applications', customerId ?? ''],
    queryFn: () => fetchCustomerApplications(customerId!),
    enabled: Boolean(customerId),
  });

  const paymentsQuery = useQuery({
    queryKey: ['customer-payments', customerId ?? ''],
    queryFn: () => fetchCustomerPayments(customerId!),
    enabled: Boolean(customerId),
  });

  const customer = customerQuery.data;

  const personalEntries = useMemo<readonly DetailEntry[]>(() => {
    const record = readRecord(customer);
    const entries: DetailEntry[] = [];

    const birthDate = textValue(record.birth_date);
    if (birthDate) entries.push({ label: 'Tanggal Lahir', value: formatDateShortId(birthDate) });

    const occupation = textValue(record.occupation);
    if (occupation) entries.push({ label: 'Pekerjaan', value: occupation });

    const monthlyIncome = numberValue(record.monthly_income);
    if (monthlyIncome !== null) entries.push({ label: 'Penghasilan Bulanan', value: <MoneyText value={monthlyIncome} /> });

    const address = textValue(record.address);
    if (address) entries.push({ label: 'Alamat', value: address });

    return entries;
  }, [customer]);

  const contactEntries = useMemo<readonly DetailEntry[]>(() => {
    const record = readRecord(customer);
    const entries: DetailEntry[] = [];

    const name = textValue(record.emergency_contact_name);
    if (name) entries.push({ label: 'Nama Kontak Darurat', value: name });

    const phone = textValue(record.emergency_contact_phone);
    if (phone) entries.push({ label: 'Telepon Kontak Darurat', value: <span className="tabular">{phone}</span> });

    return entries;
  }, [customer]);

  const contractColumns = useMemo<readonly Column<ContractSummaryRow>[]>(
    () => [
      {
        key: 'contract_number',
        header: 'Nomor Kontrak',
        cell: (row) => (
          <Link to={`/app/contracts/${row.id}`} className="tabular font-medium text-primary hover:underline">
            {row.contract_number}
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => <ContractStatusBadge status={row.status} />,
      },
      {
        key: 'outstanding',
        header: 'Sisa Piutang',
        align: 'right',
        cell: (row) => <MoneyText value={row.outstanding} />,
      },
      {
        key: 'next_due_date',
        header: 'Jatuh Tempo Berikutnya',
        cell: (row) => <DateText value={row.next_due_date} />,
      },
      {
        key: 'overdue_installments',
        header: 'Cicilan Terlambat',
        align: 'right',
        hideOnMobile: true,
        cell: (row) => <span className="tabular">{row.overdue_installments}</span>,
      },
      {
        key: 'actions',
        header: 'Aksi',
        align: 'right',
        cell: (row) => (
          <Link to={`/app/contracts/${row.id}`} className="text-primary hover:underline">
            Lihat kontrak
          </Link>
        ),
      },
    ],
    [],
  );

  const applicationColumns = useMemo<readonly Column<Record<string, unknown>>[]>(
    () => [
      {
        key: 'application_number',
        header: 'Nomor Pengajuan',
        cell: (row) => (
          <Link
            to={`/app/applications/${String(row.id ?? '')}`}
            className="tabular font-medium text-primary hover:underline"
          >
            {textValue(row.application_number) ?? '-'}
          </Link>
        ),
      },
      {
        key: 'credit_type',
        header: 'Jenis Kredit',
        cell: (row) => textValue(row.credit_type) ?? '-',
      },
      {
        key: 'principal',
        header: 'Pokok Pembiayaan',
        align: 'right',
        cell: (row) => {
          const principal = numberValue(row.principal);
          return principal === null ? <span className="text-muted-foreground">-</span> : <MoneyText value={principal} />;
        },
      },
      {
        key: 'tenor',
        header: 'Tenor',
        align: 'right',
        hideOnMobile: true,
        cell: (row) => {
          const tenor = numberValue(row.tenor);
          return <span className="tabular">{tenor === null ? '-' : `${tenor} periode`}</span>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => {
          const status = textValue(row.status);
          return status ? <ApplicationStatusBadge status={status} /> : <span className="text-muted-foreground">-</span>;
        },
      },
      {
        key: 'created_at',
        header: 'Diajukan',
        hideOnMobile: true,
        cell: (row) => {
          const createdAt = textValue(row.created_at);
          return createdAt ? <span className="tabular">{formatDateTimeId(createdAt)}</span> : '-';
        },
      },
    ],
    [],
  );

  const paymentColumns = useMemo<readonly Column<PaymentRow>[]>(
    () => [
      {
        key: 'receipt_number',
        header: 'Nomor Kuitansi',
        cell: (row) => (
          <Link to={`/app/payments/${row.id}`} className="tabular font-medium text-primary hover:underline">
            {row.receipt_number}
          </Link>
        ),
      },
      {
        key: 'paid_at',
        header: 'Waktu Pembayaran',
        cell: (row) => <span className="tabular">{formatDateTimeId(row.paid_at)}</span>,
      },
      {
        key: 'amount',
        header: 'Nominal',
        align: 'right',
        cell: (row) => <MoneyText value={row.amount} />,
      },
      {
        key: 'method',
        header: 'Metode',
        hideOnMobile: true,
        cell: (row) => <PaymentMethodBadge method={row.method} />,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => (
          <Badge variant={row.status === 'POSTED' ? 'success' : 'destructive'}>
            {row.status === 'POSTED' ? 'Diposting' : 'Dibatalkan'}
          </Badge>
        ),
      },
    ],
    [],
  );

  if (!customerId) {
    return (
      <div className="space-y-4">
        <ErrorState title="Pelanggan tidak ditemukan" message="Alamat halaman tidak memuat nomor pelanggan." />
        <Button variant="outline" asChild>
          <Link to="/app/customers">
            <ArrowLeft aria-hidden />
            Kembali ke daftar pelanggan
          </Link>
        </Button>
      </div>
    );
  }

  if (customerQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (customerQuery.isError) {
    return (
      <ErrorState
        title="Detail pelanggan gagal dimuat"
        message={errorMessage(customerQuery.error)}
        onRetry={() => void customerQuery.refetch()}
      />
    );
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <ErrorState title="Pelanggan tidak ditemukan" message="Data pelanggan tidak tersedia atau telah dihapus." />
        <Button variant="outline" asChild>
          <Link to="/app/customers">
            <ArrowLeft aria-hidden />
            Kembali ke daftar pelanggan
          </Link>
        </Button>
      </div>
    );
  }

  const record = readRecord(customer);
  const identityNumber = textValue(record.identity_number);
  const notes = textValue(record.notes);
  const isArchived = customer.status === 'ARCHIVED';
  const canManage = can('customers.manage');
  const canCollect = can('payments.create');

  const onArchive = async () => {
    try {
      await archiveMutation.mutateAsync({ id: customer.id, archived: true });
      notifySuccess('Pelanggan diarsipkan', 'Data pelanggan tetap tersimpan dan dapat dipulihkan.');
      setArchiveOpen(false);
    } catch (error) {
      notifyError(error, 'Gagal mengarsipkan pelanggan');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.full_name}
        description={`Nomor pelanggan ${customer.customer_number}`}
        badge={<CustomerStatusBadge status={customer.status} />}
        breadcrumb={
          <Link to="/app/customers" className="hover:underline">
            Pelanggan
          </Link>
        }
        actions={
          <>
            {canCollect ? (
              <Button asChild>
                <Link to={`/app/payments/new?customerId=${customer.id}`}>
                  <Wallet aria-hidden />
                  Catat Pembayaran
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="outline" asChild>
                <Link to={`/app/customers/${customer.id}/edit`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="outline" onClick={() => setArchiveOpen(true)} disabled={isArchived}>
                <Archive aria-hidden />
                {isArchived ? 'Sudah Diarsipkan' : 'Arsipkan'}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryChip label="Total Piutang" value={<MoneyText value={customer.outstanding} strong />} />
        <SummaryChip label="Total Tunggakan" value={<MoneyText value={customer.overdue_amount} strong />} />
        <SummaryChip label="Kontrak Aktif" value={<span className="tabular">{customer.active_contracts}</span>} />
        <SummaryChip
          label="Keterlambatan Maksimum"
          value={<span className="tabular">{customer.max_days_late} hari</span>}
        />
      </div>

      <Tabs defaultValue="ringkasan">
        <TabsList className="flex-wrap">
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="kontrak">Kontrak</TabsTrigger>
          <TabsTrigger value="pengajuan">Pengajuan</TabsTrigger>
          <TabsTrigger value="pembayaran">Pembayaran</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Data Pelanggan</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <DetailRow label="Nomor Pelanggan">
                    <span className="tabular">{customer.customer_number}</span>
                  </DetailRow>
                  <DetailRow label="Nama Lengkap">{customer.full_name}</DetailRow>
                  <DetailRow label="Telepon">
                    <span className="tabular">{customer.phone}</span>
                  </DetailRow>
                  <DetailRow label="Email">{customer.email ?? '-'}</DetailRow>
                  <DetailRow label="Status">
                    <CustomerStatusBadge status={customer.status} />
                  </DetailRow>
                  <DetailRow label="Pengingat Jatuh Tempo">
                    {customer.remind_enabled ? 'Aktif' : 'Nonaktif'}
                  </DetailRow>
                  <DetailRow label="Terdaftar Sejak">
                    <span className="tabular">{formatDateTimeId(customer.created_at)}</span>
                  </DetailRow>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle>Data Pribadi</CardTitle>
                <Badge variant="warning">
                  <Lock className="h-3 w-3" aria-hidden />
                  Data pribadi — akses terbatas
                </Badge>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <DetailRow label="Nomor Identitas (KTP/SIM)">
                    {identityNumber ? (
                      <span className="tabular">{identityNumber}</span>
                    ) : (
                      <span className="text-muted-foreground">Tidak tersedia pada tampilan ini</span>
                    )}
                  </DetailRow>
                  {personalEntries.map((entry) => (
                    <DetailRow key={entry.label} label={entry.label}>
                      {entry.value}
                    </DetailRow>
                  ))}
                </dl>
                {personalEntries.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Rincian data pribadi belum dimuat dari sumber data pelanggan. Buka formulir Edit untuk melihat dan
                    melengkapi datanya.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kontak Darurat</CardTitle>
              </CardHeader>
              <CardContent>
                {contactEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Kontak darurat belum terisi atau belum dimuat pada tampilan ini.
                  </p>
                ) : (
                  <dl className="divide-y">
                    {contactEntries.map((entry) => (
                      <DetailRow key={entry.label} label={entry.label}>
                        {entry.value}
                      </DetailRow>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Catatan</CardTitle>
              </CardHeader>
              <CardContent>
                {notes ? (
                  <p className="whitespace-pre-line text-sm">{notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Belum ada catatan untuk pelanggan ini.</p>
                )}
              </CardContent>
            </Card>

            {canManage ? <CustomerPortalAccountCard customer={customer} /> : null}
          </div>
        </TabsContent>

        <TabsContent value="kontrak">
          <DataTable<ContractSummaryRow>
            data={contractsQuery.data ?? []}
            columns={contractColumns}
            getRowId={(row) => row.id}
            searchable={false}
            loading={contractsQuery.isPending}
            error={contractsQuery.isError ? contractsQuery.error : undefined}
            onRetry={() => void contractsQuery.refetch()}
            emptyTitle="Belum ada kontrak"
            emptyDescription="Kontrak akan muncul setelah pengajuan pelanggan disetujui."
          />
        </TabsContent>

        <TabsContent value="pengajuan">
          <DataTable<Record<string, unknown>>
            data={(applicationsQuery.data ?? []) as readonly Record<string, unknown>[]}
            columns={applicationColumns}
            getRowId={(row) => String(row.id ?? '')}
            searchable={false}
            loading={applicationsQuery.isPending}
            error={applicationsQuery.isError ? applicationsQuery.error : undefined}
            onRetry={() => void applicationsQuery.refetch()}
            emptyTitle="Belum ada pengajuan"
            emptyDescription="Pengajuan kredit pelanggan ini akan tampil di sini."
          />
        </TabsContent>

        <TabsContent value="pembayaran">
          <DataTable<PaymentRow>
            data={paymentsQuery.data ?? []}
            columns={paymentColumns}
            getRowId={(row) => row.id}
            searchable={false}
            loading={paymentsQuery.isPending}
            error={paymentsQuery.isError ? paymentsQuery.error : undefined}
            onRetry={() => void paymentsQuery.refetch()}
            emptyTitle="Belum ada pembayaran"
            emptyDescription="Pembayaran pelanggan ini akan tampil di sini."
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Arsipkan pelanggan ini?"
        description="Pelanggan akan dipindahkan ke status Diarsipkan dan tidak lagi muncul pada daftar pelanggan aktif. Data, kontrak, dan riwayat pembayaran tetap tersimpan."
        confirmLabel="Arsipkan"
        cancelLabel="Batal"
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => {
          void onArchive();
        }}
      />
    </div>
  );
}
