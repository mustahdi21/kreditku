-- =============================================================================
-- KreditKu — supabase/tests/02_integration.sql
-- UJI INTEGRASI END-TO-END pada database sungguhan.
--
-- Alur yang diuji:
--   bootstrap → pelanggan → pengajuan → persetujuan (kontrak + jadwal)
--   → pembayaran & alokasi → pembayaran ganda (idempotensi) → kelebihan bayar
--   → denda (tidak ganda, batas maksimum, pembebasan) → pembatalan pembayaran
--   → pengingat (deduplikasi) → metrik dashboard
--   → isolasi organisasi (RLS) → trigger pelindung data finansial
--
-- Seluruh perubahan DIBATALKAN (ROLLBACK) sehingga aman dijalankan pada database
-- pengembangan. JANGAN dijalankan pada database produksi berisi data nyata.
--
-- Jalankan:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/02_integration.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Perkakas uji
-- -----------------------------------------------------------------------------

create or replace function public.fn_test_assert(p_condition boolean, p_message text)
returns void
language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'GAGAL UJI: %', p_message;
  end if;
  raise notice 'LULUS ✔ %', p_message;
end;
$$;

create or replace function public.fn_test_expect_error(p_sql text, p_fragment text, p_message text)
returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_fragment = '' or position(lower(p_fragment) in lower(sqlerrm)) > 0 then
      raise notice 'LULUS ✔ % [%]', p_message, sqlerrm;
      return;
    end if;
    raise exception 'GAGAL UJI: % — pesan tidak sesuai. Diharapkan mengandung "%", diterima: "%"',
      p_message, p_fragment, sqlerrm;
  end;
  raise exception 'GAGAL UJI: % — operasi seharusnya ditolak, tetapi berhasil.', p_message;
end;
$$;

create or replace function public.fn_test_expect_no_change(p_sql text, p_message text)
returns void
language plpgsql as $$
declare
  v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'GAGAL UJI: % — % baris berubah, seharusnya tidak ada.', p_message, v_rows;
  end if;
  raise notice 'LULUS ✔ % (0 baris berubah)', p_message;
end;
$$;

