'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { clearStoredChats } from '@/components/assistant/requests';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        // Chats are kept in this tab while signed in; the next person on this browser mustn't see them.
        clearStoredChats();
        router.push('/');
        router.refresh();
      }}
    >
      <LogOutIcon aria-hidden />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
