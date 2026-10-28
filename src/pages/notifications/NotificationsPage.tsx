/**
 * NotificationsPage.tsx — Pusat notifikasi pengguna.
 *
 * Notifikasi bersifat per pengguna (RLS pada tabel `notifications`).
 * Menandai dibaca TIDAK menghapus data: hanya mengubah `is_read` dan `read_at`
 * melalui RPC `rpc_mark_notifications_read`.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  BellOff,
  CheckCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  MessageSquare,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { notifyError, notifySuccess } from '@/components/common/Toaster';
import { useMarkNotificationsRead, useNotifications } from '@/data/admin';
import { formatDateTimeId } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { NotificationType } from '@/core/types';
import type { NotificationRow } from '@/data/types';

const PAGE_SIZE = 20;

/**
 * Label Bahasa Indonesia untuk tipe notifikasi.
 * (Belum ada padanannya di `@/core/types`, sehingga dipetakan di sini.)
 */
const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  APPLICATION_SUBMITTED: 'Pengajuan Diajukan',
  APPLICATION_DECIDED: 'Keputusan Pengajuan',
  INSTALLMENT_DUE: 'Cicilan Jatuh Tempo',
  PAYMENT_RECEIVED: 'Pembayaran Diterima',
  PAYMENT_FAILED: 'Pembayaran Gagal',
  CONTRACT_OVERDUE: 'Kontrak Menunggak',
  CONTRACT_AMENDED: 'Kontrak Diamandemen',
  ADMIN_ACTIVITY: 'Aktivitas Admin',
};

const NOTIFICATION_ICONS: Record<NotificationType, JSX.Element> = {
  APPLICATION_SUBMITTED: <FileText className="h-4 w-4" aria-hidden />,
  APPLICATION_DECIDED: <FileCheck2 className="h-4 w-4" aria-hidden />,
  INSTALLMENT_DUE: <Bell className="h-4 w-4" aria-hidden />,
  PAYMENT_RECEIVED: <Wallet className="h-4 w-4" aria-hidden />,
  PAYMENT_FAILED: <TrendingDown className="h-4 w-4" aria-hidden />,
  CONTRACT_OVERDUE: <ShieldAlert className="h-4 w-4" aria-hidden />,
  CONTRACT_AMENDED: <MessageSquare className="h-4 w-4" aria-hidden />,
  ADMIN_ACTIVITY: <Banknote className="h-4 w-4" aria-hidden />,
};

function isKnownType(value: string): value is NotificationType {
  return value in NOTIFICATION_TYPE_LABELS;
}

function NotificationItem({
  notification,
  onOpen,
  onMarkRead,
  marking,
}: {
  notification: NotificationRow;
  onOpen: (notification: NotificationRow) => void;
  onMarkRead: (notification: NotificationRow) => void;
  marking: boolean;
}): JSX.Element {
  const type = isKnownType(notification.type) ? notification.type : null;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between',
        notification.is_read ? 'bg-background' : 'border-primary/30 bg-primary/5',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            notification.is_read ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
          )}
        >
          {type ? NOTIFICATION_ICONS[type] : <Bell className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('text-sm', notification.is_read ? 'font-medium' : 'font-semibold')}>{notification.title}</p>
            {notification.is_read ? null : (
              <span className="h-2 w-2 rounded-full bg-primary" role="img" aria-label="Belum dibaca" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="muted">{type ? NOTIFICATION_TYPE_LABELS[type] : notification.type}</Badge>
            <span>{formatDateTimeId(notification.created_at)}</span>
            {notification.entity_type ? <span>• {notification.entity_type}</span> : null}
          </div>
          {notification.body ? <p className="text-sm text-muted-foreground">{notification.body}</p> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        {notification.link ? (
          <Button variant="outline" size="sm" onClick={() => onOpen(notification)}>
            <ExternalLink aria-hidden />
            Buka
          </Button>
        ) : null}
        {notification.is_read ? null : (
          <Button variant="ghost" size="sm" loading={marking} onClick={() => onMarkRead(notification)}>
            Tandai dibaca
          </Button>
        )}
      </div>
    </li>
  );
}

export default function NotificationsPage(): JSX.Element {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ unreadOnly, page, pageSize: PAGE_SIZE }),
    [page, unreadOnly],
  );

  const query = useNotifications(filters);
  const markRead = useMarkNotificationsRead();

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const handleOpen = (notification: NotificationRow) => {
    if (!notification.link) return;
    if (!notification.is_read) {
      markRead.mutate([notification.id], {
        onError: (error) => notifyError(error, 'Gagal menandai notifikasi sebagai dibaca'),
      });
    }
    navigate(notification.link);
  };

  const handleMarkOne = (notification: NotificationRow) => {
    markRead.mutate([notification.id], {
      onSuccess: () => notifySuccess('Notifikasi ditandai sudah dibaca.'),
      onError: (error) => notifyError(error, 'Gagal menandai notifikasi'),
    });
  };

  const handleMarkAll = () => {
    markRead.mutate(undefined, {
      onSuccess: () => notifySuccess('Seluruh notifikasi ditandai sudah dibaca.'),
      onError: (error) => notifyError(error, 'Gagal menandai seluruh notifikasi'),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifikasi"
        description="Pemberitahuan pengajuan, cicilan, pembayaran, dan aktivitas admin yang berkaitan dengan akun Anda."
        badge={
          total > 0 ? (
            <Badge variant="secondary">
              {total} {unreadOnly ? 'belum dibaca' : 'catatan'}
            </Badge>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={markRead.isPending}
            disabled={rows.length === 0 || rows.every((row) => row.is_read)}
            onClick={handleMarkAll}
          >
            <CheckCheck aria-hidden />
            Tandai semua dibaca
          </Button>
        }
      />

      <Tabs
        value={unreadOnly ? 'unread' : 'all'}
        onValueChange={(value) => {
          setUnreadOnly(value === 'unread');
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">Semua</TabsTrigger>
          <TabsTrigger value="unread">Belum dibaca</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="space-y-4 pt-5">
          {query.isLoading ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : query.error ? (
            <ErrorState
              title="Notifikasi gagal dimuat"
              message="Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void query.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BellOff className="h-5 w-5" />}
              title={unreadOnly ? 'Tidak ada notifikasi belum dibaca' : 'Belum ada notifikasi'}
              description={
                unreadOnly
                  ? 'Semua notifikasi sudah Anda baca. Pilih tab «Semua» untuk melihat riwayat lengkap.'
                  : 'Notifikasi akan muncul ketika ada aktivitas yang melibatkan akun Anda.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {rows.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={handleOpen}
                  onMarkRead={handleMarkOne}
                  marking={markRead.isPending}
                />
              ))}
            </ul>
          )}

          {total > PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <p className="text-sm text-muted-foreground">
                Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, total)} dari {total} notifikasi
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Sebelumnya
                </Button>
                <span className="tabular text-sm text-muted-foreground">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
