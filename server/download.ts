import 'server-only';
import { NextResponse } from 'next/server';
import { NotFoundError } from '@/server/errors';
import { getCurrentUser } from '@/server/session';
import { PdfNotSupportedError } from '@/server/tailor/layout-pdf';

/** The file formats a CV can be downloaded in. */
export type CvFileFormat = 'docx' | 'pdf';

const CONTENT_TYPES: Record<CvFileFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/**
 * A GET handler that downloads a CV file built per request (nothing is stored). Only the owner can download:
 * anyone else gets the same 404 as a missing id. A PDF that can't be drawn (Hebrew) explains itself as text.
 */
export function cvDownload(
  format: CvFileFormat,
  render: (userId: string, id: string) => Promise<{ buffer: Buffer; fileName: string }>,
) {
  return async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Sign in to download your CV.' }, { status: 401 });
    const { id } = await ctx.params;

    try {
      const { buffer, fileName } = await render(user.id, id);
      const ascii = fileName.replace(/[^\x20-\x7e]/g, '').replace(/"/g, '').trim() || 'CV';
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': CONTENT_TYPES[format],
          'Content-Disposition': `attachment; filename="${ascii}.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}.${format}`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      if (error instanceof NotFoundError) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      if (error instanceof PdfNotSupportedError) {
        return new Response('A PDF can’t be made for a Hebrew CV yet. Download the DOCX instead.', {
          status: 422,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      throw error;
    }
  };
}
