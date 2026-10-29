import { and, eq, sql } from "drizzle-orm";
import { getDb, withTenant, type Db } from "@/db";
import { card, customer, customerConsent, program, punchEvent, reward } from "@/db/schema";

export type JoinInput = {
  businessId: string;
  customerId: string;
  firstName?: string | null;
  // Marketing opt-ins from unticked-by-default checkboxes on the join page.
  marketingSms: boolean;
  marketingEmail: boolean;
  ip: string | null;
};

export type JoinResult = { ok: true; cardId: string; created: boolean } | { ok: false; reason: "not_ready" };

/**
 * Gives the customer a card on the business's active program, or returns the
 * one they already have. Runs with both the business and the customer in
 * scope, so RLS limits it to exactly this pair.
 */
export async function joinCard(input: JoinInput, db: Db = getDb()): Promise<JoinResult> {
  return withTenant(
    { businessId: input.businessId, customerId: input.customerId },
    async (tx) => {
      const [prog] = await tx
        .select()
        .from(program)
        .where(and(eq(program.businessId, input.businessId), eq(program.active, true)))
        .limit(1);
      if (!prog) return { ok: false, reason: "not_ready" } as const;

      const name = input.firstName?.trim().slice(0, 40);
      if (name) {
        // Only fill a missing first name; never overwrite one set before.
        await tx.update(customer).set({ firstName: name }).where(and(eq(customer.id, input.customerId), sql`${customer.firstName} is null`));
      }

      // Consent: record opt-ins with a timestamp; joining again never opts anyone out.
      const now = new Date();
      await tx
        .insert(customerConsent)
        .values({
          customerId: input.customerId,
          businessId: input.businessId,
          marketingSms: input.marketingSms,
          marketingSmsAt: input.marketingSms ? now : null,
          marketingEmail: input.marketingEmail,
          marketingEmailAt: input.marketingEmail ? now : null,
          source: "join_page",
          ip: input.ip,
        })
        .onConflictDoUpdate({
          target: [customerConsent.customerId, customerConsent.businessId],
          set: {
            marketingSms: sql`${customerConsent.marketingSms} or ${input.marketingSms}`,
            marketingSmsAt: sql`case when ${input.marketingSms} and not ${customerConsent.marketingSms} then now() else ${customerConsent.marketingSmsAt} end`,
            marketingEmail: sql`${customerConsent.marketingEmail} or ${input.marketingEmail}`,
            marketingEmailAt: sql`case when ${input.marketingEmail} and not ${customerConsent.marketingEmail} then now() else ${customerConsent.marketingEmailAt} end`,
          },
        });

      const [existing] = await tx
        .select({ id: card.id })
        .from(card)
        .where(and(eq(card.programId, prog.id), eq(card.customerId, input.customerId), eq(card.status, "active")));
      if (existing) return { ok: true, cardId: existing.id, created: false } as const;

      const [created] = await tx
        .insert(card)
        .values({ businessId: input.businessId, programId: prog.id, customerId: input.customerId, punches: prog.punchOnJoin ? 1 : 0 })
        .onConflictDoNothing()
        .returning({ id: card.id });
      if (!created) {
        // Another tab joined at the same moment; use its card.
        const [raced] = await tx
          .select({ id: card.id })
          .from(card)
          .where(and(eq(card.programId, prog.id), eq(card.customerId, input.customerId), eq(card.status, "active")));
        return { ok: true, cardId: raced.id, created: false } as const;
      }

      if (prog.punchOnJoin) {
        await tx.insert(punchEvent).values({ businessId: input.businessId, cardId: created.id, delta: 1, reason: "join" });
      }
      return { ok: true, cardId: created.id, created: true } as const;
    },
    db,
  );
}

export type CustomerCard = {
  cardId: string;
  punches: number;
  punchesRequired: number;
  cardName: string;
  rewardText: string;
  rewardsAvailable: number;
  firstName: string | null;
};

/** The customer's active card at this business, or null if they haven't joined. */
export async function getCustomerCard(businessId: string, customerId: string, db: Db = getDb()): Promise<CustomerCard | null> {
  return withTenant(
    { businessId, customerId },
    async (tx) => {
      const [row] = await tx
        .select({
          cardId: card.id,
          punches: card.punches,
          punchesRequired: program.punchesRequired,
          cardName: program.name,
          rewardText: program.rewardText,
        })
        .from(card)
        .innerJoin(program, eq(program.id, card.programId))
        .where(and(eq(card.businessId, businessId), eq(card.customerId, customerId), eq(card.status, "active"), eq(program.active, true)))
        .limit(1);
      if (!row) return null;

      const [{ available }] = await tx
        .select({ available: sql<number>`count(*)::int` })
        .from(reward)
        .where(and(eq(reward.businessId, businessId), eq(reward.customerId, customerId), eq(reward.status, "available")));
      const [me] = await tx.select({ firstName: customer.firstName }).from(customer).where(eq(customer.id, customerId));
      return { ...row, rewardsAvailable: available, firstName: me?.firstName ?? null };
    },
    db,
  );
}

/** The signed-in customer's own contact details (read in their own scope). */
export async function getCustomerContact(customerId: string, db: Db = getDb()) {
  return withTenant(
    { customerId },
    async (tx) => {
      const [me] = await tx
        .select({ phone: customer.phoneE164, email: customer.email, firstName: customer.firstName })
        .from(customer)
        .where(eq(customer.id, customerId));
      return me ?? null;
    },
    db,
  );
}
