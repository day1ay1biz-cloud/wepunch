import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";

// Fly health check: the web process is up and can reach Postgres.
export async function GET() {
  await connection();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
