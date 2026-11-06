-- =============================================================================
-- KreditKu — menyelesaikan konfirmasi QRIS yang perlu ditinjau
--
-- MASALAH
-- -------
-- Ketika sebuah notifikasi pembayaran tidak dapat dicocokkan dengan pasti —
-- nominal yang sama dipakai dua tagihan, atau status permintaannya tidak lagi
-- menunggu — pembayarannya sengaja TIDAK dicatat otomatis dan diparkir dengan
-- status REVIEW. Sampai migrasi ini, tidak ada satu pun cara menyelesaikannya
-- dari aplikasi: hanya lewat SQL. Untuk aplikasi yang uangnya mengalir, itu
-- celah yang tidak boleh dibiarkan.
--
-- RANCANGAN
-- ---------
-- Logika pencatatan diangkat ke fn_apply_qris_payment, lalu dipakai bersama oleh
-- dua jalur:
--
--   * rpc_confirm_qris_payment     — dipanggil server (service_role) dari
--                                    Edge Function, tanpa campur tangan manusia;
--   * rpc_resolve_qris_confirmation — dipanggil kasir, yang MEMILIH tagihan mana
--                                    yang dimaksud karena sistem tidak dapat
--                                    memutuskan sendiri.
--
-- Pencatatan pembayarannya sendiri tetap melalui rpc_post_payment, sehingga
-- alokasi, denda, dan audit memakai jalur yang sama dengan pembayaran yang
-- dicatat kasir dari formulir biasa.
--
-- KEWENANGAN
-- ----------
-- Keempat aksi memakai fn_can_collect_payment (SUPER_ADMIN, ADMIN, CASHIER) —
-- sama dengan siapa yang boleh mencatat pembayaran. Ini memang pekerjaan yang
-- sama: mencatat pembayaran, hanya saja dipicu oleh notifikasi bank.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Jejak penyelesaian pada kotak masuk konfirmasi
-- -----------------------------------------------------------------------------

alter table public.qris_confirmations
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null,
  add column if not exists resolved_note text;

comment on column public.qris_confirmations.resolved_at is
  'Kapan konfirmasi ini diselesaikan kasir; null berarti belum ditinjau.';

create index if not exists idx_qris_confirmations_unresolved
  on public.qris_confirmations (organization_id, created_at desc)
  where resolved_at is null;

-- -----------------------------------------------------------------------------
-- 2. Inti pencatatan pembayaran QRIS
-- -----------------------------------------------------------------------------
-- Tanpa pemeriksaan peran: pemanggilnya yang menentukan. Dijalankan hanya oleh
-- fungsi SECURITY DEFINER lain di bawah, sehingga pemanggilnya selalu kode
-- internal — bukan klien.

