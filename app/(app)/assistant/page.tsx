import { AssistantChat } from '@/components/assistant/assistant-chat';

export const metadata = { title: 'Chat' };

/** Static shell; the chat itself is client-side and talks to /api/chat (which checks the session). */
export default function AssistantPage() {
  return <AssistantChat />;
}
