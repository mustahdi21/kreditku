/**
 * @vitest-environment node
 *
 * index.test.ts — Uji perilaku Edge Function qris-confirm tanpa jaringan.
 *
 * Fungsi ini menerima permintaan TANPA sesi dan MEMUTUSKAN apakah uang masuk
 * dicatat. Dua hal karena itu diuji paling ketat:
 *
 *   1. Penjagaan secret. Bila penjaga ini bocor, siapa pun dapat mengirim teks
 *      notifikasi palsu dan menandai cicilan orang lain sebagai lunas.
 *   2. Penolakan saat ambigu. Nominal yang sama pada dua tagihan tidak boleh
 *      dicatat otomatis, karena berarti memilih kontrak orang lain.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, 'index.ts');

const SECRET = 'rahasia-webhook-yang-panjang-dan-acak';
const MARKER = 'pembayaran via qris statis diterima';
const TEKS_VALID = 'Pembayaran via QRIS statis diterima Rp550.000 dari BUDI SANTOSO';

type Handler = (request: Request) => Promise<Response>;

let handler: Handler;
let extractAmount: (text: string) => number | null;

interface StubOptions {
  config?: { organization_id: string | null; payload?: string | null; notif_marker?: string | null } | null;
  configError?: { message: string } | null;
  existingConfirmation?: { id: string; outcome: string } | null;
  candidates?: Array<Record<string, unknown>>;
  findError?: { message: string } | null;
  confirmResult?: Record<string, unknown> | null;
  confirmError?: { message: string } | null;
  secret?: string;
}

function loadFunction(options: StubOptions = {}) {
  const logged: Array<Record<string, unknown>> = [];
  const confirmCalls: Array<Record<string, unknown>> = [];

  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'fn_qris_config') {
      return Promise.resolve({
        data: options.configError ? null : (options.config ?? { organization_id: 'org-1', notif_marker: null }),
        error: options.configError ?? null,
      });
    }
    if (name === 'fn_find_open_qris_requests') {
      return Promise.resolve({
        data: options.findError ? null : (options.candidates ?? []),
        error: options.findError ?? null,
      });
    }
    if (name === 'fn_log_qris_confirmation') {
      logged.push(args ?? {});
      return Promise.resolve({ data: 'log-1', error: null });
    }
    if (name === 'rpc_confirm_qris_payment') {
      confirmCalls.push(args ?? {});
      return Promise.resolve({
        data: options.confirmResult ?? { status: 'DIBAYAR', receipt_number: 'KWT-1' },
        error: options.confirmError ?? null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: options.existingConfirmation ?? null, error: null });
    builder.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve({ data: options.existingConfirmation ?? null, error: null }).then(onFulfilled);
    return builder;
  });

  const createClient = vi.fn(() => ({ rpc, from }));

  const raw = readFileSync(SOURCE, 'utf8');
  const patched = raw.replace(
    /import\s*\{[^}]*\}\s*from\s*'https:[^']+';\s*/,
    'const createClient = globalThis.__kreditkuCreateClient;\n',
  );
  if (patched === raw) throw new Error('impor jarak jauh tidak ditemukan — penambalan gagal');

  const { code } = transformSync(patched, { loader: 'ts', format: 'cjs', target: 'node20' });

  const g = globalThis as unknown as Record<string, unknown>;
  g.__kreditkuCreateClient = createClient;
  // crypto.subtle sudah tersedia di Node dan bersifat hanya-baca; tidak perlu
  // dan tidak boleh ditimpa.
  g.Deno = {
    env: {
      get: (key: string) =>
        ({
          SUPABASE_URL: 'https://contoh.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
          QRIS_WEBHOOK_SECRET: options.secret === undefined ? SECRET : options.secret,
        })[key],
    },
    serve: (h: Handler) => {
      handler = h;
    },
  };

  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', code)(module, module.exports, () => undefined);
  extractAmount = module.exports.extractAmount as (text: string) => number | null;

  return { rpc, logged, confirmCalls };
}

