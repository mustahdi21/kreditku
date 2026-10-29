/**
 * @vitest-environment node
 *
 * index.test.ts — Uji perilaku Edge Function invite-user tanpa jaringan.
 *
 * MENGAPA BERKAS INI ADA DI SINI
 * ------------------------------
 * Fungsi ini hanya berjalan di runtime Deno milik Supabase, dan berkasnya
 * mengimpor modul dari esm.sh sehingga tidak dapat dijalankan apa adanya oleh
 * Node. Karena itu sumbernya diambil, impor jaraknya diganti dengan variabel
 * global, lalu dievaluasi dengan esbuild. Dengan begitu cabang yang menentukan
 * keamanan — siapa yang boleh menambah anggota, akun mana yang passwordnya
 * boleh dibuat, dan akun mana yang TIDAK boleh disentuh — dapat diuji di sini
 * alih-alih dipercaya begitu saja.
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

interface FakeUser {
  id: string;
  memberships: Array<{ organization_id: string; role: string; is_active: boolean }>;
}

interface CreateUserResult {
  data: { user: { id: string } } | null;
  error: { message: string } | null;
}

interface AdminStub {
  createUser: ReturnType<typeof vi.fn>;
  inviteUserByEmail: ReturnType<typeof vi.fn>;
  profileLookup: { data: { id: string } | null } | null;
}

/** Objek berantai yang juga dapat di-await, meniru PostgREST client supabase-js. */
function chainable(resolved: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'order', 'limit', 'is']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(resolved);
  builder.single = () => Promise.resolve(resolved);
  builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolved).then(onFulfilled);
  return builder;
}

/**
 * Tiruan pembacaan daftar anggota yang BENAR-BENAR menerapkan filter `.eq()`.
 *
 * Tanpa ini, uji "keanggotaan tidak aktif" akan lolos secara palsu: fungsi
 * mengandalkan filter `is_active = true` pada query, jadi tiruan yang mengabaikan
 * filter justru mengirimkan baris tidak aktif dan mengubah arti uji.
 */
function membershipChain(rows: ReadonlyArray<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.order = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return builder;
  };
  builder.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve({
      data: rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v)),
      error: null,
    }).then(onFulfilled);
  return builder;
}

function loadFunction(options: {
  user?: FakeUser | null;
  userError?: { message: string } | null;
  createUser?: CreateUserResult;
  invite?: { data: { user: { id: string } } | null; error: { message: string } | null };
  profileLookup?: { data: { id: string } | null } | null;
  registerError?: { message: string } | null;
}) {
  const admin: AdminStub = {
    createUser: vi.fn(() => Promise.resolve(options.createUser ?? { data: { user: { id: 'new-1' } }, error: null })),
    inviteUserByEmail: vi.fn(() =>
      Promise.resolve(options.invite ?? { data: { user: { id: 'inv-1' } }, error: null }),
    ),
    profileLookup: options.profileLookup ?? null,
  };

  const registerRpc = vi.fn(() =>
    Promise.resolve(
      options.registerError ? { data: null, error: options.registerError } : { data: { member_id: 'm-1' }, error: null },
    ),
  );

  const caller = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: options.user ? { id: options.user.id } : null },
          error: options.userError ?? null,
        }),
    },
    from: () =>
      membershipChain(
        (options.user?.memberships ?? []).map((row) => ({ ...row, user_id: options.user!.id })),
      ),
    rpc: registerRpc,
  };

  let callIndex = 0;
  const createClient = vi.fn(() => {
    callIndex += 1;
    if (callIndex === 1) return caller;
    return {
      auth: { admin: { createUser: admin.createUser, inviteUserByEmail: admin.inviteUserByEmail } },
      from: () => chainable(admin.profileLookup ?? { data: null }),
    };
  });

  const raw = readFileSync(SOURCE, 'utf8');
  const patched = raw.replace(
    /import\s*\{[^}]*\}\s*from\s*'https:[^']+';\s*/,
    'const createClient = globalThis.__kreditkuCreateClient;\n',
  );
  if (patched === raw) throw new Error('impor jarak jauh tidak ditemukan — penambalan gagal');

  const { code } = transformSync(patched, { loader: 'ts', format: 'cjs', target: 'node20' });

  const g = globalThis as unknown as Record<string, unknown>;
  g.__kreditkuCreateClient = createClient;
  g.Deno = {
    env: {
      get: (key: string) =>
        ({
          SUPABASE_URL: 'https://contoh.supabase.co',
          SUPABASE_ANON_KEY: 'anon',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
        })[key],
    },
    serve: (h: Handler) => {
      handler = h;
    },
  };

  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, () => undefined);

  return { admin, registerRpc, createClient };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new Request('https://contoh.supabase.co/functions/v1/invite-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const AUTHORIZED = { Authorization: 'Bearer token-super-admin' };
const SUPER_ADMIN: FakeUser = {
  id: 'u-1',
  memberships: [{ organization_id: 'o-1', role: 'SUPER_ADMIN', is_active: true }],
};

const dasar = { email: 'staf@kreditku.id', fullName: 'Siti Rahmawati', role: 'CASHIER' };

describe('invite-user — penjagaan akses', () => {
  beforeEach(() => loadFunction({ user: SUPER_ADMIN }));

  it('menolak permintaan tanpa token sesi', async () => {
    const response = await post(dasar);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/token sesi/i);
  });

  it('menolak sesi yang tidak valid', async () => {
    loadFunction({ user: null, userError: { message: 'invalid' } });
    const response = await post(dasar, AUTHORIZED);
    expect(response.status).toBe(401);
  });

  it('menolak anggota tanpa organisasi', async () => {
    loadFunction({ user: { id: 'u-2', memberships: [] } });
    const response = await post(dasar, AUTHORIZED);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/belum terhubung ke organisasi/i);
  });

  it('menolak pengguna yang bukan Super Admin', async () => {
    loadFunction({
      user: { id: 'u-3', memberships: [{ organization_id: 'o-1', role: 'ADMIN', is_active: true }] },
    });
    const response = await post(dasar, AUTHORIZED);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/Hanya Super Admin/i);
  });

  it('mengabaikan keanggotaan yang tidak aktif', async () => {
    loadFunction({
      user: { id: 'u-4', memberships: [{ organization_id: 'o-1', role: 'SUPER_ADMIN', is_active: false }] },
    });
    const response = await post(dasar, AUTHORIZED);
    expect(response.status).toBe(403);
  });
});