create or replace function public.fn_apply_qris_payment(
  p_request_id uuid,
  p_reference text default null,
  p_note text default null,
  p_confirmed_via text default 'MACRODROID',
  p_allow_review boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req   public.qris_payment_requests;
  v_hasil jsonb;
begin
  select * into v_req
    from public.qris_payment_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'Permintaan QRIS tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_req.status = 'PAID' then
    return jsonb_build_object('status', 'SUDAH_DIBAYAR', 'payment_id', v_req.payment_id);
  end if;

  -- Jalur otomatis hanya menerima permintaan yang masih menunggu dan belum
  -- kedaluwarsa. Kasir boleh memutuskan sebaliknya: uangnya sudah masuk, dan
  -- permintaan bisa saja sudah kedaluwarsa saat notifikasinya ditangani.
  if v_req.status <> 'PENDING' and not p_allow_review then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || 'konfirmasi setelah status ' || v_req.status::text
     where id = v_req.id;
    return jsonb_build_object('status', 'PERLU_TINJAUAN', 'alasan', 'status permintaan ' || v_req.status::text);
  end if;

  if v_req.status = 'PENDING' and v_req.expires_at < now() and not p_allow_review then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || 'konfirmasi setelah kedaluwarsa'
     where id = v_req.id;
    return jsonb_build_object('status', 'PERLU_TINJAUAN', 'alasan', 'permintaan sudah kedaluwarsa');
  end if;

  if v_req.status in ('CANCELLED', 'EXPIRED') and p_allow_review then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || 'tidak dapat dicatat karena berstatus ' || v_req.status::text
     where id = v_req.id;
    return jsonb_build_object(
      'status', 'PERLU_TINJAUAN',
      'alasan', 'Permintaan berstatus ' || v_req.status::text || ' sehingga tidak dapat dicatat. Buat permintaan baru bila pelanggan akan membayar lagi.'
    );
  end if;

  v_hasil := public.rpc_post_payment(
    p_contract_id      => v_req.contract_id,
    p_amount           => v_req.amount,
    p_method           => 'QRIS'::payment_method,
    p_idempotency_key  => 'qris:' || v_req.reference,
    p_paid_at          => now(),
    p_reference        => coalesce(p_reference, v_req.reference),
    p_notes            => coalesce(p_note, 'Pembayaran QRIS terkonfirmasi')
  );

  update public.qris_payment_requests
     set status = 'PAID',
         paid_at = now(),
         confirmed_via = p_confirmed_via,
         payment_id = nullif(v_hasil ->> 'payment_id', '')::uuid
   where id = v_req.id;

  if v_req.installment_id is not null then
    update public.qris_payment_requests
       set status = 'CANCELLED',
           note = coalesce(note || ' | ', '') || 'cicilan sudah dibayar lewat permintaan lain'
     where installment_id = v_req.installment_id
       and id <> v_req.id
       and status = 'PENDING';
  end if;

  return jsonb_build_object(
    'status', 'DIBAYAR',
    'request_id', v_req.id,
    'reference', v_req.reference,
    'payment_id', v_hasil ->> 'payment_id',
    'receipt_number', v_hasil ->> 'receipt_number'
  );
exception
  when others then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || sqlerrm
     where id = p_request_id
       and status = 'PENDING';
    raise;
end;
$$;

revoke all on function public.fn_apply_qris_payment(uuid, text, text, text, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Jalur otomatis tetap seperti semula
-- -----------------------------------------------------------------------------

create or replace function public.rpc_confirm_qris_payment(
  p_request_id uuid,
  p_reference text default null,
  p_note text default null,
  p_confirmed_via text default 'MACRODROID'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Fungsi ini hanya dapat dijalankan dari server.' using errcode = '42501';
  end if;

  return public.fn_apply_qris_payment(p_request_id, p_reference, p_note, p_confirmed_via, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Menyelesaikan konfirmasi dari kotak masuk
-- -----------------------------------------------------------------------------
-- Kasir memilih tagihan mana yang dimaksud notifikasi itu. Inilah yang menutup
-- celah pencocokan ambigu: sistem tidak menebak, manusia yang memutuskan, dan
-- keputusannya tercatat.

create or replace function public.rpc_resolve_qris_confirmation(
  p_confirmation_id uuid,
  p_request_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_konf public.qris_confirmations;
  v_org  uuid;
  v_hasil jsonb;
begin
  select * into v_konf from public.qris_confirmations where id = p_confirmation_id for update;
  if v_konf.id is null then
    raise exception 'Konfirmasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  v_org := v_konf.organization_id;
  if v_org is null then
    raise exception 'Konfirmasi ini tidak terhubung ke organisasi mana pun sehingga tidak dapat diselesaikan dari sini.'
      using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_collect_payment(v_org) then
    raise exception 'Role Anda tidak berwenang mencatat pembayaran.' using errcode = '42501';
  end if;

  if v_konf.resolved_at is not null then
    raise exception 'Konfirmasi ini sudah diselesaikan sebelumnya.' using errcode = 'P0001';
  end if;

  v_hasil := public.fn_apply_qris_payment(
    p_request_id,
    v_konf.reference,
    coalesce(p_note, 'Dicatat kasir dari konfirmasi pembayaran'),
    'MANUAL',
    true
  );

  if v_hasil ->> 'status' <> 'DIBAYAR' then
    return v_hasil;
  end if;

  update public.qris_confirmations
     set request_id = p_request_id,
         outcome = 'DIBAYAR_MANUAL',
         detail = coalesce(p_note, 'Dicatat kasir'),
         resolved_at = now(),
         resolved_by = auth.uid(),
         resolved_note = p_note
   where id = p_confirmation_id;

  return v_hasil;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Mencatat permintaan yang berstatus tinjauan
-- -----------------------------------------------------------------------------
-- Untuk permintaan yang diparkir tanpa konfirmasi pasangannya, atau yang
-- konfirmasinya datang belakangan. Kasir menegaskan bahwa uangnya memang masuk.

create or replace function public.rpc_confirm_qris_request_manual(
  p_request_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.qris_payment_requests where id = p_request_id;
  if v_org is null then
    raise exception 'Permintaan QRIS tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_collect_payment(v_org) then
    raise exception 'Role Anda tidak berwenang mencatat pembayaran.' using errcode = '42501';
  end if;

  return public.fn_apply_qris_payment(
    p_request_id,
    null,
    coalesce(p_note, 'Dikonfirmasi manual oleh kasir'),
    'MANUAL',
    true
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Mengabaikan yang bukan pembayaran
-- -----------------------------------------------------------------------------

create or replace function public.rpc_dismiss_qris_confirmation(
  p_confirmation_id uuid,
  p_reason text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_konf public.qris_confirmations;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Alasan pengabaian wajib diisi.' using errcode = '22023';
  end if;

  select * into v_konf from public.qris_confirmations where id = p_confirmation_id for update;
  if v_konf.id is null then
    raise exception 'Konfirmasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_konf.organization_id);
  if not public.fn_can_collect_payment(v_konf.organization_id) then
    raise exception 'Role Anda tidak berwenang meninjau konfirmasi pembayaran.' using errcode = '42501';
  end if;

  if v_konf.resolved_at is not null then
    raise exception 'Konfirmasi ini sudah diselesaikan sebelumnya.' using errcode = 'P0001';
  end if;

  update public.qris_confirmations
     set outcome = 'DIABAIKAN',
         resolved_at = now(),
         resolved_by = auth.uid(),
         resolved_note = p_reason
   where id = p_confirmation_id;
end;
$$;

create or replace function public.rpc_dismiss_qris_request(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.qris_payment_requests;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Alasan wajib diisi.' using errcode = '22023';
  end if;

  select * into v_req from public.qris_payment_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Permintaan QRIS tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_req.organization_id);
  if not public.fn_can_collect_payment(v_req.organization_id) then
    raise exception 'Role Anda tidak berwenang meninjau permintaan pembayaran.' using errcode = '42501';
  end if;

  if v_req.status = 'PAID' then
    raise exception 'Permintaan ini sudah dibayar dan tidak dapat diabaikan.' using errcode = 'P0001';
  end if;

  update public.qris_payment_requests
     set status = 'CANCELLED',
         note = coalesce(note || ' | ', '') || 'diabaikan kasir: ' || trim(p_reason)
   where id = p_request_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Hak eksekusi
-- -----------------------------------------------------------------------------

revoke all on function public.rpc_resolve_qris_confirmation(uuid, uuid, text) from public, anon;
revoke all on function public.rpc_confirm_qris_request_manual(uuid, text) from public, anon;
revoke all on function public.rpc_dismiss_qris_confirmation(uuid, text) from public, anon;
revoke all on function public.rpc_dismiss_qris_request(uuid, text) from public, anon;

grant execute on function public.rpc_resolve_qris_confirmation(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_confirm_qris_request_manual(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_dismiss_qris_confirmation(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_dismiss_qris_request(uuid, text) to authenticated, service_role;

-- =============================================================================
-- SELESAI — penyelesaian konfirmasi QRIS oleh kasir
-- =============================================================================
