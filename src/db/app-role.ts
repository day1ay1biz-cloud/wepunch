import postgres from "postgres";

/**
 * Creates (or updates the password of) the login role the app connects as,
 * taken from DATABASE_URL. Used for local development and tests. On Fly
 * Managed Postgres, create this role once by hand; see README.
 */
export async function ensureAppLoginRole(adminUrl: string, appUrl: string) {
  const { username, password } = new URL(appUrl);
  if (!username || !password) throw new Error("DATABASE_URL must include a user and password");
  if (!/^[a-z_][a-z0-9_]*$/.test(username)) throw new Error(`unsafe role name: ${username}`);

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_roles where rolname = ${username}`;
    const pw = decodeURIComponent(password).replaceAll("'", "''");
    const verb = exists.length ? "alter" : "create";
    await admin.unsafe(`${verb} role ${username} login nosuperuser nobypassrls password '${pw}'`);
    await admin.unsafe(`grant wepunch_app to ${username}`);
  } finally {
    await admin.end();
  }
}
