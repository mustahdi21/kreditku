-- =============================================================================
-- KreditKu — 20260101000006_rls.sql
-- Row Level Security: isolasi antar organisasi + pembatasan berdasarkan role.
--
-- Prinsip:
--   1. RLS aktif pada SELURUH tabel bisnis.
--   2. Setiap kebijakan membaca organisasi pemanggil dari fungsi security definer
--      yang hanya mengembalikan keanggotaan pengguna yang sedang login.
--   3. Penulisan data transaksional (pembayaran, alokasi, denda, audit) hanya
--      dapat dilakukan melalui fungsi bisnis (SECURITY DEFINER), sehingga tidak
--      ada kebijakan INSERT/UPDATE untuk peran klien.
--   4. Tidak ada kebijakan DELETE: penghapusan permanen dilarang.
-- =============================================================================

alter table public.organizations                       enable row level security;
alter table public.profiles                            enable row level security;
alter table public.organization_members                enable row level security;
alter table public.customers                           enable row level security;
alter table public.credit_products                     enable row level security;
alter table public.app_settings                        enable row level security;
alter table public.number_sequences                    enable row level security;
alter table public.credit_applications                 enable row level security;
alter table public.credit_application_status_history   enable row level security;
alter table public.credit_application_documents        enable row level security;
alter table public.credit_contracts                    enable row level security;
alter table public.credit_contract_amendments          enable row level security;
alter table public.installments                        enable row level security;
alter table public.payments                            enable row level security;
alter table public.payment_allocations                 enable row level security;
alter table public.payment_reversals                   enable row level security;
alter table public.penalties                           enable row level security;
alter table public.reminder_templates                  enable row level security;
alter table public.reminders                           enable row level security;
alter table public.notifications                       enable row level security;
alter table public.audit_logs                          enable row level security;
alter table public.document_templates                  enable row level security;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.fn_is_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.fn_has_role(id, array['SUPER_ADMIN']::member_role[]))
  with check (public.fn_has_role(id, array['SUPER_ADMIN']::member_role[]));

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.organization_members m
       where m.user_id = profiles.id
         and public.fn_is_member(m.organization_id)
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.organization_members m
       where m.user_id = profiles.id
         and public.fn_has_role(m.organization_id, array['SUPER_ADMIN']::member_role[])
    )
  )
  with check (
    id = auth.uid()
    or exists (
      select 1 from public.organization_members m
       where m.user_id = profiles.id
         and public.fn_has_role(m.organization_id, array['SUPER_ADMIN']::member_role[])
    )
  );

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- organization_members
-- -----------------------------------------------------------------------------

drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists members_insert on public.organization_members;
create policy members_insert on public.organization_members
  for insert to authenticated
  with check (public.fn_has_role(organization_id, array['SUPER_ADMIN']::member_role[]));

drop policy if exists members_update on public.organization_members;
create policy members_update on public.organization_members
  for update to authenticated
  using (public.fn_has_role(organization_id, array['SUPER_ADMIN']::member_role[]))
  with check (public.fn_has_role(organization_id, array['SUPER_ADMIN']::member_role[]));

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.fn_can_manage_credit(organization_id));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (public.fn_can_manage_credit(organization_id))
  with check (public.fn_can_manage_credit(organization_id));

-- -----------------------------------------------------------------------------
-- credit_products
-- -----------------------------------------------------------------------------

drop policy if exists products_select on public.credit_products;
create policy products_select on public.credit_products
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists products_insert on public.credit_products;
create policy products_insert on public.credit_products
  for insert to authenticated
  with check (public.fn_can_configure(organization_id));

drop policy if exists products_update on public.credit_products;
create policy products_update on public.credit_products
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- app_settings (hanya Super Admin; perubahan terperinci melalui rpc_update_settings)
-- -----------------------------------------------------------------------------

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings
  for update to authenticated
  using (public.fn_has_role(organization_id, array['SUPER_ADMIN']::member_role[]))
  with check (public.fn_has_role(organization_id, array['SUPER_ADMIN']::member_role[]));

-- -----------------------------------------------------------------------------
-- number_sequences — TIDAK ADA kebijakan: hanya fungsi internal yang boleh akses
-- -----------------------------------------------------------------------------

-- (RLS aktif tanpa policy = seluruh akses ditolak)

-- -----------------------------------------------------------------------------
-- credit_applications
-- -----------------------------------------------------------------------------

