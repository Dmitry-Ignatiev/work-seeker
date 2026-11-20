'use client';

import { UploadIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const MAX_BYTES = 4 * 1024 * 1024;

const noSubscribe = () => () => {};
/** False in the server HTML, true once React has hydrated (so change events are handled). */
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

/**
 * Uploads a PDF or Word (.docx) CV to /api/cv-uploads. After success it calls `onUploaded` with the CV's id when given (e.g. the chat
 * continues) and refreshes the page's data, otherwise goes to `nextHref` or refreshes the page.
 */
export function CvUpload({ nextHref, onUploaded }: { nextHref?: string; onUploaded?: (cv: { id: string }) => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A file picked before hydration would be silently ignored, so the input waits for it.
  const hydrated = useHydrated();

  const upload = (file: File) =>
    startTransition(async () => {
      setError(null);
      if (file.size > MAX_BYTES) {
        setError('The file is larger than 4 MB.');
        return;
      }
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/cv-uploads', { method: 'POST', body });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string; duplicate?: boolean };
      if (inputRef.current) inputRef.current.value = '';
      if (!response.ok) {
        setError(data.error ?? 'Upload failed. Try again.');
        return;
      }
      toast.success(data.duplicate ? 'You already uploaded this CV.' : 'CV uploaded.');
      if (onUploaded && data.id) {
        onUploaded({ id: data.id });
        router.refresh(); // e.g. the job page's CV list
      } else if (nextHref) router.push(nextHref);
      else router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed p-5">
      <label htmlFor="cv-file" className="flex items-center gap-2 font-medium">
        <UploadIcon className="size-4" aria-hidden />
        Upload your CV (PDF or Word)
      </label>
      <p className="text-sm text-muted-foreground">
        Up to 4 MB and 20 pages. Only the text is kept. The file itself is never stored.
      </p>
      <Input
        id="cv-file"
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
        disabled={!hydrated || pending}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
      />
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Reading your CV…
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
