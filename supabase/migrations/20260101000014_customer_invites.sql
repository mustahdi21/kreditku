-- =============================================================================
-- KreditKu — pendaftaran akun portal pelanggan lewat kode undangan
--
-- MASALAH
-- -------
-- Akun pelanggan harus terhubung ke baris pelanggan yang SUDAH dibuat admin.
-- Menautkannya berdasarkan kecocokan email saja tidak aman: siapa pun yang tahu
-- email pelanggan dapat mendaftar dengan email itu dan melihat tagihannya.
-- Pengiriman email konfirmasi juga belum tentu tersedia pada proyek ini.
--
-- JALAN YANG DIPILIH
-- ------------------
-- Admin membuat kode undangan untuk satu pelanggan tertentu, lalu menyampaikan
-- kode itu langsung (mis. lewat WhatsApp). Pelanggan mendaftar sendiri dengan
-- kode tersebut; akunnya langsung tertaut ke baris pelanggan yang benar.
--
-- Kode adalah kredensial, karena itu:
--   * sekali pakai — ditandai terpakai saat didaftarkan;
--   * berumur pendek — batal otomatis setelah kedaluwarsa;
--   * tunggal per pelanggan — kode baru membatalkan kode lama yang belum dipakai;
--   * dapat dicabut kapan saja oleh admin;
--   * hanya terlihat oleh staf organisasi pemilik pelanggan itu.
--
-- Kode disimpan apa adanya, bukan sebagai hash, karena admin harus dapat
-- menampilkannya kembali untuk disampaikan. Yang membatasi risikonya adalah
-- umur pendek, sekali pakai, dan pencabutan — bukan kerahasiaan penyimpanan.
-- =============================================================================

create table if not exists public.customer_invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  customer_id      uuid not null references public.customers (id) on delete cascade,
  code             text not null,
  full_name        text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  used_by          uuid references public.profiles (id) on delete set null,
  revoked_at       timestamptz,
  constraint uq_customer_invite_code unique (code)
);

comment on table public.customer_invites is
  'Kode undangan pendaftaran portal untuk satu pelanggan; sekali pakai dan berumur pendek.';

create index if not exists idx_customer_invites_customer
  on public.customer_invites (customer_id, created_at desc);

create index if not exists idx_customer_invites_open
  on public.customer_invites (code)
  where used_at is null and revoked_at is null;

-- RLS wajib aktif, dan hak anon dicabut eksplisit: default privilege platform
-- memberi anon hak pada tabel baru di skema public.
alter table public.customer_invites enable row level security;
revoke all on public.customer_invites from anon;
revoke all on public.customer_invites from public;
grant select on public.customer_invites to authenticated, service_role;

drop policy if exists customer_invites_select on public.customer_invites;
create policy customer_invites_select on public.customer_invites
  for select to authenticated
  using (public.fn_is_member(organization_id));

-- Tidak ada kebijakan tulis: seluruh perubahan lewat fungsi SECURITY DEFINER.

-- -----------------------------------------------------------------------------
-- Membangkitkan kode
-- -----------------------------------------------------------------------------
-- Alfabet sengaja tanpa 0/O dan 1/I/L agar tidak salah baca saat pelanggan
-- mengetiknya dari pesan WhatsApp.

create or replace function public.fn_generate_invite_code()
returns text
language plpgsql volatile as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text := '';
  i          integer;
begin
  for i in 1..8 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end;
$$;

comment on function public.fn_generate_invite_code() is
  'Kode undangan 8 karakter tanpa huruf dan angka yang mudah tertukar.';

-- -----------------------------------------------------------------------------
-- Membuat undangan dari aplikasi admin
-- -----------------------------------------------------------------------------

