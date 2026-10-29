import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, withTenant, type Db } from "@/db";
import { auditLog, business, location, membership } from "@/db/schema";
import { slugProblem, US_TIMEZONES } from "@/lib/business-client";
import { resolveTenant } from "@/lib/tenant";

export { slugify, slugProblem, US_TIMEZONES } from "@/lib/business-client";

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((s, ctx) => {
      const problem = slugProblem(s);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  timezone: z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]], "Pick your time zone"),
  locationName: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export type CreateBusinessResult =
  | { ok: true; businessId: string; slug: string }
  | { ok: false; field: "slug"; message: string };

/**
 * Creates a business with its first location and makes `userId` its owner.
 * `userId` must come from the authenticated session. The new id is generated
 * here so the inserts can run inside that business's own RLS scope.
 */
export async function createBusiness(
  userId: string,
  input: CreateBusinessInput,
  db: Db = getDb(),
): Promise<CreateBusinessResult> {
  if (await resolveTenant({ slug: input.slug }, db)) {
    return { ok: false, field: "slug", message: "That address is taken. Try another." };
  }

  const businessId = randomUUID();
  try {
    await withTenant(
      { businessId },
      async (tx) => {
        await tx.insert(business).values({
          id: businessId,
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
        });
        await tx.insert(location).values({
          businessId,
          name: input.locationName || "Main location",
          address: input.address || null,
          timezone: input.timezone,
        });
        await tx.insert(membership).values({ businessId, userId, role: "owner" });
        await tx.insert(auditLog).values({
          businessId,
          actorUserId: userId,
          action: "business.created",
          target: `business:${businessId}`,
        });
      },
      db,
    );
  } catch (err) {
    // Someone took the slug between the check and the insert.
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return { ok: false, field: "slug", message: "That address is taken. Try another." };
    throw err;
  }
  return { ok: true, businessId, slug: input.slug };
}
