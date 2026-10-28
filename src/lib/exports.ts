/**
 * exports.ts — Ekspor data ke CSV, Excel (XLSX), dan PDF, plus halaman cetak.
 *
 * Semua ekspor menerima data yang sudah diformat (string) sehingga satuan
 * Rupiah dan format tanggal konsisten dengan tampilan aplikasi.
 * Modul pustaka berat (xlsx, jspdf) diimpor secara dinamis agar hanya dimuat
 * ketika pengguna benar-benar mengekspor.
 */

import { formatDateNumericId } from '@/lib/date';

/** Kolom definisi ekspor. */
export interface ExportColumn<T> {
  readonly key: keyof T & string;
  readonly header: string;
  readonly width?: number;
  readonly align?: 'left' | 'right' | 'center';
}

/** Metadata ekspor untuk penamaan berkas dan judul dokumen. */
export interface ExportMeta {
  readonly filename: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly generatedBy?: string;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

function stamp(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${date}-${time}`;
}

/** Memicu unduhan berkas dari Blob di browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Mengubah nilai menjadi teks sel CSV.
 * Menggunakan pemisah titik koma agar ramah Excel dengan locale Indonesia,
 * serta tanda kutip ganda yang di-escape sesuai standar CSV.
 */
function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Membentuk isi CSV dari baris data dan definisi kolom. */
export function buildCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  meta?: ExportMeta,
): string {
  const lines: string[] = [];
  if (meta?.title) lines.push(toCsvCell(meta.title));
  if (meta?.subtitle) lines.push(toCsvCell(meta.subtitle));
  lines.push(toCsvCell(`Diekspor: ${formatDateNumericId(new Date().toISOString().slice(0, 10))}`));
  lines.push('');
  lines.push(columns.map((column) => toCsvCell(column.header)).join(';'));
  for (const row of rows) {
    lines.push(columns.map((column) => toCsvCell(row[column.key])).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/** Mengekspor data ke berkas CSV. */
export function exportCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  meta: ExportMeta,
): void {
  const csv = buildCsv(rows, columns, meta);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${sanitizeFilename(meta.filename)}-${stamp()}.csv`);
}

/** Mengekspor data ke berkas Excel (XLSX) dengan lebar kolom yang wajar. */
export async function exportXlsx<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  meta: ExportMeta,
): Promise<void> {
  const XLSX = await import('xlsx');
  const header = columns.map((column) => column.header);
  const body = rows.map((row) => columns.map((column) => row[column.key] ?? ''));
  const sheetData: (string | number)[][] = [];

  if (meta.title) sheetData.push([meta.title]);
  if (meta.subtitle) sheetData.push([meta.subtitle]);
  sheetData.push([`Diekspor: ${formatDateNumericId(new Date().toISOString().slice(0, 10))}`]);
  sheetData.push([]);
  sheetData.push(header);
  for (const row of body) sheetData.push(row as (string | number)[]);

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = columns.map((column) => ({ wch: column.width ?? 20 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `${sanitizeFilename(meta.filename)}-${stamp()}.xlsx`);
}

/** Mengekspor data ke berkas PDF dengan kop laporan sederhana. */
export async function exportPdf<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  meta: ExportMeta,
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;
  const orientation = columns.length > 6 ? 'landscape' : 'portrait';

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  let cursorY = 15;

  if (meta.title) {
    doc.setFontSize(14);
    doc.text(meta.title, 14, cursorY);
    cursorY += 7;
  }
  if (meta.subtitle) {
    doc.setFontSize(10);
    doc.text(meta.subtitle, 14, cursorY);
    cursorY += 5;
  }
  doc.setFontSize(8);
  doc.text(
    `Dicetak: ${formatDateNumericId(new Date().toISOString().slice(0, 10))}${meta.generatedBy ? ` • Oleh: ${meta.generatedBy}` : ''}`,
    14,
    cursorY,
  );
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => String(row[column.key] ?? ''))),
    styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 10, right: 10 },
    columnStyles: Object.fromEntries(
      columns.map((column, index) => [index, { halign: column.align ?? 'left' }]),
    ),
  });

  doc.save(`${sanitizeFilename(meta.filename)}-${stamp()}.pdf`);
}

/**
 * Membuka jendela cetak berisi tabel HTML.
 * Dipakai untuk "halaman siap cetak" (kuitansi, kontrak, laporan).
 */
export function printHtml(title: string, innerHtml: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    throw new Error('Popup diblokir browser. Izinkan popup untuk mencetak dokumen.');
  }
  win.document.write(`<!doctype html>
<html lang="id"><head><meta charset="utf-8" /><title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111827; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #eef2ff; }
  .muted { color: #6b7280; font-size: 12px; }
  .right { text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; }
  .footer { margin-top: 32px; font-size: 11px; color: #6b7280; }
  @media print { body { margin: 0; } }
</style></head>
<body>${innerHtml}
<script>window.onload = function () { window.print(); };</script>
</body></html>`);
  win.document.close();
}
