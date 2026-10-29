import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTenant, type Db } from "@/db";
import { auditLog, location } from "@/db/schema";
import { US_TIMEZONES } from "@/lib/business-client";

export const locationSchema = z.object({
  name: z.string().trim().min(2, "Enter a name, like the street or neighborhood").max(80),
  address: z
    .string()
    .trim()
    .max(200)
    .transform((a) => a || null),
  timezone: z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]], "Pick a time zone"),
});

export type LocationInput = z.infer<typeof locationSchema>;
export type LocationResult = { ok: true; id: string } | { ok: false; field: "name" | "form"; message: string };

/** Active locations, oldest first (the first one is the main location). */
export async function listLocations(businessId: string, db: Db = getDb()) {
  return withTenant(
    { businessId },
    (tx) =>
      tx
        .select()
        .from(location)
        .where(and(eq(location.businessId, businessId), isNull(location.archivedAt)))
        .orderBy(location.createdAt),
    db,
  );
}

const nameTaken = (businessId: string, name: string, exceptId?: string) =>
  and(
    eq(location.businessId, businessId),
    isNull(location.archivedAt),
    sql`lower(${location.name}) = ${name.toLowerCase()}`,
    exceptId ? ne(location.id, exceptId) : undefined,
  );

const DUPLICATE: LocationResult = { ok: false, field: "name", message: "You already have a location with this name." };

export async function addLocation(businessId: string, actorId: string, input: LocationInput, db: Db = getDb()): Promise<LocationResult> {
  return withTenant(
    { businessId },
    async (tx) => {
      if ((await tx.select({ id: location.id }).from(location).where(nameTaken(businessId, input.name))).length) return DUPLICATE;
      const [row] = await tx.insert(location).values({ businessId, ...input }).returning({ id: location.id });
      await tx.insert(auditLog).values({ businessId, actorUserId: actorId, action: "location.created", target: `location:${row.id}` });
      return { ok: true, id: row.id } as const;
    },
    db,
  );
}

export async function updateLocation(
  businessId: string,
  actorId: string,
  locationId: string,
  input: LocationInput,
  db: Db = getDb(),
): Promise<LocationResult> {
  return withTenant(
    { businessId },
    async (tx) => {
      if ((await tx.select({ id: location.id }).from(location).where(nameTaken(businessId, input.name, locationId))).length) return DUPLICATE;
      const rows = await tx
        .update(location)
        .set(input)
        .where(and(eq(location.id, locationId), isNull(location.archivedAt)))
        .returning({ id: location.id });
      if (!rows.length) return { ok: false, field: "form", message: "That location no longer exists." } as const;
      await tx.insert(auditLog).values({ businessId, actorUserId: actorId, action: "location.updated", target: `location:${locationId}`, metadata: input });
      return { ok: true, id: locationId } as const;
    },
    db,
  );
}

/**
 * Hides a location from the app. Its row stays so punches made there keep
 * their history. A business always keeps at least one active location.
 */
export async function archiveLocation(businessId: string, actorId: string, locationId: string, db: Db = getDb()): Promise<LocationResult> {
  return withTenant(
    { businessId },
    async (tx) => {
      // Lock the business's active locations so two archives can't race past the "last one" check.
      const active = await tx
        .select({ id: location.id })
        .from(location)
        .where(and(eq(location.businessId, businessId), isNull(location.archivedAt)))
        .for("update");
      if (!active.some((l) => l.id === locationId)) return { ok: false, field: "form", message: "That location no longer exists." } as const;
      if (active.length <= 1) return { ok: false, field: "form", message: "You need at least one location." } as const;

      await tx.update(location).set({ archivedAt: new Date() }).where(eq(location.id, locationId));
      await tx.insert(auditLog).values({ businessId, actorUserId: actorId, action: "location.archived", target: `location:${locationId}` });
      return { ok: true, id: locationId } as const;
    },
    db,
  );
}
