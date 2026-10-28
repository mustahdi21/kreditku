/**
 * db.mjs — Pembantu koneksi PostgreSQL untuk skrip konfigurasi/verifikasi.
 *
 * Digunakan HANYA oleh proses lokal/CI (bukan frontend). Koneksi memakai
 * connection string dari variabel lingkungan dan tidak pernah dicatat.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

/**
 * Tabel bisnis yang WAJIB ada beserta ekspektasi RLS.
 * Daftar ini menjadi kontrak verifikasi `npm run db:check`.
 */
export const REQUIRED_TABLES = [
  'organizations',
  'profiles',
  'organization_members',
  'customers',
  'credit_products',
  'app_settings',
  'number_sequences',
  'credit_applications',
  'credit_application_status_history',
  'credit_application_documents',
  'credit_contracts',
  'credit_contract_amendments',
  'installments',
  'payments',
  'payment_allocations',
  'payment_reversals',
  'penalties',
  'reminder_templates',
  'reminders',
  'notifications',
  'audit_logs',
  'document_templates',
];

export const REQUIRED_VIEWS = [
  'v_customer_summary',
  'v_contract_summary',
  'v_installment_details',
  'v_overdue_installments',
  'v_due_today',
  'v_upcoming_due',
  'v_aging_report',
  'v_collection_daily',
  'v_collection_monthly',
  'v_disbursement_report',
  'v_payment_breakdown',
  'v_officer_performance',
];

export const REQUIRED_FUNCTIONS = [
  'fn_next_number',
  'fn_build_schedule',
  'rpc_submit_application',
  'rpc_decide_application',
  'rpc_post_payment',
  'rpc_reverse_payment',
  'rpc_apply_penalties',
  'rpc_waive_penalty',
  'rpc_enqueue_reminders',
  'rpc_dashboard_metrics',
  'rpc_update_settings',
  'rpc_amend_contract',
  'rpc_cancel_contract',
  'rpc_bootstrap_super_admin',
];

/** Membuka koneksi PostgreSQL. Modul `pg` dimuat secara dinamis. */
export async function connect(connectionString) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error(
      'Modul "pg" belum terpasang. Jalankan: npm install (devDependency pg disertakan pada package.json).',
    );
  }
  const { Client } = pg.default ?? pg;
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    application_name: 'kreditku-script',
  });
  await client.connect();
  return client;
}

/** Daftar berkas migrasi dalam urutan nama (kronologis). */
export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/**
 * Menjalankan seluruh migrasi dalam satu transaksi.
 * Migrasi KreditKu bersifat idempoten sehingga aman dijalankan berulang.
 */
export async function applyMigrations({ connectionString, onProgress } = {}) {
  const client = await connect(connectionString);
  const applied = [];
  try {
    await client.query('begin');
    for (const file of listMigrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      applied.push(file);
      onProgress?.(file);
    }
    await client.query('commit');
    return { applied };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Memeriksa struktur database: tabel, view, fungsi, RLS, dan jumlah kebijakan.
 * Tidak mengembalikan data bisnis apa pun.
 */
export async function checkDatabase({ connectionString }) {
  const client = await connect(connectionString);
  try {
    const tables = await client.query(
      `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const views = await client.query(
      `select c.relname as name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'`,
    );
    const functions = await client.query(
      `select p.proname as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );
    const policies = await client.query(
      `select tablename, policyname, cmd, roles::text as roles
         from pg_policies where schemaname = 'public'`,
    );

    const tableMap = new Map(tables.rows.map((row) => [row.name, row]));
    const viewSet = new Set(views.rows.map((row) => row.name));
    const functionSet = new Set(functions.rows.map((row) => row.name));

    const missingTables = REQUIRED_TABLES.filter((name) => !tableMap.has(name));
    const missingViews = REQUIRED_VIEWS.filter((name) => !viewSet.has(name));
    const missingFunctions = REQUIRED_FUNCTIONS.filter((name) => !functionSet.has(name));
    const rlsFailures = REQUIRED_TABLES.filter((name) => tableMap.has(name) && !tableMap.get(name).rls);

    const policiesByTable = new Map();
    for (const row of policies.rows) {
      const list = policiesByTable.get(row.tablename) ?? [];
      list.push(row);
      policiesByTable.set(row.tablename, list);
    }

    const tablesWithoutPolicy = REQUIRED_TABLES.filter(
      (name) => tableMap.has(name) && name !== 'number_sequences' && (policiesByTable.get(name)?.length ?? 0) === 0,
    );

    const deletePolicies = policies.rows.filter((row) => row.cmd === 'DELETE').map((row) => row.tablename);

    return {
      totalBusinessTables: REQUIRED_TABLES.length,
      tablesWithRls: REQUIRED_TABLES.length - rlsFailures.length,
      policyCount: policies.rows.length,
      policiesByTable,
      missingTables,
      missingViews,
      missingFunctions,
      rlsFailures,
      tablesWithoutPolicy,
      deletePolicies,
    };
  } finally {
    await client.end();
  }
}

/**
 * Menjalankan vektor uji kesesuaian rumus bunga di database.
 * Nilai pembanding berasal dari implementasi TypeScript (sumber pratinjau di UI).
 */
export async function runScheduleVectors(connectionString, vectors) {
  const client = await connect(connectionString);
  try {
    const results = [];
    for (const vector of vectors) {
      const query = `
        select installment_number, principal, interest, fees, total_due, upfront_amount, due_date
          from public.fn_build_schedule(
            $1::bigint, $2::integer, $3::interest_method, $4::numeric, $5::rate_basis,
            $6::payment_frequency, $7::bigint, $8::admin_fee_position, $9::bigint,
            $10::date, $11::due_date_adjustment, $12::date[], $13::integer[]
          )
         order by installment_number`;
      const params = [
        vector.principal,
        vector.tenor,
        vector.method,
        vector.rateBp,
        vector.rateBasis,
        vector.frequency,
        vector.adminFee ?? 0,
        vector.adminFeePosition ?? 'UPFRONT',
        vector.otherFeePerPeriod ?? 0,
        vector.firstDueDate,
        vector.dueDateAdjustment ?? 'NONE',
        vector.holidays ?? [],
        vector.weekendDays ?? [0, 6],
      ];
      const result = await client.query(query, params);
      results.push({ vector, rows: result.rows });
    }
    return results;
  } finally {
    await client.end();
  }
}

/** Statistik ringkas (tanpa data pribadi) untuk laporan verifikasi. */
export async function collectRowCounts(connectionString) {
  const client = await connect(connectionString);
  try {
    const counts = {};
    for (const table of ['organizations', 'customers', 'credit_contracts', 'installments', 'payments', 'penalties', 'audit_logs']) {
      const result = await client.query(`select count(*)::int as total from public.${table}`);
      counts[table] = result.rows[0].total;
    }
    return counts;
  } finally {
    await client.end();
  }
}
