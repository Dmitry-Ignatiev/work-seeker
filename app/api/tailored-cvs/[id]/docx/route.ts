import { NextResponse } from 'next/server';
import { NotFoundError } from '@/server/errors';
import { getTailoredCvForDownload } from '@/server/services/tailor';
import { buildCvDocx } from '@/server/tailor/docx';
import { getCurrentUser } from '@/server/session';

/** Downloads a tailored CV as DOCX. Only its owner can; anyone else gets the same 404 as a missing id. */
export async function GET(_request: Request, ctx: RouteContext<'/api/tailored-cvs/[id]/docx'>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to download your CV.' }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const cv = await getTailoredCvForDownload(user.id, id);
    const buffer = await buildCvDocx(cv);
    const ascii = cv.fileName.replace(/[^\x20-\x7e]/g, '').trim() || 'Tailored CV';
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${ascii}.docx"; filename*=UTF-8''${encodeURIComponent(cv.fileName)}.docx`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    throw error;
  }
}
