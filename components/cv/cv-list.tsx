'use client';

import { FileTextIcon } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteCvAction, setDefaultCvAction, type ActionResult } from '@/server/actions/cv';

export interface CvRow {
  id: string;
  label: string;
  fileName: string;
  pageCount: number;
  sizeBytes: number;
  isDefault: boolean;
  /** ISO date */
  createdAt: string;
  skills: string[];
}

const SHOWN_SKILLS = 14;

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function CvList({ cvs }: { cvs: CvRow[] }) {
  if (cvs.length === 0) {
    return <p className="text-sm text-muted-foreground">No CVs yet. Upload one to start matching jobs.</p>;
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Your CVs">
      {cvs.map(cv => (
        <li key={cv.id}>
          <CvCard cv={cv} />
        </li>
      ))}
    </ul>
  );
}

function CvCard({ cv }: { cv: CvRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // The delete button asks once, then resets if not confirmed.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const run = (action: () => Promise<ActionResult>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.message);
    });

  const hidden = cv.skills.length - SHOWN_SKILLS;
  const uploaded = new Date(cv.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });

  return (
    <Card aria-label={cv.label}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
          {cv.label}
          {cv.isDefault && <Badge variant="secondary">Default</Badge>}
        </CardTitle>
        <CardDescription>
          {cv.fileName} · {cv.pageCount} {cv.pageCount === 1 ? 'page' : 'pages'} · {formatSize(cv.sizeBytes)} · uploaded{' '}
          {uploaded}
        </CardDescription>
        <CardAction className="flex gap-2">
          {!cv.isDefault && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setDefaultCvAction(cv.id), 'Default CV changed.')}
            >
              Make default
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirming) setConfirming(true);
              else run(() => deleteCvAction(cv.id), 'CV deleted.');
            }}
          >
            {confirming ? 'Confirm delete' : 'Delete'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {cv.skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No known skills found in this CV.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {cv.skills.length} {cv.skills.length === 1 ? 'skill' : 'skills'} found
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills found">
              {cv.skills.slice(0, SHOWN_SKILLS).map(skill => (
                <li key={skill}>
                  <Badge variant="outline">{skill}</Badge>
                </li>
              ))}
              {hidden > 0 && (
                <li>
                  <Badge variant="ghost">+{hidden} more</Badge>
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
