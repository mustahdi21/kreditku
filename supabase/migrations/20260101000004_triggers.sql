-- =============================================================================
-- KreditKu — 20260101000004_triggers.sql
-- Trigger pelindung integritas data finansial dan audit otomatis.
--
-- FILOSOFI
-- --------
-- Data keuangan TIDAK BOLEH diubah atau dihapus secara langsung oleh klien.
-- Perubahan harus melalui fungsi bisnis yang mencatat audit trail. Trigger di
-- bawah ini memaksakan aturan tersebut: perubahan langsung akan gagal kecuali
-- penulisan dilakukan oleh fungsi internal (ditandai GUC kreditku.internal_write).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Foreign key sirkular: pengajuan ↔ kontrak (deferred agar dapat diisi dua arah)
-- -----------------------------------------------------------------------------

alter table public.credit_applications
  drop constraint if exists fk_applications_contract;

alter table public.credit_applications
  add constraint fk_applications_contract
  foreign key (contract_id) references public.credit_contracts (id)
  on delete set null deferrable initially deferred;

-- -----------------------------------------------------------------------------
-- Pelindung pembayaran yang sudah diposting
-- -----------------------------------------------------------------------------

create or replace function public.fn_protect_posted_payment()
returns trigger
language plpgsql as $$
begin
  if public.fn_is_internal_write() then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'Pembayaran tidak boleh dihapus. Gunakan prosedur pembatalan (reversal) yang tercatat.'
      using errcode = '42501';
  end if;

  if new.amount is distinct from old.amount
     or new.contract_id is distinct from old.contract_id
     or new.method is distinct from old.method
     or new.paid_at is distinct from old.paid_at
     or new.receipt_number is distinct from old.receipt_number
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Data pembayaran yang sudah diposting tidak boleh diubah. Gunakan prosedur pembatalan (reversal).'
      using errcode = '42501';
  end if;

  if old.status = 'REVERSED' and new.status <> 'REVERSED' then
    raise exception 'Pembayaran yang sudah dibatalkan tidak dapat diaktifkan kembali.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_posted_payment on public.payments;
create trigger trg_protect_posted_payment
  before update or delete on public.payments
  for each row execute function public.fn_protect_posted_payment();

-- -----------------------------------------------------------------------------
-- Pelindung alokasi pembayaran
-- -----------------------------------------------------------------------------

create or replace function public.fn_protect_allocation()
returns trigger
language plpgsql as $$
begin
  if public.fn_is_internal_write() then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;
  raise exception 'Alokasi pembayaran hanya boleh diubah melalui prosedur pembayaran atau pembatalan.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_protect_allocation on public.payment_allocations;
create trigger trg_protect_allocation
  before update or delete on public.payment_allocations
  for each row execute function public.fn_protect_allocation();

drop trigger if exists trg_protect_reversal on public.payment_reversals;
create trigger trg_protect_reversal
  before update or delete on public.payment_reversals
  for each row execute function public.fn_protect_allocation();

-- -----------------------------------------------------------------------------
-- Pelindung nilai finansial cicilan
-- -----------------------------------------------------------------------------

create or replace function public.fn_protect_installment()
returns trigger
language plpgsql as $$
begin
  if public.fn_is_internal_write() then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'Cicilan tidak boleh dihapus. Gunakan pembatalan cicilan melalui prosedur resmi.'
      using errcode = '42501';
  end if;

  if new.paid_amount is distinct from old.paid_amount
     or new.penalty_paid_amount is distinct from old.penalty_paid_amount
     or new.total_due is distinct from old.total_due
     or new.principal is distinct from old.principal
     or new.interest is distinct from old.interest
     or new.fees is distinct from old.fees
     or new.due_date is distinct from old.due_date
     or new.base_due_date is distinct from old.base_due_date
     or new.contract_id is distinct from old.contract_id
     or new.status is distinct from old.status
     or new.last_payment_date is distinct from old.last_payment_date
     or new.cancelled_at is distinct from old.cancelled_at
     or new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'Nilai finansial dan status cicilan hanya boleh diubah melalui prosedur pembayaran, amandemen, atau pembatalan.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_installment on public.installments;
create trigger trg_protect_installment
  before update or delete on public.installments
  for each row execute function public.fn_protect_installment();

-- -----------------------------------------------------------------------------
-- Pelindung denda
-- -----------------------------------------------------------------------------

create or replace function public.fn_protect_penalty()
returns trigger
language plpgsql as $$
begin
  if public.fn_is_internal_write() then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'Catatan denda tidak boleh dihapus. Gunakan pembebasan denda melalui prosedur resmi.'
      using errcode = '42501';
  end if;
  if new.paid_amount is distinct from old.paid_amount
     or new.waived_amount is distinct from old.waived_amount
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.waived_reason is distinct from old.waived_reason then
    raise exception 'Nilai dan status denda hanya boleh diubah melalui perhitungan atau pembebasan denda.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_penalty on public.penalties;
create trigger trg_protect_penalty
  before update or delete on public.penalties
  for each row execute function public.fn_protect_penalty();

-- -----------------------------------------------------------------------------
-- Larangan penghapusan permanen data bisnis
-- -----------------------------------------------------------------------------

create or replace function public.fn_block_hard_delete()
returns trigger
language plpgsql as $$
begin
  if public.fn_is_internal_write() then
    return old;
  end if;
  raise exception 'Data % tidak boleh dihapus permanen. Gunakan arsip atau pembatalan resmi.', TG_TABLE_NAME
    using errcode = '42501';
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'customers', 'credit_applications', 'credit_contracts', 'installments',
    'payments', 'payment_allocations', 'penalties', 'audit_logs', 'notifications'
  ] loop
    execute format('drop trigger if exists trg_block_hard_delete on public.%I', v_table);
    execute format(
      'create trigger trg_block_hard_delete before delete on public.%I for each row execute function public.fn_block_hard_delete()',
      v_table
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Audit otomatis untuk tabel konfigurasi & data master
-- -----------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'organizations', 'organization_members', 'customers', 'credit_products',
    'credit_applications', 'credit_contracts', 'credit_contract_amendments',
    'app_settings', 'document_templates', 'reminder_templates'
  ] loop
    execute format('drop trigger if exists trg_audit_row on public.%I', v_table);
    execute format(
      'create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.fn_audit_row()',
      v_table
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Pencatatan login terakhir
-- -----------------------------------------------------------------------------

create or replace function public.fn_touch_login()
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles
     set last_login_at = now()
   where id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Pembuatan profil otomatis saat pengguna baru mendaftar
-- -----------------------------------------------------------------------------

create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, created_by)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.id
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- =============================================================================
-- SELESAI — trigger
-- =============================================================================
