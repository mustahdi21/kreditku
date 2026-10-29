// =============================================================================
// KreditKu — Edge Function: customer-signup
//
// TUGAS
//   Mendaftarkan akun portal pelanggan memakai kode undangan yang dibuat admin.
//   Dipanggil dari halaman pendaftaran portal, TANPA sesi Supabase — calon
//   pengguna memang belum punya akun.
//
// KENAPA TANPA EMAIL
//   Akun dibuat dengan email sudah terkonfirmasi sehingga tidak ada email
//   aktivasi yang perlu dikirim. Itu disengaja: proyek ini belum tentu punya
//   SMTP, dan kode undangan sudah menjadi bukti bahwa orang ini memang berhak.
//   Kode hanya dapat dibuat admin untuk satu pelanggan tertentu, sekali pakai,
//   dan berumur pendek.
//
// KEAMANAN
//   * Satu-satunya penjaga adalah kode undangan, karena itu deploy dilakukan
//     dengan verify_jwt = false dan TIDAK ada rahasia lain di berkas ini.
//   * Fungsi TIDAK menentukan pelanggan mana yang ditautkan — itu ditentukan
//     fn_redeem_customer_invite di basis data dari kode yang dipakai. Pemanggil
//     tidak pernah dapat menyebut id pelanggan.
//   * Bila penautan gagal setelah akun dibuat (mis. kode keburu dipakai orang
//     lain pada saat yang sama), akun itu DIHAPUS kembali sehingga tidak
//     meninggalkan akun menggantung yang tidak tertaut ke siapa pun.
//   * Password hanya dikirim sekali, tidak disimpan, dan tidak pernah
//     dikembalikan pada balasan.
//
// PEMASANGAN
//   Deploy sebagai fungsi bernama `customer-signup` dengan Verify JWT DIMATIKAN.
//   Variabel SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
//
// PEMANGGILAN
//   POST /functions/v1/customer-signup
//   Body periksa kode : { "code": "XXXXXXXX" }
//   Body pendaftaran  : { "code": "XXXXXXXX", "fullName": "...", "email": "...", "password": "..." }
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_PASSWORD_LENGTH = 10;

interface SignupPayload {
  code?: string;
  fullName?: string;
  email?: string;
  password?: string;
}

