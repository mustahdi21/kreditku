-- =============================================================================
-- local-supabase-shim.sql — PERKAKAS UJI LOKAL SAJA.
--
-- Membuat tiruan минимальную bagian dari lingkungan Supabase (skema `auth`,
-- peran `anon`/`authenticated`/`service_role`, dan fungsi `auth.uid()`) agar
-- migrasi KreditKu dapat dijalankan dan diuji pada PostgreSQL biasa tanpa
-- proyek Supabase.
--
-- JANGAN dijalankan pada proyek Supabase sungguhan: objek `auth.*` sudah
-- disediakan oleh platform dan tidak boleh ditimpa.
--
-- Pemakaian:
--   psql "$LOCAL_DB_URL" -f scripts/local-supabase-shim.sql
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists auth;

do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists auth.identities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  provider_id      text,
  identity_data    jsonb not null default '{}'::jsonb,
  provider         text not null default 'email',
  last_sign_in_at  timestamptz default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Tiruan auth.uid(): membaca klaim sub dari pengaturan sesi, sama seperti Supabase.
create or replace function auth.uid()
returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Tiruan auth.role() untuk kelengkapan.
create or replace function auth.role()
returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant select on auth.identities to authenticated, service_role;

grant anon, authenticated, service_role to current_user;
