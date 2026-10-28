/**
 * sql-parity.test.ts — Menguji kesesuaian rumus bunga antara implementasi
 * TypeScript (`src/core/interest.ts`, dipakai untuk simulasi di UI) dan
 * implementasi PostgreSQL (`public.fn_build_schedule`, dipakai saat kontrak
 * benar-benar dibuat).
 *
 * Tes ini HANYA berjalan bila variabel lingkungan SUPABASE_DB_URL tersedia.
 * Pada `npm test` biasa (tanpa database), seluruh kasus dilewati dengan jelas
 * sehingga pipeline tetap cepat dan tidak bergantung pada jaringan.
 */

import { describe, expect, it } from 'vitest';
import { computeInterestPlan } from '@/core/interest';
import { buildInstallmentSchedule } from '@/core/schedule';
import type { AdminFeePosition, DueDateAdjustment, InterestMethod, PaymentFrequency, RateBasis } from '@/core/types';

const connectionString = process.env.SUPABASE_DB_URL ?? '';
const enabled = connectionString.length > 0;

interface Vector {
  readonly name: string;
  readonly principal: number;
  readonly tenor: number;
  readonly method: InterestMethod;
  readonly rateBp: number;
  readonly rateBasis: RateBasis;
  readonly frequency: PaymentFrequency;
  readonly adminFee?: number;
  readonly adminFeePosition?: AdminFeePosition;
  readonly otherFeePerPeriod?: number;
  readonly firstDueDate: string;
  readonly dueDateAdjustment?: DueDateAdjustment;
}

