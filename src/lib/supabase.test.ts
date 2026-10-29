/**
 * supabase.test.ts — Penjaga agar klien tidak mengirim header global kustom.
 *
 * Preflight CORS untuk Edge Function dijawab oleh fungsi itu sendiri dengan
 * daftar header yang tetap: authorization, x-client-info, apikey, content-type.
 * Header global kustom ikut terkirim pada setiap permintaan, sehingga header
 * yang tidak ada di daftar itu membuat browser menolak preflight — permintaan
 * tidak pernah terkirim dan supabase-js hanya melaporkannya sebagai
 * "Failed to send a request to the Edge Function".
 *
 * Gejalanya menyesatkan karena PostgREST dan GoTrue tidak terpengaruh: keduanya
 * memantulkan header yang diminta, sehingga daftar data dan login tetap normal
 * dan hanya penambahan anggota yang gagal. Tes ini mengunci penyebabnya.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Header yang diizinkan fungsi Edge; apa pun di luar ini akan gagal preflight. */
const DIALLOWED = new Set(['authorization', 'x-client-info', 'apikey', 'content-type']);

const createClient = vi.fn((..._args: unknown[]) => ({ auth: {}, from: () => ({}) }));

vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

vi.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: 'https://contoh.supabase.co',
    supabaseAnonKey: 'kunci-anon',
    appName: 'KreditKu',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    locale: 'id-ID',
    isConfigured: true,
  },
}));

async function freshClient() {
  vi.resetModules();
  const module = await import('./supabase');
  module.getSupabaseClient();
  return createClient.mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;
}

describe('klien Supabase', () => {
  beforeEach(() => {
    createClient.mockClear();
  });

  it('tidak menyetel header global kustom', async () => {
    const options = await freshClient();
    expect(options).toBeDefined();
    expect(options!.global).toBeUndefined();
  });

  it('tidak mengirim header apa pun di luar daftar yang diizinkan Edge Function', async () => {
    const options = await freshClient();
    const headers = (options?.global as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    const tidakDiizinkan = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .filter((name) => !DIALLOWED.has(name));
    expect(tidakDiizinkan).toEqual([]);
  });

  it('tetap mengaktifkan persistensi sesi dan PKCE', async () => {
    const options = await freshClient();
    expect(options!.auth).toMatchObject({
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'pkce',
      storageKey: 'kreditku.auth',
    });
  });

  it('memakai kunci anon, bukan kunci lain', async () => {
    await freshClient();
    const call = createClient.mock.calls.at(-1);
    expect(call?.[0]).toBe('https://contoh.supabase.co');
    expect(call?.[1]).toBe('kunci-anon');
  });
});
