'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/lib/safe-next';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

interface Props {
  /** Which form: each has its own page (/sign-in, /sign-up). */
  mode: 'sign-in' | 'sign-up';
  emailPassword: boolean;
  google: boolean;
  github: boolean;
}


export function SignInForm({ mode, emailPassword, google, github }: Props) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const social = (provider: 'google' | 'github') =>
    startTransition(async () => {
      setError(null);
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: next ?? '/assistant',
        newUserCallbackURL: '/assistant',
      });
      if (error) setError(error.message ?? 'Sign-in failed.');
    });

  const submit = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      const email = String(form.get('email'));
      const password = String(form.get('password'));
      const result =
        mode === 'sign-up'
          ? await authClient.signUp.email({ email, password, name: String(form.get('name') || email) })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Something went wrong.');
        return;
      }
      // New accounts first get the chance to save a recovery code (there is no email reset).
      router.push(mode === 'sign-up' ? '/recovery-code?welcome=1' : (next ?? '/assistant'));
      router.refresh();
    });

  const noMethods = !emailPassword && !google && !github;

  return (
    <div className="flex flex-col gap-4">
      {google && (
        <Button variant="outline" size="lg" disabled={pending} onClick={() => social('google')}>
          Continue with Google
        </Button>
      )}
      {github && (
        <Button variant="outline" size="lg" disabled={pending} onClick={() => social('github')}>
          Continue with GitHub
        </Button>
      )}

      {emailPassword && (
        <form action={submit} className="flex flex-col gap-4 rounded-xl border p-4">
          <FieldGroup>
            {mode === 'sign-up' && (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={10}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
              />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={pending}>
            {mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </Button>
          {mode === 'sign-in' && (
            <Link href="/forgot-password" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          )}
          {/* The other form, keeping where they were heading. */}
          <Link
            href={`${mode === 'sign-in' ? '/sign-up' : '/sign-in'}${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {mode === 'sign-in' ? 'No account? Create one' : 'Have an account? Sign in'}
          </Link>
        </form>
      )}

      {noMethods && (
        <p className="text-sm text-muted-foreground">
          No sign-in method is configured. Set GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET.
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
