-- =============================================================================
-- KreditKu — perbaikan alur permintaan QRIS sebelum konfirmasi otomatis
--
-- TANPA KODE UNIK
-- ---------------
-- Nominal permintaan tetap SAMA PERSIS dengan tagihan cicilan. Konsekuensinya
-- harus diterima dengan sadar: bila dua pelanggan memiliki tagihan bernominal
-- sama, notifikasi pembayaran TIDAK dapat dipastikan milik siapa. Karena itu
-- pencocokan yang menghasilkan lebih dari satu kandidat tidak pernah dicatat
-- otomatis — dipindah ke tinjauan. Menebak di sini berarti mencatat pembayaran
-- pada kontrak orang lain.
--
-- Migrasi ini menambahkan tiga hal dari pola project ethereal-wa, dan dua
-- perbaikan atas rancangan sebelumnya:
--
--   1. content_hash pada kotak masuk konfirmasi, sebagai penjaga anti-duplikat
--      di tingkat basis data (pola payment-notification di ethereal-wa).
--   2. Masa berlaku permintaan menjadi 24 jam, dari sebelumnya 60 menit.
--      Satu jam terlalu pendek untuk pelanggan yang harus keluar rumah.
--   3. Permintaan yang sama tidak dibuat berulang: bila permintaan untuk
--      cicilan yang sama masih menunggu dan nominalnya belum berubah,
--      permintaan itulah yang dikembalikan.
--   4. Pembatalan permintaan lama dibatasi pada CICILAN yang sama, bukan pada
--      seluruh kontrak. Sebelumnya, pelanggan yang ingin membayar dua cicilan
--      sekaligus justru membuat QR pertamanya batal tanpa dia sadari.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Anti-duplikat konfirmasi
-- -----------------------------------------------------------------------------
-- Notifikasi yang sama dapat terkirim berkali-kali: MacroDroid mengulang kirim
-- saat jaringan gagal, atau pengguna menekan tombolnya dua kali. Sidik jari teks
-- memastikan satu notifikasi hanya diproses sekali, dan indeks unik menjadi
-- penjaganya di tingkat basis data — bukan hanya di dalam logika pemanggil.

alter table public.qris_confirmations
  add column if not exists content_hash text;

comment on column public.qris_confirmations.content_hash is
  'SHA-256 teks notifikasi apa adanya; dipakai mencegah pemrosesan berulang.';

-- Indeks unik penuh, bukan parsial: `on conflict (content_hash)` menuntut
-- indeks yang cocok persis, dan indeks parsial memerlukan predikat yang sama di
-- pernyataan konfliknya. Banyak baris bernilai NULL tetap diperbolehkan karena
-- PostgreSQL memperlakukan NULL sebagai nilai yang berbeda satu sama lain.
drop index if exists public.uq_qris_confirmation_hash;
create unique index if not exists uq_qris_confirmation_hash
  on public.qris_confirmations (content_hash);

-- -----------------------------------------------------------------------------
-- 2. Fungsi pencatat konfirmasi menerima sidik jari
-- -----------------------------------------------------------------------------

drop function if exists public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text);

create or replace function public.fn_log_qris_confirmation(
  p_organization_id uuid,
  p_request_id uuid,
  p_outcome text,
  p_amount bigint default null,
  p_reference text default null,
  p_raw_text text default null,
  p_detail text default null,
  p_source text default 'MACRODROID',
  p_content_hash text default null
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
    (organization_id, request_id, source, amount, reference, raw_text, outcome, detail, content_hash)
  values
    (p_organization_id, p_request_id, coalesce(p_source, 'MACRODROID'), p_amount,
     p_reference, left(p_raw_text, 4000), p_outcome, left(p_detail, 2000), p_content_hash)
  on conflict (content_hash) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text, text) is
  'Menyimpan satu konfirmasi pembayaran; sidik jari teks yang sama tidak tersimpan dua kali.';