create or replace function public.fn_test_set_user(p_email text)
returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'GAGAL UJI: pengguna uji % tidak ditemukan.', p_email;
  end if;
  perform set_config('request.jwt.claim.sub', v_id::text, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Bootstrap organisasi & pengguna uji
-- -----------------------------------------------------------------------------

do $$
declare
  v_bootstrap jsonb;
  v_owner uuid;
  v_org uuid;
  v_app uuid;
  v_contract uuid;
  v_payment uuid;
  v_penalty uuid;
  v_customer uuid;
  v_decision jsonb;
  v_first_payment jsonb;
  v_second_payment jsonb;
  v_metric jsonb;
  v_before_paid bigint;
  v_count integer;
  v_reminders integer;
  v_interest bigint;
  v_payable bigint;
  v_principal_sum bigint;
  v_installment_id uuid;
  v_penalty_amount bigint;
begin
  ---------------------------------------------------------------------------
  -- 1. Bootstrap
  ---------------------------------------------------------------------------
  v_bootstrap := public.rpc_bootstrap_super_admin(
    'owner@uji.local', 'UjiPassword123', 'Pemilik Uji', 'Usaha Uji', 'UJI'
  );
  v_org := (v_bootstrap ->> 'organization_id')::uuid;
  v_owner := (v_bootstrap ->> 'user_id')::uuid;

  perform public.fn_test_assert(
    (select count(*) from public.organization_members where role = 'SUPER_ADMIN' and is_active) = 1,
    'bootstrap membuat tepat satu Super Admin aktif'
  );

  perform public.fn_test_assert(
    (select count(*) from public.app_settings where organization_id = v_org) = 1,
    'bootstrap membuat pengaturan bawaan organisasi'
  );

  perform public.fn_test_assert(
    (select count(*) from public.audit_logs where organization_id = v_org and action = 'CREATE') >= 1,
    'bootstrap tercatat pada audit log'
  );

  -- Pengguna tambahan: Admin (penyetuju), Kasir, dan pengguna organisasi lain.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
  values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'kasir@uji.local', crypt('UjiPassword123', gen_salt('bf')), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'lain@uji.local', crypt('UjiPassword123', gen_salt('bf')), now()),
    ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin@uji.local', crypt('UjiPassword123', gen_salt('bf')), now());

  insert into public.profiles (id, email, full_name)
  values
    ('11111111-1111-1111-1111-111111111111', 'kasir@uji.local', 'Kasir Uji'),
    ('22222222-2222-2222-2222-222222222222', 'lain@uji.local', 'Pengguna Organisasi Lain'),
    ('44444444-4444-4444-4444-444444444444', 'admin@uji.local', 'Admin Uji')
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.organization_members (organization_id, user_id, role, is_active)
  values
    (v_org, '11111111-1111-1111-1111-111111111111', 'CASHIER', true),
    (v_org, '44444444-4444-4444-4444-444444444444', 'ADMIN', true);

  insert into public.organizations (id, name, code)
  values ('33333333-3333-3333-3333-333333333333', 'Usaha Lain', 'LAIN');

  insert into public.organization_members (organization_id, user_id, role, is_active)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'SUPER_ADMIN', true);

  insert into public.app_settings (organization_id) values ('33333333-3333-3333-3333-333333333333');

  ---------------------------------------------------------------------------
  -- 2. Pelanggan & penomoran otomatis
  ---------------------------------------------------------------------------
  perform public.fn_test_set_user('owner@uji.local');

  perform public.fn_test_assert(
    public.fn_next_number('customer', to_char(current_date, 'YYYYMM'), current_date, 'CUST')
      like 'CUST-' || to_char(current_date, 'YYYYMM') || '-%',
    'nomor pelanggan mengikuti template default'
  );

  insert into public.customers (organization_id, customer_number, full_name, phone, status, created_by, updated_by)
  values (
    v_org,
    public.fn_next_number('customer', to_char(current_date, 'YYYYMM'), current_date, 'CUST'),
    'Budi Uji', '081200000001', 'ACTIVE', v_owner, v_owner
  )
  returning id into v_customer;

  perform public.fn_test_assert(
    (select count(*) from public.audit_logs where entity_type = 'customers' and action = 'CREATE') >= 1,
    'pembuatan pelanggan tercatat pada audit log'
  );

  ---------------------------------------------------------------------------
  -- 3. Pengajuan kredit & pemisahan tugas
  ---------------------------------------------------------------------------
  insert into public.credit_applications (
    organization_id, application_number, customer_id, credit_type, price, down_payment, principal,
    tenor, method, rate_bp, rate_basis, frequency, admin_fee, admin_fee_position,
    first_due_date, disbursement_date, status, created_by
  ) values (
    v_org, 'APP-UJI-0001', v_customer, 'Sepeda Motor', 24000000, 4000000, 20000000,
    12, 'FLAT', 200, 'PER_MONTH', 'MONTHLY', 0, 'UPFRONT',
    (current_date + interval '1 month')::date, current_date, 'SUBMITTED', v_owner
  ) returning id into v_app;

  perform public.fn_test_expect_error(
    format(
      $x$select public.rpc_decide_application('%s'::uuid, 'APPROVED', 'Percobaan menyetujui pengajuan sendiri', null)$x$,
      v_app
    ),
    'Pemisahan tugas',
    'pengaju tidak dapat menyetujui pengajuannya sendiri'
  );

  perform public.fn_test_set_user('admin@uji.local');
  v_decision := public.rpc_decide_application(v_app, 'APPROVED', 'Data lengkap dan layak berdasarkan analisis kapasitas', null);

  perform public.fn_test_assert(
    (v_decision ->> 'status') = 'APPROVED',
    'pengajuan disetujui oleh Admin (bukan pengaju)'
  );

  v_contract := (v_decision ->> 'contract_id')::uuid;

  perform public.fn_test_assert(
    (select count(*) from public.credit_contracts where application_id = v_app) = 1,
    'persetujuan membuat tepat satu kontrak'
  );

  select total_interest, total_payable into v_interest, v_payable
    from public.credit_contracts where id = v_contract;

  perform public.fn_test_assert(v_interest = 4800000, 'total bunga = 2% × 20.000.000 × 12 = 4.800.000');
  perform public.fn_test_assert(v_payable = 24800000, 'total kewajiban = 20.000.000 + 4.800.000 = 24.800.000');

  perform public.fn_test_assert(
    (select count(*) from public.installments where contract_id = v_contract) = 12,
    'jadwal cicilan dibuat sejumlah tenor'
  );

  select coalesce(sum(principal), 0) into v_principal_sum from public.installments where contract_id = v_contract;
  perform public.fn_test_assert(v_principal_sum = 20000000, 'total pokok jadwal tepat sama dengan pokok pembiayaan');

  perform public.fn_test_assert(
    (select status from public.credit_contracts where id = v_contract) = 'ACTIVE',
    'kontrak baru berstatus ACTIVE'
  );

  perform public.fn_test_assert(
    (select outstanding from public.credit_contracts where id = v_contract) = 24800000,
    'sisa piutang awal sama dengan total kewajiban'
  );

  perform public.fn_test_assert(
    (select status from public.customers where id = v_customer) = 'ACTIVE',
    'status pelanggan diperbarui otomatis menjadi ACTIVE'
  );

  perform public.fn_test_assert(
    (select count(*) from public.credit_application_status_history where application_id = v_app and to_status = 'APPROVED') = 1,
    'riwayat perubahan status pengajuan tercatat'
  );

  ---------------------------------------------------------------------------
  -- 4. Pembayaran: alokasi, idempotensi, kelebihan bayar
  ---------------------------------------------------------------------------
  perform public.fn_test_set_user('kasir@uji.local');

  v_first_payment := public.rpc_post_payment(
    v_contract, 1500000, 'CASH', 'uji-idempotency-0001', now(), 'TUNAI-UJI', 'Pembayaran cicilan pertama',
    'OLDEST_FIRST', false, false, null, null
  );

  perform public.fn_test_assert((v_first_payment ->> 'duplicate') = 'false', 'pembayaran pertama dibuat (bukan duplikat)');
  perform public.fn_test_assert(
    (select count(*) from public.payments where idempotency_key = 'uji-idempotency-0001') = 1,
    'tepat satu baris pembayaran tersimpan'
  );

  -- Pengulangan dengan kunci idempotency yang sama.
  v_second_payment := public.rpc_post_payment(
    v_contract, 1500000, 'CASH', 'uji-idempotency-0001', now(), 'TUNAI-UJI', 'Kiriman ulang tombol',
    'OLDEST_FIRST', false, false, null, null
  );

  perform public.fn_test_assert((v_second_payment ->> 'duplicate') = 'true', 'klik ganda dikenali sebagai duplikat');
  perform public.fn_test_assert(
    (select count(*) from public.payments where idempotency_key = 'uji-idempotency-0001') = 1,
    'klik ganda tidak menghasilkan pembayaran kedua'
  );

  select id into v_payment from public.payments where idempotency_key = 'uji-idempotency-0001';

  perform public.fn_test_assert(
    (select coalesce(sum(amount), 0) from public.payment_allocations where payment_id = v_payment) = 1500000,
    'alokasi pembayaran berjumlah tepat sama dengan nominal'
  );

  perform public.fn_test_assert(
    (select total_paid from public.credit_contracts where id = v_contract) = 1500000,
    'total terbayar kontrak bertambah sesuai pembayaran'
  );

  perform public.fn_test_assert(
    (select outstanding from public.credit_contracts where id = v_contract) = 23300000,
    'sisa piutang berkurang tepat 1.500.000'
  );

  perform public.fn_test_assert(
    (select status from public.installments where contract_id = v_contract and installment_number = 1) = 'PARTIAL',
    'cicilan yang dibayar sebagian berstatus PARTIAL'
  );

  perform public.fn_test_assert(
    (select count(*) from public.payments where unallocated > 0) = 0,
    'tidak ada kelebihan bayar pada pembayaran yang sah'
  );

  perform public.fn_test_expect_error(
    format(
      $x$select public.rpc_post_payment('%s'::uuid, 999000000, 'CASH', 'uji-overpay-000001', now(), null, null, 'OLDEST_FIRST', false, false, null, null)$x$,
      v_contract
    ),
    'melebihi total kewajiban',
    'pembayaran melebihi kewajiban terbuka ditolak'
  );

  perform public.fn_test_expect_error(
    format($x$select public.rpc_reverse_payment('%s'::uuid, 'Percobaan kasir membatalkan pembayaran')$x$, v_payment),
    'Hanya Admin atau Super Admin',
    'kasir tidak boleh membatalkan pembayaran'
  );

  ---------------------------------------------------------------------------
  -- 5. Denda: tidak ganda, batas maksimum, pembebasan
  ---------------------------------------------------------------------------
  perform public.fn_test_set_user('admin@uji.local');

  update public.app_settings
     set penalty = jsonb_build_object(
           'type', 'FIXED_PER_DAY', 'amount', 10000, 'grace_days', 3,
           'max_amount', 200000, 'percent_base', 'OUTSTANDING'
         )
   where organization_id = v_org;

  select id into v_installment_id from public.installments where contract_id = v_contract and installment_number = 2;

  -- Menggeser jatuh tempo cicilan ke 10 hari lalu agar melewati masa tenggang.
  update public.installments
     set due_date = current_date - 10, base_due_date = current_date - 10
   where id = v_installment_id;

  perform public.rpc_apply_penalties(v_org, current_date, null);

  perform public.fn_test_assert(
    (select count(*) from public.penalties) = 1,
    'denda dibuat hanya untuk cicilan yang memenuhi syarat'
  );

  select amount into v_penalty_amount from public.penalties limit 1;
  perform public.fn_test_assert(
    v_penalty_amount = 70000,
    format('denda = (10 hari terlambat − 3 hari tenggang) × 10.000 = 70.000 (diterima: %s)', v_penalty_amount)
  );

  perform public.rpc_apply_penalties(v_org, current_date, null);
  perform public.fn_test_assert(
    (select count(*) from public.penalties) = 1,
    'perhitungan ulang tidak menggandakan catatan denda'
  );

  update public.app_settings
     set penalty = penalty || jsonb_build_object('max_amount', 50000)
   where organization_id = v_org;

  perform public.rpc_apply_penalties(v_org, current_date, null);
  perform public.fn_test_assert(
    (select amount from public.penalties limit 1) = 50000,
    'denda dibatasi pada batas maksimum 50.000'
  );

  select id into v_penalty from public.penalties limit 1;
  perform public.rpc_waive_penalty(v_penalty, 50000, 'Pembebasan karena pelanggan kooperatif dan tepat waktu');

  perform public.fn_test_assert(
    (select status from public.penalties where id = v_penalty) = 'WAIVED',
    'denda yang dibebaskan penuh berstatus WAIVED'
  );

  perform public.fn_test_assert(
    (select count(*) from public.audit_logs where action = 'WAIVE_PENALTY') = 1,
    'pembebasan denda tercatat pada audit log'
  );

  ---------------------------------------------------------------------------
  -- 6. Pembatalan pembayaran (reversal)
  ---------------------------------------------------------------------------
  select coalesce(sum(paid_amount), 0) into v_before_paid from public.installments where contract_id = v_contract;

  perform public.rpc_reverse_payment(v_payment, 'Salah mencatat nominal pembayaran');

  perform public.fn_test_assert(
    (select status from public.payments where id = v_payment) = 'REVERSED',
    'pembayaran berstatus REVERSED setelah dibatalkan'
  );

  perform public.fn_test_assert(
    (select count(*) from public.payment_reversals where payment_id = v_payment) = 1,
    'catatan pembatalan pembayaran dibuat'
  );

  perform public.fn_test_assert(
    (select coalesce(sum(paid_amount), 0) from public.installments where contract_id = v_contract) = 0,
    'saldo cicilan dikembalikan ke nol setelah pembatalan'
  );

  perform public.fn_test_assert(
    (select total_paid from public.credit_contracts where id = v_contract) = 0,
    'total terbayar kontrak dihitung ulang menjadi nol'
  );

  perform public.fn_test_assert(
    (select outstanding from public.credit_contracts where id = v_contract) = 24800000,
    'sisa piutang kembali ke total kewajiban'
  );

  perform public.fn_test_assert(
    (select count(*) from public.payment_allocations where payment_id = v_payment) = 1,
    'alokasi pembayaran asli tetap tersimpan sebagai riwayat'
  );

  perform public.fn_test_expect_error(
    format($x$select public.rpc_reverse_payment('%s'::uuid, 'Percobaan membatalkan dua kali')$x$, v_payment),
    'sudah dibatalkan',
    'pembatalan pembayaran ganda ditolak'
  );

  ---------------------------------------------------------------------------
  -- 7. Pengingat: deduplikasi
  ---------------------------------------------------------------------------
  perform public.rpc_enqueue_reminders(v_org, current_date);
  select count(*) into v_reminders from public.reminders;

  perform public.rpc_enqueue_reminders(v_org, current_date);
  perform public.fn_test_assert(
    (select count(*) from public.reminders) = v_reminders,
    'membentuk antrean pengingat dua kali tidak menggandakan data'
  );

  ---------------------------------------------------------------------------
  -- 9. Metrik dashboard
  ---------------------------------------------------------------------------
  v_metric := public.rpc_dashboard_metrics(current_date - 30, current_date, null);

  perform public.fn_test_assert(
    (v_metric ->> 'active_contracts')::int = 1,
    'metrik: satu kontrak aktif'
  );

  perform public.fn_test_assert(
    (v_metric ->> 'collections_in_range')::bigint = 0,
    'metrik: pembayaran yang dibatalkan tidak dihitung sebagai penerimaan'
  );

  perform public.fn_test_assert(
    (v_metric ->> 'reversals_in_range')::bigint = 1500000,
    'metrik: pembatalan pembayaran tercatat terpisah'
  );

  perform public.fn_test_assert(
    (v_metric ->> 'outstanding_total')::bigint = 24800000,
    'metrik: piutang berjalan = total kewajiban kontrak aktif'
  );

  perform public.fn_test_assert(
    (v_metric ->> 'overdue_total')::bigint > 0,
    'metrik: tunggakan terdeteksi pada cicilan yang melewati jatuh tempo'
  );

  perform public.fn_test_assert(
    (v_metric ->> 'penalty_outstanding')::bigint = 0,
    'metrik: denda yang sudah dibebaskan tidak dihitung sebagai denda terbuka'
  );

  perform public.fn_test_assert(
    (select count(*) from public.v_contract_summary where id = v_contract) = 1,
    'view ringkasan kontrak dapat dibaca oleh pemilik data'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 10. Isolasi organisasi (Row Level Security)
-- -----------------------------------------------------------------------------

create table public.uji_ids (key text primary key, val uuid);
insert into public.uji_ids (key, val)
select 'contract', id from public.credit_contracts limit 1;
insert into public.uji_ids (key, val)
select 'installment', id from public.installments where installment_number = 2 limit 1;
insert into public.uji_ids (key, val)
select 'payment', id from public.payments limit 1;
insert into public.uji_ids (key, val)
select 'customer', id from public.customers limit 1;
insert into public.uji_ids (key, val)
select 'penalty', id from public.penalties limit 1;
grant select on public.uji_ids to authenticated;

select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'lain@uji.local'), true);
set local role authenticated;

