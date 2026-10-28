# STATUS.md — Status Implementasi, Pengujian, dan Langkah Manual

Dokumen ini adalah laporan **jujur** tentang apa yang sudah dikerjakan, apa yang sudah
diuji (beserta bukti perintahnya), dan apa yang masih memerlukan tindakan Anda.

Terakhir diperbarui: 2026-10-28 · Lingkungan verifikasi: macOS (darwin 22.6.0), Node.js v24.17.0,
PostgreSQL 16.15 lokal, tanpa koneksi ke proyek Supabase nyata.

---

## 1. Ringkasan

| Area | Status | Bukti |
|---|---|---|
| Skema database (22 tabel, 13 view, 99 fungsi) | **SELESAI & DIJALANKAN** | migrasi dijalankan 2× tanpa galat (idempoten) |
| Row Level Security | **SELESAI & DIUJI** | RLS aktif 22/22 tabel, 45 kebijakan, 0 kebijakan DELETE |
| Logika keuangan (bunga, jadwal, denda, alokasi) | **SELESAI & DIUJI** | 185 unit test lulus + 10 vektor paritas SQL↔TS |
| Alur uang end-to-end di database | **SELESAI & DIUJI** | 71 assertion integrasi lulus di PostgreSQL sungguhan |
| Frontend (28 halaman, PWA) | **SELESAI** | build produksi sukses, kode terpecah per halaman |
| Lint / Typecheck / Build | **LULUS** | 0 error ESLint, 0 error tsc, build 2,87 MB (gzip ± 500 KB total) |
| Pemindaian rahasia pada bundle | **LULUS** | 0 temuan pada 69 berkas `dist/` |
| Deployment GitHub Pages | **BELUM DIJALANKAN** | memerlukan akun GitHub Anda (lihat DEPLOY.md) |
| Koneksi ke Supabase sungguhan | **BELUM DIJALANKAN** | memerlukan proyek Supabase Anda |
| Pengiriman WhatsApp/email nyata | **BELUM DIJALANKAN** | memerlukan kredensial provider |

---

## 2. Cara menjalankan verifikasi ulang

```bash
# 1. Pemeriksaan lingkungan
npm run env:check

# 2. Sintaks berkas migrasi (memerlukan sqlglot: pip install sqlglot)
npm run sql:check

# 3. Kualitas kode
npm run lint
npm run typecheck
npm test                 # 185 lulus, 10 dilewati (tes paritas tanpa DB)

# 4. Database: struktur, RLS, paritas rumus bunga
#    (memerlukan SUPABASE_DB_URL pada .env)
npm run db:check

# 5. Uji integrasi alur uang (membatalkan seluruh perubahan di akhir)
npm run db:test

# 6. Build & pemindaian rahasia
npm run build
node scripts/verify-deploy.mjs --dir dist
```

### Menjalankan seluruh verifikasi tanpa proyek Supabase (seperti yang dilakukan di sini)

```bash
brew install postgresql@16
export PATH="/usr/local/opt/postgresql@16/bin:$PATH"
initdb -D /tmp/kreditku-pgdata -U postgres --encoding=UTF8 --locale=C
LC_ALL=C pg_ctl -D /tmp/kreditku-pgdata -o "-p 55432 -k /tmp" -l /tmp/kreditku-pg.log start
createdb -h 127.0.0.1 -p 55432 -U postgres kreditku_test

# Tiruan minimal lingkungan Supabase (skema auth + peran + auth.uid())
psql -h 127.0.0.1 -p 55432 -U postgres -d kreditku_test -f scripts/local-supabase-shim.sql

# Migrasi (idempoten — jalankan dua kali untuk membuktikannya)
for f in supabase/migrations/*.sql; do \
  psql -h 127.0.0.1 -p 55432 -U postgres -d kreditku_test -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done

# Verifikasi
export SUPABASE_DB_URL="postgresql://postgres@127.0.0.1:55432/kreditku_test"
npm run db:check
npm run db:test
```

> `scripts/local-supabase-shim.sql` **hanya** untuk pengujian lokal. Jangan dijalankan pada
> proyek Supabase sungguhan (objek `auth.*` sudah disediakan platform).

