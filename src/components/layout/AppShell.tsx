/**
 * AppShell.tsx — Kerangka aplikasi: sidebar desktop, topbar, drawer mobile,
 * dan navigasi bawah untuk ponsel.
 *
 * Menu disaring berdasarkan izin role. Penyaringan ini hanya kosmetik —
 * penegakan sebenarnya ada di database.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Percent,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import type { Permission } from '@/auth/permissions';
import { useUnreadNotificationCount } from '@/data/admin';
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui';
import { RoleBadge } from '@/components/common/domain';

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly permission: Permission;
  readonly end?: boolean;
}

interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Ringkasan',
    items: [
      { to: '/app', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, permission: 'reports.view', end: true },
      { to: '/app/notifications', label: 'Notifikasi', icon: <Bell className="h-4 w-4" />, permission: 'notifications.view' },
    ],
  },
  {
    title: 'Kredit',
    items: [
      { to: '/app/customers', label: 'Pelanggan', icon: <Users className="h-4 w-4" />, permission: 'customers.view' },
      { to: '/app/applications', label: 'Pengajuan', icon: <FileText className="h-4 w-4" />, permission: 'applications.view' },
      { to: '/app/simulator', label: 'Simulator Kredit', icon: <Percent className="h-4 w-4" />, permission: 'applications.view' },
      { to: '/app/contracts', label: 'Kontrak', icon: <ScrollText className="h-4 w-4" />, permission: 'contracts.view' },
    ],
  },
  {
    title: 'Operasional',
    items: [
      { to: '/app/installments', label: 'Jadwal Cicilan', icon: <CalendarClock className="h-4 w-4" />, permission: 'installments.view' },
      { to: '/app/payments', label: 'Pembayaran', icon: <Wallet className="h-4 w-4" />, permission: 'payments.view' },
      { to: '/app/penalties', label: 'Denda & Tunggakan', icon: <Banknote className="h-4 w-4" />, permission: 'penalties.view' },
      { to: '/app/reminders', label: 'Pengingat', icon: <Bell className="h-4 w-4" />, permission: 'reminders.view' },
    ],
  },
  {
    title: 'Analisis & Administrasi',
    items: [
      { to: '/app/reports', label: 'Laporan', icon: <Receipt className="h-4 w-4" />, permission: 'reports.view' },
      { to: '/app/settings', label: 'Pengaturan', icon: <Settings className="h-4 w-4" />, permission: 'settings.view' },
      { to: '/app/settings/users', label: 'Pengguna', icon: <ShieldCheck className="h-4 w-4" />, permission: 'users.view' },
      { to: '/app/settings/audit', label: 'Audit Log', icon: <Gauge className="h-4 w-4" />, permission: 'audit.view' },
    ],
  },
];

const MOBILE_ITEMS: readonly NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" />, permission: 'reports.view', end: true },
  { to: '/app/customers', label: 'Pelanggan', icon: <Users className="h-5 w-5" />, permission: 'customers.view' },
  { to: '/app/contracts', label: 'Kontrak', icon: <ScrollText className="h-5 w-5" />, permission: 'contracts.view' },
  { to: '/app/payments', label: 'Bayar', icon: <Wallet className="h-5 w-5" />, permission: 'payments.view' },
];

function NavEntry({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )
      }
    >
      <span aria-hidden>{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { can, memberships, currentMembership } = useAuth();
  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => can(item.permission)),
      })).filter((section) => section.items.length > 0),
    [can],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CreditCard className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{currentMembership?.organization?.name ?? 'KreditKu'}</p>
          <p className="truncate text-xs text-muted-foreground">Credit Management System</p>
        </div>
      </div>

      {memberships.length > 1 ? (
        <p className="px-2 text-xs text-muted-foreground">{memberships.length} organisasi terhubung</p>
      ) : null}

      <nav className="flex-1 space-y-4 overflow-y-auto scrollbar-thin pb-4" aria-label="Navigasi utama">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
            {section.items.map((item) => (
              <NavEntry key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function Topbar({ onOpenMenu }: { onOpenMenu: () => void }): JSX.Element {
  const { profile, role, currentMembership, signOut, memberships, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const unread = useUnreadNotificationCount();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Buka menu navigasi">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Building2 className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
        <p className="truncate text-sm font-medium">{currentMembership?.organization?.name ?? 'KreditKu'}</p>
        {memberships.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                Ganti
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Pilih organisasi</DropdownMenuLabel>
              {memberships.map((membership) => (
                <DropdownMenuItem
                  key={membership.id}
                  onSelect={() => {
                    void switchOrganization(membership.organization_id);
                  }}
                >
                  {membership.organization?.name ?? membership.organization_id}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => navigate('/app/notifications')}
              aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
            >
              <Bell className="h-5 w-5" />
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Pusat notifikasi</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
            aria-label="Menu pengguna"
          >
            <Avatar name={profile?.full_name || profile?.email || 'Pengguna'} src={profile?.avatar_url} />
            <span className="hidden text-left sm:block">
              <span className="block max-w-[12rem] truncate text-sm font-medium">{profile?.full_name || profile?.email}</span>
              <span className="block text-xs text-muted-foreground">{role ?? '-'}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel className="flex items-center gap-2">
            <span className="truncate">{profile?.email}</span>
            {role ? <RoleBadge role={role} /> : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/app/profile')}>
            <UserCircle className="h-4 w-4" aria-hidden />
            Profil saya
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
            <Settings className="h-4 w-4" aria-hidden />
            Pengaturan
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={() => {
              void signOut();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function MobileBottomNav(): JSX.Element {
  const { can } = useAuth();
  const items = MOBILE_ITEMS.filter((item) => can(item.permission));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      aria-label="Navigasi bawah"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          <span aria-hidden>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const { needsInvitation } = useAuth();
  const location = useLocation();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-muted/30">
        <div className="flex">
          <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-background p-3 lg:block">
            <SidebarContent />
          </aside>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <span className="hidden" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetTitle className="sr-only">Navigasi</SheetTitle>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar onOpenMenu={() => setMenuOpen(true)} />

            {needsInvitation ? (
              <div className="border-b bg-warning/10 px-4 py-2 text-sm text-warning">
                Akun Anda belum terhubung ke organisasi mana pun. Hubungi Super Admin untuk mendapatkan undangan.
              </div>
            ) : null}

            {currentBadge(location.pathname)}

            <main className="flex-1 px-3 pb-20 pt-4 sm:px-4 lg:pb-8">
              <div className="mx-auto w-full max-w-[1400px]">
                <Outlet />
              </div>
            </main>
          </div>
        </div>

        <MobileBottomNav />
      </div>
    </TooltipProvider>
  );
}

/** Penanda halaman demo/lingkungan non-produksi bila dikonfigurasi. */
function currentBadge(pathname: string): ReactNode {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="border-b bg-info/5 px-4 py-1 text-xs text-info">
      Mode pengembangan — {pathname}
    </div>
  );
}

/** Judul halaman dengan aksi opsional. */
export function PageHeader({
  title,
  description,
  actions,
  badge,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  breadcrumb?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 space-y-3">
      {breadcrumb ? <div className="text-xs text-muted-foreground">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Kartu ringkasan kecil untuk header halaman detail. */
export function SummaryChip({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

/** Lencana status yang tampil di header. */
export function HeaderBadge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' | 'danger' }): JSX.Element {
  const variant = tone === 'danger' ? 'destructive' : tone === 'warning' ? 'warning' : 'default';
  return <Badge variant={variant}>{children}</Badge>;
}
