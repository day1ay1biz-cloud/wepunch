// Shared Sentry settings for the browser, server and worker.
//
// The DSN only lets clients send events, so it is safe to ship in the browser
// bundle; env vars override it per environment. No `dataCollection` option is
// passed on purpose: the SDK then keeps user info, cookies, headers and request
// bodies out of events (customer phone numbers and emails stay out of Sentry).
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  process.env.SENTRY_DSN ??
  "https://bac9c4d1e5c1771e2c3f9d1a2bce2163@o4512337899159552.ingest.us.sentry.io/4512337937170432";

export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.SENTRY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  "development";

// Full tracing locally, 10% elsewhere.
export const TRACES_SAMPLE_RATE = SENTRY_ENVIRONMENT === "development" ? 1.0 : 0.1;

// Set SENTRY_DISABLED=1 (or NEXT_PUBLIC_SENTRY_DISABLED=1) to keep a machine quiet.
export const SENTRY_ENABLED =
  process.env.NEXT_PUBLIC_SENTRY_DISABLED !== "1" && process.env.SENTRY_DISABLED !== "1";
