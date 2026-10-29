import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import {
  agency,
  auditLog,
  business,
  card,
  customer,
  customerConsent,
  device,
  location,
  membership,
  program,
  punchEvent,
  reward,
  subscription,
  user,
} from "@/db/schema";
import { getUserScopes } from "@/lib/session";
import { resolveTenant } from "@/lib/tenant";
import { adminDb, appDb } from "./db";

// Fixture: an agency owning businesses A and B, and an independent business C.
// Every test acts as the app role and tries to reach data it must not see.
const ids = {
  agency: randomUUID(),
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  locA: randomUUID(),
  locC: randomUUID(),
  progA: randomUUID(),
  progC: randomUUID(),
  custA: randomUUID(),
  custC: randomUUID(),
  cardA: randomUUID(),
  cardC: randomUUID(),
  userA: `user-${randomUUID()}`,
};

let admin: Db;
let app: Db;

/** Postgres error code, unwrapped from drizzle's query error. */
async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}

const RLS_VIOLATION = "42501"; // insufficient_privilege, also raised by WITH CHECK

beforeAll(async () => {
  admin = adminDb();
  app = appDb();

  await admin.insert(agency).values({ id: ids.agency, name: "Agency" });
  await admin.insert(business).values([
    { id: ids.a, name: "A", slug: "biz-a", agencyId: ids.agency, customDomain: "loyalty.a.test" },
    { id: ids.b, name: "B", slug: "biz-b", agencyId: ids.agency },
    { id: ids.c, name: "C", slug: "biz-c" },
  ]);
  await admin.insert(location).values([
    { id: ids.locA, businessId: ids.a, name: "A main" },
    { id: ids.locC, businessId: ids.c, name: "C main" },
  ]);
  await admin.insert(program).values([
    { id: ids.progA, businessId: ids.a, name: "A card", punchesRequired: 10, rewardText: "A reward" },
    { id: ids.progC, businessId: ids.c, name: "C card", punchesRequired: 8, rewardText: "C reward" },
  ]);
  await admin.insert(customer).values([
    { id: ids.custA, phoneE164: "+15550000001" },
    { id: ids.custC, phoneE164: "+15550000003" },
  ]);
  await admin.insert(card).values([
    { id: ids.cardA, businessId: ids.a, programId: ids.progA, customerId: ids.custA, punches: 3 },
    { id: ids.cardC, businessId: ids.c, programId: ids.progC, customerId: ids.custC, punches: 5 },
  ]);
  await admin.insert(punchEvent).values([
    { businessId: ids.a, cardId: ids.cardA, delta: 3 },
    { businessId: ids.c, cardId: ids.cardC, delta: 5 },
  ]);
  await admin.insert(user).values({ id: ids.userA, name: "Owner A", email: "owner-a@example.com" });
  await admin.insert(membership).values([
    { businessId: ids.a, userId: ids.userA, role: "owner" },
    { businessId: ids.c, userId: ids.userA, role: "staff" },
  ]);
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("database setup", () => {
  it("enables RLS with a policy on every table that has a business_id", async () => {
    const rows = await admin.execute<{ table: string; rls: boolean; policies: number }>(sql`
      select c.relname as table, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname
                      and col.column_name = 'business_id')
    `);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      expect({ table: r.table, rls: r.rls, hasPolicy: r.policies > 0 }).toEqual({
        table: r.table,
        rls: true,
        hasPolicy: true,
      });
    }
  });

  it("connects the app as a role that is subject to RLS", async () => {
    const [role] = await app.execute<{ super: boolean; bypass: boolean }>(sql`
      select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user
    `);
    expect(role).toEqual({ super: false, bypass: false });
  });
});

describe("without a tenant scope", () => {
  it("sees no tenant rows at all", async () => {
    for (const table of [
      business,
      location,
      program,
      card,
      customer,
      membership,
      punchEvent,
      reward,
      device,
      customerConsent,
      auditLog,
      subscription,
      agency,
    ]) {
      expect(await app.select().from(table)).toEqual([]);
    }
  });
});

describe("scoped to business A", () => {
  const asA = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant({ businessId: ids.a }, fn, app);

  it("reads only A's rows", async () => {
    const result = await asA(async (tx) => ({
      businesses: await tx.select({ id: business.id }).from(business),
      programs: await tx.select({ id: program.id }).from(program),
      cards: await tx.select({ id: card.id }).from(card),
      events: await tx.select({ b: punchEvent.businessId }).from(punchEvent),
      members: await tx.select({ b: membership.businessId }).from(membership),
    }));
    expect(result.businesses).toEqual([{ id: ids.a }]);
    expect(result.programs).toEqual([{ id: ids.progA }]);
    expect(result.cards).toEqual([{ id: ids.cardA }]);
    expect(result.events).toEqual([{ b: ids.a }]);
    expect(result.members).toEqual([{ b: ids.a }]);
  });

  it("cannot read C's rows by id", async () => {
    const rows = await asA((tx) => tx.select().from(program).where(eq(program.id, ids.progC)));
    expect(rows).toEqual([]);
  });

  it("sees a customer only through A's own cards", async () => {
    const rows = await asA((tx) => tx.select({ id: customer.id }).from(customer));
    expect(rows).toEqual([{ id: ids.custA }]);
  });

  it("cannot insert rows for C", async () => {
    const code = await pgErrorCode(
      asA((tx) => tx.insert(location).values({ businessId: ids.c, name: "sneaky" })),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it("cannot move its own row into C", async () => {
    const code = await pgErrorCode(
      asA((tx) => tx.update(location).set({ businessId: ids.c }).where(eq(location.id, ids.locA))),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it("cannot update or delete C's rows", async () => {
    const updated = await asA((tx) =>
      tx.update(program).set({ name: "hacked" }).where(eq(program.id, ids.progC)).returning(),
    );
    const deleted = await asA((tx) =>
      tx.delete(location).where(eq(location.id, ids.locC)).returning(),
    );
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);

    const [progC] = await admin.select().from(program).where(eq(program.id, ids.progC));
    expect(progC.name).toBe("C card");
    expect(await admin.select().from(location).where(eq(location.id, ids.locC))).toHaveLength(1);
  });

  it("cannot edit the append-only punch ledger, even its own rows", async () => {
    const code = await pgErrorCode(asA((tx) => tx.update(punchEvent).set({ delta: 100 })));
    expect(code).toBe(RLS_VIOLATION);
  });

  it("does not leak scope to the next transaction on the same connection", async () => {
    await asA((tx) => tx.select().from(business));
    expect(await app.select().from(business)).toEqual([]);
  });
});

describe("scoped to the agency", () => {
  it("reaches its own businesses and no others", async () => {
    const rows = await withTenant(
      { agencyId: ids.agency },
      (tx) => tx.select({ id: business.id }).from(business).orderBy(business.slug),
      app,
    );
    expect(rows).toEqual([{ id: ids.a }, { id: ids.b }]);
  });
});

describe("scoped to a customer", () => {
  it("sees only that customer's own record and cards", async () => {
    const result = await withTenant(
      { customerId: ids.custC },
      async (tx) => ({
        customers: await tx.select({ id: customer.id }).from(customer),
        cards: await tx.select({ id: card.id }).from(card),
        programs: await tx.select().from(program),
      }),
      app,
    );
    expect(result.customers).toEqual([{ id: ids.custC }]);
    expect(result.cards).toEqual([{ id: ids.cardC }]);
    expect(result.programs).toEqual([]);
  });
});

describe("pre-scope lookups", () => {
  it("resolves a tenant by slug or custom domain, returning routing fields only", async () => {
    expect(await resolveTenant({ slug: "biz-c" }, app)).toEqual({
      id: ids.c,
      slug: "biz-c",
      status: "trialing",
    });
    expect((await resolveTenant({ domain: "loyalty.a.test" }, app))?.id).toBe(ids.a);
    expect(await resolveTenant({ slug: "missing" }, app)).toBeNull();
  });

  it("lists a user's memberships across businesses", async () => {
    const scopes = await getUserScopes(ids.userA, app);
    expect(scopes.map((s) => [s.slug, s.role]).sort()).toEqual([
      ["biz-a", "owner"],
      ["biz-c", "staff"],
    ]);
  });
});
