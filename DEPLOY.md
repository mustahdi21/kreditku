# DEPLOY.md — Deployment KreditKu

Deployment utama menggunakan **GitHub Actions → GitHub Pages**, dengan Supabase sebagai
database dan layanan autentikasi.

---

## 1. Ringkasan alur

```
git push (branch main)
   └─ GitHub Actions: lint → typecheck → test → build → verifikasi artefak
        └─ upload artifact → deploy ke GitHub Pages
             └─ verifikasi manual oleh pemilik akun
```

Berkas terkait:

- `.github/workflows/ci.yml` — validasi pull request & branch lain.
- `.github/workflows/deploy-pages.yml` — build & deploy ke GitHub Pages.
- `scripts/deploy.mjs` — menjalankan pemeriksaan yang sama secara lokal.
- `scripts/verify-deploy.mjs` — memverifikasi hasil deployment & memindai kebocoran rahasia.

---

## 2. Publikasi repositori

```bash
git init -b main                     # bila belum
git add .
git commit -m "feat: KreditKu credit management system"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Dengan GitHub CLI:

```bash
gh repo create <repo> --private --source . --push
```

---

## 3. Konfigurasi GitHub Pages & secrets

**Settings → Pages → Source: GitHub Actions.**

**Settings → Secrets and variables → Actions:**

| Jenis | Nama | Wajib | Keterangan |
|---|---|---|---|
| Secret | `VITE_SUPABASE_URL` | ya | Project URL Supabase |
| Secret | `VITE_SUPABASE_ANON_KEY` | ya | anon/publishable key — **publik**, keamanan dijaga RLS |
| Variable | `VITE_BASE_PATH` | kondisional | `/nama-repository/` untuk subpath; kosongkan untuk domain sendiri |
| Variable | `VITE_APP_NAME` | tidak | Nama tampilan aplikasi |

> **Peringatan penting.** Nilai `VITE_*` **ter-embed ke bundle** yang dapat diunduh siapa pun,
> jadi nilainya bukan rahasia. Yang **tidak boleh** dipasang:
>
> - `service_role key` (melewati seluruh RLS),
> - password database,
> - token WhatsApp / kredensial SMTP.
>
> Workflow akan **menolak build** bila kunci yang dipasang terdeteksi berperan `service_role`.

### Base path

- **Domain sendiri / root**: `VITE_BASE_PATH` dikosongkan (build memakai `/`).
- **GitHub Pages subpath** (`https://user.github.io/kreditku/`): `VITE_BASE_PATH=/kreditku/`.

Aplikasi memakai **HashRouter**, sehingga tautan dalam seperti
`https://user.github.io/kreditku/#/app/contracts/<id>` dapat dibuka langsung tanpa
konfigurasi penulisan ulang URL di sisi server.

---

## 4. Domain kustom (opsional)

1. **Settings → Pages → Custom domain** → isi domain, mis. `kreditku.contoh.id`.
2. Pada DNS: buat `CNAME` `kreditku` → `<user>.github.io`.
3. Tambahkan berkas `public/CNAME` berisi domain tersebut, lalu build ulang.
4. Setelah status **certificate issued**, aktifkan **Enforce HTTPS**.

---

## 5. Deployment manual (bila diperlukan)

```bash
npm run deploy -- --base /kreditku/
```

Perintah tersebut menjalankan: `env:check` → `lint` → `typecheck` → `test` → `build` →
pemindaian rahasia pada artefak. Hasil build berada di `dist/`.

Untuk mengunggah manual (mis. ke hosting internal), unggah isi folder `dist/` —
bukan folder proyek.

---

## 6. Verifikasi pasca-deployment

```bash
npm run verify:deploy -- --url https://<user>.github.io/<repo>/
```

Yang diperiksa otomatis:

1. Halaman utama merespons HTTP 200 dan memuat elemen `#root`.
2. Aset JavaScript dapat diunduh.
3. **Tidak ada rahasia** pada bundle (service_role, password DB, token provider, dsb.).
4. Service worker PWA dapat diakses (fitur offline).

Yang **harus** diverifikasi manual (hanya bisa dilakukan oleh pemilik akun):

1. Masuk dengan akun Super Admin nyata.
2. Dashboard menampilkan angka dari database (bukan nol karena error).
3. Tambah pelanggan → buat pengajuan → setujui → kontrak + jadwal cicilan terbentuk.
4. Catat pembayaran → kuitansi muncul → sisa piutang berkurang.
5. Uji isolasi organisasi: akun dari organisasi kedua tidak dapat melihat data organisasi pertama.
6. Operasi tanpa hak ditolak (mis. Kasir mencoba membuka Pembatalan Pembayaran).

---

## 7. Pembaruan aplikasi

```bash
git add .
git commit -m "feat: <perubahan>"
git push          # workflow berjalan otomatis
```

Setelah selesai, jalankan `npm run verify:deploy -- --url <URL>` kembali.
Pengguna akan menerima versi terbaru melalui `registerType: 'autoUpdate'` pada service worker PWA.

---

## 8. Rollback

```bash
# Opsi A — deploy ulang commit sebelumnya
git revert <commit> && git push

# Opsi B — deploy ulang artifact lama (Actions → pilih run → Re-run jobs)

# Opsi C — checklist platform
gh run list --workflow=deploy-pages.yml --limit 10
gh run rerun <run-id>
```

