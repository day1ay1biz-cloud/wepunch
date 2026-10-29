import * as Sentry from "@sentry/node";
import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT, TRACES_SAMPLE_RATE } from "@/lib/sentry-options";

// Imported first by the worker entry point so Sentry can instrument the
// modules loaded after it. Same Sentry project as the web app; filter by the
// `service:worker` tag.
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  initialScope: { tags: { service: "worker" } },
});

export { Sentry };
