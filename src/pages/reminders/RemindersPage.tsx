/**
 * RemindersPage.tsx — Pengingat jatuh tempo.
 *
 * TIGA KEBENARAN YANG TIDAK BOLEH DILANGGAR HALAMAN INI:
 *   1. Aplikasi hanya MEMBENTUK ANTREAN pengingat. Selama kanal belum memiliki
 *      penyedia yang dikonfigurasi (atau mode simulasi masih aktif), TIDAK ADA
 *      pesan yang benar-benar dikirim. Halaman ini tidak pernah mengklaim pesan
 *      sudah terkirim.
 *   2. "Tandai Terkirim" hanya MENCATAT bahwa pengiriman dilakukan di luar
 *      aplikasi (mis. petugas mengirim WhatsApp manual). Itu bukan bukti
 *      pengiriman otomatis.
 *   3. Pesan pengingat memakai bahasa sopan dan profesional, serta tidak pernah
 *      mengungkapkan informasi utang kepada pihak ketiga selain pelanggan.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, ChevronDown, Info, Megaphone, Save } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { DateText, DetailRow, ReminderChannelBadge } from '@/components/common/domain';
import { DataTable, type Column } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/AppShell';
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
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  Input,
  Label,
  OptionsSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  SwitchRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_CHANNELS,
  REMINDER_OFFSET_LABELS,
  REMINDER_OFFSETS,
  REMINDER_STATUSES,
  type ReminderChannel,
  type ReminderOffset,
  type ReminderStatus,
} from '@/core/types';
import {
  DEFAULT_REMINDER_FILTERS,
  useEnqueueReminders,
  useMarkReminder,
  useReminderTemplates,
  useReminders,
  useSaveReminderTemplate,
  useSettings,
  type ReminderFilters,
} from '@/data/admin';
import type { IntegrationSettings, ReminderRow, ReminderTemplateRow } from '@/data/types';
import { formatDateId, formatDateTimeId, todayIso } from '@/lib/date';
import { errorMessage } from '@/lib/errors';

type TabKey = 'queue' | 'templates' | 'settings';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  PENDING: 'Menunggu',
  SENT: 'Tercatat terkirim',
  FAILED: 'Gagal',
  SKIPPED: 'Dilewati',
  CANCELLED: 'Dibatalkan',
};

const REMINDER_STATUS_VARIANTS: Record<ReminderStatus, 'warning' | 'success' | 'destructive' | 'muted' | 'outline'> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'destructive',
  SKIPPED: 'muted',
  CANCELLED: 'outline',
};

const PLACEHOLDERS = ['{nama}', '{nomor_kontrak}', '{jumlah_tagihan}', '{jatuh_tempo}', '{nama_usaha}'] as const;

function ReminderStatusBadge({ status }: { status: ReminderStatus | string }): JSX.Element {
  const key = status as ReminderStatus;
  return (
    <Badge variant={REMINDER_STATUS_VARIANTS[key] ?? 'muted'}>{REMINDER_STATUS_LABELS[key] ?? status}</Badge>
  );
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
}): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {label}
          {selected.length > 0 ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 ? (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Bersihkan pilihan
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function PlaceholderHelp(): JSX.Element {
  return (
    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      Placeholder yang dikenali: {PLACEHOLDERS.join(', ')}. Placeholder akan diganti
      server saat pesan disiapkan. Pastikan isi pesan tetap sopan dan tidak memuat informasi utang yang bersifat rahasia.
    </p>
  );
}

/** Editor satu template pengingat (offset + kanal tertentu). */
function TemplateEditor({
  template,
  organizationId,
  canManage,
}: {
  template: ReminderTemplateRow;
  organizationId: string | null;
  canManage: boolean;
}): JSX.Element {
  const saveTemplate = useSaveReminderTemplate(organizationId);
  const [body, setBody] = useState(template.body);
  const [subject, setSubject] = useState(template.subject ?? '');
  const [isActive, setIsActive] = useState(template.is_active);
  const [error, setError] = useState<string | null>(null);

  const persist = async (nextActive: boolean) => {
    if (body.trim().length < 10) {
      setError('Isi template minimal 10 karakter.');
      return false;
    }
    setError(null);
    try {
      await saveTemplate.mutateAsync({
        id: template.id,
        offset: template.offset_key,
        channel: template.channel,
        subject: subject.trim() === '' ? null : subject.trim(),
        body: body.trim(),
        isActive: nextActive,
      });
      setIsActive(nextActive);
      notifySuccess('Template disimpan', `${REMINDER_OFFSET_LABELS[template.offset_key]} • ${REMINDER_CHANNEL_LABELS[template.channel]}`);
      return true;
    } catch (saveError) {
      notifyError(saveError, 'Template gagal disimpan');
      return false;
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{REMINDER_OFFSET_LABELS[template.offset_key]}</Badge>
          <ReminderChannelBadge channel={template.channel} />
          {isActive ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge>}
        </div>
      </div>

      <FormField label="Subjek (khusus email)" hint="Boleh dikosongkan untuk kanal WhatsApp.">
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={!canManage}
          placeholder="Pengingat cicilan {nomor_kontrak}"
        />
      </FormField>

      <FormField label="Isi pesan" required error={error} hint="Minimal 10 karakter.">
        <Textarea
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!canManage}
          aria-invalid={Boolean(error)}
        />
      </FormField>

      <PlaceholderHelp />

      <SwitchRow
        label="Aktifkan template ini"
        description="Template nonaktif dilewati saat antrean pengingat dibentuk."
        checked={isActive}
        disabled={!canManage || saveTemplate.isPending}
        onCheckedChange={(checked) => {
          void persist(checked);
        }}
      />

      {canManage ? (
        <Button size="sm" loading={saveTemplate.isPending} onClick={() => void persist(isActive)}>
          <Save aria-hidden />
          Simpan template
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Hanya role dengan izin mengelola pengingat yang dapat mengubah template.</p>
      )}
    </div>
  );
}

