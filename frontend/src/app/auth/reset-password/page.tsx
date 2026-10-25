import Link from 'next/link';
import { ResetPasswordForm } from '@/components/screens/auth/reset-password-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function ResetPasswordPage() {
  return (
    <Card className="rounded-2xl shadow-2xl shadow-black/40 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
      <CardHeader className="gap-2 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Choose a new password
        </CardTitle>
        <CardDescription>You&apos;ll be logged out on all your devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
      <CardFooter className="justify-center py-5">
        <Link href="/auth/login" className="underline underline-offset-4">
          Back to log in
        </Link>
      </CardFooter>
    </Card>
  );
}
