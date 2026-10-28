/**
 * domain.tsx — Komponen presentasional khusus domain kredit:
 * status badge, teks uang, kartu statistik, baris detail, dan gerbang izin.
 */

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRupiah, type Rupiah } from '@/lib/money';
import { formatDateShortId } from '@/lib/date';
import { Badge, Card, CardContent, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';
import {
  APPLICATION_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  INSTALLMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PENALTY_STATUS_LABELS,
  REMINDER_CHANNEL_LABELS,
  ROLE_LABELS,
  type ApplicationStatus,
  type ContractStatus,
  type CustomerStatus,
  type InstallmentStatus,
  type MemberRole,
  type PaymentMethod,
  type PenaltyStatus,
  type ReminderChannel,
} from '@/core/types';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';

const CUSTOMER_STATUS_VARIANTS: Record<CustomerStatus, BadgeVariant> = {
  PROSPECT: 'muted',
  ACTIVE: 'info',
  DELINQUENT: 'destructive',
  PAID_OFF: 'success',
  BLOCKED: 'outline',
  ARCHIVED: 'muted',
};

const INSTALLMENT_STATUS_VARIANTS: Record<InstallmentStatus, BadgeVariant> = {
  PENDING: 'muted',
  DUE_TODAY: 'warning',
  OVERDUE: 'destructive',
  PARTIAL: 'info',
  PAID: 'success',
  CANCELLED: 'outline',
};

const CONTRACT_STATUS_VARIANTS: Record<ContractStatus, BadgeVariant> = {
  ACTIVE: 'info',
  DELINQUENT: 'destructive',
  PAID_OFF: 'success',
  RESTRUCTURED: 'warning',
  CANCELLED: 'outline',
};

const APPLICATION_STATUS_VARIANTS: Record<ApplicationStatus, BadgeVariant> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
};

const PENALTY_STATUS_VARIANTS: Record<PenaltyStatus, BadgeVariant> = {
  OPEN: 'destructive',
  SETTLED: 'success',
  WAIVED: 'info',
  CANCELLED: 'outline',
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus | string }): JSX.Element {
  const key = status as CustomerStatus;
  return <Badge variant={CUSTOMER_STATUS_VARIANTS[key] ?? 'muted'}>{CUSTOMER_STATUS_LABELS[key] ?? status}</Badge>;
}

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus | string }): JSX.Element {
  const key = status as InstallmentStatus;
  return <Badge variant={INSTALLMENT_STATUS_VARIANTS[key] ?? 'muted'}>{INSTALLMENT_STATUS_LABELS[key] ?? status}</Badge>;
}

export function ContractStatusBadge({ status }: { status: ContractStatus | string }): JSX.Element {
  const key = status as ContractStatus;
  return <Badge variant={CONTRACT_STATUS_VARIANTS[key] ?? 'muted'}>{CONTRACT_STATUS_LABELS[key] ?? status}</Badge>;
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus | string }): JSX.Element {
  const key = status as ApplicationStatus;
  return <Badge variant={APPLICATION_STATUS_VARIANTS[key] ?? 'muted'}>{APPLICATION_STATUS_LABELS[key] ?? status}</Badge>;
}

export function PenaltyStatusBadge({ status }: { status: PenaltyStatus | string }): JSX.Element {
  const key = status as PenaltyStatus;
  return <Badge variant={PENALTY_STATUS_VARIANTS[key] ?? 'muted'}>{PENALTY_STATUS_LABELS[key] ?? status}</Badge>;
}

export function PaymentMethodBadge({ method }: { method: PaymentMethod | string }): JSX.Element {
  const key = method as PaymentMethod;
  return <Badge variant="secondary">{PAYMENT_METHOD_LABELS[key] ?? method}</Badge>;
}

export function ReminderChannelBadge({ channel }: { channel: ReminderChannel | string }): JSX.Element {
  const key = channel as ReminderChannel;
  return <Badge variant="outline">{REMINDER_CHANNEL_LABELS[key] ?? channel}</Badge>;
}

export function RoleBadge({ role }: { role: MemberRole | string }): JSX.Element {
  const key = role as MemberRole;
  return <Badge variant={key === 'SUPER_ADMIN' ? 'default' : 'secondary'}>{ROLE_LABELS[key] ?? role}</Badge>;
}

/* -------------------------------------------------------------------------- */
/* Teks uang & tanggal                                                        */
/* -------------------------------------------------------------------------- */

export function MoneyText({
  value,
  className,
  signed = false,
  mutedWhenZero = false,
  strong = false,
}: {
  value: Rupiah;
  className?: string;
  signed?: boolean;
  mutedWhenZero?: boolean;
  strong?: boolean;
}): JSX.Element {
  const isZero = value === 0;
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        strong && 'font-semibold',
        mutedWhenZero && isZero && 'text-muted-foreground',
        value < 0 && 'text-destructive',
        className,
      )}
    >
      {formatRupiah(value, { signed })}
    </span>
  );
}

export function DateText({ value, className, fallback = '-' }: { value: string | null | undefined; className?: string; fallback?: string }): JSX.Element {
  if (!value) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  return <span className={cn('tabular whitespace-nowrap', className)}>{formatDateShortId(value)}</span>;
}

/* -------------------------------------------------------------------------- */
/* Kartu statistik                                                            */
/* -------------------------------------------------------------------------- */

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
  loading?: boolean;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export function StatCard({ label, value, hint, icon, tone = 'default', loading = false }: StatCardProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4 pt-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="h-7 w-28" /> : <p className="stat-value truncate">{value}</p>}
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? <span className={cn('shrink-0 rounded-md p-2', TONE_CLASSES[tone])}>{icon}</span> : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Baris detail & judul bagian                                                */
/* -------------------------------------------------------------------------- */

export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4', className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium sm:text-right">{children}</dd>
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gerbang izin                                                               */
/* -------------------------------------------------------------------------- */

export interface PermissionGateProps {
  allowed: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  /** Bila true, tampilkan penanda terkunci alih-alih menyembunyikan. */
  showLocked?: boolean;
  reason?: string;
}

/**
 * Menyembunyikan atau menonaktifkan elemen berdasarkan izin.
 * Bersifat kosmetik: penegakan sebenarnya ada di database.
 */
export function PermissionGate({
  allowed,
  children,
  fallback = null,
  showLocked = false,
  reason = 'Anda tidak memiliki hak untuk tindakan ini.',
}: PermissionGateProps): JSX.Element {
  if (allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (!showLocked) return <></>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Terkunci
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
