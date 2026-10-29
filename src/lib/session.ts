import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
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

/** The signed-in, email-verified user, or a redirect to sign-in. */
export async function requireUser() {
  const session = await getSession();
  if (!session || !session.user.emailVerified) redirect("/sign-in");
  return session.user;
}

/**
 * The signed-in user's access to one business, by slug. Anyone without a
 * membership gets a 404, so the dashboard never confirms a business exists.
 */
export async function requireBusinessAccess(slug: string) {
  const user = await requireUser();
  const scope = (await getUserScopes(user.id)).find((s) => s.kind === "business" && s.slug === slug);
  if (!scope) notFound();
  return { user, businessId: scope.scopeId, role: scope.role as "owner" | "staff" };
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
