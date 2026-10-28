/**
 * ErrorBoundary.tsx — Menangkap kegagalan render agar aplikasi tidak menjadi
 * layar putih. Detail teknis hanya ditampilkan pada mode pengembangan.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/base';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallbackTitle?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dicatat untuk pengembang; tidak pernah ditampilkan ke pengguna akhir.
    console.error('[KreditKu] Kesalahan render:', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
              {this.props.fallbackTitle ?? 'Terjadi kesalahan pada tampilan'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Halaman ini gagal dimuat. Data Anda tidak terpengaruh. Muat ulang halaman untuk melanjutkan.
            </p>
            {import.meta.env.DEV ? (
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {error.message}
              </pre>
            ) : null}
            <Button onClick={this.handleReload}>
              <RefreshCw aria-hidden />
              Muat ulang halaman
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
