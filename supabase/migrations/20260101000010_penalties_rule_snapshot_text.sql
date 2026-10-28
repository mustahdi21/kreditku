-- =============================================================================
-- KreditKu — kolom teks untuk pencarian rincian perhitungan denda
--
-- MASALAH
-- -------
-- Halaman Denda menyediakan kotak pencarian dengan keterangan "Cari pada
-- rincian perhitungan denda…", dan klien menerjemahkannya menjadi:
--
--   .ilike('rule_snapshot::text', '%kata%')
--
-- `rule_snapshot` bertipe jsonb, dan PostgREST tidak mendukung penulisan cast
-- seperti itu pada nama kolom filter. Yang terjadi bukan hasil kosong, melainkan
-- galat dari server:
--
--   POST /rest/v1/penalties?rule_snapshot::text=ilike.*bunga*  -> HTTP 404 42883
--   POST /rest/v1/penalties?rule_snapshot=ilike.*bunga*        -> HTTP 404 42883
--
-- 42883 adalah operator does not exist: jsonb ~~ text. Tabel penalties tidak
-- memiliki kolom teks lain yang layak dicari (hanya waived_reason yang umumnya
-- kosong), sehingga pencarian tidak dapat dibetulkan dari sisi klien.
--
-- PERBAIKAN
-- ---------
-- Menambahkan kolom teks yang dihasilkan otomatis dari rule_snapshot, sehingga
-- penyaringan teks dapat dilakukan dengan operator biasa. Kolom ini generated
-- stored: nilainya selalu mengikuti rule_snapshot dan tidak dapat ditulis klien.
--
-- CATATAN
-- -------
-- Isi kolom ini adalah representasi JSON, jadi yang cocok adalah token yang
-- memang tersimpan di dalamnya — misalnya 'PERCENT_PER_DAY', 'grace_days', atau
-- 'max_amount' — bukan label bahasa Indonesia seperti 'persen'. Perilaku ini
-- sama dengan maksud semula kode klien; yang diperbaiki adalah galat servernya,
-- bukan cakupan pencariannya.
-- =============================================================================

alter table public.penalties
  add column if not exists rule_snapshot_text text
  generated always as (rule_snapshot::text) stored;

comment on column public.penalties.rule_snapshot_text is
  'Representasi teks rule_snapshot untuk pencarian; dihasilkan otomatis, tidak untuk ditulis.';

-- =============================================================================
-- SELESAI — kolom teks pencarian denda
-- =============================================================================
