/**
 * CustomerFormPage.tsx — Formulir tambah dan ubah data pelanggan.
 *
 * Validasi memakai skema `customerSchema` dari `@/core/validation` (validasi
 * yang sama juga ditegakkan di database). Nomor pelanggan dibangkitkan server,
 * sehingga pengguna tidak pernah mengetiknya.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save, ShieldAlert } from 'lucide-react';
import { customerSchema, type CustomerInput } from '@/core/validation';
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from '@/core/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCreateCustomer, useCustomer, useUpdateCustomer } from '@/data/customers';
import type { CustomerSummaryRow } from '@/data/types';
import { errorMessage } from '@/lib/errors';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
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
import { PageHeader } from '@/components/layout/AppShell';
import { RequirePermission } from '@/routes/ProtectedRoute';

const STATUS_OPTIONS = CUSTOMER_STATUSES.map((status) => ({
  value: status,
  label: CUSTOMER_STATUS_LABELS[status],
}));

const EMPTY_VALUES: CustomerInput = {
  fullName: '',
  identityNumber: null,
  phone: '',
  email: null,
  address: null,
  birthDate: null,
  occupation: null,
  monthlyIncome: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  notes: null,
  status: 'PROSPECT',
  remindEnabled: true,
};

function mapCustomerToInput(row: CustomerSummaryRow): CustomerInput {
  return {
    fullName: row.full_name,
    identityNumber: row.identity_number,
    phone: row.phone,
    email: row.email,
    address: row.address,
    birthDate: row.birth_date,
    occupation: row.occupation,
    monthlyIncome: row.monthly_income,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    notes: row.notes,
    status: row.status,
    remindEnabled: row.remind_enabled,
  };
}

/**
 * Membentuk muatan pembaruan hanya untuk kolom yang benar-benar dimuat dari
 * sumber data. Kolom yang tidak tersedia pada baris yang dimuat tidak ikut
 * dikirim, sehingga nilai yang belum tampil tidak tertimpa menjadi kosong.
 */
function buildUpdatePayload(values: CustomerInput, columns: ReadonlySet<string>): Partial<CustomerInput> {
  const payload: Partial<CustomerInput> = {};

  if (columns.has('full_name')) payload.fullName = values.fullName;
  if (columns.has('identity_number')) payload.identityNumber = values.identityNumber ?? null;
  if (columns.has('phone')) payload.phone = values.phone;
  if (columns.has('email')) payload.email = values.email ?? null;
  if (columns.has('address')) payload.address = values.address ?? null;
  if (columns.has('birth_date')) payload.birthDate = values.birthDate ?? null;
  if (columns.has('occupation')) payload.occupation = values.occupation ?? null;
  if (columns.has('monthly_income')) payload.monthlyIncome = values.monthlyIncome ?? null;
  if (columns.has('emergency_contact_name')) payload.emergencyContactName = values.emergencyContactName ?? null;
  if (columns.has('emergency_contact_phone')) payload.emergencyContactPhone = values.emergencyContactPhone ?? null;
  if (columns.has('notes')) payload.notes = values.notes ?? null;
  if (columns.has('status')) payload.status = values.status;
  if (columns.has('remind_enabled')) payload.remindEnabled = values.remindEnabled;

  return payload;
}

/** Daftar kolom yang tersedia pada baris pelanggan yang dimuat. */
function loadedColumns(row: CustomerSummaryRow): ReadonlySet<string> {
  const record = row as unknown as Record<string, unknown>;
  return new Set(Object.keys(record).filter((key) => record[key] !== undefined));
}

export default function CustomerFormPage({ mode }: { mode: 'create' | 'edit' }): JSX.Element {
  return (
    <RequirePermission permission="customers.manage">
      <CustomerForm mode={mode} />
    </RequirePermission>
  );
}

