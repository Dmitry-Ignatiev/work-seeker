'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { resetWithRecoveryCodeAction } from '@/server/actions/recovery';
import { RecoveryCodeDisplay } from './recovery-code-display';

/** Forgot password: email + recovery code + new password. */
export function RecoveryResetForm() {
  const [newCode, setNewCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      const newPassword = String(form.get('password'));
      if (newPassword !== String(form.get('confirm'))) {
        setError("The new passwords don't match.");
        return;
      }
      const result = await resetWithRecoveryCodeAction({
        email: String(form.get('email')),
        code: String(form.get('code')),
        newPassword,
      });
      if (result.ok) setNewCode(result.newCode);
      else setError(result.message);
    });

  if (newCode) {
    return (
      <div className="flex flex-col gap-4" data-testid="reset-done">
        <p className="text-sm">
          Your password was changed and you were signed out everywhere. Your old recovery code is used up; here is
          your new one:
        </p>
        <RecoveryCodeDisplay code={newCode} />
        <Link href="/sign-in" className={buttonVariants()}>
          I saved it, sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="code">Recovery code</FieldLabel>
          <Input
            id="code"
            name="code"
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm">Repeat new password</FieldLabel>
          <Input id="confirm" name="confirm" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
        </Field>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      <Button type="submit" disabled={pending}>
        Change password
      </Button>
      {error && <FieldError>{error}</FieldError>}
      <p className="text-xs text-muted-foreground">
        Lost your recovery code too? Ask the site owner for a one-time reset link.
      </p>
      <Link href="/sign-in" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