function post(body: unknown, headers: Record<string, string> = { 'x-webhook-secret': SECRET }, url = 'https://contoh.supabase.co/functions/v1/qris-confirm') {
  return handler(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe('qris-confirm — penjagaan akses', () => {
  it('menolak permintaan tanpa secret', async () => {
    loadFunction();
    const response = await post({ notification: TEKS_VALID }, {});
    expect(response.status).toBe(401);
  });

  it('menolak secret yang salah, termasuk yang panjangnya berbeda', async () => {
    loadFunction();
    for (const salah of ['salah', SECRET.slice(0, -1), `${SECRET}x`, '']) {
      const response = await post({ notification: TEKS_VALID }, { 'x-webhook-secret': salah });
      expect(response.status, `secret: ${salah}`).toBe(401);
    }
  });

  it('menerima secret yang sama panjang tetapi berbeda isi', async () => {
    loadFunction();
    const hampir = `${SECRET.slice(0, -1)}Z`;
    expect((await post({ notification: TEKS_VALID }, { 'x-webhook-secret': hampir })).status).toBe(401);
  });

  it('menolak bila secret server belum diatur', async () => {
    loadFunction({ secret: '' });
    const response = await post({ notification: TEKS_VALID }, {});
    expect(response.status).toBe(500);
  });

  it('menerima secret lewat parameter URL dan lewat body', async () => {
    loadFunction({ candidates: [] });
    const viaUrl = await post({ notification: TEKS_VALID }, {}, `https://contoh.supabase.co/functions/v1/qris-confirm?secret=${SECRET}`);
    expect(viaUrl.status).toBe(200);
    const viaBody = await post({ notification: TEKS_VALID, secret: SECRET }, {});
    expect(viaBody.status).toBe(200);
  });

  it('menolak metode selain POST dan menjawab preflight', async () => {
    loadFunction();
    const get = await handler(new Request('https://contoh.supabase.co/functions/v1/qris-confirm', { method: 'GET' }));
    expect(get.status).toBe(405);
    const options = await handler(
      new Request('https://contoh.supabase.co/functions/v1/qris-confirm', { method: 'OPTIONS' }),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('qris-confirm — pembacaan nominal', () => {
  beforeEach(() => loadFunction());

  it('membaca nominal dengan berbagai penulisan', () => {
    expect(extractAmount('Pembayaran via QRIS statis diterima Rp550.000')).toBe(550000);
    expect(extractAmount('IDR 1.250.000,00 masuk')).toBe(1250000);
    expect(extractAmount('Rp 550.000 dari BUDI')).toBe(550000);
    expect(extractAmount('Anda menerima Rp75.123')).toBe(75123);
    expect(extractAmount('rp10000')).toBe(10000);
  });

  it('mengembalikan null bila nominal tidak ada', () => {
    expect(extractAmount('Pembayaran via QRIS statis diterima')).toBeNull();
    expect(extractAmount('Nominal: lima ratus ribu')).toBeNull();
    expect(extractAmount('Rp')).toBeNull();
  });
});

describe('qris-confirm — penyaring isi', () => {
  it('menolak teks kosong', async () => {
    loadFunction();
    const response = await post({ notification: '   ' });
    expect(response.status).toBe(400);
  });

  it('menerima teks pada field notification, text, maupun message', async () => {
    loadFunction({ candidates: [] });
    expect((await post({ text: TEKS_VALID })).status).toBe(200);
    expect((await post({ message: TEKS_VALID })).status).toBe(200);
  });

  it('menolak teks yang tidak memuat penanda, dan mencatatnya', async () => {
    const { logged } = loadFunction();
    const response = await post({ notification: 'Transfer masuk Rp550.000 dari BUDI' });
    const body = await response.json();
    expect(body.outcome).toBe('BUKAN_QRIS');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.p_outcome).toBe('BUKAN_QRIS');
  });

  it('memakai penanda dari pengaturan bila ada', async () => {
    loadFunction({ config: { organization_id: 'org-1', notif_marker: 'qris masuk' } });
    const diterima = await post({ notification: 'QRIS masuk Rp550.000' });
    expect((await diterima.json()).outcome).not.toBe('BUKAN_QRIS');
    const ditolak = await post({ notification: TEKS_VALID });
    expect((await ditolak.json()).outcome).toBe('BUKAN_QRIS');
  });

  it('melaporkan nominal yang tidak terbaca', async () => {
    const { logged } = loadFunction();
    const response = await post({ notification: 'Pembayaran via QRIS statis diterima' });
    const body = await response.json();
    expect(body.outcome).toBe('NOMINAL_TIDAK_TERBACA');
    expect(logged[0]!.p_outcome).toBe('NOMINAL_TIDAK_TERBACA');
  });

  it('menolak notifikasi yang sudah pernah diproses', async () => {
    const { confirmCalls, logged } = loadFunction({
      existingConfirmation: { id: 'log-lama', outcome: 'DIBAYAR' },
      candidates: [{ request_id: 'r-1', reference: 'QR-1', contract_number: 'K-1' }],
    });
    const response = await post({ notification: TEKS_VALID });
    const body = await response.json();
    expect(body.outcome).toBe('DUPLIKAT');
    expect(confirmCalls).toHaveLength(0);
    expect(logged).toHaveLength(0);
  });
});

describe('qris-confirm — pencocokan tagihan', () => {
  it('melaporkan bila tidak ada tagihan yang cocok', async () => {
    const { confirmCalls, logged } = loadFunction({ candidates: [] });
    const response = await post({ notification: TEKS_VALID });
    const body = await response.json();
    expect(body.outcome).toBe('TIDAK_COCOK');
    expect(confirmCalls).toHaveLength(0);
    expect(logged[0]!.p_outcome).toBe('TIDAK_COCOK');
  });

  it('TIDAK mencatat apa pun bila kandidat lebih dari satu', async () => {
    const { confirmCalls, logged } = loadFunction({
      candidates: [
        { request_id: 'r-1', reference: 'QR-1', contract_number: 'K-1' },
        { request_id: 'r-2', reference: 'QR-2', contract_number: 'K-2' },
      ],
    });
    const response = await post({ notification: TEKS_VALID });
    const body = await response.json();
    expect(body.outcome).toBe('AMBIGU');
    expect(confirmCalls).toHaveLength(0);
    expect(body.kandidat).toHaveLength(2);
    expect(logged[0]!.p_outcome).toBe('AMBIGU');
  });

  it('mencatat pembayaran bila kandidatnya tepat satu', async () => {
    const { confirmCalls, logged } = loadFunction({
      candidates: [{ request_id: 'r-1', reference: 'QR-1', contract_number: 'K-1' }],
    });
    const response = await post({ notification: TEKS_VALID });
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toBe('DIBAYAR');
    expect(body.receipt_number).toBe('KWT-1');
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]).toMatchObject({ p_request_id: 'r-1', p_confirmed_via: 'MACRODROID' });
    expect(logged[0]!.p_outcome).toBe('DIBAYAR');
  });

  it('tidak melaporkan berhasil bila pencatatan meminta tinjauan', async () => {
    const { logged } = loadFunction({
      candidates: [{ request_id: 'r-1', reference: 'QR-1', contract_number: 'K-1' }],
      confirmResult: { status: 'PERLU_TINJAUAN', alasan: 'permintaan sudah kedaluwarsa' },
    });
    const response = await post({ notification: TEKS_VALID });
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.outcome).toBe('PERLU_TINJAUAN');
    expect(body.msg).toMatch(/kedaluwarsa/);
    expect(logged[0]!.p_outcome).toBe('PERLU_TINJAUAN');
  });

  it('melaporkan bila pencatatan gagal karena galat server', async () => {
    const { logged } = loadFunction({
      candidates: [{ request_id: 'r-1', reference: 'QR-1', contract_number: 'K-1' }],
      confirmError: { message: 'idempotency bentrok' },
    });
    const response = await post({ notification: TEKS_VALID });
    expect(response.status).toBe(500);
    expect(logged[0]!.p_outcome).toBe('GAGAL_CATAT');
  });

  it('melaporkan bila konfigurasi gagal dibaca', async () => {
    const { confirmCalls } = loadFunction({ configError: { message: 'tabel tidak ada' } });
    const response = await post({ notification: TEKS_VALID });
    expect(response.status).toBe(500);
    expect(confirmCalls).toHaveLength(0);
  });

  it('menyertakan organisasi dari konfigurasi pada catatan', async () => {
    const { logged } = loadFunction({ candidates: [] });
    await post({ notification: TEKS_VALID });
    expect(logged[0]!.p_organization_id).toBe('org-1');
    expect(logged[0]!.p_content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
