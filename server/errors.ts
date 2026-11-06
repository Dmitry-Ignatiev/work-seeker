/**
 * Thrown by services when a row doesn't exist or belongs to another user.
 * Both cases look the same on purpose, so ids can't be probed.
 */
export class NotFoundError extends Error {
  constructor(what = 'Item') {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

/** Prisma unique-constraint violation (e.g. two concurrent identical inserts). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
