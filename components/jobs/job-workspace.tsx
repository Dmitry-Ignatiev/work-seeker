'use client';

import { ArrowLeftIcon, CheckIcon, FileTextIcon } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { AssistantChat, setChatContext } from '@/components/assistant/assistant-chat';
import { tailorRequest } from '@/components/assistant/requests';
import { CvUpload } from '@/components/cv/cv-upload';
import { Button } from '@/components/ui/button';

export interface WorkspaceCv {
  id: string;
  label: string;
  isDefault: boolean;
}

const SelectedCv = createContext<string | undefined>(undefined);
const CurrentJob = createContext<{ id: string; title: string; company: string } | undefined>(undefined);

interface TailorChoice {
  cvs: WorkspaceCv[];
  cvId?: string;
  /** True while the chat asks which CV to tailor (instead of tailoring the default one unasked). */
  choosing: boolean;
  setChoosing: (choosing: boolean) => void;
  /** Picks the CV for this page and tailors it now. */
  tailorWith: (cvId: string, onAsk: (text: string) => void) => void;
}
const Tailoring = createContext<TailorChoice | undefined>(undefined);

/**
 * A job's own page: its details on the left, a chat about this job on the right. The CV picked here is
 * sent with every chat message; tailoring uses it. Each job keeps its own chat history (this tab only).
 */
export function JobWorkspace({
  job,
  cvs,
  autoTailor,
  details,
  requirements,
}: {
  job: { id: string; title: string; company: string };
  cvs: WorkspaceCv[];
  autoTailor: boolean;
  details: ReactNode;
  requirements: ReactNode;
}) {
  const [cvId, setCvId] = useState<string | undefined>(() => (cvs.find(cv => cv.isDefault) ?? cvs[0])?.id);
  const tailor = tailorRequest(job);
  const chatKey = `job:${job.id}`;
  // From "Tailor my CV": with CVs on file, ask which one first. Without any, tailoring asks for an upload.
  const [choosing, setChoosing] = useState(autoTailor && cvs.length > 0);
  const tailorWith = (id: string, onAsk: (text: string) => void) => {
    setCvId(id);
    setChatContext(chatKey, { jobId: job.id, cvId: id });
    setChoosing(false);
    onAsk(tailor);
  };

  return (
    <CurrentJob.Provider value={job}>
      <SelectedCv.Provider value={cvId}>
        <Tailoring.Provider value={{ cvs, cvId, choosing, setChoosing, tailorWith }}>
        <div className="flex flex-col gap-4">
          <Link
            href="/assistant"
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> Back to search
          </Link>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <aside className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start" aria-label="Job details">
              {details}
              {requirements}
              <CvPicker cvs={cvs} value={cvId} onChange={setCvId} />
            </aside>
            <section className="flex min-h-[60vh] flex-col" aria-label="Chat about this job">
              <AssistantChat
                chatKey={chatKey}
                context={{ jobId: job.id, cvId }}
                autoStart={autoTailor && cvs.length === 0 ? tailor : undefined}
                placeholder="Ask about this job: what am I missing, do I fit…"
                EmptyState={JobChatStart}
              />
            </section>
          </div>
        </div>
        </Tailoring.Provider>
      </SelectedCv.Provider>
    </CurrentJob.Provider>
  );
}

/** What an empty job chat offers: the three things people come to a job page for. */
function JobChatStart({ onAsk }: { onAsk: (text: string) => void }) {
  const job = useContext(CurrentJob);
  const tailoring = useContext(Tailoring);
  if (tailoring?.choosing) return <ChooseCv onAsk={onAsk} />;
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm text-muted-foreground">This chat knows this job and the CV you picked.</p>
      <div className="flex flex-wrap gap-2">
        {job && (
          <Button
            size="sm"
            onClick={() => (tailoring && tailoring.cvs.length > 0 ? tailoring.setChoosing(true) : onAsk(tailorRequest(job)))}
          >
            Tailor my CV for this job
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => onAsk('What does my CV miss for this job?')}>
          What am I missing?
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAsk('Do I fit this role? Be honest.')}>
          Do I fit this role?
        </Button>
      </div>
    </div>
  );
}

/** Asks which CV to tailor: one of the CVs on file, or a new upload. */
function ChooseCv({ onAsk }: { onAsk: (text: string) => void }) {
  const job = useContext(CurrentJob);
  const tailoring = useContext(Tailoring);
  const [uploading, setUploading] = useState(false);
  if (!tailoring) return null;
  const { cvs, cvId, tailorWith, setChoosing } = tailoring;
  return (
    <div className="flex flex-col gap-3 py-4" data-testid="choose-cv">
      <p className="font-medium" dir="auto">
        Which CV should I tailor{job ? ` for ${job.title}` : ''}?
      </p>
      <ul className="flex flex-col gap-2" aria-label="Your CVs">
        {cvs.map(cv => (
          <li key={cv.id}>
            <Button
              variant={cv.id === cvId ? 'default' : 'outline'}
              className="h-auto w-full justify-start gap-2 py-2.5 text-left"
              onClick={() => tailorWith(cv.id, onAsk)}
            >
              <FileTextIcon className="size-4 shrink-0" aria-hidden />
              <span dir="auto" className="truncate">
                {cv.label}
              </span>
              {cv.isDefault && <span className="ml-auto text-xs opacity-75">default</span>}
            </Button>
          </li>
        ))}
      </ul>
      {uploading ? (
        <CvUpload onUploaded={cv => tailorWith(cv.id, onAsk)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setUploading(true)}>
            Upload a different CV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function CvPicker({ cvs, value, onChange }: { cvs: WorkspaceCv[]; value?: string; onChange: (id: string) => void }) {
  if (cvs.length === 0) {
    return <p className="text-sm text-muted-foreground">No CV yet: tailoring will ask you to upload one.</p>;
  }
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted-foreground">CV to use</span>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={cvs.length === 1}
      >
        {cvs.map(cv => (
          <option key={cv.id} value={cv.id}>
            {cv.label}
            {cv.isDefault && cvs.length > 1 ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The job's concrete requirements; green when the CV picked on this page already shows them. */
export function RequirementChips({
  requirements,
  have,
}: {
  requirements: { keyword: string }[];
  have: Record<string, string[]>;
}) {
  const cvId = useContext(SelectedCv);
  const owned = new Set(cvId ? (have[cvId] ?? []) : []);
  if (requirements.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="requirements">
      <h2 className="text-sm text-muted-foreground">What they ask for{cvId ? ' (green: in your CV)' : ''}</h2>
      <ul className="flex flex-wrap gap-1.5">
        {requirements.map(({ keyword }) => (
          <li
            key={keyword}
            dir="auto"
            className={
              owned.has(keyword)
                ? 'inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary'
                : 'rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'
            }
          >
            {owned.has(keyword) && <CheckIcon className="size-3" aria-label="In your CV" />}
            {keyword}
          </li>
        ))}
      </ul>
    </div>
  );
}
