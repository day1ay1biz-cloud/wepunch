import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import { auditLog, business, program, user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { getActiveProgram, PROGRAM_DEFAULTS, programSchema, saveProgram } from "@/lib/program";
import { textColorOn } from "@/lib/program-rules";
import { adminDb, appDb } from "./db";

const form = (overrides: Record<string, string | undefined> = {}) => ({
  name: "Coffee Card",
  rewardText: "Free drink",
  punchesRequired: "10",
  brandColor: "#6B3E26",
  maxPunchesPerVisit: "1",
  minMinutesBetween: "60",
  expiryDays: "",
  ...overrides,
});

describe("programSchema", () => {
  it("parses form strings into typed rules", () => {
    expect(programSchema.parse(form({ punchOnJoin: "on", expiryDays: "365" }))).toEqual({
      name: "Coffee Card",
      rewardText: "Free drink",
      punchesRequired: 10,
      brandColor: "#6b3e26",
      maxPunchesPerVisit: 1,
      minMinutesBetween: 60,
      expiryDays: 365,
      punchOnJoin: true,
    });
  });

  it("treats a blank expiry as never and a missing checkbox as off", () => {
    const parsed = programSchema.parse(form());
    expect(parsed.expiryDays).toBeNull();
    expect(parsed.punchOnJoin).toBe(false);
  });

  it.each([
    ["punchesRequired", "1"],
    ["punchesRequired", "21"],
    ["punchesRequired", "4.5"],
    ["brandColor", "brown"],
    ["maxPunchesPerVisit", "0"],
    ["minMinutesBetween", "-5"],
    ["expiryDays", "7"],
    ["name", " "],
  ])("rejects %s = %j", (field, value) => {
    const result = programSchema.safeParse(form({ [field]: value }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe(field);
  });
});

describe("textColorOn", () => {
  it.each([
    ["#18181b", "#ffffff"],
    ["#6b3e26", "#ffffff"],
    ["#ffffff", "#18181b"],
    ["#facc15", "#18181b"],
  ])("%s → %s", (bg, fg) => {
    expect(textColorOn(bg)).toBe(fg);
  });
});

describe("saveProgram", () => {
  let admin: Db;
  let app: Db;
  const ownerId = `user-${randomUUID()}`;
  let businessId = "";
  let otherBusinessId = "";

  beforeAll(async () => {
    admin = adminDb();
    app = appDb();
    await admin.insert(user).values({ id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true });
    const a = await createBusiness(ownerId, { name: "Card Shop", slug: `card-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" }, app);
    const b = await createBusiness(ownerId, { name: "Other", slug: `other-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" }, app);
    if (!a.ok || !b.ok) throw new Error("fixture businesses not created");
    businessId = a.businessId;
    otherBusinessId = b.businessId;
  });

  afterAll(async () => {
    await admin?.$client.end();
    await app?.$client.end();
  });

  it("creates the card on first save and sets the brand colour", async () => {
    expect(await getActiveProgram(businessId, app)).toBeNull();
    const input = programSchema.parse(form());
    const result = await saveProgram(businessId, ownerId, input, app);
    expect(result.created).toBe(true);

    const saved = await getActiveProgram(businessId, app);
    expect(saved).toMatchObject({ name: "Coffee Card", punchesRequired: 10, rewardText: "Free drink", expiryDays: null });
    const [biz] = await admin.select().from(business).where(eq(business.id, businessId));
    expect(biz.brandColor).toBe("#6b3e26");
  });

  it("updates the same card on later saves instead of adding another", async () => {
    const result = await saveProgram(businessId, ownerId, { ...PROGRAM_DEFAULTS, name: "Bean Card", punchesRequired: 8 }, app);
    expect(result.created).toBe(false);

    const programs = await withTenant({ businessId }, (tx) => tx.select().from(program), app);
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({ name: "Bean Card", punchesRequired: 8 });

    const audit = await withTenant({ businessId }, (tx) => tx.select({ action: auditLog.action }).from(auditLog), app);
    expect(audit.map((a) => a.action).sort()).toEqual(["business.created", "program.created", "program.updated"]);
  });

  it("leaves other businesses untouched", async () => {
    expect(await getActiveProgram(otherBusinessId, app)).toBeNull();
  });
});