---

## 3. Hasil pengujian (angka nyata)

### 3.1 Unit test — `npm test`

```
Test Files  12 passed (12)
     Tests  185 passed | 10 skipped (195)
```

Cakupan: pembulatan Rupiah (HALF_UP/HALF_EVEN/FLOOR/CEIL), persentase eksak berbasis BigInt,
distribusi tanpa kehilangan 1 rupiah, bunga flat/anuitas/tanpa bunga, penyesuaian tanggal jatuh
tempo (akhir bulan, hari kerja, hari libur), denda (tenggang, batas maksimum, dasar persentase),
alokasi pembayaran (penuh/sebagian/beberapa cicilan/denda lebih dahulu/kelebihan bayar),
idempotency key, status cicilan & kontrak, ember umur piutang, penomoran dokumen,
skema validasi Zod, matriks hak akses, dan metrik dashboard.

10 tes yang **dilewati** tanpa database adalah tes paritas rumus bunga (`sql-parity.test.ts`) —
aktif otomatis ketika `SUPABASE_DB_URL` tersedia.

### 3.2 Paritas rumus bunga SQL ↔ TypeScript — `npm run db:check`

```
✓ src/core/sql-parity.test.ts (11 tests | 1 skipped)
  Tests  10 passed
✔ Rumus bunga PostgreSQL identik dengan implementasi TypeScript.
```

10 vektor uji membandingkan `public.fn_build_schedule` dengan `src/core/interest.ts`:
pokok, komponen biaya, dan tanggal jatuh tempo harus **identik**; komponen bunga boleh berbeda
maksimum 1 Rupiah per periode (perbedaan presisi floating point vs numeric) dengan total
selisih ≤ 5 Rupiah per kontrak.

### 3.3 Verifikasi struktur & RLS — `npm run db:check`

```
✔ Seluruh 22 tabel bisnis tersedia.
✔ Seluruh view laporan tersedia.
✔ Seluruh fungsi bisnis tersedia.
✔ RLS aktif pada 22/22 tabel bisnis.
✔ Setiap tabel bisnis memiliki kebijakan akses (number_sequences sengaja tertutup total).
! Terdapat kebijakan DELETE pada: credit_application_documents (disengaja: lampiran boleh dihapus admin)
✔ Tidak ada kebijakan DELETE pada data keuangan.
Total kebijakan terpasang: 45
```

### 3.4 Uji integrasi alur uang — `npm run db:test`

```
71 assertion LULUS · SELURUH UJI INTEGRASI LULUS
```

Yang dibuktikan (semua pada PostgreSQL sungguhan, dalam satu transaksi yang dibatalkan di akhir):

| Kelompok | Assertion kunci |
|---|---|
| Bootstrap | Super Admin pertama dibuat; organisasi + pengaturan bawaan; tercatat pada audit log |
| Penomoran | Nomor pelanggan mengikuti template `CUST-{YYYY}{MM}-{SEQ:n}` |
| Pemisahan tugas | Pengaju **tidak dapat** menyetujui pengajuannya sendiri |
| Persetujuan | 1 kontrak dibuat; total bunga 4.800.000; total kewajiban 24.800.000; 12 cicilan; Σ pokok = pokok pembiayaan; status ACTIVE; pelanggan otomatis ACTIVE; riwayat status tercatat |
| Pembayaran | Alokasi = nominal; total terbayar & sisa piutang tepat; cicilan berstatus PARTIAL |
| Idempotensi | Kunci sama → `duplicate: true`, tetap 1 baris pembayaran & 1 alokasi |
| Kelebihan bayar | Ditolak tanpa kebijakan khusus (pesan menyebut kelebihan yang diminta) |
| Otorisasi | Kasir **tidak boleh** membatalkan pembayaran |
| Denda | (10 hari − tenggang 3) × 10.000 = 70.000; hitung ulang tidak menggandakan; batas maksimum 50.000 dipatuhi; pembebasan → WAIVED + audit log |
| Pembatalan | Status REVERSED; saldo cicilan & total terbayar kembali ke nol; sisa piutang pulih; alokasi asli tetap tersimpan sebagai riwayat; pembatalan ganda ditolak |
| Pengingat | Membentuk antrean 2× tidak menggandakan data |
| Metrik | Pembayaran yang dibatalkan ≠ penerimaan; reversal tercatat terpisah; piutang = total kewajiban; tunggakan terdeteksi; denda dibebaskan tidak dihitung |
| RLS | Organisasi lain melihat 0 pelanggan/kontrak/pembayaran/cicilan; view tetap tunduk RLS; tanpa sesi tidak ada data; kasir tidak dapat membaca audit log |
| Trigger | Perubahan langsung `paid_amount`/`status` cicilan ditolak; perubahan nominal & penghapusan pembayaran tidak menghasilkan perubahan; penghapusan pelanggan & perubahan nilai denda ditolak |

