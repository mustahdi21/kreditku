# DATABASE.md — Referensi Skema & Fungsi Database

Dokumen ini menjelaskan struktur database KreditKu, fungsi bisnis yang tersedia,
dan aturan yang ditegakkan di sisi server.

Sumber kebenaran: `supabase/migrations/*.sql`.

---

## 1. Urutan migrasi

| Berkas | Isi |
|---|---|
| `20260101000001_init.sql` | Ekstensi, tipe enum, 22 tabel bisnis, index, kolom audit |
| `20260101000002_functions.sql` | Utilitas organisasi/role, penomoran, rumus bunga & jadwal, status turunan |
| `20260101000003_business_functions.sql` | Pengajuan, kontrak, pembayaran, reversal, denda, pengingat, metrik dashboard |
| `20260101000004_triggers.sql` | Trigger pelindung data finansial, larangan hapus, audit otomatis |
| `20260101000005_views.sql` | 13 view pelaporan (security_invoker) |
| `20260101000006_rls.sql` | Kebijakan RLS + hak akses objek |
| `20260101000007_operations.sql` | Pengaturan, anggota, amandemen, pembatalan, notifikasi, bootstrap |

Seluruh migrasi **idempoten** dan dapat dijalankan ulang dengan aman.

---

## 2. Tabel utama

### Master & konfigurasi

| Tabel | Keterangan |
|---|---|
| `organizations` | Identitas usaha (nama, kode, kontak, mata uang, zona waktu) |
| `profiles` | Profil pengguna (terhubung `auth.users`), menandai organisasi aktif |
| `organization_members` | Keanggotaan + role per organisasi |
| `app_settings` | `numbering`, `finance`, `penalty`, `integrations`, `ui` (JSONB per bagian) |
| `number_sequences` | Penomoran atomik per organisasi/periode (tanpa akses klien) |
| `credit_products` | Template produk kredit |
| `document_templates`, `reminder_templates` | Template dokumen & pesan |

### Pelanggan & kredit

| Tabel | Keterangan |
|---|---|
| `customers` | Data pelanggan + nomor unik per organisasi + status |
| `credit_applications` | Pengajuan (harga, uang muka, pokok, tenor, metode, bunga, status) |
| `credit_application_status_history` | Riwayat perubahan status + pelaksana |
| `credit_application_documents` | Metadata dokumen lampiran (path Storage, MIME, ukuran) |
| `credit_contracts` | Kontrak: snapshot syarat kredit, total, saldo, status, tanggal |
| `credit_contract_amendments` | Snapshot sebelum/sesudah amandemen + alasan |
| `installments` | Jadwal cicilan per kontrak (pokok, bunga, biaya, tagihan, terbayar, status) |

### Transaksi keuangan

| Tabel | Keterangan |
|---|---|
| `payments` | Pembayaran: nomor kuitansi unik, idempotency key, status POSTED/REVERSED |
| `payment_allocations` | Alokasi pembayaran ke cicilan dan/atau denda (unik per pasangan) |
| `payment_reversals` | Catatan pembatalan pembayaran (nomor, alasan, pelaksana) |
| `penalties` | Denda: **satu baris per cicilan** (unique `installment_id`), nominal/bayar/bebas |
| `reminders` | Antrean pengingat (unik per cicilan + offset + kanal) |
| `notifications` | Notifikasi pengguna/organisasi |
| `audit_logs` | Audit append-only (aktor, aksi, entitas, sebelum/sesudah, metadata) |

### Constraint penting

```sql
-- installments
unique (contract_id, installment_number)
check (total_due = principal + interest + fees)

-- credit_contracts
unique (organization_id, contract_number)
check (principal = price - down_payment)
check (total_payable = principal + total_interest + total_fees)

-- credit_applications
check (down_payment <= price)
check (principal = price - down_payment)
check (not (method = 'NONE' and rate_bp <> 0))

-- payments
unique (organization_id, receipt_number)
unique (organization_id, idempotency_key)
check (amount > 0)

-- penalties
unique (installment_id)
check (paid_amount + waived_amount <= amount)
```

