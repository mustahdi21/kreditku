/**
 * permissions.ts — Matriks hak akses sisi klien.
 *
 * PENTING: matriks ini HANYA mengatur tampilan (menyembunyikan tombol/menu).
 * Penegakan sebenarnya ada di database melalui Row Level Security dan
 * pemeriksaan role pada fungsi bisnis (SECURITY DEFINER). Jangan pernah
 * menganggap pemeriksaan di sini sebagai pengamanan.
 */

import type { MemberRole } from '@/core/types';
import { MEMBER_ROLES } from '@/core/types';

export const PERMISSIONS = [
  'customers.view',
  'customers.manage',
  'applications.view',
  'applications.manage',
  'applications.decide',
  'contracts.view',
  'contracts.manage',
  'contracts.amend',
  'contracts.cancel',
  'installments.view',
  'installments.manage',
  'payments.view',
  'payments.create',
  'payments.reverse',
  'penalties.view',
  'penalties.manage',
  'penalties.waive',
  'reminders.view',
  'reminders.manage',
  'reports.view',
  'exports.create',
  'settings.view',
  'settings.manage',
  'settings.integrations',
  'settings.business',
  'users.view',
  'users.manage',
  'audit.view',
  'notifications.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'customers.view',
  'applications.view',
  'contracts.view',
  'installments.view',
  'payments.view',
  'penalties.view',
  'reminders.view',
  'reports.view',
  'settings.view',
  'notifications.view',
  'audit.view',
];

const CASHIER_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS.filter((permission) => permission !== 'audit.view'),
  'payments.create',
  'reminders.manage',
  'exports.create',
];

const CREDIT_OFFICER_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS.filter((permission) => permission !== 'audit.view'),
  'customers.manage',
  'applications.manage',
  'reminders.manage',
  'exports.create',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...PERMISSIONS,
].filter(
  (permission) =>
    permission !== 'settings.integrations' &&
    permission !== 'settings.business' &&
    permission !== 'users.manage',
) as readonly Permission[];

const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  VIEWER: VIEWER_PERMISSIONS,
  CASHIER: CASHIER_PERMISSIONS,
  CREDIT_OFFICER: CREDIT_OFFICER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
};

/** Memeriksa apakah role memiliki sebuah izin. */
export function hasPermission(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Memeriksa apakah role memiliki SEMUA izin yang diminta. */
export function hasAllPermissions(role: MemberRole | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

/** Memeriksa apakah role memiliki SALAH SATU izin yang diminta. */
export function hasAnyPermission(role: MemberRole | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/** True bila anggota dapat mencatat pembayaran. */
export function canCollectPayment(role: MemberRole | null | undefined): boolean {
  return hasPermission(role, 'payments.create');
}

/** True bila anggota hanya dapat membaca (Viewer/Auditor). */
export function isReadOnlyRole(role: MemberRole | null | undefined): boolean {
  return role === 'VIEWER';
}

/** Daftar role yang valid — dipakai untuk validasi input. */
export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}
