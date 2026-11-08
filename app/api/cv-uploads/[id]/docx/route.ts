import { cvDownload } from '@/server/download';
import { renderUploadedCv } from '@/server/services/cv';

/** Downloads an uploaded CV converted to DOCX (no AI, no edits). */
export const GET = cvDownload('docx', (userId, id) => renderUploadedCv(userId, id, 'docx'));
