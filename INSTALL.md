# INSTALL.md — Panduan Instalasi KreditKu

Panduan ini membawa Anda dari nol hingga aplikasi berjalan dengan data nyata.

Perkiraan waktu: **20–30 menit** (sebagian besar menunggu pembuatan proyek Supabase).

---

## 0. Ringkasan langkah

| # | Langkah | Dapat diotomatisasi? |
|---|---|---|
| 1 | Pasang Node.js 20+ dan Git | Manual (sekali) |
| 2 | Buat proyek Supabase | **Manual** (memerlukan akun & otorisasi Anda) |
| 3 | Isi `.env` (URL + anon key) | Otomatis via `npm run setup` |
| 4 | Jalankan migrasi database | Otomatis bila `SUPABASE_DB_URL` tersedia |
| 5 | Verifikasi RLS & rumus bunga | Otomatis (`npm run db:check`) |
| 6 | Buat Super Admin pertama | Otomatis (`npm run bootstrap:admin`) |
| 7 | Jalankan aplikasi | Otomatis (`npm run dev`) |
| 8 | Konfigurasi kanal pengingat | Manual (opsional, memerlukan kredensial provider) |
| 9 | Deploy ke GitHub Pages | Semi-otomatis (lihat DEPLOY.md) |

---

## 1. Prasyarat

```bash
node -v      # harus v20 atau lebih baru (disarankan v22 / v24 LTS)
npm -v
git --version
```

Opsional (mempercepat langkah otomatis):

```bash
# GitHub CLI — untuk operasi repositori/secrets
brew install gh && gh auth login

# Supabase CLI — alternatif menjalankan migrasi
brew install supabase/tap/supabase && supabase login
```

Pemeriksaan otomatis: `npm run env:check`.

---

## 2. Buat proyek Supabase

Langkah ini **memerlukan akun Supabase Anda** dan tidak dapat diotomatisasi.

1. Buka <https://supabase.com/dashboard> → **New project**.
2. Pilih organisasi, isi nama proyek (mis. `kreditku`), lalu **Database Password**
   yang kuat. Simpan password tersebut di tempat aman (password manager) —
   aplikasi tidak memerlukannya, tetapi Anda akan memerlukannya untuk
   `SUPABASE_DB_URL`.
3. Pilih region terdekat (mis. `Singapore`) dan tunggu hingga proyek siap.
4. Catat dua nilai dari **Project Settings → API**:
   - `Project URL` → `https://xxxxxxxx.supabase.co`
   - `anon public key` (atau `publishable key`)

> **Jangan gunakan `service_role key` pada frontend.** Kunci tersebut melewati seluruh
> Row Level Security. `npm run env:check` akan menolak konfigurasi yang salah kunci.

---

## 3. Konfigurasi lingkungan

```bash
npm install
npm run setup
```

Wizard akan:

1. Memeriksa Node, Git, dan struktur proyek.
2. Membuat `.env` dari `.env.example` dan meminta **Project URL** serta **anon key**
   (input kunci disamarkan saat diketik).
3. Menolak proses bila yang dimasukkan ternyata `service_role key`.
4. Menguji koneksi ke Supabase Auth.
5. Menjalankan seluruh migrasi bila `SUPABASE_DB_URL` tersedia.
6. Memverifikasi RLS.
7. Menampilkan langkah manual yang tersisa.

Secara manual, isi `.env` seperti berikut:

```dotenv
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_BASE_PATH=/
```

### Tentang `SUPABASE_DB_URL`

Hanya diperlukan oleh skrip lokal/CI untuk menjalankan migrasi dan verifikasi.

- **Project Settings → Database → Connection string → URI**
  (bentuk: `postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres`).
- Alternatif **Connection Pooling** (port `6543`) juga bekerja.
- Simpan **hanya** di `.env` lokal (sudah diabaikan Git) atau variabel lingkungan CI.
  Jangan pernah menempelkannya pada percakapan, issue, atau commit.

---

## 4. Migrasi database

### Cara A — otomatis (disarankan)

