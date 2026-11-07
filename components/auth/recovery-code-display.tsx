'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Shows a freshly issued recovery code once, with a copy button. */
export function RecoveryCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is still on screen to copy by hand.
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-lg font-semibold tracking-wider" data-testid="recovery-code">
          {code}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Save it in a password manager or somewhere safe. It is shown only now; we keep only a scrambled form of it.
      </p>
    </div>
  );
}
