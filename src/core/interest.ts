/**
 * interest.ts — Perhitungan bunga dan pembentukan rencana angsuran.
 *
 * METODE YANG DIDUKUNG (tidak dicampur satu sama lain)
 * ---------------------------------------------------
 * 1. NONE    — Tanpa bunga. Pokok dibagi rata ke seluruh periode.
 * 2. FLAT    — Bunga dihitung dari POKOK AWAL dan bernilai sama setiap periode.
 *              totalBunga = bungaPerPeriode × tenor.
 * 3. ANNUITY — Bunga efektif/anuitas. Bunga dihitung dari SISA POKOK berjalan,
 *              sehingga angsuran total tetap tetapi komposisi bunga menurun.
 *              A = P × i ÷ (1 − (1+i)^−n)
 *
 * KONVENSI TARIF
 * --------------
 * Tarif disimpan dalam BASIS POINT (1% = 100 bp) beserta basisnya
 * (per bulan atau per tahun). Konversi ke tarif per periode mengikuti
 * jumlah periode per tahun dari frekuensi pembayaran:
 *
 *   MONTHLY   → 12 periode/tahun
 *   BIWEEKLY  → 26 periode/tahun
 *   WEEKLY    → 52 periode/tahun
 *   DAILY     → 365 periode/tahun
 *
 *   tarif per periode (PER_MONTH) = bp × 12 ÷ periodePerTahun
 *   tarif per periode (PER_YEAR)  = bp ÷ periodePerTahun
 *
 * Contoh: 2% per bulan pada cicilan mingguan → 2000 bp × 12 ÷ 52 ≈ 461,54 bp
 * (≈ 0,046154% per minggu, proporsional terhadap sebulan).
 *
 * PEMBULATAN
 * ----------
 * Setiap komponen dibulatkan ke Rupiah bulat. Agar penjumlahan komponen selalu
 * sama dengan total yang dijanjikan, komponen POKOK pada periode terakhir
 * menyerap seluruh selisih pembulatan (lihat `reconcileFinalRow`).
 */

import {
  applyRate,
  assertPositive,
  assertRupiah,
  MoneyError,
  roundRupiah,
  splitEvenly,
  sumRupiah,
  type Rupiah,
  type RoundingMode,
  DEFAULT_ROUNDING,
  ZERO,
} from '@/lib/money';
import type {
  AdminFeePosition,
  InterestMethod,
  PaymentFrequency,
  RateBasis,
} from '@/core/types';

/** Jumlah periode pembayaran dalam satu tahun untuk setiap frekuensi. */
export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  BIWEEKLY: 26,
  WEEKLY: 52,
  DAILY: 365,
};

/** Jumlah bulan per periode (dipakai penerjemah tanggal, bukan perhitungan uang). */
export const MONTHS_PER_PERIOD: Record<PaymentFrequency, number> = {
  MONTHLY: 1,
  BIWEEKLY: 0,
  WEEKLY: 0,
  DAILY: 0,
};

/** Input tunggal untuk seluruh perhitungan bunga. */
export interface InterestInput {
  /** Pokok pembiayaan setelah dikurangi uang muka, dalam Rupiah. */
  readonly principal: Rupiah;
  /** Jumlah periode angsuran (tenor). Harus bilangan bulat positif. */
  readonly tenor: number;
  /** Metode bunga. */
  readonly method: InterestMethod;
  /** Tarif dalam basis point (1% = 100 bp). Diabaikan bila method = NONE. */
  readonly rateBp: number;
  /** Basis tarif: per bulan atau per tahun. */
  readonly rateBasis: RateBasis;
  /** Frekuensi pembayaran. */
  readonly frequency: PaymentFrequency;
  /** Biaya administrasi, dalam Rupiah. */
  readonly adminFee?: Rupiah;
  /** Posisi pembebanan biaya administrasi. Default UPFRONT. */
  readonly adminFeePosition?: AdminFeePosition;
  /** Biaya lain yang dibebankan setiap periode (mis. materai/provisi), dalam Rupiah. */
  readonly otherFeePerPeriod?: Rupiah;
  /** Mode pembulatan. Default HALF_UP. */
  readonly rounding?: RoundingMode;
}

