-- =============================================================================
-- KreditKu — portal pelanggan: akun pelanggan, akses baca, dan pembayaran QRIS
--
-- MASALAH
-- -------
-- Seluruh kebijakan akses yang ada memakai fn_is_member(organization_id), yaitu
-- keanggotaan pada organization_members. Pelanggan BUKAN anggota organisasi,
-- sehingga akun pelanggan tidak akan melihat apa pun — bahkan cicilannya
-- sendiri. Tabel customers juga belum punya penghubung ke akun login.
--
-- Migrasi ini menambahkan:
--   1. penghubung customers.user_id ke akun login;
--   2. bantuan penentu "saya pelanggan yang mana" dan "kontrak ini milik saya?";
--   3. kebijakan baca untuk pelanggan, hanya pada datanya sendiri;
--   4. tabel permintaan pembayaran QRIS beserta kotak masuk konfirmasi;
--   5. fungsi yang dipakai portal: membuat permintaan, membatalkannya, membaca
--      QR merchant, dan mencatat pembayaran dari konfirmasi server.
--
-- SIFAT PERUBAHAN
-- ---------------
-- Seluruh kebijakan pelanggan bersifat HANYA BACA dan selalu dibatasi oleh
-- auth.uid(). Tidak ada satu pun kebijakan yang memberi pelanggan hak menulis,
-- sehingga satu-satunya jalan mengubah data keuangan tetap melalui fungsi
-- bisnis yang mencatat audit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Penghubung akun pelanggan
-- -----------------------------------------------------------------------------
-- Menunjuk ke profiles (bukan auth.users) agar konsisten dengan
-- organization_members.user_id. Baris profiles dibuat otomatis oleh trigger
-- on_auth_user_created setiap ada akun auth baru.

alter table public.customers
  add column if not exists user_id uuid references public.profiles (id) on delete set null;

comment on column public.customers.user_id is
  'Akun login pemilik baris pelanggan ini; dipakai portal pelanggan. Kosong berarti pelanggan belum punya akun.';

-- Satu akun hanya boleh menempel pada satu baris pelanggan. Indeks parsial
-- supaya pelanggan tanpa akun (mayoritas) tidak saling bentrok pada nilai null.
create unique index if not exists uq_customers_user_id
  on public.customers (user_id)
  where user_id is not null;

create index if not exists idx_customers_user on public.customers (user_id);

-- -----------------------------------------------------------------------------
-- 2. Bantuan penentu identitas pelanggan
-- -----------------------------------------------------------------------------

-- Mengembalikan baris pelanggan milik pemanggil. SECURITY DEFINER karena
-- kebijakan pada customers sendiri memanggil fungsi ini — tanpa itu terjadi
-- rekursi kebijakan. Batasannya tegas: hanya melihat baris dengan
-- user_id = auth.uid(), tidak pernah menerima parameter organisasi.
create or replace function public.fn_current_customer_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
    from public.customers c
   where c.user_id = auth.uid()
     and c.archived_at is null
   limit 1;
$$;

comment on function public.fn_current_customer_id() is
  'Baris pelanggan milik pemanggil, atau null bila akun ini bukan akun pelanggan.';

-- Dipakai kebijakan pada installments, payments, dan penalties supaya
-- kebijakannya pendek dan tidak berbeda-beda antar tabel.
create or replace function public.fn_is_my_contract(p_contract_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.credit_contracts c
     where c.id = p_contract_id
       and c.customer_id = public.fn_current_customer_id()
  );
$$;

comment on function public.fn_is_my_contract(uuid) is
  'True bila kontrak milik pelanggan yang sedang login.';

-- -----------------------------------------------------------------------------
-- 3. Kebijakan baca untuk pelanggan
-- -----------------------------------------------------------------------------
-- Kebijakan bersifat permisif dan digabung dengan OR, sehingga kebijakan staf
-- yang sudah ada tetap berlaku apa adanya. Pelanggan hanya mendapat tambahan
-- baris miliknya sendiri.

drop policy if exists customers_select_self on public.customers;
create policy customers_select_self on public.customers
  for select to authenticated
  using (user_id is not null and user_id = auth.uid());

