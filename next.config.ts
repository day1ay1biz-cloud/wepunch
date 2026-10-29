import type { NextConfig } from "next";
// SDK v11 moved the build wrapper to its own entry point.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: "kinetic-ventures",
  project: "wepunch",

  // Source maps upload on `next build` when this build-time secret is set
  // (CI and the Fly Docker build); without it the build skips the upload.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,

  // Docker builds have no .git, so CI passes the commit SHA in. Locally the
  // plugin falls back to detecting it from git.
  release: process.env.SENTRY_RELEASE ? { name: process.env.SENTRY_RELEASE } : undefined,

  // Browser events go through our own domain so ad blockers do not drop them.
  // proxy.ts must not rewrite this path into a tenant.
  tunnelRoute: "/monitoring",

  silent: !process.env.CI,
});