/** Satu baris rencana angsuran tanpa tanggal jatuh tempo. */
export interface PlanRow {
  readonly installmentNumber: number;
  readonly principal: Rupiah;
  readonly interest: Rupiah;
  readonly fees: Rupiah;
  readonly totalDue: Rupiah;
}

/** Hasil perhitungan lengkap sebuah kredit. */
export interface InterestPlan {
  readonly principal: Rupiah;
  readonly tenor: number;
  readonly method: InterestMethod;
  readonly rateBp: number;
  readonly rateBasis: RateBasis;
  readonly frequency: PaymentFrequency;
  /** Tarif per periode dalam basis point, hasil konversi. */
  readonly ratePerPeriodBp: number;
  /** Tarif tahunan efektif dalam basis point (bila dinyatakan per bulan → ×12). */
  readonly annualRateBp: number;
  /** Jumlah bunga per periode (bernilai sama untuk metode FLAT). */
  readonly interestPerPeriod: Rupiah;
  readonly totalInterest: Rupiah;
  readonly totalFees: Rupiah;
  readonly adminFee: Rupiah;
  readonly upfrontAmount: Rupiah;
  readonly totalPayable: Rupiah;
  readonly installmentAmount: Rupiah;
  /** Angsuran periode pertama (dapat berbeda karena biaya admin). */
  readonly firstInstallmentAmount: Rupiah;
  /** Angsuran periode terakhir (menyerap selisih pembulatan). */
  readonly lastInstallmentAmount: Rupiah;
  readonly rows: readonly PlanRow[];
}

/** Menghitung jumlah periode per tahun untuk sebuah frekuensi. */
export function periodsPerYear(frequency: PaymentFrequency): number {
  const value = PERIODS_PER_YEAR[frequency];
  if (!value) throw new MoneyError(`Frekuensi pembayaran tidak dikenal: ${String(frequency)}`);
  return value;
}

/**
 * Mengonversi tarif ke basis point per periode pembayaran.
 * Hasil dapat berupa pecahan (mis. 461,538... bp untuk cicilan mingguan),
 * karena pembulatan baru dilakukan pada nominal uang.
 */
export function toRatePerPeriodBp(
  rateBp: number,
  rateBasis: RateBasis,
  frequency: PaymentFrequency,
): number {
  if (!Number.isFinite(rateBp)) throw new MoneyError('Tarif bunga tidak valid.');
  if (rateBp < 0) throw new MoneyError('Tarif bunga tidak boleh negatif.');
  const ppy = periodsPerYear(frequency);
  return rateBasis === 'PER_YEAR' ? rateBp / ppy : (rateBp * 12) / ppy;
}

/** Tarif tahunan dalam basis point. */
export function toAnnualRateBp(rateBp: number, rateBasis: RateBasis): number {
  if (!Number.isFinite(rateBp) || rateBp < 0) throw new MoneyError('Tarif bunga tidak valid.');
  return rateBasis === 'PER_MONTH' ? rateBp * 12 : rateBp;
}