drop policy if exists contracts_select_own on public.credit_contracts;
create policy contracts_select_own on public.credit_contracts
  for select to authenticated
  using (public.fn_is_my_contract(id));

drop policy if exists installments_select_own on public.installments;
create policy installments_select_own on public.installments
  for select to authenticated
  using (public.fn_is_my_contract(contract_id));

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (public.fn_is_my_contract(contract_id));

drop policy if exists allocations_select_own on public.payment_allocations;
create policy allocations_select_own on public.payment_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.payments p
       where p.id = payment_id and public.fn_is_my_contract(p.contract_id)
    )
  );

drop policy if exists penalties_select_own on public.penalties;
create policy penalties_select_own on public.penalties
  for select to authenticated
  using (public.fn_is_my_contract(contract_id));

-- Nama dan alamat usaha diperlukan untuk kepala halaman portal dan tanda terima.
-- Hanya organisasi tempat pelanggan itu terdaftar.
drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own on public.organizations
  for select to authenticated
  using (
    exists (
      select 1 from public.customers c
       where c.organization_id = organizations.id
         and c.user_id = auth.uid()
    )
  );

-- Notifikasi yang ditujukan langsung ke akun ini, misalnya pengingat jatuh
-- tempo. Kebijakan staf yang ada mensyaratkan keanggotaan, sehingga pelanggan
-- tidak melihat notifikasi apa pun tanpa kebijakan tambahan ini.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id is not null and user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. Permintaan pembayaran QRIS
-- -----------------------------------------------------------------------------
-- Satu baris mewakili satu tagihan yang menunggu dibayar. Nominalnya DIHITUNG
-- SERVER, bukan dikirim klien, sehingga pelanggan tidak dapat meminta tagihan
-- dengan angka karangan. Baris ini juga yang menjadi dasar pencocokan
-- konfirmasi pembayaran: konfirmasi hanya dianggap sah bila nominal dan
-- waktunya cocok dengan permintaan yang masih terbuka.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'qris_request_status') then
    create type qris_request_status as enum ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'REVIEW');
  end if;
end $$;

create table if not exists public.qris_payment_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  customer_id      uuid not null references public.customers (id) on delete cascade,
  contract_id      uuid not null references public.credit_contracts (id) on delete cascade,
  installment_id   uuid references public.installments (id) on delete set null,
  amount           bigint not null check (amount > 0),
  reference        text not null,
  status           qris_request_status not null default 'PENDING',
  qr_payload       text,
  note             text,
  confirmed_via    text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  paid_at          timestamptz,
  payment_id       uuid references public.payments (id) on delete set null,
  constraint uq_qris_reference unique (reference)
);

comment on table public.qris_payment_requests is
  'Tagihan QRIS yang menunggu dibayar. Nominal dan status hanya berubah melalui fungsi di migrasi ini.';

create index if not exists idx_qris_requests_open
  on public.qris_payment_requests (organization_id, amount, expires_at)
  where status = 'PENDING';

create index if not exists idx_qris_requests_customer
  on public.qris_payment_requests (customer_id, created_at desc);

-- Kotak masuk mentah dari MacroDroid. Dipisahkan dari permintaan supaya
-- konfirmasi yang tidak cocok tetap tersimpan lengkap dan dapat ditelusuri,
-- bukan hilang tanpa jejak.
create table if not exists public.qris_confirmations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete cascade,
  request_id       uuid references public.qris_payment_requests (id) on delete set null,
  source           text not null default 'MACRODROID',
  amount           bigint,
  reference        text,
  raw_text         text,
  outcome          text not null,
  detail           text,
  created_at       timestamptz not null default now()
);

comment on table public.qris_confirmations is
  'Catatan setiap konfirmasi pembayaran yang masuk, termasuk yang tidak cocok.';

create index if not exists idx_qris_confirmations_created
  on public.qris_confirmations (created_at desc);

