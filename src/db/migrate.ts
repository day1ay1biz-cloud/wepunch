// Applies pending migrations as the table owner. Runs as Fly's release_command
// on every deploy (bundled to dist/db/migrate.mjs) and via `pnpm db:migrate`.
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is not set");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("migrations applied");
} finally {
  await client.end();
}
