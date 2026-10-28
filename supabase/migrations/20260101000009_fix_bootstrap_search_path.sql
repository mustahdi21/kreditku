-- =============================================================================
-- KreditKu — perbaikan search_path rpc_bootstrap_super_admin
--
-- MASALAH
-- -------
-- `rpc_bootstrap_super_admin` dideklarasikan dengan
-- `set search_path = public, auth, pg_temp`, sementara `pgcrypto` dipasang oleh
-- `create extension if not exists "pgcrypto"` pada 20260101000001_init.sql —
-- tanpa menyebut skema. Di Supabase, ekstensi itu bisa berada di skema
-- `extensions`, bukan `public`. Akibatnya pemanggilan `gen_salt('bf')` dan
-- `crypt(...)` di dalam fungsi gagal:
--
--   ERROR: 42883: function gen_salt(unknown) does not exist
--
-- Akibat lanjutan: tidak ada satu pun cara membuat Super Admin pertama, karena
-- seluruh jalur (SQL Editor, scripts/bootstrap-admin.mjs lewat koneksi langsung
-- maupun lewat PostgREST dengan service_role) berakhir pada fungsi yang sama.
--
-- MENGAPA TIDAK CUKUP `set search_path` DI SISI PEMANGGIL
-- ------------------------------------------------------
-- Klausa `SET search_path` pada definisi fungsi MENIMPA pengaturan pemanggil
-- selama badan fungsi berjalan. Jadi `set local search_path` sebelum memanggil
-- RPC ini tidak berpengaruh.
--
-- PERBAIKAN
-- ---------
-- Menambahkan skema tempat `pgcrypto` benar-benar berada ke search_path fungsi.
-- Skema itu dideteksi saat migrasi dijalankan, bukan ditulis tetap, karena
-- lokasinya berbeda antar project (public pada project lama, extensions pada
-- project Supabase saat ini).
-- =============================================================================

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_schema is null then
    execute 'create extension if not exists pgcrypto with schema public';
    v_schema := 'public';
    raise notice 'pgcrypto dipasang pada skema public.';
  else
    raise notice 'pgcrypto ditemukan pada skema %.', v_schema;
  end if;

  execute format(
    'alter function public.rpc_bootstrap_super_admin(text, text, text, text, text) '
    'set search_path = public, auth, %I, pg_temp',
    v_schema
  );

  raise notice 'search_path rpc_bootstrap_super_admin diperbarui (menyertakan %).', v_schema;
end $$;

-- =============================================================================
-- SELESAI — perbaikan search_path
-- =============================================================================
