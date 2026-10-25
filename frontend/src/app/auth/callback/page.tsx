import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

export default function AuthCallbackPage() {
  return (
    <Card className="rounded-2xl shadow-2xl shadow-black/40 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
      <CardHeader className="justify-items-center gap-2 text-center">
        <Spinner className="mb-3 size-7 text-muted-foreground" />
        <CardTitle className="text-2xl font-semibold tracking-tight">Signing you in</CardTitle>
        <CardDescription>This only takes a moment.</CardDescription>
      </CardHeader>
    </Card>
  );
}
