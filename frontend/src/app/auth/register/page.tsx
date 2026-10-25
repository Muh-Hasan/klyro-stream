import Link from 'next/link';
import { GoogleButton } from '@/components/screens/auth/google-button';
import { RegisterForm } from '@/components/screens/auth/register-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';

export default function RegisterPage() {
  return (
    <Card className="rounded-2xl shadow-2xl shadow-black/40 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
      <CardHeader className="gap-2 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">Create your account</CardTitle>
        <CardDescription>Start sharing match footage with your club.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <GoogleButton />
          <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
            or
          </FieldSeparator>
          <RegisterForm />
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-center gap-1 py-5 text-muted-foreground">
        Already have an account?
        <Link href="/auth/login" className="text-foreground underline underline-offset-4">
          Log in
        </Link>
      </CardFooter>
    </Card>
  );
}
