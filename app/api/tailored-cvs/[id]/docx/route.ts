import { cvDownload } from '@/server/download';
import { renderTailoredCv } from '@/server/services/tailor';

/** Downloads a tailored CV as DOCX. */
export const GET = cvDownload('docx', (userId, id) => renderTailoredCv(userId, id, 'docx'));