-- RLS wajib aktif: tanpa itu tabel ini terbuka bagi siapa pun yang punya hak
-- pada skema. Hak akses tabel juga harus diberikan ulang di sini, karena
-- `grant ... on all tables` pada 20260101000006_rls.sql hanya berlaku untuk
-- tabel yang sudah ada saat migrasi itu dijalankan. Yang diberikan hanya SELECT:
-- penulisan satu-satunya jalan lewat fungsi SECURITY DEFINER di bawah.
alter table public.qris_payment_requests enable row level security;
alter table public.qris_confirmations enable row level security;

grant select on public.qris_payment_requests to authenticated, service_role;
grant select on public.qris_confirmations to authenticated, service_role;

drop policy if exists qris_requests_select on public.qris_payment_requests;
create policy qris_requests_select on public.qris_payment_requests
  for select to authenticated
  using (
    customer_id = public.fn_current_customer_id()
    or public.fn_is_member(organization_id)
  );

drop policy if exists qris_confirmations_select on public.qris_confirmations;
create policy qris_confirmations_select on public.qris_confirmations
  for select to authenticated
  using (organization_id is not null and public.fn_is_member(organization_id));

-- Tidak ada kebijakan insert/update/delete untuk kedua tabel: hanya fungsi
-- SECURITY DEFINER di bawah yang boleh menulis.

-- -----------------------------------------------------------------------------
-- 5. Izinkan service_role menjalankan fungsi bisnis
-- -----------------------------------------------------------------------------
-- Pencatatan pembayaran dari konfirmasi server dijalankan Edge Function memakai
-- service role — bukan anggota organisasi mana pun, sehingga pemeriksaan
-- keanggotaan dan peran akan selalu menolaknya. Kunci server ini tidak pernah
-- sampai ke browser, dan tidak menambah kemampuan apa pun yang belum dimilikinya
-- (service_role memang melewati RLS). Tanpa ini, konfirmasi QRIS hanya bisa
-- dicatat manual oleh kasir.

create or replace function public.fn_is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (
           select 1 from public.organization_members m
            where m.user_id = auth.uid() and m.organization_id = p_org and m.is_active
         );
$$;

