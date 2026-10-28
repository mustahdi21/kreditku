/**
 * form.tsx — Komponen formulir: field berlabel, select, checkbox, switch,
 * input uang Rupiah, dan input angka.
 *
 * Aksesibilitas:
 *   * Setiap field wajib memiliki <Label htmlFor> yang terhubung ke input.
 *   * Pesan kesalahan dihubungkan dengan aria-describedby dan aria-invalid.
 *   * Input uang selalu menampilkan format Rupiah agar tidak ambigu.
 */

import {
  forwardRef,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRupiahNumber, parseRupiahInput, type Rupiah } from '@/lib/money';
import { Input, Label } from '@/components/ui/base';

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                              */
/* -------------------------------------------------------------------------- */

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, hint, required, className, children }: FormFieldProps): JSX.Element {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Grid dua kolom yang menyesuaikan diri pada layar kecil. */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Select                                                                     */
/* -------------------------------------------------------------------------- */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm',
      'disabled:cursor-not-allowed disabled:opacity-60 [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>): JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'relative z-50 max-h-80 min-w-[10rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>): JSX.Element {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/** Select sederhana berbasis daftar opsi (paling sering dipakai). */
export interface OptionsSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-invalid'?: boolean;
}

export function OptionsSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Pilih…',
  disabled,
  className,
  id,
  'aria-invalid': ariaInvalid,
}: OptionsSelectProps): JSX.Element {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className} id={id} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* Checkbox & Switch                                                          */
/* -------------------------------------------------------------------------- */

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded-sm border border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
      'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

/** Baris opsi dengan label yang dapat diklik. */
export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id?: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <Label htmlFor={fieldId} className="cursor-pointer">
          {label}
        </Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={fieldId} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Input uang Rupiah                                                          */
/* -------------------------------------------------------------------------- */

export interface MoneyInputProps {
  id?: string;
  value: Rupiah | null;
  onChange: (value: Rupiah | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  max?: Rupiah;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Input nominal Rupiah dengan pemisah ribuan otomatis.
 * Nilai yang dikembalikan selalu bilangan bulat Rupiah (atau null bila kosong).
 */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder = '0',
  disabled,
  className,
  max,
  ...aria
}: MoneyInputProps): JSX.Element {
  const [text, setText] = useState<string>(value === null ? '' : formatRupiahNumber(value));

  const handleChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    if (digits === '') {
      setText('');
      onChange(null);
      return;
    }
    const parsed = parseRupiahInput(digits);
    if (parsed === null) return;
    const limited = max !== undefined && parsed > max ? max : parsed;
    setText(formatRupiahNumber(limited));
    onChange(limited);
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        className={cn('pl-9 tabular', className)}
        {...aria}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Input angka & persen                                                       */
/* -------------------------------------------------------------------------- */

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
}

export function NumberInput({ value, onChange, min, max, allowDecimal = false, ...props }: NumberInputProps): JSX.Element {
  return (
    <Input
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={value === null ? '' : String(value)}
      onChange={(event) => {
        const raw = event.target.value.trim();
        if (raw === '') {
          onChange(null);
          return;
        }
        if (!allowDecimal && !/^\d*$/.test(raw)) return;
        if (allowDecimal && !/^\d*[.,]?\d*$/.test(raw)) return;
        const normalized = allowDecimal ? raw.replace(',', '.') : raw;
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return;
        let next = parsed;
        if (min !== undefined && next < min) next = min;
        if (max !== undefined && next > max) next = max;
        onChange(next);
      }}
      {...props}
    />
  );
}

/**
 * Input persentase yang menyimpan nilai dalam BASIS POINT.
 * Contoh: pengguna mengetik 2,5 (%) → nilai tersimpan 250 bp.
 */
export interface PercentInputProps {
  id?: string;
  valueBp: number;
  onChangeBp: (bp: number) => void;
  disabled?: boolean;
  maxPercent?: number;
  'aria-invalid'?: boolean;
}

export function PercentInput({ id, valueBp, onChangeBp, disabled, maxPercent = 100, ...aria }: PercentInputProps): JSX.Element {
  const [text, setText] = useState(String(valueBp / 100));
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value.replace(',', '.').replace(/[^\d.]/g, '');
          setText(raw);
          if (raw === '') {
            onChangeBp(0);
            return;
          }
          const percent = Number(raw);
          if (!Number.isFinite(percent)) return;
          const limited = Math.min(percent, maxPercent);
          onChangeBp(Math.round(limited * 100));
        }}
        className="pr-9 tabular"
        {...aria}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Input tanggal (YYYY-MM-DD)                                                 */
/* -------------------------------------------------------------------------- */

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | null;
  onChange: (value: string | null) => void;
}

export function DateInput({ value, onChange, className, ...props }: DateInputProps): JSX.Element {
  return (
    <Input
      type="date"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      className={cn('tabular', className)}
      {...props}
    />
  );
}