---

## 3. Fungsi bisnis (RPC)

Semua fungsi memeriksa keanggotaan organisasi dan role pemanggil sebelum menulis.

| Fungsi | Pemanggil berwenang | Kegunaan |
|---|---|---|
| `fn_next_number(p_key, p_period_key, p_doc_date, p_doc_type, p_org)` | Role dengan `can_write` | Membangkitkan nomor dokumen berikutnya (atomik) |
| `rpc_submit_application(p_application_id, p_note)` | Super Admin/Admin/Petugas | Mengajukan kredit untuk diperiksa |
| `rpc_decide_application(p_application_id, p_decision, p_reason, p_contract_number)` | Super Admin/Admin | Menyetujui (membuat kontrak + jadwal) atau menolak |
| `rpc_cancel_application(p_application_id, p_reason)` | Super Admin/Admin/Petugas | Membatalkan pengajuan tanpa kontrak |
| `rpc_post_payment(...)` | Super Admin/Admin/Kasir | Mencatat pembayaran + alokasi + pembaruan saldo (idempoten) |
| `rpc_reverse_payment(p_payment_id, p_reason)` | Super Admin/Admin | Membatalkan pembayaran & menghitung ulang saldo |
| `rpc_apply_penalties(p_org, p_as_of, p_contract_id)` | Super Admin/Admin | Menghitung/menyegarkan denda cicilan menunggak |
| `rpc_waive_penalty(p_penalty_id, p_amount, p_reason)` | Super Admin/Admin | Membebaskan (sebagian/seluruh) denda |
| `rpc_enqueue_reminders(p_org, p_as_of)` | Anggota organisasi | Membentuk antrean pengingat (deduplikasi) |
| `rpc_mark_reminder(p_reminder_id, p_status, p_error)` | Anggota organisasi | Mencatat hasil pengiriman pengingat |
| `rpc_cancel_installment(p_installment_id, p_reason)` | Super Admin/Admin | Membatalkan cicilan yang belum dibayar |
| `rpc_amend_contract(...)` | Super Admin/Admin | Amandemen kontrak + snapshot + (opsional) pembentukan ulang jadwal |
| `rpc_cancel_contract(p_contract_id, p_reason)` | Super Admin/Admin | Membatalkan kontrak (menolak bila sudah ada pembayaran) |
| `rpc_dashboard_metrics(p_from, p_to, p_org)` | Anggota organisasi | Metrik dashboard (JSONB) |
| `rpc_payment_series(p_from, p_to, p_org)` | Anggota organisasi | Deret pembayaran harian |
| `rpc_update_settings(p_section, p_value)` | Bagian `integrations` & `business`: Super Admin; lainnya: Admin | Memperbarui pengaturan dengan validasi |
| `rpc_register_member(p_user_id, p_email, p_full_name, p_role)` | Super Admin | Mendaftarkan anggota (dipanggil Edge Function `invite-user`) |
| `rpc_update_member(p_member_id, p_role, p_is_active)` | Super Admin | Mengubah role/status anggota (menjaga Super Admin terakhir) |
| `rpc_switch_organization(p_organization_id)` | Anggota | Mengganti organisasi aktif |
| `rpc_mark_notifications_read(p_ids)` | Anggota | Menandai notifikasi telah dibaca |
| `rpc_bootstrap_super_admin(...)` | `service_role` saja | Membuat Super Admin pertama (sekali saja) |

### Fungsi perhitungan murni (dapat dipanggil langsung)

