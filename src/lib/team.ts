import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTenant, type Db } from "@/db";
import { auditLog, invitation, membership, user } from "@/db/schema";

const INVITE_TTL_DAYS = 7;

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  role: z.enum(["staff", "owner"], "Pick a role"),
  // Empty means every location.
  locationIds: z.array(z.uuid()).default([]),
});

export type InviteInput = z.infer<typeof inviteSchema>;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const expiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

/** Members and open invitations for the team page. */
export async function listTeam(businessId: string, db: Db = getDb()) {
  return withTenant(
    { businessId },
    async (tx) => ({
      members: await tx
        .select({
          id: membership.id,
          userId: membership.userId,
          role: membership.role,
          active: membership.active,
          locationIds: membership.locationIds,
          name: user.name,
          email: user.email,
        })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(eq(membership.businessId, businessId))
        .orderBy(membership.createdAt),
      invites: await tx
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .where(and(eq(invitation.businessId, businessId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .orderBy(invitation.createdAt),
    }),
    db,
  );
}

export type CreateInviteResult =
  | { ok: true; inviteId: string; token: string; email: string }
  | { ok: false; field: "email"; message: string };

/**
 * Invites `input.email` to the business, replacing any open invite for the
 * same address. The returned token goes into the email link and is never
 * stored. The caller must have checked that `inviterId` is an owner.
 */
export async function createInvite(
  businessId: string,
  inviterId: string,
  input: InviteInput,
  db: Db = getDb(),
): Promise<CreateInviteResult> {
  return withTenant(
    { businessId },
    async (tx) => {
      const [member] = await tx
        .select({ id: membership.id })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(eq(membership.businessId, businessId), eq(membership.active, true), sql`lower(${user.email}) = ${input.email}`));
      if (member) return { ok: false, field: "email", message: "This person is already on your team." };

      await tx
        .update(invitation)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitation.businessId, businessId),
            sql`lower(${invitation.email}) = ${input.email}`,
            isNull(invitation.acceptedAt),
            isNull(invitation.revokedAt),
          ),
        );

      const token = newToken();
      const [row] = await tx
        .insert(invitation)
        .values({
          businessId,
          email: input.email,
          role: input.role,
          locationIds: input.locationIds,
          tokenHash: hashToken(token),
          invitedBy: inviterId,
          expiresAt: expiry(),
        })
        .returning({ id: invitation.id });

      await tx.insert(auditLog).values({
        businessId,
        actorUserId: inviterId,
        action: "invite.created",
        target: `invitation:${row.id}`,
        metadata: { role: input.role },
      });
      return { ok: true, inviteId: row.id, token, email: input.email };
    },
    db,
  );
}

