-- =============================================================================
-- KreditKu — menutup hak tabel bawaan platform pada tabel portal
--
-- MASALAH
-- -------
-- Supabase memasang default privilege sehingga tabel BARU di skema public
-- langsung mendapat hak untuk anon, authenticated, dan service_role. Akibatnya
-- qris_payment_requests dan qris_confirmations dapat dibaca anon pada tingkat
-- tabel:
--
--   GET /rest/v1/qris_payment_requests  -> HTTP 200 dengan isi []
--
-- Isinya kosong karena RLS aktif dan tidak ada kebijakan untuk anon, jadi TIDAK
-- ada data yang bocor, dan penulisan ditolak dengan 42501. Namun keamanannya
-- bergantung sepenuhnya pada kebijakan: andai suatu saat ada kebijakan keliru,
-- hak tabel inilah yang menjadi satu-satunya penghalang. Tabel lain di skema ini
-- sudah dicabut haknya pada 20260101000006_rls.sql, sehingga posturnya tidak
-- seragam.
--
-- PERBAIKAN
-- ---------
-- Mencabut seluruh hak anon atas kedua tabel, lalu menegaskan kembali hak yang
-- memang diperlukan. authenticated hanya mendapat SELECT; penulisan tetap hanya
-- melalui fungsi SECURITY DEFINER, sama seperti pada migrasi 0011.
--
-- CATATAN UNTUK MIGRASI BERIKUTNYA
-- --------------------------------
-- Setiap tabel baru di skema public WAJIB mencabut hak anon secara eksplisit.
-- `grant ... on all tables` pada migrasi 0006 tidak menjangkau tabel yang dibuat
-- setelahnya, dan default privilege platform justru memberi anon hak tersebut.
-- =============================================================================

revoke all on public.qris_payment_requests from anon;
revoke all on public.qris_payment_requests from public;
revoke all on public.qris_confirmations from anon;
revoke all on public.qris_confirmations from public;

grant select on public.qris_payment_requests to authenticated, service_role;
grant select on public.qris_confirmations to authenticated, service_role;

-- =============================================================================
-- SELESAI — hak tabel portal disamakan dengan tabel lain
-- =============================================================================
