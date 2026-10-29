-- =============================================================================
-- KreditKu — pelanggan menentukan sendiri nominal pembayarannya
--
-- PERUBAHAN
-- ---------
-- rpc_create_qris_request menerima p_amount opsional:
--   * kosong  -> perilaku lama: sebesar tagihan satu cicilan, dibayar penuh;
--   * diisi   -> nominal bebas, termasuk pembayaran sebagian.
--
-- Yang TIDAK berubah: nominal tetap ditentukan SERVER, bukan diterima begitu
-- saja dari klien. Nilai kiriman klien hanya boleh MEMPERKECIL dari tagihan,
-- tidak pernah memperbesarnya, dan diperiksa sebelum permintaan dibuat:
--
--   * minimal 1 rupiah — nominal nol atau negatif tidak masuk akal;
--   * maksimal sebesar TOTAL TAGIHAN TERBUKA pada kontrak itu, dihitung dari
--     view yang sama yang dipakai aplikasi, bukan dari angka kiriman klien.
--
-- Batas atas sengaja memakai total kontrak, bukan satu cicilan: pelanggan yang
-- membayar lebih besar daripada satu cicilan memang wajar — kelebihannya
-- dialokasikan ke cicilan berikutnya oleh mesin alokasi yang sudah ada, sama
-- seperti pembayaran yang dicatat kasir.
--
-- AKIBAT PADA PENCOCOKAN QRIS
-- ---------------------------
-- Nominal bebas membuat dua permintaan cenderung bernilai berbeda, sehingga
-- justru mengurangi kejadian ambigu. Yang tetap berlaku: bila ada lebih dari
-- satu tagihan bernominal sama persis, pembayarannya ditinjau kasir, tidak
-- dicatat otomatis.
-- =============================================================================

drop function if exists public.rpc_create_qris_request(uuid, uuid);

create or replace function public.rpc_create_qris_request(
  p_contract_id uuid,
  p_installment_id uuid default null,
  p_amount bigint default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer  uuid := public.fn_current_customer_id();
  v_org       uuid;
  v_nomor     text;
  v_cicilan   record;
  v_terbuka   bigint;
  v_amount    bigint;
  v_reference text;
  v_id        uuid;
  v_ada       public.qris_payment_requests;
  v_expires   timestamptz := now() + interval '24 hours';
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

  -- Seluruh tagihan terbuka pada kontrak ini, dihitung server.
  select coalesce(sum(d.outstanding + coalesce(d.penalty_outstanding, 0)), 0)
    into v_terbuka
    from public.v_installment_details d
   where d.contract_id = p_contract_id
     and d.stored_status <> 'CANCELLED';

  if v_terbuka <= 0 then
    raise exception 'Tidak ada tagihan yang perlu dibayar pada kontrak ini.' using errcode = 'P0002';
  end if;

  if p_amount is null then
    -- Tanpa nominal kiriman: sebesar cicilan belum lunas paling awal.
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
  else
    if p_amount <= 0 then
      raise exception 'Nominal pembayaran harus lebih besar dari nol.' using errcode = '22023';
    end if;

    if p_amount > v_terbuka then
      raise exception
        'Nominal Rp% melebihi total tagihan Rp%. Kurangi nominalnya atau bayar penuh.',
        replace(to_char(p_amount, 'FM999,999,999,999'), ',', '.'),
        replace(to_char(v_terbuka, 'FM999,999,999,999'), ',', '.')
        using errcode = '22023';
    end if;

    v_amount := p_amount;

    -- Cicilan yang ditampilkan: yang disebut pelanggan, atau yang paling awal
    -- belum lunas. Tidak wajib ada bila nominalnya lebih kecil daripada satu
    -- cicilan sekalipun — kelebihannya nanti dialokasikan oleh mesin alokasi.
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
  end if;

  -- Permintaan yang masih menunggu untuk cicilan dan nominal yang sama
  -- dikembalikan apa adanya, supaya membuka halaman dua kali tidak menghasilkan
  -- dua QR yang keduanya bisa dibayar.
  select * into v_ada
    from public.qris_payment_requests
   where installment_id is not distinct from v_cicilan.id
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
      'lanjutan', true,
      'total_outstanding', v_terbuka
    );
  end if;

  -- Permintaan lama untuk cicilan yang sama ditutup, supaya tidak ada dua QR
  -- aktif yang dapat membayar cicilan yang sama.
  if v_cicilan.id is not null then
    update public.qris_payment_requests
       set status = 'CANCELLED',
           note = coalesce(note || ' | ', '') || 'digantikan permintaan baru'
     where installment_id = v_cicilan.id
       and status = 'PENDING';
  end if;

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
    'lanjutan', false,
    'total_outstanding', v_terbuka
  );
end;
$$;

comment on function public.rpc_create_qris_request(uuid, uuid, bigint) is
  'Membuat permintaan pembayaran QRIS; nominal dihitung dan dibatasi server, boleh sebagian.';

revoke all on function public.rpc_create_qris_request(uuid, uuid, bigint) from public, anon;
grant execute on function public.rpc_create_qris_request(uuid, uuid, bigint) to authenticated, service_role;

-- =============================================================================
-- SELESAI — nominal yang dapat ditentukan pelanggan
-- =============================================================================
