# SECURITY.md — Keamanan, Hak Akses, dan Pemulihan Data

Dokumen ini menjelaskan model keamanan KreditKu, kontrol yang diterapkan, dan prosedur
operasional yang harus diikuti.

---

## 1. Prinsip utama

1. **Keamanan ditegakkan di database, bukan di antarmuka.** Menyembunyikan tombol hanya
   kosmetik; setiap operasi tetap divalidasi ulang oleh Row Level Security dan fungsi
   `SECURITY DEFINER` yang memeriksa keanggotaan organisasi serta role pemanggil.
2. **Rahasia tidak pernah berada di frontend.** Yang ter-embed ke bundle hanya
   `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (keduanya publik dan dilindungi RLS).
3. **Data keuangan tidak dapat dihapus permanen.** Penghapusan diblokir trigger; koreksi
   dilakukan melalui prosedur resmi (pembatalan cicilan, reversal pembayaran, pembatalan kontrak).
4. **Semua perubahan penting tercatat.** Audit log append-only untuk data master dan konfigurasi,
   plus log transaksional pada setiap pembayaran/pembatalan/pembebasan denda.

---

## 2. Matriks hak akses

| Kemampuan | Super Admin | Admin | Petugas Kredit | Kasir | Viewer |
|---|---|---|---|---|---|
| Melihat dashboard & laporan | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ekspor data (CSV/XLSX/PDF) | ✔ | ✔ | ✔ | ✔ | — |
| Mengelola pelanggan | ✔ | ✔ | ✔ | — | — |
| Membuat pengajuan | ✔ | ✔ | ✔ | — | — |
| Menyetujui/menolak pengajuan | ✔ | ✔ | — | — | — |
| Mengelola kontrak (amandemen/batal) | ✔ | ✔ | — | — | — |
| Mencatat pembayaran | ✔ | ✔ | — | ✔ | — |
| Membatalkan (reversal) pembayaran | ✔ | ✔ | — | — | — |
| Menghitung denda | ✔ | ✔ | — | — | — |
| Membebaskan denda | ✔ | ✔ | — | — | — |
| Mengelola pengingat | ✔ | ✔ | ✔ | ✔ | — |
| Mengubah identitas usaha | ✔ | — | — | — | — |
| Mengubah integrasi (kanal/kunci) | ✔ | — | — | — | — |
| Mengelola pengguna & role | ✔ | — | — | — | — |
| Melihat audit log | ✔ | ✔ | — | — | ✔ |
| Mengubah pengaturan keuangan/denda | ✔ | ✔ | — | — | — |

Ketentuan tambahan:

- **Pemisahan tugas**: bila `require_separate_approver` aktif, pengaju **tidak dapat**
  menyetujui pengajuannya sendiri.
- **Super Admin terakhir** tidak dapat dinonaktifkan atau diturunkan rolenya.
- **Viewer/Auditor** hanya membaca; tombol ekspor dinonaktifkan.

Implementasi: `src/auth/permissions.ts` (tampilan) dan
`supabase/migrations/20260101000006_rls.sql` + `…_functions.sql` (penegakan).

---

## 3. Kontrol keamanan yang diterapkan

### 3.1 Row Level Security

- RLS aktif pada **seluruh** tabel bisnis (22 tabel).
- Setiap kebijakan bergantung pada `fn_current_org()` — fungsi `SECURITY DEFINER` yang hanya
  mengembalikan organisasi milik pengguna yang sedang login.
- Tabel `number_sequences` **tanpa kebijakan** sama sekali (hanya fungsi internal yang dapat
  mengakses), sehingga penomoran tidak dapat dimanipulasi klien.
- Tidak ada kebijakan `DELETE` pada tabel data (diperkuat trigger `fn_block_hard_delete`).

### 3.2 Pemisahan peran database

- `anon` → hanya dapat membaca objek publik yang diizinkan; fungsi bisnis `revoke` dari `anon`.
- `authenticated` → mengakses data sesuai RLS; fungsi bisnis dapat dipanggil tetapi selalu
  memeriksa keanggotaan + role.
- `service_role` → hanya dipakai Edge Function & skrip lokal (bootstrap, migrasi).

### 3.3 Integritas transaksi keuangan

- Pencatatan pembayaran, reversal, denda, dan persetujuan berjalan **dalam satu transaksi**
  (`rpc_post_payment`, `rpc_reverse_payment`, `rpc_apply_penalties`, `rpc_decide_application`).
- **Idempotensi**: `unique (organization_id, idempotency_key)`; permintaan dengan kunci sama
  mengembalikan pembayaran yang sudah ada, sehingga klik ganda tidak menghasilkan pembayaran ganda.
- **Locking**: baris kontrak dikunci (`SELECT … FOR UPDATE`) selama pembayaran diproses,
  mencegah perhitungan saldo yang salah pada permintaan paralel.
- **Constraint**: `total_due = principal + interest + fees`,
  `total_payable = principal + total_interest + total_fees`,
  `Σ pokok jadwal = pokok pembiayaan` (divalidasi fungsi), `paid_amount + waived_amount ≤ amount`
  pada denda, dan `unique (contract_id, installment_number)`.
- **Trigger pelindung**: perubahan `payments`, `payment_allocations`, `penalties`, dan kolom
  finansial `installments` ditolak kecuali berasal dari fungsi internal (GUC
  `kreditku.internal_write`).

### 3.4 Validasi & input

- Validasi klien: Zod (`src/core/validation.ts`).
- Validasi server: constraint, pemeriksaan tipe, pembatasan panjang/rentang, pemeriksaan role.
- Pencarian PostgREST dibersihkan dari karakter bermakna (`sanitizeSearchTerm`).
- Pesan error tidak membocorkan detail internal (`src/lib/errors.ts` memetakan SQLSTATE ke pesan ramah).

### 3.5 Autentikasi & sesi

- Supabase Auth (email + password), sesi PKCE, refresh token otomatis, penyimpanan pada
  kunci terpisah `kreditku.auth`.
- Password minimum 10 karakter + kombinasi huruf/angka (kebijakan aplikasi), hash bcrypt di sisi server.
- Reset password melalui email; tautan pemulihan memakai sesi sementara.
- Pembatasan percobaan login mengikuti kebijakan bawaan Supabase Auth
  (aktifkan **Auth → Rate Limits** dan captcha sesuai kebutuhan).

### 3.6 Rahasia & konfigurasi

- Hanya kunci publik pada variabel `VITE_*`; `npm run env:check` menolak `service_role key`.
- Workflow deployment menolak build bila kunci yang dipasang berperan `service_role`.
- `verify-deploy.mjs` memindai bundle terhadap pola rahasia (service_role, connection string,
  token provider, SMTP, AWS key, private key) sebelum dan sesudah deployment.
- Edge Function membaca rahasia dari environment server (Supabase secrets), bukan dari klien.

### 3.7 Audit trail

- Trigger `fn_audit_row` mencatat sebelum/sesudah pada: `organizations`, `organization_members`,
  `customers`, `credit_products`, `credit_applications`, `credit_contracts`,
  `credit_contract_amendments`, `app_settings`, `document_templates`, `reminder_templates`.
- Fungsi bisnis mencatat aksi eksplisit: `APPROVE`, `REJECT`, `CANCEL`, `POST_PAYMENT`,
  `REVERSE_PAYMENT`, `WAIVE_PENALTY`, `SETTINGS_CHANGE`, `INVITE_USER`, `ACTIVATE_USER`,
  `DEACTIVATE_USER`.
- `audit_logs` tidak memiliki kebijakan tulis/ubah/hapus — hanya bisa dibaca role berwenang.
- Audit log memuat `actor_id`, `actor_email`, dan `ip_address` (bila tersedia dari proxy).

---

## 4. Yang TIDAK dilakukan sistem ini

| Hal | Alasan |
|---|---|
| Menyimpan password pengguna | Ditangani Supabase Auth (hash bcrypt) |
| Memakai kartu kredit / payment gateway | Pembayaran dicatat manual; tidak ada klaim verifikasi otomatis |
| Mengirim pesan bila provider belum dikonfigurasi | Pengingat ditandai `SKIPPED` dengan alasan yang jelas |
| Mengunggah dokumen tanpa bucket Storage | Formulir hanya menyediakan kolom path; unggahan tidak dipalsukan |
| Menghapus data keuangan | Diblokir trigger; tersedia prosedur koreksi resmi |
| Menyimpan rahasia pada localStorage/sessionStorage | Hanya preferensi UI & cache React Query yang tersimpan di memori |

---

## 5. Prosedur koreksi data (tidak menghapus riwayat)

| Kasus | Prosedur resmi |
|---|---|
| Salah mencatat nominal pembayaran | **Pembayaran → Detail → Batalkan Pembayaran** (alasan wajib). Saldo dihitung ulang; pembayaran asal tetap tersimpan dengan status `REVERSED` dan nomor pembatalan. |
| Cicilan perlu dibatalkan (belum dibayar) | **Kontrak → Jadwal Cicilan → Batal** dengan alasan. |
| Kontrak dibatalkan | **Kontrak → Batalkan Kontrak**; sistem menolak bila sudah ada pembayaran (lakukan reversal terlebih dahulu). |
| Syarat kredit berubah | **Kontrak → Amandemen** dengan alasan, snapshot sebelum/sesudah tersimpan. Jadwal hanya dapat dibentuk ulang bila belum ada pembayaran. |
| Denda perlu dikurangi | **Denda → Bebaskan Denda** (alasan wajib, tercatat beserta pelaksana). |
| Pelanggan tidak aktif | **Pelanggan → Arsipkan** (bukan dihapus). |

---

## 6. Operasional keamanan

### Wajib sebelum digunakan dengan data nyata

- [ ] Batasi akses dashboard Supabase (2FA untuk semua pemilik akun).
- [ ] Aktifkan **Auth → Rate Limits**; pertimbangkan captcha pada halaman masuk.
- [ ] Terapkan **kebijakan password bawaan Supabase** yang lebih ketat bila diperlukan.
- [ ] Pastikan hanya role berwenang yang memiliki akun; tinjau daftar pengguna setiap kuartal.
- [ ] Aktifkan **Point-in-Time Recovery / Backup harian** pada Supabase.
- [ ] Periksa audit log secara berkala (minimal bulanan).
- [ ] Jalankan `npm audit --audit-level=high` dan `npm run audit:deps` sebelum rilis.

### Rotasi rahasia

| Rahasia | Kapan dirotasi | Cara |
|---|---|---|
| Password akun pengguna | Secara berkala / saat ada indikasi kebocoran | Reset password oleh pengguna |
| `service_role key` | Bila pernah terlihat pada log/screenshot | Supabase → Project Settings → API → **Reset**; perbarui Supabase secrets & `.env` lokal |
| Kunci provider WhatsApp/email | Sesuai kebijakan penyedia (mis. 90 hari) | Terbitkan kunci baru, perbarui `supabase secrets`, cabut kunci lama |
| `REMINDER_CRON_SECRET` | Berkala | Ganti secret, perbarui pemanggil penjadwal |
| Password database | Berkala | Supabase → Database → Reset password; perbarui `SUPABASE_DB_URL` lokal |

---

## 7. Backup dan pemulihan

### Backup

1. **Supabase**: aktifkan backup harian (paket berbayar juga menyediakan Point-in-Time Recovery).
2. **Ekspor berkala** tabel kritis (mis. mingguan) menggunakan connection string lokal:

   ```bash
   pg_dump "$SUPABASE_DB_URL" \
     --data-only --no-owner --no-privileges \
     -t public.credit_contracts -t public.installments -t public.payments \
     -t public.payment_allocations -t public.payment_reversals -t public.penalties \
     -t public.customers -t public.audit_logs \
     -f backup-kreditku-$(date +%Y%m%d).sql
   ```

3. Simpan hasil ekspor pada penyimpanan terenkripsi di luar laptop kerja.
4. Simpan `supabase/migrations` sebagai bagian dari repositori (sudah termasuk) agar
   skema selalu dapat dibangun ulang.

### Pemulihan

1. Buat proyek Supabase baru (jangan menimpa proyek yang masih dipakai).
2. Jalankan seluruh migrasi berurutan.
3. Pulihkan data: melalui fitur restore Supabase, atau `psql "$SUPABASE_DB_URL" -f backup-….sql`.
4. Jalankan `npm run db:check` (RLS + rumus bunga).
5. Verifikasi **konsistensi saldo** setelah pemulihan:

   ```sql
   -- Total terbayar pada kontrak harus sama dengan jumlah alokasi pembayaran POSTED.
   select c.contract_number,
          c.total_paid,
          coalesce(sum(a.amount) filter (where p.status = 'POSTED'), 0) as alokasi_aktif
     from public.credit_contracts c
     left join public.payment_allocations a on a.installment_id in (
            select id from public.installments where contract_id = c.id)
     left join public.payments p on p.id = a.payment_id
    group by c.id, c.contract_number, c.total_paid
   having c.total_paid <> coalesce(sum(a.amount) filter (where p.status = 'POSTED'), 0);
   ```

   Kueri di atas harus **tidak mengembalikan baris**. Bila ada, perbaiki dengan
   `select public.fn_refresh_contract(id) from public.credit_contracts where …`.
6. Perbarui `.env`/secret bila proyek baru memiliki URL & kunci berbeda.

---

## 8. Pelaporan insiden

1. Nonaktifkan akun yang dicurigai (**Pengaturan → Pengguna → Nonaktifkan**).
2. Periksa **Audit Log** pada rentang waktu terkait (filter entitas & pelaku).
3. Bila kredensial server bocor: rotasi `service_role`, password database, dan kunci provider.
4. Bila pembayaran mencurigakan: batalkan melalui prosedur reversal (riwayat tetap tersimpan),
   lalu cocokkan dengan bukti transfer fisik.
5. Dokumentasikan temuan, dampak, dan tindakan perbaikan.

---

## 9. Batasan yang diketahui

- Pembayaran bersifat pencatatan manual; tidak ada verifikasi otomatis dari bank/gateway.
- Tidak ada pembatasan laju (rate limiting) khusus pada API bisnis selain yang disediakan
  platform Supabase; gunakan batas platform atau tambahkan di tingkat proxy bila diperlukan.
- Perlindungan CSRF bersandar pada model token bearer (Authorization header), bukan cookie,
  sehingga tidak rentan terhadap CSRF klasik; jangan mengubah konfigurasi menjadi cookie-based
  tanpa menambahkan proteksi tambahan.
- Enkripsi data pribadi tingkat kolom (mis. nomor identitas) belum diterapkan; gunakan
  penyimpanan terenkripsi pada tingkat database/disk dan batasi akses role.
- Audit log menyimpan nilai kolom pada saat perubahan; kolom sensitif (nomor identitas)
  akan tercatat pada log perubahan — batasi akses `audit_logs` ke role berwenang saja.
