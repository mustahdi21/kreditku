// =============================================================================
// KreditKu — Edge Function: qris-confirm
//
// TUGAS
//   Menerima teks notifikasi pembayaran QRIS yang dikirim MacroDroid dari HP
//   merchant, lalu mencatat pembayaran cicilan yang cocok.
//
//   Alur ini mengikuti pola yang sudah dipakai pada project ethereal-wa:
//   notifikasi bank ditangkap di HP, dikirim apa adanya sebagai teks, lalu
//   server yang membaca nominal dan mencocokkannya dengan tagihan yang terbuka.
//
// KENAPA TEKS APA ADANYA
//   Format notifikasi berbeda antar bank dan dompet digital, dan berubah tanpa
//   pemberitahuan. Karena itu yang dikirim adalah teks utuh, bukan hasil
//   pembacaan di HP: aturan pembacaan berada di server dan dapat diperbaiki
//   tanpa menyentuh HP siapa pun. Setiap teks yang masuk tersimpan, termasuk
//   yang tidak cocok, sehingga penyetelan penanda dapat dilakukan dari data
//   nyata.
//
// KEAMANAN
//   * Fungsi ini menerima permintaan TANPA sesi Supabase, karena yang memanggil
//     adalah MacroDroid. Karena itu deploy harus dengan verify_jwt = false, dan
//     satu-satunya penjaga adalah WEBHOOK_SECRET yang dibandingkan di sini.
//     Isi secret dengan nilai acak panjang, jangan yang mudah ditebak.
//   * Pencatatan pembayaran TIDAK diputuskan di sini. Fungsi ini hanya mencari
//     kandidat lewat fn_find_open_qris_requests dan menyerahkan pencatatan kepada
//     rpc_confirm_qris_payment, yang menolak bila permintaan sudah tidak
//     menunggu atau sudah kedaluwarsa.
//   * Bila kandidat lebih dari satu, TIDAK ADA yang dicatat. Nominal yang sama
//     pada dua tagihan berbeda tidak dapat dipastikan milik siapa, dan menebak
//     berarti mencatat pembayaran pada kontrak orang lain.
//
// PEMASANGAN
//   Deploy sebagai fungsi bernama `qris-confirm` dengan Verify JWT dimatikan.
//   Secret yang dibutuhkan (atur sebagai secret Edge Function):
//     QRIS_WEBHOOK_SECRET  — nilai acak, dipakai MacroDroid pada header
//                            x-webhook-secret atau parameter ?secret=
//   Variabel SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
//
// PEMANGGILAN DARI MACRODROID
//   POST https://<ref>.supabase.co/functions/v1/qris-confirm
//   Header: x-webhook-secret: <secret>
//   Body  : { "notification": "<teks notifikasi bank>" }
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Dipakai bila organisasi belum mengatur penandanya sendiri. */
const DEFAULT_NOTIF_MARKER = 'pembayaran via qris statis diterima';

interface ConfirmPayload {
  notification?: string;
  text?: string;
  message?: string;
  secret?: string;
}

/**
 * Membaca nominal dari teks notifikasi.
 *
 * Mengikuti aturan yang sudah dipakai project ethereal-wa: ambil angka setelah
 * "Rp" atau "IDR", buang dua angka desimal di belakang, lalu sisakan digitnya.
 * Contoh: "Rp550.000" -> 550000, "IDR 1.250.000,00" -> 1250000.
 */