/** Validasi input perhitungan bunga. Melempar MoneyError bila tidak konsisten. */
export function validateInterestInput(input: InterestInput): void {
  assertRupiah(input.principal, 'pokok pembiayaan');
  if (input.principal < 0) throw new MoneyError('Pokok pembiayaan tidak boleh negatif.');
  if (!Number.isInteger(input.tenor) || input.tenor <= 0) {
    throw new MoneyError('Tenor harus berupa bilangan bulat positif.');
  }
  if (input.tenor > 600) throw new MoneyError('Tenor melebihi batas wajar (maksimum 600 periode).');
  if (input.method !== 'NONE') {
    if (!Number.isFinite(input.rateBp) || input.rateBp < 0) {
      throw new MoneyError('Tarif bunga tidak valid.');
    }
    if (input.rateBp > 10_000) throw new MoneyError('Tarif bunga melebihi 100% per basis yang dipilih.');
  }
  if (input.adminFee !== undefined && input.adminFee < 0) {
    throw new MoneyError('Biaya administrasi tidak boleh negatif.');
  }
  if (input.otherFeePerPeriod !== undefined && input.otherFeePerPeriod < 0) {
    throw new MoneyError('Biaya tambahan tidak boleh negatif.');
  }
}

/**
 * Menghitung rencana angsuran lengkap untuk sebuah kredit.
 *
 * Fungsi ini MURNI: tidak menyentuh database, tidak menyentuh waktu sistem.
 * Seluruh tanggal ditentukan oleh `schedule.ts`.
 */
export function computeInterestPlan(input: InterestInput): InterestPlan {
  validateInterestInput(input);

  const {
    principal,
    tenor,
    method,
    rateBasis,
    frequency,
    adminFee = ZERO,
    adminFeePosition = 'UPFRONT',
    otherFeePerPeriod = ZERO,
    rounding = DEFAULT_ROUNDING,
  } = input;

  if (method === 'NONE' && input.rateBp > 0) {
    // Metode NONE sengaja mengabaikan tarif; ini bukan error, hanya dokumentasi perilaku.
  }

  const effectiveRateBp = method === 'NONE' ? 0 : input.rateBp;
  const ratePerPeriodBp = method === 'NONE' ? 0 : toRatePerPeriodBp(effectiveRateBp, rateBasis, frequency);
  const annualRateBp = method === 'NONE' ? 0 : toAnnualRateBp(effectiveRateBp, rateBasis);

  const adminPortion = distributeAdminFee(adminFee, adminFeePosition, tenor, rounding);

  let coreRows: { principal: Rupiah; interest: Rupiah }[];
  if (method === 'FLAT') {
    coreRows = buildFlatRows(principal, tenor, ratePerPeriodBp, rounding);
  } else if (method === 'ANNUITY') {
    coreRows = buildAnnuityRows(principal, tenor, ratePerPeriodBp, rounding);
  } else {
    coreRows = buildNoInterestRows(principal, tenor, rounding);
  }

  const rows: PlanRow[] = coreRows.map((row, index) => {
    const fees = otherFeePerPeriod + adminPortion.perPeriod[index]!;
    return {
      installmentNumber: index + 1,
      principal: row.principal,
      interest: row.interest,
      fees,
      totalDue: sumRupiah([row.principal, row.interest, fees]),
    };
  });

  const totalInterest = sumRupiah(rows.map((row) => row.interest));
  const totalFees = sumRupiah(rows.map((row) => row.fees));
  const totalPrincipal = sumRupiah(rows.map((row) => row.principal));

  if (totalPrincipal !== principal) {
    throw new MoneyError(
      `Rekonsiliasi gagal: total pokok jadwal (${totalPrincipal}) tidak sama dengan pokok pembiayaan (${principal}).`,
    );
  }

  const totalPayable = sumRupiah([principal, totalInterest, totalFees]);
  const firstInstallmentAmount = rows[0]!.totalDue;
  const lastInstallmentAmount = rows[rows.length - 1]!.totalDue;
  const installmentAmount =
    rows.length > 1
      ? roundRupiah(
          rows.slice(0, rows.length - 1).reduce((acc, row) => acc + row.totalDue, 0) / (rows.length - 1),
          rounding,
        )
      : firstInstallmentAmount;

  return {
    principal,
    tenor,
    method,
    rateBp: effectiveRateBp,
    rateBasis,
    frequency,
    ratePerPeriodBp,
    annualRateBp,
    interestPerPeriod: method === 'FLAT' ? (rows[0]?.interest ?? ZERO) : ZERO,
    totalInterest,
    totalFees,
    adminFee,
    upfrontAmount: adminPortion.upfront,
    totalPayable,
    installmentAmount,
    firstInstallmentAmount,
    lastInstallmentAmount,
    rows,
  };
}

