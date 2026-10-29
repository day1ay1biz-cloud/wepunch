import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import { card, punchEvent, reward, user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { upsertVerifiedCustomer } from "@/lib/customer-auth";
import { joinCard } from "@/lib/enrollment";
import { addLocation, archiveLocation, listLocations, locationSchema } from "@/lib/locations";
import { PROGRAM_DEFAULTS, saveProgram } from "@/lib/program";
import { punch, redeem, undoPunch, undoRedeem, type Actor, type CounterContext } from "@/lib/punching";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
const tag = randomUUID().slice(0, 8);
const ownerId = `owner-${randomUUID()}`;
const staffId = `staff-${randomUUID()}`;
const otherStaffId = `staff-${randomUUID()}`;

// Business "main": 3 punches per card, up to 2 per visit, no cooldown.
// Business "slow": 60 minutes between punches, first punch free on joining.
let main = "";
let slow = "";
let mainLoc = "";
let secondLoc = "";
let slowLoc = "";

const owner = (): Actor => ({ userId: ownerId, role: "owner", locationIds: [] });
const staff = (locationIds: string[] = [], userId = staffId): Actor => ({ userId, role: "staff", locationIds });
const at = (businessId: string, actor: Actor, locationId: string): CounterContext => ({ businessId, actor, locationId });

async function newCustomerCard(businessId: string) {
  const customerId = await upsertVerifiedCustomer("email", `p-${randomUUID()}@example.com`, app);
  const joined = await joinCard({ businessId, customerId, marketingSms: false, marketingEmail: false, ip: null }, app);
  if (!joined.ok) throw new Error("join failed");
  return { customerId, cardId: joined.cardId };
}

const cardRow = async (id: string) => (await admin.select().from(card).where(eq(card.id, id)))[0];

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  await admin.insert(user).values([
    { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true },
    { id: staffId, name: "Staff", email: `${staffId}@example.com`, emailVerified: true },
    { id: otherStaffId, name: "Other", email: `${otherStaffId}@example.com`, emailVerified: true },
  ]);
  const a = await createBusiness(ownerId, { name: "Main", slug: `punch-${tag}`, timezone: "America/Phoenix" }, app);
  const b = await createBusiness(ownerId, { name: "Slow", slug: `punch-slow-${tag}`, timezone: "America/Phoenix" }, app);
  if (!a.ok || !b.ok) throw new Error("fixtures");
  main = a.businessId;
  slow = b.businessId;
  await saveProgram(main, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 3, maxPunchesPerVisit: 2, minMinutesBetween: 0 }, app);
  await saveProgram(slow, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 5, maxPunchesPerVisit: 1, minMinutesBetween: 60, punchOnJoin: true }, app);
  mainLoc = (await listLocations(main, app))[0].id;
  const second = await addLocation(main, ownerId, locationSchema.parse({ name: "Second", address: "", timezone: "America/Phoenix" }), app);
  if (!second.ok) throw new Error("location");
  secondLoc = second.id;
  slowLoc = (await listLocations(slow, app))[0].id;
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("punching", () => {
  it("adds a punch and records who, where and how many", async () => {
    const { cardId } = await newCustomerCard(main);
    const res = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    expect(res).toMatchObject({ ok: true, punches: 1, punchesRequired: 3, rewardsEarned: 0, rewardsAvailable: 0 });

    const events = await withTenant({ businessId: main }, (tx) => tx.select().from(punchEvent).where(eq(punchEvent.cardId, cardId)), app);
    expect(events).toMatchObject([{ delta: 1, staffUserId: staffId, locationId: mainLoc }]);
  });

  it("enforces the most punches per visit", async () => {
    const { cardId } = await newCustomerCard(main);
    expect(await punch(at(main, staff(), mainLoc), { cardId, count: 3 }, app)).toMatchObject({ ok: false, reason: "too_many" });
    expect(await punch(at(main, staff(), mainLoc), { cardId, count: 0 }, app)).toMatchObject({ ok: false, reason: "too_many" });
    expect((await cardRow(cardId)).punches).toBe(0);
  });

  it("fills the card, earns a reward and carries extra punches to a new card", async () => {
    const { cardId, customerId } = await newCustomerCard(main);
    await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    const res = await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    if (!res.ok) throw new Error(res.message);
    expect(res).toMatchObject({ punches: 1, rewardsEarned: 1, rewardsAvailable: 1 });
    expect(res.cardId).not.toBe(cardId);

    expect(await cardRow(cardId)).toMatchObject({ status: "completed", punches: 3 });
    expect(await cardRow(res.cardId)).toMatchObject({ status: "active", punches: 1, customerId });

    // The ledger matches the card balances: 2 + 1 on the full card, 1 on the new one.
    const sums = await admin
      .select({ cardId: punchEvent.cardId, delta: punchEvent.delta })
      .from(punchEvent)
      .where(eq(punchEvent.businessId, main));
    const total = (id: string) => sums.filter((s) => s.cardId === id).reduce((a, s) => a + s.delta, 0);
    expect([total(cardId), total(res.cardId)]).toEqual([3, 1]);
  });

  it("a scan of the old, now-full card punches the customer's current card", async () => {
    const { cardId } = await newCustomerCard(main);
    await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    const filled = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    if (!filled.ok) throw new Error(filled.message);
    const again = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    expect(again).toMatchObject({ ok: true, cardId: filled.cardId, punches: 1 });
  });

  it("applies a retried punch once", async () => {
    const { cardId } = await newCustomerCard(main);
    const clientEventId = randomUUID();
    await punch(at(main, staff(), mainLoc), { cardId, count: 1, clientEventId }, app);
    const retry = await punch(at(main, staff(), mainLoc), { cardId, count: 1, clientEventId }, app);
    expect(retry).toMatchObject({ ok: true, duplicate: true, punches: 1 });
  });

  it("uses a scanned code once per action", async () => {
    const { cardId, customerId } = await newCustomerCard(main);
    const tokenNonce = randomUUID();
    expect((await punch(at(main, staff(), mainLoc), { cardId, count: 1, tokenNonce }, app)).ok).toBe(true);
    expect(await punch(at(main, staff(), mainLoc), { cardId, count: 1, tokenNonce }, app)).toMatchObject({ ok: false, reason: "token_used" });
    // The same code may still redeem (there's nothing to redeem yet, so it says so).
    expect(await redeem(at(main, staff(), mainLoc), { customerId, tokenNonce }, app)).toMatchObject({ ok: false, reason: "none" });
  });

  it("keeps staff to their locations and refuses archived ones", async () => {
    const { cardId } = await newCustomerCard(main);
    expect(await punch(at(main, staff([mainLoc]), secondLoc), { cardId, count: 1 }, app)).toMatchObject({ ok: false, reason: "location" });
    expect((await punch(at(main, staff([mainLoc]), mainLoc), { cardId, count: 1 }, app)).ok).toBe(true);

    const extra = await addLocation(main, ownerId, locationSchema.parse({ name: `Temp ${tag}`, address: "", timezone: "America/Phoenix" }), app);
    if (!extra.ok) throw new Error("location");
    await archiveLocation(main, ownerId, extra.id, app);
    expect(await punch(at(main, owner(), extra.id), { cardId, count: 1 }, app)).toMatchObject({ ok: false, reason: "location" });
  });

  it("can't reach another business's card", async () => {
    const { cardId } = await newCustomerCard(main);
    expect(await punch(at(slow, owner(), slowLoc), { cardId, count: 1 }, app)).toMatchObject({ ok: false, reason: "no_card" });
  });

  it("two devices punching at once both count", async () => {
    const { cardId } = await newCustomerCard(main);
    const second = appDb();
    try {
      await Promise.all([
        punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app),
        punch(at(main, staff(), mainLoc), { cardId, count: 1 }, second),
      ]);
    } finally {
      await second.$client.end();
    }
    expect((await cardRow(cardId)).punches).toBe(2);
  });
});

