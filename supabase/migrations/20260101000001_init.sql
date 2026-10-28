-- =============================================================================
-- KreditKu — 20260101000001_init.sql
-- Skema dasar: ekstensi, tipe enum, tabel inti, index, dan infrastruktur audit.
--
-- Migrasi ini IDEMPOTEN: dapat dijalankan berulang tanpa merusak data
-- (create ... if not exists / drop ... if exists sebelum create policy/trigger).
--
-- Konvensi:
--   * Seluruh nominal uang disimpan sebagai BIGINT dalam satuan Rupiah bulat.
--   * Seluruh tanggal bisnis disimpan sebagai DATE (tanpa zona waktu).
--   * Seluruh timestamp audit disimpan sebagai TIMESTAMPTZ (UTC).
--   * Setiap tabel bisnis memiliki organization_id dan dilindungi RLS.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tipe enum
-- -----------------------------------------------------------------------------

do $$ begin
  create type member_role as enum ('SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'CASHIER', 'VIEWER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_status as enum ('PROSPECT', 'ACTIVE', 'DELINQUENT', 'PAID_OFF', 'BLOCKED', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interest_method as enum ('NONE', 'FLAT', 'ANNUITY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rate_basis as enum ('PER_MONTH', 'PER_YEAR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_frequency as enum ('MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admin_fee_position as enum ('UPFRONT', 'FIRST_INSTALLMENT', 'SPREAD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contract_status as enum ('ACTIVE', 'PAID_OFF', 'DELINQUENT', 'RESTRUCTURED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type installment_status as enum ('PENDING', 'DUE_TODAY', 'OVERDUE', 'PARTIAL', 'PAID', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('CASH', 'BANK_TRANSFER', 'QRIS', 'E_WALLET', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('POSTED', 'REVERSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type penalty_type as enum ('NONE', 'FIXED_PER_DAY', 'FIXED_PER_INSTALLMENT', 'PERCENT_PER_DAY', 'PERCENT_PER_MONTH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type penalty_status as enum ('OPEN', 'SETTLED', 'WAIVED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type penalty_percent_base as enum ('OUTSTANDING', 'TOTAL_DUE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_channel as enum ('WHATSAPP', 'EMAIL', 'IN_APP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_offset as enum ('D_MINUS_7', 'D_MINUS_3', 'D_MINUS_1', 'DUE_DATE', 'AFTER_DUE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_status as enum ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'APPLICATION_SUBMITTED',
    'APPLICATION_DECIDED',
    'INSTALLMENT_DUE',
    'PAYMENT_RECEIVED',
    'PAYMENT_FAILED',
    'CONTRACT_OVERDUE',
    'CONTRACT_AMENDED',
    'ADMIN_ACTIVITY'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type allocation_order as enum ('OLDEST_FIRST', 'NEWEST_FIRST', 'MANUAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type due_date_adjustment as enum ('NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum (
    'CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'RESTORE', 'APPROVE', 'REJECT', 'CANCEL',
    'POST_PAYMENT', 'REVERSE_PAYMENT', 'WAIVE_PENALTY', 'LOGIN', 'LOGOUT',
    'INVITE_USER', 'ACTIVATE_USER', 'DEACTIVATE_USER', 'SETTINGS_CHANGE', 'EXPORT'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Fungsi utilitas umum
-- -----------------------------------------------------------------------------

-- Diperlukan karena constraint unik memakai ekspresi lower(email).
create or replace function public.fn_normalize_email(p_email text) returns text
language sql immutable as $$
  select lower(trim(coalesce(p_email, '')));
$$;

-- Timestamp modifikasi otomatis.
create or replace function public.fn_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabel: organizations
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 2 and 160),
  code                text not null check (code ~ '^[A-Z0-9]{2,12}$'),
  logo_url            text,
  address             text,
  phone               text,
  email               text,
  currency            text not null default 'IDR' check (char_length(currency) = 3),
  timezone            text not null default 'Asia/Jakarta',
  locale              text not null default 'id-ID',
  is_active           boolean not null default true,
  settings            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);

create unique index if not exists uq_organizations_code on public.organizations (upper(code));

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: profiles (profil pengguna, terhubung ke auth.users)
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  email                   text not null,
  full_name               text not null default '',
  phone                   text,
  avatar_url              text,
  is_active               boolean not null default true,
  active_organization_id  uuid references public.organizations (id) on delete set null,
  last_login_at           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid
);

create unique index if not exists uq_profiles_email on public.profiles (public.fn_normalize_email(email));
create index if not exists idx_profiles_active_org on public.profiles (active_organization_id);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: organization_members
-- -----------------------------------------------------------------------------

create table if not exists public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             member_role not null default 'VIEWER',
  is_active        boolean not null default true,
  invited_by       uuid references public.profiles (id) on delete set null,
  invited_at       timestamptz,
  joined_at        timestamptz,
  notes            text,
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  constraint uq_org_member unique (organization_id, user_id)
);

create index if not exists idx_members_user on public.organization_members (user_id) where is_active;
create index if not exists idx_members_org on public.organization_members (organization_id) where is_active;

drop trigger if exists trg_members_updated_at on public.organization_members;
create trigger trg_members_updated_at before update on public.organization_members
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: customers
-- -----------------------------------------------------------------------------

create table if not exists public.customers (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  customer_number           text not null,
  full_name                 text not null check (char_length(trim(full_name)) between 2 and 120),
  identity_number           text,
  phone                     text not null check (phone ~ '^[+]?[0-9\s-]{8,20}$'),
  email                     text,
  address                   text,
  birth_date                date,
  occupation                text,
  monthly_income            bigint check (monthly_income is null or monthly_income >= 0),
  emergency_contact_name    text,
  emergency_contact_phone   text,
  notes                     text,
  status                    customer_status not null default 'PROSPECT',
  remind_enabled            boolean not null default true,
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references public.profiles (id) on delete set null,
  updated_by                uuid references public.profiles (id) on delete set null,
  constraint uq_customer_number unique (organization_id, customer_number)
);

create index if not exists idx_customers_org_status on public.customers (organization_id, status);
create index if not exists idx_customers_org_name on public.customers (organization_id, lower(full_name));
create index if not exists idx_customers_phone on public.customers (organization_id, phone);
create index if not exists idx_customers_created on public.customers (organization_id, created_at desc);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at before update on public.customers
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: credit_products (template produk kredit)
-- -----------------------------------------------------------------------------

create table if not exists public.credit_products (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  code                  text not null,
  name                  text not null,
  description           text,
  default_tenor         integer not null default 12 check (default_tenor between 1 and 600),
  default_method        interest_method not null default 'FLAT',
  default_rate_bp       numeric(12, 4) not null default 0 check (default_rate_bp >= 0 and default_rate_bp <= 10000),
  default_rate_basis    rate_basis not null default 'PER_MONTH',
  default_frequency     payment_frequency not null default 'MONTHLY',
  default_admin_fee     bigint not null default 0 check (default_admin_fee >= 0),
  min_down_payment_pct  numeric(5, 2) not null default 0 check (min_down_payment_pct between 0 and 100),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,
  constraint uq_product_code unique (organization_id, code)
);

drop trigger if exists trg_products_updated_at on public.credit_products;
create trigger trg_products_updated_at before update on public.credit_products
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: app_settings (satu baris per organisasi)
-- -----------------------------------------------------------------------------

create table if not exists public.app_settings (
  organization_id       uuid primary key references public.organizations (id) on delete cascade,
  numbering             jsonb not null default jsonb_build_object(
                          'customer', 'CUST-{YYYY}{MM}-{SEQ:5}',
                          'contract', 'CTR-{YYYY}-{SEQ:5}',
                          'receipt', 'KWT-{YYYYMMDD}-{SEQ:4}',
                          'application', 'APP-{YYYY}{MM}-{SEQ:5}',
                          'payment_reversal', 'RVS-{YYYYMMDD}-{SEQ:4}'
                        ),
  finance               jsonb not null default jsonb_build_object(
                          'default_interest_method', 'FLAT',
                          'default_rate_bp', 0,
                          'default_rate_basis', 'PER_MONTH',
                          'default_tenor', 12,
                          'default_admin_fee', 0,
                          'max_tenor', 60,
                          'min_down_payment_percent', 0,
                          'allow_overpayment', false,
                          'allocation_order', 'OLDEST_FIRST',
                          'penalty_first', false,
                          'require_separate_approver', true,
                          'due_date_adjustment', 'NONE',
                          'weekend_days', jsonb_build_array(0, 6),
                          'holidays', '[]'::jsonb,
                          'aging_bounds', jsonb_build_array(7, 30, 60, 90)
                        ),
  penalty               jsonb not null default jsonb_build_object(
                          'type', 'NONE',
                          'amount', 0,
                          'grace_days', 0,
                          'max_amount', null,
                          'percent_base', 'OUTSTANDING'
                        ),
  integrations          jsonb not null default jsonb_build_object(
                          'whatsapp_enabled', false,
                          'whatsapp_provider', 'WAHASENDER',
                          'email_enabled', false,
                          'reminder_offsets', jsonb_build_array('D_MINUS_3', 'DUE_DATE', 'AFTER_DUE'),
                          'reminder_channels', jsonb_build_array('IN_APP'),
                          'reminder_simulation_mode', true
                        ),
  ui                    jsonb not null default jsonb_build_object('theme', 'light', 'primary_color', 'indigo'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

drop trigger if exists trg_settings_updated_at on public.app_settings;
create trigger trg_settings_updated_at before update on public.app_settings
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: number_sequences (penomoran atomik per organisasi/periode)
-- -----------------------------------------------------------------------------

create table if not exists public.number_sequences (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null,
  period_key       text not null,
  last_value       bigint not null default 0 check (last_value >= 0),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, key, period_key)
);

-- -----------------------------------------------------------------------------
-- Tabel: credit_applications
-- -----------------------------------------------------------------------------

create table if not exists public.credit_applications (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  application_number    text not null,
  customer_id           uuid not null references public.customers (id) on delete restrict,
  product_id            uuid references public.credit_products (id) on delete set null,
  credit_type           text not null,
  price                 bigint not null check (price > 0),
  down_payment          bigint not null default 0 check (down_payment >= 0),
  principal             bigint not null check (principal > 0),
  tenor                 integer not null check (tenor between 1 and 600),
  method                interest_method not null default 'FLAT',
  rate_bp               numeric(12, 4) not null default 0 check (rate_bp >= 0 and rate_bp <= 10000),
  rate_basis            rate_basis not null default 'PER_MONTH',
  frequency             payment_frequency not null default 'MONTHLY',
  admin_fee             bigint not null default 0 check (admin_fee >= 0),
  admin_fee_position    admin_fee_position not null default 'UPFRONT',
  other_fee_per_period  bigint not null default 0 check (other_fee_per_period >= 0),
  disbursement_date     date,
  first_due_date        date not null,
  due_date_adjustment   due_date_adjustment not null default 'NONE',
  status                application_status not null default 'DRAFT',
  notes                 text,
  decision_reason       text,
  submitted_at          timestamptz,
  decided_at            timestamptz,
  decided_by            uuid references public.profiles (id) on delete set null,
  contract_id           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,
  constraint uq_application_number unique (organization_id, application_number),
  constraint chk_application_down_payment check (down_payment <= price),
  constraint chk_application_principal check (principal = price - down_payment),
  constraint chk_application_fees check (not (method = 'NONE' and rate_bp <> 0))
);

create index if not exists idx_applications_org_status on public.credit_applications (organization_id, status);
create index if not exists idx_applications_customer on public.credit_applications (customer_id, created_at desc);
create index if not exists idx_applications_created on public.credit_applications (organization_id, created_at desc);

drop trigger if exists trg_applications_updated_at on public.credit_applications;
create trigger trg_applications_updated_at before update on public.credit_applications
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: credit_application_status_history
-- -----------------------------------------------------------------------------

create table if not exists public.credit_application_status_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id  uuid not null references public.credit_applications (id) on delete cascade,
  from_status     application_status,
  to_status       application_status not null,
  note            text,
  changed_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_application_history on public.credit_application_status_history (application_id, created_at);

-- -----------------------------------------------------------------------------
-- Tabel: credit_application_documents
-- -----------------------------------------------------------------------------

create table if not exists public.credit_application_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id  uuid not null references public.credit_applications (id) on delete cascade,
  file_path       text not null,
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_application_documents on public.credit_application_documents (application_id);

-- -----------------------------------------------------------------------------
-- Tabel: credit_contracts
-- -----------------------------------------------------------------------------

create table if not exists public.credit_contracts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  contract_number       text not null,
  application_id        uuid unique references public.credit_applications (id) on delete set null,
  customer_id           uuid not null references public.customers (id) on delete restrict,
  contract_date         date not null default current_date,
  disbursement_date     date,
  price                 bigint not null check (price > 0),
  down_payment          bigint not null default 0 check (down_payment >= 0),
  principal             bigint not null check (principal > 0),
  tenor                 integer not null check (tenor between 1 and 600),
  method                interest_method not null,
  rate_bp               numeric(12, 4) not null default 0 check (rate_bp >= 0 and rate_bp <= 10000),
  rate_basis            rate_basis not null,
  frequency             payment_frequency not null,
  admin_fee             bigint not null default 0 check (admin_fee >= 0),
  admin_fee_position    admin_fee_position not null default 'UPFRONT',
  other_fee_per_period  bigint not null default 0 check (other_fee_per_period >= 0),
  upfront_amount        bigint not null default 0 check (upfront_amount >= 0),
  total_interest        bigint not null default 0 check (total_interest >= 0),
  total_fees            bigint not null default 0 check (total_fees >= 0),
  total_payable         bigint not null default 0 check (total_payable >= 0),
  total_paid            bigint not null default 0 check (total_paid >= 0),
  outstanding           bigint not null default 0 check (outstanding >= 0),
  first_due_date        date not null,
  next_due_date         date,
  due_date_adjustment   due_date_adjustment not null default 'NONE',
  status                contract_status not null default 'ACTIVE',
  last_payment_date     date,
  restructured_at       timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  notes                 text,
  snapshot              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,
  constraint uq_contract_number unique (organization_id, contract_number),
  constraint chk_contract_principal check (principal = price - down_payment),
  constraint chk_contract_total_payable check (total_payable = principal + total_interest + total_fees)
);

create index if not exists idx_contracts_org_status on public.credit_contracts (organization_id, status);
create index if not exists idx_contracts_customer on public.credit_contracts (customer_id, created_at desc);
create index if not exists idx_contracts_next_due on public.credit_contracts (organization_id, next_due_date) where status <> 'PAID_OFF';
create index if not exists idx_contracts_disbursement on public.credit_contracts (organization_id, disbursement_date);

drop trigger if exists trg_contracts_updated_at on public.credit_contracts;
create trigger trg_contracts_updated_at before update on public.credit_contracts
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: credit_contract_amendments
-- -----------------------------------------------------------------------------

create table if not exists public.credit_contract_amendments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contract_id      uuid not null references public.credit_contracts (id) on delete restrict,
  reason           text not null check (char_length(trim(reason)) >= 10),
  before_snapshot  jsonb not null,
  after_snapshot   jsonb not null,
  effective_from   date not null,
  schedule_rebuilt boolean not null default false,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_amendments_contract on public.credit_contract_amendments (contract_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tabel: installments
-- -----------------------------------------------------------------------------

create table if not exists public.installments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  contract_id         uuid not null references public.credit_contracts (id) on delete cascade,
  installment_number  integer not null check (installment_number > 0),
  base_due_date       date not null,
  due_date            date not null,
  principal           bigint not null check (principal >= 0),
  interest            bigint not null default 0 check (interest >= 0),
  fees                bigint not null default 0 check (fees >= 0),
  total_due           bigint not null check (total_due >= 0),
  paid_amount         bigint not null default 0 check (paid_amount >= 0),
  penalty_paid_amount bigint not null default 0 check (penalty_paid_amount >= 0),
  status              installment_status not null default 'PENDING',
  last_payment_date   date,
  notes               text,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_installment_number unique (contract_id, installment_number),
  constraint chk_installment_total check (total_due = principal + interest + fees)
);

create index if not exists idx_installments_due on public.installments (organization_id, due_date) where status <> 'CANCELLED';
create index if not exists idx_installments_contract on public.installments (contract_id, installment_number);
create index if not exists idx_installments_unpaid on public.installments (organization_id, due_date)
  where status not in ('PAID', 'CANCELLED');

drop trigger if exists trg_installments_updated_at on public.installments;
create trigger trg_installments_updated_at before update on public.installments
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: payments
-- -----------------------------------------------------------------------------

create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  contract_id      uuid not null references public.credit_contracts (id) on delete restrict,
  receipt_number   text not null,
  amount           bigint not null check (amount > 0),
  method           payment_method not null,
  paid_at          timestamptz not null default now(),
  paid_date        date not null default current_date,
  reference        text,
  notes            text,
  proof_path       text,
  status           payment_status not null default 'POSTED',
  idempotency_key  text not null check (char_length(idempotency_key) between 16 and 128),
  penalty_first    boolean not null default false,
  allocation_order allocation_order not null default 'OLDEST_FIRST',
  unallocated      bigint not null default 0 check (unallocated >= 0),
  reversed_at      timestamptz,
  reversed_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  constraint uq_receipt_number unique (organization_id, receipt_number),
  constraint uq_payment_idempotency unique (organization_id, idempotency_key)
);

create index if not exists idx_payments_contract on public.payments (contract_id, paid_at desc);
create index if not exists idx_payments_date on public.payments (organization_id, paid_date desc);
create index if not exists idx_payments_status on public.payments (organization_id, status);
create index if not exists idx_payments_officer on public.payments (organization_id, created_by, paid_date desc);

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at before update on public.payments
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: payment_allocations
-- -----------------------------------------------------------------------------

create table if not exists public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  payment_id      uuid not null references public.payments (id) on delete restrict,
  installment_id  uuid not null references public.installments (id) on delete restrict,
  amount          bigint not null default 0 check (amount >= 0),
  penalty_amount  bigint not null default 0 check (penalty_amount >= 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  constraint uq_allocation unique (payment_id, installment_id),
  constraint chk_allocation_total check (amount + penalty_amount > 0)
);

create index if not exists idx_allocations_payment on public.payment_allocations (payment_id);
create index if not exists idx_allocations_installment on public.payment_allocations (installment_id);

-- -----------------------------------------------------------------------------
-- Tabel: payment_reversals
-- -----------------------------------------------------------------------------

create table if not exists public.payment_reversals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  payment_id      uuid not null unique references public.payments (id) on delete restrict,
  reversal_number text not null,
  amount          bigint not null check (amount > 0),
  reason          text not null check (char_length(trim(reason)) >= 5),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint uq_reversal_number unique (organization_id, reversal_number)
);

-- -----------------------------------------------------------------------------
-- Tabel: penalties
-- -----------------------------------------------------------------------------

create table if not exists public.penalties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  contract_id      uuid not null references public.credit_contracts (id) on delete cascade,
  installment_id   uuid not null unique references public.installments (id) on delete cascade,
  rule_snapshot    jsonb not null default '{}'::jsonb,
  amount           bigint not null default 0 check (amount >= 0),
  paid_amount      bigint not null default 0 check (paid_amount >= 0),
  waived_amount    bigint not null default 0 check (waived_amount >= 0),
  late_days        integer not null default 0 check (late_days >= 0),
  chargeable_days  integer not null default 0 check (chargeable_days >= 0),
  status           penalty_status not null default 'OPEN',
  calculated_at    date not null default current_date,
  waived_reason    text,
  waived_by        uuid references public.profiles (id) on delete set null,
  waived_at        timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_penalty_paid check (paid_amount + waived_amount <= amount)
);

create index if not exists idx_penalties_open on public.penalties (organization_id, status) where status = 'OPEN';
create index if not exists idx_penalties_contract on public.penalties (contract_id);

drop trigger if exists trg_penalties_updated_at on public.penalties;
create trigger trg_penalties_updated_at before update on public.penalties
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: reminder_templates
-- -----------------------------------------------------------------------------

create table if not exists public.reminder_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offset_key      reminder_offset not null,
  channel         reminder_channel not null,
  subject         text,
  body            text not null check (char_length(body) >= 10),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  constraint uq_reminder_template unique (organization_id, offset_key, channel)
);

drop trigger if exists trg_reminder_templates_updated_at on public.reminder_templates;
create trigger trg_reminder_templates_updated_at before update on public.reminder_templates
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: reminders (antrean pengingat, satu baris per cicilan+offset+kanal)
-- -----------------------------------------------------------------------------

create table if not exists public.reminders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id     uuid not null references public.credit_contracts (id) on delete cascade,
  installment_id  uuid not null references public.installments (id) on delete cascade,
  customer_id     uuid not null references public.customers (id) on delete cascade,
  offset_key      reminder_offset not null,
  channel         reminder_channel not null,
  scheduled_for   date not null,
  status          reminder_status not null default 'PENDING',
  attempts        integer not null default 0 check (attempts >= 0),
  sent_at         timestamptz,
  last_error      text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_reminder_dedup unique (installment_id, offset_key, channel)
);

create index if not exists idx_reminders_pending on public.reminders (organization_id, scheduled_for) where status = 'PENDING';
create index if not exists idx_reminders_contract on public.reminders (contract_id);

drop trigger if exists trg_reminders_updated_at on public.reminders;
create trigger trg_reminders_updated_at before update on public.reminders
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabel: notifications
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete cascade,
  type            notification_type not null,
  title           text not null,
  body            text,
  link            text,
  entity_type     text,
  entity_id       uuid,
  is_read         boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications (user_id, is_read, created_at desc);
create index if not exists idx_notifications_org on public.notifications (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tabel: audit_logs
-- -----------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_email     text,
  action          audit_action not null,
  entity_type     text not null,
  entity_id       uuid,
  summary         text,
  before_data     jsonb,
  after_data      jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_org_created on public.audit_logs (organization_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_actor on public.audit_logs (actor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tabel: document_templates
-- -----------------------------------------------------------------------------

create table if not exists public.document_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            text not null check (kind in ('CONTRACT', 'RECEIPT', 'REMINDER', 'STATEMENT')),
  name            text not null,
  body            text not null,
  version         integer not null default 1 check (version > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null,
  constraint uq_document_template unique (organization_id, kind, name, version)
);

drop trigger if exists trg_document_templates_updated_at on public.document_templates;
create trigger trg_document_templates_updated_at before update on public.document_templates
  for each row execute function public.fn_set_updated_at();

-- =============================================================================
-- SELESAI — tabel inti
-- =============================================================================
