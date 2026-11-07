'use client';

import { useChat } from '@ai-sdk/react';
import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AssistantMessage } from '@/server/ai/assistant/agent';
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

export function AssistantChat() {
  const { messages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat<AssistantMessage>({
    // After you approve or decline (e.g. confirming experience), the agent continues on its own.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const prefill = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const box = inputRef.current;
      box?.focus();
      box?.setSelectionRange(text.length, text.length);
    });
  };
  const busy = status === 'submitted' || status === 'streaming';

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
      {messages.length === 0 ? (
        <section className="flex flex-col gap-4 py-6">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold">Find your next high-tech job</h1>
            <p className="text-sm text-muted-foreground">
              Describe the role you want. I search GotFriends, Israeli company careers pages and remote job boards.
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
                      onPrefill={prefill}
                      onApproval={(id, approved) => addToolApprovalResponse({ id, approved })}
                      busy={busy}
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
          placeholder="e.g. Senior backend jobs in Tel Aviv, Node.js or Go"
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
