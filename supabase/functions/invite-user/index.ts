// =============================================================================
// KreditKu — Edge Function: invite-user
//
// TUGAS
//   Mengundang pengguna baru (mengirim email undangan Supabase) lalu
//   mendaftarkannya sebagai anggota organisasi dengan role yang diminta.
//
// KEAMANAN
//   * Pemanggil WAJIB sudah login (verify_jwt = true).
//   * Pemanggil WAJIB berperan SUPER_ADMIN pada organisasinya.
//     Pemeriksaan dilakukan melalui klien ber-JWT pemanggil sehingga RLS
//     ikut berlaku; service role TIDAK dipakai untuk memutuskan izin.
//   * Service role hanya dipakai untuk membuat akun auth (undangan) dan
//     TIDAK PERNAH dikembalikan ke klien.
//   * Fungsi tidak pernah menerima, menyimpan, atau menampilkan password.
//
// PEMASANGAN
//   supabase functions deploy invite-user
//   Variabel lingkungan yang dibutuhkan (otomatis tersedia di Supabase):
//     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   Opsional: APP_REDIRECT_URL (tautan tujuan setelah pengguna menetapkan password)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface InvitePayload {
  email?: string;
  fullName?: string;
  role?: string;
}

const ALLOWED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'CASHIER', 'VIEWER'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Metode tidak diizinkan.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const redirectTo = Deno.env.get('APP_REDIRECT_URL');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Konfigurasi server tidak lengkap (SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY).' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Permintaan harus menyertakan token sesi pengguna.' }, 401);
  }

  // Klien dengan JWT pemanggil: seluruh pemeriksaan izin mengikuti RLS.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: 'Sesi tidak valid. Silakan login kembali.' }, 401);
  }

  let payload: InvitePayload;
  try {
    payload = (await request.json()) as InvitePayload;
  } catch {
    return json({ error: 'Body permintaan harus berupa JSON.' }, 400);
  }

  const email = (payload.email ?? '').trim().toLowerCase();
  const fullName = (payload.fullName ?? '').trim();
  const role = (payload.role ?? 'VIEWER').trim().toUpperCase();

  if (!isValidEmail(email)) return json({ error: 'Format email tidak valid.' }, 422);
  if (fullName.length < 2) return json({ error: 'Nama minimal 2 karakter.' }, 422);
  if (!ALLOWED_ROLES.includes(role)) return json({ error: 'Role tidak dikenal.' }, 422);

  // Verifikasi role pemanggil melalui keanggotaan yang terlihat RLS.
  const { data: memberships, error: membershipError } = await callerClient
    .from('organization_members')
    .select('organization_id, role, is_active')
    .eq('user_id', userData.user.id)
    .eq('is_active', true);

  if (membershipError) {
    return json({ error: 'Tidak dapat memverifikasi keanggotaan organisasi.' }, 403);
  }
  if (!memberships || memberships.length === 0) {
    return json({ error: 'Akun Anda belum terhubung ke organisasi mana pun.' }, 403);
  }
  if (!memberships.some((row) => row.role === 'SUPER_ADMIN')) {
    return json({ error: 'Hanya Super Admin yang boleh mengundang pengguna.' }, 403);
  }

  // Klien admin hanya dipakai untuk membuat/mengundang akun auth.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const inviteOptions = redirectTo ? { redirectTo } : undefined;
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    ...(inviteOptions ? inviteOptions : {}),
  });

  if (inviteError && !/already registered|already exists/i.test(inviteError.message)) {
    return json({ error: `Undangan gagal dikirim: ${inviteError.message}` }, 400);
  }

  let userId = invited?.user?.id ?? null;

  if (!userId) {
    // Pengguna sudah ada: cari id-nya untuk didaftarkan sebagai anggota.
    const { data: existing } = await adminClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    userId = existing?.id ?? null;
  }

  if (!userId) {
    return json(
      {
        error:
          'Akun undangan dibuat tetapi profil pengguna belum tersedia. Minta pengguna menyelesaikan pendaftaran, lalu tambahkan kembali.',
      },
      409,
    );
  }

  const { data: registration, error: registerError } = await callerClient.rpc('rpc_register_member', {
    p_user_id: userId,
    p_email: email,
    p_full_name: fullName,
    p_role: role,
  });

  if (registerError) {
    return json({ error: `Gagal menambahkan anggota: ${registerError.message}` }, 400);
  }

  return json({
    ok: true,
    invited_email: email,
    role,
    member_id: (registration as { member_id?: string } | null)?.member_id ?? null,
    note: 'Email undangan dikirim oleh Supabase Auth. Pengguna menetapkan password sendiri melalui tautan tersebut.',
  });
});