do $$
begin
  perform public.fn_test_assert(
    (select count(*) from public.customers) = 0,
    'RLS: pengguna organisasi lain tidak melihat pelanggan organisasi pertama'
  );
  perform public.fn_test_assert(
    (select count(*) from public.credit_contracts) = 0,
    'RLS: pengguna organisasi lain tidak melihat kontrak organisasi pertama'
  );
  perform public.fn_test_assert(
    (select count(*) from public.payments) = 0,
    'RLS: pengguna organisasi lain tidak melihat pembayaran organisasi pertama'
  );
  perform public.fn_test_assert(
    (select count(*) from public.installments) = 0,
    'RLS: pengguna organisasi lain tidak melihat cicilan organisasi pertama'
  );
  perform public.fn_test_assert(
    (select count(*) from public.v_contract_summary) = 0,
    'RLS: view ringkasan kontrak tetap tunduk pada RLS'
  );
  perform public.fn_test_assert(
    (select count(*) from public.v_installment_details) = 0,
    'RLS: view rincian cicilan tetap tunduk pada RLS'
  );
  perform public.fn_test_assert(
    public.fn_current_org() = '33333333-3333-3333-3333-333333333333'::uuid,
    'RLS: organisasi aktif dihitung dari keanggotaan pengguna'
  );
