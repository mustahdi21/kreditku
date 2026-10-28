-- =============================================================================
-- KreditKu — 20260101000003_business_functions.sql
-- Fungsi bisnis transaksional: penomoran, pengajuan, kontrak, pembayaran,
-- reversal, denda, pengingat, metrik dashboard, dan audit.
--
-- Seluruh fungsi di sini bersifat SECURITY DEFINER dan WAJIB memeriksa
-- keanggotaan organisasi + role sebelum menulis. Penulisan internal
-- ditandai dengan GUC `kreditku.internal_write` agar trigger pelindung
-- dapat membedakan perubahan yang sah dari perubahan langsung oleh klien.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Penanda penulisan internal
-- -----------------------------------------------------------------------------
-- Fungsi bisnis dijalankan sebagai SECURITY DEFINER (pemiliknya adalah pemilik
-- basis data), sedangkan klien selalu terhubung sebagai peran `authenticated`.
-- Karena itu identitas eksekusi (`current_user`) dapat dipakai sebagai penanda
-- yang TIDAK DAPAT DIPALSUKAN oleh klien:
--
--   * di dalam fungsi internal   → current_user = pemilik DB  → penulisan sah
--   * permintaan langsung klien  → current_user = authenticated → dilindungi
--
-- Keunggulan dibanding penanda berbasis pengaturan sesi: cakupannya otomatis
-- terbatas pada pernyataan yang dijalankan oleh fungsi internal, tanpa perlu
-- membuka/menutup penanda secara manual, dan tidak pernah "bocor" ke pernyataan
-- berikutnya pada transaksi yang sama.
--
-- `fn_begin_internal_write()` dipertahankan sebagai penanda dokumentasi pada
-- kode fungsi bisnis (menandai awal bagian penulisan internal) dan tidak lagi
-- mengubah status apa pun.

create or replace function public.fn_internal_roles()
returns text[]
language sql immutable as $$
  select array['postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role', 'dashboard_user'];
$$;

create or replace function public.fn_is_internal_write()
returns boolean
language sql stable as $$
  select current_user::text = any (public.fn_internal_roles())
      or current_setting('request.jwt.claim.role', true) = 'service_role'
      or session_user::text = 'service_role';
$$;

create or replace function public.fn_begin_internal_write()
returns void
language sql immutable as $$
  select null::void;
$$;

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------

