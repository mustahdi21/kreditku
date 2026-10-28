#!/usr/bin/env node
/**
 * bootstrap-admin.mjs — Membuat Super Admin pertama.
 *
 * KEAMANAN
 * --------
 *   * Password diketik secara lokal (input tersembunyi) dan TIDAK PERNAH
 *     dicetak, dikirim ke layanan pihak ketiga, atau disimpan pada berkas.
 *   * Fungsi server `rpc_bootstrap_super_admin` hanya bekerja selama belum ada
 *     Super Admin aktif, sehingga skrip ini tidak dapat dipakai untuk
 *     mengambil alih sistem yang sudah berjalan.
 *   * Skrip memerlukan kredensial server (connection string database atau
 *     service role key) yang hanya boleh berada pada mesin lokal/CI.
 *
 * Jalankan: npm run bootstrap:admin
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ask,
  askHidden,
  closePrompts,
  confirm,
  fail,
  heading,
  info,
  step,
  success,
  warn,
} from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

const envFile = loadEnvFile();
const dbUrl = process.env.SUPABASE_DB_URL || envFile.SUPABASE_DB_URL;
const supabaseUrl = process.env.SUPABASE_URL || envFile.SUPABASE_URL || envFile.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY;

function validateEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function validatePassword(value) {
  if (value.length < 10) return 'Password minimal 10 karakter.';
  if (!/[A-Za-z]/.test(value)) return 'Password harus mengandung huruf.';
  if (!/[0-9]/.test(value)) return 'Password harus mengandung angka.';
  return null;
}

async function runViaDatabase(params) {
  const { connect } = await import('./lib/db.mjs');
  const client = await connect(dbUrl);
  try {
    const result = await client.query(
      `select public.rpc_bootstrap_super_admin($1, $2, $3, $4, $5) as result`,
      [params.email, params.password, params.fullName, params.orgName, params.orgCode],
    );
    return result.rows[0]?.result ?? null;
  } finally {
    await client.end();
  }
}

async function runViaRest(params) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/rpc_bootstrap_super_admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      p_email: params.email,
      p_password: params.password,
      p_full_name: params.fullName,
      p_org_name: params.orgName,
      p_org_code: params.orgCode,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message ?? body;
    } catch {
      /* biarkan pesan mentah */
    }
    throw new Error(message);
  }
  return response.json();
}

async function main() {
  console.log(`
${'\u001b[1m\u001b[34m'}KreditKu — Bootstrap Super Admin${'\u001b[0m'}
`);

  if (!dbUrl && !(supabaseUrl && serviceKey)) {
    fail('Kredensial server belum tersedia.');
    console.log(`
Salah satu dari berikut diperlukan untuk membuat Super Admin:

  A. SUPABASE_DB_URL (connection string PostgreSQL), atau
  B. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

Simpan pada berkas .env (hanya lokal, jangan di-commit) atau ekspor sebagai
variabel lingkungan sebelum menjalankan skrip ini.

Alternatif tanpa kredensial server: jalankan fungsi berikut pada SQL Editor
Supabase (hanya sekali, selama belum ada Super Admin):

  select public.rpc_bootstrap_super_admin(
    'admin@contoh.id',            -- email
    '<password-kuat-anda>',       -- password minimal 10 karakter
    'Nama Administrator',         -- nama lengkap
    'Nama Usaha Anda',            -- nama usaha
    'USAHA'                       -- kode organisasi (huruf kapital/angka)
  );

Catatan: jangan pernah mengirim password melalui percakapan atau repositori.
`);
    process.exit(1);
  }

  if (!(await confirm('Lanjutkan membuat Super Admin pertama?', true))) return;

  heading('Data Super Admin');

  let email = '';
  while (!validateEmail(email)) {
    email = await ask('Email Super Admin');
    if (!validateEmail(email)) warn('Format email tidak valid. Coba lagi.');
  }

  let password = '';
  let passwordError = 'Password belum memenuhi syarat.';
  while (passwordError) {
    password = await askHidden('Password (minimal 10 karakter, kombinasi huruf dan angka)');
    passwordError = validatePassword(password);
    if (passwordError) warn(passwordError);
  }

  const confirmation = await askHidden('Ulangi password');
  if (confirmation !== password) {
    fail('Konfirmasi password tidak sama. Proses dihentikan demi keamanan.');
    process.exit(1);
  }

  const fullName = await ask('Nama lengkap administrator', { defaultValue: 'Super Admin' });
  const orgName = await ask('Nama usaha');
  const orgCode = await ask('Kode organisasi (huruf kapital/angka, 2–12 karakter)', {
    defaultValue: (orgName.replace(/[^A-Za-z0-9]/g, '') || 'ORG').toUpperCase().slice(0, 6),
  });

  heading('Membuat akun');

  try {
    let result;
    if (dbUrl) {
      step('Menghubungi database melalui connection string…');
      result = await runViaDatabase({ email, password, fullName, orgName, orgCode });
    } else {
      step('Memanggil fungsi Server melalui REST API dengan service role…');
      result = await runViaRest({ email, password, fullName, orgName, orgCode });
    }

    success('Super Admin berhasil dibuat.');
    info(`Email              : ${email}`);
    info(`Organisasi         : ${result?.organization_id ?? '(lihat database)'}`);
    info(`Kode organisasi    : ${result?.organization_code ?? orgCode}`);
    console.log(`
${'\u001b[1m'}Langkah berikutnya:${'\u001b[0m'}
  1. Jalankan aplikasi: npm run dev
  2. Masuk menggunakan email dan password yang baru Anda buat.
  3. Tambahkan anggota lain melalui Pengaturan → Pengguna.

Password Anda tidak pernah ditampilkan atau disimpan oleh skrip ini.
`);
  } catch (error) {
    fail(`Gagal membuat Super Admin: ${error?.message ?? error}`);
    info('Pastikan migrasi sudah dijalankan (npm run db:check) dan kredensial server masih berlaku.');
    process.exitCode = 1;
  } finally {
    closePrompts();
  }
}

main().catch((error) => {
  fail(`Skrip berhenti: ${error?.message ?? error}`);
  process.exitCode = 1;
});