### 3.5 Frontend

```
npm run lint       → 0 error, 10 warning (react-refresh pada berkas yang mengekspor helper + komponen)
npm run typecheck  → 0 error (TypeScript strict, noUnusedLocals)
npm run build      → sukses, 69 berkas, 2,87 MB (index 459 kB → 134 kB gzip)
node scripts/verify-deploy.mjs --dir dist → LULUS, 0 rahasia ter-embed
```

28 halaman: Login, Lupa/Reset Password, Setup, Tanpa Akses, 404, Dashboard, Pelanggan (daftar/form/detail),
Pengajuan (daftar/form/detail), Simulator, Kontrak (daftar/detail), Jadwal Cicilan,
Pembayaran (daftar/form/detail), Denda & Tunggakan, Pengingat, Laporan (13 laporan),
Notifikasi, Pengaturan (7 bagian + template dokumen), Pengguna, Audit Log, Profil.

---

## 4. Temuan nyata yang diperbaiki selama pengujian

Uji integrasi menemukan empat cacat yang tidak terlihat dari pemeriksaan statis:

1. **Kebocoran penanda penulisan internal.** Penanda berbasis pengaturan sesi membuat trigger
   pelindung tidak aktif pada sisa transaksi yang sama. Diganti dengan penanda berbasis identitas
   eksekusi (`current_user`): fungsi bisnis berjalan sebagai pemilik basis data sedangkan klien
   berperan `authenticated`, sehingga klien tidak dapat memalsukannya dan cakupannya otomatis
   terbatas pada pernyataan yang dijalankan fungsi internal.
2. **`rpc_enqueue_reminders` mereferensikan kolom yang salah** (`c.customer_id` alih-alih
   `ct.customer_id`) sehingga pembentukan antrean pengingat gagal saat dijalankan.
3. **Kolom view tidak dapat diubah urutannya** (`create or replace view` gagal saat migrasi
   dijalankan ulang). Kolom baru sekarang selalu ditambahkan di akhir daftar select agar migrasi
   tetap idempoten.
4. **Payload pengaturan `business` berpotensi tidak tersimpan** karena perbedaan penamaan kunci
   (camelCase dari formulir vs snake_case di database). `rpc_update_settings` kini menerima kedua
   bentuk dan memvalidasi kode organisasi sebelum menyimpan.

Tambahan perbaikan integrasi dari laporan agen pembangun halaman:

5. `v_customer_summary` kini memuat data pribadi lengkap (nomor identitas, alamat, tanggal lahir,
   pekerjaan, penghasilan, kontak darurat, catatan) sehingga tab Ringkasan pada halaman pelanggan
   menampilkan data sebenarnya.
6. `DataTable` memiliki mode `manualPagination` untuk tabel berpaginasi server.
7. `v_payment_breakdown` menyertakan nomor kontrak, nama pelanggan, dan nama petugas.
8. Modul data `src/data/documents.ts` + pengelola **Template Dokumen** pada Pengaturan
   (sebelumnya ditandai "belum tersedia" secara jujur oleh agen — sekarang benar-benar berfungsi).

---

## 5. Konfigurasi eksternal yang masih diperlukan

