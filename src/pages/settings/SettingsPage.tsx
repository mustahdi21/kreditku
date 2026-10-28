/**
 * SettingsPage.tsx — Pengaturan organisasi aktif.
 *
 * STRUKTUR
 * --------
 * Bagian ditentukan oleh parameter rute `:section` (business, numbering,
 * finance, penalty, integrations, templates, ui). Setiap bagian memuat nilai
 * terkini dari `app_settings` / `organizations`, memvalidasi dengan skema dari
 * `@/core/validation` SEBELUM menyimpan, lalu memanggil `useUpdateSettings`.
 *
 * CATATAN VALIDASI
 * ----------------
 * Skema pengaturan memakai `transform` dan `default`, sehingga tipe masukan dan
 * keluaran berbeda. Karena itu formulir bagian ini memakai `safeParse` +
 * `mapZodErrors` (pemetaan error ke field) alih-alih zodResolver, agar pesan
 * kesalahan tetap akurat untuk tiap kolom.
 *
 * RAHASIA
 * -------
 * Kredensial WhatsApp/Email TIDAK PERNAH berada di browser. Halaman ini hanya
 * menyimpan preferensi; token disimpan sebagai secret Edge Function di server.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  FileText,
  Hash,
  Info,
  Lock,
  Plug,
  Plus,
  Save,
  Trash2,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { DetailRow, ReminderChannelBadge } from '@/components/common/domain';
import { errorMessage } from '@/lib/errors';
import { useQueryClient } from '@tanstack/react-query';
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  useDocumentTemplates,
  useSaveDocumentTemplate,
  useToggleDocumentTemplate,
  type DocumentKind,
  type DocumentTemplateRow,
} from '@/data/documents';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  MoneyInput,
  NumberInput,
  OptionsSelect,
  PercentInput,
  Skeleton,
  SwitchRow,
  Tabs,
  Textarea,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { useOrganization, useReminderTemplates, useSettings, useUpdateSettings } from '@/data/admin';
import {
  DEFAULT_NUMBER_TEMPLATES,
  NUMBER_TEMPLATE_LABELS,
  formatDocumentNumber,
  validateNumberTemplate,
  type NumberTemplateKey,
} from '@/core/numbering';
import {
  PENALTY_PERCENT_BASES,
  PENALTY_PERCENT_BASE_LABELS,
  describePenaltyRule,
  type PenaltyPercentBase,
  type PenaltyRule,
} from '@/core/penalties';
import {
  businessSettingsSchema,
  financeSettingsSchema,
  formatZodError,
  integrationSettingsSchema,
  mapZodErrors,
  numberSettingsSchema,
  penaltyRuleSchema,
} from '@/core/validation';
import {
  ALLOCATION_ORDERS,
  DUE_DATE_ADJUSTMENTS,
  INTEREST_METHODS,
  INTEREST_METHOD_LABELS,
  PENALTY_TYPES,
  PENALTY_TYPE_LABELS,
  RATE_BASES,
  RATE_BASIS_LABELS,
  REMINDER_CHANNELS,
  REMINDER_CHANNEL_LABELS,
  REMINDER_OFFSETS,
  REMINDER_OFFSET_LABELS,
  ROLE_LABELS,
  type AllocationOrder,
  type DueDateAdjustment,
  type InterestMethod,
  type PenaltyType,
  type RateBasis,
} from '@/core/types';
import { formatDateShortId, todayIso } from '@/lib/date';
import { bpToPercent, percentToBp } from '@/lib/money';
import type { AppSettingsRow, OrganizationRow } from '@/data/types';

/* -------------------------------------------------------------------------- */
/* Bagian                                                                     */
/* -------------------------------------------------------------------------- */

const SECTIONS = ['business', 'numbering', 'finance', 'penalty', 'integrations', 'templates', 'ui'] as const;
type SettingsSection = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<SettingsSection, string> = {
  business: 'Identitas Usaha',
  numbering: 'Penomoran Dokumen',
  finance: 'Keuangan & Kredit',
  penalty: 'Aturan Denda',
  integrations: 'Integrasi & Pengingat',
  templates: 'Template',
  ui: 'Tampilan',
};

const SECTION_ORDER: readonly SettingsSection[] = SECTIONS;

function isSection(value: string | undefined): value is SettingsSection {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value);
}

