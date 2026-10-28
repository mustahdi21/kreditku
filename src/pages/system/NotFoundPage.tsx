/**
 * NotFoundPage.tsx — Halaman 404.
 */

import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <Compass className="h-5 w-5" aria-hidden />
            Halaman tidak ditemukan
          </CardTitle>
          <CardDescription>Alamat yang Anda buka tidak tersedia atau sudah dipindahkan.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/app">Kembali ke dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
