'use client';

import Link from 'next/link';
import { PasswordInput } from '@/components/common/password-input';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            className="h-10"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@club.com"
            required
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              href="/auth/forgot-password"
              className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            className="h-10"
            required
          />
        </Field>
        <Button type="submit" className="h-10">
          Log in
        </Button>
      </FieldGroup>
    </form>
  );
}
