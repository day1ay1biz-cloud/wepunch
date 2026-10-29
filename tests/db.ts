import "dotenv/config";
import { createDb } from "@/db";

// Tests use their own database on the same server, derived from .env.
export const TEST_DB_NAME = "wepunch_test";

function withDatabase(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL must be set");

export const urls = {
  server: withDatabase(adminUrl, "postgres"),
  admin: withDatabase(adminUrl, TEST_DB_NAME),
  app: withDatabase(appUrl, TEST_DB_NAME),
};

/** Table owner: bypasses RLS. Only for fixtures and assertions. */
export const adminDb = () => createDb(urls.admin, { max: 1, onnotice: () => {} });

/** The app role, exactly as request handlers connect. One connection, so tests
 *  also prove scope does not leak between transactions on a pooled connection. */
export const appDb = () => createDb(urls.app, { max: 1, onnotice: () => {} });