| # | Kebutuhan | Mengapa tidak bisa diotomatisasi | Panduan |
|---|---|---|---|
| 1 | Proyek Supabase (URL + anon key) | Memerlukan akun & otorisasi Anda | `npm run setup`, [INSTALL.md](../INSTALL.md) |
| 2 | `SUPABASE_DB_URL` | Berisi password database | [INSTALL.md](../INSTALL.md) §3 |
| 3 | Migrasi di proyek Supabase | Butuh kredensial di atas (atau tempel manual di SQL Editor) | `npm run setup` atau [INSTALL.md](../INSTALL.md) §4 |
| 4 | Super Admin pertama | Harus dijalankan setelah migrasi | `npm run bootstrap:admin` |
| 5 | Repositori GitHub + Pages + secrets | Memerlukan akun GitHub | [DEPLOY.md](../DEPLOY.md) §2–3 |
| 6 | Penyimpanan dokumen (bucket Storage) | Bucket belum dibuat; formulir hanya mencatat path | [SECURITY.md](../SECURITY.md) |
| 7 | Kredensial WhatsApp/SMTP | Rahasia milik akun Anda | [INSTALL.md](../INSTALL.md) §8 |
| 8 | Penjadwal pengingat (Cron) | Memerlukan proyek Supabase aktif | [INSTALL.md](../INSTALL.md) §8 |
| 9 | Penyesuaian kebijakan denda & format dokumen | Keputusan bisnis, bukan teknis | Menu Pengaturan |

---

## 6. Batasan yang diakui secara terbuka

1. **Belum pernah dijalankan terhadap proyek Supabase sungguhan.** Semua verifikasi database
   dilakukan pada PostgreSQL 16 lokal dengan tiruan skema `auth`. Perbedaan yang mungkin muncul
   di Supabase: kebijakan bawaan platform, ekstensi yang tersedia, dan perilaku PostgREST.
2. **Belum pernah di-deploy.** Belum ada URL aplikasi yang terverifikasi karena memerlukan
   akun GitHub Anda. Jangan menganggap deployment berhasil sebelum `npm run verify:deploy` lulus
   pada URL nyata.
3. **Pengingat WhatsApp/email belum pernah mengirim pesan nyata.** Selama mode simulasi aktif,
   sistem menandai pengingat `SKIPPED` dan tidak mengklaim pesan terkirim.
4. **Pembayaran bersifat pencatatan manual.** Tidak ada payment gateway; sistem tidak mengklaim
   verifikasi otomatis dari bank.
5. **Unggah bukti pembayaran belum aktif.** Kolom `proof_path` mencatat lokasi berkas; unggahan
   memerlukan bucket Storage yang harus dibuat lebih dahulu.
6. **Beberapa halaman mengambil maksimum 200–5000 baris** untuk tabel dan ekspor.
   Untuk volume besar, gunakan filter rentang tanggal.
7. **Ekspor mengambil baris yang sedang tampil** (setelah filter), bukan seluruh tabel.
8. **Audit log menyimpan nilai kolom sebelum/sesudah**, termasuk kolom pribadi. Akses dibatasi
   pada role berwenang (Super Admin, Admin, Viewer).
9. **10 peringatan ESLint** (aturan `react-refresh/only-export-components`) berasal dari berkas
   yang sengaja mengekspor komponen sekaligus helper (mis. `Toaster.tsx`) — bukan kesalahan.
10. **Tidak ada surat peringatan otomatis (SP) berjenjang**; pengingat hanya berupa pesan
    H-7/H-3/H-1/hari H/setelah jatuh tempo.

---

## 7. Checklist sebelum produksi

- [ ] `npm run db:check` lulus pada database produksi.
- [ ] `npm run db:test` lulus (uji integrasi pada transaksi yang dibatalkan).
- [ ] `npm run verify:deploy -- --url <URL>` lulus.
- [ ] Akun demo (`supabase/seed.sql`) tidak ada pada database produksi.
- [ ] RLS diuji dengan dua organisasi nyata (isolasi terbukti).
- [ ] Backup otomatis aktif dan prosedur pemulihan sudah dicoba pada proyek terpisah.
- [ ] Mode simulasi pengingat dinonaktifkan hanya setelah provider diuji.
- [ ] Kebijakan denda & format dokumen disesuaikan dengan perjanjian dan hukum yang berlaku.
- [ ] Role setiap pengguna ditinjau (terutama daftar Super Admin).