interface InviteRow {
  id: string;
  customer_id: string;
  organization_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  full_name: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/**
 * True bila galat dari Supabase Auth berarti email sudah terpakai.
 *
 * GoTrue memakai beberapa kalimat berbeda untuk keadaan yang sama, dan yang
 * paling mudah terlewat adalah "A user with this email address has already been
 * registered" — di dalamnya TIDAK terdapat rangkaian kata "already registered"
 * karena disela kata "been". Pola yang terlalu sempit membuat pesan yang benar
 * justru lolos menjadi galat umum yang membingungkan pendaftar.
 */
function isDuplicateEmail(message: string): boolean {
  return /already registered|already been registered|already exists|already been created|user_already_exists/i.test(
    message,
  );
}

interface InviteCheck {
  readonly ok: boolean;
  readonly message?: string;
  readonly invite?: InviteRow;
}

/** Memeriksa kode tanpa mengubah apa pun; dipakai sebelum akun dibuat. */
function evaluateInvite(invite: InviteRow | null): InviteCheck {
  if (!invite) return { ok: false, message: 'Kode undangan tidak ditemukan.' };
  if (invite.revoked_at) return { ok: false, message: 'Kode undangan ini sudah dicabut admin.' };
  if (invite.used_at) return { ok: false, message: 'Kode undangan ini sudah pernah dipakai.' };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, message: 'Kode undangan ini sudah kedaluwarsa. Minta kode baru kepada admin.' };
  }
  return { ok: true, invite };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Metode harus POST.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, message: 'Konfigurasi server tidak lengkap.' }, 500);
  }

  let payload: SignupPayload = {};
  try {
    payload = (await request.json()) as SignupPayload;
  } catch {
    return json({ ok: false, message: 'Isi permintaan bukan JSON yang sah.' }, 400);
  }

  const code = (payload.code ?? '').trim().toUpperCase();
  if (!code) {
    return json({ ok: false, message: 'Kode undangan wajib diisi.' }, 422);
  }
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return json({ ok: false, message: 'Kode undangan terdiri dari 8 huruf atau angka.' }, 422);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inviteRaw, error: inviteError } = await admin
    .from('customer_invites')
    .select('id, customer_id, organization_id, expires_at, used_at, revoked_at, full_name')
    .eq('code', code)
    .maybeSingle();

  if (inviteError) {
    return json({ ok: false, message: `Gagal memeriksa kode: ${inviteError.message}` }, 500);
  }

  const pemeriksaan = evaluateInvite((inviteRaw ?? null) as InviteRow | null);
  if (!pemeriksaan.ok || !pemeriksaan.invite) {
    return json({ ok: false, message: pemeriksaan.message ?? 'Kode undangan tidak sah.' }, 400);
  }
  const invite = pemeriksaan.invite;

  // Pelanggannya sudah punya akun: kode tidak boleh dipakai lagi.
  const { data: pelanggan } = await admin
    .from('customers')
    .select('id, full_name, user_id')
    .eq('id', invite.customer_id)
    .maybeSingle();

  if (!pelanggan) {
    return json({ ok: false, message: 'Data pelanggan untuk kode ini tidak ditemukan.' }, 400);
  }
  if (pelanggan.user_id) {
    return json(
      { ok: false, message: 'Pelanggan ini sudah memiliki akun portal. Silakan masuk atau minta admin mencabut kodenya.' },
      409,
    );
  }

  const namaPelanggan = invite.full_name ?? pelanggan.full_name ?? null;

  // Mode periksa kode: dipakai halaman pendaftaran untuk menampilkan nama
  // pelanggan sebelum formulir diisi. Tidak mengubah apa pun.
  const fullName = (payload.fullName ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const password = payload.password ?? '';

  if (!fullName && !email && !password) {
    return json({
      ok: true,
      mode: 'PERIKSA',
      customer_name: namaPelanggan,
      expires_at: invite.expires_at,
    });
  }

  if (fullName.length < 2) {
    return json({ ok: false, message: 'Nama lengkap minimal 2 karakter.' }, 422);
  }
  if (!isValidEmail(email)) {
    return json({ ok: false, message: 'Format email tidak valid.' }, 422);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ ok: false, message: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.` }, 422);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user?.id) {
    const tersedia = isDuplicateEmail(createError?.message ?? '');
    return json(
      {
        ok: false,
        message: tersedia
          ? 'Email ini sudah terdaftar. Bila akun itu milik Anda, silakan masuk; bila bukan, gunakan email lain.'
          : `Akun gagal dibuat: ${createError?.message ?? 'tidak diketahui'}`,
      },
      tersedia ? 409 : 400,
    );
  }

  const userId = created.user.id;

  const { data: redeemRaw, error: redeemError } = await admin.rpc('fn_redeem_customer_invite', {
    p_code: code,
    p_user_id: userId,
    p_full_name: fullName,
  });

  const redeem = (redeemRaw ?? {}) as { status?: string; customer_name?: string };

  if (redeemError || redeem.status !== 'BERHASIL') {
    // Jangan tinggalkan akun menggantung yang tidak tertaut ke pelanggan mana
    // pun. Yang paling mungkin terjadi: kode keburu dipakai orang lain pada
    // saat yang hampir bersamaan.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    const pesan =
      redeem.status === 'KODE_SUDAH_DIPAKAI'
        ? 'Kode undangan baru saja dipakai orang lain. Minta kode baru kepada admin.'
        : redeem.status === 'PELANGGAN_SUDAH_PUNYA_AKUN'
          ? 'Pelanggan ini sudah memiliki akun portal.'
          : redeemError?.message ?? 'Kode undangan tidak dapat dipakai lagi.';
    return json({ ok: false, message: pesan, status: redeem.status ?? 'GAGAL' }, 409);
  }

  return json({
    ok: true,
    mode: 'DAFTAR',
    email,
    customer_name: redeem.customer_name ?? namaPelanggan,
    message: 'Akun portal berhasil dibuat. Silakan masuk memakai email dan password Anda.',
  });
});