**Migrasi database tidak di-rollback secara otomatis.** Migrasi KreditKu bersifat aditif dan
idempoten; perhatikan urutan penerapan kode dan migrasi (terapkan migrasi lebih dahulu,
lalu deploy frontend).

---

## 9. Biaya dan batas platform

| Layanan | Catatan |
|---|---|
| GitHub Pages | Gratis untuk repositori publik; batas ukuran artefak 1 GB. Untuk repo privat diperlukan paket GitHub yang mendukung Pages. |
| GitHub Actions | Kuota menit berbeda untuk repo privat. Workflow ini ringan (±3–5 menit per run). |
| Supabase | Free tier cukup untuk uji coba & usaha kecil; proyek free tier dijeda setelah 7 hari tanpa aktivitas. Untuk produksi gunakan paket berbayar agar tidak dijeda. |

---

## 10. Portal pelanggan & pembayaran QRIS

Portal pelanggan adalah permukaan terpisah dari aplikasi admin, dengan masuk
sendiri. Alamatnya memakai basis aplikasi yang sama:

| Halaman | Alamat |
|---|---|
| Aplikasi admin | `<URL>/#/app` |
| Portal pelanggan | `<URL>/#/portal` |
| Masuk portal | `<URL>/#/portal/masuk` |

Yang boleh masuk portal hanya akun yang **terhubung ke sebuah baris pelanggan**.
Akun staf justru ditolak di sana, karena portal menampilkan data satu pelanggan,
bukan data usaha. Penautan akun dilakukan dari aplikasi admin lewat
`rpc_link_customer_account(p_customer_id, p_email)`.

### Fungsi Edge yang dibutuhkan

| Fungsi | Verify JWT | Secret | Alasan |
|---|---|---|---|
| `invite-user` | `true` | — | Dipanggil dari aplikasi dengan sesi pengguna. |
| `qris-confirm` | **`false`** | `QRIS_WEBHOOK_SECRET` | Dipanggil MacroDroid di HP merchant, yang tidak punya sesi Supabase. Satu-satunya penjaga adalah secret tersebut — pakai nilai acak panjang. |

Nilai `verify_jwt` juga tercatat di `supabase/config.toml` supaya penerapan
berikutnya tidak bergantung pada mengingat sakelarnya di dashboard.

### Pengaturan integrasi

```sql
update public.app_settings
   set integrations = integrations
     || jsonb_build_object(
          'qrisStaticPayload', '<payload QRIS statis merchant>',
          'qrisNotifMarker', '<potongan kata yang selalu muncul pada notifikasi bank>'
        )
 where organization_id = '<id organisasi>';
```

`qrisNotifMarker` harus diambil dari notifikasi nyata, bukan ditebak. Selama
penandanya belum tepat, setiap notifikasi tetap tersimpan dengan status
`BUKAN_QRIS` pada tabel `qris_confirmations`, sehingga teks aslinya dapat dibaca
lalu penandanya disesuaikan. Tidak ada notifikasi yang hilang.

### Makro MacroDroid

| Bagian | Nilai |
|---|---|
| Trigger | Notification Received, dari aplikasi bank/dompet digital pengirim notifikasi pembayaran |
| Action | HTTP Request, `POST https://<ref>.supabase.co/functions/v1/qris-confirm` |
| Header | `x-webhook-secret: <QRIS_WEBHOOK_SECRET>` dan `Content-Type: application/json` |
| Body | `{"notification": "[notification_text]"}` — sisipkan lewat magic text, jangan diketik manual |

Pembayaran hanya dicatat otomatis bila tepat **satu** tagihan terbuka bernominal
sama. Bila ada lebih dari satu, permintaannya dipindah ke status `REVIEW` untuk
ditinjau kasir — sistem tidak menebak, karena menebak berarti mencatat
pembayaran pada kontrak orang lain.

---

## 11. Checklist sebelum produksi

- [ ] `npm run db:check` lulus pada database produksi (RLS + rumus bunga).
- [ ] `npm run verify:deploy -- --url <URL>` lulus.
- [ ] `service_role key` tidak ada pada secret/variabel workflow frontend.
- [ ] Mode simulasi pengingat dinonaktifkan **hanya** setelah provider terkonfigurasi & diuji.
- [ ] Backup otomatis Supabase aktif dan prosedur pemulihan sudah diuji.
- [ ] Akun demo dari `seed.sql` tidak ada pada database produksi.
- [ ] Audit log berisi aktivitas nyata (`Pengaturan → Audit Log`).
- [ ] Kebijakan denda sudah disesuaikan dengan perjanjian & hukum yang berlaku.
- [ ] `qris-confirm` ter-deploy dengan Verify JWT dimatikan dan `QRIS_WEBHOOK_SECRET` terisi nilai acak panjang.
- [ ] `qrisStaticPayload` dan `qrisNotifMarker` sudah diisi dari QR merchant dan notifikasi bank yang nyata.
- [ ] Satu pembayaran QRIS nyata sudah diuji: notifikasi HP sampai cicilan tercatat lunas.
- [ ] Setiap pelanggan yang akan memakai portal sudah punya akun dan tertaut lewat `rpc_link_customer_account`.
