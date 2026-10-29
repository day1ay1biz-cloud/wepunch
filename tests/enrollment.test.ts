import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import { card, customerConsent, punchEvent, user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { signCardToken, verifyCardToken } from "@/lib/card-token";
import { upsertVerifiedCustomer } from "@/lib/customer-auth";
import { getCustomerCard, joinCard } from "@/lib/enrollment";
import { PROGRAM_DEFAULTS, saveProgram } from "@/lib/program";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
const tag = randomUUID().slice(0, 8);
const ownerId = `user-${randomUUID()}`;
let withCard = "";
let freePunch = "";
let noCard = "";

async function newBusiness(slug: string) {
  const res = await createBusiness(ownerId, { name: slug, slug, timezone: "America/Phoenix" }, app);
  if (!res.ok) throw new Error(res.message);
  return res.businessId;
}

const customerFor = () => upsertVerifiedCustomer("email", `c-${randomUUID()}@example.com`, app);
const join = (businessId: string, customerId: string, extra: Partial<Parameters<typeof joinCard>[0]> = {}) =>
  joinCard({ businessId, customerId, marketingSms: false, marketingEmail: false, ip: "203.0.113.5", ...extra }, app);

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  await admin.insert(user).values({ id: ownerId, name: "Owner", email: `enroll-${tag}@example.com`, emailVerified: true });
  withCard = await newBusiness(`enroll-${tag}`);
  freePunch = await newBusiness(`enroll-free-${tag}`);
  noCard = await newBusiness(`enroll-none-${tag}`);
  await saveProgram(withCard, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 8, punchOnJoin: false }, app);
  await saveProgram(freePunch, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 5, punchOnJoin: true }, app);
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("joinCard", () => {
  it("creates a card once; joining again returns the same card", async () => {
    const customerId = await customerFor();
    const first = await join(withCard, customerId, { firstName: "Maria" });
    const second = await join(withCard, customerId, { firstName: "Someone Else" });
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toEqual({ ok: true, cardId: first.ok ? first.cardId : "", created: false });

    expect(await getCustomerCard(withCard, customerId, app)).toMatchObject({
      punches: 0,
      punchesRequired: 8,
      rewardsAvailable: 0,
      firstName: "Maria",
    });
  });

  it("gives the first punch on joining when the card says so, with a ledger entry", async () => {
    const customerId = await customerFor();
    const res = await join(freePunch, customerId);
    if (!res.ok) throw new Error("join failed");
    expect((await getCustomerCard(freePunch, customerId, app))?.punches).toBe(1);

    const events = await withTenant({ businessId: freePunch }, (tx) => tx.select().from(punchEvent).where(eq(punchEvent.cardId, res.cardId)), app);
    expect(events).toMatchObject([{ delta: 1, reason: "join", staffUserId: null }]);
  });

  it("refuses to join a business with no card yet", async () => {
    expect(await join(noCard, await customerFor())).toEqual({ ok: false, reason: "not_ready" });
  });

  it("records opt-in time and source, and joining again never opts out", async () => {
    const customerId = await customerFor();
    await join(withCard, customerId, { marketingEmail: true });
    await join(withCard, customerId, { marketingEmail: false, marketingSms: true });

    const [consent] = await withTenant(
      { businessId: withCard },
      (tx) => tx.select().from(customerConsent).where(and(eq(customerConsent.customerId, customerId), eq(customerConsent.businessId, withCard))),
      app,
    );
    expect(consent).toMatchObject({ marketingEmail: true, marketingSms: true, source: "join_page", ip: "203.0.113.5" });
    expect(consent.marketingEmailAt).toBeInstanceOf(Date);
    expect(consent.marketingSmsAt).toBeInstanceOf(Date);
  });
});

describe("customer isolation", () => {
  it("one customer can't see another's card, even at the same business", async () => {
    const maria = await customerFor();
    const sam = await customerFor();
    await join(withCard, maria);
    await join(withCard, sam);

    const seenBySam = await withTenant({ customerId: sam }, (tx) => tx.select({ customerId: card.customerId }).from(card), app);
    expect(seenBySam.map((c) => c.customerId)).toEqual([sam]);
    expect(await getCustomerCard(freePunch, maria, app)).toBeNull();
  });
});

describe("card QR tokens", () => {
  const cardId = randomUUID();
  const businessId = randomUUID();

  it("round-trips and expires after 60 seconds", () => {
    const now = Date.now();
    const { token, expiresAt } = signCardToken(cardId, businessId, now);
    expect(expiresAt).toBeGreaterThan(now + 59_000);
    expect(verifyCardToken(token, businessId, now + 1000)).toMatchObject({ ok: true, cardId });
    expect(verifyCardToken(token, businessId, now + 61_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects edits, other businesses and junk", () => {
    const { token } = signCardToken(cardId, businessId);
    const [prefix, body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), c: randomUUID() })).toString("base64url");
    expect(verifyCardToken(`${prefix}.${forged}.${sig}`, businessId)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCardToken(token, randomUUID())).toEqual({ ok: false, reason: "wrong_business" });
    expect(verifyCardToken("hello", businessId)).toEqual({ ok: false, reason: "malformed" });
  });

  it("gives every token a fresh nonce", () => {
    expect(signCardToken(cardId, businessId).token).not.toBe(signCardToken(cardId, businessId).token);
  });
});
