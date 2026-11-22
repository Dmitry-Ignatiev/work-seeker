'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { ArrowUpIcon, SquareIcon, SquarePenIcon } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AssistantMessage } from '@/server/ai/assistant/agent';
import { CHAT_STORAGE_PREFIX } from './requests';
import { RichText } from './rich-text';
import { ToolPart } from './tool-part';

const EXAMPLES = [
  'Senior backend jobs in Tel Aviv, Node.js or Go',
  'Remote DevOps roles with Kubernetes',
  'משרות QA אוטומציה במרכז',
  'Junior frontend React jobs',
];

/** The server answers errors as JSON { error }: show that sentence, never a raw stack or status. */
function friendlyError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // Not JSON: fall through.
  }
  return error.message && error.message.length < 200 ? error.message : 'Something went wrong. Please try again.';
}

export interface ChatContext {
  jobId: string;
  cvId?: string;
}

interface Props {
  /** Where this chat's history is kept in the tab: "search", or "job:<id>" for a job page. */
  chatKey?: string;
  /** Sent with every request: the job a job page's chat is about, and the CV picked there. */
  context?: ChatContext;
  /** Sent once when the chat opens empty (e.g. "Tailor my CV" from a job card). */
  autoStart?: string;
  /** Shown instead of the search examples when the chat is empty; `onAsk` sends a message as the user. */
  EmptyState?: ComponentType<{ onAsk: (text: string) => void }>;
  placeholder?: string;
}

const noSubscribe = () => () => {};
/** False in the server HTML, true once React has hydrated: the saved history is only readable in the browser. */
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

/** The page context of each chat, read when a request is sent (so a CV picked later is used from then on). */
const chatContexts = new Map<string, ChatContext | undefined>();

/** Sets a chat's context right away, for a message sent in the same click (the effect below runs after render). */
export function setChatContext(chatKey: string, context: ChatContext) {
  chatContexts.set(chatKey, context);
}

function readSaved(storageKey: string): AssistantMessage[] {
  try {
    const saved = sessionStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as AssistantMessage[]) : [];
  } catch {
    return []; // unreadable or blocked storage: start empty
  }
}

export function AssistantChat(props: Props) {
  const hydrated = useHydrated();
  if (!hydrated) return <div className="mx-auto w-full max-w-3xl flex-1" aria-busy="true" />;
  return <Chat {...props} />;
}

function Chat({
  chatKey = 'search',
  context,
  autoStart,
  EmptyState,
  placeholder = 'e.g. Senior backend jobs in Tel Aviv, Node.js or Go',
}: Props) {
  useEffect(() => {
    chatContexts.set(chatKey, context);
  }, [chatKey, context]);
  // The history of this chat survives leaving the page (e.g. to a job and back) within this tab.
  const storageKey = `${CHAT_STORAGE_PREFIX}${chatKey}`;
  const [initialMessages] = useState(() => readSaved(storageKey));
  const [transport] = useState(
    () =>
      new DefaultChatTransport<AssistantMessage>({
        api: '/api/chat',
        body: () => {
          const current = chatContexts.get(chatKey);
          return current ? { context: current } : {};
        },
      }),
  );
  const { messages, setMessages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat<AssistantMessage>({
    id: chatKey,
    messages: initialMessages,
    transport,
    // After you approve or decline (e.g. confirming experience), the agent continues on its own.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Full or blocked storage: the chat still works, it just won't be restored.
    }
  }, [messages, busy, storageKey]);

  // Starts over: stops a reply in progress and forgets this chat's history (here and in the tab's storage).
  const newChat = () => {
    void stop();
    queued.current = null;
    setMessages([]);
    setInput('');
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Storage blocked: nothing was stored.
    }
    inputRef.current?.focus();
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  // A message asked for while the agent is still answering (e.g. a CV uploaded mid-reply) waits here
  // and is sent as soon as the reply finishes, instead of being dropped.
  const queued = useRef<string | null>(null);
  const busyNow = useRef(busy);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (busyNow.current) {
      queued.current = trimmed;
      return;
    }
    sendMessage({ text: trimmed });
    setInput('');
  };

  useEffect(() => {
    busyNow.current = busy;
    if (busy || !queued.current) return;
    const text = queued.current;
    queued.current = null;
    sendMessage({ text });
  }, [busy, sendMessage]);

  // Opened from "Tailor my CV": start right away, once, if this chat has no history yet.
  // Scheduled rather than sent inline: in development React mounts twice and the chat aborts the first
  // mount's request on cleanup, so only the mount that stays sends it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !autoStart || initialMessages.length > 0) return;
    const timer = setTimeout(() => {
      started.current = true;
      sendMessage({ text: autoStart });
    }, 0);
    return () => clearTimeout(timer);
  }, [autoStart, initialMessages.length, sendMessage]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
      {messages.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="rounded-full" onClick={newChat}>
            <SquarePenIcon aria-hidden /> New chat
          </Button>
        </div>
      )}
      {messages.length === 0 && EmptyState ? (
        <EmptyState onAsk={send} />
      ) : messages.length === 0 ? (
        <section className="flex flex-col gap-4 py-6">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold">Find your next high-tech job</h1>
            <p className="text-sm text-muted-foreground">
              Describe the role you want. I search Israeli company careers pages and remote job boards.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(example => (
              <Button key={example} variant="outline" size="sm" dir="auto" onClick={() => send(example)}>
                {example}
              </Button>
            ))}
          </div>
        </section>
      ) : (
        <ol className="flex flex-col gap-5" aria-label="Conversation">
          {messages.map(message => (
            <li key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-3'}>
              {message.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground" data-testid="user-message">
                  {message.parts.map((part, i) =>
                    // The "(jobId …)" suffix is for the model; people don't need to see it.
                    part.type === 'text' ? <RichText key={i} text={part.text.replace(/\s*\(jobId [\w-]+\)/, '')} /> : null,
                  )}
                </div>
              ) : (
                message.parts.map((part, i) =>
                  part.type === 'text' ? (
                    <div key={i} data-testid="assistant-message">
                      <RichText text={part.text} />
                    </div>
                  ) : (
                    <ToolPart
                      key={i}
                      part={part}
                      onAsk={send}
                      onApproval={(id, approved) => addToolApprovalResponse({ id, approved })}
                    />
                  ),
                )
              )}
            </li>
          ))}
          {status === 'submitted' && (
            <li role="status" className="text-sm text-muted-foreground">
              Thinking…
            </li>
          )}
        </ol>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {friendlyError(error)}
        </p>
      )}
      <div ref={bottomRef} />

      <form
        className="sticky bottom-0 mt-auto flex items-end gap-2 border-t bg-background/95 py-3 backdrop-blur"
        onSubmit={event => {
          event.preventDefault();
          send(input);
        }}
      >
        <Textarea
          ref={inputRef}
          aria-label="Message"
          dir="auto"
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(input);
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="max-h-40 min-h-10 resize-none"
        />
        {busy ? (
          <Button type="button" size="icon" variant="outline" onClick={() => stop()} aria-label="Stop">
            <SquareIcon />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim()}>
            <ArrowUpIcon />
          </Button>
        )}
      </form>
    </div>
  );
}
