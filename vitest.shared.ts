import path from 'node:path';

const root = import.meta.dirname;

/** Module resolution shared by the unit and integration configs. */
export const resolve = {
  alias: {
    '@': root,
    // `server-only` throws outside a React Server bundle; tests run plain Node.
    'server-only': path.join(root, 'tests/support/empty.ts'),
  },
};
