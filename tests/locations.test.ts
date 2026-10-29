import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { location, user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { addLocation, archiveLocation, listLocations, locationSchema, updateLocation } from "@/lib/locations";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
let businessId = "";
let otherBusinessId = "";
const ownerId = `user-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const loc = (name: string, address = "", timezone = "America/Phoenix") => locationSchema.parse({ name, address, timezone });

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  await admin.insert(user).values({ id: ownerId, name: "Owner", email: `loc-${tag}@example.com`, emailVerified: true });
  const a = await createBusiness(ownerId, { name: "Loc Shop", slug: `loc-${tag}`, timezone: "America/Phoenix", locationName: "Mill Ave" }, app);
  const b = await createBusiness(ownerId, { name: "Loc Other", slug: `loc-other-${tag}`, timezone: "America/Phoenix" }, app);
  if (!a.ok || !b.ok) throw new Error("fixtures not created");
  businessId = a.businessId;
  otherBusinessId = b.businessId;
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("locationSchema", () => {
  it("turns a blank address into null and rejects unknown time zones", () => {
    expect(loc("Downtown").address).toBeNull();
    expect(locationSchema.safeParse({ name: "X Street", address: "", timezone: "Europe/Paris" }).success).toBe(false);
    expect(locationSchema.safeParse({ name: "X", address: "", timezone: "America/Phoenix" }).success).toBe(false);
  });
});

describe("locations", () => {
  it("adds locations and refuses duplicate names, case-insensitively", async () => {
    const added = await addLocation(businessId, ownerId, loc("Scottsdale Rd", "7000 E Main St"), app);
    expect(added.ok).toBe(true);
    expect(await addLocation(businessId, ownerId, loc("scottsdale rd"), app)).toMatchObject({ ok: false, field: "name" });

    const names = (await listLocations(businessId, app)).map((l) => l.name);
    expect(names).toEqual(["Mill Ave", "Scottsdale Rd"]);
  });

  it("renames and moves a location, but not onto another's name", async () => {
    const [mill, scottsdale] = await listLocations(businessId, app);
    expect(await updateLocation(businessId, ownerId, scottsdale.id, loc("Mill Ave"), app)).toMatchObject({ ok: false, field: "name" });
    expect(await updateLocation(businessId, ownerId, scottsdale.id, loc("Old Town", "1 Old Town Way", "America/Denver"), app)).toEqual({
      ok: true,
      id: scottsdale.id,
    });
    // Keeping its own name is fine.
    expect((await updateLocation(businessId, ownerId, mill.id, loc("Mill Ave", "500 S Mill Ave"), app)).ok).toBe(true);

    const [, oldTown] = await listLocations(businessId, app);
    expect(oldTown).toMatchObject({ name: "Old Town", address: "1 Old Town Way", timezone: "America/Denver" });
  });

  it("archives instead of deleting, and always keeps one location", async () => {
    const [mill, oldTown] = await listLocations(businessId, app);
    expect(await archiveLocation(businessId, ownerId, oldTown.id, app)).toEqual({ ok: true, id: oldTown.id });
    expect((await listLocations(businessId, app)).map((l) => l.name)).toEqual(["Mill Ave"]);

    const [row] = await admin.select().from(location).where(eq(location.id, oldTown.id));
    expect(row.archivedAt).toBeInstanceOf(Date);

    expect(await archiveLocation(businessId, ownerId, mill.id, app)).toEqual({ ok: false, field: "form", message: "You need at least one location." });
    // Archived locations can't be edited, and their name is free again.
    expect((await updateLocation(businessId, ownerId, oldTown.id, loc("Old Town 2"), app)).ok).toBe(false);
    expect((await addLocation(businessId, ownerId, loc("Old Town"), app)).ok).toBe(true);
  });

  it("can't touch another business's locations", async () => {
    const [mill] = await listLocations(businessId, app);
    expect((await updateLocation(otherBusinessId, ownerId, mill.id, loc("Hijacked"), app)).ok).toBe(false);
    expect((await archiveLocation(otherBusinessId, ownerId, mill.id, app)).ok).toBe(false);
    expect((await listLocations(businessId, app))[0].name).toBe("Mill Ave");
  });
});
