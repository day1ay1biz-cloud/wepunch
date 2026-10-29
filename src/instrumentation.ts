import * as Sentry from "@sentry/nextjs";

// The app runs only on the Node.js runtime (Cache Components and proxy.ts both
// require it), so there is no Edge config.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

// Reports unhandled errors from server components, route handlers and server actions.
export const onRequestError = Sentry.captureRequestError;