describe("minutes between punches", () => {
  it("blocks a second punch inside the window, ignoring the free join punch and undone punches", async () => {
    const { cardId } = await newCustomerCard(slow);
    expect((await cardRow(cardId)).punches).toBe(1); // free on joining

    const first = await punch(at(slow, staff(), slowLoc), { cardId, count: 1 }, app);
    expect(first).toMatchObject({ ok: true, punches: 2 });
    expect(await punch(at(slow, staff(), slowLoc), { cardId, count: 1 }, app)).toMatchObject({
      ok: false,
      reason: "cooldown",
      message: expect.stringContaining("60 minutes"),
    });

    if (!first.ok) throw new Error("punch");
    expect(await undoPunch({ businessId: slow, actor: staff() }, first.eventId, app)).toEqual({ ok: true });
    expect(await punch(at(slow, staff(), slowLoc), { cardId, count: 1 }, app)).toMatchObject({ ok: true, punches: 2 });
  });

  it("allows the next punch once the window has passed", async () => {
    const { cardId } = await newCustomerCard(slow);
    const first = await punch(at(slow, staff(), slowLoc), { cardId, count: 1 }, app);
    if (!first.ok) throw new Error("punch");
    await admin.update(punchEvent).set({ createdAt: new Date(Date.now() - 61 * 60_000) }).where(eq(punchEvent.id, first.eventId));
    expect((await punch(at(slow, staff(), slowLoc), { cardId, count: 1 }, app)).ok).toBe(true);
  });
});

