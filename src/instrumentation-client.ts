import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT, TRACES_SAMPLE_RATE } from "@/lib/sentry-options";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: TRACES_SAMPLE_RATE,

  // Session Replay: 10% of sessions, every session with an error. Replay masks
  // all text and inputs by default, which this app relies on.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
});

// Traces App Router navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