/** Bunga nol; pokok dibagi rata dengan periode terakhir menyerap selisih. */
function buildNoInterestRows(
  principal: Rupiah,
  tenor: number,
  rounding: RoundingMode,
): { principal: Rupiah; interest: Rupiah }[] {
  return splitEvenly(principal, tenor, rounding).map((part) => ({ principal: part, interest: ZERO }));
}

/** Bunga flat: bunga per periode konstan dihitung dari pokok awal. */
function buildFlatRows(
  principal: Rupiah,
  tenor: number,
  ratePerPeriodBp: number,
  rounding: RoundingMode,
): { principal: Rupiah; interest: Rupiah }[] {
  const interestPerPeriod = applyRate(principal, ratePerPeriodBp, 1, rounding);
  const principalParts = splitEvenly(principal, tenor, rounding);
  return principalParts.map((part) => ({ principal: part, interest: interestPerPeriod }));
}

/**
 * Bunga efektif (anuitas): bunga dihitung dari sisa pokok berjalan.
 * Angsuran total dijaga tetap; periode terakhir menyerap sisa pokok.
 */
function buildAnnuityRows(
  principal: Rupiah,
  tenor: number,
  ratePerPeriodBp: number,
  rounding: RoundingMode,
): { principal: Rupiah; interest: Rupiah }[] {
  if (principal === 0) {
    return Array.from({ length: tenor }, () => ({ principal: ZERO, interest: ZERO }));
  }
  const i = ratePerPeriodBp / 10_000;
  if (i <= 0) return buildNoInterestRows(principal, tenor, rounding);

  const annuity = (principal * i) / (1 - Math.pow(1 + i, -tenor));
  const basePayment = roundRupiah(annuity, rounding);
  if (basePayment <= 0) {
    throw new MoneyError('Angsuran hasil perhitungan tidak valid (nol atau negatif).');
  }

  const rows: { principal: Rupiah; interest: Rupiah }[] = [];
  let remaining = principal;

  for (let period = 1; period <= tenor; period += 1) {
    const interest = applyRate(remaining, ratePerPeriodBp, 1, rounding);
    let principalPart: Rupiah;

    if (period === tenor) {
      principalPart = remaining;
    } else {
      principalPart = basePayment - interest;
      if (principalPart < 0) principalPart = 0;
      if (principalPart > remaining) principalPart = remaining;
    }

    remaining -= principalPart;
    rows.push({ principal: principalPart, interest });
  }

  if (remaining !== 0) {
    // Selisih hanya mungkin terjadi bila tenor sangat panjang dan tingkat bunga sangat kecil.
    const last = rows[rows.length - 1]!;
    rows[rows.length - 1] = { principal: last.principal + remaining, interest: last.interest };
  }

  return rows;
}

/** Hasil distribusi biaya administrasi. */
interface AdminFeeDistribution {
  readonly upfront: Rupiah;
  readonly perPeriod: readonly Rupiah[];
}

/** Mendistribusikan biaya administrasi sesuai posisi pembebanannya. */
export function distributeAdminFee(
  adminFee: Rupiah,
  position: AdminFeePosition,
  tenor: number,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): AdminFeeDistribution {
  assertRupiah(adminFee, 'biaya administrasi');
  if (adminFee < 0) throw new MoneyError('Biaya administrasi tidak boleh negatif.');
  const empty = new Array<Rupiah>(tenor).fill(ZERO);
  if (adminFee === 0) return { upfront: ZERO, perPeriod: empty };

  switch (position) {
    case 'UPFRONT':
      return { upfront: adminFee, perPeriod: empty };
    case 'FIRST_INSTALLMENT': {
      const perPeriod = [...empty];
      perPeriod[0] = adminFee;
      return { upfront: ZERO, perPeriod };
    }
    case 'SPREAD': {
      const parts = splitEvenly(adminFee, tenor, rounding);
      return { upfront: ZERO, perPeriod: parts };
    }
    default:
      return { upfront: adminFee, perPeriod: empty };
  }
}

