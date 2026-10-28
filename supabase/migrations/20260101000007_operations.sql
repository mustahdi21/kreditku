-- =============================================================================
-- KreditKu — 20260101000007_operations.sql
-- Operasi tingkat lanjut: pengaturan terperinci, manajemen anggota, amandemen
-- kontrak, pembatalan kontrak/cicilan, notifikasi, dan bootstrap super admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pengaturan organisasi (dengan pembatasan per bagian)
-- -----------------------------------------------------------------------------

create or replace function public.rpc_update_settings(p_section text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.fn_current_org();
  v_role member_role;
  v_before jsonb;
  v_payload jsonb;
  v_code text;
begin
  perform public.fn_assert_member(v_org);
  v_role := public.fn_current_role();

  if p_section not in ('business', 'numbering', 'finance', 'penalty', 'integrations', 'ui') then
    raise exception 'Bagian pengaturan tidak dikenal: %', p_section using errcode = '22023';
  end if;

  -- Menerima dua bentuk payload: terbungkus ({ "business": { … } }) maupun
  -- langsung ({ "name": … }). Klien yang berbeda dapat memakai salah satunya.
  v_payload := coalesce(p_value -> p_section, p_value);
  if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Nilai pengaturan untuk bagian % harus berupa objek JSON.', p_section using errcode = '22023';
  end if;

  -- Bagian sensitif hanya untuk Super Admin.
  if p_section = 'integrations' and v_role <> 'SUPER_ADMIN' then
    raise exception 'Hanya Super Admin yang boleh mengubah pengaturan integrasi.' using errcode = '42501';
  end if;

  if v_role not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Role Anda tidak diizinkan mengubah pengaturan.' using errcode = '42501';
  end if;

  if p_section = 'business' then
    if v_role <> 'SUPER_ADMIN' then
      raise exception 'Hanya Super Admin yang boleh mengubah identitas usaha.' using errcode = '42501';
    end if;

    v_code := upper(trim(coalesce(
      nullif(v_payload ->> 'code', ''),
      nullif(v_payload ->> 'organizationCode', ''),
      ''
    )));
    if v_code <> '' and v_code !~ '^[A-Z0-9]{2,12}$' then
      raise exception 'Kode organisasi hanya boleh huruf kapital dan angka, 2–12 karakter.' using errcode = '22023';
    end if;

    select to_jsonb(o) into v_before from public.organizations o where o.id = v_org;
    update public.organizations
       set name = coalesce(nullif(trim(coalesce(v_payload ->> 'name', v_payload ->> 'businessName', '')), ''), name),
           code = coalesce(nullif(v_code, ''), code),
           logo_url = coalesce(v_payload ->> 'logo_url', v_payload ->> 'logoUrl', logo_url),
           address = coalesce(v_payload ->> 'address', address),
           phone = coalesce(v_payload ->> 'phone', phone),
           email = coalesce(v_payload ->> 'email', email),
           currency = coalesce(nullif(v_payload ->> 'currency', ''), currency),
           timezone = coalesce(nullif(v_payload ->> 'timezone', ''), timezone),
           locale = coalesce(nullif(v_payload ->> 'locale', ''), locale),
           updated_by = auth.uid()
     where id = v_org;
  else
    select to_jsonb(s) into v_before from public.app_settings s where s.organization_id = v_org;
    insert into public.app_settings (organization_id, updated_by)
    values (v_org, auth.uid())
    on conflict (organization_id) do nothing;

    if p_section = 'numbering' then
      update public.app_settings
         set numbering = numbering || v_payload,
             updated_by = auth.uid()
       where organization_id = v_org;
    elsif p_section = 'finance' then
      update public.app_settings
         set finance = finance || v_payload,
             updated_by = auth.uid()
       where organization_id = v_org;
    elsif p_section = 'penalty' then
      update public.app_settings
         set penalty = penalty || v_payload,
             updated_by = auth.uid()
       where organization_id = v_org;
    elsif p_section = 'integrations' then
      update public.app_settings
         set integrations = integrations || v_payload,
             updated_by = auth.uid()
       where organization_id = v_org;
    else
      update public.app_settings
         set ui = ui || v_payload,
             updated_by = auth.uid()
       where organization_id = v_org;
    end if;
  end if;

  -- Validasi template penomoran agar kesalahan konfigurasi terdeteksi lebih awal.
  if p_section = 'numbering' then
    declare
      v_settings public.app_settings;
      v_key text;
      v_template text;
    begin
      select * into v_settings from public.app_settings where organization_id = v_org;
      foreach v_key in array array['customer', 'contract', 'receipt', 'application', 'payment_reversal'] loop
        v_template := v_settings.numbering ->> v_key;
        if v_template is not null and v_template <> '' and v_template !~ '\{SEQ(?::\d+)?\}' then
          raise exception 'Template penomoran % harus mengandung token {SEQ}.', v_key using errcode = '22023';
        end if;
      end loop;
    end;
  end if;

  perform public.fn_log_audit(
    v_org, 'SETTINGS_CHANGE', case when p_section = 'business' then 'organizations' else 'app_settings' end,
    v_org, format('Perubahan pengaturan: %s', p_section), v_before, v_payload
  );

  return jsonb_build_object('section', p_section, 'updated', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Manajemen anggota & role
-- -----------------------------------------------------------------------------

-- Mendaftarkan pengguna yang SUDAH ada di auth.users sebagai anggota organisasi.
-- Pembuatan akun auth dilakukan oleh Edge Function `invite-user` (service role).
-- Fungsi ini TIDAK menerima password dan tidak pernah menyimpannya.
create or replace function public.rpc_register_member(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role member_role
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.fn_current_org();
  v_member_id uuid;
begin
  perform public.fn_assert_member(v_org);
  if not public.fn_has_role(v_org, array['SUPER_ADMIN']::member_role[]) then
    raise exception 'Hanya Super Admin yang boleh menambah anggota.' using errcode = '42501';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email tidak valid.' using errcode = '22023';
  end if;
  if p_role is null then
    raise exception 'Role wajib diisi.' using errcode = '22023';
  end if;

  insert into public.profiles (id, email, full_name)
  values (p_user_id, lower(p_email), coalesce(p_full_name, ''))
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;

  insert into public.organization_members (organization_id, user_id, role, is_active, invited_by, invited_at, created_by)
  values (v_org, p_user_id, p_role, true, auth.uid(), now(), auth.uid())
  on conflict (organization_id, user_id) do update
    set role = excluded.role, is_active = true
  returning id into v_member_id;

  perform public.fn_log_audit(
    v_org, 'INVITE_USER', 'organization_members', v_member_id,
    format('Undangan anggota %s sebagai %s', p_email, p_role),
    null, jsonb_build_object('email', p_email, 'role', p_role)
  );

  return jsonb_build_object('member_id', v_member_id, 'user_id', p_user_id, 'role', p_role);
end;
$$;

-- Mengubah role atau mengaktifkan/menonaktifkan anggota.
create or replace function public.rpc_update_member(p_member_id uuid, p_role member_role, p_is_active boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member public.organization_members;
  v_super_admins integer;
begin
  select * into v_member from public.organization_members where id = p_member_id for update;
  if not found then
    raise exception 'Anggota tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_member.organization_id);
  if not public.fn_has_role(v_member.organization_id, array['SUPER_ADMIN']::member_role[]) then
    raise exception 'Hanya Super Admin yang boleh mengubah anggota.' using errcode = '42501';
  end if;

  -- Mencegah organisasi kehilangan seluruh Super Admin aktif.
  if v_member.role = 'SUPER_ADMIN' and (p_role <> 'SUPER_ADMIN' or not p_is_active) then
    select count(*) into v_super_admins
      from public.organization_members m
     where m.organization_id = v_member.organization_id
       and m.role = 'SUPER_ADMIN'
       and m.is_active;
    if v_super_admins <= 1 then
      raise exception 'Tidak dapat menonaktifkan Super Admin terakhir pada organisasi ini.' using errcode = '42501';
    end if;
  end if;

  update public.organization_members
     set role = p_role,
         is_active = p_is_active,
         joined_at = case when p_is_active and joined_at is null then now() else joined_at end,
         updated_by = auth.uid()
   where id = p_member_id;

  perform public.fn_log_audit(
    v_member.organization_id,
    case when p_is_active then 'ACTIVATE_USER' else 'DEACTIVATE_USER' end,
    'organization_members', p_member_id,
    format('Perubahan anggota menjadi %s (%s)', p_role, case when p_is_active then 'aktif' else 'nonaktif' end),
    to_jsonb(v_member), jsonb_build_object('role', p_role, 'is_active', p_is_active)
  );

  return jsonb_build_object('member_id', p_member_id, 'role', p_role, 'is_active', p_is_active);
end;
$$;

-- Mengganti organisasi aktif pengguna (untuk pengguna yang tergabung di banyak organisasi).
create or replace function public.rpc_switch_organization(p_organization_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.fn_is_member(p_organization_id) then
    raise exception 'Anda bukan anggota organisasi tersebut.' using errcode = '42501';
  end if;
  update public.profiles set active_organization_id = p_organization_id where id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- Amandemen kontrak
-- -----------------------------------------------------------------------------

create or replace function public.rpc_amend_contract(
  p_contract_id uuid,
  p_reason text,
  p_new_tenor integer,
  p_new_rate_bp numeric,
  p_new_rate_basis rate_basis,
  p_new_first_due date,
  p_effective_from date,
  p_rebuild_schedule boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract public.credit_contracts;
  v_settings public.app_settings;
  v_before jsonb;
  v_after jsonb;
  v_paid_count integer;
  v_schedule record;
  v_total_interest bigint := 0;
  v_total_fees bigint := 0;
  v_total_payable bigint := 0;
  v_principal_sum bigint := 0;
  v_upfront bigint := 0;
  v_next_due date;
  v_holidays date[];
  v_weekend integer[];
begin
  if p_reason is null or char_length(trim(p_reason)) < 10 then
    raise exception 'Alasan amandemen wajib diisi minimal 10 karakter.' using errcode = '22023';
  end if;

  select * into v_contract from public.credit_contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Kontrak tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_contract.organization_id);
  if not public.fn_can_configure(v_contract.organization_id) then
    raise exception 'Hanya Admin atau Super Admin yang boleh melakukan amandemen kontrak.' using errcode = '42501';
  end if;
  if v_contract.status = 'CANCELLED' then
    raise exception 'Kontrak yang dibatalkan tidak dapat diamandemen.' using errcode = '22023';
  end if;

  select count(*) into v_paid_count
    from public.installments i
   where i.contract_id = p_contract_id and i.paid_amount > 0;

  if p_rebuild_schedule and v_paid_count > 0 then
    raise exception
      'Jadwal tidak dapat dibentuk ulang karena sudah ada pembayaran. Buat kontrak baru atau lakukan restrukturisasi manual.'
      using errcode = '22023';
  end if;

  select * into v_settings from public.app_settings where organization_id = v_contract.organization_id;
  v_holidays := coalesce(
    (select array_agg(value::date) from jsonb_array_elements_text(coalesce(v_settings.finance -> 'holidays', '[]'::jsonb)) as t(value)),
    array[]::date[]
  );
  v_weekend := coalesce(
    (select array_agg(value::integer) from jsonb_array_elements_text(coalesce(v_settings.finance -> 'weekend_days', '[0,6]'::jsonb)) as t(value)),
    array[0, 6]
  );

  v_before := jsonb_build_object(
    'tenor', v_contract.tenor, 'rate_bp', v_contract.rate_bp, 'rate_basis', v_contract.rate_basis,
    'first_due_date', v_contract.first_due_date, 'total_payable', v_contract.total_payable,
    'status', v_contract.status
  );

  perform public.fn_begin_internal_write();

  if p_rebuild_schedule then
    delete from public.installments where contract_id = p_contract_id;

    select coalesce(sum(s.interest), 0), coalesce(sum(s.fees), 0), coalesce(sum(s.total_due), 0),
           coalesce(sum(s.principal), 0), coalesce(max(s.upfront_amount), 0), min(s.due_date)
      into v_total_interest, v_total_fees, v_total_payable, v_principal_sum, v_upfront, v_next_due
      from public.fn_build_schedule(
        v_contract.principal, p_new_tenor, v_contract.method, p_new_rate_bp, p_new_rate_basis,
        v_contract.frequency, v_contract.admin_fee, v_contract.admin_fee_position,
        v_contract.other_fee_per_period, p_new_first_due, v_contract.due_date_adjustment,
        v_holidays, v_weekend
      ) s;

    if v_principal_sum <> v_contract.principal then
      raise exception 'Rekonsiliasi gagal saat amandemen: total pokok % tidak sama dengan %',
        v_principal_sum, v_contract.principal using errcode = '22023';
    end if;

    for v_schedule in
      select * from public.fn_build_schedule(
        v_contract.principal, p_new_tenor, v_contract.method, p_new_rate_bp, p_new_rate_basis,
        v_contract.frequency, v_contract.admin_fee, v_contract.admin_fee_position,
        v_contract.other_fee_per_period, p_new_first_due, v_contract.due_date_adjustment,
        v_holidays, v_weekend
      )
    loop
      insert into public.installments (
        organization_id, contract_id, installment_number, base_due_date, due_date,
        principal, interest, fees, total_due, status
      ) values (
        v_contract.organization_id, p_contract_id, v_schedule.installment_number,
        v_schedule.base_due_date, v_schedule.due_date, v_schedule.principal, v_schedule.interest,
        v_schedule.fees, v_schedule.total_due,
        public.fn_installment_status(v_schedule.total_due, 0, v_schedule.due_date, current_date, false)
      );
    end loop;

    update public.credit_contracts
       set tenor = p_new_tenor,
           rate_bp = p_new_rate_bp,
           rate_basis = p_new_rate_basis,
           first_due_date = p_new_first_due,
           total_interest = v_total_interest,
           total_fees = v_total_fees,
           total_payable = v_total_payable,
           upfront_amount = v_upfront,
           next_due_date = v_next_due,
           updated_by = auth.uid()
     where id = p_contract_id;
  end if;

  v_after := jsonb_build_object(
    'tenor', p_new_tenor, 'rate_bp', p_new_rate_bp, 'rate_basis', p_new_rate_basis,
    'first_due_date', p_new_first_due, 'rebuild_schedule', p_rebuild_schedule,
    'effective_from', p_effective_from
  );

  insert into public.credit_contract_amendments (
    organization_id, contract_id, reason, before_snapshot, after_snapshot, effective_from,
    schedule_rebuilt, created_by
  ) values (
    v_contract.organization_id, p_contract_id, p_reason, v_before, v_after, p_effective_from,
    p_rebuild_schedule, auth.uid()
  );

  perform public.fn_refresh_installment_statuses(p_contract_id);
  perform public.fn_refresh_contract(p_contract_id);

  perform public.fn_log_audit(
    v_contract.organization_id, 'UPDATE', 'credit_contracts', p_contract_id,
    format('Amandemen kontrak %s: %s', v_contract.contract_number, p_reason),
    v_before, v_after
  );

  perform public.fn_notify(
    v_contract.organization_id, 'CONTRACT_AMENDED', 'Kontrak diamandemen',
    format('Kontrak %s diamandemen: %s', v_contract.contract_number, p_reason),
    format('/app/contracts/%s', p_contract_id), 'credit_contracts', p_contract_id
  );

  return jsonb_build_object('contract_id', p_contract_id, 'schedule_rebuilt', p_rebuild_schedule);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pembatalan kontrak & cicilan
-- -----------------------------------------------------------------------------

create or replace function public.rpc_cancel_contract(p_contract_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract public.credit_contracts;
  v_cancelled integer;
  v_paid bigint;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'Alasan pembatalan kontrak wajib diisi minimal 5 karakter.' using errcode = '22023';
  end if;

  select * into v_contract from public.credit_contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Kontrak tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_contract.organization_id);
  if not public.fn_can_configure(v_contract.organization_id) then
    raise exception 'Hanya Admin atau Super Admin yang boleh membatalkan kontrak.' using errcode = '42501';
  end if;
  if v_contract.status = 'CANCELLED' then
    raise exception 'Kontrak sudah dibatalkan.' using errcode = '22023';
  end if;

  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.installments i where i.contract_id = p_contract_id;
  if v_paid > 0 then
    raise exception
      'Kontrak sudah memiliki pembayaran sebesar %. Batalkan pembayaran (reversal) terlebih dahulu sebelum membatalkan kontrak.',
      v_paid using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();

  update public.installments
     set status = 'CANCELLED', cancelled_at = now(), cancel_reason = p_reason
   where contract_id = p_contract_id and paid_amount = 0;
  get diagnostics v_cancelled = row_count;

  update public.credit_contracts
     set status = 'CANCELLED', cancelled_at = now(), cancel_reason = p_reason,
         outstanding = 0, next_due_date = null, updated_by = auth.uid()
   where id = p_contract_id;

  perform public.fn_refresh_customer(v_contract.customer_id);
  perform public.fn_log_audit(
    v_contract.organization_id, 'CANCEL', 'credit_contracts', p_contract_id,
    format('Kontrak %s dibatalkan: %s', v_contract.contract_number, p_reason),
    to_jsonb(v_contract), jsonb_build_object('reason', p_reason, 'installments_cancelled', v_cancelled)
  );

  return jsonb_build_object('contract_id', p_contract_id, 'installments_cancelled', v_cancelled);
end;
$$;

create or replace function public.rpc_cancel_installment(p_installment_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_installment public.installments;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'Alasan pembatalan cicilan wajib diisi minimal 5 karakter.' using errcode = '22023';
  end if;

  select * into v_installment from public.installments where id = p_installment_id for update;
  if not found then
    raise exception 'Cicilan tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_installment.organization_id);
  if not public.fn_can_configure(v_installment.organization_id) then
    raise exception 'Hanya Admin atau Super Admin yang boleh membatalkan cicilan.' using errcode = '42501';
  end if;
  if v_installment.paid_amount > 0 then
    raise exception 'Cicilan yang sudah dibayar tidak dapat dibatalkan.' using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();

  update public.installments
     set status = 'CANCELLED', cancelled_at = now(), cancel_reason = p_reason
   where id = p_installment_id;

  perform public.fn_refresh_contract(v_installment.contract_id);
  perform public.fn_log_audit(
    v_installment.organization_id, 'CANCEL', 'installments', p_installment_id,
    format('Cicilan ke-%s dibatalkan: %s', v_installment.installment_number, p_reason),
    to_jsonb(v_installment), jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('installment_id', p_installment_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifikasi
-- -----------------------------------------------------------------------------

create or replace function public.rpc_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  update public.notifications n
     set is_read = true, read_at = now()
   where public.fn_is_member(n.organization_id)
     and (n.user_id is null or n.user_id = auth.uid())
     and not n.is_read
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Bootstrap Super Admin
-- -----------------------------------------------------------------------------
-- Membuat pengguna auth pertama + organisasi + keanggotaan Super Admin.
--
-- KEAMANAN:
--   * Hanya dapat dijalankan bila BELUM ADA Super Admin di seluruh sistem.
--   * Tidak dapat dipanggil oleh anon/authenticated (hanya service_role / postgres).
--   * Password TIDAK PERNAH disimpan di source code; dikirim sebagai parameter
--     dari skrip bootstrap yang mengambilnya dari variabel lingkungan lokal.
--   * Password di-hash dengan bcrypt (crypt + gen_salt('bf')).
-- -----------------------------------------------------------------------------

create or replace function public.rpc_bootstrap_super_admin(
  p_email text,
  p_password text,
  p_full_name text,
  p_org_name text,
  p_org_code text default null
)
returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_existing integer;
  v_code text;
begin
  select count(*) into v_existing
    from public.organization_members m
   where m.role = 'SUPER_ADMIN' and m.is_active;

  if v_existing > 0 then
    raise exception 'Bootstrap ditolak: sudah terdapat Super Admin aktif. Gunakan halaman pengguna untuk menambah anggota.'
      using errcode = '42501';
  end if;

  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email tidak valid.' using errcode = '22023';
  end if;
  if p_password is null or char_length(p_password) < 10 then
    raise exception 'Password minimal 10 karakter.' using errcode = '22023';
  end if;
  if p_org_name is null or char_length(trim(p_org_name)) < 2 then
    raise exception 'Nama usaha minimal 2 karakter.' using errcode = '22023';
  end if;

  v_code := upper(regexp_replace(coalesce(nullif(trim(p_org_code), ''), left(regexp_replace(p_org_name, '[^A-Za-z0-9]', '', 'g'), 6)), '[^A-Z0-9]', '', 'g'));
  if v_code is null or char_length(v_code) < 2 then
    v_code := 'ORG';
  end if;
  v_code := left(v_code, 12);

  select id into v_user_id from auth.users where lower(email) = lower(p_email);

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      lower(p_email), crypt(p_password, gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', p_full_name), now(), now()
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email), 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_user_id;
  end if;

  insert into public.profiles (id, email, full_name, is_active)
  values (v_user_id, lower(p_email), coalesce(p_full_name, ''), true)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, is_active = true;

  select id into v_org_id from public.organizations where upper(code) = v_code;
  if v_org_id is null then
    insert into public.organizations (name, code, created_by)
    values (trim(p_org_name), v_code, v_user_id)
    returning id into v_org_id;
  end if;

  insert into public.app_settings (organization_id) values (v_org_id)
  on conflict (organization_id) do nothing;

  insert into public.organization_members (organization_id, user_id, role, is_active, joined_at, created_by)
  values (v_org_id, v_user_id, 'SUPER_ADMIN', true, now(), v_user_id)
  on conflict (organization_id, user_id) do update set role = 'SUPER_ADMIN', is_active = true;

  update public.profiles set active_organization_id = v_org_id where id = v_user_id;

  insert into public.audit_logs (organization_id, actor_id, actor_email, action, entity_type, entity_id, summary)
  values (v_org_id, v_user_id, lower(p_email), 'CREATE', 'organizations', v_org_id,
          'Bootstrap Super Admin dan organisasi awal');

  return jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'organization_code', v_code,
    'email', lower(p_email)
  );
end;
$$;

-- Bootstrap hanya untuk service_role / postgres — bukan untuk klien.
revoke all on function public.rpc_bootstrap_super_admin(text, text, text, text, text) from public, anon, authenticated;

-- =============================================================================
-- SELESAI
-- =============================================================================
