-- =============================================================================
-- KreditKu — penghapusan permanen pelanggan (terbatas)
--
-- KENAPA DIBATASI
-- ---------------
-- Tabel customers tidak punya kebijakan DELETE, sehingga RLS sudah menolak
-- penghapusan dari klien. Di atas itu, trigger trg_block_hard_delete menolak
-- penghapusan mentah dengan pesan "Data tidak boleh dihapus permanen. Gunakan
-- arsip atau pembatalan resmi." Blokir itu hanya terbuka bagi fungsi SECURITY
-- DEFINER, karena di dalamnya current_user adalah pemilik basis data dan
-- fn_is_internal_write() bernilai benar.
--
-- Rancangan itu disengaja: data keuangan tidak boleh hilang karena satu
-- permintaan yang tidak terkendali. Fungsi ini adalah pintu resminya.
--
-- KAPAN DIPAKAI
-- -------------
-- Hanya untuk pelanggan yang salah dibuat — belum punya kontrak dan belum punya
-- pengajuan. Bila ada salah satunya, foreign key `on delete restrict` pada kedua
-- tabel itu akan menolak penghapusan; fungsi ini menangkap keadaan itu lebih awal
-- dan menjelaskannya dengan kalimat yang dapat ditindaklanjuti, bukan membiarkan
-- galat batasan menyeruak ke layar pengguna.
--
-- Untuk pelanggan yang sudah punya riwayat, jalur yang benar adalah ARSIP:
-- data tetap utuh, hanya tidak lagi muncul pada daftar aktif.
-- =============================================================================

create or replace function public.rpc_delete_customer(p_customer_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row       public.customers;
  v_kontrak   integer;
  v_pengajuan integer;
  v_akun      uuid;
begin
  select * into v_row
    from public.customers
   where id = p_customer_id
   for update;

  if v_row.id is null then
    raise exception 'Pelanggan tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_row.organization_id);
  if not public.fn_can_configure(v_row.organization_id) then
    raise exception 'Hanya peran yang mengatur sistem yang dapat menghapus pelanggan permanen.'
      using errcode = '42501';
  end if;

  select count(*) into v_kontrak from public.credit_contracts where customer_id = p_customer_id;
  select count(*) into v_pengajuan from public.credit_applications where customer_id = p_customer_id;

  if v_kontrak > 0 or v_pengajuan > 0 then
    raise exception
      'Pelanggan % memiliki % kontrak dan % pengajuan, sehingga tidak dapat dihapus permanen. Gunakan Arsipkan supaya riwayat tetap tersimpan.',
      v_row.full_name, v_kontrak, v_pengajuan
      using errcode = 'P0001';
  end if;

  select user_id into v_akun from public.customers where id = p_customer_id;

  -- Penghapusan ini tercatat otomatis oleh trigger trg_audit_row pada tabel
  -- customers (after insert or update or delete), lengkap dengan pelakunya.
  delete from public.customers where id = p_customer_id;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_number', v_row.customer_number,
    'full_name', v_row.full_name,
    'had_portal_account', v_akun is not null
  );
end;
$$;

comment on function public.rpc_delete_customer(uuid) is
  'Menghapus pelanggan permanen; hanya untuk pelanggan tanpa kontrak dan tanpa pengajuan.';

-- Hanya peran yang mengatur sistem. Menghapus data master bukan pekerjaan
-- sehari-hari, sehingga izinnya lebih sempit daripada mengelola kredit.
revoke all on function public.rpc_delete_customer(uuid) from public, anon;
grant execute on function public.rpc_delete_customer(uuid) to authenticated, service_role;

-- =============================================================================
-- SELESAI — penghapusan permanen pelanggan
-- =============================================================================
