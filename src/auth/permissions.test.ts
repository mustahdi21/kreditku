/**
 * permissions.test.ts — Memastikan matriks hak akses sesuai kebijakan yang
 * disepakati. Matriks ini hanya mengatur tampilan; penegakan sebenarnya ada
 * di database, tetapi kesalahan di sini akan menyembunyikan/menampilkan tombol
 * secara keliru, sehingga tetap diuji.
 */

import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/core/types';
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isMemberRole,
  isReadOnlyRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
} from '@/auth/permissions';

describe('permissions — kelengkapan matriks', () => {
  it('mendefinisikan izin untuk seluruh role', () => {
    for (const role of MEMBER_ROLES) {
      expect(ROLE_PERMISSIONS[role].length, `role ${role}`).toBeGreaterThan(0);
    }
  });

  it('hanya memakai izin yang terdaftar', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of MEMBER_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} → ${permission}`).toBe(true);
      }
    }
  });

  it('Super Admin memiliki seluruh izin', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('SUPER_ADMIN', permission), permission).toBe(true);
    }
  });
});

describe('permissions — Viewer / Auditor', () => {
  it('hanya dapat membaca', () => {
    expect(hasPermission('VIEWER', 'customers.view')).toBe(true);
    expect(hasPermission('VIEWER', 'contracts.view')).toBe(true);
    expect(hasPermission('VIEWER', 'audit.view')).toBe(true);
    expect(isReadOnlyRole('VIEWER')).toBe(true);
  });

  it('tidak dapat mengubah data atau mengekspor', () => {
    const forbidden: Permission[] = [
      'customers.manage',
      'applications.manage',
      'applications.decide',
      'payments.create',
      'payments.reverse',
      'penalties.waive',
      'settings.manage',
      'users.manage',
      'exports.create',
    ];
    for (const permission of forbidden) {
      expect(hasPermission('VIEWER', permission), permission).toBe(false);
    }
  });
});

describe('permissions — Kasir', () => {
  it('dapat mencatat pembayaran', () => {
    expect(hasPermission('CASHIER', 'payments.create')).toBe(true);
    expect(hasPermission('CASHIER', 'payments.view')).toBe(true);
    expect(hasPermission('CASHIER', 'installments.view')).toBe(true);
  });

  it('tidak dapat membatalkan pembayaran atau mengelola kredit', () => {
    expect(hasPermission('CASHIER', 'payments.reverse')).toBe(false);
    expect(hasPermission('CASHIER', 'customers.manage')).toBe(false);
    expect(hasPermission('CASHIER', 'applications.decide')).toBe(false);
    expect(hasPermission('CASHIER', 'contracts.cancel')).toBe(false);
    expect(hasPermission('CASHIER', 'audit.view')).toBe(false);
  });
});

describe('permissions — Petugas Kredit', () => {
  it('dapat mengelola pelanggan dan pengajuan', () => {
    expect(hasPermission('CREDIT_OFFICER', 'customers.manage')).toBe(true);
    expect(hasPermission('CREDIT_OFFICER', 'applications.manage')).toBe(true);
  });

  it('tidak dapat menyetujui pengajuan atau mencatat pembayaran', () => {
    expect(hasPermission('CREDIT_OFFICER', 'applications.decide')).toBe(false);
    expect(hasPermission('CREDIT_OFFICER', 'payments.create')).toBe(false);
    expect(hasPermission('CREDIT_OFFICER', 'penalties.waive')).toBe(false);
  });
});

describe('permissions — Admin', () => {
  it('dapat menjalankan operasional penuh', () => {
    expect(hasPermission('ADMIN', 'applications.decide')).toBe(true);
    expect(hasPermission('ADMIN', 'payments.reverse')).toBe(true);
    expect(hasPermission('ADMIN', 'penalties.waive')).toBe(true);
    expect(hasPermission('ADMIN', 'contracts.amend')).toBe(true);
    expect(hasPermission('ADMIN', 'settings.manage')).toBe(true);
    expect(hasPermission('ADMIN', 'audit.view')).toBe(true);
  });

  it('tidak dapat mengubah konfigurasi sensitif Super Admin', () => {
    expect(hasPermission('ADMIN', 'settings.integrations')).toBe(false);
    expect(hasPermission('ADMIN', 'settings.business')).toBe(false);
    expect(hasPermission('ADMIN', 'users.manage')).toBe(false);
  });
});

describe('permissions — utilitas', () => {
  it('memeriksa kombinasi izin', () => {
    expect(hasAllPermissions('ADMIN', ['customers.manage', 'payments.create'])).toBe(true);
    expect(hasAllPermissions('CASHIER', ['payments.create', 'customers.manage'])).toBe(false);
    expect(hasAnyPermission('CASHIER', ['customers.manage', 'payments.create'])).toBe(true);
    expect(hasAnyPermission(null, ['payments.create'])).toBe(false);
  });

  it('memvalidasi nilai role', () => {
    expect(isMemberRole('SUPER_ADMIN')).toBe(true);
    expect(isMemberRole('CASHIER')).toBe(true);
    expect(isMemberRole('ROOT')).toBe(false);
    expect(isMemberRole(null)).toBe(false);
  });

  it('menandai role yang hanya membaca', () => {
    expect(isReadOnlyRole('VIEWER')).toBe(true);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'CASHIER'] as const) {
      expect(isReadOnlyRole(role), role).toBe(false);
    }
  });
});