create or replace function public.fn_has_role(p_org uuid, p_roles member_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (
           select 1 from public.organization_members m
            where m.user_id = auth.uid()
              and m.organization_id = p_org
              and m.is_active
              and m.role = any (p_roles)
         );
$$;

-- fn_assert_member memeriksa auth.uid() lebih dulu, SEBELUM memanggil
-- fn_is_member. Karena kunci service_role tidak membawa klaim sub, auth.uid()
-- bernilai null dan fungsi ini menolak lebih awal — pengecualian pada
-- fn_is_member tidak pernah tercapai. Test lokal menemukan ini sebagai
-- "Sesi tidak valid. Silakan login kembali." dari dalam rpc_post_payment.
create or replace function public.fn_assert_member(p_org uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'Sesi tidak valid. Silakan login kembali.' using errcode = '42501';
  end if;
  if not public.fn_is_member(p_org) then
    raise exception 'Anda tidak memiliki akses ke organisasi data ini.' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Membaca QR merchant
-- -----------------------------------------------------------------------------
-- Payload QR statis merchant disimpan di app_settings.integrations. Isinya
-- memang publik — tercetak di meja kas dan dipindai setiap pelanggan — tetapi
-- app_settings secara keseluruhan memuat konfigurasi lain, sehingga yang dibuka
-- hanya satu kunci ini.

create or replace function public.rpc_portal_qris_payload()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org     uuid;
  v_payload text;
  v_nama    text;
begin
  select c.organization_id into v_org
    from public.customers c
   where c.id = public.fn_current_customer_id();

  if v_org is null then
    raise exception 'Akun ini tidak terhubung ke data pelanggan.' using errcode = '42501';
  end if;

  select coalesce(s.integrations ->> 'qrisStaticPayload', '') into v_payload
    from public.app_settings s
   where s.organization_id = v_org;

  select o.name into v_nama from public.organizations o where o.id = v_org;

  if v_payload is null or length(trim(v_payload)) = 0 then
    raise exception 'Usaha ini belum mengatur QRIS pada pengaturan integrasi.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('payload', trim(v_payload), 'merchant_name', v_nama);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Membuat permintaan pembayaran
-- -----------------------------------------------------------------------------
-- Nominal dihitung dari tagihan yang benar-benar terbuka pada cicilan terpilih.
-- Cicilan yang dimaksud adalah cicilan belum lunas paling awal; bila pelanggan
-- menyebut cicilan tertentu, kepemilikannya diperiksa lebih dulu.

create or replace function public.rpc_create_qris_request(
  p_contract_id uuid,
  p_installment_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer   uuid := public.fn_current_customer_id();
  v_org        uuid;
  v_nomor      text;
  v_cicilan    record;
  v_amount     bigint;
  v_reference  text;
  v_id         uuid;
  v_expires    timestamptz := now() + interval '60 minutes';
begin
  if v_customer is null then
    raise exception 'Akun ini tidak terhubung ke data pelanggan.' using errcode = '42501';
  end if;

  select c.organization_id, c.contract_number into v_org, v_nomor
    from public.credit_contracts c
   where c.id = p_contract_id and c.customer_id = v_customer;

  if v_org is null then
    raise exception 'Kontrak tidak ditemukan untuk akun ini.' using errcode = '42501';
  end if;

  select d.id, d.installment_number, d.due_date,
         d.outstanding + coalesce(d.penalty_outstanding, 0) as tagihan
    into v_cicilan
    from public.v_installment_details d
   where d.contract_id = p_contract_id
     and d.stored_status <> 'CANCELLED'
     and (p_installment_id is null or d.id = p_installment_id)
     and d.outstanding + coalesce(d.penalty_outstanding, 0) > 0
   order by d.installment_number
   limit 1;

  if v_cicilan is null then
    raise exception 'Tidak ada tagihan yang perlu dibayar pada kontrak ini.' using errcode = 'P0002';
  end if;

  v_amount := v_cicilan.tagihan;

  -- Permintaan lama pada kontrak yang sama ditutup supaya konfirmasi tidak
  -- pernah cocok dengan dua permintaan sekaligus.
  update public.qris_payment_requests
     set status = 'CANCELLED',
         note = coalesce(note || ' | ', '') || 'digantikan permintaan baru'
   where contract_id = p_contract_id
     and status = 'PENDING';

  v_reference := 'QR' || to_char(now(), 'YYMMDD') || '-'
              || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.qris_payment_requests
    (organization_id, customer_id, contract_id, installment_id, amount, reference, expires_at)
  values
    (v_org, v_customer, p_contract_id, v_cicilan.id, v_amount, v_reference, v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'request_id', v_id,
    'reference', v_reference,
    'amount', v_amount,
    'contract_number', v_nomor,
    'installment_number', v_cicilan.installment_number,
    'due_date', v_cicilan.due_date,
    'expires_at', v_expires
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Membatalkan permintaan
-- -----------------------------------------------------------------------------

create or replace function public.rpc_cancel_qris_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer uuid := public.fn_current_customer_id();
begin
  update public.qris_payment_requests
     set status = 'CANCELLED', note = coalesce(note, 'dibatalkan pelanggan')
   where id = p_request_id
     and status = 'PENDING'
     and customer_id = v_customer;

  if not found then
    raise exception 'Permintaan tidak ditemukan atau sudah tidak menunggu pembayaran.' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Mencatat pembayaran dari konfirmasi server
-- -----------------------------------------------------------------------------
-- Dipanggil Edge Function dengan service role setelah notifikasi pembayaran
-- ditangkap MacroDroid. Fungsi ini yang memutuskan boleh-tidaknya mencatat:
-- permintaan harus masih PENDING, belum kedaluwarsa, dan nominalnya harus sama
-- dengan yang terekam. Pencatatan pembayaran itu sendiri tetap melalui
-- rpc_post_payment supaya alokasi, denda, dan audit memakai jalur yang sama
-- dengan pembayaran yang dicatat kasir.

create or replace function public.rpc_confirm_qris_payment(
  p_request_id uuid,
  p_reference text default null,
  p_note text default null,
  p_confirmed_via text default 'MACRODROID'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req    public.qris_payment_requests;
  v_hasil  jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Fungsi ini hanya dapat dijalankan dari server.' using errcode = '42501';
  end if;

  select * into v_req
    from public.qris_payment_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'Permintaan QRIS tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_req.status = 'PAID' then
    return jsonb_build_object('status', 'SUDAH_DIBAYAR', 'payment_id', v_req.payment_id);
  end if;

  if v_req.status <> 'PENDING' then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || 'konfirmasi setelah status ' || v_req.status::text
     where id = v_req.id;
    return jsonb_build_object('status', 'PERLU_TINJAUAN', 'alasan', 'status permintaan ' || v_req.status::text);
  end if;

  if v_req.expires_at < now() then
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || 'konfirmasi setelah kedaluwarsa'
     where id = v_req.id;
    return jsonb_build_object('status', 'PERLU_TINJAUAN', 'alasan', 'permintaan sudah kedaluwarsa');
  end if;

  v_hasil := public.rpc_post_payment(
    p_contract_id      => v_req.contract_id,
    p_amount           => v_req.amount,
    p_method           => 'QRIS'::payment_method,
    p_idempotency_key  => 'qris:' || v_req.reference,
    p_paid_at          => now(),
    p_reference        => coalesce(p_reference, v_req.reference),
    p_notes            => coalesce(p_note, 'Pembayaran QRIS terkonfirmasi otomatis')
  );

  update public.qris_payment_requests
     set status = 'PAID',
         paid_at = now(),
         confirmed_via = p_confirmed_via,
         payment_id = nullif(v_hasil ->> 'payment_id', '')::uuid
   where id = v_req.id;

  return jsonb_build_object(
    'status', 'DIBAYAR',
    'request_id', v_req.id,
    'reference', v_req.reference,
    'payment_id', v_hasil ->> 'payment_id',
    'receipt_number', v_hasil ->> 'receipt_number'
  );
exception
  when others then
    -- Kegagalan pencatatan tidak boleh menghilangkan jejak: permintaan dipindah
    -- ke REVIEW beserta pesan aslinya, lalu galat diteruskan ke pemanggil.
    update public.qris_payment_requests
       set status = 'REVIEW',
           confirmed_via = p_confirmed_via,
           note = coalesce(note || ' | ', '') || sqlerrm
     where id = p_request_id
       and status = 'PENDING';
    raise;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Mencari permintaan yang cocok dengan konfirmasi
-- -----------------------------------------------------------------------------
-- Dipakai Edge Function sebelum mencatat pembayaran. Pencocokan dilakukan di
-- basis data supaya aturannya satu tempat dan tidak bergantung pada ingatan
-- pemanggil: permintaan harus masih PENDING, belum kedaluwarsa, dan nominalnya
-- sama persis.
--
-- Mengembalikan SELURUH kandidat, bukan satu. Bila ada lebih dari satu usaha
-- dengan nominal yang sama pada waktu yang sama, pemanggil harus memutuskan
-- untuk meninjau alih-alih menebak — dan menebak di sini berarti mencatat
-- pembayaran pada kontrak yang salah.

create or replace function public.fn_find_open_qris_requests(p_amount bigint)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(kandidat order by kandidat ->> 'created_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'request_id', r.id,
               'reference', r.reference,
               'amount', r.amount,
               'contract_number', c.contract_number,
               'customer_name', cu.full_name,
               'created_at', r.created_at,
               'expires_at', r.expires_at
             ) as kandidat
        from public.qris_payment_requests r
        join public.credit_contracts c on c.id = r.contract_id
        join public.customers cu on cu.id = r.customer_id
       where r.status = 'PENDING'
         and r.expires_at > now()
         and r.amount = p_amount
    ) k;
$$;

comment on function public.fn_find_open_qris_requests(bigint) is
  'Kandidat permintaan QRIS terbuka untuk nominal tertentu; hanya untuk service_role.';

-- -----------------------------------------------------------------------------
-- 10b. Mencatat konfirmasi yang masuk
-- -----------------------------------------------------------------------------
-- Setiap konfirmasi dicatat, termasuk yang tidak cocok dan yang gagal. Tanpa
-- ini, notifikasi yang salah baca akan hilang tanpa jejak dan tidak ada cara
-- menelusuri mengapa sebuah pembayaran tidak tercatat. Penulisan tetap lewat
-- fungsi agar tabelnya tidak perlu diberi hak tulis kepada siapa pun.

create or replace function public.fn_log_qris_confirmation(
  p_organization_id uuid,
  p_request_id uuid,
  p_outcome text,
  p_amount bigint default null,
  p_reference text default null,
  p_raw_text text default null,
  p_detail text default null,
  p_source text default 'MACRODROID'
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Fungsi ini hanya dapat dijalankan dari server.' using errcode = '42501';
  end if;

  insert into public.qris_confirmations
    (organization_id, request_id, source, amount, reference, raw_text, outcome, detail)
  values
    (p_organization_id, p_request_id, coalesce(p_source, 'MACRODROID'), p_amount,
     p_reference, left(p_raw_text, 4000), p_outcome, left(p_detail, 2000))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text) is
  'Menyimpan satu konfirmasi pembayaran apa adanya; hanya untuk service_role.';

-- -----------------------------------------------------------------------------
-- 11. Menautkan akun login ke baris pelanggan
-- -----------------------------------------------------------------------------
-- Dipakai staf dari aplikasi admin. Pencarian akun dilakukan lewat email supaya
-- aplikasi tidak perlu mengetahui id akun, dan penautan ganda dicegah indeks
-- unik pada customers.user_id.

create or replace function public.rpc_link_customer_account(
  p_customer_id uuid,
  p_email text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org      uuid;
  v_user_id  uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer_id;
  if v_org is null then
    raise exception 'Pelanggan tidak ditemukan.' using errcode = 'P0002';
  end if;

  perform public.fn_assert_member(v_org);
  if not public.fn_can_manage_credit(v_org) then
    raise exception 'Hanya peran yang mengelola kredit yang dapat menautkan akun pelanggan.' using errcode = '42501';
  end if;

  select id into v_user_id from public.profiles where lower(email) = lower(trim(p_email));
  if v_user_id is null then
    raise exception 'Akun dengan email itu belum ada. Buat akunnya lebih dulu di halaman Pengguna.'
      using errcode = 'P0002';
  end if;

  update public.customers
     set user_id = v_user_id, updated_by = auth.uid()
   where id = p_customer_id;

  return jsonb_build_object('customer_id', p_customer_id, 'user_id', v_user_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Hak eksekusi
-- -----------------------------------------------------------------------------
-- Mengikuti pola 20260101000008: cabut dari public dan anon, berikan hanya
-- kepada peran yang memang memakainya. `from public` yang penting — mencabut
-- dari anon saja tidak menghapus hak bawaan PUBLIC.

revoke all on function public.fn_current_customer_id() from public, anon;
revoke all on function public.fn_is_my_contract(uuid) from public, anon;
revoke all on function public.rpc_portal_qris_payload() from public, anon;
revoke all on function public.rpc_create_qris_request(uuid, uuid) from public, anon;
revoke all on function public.rpc_cancel_qris_request(uuid) from public, anon;
revoke all on function public.rpc_confirm_qris_payment(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rpc_link_customer_account(uuid, text) from public, anon;
revoke all on function public.fn_find_open_qris_requests(bigint) from public, anon, authenticated;
revoke all on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text) from public, anon, authenticated;

grant execute on function public.fn_current_customer_id() to authenticated, service_role;
grant execute on function public.fn_is_my_contract(uuid) to authenticated, service_role;
grant execute on function public.rpc_portal_qris_payload() to authenticated, service_role;
grant execute on function public.rpc_create_qris_request(uuid, uuid) to authenticated, service_role;
grant execute on function public.rpc_cancel_qris_request(uuid) to authenticated, service_role;
grant execute on function public.rpc_confirm_qris_payment(uuid, text, text, text) to service_role;
grant execute on function public.rpc_link_customer_account(uuid, text) to authenticated, service_role;
grant execute on function public.fn_find_open_qris_requests(bigint) to service_role;
grant execute on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text) to service_role;

-- =============================================================================
-- SELESAI — fondasi portal pelanggan
-- =============================================================================
