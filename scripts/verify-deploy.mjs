#!/usr/bin/env node
/**
 * verify-deploy.mjs — Verifikasi hasil deployment.
 *
 * Memeriksa:
 *   1. Halaman dapat diakses (HTTP 200) dan memuat elemen #root.
 *   2. Aset JavaScript hasil build dapat diunduh.
 *   3. TIDAK ada rahasia yang ter-embed pada bundle (service role key,
 *      password database, token WhatsApp, password SMTP).
 *   4. Hanya kunci publik Supabase yang muncul pada bundle.
 *
 * Jalankan:
 *   npm run verify:deploy -- --url https://<user>.github.io/<repo>/
 *   npm run verify:deploy -- --dir dist        (memeriksa berkas lokal saja)
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, COLOR, fail, heading, info, step, success, warn } from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const urlFlagIndex = args.indexOf('--url');
const dirFlagIndex = args.indexOf('--dir');
const targetUrl = urlFlagIndex >= 0 ? args[urlFlagIndex + 1] : null;
const targetDir = dirFlagIndex >= 0 ? args[dirFlagIndex + 1] : resolve(ROOT, 'dist');

let failures = 0;

/**
 * Pola rahasia yang TIDAK BOLEH muncul pada bundle frontend.
 *
 * Catatan: nama variabel seperti SUPABASE_SERVICE_ROLE_KEY boleh muncul pada
 * teks peringatan antarmuka; yang dilarang adalah NILAI rahasianya. Karena itu
 * pencarian utama memakai pola JWT dan pola penugasan nilai.
 */
