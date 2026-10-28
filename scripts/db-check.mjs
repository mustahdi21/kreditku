#!/usr/bin/env node
/**
 * db-check.mjs — Verifikasi database KreditKu.
 *
 * Memeriksa:
 *   1. Kelengkapan tabel, view, dan fungsi bisnis.
 *   2. Row Level Security aktif pada seluruh tabel bisnis.
 *   3. Jumlah dan distribusi kebijakan RLS (termasuk larangan DELETE).
 *   4. Kesesuaian rumus bunga antara PostgreSQL dan TypeScript
 *      (menjalankan src/core/sql-parity.test.ts).
 *
 * Memerlukan SUPABASE_DB_URL (connection string Postgres). Tidak menampilkan
 * data pribadi apa pun — hanya struktur dan jumlah baris.
 *
 * Jalankan: npm run db:check
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, COLOR, fail, heading, info, step, success, warn } from './lib/util.mjs';

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
const connectionString = process.env.SUPABASE_DB_URL || envFile.SUPABASE_DB_URL;

if (!connectionString) {
  fail('SUPABASE_DB_URL belum tersedia.');
  console.log(`
Verifikasi database memerlukan connection string PostgreSQL:

  1. Buka proyek Supabase → Project Settings → Database → Connection string → URI.
  2. Tambahkan pada berkas .env (hanya lokal, jangan di-commit):
       SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
  3. Jalankan ulang: npm run db:check

Catatan: connection string berisi password database. Berkas .env sudah
diabaikan oleh Git; jangan pernah menempelkan nilainya pada percakapan.
`);
  process.exit(1);
}

const {
  checkDatabase,
  runScheduleVectors: _runScheduleVectors,
  collectRowCounts,
} = await import('./lib/db.mjs');

let failures = 0;

heading('1. Struktur database');
const report = await checkDatabase({ connectionString });

if (report.missingTables.length === 0) success(`Seluruh ${report.totalBusinessTables} tabel bisnis tersedia.`);
else {
  failures += 1;
  fail(`Tabel hilang: ${report.missingTables.join(', ')}`);
}

if (report.missingViews.length === 0) success('Seluruh view laporan tersedia.');
else {
  failures += 1;
  fail(`View hilang: ${report.missingViews.join(', ')}`);
}

if (report.missingFunctions.length === 0) success('Seluruh fungsi bisnis tersedia.');
else {
  failures += 1;
  fail(`Fungsi hilang: ${report.missingFunctions.join(', ')}`);
}

heading('2. Row Level Security');
if (report.rlsFailures.length === 0) {
  success(`RLS aktif pada ${report.tablesWithRls}/${report.totalBusinessTables} tabel bisnis.`);
} else {
  failures += 1;
  fail(`Tabel tanpa RLS: ${report.rlsFailures.join(', ')}`);
}

info(`Total kebijakan terpasang: ${report.policyCount}`);

if (report.tablesWithoutPolicy.length === 0) {
  success('Setiap tabel bisnis memiliki kebijakan akses (number_sequences sengaja tertutup total).');
} else {
  warn(`Tabel tanpa kebijakan: ${report.tablesWithoutPolicy.join(', ')}`);
}

if (report.deletePolicies.length === 0) {
  success('Tidak ada kebijakan DELETE: data bisnis tidak dapat dihapus permanen oleh klien.');
} else {
  warn(`Terdapat kebijakan DELETE pada: ${report.deletePolicies.join(', ')} (pastikan ini disengaja).`);
}

heading('3. Kesesuaian rumus bunga (PostgreSQL ↔ TypeScript)');
step('Menjalankan src/core/sql-parity.test.ts …');
const parity = spawnSync('npx', ['vitest', 'run', 'src/core/sql-parity.test.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_DB_URL: connectionString, SQL_PARITY: 'on' },
  shell: false,
});
if (parity.status === 0) success('Rumus bunga PostgreSQL identik dengan implementasi TypeScript.');
else {
  failures += 1;
  fail('Terdapat perbedaan antara rumus PostgreSQL dan TypeScript (lihat keluaran tes di atas).');
}

heading('4. Jumlah data (informasi, tanpa data pribadi)');
try {
  const counts = await collectRowCounts(connectionString);
  for (const [table, total] of Object.entries(counts)) info(`${table}: ${total} baris`);
} catch (error) {
  warn(`Tidak dapat menghitung jumlah baris: ${error?.message ?? error}`);
}

console.log('\n' + '='.repeat(60));
if (failures === 0) {
  console.log(color(COLOR.green, 'Verifikasi database LULUS.'));
  process.exit(0);
}
console.log(color(COLOR.red, `Verifikasi database GAGAL pada ${failures} pemeriksaan.`));
process.exit(1);
