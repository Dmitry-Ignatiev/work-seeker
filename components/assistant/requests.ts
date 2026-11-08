/** Chat messages the UI sends for the user. The "(jobId …)" suffix is for the model and hidden in the chat. */
export const tailorRequest = (job: { id: string; title: string; company: string }) =>
  `Tailor my CV for "${job.title}" at ${job.company} (jobId ${job.id}).`;

/** Chat histories live in this tab only (sessionStorage) and are cleared on sign-out. */
export const CHAT_STORAGE_PREFIX = 'work-seeker:chat:';

export function clearStoredChats() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(CHAT_STORAGE_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was stored.
  }
}
