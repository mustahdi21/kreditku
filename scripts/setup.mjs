#!/usr/bin/env node
/**
 * setup.mjs — Wizard konfigurasi KreditKu.
 *
 * Memandu langkah yang dapat diotomatisasi dan berhenti dengan instruksi jelas
 * pada langkah yang memerlukan otorisasi pemilik akun (pembuatan proyek Supabase,
 * login GitHub, dan sejenisnya).
 *
 * ATURAN KEAMANAN
 * ---------------
 *   * Skrip TIDAK PERNAH meminta password, token pribadi, atau service role key
 *     melalui percakapan/chat. Nilai rahasia hanya diketik langsung pada terminal
 *     lokal dan disimpan pada berkas .env (izin 0600) atau variabel lingkungan.
 *   * Skrip tidak pernah menampilkan nilai rahasia pada layar maupun log.
 *
 * Jalankan: npm run setup
 */

import { existsSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ask,
  askHidden,
  closePrompts,
  color,
  COLOR,
  confirm,
  fail,
  hasCommand,
  heading,
  info,
  isFilled,
  parseEnvFile,
  redact,
  run,
  step,
  success,
  updateEnvFile,
  warn,
} from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = resolve(ROOT, '.env');
const ENV_EXAMPLE = resolve(ROOT, '.env.example');

const state = {
  supabaseConfigured: false,
  databaseReachable: false,
  migrationsApplied: false,
  rlsVerified: false,
  adminBootstrapped: false,
  repoReady: false,
};

/* -------------------------------------------------------------------------- */

function checkPrerequisites() {
  heading('1. Pemeriksaan prasyarat');

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) success(`Node.js v${process.versions.node}`);
  else {
    fail(`Node.js v${process.versions.node} terlalu lama (butuh v20+).`);
    process.exitCode = 1;
    return false;
  }

  if (hasCommand('git')) success('Git tersedia');
  else warn('Git tidak tersedia — langkah deployment GitHub akan dilewati.');

  if (hasCommand('gh')) info('GitHub CLI (gh) tersedia: langkah otomatis deployment dapat dilakukan.');
  else info('GitHub CLI (gh) tidak tersedia: gunakan antarmuka web GitHub untuk deployment.');

  if (hasCommand('supabase')) info('Supabase CLI tersedia: migrasi dapat dijalankan dengan `supabase db push`.');
  else info('Supabase CLI tidak tersedia: migrasi akan dijalankan melalui koneksi PostgreSQL langsung atau SQL Editor.');

  if (!existsSync(resolve(ROOT, 'node_modules'))) {
    warn('Dependencies belum terpasang.');
    info('Jalankan `npm install` terlebih dahulu, lalu ulangi `npm run setup`.');
    return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */

async function configureEnv() {
  heading('2. Konfigurasi Supabase');

  const env = parseEnvFile(ENV_PATH);
  const hasUrl = isFilled(env.VITE_SUPABASE_URL);
  const hasKey = isFilled(env.VITE_SUPABASE_ANON_KEY);

  if (hasUrl && hasKey) {
    success('Berkas .env sudah berisi URL dan kunci publik Supabase.');
    if (!(await confirm('Perbarui nilainya?', false))) return;
  } else {
    if (!existsSync(ENV_PATH) && existsSync(ENV_EXAMPLE)) {
      copyFileSync(ENV_EXAMPLE, ENV_PATH);
      success('Berkas .env dibuat dari .env.example.');
    }
    info('Buka dashboard Supabase → Project Settings → API untuk menyalin nilainya.');
    info('Kunci yang diperlukan hanya "Project URL" dan "anon/publishable key".');
    info('JANGAN memasukkan service_role key pada variabel VITE_*.');
  }

  const url = await ask('Project URL Supabase (https://xxxx.supabase.co)', {
    defaultValue: isFilled(env.VITE_SUPABASE_URL) ? env.VITE_SUPABASE_URL : '',
  });
  const anonKey = await askHidden('anon/publishable key (input tersembunyi)');

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    warn('Format URL tidak mengikuti pola https://<project>.supabase.co. Lanjutkan hanya bila Anda yakin (mis. self-hosted).');
  }

  const payloadPart = anonKey.split('.')[1];
  let role = null;
  try {
    role = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8')).role ?? null;
  } catch {
    role = null;
  }
  if (role === 'service_role') {
    fail('Kunci yang Anda masukkan adalah service_role key.');
    fail('Kunci ini melewati seluruh RLS dan tidak boleh dipakai pada frontend. Proses dihentikan.');
    process.exitCode = 1;
    return;
  }
  if (role && role !== 'anon' && role !== 'authenticated') {
    warn(`Role pada kunci: "${role}". Pastikan ini kunci publik (anon/publishable).`);
  }

  updateEnvFile(ENV_PATH, { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey });
  success(`Konfigurasi publik disimpan (kunci: ${redact(anonKey)}).`);
  state.supabaseConfigured = true;

  // Kunci server-side bersifat opsional tetapi diperlukan untuk migrasi otomatis.
  heading('3. Kredensial server (opsional, tetap lokal)');
  info('Dipakai HANYA oleh skrip lokal/CI untuk menjalankan migrasi dan bootstrap.');
  info('Nilai ini tidak pernah dikirim ke browser dan tidak boleh di-commit.');
  if (await confirm('Simpan kredensial server pada berkas .env sekarang?', false)) {
    step('SUPABASE_DB_URL: connection string Postgres (Project Settings → Database → Connection string → URI).');
    const dbUrl = await askHidden('SUPABASE_DB_URL (kosongkan untuk melewati)');
    const serviceKey = await askHidden('SUPABASE_SERVICE_ROLE_KEY (kosongkan untuk melewati)');
    const patch = {};
    if (isFilled(dbUrl)) patch.SUPABASE_DB_URL = dbUrl;
    if (isFilled(serviceKey)) patch.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    if (Object.keys(patch).length > 0) {
      updateEnvFile(ENV_PATH, patch);
      success(`Kredensial server disimpan untuk: ${Object.keys(patch).join(', ')}.`);
    } else {
      warn('Tidak ada kredensial server yang disimpan.');
    }
  }
}