drop policy if exists applications_select on public.credit_applications;
create policy applications_select on public.credit_applications
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists applications_insert on public.credit_applications;
create policy applications_insert on public.credit_applications
  for insert to authenticated
  with check (public.fn_can_manage_credit(organization_id));

drop policy if exists applications_update on public.credit_applications;
create policy applications_update on public.credit_applications
  for update to authenticated
  using (public.fn_can_manage_credit(organization_id))
  with check (public.fn_can_manage_credit(organization_id));

-- -----------------------------------------------------------------------------
-- credit_application_status_history
-- -----------------------------------------------------------------------------

drop policy if exists application_history_select on public.credit_application_status_history;
create policy application_history_select on public.credit_application_status_history
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists application_history_insert on public.credit_application_status_history;
create policy application_history_insert on public.credit_application_status_history
  for insert to authenticated
  with check (public.fn_can_manage_credit(organization_id));

-- -----------------------------------------------------------------------------
-- credit_application_documents
-- -----------------------------------------------------------------------------

drop policy if exists application_documents_select on public.credit_application_documents;
create policy application_documents_select on public.credit_application_documents
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists application_documents_insert on public.credit_application_documents;
create policy application_documents_insert on public.credit_application_documents
  for insert to authenticated
  with check (public.fn_can_manage_credit(organization_id));

drop policy if exists application_documents_delete on public.credit_application_documents;
create policy application_documents_delete on public.credit_application_documents
  for delete to authenticated
  using (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- credit_contracts
-- -----------------------------------------------------------------------------

drop policy if exists contracts_select on public.credit_contracts;
create policy contracts_select on public.credit_contracts
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists contracts_update on public.credit_contracts;
create policy contracts_update on public.credit_contracts
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- credit_contract_amendments (penulisan melalui rpc_amend_contract)
-- -----------------------------------------------------------------------------

drop policy if exists amendments_select on public.credit_contract_amendments;
create policy amendments_select on public.credit_contract_amendments
  for select to authenticated
  using (public.fn_is_member(organization_id));

-- -----------------------------------------------------------------------------
-- installments
-- -----------------------------------------------------------------------------

drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists installments_update on public.installments;
create policy installments_update on public.installments
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- payments — pembacaan oleh anggota; penulisan HANYA melalui rpc_post_payment
-- -----------------------------------------------------------------------------

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.fn_is_member(organization_id));

-- -----------------------------------------------------------------------------
-- payment_allocations & payment_reversals — hanya dibaca
-- -----------------------------------------------------------------------------

drop policy if exists allocations_select on public.payment_allocations;
create policy allocations_select on public.payment_allocations
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists reversals_select on public.payment_reversals;
create policy reversals_select on public.payment_reversals
  for select to authenticated
  using (public.fn_is_member(organization_id));

-- -----------------------------------------------------------------------------
-- penalties
-- -----------------------------------------------------------------------------

drop policy if exists penalties_select on public.penalties;
create policy penalties_select on public.penalties
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists penalties_update on public.penalties;
create policy penalties_update on public.penalties
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- reminder_templates
-- -----------------------------------------------------------------------------

drop policy if exists reminder_templates_select on public.reminder_templates;
create policy reminder_templates_select on public.reminder_templates
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists reminder_templates_write on public.reminder_templates;
create policy reminder_templates_write on public.reminder_templates
  for insert to authenticated
  with check (public.fn_can_configure(organization_id));

drop policy if exists reminder_templates_update on public.reminder_templates;
create policy reminder_templates_update on public.reminder_templates
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- reminders
-- -----------------------------------------------------------------------------

