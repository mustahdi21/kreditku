# Konvensi Frontend KreditKu

Dokumen ini adalah acuan wajib untuk setiap halaman/komponen baru.

## Bahasa & format

- Seluruh teks antarmuka: **Bahasa Indonesia** (baku, tidak kaku).
- Mata uang: Rupiah penuh tanpa desimal → gunakan `formatRupiah`, `MoneyText`.
- Tanggal: `formatDateShortId`, `formatDateId`, `formatDateTimeId` dari `@/lib/date`. Jangan memakai `toLocaleDateString` langsung.
- Angka: `tabular` class untuk kolom uang.
- Jangan menampilkan stack trace ke pengguna; gunakan `errorMessage(error)` dari `@/lib/errors`.

## Struktur berkas

```
src/pages/<domain>/<Name>Page.tsx      → halaman (default export)
src/components/data/…                  → tabel & komponen data
src/components/common/domain.tsx       → badge status, MoneyText, StatCard, PageHeader
src/components/layout/AppShell.tsx     → PageHeader diekspor dari sini
```

**Semua halaman wajib memakai `export default`** karena dimuat via `React.lazy`.

## Data

- Hanya boleh memakai fungsi dari `@/data/*`. JANGAN memanggil `supabase()` langsung dari halaman.
- Query: `useXxx()` dari React Query. Mutasi: `useYyy()`; setelah sukses tampilkan `notifySuccess` dan andalkan invalidasi yang sudah ada.
- Kesalahan mutasi: `notifyError(error)` dari `@/components/common/Toaster`.
- Jangan menampilkan angka palsu. Jika data belum dimuat → tampilkan skeleton/`loading` pada komponen, bukan angka 0 palsu.

## Izin

- Gunakan `useAuth().can('permission')` untuk menyembunyikan tombol aksi.
- Gunakan `<RequirePermission permission="…">` untuk halaman yang sensitif.
- Peringatan: ini hanya kosmetik; penegakan ada di RLS.

## Formulir

- `react-hook-form` + `zodResolver` dengan skema dari `@/core/validation`.
- Gunakan `FormField`, `FormGrid`, `MoneyInput`, `PercentInput`, `NumberInput`, `DateInput`, `OptionsSelect` dari `@/components/ui`.
- Tombol submit: `<Button type="submit" loading={form.formState.isSubmitting}>`.

## Komponen UI yang tersedia

Dari `@/components/ui`:
`Button, Input, Textarea, Label, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
Separator, Skeleton, Progress, Avatar, Spinner, EmptyState, ErrorState, TableSkeleton,
Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose,
Sheet, SheetContent, SheetTrigger, SheetTitle,
AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
AlertDialogAction, AlertDialogCancel, ConfirmDialog,
DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
Popover, PopoverTrigger, PopoverContent, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
Tabs, TabsList, TabsTrigger, TabsContent, Accordion, AccordionItem, AccordionTrigger, AccordionContent,
ScrollArea, FormField, FormGrid, OptionsSelect, Checkbox, Switch, SwitchRow, MoneyInput, NumberInput, PercentInput, DateInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue`

Dari `@/components/common/domain`:
`CustomerStatusBadge, InstallmentStatusBadge, ContractStatusBadge, ApplicationStatusBadge, PenaltyStatusBadge,
PaymentMethodBadge, ReminderChannelBadge, RoleBadge, MoneyText, DateText, StatCard, DetailRow, SectionTitle, PermissionGate`

Dari `@/components/layout/AppShell`:
`PageHeader, SummaryChip, HeaderBadge`

Dari `@/components/data/DataTable`:
`DataTable` + tipe `Column<T>`.

## Aksesibilitas & responsif

- Setiap input memiliki label yang terhubung (`FormField` sudah menangani).
- Tombol ikon wajib punya `aria-label`.
- Tabel dibungkus `DataTable` agar pencarian/paginasi/sortir konsisten.
- Uji pada lebar 360 px: hindari tabel lebar tanpa `hideOnMobile` atau scroll horizontal.

## Larangan

- Tidak ada tombol/link tanpa fungsi. Jika fitur belum tersedia, tampilkan tombol nonaktif dengan keterangan jelas.
- Tidak ada data contoh (mock) di kode produksi.
- Tidak ada `console.log` selain `console.warn`/`console.error`.
- Tidak menambah dependensi baru.
- Tidak ada `any` tanpa alasan yang dikomentari.
