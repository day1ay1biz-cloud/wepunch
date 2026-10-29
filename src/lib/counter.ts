import { and, desc, eq, gt, ilike, isNotNull, like, or, sql } from "drizzle-orm";
import { getDb, withTenant, type Db } from "@/db";
import { card, customer, membership, program, punchEvent, reward, user } from "@/db/schema";
import { verifyCardToken } from "@/lib/card-token";
import { maskDestination } from "@/lib/customer-auth";
import type { Actor } from "@/lib/punching";

// Read side of the counter: who is this customer, what's on their card, and
// what happened recently. Everything is read inside the business's scope, so
// a customer is only visible here through a card at this business.

export type CardSummary = {
  cardId: string;
  customerId: string;
  name: string;
  contact: string;
  punches: number;
  punchesRequired: number;
  maxPunchesPerVisit: number;
  cardName: string;
  rewardText: string;
  rewardsAvailable: number;
  lastPunchAt: string | null;
};

/** The staff member's role and assigned locations at this business. */
export async function actorFor(businessId: string, userId: string, role: "owner" | "staff", db: Db = getDb()): Promise<Actor> {
  const [m] = await withTenant(
    { businessId },
    (tx) => tx.select({ locationIds: membership.locationIds }).from(membership).where(and(eq(membership.businessId, businessId), eq(membership.userId, userId))),
    db,
  );
  return { userId, role, locationIds: m?.locationIds ?? [] };
}

export async function cardSummary(businessId: string, by: { cardId: string } | { customerId: string }, db: Db = getDb()): Promise<CardSummary | null> {
  return withTenant(
    { businessId },
    async (tx) => {
      // A scanned card may have filled up; follow the customer to their current card.
      let customerId: string;
      let programId: string | null = null;
      if ("cardId" in by) {
        const [scanned] = await tx.select({ customerId: card.customerId, programId: card.programId }).from(card).where(eq(card.id, by.cardId));
        if (!scanned) return null;
        customerId = scanned.customerId;
        programId = scanned.programId;
      } else {
        customerId = by.customerId;
      }

      const [row] = await tx
        .select({
          cardId: card.id,
          punches: card.punches,
          punchesRequired: program.punchesRequired,
          maxPunchesPerVisit: program.maxPunchesPerVisit,
          cardName: program.name,
          rewardText: program.rewardText,
          firstName: customer.firstName,
          phone: customer.phoneE164,
          email: customer.email,
        })
        .from(card)
        .innerJoin(program, eq(program.id, card.programId))
        .innerJoin(customer, eq(customer.id, card.customerId))
        .where(
          and(
            eq(card.businessId, businessId),
            eq(card.customerId, customerId),
            eq(card.status, "active"),
            eq(program.active, true),
            programId ? eq(card.programId, programId) : undefined,
          ),
        )
        .limit(1);
      if (!row) return null;

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(reward)
        .where(and(eq(reward.businessId, businessId), eq(reward.customerId, customerId), eq(reward.status, "available")));
      const [last] = await tx
        .select({ at: punchEvent.createdAt })
        .from(punchEvent)
        .innerJoin(card, eq(card.id, punchEvent.cardId))
        .where(and(eq(card.customerId, customerId), eq(card.businessId, businessId), gt(punchEvent.delta, 0)))
        .orderBy(desc(punchEvent.createdAt))
        .limit(1);

      return {
        cardId: row.cardId,
        customerId,
        name: row.firstName ?? "Customer",
        contact: row.phone ? maskDestination("sms", row.phone) : row.email ? maskDestination("email", row.email) : "",
        punches: row.punches,
        punchesRequired: row.punchesRequired,
        maxPunchesPerVisit: row.maxPunchesPerVisit,
        cardName: row.cardName,
        rewardText: row.rewardText,
        rewardsAvailable: n,
        lastPunchAt: last?.at.toISOString() ?? null,
      };
    },
    db,
  );
}

export type ScanLookup = { ok: true; summary: CardSummary; nonce: string } | { ok: false; message: string };

/** Identifies a customer from the code on their phone. */
export async function lookupByToken(businessId: string, token: string, db: Db = getDb()): Promise<ScanLookup> {
  const verified = verifyCardToken(token, businessId);
  if (!verified.ok) {
    const message = {
      expired: "That code has expired. Ask the customer to refresh their card.",
      wrong_business: "That card belongs to a different business.",
      bad_signature: "That isn't a valid card code.",
      malformed: "That isn't a wepunch card code.",
    }[verified.reason];
    return { ok: false, message };
  }
  const summary = await cardSummary(businessId, { cardId: verified.cardId }, db);
  return summary ? { ok: true, summary, nonce: verified.nonce } : { ok: false, message: "We couldn't find that card." };
}

