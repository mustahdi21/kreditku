/**
 * @vitest-environment node
 *
 * index.test.ts — Uji perilaku Edge Function customer-signup tanpa jaringan.
 *
 * Fungsi ini adalah satu-satunya pintu yang dapat membuat akun TANPA sesi, jadi
 * yang diuji paling ketat adalah batasnya: kode yang tidak sah tidak boleh
 * menghasilkan akun, dan akun yang gagal ditautkan harus dihapus kembali —
 * bukan ditinggalkan menggantung tanpa tertaut ke pelanggan mana pun.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, 'index.ts');

type Handler = (request: Request) => Promise<Response>;

let handler: Handler;

const INVITE_OK = {
  id: 'inv-1',
  customer_id: 'cust-1',
  organization_id: 'org-1',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  used_at: null,
  revoked_at: null,
  full_name: 'Pelanggan Satu',
};

interface StubOptions {
  invite?: Record<string, unknown> | null;
  inviteError?: { message: string } | null;
  customer?: { id: string; full_name: string; user_id: string | null } | null;
  createUser?: { data: { user: { id: string } } | null; error: { message: string } | null };
  redeem?: Record<string, unknown> | null;
  redeemError?: { message: string } | null;
  env?: Record<string, string>;
}

function loadFunction(options: StubOptions = {}) {
  const createUser = vi.fn(() =>
    Promise.resolve(options.createUser ?? { data: { user: { id: 'user-baru' } }, error: null }),
  );
  const deleteUser = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const redeem = vi.fn(() =>
    Promise.resolve({
      data: options.redeem ?? { status: 'BERHASIL', customer_name: 'Pelanggan Satu' },
      error: options.redeemError ?? null,
    }),
  );

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.limit = () => builder;
    const payload =
      table === 'customer_invites'
        ? { data: options.inviteError ? null : (options.invite ?? null), error: options.inviteError ?? null }
        : { data: options.customer ?? null, error: null };
    builder.maybeSingle = () => Promise.resolve(payload);
    builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(payload).then(onFulfilled);
    return builder;
  });

  const createClient = vi.fn(() => ({ from, rpc: redeem, auth: { admin: { createUser, deleteUser } } }));

  const raw = readFileSync(SOURCE, 'utf8');
  const patched = raw.replace(
    /import\s*\{[^}]*\}\s*from\s*'https:[^']+';\s*/,
    'const createClient = globalThis.__kreditkuCreateClient;\n',
  );
  if (patched === raw) throw new Error('impor jarak jauh tidak ditemukan — penambalan gagal');

  const { code } = transformSync(patched, { loader: 'ts', format: 'cjs', target: 'node20' });

  const env = options.env ?? {
    SUPABASE_URL: 'https://contoh.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  };

  const g = globalThis as unknown as Record<string, unknown>;
  g.__kreditkuCreateClient = createClient;
  g.Deno = {
    env: { get: (key: string) => env[key] },
    serve: (h: Handler) => {
      handler = h;
    },
  };

  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, () => undefined);

  return { createUser, deleteUser, redeem };
}