function SectionSkeleton(): JSX.Element {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function SettingsCard({
  title,
  description,
  children,
  footer,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

function LockedNotice({ title, message, children }: { title: string; message: string; children?: ReactNode }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-warning" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

/** Menampilkan pesan kesalahan umum dari `safeParse` bila tidak terpetakan ke kolom. */
function formErrorSummary(errors: Record<string, string>): string | null {
  const general = errors._form;
  if (general) return general;
  const values = Object.values(errors);
  return values.length > 0 ? values.join(' ') : null;
}

/* -------------------------------------------------------------------------- */
/* 1. Identitas usaha                                                         */
/* -------------------------------------------------------------------------- */

function BusinessSection({ organization }: { organization: OrganizationRow }): JSX.Element {
  const { can, role } = useAuth();
  const update = useUpdateSettings();
  const allowed = can('settings.business');

  const [form, setForm] = useState({
    businessName: organization.name,
    organizationCode: organization.code,
    logoUrl: organization.logo_url ?? '',
    address: organization.address ?? '',
    phone: organization.phone ?? '',
    email: organization.email ?? '',
    currency: organization.currency,
    timezone: organization.timezone,
    locale: organization.locale,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      businessName: organization.name,
      organizationCode: organization.code,
      logoUrl: organization.logo_url ?? '',
      address: organization.address ?? '',
      phone: organization.phone ?? '',
      email: organization.email ?? '',
      currency: organization.currency,
      timezone: organization.timezone,
      locale: organization.locale,
    });
  }, [organization]);

  if (!allowed) {
    return (
      <LockedNotice
        title="Identitas usaha terkunci"
        message={`Hanya Super Admin yang dapat mengubah identitas usaha. Role Anda saat ini: ${role ? ROLE_LABELS[role] : '-'}.`}
      >
        <dl className="divide-y">
          <DetailRow label="Nama usaha">{organization.name}</DetailRow>
          <DetailRow label="Kode organisasi">{organization.code}</DetailRow>
          <DetailRow label="Alamat">{organization.address ?? '-'}</DetailRow>
          <DetailRow label="Telepon">{organization.phone ?? '-'}</DetailRow>
          <DetailRow label="Email">{organization.email ?? '-'}</DetailRow>
          <DetailRow label="Mata uang">{organization.currency}</DetailRow>
          <DetailRow label="Zona waktu">{organization.timezone}</DetailRow>
          <DetailRow label="Locale">{organization.locale}</DetailRow>
        </dl>
      </LockedNotice>
    );
  }

  const handleSave = () => {
    const parsed = businessSettingsSchema.safeParse({
      businessName: form.businessName,
      organizationCode: form.organizationCode,
      logoUrl: form.logoUrl.trim() === '' ? null : form.logoUrl.trim(),
      address: form.address.trim() === '' ? null : form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      currency: form.currency.trim().toUpperCase(),
      timezone: form.timezone.trim(),
      locale: form.locale.trim(),
    });

    if (!parsed.success) {
      const mapped = mapZodErrors(parsed.error);
      setErrors(mapped);
      notifyError(new Error(formatZodError(parsed.error)), 'Isian identitas usaha belum valid');
      return;
    }

    setErrors({});
    update.mutate(
      { section: 'business', value: { ...parsed.data } },
      {
        onSuccess: () => notifySuccess('Identitas usaha disimpan.', 'Perubahan tampil setelah data organisasi dimuat ulang.'),
        onError: (error) => notifyError(error, 'Identitas usaha gagal disimpan'),
      },
    );
  };

  return (
    <SettingsCard
      title="Identitas Usaha"
      description="Data ini muncul pada kop laporan, kuitansi, dan dokumen cetak lainnya."
      footer={
        <Button loading={update.isPending} onClick={handleSave}>
          <Save aria-hidden />
          Simpan identitas usaha
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Nama usaha" htmlFor="business-name" required error={errors.businessName}>
          <Input
            id="business-name"
            value={form.businessName}
            onChange={(event) => setForm({ ...form, businessName: event.target.value })}
          />
        </FormField>
        <FormField
          label="Kode organisasi"
          htmlFor="business-code"
          required
          error={errors.organizationCode}
          hint="Huruf kapital dan angka saja, maksimum 12 karakter. Dipakai pada token {ORG} penomoran."
        >
          <Input
            id="business-code"
            value={form.organizationCode}
            onChange={(event) => setForm({ ...form, organizationCode: event.target.value.toUpperCase() })}
          />
        </FormField>
      </FormGrid>

      <FormField label="URL logo" htmlFor="business-logo" error={errors.logoUrl} hint="Kosongkan bila tidak memakai logo.">
        <Input
          id="business-logo"
          placeholder="https://…/logo.png"
          value={form.logoUrl}
          onChange={(event) => setForm({ ...form, logoUrl: event.target.value })}
        />
      </FormField>

      <FormField label="Alamat" htmlFor="business-address" error={errors.address}>
        <Input
          id="business-address"
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
        />
      </FormField>

      <FormGrid>
        <FormField label="Telepon" htmlFor="business-phone" error={errors.phone}>
          <Input
            id="business-phone"
            inputMode="tel"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </FormField>
        <FormField label="Email" htmlFor="business-email" error={errors.email}>
          <Input
            id="business-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="Mata uang" htmlFor="business-currency" error={errors.currency} hint="Kode 3 huruf, mis. IDR.">
          <Input
            id="business-currency"
            value={form.currency}
            onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          />
        </FormField>
        <FormField label="Zona waktu" htmlFor="business-timezone" error={errors.timezone} hint="mis. Asia/Jakarta.">
          <Input
            id="business-timezone"
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </FormField>
      </FormGrid>

      <FormField label="Locale" htmlFor="business-locale" error={errors.locale} hint="mis. id-ID.">
        <Input
          id="business-locale"
          value={form.locale}
          onChange={(event) => setForm({ ...form, locale: event.target.value })}
        />
      </FormField>

      {formErrorSummary(errors) ? (
        <p className="text-sm font-medium text-destructive">{formErrorSummary(errors)}</p>
      ) : null}
    </SettingsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Penomoran dokumen                                                       */
/* -------------------------------------------------------------------------- */

const NUMBER_TEMPLATE_KEYS = Object.keys(DEFAULT_NUMBER_TEMPLATES) as NumberTemplateKey[];

const DOCUMENT_TYPE_CODES: Record<NumberTemplateKey, string> = {
  customer: 'CUST',
  contract: 'CTR',
  receipt: 'KWT',
  application: 'APP',
  payment_reversal: 'RVS',
};

const NUMBER_TOKENS: readonly { token: string; meaning: string }[] = [
  { token: '{ORG}', meaning: 'Kode organisasi (mis. PTM)' },
  { token: '{YYYY}', meaning: 'Tahun 4 digit dari tanggal dokumen' },
  { token: '{YY}', meaning: 'Tahun 2 digit' },
  { token: '{MM}', meaning: 'Bulan 2 digit' },
  { token: '{DD}', meaning: 'Tanggal 2 digit' },
  { token: '{YYYYMMDD}', meaning: 'Gabungan tanggal (boleh YYYYMM, MMDD, dan sejenisnya)' },
  { token: '{ROMAN}', meaning: 'Bulan dalam angka Romawi (I–XII)' },
  { token: '{SEQ:n}', meaning: 'Nomor urut dengan padding n digit (maksimum 10), mis. {SEQ:5} → 00042' },
  { token: '{TYPE}', meaning: 'Kode tipe dokumen (mis. CTR)' },
];

function NumberingSection({
  settings,
  organization,
}: {
  settings: AppSettingsRow;
  organization: OrganizationRow | undefined;
}): JSX.Element {
  const update = useUpdateSettings();
  const [templates, setTemplates] = useState<Record<NumberTemplateKey, string>>(() => ({ ...settings.numbering }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setTemplates({ ...settings.numbering });
  }, [settings]);

  const validations = NUMBER_TEMPLATE_KEYS.map((key) => ({
    key,
    result: validateNumberTemplate(templates[key] ?? ''),
  }));
  const allValid = validations.every((item) => item.result.valid);

  const preview = (key: NumberTemplateKey): string => {
    try {
      return formatDocumentNumber({
        template: templates[key] ?? '',
        dateIso: todayIso(),
        sequence: 42,
        organizationCode: organization?.code ?? 'ORG',
        documentType: DOCUMENT_TYPE_CODES[key],
      });
    } catch {
      return 'Template belum valid sehingga pratinjau tidak dapat dibuat.';
    }
  };

  const handleSave = () => {
    if (!allValid) {
      notifyError(new Error('Perbaiki template yang belum valid sebelum menyimpan.'), 'Template nomor belum valid');
      return;
    }

    const parsed = numberSettingsSchema.safeParse({
      customerTemplate: templates.customer,
      contractTemplate: templates.contract,
      receiptTemplate: templates.receipt,
      applicationTemplate: templates.application,
    });

    if (!parsed.success) {
      const mapped = mapZodErrors(parsed.error);
      setErrors(mapped);
      notifyError(new Error(formatZodError(parsed.error)), 'Template nomor belum valid');
      return;
    }

    setErrors({});
    update.mutate(
      {
        section: 'numbering',
        value: {
          customer: templates.customer,
          contract: templates.contract,
          receipt: templates.receipt,
          application: templates.application,
          payment_reversal: templates.payment_reversal,
        },
      },
      {
        onSuccess: () => notifySuccess('Template penomoran disimpan.'),
        onError: (error) => notifyError(error, 'Template penomoran gagal disimpan'),
      },
    );
  };

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Penomoran Dokumen"
        description="Template nomor untuk pelanggan, kontrak, kuitansi, pengajuan, dan pembatalan pembayaran."
        action={<Badge variant={allValid ? 'success' : 'destructive'}>{allValid ? 'Semua template valid' : 'Ada template tidak valid'}</Badge>}
        footer={
          <Button loading={update.isPending} disabled={!allValid} onClick={handleSave}>
            <Save aria-hidden />
            Simpan penomoran
          </Button>
        }
      >
        {!allValid ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
            Tombol simpan dinonaktifkan sampai seluruh template valid. Setiap template wajib memuat token {'{SEQ}'}.
          </p>
        ) : null}

        {NUMBER_TEMPLATE_KEYS.map((key) => {
          const validation = validations.find((item) => item.key === key);
          const error = validation?.result.valid
            ? errors[key === 'customer' ? 'customerTemplate' : key === 'contract' ? 'contractTemplate' : key === 'receipt' ? 'receiptTemplate' : 'applicationTemplate']
            : validation?.result.error;

          return (
            <div key={key} className="space-y-2 rounded-md border p-3">
              <FormField
                label={NUMBER_TEMPLATE_LABELS[key]}
                htmlFor={`template-${key}`}
                error={error}
                required
                hint={`Default: ${DEFAULT_NUMBER_TEMPLATES[key]}`}
              >
                <Input
                  id={`template-${key}`}
                  value={templates[key] ?? ''}
                  aria-invalid={!validation?.result.valid}
                  onChange={(event) => setTemplates({ ...templates, [key]: event.target.value })}
                  className="font-mono"
                />
              </FormField>
              <p className="text-xs text-muted-foreground">
                Pratinjau (tanggal hari ini, urut 42):{' '}
                <span className="font-mono text-foreground">{preview(key)}</span>
              </p>
            </div>
          );
        })}
      </SettingsCard>

      <SettingsCard title="Token yang Tersedia" description="Token ditulis dengan kurung kurawal dan diganti saat dokumen dibuat.">
        <ul className="space-y-1.5 text-sm">
          {NUMBER_TOKENS.map((item) => (
            <li key={item.token} className="flex flex-wrap items-baseline gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{item.token}</code>
              <span className="text-muted-foreground">{item.meaning}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Nomor urut sebenarnya dibangkitkan secara atomik di database melalui fungsi <code>fn_next_number()</code>,
          sehingga pratinjau di atas hanya ilustrasi format.
        </p>
      </SettingsCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Keuangan & kredit                                                       */
/* -------------------------------------------------------------------------- */

const WEEKDAYS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Senin' },
  { value: 2, label: 'Selasa' },
  { value: 3, label: 'Rabu' },
  { value: 4, label: 'Kamis' },
  { value: 5, label: 'Jumat' },
  { value: 6, label: 'Sabtu' },
  { value: 0, label: 'Minggu' },
];

const ALLOCATION_ORDER_LABELS: Record<AllocationOrder, string> = {
  OLDEST_FIRST: 'Cicilan terlama lebih dahulu',
  NEWEST_FIRST: 'Cicilan terbaru lebih dahulu',
  MANUAL: 'Manual (dipilih kasir)',
};

const DUE_DATE_ADJUSTMENT_LABELS: Record<DueDateAdjustment, string> = {
  NONE: 'Tidak disesuaikan',
  PREVIOUS_BUSINESS_DAY: 'Hari kerja sebelumnya',
  NEXT_BUSINESS_DAY: 'Hari kerja berikutnya',
};

function FinanceSection({ settings }: { settings: AppSettingsRow }): JSX.Element {
  const update = useUpdateSettings();
  const finance = settings.finance;

  const [form, setForm] = useState({
    defaultInterestMethod: finance.default_interest_method,
    defaultRateBp: finance.default_rate_bp,
    defaultRateBasis: finance.default_rate_basis,
    defaultTenor: finance.default_tenor,
    defaultAdminFee: finance.default_admin_fee,
    maxTenor: finance.max_tenor,
    minDownPaymentPercent: finance.min_down_payment_percent,
    allowOverpayment: finance.allow_overpayment,
    allocationOrder: finance.allocation_order,
    penaltyFirst: finance.penalty_first,
    requireSeparateApprover: finance.require_separate_approver,
    dueDateAdjustment: finance.due_date_adjustment,
    weekendDays: [...finance.weekend_days],
    holidays: [...finance.holidays],
    agingBounds: [...finance.aging_bounds],
  });
  const [holidayInput, setHolidayInput] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      defaultInterestMethod: finance.default_interest_method,
      defaultRateBp: finance.default_rate_bp,
      defaultRateBasis: finance.default_rate_basis,
      defaultTenor: finance.default_tenor,
      defaultAdminFee: finance.default_admin_fee,
      maxTenor: finance.max_tenor,
      minDownPaymentPercent: finance.min_down_payment_percent,
      allowOverpayment: finance.allow_overpayment,
      allocationOrder: finance.allocation_order,
      penaltyFirst: finance.penalty_first,
      requireSeparateApprover: finance.require_separate_approver,
      dueDateAdjustment: finance.due_date_adjustment,
      weekendDays: [...finance.weekend_days],
      holidays: [...finance.holidays],
      agingBounds: [...finance.aging_bounds],
    });
  }, [finance]);

  const agingAscending = form.agingBounds.every((value, index, all) => index === 0 || value > (all[index - 1] ?? 0));

  const handleSave = () => {
    if (!agingAscending) {
      setErrors({ agingBounds: 'Batas aging harus menaik (mis. 7, 30, 60, 90).' });
      notifyError(new Error('Batas aging harus menaik.'), 'Isian keuangan belum valid');
      return;
    }

    const parsed = financeSettingsSchema.safeParse({
      defaultInterestMethod: form.defaultInterestMethod,
      defaultRateBp: form.defaultRateBp,
      defaultRateBasis: form.defaultRateBasis,
      defaultTenor: form.defaultTenor,
      defaultAdminFee: form.defaultAdminFee,
      maxTenor: form.maxTenor,
      minDownPaymentPercent: form.minDownPaymentPercent,
      allowOverpayment: form.allowOverpayment,
      allocationOrder: form.allocationOrder,
      penaltyFirst: form.penaltyFirst,
      requireSeparateApprover: form.requireSeparateApprover,
      dueDateAdjustment: form.dueDateAdjustment,
      weekendDays: form.weekendDays,
      holidays: form.holidays,
      agingBounds: form.agingBounds,
    });

    if (!parsed.success) {
      const mapped = mapZodErrors(parsed.error);
      setErrors(mapped);
      notifyError(new Error(formatZodError(parsed.error)), 'Isian keuangan belum valid');
      return;
    }

    setErrors({});
    const data = parsed.data;
    update.mutate(
      {
        section: 'finance',
        value: {
          default_interest_method: data.defaultInterestMethod,
          default_rate_bp: data.defaultRateBp,
          default_rate_basis: data.defaultRateBasis,
          default_tenor: data.defaultTenor,
          default_admin_fee: data.defaultAdminFee,
          max_tenor: data.maxTenor,
          min_down_payment_percent: data.minDownPaymentPercent,
          allow_overpayment: data.allowOverpayment,
          allocation_order: data.allocationOrder,
          penalty_first: data.penaltyFirst,
          require_separate_approver: data.requireSeparateApprover,
          due_date_adjustment: data.dueDateAdjustment,
          weekend_days: data.weekendDays,
          holidays: data.holidays,
          aging_bounds: data.agingBounds,
        },
      },
      {
        onSuccess: () => notifySuccess('Pengaturan keuangan disimpan.'),
        onError: (error) => notifyError(error, 'Pengaturan keuangan gagal disimpan'),
      },
    );
  };

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Keuangan & Kredit"
        description="Nilai default saat membuat pengajuan baru serta aturan alokasi pembayaran."
        footer={
          <Button loading={update.isPending} onClick={handleSave}>
            <Save aria-hidden />
            Simpan pengaturan keuangan
          </Button>
        }
      >
        <FormGrid>
          <FormField label="Metode bunga default" htmlFor="finance-method" error={errors.defaultInterestMethod}>
            <OptionsSelect
              id="finance-method"
              value={form.defaultInterestMethod}
              onValueChange={(value) => setForm({ ...form, defaultInterestMethod: value as InterestMethod })}
              options={INTEREST_METHODS.map((method) => ({ value: method, label: INTEREST_METHOD_LABELS[method] }))}
            />
          </FormField>
          <FormField label="Basis tarif default" htmlFor="finance-basis" error={errors.defaultRateBasis}>
            <OptionsSelect
              id="finance-basis"
              value={form.defaultRateBasis}
              onValueChange={(value) => setForm({ ...form, defaultRateBasis: value as RateBasis })}
              options={RATE_BASES.map((basis) => ({ value: basis, label: RATE_BASIS_LABELS[basis] }))}
            />
          </FormField>
        </FormGrid>

        <FormGrid>
          <FormField
            label="Tarif bunga default"
            htmlFor="finance-rate"
            error={errors.defaultRateBp}
            hint={`Nilai tersimpan: ${form.defaultRateBp} basis point (${bpToPercent(form.defaultRateBp)}%).`}
          >
            <PercentInput
              id="finance-rate"
              valueBp={form.defaultRateBp}
              onChangeBp={(bp) => setForm({ ...form, defaultRateBp: bp })}
            />
          </FormField>
          <FormField
            label="Uang muka minimum"
            htmlFor="finance-dp"
            error={errors.minDownPaymentPercent}
            hint="Dalam persen dari harga barang."
          >
            <PercentInput
              id="finance-dp"
              valueBp={percentToBp(form.minDownPaymentPercent)}
              onChangeBp={(bp) => setForm({ ...form, minDownPaymentPercent: bpToPercent(bp) })}
            />
          </FormField>
        </FormGrid>

        <FormGrid>
          <FormField label="Tenor default" htmlFor="finance-tenor" error={errors.defaultTenor} hint="Jumlah periode.">
            <NumberInput
              id="finance-tenor"
              value={form.defaultTenor}
              min={1}
              max={600}
              onChange={(value) => setForm({ ...form, defaultTenor: value ?? 1 })}
            />
          </FormField>
          <FormField label="Tenor maksimum" htmlFor="finance-max-tenor" error={errors.maxTenor} hint="Batas tenor yang boleh diajukan.">
            <NumberInput
              id="finance-max-tenor"
              value={form.maxTenor}
              min={1}
              max={600}
              onChange={(value) => setForm({ ...form, maxTenor: value ?? 1 })}
            />
          </FormField>
        </FormGrid>

        <FormGrid>
          <FormField label="Biaya administrasi default" htmlFor="finance-fee" error={errors.defaultAdminFee}>
            <MoneyInput
              id="finance-fee"
              value={form.defaultAdminFee}
              onChange={(value) => setForm({ ...form, defaultAdminFee: value ?? 0 })}
            />
          </FormField>
          <FormField label="Urutan alokasi pembayaran" htmlFor="finance-allocation" error={errors.allocationOrder}>
            <OptionsSelect
              id="finance-allocation"
              value={form.allocationOrder}
              onValueChange={(value) => setForm({ ...form, allocationOrder: value as AllocationOrder })}
              options={ALLOCATION_ORDERS.map((order) => ({ value: order, label: ALLOCATION_ORDER_LABELS[order] }))}
            />
          </FormField>
        </FormGrid>

        <FormField label="Penyesuaian tanggal jatuh tempo" htmlFor="finance-due-adjust" error={errors.dueDateAdjustment}>
          <OptionsSelect
            id="finance-due-adjust"
            value={form.dueDateAdjustment}
            onValueChange={(value) => setForm({ ...form, dueDateAdjustment: value as DueDateAdjustment })}
            options={DUE_DATE_ADJUSTMENTS.map((adjustment) => ({
              value: adjustment,
              label: DUE_DATE_ADJUSTMENT_LABELS[adjustment],
            }))}
          />
        </FormField>

        <SwitchRow
          id="finance-overpayment"
          label="Izinkan kelebihan bayar"
          description="Bila aktif, pembayaran melebihi kewajiban kontrak dapat diterima dan dicatat sebagai kelebihan."
          checked={form.allowOverpayment}
          onCheckedChange={(checked) => setForm({ ...form, allowOverpayment: checked })}
        />
        <SwitchRow
          id="finance-penalty-first"
          label="Denda dibayar lebih dahulu"
          description="Bila aktif, alokasi pembayaran mendahulukan denda sebelum cicilan."
          checked={form.penaltyFirst}
          onCheckedChange={(checked) => setForm({ ...form, penaltyFirst: checked })}
        />
        <SwitchRow
          id="finance-separate-approver"
          label="Wajib approver terpisah"
          description="Pengajuan harus disetujui oleh pengguna berbeda dari pembuatnya."
          checked={form.requireSeparateApprover}
          onCheckedChange={(checked) => setForm({ ...form, requireSeparateApprover: checked })}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium">Hari akhir pekan</p>
          <p className="text-xs text-muted-foreground">
            Hari yang dipilih diperlakukan sebagai akhir pekan saat menyesuaikan tanggal jatuh tempo.
          </p>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((day) => {
              const id = `finance-weekend-${day.value}`;
              const checked = form.weekendDays.includes(day.value);
              return (
                <label key={day.value} htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(state) =>
                      setForm({
                        ...form,
                        weekendDays: state
                          ? [...form.weekendDays, day.value].sort((a, b) => a - b)
                          : form.weekendDays.filter((value) => value !== day.value),
                      })
                    }
                  />
                  {day.label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Hari libur nasional</p>
          <p className="text-xs text-muted-foreground">
            Tanggal yang terdaftar tidak dihitung sebagai hari kerja. Tambahkan hari libur organisasi Anda.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-44">
              <DateInput value={holidayInput} onChange={setHolidayInput} aria-label="Tanggal hari libur" />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!holidayInput}
              onClick={() => {
                if (!holidayInput) return;
                if (form.holidays.includes(holidayInput)) {
                  setHolidayInput(null);
                  return;
                }
                setForm({ ...form, holidays: [...form.holidays, holidayInput].sort() });
                setHolidayInput(null);
              }}
            >
              <Plus aria-hidden />
              Tambah
            </Button>
          </div>
          {form.holidays.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada hari libur terdaftar.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {form.holidays.map((holiday) => (
                <li key={holiday} className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="tabular">{formatDateShortId(holiday)}</span>
                  <button
                    type="button"
                    aria-label={`Hapus hari libur ${formatDateShortId(holiday)}`}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    onClick={() => setForm({ ...form, holidays: form.holidays.filter((value) => value !== holiday) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Batas umur tunggakan (aging)</p>
          <p className="text-xs text-muted-foreground">
            Empat batas hari yang harus menaik, mis. 7 / 30 / 60 / 90. Dipakai pada laporan umur piutang.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {form.agingBounds.map((bound, index) => (
              <FormField key={index} label={`Batas ${index + 1}`} htmlFor={`finance-aging-${index}`}>
                <NumberInput
                  id={`finance-aging-${index}`}
                  value={bound}
                  min={1}
                  onChange={(value) => {
                    const next = [...form.agingBounds];
                    next[index] = value ?? 1;
                    setForm({ ...form, agingBounds: next });
                  }}
                />
              </FormField>
            ))}
          </div>
          {!agingAscending ? (
            <p className="text-xs font-medium text-destructive">Batas aging harus menaik dari batas 1 sampai batas 4.</p>
          ) : null}
          {errors.agingBounds ? <p className="text-xs font-medium text-destructive">{errors.agingBounds}</p> : null}
        </div>
      </SettingsCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Aturan denda                                                            */
/* -------------------------------------------------------------------------- */

const isPercentPenalty = (type: PenaltyType): boolean =>
  type === 'PERCENT_PER_DAY' || type === 'PERCENT_PER_MONTH';

function PenaltySection({ settings }: { settings: AppSettingsRow }): JSX.Element {
  const update = useUpdateSettings();
  const penalty = settings.penalty;

  const [type, setType] = useState<PenaltyType>(penalty.type);
  const [amountRupiah, setAmountRupiah] = useState<number>(isPercentPenalty(penalty.type) ? 0 : penalty.amount);
  const [amountBp, setAmountBp] = useState<number>(isPercentPenalty(penalty.type) ? penalty.amount : 0);
  const [graceDays, setGraceDays] = useState<number>(penalty.grace_days);
  const [maxAmount, setMaxAmount] = useState<number | null>(penalty.max_amount);
  const [percentBase, setPercentBase] = useState<PenaltyPercentBase>(penalty.percent_base);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setType(penalty.type);
    setAmountRupiah(isPercentPenalty(penalty.type) ? 0 : penalty.amount);
    setAmountBp(isPercentPenalty(penalty.type) ? penalty.amount : 0);
    setGraceDays(penalty.grace_days);
    setMaxAmount(penalty.max_amount);
    setPercentBase(penalty.percent_base);
  }, [penalty]);

  const effectiveAmount = isPercentPenalty(type) ? amountBp : amountRupiah;

  const rule: PenaltyRule = {
    type,
    amount: effectiveAmount,
    graceDays,
    maxAmount,
    percentBase,
  };

  const handleSave = () => {
    const parsed = penaltyRuleSchema.safeParse({
      type,
      amount: effectiveAmount,
      graceDays,
      maxAmount,
      percentBase,
    });

    if (!parsed.success) {
      const mapped = mapZodErrors(parsed.error);
      setErrors(mapped);
      notifyError(new Error(formatZodError(parsed.error)), 'Aturan denda belum valid');
      return;
    }

    setErrors({});
    update.mutate(
      {
        section: 'penalty',
        value: {
          type: parsed.data.type,
          amount: parsed.data.amount,
          grace_days: parsed.data.graceDays,
          max_amount: parsed.data.maxAmount,
          percent_base: parsed.data.percentBase,
        },
      },
      {
        onSuccess: () => notifySuccess('Aturan denda disimpan.'),
        onError: (error) => notifyError(error, 'Aturan denda gagal disimpan'),
      },
    );
  };

  return (
    <SettingsCard
      title="Aturan Denda"
      description="Denda dihitung per cicilan yang melewati jatuh tempo. Satu cicilan hanya memiliki satu catatan denda aktif."
      footer={
        <Button loading={update.isPending} onClick={handleSave}>
          <Save aria-hidden />
          Simpan aturan denda
        </Button>
      }
    >
      <div className="rounded-md border bg-muted/40 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pratinjau aturan berlaku</p>
        <p className="text-sm">{describePenaltyRule(rule)}</p>
      </div>

      <FormField label="Jenis denda" htmlFor="penalty-type" error={errors.type}>
        <OptionsSelect
          id="penalty-type"
          value={type}
          onValueChange={(value) => setType(value as PenaltyType)}
          options={PENALTY_TYPES.map((penaltyType) => ({ value: penaltyType, label: PENALTY_TYPE_LABELS[penaltyType] }))}
        />
      </FormField>

      {isPercentPenalty(type) ? (
        <FormField
          label="Tarif denda"
          htmlFor="penalty-percent"
          error={errors.amount}
          hint={`Nilai tersimpan: ${amountBp} basis point (${bpToPercent(amountBp)}%). Dihitung per 30 hari untuk jenis per bulan.`}
        >
          <PercentInput id="penalty-percent" valueBp={amountBp} onChangeBp={setAmountBp} />
        </FormField>
      ) : (
        <FormField
          label={type === 'FIXED_PER_DAY' ? 'Nominal denda per hari' : 'Nominal denda per cicilan'}
          htmlFor="penalty-amount"
          error={errors.amount}
        >
          <MoneyInput
            id="penalty-amount"
            value={amountRupiah}
            onChange={(value) => setAmountRupiah(value ?? 0)}
            disabled={type === 'NONE'}
          />
        </FormField>
      )}

      <FormGrid>
        <FormField label="Masa tenggang (hari)" htmlFor="penalty-grace" error={errors.graceDays} hint="0–365 hari.">
          <NumberInput
            id="penalty-grace"
            value={graceDays}
            min={0}
            max={365}
            onChange={(value) => setGraceDays(value ?? 0)}
            disabled={type === 'NONE'}
          />
        </FormField>
        <FormField
          label="Batas maksimum per cicilan"
          htmlFor="penalty-max"
          error={errors.maxAmount}
          hint="Kosongkan bila tanpa batas maksimum."
        >
          <MoneyInput id="penalty-max" value={maxAmount} onChange={setMaxAmount} disabled={type === 'NONE'} />
        </FormField>
      </FormGrid>

      {isPercentPenalty(type) ? (
        <FormField
          label="Dasar perhitungan persentase"
          htmlFor="penalty-base"
          error={errors.percentBase}
          hint="Menentukan nilai yang dipakai sebagai dasar persentase."
        >
          <OptionsSelect
            id="penalty-base"
            value={percentBase}
            onValueChange={(value) => setPercentBase(value as PenaltyPercentBase)}
            options={PENALTY_PERCENT_BASES.map((base) => ({
              value: base,
              label: PENALTY_PERCENT_BASE_LABELS[base],
            }))}
          />
        </FormField>
      ) : null}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Perhitungan ulang hanya memperbarui catatan denda yang belum dibayar atau belum dibebaskan. Denda historis yang
        sudah lunas tidak berubah.
      </p>
    </SettingsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Integrasi & pengingat                                                   */
/* -------------------------------------------------------------------------- */

function IntegrationsSection({ settings }: { settings: AppSettingsRow }): JSX.Element {
  const { can, role } = useAuth();
  const update = useUpdateSettings();
  const integrations = settings.integrations;
  const allowed = can('settings.integrations');

  const [form, setForm] = useState({
    whatsappEnabled: integrations.whatsapp_enabled,
    whatsappProvider: integrations.whatsapp_provider,
    whatsappSenderName: integrations.whatsapp_sender_name ?? '',
    emailEnabled: integrations.email_enabled,
    emailFromName: integrations.email_from_name ?? '',
    emailFromAddress: integrations.email_from_address ?? '',
    reminderOffsets: [...integrations.reminder_offsets],
    reminderChannels: [...integrations.reminder_channels],
    reminderSimulationMode: integrations.reminder_simulation_mode,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      whatsappEnabled: integrations.whatsapp_enabled,
      whatsappProvider: integrations.whatsapp_provider,
      whatsappSenderName: integrations.whatsapp_sender_name ?? '',
      emailEnabled: integrations.email_enabled,
      emailFromName: integrations.email_from_name ?? '',
      emailFromAddress: integrations.email_from_address ?? '',
      reminderOffsets: [...integrations.reminder_offsets],
      reminderChannels: [...integrations.reminder_channels],
      reminderSimulationMode: integrations.reminder_simulation_mode,
    });
  }, [integrations]);

  if (!allowed) {
    return (
      <LockedNotice
        title="Integrasi terkunci"
        message={`Hanya Super Admin yang dapat mengubah integrasi pengiriman pesan. Role Anda saat ini: ${role ? ROLE_LABELS[role] : '-'}.`}
      >
        <dl className="divide-y">
          <DetailRow label="WhatsApp">
            {integrations.whatsapp_enabled ? `Aktif (${integrations.whatsapp_provider})` : 'Nonaktif'}
          </DetailRow>
          <DetailRow label="Email">{integrations.email_enabled ? 'Aktif' : 'Nonaktif'}</DetailRow>
          <DetailRow label="Jadwal pengingat">
            {integrations.reminder_offsets.map((offset) => REMINDER_OFFSET_LABELS[offset]).join(', ') || '-'}
          </DetailRow>
          <DetailRow label="Kanal pengingat">
            {integrations.reminder_channels.map((channel) => REMINDER_CHANNEL_LABELS[channel]).join(', ') || '-'}
          </DetailRow>
          <DetailRow label="Mode simulasi">{integrations.reminder_simulation_mode ? 'Aktif' : 'Nonaktif'}</DetailRow>
        </dl>
      </LockedNotice>
    );
  }

  const handleSave = () => {
    const parsed = integrationSettingsSchema.safeParse({
      whatsappEnabled: form.whatsappEnabled,
      whatsappProvider: form.whatsappProvider,
      whatsappSenderName: form.whatsappSenderName.trim() === '' ? null : form.whatsappSenderName.trim(),
      emailEnabled: form.emailEnabled,
      emailFromName: form.emailFromName.trim() === '' ? null : form.emailFromName.trim(),
      emailFromAddress: form.emailFromAddress.trim(),
      reminderOffsets: form.reminderOffsets,
      reminderChannels: form.reminderChannels,
      reminderSimulationMode: form.reminderSimulationMode,
    });

    if (!parsed.success) {
      const mapped = mapZodErrors(parsed.error);
      setErrors(mapped);
      notifyError(new Error(formatZodError(parsed.error)), 'Isian integrasi belum valid');
      return;
    }

    setErrors({});
    const data = parsed.data;
    update.mutate(
      {
        section: 'integrations',
        value: {
          whatsapp_enabled: data.whatsappEnabled,
          whatsapp_provider: data.whatsappProvider,
          whatsapp_sender_name: data.whatsappSenderName ?? null,
          email_enabled: data.emailEnabled,
          email_from_name: data.emailFromName ?? null,
          email_from_address: data.emailFromAddress ?? null,
          reminder_offsets: data.reminderOffsets,
          reminder_channels: data.reminderChannels,
          reminder_simulation_mode: data.reminderSimulationMode,
        },
      },
      {
        onSuccess: () => notifySuccess('Pengaturan integrasi disimpan.'),
        onError: (error) => notifyError(error, 'Pengaturan integrasi gagal disimpan'),
      },
    );
  };

  return (
    <SettingsCard
      title="Integrasi & Pengingat"
      description="Preferensi pengiriman pengingat jatuh tempo melalui WhatsApp dan email."
      footer={
        <Button loading={update.isPending} onClick={handleSave}>
          <Save aria-hidden />
          Simpan integrasi
        </Button>
      }
    >
      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          Kredensial tidak pernah disimpan di browser
        </p>
        <p className="text-muted-foreground">
          Token dan kredensial penyedia (WhatsApp/email) disimpan sebagai rahasia Edge Function di server. Halaman ini
          hanya menyimpan preferensi. Selama <strong>mode simulasi</strong> aktif, tidak ada pesan yang benar-benar
          dikirim — pengingat hanya dicatat sebagai simulasi.
        </p>
      </div>

      <SwitchRow
        id="integration-wa"
        label="Aktifkan pengingat WhatsApp"
        description="Pengingat dikirim melalui penyedia yang dipilih bila mode simulasi dimatikan."
        checked={form.whatsappEnabled}
        onCheckedChange={(checked) => setForm({ ...form, whatsappEnabled: checked })}
      />

      {form.whatsappEnabled ? (
        <FormGrid>
          <FormField label="Penyedia WhatsApp" htmlFor="integration-provider" error={errors.whatsappProvider}>
            <OptionsSelect
              id="integration-provider"
              value={form.whatsappProvider}
              onValueChange={(value) =>
                setForm({ ...form, whatsappProvider: value as 'WAHASENDER' | 'CUSTOM' })
              }
              options={[
                { value: 'WAHASENDER', label: 'WahaSender (bawaan)' },
                { value: 'CUSTOM', label: 'Penyedia kustom' },
              ]}
            />
          </FormField>
          <FormField
            label="Nama pengirim"
            htmlFor="integration-wa-sender"
            error={errors.whatsappSenderName}
            hint="Nama yang tampil pada pesan pelanggan."
          >
            <Input
              id="integration-wa-sender"
              value={form.whatsappSenderName}
              onChange={(event) => setForm({ ...form, whatsappSenderName: event.target.value })}
            />
          </FormField>
        </FormGrid>
      ) : null}

      <SwitchRow
        id="integration-email"
        label="Aktifkan pengingat email"
        description="Pengingat dikirim melalui SMTP yang dikonfigurasi sebagai secret server."
        checked={form.emailEnabled}
        onCheckedChange={(checked) => setForm({ ...form, emailEnabled: checked })}
      />

      {form.emailEnabled ? (
        <FormGrid>
          <FormField label="Nama pengirim email" htmlFor="integration-email-name" error={errors.emailFromName}>
            <Input
              id="integration-email-name"
              value={form.emailFromName}
              onChange={(event) => setForm({ ...form, emailFromName: event.target.value })}
            />
          </FormField>
          <FormField label="Alamat pengirim email" htmlFor="integration-email-address" error={errors.emailFromAddress}>
            <Input
              id="integration-email-address"
              type="email"
              placeholder="noreply@perusahaan.id"
              value={form.emailFromAddress}
              onChange={(event) => setForm({ ...form, emailFromAddress: event.target.value })}
            />
          </FormField>
        </FormGrid>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Jadwal pengingat</p>
        <p className="text-xs text-muted-foreground">Pilih minimal satu jadwal. Minimal satu kanal juga wajib dipilih.</p>
        <div className="flex flex-wrap gap-3">
          {REMINDER_OFFSETS.map((offset) => {
            const id = `integration-offset-${offset}`;
            const checked = form.reminderOffsets.includes(offset);
            return (
              <label key={offset} htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(state) =>
                    setForm({
                      ...form,
                      reminderOffsets: state
                        ? [...form.reminderOffsets, offset]
                        : form.reminderOffsets.filter((value) => value !== offset),
                    })
                  }
                />
                {REMINDER_OFFSET_LABELS[offset]}
              </label>
            );
          })}
        </div>
        {errors.reminderOffsets ? <p className="text-xs font-medium text-destructive">{errors.reminderOffsets}</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Kanal pengingat</p>
        <div className="flex flex-wrap gap-3">
          {REMINDER_CHANNELS.map((channel) => {
            const id = `integration-channel-${channel}`;
            const checked = form.reminderChannels.includes(channel);
            return (
              <label key={channel} htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(state) =>
                    setForm({
                      ...form,
                      reminderChannels: state
                        ? [...form.reminderChannels, channel]
                        : form.reminderChannels.filter((value) => value !== channel),
                    })
                  }
                />
                {REMINDER_CHANNEL_LABELS[channel]}
              </label>
            );
          })}
        </div>
        {errors.reminderChannels ? <p className="text-xs font-medium text-destructive">{errors.reminderChannels}</p> : null}
      </div>

      <SwitchRow
        id="integration-simulation"
        label="Mode simulasi"
        description="Bila aktif, pengingat tidak dikirim ke pelanggan — hanya tercatat untuk pengujian alur."
        checked={form.reminderSimulationMode}
        onCheckedChange={(checked) => setForm({ ...form, reminderSimulationMode: checked })}
      />
    </SettingsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Template                                                                */
/* -------------------------------------------------------------------------- */

/**
 * DocumentTemplatesSection — pengelola template dokumen (kontrak, kuitansi, surat).
 *
 * Setiap penyimpanan template baru pada nama yang sama menaikkan nomor versi,
 * sehingga dokumen yang sudah dicetak tidak berubah oleh perubahan berikutnya.
 */
function DocumentTemplatesSection(): JSX.Element {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const templatesQuery = useDocumentTemplates(organizationId);
  const saveMutation = useSaveDocumentTemplate(organizationId);
  const toggleMutation = useToggleDocumentTemplate();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplateRow | null>(null);
  const [form, setForm] = useState<{ kind: DocumentKind; name: string; body: string; isActive: boolean }>({
    kind: 'CONTRACT',
    name: '',
    body: '',
    isActive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const templates = templatesQuery.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({ kind: 'CONTRACT', name: '', body: '', isActive: true });
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (row: DocumentTemplateRow) => {
    setEditing(row);
    setForm({ kind: row.kind, name: row.name, body: row.body, isActive: row.is_active });
    setFormError(null);
    setOpen(true);
  };

  const submit = async () => {
    setFormError(null);
    if (form.name.trim().length < 2) {
      setFormError('Nama template minimal 2 karakter.');
      return;
    }
    if (form.body.trim().length < 10) {
      setFormError('Isi template minimal 10 karakter.');
      return;
    }
    try {
      const saved = await saveMutation.mutateAsync({
        id: editing?.id ?? null,
        kind: form.kind,
        name: form.name,
        body: form.body,
        isActive: form.isActive,
      });
      notifySuccess(
        editing ? 'Template diperbarui' : `Template disimpan sebagai versi ${saved.version}`,
        editing ? form.name : 'Versi baru dibuat agar dokumen lama tidak berubah.',
      );
      setOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  return (
    <SettingsCard
      title="Template Dokumen"
      description="Template kontrak, kuitansi, dan surat yang dapat dicetak. Placeholder yang didukung: {nama_pelanggan}, {nomor_kontrak}, {nama_usaha}, {tanggal}."
      action={
        <Button size="sm" onClick={openCreate} disabled={!organizationId}>
          <Plus className="h-4 w-4" aria-hidden />
          Template Baru
        </Button>
      }
    >
      {templatesQuery.isLoading ? (
        <SectionSkeleton />
      ) : templatesQuery.error ? (
        <ErrorState
          title="Template dokumen gagal dimuat"
          message="Periksa koneksi Anda lalu coba lagi."
          onRetry={() => void queryClient.invalidateQueries({ queryKey: ['document-templates'] })}
        />
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada template dokumen. Selama belum ada, dokumen dicetak memakai tata letak bawaan aplikasi pada tombol
          Cetak di halaman Kontrak dan Pembayaran.
        </p>
      ) : (
        <ul className="divide-y">
          {templates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {template.name}
                  <Badge variant="secondary">{DOCUMENT_KIND_LABELS[template.kind]}</Badge>
                  <Badge variant="outline">Versi {template.version}</Badge>
                </p>
                <p className="truncate text-xs text-muted-foreground">{template.body.slice(0, 120)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={template.is_active ? 'success' : 'muted'}>
                  {template.is_active ? 'Aktif' : 'Nonaktif'}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
                  Ubah
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={toggleMutation.isPending && toggleMutation.variables?.id === template.id}
                  onClick={() =>
                    toggleMutation.mutate(
                      { id: template.id, isActive: !template.is_active },
                      {
                        onSuccess: () =>
                          notifySuccess(
                            template.is_active ? 'Template dinonaktifkan' : 'Template diaktifkan',
                            template.name,
                          ),
                        onError: (error) => notifyError(error),
                      },
                    )
                  }
                >
                  {template.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Ubah template dokumen' : 'Template dokumen baru'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Versi ${editing.version} akan diperbarui. Dokumen yang sudah dicetak tidak ikut berubah.`
                : 'Template baru dibuat sebagai versi 1. Menyimpan dengan nama yang sama akan membuat versi berikutnya.'}
            </DialogDescription>
          </DialogHeader>

          {formError ? <ErrorState title="Template tidak dapat disimpan" message={formError} /> : null}

          <div className="space-y-4">
            <FormGrid>
              <FormField label="Jenis dokumen" htmlFor="doc-kind" required>
                <OptionsSelect
                  id="doc-kind"
                  value={form.kind}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, kind: value as DocumentKind }))}
                  options={DOCUMENT_KINDS.map((kind) => ({ value: kind, label: DOCUMENT_KIND_LABELS[kind] }))}
                  disabled={Boolean(editing)}
                />
              </FormField>
              <FormField label="Nama template" htmlFor="doc-name" required>
                <Input
                  id="doc-name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Contoh: Kontrak Motor Standar"
                />
              </FormField>
            </FormGrid>

            <FormField
              label="Isi template"
              htmlFor="doc-body"
              hint="Gunakan placeholder {nama_pelanggan}, {nomor_kontrak}, {nama_usaha}, {tanggal}."
              required
            >
              <Textarea
                id="doc-body"
                rows={10}
                value={form.body}
                onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                className="font-mono text-xs"
              />
            </FormField>

            <SwitchRow
              label="Aktifkan template"
              description="Template nonaktif tidak dipakai saat mencetak dokumen."
              checked={form.isActive}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isActive: checked }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>
              Batal
            </Button>
            <Button onClick={() => void submit()} loading={saveMutation.isPending}>
              Simpan template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function TemplatesSection(): JSX.Element {
  const { organizationId } = useAuth();
  const templatesQuery = useReminderTemplates(organizationId);
  const templates = templatesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Template Pengingat"
        description="Ringkasan template pesan pengingat yang aktif pada organisasi ini."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/reminders">Kelola di halaman Pengingat</Link>
          </Button>
        }
      >
        {templatesQuery.isLoading ? (
          <SectionSkeleton />
        ) : templatesQuery.error ? (
          <ErrorState
            title="Template pengingat gagal dimuat"
            message="Periksa koneksi Anda lalu coba lagi."
            onRetry={() => void templatesQuery.refetch()}
          />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada template pengingat tersimpan. Buat template pada halaman Pengingat agar pesan dapat dikirim.
          </p>
        ) : (
          <ul className="divide-y">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">
                    {REMINDER_OFFSET_LABELS[template.offset_key]} • {template.subject ?? 'Tanpa subjek'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{template.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ReminderChannelBadge channel={template.channel} />
                  <Badge variant={template.is_active ? 'success' : 'muted'}>
                    {template.is_active ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <DocumentTemplatesSection />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Tampilan                                                                */
/* -------------------------------------------------------------------------- */

const THEME_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'system', label: 'Ikuti sistem' },
  { value: 'light', label: 'Terang' },
  { value: 'dark', label: 'Gelap' },
];

function UiSection({ settings }: { settings: AppSettingsRow }): JSX.Element {
  const update = useUpdateSettings();
  const [theme, setTheme] = useState<string>(typeof settings.ui.theme === 'string' ? settings.ui.theme : 'system');
  const [primaryColor, setPrimaryColor] = useState<string>(
    typeof settings.ui.primary_color === 'string' ? settings.ui.primary_color : '#4f46e5',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setTheme(typeof settings.ui.theme === 'string' ? settings.ui.theme : 'system');
    setPrimaryColor(typeof settings.ui.primary_color === 'string' ? settings.ui.primary_color : '#4f46e5');
  }, [settings.ui]);

  const colorValid = /^#[0-9a-fA-F]{6}$/.test(primaryColor);

  const handleSave = () => {
    if (!colorValid) {
      setErrors({ primary_color: 'Warna utama harus berformat heksadesimal 6 digit, mis. #4f46e5.' });
      notifyError(new Error('Warna utama tidak valid.'), 'Pengaturan tampilan belum valid');
      return;
    }
    setErrors({});
    update.mutate(
      { section: 'ui', value: { theme, primary_color: primaryColor } },
      {
        onSuccess: () => notifySuccess('Preferensi tampilan disimpan.'),
        onError: (error) => notifyError(error, 'Preferensi tampilan gagal disimpan'),
      },
    );
  };

  return (
    <SettingsCard
      title="Tampilan"
      description="Preferensi tema dan warna utama organisasi."
      footer={
        <Button loading={update.isPending} onClick={handleSave}>
          <Save aria-hidden />
          Simpan preferensi tampilan
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Preferensi tema" htmlFor="ui-theme" error={errors.theme}>
          <OptionsSelect id="ui-theme" value={theme} onValueChange={setTheme} options={THEME_OPTIONS} />
        </FormField>
        <FormField
          label="Warna utama"
          htmlFor="ui-color"
          error={errors.primary_color}
          hint="Format heksadesimal 6 digit, mis. #4f46e5."
        >
          <div className="flex items-center gap-2">
            <Input
              id="ui-color"
              value={primaryColor}
              onChange={(event) => setPrimaryColor(event.target.value)}
              className="font-mono"
            />
            <span
              aria-hidden
              className="h-9 w-9 shrink-0 rounded-md border"
              style={{ backgroundColor: colorValid ? primaryColor : 'transparent' }}
            />
          </div>
        </FormField>
      </FormGrid>

      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Preferensi disimpan, bukan diterapkan langsung</p>
        <p>
          Nilai ini disimpan sebagai preferensi organisasi pada pengaturan. Aplikasi belum mengubah tema atau warna
          secara otomatis pada sesi berjalan — penerapan akan mengikuti mekanisme tema aplikasi. Halaman ini tidak
          memalsukan pergantian tema.
        </p>
        <p className="mt-1">
          Kepadatan tampilan (density) mengikuti pengaturan peramban dan ukuran layar; belum ada preferensi terpisah.
        </p>
      </div>
    </SettingsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Halaman                                                                    */
/* -------------------------------------------------------------------------- */

export default function SettingsPage(): JSX.Element {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { organizationId, can, role } = useAuth();

  const settingsQuery = useSettings(organizationId);
  const organizationQuery = useOrganization(organizationId);

  const active: SettingsSection = isSection(section) ? section : 'business';

  let content: ReactNode;
  if (active === 'business') {
    content = organizationQuery.isLoading ? (
      <SectionSkeleton />
    ) : organizationQuery.error ? (
      <ErrorState
        title="Data organisasi gagal dimuat"
        message="Periksa koneksi Anda lalu coba lagi."
        onRetry={() => void organizationQuery.refetch()}
      />
    ) : organizationQuery.data ? (
      <BusinessSection organization={organizationQuery.data} />
    ) : (
      <ErrorState title="Organisasi tidak ditemukan" message="Organisasi aktif tidak dapat dimuat pada sesi ini." />
    );
  } else if (settingsQuery.isLoading) {
    content = <SectionSkeleton />;
  } else if (settingsQuery.error) {
    content = (
      <ErrorState
        title="Pengaturan gagal dimuat"
        message="Pengaturan organisasi belum dapat dimuat. Periksa koneksi Anda lalu coba lagi."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else if (!settingsQuery.data) {
    content = (
      <ErrorState
        title="Pengaturan belum tersedia"
        message="Berkas pengaturan organisasi belum dibuat di server. Hubungi administrator sistem."
      />
    );
  } else if (active === 'numbering') {
    content = <NumberingSection settings={settingsQuery.data} organization={organizationQuery.data} />;
  } else if (active === 'finance') {
    content = <FinanceSection settings={settingsQuery.data} />;
  } else if (active === 'penalty') {
    content = <PenaltySection settings={settingsQuery.data} />;
  } else if (active === 'integrations') {
    content = <IntegrationsSection settings={settingsQuery.data} />;
  } else if (active === 'templates') {
    content = <TemplatesSection />;
  } else {
    content = <UiSection settings={settingsQuery.data} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pengaturan"
        description="Konfigurasi organisasi aktif. Perubahan hanya tersimpan setelah validasi berhasil di sisi klien dan server."
        badge={
          <Badge variant="secondary" className="gap-1">
            {active === 'business' ? <Building2 className="h-3 w-3" aria-hidden /> : null}
            {active === 'numbering' ? <Hash className="h-3 w-3" aria-hidden /> : null}
            {active === 'finance' ? <Wallet className="h-3 w-3" aria-hidden /> : null}
            {active === 'penalty' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
            {active === 'integrations' ? <Plug className="h-3 w-3" aria-hidden /> : null}
            {active === 'templates' ? <FileText className="h-3 w-3" aria-hidden /> : null}
            {active === 'ui' ? <Info className="h-3 w-3" aria-hidden /> : null}
            {SECTION_LABELS[active]}
          </Badge>
        }
      />

      <p className="text-xs text-muted-foreground">
        Role Anda: {role ? ROLE_LABELS[role] : '-'}. Izin <code>settings.business</code> dan{' '}
        <code>settings.integrations</code> hanya dimiliki Super Admin
        {can('settings.business') ? ' — Anda memilikinya' : ' — Anda tidak memilikinya'}.
      </p>

      <Tabs value={active} onValueChange={(value) => navigate(`/app/settings/${value}`)}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 p-1">
          {SECTION_ORDER.map((item) => (
            <TabsTrigger key={item} value={item}>
              {SECTION_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {content}
    </div>
  );
}