| Fungsi | Kegunaan |
|---|---|
| `fn_round_half_up(numeric)` | Pembulatan setengah ke atas (menjauhi nol) |
| `fn_apply_rate(amount, rate_bp, divisor)` | Menerapkan tarif basis point ke nominal |
| `fn_rate_per_period(rate_bp, basis, frekuensi)` | Konversi tarif ke per periode |
| `fn_add_periods(date, count, frekuensi)` | Penambahan tanggal per periode (bulan dibatasi akhir bulan) |
| `fn_is_business_day`, `fn_adjust_due_date` | Kebijakan hari kerja & hari libur |
| `fn_build_schedule(...)` | Membentuk jadwal lengkap (pokok, bunga, biaya, tanggal) |
| `fn_installment_status(...)` | Status cicilan turunan dari fakta pembayaran + tanggal |
| `fn_aging_bucket(late_days, bounds)` | Ember umur tunggakan |

---

## 4. View pelaporan

Semuanya `security_invoker = true` sehingga RLS tabel dasar tetap berlaku.

| View | Isi |
|---|---|
| `v_customer_summary` | Pelanggan + jumlah kontrak, total piutang, tunggakan, jatuh tempo berikutnya |
| `v_contract_summary` | Kontrak + nama pelanggan, progres %, jumlah cicilan lunas/sebagian/terlambat, denda terbuka |
| `v_installment_details` | Cicilan + status turunan, hari terlambat, ember umur, denda terbuka, data pelanggan |
| `v_overdue_installments` | Cicilan menunggak (sisa > 0 dan melewati jatuh tempo) |
| `v_due_today` | Jatuh tempo hari ini |
| `v_upcoming_due` | Jatuh tempo ≤ 7 hari ke depan |
| `v_aging_report` | Agregat umur piutang per ember |
| `v_collection_daily`, `v_collection_monthly` | Rekap penerimaan & pembatalan per hari/bulan |
| `v_disbursement_report` | Laporan pencairan per kontrak |
| `v_payment_breakdown` | Pembayaran + rincian alokasi (cicilan vs denda) |
| `v_officer_performance` | Kinerja petugas (pembayaran, pengajuan, keputusan) |

---

## 5. Trigger & penegakan integritas

| Trigger | Tabel | Fungsi |
|---|---|---|
| `trg_protect_posted_payment` | `payments` | Menolak UPDATE nominal/kontrak/metode dan DELETE |
| `trg_protect_allocation` | `payment_allocations` | Menolak UPDATE/DELETE langsung |
| `trg_protect_reversal` | `payment_reversals` | Menolak UPDATE/DELETE langsung |
| `trg_protect_installment` | `installments` | Menolak perubahan nilai finansial/tanggal/relasi |
| `trg_protect_penalty` | `penalties` | Menolak perubahan nominal/bayar/bebas |
| `trg_block_hard_delete` | tabel data | Menolak DELETE permanen |
| `trg_audit_row` | tabel master | Mencatat audit otomatis (sebelum/sesudah) |
| `on_auth_user_created` | `auth.users` | Membuat baris `profiles` otomatis |
| `trg_*_updated_at` | seluruh tabel | Memperbarui `updated_at` |

Fungsi internal menandai penulisan yang sah dengan GUC `kreditku.internal_write`
(`fn_begin_internal_write()`), sehingga trigger dapat membedakan operasi resmi dari
percobaan manipulasi langsung.

---

## 6. Pola penambahan fitur baru

1. Tambahkan migrasi **baru** di `supabase/migrations/` dengan nama berurutan
   (`20260101000008_*.sql`). Jangan mengubah migrasi yang sudah dirilis.
2. Tambahkan tabel/kebijakan RLS, lalu **wajib** buat kebijakan untuk role terkait.
3. Bila menyentuh data keuangan: tambahkan fungsi RPC transaksional + pemanggilan audit
   (`fn_log_audit`), bukan operasi langsung dari klien.
4. Perbarui `scripts/lib/db.mjs` (`REQUIRED_TABLES`/`REQUIRED_FUNCTIONS`) agar
   `npm run db:check` ikut memverifikasi objek baru.
5. Tambahkan pengujian pgTAP pada `supabase/tests/` untuk aturan baru.
6. Perbarui dokumen ini.