/**
 * Menghitung nilai pokok pembiayaan dari harga barang dan uang muka.
 * Melempar error bila uang muka melebihi harga barang.
 */
export function computeFinancedPrincipal(price: Rupiah, downPayment: Rupiah): Rupiah {
  assertRupiah(price, 'harga barang');
  assertRupiah(downPayment, 'uang muka');
  if (price < 0) throw new MoneyError('Harga barang tidak boleh negatif.');
  if (downPayment < 0) throw new MoneyError('Uang muka tidak boleh negatif.');
  if (downPayment > price) throw new MoneyError('Uang muka tidak boleh melebihi harga barang.');
  return price - downPayment;
}

/**
 * Ringkasan simulasi untuk ditampilkan pada simulator kredit.
 * Sengaja berupa struktur datar agar mudah dirender dan diuji.
 */
export interface SimulationSummary {
  readonly price: Rupiah;
  readonly downPayment: Rupiah;
  readonly principal: Rupiah;
  readonly tenor: number;
  readonly method: InterestMethod;
  readonly ratePerPeriodBp: number;
  readonly annualRateBp: number;
  readonly totalInterest: Rupiah;
  readonly adminFee: Rupiah;
  readonly otherFees: Rupiah;
  readonly upfrontAmount: Rupiah;
  readonly totalPayable: Rupiah;
  readonly installmentAmount: Rupiah;
  readonly firstInstallmentAmount: Rupiah;
  readonly lastInstallmentAmount: Rupiah;
  readonly rows: readonly PlanRow[];
}

/** Membuat ringkasan simulasi dari harga, uang muka, dan parameter kredit. */
export function simulateCredit(
  params: Omit<InterestInput, 'principal'> & { readonly price: Rupiah; readonly downPayment: Rupiah },
): SimulationSummary {
  const principal = computeFinancedPrincipal(params.price, params.downPayment);
  const plan = computeInterestPlan({ ...params, principal });
  assertPositive(plan.rows.length, 'jumlah angsuran');
  return {
    price: params.price,
    downPayment: params.downPayment,
    principal,
    tenor: plan.tenor,
    method: plan.method,
    ratePerPeriodBp: plan.ratePerPeriodBp,
    annualRateBp: plan.annualRateBp,
    totalInterest: plan.totalInterest,
    adminFee: plan.adminFee,
    otherFees: sumRupiah(plan.rows.map((row) => row.fees)),
    upfrontAmount: plan.upfrontAmount,
    totalPayable: plan.totalPayable,
    installmentAmount: plan.installmentAmount,
    firstInstallmentAmount: plan.firstInstallmentAmount,
    lastInstallmentAmount: plan.lastInstallmentAmount,
    rows: plan.rows,
  };
}

/** Penjelasan metode bunga dalam bahasa Indonesia, untuk ditampilkan ke pengguna. */
export function describeInterestMethod(method: InterestMethod): string {
  switch (method) {
    case 'NONE':
      return 'Tanpa bunga — pokok pembiayaan dibagi rata ke seluruh periode. Tidak ada tambahan biaya bunga.';
    case 'FLAT':
      return 'Bunga flat — bunga dihitung dari pokok awal dan jumlahnya sama setiap periode. Total bunga = bunga per periode × tenor.';
    case 'ANNUITY':
      return 'Bunga efektif (anuitas) — bunga dihitung dari sisa pokok berjalan sehingga total angsuran tetap, namun porsi bunga menurun setiap periode.';
    default:
      return 'Metode bunga tidak dikenal.';
  }
}