-- -----------------------------------------------------------------------------
-- 3. Membuat permintaan: tanpa duplikat, masa berlaku 24 jam, batal per cicilan
-- -----------------------------------------------------------------------------

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
  v_ada        public.qris_payment_requests;
  v_expires    timestamptz := now() + interval '24 hours';
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

  -- Permintaan yang masih menunggu untuk cicilan yang sama dan nominal yang
  -- sama dikembalikan apa adanya, supaya pelanggan yang membuka halaman dua
  -- kali tidak menghasilkan dua QR yang keduanya bisa dibayar.
  select * into v_ada
    from public.qris_payment_requests
   where installment_id = v_cicilan.id
     and status = 'PENDING'
     and amount = v_amount
     and expires_at > now()
   order by created_at desc
   limit 1;

  if v_ada.id is not null then
    return jsonb_build_object(
      'request_id', v_ada.id,
      'reference', v_ada.reference,
      'amount', v_ada.amount,
      'contract_number', v_nomor,
      'installment_number', v_cicilan.installment_number,
      'due_date', v_cicilan.due_date,
      'expires_at', v_ada.expires_at,
      'lanjutan', true
    );
  end if;

  -- Permintaan lama untuk CICILAN yang sama ditutup. Yang dibatalkan hanya
  -- cicilan ini saja, sehingga pelanggan dapat menyiapkan pembayaran beberapa
  -- cicilan sekaligus tanpa QR-nya saling membatalkan.
  update public.qris_payment_requests
     set status = 'CANCELLED',
         note = coalesce(note || ' | ', '') || 'digantikan permintaan baru'
   where installment_id = v_cicilan.id
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
    'expires_at', v_expires,
    'lanjutan', false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Mencatat pembayaran: tutup permintaan lain untuk cicilan yang sama
-- -----------------------------------------------------------------------------
-- Tanpa kode unik, dua permintaan untuk cicilan yang sama dapat memiliki nominal
-- identik dan sama-sama menunggu. Begitu salah satunya dibayar, sisanya harus
-- ditutup — kalau tidak, pembayaran kedua akan tercatat sebagai kelebihan pada
-- cicilan yang sudah lunas.

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

  if v_req.installment_id is not null then
    update public.qris_payment_requests
       set status = 'CANCELLED',
           note = coalesce(note || ' | ', '') || 'cicilan sudah dibayar lewat permintaan lain'
     where installment_id = v_req.installment_id
       and id <> v_req.id
       and status = 'PENDING';
  end if;

  return jsonb_build_object(
    'status', 'DIBAYAR',
    'request_id', v_req.id,
    'reference', v_req.reference,
    'payment_id', v_hasil ->> 'payment_id',
    'receipt_number', v_hasil ->> 'receipt_number'
  );
exception
  when others then
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
-- 6. Konfigurasi QRIS untuk server
-- -----------------------------------------------------------------------------
-- Edge Function perlu mengetahui dua hal sebelum dapat memutuskan: penanda teks
-- notifikasi, dan organisasi pemilik QR tersebut. Keduanya dibaca dari satu
-- tempat agar tidak ada salinan aturan di sisi server. Penanda dibuat
-- konfigurabel karena kata-katanya bergantung pada aplikasi bank yang dipakai —
-- notifikasi yang tidak cocok akan tetap tersimpan, sehingga admin dapat melihat
-- teks aslinya lalu menyesuaikan penandanya.

create or replace function public.fn_qris_config()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'organization_id', s.organization_id,
           'payload', nullif(trim(coalesce(s.integrations ->> 'qrisStaticPayload', '')), ''),
           'notif_marker', nullif(trim(coalesce(s.integrations ->> 'qrisNotifMarker', '')), '')
         )
    from public.app_settings s
   where nullif(trim(coalesce(s.integrations ->> 'qrisStaticPayload', '')), '') is not null
   order by s.created_at
   limit 1;
$$;

comment on function public.fn_qris_config() is
  'Organisasi, payload QRIS, dan penanda notifikasi; hanya untuk service_role.';

-- -----------------------------------------------------------------------------
-- 7. Hak eksekusi
-- -----------------------------------------------------------------------------

revoke all on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_log_qris_confirmation(uuid, uuid, text, bigint, text, text, text, text, text) to service_role;
revoke all on function public.fn_qris_config() from public, anon, authenticated;
grant execute on function public.fn_qris_config() to service_role;

-- =============================================================================
-- SELESAI — alur permintaan QRIS tanpa kode unik
-- =============================================================================
