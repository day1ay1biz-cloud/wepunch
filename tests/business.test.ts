import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import { auditLog, business, location, membership, user } from "@/db/schema";
import { createBusiness, createBusinessSchema, slugify, slugProblem } from "@/lib/business";
import { getUserScopes } from "@/lib/session";
import { adminDb, appDb } from "./db";

describe("slugify", () => {
  it.each([
    ["Joe's Coffee", "joes-coffee"],
    ["Café Olé & Co.", "cafe-ole-co"],
    ["  --Bella   Salon--  ", "bella-salon"],
    ["A".repeat(60), "a".repeat(48)],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe("slugProblem", () => {
  it.each([
    ["joes-coffee", null],
    ["ab", "Use at least 3 characters"],
    ["-joes", expect.stringContaining("lowercase")],
    ["Joes", expect.stringContaining("lowercase")],
    ["dashboard", "That address is reserved"],
    ["monitoring", "That address is reserved"],
  ])("%s", (slug, problem) => {
    expect(slugProblem(slug)).toEqual(problem);
  });

  it("rejects time zones outside the US list", () => {
    const parsed = createBusinessSchema.safeParse({ name: "Shop", slug: "shop-x", timezone: "Europe/London" });
    expect(parsed.success).toBe(false);
  });
});

describe("createBusiness", () => {
  let admin: Db;
  let app: Db;
  const ownerId = `user-${randomUUID()}`;
  const otherId = `user-${randomUUID()}`;
  const slug = `shop-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    admin = adminDb();
    app = appDb();
    await admin.insert(user).values([
      { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true },
      { id: otherId, name: "Other", email: `${otherId}@example.com`, emailVerified: true },
    ]);
  });

  afterAll(async () => {
    await admin?.$client.end();
    await app?.$client.end();
  });

  it("creates the business, a location and an owner membership in its own scope", async () => {
    const result = await createBusiness(
      ownerId,
      { name: "Test Shop", slug, timezone: "America/Chicago", locationName: "Downtown", address: "1 Main St" },
      app,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await withTenant({ businessId: result.businessId }, async (tx) => ({
      biz: await tx.select().from(business),
      locs: await tx.select().from(location),
      members: await tx.select().from(membership),
      audit: await tx.select().from(auditLog),
    }), app);
    expect(rows.biz).toMatchObject([{ name: "Test Shop", slug, timezone: "America/Chicago", status: "trialing" }]);
    expect(rows.locs).toMatchObject([{ name: "Downtown", address: "1 Main St" }]);
    expect(rows.members).toMatchObject([{ userId: ownerId, role: "owner" }]);
    expect(rows.audit).toMatchObject([{ action: "business.created", actorUserId: ownerId }]);

    expect((await getUserScopes(ownerId, app)).map((s) => [s.slug, s.role])).toEqual([[slug, "owner"]]);
    expect(await getUserScopes(otherId, app)).toEqual([]);
  });

  it("refuses a slug that is already taken", async () => {
    const result = await createBusiness(otherId, { name: "Copycat", slug, timezone: "America/New_York" }, app);
    expect(result).toEqual({ ok: false, field: "slug", message: "That address is taken. Try another." });
    const [count] = await admin.select().from(business).where(eq(business.slug, slug));
    expect(count.name).toBe("Test Shop");
  });

  it("defaults the location name when none is given", async () => {
    const result = await createBusiness(otherId, { name: "Second", slug: `${slug}-2`, timezone: "America/Denver" }, app);
    if (!result.ok) throw new Error(result.message);
    const locs = await withTenant({ businessId: result.businessId }, (tx) => tx.select().from(location), app);
    expect(locs).toMatchObject([{ name: "Main location", address: null }]);
  });
});
