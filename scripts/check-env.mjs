#!/usr/bin/env node
/**
 * check-env.mjs — Memeriksa kesiapan lingkungan KreditKu.
 *
 * Memeriksa tanpa pernah menampilkan nilai rahasia:
 *   * versi Node.js dan ketersediaan npm;
 *   * keberadaan Git dan status repositori;
 *   * berkas .env beserta variabel wajib;
 *   * memastikan kunci yang dipasang pada VITE_ bukan service_role key;
 *   * keberadaan workflow GitHub Actions.
 *
 * Jalankan: npm run env:check
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failures = 0;
let warnings = 0;

function ok(label, detail = '') {
  results.push({ level: 'ok', label, detail });
}

function warn(label, detail = '') {
  warnings += 1;
  results.push({ level: 'warn', label, detail });
}

function fail(label, detail = '') {
  failures += 1;
  results.push({ level: 'fail', label, detail });
}

function run(command, args) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Node & npm                                                                 */
/* -------------------------------------------------------------------------- */

const nodeVersion = process.versions.node;
const [major] = nodeVersion.split('.').map(Number);
if (major >= 20) ok('Node.js', `v${nodeVersion}`);
else fail('Node.js', `v${nodeVersion} — diperlukan minimal v20 (disarankan v22 atau v24 LTS).`);

const npmVersion = run('npm', ['--version']);
if (npmVersion) ok('npm', `v${npmVersion}`);
else fail('npm', 'npm tidak ditemukan pada PATH.');

/* -------------------------------------------------------------------------- */
/* Git                                                                        */
/* -------------------------------------------------------------------------- */

const gitVersion = run('git', ['--version']);
if (gitVersion) ok('Git', gitVersion);
else warn('Git', 'Git tidak ditemukan. Diperlukan untuk deployment melalui GitHub.');

if (existsSync(resolve(ROOT, '.git'))) {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = run('git', ['remote', 'get-url', 'origin']);
  ok('Repositori Git', `branch ${branch ?? '(belum ada commit)'}${remote ? `, remote terpasang` : ', remote belum diatur'}`);
  if (!remote) warn('Remote GitHub', 'Belum ada remote origin. Tambahkan dengan: git remote add origin <url-repository>.');
} else {
  warn('Repositori Git', 'Belum diinisialisasi. Jalankan: git init -b main');
}

/* -------------------------------------------------------------------------- */
/* Berkas .env                                                                */
/* -------------------------------------------------------------------------- */

const envPath = resolve(ROOT, '.env');
if (!existsSync(envPath)) {
  fail('Berkas .env', 'Belum ada. Salin .env.example menjadi .env lalu isi nilainya.');
} else {
  ok('Berkas .env', 'ditemukan');
  const content = readFileSync(envPath, 'utf8');
  const parse = (key) => {
    const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    return value;
  };

  const publicKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  for (const key of publicKeys) {
    const value = parse(key);
    if (!value || /xxxxxxxx|your-|example/i.test(value)) {
      fail(key, 'belum diisi atau masih berisi contoh.');
    } else {
      ok(key, 'terisi');
    }
  }

  const url = parse('VITE_SUPABASE_URL');
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    warn('Format VITE_SUPABASE_URL', 'Tidak mengikuti pola https://<project>.supabase.co — periksa kembali nilainya.');
  }

  // Pemeriksaan penting: anon key TIDAK boleh service_role.
  const anonKey = parse('VITE_SUPABASE_ANON_KEY');
  if (anonKey) {
    const payloadPart = anonKey.split('.')[1];
    let role = null;
    try {
      role = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8')).role ?? null;
    } catch {
      role = null;
    }
    if (role === 'service_role') {
      fail(
        'KEAMANAN: VITE_SUPABASE_ANON_KEY berisi service_role key',
        'Kunci ini melewati seluruh RLS dan tidak boleh berada di frontend. Ganti dengan anon/publishable key.',
      );
    } else if (role) {
      ok('Kunci publik Supabase', `role="${role}" (aman untuk frontend)`);
    } else {
      warn('Kunci publik Supabase', 'Tidak dapat dibaca sebagai JWT. Pastikan nilainya benar.');
    }
  }

  if (parse('SUPABASE_SERVICE_ROLE_KEY')) {
    ok('Service role key (skrip server)', 'terpasang pada .env (hanya dipakai skrip lokal/CI, tidak pernah dikirim ke browser)');
  } else {
    warn(
      'Service role key (skrip server)',
      'Belum diisi. Diperlukan hanya untuk migrasi otomatis dan bootstrap admin.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Aset proyek                                                                */
/* -------------------------------------------------------------------------- */

const requiredFiles = [
  'package.json',
  'supabase/migrations/20260101000001_init.sql',
  'supabase/migrations/20260101000006_rls.sql',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy-pages.yml',
];
for (const file of requiredFiles) {
  if (existsSync(resolve(ROOT, file))) ok(`Berkas ${file}`, 'ada');
  else fail(`Berkas ${file}`, 'tidak ditemukan.');
}

const nodeModules = existsSync(resolve(ROOT, 'node_modules'));
if (nodeModules) ok('Dependencies', 'node_modules tersedia');
else warn('Dependencies', 'node_modules belum ada. Jalankan: npm install');

/* -------------------------------------------------------------------------- */
/* Laporan                                                                    */
/* -------------------------------------------------------------------------- */

const icons = { ok: '[ OK ]', warn: '[WARN]', fail: '[GAGAL]' };
console.log('\nPemeriksaan lingkungan KreditKu\n' + '='.repeat(60));
for (const item of results) {
  console.log(`${icons[item.level]} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}
console.log('='.repeat(60));
console.log(`Ringkasan: ${results.filter((r) => r.level === 'ok').length} ok, ${warnings} peringatan, ${failures} gagal.\n`);

if (failures > 0) {
  console.log('Langkah berikutnya: jalankan `npm run setup` untuk memandu konfigurasi.\n');
  process.exit(1);
}
process.exit(0);