export function extractAmount(text: string): number | null {
  const match = text.match(/(?:Rp|IDR)\s?([\d.,]+)/i);
  if (!match) return null;
  const numeric = match[1].replace(/[.,]\d{2}$/, '');
  const digits = numeric.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** SHA-256 heksadesimal dari teks apa adanya, dipakai menolak pemrosesan ganda. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Perbandingan yang tidak berhenti pada karakter pertama yang berbeda. */
function secretMatches(expected: string, given: string): boolean {
  if (!expected || !given || expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ success: false, msg: 'Metode harus POST.' }, 405);
  }

  const expectedSecret = Deno.env.get('QRIS_WEBHOOK_SECRET') ?? '';
  if (!expectedSecret) {
    return json({ success: false, msg: 'Webhook belum dikonfigurasi pada server (WEBHOOK_SECRET kosong).' }, 500);
  }

  const url = new URL(request.url);
  let payload: ConfirmPayload = {};
  try {
    payload = (await request.json()) as ConfirmPayload;
  } catch {
    payload = {};
  }

  const givenSecret =
    request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret') ?? payload.secret ?? '';
  if (!secretMatches(expectedSecret, givenSecret)) {
    return json({ success: false, msg: 'Secret tidak sesuai.' }, 401);
  }

  const text = (payload.notification ?? payload.text ?? payload.message ?? '').trim();
  if (!text) {
    return json({ success: false, msg: 'Isi notifikasi kosong.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ success: false, msg: 'Konfigurasi server tidak lengkap.' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const contentHash = await sha256Hex(text);

  // Konfigurasi dibaca dari basis data supaya penanda notifikasi hanya ada di
  // satu tempat dan dapat diubah lewat pengaturan, bukan lewat deploy ulang.
  const { data: configRaw, error: configError } = await admin.rpc('fn_qris_config');
  if (configError) {
    return json({ success: false, msg: `Gagal membaca konfigurasi: ${configError.message}` }, 500);
  }
  const config = (configRaw ?? {}) as {
    organization_id?: string | null;
    notif_marker?: string | null;
  };
  const organizationId = config.organization_id ?? null;

  const marker = (config.notif_marker ?? DEFAULT_NOTIF_MARKER).toLowerCase();

  const logOutcome = async (
    outcome: string,
    amount: number | null,
    requestId: string | null,
    detail: string | null,
  ): Promise<void> => {
    await admin.rpc('fn_log_qris_confirmation', {
      p_organization_id: organizationId,
      p_request_id: requestId,
      p_outcome: outcome,
      p_amount: amount,
      p_reference: null,
      p_raw_text: text,
      p_detail: detail,
      p_source: 'MACRODROID',
      p_content_hash: contentHash,
    });
  };

  // Notifikasi yang sama dapat terkirim berkali-kali: MacroDroid mengulang saat
  // jaringan gagal, atau tombolnya tertekan dua kali.
  const { data: sudahAda } = await admin
    .from('qris_confirmations')
    .select('id, outcome')
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (sudahAda) {
    return json({ success: true, msg: 'Notifikasi ini sudah pernah diproses.', outcome: 'DUPLIKAT' });
  }

  if (!text.toLowerCase().includes(marker)) {
    await logOutcome('BUKAN_QRIS', null, null, `Teks tidak memuat penanda "${marker}".`);
    return json({
      success: false,
      msg: 'Bukan notifikasi pembayaran QRIS yang dikenali.',
      outcome: 'BUKAN_QRIS',
      marker,
    });
  }

  const amount = extractAmount(text);
  if (amount === null) {
    await logOutcome('NOMINAL_TIDAK_TERBACA', null, null, 'Nominal tidak ditemukan pada teks notifikasi.');
    return json({ success: false, msg: 'Nominal tidak ditemukan pada teks notifikasi.', outcome: 'NOMINAL_TIDAK_TERBACA' });
  }

  const { data: kandidatRaw, error: cariError } = await admin.rpc('fn_find_open_qris_requests', {
    p_amount: amount,
  });
  if (cariError) {
    await logOutcome('GAGAL_CARI', amount, null, cariError.message);
    return json({ success: false, msg: `Gagal mencari tagihan: ${cariError.message}`, amount }, 500);
  }

  const kandidat = (kandidatRaw ?? []) as Array<{ request_id: string; reference: string; contract_number: string }>;

  if (kandidat.length === 0) {
    await logOutcome('TIDAK_COCOK', amount, null, 'Tidak ada tagihan terbuka dengan nominal itu.');
    return json({
      success: false,
      msg: 'Nominal tidak cocok dengan tagihan yang menunggu pembayaran.',
      outcome: 'TIDAK_COCOK',
      amount,
    });
  }

  if (kandidat.length > 1) {
    const daftar = kandidat.map((k) => k.reference).join(', ');
    await logOutcome('AMBIGU', amount, null, `Lebih dari satu tagihan bernominal sama: ${daftar}`);
    return json({
      success: false,
      msg: 'Lebih dari satu tagihan bernominal sama. Perlu ditinjau manual di aplikasi.',
      outcome: 'AMBIGU',
      amount,
      kandidat: kandidat.map((k) => ({ request_id: k.request_id, reference: k.reference, kontrak: k.contract_number })),
    });
  }

  const target = kandidat[0]!;
  const { data: hasilRaw, error: catatError } = await admin.rpc('rpc_confirm_qris_payment', {
    p_request_id: target.request_id,
    p_reference: null,
    p_note: `Dicatat otomatis dari notifikasi: ${text.slice(0, 200)}`,
    p_confirmed_via: 'MACRODROID',
  });

  if (catatError) {
    await logOutcome('GAGAL_CATAT', amount, target.request_id, catatError.message);
    return json({ success: false, msg: `Gagal mencatat pembayaran: ${catatError.message}`, amount }, 500);
  }

  const hasil = (hasilRaw ?? {}) as { status?: string; receipt_number?: string; alasan?: string };

  if (hasil.status === 'DIBAYAR') {
    await logOutcome('DIBAYAR', amount, target.request_id, `Kuitansi ${hasil.receipt_number ?? '-'}`);
    return json({
      success: true,
      msg: `Pembayaran Rp${amount.toLocaleString('id-ID')} tercatat.`,
      outcome: 'DIBAYAR',
      amount,
      reference: target.reference,
      contract_number: target.contract_number,
      receipt_number: hasil.receipt_number ?? null,
    });
  }

  await logOutcome(hasil.status ?? 'PERLU_TINJAUAN', amount, target.request_id, hasil.alasan ?? null);
  return json({
    success: false,
    msg: hasil.alasan ?? 'Pembayaran perlu ditinjau manual.',
    outcome: hasil.status ?? 'PERLU_TINJAUAN',
    amount,
    reference: target.reference,
  });
});