function post(body: unknown) {
  return handler(
    new Request('https://contoh.supabase.co/functions/v1/customer-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const DAFTAR = {
  code: 'ABCDEFGH',
  fullName: 'Pelanggan Satu',
  email: 'satu@contoh.id',
  password: 'RahasiaPelanggan2026',
};

describe('customer-signup — bentuk permintaan', () => {
  it('menolak metode selain POST dan menjawab preflight', async () => {
    loadFunction({ invite: INVITE_OK });
    const get = await handler(new Request('https://x/functions/v1/customer-signup', { method: 'GET' }));
    expect(get.status).toBe(405);
    const options = await handler(new Request('https://x/functions/v1/customer-signup', { method: 'OPTIONS' }));
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('menolak konfigurasi server yang tidak lengkap', async () => {
    loadFunction({ env: {} });
    expect((await post(DAFTAR)).status).toBe(500);
  });

  it('menolak kode kosong dan kode yang bentuknya salah', async () => {
    loadFunction({ invite: INVITE_OK });
    expect((await post({ ...DAFTAR, code: '' })).status).toBe(422);
    expect((await post({ ...DAFTAR, code: 'ABC' })).status).toBe(422);
    expect((await post({ ...DAFTAR, code: 'ABCD-EFG' })).status).toBe(422);
  });
});

describe('customer-signup — keadaan kode', () => {
  it('menolak kode yang tidak ditemukan', async () => {
    const { createUser } = loadFunction({ invite: null });
    const response = await post(DAFTAR);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/tidak ditemukan/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('menolak kode yang sudah dicabut', async () => {
    loadFunction({ invite: { ...INVITE_OK, revoked_at: new Date().toISOString() } });
    expect((await (await post(DAFTAR)).json()).message).toMatch(/dicabut/);
  });

  it('menolak kode yang sudah dipakai', async () => {
    loadFunction({ invite: { ...INVITE_OK, used_at: new Date().toISOString() } });
    expect((await (await post(DAFTAR)).json()).message).toMatch(/sudah pernah dipakai/);
  });

  it('menolak kode yang kedaluwarsa', async () => {
    loadFunction({ invite: { ...INVITE_OK, expires_at: new Date(Date.now() - 1000).toISOString() } });
    expect((await (await post(DAFTAR)).json()).message).toMatch(/kedaluwarsa/);
  });

  it('menolak bila pelanggannya sudah punya akun', async () => {
    loadFunction({
      invite: INVITE_OK,
      customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: 'user-lama' },
    });
    const response = await post(DAFTAR);
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/sudah memiliki akun/);
  });
});

describe('customer-signup — mode periksa kode', () => {
  beforeEach(() => loadFunction({ invite: INVITE_OK, customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null } }));

  it('mengembalikan nama pelanggan tanpa membuat akun', async () => {
    const response = await post({ code: 'ABCDEFGH' });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.mode).toBe('PERIKSA');
    expect(body.customer_name).toBe('Pelanggan Satu');
    expect(body.expires_at).toBeTruthy();
  });
});

describe('customer-signup — validasi data pendaftar', () => {
  beforeEach(() =>
    loadFunction({ invite: INVITE_OK, customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null } }),
  );

  it('menolak nama yang terlalu pendek', async () => {
    expect((await post({ ...DAFTAR, fullName: 'A' })).status).toBe(422);
  });

  it('menolak email yang tidak sah', async () => {
    expect((await post({ ...DAFTAR, email: 'bukan-email' })).status).toBe(422);
  });

  it('menolak password yang terlalu pendek', async () => {
    const response = await post({ ...DAFTAR, password: 'pendek1' });
    expect(response.status).toBe(422);
    expect((await response.json()).message).toMatch(/minimal 10 karakter/);
  });
});

describe('customer-signup — pembuatan akun', () => {
  beforeEach(() =>
    loadFunction({ invite: INVITE_OK, customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null } }),
  );

  it('membuat akun terkonfirmasi tanpa mengirim email', async () => {
    const { createUser, redeem } = loadFunction({
      invite: INVITE_OK,
      customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null },
    });
    const response = await post(DAFTAR);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('DAFTAR');
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0]![0]).toMatchObject({
      email: 'satu@contoh.id',
      password: 'RahasiaPelanggan2026',
      email_confirm: true,
    });
    expect(redeem).toHaveBeenCalledWith(
      'fn_redeem_customer_invite',
      expect.objectContaining({ p_code: 'ABCDEFGH', p_user_id: 'user-baru' }),
    );
  });

  it('tidak mengembalikan password pada balasan', async () => {
    loadFunction({ invite: INVITE_OK, customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null } });
    expect(await (await post(DAFTAR)).text()).not.toContain('RahasiaPelanggan2026');
  });

  it('mengenali semua varian pesan email ganda dari GoTrue', async () => {
    for (const message of [
      'User already registered',
      'A user with this email address has already been registered',
      'User already exists',
      'user_already_exists',
    ]) {
      loadFunction({
        invite: INVITE_OK,
        customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null },
        createUser: { data: null, error: { message } },
      });
      const response = await post(DAFTAR);
      const body = await response.json();
      expect(response.status, `pesan: ${message}`).toBe(409);
      expect(body.message, `pesan: ${message}`).toMatch(/sudah terdaftar/);
    }
  });

  it('MENGHAPUS akun yang gagal ditautkan, tidak meninggalkannya menggantung', async () => {
    const { deleteUser } = loadFunction({
      invite: INVITE_OK,
      customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null },
      redeem: { status: 'KODE_SUDAH_DIPAKAI' },
    });
    const response = await post(DAFTAR);
    expect(response.status).toBe(409);
    expect(deleteUser).toHaveBeenCalledWith('user-baru');
    expect((await response.json()).message).toMatch(/dipakai orang lain/);
  });

  it('menghapus akun juga bila penautan gagal karena galat server', async () => {
    const { deleteUser } = loadFunction({
      invite: INVITE_OK,
      customer: { id: 'cust-1', full_name: 'Pelanggan Satu', user_id: null },
      redeem: null,
      redeemError: { message: 'koneksi terputus' },
    });
    const response = await post(DAFTAR);
    expect(response.status).toBe(409);
    expect(deleteUser).toHaveBeenCalledWith('user-baru');
  });
});