/* -------------------------------------------------------------------------- */

async function testConnection() {
  heading('4. Uji koneksi Supabase');
  const env = parseEnvFile(ENV_PATH);
  if (!isFilled(env.VITE_SUPABASE_URL)) {
    warn('URL Supabase belum diisi. Langkah ini dilewati.');
    return;
  }

  step(`Menghubungi ${env.VITE_SUPABASE_URL}/auth/v1/health …`);
  try {
    const response = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY ?? '' },
    });
    if (response.ok) {
      success('Supabase Auth merespons dengan baik.');
      state.databaseReachable = true;
    } else {
      warn(`Supabase merespons status ${response.status}. Periksa URL dan kunci publik.`);
    }
  } catch (error) {
    fail(`Koneksi gagal: ${error?.message ?? error}`);
    info('Periksa koneksi internet, URL proyek, dan status proyek Supabase (mungkin sedang dijeda).');
  }
}

/* -------------------------------------------------------------------------- */

async function applyMigrations() {
  heading('5. Migrasi database');

  const env = parseEnvFile(ENV_PATH);
  const dbUrl = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  info('Berkas migrasi berada pada folder supabase/migrations dan dijalankan berurutan.');
  info('Seluruh migrasi bersifat idempoten (aman dijalankan ulang).');

  if (!isFilled(dbUrl)) {
    warn('SUPABASE_DB_URL belum tersedia — migrasi tidak dapat dijalankan otomatis.');
    console.log(`
${color(COLOR.bold, 'Jalankan migrasi secara manual (sekali saja):')}
  1. Buka proyek Supabase → SQL Editor → New query.
  2. Tempel isi berkas berikut secara BERURUTAN, jalankan satu per satu:
${['20260101000001_init.sql', '20260101000002_functions.sql', '20260101000003_business_functions.sql', '20260101000004_triggers.sql', '20260101000005_views.sql', '20260101000006_rls.sql', '20260101000007_operations.sql']
  .map((file) => `       supabase/migrations/${file}`)
  .join('\n')}
  3. Verifikasi dengan: npm run db:check (memerlukan SUPABASE_DB_URL).
`);
    if (!(await confirm('Sudah menjalankan seluruh migrasi secara manual?', false))) return;
    state.migrationsApplied = true;
    return;
  }

  if (!(await confirm('Jalankan migrasi sekarang? (tidak ada perintah destruktif)', true))) return;

  try {
    const { checkDatabase, applyMigrations: runMigrations } = await import('./lib/db.mjs');
    const result = await runMigrations({ connectionString: dbUrl });
    for (const file of result.applied) success(`Migrasi dijalankan: ${file}`);
    state.migrationsApplied = true;

    step('Memverifikasi RLS…');
    const report = await checkDatabase({ connectionString: dbUrl });
    state.rlsVerified = report.rlsFailures.length === 0 && report.missingTables.length === 0;
    if (state.rlsVerified) {
      success(`RLS aktif pada ${report.tablesWithRls}/${report.totalBusinessTables} tabel bisnis, ${report.policyCount} kebijakan terpasang.`);
    } else {
      fail(`Verifikasi RLS gagal. Tabel tanpa RLS: ${report.rlsFailures.join(', ') || '-'}; tabel hilang: ${report.missingTables.join(', ') || '-'}`);
    }
    info(`Kverifikasi tambahan dengan service key: ${serviceKey ? 'tersedia' : 'tidak tersedia (dilewati)'}.`);
  } catch (error) {
    fail(`Migrasi gagal: ${error?.message ?? error}`);
    info('Periksa connection string (harus dalam bentuk postgresql://…) dan status proyek Supabase.');
  }
}

/* -------------------------------------------------------------------------- */

