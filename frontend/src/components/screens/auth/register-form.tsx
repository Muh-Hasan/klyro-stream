'use client';

import { PasswordInput } from '@/components/common/password-input';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function RegisterForm() {
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
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            className="h-10"
            id="password"
            name="password"
            autoComplete="new-password"
            aria-describedby="password-rules"
            required
          />
          <FieldDescription id="password-rules">
            At least 8 characters, with an uppercase letter, a lowercase letter and a number.
          </FieldDescription>
        </Field>
        <Button type="submit" className="h-10">
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
