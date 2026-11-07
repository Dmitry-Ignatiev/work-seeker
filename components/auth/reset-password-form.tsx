'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

function ExpiredLink() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4" data-testid="reset-invalid">
      <p className="text-sm">
        This reset link is invalid or has expired. Links work once and last 1 hour. Ask the site owner for a new one,
        or use your recovery code.
      </p>
      <Link href="/forgot-password" className="text-sm underline-offset-4 hover:underline">
        Reset with my recovery code
      </Link>
    </div>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!token || params.get('error') || expired) return <ExpiredLink />;

  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-4" data-testid="reset-done">
        <p className="text-sm">Your password was changed, and you were signed out on your other devices.</p>
        <Link href="/sign-in" className="text-sm font-medium underline-offset-4 hover:underline">
          Sign in with your new password
        </Link>
      </div>
    );
  }

  const submit = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      const newPassword = String(form.get('password'));
      if (newPassword !== String(form.get('confirm'))) {
        setError("The passwords don't match.");
        return;
      }
      const { error } = await authClient.resetPassword({ newPassword, token });
      if (!error) setDone(true);
      else if (error.code === 'INVALID_TOKEN') setExpired(true);
      else setError(error.message ?? 'Something went wrong. Try again.');
    });

  return (
    <form action={submit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm">Repeat new password</FieldLabel>
          <Input id="confirm" name="confirm" type="password" minLength={10} autoComplete="new-password" required />
        </Field>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      <Button type="submit" disabled={pending}>
        Change password
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}