async function bootstrapAdmin() {
  heading('6. Super Admin pertama');

  console.log(`
${color(COLOR.bold, 'Buat akun Super Admin pertama dengan:')}
    npm run bootstrap:admin

${color(COLOR.dim, 'Skrip tersebut meminta email, password, dan identitas usaha secara lokal.')}
${color(COLOR.dim, 'Password tidak pernah ditampilkan, tidak dikirim ke chat, dan tidak disimpan pada berkas.')}
`);

  if (await confirm('Tandai langkah ini sebagai selesai (Anda akan menjalankannya setelah wizard)?', true)) {
    state.adminBootstrapped = true;
  }
}

/* -------------------------------------------------------------------------- */

async function githubSteps() {
  heading('7. Repositori & deployment GitHub');

  const hasRepo = existsSync(resolve(ROOT, '.git'));
  if (!hasRepo) {
    if (await confirm('Inisialisasi repositori Git lokal sekarang?', true)) {
      try {
        run('git', ['init', '-b', 'main'], { cwd: ROOT });
        success('Repositori Git diinisialisasi pada branch main.');
      } catch (error) {
        fail(`Gagal menginisialisasi Git: ${error?.message ?? error}`);
      }
    }
  } else {
    success('Repositori Git sudah ada.');
  }

  const workflowsReady = existsSync(resolve(ROOT, '.github/workflows/deploy-pages.yml'));
  if (workflowsReady) success('Workflow GitHub Actions (CI + deploy Pages) tersedia.');
  else warn('Workflow GitHub Actions belum lengkap.');

  console.log(`
${color(COLOR.bold, 'Langkah yang memerlukan otorisasi Anda (tidak dapat diotomatisasi):')}
  1. Buat repositori kosong di GitHub (tanpa README), lalu:
       git remote add origin https://github.com/<user>/<repo>.git
       git add . && git commit -m "feat: KreditKu initial commit"
       git push -u origin main
  2. Repository → Settings → Pages → Source: "GitHub Actions".
  3. Repository → Settings → Secrets and variables → Actions → New repository secret:
       VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
     (Keduanya PUBLIC dan memang ter-embed ke bundle — jangan pernah menaruh
      service_role key pada secret yang dipakai proses build frontend.)
  4. Bila aplikasi dipasang di subpath repository, set variable:
       VITE_BASE_PATH = /<nama-repository>/
  5. Jalankan build & deployment:
       git push            (workflow berjalan otomatis)
       npm run verify:deploy -- --url https://<user>.github.io/<repo>/
`);

  state.repoReady = true;
}

/* -------------------------------------------------------------------------- */

async function finalSummary() {
  heading('Ringkasan konfigurasi');
  const rows = [
    ['Prasyarat terpenuhi', true],
    ['Konfigurasi publik Supabase', state.supabaseConfigured || isFilled(parseEnvFile(ENV_PATH).VITE_SUPABASE_URL)],
    ['Koneksi Supabase diuji', state.databaseReachable],
    ['Migrasi database', state.migrationsApplied],
    ['RLS terverifikasi', state.rlsVerified],
    ['Super Admin', state.adminBootstrapped],
    ['Repositori GitHub', state.repoReady],
  ];
  for (const [label, value] of rows) {
    console.log(`  ${value ? color(COLOR.green, '✔') : color(COLOR.yellow, '•')} ${label}`);
  }

  console.log(`
${color(COLOR.bold, 'Langkah manual yang masih diperlukan:')}
  1. npm run bootstrap:admin            → membuat Super Admin pertama.
  2. npm run db:check                   → verifikasi tabel, RLS, dan kesesuaian rumus bunga.
  3. Isi kredensial kanal pengingat pada Settings → Integrations (bila ingin notifikasi nyata;
     selama mode simulasi aktif, pesan TIDAK dikirim).
  4. Deploy Edge Function (opsional): supabase functions deploy invite-user
  5. Aktifkan GitHub Pages dan isi secrets sesuai instruksi langkah 7.

${color(COLOR.bold, 'Perintah berguna:')}
  npm run dev            → jalankan aplikasi pengembangan
  npm run lint           → pemeriksaan kode
  npm run typecheck      → pemeriksaan tipe TypeScript
  npm test               → unit test (logika keuangan)
  npm run build          → build produksi
  npm run verify:deploy  → verifikasi hasil deployment
`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`
${color(COLOR.bold, 'KreditKu — Wizard Konfigurasi')}
${color(COLOR.dim, 'Sistem Manajemen Kredit dan Cicilan')}
`);

  try {
    const ready = checkPrerequisites();
    if (!ready) return;

    await configureEnv();
    await testConnection();
    await applyMigrations();
    await bootstrapAdmin();
    await githubSteps();
    await finalSummary();
  } finally {
    closePrompts();
  }
}

main().catch((error) => {
  fail(`Wizard berhenti karena kesalahan: ${error?.message ?? error}`);
  process.exitCode = 1;
});
