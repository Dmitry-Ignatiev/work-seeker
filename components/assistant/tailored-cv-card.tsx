'use client';

import { DownloadIcon, FileCheck2Icon, ShieldCheckIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { TailorResult } from '@/server/services/tailor';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Highlights the job keywords an edit added. */
function Highlighted({ text, keywords }: { text: string; keywords: string[] }) {
  if (keywords.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
  return (
    <>
      {text.split(pattern).map((piece, i) =>
        keywords.some(k => k.toLowerCase() === piece.toLowerCase()) ? (
          <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">
            {piece}
          </mark>
        ) : (
          <Fragment key={i}>{piece}</Fragment>
        ),
      )}
    </>
  );
}

/** The tailoring result: coverage, before/after edits, what the truth check refused, what's missing, download. */
export function TailoredCvCard({ result, onHaveSkill }: { result: TailorResult; onHaveSkill: (keyword: string) => void }) {
  const percent = result.keywordTotal ? Math.round((result.coverageAfter / result.keywordTotal) * 100) : 0;
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground" aria-label="Tailored CV">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="flex items-center gap-2 font-medium" dir="auto">
            <FileCheck2Icon className="size-4 text-primary" aria-hidden />
            CV tailored for {result.job.title}
          </h3>
          <p className="text-sm text-muted-foreground" dir="auto">
            {result.job.company} · from your CV “{result.cvLabel}”
          </p>
          <p className="text-xs text-muted-foreground" data-testid="layout-note">
            {result.layout === 'ORIGINAL'
              ? 'Same design, wording and page count as your PDF; only the changes below.'
              : result.layout === 'MULTI_COLUMN'
                ? 'Your PDF has two columns, so the DOCX is a clean single-column version.'
                : 'Your PDF’s design couldn’t be read reliably, so the DOCX uses a clean template. Upload it again to retry.'}
          </p>
        </div>
        <a href={result.downloadUrl} download className={buttonVariants({ size: 'sm' })}>
          <DownloadIcon aria-hidden /> Download DOCX
        </a>
      </header>

      {result.keywordTotal > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="coverage">
          <p className="text-sm">
            Job keywords in your CV: <strong>{result.coverageBefore}</strong> → <strong>{result.coverageAfter}</strong> of{' '}
            {result.keywordTotal}
          </p>
          <Progress value={percent} aria-label="Keyword coverage" />
        </div>
      )}

      {result.changes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">Rewritten ({result.changes.length})</h4>
          <ul className="flex flex-col gap-3" aria-label="Changes">
            {result.changes.map(change => (
              <li key={change.bulletId} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm">
                {change.before && (
                  <p dir="auto" className="text-muted-foreground line-through decoration-muted-foreground/50">
                    {change.before}
                  </p>
                )}
                <p dir="auto">
                  <Highlighted text={change.after} keywords={change.keywords} />
                </p>
                {change.reworded && (
                  <Badge variant="outline" className="self-start">
                    Reworded: please check it’s accurate
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.skillsAdded.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Added to Skills</span>{' '}
          <span className="text-muted-foreground">(your CV already shows them):</span> {result.skillsAdded.join(', ')}
        </p>
      )}

      {result.rejected.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="refused">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheckIcon className="size-4 text-primary" aria-hidden /> Kept as written: the truth check refused these rewrites
          </h4>
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {result.rejected.map((r, i) => (
              <li key={i} dir="auto">
                “{r.before}” <span className="text-foreground">({r.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.missing.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="missing">
          <h4 className="text-sm font-medium">Not in your CV, so not added</h4>
          <p className="text-xs text-muted-foreground">If you really have one of these, tell me about it and I’ll add it.</p>
          <div className="flex flex-wrap gap-1.5">
            {result.missing.map(keyword => (
              <Button key={keyword} variant="outline" size="xs" onClick={() => onHaveSkill(keyword)}>
                I have {keyword}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