end $$;

reset role;

select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'kasir@uji.local'), true);
set local role authenticated;

do $$
begin
  perform public.fn_test_assert(
    (select count(*) from public.customers) = 1,
    'RLS: anggota organisasi melihat data organisasinya sendiri'
  );
  perform public.fn_test_assert(
    (select count(*) from public.v_installment_details) = 12,
    'RLS: view rincian cicilan menampilkan seluruh jadwal kontrak miliknya'
  );
  perform public.fn_test_assert(
    (select count(*) from public.audit_logs) = 0,
    'RLS: kasir tidak dapat membaca audit log'
  );
  perform public.fn_test_assert(
    (select count(*) from public.app_settings) = 1,
    'RLS: kasir dapat membaca pengaturan organisasinya'
  );

  perform public.fn_test_assert(
    public.fn_can_collect_payment(public.fn_current_org()),
    'izin: kasir boleh mencatat pembayaran'
  );
  perform public.fn_test_assert(
    not public.fn_can_configure(public.fn_current_org()),
    'izin: kasir tidak boleh mengubah konfigurasi'
  );
end $$;

-- Kasir tidak boleh mengelola pengajuan.
do $$
declare
  v_app uuid;
begin
  select id into v_app from public.credit_applications where application_number = 'APP-UJI-0001';
  perform public.fn_test_expect_error(
    format($x$select public.rpc_submit_application('%s'::uuid, null)$x$, v_app),
    'tidak diizinkan',
    'kasir dilarang mengelola pengajuan kredit'
  );
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 11. Trigger pelindung data finansial (dijalankan sebagai klien terautentikasi)
-- -----------------------------------------------------------------------------
-- Pengujian ini HARUS berjalan sebagai peran `authenticated` seperti klien
-- sungguhan, karena penanda "penulisan internal" ditentukan oleh identitas
-- eksekusi (fungsi internal berjalan sebagai pemilik basis data).

