#!/usr/bin/env node
/**
 * deploy.mjs — Menjalankan pemeriksaan mutu dan build produksi sebelum
 * deployment. TIDAK melakukan push ke GitHub secara otomatis tanpa
 * persetujuan (lihat langkah persetujuan di akhir).
 *
 * Jalankan: npm run deploy
 *   parameter: --base /nama-repository/   → mengatur VITE_BASE_PATH saat build
 *              --skip-tests                → melewati pengujian (tidak disarankan)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ask,
  closePrompts,
  color,
  COLOR,
  confirm,
  fail,
  heading,
  info,
  run,
  step,
  success,
  warn,
} from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const basePath = baseIndex >= 0 ? args[baseIndex + 1] : null;
const skipTests = args.includes('--skip-tests');

function execute(command, commandArgs, options = {}) {
  step(`$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
    shell: false,
  });
  if (result.status !== 0) {
    fail(`Perintah gagal dengan kode ${result.status ?? 'tidak diketahui'}.`);
    process.exit(result.status ?? 1);
  }
}

async function main() {
  console.log(`
${color(COLOR.bold + COLOR.blue, 'KreditKu — Deployment')}
`);

  heading('1. Pemeriksaan lingkungan');
  execute('node', ['scripts/check-env.mjs']);

  if (!skipTests) {
    heading('2. Pemeriksaan kualitas');
    execute('npm', ['run', 'lint']);
    execute('npm', ['run', 'typecheck']);
    execute('npm', ['run', 'test']);
  } else {
    warn('Pengujian dilewati (--skip-tests). Pastikan ini disengaja.');
  }

  heading('3. Build produksi');
  const env = {};
  if (basePath) {
    env.VITE_BASE_PATH = basePath.endsWith('/') ? basePath : `${basePath}/`;
    success(`Base path build: ${env.VITE_BASE_PATH}`);
    // Menuliskan base path ke .env agar konsisten pada build berikutnya.
    writeFileSync(resolve(ROOT, '.env.local'), `VITE_BASE_PATH=${env.VITE_BASE_PATH}\n`, 'utf8');
  } else {
    info('Base path default "/" dipakai. Untuk GitHub Pages subpath gunakan --base /nama-repo/');
  }
  execute('npm', ['run', 'build'], { env });

  heading('4. Verifikasi artefak');
  execute('node', ['scripts/verify-deploy.mjs', '--dir', 'dist']);

  heading('5. Deployment');
  const hasGit = existsSync(resolve(ROOT, '.git'));
  if (!hasGit) {
    fail('Repositori Git belum ada. Inisialisasi dengan: git init -b main');
    return;
  }

  const status = run('git', ['status', '--porcelain'], { cwd: ROOT });
  if (status) {
    info('Perubahan yang belum di-commit:');
    console.log(status.split('\n').slice(0, 20).map((line) => `    ${line}`).join('\n'));
  } else {
    success('Tidak ada perubahan yang belum di-commit.');
  }

  console.log(`
${color(COLOR.bold, 'Deployment dilakukan melalui GitHub Actions:')}
  1. Commit dan push perubahan Anda:
       git add . && git commit -m "<pesan>" && git push
  2. Workflow .github/workflows/deploy-pages.yml akan menjalankan
     lint → typecheck → test → build → deploy ke GitHub Pages.
  3. Setelah selesai, verifikasi dengan:
       npm run verify:deploy -- --url <URL-Pages-Anda>
`);

  if (await confirm('Tampilkan panduan penyiapan GitHub Pages dan secrets?', false)) {
    console.log(`
  1. Repository → Settings → Pages → Source: GitHub Actions.
  2. Repository → Settings → Secrets and variables → Actions:
       VITE_SUPABASE_URL       (bukan rahasia, tetap disimpan sebagai secret agar seragam)
       VITE_SUPABASE_ANON_KEY  (publik, AMAN karena dilindungi RLS)
     Variables (bukan secrets):
       VITE_BASE_PATH = /<nama-repository>/   (hanya bila memakai subpath)
  3. JANGAN pernah menaruh service_role key pada secret workflow frontend,
     karena nilainya akan ter-embed ke bundle yang dapat diunduh siapa pun.
`);
  }

  closePrompts();
}

main().catch((error) => {
  fail(`Deployment berhenti: ${error?.message ?? error}`);
  process.exitCode = 1;
});
