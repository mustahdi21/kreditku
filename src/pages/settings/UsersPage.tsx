/**
 * UsersPage.tsx — Manajemen anggota organisasi.
 *
 * DUA CARA MENAMBAH PENGGUNA
 * --------------------------
 * 1. Kirim undangan (bawaan). Pengguna menerima tautan email dan mengatur
 *    passwordnya sendiri, sehingga password-nya tidak pernah diketahui admin.
 *    Cara ini memerlukan SMTP yang berfungsi pada proyek Supabase.
 * 2. Buat akun dengan password awal. Dipakai bila SMTP belum tersedia: admin
 *    menetapkan password awal, menyampaikannya langsung kepada pengguna, dan
 *    pengguna menggantinya di halaman Profil (auth.updateUser, tidak butuh
 *    email). Dalam cara ini admin mengetahui password awal tersebut, jadi
 *    penggantian oleh pengguna bukan sekadar saran.
 *
 * KEAMANAN
 * --------
 * 1. Penambahan anggota dikerjakan Edge Function `invite-user` di server.
 * 2. Rahasia (service role key) berada di secrets Edge Function, bukan di
 *    browser. Bila fungsi belum di-deploy, halaman ini menampilkan langkah
 *    manual dan TIDAK pernah mengaku berhasil.
 * 3. Password awal hanya dikirim sekali ke fungsi, tidak disimpan aplikasi,
 *    tidak ditulis ke log, dan tidak pernah dikembalikan oleh server.
 * 4. Akun yang sudah ada TIDAK pernah diubah passwordnya oleh halaman ini —
 *    hanya didaftarkan sebagai anggota.
 * 5. Penegakan sesungguhnya ada di RLS + fungsi server; matriks izin di sini
 *    hanya untuk tampilan.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import { DataTable, type Column } from '@/components/data/DataTable';
import { RoleBadge } from '@/components/common/domain';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  OptionsSelect,
  SwitchRow,
} from '@/components/ui';
import { RequirePermission } from '@/routes/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';
import { useMembers, useUpdateMember } from '@/data/admin';
import { getSupabaseClient } from '@/lib/supabase';
import { errorMessage, isEdgeFunctionMissing } from '@/lib/errors';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@/auth/permissions';
import { MEMBER_ROLES, ROLE_LABELS, type MemberRole } from '@/core/types';
import { inviteUserSchema, type InviteUserInput } from '@/core/validation';
import { formatDateShortId, formatDateTimeId } from '@/lib/date';
import type { MemberRow } from '@/data/types';

const ROLE_OPTIONS = MEMBER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/** Label Bahasa Indonesia untuk matriks izin (hanya untuk keterbacaan tabel). */
const PERMISSION_LABELS: Record<Permission, string> = {
  'customers.view': 'Lihat pelanggan',
  'customers.manage': 'Kelola pelanggan',
  'applications.view': 'Lihat pengajuan',
  'applications.manage': 'Kelola pengajuan',
  'applications.decide': 'Putuskan pengajuan',
  'contracts.view': 'Lihat kontrak',
  'contracts.manage': 'Kelola kontrak',
  'contracts.amend': 'Amandemen kontrak',
  'contracts.cancel': 'Batalkan kontrak',
  'installments.view': 'Lihat cicilan',
  'installments.manage': 'Kelola cicilan',
  'payments.view': 'Lihat pembayaran',
  'payments.create': 'Catat pembayaran',
  'payments.reverse': 'Batalkan pembayaran',
  'penalties.view': 'Lihat denda',
  'penalties.manage': 'Kelola denda',
  'penalties.waive': 'Bebaskan denda',
  'reminders.view': 'Lihat pengingat',
  'reminders.manage': 'Kelola pengingat',
  'reports.view': 'Lihat laporan',
  'exports.create': 'Ekspor data',
  'settings.view': 'Lihat pengaturan',
  'settings.manage': 'Kelola pengaturan',
  'settings.integrations': 'Pengaturan integrasi',
  'settings.business': 'Identitas usaha',
  'users.view': 'Lihat pengguna',
  'users.manage': 'Kelola pengguna',
  'audit.view': 'Lihat audit log',
  'notifications.view': 'Lihat notifikasi',
};

