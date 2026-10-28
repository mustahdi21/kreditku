-- =============================================================================
-- KreditKu — 20260101000002_functions.sql
-- Seluruh logika bisnis server-side: penomoran dokumen, perhitungan bunga,
-- pembuatan jadwal, kontrak, pembayaran, denda, pengingat, dan metrik dashboard.
--
-- Aturan penulisan:
--   * Semua fungsi bisnis bersifat SECURITY DEFINER dengan search_path yang
--     dipatok, lalu memeriksa keanggotaan organisasi dan role secara eksplisit.
--   * Uang menggunakan BIGINT Rupiah; pembulatan half-up memakai round(numeric)
--     PostgreSQL yang berperilaku "half away from zero" — sama dengan HALF_UP
--     pada src/lib/money.ts.
--   * Fungsi perhitungan bunga di sini adalah SUMBER KEBENARAN saat kontrak
--     dibuat. Versi TypeScript dipakai untuk pratinjau/simulasi di UI.
--     Kesesuaian keduanya diuji oleh `npm run db:check`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitas organisasi & role
-- -----------------------------------------------------------------------------

create or replace function public.fn_current_org()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.active_organization_id
       from public.profiles p
      where p.id = auth.uid()
        and exists (
          select 1 from public.organization_members m
           where m.user_id = p.id
             and m.organization_id = p.active_organization_id
             and m.is_active
        )),
    (select m.organization_id
       from public.organization_members m
      where m.user_id = auth.uid() and m.is_active
      order by m.created_at
      limit 1)
  );
$$;

create or replace function public.fn_current_role()
returns member_role
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role
    from public.organization_members m
   where m.user_id = auth.uid()
     and m.is_active
     and m.organization_id = public.fn_current_org()
   limit 1;
$$;

create or replace function public.fn_is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = p_org and m.is_active
  );
$$;

create or replace function public.fn_has_role(p_org uuid, p_roles member_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid()
       and m.organization_id = p_org
       and m.is_active
       and m.role = any (p_roles)
  );
$$;

