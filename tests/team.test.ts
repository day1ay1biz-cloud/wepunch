import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "@/db";
import { invitation, membership, user } from "@/db/schema";
import { createBusiness } from "@/lib/business";
import { acceptInvite, createInvite, listTeam, lookupInvite, resendInvite, revokeInvite, setStaffActive } from "@/lib/team";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
let businessId = "";
let otherBusinessId = "";
const ownerId = `user-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);

async function makeUser(email: string, emailVerified = true) {
  const id = `user-${randomUUID()}`;
  await admin.insert(user).values({ id, name: email.split("@")[0], email, emailVerified });
  return { id, email, emailVerified };
}

const staffInvite = (email: string) => ({ email, role: "staff" as const, locationIds: [] });

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  await admin.insert(user).values({ id: ownerId, name: "Owner", email: `owner-${tag}@example.com`, emailVerified: true });
  const a = await createBusiness(ownerId, { name: "Team Shop", slug: `team-${tag}`, timezone: "America/New_York" }, app);
  const b = await createBusiness(ownerId, { name: "Other Shop", slug: `team-other-${tag}`, timezone: "America/New_York" }, app);
  if (!a.ok || !b.ok) throw new Error("fixtures not created");
  businessId = a.businessId;
  otherBusinessId = b.businessId;
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

describe("staff invitations", () => {
  it("creates an invite whose token finds it, storing only a hash", async () => {
    const res = await createInvite(businessId, ownerId, staffInvite(`Sam-${tag}@Example.com`.toLowerCase()), app);
    if (!res.ok) throw new Error(res.message);

    const found = await lookupInvite(res.token, app);
    expect(found).toMatchObject({ status: "open", businessName: "Team Shop", role: "staff" });

    const [stored] = await admin.select().from(invitation).where(eq(invitation.id, res.inviteId));
    expect(stored.tokenHash).not.toContain(res.token);
    expect(stored.tokenHash).toHaveLength(64);

    const team = await listTeam(businessId, app);
    expect(team.invites.map((i) => i.email)).toContain(`sam-${tag}@example.com`);
    expect((await listTeam(otherBusinessId, app)).invites).toEqual([]);
  });

  it("re-inviting the same address replaces the old link", async () => {
    const email = `repeat-${tag}@example.com`;
    const first = await createInvite(businessId, ownerId, staffInvite(email), app);
    const second = await createInvite(businessId, ownerId, staffInvite(email), app);
    if (!first.ok || !second.ok) throw new Error("invites not created");
    expect((await lookupInvite(first.token, app)).status).toBe("revoked");
    expect((await lookupInvite(second.token, app)).status).toBe("open");
  });

  it("refuses to invite someone already on the team", async () => {
    const res = await createInvite(businessId, ownerId, staffInvite(`owner-${tag}@example.com`), app);
    expect(res).toEqual({ ok: false, field: "email", message: "This person is already on your team." });
  });

  it("only the invited, verified address can accept, and only once", async () => {
    const email = `jo-${tag}@example.com`;
    const res = await createInvite(businessId, ownerId, staffInvite(email), app);
    if (!res.ok) throw new Error(res.message);

    const stranger = await makeUser(`stranger-${tag}@example.com`);
    expect(await acceptInvite(res.token, stranger, app)).toEqual({ ok: false, reason: "wrong_email" });

    const unverified = { id: "x", email, emailVerified: false };
    expect(await acceptInvite(res.token, unverified, app)).toEqual({ ok: false, reason: "unverified" });

    const jo = await makeUser(email.toUpperCase());
    expect(await acceptInvite(res.token, jo, app)).toEqual({ ok: true, businessSlug: `team-${tag}` });
    expect(await acceptInvite(res.token, jo, app)).toEqual({ ok: false, reason: "accepted" });

    const members = await withTenant({ businessId }, (tx) => tx.select().from(membership).where(eq(membership.userId, jo.id)), app);
    expect(members).toMatchObject([{ role: "staff", active: true }]);
  });

  it("expired, revoked and resent links stop working", async () => {
    const expired = await createInvite(businessId, ownerId, staffInvite(`late-${tag}@example.com`), app);
    const revoked = await createInvite(businessId, ownerId, staffInvite(`gone-${tag}@example.com`), app);
    const resent = await createInvite(businessId, ownerId, staffInvite(`again-${tag}@example.com`), app);
    if (!expired.ok || !revoked.ok || !resent.ok) throw new Error("invites not created");

    await admin.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, expired.inviteId));
    expect((await lookupInvite(expired.token, app)).status).toBe("expired");
    const late = await makeUser(`late-${tag}@example.com`);
    expect(await acceptInvite(expired.token, late, app)).toEqual({ ok: false, reason: "expired" });

    expect(await revokeInvite(businessId, ownerId, revoked.inviteId, app)).toBe(true);
    expect((await lookupInvite(revoked.token, app)).status).toBe("revoked");

    const fresh = await resendInvite(businessId, ownerId, resent.inviteId, app);
    expect(fresh?.email).toBe(`again-${tag}@example.com`);
    expect((await lookupInvite(resent.token, app)).status).toBe("missing");
    expect((await lookupInvite(fresh!.token, app)).status).toBe("open");
  });

  it("an owner of one business can't revoke another business's invite", async () => {
    const res = await createInvite(businessId, ownerId, staffInvite(`guarded-${tag}@example.com`), app);
    if (!res.ok) throw new Error(res.message);
    expect(await revokeInvite(otherBusinessId, ownerId, res.inviteId, app)).toBe(false);
    expect((await lookupInvite(res.token, app)).status).toBe("open");
  });

  it("rejects malformed tokens without a database round trip", async () => {
    expect(await lookupInvite("../../etc", app)).toEqual({ status: "missing" });
  });
});

describe("staff access", () => {
  it("switches staff off and back on, re-inviting reactivates, owners can't be switched off", async () => {
    const email = `kim-${tag}@example.com`;
    const res = await createInvite(businessId, ownerId, staffInvite(email), app);
    if (!res.ok) throw new Error(res.message);
    const kim = await makeUser(email);
    await acceptInvite(res.token, kim, app);

    const team = await listTeam(businessId, app);
    const kimMember = team.members.find((m) => m.userId === kim.id)!;
    const ownerMember = team.members.find((m) => m.userId === ownerId)!;

    expect(await setStaffActive(businessId, ownerId, kimMember.id, false, app)).toBe(true);
    expect(await setStaffActive(businessId, ownerId, ownerMember.id, false, app)).toBe(false);

    const again = await createInvite(businessId, ownerId, staffInvite(email), app);
    if (!again.ok) throw new Error(again.message);
    expect(await acceptInvite(again.token, kim, app)).toMatchObject({ ok: true });

    const after = await listTeam(businessId, app);
    expect(after.members.find((m) => m.userId === kim.id)?.active).toBe(true);
    expect(after.members.find((m) => m.userId === ownerId)).toMatchObject({ role: "owner", active: true });
  });
});