interface InviteOutcome {
  readonly deployRequired: boolean;
  readonly message: string;
}

function UsersContent(): JSX.Element {
  const { organizationId, can, profile, role } = useAuth();
  const membersQuery = useMembers(organizationId);
  const updateMember = useUpdateMember();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);

  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<MemberRole>('VIEWER');
  const [editActive, setEditActive] = useState(true);
  const [confirmSave, setConfirmSave] = useState(false);

  const form = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', fullName: '', role: 'VIEWER', initialPassword: '' },
  });

  const members = membersQuery.data ?? [];

  const openEdit = (member: MemberRow) => {
    setEditing(member);
    setEditRole(member.role);
    setEditActive(member.is_active);
    setInviteOutcome(null);
  };

  const submitInvite = form.handleSubmit(async (values) => {
    setInviting(true);
    setInviteOutcome(null);
    try {
      const client = getSupabaseClient();
      const initialPassword = values.initialPassword?.trim() ?? '';
      const response = await client.functions.invoke('invite-user', {
        body: {
          email: values.email,
          fullName: values.fullName,
          role: values.role,
          organizationId,
          ...(initialPassword ? { initialPassword } : {}),
        },
      });

      if (response.error) {
        const rawMessage = errorMessage(response.error);
        const status = (response.error as { context?: { status?: number } }).context?.status;
        setInviteOutcome({ deployRequired: isEdgeFunctionMissing(rawMessage, status), message: rawMessage });
        return;
      }

      const payload = response.data as { error?: string; message?: string; note?: string } | null;
      if (payload?.error) {
        setInviteOutcome({ deployRequired: isEdgeFunctionMissing(payload.error), message: payload.error });
        return;
      }

      if (initialPassword) {
        notifySuccess(
          'Akun dibuat.',
          `Sampaikan password awal kepada ${values.email} secara langsung. Ia dapat menggantinya di halaman Profil.`,
        );
      } else {
        notifySuccess('Undangan terkirim.', `${values.email} akan menerima tautan untuk mengatur password sendiri.`);
      }
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      setInviteOpen(false);
      form.reset({ email: '', fullName: '', role: 'VIEWER', initialPassword: '' });
    } catch (error) {
      const rawMessage = errorMessage(error);
      setInviteOutcome({ deployRequired: isEdgeFunctionMissing(rawMessage), message: rawMessage });
    } finally {
      setInviting(false);
    }
  });

  const columns: readonly Column<MemberRow>[] = [
    {
      key: 'name',
      header: 'Nama',
      accessor: (row) => row.profiles?.full_name ?? '-',
      sortable: true,
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="font-medium">{row.profiles?.full_name ?? 'Tanpa nama'}</p>
          {row.profiles?.phone ? <p className="text-xs text-muted-foreground">{row.profiles.phone}</p> : null}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      accessor: (row) => row.profiles?.email ?? '-',
      sortable: true,
    },
    {
      key: 'role',
      header: 'Role',
      accessor: (row) => ROLE_LABELS[row.role],
      cell: (row) => <RoleBadge role={row.role} />,
      sortable: true,
    },
    {
      key: 'is_active',
      header: 'Status',
      accessor: (row) => (row.is_active ? 'Aktif' : 'Nonaktif'),
      cell: (row) => <Badge variant={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Aktif' : 'Nonaktif'}</Badge>,
    },
    {
      key: 'joined_at',
      header: 'Bergabung',
      accessor: (row) => row.joined_at,
      cell: (row) => <span className="tabular">{formatDateShortId(row.joined_at)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      cell: (row) => (
        <Button variant="outline" size="sm" disabled={!can('users.manage')} onClick={() => openEdit(row)}>
          Ubah akses
        </Button>
      ),
    },
  ];

  const isSelf = editing?.user_id === profile?.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pengguna"
        description="Anggota organisasi aktif beserta role dan izinnya. Role menentukan apa yang dapat dilihat dan dilakukan."
        badge={<Badge variant="secondary">{members.length} anggota</Badge>}
        actions={
          <Button disabled={!can('users.manage')} onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden />
            Tambah Pengguna
          </Button>
        }
      />

      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Super Admin aktif terakhir tidak dapat dinonaktifkan.</p>
        <p>
          Server menolak permintaan tersebut agar organisasi tidak pernah kehilangan administrator. Nonaktifkan atau
          ganti role anggota lain terlebih dahulu, baru lakukan perubahan pada akun terakhir.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          {membersQuery.error ? (
            <ErrorState
              title="Daftar anggota gagal dimuat"
              message="Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void membersQuery.refetch()}
            />
          ) : (
            <DataTable
              data={members}
              columns={columns}
              getRowId={(row) => row.id}
              loading={membersQuery.isLoading}
              searchPlaceholder="Cari nama atau email…"
              initialPageSize={20}
              emptyTitle="Belum ada anggota"
              emptyDescription="Tambahkan rekan kerja agar dapat mengakses organisasi ini."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            Matriks Izin per Role
          </CardTitle>
          <CardDescription>
            Tampilan ini bersifat informatif. Penegakan izin sebenarnya dilakukan oleh Row Level Security dan fungsi
            server di database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="h-11 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Izin
                  </th>
                  {MEMBER_ROLES.map((memberRole) => (
                    <th
                      key={memberRole}
                      scope="col"
                      className="h-11 px-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {ROLE_LABELS[memberRole]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((permission) => (
                  <tr key={permission} className="border-t">
                    <td className="px-3 py-2">
                      <p>{PERMISSION_LABELS[permission]}</p>
                      <p className="font-mono text-xs text-muted-foreground">{permission}</p>
                    </td>
                    {MEMBER_ROLES.map((memberRole) => {
                      const granted = ROLE_PERMISSIONS[memberRole].includes(permission);
                      return (
                        <td key={memberRole} className="px-3 py-2 text-center">
                          {granted ? (
                            <span className="text-success" aria-label="Diizinkan">
                              ✓
                            </span>
                          ) : (
                            <span className="text-muted-foreground" aria-label="Tidak diizinkan">
                              –
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Role Anda saat ini: {role ? ROLE_LABELS[role] : '-'}. Perubahan role berlaku pada permintaan berikutnya
            setelah sesi dimuat ulang.
          </p>
        </CardContent>
      </Card>

      {/* Dialog undangan */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteOutcome(null);
        }}
      >
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>Tambah Pengguna</DialogTitle>
            <DialogDescription>
              Isi password awal untuk membuat akun langsung tanpa mengirim email — pilih ini bila SMTP belum
              dikonfigurasi. Biarkan kosong bila ingin mengirim undangan: pengguna akan menerima tautan dan mengatur
              passwordnya sendiri.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void submitInvite(event)}>
            <FormField label="Nama lengkap" htmlFor="invite-name" required error={form.formState.errors.fullName?.message}>
              <Input id="invite-name" placeholder="mis. Siti Rahmawati" autoComplete="off" {...form.register('fullName')} />
            </FormField>
            <FormField label="Email" htmlFor="invite-email" required error={form.formState.errors.email?.message}>
              <Input id="invite-email" type="email" placeholder="nama@perusahaan.id" autoComplete="off" {...form.register('email')} />
            </FormField>
            <FormField label="Role" htmlFor="invite-role" required error={form.formState.errors.role?.message}>
              <OptionsSelect
                id="invite-role"
                value={form.watch('role')}
                onValueChange={(value) => form.setValue('role', value as MemberRole, { shouldValidate: true })}
                options={ROLE_OPTIONS}
              />
            </FormField>
            <FormField
              label="Password awal (opsional)"
              htmlFor="invite-password"
              error={form.formState.errors.initialPassword?.message}
              hint="Minimal 10 karakter, mengandung huruf dan angka. Sampaikan kepada pengguna secara langsung; ia dapat menggantinya di halaman Profil."
            >
              <Input
                id="invite-password"
                type="password"
                placeholder="Kosongkan untuk mengirim undangan email"
                autoComplete="new-password"
                {...form.register('initialPassword')}
              />
            </FormField>

            {inviteOutcome ? (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-destructive">
                  <ShieldAlert className="h-4 w-4" aria-hidden />
                  Gagal menambah pengguna
                </p>
                {inviteOutcome.deployRequired ? (
                  <>
                    <p className="text-muted-foreground">
                      Edge Function <code>invite-user</code> belum tersedia pada proyek Supabase Anda. Ini langkah
                      manual satu kali yang harus dilakukan administrator sistem (bukan dari halaman ini):
                    </p>
                    <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>
                        Deploy fungsi: <code>supabase functions deploy invite-user</code>
                      </li>
                      <li>
                        Pastikan secret <code>SUPABASE_SERVICE_ROLE_KEY</code> hanya diatur sebagai secret Edge Function
                        di server, tidak pernah di berkas <code>.env</code> klien.
                      </li>
                      <li>
                        Ikuti berkas <code>DEPLOY.md</code> pada repositori untuk langkah lengkap.
                      </li>
                    </ol>
                    <p className="text-xs text-muted-foreground">
                      Tidak ada undangan yang dikirim sampai fungsi ini aktif. Halaman ini tidak akan menampilkan pesan
                      sukses palsu.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">{inviteOutcome.message}</p>
                )}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviting}>
                Tutup
              </Button>
              <Button type="submit" loading={inviting}>
                <UserPlus aria-hidden />
                {form.watch('initialPassword') ? 'Buat akun' : 'Kirim undangan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog ubah akses */}
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : setEditing(null))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Ubah Akses Anggota</DialogTitle>
            <DialogDescription>
              {editing?.profiles?.full_name ?? editing?.profiles?.email ?? 'Anggota'} • bergabung{' '}
              {formatDateTimeId(editing?.joined_at ?? editing?.created_at ?? null)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormField label="Role" htmlFor="member-role">
              <OptionsSelect
                id="member-role"
                value={editRole}
                onValueChange={(value) => setEditRole(value as MemberRole)}
                options={ROLE_OPTIONS}
              />
            </FormField>
            <SwitchRow
              id="member-active"
              label="Status aktif"
              description="Anggota nonaktif tidak dapat membuka data organisasi, tetapi riwayatnya tetap tersimpan."
              checked={editActive}
              onCheckedChange={setEditActive}
            />
            {isSelf && !editActive ? (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-muted-foreground">
                Anda sedang menonaktifkan akun Anda sendiri. Server akan menolak bila Anda adalah Super Admin aktif
                terakhir.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Batal
            </Button>
            <Button
              disabled={!editing || !can('users.manage')}
              onClick={() => setConfirmSave(true)}
            >
              <KeyRound aria-hidden />
              Simpan perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="Terapkan perubahan akses?"
        description={`Role menjadi ${ROLE_LABELS[editRole]} dan status ${editActive ? 'aktif' : 'nonaktif'}. Perubahan berlaku pada permintaan berikutnya dari anggota tersebut.`}
        confirmLabel="Ya, terapkan"
        loading={updateMember.isPending}
        onConfirm={() => {
          if (!editing) return;
          updateMember.mutate(
            { memberId: editing.id, role: editRole, isActive: editActive },
            {
              onSuccess: () => {
                notifySuccess('Akses anggota diperbarui.');
                setConfirmSave(false);
                setEditing(null);
              },
              onError: (error) => {
                notifyError(error, 'Gagal memperbarui akses anggota');
                setConfirmSave(false);
              },
            },
          );
        }}
      />
    </div>
  );
}

export default function UsersPage(): JSX.Element {
  return (
    <RequirePermission permission="users.view">
      <UsersContent />
    </RequirePermission>
  );
}
