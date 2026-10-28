-- =============================================================================
-- KreditKu — supabase/seed.sql
-- DATA CONTOH UNTUK PENGEMBANGAN SAJA.
--
-- ATURAN PENTING:
--   * Berkas ini HANYA dijalankan oleh `supabase db reset` pada lingkungan lokal
--     atau ketika dipanggil manual. `supabase db push` (deployment) TIDAK
--     menjalankan berkas ini.
--   * Seed menolak berjalan bila sudah ada organisasi lain pada database,
--     sehingga tidak mungkin merusak data produksi secara tidak sengaja.
--   * Password akun contoh di bawah HANYA untuk pengembangan lokal dan tidak
--     boleh dipakai pada lingkungan nyata.
--
-- Akun contoh (lokal):
--   superadmin@kreditku.local / DevPassword123!
--   admin@kreditku.local      / DevPassword123!
--   kasir@kreditku.local      / DevPassword123!
-- =============================================================================

do $$
declare
  v_org_count integer;
  v_org_id uuid;
  v_super uuid;
  v_admin uuid;
  v_cashier uuid;
  v_customer_1 uuid;
  v_customer_2 uuid;
  v_app_1 uuid;
  v_app_2 uuid;
  v_contract_1 uuid;
  v_contract_2 uuid;
  v_result jsonb;
  v_dev_password text := 'DevPassword123!';
