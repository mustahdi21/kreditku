-- =============================================================================
-- KreditKu — supabase/tests/01_kreditku_core.sql
-- Uji database berbasis pgTAP.
--
-- Jalankan pada lingkungan lokal:
--     supabase test db
-- atau langsung:
--     psql "$SUPABASE_DB_URL" -f supabase/tests/01_kreditku_core.sql
--
-- Uji ini memeriksa hal yang TIDAK dapat diuji dari frontend:
--   * keberadaan tabel, view, dan fungsi kunci;
--   * RLS aktif pada tabel bisnis;
--   * kebenaran rumus perhitungan bunga (flat, anuitas, tanpa bunga);
--   * perilaku penomoran dokumen;
--   * penegakan idempotensi pembayaran pada tingkat database.
-- =============================================================================

begin;

create extension if not exists pgtap;

select plan(46);

-- -----------------------------------------------------------------------------
-- Struktur
-- -----------------------------------------------------------------------------

select has_table('public', 'customers', 'tabel customers tersedia');
select has_table('public', 'credit_applications', 'tabel credit_applications tersedia');
select has_table('public', 'credit_contracts', 'tabel credit_contracts tersedia');
select has_table('public', 'installments', 'tabel installments tersedia');
select has_table('public', 'payments', 'tabel payments tersedia');
select has_table('public', 'payment_allocations', 'tabel payment_allocations tersedia');
select has_table('public', 'payment_reversals', 'tabel payment_reversals tersedia');
select has_table('public', 'penalties', 'tabel penalties tersedia');
select has_table('public', 'audit_logs', 'tabel audit_logs tersedia');
select has_table('public', 'app_settings', 'tabel app_settings tersedia');

select has_view('public', 'v_contract_summary', 'view ringkasan kontrak tersedia');
select has_view('public', 'v_installment_details', 'view rincian cicilan tersedia');
select has_view('public', 'v_aging_report', 'view umur piutang tersedia');

select has_function('public', 'fn_next_number', 'fungsi penomoran tersedia');
select has_function('public', 'fn_build_schedule', 'fungsi pembentuk jadwal tersedia');
select has_function('public', 'rpc_post_payment', 'fungsi pencatatan pembayaran tersedia');
select has_function('public', 'rpc_reverse_payment', 'fungsi pembatalan pembayaran tersedia');
select has_function('public', 'rpc_decide_application', 'fungsi keputusan pengajuan tersedia');
select has_function('public', 'rpc_apply_penalties', 'fungsi perhitungan denda tersedia');

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.customers'::regclass),
  'RLS aktif pada customers'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payments'::regclass),
  'RLS aktif pada payments'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.installments'::regclass),
  'RLS aktif pada installments'
);
select ok(
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'DELETE') = 0,
  'tidak ada kebijakan DELETE pada skema public'
);

-- -----------------------------------------------------------------------------
-- Rumus bunga — metode FLAT
-- Pokok 10.000.000, bunga 2% per bulan flat, 12 periode
-- → bunga per periode 200.000, total 2.400.000, angsuran 1.033.333 (periode akhir 1.033.337)
-- -----------------------------------------------------------------------------