/** Pembuat/pembaru template untuk kombinasi jadwal + kanal yang dipilih. */
function NewTemplateCard({ organizationId, canManage }: { organizationId: string | null; canManage: boolean }): JSX.Element {
  const saveTemplate = useSaveReminderTemplate(organizationId);
  const [offset, setOffset] = useState<ReminderOffset>('D_MINUS_3');
  const [channel, setChannel] = useState<ReminderChannel>('WHATSAPP');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(
    'Selamat pagi {nama}, kami mengingatkan cicilan kontrak {nomor_kontrak} sebesar {jumlah_tagihan} yang jatuh tempo pada {jatuh_tempo}. Terima kasih.',
  );
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (body.trim().length < 10) {
      setError('Isi template minimal 10 karakter.');
      return;
    }
    setError(null);
    try {
      await saveTemplate.mutateAsync({
        id: null,
        offset,
        channel,
        subject: subject.trim() === '' ? null : subject.trim(),
        body: body.trim(),
        isActive: true,
      });
      notifySuccess(
        'Template disimpan',
        'Kombinasi jadwal + kanal yang sama akan diperbarui (tidak dibuat ganda).',
      );
    } catch (saveError) {
      notifyError(saveError, 'Template gagal disimpan');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tambah / perbarui template</CardTitle>
        <CardDescription>
          Satu kombinasi jadwal dan kanal hanya memiliki satu template. Menyimpan kombinasi yang sudah ada akan
          memperbaruinya, bukan membuat duplikat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Jadwal pengingat" required>
            <OptionsSelect
              value={offset}
              onValueChange={(value) => setOffset(value as ReminderOffset)}
              disabled={!canManage}
              options={REMINDER_OFFSETS.map((item) => ({ value: item, label: REMINDER_OFFSET_LABELS[item] }))}
            />
          </FormField>
          <FormField label="Kanal" required>
            <OptionsSelect
              value={channel}
              onValueChange={(value) => setChannel(value as ReminderChannel)}
              disabled={!canManage}
              options={REMINDER_CHANNELS.map((item) => ({ value: item, label: REMINDER_CHANNEL_LABELS[item] }))}
            />
          </FormField>
        </div>
        <FormField label="Subjek (khusus email)">
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={!canManage}
            placeholder="Pengingat cicilan {nomor_kontrak}"
          />
        </FormField>
        <FormField label="Isi pesan" required error={error} hint="Minimal 10 karakter.">
          <Textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={!canManage}
            aria-invalid={Boolean(error)}
          />
        </FormField>
        <PlaceholderHelp />
        <Button loading={saveTemplate.isPending} disabled={!canManage} onClick={() => void handleSave()}>
          <Save aria-hidden />
          Simpan template
        </Button>
      </CardContent>
    </Card>
  );
}

