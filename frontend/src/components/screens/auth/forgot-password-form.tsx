'use client';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function ForgotPasswordForm() {
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
        <Button type="submit" className="h-10">
          Send reset link
        </Button>
      </FieldGroup>
    </form>
  );
}