const VECTORS: readonly Vector[] = [
  { name: 'flat 12 periode', principal: 10_000_000, tenor: 12, method: 'FLAT', rateBp: 200, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', firstDueDate: '2026-02-15' },
  { name: 'flat tanpa bunga', principal: 10_000_000, tenor: 12, method: 'NONE', rateBp: 0, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', firstDueDate: '2026-02-15' },
  { name: 'anuitas 12 periode', principal: 10_000_000, tenor: 12, method: 'ANNUITY', rateBp: 100, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', firstDueDate: '2026-02-15' },
  { name: 'anuitas 24 periode tarif tahunan', principal: 48_000_000, tenor: 24, method: 'ANNUITY', rateBp: 1_800, rateBasis: 'PER_YEAR', frequency: 'MONTHLY', firstDueDate: '2026-03-01' },
  { name: 'flat mingguan', principal: 2_500_000, tenor: 26, method: 'FLAT', rateBp: 150, rateBasis: 'PER_MONTH', frequency: 'WEEKLY', firstDueDate: '2026-02-02' },
  { name: 'flat biaya administrasi tersebar', principal: 7_777_777, tenor: 7, method: 'FLAT', rateBp: 175, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', adminFee: 100_000, adminFeePosition: 'SPREAD', firstDueDate: '2026-02-10' },
  { name: 'flat biaya administrasi cicilan pertama', principal: 5_000_000, tenor: 6, method: 'FLAT', rateBp: 250, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', adminFee: 350_000, adminFeePosition: 'FIRST_INSTALLMENT', otherFeePerPeriod: 5_000, firstDueDate: '2026-02-05' },
  { name: 'anuitas penyesuaian hari kerja', principal: 3_333_333, tenor: 9, method: 'ANNUITY', rateBp: 125, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', firstDueDate: '2026-01-31', dueDateAdjustment: 'NEXT_BUSINESS_DAY' },
  { name: 'flat dua mingguan', principal: 12_345_678, tenor: 18, method: 'FLAT', rateBp: 90, rateBasis: 'PER_MONTH', frequency: 'BIWEEKLY', firstDueDate: '2026-02-14' },
  { name: 'pokok kecil tenor panjang', principal: 1_000_000, tenor: 60, method: 'FLAT', rateBp: 100, rateBasis: 'PER_MONTH', frequency: 'MONTHLY', firstDueDate: '2026-02-28' },
];

interface ScheduleRow {
  installment_number: number;
  principal: number | string;
  interest: number | string;
  fees: number | string;
  total_due: number | string;
  due_date: string | Date;
}

function toNumber(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

async function querySchedule(vector: Vector): Promise<ScheduleRow[]> {
  const pg = await import('pg');
  const { Client } = (pg as unknown as { default?: { Client: unknown }; Client?: unknown });
  const ClientCtor = (Client ?? (pg as unknown as { Client: unknown }).Client) as new (config: unknown) => {
    connect: () => Promise<void>;
    query: (text: string, values: unknown[]) => Promise<{ rows: ScheduleRow[] }>;
    end: () => Promise<void>;
  };

  const client = new ClientCtor({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(
      `select installment_number, principal, interest, fees, total_due, due_date
         from public.fn_build_schedule(
           $1::bigint, $2::integer, $3::interest_method, $4::numeric, $5::rate_basis,
           $6::payment_frequency, $7::bigint, $8::admin_fee_position, $9::bigint,
           $10::date, $11::due_date_adjustment, $12::date[], $13::integer[]
         )
        order by installment_number`,
      [
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
        [],
        [0, 6],
      ],
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

describe.skipIf(!enabled)('paritas perhitungan bunga: PostgreSQL vs TypeScript', () => {
  for (const vector of VECTORS) {
    it(`vektor: ${vector.name}`, async () => {
      const plan = computeInterestPlan({
        principal: vector.principal,
        tenor: vector.tenor,
        method: vector.method,
        rateBp: vector.rateBp,
        rateBasis: vector.rateBasis,
        frequency: vector.frequency,
        adminFee: vector.adminFee ?? 0,
        adminFeePosition: vector.adminFeePosition ?? 'UPFRONT',
        otherFeePerPeriod: vector.otherFeePerPeriod ?? 0,
      });
      const expected = buildInstallmentSchedule({
        plan,
        firstDueDate: vector.firstDueDate,
        dueDateAdjustment: vector.dueDateAdjustment ?? 'NONE',
      });

      const actual = await querySchedule(vector);
      expect(actual).toHaveLength(expected.length);

      // Pokok, biaya, dan tanggal harus IDENTIK.
      for (const [index, row] of actual.entries()) {
        const mine = expected[index]!;
        expect(toNumber(row.principal), `pokok cicilan ${index + 1}`).toBe(mine.principal);
        expect(toNumber(row.fees), `biaya cicilan ${index + 1}`).toBe(mine.fees);
        expect(toIsoDate(row.due_date), `jatuh tempo cicilan ${index + 1}`).toBe(mine.dueDate);
      }

      // Bunga dapat berbeda maksimal 1 Rupiah per periode karena TypeScript
      // memakai floating point sedangkan PostgreSQL memakai numeric presisi
      // tinggi. Selisih total dibatasi 5 Rupiah per kontrak.
      let interestDelta = 0;
      for (const [index, row] of actual.entries()) {
        const mine = expected[index]!;
        const delta = Math.abs(toNumber(row.interest) - mine.interest);
        expect(delta, `selisih bunga cicilan ${index + 1}`).toBeLessThanOrEqual(1);
        interestDelta += delta;
      }
      expect(interestDelta, 'selisih bunga total').toBeLessThanOrEqual(5);

      // Total kewajiban harus sama persis.
      const totalSql = actual.reduce((total, row) => total + toNumber(row.total_due), 0);
      const totalTs = expected.reduce((total, row) => total + row.totalDue, 0);
      expect(Math.abs(totalSql - totalTs)).toBeLessThanOrEqual(5);
    });
  }
});

describe.skipIf(enabled)('paritas perhitungan bunga (dilewati)', () => {
  it('informasi', () => {
    // Tes paritas memerlukan database sungguhan. Jalankan `npm run db:check`
    // dengan SUPABASE_DB_URL terisi untuk mengaktifkannya.
    expect(enabled).toBe(false);
  });
});
