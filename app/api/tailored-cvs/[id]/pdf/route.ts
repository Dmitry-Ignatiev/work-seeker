import { cvDownload } from '@/server/download';
import { renderTailoredCv } from '@/server/services/tailor';

/** Downloads a tailored CV as PDF. */
export const GET = cvDownload('pdf', (userId, id) => renderTailoredCv(userId, id, 'pdf'));