create or replace function public.rpc_create_customer_invite(
  p_customer_id uuid,
  p_valid_days integer default 7,
  p_full_name text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org     uuid;
  v_tertaut uuid;
  v_code    text;
  v_expires timestamptz;
  v_id      uuid;
  i         integer;
begin
  select organization_id, user_id into v_org, v_tertaut
    from public.customers where id = p_customer_id;

  if v_org is null then
    raise exception 'Pelanggan tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_manage_credit(v_org) then
    raise exception 'Hanya peran yang mengelola kredit yang dapat membuat undangan portal.' using errcode = '42501';
  end if;

  if v_tertaut is not null then
    raise exception 'Pelanggan ini sudah memiliki akun portal.' using errcode = 'P0001';
  end if;

  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 30 then
    raise exception 'Masa berlaku undangan harus antara 1 sampai 30 hari.' using errcode = '22023';
  end if;

  v_expires := now() + make_interval(days => p_valid_days);

  -- Satu undangan aktif per pelanggan: kode lama yang belum dipakai dicabut
  -- supaya tidak ada dua kode yang sama-sama dapat mendaftarkan akun.
  update public.customer_invites
     set revoked_at = now()
   where customer_id = p_customer_id
     and used_at is null
     and revoked_at is null;

  for i in 1..20 loop
    v_code := public.fn_generate_invite_code();
    begin
      insert into public.customer_invites
        (organization_id, customer_id, code, full_name, created_by, expires_at)
      values
        (v_org, p_customer_id, v_code, nullif(trim(coalesce(p_full_name, '')), ''), auth.uid(), v_expires)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;

  if v_id is null then
    raise exception 'Gagal membuat kode unik, coba lagi.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'invite_id', v_id,
    'code', v_code,
    'expires_at', v_expires,
    'valid_days', p_valid_days
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Mencabut undangan
-- -----------------------------------------------------------------------------

create or replace function public.rpc_revoke_customer_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.customer_invites where id = p_invite_id;
  if v_org is null then
    raise exception 'Undangan tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_manage_credit(v_org) then
    raise exception 'Hanya peran yang mengelola kredit yang dapat mencabut undangan portal.' using errcode = '42501';
  end if;

  update public.customer_invites
     set revoked_at = now()
   where id = p_invite_id and used_at is null and revoked_at is null;

  if not found then
    raise exception 'Undangan sudah dipakai atau sudah dicabut.' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Menukar kode menjadi tautan akun
-- -----------------------------------------------------------------------------
-- Dipanggil Edge Function customer-signup dengan service_role SETELAH akun auth
-- dibuat. Fungsi ini yang menentukan sah atau tidaknya kode, dan dia yang
-- menautkan akun ke baris pelanggan — bukan pemanggil.
--
-- Dikembalikan sebagai jsonb, bukan galat, untuk keadaan yang wajar terjadi
-- (kode salah, kedaluwarsa, sudah dipakai) agar Edge Function dapat menjawab
-- pesan yang jelas tanpa menebak dari kode galat.

create or replace function public.fn_redeem_customer_invite(
  p_code text,
  p_user_id uuid,
  p_full_name text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv public.customer_invites;
  v_ada uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Fungsi ini hanya dapat dijalankan dari server.' using errcode = '42501';
  end if;

  select * into v_inv
    from public.customer_invites
   where upper(trim(p_code)) = code
   for update;

  if v_inv.id is null then
    return jsonb_build_object('status', 'KODE_TIDAK_DITEMUKAN');
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('status', 'KODE_DICABUT');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('status', 'KODE_SUDAH_DIPAKAI');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('status', 'KODE_KEDALUWARSA');
  end if;

  select user_id into v_ada from public.customers where id = v_inv.customer_id;
  if v_ada is not null then
    update public.customer_invites set revoked_at = now() where id = v_inv.id;
    return jsonb_build_object('status', 'PELANGGAN_SUDAH_PUNYA_AKUN');
  end if;

  update public.customers
     set user_id = p_user_id,
         updated_by = p_user_id,
         email = coalesce(email, (select p.email from public.profiles p where p.id = p_user_id))
   where id = v_inv.customer_id;

  update public.customer_invites
     set used_at = now(), used_by = p_user_id
   where id = v_inv.id;

  return jsonb_build_object(
    'status', 'BERHASIL',
    'customer_id', v_inv.customer_id,
    'organization_id', v_inv.organization_id,
    'customer_name', (select full_name from public.customers where id = v_inv.customer_id)
  );
end;
$$;

comment on function public.fn_redeem_customer_invite(text, uuid, text) is
  'Menukar kode undangan menjadi tautan akun pelanggan; hanya untuk service_role.';

-- -----------------------------------------------------------------------------
-- Hak eksekusi
-- -----------------------------------------------------------------------------

revoke all on function public.rpc_create_customer_invite(uuid, integer, text) from public, anon;
revoke all on function public.rpc_revoke_customer_invite(uuid) from public, anon;
revoke all on function public.fn_redeem_customer_invite(text, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_generate_invite_code() from public, anon, authenticated;

grant execute on function public.rpc_create_customer_invite(uuid, integer, text) to authenticated, service_role;
grant execute on function public.rpc_revoke_customer_invite(uuid) to authenticated, service_role;
grant execute on function public.fn_redeem_customer_invite(text, uuid, text) to service_role;

-- =============================================================================
-- SELESAI — undangan pendaftaran portal pelanggan
-- =============================================================================
