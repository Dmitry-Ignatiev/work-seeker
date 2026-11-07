import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // No route folder may be named "cvs": the Vercel CLI's built-in ignore list has "CVS" (an old
  // version-control system), matches without case, and silently leaves such folders out of the upload.
  // So the CV page lives at /my-cvs; old links still work.
  async redirects() {
    return [{ source: '/cvs', destination: '/my-cvs', permanent: true }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