describe("undo", () => {
  it("staff can undo their own punch for 10 minutes; after that only an owner can", async () => {
    const { cardId } = await newCustomerCard(main);
    const a = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    const b = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    if (!a.ok || !b.ok) throw new Error("punch");

    expect(await undoPunch({ businessId: main, actor: staff([], otherStaffId) }, b.eventId, app)).toEqual({ ok: false, message: "Ask an owner to undo this." });
    expect(await undoPunch({ businessId: main, actor: staff() }, b.eventId, app)).toEqual({ ok: true });
    expect(await undoPunch({ businessId: main, actor: staff() }, b.eventId, app)).toEqual({ ok: false, message: "That punch was already undone." });
    expect((await cardRow(cardId)).punches).toBe(1);

    await admin.update(punchEvent).set({ createdAt: new Date(Date.now() - 20 * 60_000) }).where(eq(punchEvent.id, a.eventId));
    expect(await undoPunch({ businessId: main, actor: staff() }, a.eventId, app)).toEqual({ ok: false, message: "Ask an owner to undo this." });
    expect(await undoPunch({ businessId: main, actor: owner() }, a.eventId, app)).toEqual({ ok: true });
    expect((await cardRow(cardId)).punches).toBe(0);
  });

  it("refuses after 24 hours and on a punch that filled the card", async () => {
    const { cardId } = await newCustomerCard(main);
    const a = await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    const full = await punch(at(main, staff(), mainLoc), { cardId, count: 1 }, app);
    if (!a.ok || !full.ok) throw new Error("punch");
    expect((await undoPunch({ businessId: main, actor: owner() }, full.eventId, app)).ok).toBe(false);

    const { cardId: other } = await newCustomerCard(main);
    const old = await punch(at(main, staff(), mainLoc), { cardId: other, count: 1 }, app);
    if (!old.ok) throw new Error("punch");
    await admin.update(punchEvent).set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) }).where(eq(punchEvent.id, old.eventId));
    expect(await undoPunch({ businessId: main, actor: owner() }, old.eventId, app)).toMatchObject({ ok: false, message: expect.stringContaining("24 hours") });
  });
});

describe("rewards", () => {
  it("redeems the oldest reward, and the redemption can be undone", async () => {
    const { cardId, customerId } = await newCustomerCard(main);
    await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    await punch(at(main, staff(), mainLoc), { cardId, count: 2 }, app);
    expect(await redeem(at(main, staff(), mainLoc), { customerId }, app)).toMatchObject({ ok: true, rewardsAvailable: 0 });
    expect(await redeem(at(main, staff(), mainLoc), { customerId }, app)).toMatchObject({ ok: false, reason: "none" });

    const [r] = await admin.select().from(reward).where(eq(reward.customerId, customerId));
    expect(r).toMatchObject({ status: "redeemed", redeemedBy: staffId, locationId: mainLoc });

    expect(await undoRedeem({ businessId: main, actor: staff([], otherStaffId) }, r.id, app)).toMatchObject({ ok: false });
    expect(await undoRedeem({ businessId: main, actor: staff() }, r.id, app)).toEqual({ ok: true });
    const [back] = await admin.select().from(reward).where(eq(reward.id, r.id));
    expect(back).toMatchObject({ status: "available", redeemedAt: null, redeemedBy: null });
  });
});
