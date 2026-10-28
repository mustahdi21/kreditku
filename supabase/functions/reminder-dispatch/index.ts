// =============================================================================
// KreditKu — Edge Function: reminder-dispatch
//
// TUGAS
//   1. Membentuk antrean pengingat untuk seluruh organisasi (idempoten).
//   2. Mengirim pengingat yang masih PENDING melalui kanal yang dikonfigurasi.
//
// KANAL
//   * IN_APP  : membuat baris notifikasi di dalam aplikasi (selalu tersedia).
//   * WHATSAPP: memanggil penyedia resmi melalui HTTP API (WAHASENDER_API_URL).
//   * EMAIL   : memanggil penyedia HTTP API (EMAIL_API_URL, mis. Resend/Postmark).
//
// KEJUJURAN STATUS
//   Bila kredensial penyedia belum tersedia atau mode simulasi aktif, pengingat
//   ditandai SKIPPED dengan alasan yang jelas. Fungsi ini TIDAK PERNAH menandai
//   pesan sebagai terkirim bila benar-benar tidak dikirim.
//
// PENJADWALAN
//   Panggil fungsi ini dari penjadwal: Supabase Cron, GitHub Actions terjadwal,
//   atau layanan cron lain. Sertakan header `x-cron-secret` bila
//   REMINDER_CRON_SECRET diisi (sangat disarankan).
//
// PEMASANGAN
//   supabase functions deploy reminder-dispatch --no-verify-jwt
//   Rahasia: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REMINDER_CRON_SECRET,
//            WAHASENDER_API_KEY, WAHASENDER_API_URL, EMAIL_API_URL, EMAIL_API_KEY,
//            EMAIL_FROM
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

interface ReminderRecord {
  id: string;
  organization_id: string;
  contract_id: string;
  installment_id: string;
  customer_id: string;
  offset_key: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  scheduled_for: string;
  attempts: number;
}

interface DispatchResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  details: { reminder_id: string; channel: string; outcome: string; reason?: string }[];
}

const OFFSET_LABELS: Record<string, string> = {
  D_MINUS_7: '7 hari sebelum jatuh tempo',
  D_MINUS_3: '3 hari sebelum jatuh tempo',
  D_MINUS_1: '1 hari sebelum jatuh tempo',
  DUE_DATE: 'hari jatuh tempo',
  AFTER_DUE: 'setelah jatuh tempo',
};

function formatRupiah(value: number): string {
  return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
}