const FORBIDDEN_PATTERNS = [
  { name: 'service_role JWT (klaim role)', regex: /"role"\s*:\s*"service_role"/ },
  { name: 'penugasan service role key', regex: /SERVICE_ROLE_KEY["']?\s*[:=]\s*["']?ey[A-Za-z0-9_-]{10,}/ },
  { name: 'password database', regex: /postgres(ql)?:\/\/[^"'\s]*:[^"'\s]+@/i },
  { name: 'penugasan token WhatsApp', regex: /WAHA?SENDER_API_KEY["']?\s*[:=]\s*["'][A-Za-z0-9_-]{8,}/i },
  { name: 'penugasan password SMTP', regex: /SMTP_(PASS|PASSWORD)["']?\s*[:=]\s*["'][^"']{4,}/i },
  { name: 'service account JSON', regex: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'kunci rahasia umum (sk_/pk_live)', regex: /\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/ },
];

/** JWT apa pun yang perannya bukan anon/authenticated dianggap temuan. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;

function decodeJwtRole(token) {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(decoded).role ?? null;
  } catch {
    return null;
  }
}

/** Memeriksa satu berkas teks dan mengembalikan daftar temuan. */
function scanForSecrets(filePath, content) {
  const findings = [];

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(content)) findings.push(pattern.name);
  }

  const jwtRoles = new Set();
  for (const match of content.matchAll(JWT_PATTERN)) {
    const role = decodeJwtRole(match[0]);
    if (role && role !== 'anon' && role !== 'authenticated') {
      jwtRoles.add(role);
    }
  }
  for (const role of jwtRoles) {
    findings.push(`JWT dengan peran "${role}" ter-embed pada bundle`);
  }

  return [...new Set(findings)];
}

function collectFiles(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) collectFiles(path, result);
    else result.push({ path, size: stats.size });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 1. Artefak build lokal                                                     */
/* -------------------------------------------------------------------------- */

heading('1. Artefak build lokal');

const files = collectFiles(targetDir);
if (files.length === 0) {
  fail(`Tidak ada berkas pada ${targetDir}. Jalankan: npm run build`);
  failures += 1;
} else {
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  success(`${files.length} berkas (${(totalSize / 1024 / 1024).toFixed(2)} MB) pada ${targetDir}`);
  const hasIndex = files.some((file) => file.path.endsWith('index.html'));
  if (hasIndex) success('index.html tersedia');
  else {
    fail('index.html tidak ditemukan pada hasil build');
    failures += 1;
  }
  const hasServiceWorker = files.some((file) => file.path.endsWith('sw.js'));
  if (hasServiceWorker) success('Service worker PWA tersedia');
  else warn('Service worker PWA tidak ditemukan pada hasil build');
}

/* -------------------------------------------------------------------------- */
/* 2. Pemindaian rahasia pada bundle                                          */
/* -------------------------------------------------------------------------- */

heading('2. Pemindaian rahasia pada bundle');

let leaks = 0;
for (const file of files) {
  if (!/\.(js|css|html|json|map)$/.test(file.path)) continue;
  const content = readFileSync(file.path, 'utf8');
  for (const finding of scanForSecrets(file.path, content)) {
    fail(`${finding} — berkas: ${file.path.replace(ROOT + '/', '')}`);
    leaks += 1;
    failures += 1;
  }
}
if (leaks === 0) success('Tidak ada rahasia yang ter-embed pada bundle.');

/* -------------------------------------------------------------------------- */
/* 3. Verifikasi URL publik                                                   */
/* -------------------------------------------------------------------------- */

heading('3. Verifikasi URL deployment');

if (!targetUrl) {
  warn('URL deployment tidak diberikan. Lewati verifikasi jaringan.');
  info('Contoh: npm run verify:deploy -- --url https://<user>.github.io/<repo>/');
} else {
  step(`Mengambil ${targetUrl} …`);
  try {
    const response = await fetch(targetUrl, { redirect: 'follow' });
    if (response.ok) success(`Halaman utama merespons HTTP ${response.status}`);
    else {
      fail(`Halaman utama merespons HTTP ${response.status}`);
      failures += 1;
    }

    const html = await response.text();
    if (html.includes('id="root"')) success('Elemen #root ditemukan pada HTML.');
    else {
      warn('Elemen #root tidak ditemukan — pastikan index.html yang benar telah ter-deploy.');
    }

    // Ambil aset JS pertama untuk diperiksa.
    const scriptMatch = html.match(/src="([^"]+\.js)"/);
    if (scriptMatch) {
      const assetUrl = new URL(scriptMatch[1], targetUrl).toString();
      step(`Memeriksa aset: ${assetUrl}`);
      const assetResponse = await fetch(assetUrl);
      if (assetResponse.ok) {
        const assetText = await assetResponse.text();
        const found = scanForSecrets(assetUrl, assetText);
        if (found.length === 0) success('Aset JavaScript tidak mengandung rahasia.');
        else {
          for (const finding of found) fail(`Aset mengandung: ${finding}`);
          failures += 1;
        }
        if (/supabase\.co/.test(assetText)) success('Aset terhubung ke konfigurasi Supabase (URL proyek ter-embed).');
      } else {
        fail(`Aset JavaScript tidak dapat diunduh (HTTP ${assetResponse.status})`);
        failures += 1;
      }
    } else {
      warn('Tidak menemukan aset JavaScript pada HTML (kemungkinan base path tidak sesuai).');
      info('Periksa nilai VITE_BASE_PATH: untuk GitHub Pages pada subpath gunakan "/nama-repository/".');
    }

    const sw = await fetch(new URL('sw.js', targetUrl));
    if (sw.ok) success('Service worker dapat diakses (PWA aktif).');
    else warn(`Service worker tidak dapat diakses (HTTP ${sw.status}) — fitur offline tidak aktif.`);
  } catch (error) {
    fail(`Gagal menghubungi ${targetUrl}: ${error?.message ?? error}`);
    failures += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* Ringkasan                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\n' + '='.repeat(60));
if (failures === 0) {
  console.log(color(COLOR.green, 'Verifikasi deployment LULUS.'));
  console.log(`
Yang perlu diperiksa manual sekali oleh pemilik akun:
  • Login dengan akun nyata (Super Admin) pada URL di atas.
  • Pastikan halaman Pelanggan/Kontrak/Pembayaran menampilkan data organisasi.
  • Pastikan RLS bekerja: akun dari organisasi lain tidak dapat melihat data.
`);
  process.exit(0);
}
console.log(color(COLOR.red, `Verifikasi deployment GAGAL pada ${failures} pemeriksaan.`));
process.exit(1);