function CustomerForm({ mode }: { mode: 'create' | 'edit' }): JSX.Element {
  const navigate = useNavigate();
  const { customerId } = useParams<{ customerId: string }>();
  const { organizationId } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [availableColumns, setAvailableColumns] = useState<ReadonlySet<string>>(() => new Set<string>());

  const isEdit = mode === 'edit';
  const customerQuery = useCustomer(isEdit ? customerId : undefined);
  const createMutation = useCreateCustomer(organizationId);
  const updateMutation = useUpdateCustomer();

  const form = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!isEdit || !customerQuery.data) return;
    setAvailableColumns(loadedColumns(customerQuery.data));
    form.reset(mapCustomerToInput(customerQuery.data));
  }, [customerQuery.data, form, isEdit]);

  const backHref = isEdit && customerId ? `/app/customers/${customerId}` : '/app/customers';

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (!isEdit) {
        const result = await createMutation.mutateAsync(values);
        notifySuccess('Pelanggan dibuat', `Nomor pelanggan: ${result.customerNumber}`);
        navigate(`/app/customers/${result.customer.id}`, { replace: true });
        return;
      }

      if (!customerId) {
        throw new Error('ID pelanggan tidak ditemukan pada alamat halaman.');
      }

      await updateMutation.mutateAsync({ id: customerId, input: buildUpdatePayload(values, availableColumns) });
      notifySuccess('Perubahan pelanggan disimpan');
      navigate(`/app/customers/${customerId}`, { replace: true });
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
      notifyError(error, 'Gagal menyimpan pelanggan');
    }
  });

  if (isEdit && customerQuery.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Ubah Pelanggan" description="Memuat data pelanggan…" />
        <Card>
          <CardContent className="space-y-3 pt-5">
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isEdit && customerQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Ubah Pelanggan" />
        <ErrorState
          message={errorMessage(customerQuery.error)}
          onRetry={() => void customerQuery.refetch()}
          className="bg-destructive/5"
        />
        <Button variant="outline" asChild>
          <Link to="/app/customers">
            <ArrowLeft aria-hidden />
            Kembali ke daftar pelanggan
          </Link>
        </Button>
      </div>
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="space-y-4">
      <PageHeader
        title={isEdit ? 'Ubah Pelanggan' : 'Tambah Pelanggan'}
        description={
          isEdit
            ? `Perbarui data pelanggan ${customerQuery.data?.customer_number ?? ''}`.trim()
            : 'Nomor pelanggan dibangkitkan otomatis oleh sistem saat data disimpan.'
        }
        actions={
          <Button variant="outline" asChild>
            <Link to={backHref}>
              <ArrowLeft aria-hidden />
              Batal
            </Link>
          </Button>
        }
      />

      {formError ? <ErrorState title="Gagal menyimpan" message={formError} /> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Data Pelanggan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormGrid>
              <FormField
                label="Nama Lengkap"
                htmlFor="fullName"
                required
                error={form.formState.errors.fullName?.message}
              >
                <Input
                  id="fullName"
                  autoComplete="name"
                  aria-invalid={Boolean(form.formState.errors.fullName)}
                  {...form.register('fullName')}
                />
              </FormField>

              <FormField
                label="Nomor Identitas (KTP/SIM)"
                htmlFor="identityNumber"
                hint="Data pribadi — akses terbatas. Hanya dipakai untuk verifikasi."
                error={form.formState.errors.identityNumber?.message}
              >
                <Input
                  id="identityNumber"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.identityNumber)}
                  {...form.register('identityNumber')}
                />
              </FormField>

              <FormField label="Telepon" htmlFor="phone" required error={form.formState.errors.phone?.message}>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="0812xxxxxxx"
                  aria-invalid={Boolean(form.formState.errors.phone)}
                  {...form.register('phone')}
                />
              </FormField>

              <FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(form.formState.errors.email)}
                  {...form.register('email')}
                />
              </FormField>

              <FormField
                label="Tanggal Lahir"
                htmlFor="birthDate"
                error={form.formState.errors.birthDate?.message}
              >
                <Controller
                  control={form.control}
                  name="birthDate"
                  render={({ field }) => (
                    <DateInput
                      id="birthDate"
                      value={field.value ?? null}
                      onChange={(value) => field.onChange(value)}
                      aria-invalid={Boolean(form.formState.errors.birthDate)}
                    />
                  )}
                />
              </FormField>

              <FormField label="Pekerjaan" htmlFor="occupation" error={form.formState.errors.occupation?.message}>
                <Input id="occupation" autoComplete="organization-title" {...form.register('occupation')} />
              </FormField>

              <FormField
                label="Penghasilan Bulanan"
                htmlFor="monthlyIncome"
                hint="Isi perkiraan penghasilan bulanan pelanggan."
                error={form.formState.errors.monthlyIncome?.message}
              >
                <Controller
                  control={form.control}
                  name="monthlyIncome"
                  render={({ field }) => (
                    <MoneyInput
                      id="monthlyIncome"
                      value={field.value ?? null}
                      onChange={(value) => field.onChange(value)}
                    />
                  )}
                />
              </FormField>

              <FormField label="Status" htmlFor="status" error={form.formState.errors.status?.message}>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <OptionsSelect
                      id="status"
                      value={field.value}
                      onValueChange={(value) => field.onChange(value as CustomerStatus)}
                      options={STATUS_OPTIONS}
                    />
                  )}
                />
              </FormField>
            </FormGrid>

            <FormField label="Alamat" htmlFor="address" error={form.formState.errors.address?.message}>
              <Textarea id="address" rows={3} autoComplete="street-address" {...form.register('address')} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kontak Darurat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormGrid>
              <FormField
                label="Nama Kontak Darurat"
                htmlFor="emergencyContactName"
                error={form.formState.errors.emergencyContactName?.message}
              >
                <Input id="emergencyContactName" autoComplete="off" {...form.register('emergencyContactName')} />
              </FormField>

              <FormField
                label="Telepon Kontak Darurat"
                htmlFor="emergencyContactPhone"
                error={form.formState.errors.emergencyContactPhone?.message}
              >
                <Input
                  id="emergencyContactPhone"
                  type="tel"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.emergencyContactPhone)}
                  {...form.register('emergencyContactPhone')}
                />
              </FormField>
            </FormGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catatan &amp; Pengingat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Catatan" htmlFor="notes" error={form.formState.errors.notes?.message}>
              <Textarea
                id="notes"
                rows={4}
                placeholder="Informasi tambahan mengenai pelanggan, kesepakatan khusus, atau riwayat penagihan."
                {...form.register('notes')}
              />
            </FormField>

            <Controller
              control={form.control}
              name="remindEnabled"
              render={({ field }) => (
                <SwitchRow
                  id="remindEnabled"
                  label="Aktifkan pengingat jatuh tempo"
                  description="Bila aktif, pelanggan akan menerima pengingat sebelum tanggal jatuh tempo cicilan."
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked)}
                />
              )}
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Nomor identitas termasuk data pribadi — tampilkan dan gunakan secara terbatas.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to={backHref}>Batal</Link>
            </Button>
            <Button type="submit" loading={isSubmitting}>
              <Save aria-hidden />
              {isEdit ? 'Simpan Perubahan' : 'Simpan Pelanggan'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