function formatDateId(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${Number(day)} ${months[Number(month) - 1] ?? month} ${year}`;
}

/** Pesan sopan, profesional, tanpa tekanan, dan tanpa rincian utang yang sensitif berlebihan. */
function buildMessage(context: {
  customerName: string;
  businessName: string;
  contractNumber: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  offsetKey: string;
}): string {
  const timing = OFFSET_LABELS[context.offsetKey] ?? 'menjelang jatuh tempo';
  return [
    `Selamat siang Bapak/Ibu ${context.customerName},`,
    '',
    `${context.businessName} ingin mengingatkan bahwa angsuran ke-${context.installmentNumber} untuk kontrak ${context.contractNumber} akan jatuh tempo pada ${formatDateId(context.dueDate)} (${timing}).`,
    `Jumlah angsuran: ${formatRupiah(context.amount)}.`,
    '',
    'Bila sudah melakukan pembayaran, mohon abaikan pesan ini dan terima kasih atas ketertiban Anda.',
    'Informasi lebih lanjut silakan hubungi petugas kami pada jam kerja.',
    '',
    `${context.businessName}`,
  ].join('\n');
}

async function sendWhatsapp(to: string, message: string): Promise<{ ok: boolean; reason?: string }> {
  const apiUrl = Deno.env.get('WAHASENDER_API_URL');
  const apiKey = Deno.env.get('WAHASENDER_API_KEY');
  if (!apiUrl || !apiKey) {
    return { ok: false, reason: 'Kredensial WhatsApp belum dikonfigurasi (WAHASENDER_API_URL / WAHASENDER_API_KEY).' };
  }
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ phone: to, message }),
    });
    if (!response.ok) {
      return { ok: false, reason: `Penyedia WhatsApp merespons HTTP ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Gagal menghubungi penyedia WhatsApp: ${String(error)}` };
  }
}

async function sendEmail(to: string, subject: string, message: string): Promise<{ ok: boolean; reason?: string }> {
  const apiUrl = Deno.env.get('EMAIL_API_URL');
  const apiKey = Deno.env.get('EMAIL_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!apiUrl || !apiKey || !from) {
    return { ok: false, reason: 'Kredensial email belum dikonfigurasi (EMAIL_API_URL / EMAIL_API_KEY / EMAIL_FROM).' };
  }
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [to], subject, text: message }),
    });
    if (!response.ok) return { ok: false, reason: `Penyedia email merespons HTTP ${response.status}.` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Gagal menghubungi penyedia email: ${String(error)}` };
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (cronSecret && request.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Tidak diizinkan.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Konfigurasi server tidak lengkap.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(request.url);
  const asOf = url.searchParams.get('as_of') ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100') || 100, 500);
  const dryRun = url.searchParams.get('dry_run') === '1';

  const result: DispatchResult = { processed: 0, sent: 0, skipped: 0, failed: 0, details: [] };

  // 1. Membentuk antrean untuk seluruh organisasi (fungsi server, idempoten).
  const { data: organizations, error: orgError } = await admin.from('organizations').select('id, name');
  if (orgError) {
    return new Response(JSON.stringify({ error: `Gagal memuat organisasi: ${orgError.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const organizationNames = new Map<string, string>((organizations ?? []).map((row) => [row.id, row.name]));
  let enqueued = 0;

  for (const organization of organizations ?? []) {
    const { data: enqueueResult, error: enqueueError } = await admin.rpc('rpc_enqueue_reminders', {
      p_org: organization.id,
      p_as_of: asOf,
    });
    if (enqueueError) {
      result.details.push({ reminder_id: '-', channel: '-', outcome: 'ENQUEUE_ERROR', reason: enqueueError.message });
      continue;
    }
    enqueued += Number((enqueueResult as { inserted?: number } | null)?.inserted ?? 0);
  }

  // 2. Mengirim pengingat yang masih PENDING.
  const { data: pending, error: pendingError } = await admin
    .from('reminders')
    .select('id, organization_id, contract_id, installment_id, customer_id, offset_key, channel, scheduled_for, attempts')
    .eq('status', 'PENDING')
    .lte('scheduled_for', asOf)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (pendingError) {
    return new Response(JSON.stringify({ error: `Gagal memuat antrean: ${pendingError.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  for (const reminder of (pending ?? []) as ReminderRecord[]) {
    result.processed += 1;

    const { data: settings } = await admin
      .from('app_settings')
      .select('integrations')
      .eq('organization_id', reminder.organization_id)
      .maybeSingle();

    const integrations = (settings?.integrations ?? {}) as Record<string, unknown>;
    const simulationMode = integrations.reminder_simulation_mode !== false;

    const { data: installment } = await admin
      .from('installments')
      .select('installment_number, due_date, total_due, paid_amount, contract_id')
      .eq('id', reminder.installment_id)
      .maybeSingle();

    const { data: contract } = await admin
      .from('credit_contracts')
      .select('contract_number, customer_id')
      .eq('id', reminder.contract_id)
      .maybeSingle();

    const { data: customer } = await admin
      .from('customers')
      .select('full_name, phone, email, remind_enabled')
      .eq('id', reminder.customer_id)
      .maybeSingle();

    if (!installment || !contract || !customer) {
      await admin.rpc('rpc_mark_reminder', {
        p_reminder_id: reminder.id,
        p_status: 'FAILED',
        p_error: 'Data cicilan/kontrak/pelanggan tidak lengkap.',
      });
      result.failed += 1;
      result.details.push({ reminder_id: reminder.id, channel: reminder.channel, outcome: 'FAILED', reason: 'data tidak lengkap' });
      continue;
    }

    if (customer.remind_enabled === false) {
      await admin.rpc('rpc_mark_reminder', {
        p_reminder_id: reminder.id,
        p_status: 'SKIPPED',
        p_error: 'Pelanggan menonaktifkan pengingat.',
      });
      result.skipped += 1;
      result.details.push({ reminder_id: reminder.id, channel: reminder.channel, outcome: 'SKIPPED', reason: 'pelanggan menonaktifkan pengingat' });
      continue;
    }

    const message = buildMessage({
      customerName: customer.full_name,
      businessName: organizationNames.get(reminder.organization_id) ?? 'KreditKu',
      contractNumber: contract.contract_number,
      installmentNumber: installment.installment_number,
      dueDate: installment.due_date,
      amount: Math.max(0, Number(installment.total_due) - Number(installment.paid_amount)),
      offsetKey: reminder.offset_key,
    });

    if (dryRun) {
      result.details.push({ reminder_id: reminder.id, channel: reminder.channel, outcome: 'DRY_RUN' });
      continue;
    }

    let outcome: { ok: boolean; reason?: string };

    if (reminder.channel === 'IN_APP') {
      const { error } = await admin.from('notifications').insert({
        organization_id: reminder.organization_id,
        type: 'INSTALLMENT_DUE',
        title: `Pengingat angsuran ${contract.contract_number}`,
        body: `Angsuran ke-${installment.installment_number} jatuh tempo ${formatDateId(installment.due_date)}.`,
        link: `/app/contracts/${reminder.contract_id}`,
        entity_type: 'credit_contracts',
        entity_id: reminder.contract_id,
      });
      outcome = error ? { ok: false, reason: error.message } : { ok: true };
    } else if (reminder.channel === 'WHATSAPP') {
      if (!customer.phone) outcome = { ok: false, reason: 'Nomor WhatsApp pelanggan tidak tersedia.' };
      else if (simulationMode) outcome = { ok: false, reason: 'Mode simulasi aktif — pesan tidak dikirim.' };
      else outcome = await sendWhatsapp(customer.phone, message);
    } else {
      if (!customer.email) outcome = { ok: false, reason: 'Email pelanggan tidak tersedia.' };
      else if (simulationMode) outcome = { ok: false, reason: 'Mode simulasi aktif — pesan tidak dikirim.' };
      else outcome = await sendEmail(customer.email, `Pengingat angsuran ${contract.contract_number}`, message);
    }

    if (outcome.ok) {
      await admin.rpc('rpc_mark_reminder', { p_reminder_id: reminder.id, p_status: 'SENT', p_error: null });
      result.sent += 1;
      result.details.push({ reminder_id: reminder.id, channel: reminder.channel, outcome: 'SENT' });
    } else {
      const shouldSkip = /belum dikonfigurasi|Mode simulasi|tidak tersedia/.test(outcome.reason ?? '');
      await admin.rpc('rpc_mark_reminder', {
        p_reminder_id: reminder.id,
        p_status: shouldSkip ? 'SKIPPED' : 'FAILED',
        p_error: outcome.reason ?? 'Kesalahan tidak diketahui.',
      });
      if (shouldSkip) result.skipped += 1;
      else result.failed += 1;
      result.details.push({
        reminder_id: reminder.id,
        channel: reminder.channel,
        outcome: shouldSkip ? 'SKIPPED' : 'FAILED',
        reason: outcome.reason,
      });
    }
  }

  return new Response(
    JSON.stringify({
      as_of: asOf,
      dry_run: dryRun,
      enqueued,
      ...result,
      note: 'Pengingat yang SKIPPED tidak dikirim. Periksa konfigurasi kanal pada Pengaturan → Integrasi.',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