describe('invite-user — validasi masukan', () => {
  beforeEach(() => loadFunction({ user: SUPER_ADMIN }));

  it('menolak email yang tidak sah', async () => {
    expect((await post({ ...dasar, email: 'bukan-email' }, AUTHORIZED)).status).toBe(422);
  });

  it('menolak nama yang terlalu pendek', async () => {
    expect((await post({ ...dasar, fullName: 'A' }, AUTHORIZED)).status).toBe(422);
  });

  it('menolak role yang tidak dikenal', async () => {
    expect((await post({ ...dasar, role: 'PEMILIK' }, AUTHORIZED)).status).toBe(422);
  });

  it('menolak password awal yang terlalu pendek', async () => {
    const response = await post({ ...dasar, initialPassword: 'pendek1' }, AUTHORIZED);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/minimal 10 karakter/i);
  });
});

describe('invite-user — membuat akun dengan password awal', () => {
  it('membuat akun terkonfirmasi tanpa mengirim email undangan', async () => {
    const { admin } = loadFunction({ user: SUPER_ADMIN });

    const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe('created');
    expect(admin.createUser).toHaveBeenCalledTimes(1);
    expect(admin.createUser.mock.calls[0]![0]).toMatchObject({
      email: 'staf@kreditku.id',
      password: 'RahasiaStaf2026',
      email_confirm: true,
    });
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('tidak mengembalikan password pada balasan', async () => {
    loadFunction({ user: SUPER_ADMIN });
    const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    expect(await response.text()).not.toContain('RahasiaStaf2026');
  });

  it('mendaftarkan akun baru sebagai anggota dengan role yang diminta', async () => {
    const { registerRpc } = loadFunction({ user: SUPER_ADMIN });
    await post({ ...dasar, role: 'CREDIT_OFFICER', initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    expect(registerRpc).toHaveBeenCalledWith(
      'rpc_register_member',
      expect.objectContaining({ p_user_id: 'new-1', p_role: 'CREDIT_OFFICER', p_email: 'staf@kreditku.id' }),
    );
  });

  it('TIDAK mengubah password akun yang sudah ada, hanya mendaftarkannya', async () => {
    const { admin, registerRpc } = loadFunction({
      user: SUPER_ADMIN,
      createUser: {
        data: null,
        error: { message: 'A user with this email address has already been registered' },
      },
      profileLookup: { data: { id: 'lama-9' } },
    });

    const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe('existed');
    expect(body.note).toMatch(/Password TIDAK diubah/i);
    expect(registerRpc).toHaveBeenCalledWith(
      'rpc_register_member',
      expect.objectContaining({ p_user_id: 'lama-9' }),
    );
  });

  it('mengenali varian pesan akun ganda lain dari GoTrue', async () => {
    for (const message of [
      'User already registered',
      'A user with this email address has already been registered',
      'User already exists',
      'user_already_exists',
    ]) {
      const { admin, registerRpc } = loadFunction({
        user: SUPER_ADMIN,
        createUser: { data: null, error: { message } },
        profileLookup: { data: { id: 'ada-1' } },
      });
      const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
      const body = await response.json();
      expect(response.status, `pesan: ${message}`).toBe(200);
      expect(body.outcome, `pesan: ${message}`).toBe('existed');
      expect(registerRpc).toHaveBeenCalled();
    }
  });

  it('melaporkan galat pembuatan akun selain "sudah terdaftar"', async () => {
    loadFunction({
      user: SUPER_ADMIN,
      createUser: { data: null, error: { message: 'Password should contain at least one character of each' } },
    });
    const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Gagal membuat akun/);
  });
});

describe('invite-user — jalur undangan email tetap utuh', () => {
  it('memakai inviteUserByEmail bila password awal tidak diisi', async () => {
    const { admin } = loadFunction({ user: SUPER_ADMIN });

    const response = await post(dasar, AUTHORIZED);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe('invited');
    expect(admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(body.note).toMatch(/Email undangan/i);
  });

  it('memperlakukan password awal kosong seperti tidak diisi', async () => {
    const { admin } = loadFunction({ user: SUPER_ADMIN });
    const response = await post({ ...dasar, initialPassword: '' }, AUTHORIZED);
    expect((await response.json()).outcome).toBe('invited');
    expect(admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('melaporkan galat pengiriman undangan', async () => {
    loadFunction({
      user: SUPER_ADMIN,
      invite: { data: null, error: { message: 'Email rate limit exceeded' } },
    });
    const response = await post(dasar, AUTHORIZED);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Undangan gagal dikirim/);
  });
});

describe('invite-user — kegagalan pendaftaran anggota', () => {
  it('meneruskan pesan dari fungsi basis data', async () => {
    loadFunction({ user: SUPER_ADMIN, registerError: { message: 'Role tidak dikenal.' } });
    const response = await post({ ...dasar, initialPassword: 'RahasiaStaf2026' }, AUTHORIZED);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Gagal menambahkan anggota: Role tidak dikenal/);
  });
});
