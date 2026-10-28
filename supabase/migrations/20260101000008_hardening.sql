-- =============================================================================
-- KreditKu — Pengerasan otorisasi fungsi
--
-- Hasil audit pasca-deploy terhadap project Supabase produksi. Menutup dua
-- celah yang saling memperkuat:
--
-- H-01  rpc_payment_series memakai nilai p_org dari pemanggil tanpa memeriksa
--       keanggotaan, padahal fungsi berjalan SECURITY DEFINER sehingga melewati
--       RLS. Pemanggil tanpa sesi (anon) dapat membaca agregat pembayaran harian
--       — nominal, jumlah transaksi, dan nilai pembatalan — untuk organisasi
--       mana pun yang UUID-nya diketahui.
--
--       Bukti: POST /rest/v1/rpc/rpc_payment_series dengan anon key dan
--       p_org sembarang mengembalikan satu baris per hari untuk rentang yang
--       diminta, bukan penolakan.
--
-- H-02  `revoke ... from anon` pada 20260101000006_rls.sql tidak efektif.
--       Fungsi di PostgreSQL menerima EXECUTE untuk pseudo-role PUBLIC secara
--       bawaan, dan mencabut dari role `anon` tidak menghapus grant PUBLIC itu.
--       Seluruh rpc_* karenanya tetap dapat dipanggil anon; satu-satunya
--       penghalang adalah pemeriksaan sesi di dalam masing-masing fungsi.
--       Fungsi yang pemeriksaannya dapat dilewati (H-01) menjadi dapat
--       dieksploitasi tanpa kredensial apa pun, memakai kunci anon yang
--       memang tertanam pada bundle frontend.
--
--       Bukti: rpc_apply_penalties tercantum pada daftar `revoke ... from anon`
--       (baris 442 migrasi 0006), namun pemanggilan anon tetap sampai ke isi
--       fungsi dan menerima pesan milik fn_assert_member di dalamnya.
--
-- ATURAN YANG HARUS DIPATUHI MIGRASI BERIKUTNYA
-- ---------------------------------------------
-- Fungsi pembantu yang dipakai ekspresi policy RLS — fn_is_member, fn_has_role,
-- fn_can_write, fn_can_manage_credit, fn_can_collect_payment, fn_can_configure,
-- fn_current_org — WAJIB tetap dapat dijalankan oleh role `authenticated`.
-- PostgreSQL memeriksa EXECUTE terhadap pengguna yang menjalankan query, bukan
-- terhadap definisi policy, sehingga mencabut EXECUTE dari PUBLIC pada fungsi
-- tersebut akan menggagalkan seluruh query terautentikasi dengan
-- "permission denied for function". Karena alasan itu migrasi ini hanya
-- mengunci fungsi yang dipanggil langsung oleh klien, dan tidak mengubah
-- default privilege skema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- H-01 — rpc_payment_series: periksa keanggotaan sebelum membaca data
-- -----------------------------------------------------------------------------
-- Pola pemeriksaan mengikuti rpc_dashboard_metrics agar konsisten: hitung
-- organisasi efektif, lalu pastikan pemanggil adalah anggotanya.
create or replace function public.rpc_payment_series(
  p_from date,
  p_to date,
  p_org uuid default null
)
returns table (period date, amount bigint, count integer, reversal_amount bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := coalesce(p_org, public.fn_current_org());
begin
  perform public.fn_assert_member(v_org);

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as period
  )
  select d.period,
         coalesce(sum(case when p.status = 'POSTED' then p.amount end), 0)::bigint,
         coalesce(count(case when p.status = 'POSTED' then 1 end), 0)::integer,
         coalesce(sum(case when p.status = 'REVERSED' then p.amount end), 0)::bigint
    from days d
    left join public.payments p
      on p.paid_date = d.period
     and p.organization_id = v_org
   group by d.period
   order by d.period;
end;
$$;

-- -----------------------------------------------------------------------------
-- H-02 — cabut EXECUTE bawaan PUBLIC pada fungsi yang dipanggil klien
-- -----------------------------------------------------------------------------
-- `from public` (bukan hanya `from anon`) adalah inti perbaikan: grant bawaan
-- PUBLIC inilah yang membuat anon tetap dapat memanggil fungsi ini.
-- service_role dipulihkan agar skrip server dan scripts/bootstrap-admin.mjs
-- tetap bekerja.

revoke all on function public.fn_next_number(text, text, date, text, uuid) from public, anon;
revoke all on function public.fn_touch_login() from public, anon;
revoke all on function public.rpc_submit_application(uuid, text) from public, anon;
revoke all on function public.rpc_decide_application(uuid, application_status, text, text) from public, anon;
revoke all on function public.rpc_cancel_application(uuid, text) from public, anon;
revoke all on function public.rpc_post_payment(uuid, bigint, payment_method, text, timestamptz, text, text, allocation_order, boolean, boolean, uuid[], text) from public, anon;
revoke all on function public.rpc_reverse_payment(uuid, text) from public, anon;
revoke all on function public.rpc_apply_penalties(uuid, date, uuid) from public, anon;
revoke all on function public.rpc_waive_penalty(uuid, bigint, text) from public, anon;
revoke all on function public.rpc_enqueue_reminders(uuid, date) from public, anon;
revoke all on function public.rpc_mark_reminder(uuid, reminder_status, text) from public, anon;
revoke all on function public.rpc_dashboard_metrics(date, date, uuid) from public, anon;
revoke all on function public.rpc_payment_series(date, date, uuid) from public, anon;
revoke all on function public.rpc_update_settings(text, jsonb) from public, anon;
revoke all on function public.rpc_register_member(uuid, text, text, member_role) from public, anon;
revoke all on function public.rpc_update_member(uuid, member_role, boolean) from public, anon;
revoke all on function public.rpc_switch_organization(uuid) from public, anon;
revoke all on function public.rpc_amend_contract(uuid, text, integer, numeric, rate_basis, date, date, boolean) from public, anon;
revoke all on function public.rpc_cancel_contract(uuid, text) from public, anon;
revoke all on function public.rpc_cancel_installment(uuid, text) from public, anon;
revoke all on function public.rpc_mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.rpc_bootstrap_super_admin(text, text, text, text, text) from public, anon;