export type CustomerMatch = { customerId: string; name: string; contact: string; punches: number; punchesRequired: number };

/**
 * Finds customers with a card here by the last digits of their phone (4+)
 * or part of their email. Customers without a card here never match.
 */
export async function searchCustomers(businessId: string, query: string, db: Db = getDb()): Promise<CustomerMatch[]> {
  const q = query.trim();
  const digits = q.replace(/\D/g, "");
  // A phone search is all phone characters ("0123", "(480) 555-0123"), not text that happens to contain digits.
  const byPhone = /^[\d\s()+.-]+$/.test(q) && digits.length >= 4;
  if (!byPhone && q.length < 3) return [];

  return withTenant(
    { businessId },
    async (tx) => {
      const rows = await tx
        .selectDistinctOn([customer.id], {
          customerId: customer.id,
          firstName: customer.firstName,
          phone: customer.phoneE164,
          email: customer.email,
          punches: card.punches,
          punchesRequired: program.punchesRequired,
        })
        .from(card)
        .innerJoin(customer, eq(customer.id, card.customerId))
        .innerJoin(program, eq(program.id, card.programId))
        .where(
          and(
            eq(card.businessId, businessId),
            eq(card.status, "active"),
            byPhone
              ? and(isNotNull(customer.phoneE164), like(customer.phoneE164, `%${digits}`))
              : or(ilike(customer.email, `%${q.replace(/[%_\\]/g, "")}%`), ilike(customer.firstName, `${q.replace(/[%_\\]/g, "")}%`)),
          ),
        )
        .limit(10);
      return rows.map((r) => ({
        customerId: r.customerId,
        name: r.firstName ?? "Customer",
        contact: r.phone ? maskDestination("sms", r.phone) : r.email ? maskDestination("email", r.email) : "",
        punches: r.punches,
        punchesRequired: r.punchesRequired,
      }));
    },
    db,
  );
}

export type ActivityItem = {
  kind: "punch" | "redeem";
  id: string;
  at: string;
  customerName: string;
  detail: string;
  staffUserId: string | null;
  staffName: string | null;
  undone: boolean;
};

/** The last 24 hours at the counter, newest first, for the undo list. */
export async function recentActivity(businessId: string, db: Db = getDb(), limit = 15): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return withTenant(
    { businessId },
    async (tx) => {
      const punches = await tx
        .select({
          id: punchEvent.id,
          at: punchEvent.createdAt,
          delta: punchEvent.delta,
          staffUserId: punchEvent.staffUserId,
          staffName: user.name,
          firstName: customer.firstName,
          undone: sql<boolean>`exists (select 1 from punch_event r where r.reverses_event_id = ${punchEvent.id})`,
        })
        .from(punchEvent)
        .innerJoin(card, eq(card.id, punchEvent.cardId))
        .innerJoin(customer, eq(customer.id, card.customerId))
        .leftJoin(user, eq(user.id, punchEvent.staffUserId))
        .where(and(eq(punchEvent.businessId, businessId), gt(punchEvent.delta, 0), gt(punchEvent.createdAt, since), sql`${punchEvent.reason} is distinct from 'join'`))
        .orderBy(desc(punchEvent.createdAt))
        .limit(limit);
      const redemptions = await tx
        .select({
          id: reward.id,
          at: reward.redeemedAt,
          staffUserId: reward.redeemedBy,
          staffName: user.name,
          firstName: customer.firstName,
        })
        .from(reward)
        .innerJoin(customer, eq(customer.id, reward.customerId))
        .leftJoin(user, eq(user.id, reward.redeemedBy))
        .where(and(eq(reward.businessId, businessId), eq(reward.status, "redeemed"), gt(reward.redeemedAt, since)))
        .orderBy(desc(reward.redeemedAt))
        .limit(limit);

      const items: ActivityItem[] = [
        ...punches.map((p) => ({
          kind: "punch" as const,
          id: p.id,
          at: p.at.toISOString(),
          customerName: p.firstName ?? "Customer",
          detail: p.delta === 1 ? "+1 punch" : `+${p.delta} punches`,
          staffUserId: p.staffUserId,
          staffName: p.staffName,
          undone: p.undone,
        })),
        ...redemptions.map((r) => ({
          kind: "redeem" as const,
          id: r.id,
          at: r.at!.toISOString(),
          customerName: r.firstName ?? "Customer",
          detail: "Reward redeemed",
          staffUserId: r.staffUserId,
          staffName: r.staffName,
          undone: false,
        })),
      ];
      return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },
    db,
  );
}