/** New token and a fresh 7 days for an open invite; the old link stops working. */
export async function resendInvite(businessId: string, actorId: string, inviteId: string, db: Db = getDb()) {
  return withTenant(
    { businessId },
    async (tx) => {
      const token = newToken();
      const [row] = await tx
        .update(invitation)
        .set({ tokenHash: hashToken(token), expiresAt: expiry() })
        .where(and(eq(invitation.id, inviteId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .returning({ email: invitation.email, role: invitation.role });
      if (!row) return null;
      await tx.insert(auditLog).values({ businessId, actorUserId: actorId, action: "invite.resent", target: `invitation:${inviteId}` });
      return { token, email: row.email, role: row.role };
    },
    db,
  );
}

export async function revokeInvite(businessId: string, actorId: string, inviteId: string, db: Db = getDb()) {
  return withTenant(
    { businessId },
    async (tx) => {
      const rows = await tx
        .update(invitation)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitation.id, inviteId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .returning({ id: invitation.id });
      if (rows.length) {
        await tx.insert(auditLog).values({ businessId, actorUserId: actorId, action: "invite.revoked", target: `invitation:${inviteId}` });
      }
      return rows.length > 0;
    },
    db,
  );
}

/** Turns a staff member's access off or back on. Owners can't be switched off here. */
export async function setStaffActive(
  businessId: string,
  actorId: string,
  membershipId: string,
  active: boolean,
  db: Db = getDb(),
) {
  return withTenant(
    { businessId },
    async (tx) => {
      const rows = await tx
        .update(membership)
        .set({ active })
        .where(and(eq(membership.id, membershipId), eq(membership.role, "staff")))
        .returning({ id: membership.id });
      if (rows.length) {
        await tx.insert(auditLog).values({
          businessId,
          actorUserId: actorId,
          action: active ? "member.reactivated" : "member.deactivated",
          target: `membership:${membershipId}`,
        });
      }
      return rows.length > 0;
    },
    db,
  );
}

export type InviteLookup =
  | { status: "missing" }
  | {
      status: "open" | "expired" | "accepted" | "revoked";
      id: string;
      businessId: string;
      businessName: string;
      businessSlug: string;
      email: string;
      role: "owner" | "staff";
    };

/** Finds an invite by its emailed token, before the reader belongs to the business. */
export async function lookupInvite(token: string, db: Db = getDb()): Promise<InviteLookup> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "missing" };
  const [row] = await db.execute<{
    id: string;
    business_id: string;
    business_name: string;
    business_slug: string;
    email: string;
    role: "owner" | "staff";
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  }>(sql`select * from invitation_by_token(${hashToken(token)})`);
  if (!row) return { status: "missing" };

  const status = row.accepted_at
    ? "accepted"
    : row.revoked_at
      ? "revoked"
      : new Date(row.expires_at) <= new Date()
        ? "expired"
        : "open";
  return {
    status,
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    businessSlug: row.business_slug,
    email: row.email,
    role: row.role,
  };
}

export type AcceptResult =
  | { ok: true; businessSlug: string }
  | { ok: false; reason: "missing" | "expired" | "accepted" | "revoked" | "wrong_email" | "unverified" };

/**
 * Joins the signed-in user to the business. The invite must be open, and the
 * user's verified email must match the invited address, so a forwarded link
 * can't be used by someone else.
 */
export async function acceptInvite(
  token: string,
  account: { id: string; email: string; emailVerified: boolean },
  db: Db = getDb(),
): Promise<AcceptResult> {
  const invite = await lookupInvite(token, db);
  if (invite.status !== "open") return { ok: false, reason: invite.status };
  if (!account.emailVerified) return { ok: false, reason: "unverified" };
  if (account.email.toLowerCase() !== invite.email.toLowerCase()) return { ok: false, reason: "wrong_email" };

  return withTenant(
    { businessId: invite.businessId },
    async (tx) => {
      // Claims the invite atomically, so two tabs can't both accept it.
      const [claimed] = await tx
        .update(invitation)
        .set({ acceptedAt: new Date(), acceptedBy: account.id })
        .where(
          and(
            eq(invitation.id, invite.id),
            isNull(invitation.acceptedAt),
            isNull(invitation.revokedAt),
            sql`${invitation.expiresAt} > now()`,
          ),
        )
        .returning({ role: invitation.role, locationIds: invitation.locationIds });
      if (!claimed) return { ok: false, reason: "accepted" } as const;

      const [existing] = await tx
        .select()
        .from(membership)
        .where(and(eq(membership.businessId, invite.businessId), eq(membership.userId, account.id)));

      if (!existing) {
        await tx.insert(membership).values({
          businessId: invite.businessId,
          userId: account.id,
          role: claimed.role,
          locationIds: claimed.locationIds,
        });
      } else {
        // Never downgrade: an owner accepting a staff invite stays an owner.
        const role = existing.role === "owner" || claimed.role === "owner" ? "owner" : "staff";
        await tx
          .update(membership)
          .set({ active: true, role, locationIds: existing.active ? existing.locationIds : claimed.locationIds })
          .where(eq(membership.id, existing.id));
      }

      await tx.insert(auditLog).values({
        businessId: invite.businessId,
        actorUserId: account.id,
        action: "member.joined",
        target: `invitation:${invite.id}`,
        metadata: { role: claimed.role },
      });
      return { ok: true, businessSlug: invite.businessSlug } as const;
    },
    db,
  );
}
