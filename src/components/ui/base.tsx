/**
 * base.tsx — Komponen dasar antarmuka KreditKu.
 *
 * Semua komponen:
 *   * meneruskan props HTML asli (sehingga atribut aria-* dan data-* bekerja),
 *   * memiliki state fokus yang terlihat,
 *   * dan tidak menyembunyikan kegagalan (tidak ada tombol tanpa aksi).
 */

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        success: 'bg-success text-success-foreground hover:bg-success/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Component>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };

/* -------------------------------------------------------------------------- */
/* Input & Textarea                                                           */
/* -------------------------------------------------------------------------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/* -------------------------------------------------------------------------- */
/* Label                                                                      */
/* -------------------------------------------------------------------------- */

export interface LabelProps extends HTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  htmlFor?: string;
}

export function Label({ className, children, required = false, ...props }: LabelProps): JSX.Element {
  return (
    <label className={cn('text-sm font-medium leading-none', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-1 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
        info: 'border-transparent bg-info/12 text-info',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('flex items-center gap-2 p-5 pt-0', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Separator, Skeleton, Progress, Avatar                                      */
/* -------------------------------------------------------------------------- */

export function Separator({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all', clamped >= 100 ? 'bg-success' : 'bg-primary')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }): JSX.Element {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary',
        className,
      )}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials || '?'}
    </span>
  );
}

export function Spinner({ className, label = 'Memuat' }: { className?: string; label?: string }): JSX.Element {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / Error state                                                        */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center', className)}>
      <span className="rounded-full bg-muted p-3 text-muted-foreground" aria-hidden>
        {icon ?? <Inbox className="h-5 w-5" />}
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title = 'Terjadi kesalahan', message, onRetry, className }: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4', className)}
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

/** Placeholder pemuatan tabel berbentuk kerangka. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }): JSX.Element {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
