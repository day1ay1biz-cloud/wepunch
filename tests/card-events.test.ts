import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "@/db";
import { user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { upsertVerifiedCustomer } from "@/lib/customer-auth";
import { joinCard } from "@/lib/enrollment";
import { listLocations } from "@/lib/locations";
import { PROGRAM_DEFAULTS, saveProgram } from "@/lib/program";
import { punch, redeem } from "@/lib/punching";
import { adminDb, appDb, urls } from "./db";

let admin: Db;
let app: Db;
let listener: postgres.Sql;

beforeAll(() => {
  admin = adminDb();
  app = appDb();
  listener = postgres(urls.app, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await listener?.end();
  await admin?.$client.end();
  await app?.$client.end();
});

it("punches and redemptions notify listeners on commit, naming the customer and business", async () => {
  const ownerId = `owner-${randomUUID()}`;
  await admin.insert(user).values({ id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true });
  const biz = await createBusiness(ownerId, { name: "Live", slug: `live-${randomUUID().slice(0, 8)}`, timezone: "America/Phoenix" }, app);
  if (!biz.ok) throw new Error("business");
  await saveProgram(biz.businessId, ownerId, { ...PROGRAM_DEFAULTS, punchesRequired: 2, maxPunchesPerVisit: 2, minMinutesBetween: 0 }, app);
  const locationId = (await listLocations(biz.businessId, app))[0].id;
  const customerId = await upsertVerifiedCustomer("email", `live-${randomUUID()}@example.com`, app);
  const joined = await joinCard({ businessId: biz.businessId, customerId, marketingSms: false, marketingEmail: false, ip: null }, app);
  if (!joined.ok) throw new Error("join");

  const received: { businessId: string; customerId: string }[] = [];
  await listener.listen("card_activity", (payload) => received.push(JSON.parse(payload)));

  const ctx = { businessId: biz.businessId, actor: { userId: ownerId, role: "owner" as const, locationIds: [] }, locationId };
  await punch(ctx, { cardId: joined.cardId, count: 2 }, app);
  await redeem(ctx, { customerId }, app);
  // A refused punch (too many) must not notify anyone.
  await punch(ctx, { cardId: joined.cardId, count: 5 }, app);

  await new Promise((r) => setTimeout(r, 300));
  const mine = received.filter((e) => e.customerId === customerId);
  expect(mine).toEqual([
    { businessId: biz.businessId, customerId },
    { businessId: biz.businessId, customerId },
  ]);
});