select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'admin@uji.local'), true);
set local role authenticated;

do $$
declare
  v_installment uuid;
  v_payment uuid;
  v_customer uuid;
  v_penalty uuid;
begin
  select val into v_installment from public.uji_ids where key = 'installment';
  select val into v_payment from public.uji_ids where key = 'payment';
  select val into v_customer from public.uji_ids where key = 'customer';
  select val into v_penalty from public.uji_ids where key = 'penalty';

  -- Nilai finansial cicilan hanya boleh berubah melalui prosedur resmi.
  perform public.fn_test_expect_error(
    format($x$update public.installments set paid_amount = 999999 where id = '%s'::uuid$x$, v_installment),
    'hanya boleh diubah melalui prosedur',
    'perubahan langsung paid_amount cicilan ditolak'
  );

  perform public.fn_test_expect_error(
    format($x$update public.installments set status = 'PAID' where id = '%s'::uuid$x$, v_installment),
    'hanya boleh diubah melalui prosedur',
    'perubahan langsung status cicilan ditolak'
  );

  -- Tabel pembayaran tidak memiliki kebijakan UPDATE/DELETE: RLS menolak
  -- tanpa perubahan baris, dan trigger pelindung menjadi lapisan kedua.
  perform public.fn_test_expect_no_change(
    format($x$update public.payments set amount = 1 where id = '%s'::uuid$x$, v_payment),
    'perubahan nominal pembayaran yang sudah diposting tidak menghasilkan perubahan'
  );

  perform public.fn_test_expect_no_change(
    format($x$delete from public.payments where id = '%s'::uuid$x$, v_payment),
    'penghapusan pembayaran tidak menghasilkan perubahan'
  );

  perform public.fn_test_expect_no_change(
    format($x$delete from public.customers where id = '%s'::uuid$x$, v_customer),
    'penghapusan pelanggan tidak menghasilkan perubahan (harus diarsipkan)'
  );

  perform public.fn_test_expect_error(
    format($x$update public.penalties set waived_amount = 1 where id = '%s'::uuid$x$, v_penalty),
    'hanya boleh diubah melalui',
    'perubahan langsung nilai denda ditolak'
  );

  perform public.fn_test_assert(
    (select amount from public.payments where id = v_payment) = 1500000,
    'nominal pembayaran tetap tidak berubah setelah percobaan manipulasi'
  );
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 12. Pengguna tanpa sesi tidak melihat apa pun
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

do $$
begin
  perform public.fn_test_assert(
    (select count(*) from public.customers) = 0,
    'RLS: tanpa sesi (anon), tidak ada data yang terlihat'
  );
  perform public.fn_test_assert(
    public.fn_current_org() is null,
    'RLS: tanpa sesi, organisasi aktif tidak dapat ditentukan'
  );
end $$;

reset role;

do $$
begin
  raise notice '';
  raise notice '============================================================';
  raise notice ' SELURUH UJI INTEGRASI LULUS';
  raise notice '============================================================';
end $$;

rollback;
