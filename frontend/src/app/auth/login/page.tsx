import Link from 'next/link';
import { GoogleButton } from '@/components/screens/auth/google-button';
import { LoginForm } from '@/components/screens/auth/login-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';

export default function LoginPage() {
  return (
    <Card className="rounded-2xl shadow-2xl shadow-black/40 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
      <CardHeader className="gap-2 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">Welcome back</CardTitle>
        <CardDescription>Log in to watch your club&apos;s videos.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <GoogleButton />
          <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
            or
          </FieldSeparator>
          <LoginForm />
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-center gap-1 py-5 text-muted-foreground">
        New to KlyroStream?
        <Link href="/auth/register" className="text-foreground underline underline-offset-4">
          Sign up
        </Link>
      </CardFooter>
    </Card>
  );
}
