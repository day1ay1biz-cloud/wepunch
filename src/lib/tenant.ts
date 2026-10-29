import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";

export type ResolvedTenant = {
  id: string;
  slug: string;
  status: "trialing" | "active" | "past_due" | "suspended" | "deleted";
};

/**
 * Looks a business up by slug or custom domain before any tenant scope exists.
 * Goes through the `resolve_business` SECURITY DEFINER function, which returns
 * only routing fields; everything else must be read inside withTenant().
 */
export async function resolveTenant(
  by: { slug: string } | { domain: string },
  db: Db = getDb(),
): Promise<ResolvedTenant | null> {
  const slug = "slug" in by ? by.slug : null;
  const domain = "domain" in by ? by.domain : null;
  const rows = await db.execute<ResolvedTenant>(
    sql`select id, slug, status from resolve_business(${slug}, ${domain})`,
  );
  return rows[0] ?? null;
}
