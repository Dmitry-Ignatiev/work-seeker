import { cvDownload } from '@/server/download';
import { renderUploadedCv } from '@/server/services/cv';

/** Downloads an uploaded CV as a PDF rebuilt from its saved layout (the original file is never stored). */
export const GET = cvDownload('pdf', (userId, id) => renderUploadedCv(userId, id, 'pdf'));
