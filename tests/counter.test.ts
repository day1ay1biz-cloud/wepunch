import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { signCardToken } from "@/lib/card-token";
import { actorFor, cardSummary, lookupByToken, recentActivity, searchCustomers } from "@/lib/counter";
import { upsertVerifiedCustomer } from "@/lib/customer-auth";
import { joinCard } from "@/lib/enrollment";
import { listLocations } from "@/lib/locations";
import { PROGRAM_DEFAULTS, saveProgram } from "@/lib/program";
import { punch, undoPunch } from "@/lib/punching";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
const tag = randomUUID().slice(0, 8);
const ownerId = `owner-${randomUUID()}`;
let biz = "";
let other = "";
let loc = "";
const last4 = String(randomInt(1000, 9999));
let mariaCard = "";
let mariaId = "";

async function join(businessId: string, channel: "sms" | "email", destination: string, firstName: string) {
  const customerId = await upsertVerifiedCustomer(channel, destination, app);
  const res = await joinCard({ businessId, customerId, firstName, marketingSms: false, marketingEmail: false, ip: null }, app);
  if (!res.ok) throw new Error("join");
  return { customerId, cardId: res.cardId };
}

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  await admin.insert(user).values({ id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true });
  const a = await createBusiness(ownerId, { name: "Lookup", slug: `lookup-${tag}`, timezone: "America/Phoenix" }, app);
  const b = await createBusiness(ownerId, { name: "Other", slug: `lookup-o-${tag}`, timezone: "America/Phoenix" }, app);
  if (!a.ok || !b.ok) throw new Error("fixtures");
  biz = a.businessId;
  other = b.businessId;
  await saveProgram(biz, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 5, maxPunchesPerVisit: 2, minMinutesBetween: 0 }, app);
  await saveProgram(other, ownerId, { ...PROGRAM_DEFAULTS, minMinutesBetween: 0 }, app);
  loc = (await listLocations(biz, app))[0].id;

  const maria = await join(biz, "sms", `+1480555${last4}`, "Maria");
  mariaCard = maria.cardId;
  mariaId = maria.customerId;
  await join(biz, "email", `sam-${tag}@example.com`, "Sam");
  // Only a member of the other business: must never show up here.
  await join(other, "sms", `+1602555${last4}`, "Stranger");
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("lookup", () => {
  it("identifies a customer from a fresh code, and explains bad ones", async () => {
    const { token } = signCardToken(mariaCard, biz);
    const res = await lookupByToken(biz, token, app);
    expect(res).toMatchObject({ ok: true, summary: { name: "Maria", contact: `(•••) •••-${last4}`, punches: 0, punchesRequired: 5, maxPunchesPerVisit: 2 } });

    expect(await lookupByToken(other, token, app)).toEqual({ ok: false, message: "That card belongs to a different business." });
    const old = signCardToken(mariaCard, biz, Date.now() - 120_000).token;
    expect(await lookupByToken(biz, old, app)).toMatchObject({ ok: false, message: expect.stringContaining("expired") });
    expect(await lookupByToken(biz, "https://example.com", app)).toMatchObject({ ok: false });
  });

  it("finds customers by the last phone digits or email, only those with a card here", async () => {
    const byPhone = await searchCustomers(biz, last4, app);
    expect(byPhone.map((m) => m.name)).toEqual(["Maria"]);
    expect((await searchCustomers(biz, `sam-${tag}`, app)).map((m) => m.name)).toEqual(["Sam"]);
    expect(await searchCustomers(biz, "12", app)).toEqual([]);
    expect((await searchCustomers(other, last4, app)).map((m) => m.name)).toEqual(["Stranger"]);
  });

  it("follows a full card to the customer's current one", async () => {
    const actor = await actorFor(biz, ownerId, "owner", app);
    for (let i = 0; i < 3; i++) await punch({ businessId: biz, actor, locationId: loc }, { cardId: mariaCard, count: 2 }, app);
    const summary = await cardSummary(biz, { cardId: mariaCard }, app);
    expect(summary).toMatchObject({ customerId: mariaId, punches: 1, rewardsAvailable: 1 });
    expect(summary?.cardId).not.toBe(mariaCard);
  });

  it("lists recent activity with undone punches marked", async () => {
    const actor = await actorFor(biz, ownerId, "owner", app);
    const res = await punch({ businessId: biz, actor, locationId: loc }, { cardId: mariaCard, count: 1 }, app);
    if (!res.ok) throw new Error(res.message);
    await undoPunch({ businessId: biz, actor }, res.eventId, app);

    const items = await recentActivity(biz, app);
    expect(items[0]).toMatchObject({ kind: "punch", id: res.eventId, customerName: "Maria", detail: "+1 punch", undone: true, staffName: "Owner" });
    expect(items.every((i) => i.customerName !== "Stranger")).toBe(true);
  });
});