begin
  select count(*) into v_org_count from public.organizations;
  if v_org_count > 0 then
    raise notice 'Seed dilewati: sudah terdapat organisasi pada database ini.';
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Organisasi
  -- ---------------------------------------------------------------------------
  insert into public.organizations (name, code, address, phone, email)
  values ('KreditKu Demo', 'DEMO', 'Jl. Contoh No. 1, Jakarta', '0211234567', 'demo@kreditku.local')
  returning id into v_org_id;

  insert into public.app_settings (organization_id) values (v_org_id)
  on conflict (organization_id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Pengguna & keanggotaan
  -- ---------------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'superadmin@kreditku.local', crypt(v_dev_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Super Admin Demo'), now(), now()
  ) returning id into v_super;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_super, v_super::text,
          jsonb_build_object('sub', v_super::text, 'email', 'superadmin@kreditku.local', 'email_verified', true),
          'email', now(), now(), now());

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin@kreditku.local', crypt(v_dev_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Admin Demo'), now(), now()
  ) returning id into v_admin;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_admin, v_admin::text,
          jsonb_build_object('sub', v_admin::text, 'email', 'admin@kreditku.local', 'email_verified', true),
          'email', now(), now(), now());

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'kasir@kreditku.local', crypt(v_dev_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Kasir Demo'), now(), now()
  ) returning id into v_cashier;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_cashier, v_cashier::text,
          jsonb_build_object('sub', v_cashier::text, 'email', 'kasir@kreditku.local', 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profiles (id, email, full_name, active_organization_id)
  values
    (v_super, 'superadmin@kreditku.local', 'Super Admin Demo', v_org_id),
    (v_admin, 'admin@kreditku.local', 'Admin Demo', v_org_id),
    (v_cashier, 'kasir@kreditku.local', 'Kasir Demo', v_org_id);

  insert into public.organization_members (organization_id, user_id, role, is_active, joined_at)
  values
    (v_org_id, v_super, 'SUPER_ADMIN', true, now()),
    (v_org_id, v_admin, 'ADMIN', true, now()),
    (v_org_id, v_cashier, 'CASHIER', true, now());

  -- ---------------------------------------------------------------------------
  -- Aturan denda contoh (aktif untuk menguji jalur perhitungan denda)
  -- ---------------------------------------------------------------------------
  update public.app_settings
     set penalty = jsonb_build_object(
           'type', 'FIXED_PER_DAY', 'amount', 5000, 'grace_days', 3,
           'max_amount', 500000, 'percent_base', 'OUTSTANDING'
         )
   where organization_id = v_org_id;

  -- ---------------------------------------------------------------------------
  -- Pelanggan
  -- ---------------------------------------------------------------------------
  insert into public.customers (
    organization_id, customer_number, full_name, phone, email, address, occupation,
    monthly_income, status, created_by
  ) values (
    v_org_id, 'CUST-' || to_char(current_date, 'YYYYMM') || '-00001', 'Budi Santoso',
    '081234567890', 'budi@example.com', 'Jl. Melati No. 10, Bandung', 'Karyawan Swasta',
    8500000, 'ACTIVE', v_admin
  ) returning id into v_customer_1;

  insert into public.customers (
    organization_id, customer_number, full_name, phone, address, occupation,
    monthly_income, status, created_by
  ) values (
    v_org_id, 'CUST-' || to_char(current_date, 'YYYYMM') || '-00002', 'Siti Aminah',
    '081298765432', 'Jl. Kenanga No. 5, Jakarta', 'Wirausaha',
    12000000, 'ACTIVE', v_admin
  ) returning id into v_customer_2;

  -- ---------------------------------------------------------------------------
  -- Produk kredit
  -- ---------------------------------------------------------------------------
  insert into public.credit_products (
    organization_id, code, name, default_tenor, default_method, default_rate_bp,
    default_rate_basis, default_frequency, default_admin_fee, min_down_payment_pct
  ) values (
    v_org_id, 'MOTOR', 'Kredit Sepeda Motor', 12, 'FLAT', 200, 'PER_MONTH', 'MONTHLY', 250000, 20
  );

  -- ---------------------------------------------------------------------------
  -- Pengajuan kredit (disetujui) — memakai RPC agar jadwal dibuat server-side
  -- ---------------------------------------------------------------------------
  insert into public.credit_applications (
    organization_id, application_number, customer_id, credit_type, price, down_payment,
    principal, tenor, method, rate_bp, rate_basis, frequency, admin_fee, admin_fee_position,
    first_due_date, disbursement_date, status, created_by
  ) values (
    v_org_id, 'APP-' || to_char(current_date, 'YYYYMM') || '-00001', v_customer_1,
    'Sepeda Motor', 24000000, 5000000, 19000000, 12, 'FLAT', 200, 'PER_MONTH', 'MONTHLY',
    250000, 'UPFRONT', (date_trunc('month', current_date) + interval '1 month')::date,
    current_date, 'SUBMITTED', v_admin
  ) returning id into v_app_1;

  insert into public.credit_applications (
    organization_id, application_number, customer_id, credit_type, price, down_payment,
    principal, tenor, method, rate_bp, rate_basis, frequency, admin_fee, admin_fee_position,
    first_due_date, disbursement_date, status, created_by
  ) values (
    v_org_id, 'APP-' || to_char(current_date, 'YYYYMM') || '-00002', v_customer_2,
    'Mesin Produksi', 60000000, 12000000, 48000000, 24, 'ANNUITY', 150, 'PER_MONTH', 'MONTHLY',
    500000, 'FIRST_INSTALLMENT', (date_trunc('month', current_date) + interval '1 month')::date,
    current_date, 'SUBMITTED', v_admin
  ) returning id into v_app_2;

  -- Persetujuan dilakukan sebagai Super Admin (pemisahan tugas aktif).
  perform set_config('request.jwt.claim.sub', v_super::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_super::text)::text, true);

  v_result := public.rpc_decide_application(v_app_1, 'APPROVED', 'Data lengkap dan layak berdasarkan analisis awal', null);
  v_contract_1 := (v_result ->> 'contract_id')::uuid;

  v_result := public.rpc_decide_application(v_app_2, 'APPROVED', 'Laporan keuangan usaha menunjukkan kapasitas memadai', null);
  v_contract_2 := (v_result ->> 'contract_id')::uuid;

  -- ---------------------------------------------------------------------------
  -- Pembayaran contoh pada kontrak pertama (dilakukan sebagai Kasir)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_cashier::text, true);

  perform public.rpc_post_payment(
    v_contract_1, 1700000, 'CASH', 'seed-payment-0000000001',
    now() - interval '20 days', 'TUNAI-001', 'Pembayaran cicilan pertama', null, null, null, null, null
  );

  perform public.rpc_post_payment(
    v_contract_1, 850000, 'BANK_TRANSFER', 'seed-payment-0000000002',
    now() - interval '5 days', 'TRF-8812', 'Pembayaran sebagian cicilan kedua', null, null, null, null, null
  );

  -- Perhitungan denda & antrean pengingat dijalankan sebagai Super Admin.
  perform set_config('request.jwt.claim.sub', v_super::text, true);
  perform public.rpc_apply_penalties(v_org_id, current_date, null);
  perform public.rpc_enqueue_reminders(v_org_id, current_date);

  raise notice 'Seed selesai. Organisasi: %, kontrak: %, %', v_org_id, v_contract_1, v_contract_2;
end $$;