```bash
npm run setup        # memilih "Jalankan migrasi sekarang?"
# atau langsung:
node -e "import('./scripts/lib/db.mjs').then(async (m) => { await m.applyMigrations({connectionString: process.env.SUPABASE_DB_URL, onProgress: console.log}); })"
```

Seluruh migrasi bersifat **idempoten** (aman dijalankan ulang) dan dijalankan dalam satu transaksi.

### Cara B — manual melalui SQL Editor

Buka proyek Supabase → **SQL Editor** → **New query**, lalu jalankan berkas berikut
**satu per satu, sesuai urutan**:

```
supabase/migrations/20260101000001_init.sql
supabase/migrations/20260101000002_functions.sql
supabase/migrations/20260101000003_business_functions.sql
supabase/migrations/20260101000004_triggers.sql
supabase/migrations/20260101000005_views.sql
supabase/migrations/20260101000006_rls.sql
supabase/migrations/20260101000007_operations.sql
```

### Cara C — Supabase CLI

```bash
supabase link --project-ref <project-ref>
supabase db push
```

### Data contoh (pengembangan saja)

`sufabase/seed.sql` membuat organisasi demo, tiga akun (`superadmin@kreditku.local`,
`admin@kreditku.local`, `kasir@kreditku.local`, password `DevPassword123!`), dua pelanggan,
dua kontrak dengan jadwal cicilan, dan dua pembayaran.

```bash
supabase db reset          # menjalankan migrasi + seed pada database LOKAL
```

> **Jangan** menjalankan seed pada proyek produksi. Seed menolak berjalan bila sudah ada
> organisasi pada database.

---

## 5. Verifikasi

```bash
npm run db:check
```

Pemeriksaan yang dilakukan:

1. Seluruh tabel bisnis, view laporan, dan fungsi tersedia.
2. **RLS aktif** pada setiap tabel bisnis + jumlah kebijakan terpasang.
3. Tidak ada kebijakan `DELETE` (data bisnis tidak dapat dihapus permanen).
4. **Kesesuaian rumus bunga** PostgreSQL ↔ TypeScript pada 10 vektor uji
   (pokok, biaya, dan tanggal harus identik; bunga boleh berbeda maksimal 1 Rupiah per periode
   karena perbedaan presisi, dengan total selisih maksimal 5 Rupiah).

Jalankan juga pemeriksaan lokal:

```bash
npm run lint
npm run typecheck
npm test
```

---

## 6. Super Admin pertama

```bash
npm run bootstrap:admin
```

Skrip akan meminta (secara lokal, tanpa echo untuk password):

- email Super Admin,
- password (minimal 10 karakter, kombinasi huruf & angka) — diketik dua kali,
- nama lengkap, nama usaha, dan kode organisasi.

Kemudian memanggil fungsi server `rpc_bootstrap_super_admin`, yang:

- **menolak** berjalan bila sudah ada Super Admin aktif (mencegah pengambilalihan sistem),
- menyimpan password sebagai hash bcrypt (`crypt` + `gen_salt('bf')`),
- membuat organisasi + `app_settings` bawaan + keanggotaan `SUPER_ADMIN`,
- mencatat aksi bootstrap pada audit log.

Alternatif tanpa kredensial server — jalankan pada SQL Editor (hanya sekali):

```sql
select public.rpc_bootstrap_super_admin(
  'admin@contoh.id',
  '<password-kuat-anda>',
  'Nama Administrator',
  'Nama Usaha Anda',
  'USAHA'
);
```

---

## 7. Menjalankan aplikasi

```bash
npm run dev          # http://localhost:5173
```

Masuk dengan akun Super Admin, lalu:

1. **Pengaturan → Business** — sesuaikan nama usaha, kode, kontak, zona waktu.
2. **Pengaturan → Numbering** — periksa format nomor pelanggan/kontrak/kuitansi.
3. **Pengaturan → Finance** — metode bunga default, tenor maksimum, kebijakan uang muka,
   hari kerja & hari libur, batas umur piutang.
4. **Pengaturan → Penalty** — aktifkan aturan denda beserta masa tenggang dan batas maksimum.
5. **Pengaturan → Users** — undang petugas (memerlukan Edge Function `invite-user`, lihat langkah 8).

---