-- Role yang boleh menulis data operasional.
create or replace function public.fn_can_write(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.fn_has_role(p_org, array['SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'CASHIER']::member_role[]);
$$;

-- Role yang boleh mengelola data pelanggan & pengajuan.
create or replace function public.fn_can_manage_credit(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.fn_has_role(p_org, array['SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER']::member_role[]);
$$;

-- Role yang boleh mencatat pembayaran.
create or replace function public.fn_can_collect_payment(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.fn_has_role(p_org, array['SUPER_ADMIN', 'ADMIN', 'CASHIER']::member_role[]);
$$;

-- Role yang boleh mengubah konfigurasi sensitif.
create or replace function public.fn_can_configure(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.fn_has_role(p_org, array['SUPER_ADMIN', 'ADMIN']::member_role[]);
$$;

-- Pemeriksa keanggotaan yang melempar error (dipakai fungsi bisnis).
create or replace function public.fn_assert_member(p_org uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sesi tidak valid. Silakan login kembali.' using errcode = '42501';
  end if;
  if not public.fn_is_member(p_org) then
    raise exception 'Anda tidak memiliki akses ke organisasi data ini.' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Penomoran dokumen
-- -----------------------------------------------------------------------------

-- Mengambil nomor urut berikutnya secara atomik (aman untuk pemanggilan paralel).
create or replace function public.fn_allocate_sequence(p_org uuid, p_key text, p_period_key text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_value bigint;
begin
  insert into public.number_sequences (organization_id, key, period_key, last_value)
  values (p_org, p_key, p_period_key, 1)
  on conflict (organization_id, key, period_key)
  do update set last_value = public.number_sequences.last_value + 1, updated_at = now()
  returning last_value into v_value;
  return v_value;
end;
$$;

-- Menghasilkan nomor dokumen berdasarkan template pada app_settings.numbering.
create or replace function public.fn_next_document_number(
  p_org uuid,
  p_key text,
  p_period_key text,
  p_template text,
  p_doc_date date,
  p_org_code text default null,
  p_doc_type text default null
)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_seq bigint;
  v_result text;
  v_match text[];
  v_width integer;
  v_seq_text text;
begin
  if p_template is null or p_template !~ '\{SEQ(?::\d+)?\}' then
    raise exception 'Template penomoran tidak valid: %', coalesce(p_template, '(kosong)') using errcode = '22023';
  end if;

  v_seq := public.fn_allocate_sequence(p_org, p_key, p_period_key);

  v_result := p_template;
  v_result := replace(v_result, '{ORG}', coalesce(p_org_code, 'ORG'));
  v_result := replace(v_result, '{TYPE}', coalesce(p_doc_type, ''));
  v_result := replace(v_result, '{YYYYMMDD}', to_char(p_doc_date, 'YYYYMMDD'));
  v_result := replace(v_result, '{YYYYMM}', to_char(p_doc_date, 'YYYYMM'));
  v_result := replace(v_result, '{YYMMDD}', to_char(p_doc_date, 'YYMMDD'));
  v_result := replace(v_result, '{MMDD}', to_char(p_doc_date, 'MMDD'));
  v_result := replace(v_result, '{YYYY}', to_char(p_doc_date, 'YYYY'));
  v_result := replace(v_result, '{YY}', to_char(p_doc_date, 'YY'));
  v_result := replace(v_result, '{MM}', to_char(p_doc_date, 'MM'));
  v_result := replace(v_result, '{DD}', to_char(p_doc_date, 'DD'));
  v_result := replace(v_result, '{ROMAN}', public.fn_roman_month(p_doc_date));

  loop
    v_match := regexp_match(v_result, '\{SEQ(?::(\d+))?\}');
    exit when v_match is null;
    v_width := coalesce(v_match[1]::integer, 0);
    v_seq_text := case when v_width > 0 then lpad(v_seq::text, v_width, '0') else v_seq::text end;
    v_result := regexp_replace(v_result, '\{SEQ(?::\d+)?\}', v_seq_text);
  end loop;

  if v_result ~ '\{[^}]*\}' then
    raise exception 'Template penomoran mengandung token yang tidak dikenal: %', v_result using errcode = '22023';
  end if;

  return v_result;
end;
$$;

-- Angka Romawi untuk bulan (1–12).
create or replace function public.fn_roman_month(p_date date)
returns text
language sql immutable as $$
  select (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[extract(month from p_date)::integer];
$$;

-- Mengambil konfigurasi penomoran organisasi.
create or replace function public.fn_number_template(p_org uuid, p_key text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(s.numbering ->> p_key, '')
    from public.app_settings s
   where s.organization_id = p_org;
$$;

-- -----------------------------------------------------------------------------
-- Perhitungan bunga (sumber kebenaran untuk penciptaan kontrak)
-- -----------------------------------------------------------------------------

-- Pembulatan half-up (menjauhi nol), identik dengan RoundingMode HALF_UP.
create or replace function public.fn_round_half_up(p_value numeric)
returns bigint
language sql immutable as $$
  select round(coalesce(p_value, 0))::bigint;
$$;

-- Menerapkan tarif basis point pada nominal: round(amount × bp ÷ (10.000 × divisor)).
create or replace function public.fn_apply_rate(p_amount bigint, p_rate_bp numeric, p_divisor numeric default 1)
returns bigint
language sql immutable as $$
  select case
    when p_amount is null or p_amount = 0 then 0::bigint
    when p_rate_bp is null or p_rate_bp = 0 then 0::bigint
    when p_divisor is null or p_divisor = 0 then null::bigint
    else round((p_amount::numeric * p_rate_bp) / (10000::numeric * p_divisor))::bigint
  end;
$$;

create or replace function public.fn_periods_per_year(p_frequency payment_frequency)
returns numeric
language sql immutable as $$
  select case p_frequency
    when 'MONTHLY' then 12::numeric
    when 'BIWEEKLY' then 26::numeric
    when 'WEEKLY' then 52::numeric
    when 'DAILY' then 365::numeric
  end;
$$;

-- Tarif per periode pembayaran (mengembalikan pecahan basis point).
create or replace function public.fn_rate_per_period(
  p_rate_bp numeric,
  p_rate_basis rate_basis,
  p_frequency payment_frequency
)
returns numeric
language sql immutable as $$
  select case
    when coalesce(p_rate_bp, 0) = 0 then 0::numeric
    when p_rate_basis = 'PER_YEAR' then p_rate_bp / public.fn_periods_per_year(p_frequency)
    else (p_rate_bp * 12) / public.fn_periods_per_year(p_frequency)
  end;
$$;

-- Menambahkan sejumlah periode pada tanggal (mengikuti perilaku date-fns addMonths).
create or replace function public.fn_add_periods(p_date date, p_count integer, p_frequency payment_frequency)
returns date
language sql immutable as $$
  select case p_frequency
    when 'MONTHLY' then (p_date + make_interval(months => p_count))::date
    when 'BIWEEKLY' then (p_date + make_interval(days => p_count * 14))::date
    when 'WEEKLY' then (p_date + make_interval(days => p_count * 7))::date
    when 'DAILY' then (p_date + make_interval(days => p_count))::date
  end;
$$;

create or replace function public.fn_is_business_day(p_date date, p_holidays date[], p_weekend integer[])
returns boolean
language sql immutable as $$
  select not (extract(dow from p_date)::integer = any (coalesce(p_weekend, array[0, 6])))
     and not (p_date = any (coalesce(p_holidays, array[]::date[])));
$$;

-- Penyesuaian tanggal jatuh tempo ke hari kerja terdekat.
create or replace function public.fn_adjust_due_date(
  p_date date,
  p_policy due_date_adjustment,
  p_holidays date[] default array[]::date[],
  p_weekend integer[] default array[0, 6]
)
returns date
language plpgsql immutable as $$
declare
  v_date date := p_date;
  i integer;
begin
  if p_policy = 'NONE' then
    return p_date;
  end if;
  for i in 1..30 loop
    if public.fn_is_business_day(v_date, p_holidays, p_weekend) then
      return v_date;
    end if;
    v_date := v_date + case when p_policy = 'PREVIOUS_BUSINESS_DAY' then -1 else 1 end;
  end loop;
  return p_date;
end;
$$;

-- Membentuk jadwal angsuran lengkap (tanpa menyentuh tabel).
create or replace function public.fn_build_schedule(
  p_principal bigint,
  p_tenor integer,
  p_method interest_method,
  p_rate_bp numeric,
  p_rate_basis rate_basis,
  p_frequency payment_frequency,
  p_admin_fee bigint default 0,
  p_admin_fee_position admin_fee_position default 'UPFRONT',
  p_other_fee bigint default 0,
  p_first_due date default current_date,
  p_due_adjustment due_date_adjustment default 'NONE',
  p_holidays date[] default array[]::date[],
  p_weekend integer[] default array[0, 6]
)
returns table (
  installment_number integer,
  base_due_date date,
  due_date date,
  principal bigint,
  interest bigint,
  fees bigint,
  total_due bigint,
  upfront_amount bigint
)
language plpgsql immutable as $$
declare
  v_rate_pp numeric;
  v_i numeric;
  v_base_principal bigint;
  v_principal_remainder bigint;
  v_flat_interest bigint;
  v_payment bigint;
  v_remaining bigint;
  v_interest bigint;
  v_principal_part bigint;
  v_admin_per_period bigint := 0;
  v_admin_first bigint := 0;
  v_upfront bigint := 0;
  v_fees bigint;
  v_due date;
  v_base_due date;
  n integer;
begin
  if p_principal is null or p_principal <= 0 then
    raise exception 'Pokok pembiayaan harus lebih besar dari nol.' using errcode = '22023';
  end if;
  if p_tenor is null or p_tenor < 1 or p_tenor > 600 then
    raise exception 'Tenor harus antara 1 dan 600 periode.' using errcode = '22023';
  end if;
  if coalesce(p_admin_fee, 0) < 0 or coalesce(p_other_fee, 0) < 0 then
    raise exception 'Biaya tidak boleh negatif.' using errcode = '22023';
  end if;

  v_rate_pp := case when p_method = 'NONE' then 0::numeric
                   else public.fn_rate_per_period(p_rate_bp, p_rate_basis, p_frequency) end;

  -- Distribusi biaya administrasi.
  -- Bagian per periode dibulatkan ke BAWAH dan sisa diletakkan pada periode
  -- terakhir, sehingga tidak pernah ada biaya negatif dan totalnya tepat.
  if p_admin_fee_position = 'UPFRONT' then
    v_upfront := coalesce(p_admin_fee, 0);
  elsif p_admin_fee_position = 'FIRST_INSTALLMENT' then
    v_admin_first := coalesce(p_admin_fee, 0);
  elsif p_admin_fee_position = 'SPREAD' then
    v_admin_per_period := trunc(coalesce(p_admin_fee, 0)::numeric / p_tenor)::bigint;
  end if;

  if p_method = 'ANNUITY' and v_rate_pp > 0 then
    v_i := v_rate_pp / 10000::numeric;
    v_payment := public.fn_round_half_up((p_principal * v_i) / (1 - power(1 + v_i, -p_tenor)));
    if v_payment <= 0 then
      raise exception 'Angsuran anuitas tidak valid (nol atau negatif).' using errcode = '22023';
    end if;
  else
    v_base_principal := trunc(p_principal::numeric / p_tenor)::bigint;
    v_principal_remainder := p_principal - (v_base_principal * (p_tenor - 1));
    if p_method = 'FLAT' then
      v_flat_interest := public.fn_apply_rate(p_principal, v_rate_pp);
    end if;
  end if;

  v_remaining := p_principal;

  for n in 1..p_tenor loop
    v_base_due := public.fn_add_periods(p_first_due, n - 1, p_frequency);
    v_due := public.fn_adjust_due_date(v_base_due, p_due_adjustment, p_holidays, p_weekend);

    if p_method = 'ANNUITY' and v_rate_pp > 0 then
      v_interest := public.fn_apply_rate(v_remaining, v_rate_pp);
      if n = p_tenor then
        v_principal_part := v_remaining;
      else
        v_principal_part := greatest(0::bigint, least(v_payment - v_interest, v_remaining));
      end if;
      v_remaining := v_remaining - v_principal_part;
    else
      v_interest := case when p_method = 'FLAT' then v_flat_interest else 0::bigint end;
      v_principal_part := case when n = p_tenor then v_principal_remainder else v_base_principal end;
    end if;

    v_fees := coalesce(p_other_fee, 0)
            + case when n = 1 then v_admin_first else 0 end
            + v_admin_per_period
            + case when n = p_tenor and p_admin_fee_position = 'SPREAD'
                   then coalesce(p_admin_fee, 0) - (v_admin_per_period * p_tenor)
                   else 0 end;

    installment_number := n;
    base_due_date := v_base_due;
    due_date := v_due;
    principal := v_principal_part;
    interest := v_interest;
    fees := v_fees;
    total_due := v_principal_part + v_interest + v_fees;
    upfront_amount := v_upfront;
    return next;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status turunan
-- -----------------------------------------------------------------------------

-- Status cicilan berbasis fakta pembayaran + tanggal acuan.
create or replace function public.fn_installment_status(
  p_total_due bigint,
  p_paid_amount bigint,
  p_due_date date,
  p_as_of date default current_date,
  p_is_cancelled boolean default false
)
returns installment_status
language sql immutable as $$
  select case
    when p_is_cancelled then 'CANCELLED'::installment_status
    when p_total_due > 0 and p_paid_amount >= p_total_due then 'PAID'::installment_status
    when p_paid_amount > 0 then 'PARTIAL'::installment_status
    when p_due_date < p_as_of then 'OVERDUE'::installment_status
    when p_due_date = p_as_of then 'DUE_TODAY'::installment_status
    else 'PENDING'::installment_status
  end;
$$;

-- Ember umur tunggakan.
create or replace function public.fn_aging_bucket(p_late_days integer, p_bounds integer[] default array[7, 30, 60, 90])
returns text
language sql immutable as $$
  select case
    when coalesce(p_late_days, 0) <= 0 then 'CURRENT'
    when p_late_days <= coalesce(p_bounds[1], 7) then 'D1_7'
    when p_late_days <= coalesce(p_bounds[2], 30) then 'D8_30'
    when p_late_days <= coalesce(p_bounds[3], 60) then 'D31_60'
    when p_late_days <= coalesce(p_bounds[4], 90) then 'D61_90'
    else 'D90_PLUS'
  end;
$$;

-- -----------------------------------------------------------------------------
-- Penghitung ulang saldo kontrak & pelanggan
-- -----------------------------------------------------------------------------

-- Menghitung ulang total terbayar, sisa piutang, jatuh tempo berikutnya,
-- dan status kontrak berdasarkan seluruh cicilan. Status tidak pernah
-- disimpulkan dari satu cicilan saja.
create or replace function public.fn_refresh_contract(p_contract_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract public.credit_contracts;
  v_total_paid bigint;
  v_outstanding bigint;
  v_next_due date;
  v_last_payment date;
  v_overdue integer;
  v_settled boolean;
  v_status contract_status;
begin
  select * into v_contract from public.credit_contracts where id = p_contract_id;
  if not found then
    return;
  end if;

  select coalesce(sum(i.paid_amount), 0),
         coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0),
         min(case when i.total_due > i.paid_amount then i.due_date end),
         max(i.last_payment_date),
         count(*) filter (where i.total_due > i.paid_amount and i.due_date < current_date)
    into v_total_paid, v_outstanding, v_next_due, v_last_payment, v_overdue
    from public.installments i
   where i.contract_id = p_contract_id
     and i.status <> 'CANCELLED';

  select (count(*) > 0 and coalesce(sum(greatest(total_due - paid_amount, 0)), 0) = 0)
    into v_settled
    from public.installments
   where contract_id = p_contract_id
     and status <> 'CANCELLED';

  if v_contract.status = 'CANCELLED' then
    v_status := 'CANCELLED';
  elsif v_settled then
    v_status := 'PAID_OFF';
  elsif v_overdue > 0 then
    v_status := 'DELINQUENT';
  elsif v_contract.status = 'RESTRUCTURED' or v_contract.restructured_at is not null then
    v_status := 'RESTRUCTURED';
  else
    v_status := 'ACTIVE';
  end if;

  update public.credit_contracts
     set total_paid = v_total_paid,
         outstanding = v_outstanding,
         next_due_date = v_next_due,
         last_payment_date = v_last_payment,
         status = v_status,
         updated_at = now()
   where id = p_contract_id;

  perform public.fn_refresh_customer(v_contract.customer_id);
end;
$$;

-- Menghitung ulang status pelanggan (status BLOCKED/ARCHIVED dipertahankan).
create or replace function public.fn_refresh_customer(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer public.customers;
  v_statuses contract_status[];
  v_count integer;
  v_new_status customer_status;
begin
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    return;
  end if;
  if v_customer.status in ('BLOCKED', 'ARCHIVED') then
    return;
  end if;

  select coalesce(array_agg(c.status), array[]::contract_status[]), count(*)
    into v_statuses, v_count
    from public.credit_contracts c
   where c.customer_id = p_customer_id
     and c.status <> 'CANCELLED';

  if v_count = 0 then
    v_new_status := 'PROSPECT';
  elsif 'DELINQUENT'::contract_status = any (v_statuses) then
    v_new_status := 'DELINQUENT';
  elsif 'ACTIVE'::contract_status = any (v_statuses)
     or 'RESTRUCTURED'::contract_status = any (v_statuses) then
    v_new_status := 'ACTIVE';
  else
    v_new_status := 'PAID_OFF';
  end if;

  if v_new_status <> v_customer.status then
    update public.customers set status = v_new_status, updated_at = now() where id = p_customer_id;
  end if;
end;
$$;

-- Menghitung ulang status seluruh cicilan yang belum dibatalkan pada kontrak.
create or replace function public.fn_refresh_installment_statuses(p_contract_id uuid, p_as_of date default current_date)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.installments i
     set status = public.fn_installment_status(i.total_due, i.paid_amount, i.due_date, p_as_of, i.cancelled_at is not null)
   where i.contract_id = p_contract_id;
$$;

-- =============================================================================
-- SELESAI — utilitas & perhitungan
-- =============================================================================