function IntegrationSettingsPanel({
  settings,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  settings: IntegrationSettings | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}): JSX.Element {
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
  if (!settings) {
    return (
      <ErrorState message="Pengaturan integrasi organisasi belum tersedia sehingga status pengiriman tidak dapat dipastikan. Anggap pesan pengingat TIDAK dikirim sampai pengaturan tersedia." />
    );
  }

  const whatsappConfigured = settings.whatsapp_enabled;
  const emailConfigured = settings.email_enabled;
  const usesWhatsapp = settings.reminder_channels.includes('WHATSAPP');
  const usesEmail = settings.reminder_channels.includes('EMAIL');
  const usesInApp = settings.reminder_channels.includes('IN_APP');
  const simulation = settings.reminder_simulation_mode;

  const whatsappMissing = usesWhatsapp && !whatsappConfigured;
  const emailMissing = usesEmail && !emailConfigured;

  return (
    <div className="space-y-4">
      {simulation || whatsappMissing || emailMissing ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            Pesan pengingat TIDAK benar-benar dikirim
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {simulation ? (
              <li>
                Mode simulasi aktif (<code>reminder_simulation_mode</code>). Seluruh pengiriman hanya dicatat sebagai
                simulasi; tidak ada pesan yang keluar dari sistem.
              </li>
            ) : null}
            {whatsappMissing ? (
              <li>
                Kanal WhatsApp dipilih, tetapi integrasi WhatsApp belum diaktifkan
                (<code>whatsapp_enabled = false</code>). Pengingat WhatsApp tidak akan terkirim.
              </li>
            ) : null}
            {emailMissing ? (
              <li>
                Kanal Email dipilih, tetapi integrasi email belum diaktifkan (<code>email_enabled = false</code>).
                Pengingat email tidak akan terkirim.
              </li>
            ) : null}
          </ul>
          <p className="text-xs text-muted-foreground">
            Jangan menyampaikan kepada pelanggan bahwa pengingat sudah dikirim sebelum pengiriman benar-benar dilakukan
            melalui kanal di luar aplikasi.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 text-info" aria-hidden />
            Konfigurasi kanal tersedia
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Penyedia kanal sudah diaktifkan. Status &ldquo;Tercatat terkirim&rdquo; pada antrean tetap bergantung pada
            proses pengiriman (manual atau proses berkala) dan bukan jaminan pesan sampai ke pelanggan.
          </p>
        </div>
      )}

      <dl>
        <DetailRow label="WhatsApp aktif">
          {whatsappConfigured ? <Badge variant="success">Ya</Badge> : <Badge variant="muted">Belum</Badge>}
        </DetailRow>
        <DetailRow label="Penyedia WhatsApp">{settings.whatsapp_provider}</DetailRow>
        <DetailRow label="Nama pengirim WhatsApp">{settings.whatsapp_sender_name ?? '-'}</DetailRow>
        <DetailRow label="Email aktif">
          {emailConfigured ? <Badge variant="success">Ya</Badge> : <Badge variant="muted">Belum</Badge>}
        </DetailRow>
        <DetailRow label="Nama pengirim email">{settings.email_from_name ?? '-'}</DetailRow>
        <DetailRow label="Alamat pengirim email">{settings.email_from_address ?? '-'}</DetailRow>
        <DetailRow label="Jadwal pengingat aktif">
          <span className="flex flex-wrap justify-end gap-1">
            {settings.reminder_offsets.length > 0 ? (
              settings.reminder_offsets.map((offset) => (
                <Badge key={offset} variant="secondary">
                  {REMINDER_OFFSET_LABELS[offset]}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">Belum ada jadwal dipilih</span>
            )}
          </span>
        </DetailRow>
        <DetailRow label="Kanal aktif">
          <span className="flex flex-wrap justify-end gap-1">
            {settings.reminder_channels.length > 0 ? (
              settings.reminder_channels.map((channel) => (
                <ReminderChannelBadge key={channel} channel={channel} />
              ))
            ) : (
              <span className="text-muted-foreground">Belum ada kanal dipilih</span>
            )}
          </span>
        </DetailRow>
        <DetailRow label="Mode simulasi">
          {simulation ? <Badge variant="warning">Aktif — pesan tidak dikirim</Badge> : <Badge variant="success">Nonaktif</Badge>}
        </DetailRow>
        <DetailRow label="Notifikasi dalam aplikasi">
          {usesInApp ? <Badge variant="info">Digunakan</Badge> : <span className="text-muted-foreground">Tidak digunakan</span>}
        </DetailRow>
      </dl>

      <p className="text-xs text-muted-foreground">
        Pengaturan ini hanya dapat diubah oleh Super Admin melalui halaman Pengaturan → Integrasi. Perubahan di halaman
        ini tidak tersedia agar konfigurasi kanal tidak berubah tanpa sengaja.
      </p>
    </div>
  );
}

export default function RemindersPage(): JSX.Element {
  const { can, organizationId } = useAuth();
  const canManage = can('reminders.manage');

  const [tab, setTab] = useState<TabKey>('queue');
  const [filters, setFilters] = useState<ReminderFilters>(DEFAULT_REMINDER_FILTERS);
  const [sentTarget, setSentTarget] = useState<ReminderRow | null>(null);
  const [failTarget, setFailTarget] = useState<ReminderRow | null>(null);
  const [failMessage, setFailMessage] = useState('');
  const [failError, setFailError] = useState<string | null>(null);

  const queueQuery = useReminders(filters);
  const templatesQuery = useReminderTemplates(organizationId);
  const settingsQuery = useSettings(organizationId);
  const enqueueReminders = useEnqueueReminders();
  const markReminder = useMarkReminder();

  const rows = queueQuery.data?.rows ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  const integrations = settingsQuery.data?.integrations ?? null;

  const templates = useMemo(
    () =>
      [...(templatesQuery.data ?? [])].sort(
        (a, b) =>
          REMINDER_OFFSETS.indexOf(a.offset_key) - REMINDER_OFFSETS.indexOf(b.offset_key) ||
          a.channel.localeCompare(b.channel),
      ),
    [templatesQuery.data],
  );

  const handleEnqueue = async () => {
    try {
      const result = await enqueueReminders.mutateAsync({ asOf: todayIso() });
      notifySuccess(
        `${result.inserted} pengingat ditambahkan ke antrean`,
        `Dihitung per ${formatDateId(result.as_of)}. Proses ini idempoten: satu pengingat per kombinasi cicilan + jadwal + kanal, sehingga menjalankannya ulang tidak menggandakan antrean. Pembentukan antrean tidak berarti pesan sudah dikirim.`,
      );
    } catch (error) {
      notifyError(error, 'Gagal membentuk antrean pengingat');
    }
  };

  const handleMarkSent = async () => {
    if (!sentTarget) return;
    try {
      await markReminder.mutateAsync({ reminderId: sentTarget.id, status: 'SENT' });
      notifySuccess(
        'Status diperbarui menjadi "Tercatat terkirim"',
        'Status ini hanya mencatat bahwa pengiriman sudah dilakukan di luar aplikasi. Aplikasi tidak mengirim pesan apa pun.',
      );
      setSentTarget(null);
    } catch (error) {
      notifyError(error, 'Gagal memperbarui status pengingat');
    }
  };

  const handleMarkFailed = async () => {
    if (!failTarget) return;
    if (failMessage.trim().length < 3) {
      setFailError('Tuliskan penyebab kegagalan minimal 3 karakter agar dapat ditindaklanjuti.');
      return;
    }
    setFailError(null);
    try {
      await markReminder.mutateAsync({ reminderId: failTarget.id, status: 'FAILED', error: failMessage.trim() });
      notifySuccess('Pengingat ditandai gagal', 'Penyebab kegagalan tersimpan pada antrean.');
      setFailTarget(null);
      setFailMessage('');
    } catch (error) {
      notifyError(error, 'Gagal memperbarui status pengingat');
    }
  };

  const queueColumns: Column<ReminderRow>[] = [
    {
      key: 'scheduled_for',
      header: 'Jadwal',
      accessor: (row) => row.scheduled_for,
      cell: (row) => <span className="tabular whitespace-nowrap">{formatDateTimeId(row.scheduled_for)}</span>,
    },
    {
      key: 'contract',
      header: 'Kontrak',
      accessor: (row) => row.credit_contracts?.contract_number ?? '',
      cell: (row) => (
        <Link to={`/app/contracts/${row.contract_id}`} className="tabular font-medium text-primary hover:underline">
          {row.credit_contracts?.contract_number ?? '-'}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Pelanggan',
      accessor: (row) => row.customers?.full_name ?? '',
      cell: (row) => (
        <Link to={`/app/customers/${row.customer_id}`} className="text-primary hover:underline">
          {row.customers?.full_name ?? '-'}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: 'Telepon',
      hideOnMobile: true,
      accessor: (row) => row.customers?.phone ?? '',
      cell: (row) => <span className="tabular">{row.customers?.phone ?? '-'}</span>,
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
      accessor: (row) => row.installments?.due_date ?? '',
      cell: (row) => <DateText value={row.installments?.due_date ?? null} />,
    },
    {
      key: 'channel',
      header: 'Kanal',
      accessor: (row) => row.channel,
      cell: (row) => <ReminderChannelBadge channel={row.channel} />,
    },
    {
      key: 'offset',
      header: 'Jadwal Pengingat',
      accessor: (row) => row.offset_key,
      cell: (row) => <span className="text-xs">{REMINDER_OFFSET_LABELS[row.offset_key] ?? row.offset_key}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (row) => <ReminderStatusBadge status={row.status} />,
    },
    {
      key: 'attempts',
      header: 'Percobaan',
      align: 'right',
      accessor: (row) => row.attempts,
      cell: (row) => <span className="tabular">{row.attempts}</span>,
    },
    {
      key: 'last_error',
      header: 'Error Terakhir',
      hideOnMobile: true,
      accessor: (row) => row.last_error ?? '',
      cell: (row) =>
        row.last_error ? (
          <span className="text-xs text-destructive">{row.last_error}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      cell: (row) =>
        canManage ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={row.status === 'SENT'} onClick={() => setSentTarget(row)}>
              Tandai Terkirim
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={row.status === 'FAILED'}
              onClick={() => {
                setFailTarget(row);
                setFailMessage(row.last_error ?? '');
                setFailError(null);
              }}
            >
              Tandai Gagal
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Hanya lihat</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pengingat"
        description="Antrean pengingat jatuh tempo, template pesan, dan status integrasi kanal. Aplikasi tidak pernah mengklaim pesan terkirim tanpa bukti pengiriman."
      />

      <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info/10 p-3 text-sm">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p className="text-xs text-muted-foreground">
          Pesan pengingat dirancang memakai bahasa yang sopan dan profesional, hanya menyampaikan kewajiban cicilan
          kepada pelanggan yang bersangkutan, dan TIDAK mengungkapkan informasi utang kepada pihak ketiga (tetangga,
          keluarga, atau atasan) selain pelanggan sendiri.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="queue">
            <BellRing className="h-4 w-4" aria-hidden />
            Antrean
          </TabsTrigger>
          <TabsTrigger value="templates">Template</TabsTrigger>
          <TabsTrigger value="settings">Pengaturan</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="queue" className="space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4 pt-4">
              <MultiSelect
                label="Status"
                options={REMINDER_STATUSES.map((status) => ({ value: status, label: REMINDER_STATUS_LABELS[status] }))}
                selected={filters.statuses}
                onChange={(next) => setFilters((previous) => ({ ...previous, page: 1, statuses: next }))}
              />
              <MultiSelect
                label="Kanal"
                options={REMINDER_CHANNELS.map((channel) => ({
                  value: channel,
                  label: REMINDER_CHANNEL_LABELS[channel],
                }))}
                selected={filters.channels}
                onChange={(next) => setFilters((previous) => ({ ...previous, page: 1, channels: next }))}
              />
              <div className="flex items-center gap-2">
                <Label htmlFor="reminder-from">Jadwal dari</Label>
                <DateInput
                  id="reminder-from"
                  value={filters.from ?? null}
                  onChange={(value) => setFilters((previous) => ({ ...previous, page: 1, from: value }))}
                />
                <span className="text-sm text-muted-foreground">sampai</span>
                <DateInput
                  aria-label="Jadwal sampai"
                  value={filters.to ?? null}
                  onChange={(value) => setFilters((previous) => ({ ...previous, page: 1, to: value }))}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters(DEFAULT_REMINDER_FILTERS)}
              >
                Reset filter
              </Button>
              <span className="flex-1" />
              {canManage ? (
                <Button loading={enqueueReminders.isPending} onClick={() => void handleEnqueue()}>
                  <BellRing aria-hidden />
                  Bentuk Antrean Pengingat
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <p className="text-xs text-muted-foreground">
              &ldquo;Bentuk Antrean Pengingat&rdquo; menghitung pengingat yang seharusnya dikirim berdasarkan jadwal pada
              hari ini. Proses ini idempoten: satu pengingat per kombinasi cicilan + jadwal + kanal, sehingga menjalankan
              tombol ini berkali-kali tidak membuat pengingat ganda. Membentuk antrean TIDAK mengirim pesan — periksa tab
              Pengaturan untuk status kanal.
            </p>
          ) : null}

          <DataTable
            data={rows}
            columns={queueColumns}
            getRowId={(row) => row.id}
            loading={queueQuery.isLoading}
            error={queueQuery.isError ? queueQuery.error : undefined}
            onRetry={() => void queueQuery.refetch()}
            searchable={false}
            initialPageSize={200}
            emptyTitle="Antrean pengingat kosong"
            emptyDescription="Belum ada pengingat pada filter ini. Gunakan tombol “Bentuk Antrean Pengingat” untuk menyusunnya dari jadwal yang berlaku."
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Halaman {filters.page} dari {totalPages} • {total} pengingat (paginasi server)
                </span>
                <div className="flex items-center gap-2">
                  <OptionsSelect
                    aria-label="Jumlah baris per halaman"
                    className="h-9 w-[120px]"
                    value={String(filters.pageSize)}
                    onValueChange={(value) =>
                      setFilters((previous) => ({ ...previous, page: 1, pageSize: Number(value) }))
                    }
                    options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size} / halaman` }))}
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
                    disabled={filters.page >= totalPages}
                    onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            }
          />
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="templates" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Template pesan pengingat</CardTitle>
              <CardDescription>
                Template menentukan isi pesan untuk setiap jadwal dan kanal. Gunakan bahasa yang sopan dan jangan
                mencantumkan rincian utang yang bersifat rahasia.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {templatesQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : templatesQuery.isError ? (
                <ErrorState message={errorMessage(templatesQuery.error)} onRetry={() => void templatesQuery.refetch()} />
              ) : templates.length === 0 ? (
                <div className="space-y-2 rounded-md border border-dashed p-4 text-sm">
                  <p className="font-medium">Belum ada template tersimpan</p>
                  <p className="text-xs text-muted-foreground">
                    Buat template pertama pada kartu &ldquo;Tambah / perbarui template&rdquo; di bawah. Tanpa template,
                    pengingat tetap dapat dibentuk, tetapi isi pesannya memakai teks bawaan sistem.
                  </p>
                </div>
              ) : (
                templates.map((template) => (
                  <TemplateEditor
                    key={template.id}
                    template={template}
                    organizationId={organizationId}
                    canManage={canManage}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <NewTemplateCard organizationId={organizationId} canManage={canManage} />
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="settings" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Status integrasi kanal</CardTitle>
              <CardDescription>
                Menampilkan konfigurasi pengiriman pengingat organisasi. Bila sebuah kanal belum memiliki penyedia,
                pesan pada kanal tersebut TIDAK dikirim dan hanya tercatat sebagai simulasi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IntegrationSettingsPanel
                settings={integrations}
                isLoading={settingsQuery.isLoading}
                isError={settingsQuery.isError}
                error={settingsQuery.error}
                onRetry={() => void settingsQuery.refetch()}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kebijakan isi pesan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Pesan pengingat hanya menyampaikan kewajiban cicilan kepada pelanggan yang bersangkutan dengan bahasa
                sopan dan profesional.
              </p>
              <p>
                Pesan tidak memuat ancaman, tidak menyebut tunggakan kepada pihak ketiga, dan tidak mengungkapkan rincian
                utang kepada siapa pun selain pelanggan.
              </p>
              <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Jangan pernah menyatakan kepada pelanggan bahwa pengingat sudah dikirim tanpa bukti pengiriman dari kanal
                yang digunakan.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={sentTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSentTarget(null);
        }}
        title="Tandai pengingat ini terkirim?"
        description="Status ini hanya MENCATAT bahwa pengiriman sudah dilakukan di luar aplikasi (mis. petugas mengirim WhatsApp manual). Aplikasi tidak mengirim pesan apa pun dan status ini bukan bukti otomatis bahwa pelanggan menerima pesan."
        confirmLabel="Tandai terkirim"
        loading={markReminder.isPending}
        onConfirm={() => void handleMarkSent()}
      />

      <Dialog
        open={failTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFailTarget(null);
            setFailMessage('');
            setFailError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tandai pengingat gagal</DialogTitle>
            <DialogDescription>
              Catat penyebab kegagalan agar dapat ditindaklanjuti. Percobaan pengiriman akan tetap tercatat pada antrean.
            </DialogDescription>
          </DialogHeader>
          <FormField
            label="Penyebab kegagalan"
            required
            error={failError}
            hint="Contoh: nomor WhatsApp tidak aktif, alamat email tidak valid."
          >
            <Textarea
              value={failMessage}
              onChange={(event) => setFailMessage(event.target.value)}
              placeholder="Contoh: nomor WhatsApp pelanggan tidak aktif."
              aria-invalid={Boolean(failError)}
            />
          </FormField>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFailTarget(null);
                setFailMessage('');
                setFailError(null);
              }}
            >
              Batal
            </Button>
            <Button variant="destructive" loading={markReminder.isPending} onClick={() => void handleMarkFailed()}>
              Tandai gagal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