## 8. Kanal pengingat (opsional)

Antrean pengingat sudah berfungsi tanpa provider (kanal `IN_APP` selalu tersedia).
Untuk WhatsApp/email:

```bash
supabase functions deploy invite-user
supabase functions deploy reminder-dispatch --no-verify-jwt
supabase secrets set \
  WAHASENDER_API_URL="https://api.wahasender.com/api/send-message" \
  WAHASENDER_API_KEY="<kunci-provider>" \
  EMAIL_API_URL="https://api.resend.com/emails" \
  EMAIL_API_KEY="<kunci-provider>" \
  EMAIL_FROM="KreditKu <no-reply@domain-anda.id>" \
  REMINDER_CRON_SECRET="<string-acak-panjang>" \
  APP_REDIRECT_URL="https://<domain-anda>/"
```

Setelah itu:

1. **Pengaturan → Integrations** — aktifkan kanal, isi nama pengirim, **matikan mode simulasi**.
2. **Pengingat → Template** — sesuaikan isi pesan (gunakan bahasa yang sopan).
3. Jadwalkan pemanggilan fungsi (pilih salah satu):
   - **Supabase Cron / pg_cron**:
     ```sql
     select cron.schedule('kreditku-reminder', '0 1 * * *', $$
       select net.http_post(
         url := 'https://<project-ref>.functions.supabase.co/reminder-dispatch',
         headers := jsonb_build_object('x-cron-secret', '<REMINDER_CRON_SECRET>')
       );
     $$);
     ```
   - **GitHub Actions terjadwal** (contoh `cron: '0 1 * * *'`) yang memanggil endpoint
     dengan header `x-cron-secret`.

Selama mode simulasi aktif atau kredensial belum diisi, pengingat ditandai `SKIPPED`
dengan alasan yang jelas — sistem **tidak** mengklaim pesan terkirim.

---

## 9. Penyelesaian

```bash
npm run build                     # build produksi
npm run verify:deploy -- --dir dist
```

Lanjutkan ke [DEPLOY.md](./DEPLOY.md) untuk publikasi ke GitHub Pages.

---

## Pemecahan masalah

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| Layar "Aplikasi belum dikonfigurasi" | `.env` belum lengkap | `npm run setup`, lalu muat ulang |
| "Email atau password salah" padahal benar | Akun belum dibuat / belum dikonfirmasi | Jalankan `npm run bootstrap:admin` atau konfirmasi email pada dashboard Supabase |
| Akun login tetapi diarahkan ke halaman "belum terhubung ke organisasi" | Belum ada baris `organization_members` | Undang melalui **Pengaturan → Pengguna** (Super Admin) |
| Halaman kosong tanpa data | RLS memblokir atau user belum punya organisasi aktif | `npm run db:check`, periksa role pada **Pengaturan → Pengguna** |
| `permission denied for table …` | Kebijakan RLS belum terpasang | Jalankan ulang `20260101000006_rls.sql` |
| Migrasi gagal "already exists" | Dijalankan pada database yang sudah termigrasi | Aman — migrasi idempoten. Periksa pesan spesifiknya. |
| Tombol ekspor hilang | Role Anda Viewer/Auditor | Gunakan peran dengan izin `exports.create` |
| Pembayaran ditolak "melebihi kewajiban" | Nominal > sisa tagihan | Kecilkan nominal atau aktifkan kebijakan kelebihan bayar (Admin) |
| Denda tidak muncul | Aturan denda belum diaktifkan / masih dalam masa tenggang | **Pengaturan → Penalty**, lalu **Denda → Hitung Ulang** |
| Pengingat berstatus SKIPPED | Provider belum dikonfigurasi / mode simulasi aktif | Konfigurasi kanal pada **Pengaturan → Integrations** |

---

## Pemulihan & backup

Lihat [SECURITY.md](./SECURITY.md) bagian **Backup dan pemulihan**. Ringkasnya:
aktifkan backup harian pada Supabase, uji pemulihan pada proyek terpisah, dan
ekspor berkala tabel kritis (`credit_contracts`, `installments`, `payments`,
`payment_allocations`, `penalties`, `audit_logs`).
