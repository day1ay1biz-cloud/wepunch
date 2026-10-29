import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, type Db } from "@/db";
import { getAuth } from "@/lib/auth";

export type UserScope = {
  kind: "business" | "agency";
  scopeId: string;
  name: string;
  slug: string | null;
  role: string;
};

/** The signed-in owner, staff member or admin, or null. */
export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/**
 * Businesses and agencies the user may act for. Pass only the id of the
 * authenticated session user: the lookup bypasses RLS by design.
 */
export async function getUserScopes(userId: string, db: Db = getDb()): Promise<UserScope[]> {
  return db.execute<UserScope>(sql`
    select kind, scope_id as "scopeId", name, slug, role from user_scopes(${userId})
  `);
}