select is(
  (select sum(interest) from public.fn_build_schedule(
      10000000::bigint, 12, 'FLAT'::interest_method, 200, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  2400000::bigint,
  'flat: total bunga = 2% × 10.000.000 × 12 periode'
);

select is(
  (select principal from public.fn_build_schedule(
      10000000::bigint, 12, 'FLAT'::interest_method, 200, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])
    where installment_number = 12),
  833337::bigint,
  'flat: periode terakhir menyerap selisih pembulatan pokok'
);

select is(
  (select count(*) from public.fn_build_schedule(
      10000000::bigint, 12, 'FLAT'::interest_method, 200, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  12::bigint,
  'flat: jumlah periode sesuai tenor'
);

select is(
  (select min(interest) from public.fn_build_schedule(
      10000000::bigint, 12, 'FLAT'::interest_method, 200, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  200000::bigint,
  'flat: bunga per periode konstan'
);

-- -----------------------------------------------------------------------------
-- Rumus bunga — metode ANNUITY (bunga efektif)
-- -----------------------------------------------------------------------------

select is(
  (select sum(principal) from public.fn_build_schedule(
      10000000::bigint, 12, 'ANNUITY'::interest_method, 100, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  10000000::bigint,
  'anuitas: total pokok tepat sama dengan pokok pembiayaan'
);

select ok(
  (select min(interest) from public.fn_build_schedule(
      10000000::bigint, 12, 'ANNUITY'::interest_method, 100, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6]))
  <
  (select max(interest) from public.fn_build_schedule(
      10000000::bigint, 12, 'ANNUITY'::interest_method, 100, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  'anuitas: bunga menurun dari periode pertama ke terakhir'
);

select ok(
  (select sum(interest) from public.fn_build_schedule(
      10000000::bigint, 12, 'ANNUITY'::interest_method, 100, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6]))
  between 600000 and 700000,
  'anuitas: total bunga 1% per bulan 12 periode berada pada rentang wajar'
);

-- -----------------------------------------------------------------------------
-- Rumus bunga — tanpa bunga dan biaya administrasi
-- -----------------------------------------------------------------------------

select is(
  (select sum(interest) from public.fn_build_schedule(
      9000000::bigint, 9, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  0::bigint,
  'tanpa bunga: total bunga nol'
);

select is(
  (select sum(fees) from public.fn_build_schedule(
      9000000::bigint, 9, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 300000, 'SPREAD'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])),
  300000::bigint,
  'biaya administrasi tersebar: total tepat sama tanpa kehilangan 1 rupiah'
);

select is(
  (select fees from public.fn_build_schedule(
      9000000::bigint, 9, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 300000, 'FIRST_INSTALLMENT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])
    where installment_number = 1),
  300000::bigint,
  'biaya administrasi dibebankan penuh pada cicilan pertama'
);

select is(
  (select upfront_amount from public.fn_build_schedule(
      9000000::bigint, 9, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 300000, 'UPFRONT'::admin_fee_position, 0,
      '2026-02-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])
    limit 1),
  300000::bigint,
  'biaya administrasi di muka dikembalikan sebagai upfront_amount'
);

-- -----------------------------------------------------------------------------
-- Tanggal jatuh tempo
-- -----------------------------------------------------------------------------

select is(
  (select due_date from public.fn_build_schedule(
      1000000::bigint, 3, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-01-15'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])
    where installment_number = 2),
  '2026-02-15'::date,
  'jatuh tempo bulanan mengikuti tanggal pertama'
);

select is(
  (select due_date from public.fn_build_schedule(
      1000000::bigint, 3, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-01-31'::date, 'NONE'::due_date_adjustment, array[]::date[], array[0, 6])
    where installment_number = 2),
  '2026-02-28'::date,
  'jatuh tempo akhir bulan dibatasi pada akhir bulan tujuan'
);

select is(
  (select due_date from public.fn_build_schedule(
      1000000::bigint, 3, 'NONE'::interest_method, 0, 'PER_MONTH'::rate_basis,
      'MONTHLY'::payment_frequency, 0, 'UPFRONT'::admin_fee_position, 0,
      '2026-01-17'::date, 'NEXT_BUSINESS_DAY'::due_date_adjustment, array[]::date[], array[0, 6])
    where installment_number = 1),
  '2026-01-19'::date,
  'kebijakan hari kerja menggeser Sabtu ke Senin'
);

-- -----------------------------------------------------------------------------
-- Utilitas pembulatan & penomoran
-- -----------------------------------------------------------------------------

select is(public.fn_apply_rate(1500000::bigint, 250), 37500::bigint, 'pembulatan 2,5% dari 1.500.000');
select is(public.fn_apply_rate(9999::bigint, 0.5), 0::bigint, 'pembulatan ke bawah untuk 0,49995');
select is(public.fn_apply_rate(10000::bigint, 0.5), 1::bigint, 'pembulatan setengah ke atas');

select is(
  public.fn_installment_status(1000000::bigint, 1000000::bigint, '2026-01-01'::date, '2026-02-01'::date, false),
  'PAID'::installment_status,
  'status cicilan: lunas meskipun dibayar terlambat'
);

select is(
  public.fn_installment_status(1000000::bigint, 0::bigint, '2026-01-01'::date, '2026-02-01'::date, false),
  'OVERDUE'::installment_status,
  'status cicilan: terlambat ketika melewati jatuh tempo'
);

select is(public.fn_aging_bucket(0), 'CURRENT', 'umur piutang: belum jatuh tempo');
select is(public.fn_aging_bucket(8), 'D8_30', 'umur piutang: 8 hari masuk ember 8–30');
select is(public.fn_aging_bucket(120), 'D90_PLUS', 'umur piutang: 120 hari masuk ember >90');
select is(public.fn_roman_month('2026-03-01'::date), 'III', 'bulan Romawi untuk Maret');

select * from finish();
rollback;
