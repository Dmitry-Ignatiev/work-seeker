import { NextResponse } from 'next/server';
import { CV_MAX_BYTES, CvUploadError, extractPdfText } from '@/server/cv/pdf';
import { createCv } from '@/server/services/cv';
import { getCurrentUser } from '@/server/session';

/** Room for the multipart boundary and headers around the file. */
const ENVELOPE_BYTES = 64 * 1024;

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/**
 * CV upload: multipart field `file`, a PDF of at most 4 MB and 20 pages.
 * The PDF is parsed in memory and discarded. Only its text is stored.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return error('Sign in to upload a CV.', 401);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > CV_MAX_BYTES + ENVELOPE_BYTES) return error('The file is larger than 4 MB.', 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error('Send the CV as multipart form data.', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return error('Choose a PDF file.', 400);
  if (file.size > CV_MAX_BYTES) return error('The file is larger than 4 MB.', 413);

  try {
    const { text, pageCount, links } = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    const result = await createCv(user.id, { fileName: file.name, sizeBytes: file.size, pageCount, text, links });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof CvUploadError) return error(e.message, 400);
    throw e;
  }
}
