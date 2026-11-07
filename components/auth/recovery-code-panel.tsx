'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { createRecoveryCodeAction } from '@/server/actions/recovery';
import { RecoveryCodeDisplay } from './recovery-code-display';

export function RecoveryCodePanel({ hasCode, welcome }: { hasCode: boolean; welcome: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createRecoveryCodeAction();
      if (result.ok) setCode(result.code);
      else setError(result.message);
    });

  if (code) {
    return (
      <div className="flex flex-col gap-4">
        <RecoveryCodeDisplay code={code} />
        {hasCode && <p className="text-sm text-muted-foreground">Your previous code no longer works.</p>}
        <Link href="/assistant" className={buttonVariants()}>
          I saved it, continue
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {hasCode
          ? 'You already have a recovery code. Create a new one if you lost it or think someone saw it; the old one stops working.'
          : 'If you forget your password, this code lets you set a new one. We don’t send emails, so without it only the site owner can help you.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={create} disabled={pending}>
          {hasCode ? 'Replace my recovery code' : 'Create my recovery code'}
        </Button>
        {welcome && (
          <Link href="/assistant" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Skip for now
          </Link>
        )}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