-- Aplikasi memakai seluruh fungsi di atas setelah pengguna masuk. Bila grant
-- eksplisit dari migrasi 0006 belum ada, pernyataan berikut memastikan
-- permukaan akses klien tetap utuh setelah pencabutan di atas.
grant execute on function public.fn_next_number(text, text, date, text, uuid) to authenticated;
grant execute on function public.fn_touch_login() to authenticated;
grant execute on function public.rpc_submit_application(uuid, text) to authenticated;
grant execute on function public.rpc_decide_application(uuid, application_status, text, text) to authenticated;
grant execute on function public.rpc_cancel_application(uuid, text) to authenticated;
grant execute on function public.rpc_post_payment(uuid, bigint, payment_method, text, timestamptz, text, text, allocation_order, boolean, boolean, uuid[], text) to authenticated;
grant execute on function public.rpc_reverse_payment(uuid, text) to authenticated;
grant execute on function public.rpc_apply_penalties(uuid, date, uuid) to authenticated;
grant execute on function public.rpc_waive_penalty(uuid, bigint, text) to authenticated;
grant execute on function public.rpc_enqueue_reminders(uuid, date) to authenticated;
grant execute on function public.rpc_mark_reminder(uuid, reminder_status, text) to authenticated;
grant execute on function public.rpc_dashboard_metrics(date, date, uuid) to authenticated;
grant execute on function public.rpc_payment_series(date, date, uuid) to authenticated;
grant execute on function public.rpc_update_settings(text, jsonb) to authenticated;
grant execute on function public.rpc_register_member(uuid, text, text, member_role) to authenticated;
grant execute on function public.rpc_update_member(uuid, member_role, boolean) to authenticated;
grant execute on function public.rpc_switch_organization(uuid) to authenticated;
grant execute on function public.rpc_amend_contract(uuid, text, integer, numeric, rate_basis, date, date, boolean) to authenticated;
grant execute on function public.rpc_cancel_contract(uuid, text) to authenticated;
grant execute on function public.rpc_cancel_installment(uuid, text) to authenticated;
grant execute on function public.rpc_mark_notifications_read(uuid[]) to authenticated;

-- rpc_bootstrap_super_admin sengaja TIDAK diberikan kepada authenticated: fungsi
-- ini membuat organisasi pertama beserta super admin, dan hanya boleh dijalankan
-- dari jalur server (scripts/bootstrap-admin.mjs).
grant execute on function public.rpc_bootstrap_super_admin(text, text, text, text, text) to service_role;

grant execute on function public.fn_next_number(text, text, date, text, uuid) to service_role;
grant execute on function public.fn_touch_login() to service_role;
grant execute on function public.rpc_submit_application(uuid, text) to service_role;
grant execute on function public.rpc_decide_application(uuid, application_status, text, text) to service_role;
grant execute on function public.rpc_cancel_application(uuid, text) to service_role;
grant execute on function public.rpc_post_payment(uuid, bigint, payment_method, text, timestamptz, text, text, allocation_order, boolean, boolean, uuid[], text) to service_role;
grant execute on function public.rpc_reverse_payment(uuid, text) to service_role;
grant execute on function public.rpc_apply_penalties(uuid, date, uuid) to service_role;
grant execute on function public.rpc_waive_penalty(uuid, bigint, text) to service_role;
grant execute on function public.rpc_enqueue_reminders(uuid, date) to service_role;
grant execute on function public.rpc_mark_reminder(uuid, reminder_status, text) to service_role;
grant execute on function public.rpc_dashboard_metrics(date, date, uuid) to service_role;
grant execute on function public.rpc_payment_series(date, date, uuid) to service_role;
grant execute on function public.rpc_update_settings(text, jsonb) to service_role;
grant execute on function public.rpc_register_member(uuid, text, text, member_role) to service_role;
grant execute on function public.rpc_update_member(uuid, member_role, boolean) to service_role;
grant execute on function public.rpc_switch_organization(uuid) to service_role;
grant execute on function public.rpc_amend_contract(uuid, text, integer, numeric, rate_basis, date, date, boolean) to service_role;
grant execute on function public.rpc_cancel_contract(uuid, text) to service_role;
grant execute on function public.rpc_cancel_installment(uuid, text) to service_role;
grant execute on function public.rpc_mark_notifications_read(uuid[]) to service_role;

-- =============================================================================
-- SELESAI — pengerasan otorisasi fungsi
-- =============================================================================
