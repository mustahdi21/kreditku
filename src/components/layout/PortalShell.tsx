/**
 * PortalShell.tsx — Kerangka halaman portal pelanggan.
 *
 * Portal dirancang untuk dibuka dari ponsel, karena itu tata letaknya satu
 * kolom sempit dengan navigasi bawah — bukan bilah samping seperti aplikasi
 * admin. Nama pelanggan dan nama usaha ditampilkan di kepala halaman agar
 * pengguna yakin sedang melihat tagihannya sendiri.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { History, Home, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { useMerchantQris, useMyCustomer } from '@/data/portal';
import { Button, Separator, Skeleton } from '@/components/ui';

const TABS = [
  { to: '/portal', label: 'Tagihan', icon: Home, end: true },
  { to: '/portal/riwayat', label: 'Riwayat', icon: History, end: false },
] as const;

export function PortalShell(): JSX.Element {
  const { signOut, profile } = useAuth();
  const customer = useMyCustomer();
  const merchant = useMerchantQris();

  const namaPelanggan = customer.data?.full_name ?? profile?.full_name ?? 'Pelanggan';
  const namaUsaha = merchant.data?.merchantName ?? 'Portal Pembayaran';

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{namaUsaha}</p>
            <p className="truncate text-xs text-muted-foreground">Halo, {namaPelanggan}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Keluar
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4 pb-24">
        {customer.data?.customer_number ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Nomor pelanggan <span className="font-medium text-foreground">{customer.data.customer_number}</span>
          </p>
        ) : customer.isLoading ? (
          <Skeleton className="mb-3 h-4 w-40" />
        ) : null}

        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background">
        <div className="mx-auto flex w-full max-w-md">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-3 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <tab.icon className="h-5 w-5" aria-hidden />
              {tab.label}
            </NavLink>
          ))}
        </div>
        <Separator />
      </nav>
    </div>
  );
}