drop policy if exists reminders_select on public.reminders;
create policy reminders_select on public.reminders
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists reminders_update on public.reminders;
create policy reminders_update on public.reminders
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    public.fn_is_member(organization_id)
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (
    public.fn_is_member(organization_id)
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    public.fn_is_member(organization_id)
    and (user_id is null or user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- audit_logs — hanya dibaca oleh Super Admin, Admin, dan Viewer/Auditor
-- -----------------------------------------------------------------------------

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    organization_id is not null
    and public.fn_has_role(
      organization_id,
      array['SUPER_ADMIN', 'ADMIN', 'VIEWER']::member_role[]
    )
  );

-- -----------------------------------------------------------------------------
-- document_templates
-- -----------------------------------------------------------------------------

drop policy if exists document_templates_select on public.document_templates;
create policy document_templates_select on public.document_templates
  for select to authenticated
  using (public.fn_is_member(organization_id));

drop policy if exists document_templates_insert on public.document_templates;
create policy document_templates_insert on public.document_templates
  for insert to authenticated
  with check (public.fn_can_configure(organization_id));

drop policy if exists document_templates_update on public.document_templates;
create policy document_templates_update on public.document_templates
  for update to authenticated
  using (public.fn_can_configure(organization_id))
  with check (public.fn_can_configure(organization_id));

-- =============================================================================
-- Hak akses objek
-- =============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- View laporan hanya untuk pengguna terautentikasi.
grant select on all tables in schema public to authenticated;

-- Peran anon tidak diberi akses apa pun pada skema public: seluruh data
-- hanya dapat dibaca setelah pengguna terautentikasi (RLS tetap berlaku).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to anon;

-- -----------------------------------------------------------------------------
-- Pembatasan fungsi
-- -----------------------------------------------------------------------------

-- Fungsi internal tidak boleh dipanggil langsung oleh klien.
revoke all on function public.fn_allocate_sequence(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fn_set_application_status(uuid, application_status, text, uuid) from public, anon, authenticated;
revoke all on function public.fn_begin_internal_write() from public, anon, authenticated;
revoke all on function public.fn_is_internal_write() from public, anon, authenticated;
revoke all on function public.fn_internal_roles() from public, anon, authenticated;
revoke all on function public.fn_log_audit(uuid, audit_action, text, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fn_notify(uuid, notification_type, text, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fn_refresh_contract(uuid) from public, anon, authenticated;
revoke all on function public.fn_refresh_customer(uuid) from public, anon, authenticated;
revoke all on function public.fn_refresh_installment_statuses(uuid, date) from public, anon, authenticated;
revoke all on function public.fn_audit_row() from public, anon, authenticated;
revoke all on function public.fn_handle_new_user() from public, anon, authenticated;

-- Fungsi yang memang dipanggil dari aplikasi (semuanya memeriksa keanggotaan).
revoke all on function public.fn_next_number(text, text, date, text, uuid) from anon;
revoke all on function public.rpc_submit_application(uuid, text) from anon;
revoke all on function public.rpc_decide_application(uuid, application_status, text, text) from anon;
revoke all on function public.rpc_cancel_application(uuid, text) from anon;
revoke all on function public.rpc_post_payment(uuid, bigint, payment_method, text, timestamptz, text, text, allocation_order, boolean, boolean, uuid[], text) from anon;
revoke all on function public.rpc_reverse_payment(uuid, text) from anon;
revoke all on function public.rpc_apply_penalties(uuid, date, uuid) from anon;
revoke all on function public.rpc_waive_penalty(uuid, bigint, text) from anon;
revoke all on function public.rpc_enqueue_reminders(uuid, date) from anon;
revoke all on function public.rpc_mark_reminder(uuid, reminder_status, text) from anon;
revoke all on function public.rpc_dashboard_metrics(date, date, uuid) from anon;
revoke all on function public.rpc_payment_series(date, date, uuid) from anon;

grant execute on function public.fn_next_number(text, text, date, text, uuid) to authenticated;
grant execute on function public.rpc_submit_application(uuid, text) to authenticated;
grant execute on function public.rpc_decide_application(uuid, application_status, text, text) to authenticated;
grant execute on function public.rpc_cancel_application(uuid, text) to authenticated;
grant execute on function public.rpc_post_payment(uuid, bigint, payment_method, text, timestamptz, text, text, allocation_order, boolean, boolean, uuid[], text) to authenticated;
grant execute on function public.rpc_reverse_payment(uuid, text) to authenticated;
grant execute on function public.rpc_apply_penalties(uuid, date, uuid) to authenticated;
grant execute on function public.rpc_waive_penalty(uuid, bigint, text) to authenticated;
grant execute on function public.rpc_enqueue_reminders(uuid, date) to authenticated;
grant execute on function public.rpc_mark_reminder(uuid, reminder_status, text) to authenticated;
grant execute on function public.rpc_dashboard_metrics(date, date, uuid) to authenticated;
grant execute on function public.rpc_payment_series(date, date, uuid) to authenticated;
grant execute on function public.fn_touch_login() to authenticated;

-- =============================================================================
-- SELESAI — RLS
-- =============================================================================
