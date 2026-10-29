import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT, TRACES_SAMPLE_RATE } from "@/lib/sentry-options";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  initialScope: { tags: { service: "web" } },
  // includeLocalVariables stays off: locals can hold customer contact details.
});