create or replace function public.fn_log_audit(
  p_org uuid,
  p_action audit_action,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
begin
  select p.email into v_email from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (
    organization_id, actor_id, actor_email, action, entity_type, entity_id,
    summary, before_data, after_data, metadata
  ) values (
    p_org, auth.uid(), v_email, p_action, p_entity_type, p_entity_id,
    p_summary, p_before, p_after, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.fn_audit_row()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_entity uuid;
  v_action audit_action;
  v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    v_action := 'CREATE';
    v_org := (to_jsonb(new) ->> 'organization_id')::uuid;
    v_entity := (to_jsonb(new) ->> 'id')::uuid;
  elsif TG_OP = 'UPDATE' then
    v_action := 'UPDATE';
    v_org := (to_jsonb(new) ->> 'organization_id')::uuid;
    v_entity := (to_jsonb(new) ->> 'id')::uuid;
    if to_jsonb(new) = to_jsonb(old) then
      return new;
    end if;
  else
    v_action := 'DELETE';
    v_org := (to_jsonb(old) ->> 'organization_id')::uuid;
    v_entity := (to_jsonb(old) ->> 'id')::uuid;
  end if;

  -- Tabel organisasi tidak memiliki kolom organization_id: gunakan id baris
  -- agar catatan auditnya tetap terlihat oleh anggota organisasi tersebut.
  if v_org is null and TG_TABLE_NAME = 'organizations' then
    v_org := v_entity;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    v_org,
    v_actor,
    v_action,
    TG_TABLE_NAME,
    v_entity,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifikasi internal
-- -----------------------------------------------------------------------------

create or replace function public.fn_notify(
  p_org uuid,
  p_type notification_type,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_user_id uuid default null,
  p_exclude_actor boolean default true
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (organization_id, user_id, type, title, body, link, entity_type, entity_id)
  values (p_org, p_user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id);
exception when others then
  -- Notifikasi tidak boleh menggagalkan transaksi bisnis.
  null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Penomoran dokumen tingkat organisasi
-- -----------------------------------------------------------------------------

-- Menghasilkan nomor dokumen berikutnya untuk organisasi pemanggil.
create or replace function public.fn_next_number(
  p_key text,
  p_period_key text,
  p_doc_date date default current_date,
  p_doc_type text default null,
  p_org uuid default null
)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := coalesce(p_org, public.fn_current_org());
  v_template text;
  v_code text;
begin
  perform public.fn_assert_member(v_org);
  if not public.fn_can_write(v_org) then
    raise exception 'Role Anda tidak diizinkan membuat dokumen baru.' using errcode = '42501';
  end if;

  v_template := public.fn_number_template(v_org, p_key);
  if v_template is null or v_template = '' then
    raise exception 'Template penomoran untuk % belum dikonfigurasi.', p_key using errcode = '22023';
  end if;

  select o.code into v_code from public.organizations o where o.id = v_org;

  return public.fn_next_document_number(v_org, p_key, p_period_key, v_template, p_doc_date, v_code, p_doc_type);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pengajuan kredit
-- -----------------------------------------------------------------------------

-- Mengubah status pengajuan dengan mencatat riwayat.
create or replace function public.fn_set_application_status(
  p_application_id uuid,
  p_status application_status,
  p_note text default null,
  p_decided_by uuid default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.credit_applications;
begin
  select * into v_app from public.credit_applications where id = p_application_id;
  if not found then
    raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_app.organization_id);

  update public.credit_applications
     set status = p_status,
         decision_reason = coalesce(p_note, decision_reason),
         submitted_at = case when p_status = 'SUBMITTED' and submitted_at is null then now() else submitted_at end,
         decided_at = case when p_status in ('APPROVED', 'REJECTED') then now() else decided_at end,
         decided_by = coalesce(p_decided_by, case when p_status in ('APPROVED', 'REJECTED') then auth.uid() else decided_by end),
         updated_by = auth.uid()
   where id = p_application_id;

  insert into public.credit_application_status_history (
    organization_id, application_id, from_status, to_status, note, changed_by
  ) values (v_app.organization_id, p_application_id, v_app.status, p_status, p_note, auth.uid());
end;
$$;

create or replace function public.rpc_submit_application(p_application_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.credit_applications;
begin
  select * into v_app from public.credit_applications where id = p_application_id;
  if not found then
    raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_app.organization_id);
  if not public.fn_can_manage_credit(v_app.organization_id) then
    raise exception 'Role Anda tidak diizinkan mengajukan kredit.' using errcode = '42501';
  end if;
  if v_app.status not in ('DRAFT', 'SUBMITTED') then
    raise exception 'Pengajuan berstatus % tidak dapat diajukan.', v_app.status using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();
  perform public.fn_set_application_status(p_application_id, 'SUBMITTED', p_note);
  perform public.fn_log_audit(v_app.organization_id, 'UPDATE', 'credit_applications', p_application_id, 'Pengajuan dikirim untuk diperiksa');
  perform public.fn_notify(
    v_app.organization_id, 'APPLICATION_SUBMITTED',
    'Pengajuan kredit baru',
    format('Pengajuan %s menunggu pemeriksaan.', v_app.application_number),
    format('/app/applications/%s', p_application_id),
    'credit_applications', p_application_id
  );
end;
$$;

create or replace function public.rpc_decide_application(
  p_application_id uuid,
  p_decision application_status,
  p_reason text,
  p_contract_number text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.credit_applications;
  v_org public.organizations;
  v_settings public.app_settings;
  v_require_separate boolean;
  v_contract_id uuid;
  v_contract_number text;
  v_schedule record;
  v_total_interest bigint := 0;
  v_total_fees bigint := 0;
  v_total_payable bigint := 0;
  v_principal_sum bigint := 0;
  v_upfront bigint := 0;
  v_first_due date;
  v_next_due date;
  v_holidays date[];
  v_weekend integer[];
  v_due_adjustment due_date_adjustment;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Keputusan harus APPROVED atau REJECTED.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'Alasan keputusan wajib diisi minimal 5 karakter.' using errcode = '22023';
  end if;

  select * into v_app from public.credit_applications where id = p_application_id for update;
  if not found then
    raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_app.organization_id);
  if not public.fn_has_role(v_app.organization_id, array['SUPER_ADMIN', 'ADMIN']::member_role[]) then
    raise exception 'Hanya Admin atau Super Admin yang boleh menyetujui atau menolak pengajuan.' using errcode = '42501';
  end if;

  select * into v_settings from public.app_settings where organization_id = v_app.organization_id;
  v_require_separate := coalesce((v_settings.finance ->> 'require_separate_approver')::boolean, true);
  if v_require_separate and v_app.created_by = auth.uid() then
    raise exception 'Pemisahan tugas aktif: pengaju tidak boleh menyetujui pengajuannya sendiri.' using errcode = '42501';
  end if;

  if v_app.status not in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW') then
    raise exception 'Pengajuan berstatus % tidak dapat diputuskan.', v_app.status using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();

  if p_decision = 'REJECTED' then
    perform public.fn_set_application_status(p_application_id, 'REJECTED', p_reason);
    perform public.fn_log_audit(v_app.organization_id, 'REJECT', 'credit_applications', p_application_id, p_reason);
    perform public.fn_notify(
      v_app.organization_id, 'APPLICATION_DECIDED', 'Pengajuan kredit ditolak',
      format('Pengajuan %s ditolak: %s', v_app.application_number, p_reason),
      format('/app/applications/%s', p_application_id), 'credit_applications', p_application_id,
      v_app.created_by
    );
    return jsonb_build_object('status', 'REJECTED', 'application_id', p_application_id);
  end if;

  -- Persetujuan: membentuk kontrak + jadwal cicilan secara atomik.
  select * into v_org from public.organizations where id = v_app.organization_id;

  v_contract_number := nullif(trim(coalesce(p_contract_number, '')), '');
  if v_contract_number is null then
    v_contract_number := public.fn_next_document_number(
      v_app.organization_id, 'contract', to_char(current_date, 'YYYY'),
      public.fn_template_or_default(v_app.organization_id, 'contract', 'CTR-{YYYY}-{SEQ:5}'), current_date, v_org.code, 'CTR'
    );
  end if;

  v_first_due := v_app.first_due_date;
  v_holidays := coalesce(
    (select array_agg(value::date) from jsonb_array_elements_text(coalesce(v_settings.finance -> 'holidays', '[]'::jsonb)) as t(value)),
    array[]::date[]
  );
  v_weekend := coalesce(
    (select array_agg(value::integer) from jsonb_array_elements_text(coalesce(v_settings.finance -> 'weekend_days', '[0,6]'::jsonb)) as t(value)),
    array[0, 6]
  );
  v_due_adjustment := coalesce(
    nullif(v_settings.finance ->> 'due_date_adjustment', '')::due_date_adjustment,
    v_app.due_date_adjustment
  );

  -- Total dihitung lebih dulu agar kontrak dapat disisipkan dengan nilai yang
  -- konsisten (constraint total_payable = principal + total_interest + total_fees).
  select coalesce(sum(s.interest), 0),
         coalesce(sum(s.fees), 0),
         coalesce(sum(s.total_due), 0),
         coalesce(sum(s.principal), 0),
         coalesce(max(s.upfront_amount), 0),
         min(s.due_date)
    into v_total_interest, v_total_fees, v_total_payable, v_principal_sum, v_upfront, v_next_due
    from public.fn_build_schedule(
      v_app.principal, v_app.tenor, v_app.method, v_app.rate_bp, v_app.rate_basis, v_app.frequency,
      v_app.admin_fee, v_app.admin_fee_position, v_app.other_fee_per_period, v_first_due,
      v_due_adjustment, v_holidays, v_weekend
    ) s;

  if v_principal_sum <> v_app.principal then
    raise exception 'Rekonsiliasi gagal: total pokok jadwal (%) berbeda dengan pokok pembiayaan (%).',
      v_principal_sum, v_app.principal using errcode = '22023';
  end if;

  insert into public.credit_contracts (
    organization_id, contract_number, application_id, customer_id, contract_date,
    disbursement_date, price, down_payment, principal, tenor, method, rate_bp,
    rate_basis, frequency, admin_fee, admin_fee_position, other_fee_per_period,
    upfront_amount, total_interest, total_fees, total_payable, total_paid, outstanding,
    first_due_date, next_due_date, due_date_adjustment, status, notes,
    created_by, updated_by, snapshot
  ) values (
    v_app.organization_id, v_contract_number, v_app.id, v_app.customer_id, current_date,
    coalesce(v_app.disbursement_date, current_date), v_app.price, v_app.down_payment, v_app.principal,
    v_app.tenor, v_app.method, v_app.rate_bp, v_app.rate_basis, v_app.frequency, v_app.admin_fee,
    v_app.admin_fee_position, v_app.other_fee_per_period,
    v_upfront, v_total_interest, v_total_fees, v_total_payable, 0, v_total_payable,
    v_first_due, v_next_due, v_due_adjustment,
    'ACTIVE', v_app.notes, auth.uid(), auth.uid(),
    jsonb_build_object(
      'product_id', v_app.product_id,
      'credit_type', v_app.credit_type,
      'application_number', v_app.application_number,
      'snapshot_at', now(),
      'method', v_app.method, 'rate_bp', v_app.rate_bp, 'rate_basis', v_app.rate_basis,
      'tenor', v_app.tenor, 'frequency', v_app.frequency,
      'admin_fee', v_app.admin_fee, 'admin_fee_position', v_app.admin_fee_position,
      'other_fee_per_period', v_app.other_fee_per_period
    )
  ) returning id into v_contract_id;

  for v_schedule in
    select * from public.fn_build_schedule(
      v_app.principal, v_app.tenor, v_app.method, v_app.rate_bp, v_app.rate_basis, v_app.frequency,
      v_app.admin_fee, v_app.admin_fee_position, v_app.other_fee_per_period, v_first_due,
      v_due_adjustment, v_holidays, v_weekend
    )
  loop
    insert into public.installments (
      organization_id, contract_id, installment_number, base_due_date, due_date,
      principal, interest, fees, total_due, status
    ) values (
      v_app.organization_id, v_contract_id, v_schedule.installment_number, v_schedule.base_due_date,
      v_schedule.due_date, v_schedule.principal, v_schedule.interest, v_schedule.fees,
      v_schedule.total_due,
      public.fn_installment_status(v_schedule.total_due, 0, v_schedule.due_date, current_date, false)
    );
  end loop;

  update public.credit_applications
     set contract_id = v_contract_id,
         status = 'APPROVED',
         decision_reason = p_reason,
         decided_at = now(),
         decided_by = auth.uid(),
         updated_by = auth.uid()
   where id = p_application_id;

  insert into public.credit_application_status_history (
    organization_id, application_id, from_status, to_status, note, changed_by
  ) values (v_app.organization_id, p_application_id, v_app.status, 'APPROVED', p_reason, auth.uid());

  perform public.fn_refresh_contract(v_contract_id);
  perform public.fn_refresh_customer(v_app.customer_id);

  perform public.fn_log_audit(
    v_app.organization_id, 'APPROVE', 'credit_contracts', v_contract_id,
    format('Kontrak %s dibuat dari pengajuan %s', v_contract_number, v_app.application_number),
    null, jsonb_build_object('contract_number', v_contract_number, 'application_id', p_application_id, 'reason', p_reason)
  );

  perform public.fn_notify(
    v_app.organization_id, 'APPLICATION_DECIDED', 'Pengajuan kredit disetujui',
    format('Pengajuan %s disetujui. Kontrak %s telah dibuat.', v_app.application_number, v_contract_number),
    format('/app/contracts/%s', v_contract_id), 'credit_contracts', v_contract_id, v_app.created_by
  );

  return jsonb_build_object(
    'status', 'APPROVED',
    'application_id', p_application_id,
    'contract_id', v_contract_id,
    'contract_number', v_contract_number,
    'total_payable', v_total_payable,
    'total_interest', v_total_interest,
    'total_fees', v_total_fees,
    'installments', v_app.tenor
  );
end;
$$;

-- Membatalkan pengajuan (draft/ajuan yang belum menjadi kontrak).
create or replace function public.rpc_cancel_application(p_application_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.credit_applications;
begin
  select * into v_app from public.credit_applications where id = p_application_id for update;
  if not found then
    raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_app.organization_id);
  if not public.fn_can_manage_credit(v_app.organization_id) then
    raise exception 'Role Anda tidak diizinkan membatalkan pengajuan.' using errcode = '42501';
  end if;
  if v_app.contract_id is not null then
    raise exception 'Pengajuan sudah menghasilkan kontrak. Batalkan kontrak melalui prosedur pembatalan kontrak.' using errcode = '22023';
  end if;
  if v_app.status in ('CANCELLED', 'REJECTED', 'APPROVED') then
    raise exception 'Pengajuan berstatus % tidak dapat dibatalkan.', v_app.status using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();
  perform public.fn_set_application_status(p_application_id, 'CANCELLED', p_reason);
  perform public.fn_log_audit(v_app.organization_id, 'CANCEL', 'credit_applications', p_application_id, p_reason);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pembayaran
-- -----------------------------------------------------------------------------

-- Mencatat pembayaran secara transaksional dengan alokasi ke cicilan/denda.
--
-- Jaminan yang diberikan:
--   * Idempotent — kunci idempotency yang sama mengembalikan pembayaran yang ada.
--   * Tidak pernah mengalokasikan melebihi sisa kewajiban.
--   * Nomor kuitansi unik dan dibangkitkan secara atomik.
--   * Idempotensi & alokasi dilakukan di server, bukan di klien.
create or replace function public.rpc_post_payment(
  p_contract_id uuid,
  p_amount bigint,
  p_method payment_method,
  p_idempotency_key text,
  p_paid_at timestamptz default now(),
  p_reference text default null,
  p_notes text default null,
  p_allocation_order allocation_order default null,
  p_penalty_first boolean default null,
  p_allow_overpayment boolean default null,
  p_manual_installments uuid[] default null,
  p_proof_path text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract public.credit_contracts;
  v_org uuid;
  v_settings public.app_settings;
  v_order allocation_order;
  v_penalty_first boolean;
  v_allow_over boolean;
  v_existing public.payments;
  v_payment_id uuid;
  v_receipt text;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_remaining bigint;
  v_row record;
  v_open_installment bigint;
  v_open_penalty bigint;
  v_to_installment bigint;
  v_to_penalty bigint;
  v_allocations jsonb := '[]'::jsonb;
  v_unallocated bigint := 0;
  v_customer_name text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih besar dari nol.' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 16 then
    raise exception 'Kunci idempotency wajib diisi minimal 16 karakter.' using errcode = '22023';
  end if;

  select * into v_contract from public.credit_contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Kontrak tidak ditemukan.' using errcode = 'P0002';
  end if;
  v_org := v_contract.organization_id;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_collect_payment(v_org) then
    raise exception 'Role Anda tidak diizinkan mencatat pembayaran.' using errcode = '42501';
  end if;
  if v_contract.status = 'CANCELLED' then
    raise exception 'Kontrak telah dibatalkan dan tidak dapat menerima pembayaran.' using errcode = '22023';
  end if;

  -- Idempotensi: kembalikan pembayaran yang sudah ada bila kunci sama.
  select * into v_existing
    from public.payments
   where organization_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'payment_id', v_existing.id,
      'receipt_number', v_existing.receipt_number,
      'amount', v_existing.amount,
      'status', v_existing.status
    );
  end if;

  select * into v_settings from public.app_settings where organization_id = v_org;
  v_order := coalesce(p_allocation_order, nullif(v_settings.finance ->> 'allocation_order', '')::allocation_order, 'OLDEST_FIRST');
  v_penalty_first := coalesce(p_penalty_first, (v_settings.finance ->> 'penalty_first')::boolean, false);
  v_allow_over := coalesce((v_settings.finance ->> 'allow_overpayment')::boolean, false);

  if p_allow_overpayment is true then
    if not public.fn_can_configure(v_org) then
      raise exception 'Hanya Admin atau Super Admin yang boleh mengizinkan kelebihan bayar.' using errcode = '42501';
    end if;
    v_allow_over := true;
  end if;

  perform public.fn_begin_internal_write();

  v_receipt := public.fn_next_document_number(
    v_org, 'receipt', to_char(v_paid_at::date, 'YYYYMMDD'),
    public.fn_template_or_default(v_org, 'receipt', 'KWT-{YYYYMMDD}-{SEQ:4}'),
    v_paid_at::date,
    (select code from public.organizations where id = v_org),
    'KWT'
  );

  insert into public.payments (
    organization_id, contract_id, receipt_number, amount, method, paid_at, paid_date,
    reference, notes, proof_path, status, idempotency_key, penalty_first, allocation_order, created_by, updated_by
  ) values (
    v_org, p_contract_id, v_receipt, p_amount, p_method, v_paid_at, v_paid_at::date,
    p_reference, p_notes, p_proof_path, 'POSTED', p_idempotency_key, v_penalty_first, v_order, auth.uid(), auth.uid()
  ) returning id into v_payment_id;

  v_remaining := p_amount;

  for v_row in
    select i.id,
           i.installment_number,
           i.due_date,
           greatest(i.total_due - i.paid_amount, 0) as open_installment,
           pn.id as penalty_id,
           greatest(coalesce(pn.amount, 0) - coalesce(pn.paid_amount, 0) - coalesce(pn.waived_amount, 0), 0) as open_penalty
      from public.installments i
      left join public.penalties pn on pn.installment_id = i.id and pn.status = 'OPEN'
     where i.contract_id = p_contract_id
       and i.status <> 'CANCELLED'
       and greatest(i.total_due - i.paid_amount, 0)
         + greatest(coalesce(pn.amount, 0) - coalesce(pn.paid_amount, 0) - coalesce(pn.waived_amount, 0), 0) > 0
     order by case v_order
                when 'OLDEST_FIRST' then extract(epoch from i.due_date)
                when 'NEWEST_FIRST' then -extract(epoch from i.due_date)
                else coalesce(array_position(p_manual_installments, i.id), 999999)::numeric
              end asc,
              i.installment_number asc
  loop
    exit when v_remaining <= 0;

    v_open_installment := v_row.open_installment;
    v_open_penalty := v_row.open_penalty;
    v_to_installment := 0;
    v_to_penalty := 0;

    if v_penalty_first and v_open_penalty > 0 then
      v_to_penalty := least(v_remaining, v_open_penalty);
      v_remaining := v_remaining - v_to_penalty;
    end if;

    if v_remaining > 0 and v_open_installment > 0 then
      v_to_installment := least(v_remaining, v_open_installment);
      v_remaining := v_remaining - v_to_installment;
    end if;

    if v_remaining > 0 and not v_penalty_first and v_open_penalty > 0 then
      v_to_penalty := least(v_remaining, v_open_penalty);
      v_remaining := v_remaining - v_to_penalty;
    end if;

    if v_to_installment = 0 and v_to_penalty = 0 then
      continue;
    end if;

    insert into public.payment_allocations (
      organization_id, payment_id, installment_id, amount, penalty_amount, created_by
    ) values (
      v_org, v_payment_id, v_row.id, v_to_installment, v_to_penalty, auth.uid()
    );

    update public.installments
       set paid_amount = paid_amount + v_to_installment,
           last_payment_date = case when v_to_installment > 0 then v_paid_at::date else last_payment_date end,
           status = public.fn_installment_status(
             total_due, paid_amount + v_to_installment, due_date, current_date, cancelled_at is not null
           )
     where id = v_row.id;

    if v_to_penalty > 0 and v_row.penalty_id is not null then
      update public.penalties
         set paid_amount = paid_amount + v_to_penalty,
             status = case
               when paid_amount + v_to_penalty + waived_amount >= amount then 'SETTLED'::penalty_status
               else 'OPEN'::penalty_status
             end
       where id = v_row.penalty_id;
    end if;

    v_allocations := v_allocations || jsonb_build_object(
      'installment_id', v_row.id,
      'installment_number', v_row.installment_number,
      'to_installment', v_to_installment,
      'to_penalty', v_to_penalty
    );
  end loop;

  v_unallocated := v_remaining;
  if v_unallocated > 0 and not v_allow_over then
    raise exception
      'Nominal pembayaran melebihi total kewajiban terbuka (kelebihan %). Aktifkan kebijakan kelebihan bayar bila hal ini disengaja.',
      v_unallocated using errcode = '22023';
  end if;

  update public.payments
     set unallocated = v_unallocated,
         updated_by = auth.uid()
   where id = v_payment_id;

  perform public.fn_refresh_installment_statuses(p_contract_id);
  perform public.fn_refresh_contract(p_contract_id);

  select c.full_name into v_customer_name from public.customers c where c.id = v_contract.customer_id;

  perform public.fn_log_audit(
    v_org, 'POST_PAYMENT', 'payments', v_payment_id,
    format('Pembayaran %s sebesar %s dicatat', v_receipt, p_amount),
    null,
    jsonb_build_object('receipt_number', v_receipt, 'amount', p_amount, 'method', p_method, 'allocations', v_allocations, 'unallocated', v_unallocated)
  );

  perform public.fn_notify(
    v_org, 'PAYMENT_RECEIVED', 'Pembayaran diterima',
    format('Pembayaran %s dari %s sebesar %s.', v_receipt, coalesce(v_customer_name, 'pelanggan'), p_amount),
    format('/app/payments/%s', v_payment_id), 'payments', v_payment_id
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment_id,
    'receipt_number', v_receipt,
    'amount', p_amount,
    'allocations', v_allocations,
    'unallocated', v_unallocated
  );
end;
$$;

-- Pembatalan (reversal) pembayaran yang sudah diposting.
-- Data pembayaran asli TIDAK dihapus dan tidak diubah nominalnya; dibuat
-- catatan pembatalan yang dapat diaudit dan saldo dihitung ulang.
create or replace function public.rpc_reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.payments;
  v_org uuid;
  v_alloc record;
  v_reversal_number text;
  v_remaining_allocations integer;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'Alasan pembatalan wajib diisi minimal 5 karakter.' using errcode = '22023';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Pembayaran tidak ditemukan.' using errcode = 'P0002';
  end if;
  v_org := v_payment.organization_id;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_configure(v_org) then
    raise exception 'Hanya Admin atau Super Admin yang boleh membatalkan pembayaran.' using errcode = '42501';
  end if;
  if v_payment.status = 'REVERSED' then
    raise exception 'Pembayaran % sudah dibatalkan sebelumnya.', v_payment.receipt_number using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();

  for v_alloc in
    select * from public.payment_allocations where payment_id = p_payment_id
  loop
    update public.installments
       set paid_amount = greatest(paid_amount - v_alloc.amount, 0),
           penalty_paid_amount = greatest(penalty_paid_amount - v_alloc.penalty_amount, 0)
     where id = v_alloc.installment_id;

    if v_alloc.penalty_amount > 0 then
      update public.penalties
         set paid_amount = greatest(paid_amount - v_alloc.penalty_amount, 0),
             status = case
               when status = 'SETTLED' and (paid_amount - v_alloc.penalty_amount) + waived_amount < amount then 'OPEN'::penalty_status
               else status
             end
       where installment_id = v_alloc.installment_id;
    end if;
  end loop;

  -- Memperbarui tanggal pembayaran terakhir dari alokasi yang masih berlaku.
  update public.installments i
     set last_payment_date = (
       select max(p.paid_date)
         from public.payment_allocations a
         join public.payments p on p.id = a.payment_id
        where a.installment_id = i.id and a.amount > 0 and p.status = 'POSTED'
     )
   where i.contract_id = v_payment.contract_id;

  v_reversal_number := public.fn_next_document_number(
    v_org, 'payment_reversal', to_char(current_date, 'YYYYMMDD'),
    public.fn_template_or_default(v_org, 'payment_reversal', 'RVS-{YYYYMMDD}-{SEQ:4}'),
    current_date,
    (select code from public.organizations where id = v_org),
    'RVS'
  );

  insert into public.payment_reversals (
    organization_id, payment_id, reversal_number, amount, reason, created_by
  ) values (
    v_org, p_payment_id, v_reversal_number, v_payment.amount, p_reason, auth.uid()
  );

  update public.payments
     set status = 'REVERSED', reversed_at = now(), reversed_by = auth.uid(), updated_by = auth.uid()
   where id = p_payment_id;

  perform public.fn_refresh_installment_statuses(v_payment.contract_id);
  perform public.fn_refresh_contract(v_payment.contract_id);

  select count(*) into v_remaining_allocations
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
   where a.installment_id in (select installment_id from public.payment_allocations where payment_id = p_payment_id)
     and p.status = 'POSTED';

  perform public.fn_log_audit(
    v_org, 'REVERSE_PAYMENT', 'payments', p_payment_id,
    format('Pembayaran %s dibatalkan: %s', v_payment.receipt_number, p_reason),
    to_jsonb(v_payment), jsonb_build_object('reversal_number', v_reversal_number, 'reason', p_reason)
  );

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'reversal_number', v_reversal_number,
    'amount', v_payment.amount,
    'active_allocations_after', v_remaining_allocations
  );
end;
$$;

-- Mengambil template penomoran atau nilai default bila belum dikonfigurasi.
create or replace function public.fn_template_or_default(p_org uuid, p_key text, p_default text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(public.fn_number_template(p_org, p_key), ''), p_default);
$$;

-- -----------------------------------------------------------------------------
-- Denda
-- -----------------------------------------------------------------------------

-- Menghitung ulang denda untuk seluruh cicilan yang menunggak.
-- Satu cicilan hanya boleh memiliki satu catatan denda (unique installment_id),
-- sehingga denda tidak pernah dikenakan dua kali.
create or replace function public.rpc_apply_penalties(
  p_org uuid default null,
  p_as_of date default current_date,
  p_contract_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := coalesce(p_org, public.fn_current_org());
  v_settings public.app_settings;
  v_rule_type penalty_type;
  v_rule_amount numeric;
  v_grace integer;
  v_max bigint;
  v_percent_base penalty_percent_base;
  v_row record;
  v_late integer;
  v_chargeable integer;
  v_base bigint;
  v_amount bigint;
  v_capped boolean;
  v_processed integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
begin
  perform public.fn_assert_member(v_org);
  if not public.fn_can_configure(v_org) then
    raise exception 'Hanya Admin atau Super Admin yang boleh menghitung denda.' using errcode = '42501';
  end if;

  select * into v_settings from public.app_settings where organization_id = v_org;
  v_rule_type := coalesce(nullif(v_settings.penalty ->> 'type', '')::penalty_type, 'NONE');
  v_rule_amount := coalesce((v_settings.penalty ->> 'amount')::numeric, 0);
  v_grace := coalesce((v_settings.penalty ->> 'grace_days')::integer, 0);
  v_max := nullif(v_settings.penalty ->> 'max_amount', '')::bigint;
  v_percent_base := coalesce(nullif(v_settings.penalty ->> 'percent_base', '')::penalty_percent_base, 'OUTSTANDING');

  perform public.fn_begin_internal_write();

  for v_row in
    select i.id,
           i.contract_id,
           i.total_due,
           i.paid_amount,
           i.due_date,
           greatest(i.total_due - i.paid_amount, 0) as outstanding,
           (p_as_of - i.due_date) as late_days,
           pn.id as penalty_id,
           pn.status as penalty_status,
           pn.amount as penalty_amount
      from public.installments i
      left join public.penalties pn on pn.installment_id = i.id
     where i.organization_id = v_org
       and i.status <> 'CANCELLED'
       and i.due_date < p_as_of
       and i.total_due > i.paid_amount
       and (p_contract_id is null or i.contract_id = p_contract_id)
  loop
    v_late := greatest(v_row.late_days, 0);
    v_chargeable := greatest(v_late - v_grace, 0);

    if v_rule_type = 'NONE' or v_rule_amount <= 0 or v_chargeable <= 0 then
      v_amount := 0;
      v_capped := false;
    else
      v_base := case when v_percent_base = 'TOTAL_DUE' then v_row.total_due else v_row.outstanding end;
      v_amount := case v_rule_type
        when 'FIXED_PER_DAY' then round(v_rule_amount * v_chargeable)::bigint
        when 'FIXED_PER_INSTALLMENT' then round(v_rule_amount)::bigint
        when 'PERCENT_PER_DAY' then public.fn_apply_rate(v_base, v_rule_amount * v_chargeable)
        when 'PERCENT_PER_MONTH' then public.fn_apply_rate(v_base, v_rule_amount * ceil(v_chargeable::numeric / 30))
        else 0::bigint
      end;
      v_capped := v_max is not null and v_amount > v_max;
      if v_capped then
        v_amount := v_max;
      end if;
    end if;

    -- Catatan denda yang sudah dibayar/dibebaskan tidak boleh diubah diam-diam.
    if v_row.penalty_id is not null and v_row.penalty_status in ('SETTLED', 'WAIVED', 'CANCELLED') then
      continue;
    end if;

    if v_row.penalty_id is null then
      if v_amount > 0 then
        insert into public.penalties (
          organization_id, contract_id, installment_id, rule_snapshot, amount,
          late_days, chargeable_days, status, calculated_at
        ) values (
          v_org, v_row.contract_id, v_row.id,
          jsonb_build_object('type', v_rule_type, 'amount', v_rule_amount, 'grace_days', v_grace, 'max_amount', v_max, 'percent_base', v_percent_base, 'capped', v_capped),
          v_amount, v_late, v_chargeable, 'OPEN', p_as_of
        );
        v_created := v_created + 1;
      end if;
    else
      update public.penalties
         set amount = greatest(v_amount, paid_amount + waived_amount),
             late_days = v_late,
             chargeable_days = v_chargeable,
             calculated_at = p_as_of,
             rule_snapshot = jsonb_build_object('type', v_rule_type, 'amount', v_rule_amount, 'grace_days', v_grace, 'max_amount', v_max, 'percent_base', v_percent_base, 'capped', v_capped)
       where id = v_row.penalty_id;
      v_updated := v_updated + 1;
    end if;

    v_processed := v_processed + 1;
  end loop;

  perform public.fn_log_audit(
    v_org, 'UPDATE', 'penalties', null,
    format('Perhitungan denda per %s: %s cicilan diproses', p_as_of, v_processed),
    null, jsonb_build_object('processed', v_processed, 'created', v_created, 'updated', v_updated, 'as_of', p_as_of)
  );

  return jsonb_build_object('processed', v_processed, 'created', v_created, 'updated', v_updated);
end;
$$;

-- Membebaskan (sebagian/seluruh) denda dengan persetujuan berwenang.
create or replace function public.rpc_waive_penalty(p_penalty_id uuid, p_amount bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_penalty public.penalties;
  v_open bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembebasan harus lebih besar dari nol.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 10 then
    raise exception 'Alasan pembebasan wajib diisi minimal 10 karakter.' using errcode = '22023';
  end if;

  select * into v_penalty from public.penalties where id = p_penalty_id for update;
  if not found then
    raise exception 'Catatan denda tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_penalty.organization_id);
  if not public.fn_can_configure(v_penalty.organization_id) then
    raise exception 'Hanya Admin atau Super Admin yang boleh membebaskan denda.' using errcode = '42501';
  end if;

  v_open := greatest(v_penalty.amount - v_penalty.paid_amount - v_penalty.waived_amount, 0);
  if p_amount > v_open then
    raise exception 'Nominal pembebasan (%) melebihi sisa denda (%).', p_amount, v_open using errcode = '22023';
  end if;

  perform public.fn_begin_internal_write();

  update public.penalties
     set waived_amount = waived_amount + p_amount,
         waived_reason = p_reason,
         waived_by = auth.uid(),
         waived_at = now(),
         status = case
           when paid_amount + waived_amount + p_amount >= amount then 'WAIVED'::penalty_status
           else 'OPEN'::penalty_status
         end
   where id = p_penalty_id;

  perform public.fn_log_audit(
    v_penalty.organization_id, 'WAIVE_PENALTY', 'penalties', p_penalty_id,
    format('Pembebasan denda sebesar %s: %s', p_amount, p_reason),
    to_jsonb(v_penalty), jsonb_build_object('waived', p_amount, 'reason', p_reason)
  );

  return jsonb_build_object('penalty_id', p_penalty_id, 'waived', p_amount);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pengingat
-- -----------------------------------------------------------------------------

-- Membentuk antrean pengingat berdasarkan tanggal jatuh tempo.
-- Satu cicilan hanya memiliki satu pengingat per offset+kanal (unique constraint).
create or replace function public.rpc_enqueue_reminders(
  p_org uuid default null,
  p_as_of date default current_date
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := coalesce(p_org, public.fn_current_org());
  v_settings public.app_settings;
  v_offsets text[];
  v_channels reminder_channel[];
  v_offset text;
  v_channel reminder_channel;
  v_day_offset integer;
  v_row record;
  v_inserted integer := 0;
begin
  perform public.fn_assert_member(v_org);

  select * into v_settings from public.app_settings where organization_id = v_org;
  select coalesce(array_agg(value), array['D_MINUS_3', 'DUE_DATE', 'AFTER_DUE'])
    into v_offsets
    from jsonb_array_elements_text(coalesce(v_settings.integrations -> 'reminder_offsets', '["D_MINUS_3","DUE_DATE","AFTER_DUE"]'::jsonb)) as t(value);

  select coalesce(array_agg(value::reminder_channel), array['IN_APP']::reminder_channel[])
    into v_channels
    from jsonb_array_elements_text(coalesce(v_settings.integrations -> 'reminder_channels', '["IN_APP"]'::jsonb)) as t(value);

  perform public.fn_begin_internal_write();

  foreach v_offset in array v_offsets loop
    v_day_offset := case v_offset
      when 'D_MINUS_7' then 7
      when 'D_MINUS_3' then 3
      when 'D_MINUS_1' then 1
      when 'DUE_DATE' then 0
      when 'AFTER_DUE' then -1
      else null
    end;
    continue when v_day_offset is null;

    for v_row in
      select i.id as installment_id,
             i.contract_id,
             i.due_date,
             ct.customer_id,
             c.remind_enabled
        from public.installments i
        join public.credit_contracts ct on ct.id = i.contract_id
        join public.customers c on c.id = ct.customer_id
       where i.organization_id = v_org
         and i.status not in ('PAID', 'CANCELLED')
         and i.total_due > i.paid_amount
         and i.due_date = p_as_of + v_day_offset
    loop
      foreach v_channel in array v_channels loop
        begin
          insert into public.reminders (
            organization_id, contract_id, installment_id, customer_id,
            offset_key, channel, scheduled_for, status
          ) values (
            v_org, v_row.contract_id, v_row.installment_id, v_row.customer_id,
            v_offset::reminder_offset, v_channel, p_as_of,
            case when coalesce(v_row.remind_enabled, true) then 'PENDING'::reminder_status else 'SKIPPED'::reminder_status end
          )
          on conflict (installment_id, offset_key, channel) do nothing;
          if found then
            v_inserted := v_inserted + 1;
          end if;
        exception when unique_violation then
          null;
        end;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'as_of', p_as_of);
end;
$$;

-- Mencatat hasil pengiriman pengingat (dipakai Edge Function / proses terjadwal).
create or replace function public.rpc_mark_reminder(
  p_reminder_id uuid,
  p_status reminder_status,
  p_error text default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reminder public.reminders;
begin
  select * into v_reminder from public.reminders where id = p_reminder_id for update;
  if not found then
    raise exception 'Pengingat tidak ditemukan.' using errcode = 'P0002';
  end if;
  perform public.fn_assert_member(v_reminder.organization_id);

  perform public.fn_begin_internal_write();

  update public.reminders
     set status = p_status,
         attempts = attempts + 1,
         sent_at = case when p_status = 'SENT' then now() else sent_at end,
         last_error = p_error
   where id = p_reminder_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Metrik dashboard (server-side, menghormati RLS melalui pemeriksaan organisasi)
-- -----------------------------------------------------------------------------

create or replace function public.rpc_dashboard_metrics(
  p_from date default date_trunc('month', current_date)::date,
  p_to date default current_date,
  p_org uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := coalesce(p_org, public.fn_current_org());
  v_result jsonb;
begin
  perform public.fn_assert_member(v_org);

  select jsonb_build_object(
    'active_customers', (
      select count(*) from public.customers c
       where c.organization_id = v_org and c.status in ('ACTIVE', 'DELINQUENT')
    ),
    'new_customers', (
      select count(*) from public.customers c
       where c.organization_id = v_org and c.created_at::date between p_from and p_to
    ),
    'applications_in_range', (
      select count(*) from public.credit_applications a
       where a.organization_id = v_org and a.created_at::date between p_from and p_to
    ),
    'applications_pending', (
      select count(*) from public.credit_applications a
       where a.organization_id = v_org and a.status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
    ),
    'approved_financing', (
      select coalesce(sum(a.principal), 0) from public.credit_applications a
       where a.organization_id = v_org and a.status = 'APPROVED' and a.decided_at::date between p_from and p_to
    ),
    'disbursed_in_range', (
      select coalesce(sum(ct.principal), 0) from public.credit_contracts ct
       where ct.organization_id = v_org and ct.status <> 'CANCELLED' and ct.disbursement_date between p_from and p_to
    ),
    'active_contracts', (
      select count(*) from public.credit_contracts ct
       where ct.organization_id = v_org and ct.status in ('ACTIVE', 'DELINQUENT', 'RESTRUCTURED')
    ),
    'paid_off_contracts', (
      select count(*) from public.credit_contracts ct where ct.organization_id = v_org and ct.status = 'PAID_OFF'
    ),
    'delinquent_contracts', (
      select count(*) from public.credit_contracts ct where ct.organization_id = v_org and ct.status = 'DELINQUENT'
    ),
    'outstanding_total', (
      select coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0)
        from public.installments i
        join public.credit_contracts ct on ct.id = i.contract_id
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and ct.status in ('ACTIVE', 'DELINQUENT', 'RESTRUCTURED')
    ),
    'overdue_total', (
      select coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0)
        from public.installments i
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and i.due_date < current_date and i.total_due > i.paid_amount
    ),
    'overdue_count', (
      select count(*) from public.installments i
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and i.due_date < current_date and i.total_due > i.paid_amount
    ),
    'due_today_total', (
      select coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0)
        from public.installments i
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and i.due_date = current_date and i.total_due > i.paid_amount
    ),
    'due_today_count', (
      select count(*) from public.installments i
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and i.due_date = current_date and i.total_due > i.paid_amount
    ),
    'penalty_outstanding', (
      select coalesce(sum(greatest(pn.amount - pn.paid_amount - pn.waived_amount, 0)), 0)
        from public.penalties pn
       where pn.organization_id = v_org and pn.status = 'OPEN'
    ),
    'collections_in_range', (
      select coalesce(sum(p.amount), 0) from public.payments p
       where p.organization_id = v_org and p.status = 'POSTED' and p.paid_date between p_from and p_to
    ),
    'reversals_in_range', (
      select coalesce(sum(p.amount), 0) from public.payments p
       where p.organization_id = v_org and p.status = 'REVERSED' and p.paid_date between p_from and p_to
    ),
    'on_time_paid', (
      select count(*) from public.installments i
       where i.organization_id = v_org and i.status = 'PAID'
         and i.last_payment_date is not null and i.last_payment_date <= i.due_date
    ),
    'total_paid_installments', (
      select count(*) from public.installments i
       where i.organization_id = v_org and i.status = 'PAID'
    ),
    'long_overdue_outstanding', (
      select coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0)
        from public.installments i
       where i.organization_id = v_org and i.status <> 'CANCELLED'
         and i.total_due > i.paid_amount and (current_date - i.due_date) > 90
    ),
    'method_distribution', (
      select coalesce(jsonb_object_agg(x.method, x.total), '{}'::jsonb)
        from (
          select p.method::text as method, sum(p.amount) as total
            from public.payments p
           where p.organization_id = v_org and p.status = 'POSTED' and p.paid_date between p_from and p_to
           group by p.method
        ) x
    ),
    'status_distribution', (
      select coalesce(jsonb_object_agg(x.status, x.total), '{}'::jsonb)
        from (
          select ct.status::text as status, count(*) as total
            from public.credit_contracts ct
           where ct.organization_id = v_org
           group by ct.status
        ) x
    ),
    'aging', (
      select coalesce(jsonb_object_agg(x.bucket, jsonb_build_object('count', x.cnt, 'amount', x.amount)), '{}'::jsonb)
        from (
          select public.fn_aging_bucket((current_date - i.due_date)::integer) as bucket,
                 count(*) as cnt,
                 sum(greatest(i.total_due - i.paid_amount, 0)) as amount
            from public.installments i
           where i.organization_id = v_org and i.status <> 'CANCELLED'
             and i.due_date < current_date and i.total_due > i.paid_amount
           group by 1
        ) x
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Deret pembayaran harian untuk grafik dashboard.
create or replace function public.rpc_payment_series(
  p_from date,
  p_to date,
  p_org uuid default null
)
returns table (period date, amount bigint, count integer, reversal_amount bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as period
  )
  select d.period,
         coalesce(sum(case when p.status = 'POSTED' then p.amount end), 0)::bigint as amount,
         coalesce(count(case when p.status = 'POSTED' then 1 end), 0)::integer as count,
         coalesce(sum(case when p.status = 'REVERSED' then p.amount end), 0)::bigint as reversal_amount
    from days d
    left join public.payments p
      on p.paid_date = d.period
     and p.organization_id = coalesce(p_org, public.fn_current_org())
   group by d.period
   order by d.period;
$$;

-- =============================================================================
-- SELESAI — fungsi bisnis
-- =============================================================================
