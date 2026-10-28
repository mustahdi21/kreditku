# KreditKu — Credit Management System

Aplikasi web manajemen kredit dan cicilan untuk usaha pembiayaan: pelanggan, pengajuan,
kontrak, jadwal cicilan, pembayaran (dengan alokasi & pembatalan), denda, pengingat,
laporan piutang, serta audit log.

- **Bahasa**: Indonesia · **Mata uang**: Rupiah (IDR) · **Zona waktu**: Asia/Jakarta
- **Frontend**: React + TypeScript + Vite + Tailwind CSS (PWA)
- **Backend**: Supabase (PostgreSQL + Auth + Row Level Security + Edge Functions)
- **Deployment**: GitHub Actions → GitHub Pages

> Status proyek: **siap dijalankan setelah konfigurasi Supabase**. Lihat
> [INSTALL.md](./INSTALL.md) untuk langkah instalasi dan [DEPLOY.md](./DEPLOY.md)
> untuk deployment. Keamanan dibahas pada [SECURITY.md](./SECURITY.md), dan
> daftar fitur beserta status pengujian pada [docs/STATUS.md](./docs/STATUS.md).

---

## Daftar isi

1. [Fitur](#fitur)
2. [Arsitektur](#arsitektur)
3. [Mulai cepat](#mulai-cepat)
4. [Perintah npm](#perintah-npm)
5. [Struktur proyek](#struktur-proyek)
6. [Perhitungan keuangan](#perhitungan-keuangan)
7. [Keamanan dan hak akses](#keamanan-dan-hak-akses)
8. [Batasan yang perlu diketahui](#batasan-yang-perlu-diketahui)

---

## Fitur

**Pelanggan**
CRUD + arsip, nomor pelanggan otomatis, pencarian & filter status, riwayat pengajuan/kontrak/pembayaran,
total piutang dan tunggakan per pelanggan.

**Pengajuan kredit**
Alur draft → diajukan → pemeriksaan → disetujui/ditolak/dibatalkan, riwayat perubahan status beserta
petugas, persetujuan membuat kontrak + jadwal cicilan secara otomatis dan atomik.
Pemisahan tugas (pengaju tidak dapat menyetujui pengajuannya sendiri) dapat diaktifkan.

**Simulator kredit**
Perhitungan pratinjau tanpa menyentuh database: tanpa bunga, bunga flat, dan bunga efektif (anuitas),
dengan penjelasan rumus, ekspor jadwal (CSV/XLSX/PDF).

**Kontrak**
Nomor kontrak otomatis, snapshot syarat kredit saat dibuat (perubahan pengaturan tidak mengubah kontrak lama),
cetak kontrak, ekspor jadwal, amandemen dengan snapshot sebelum/sesudah, pembatalan resmi.

**Cicilan & jatuh tempo**
Jadwal per kontrak, kalender jatuh tempo, daftar jatuh tempo hari ini/7 hari ke depan, tunggakan dengan
umur piutang (1–7, 8–30, 31–60, 61–90, >90 hari, batas dapat dikonfigurasi), penandaan cepat.

**Pembayaran**
Pencatatan transaksional di server: pembayaran penuh/sebagian/beberapa cicilan sekaligus, alokasi otomatis
(terlama dahulu, terbaru dahulu, atau manual), pelunasan denda, kuitansi bernomor unik, idempotency key
(mencegah pembayaran ganda), pembatalan (reversal) dengan alasan dan audit trail. Data pembayaran yang sudah
diposting tidak dapat diubah atau dihapus.

**Denda & penagihan**
Denda nominal per hari/per cicilan atau persentase per hari/per bulan, masa tenggang, batas maksimum,
pembebasan denda dengan persetujuan dan alasan. Satu cicilan hanya memiliki satu catatan denda sehingga
tidak pernah dikenakan ganda.

**Pengingat**
Antrean pengingat H-7/H-3/H-1/hari H/setelah jatuh tempo melalui kanal WhatsApp, email, dan notifikasi
dalam aplikasi, lengkap dengan template yang dapat diedit, status pengiriman, dan mode simulasi yang
jujur (pesan tidak diklaim terkirim bila provider belum dikonfigurasi).

**Dashboard & laporan**
Metrik dihitung server-side dari database (bukan angka contoh): piutang berjalan, tunggakan, denda,
pembayaran, pencairan, tingkat tepat waktu, rasio kredit bermasalah, distribusi umur piutang.
Laporan pelanggan, pengajuan, kredit aktif, pencairan, piutang, pembayaran, tunggakan, denda, pelunasan,
arus kas, pendapatan bunga, kinerja petugas, dan audit aktivitas — semuanya dapat diekspor ke CSV/XLSX/PDF
dan dicetak.

**Administrasi**
5 role (Super Admin, Admin, Petugas Kredit, Kasir, Viewer/Auditor), isolasi data antar organisasi
(multi-tenant), pusat notifikasi, halaman pengaturan lengkap, dan audit log append-only.

---

## Arsitektur

```
Browser (React PWA)
   │  anon key + JWT pengguna  (kunci publik, dilindungi RLS)
   ▼
Supabase
   ├─ Auth            → sesi, undangan, reset password
   ├─ PostgreSQL      → skema, constraint, trigger, view laporan
   ├─ RLS             → isolasi organisasi + pembatasan role
   ├─ Fungsi RPC      → pembayaran, persetujuan, denda, amandemen (transaksional + audit)
   └─ Edge Functions  → invite-user, reminder-dispatch (service role hanya di server)
```

Keputusan penting:

1. **Angka uang adalah integer Rupiah.** Tidak ada floating point pada domain bisnis
   (`src/lib/money.ts`). Pembulatan selalu eksplisit (default HALF_UP).
2. **Logika finansial ada di dua tempat dan dijaga tetap sama**: TypeScript untuk
   pratinjau/simulasi, PostgreSQL untuk penciptaan kontrak (sumber kebenaran). Kesesuaian
   keduanya diuji oleh `npm run db:check`.
3. **Penulisan data keuangan hanya melalui fungsi server.** Tabel `payments`,
   `payment_allocations`, `penalties`, dan `installments` diproteksi trigger: perubahan
   langsung dari klien ditolak.
4. **Tidak ada penghapusan permanen.** Data bisnis diarsipkan/dibatalkan, bukan dihapus.

---

## Mulai cepat

```bash
# 1. Pasang dependencies
npm install

# 2. Wizard konfigurasi (membuat .env, menguji koneksi, menjalankan migrasi, verifikasi RLS)
npm run setup

# 3. Buat Super Admin pertama
npm run bootstrap:admin

# 4. Jalankan aplikasi
npm run dev            # http://localhost:5173
```

Panduan rinci: [INSTALL.md](./INSTALL.md).

---

## Perintah npm

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Menjalankan aplikasi pengembangan |
| `npm run build` | Pemeriksaan tipe + build produksi ke `dist/` |
| `npm run preview` | Pratinjau hasil build secara lokal |
| `npm run lint` | ESLint |
| `npm run typecheck` | Pemeriksaan tipe TypeScript (strict) |
| `npm test` | Unit test logika keuangan & aturan bisnis |
| `npm run test:coverage` | Unit test + laporan cakupan |
| `npm run env:check` | Memeriksa kesiapan lingkungan (termasuk deteksi kunci berbahaya) |
| `npm run sql:check` | Memeriksa sintaks berkas migrasi SQL (memerlukan `sqlglot`) |
| `npm run db:check` | Memverifikasi tabel, RLS, dan kesesuaian rumus bunga di database |
| `npm run setup` | Wizard konfigurasi interaktif |
| `npm run bootstrap:admin` | Membuat Super Admin pertama (password diketik lokal) |
| `npm run deploy` | Lint + typecheck + test + build + verifikasi artefak |
| `npm run verify:deploy -- --url <URL>` | Memverifikasi hasil deployment dan memindai kebocoran rahasia |
| `npm run icons:generate` | Membuat ulang ikon PWA (tanpa dependensi tambahan) |
| `npm run audit:deps` | Memeriksa kerentanan dependency |

---

## Struktur proyek

```
src/
  core/        logika domain murni + pengujiannya (uang, bunga, jadwal, denda, alokasi, status, metrik, validasi)
  lib/         utilitas (money, date, exports, errors, env, supabase client, queryClient)
  data/        lapisan akses data (React Query + Supabase) — halaman tidak memanggil Supabase langsung
  auth/        AuthProvider, matriks izin
  components/  ui (primitif), common (domain), data (DataTable), layout (AppShell)
  pages/       halaman per domain
supabase/
  migrations/  skema, fungsi bisnis, trigger, view, RLS, operasi lanjutan
  functions/   edge functions (invite-user, reminder-dispatch)
  seed.sql     data contoh khusus pengembangan
scripts/       wizard, verifikasi, ikon, pemeriksa SQL
docs/          konvensi frontend, status fitur, panduan backup
.github/       workflow CI dan deployment GitHub Pages
```

---

## Perhitungan keuangan

Format penyimpanan: **integer Rupiah**. Tarif bunga disimpan dalam **basis point**
(1% = 100 bp) beserta basisnya (per bulan / per tahun).

| Metode | Rumus |
|---|---|
| Tanpa bunga | Pokok dibagi rata; periode terakhir menyerap selisih pembulatan. |
| Bunga flat | Bunga per periode = `round(pokok × tarif)`; total bunga = bunga per periode × tenor. |
| Bunga efektif (anuitas) | `A = P × i ÷ (1 − (1+i)^−n)`; bunga dihitung dari **sisa pokok berjalan**. |

Konversi tarif mengikuti jumlah periode per tahun dari frekuensi pembayaran
(bulanan 12, dua mingguan 26, mingguan 52, harian 365):

- tarif per periode (basis per bulan) = `bp × 12 ÷ periodePerTahun`
- tarif per periode (basis per tahun) = `bp ÷ periodePerTahun`

Pembulatan: seluruh komponen dibulatkan ke Rupiah penuh (default HALF_UP);
pokok periode terakhir menyerap selisih sehingga `Σ pokok = pokok pembiayaan` **selalu tepat**.

**Definisi metrik** (diimplementasikan pada `src/core/metrics.ts` dan `rpc_dashboard_metrics`):
piutang berjalan, tunggakan, pencairan, pendapatan bunga, arus kas, tingkat tepat waktu, dan
rasio kredit bermasalah dipisahkan secara eksplisit. Seluruh penerimaan kas **bukan** keuntungan —
pokok yang kembali adalah pengembalian modal, sedangkan pendapatan terdiri dari bunga, biaya
administrasi, dan denda.

---

## Keamanan dan hak akses

| Role | Ringkasan hak |
|---|---|
| Super Admin | Seluruh konfigurasi, pengguna, integrasi, audit log |
| Admin | Operasional penuh (pelanggan s.d. laporan); tidak dapat mengubah identitas usaha & integrasi |
| Petugas Kredit | Pelanggan, pengajuan, pengingat; tidak menyetujui pengajuannya sendiri |
| Kasir | Mencatat pembayaran; tidak mengubah/menghapus pembayaran (harus reversal) |
| Viewer / Auditor | Hanya membaca + audit log; tombol ekspor dinonaktifkan |

Penegakan dilakukan di **database** (RLS + pemeriksaan role pada fungsi `SECURITY DEFINER`),
bukan hanya di antarmuka. Rincian lengkap: [SECURITY.md](./SECURITY.md).

---

## Batasan yang perlu diketahui

1. **Pembayaran bersifat pencatatan manual.** Tidak ada payment gateway yang terintegrasi.
   Pembayaran tidak diklaim "terverifikasi otomatis" oleh sistem.
2. **Pengingat WhatsApp/email** memerlukan kredensial provider (Edge Function secret).
   Selama mode simulasi aktif, pesan **tidak** dikirim dan statusnya ditandai `SKIPPED`.
3. **GitHub Pages adalah hosting statis.** Seluruh operasi sensitif (persetujuan, pembayaran,
   denda) berjalan di database melalui fungsi RPC — bukan di browser.
4. **Upload dokumen** memerlukan bucket Storage yang harus dibuat oleh pemilik proyek;
   formulir menyediakan kolom path, bukan unggahan palsu.
5. **Aplikasi memakai HashRouter** (`/#/app/...`) agar tautan dalam tetap bekerja pada
   hosting statis tanpa penulisan ulang URL di sisi server.

---

## Lisensi

Perangkat lunak internal. Sesuaikan dengan kebijakan organisasi Anda sebelum digunakan
untuk data pelanggan nyata.
