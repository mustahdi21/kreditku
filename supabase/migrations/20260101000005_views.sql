-- =============================================================================
-- KreditKu — 20260101000005_views.sql
-- View pelaporan. Semua view dibuat dengan security_invoker = true sehingga
-- Row Level Security pada tabel dasar tetap berlaku bagi pemanggil.
-- (Memerlukan PostgreSQL 15+ — seluruh proyek Supabase saat ini memenuhi.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ringkasan pelanggan
-- -----------------------------------------------------------------------------

-- CATATAN: kolom baru WAJIB ditambahkan di AKHIR daftar select. PostgreSQL
-- mengidentifikasi kolom view berdasarkan posisi, sehingga `create or replace
-- view` akan gagal bila urutan kolom lama berubah. Dengan menambahkan di akhir,
-- migrasi tetap idempoten dan aman dijalankan berulang.
create or replace view public.v_customer_summary
with (security_invoker = true) as
select
  c.id,
  c.organization_id,
  c.customer_number,
  c.full_name,
  c.phone,
  c.email,
  c.status,
  c.remind_enabled,
  c.created_at,
  c.archived_at,
  coalesce(t.total_contracts, 0)                as total_contracts,
  coalesce(t.active_contracts, 0)               as active_contracts,
  coalesce(t.total_payable, 0)::bigint          as total_payable,
  coalesce(t.total_paid, 0)::bigint             as total_paid,
  coalesce(t.outstanding, 0)::bigint            as outstanding,
  coalesce(t.overdue_amount, 0)::bigint         as overdue_amount,
  t.next_due_date,
  coalesce(t.max_days_late, 0)                  as max_days_late,
  -- Data pribadi tambahan (akses dibatasi oleh RLS pada tabel dasar).
  c.identity_number,
  c.address,
  c.birth_date,
  c.occupation,
  c.monthly_income,
  c.emergency_contact_name,
  c.emergency_contact_phone,
  c.notes,
  c.updated_at
from public.customers c
left join lateral (
  select
    count(*)                                                    as total_contracts,
    count(*) filter (where ct.status in ('ACTIVE', 'DELINQUENT', 'RESTRUCTURED')) as active_contracts,
    sum(ct.total_payable)                                       as total_payable,
    sum(ct.total_paid)                                          as total_paid,
    sum(case when ct.status in ('ACTIVE', 'DELINQUENT', 'RESTRUCTURED') then ct.outstanding else 0 end) as outstanding,
    sum(ov.overdue_amount)                                      as overdue_amount,
    min(ct.next_due_date)                                       as next_due_date,
    max(ov.max_days_late)                                       as max_days_late
  from public.credit_contracts ct
  left join lateral (
    select coalesce(sum(greatest(i.total_due - i.paid_amount, 0)), 0) as overdue_amount,
           max((current_date - i.due_date))                           as max_days_late
      from public.installments i
     where i.contract_id = ct.id
       and i.status <> 'CANCELLED'
       and i.due_date < current_date
       and i.total_due > i.paid_amount
  ) ov on true
  where ct.customer_id = c.id
    and ct.status <> 'CANCELLED'
) t on true;

-- -----------------------------------------------------------------------------
-- Ringkasan kontrak
-- -----------------------------------------------------------------------------

create or replace view public.v_contract_summary
with (security_invoker = true) as
select
  ct.id,
  ct.organization_id,
  ct.contract_number,
  ct.customer_id,
  c.customer_number,
  c.full_name              as customer_name,
  c.phone                  as customer_phone,
  ct.contract_date,
  ct.disbursement_date,
  ct.principal,
  ct.down_payment,
  ct.price,
  ct.tenor,
  ct.method,
  ct.rate_bp,
  ct.rate_basis,
  ct.frequency,
  ct.total_interest,
  ct.total_fees,
  ct.total_payable,
  ct.total_paid,
  ct.outstanding,
  ct.first_due_date,
  ct.next_due_date,
  ct.last_payment_date,
  ct.status,
  ct.created_at,
  coalesce(stats.paid_count, 0)         as paid_installments,
  coalesce(stats.partial_count, 0)      as partial_installments,
  coalesce(stats.overdue_count, 0)      as overdue_installments,
  coalesce(stats.overdue_amount, 0)     as overdue_amount,
  coalesce(stats.penalty_open, 0)       as penalty_outstanding,
  coalesce(stats.max_days_late, 0)      as max_days_late,
  case when ct.total_payable > 0
       then round((ct.total_paid::numeric / ct.total_payable::numeric) * 100, 1)
       else 0 end                      as progress_percent
from public.credit_contracts ct
join public.customers c on c.id = ct.customer_id
left join lateral (
  select
    count(*) filter (where i.total_due > 0 and i.paid_amount >= i.total_due) as paid_count,
    count(*) filter (where i.paid_amount > 0 and i.paid_amount < i.total_due) as partial_count,
    count(*) filter (where i.due_date < current_date and i.total_due > i.paid_amount) as overdue_count,
    coalesce(sum(greatest(i.total_due - i.paid_amount, 0)) filter (where i.due_date < current_date), 0) as overdue_amount,
    coalesce(sum(greatest(pn.amount - pn.paid_amount - pn.waived_amount, 0)) filter (where pn.status = 'OPEN'), 0) as penalty_open,
    max((current_date - i.due_date)) filter (where i.due_date < current_date and i.total_due > i.paid_amount) as max_days_late
  from public.installments i
  left join public.penalties pn on pn.installment_id = i.id
  where i.contract_id = ct.id and i.status <> 'CANCELLED'
) stats on true;

-- -----------------------------------------------------------------------------
-- Rincian cicilan (dipakai tabel cicilan, penagihan, dan pengingat)
-- -----------------------------------------------------------------------------

create or replace view public.v_installment_details
with (security_invoker = true) as
select
  i.id,
  i.organization_id,
  i.contract_id,
  ct.contract_number,
  i.installment_number,
  i.base_due_date,
  i.due_date,
  i.principal,
  i.interest,
  i.fees,
  i.total_due,
  i.paid_amount,
  i.penalty_paid_amount,
  greatest(i.total_due - i.paid_amount, 0)::bigint as outstanding,
  i.last_payment_date,
  i.status as stored_status,
  case
    when i.cancelled_at is not null then 'CANCELLED'
    when i.total_due > 0 and i.paid_amount >= i.total_due then 'PAID'
    when i.paid_amount > 0 then 'PARTIAL'
    when i.due_date < current_date then 'OVERDUE'
    when i.due_date = current_date then 'DUE_TODAY'
    else 'PENDING'
  end as status,
  greatest((current_date - i.due_date), 0) as late_days,
  public.fn_aging_bucket(greatest((current_date - i.due_date), 0)) as aging_bucket,
  coalesce(greatest(pn.amount - pn.paid_amount - pn.waived_amount, 0), 0)::bigint as penalty_outstanding,
  coalesce(pn.amount, 0)::bigint as penalty_amount,
  pn.id as penalty_id,
  pn.status as penalty_status,
  ct.customer_id,
  c.customer_number,
  c.full_name as customer_name,
  c.phone as customer_phone,
  c.remind_enabled
from public.installments i
join public.credit_contracts ct on ct.id = i.contract_id
join public.customers c on c.id = ct.customer_id
left join public.penalties pn on pn.installment_id = i.id;

-- -----------------------------------------------------------------------------
-- Tunggakan
-- -----------------------------------------------------------------------------

create or replace view public.v_overdue_installments
with (security_invoker = true) as
select *
from public.v_installment_details
where status <> 'CANCELLED'
  and outstanding > 0
  and due_date < current_date;

-- Jatuh tempo hari ini
create or replace view public.v_due_today
with (security_invoker = true) as
select *
from public.v_installment_details
where status <> 'CANCELLED'
  and outstanding > 0
  and due_date = current_date;

-- Jatuh tempo dalam 7 hari ke depan
create or replace view public.v_upcoming_due
with (security_invoker = true) as
select *
from public.v_installment_details
where status <> 'CANCELLED'
  and outstanding > 0
  and due_date > current_date
  and due_date <= current_date + 7;

-- -----------------------------------------------------------------------------
-- Laporan umur piutang
-- -----------------------------------------------------------------------------

create or replace view public.v_aging_report
with (security_invoker = true) as
select
  i.organization_id,
  public.fn_aging_bucket(greatest((current_date - i.due_date), 0)) as bucket,
  count(*)::bigint                        as installment_count,
  count(distinct i.contract_id)::bigint    as contract_count,
  sum(i.principal)::bigint                 as principal_amount,
  sum(i.interest)::bigint                  as interest_amount,
  sum(i.fees)::bigint                      as fees_amount,
  sum(greatest(i.total_due - i.paid_amount, 0))::bigint as outstanding,
  coalesce(sum(greatest(pn.amount - pn.paid_amount - pn.waived_amount, 0)) filter (where pn.status = 'OPEN'), 0)::bigint as penalty_outstanding,
  max((current_date - i.due_date))         as max_days_late
from public.installments i
left join public.penalties pn on pn.installment_id = i.id
where i.status <> 'CANCELLED'
  and i.due_date < current_date
  and i.total_due > i.paid_amount
group by i.organization_id, 2;

-- -----------------------------------------------------------------------------
-- Laporan pembayaran harian & bulanan
-- -----------------------------------------------------------------------------

create or replace view public.v_collection_daily
with (security_invoker = true) as
select
  p.organization_id,
  p.paid_date,
  count(*) filter (where p.status = 'POSTED')::bigint                   as payment_count,
  coalesce(sum(p.amount) filter (where p.status = 'POSTED'), 0)::bigint as amount,
  coalesce(sum(p.amount) filter (where p.status = 'REVERSED'), 0)::bigint as reversal_amount,
  count(distinct p.contract_id)::bigint                                 as contract_count
from public.payments p
group by p.organization_id, p.paid_date;

create or replace view public.v_collection_monthly
with (security_invoker = true) as
select
  p.organization_id,
  date_trunc('month', p.paid_date)::date as period_month,
  count(*) filter (where p.status = 'POSTED')::bigint                   as payment_count,
  coalesce(sum(p.amount) filter (where p.status = 'POSTED'), 0)::bigint as amount,
  coalesce(sum(p.amount) filter (where p.status = 'REVERSED'), 0)::bigint as reversal_amount
from public.payments p
group by p.organization_id, 2;

-- -----------------------------------------------------------------------------
-- Laporan pencairan
-- -----------------------------------------------------------------------------

create or replace view public.v_disbursement_report
with (security_invoker = true) as
select
  ct.id as contract_id,
  ct.organization_id,
  ct.contract_number,
  ct.disbursement_date,
  ct.customer_id,
  c.customer_number,
  c.full_name as customer_name,
  ct.principal,
  ct.upfront_amount,
  ct.total_interest,
  ct.total_fees,
  ct.total_payable,
  ct.tenor,
  ct.method,
  ct.rate_bp,
  ct.rate_basis,
  ct.status
from public.credit_contracts ct
join public.customers c on c.id = ct.customer_id
where ct.status <> 'CANCELLED';

-- -----------------------------------------------------------------------------
-- Analitik pembayaran per kontrak (pokok, bunga, biaya, denda)
-- -----------------------------------------------------------------------------

create or replace view public.v_payment_breakdown
with (security_invoker = true) as
select
  p.organization_id,
  p.id as payment_id,
  p.contract_id,
  p.receipt_number,
  p.paid_date,
  p.amount,
  p.method,
  p.status,
  p.created_by,
  coalesce(sum(a.amount), 0)::bigint         as allocated_to_installments,
  coalesce(sum(a.penalty_amount), 0)::bigint as allocated_to_penalties,
  p.unallocated,
  -- Kolom tambahan (ditambahkan di akhir agar view tetap idempoten).
  ct.contract_number,
  c.full_name                                as customer_name,
  c.customer_number,
  pr.full_name                               as officer_name
from public.payments p
left join public.payment_allocations a on a.payment_id = p.id
left join public.credit_contracts ct on ct.id = p.contract_id
left join public.customers c on c.id = ct.customer_id
left join public.profiles pr on pr.id = p.created_by
group by p.organization_id, p.id, p.contract_id, p.receipt_number, p.paid_date,
         p.amount, p.method, p.status, p.created_by, p.unallocated,
         ct.contract_number, c.full_name, c.customer_number, pr.full_name;

-- -----------------------------------------------------------------------------
-- Kinerja petugas
-- -----------------------------------------------------------------------------

create or replace view public.v_officer_performance
with (security_invoker = true) as
select
  m.organization_id,
  m.user_id,
  pr.full_name,
  pr.email,
  m.role,
  coalesce(pay.payment_count, 0)::bigint     as payments_count,
  coalesce(pay.payment_amount, 0)::bigint    as payments_amount,
  coalesce(app.applications_count, 0)::bigint as applications_count,
  coalesce(dec.approved_count, 0)::bigint    as approvals_count,
  coalesce(dec.rejected_count, 0)::bigint    as rejections_count
from public.organization_members m
join public.profiles pr on pr.id = m.user_id
left join lateral (
  select count(*) as payment_count, sum(p.amount) as payment_amount
    from public.payments p
   where p.created_by = m.user_id and p.status = 'POSTED' and p.organization_id = m.organization_id
) pay on true
left join lateral (
  select count(*) as applications_count
    from public.credit_applications a
   where a.created_by = m.user_id and a.organization_id = m.organization_id
) app on true
left join lateral (
  select count(*) filter (where a.status = 'APPROVED') as approved_count,
         count(*) filter (where a.status = 'REJECTED') as rejected_count
    from public.credit_applications a
   where a.decided_by = m.user_id and a.organization_id = m.organization_id
) dec on true;

-- -----------------------------------------------------------------------------
-- Pusat notifikasi pengguna
-- =============================================================================

create or replace view public.v_my_notifications
with (security_invoker = true) as
select n.*
from public.notifications n
where n.user_id = auth.uid()
   or (n.user_id is null and n.organization_id = public.fn_current_org());

-- =============================================================================
-- SELESAI — view
-- =============================================================================
