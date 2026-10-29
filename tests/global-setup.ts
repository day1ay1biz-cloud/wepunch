import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensureAppLoginRole } from "@/db/app-role";
import { TEST_DB_NAME, urls } from "./db";

// Fresh test database per run, migrated exactly like production.
export default async function setup() {
  const server = postgres(urls.server, { max: 1, onnotice: () => {} });
  await server.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`);
  await server.unsafe(`create database ${TEST_DB_NAME}`);
  await server.end();

  const admin = postgres(urls.admin, { max: 1, onnotice: () => {} });
  await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
  await admin.end();

  await ensureAppLoginRole(urls.admin, urls.app);
}
