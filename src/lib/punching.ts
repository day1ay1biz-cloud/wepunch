import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, withTenant, type Db, type Tx } from "@/db";
import { auditLog, card, cardTokenUse, location, program, punchEvent, reward } from "@/db/schema";

// The counter's write path: punches, rewards, redemptions and their undo.
// Every function runs inside the business's RLS scope and locks the card row
// it changes, so two devices punching the same card can't lose an update.

export type Actor = { userId: string; role: "owner" | "staff"; locationIds: string[] };
export type CounterContext = { businessId: string; actor: Actor; locationId: string };

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
// Staff can take back their own mistake for a few minutes; owners have 24 hours.
const STAFF_UNDO_WINDOW_MS = 10 * 60 * 1000;

export type PunchOk = {
  ok: true;
  eventId: string;
  cardId: string;
  punches: number;
  punchesRequired: number;
  rewardsEarned: number;
  rewardsAvailable: number;
  duplicate?: boolean;
};
export type PunchError = {
  ok: false;
  reason: "no_card" | "too_many" | "cooldown" | "token_used" | "location" | "program_inactive";
  message: string;
};

/** Tells live customer screens (SSE) to refresh. Delivered when the transaction commits. */
async function notifyCustomer(tx: Tx, businessId: string, customerId: string) {
  await tx.execute(sql`select pg_notify('card_activity', ${JSON.stringify({ businessId, customerId })})`);
}

async function checkLocation(tx: Tx, ctx: CounterContext): Promise<PunchError | null> {
  const [loc] = await tx
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.id, ctx.locationId), eq(location.businessId, ctx.businessId), isNull(location.archivedAt)));
  const allowed = ctx.actor.locationIds.length === 0 || ctx.actor.locationIds.includes(ctx.locationId);
  return loc && allowed ? null : { ok: false, reason: "location", message: "Pick a location you work at." };
}

/** Uses a scanned token's nonce for one action; false if it was already used. */
async function useToken(tx: Tx, businessId: string, nonce: string, action: "punch" | "redeem") {
  const rows = await tx.insert(cardTokenUse).values({ nonce, action, businessId }).onConflictDoNothing().returning({ nonce: cardTokenUse.nonce });
  return rows.length > 0;
}

async function availableRewards(tx: Tx, businessId: string, customerId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(reward)
    .where(and(eq(reward.businessId, businessId), eq(reward.customerId, customerId), eq(reward.status, "available")));
  return n;
}

/**
 * Adds `count` punches to a card. Enforces the card's rules (most punches
 * per visit, minutes between punches), turns a full card into a reward and
 * carries extra punches onto a new card. `clientEventId` makes retries safe;
 * `tokenNonce` (from a scanned code) can be used for one punch only.
 */
export async function punch(
  ctx: CounterContext,
  input: { cardId: string; count: number; tokenNonce?: string; clientEventId?: string },
  db: Db = getDb(),
): Promise<PunchOk | PunchError> {
  return withTenant(
    { businessId: ctx.businessId },
    async (tx): Promise<PunchOk | PunchError> => {
      if (input.clientEventId) {
        // A retry of a punch that already went through: report it, don't repeat it.
        const [done] = await tx.select().from(punchEvent).where(eq(punchEvent.clientEventId, input.clientEventId));
        if (done) {
          const [c] = await tx.select().from(card).where(eq(card.id, done.cardId));
          const [p] = await tx.select().from(program).where(eq(program.id, c.programId));
          return {
            ok: true,
            duplicate: true,
            eventId: done.id,
            cardId: c.id,
            punches: c.punches,
            punchesRequired: p.punchesRequired,
            rewardsEarned: 0,
            rewardsAvailable: await availableRewards(tx, ctx.businessId, c.customerId),
          };
        }
      }

      const locationError = await checkLocation(tx, ctx);
      if (locationError) return locationError;

      // The scanned card may have filled up since the code was shown; punch
      // the customer's current card on the same program instead.
      const [scanned] = await tx.select().from(card).where(and(eq(card.id, input.cardId), eq(card.businessId, ctx.businessId)));
      if (!scanned) return { ok: false, reason: "no_card", message: "We couldn't find that card." };
      const [current] = await tx
        .select()
        .from(card)
        .where(and(eq(card.programId, scanned.programId), eq(card.customerId, scanned.customerId), eq(card.status, "active")))
        .for("update");
      if (!current) return { ok: false, reason: "no_card", message: "This customer has no active card." };

      const [prog] = await tx.select().from(program).where(eq(program.id, current.programId));
      if (!prog.active) return { ok: false, reason: "program_inactive", message: "This card program is no longer active." };

      const count = Math.trunc(input.count);
      if (count < 1 || count > prog.maxPunchesPerVisit) {
        return {
          ok: false,
          reason: "too_many",
          message: prog.maxPunchesPerVisit === 1 ? "Only 1 punch per visit." : `At most ${prog.maxPunchesPerVisit} punches per visit.`,
        };
      }

      if (prog.minMinutesBetween > 0) {
        // Latest real punch on this program for this customer that hasn't been undone.
        const [last] = await tx
          .select({ at: punchEvent.createdAt })
          .from(punchEvent)
          .innerJoin(card, eq(card.id, punchEvent.cardId))
          .where(
            and(
              eq(card.customerId, current.customerId),
              eq(card.programId, current.programId),
              gt(punchEvent.delta, 0),
              // Not `<>`: normal punches have a NULL reason, and NULL <> 'join' is NULL.
              sql`${punchEvent.reason} is distinct from 'join'`,
              sql`not exists (select 1 from punch_event r where r.reverses_event_id = ${punchEvent.id})`,
            ),
          )
          .orderBy(desc(punchEvent.createdAt))
          .limit(1);
        if (last) {
          const waitMs = last.at.getTime() + prog.minMinutesBetween * 60_000 - Date.now();
          if (waitMs > 0) {
            const minutes = Math.ceil(waitMs / 60_000);
            return {
              ok: false,
              reason: "cooldown",
              message: `Already punched recently. Next punch in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
            };
          }
        }
      }

      if (input.tokenNonce && !(await useToken(tx, ctx.businessId, input.tokenNonce, "punch"))) {
        return { ok: false, reason: "token_used", message: "That code was already used. Ask the customer to show their card again." };
      }

      // Record the punch on the current card, filling it and any following
      // cards; each full card becomes a reward.
      let remaining = count;
      let cardRow = current;
      let firstEventId = "";
      let rewardsEarned = 0;
      while (remaining > 0) {
        const room = prog.punchesRequired - cardRow.punches;
        const applied = Math.min(room, remaining);
        const [event] = await tx
          .insert(punchEvent)
          .values({
            businessId: ctx.businessId,
            cardId: cardRow.id,
            locationId: ctx.locationId,
            staffUserId: ctx.actor.userId,
            delta: applied,
            // Only the first event carries the retry key (it's unique).
            clientEventId: firstEventId ? null : (input.clientEventId ?? null),
          })
          .returning({ id: punchEvent.id });
        firstEventId ||= event.id;
        remaining -= applied;

        if (cardRow.punches + applied < prog.punchesRequired) {
          await tx.update(card).set({ punches: cardRow.punches + applied }).where(eq(card.id, cardRow.id));
          cardRow = { ...cardRow, punches: cardRow.punches + applied };
          break;
        }

        await tx
          .update(card)
          .set({ punches: prog.punchesRequired, status: "completed", completedAt: new Date() })
          .where(eq(card.id, cardRow.id));
        await tx.insert(reward).values({ businessId: ctx.businessId, cardId: cardRow.id, customerId: cardRow.customerId });
        rewardsEarned++;
        const [next] = await tx
          .insert(card)
          .values({ businessId: ctx.businessId, programId: prog.id, customerId: cardRow.customerId, punches: 0 })
          .returning();
        cardRow = next;
      }

      await notifyCustomer(tx, ctx.businessId, current.customerId);
      return {
        ok: true,
        eventId: firstEventId,
        cardId: cardRow.id,
        punches: cardRow.punches,
        punchesRequired: prog.punchesRequired,
        rewardsEarned,
        rewardsAvailable: await availableRewards(tx, ctx.businessId, current.customerId),
      };
    },
    db,
  );
}

export type RedeemResult =
  | { ok: true; rewardId: string; rewardText: string; rewardsAvailable: number }
  | { ok: false; reason: "none" | "token_used" | "location"; message: string };

/** Redeems the customer's oldest available reward. */
export async function redeem(
  ctx: CounterContext,
  input: { customerId: string; tokenNonce?: string },
  db: Db = getDb(),
): Promise<RedeemResult> {
  return withTenant(
    { businessId: ctx.businessId },
    async (tx): Promise<RedeemResult> => {
      const locationError = await checkLocation(tx, ctx);
      if (locationError) return { ok: false, reason: "location", message: locationError.message };

      const [oldest] = await tx
        .select({ id: reward.id, rewardText: program.rewardText })
        .from(reward)
        .innerJoin(card, eq(card.id, reward.cardId))
        .innerJoin(program, eq(program.id, card.programId))
        .where(and(eq(reward.businessId, ctx.businessId), eq(reward.customerId, input.customerId), eq(reward.status, "available")))
        .orderBy(asc(reward.earnedAt))
        .limit(1)
        .for("update", { of: reward, skipLocked: true });
      if (!oldest) return { ok: false, reason: "none", message: "No reward to redeem yet." };

      if (input.tokenNonce && !(await useToken(tx, ctx.businessId, input.tokenNonce, "redeem"))) {
        return { ok: false, reason: "token_used", message: "That code was already used. Ask the customer to show their card again." };
      }

      await tx
        .update(reward)
        .set({ status: "redeemed", redeemedAt: new Date(), redeemedBy: ctx.actor.userId, locationId: ctx.locationId })
        .where(eq(reward.id, oldest.id));
      await notifyCustomer(tx, ctx.businessId, input.customerId);
      return {
        ok: true,
        rewardId: oldest.id,
        rewardText: oldest.rewardText,
        rewardsAvailable: await availableRewards(tx, ctx.businessId, input.customerId),
      };
    },
    db,
  );
}

export type UndoResult = { ok: true } | { ok: false; message: string };

function mayUndo(actor: Actor, doneBy: string | null, at: Date): string | null {
  const age = Date.now() - at.getTime();
  if (age > UNDO_WINDOW_MS) return "It's been more than 24 hours, so this can't be undone.";
  if (actor.role === "owner") return null;
  if (doneBy === actor.userId && age <= STAFF_UNDO_WINDOW_MS) return null;
  return "Ask an owner to undo this.";
}

/** Takes back a punch with a reversing entry; the original stays in the ledger. */
export async function undoPunch(ctx: Omit<CounterContext, "locationId">, eventId: string, db: Db = getDb()): Promise<UndoResult> {
  return withTenant(
    { businessId: ctx.businessId },
    async (tx): Promise<UndoResult> => {
      const [event] = await tx.select().from(punchEvent).where(eq(punchEvent.id, eventId));
      if (!event || event.delta <= 0 || event.reason === "join") return { ok: false, message: "That punch can't be undone." };
      const denied = mayUndo(ctx.actor, event.staffUserId, event.createdAt);
      if (denied) return { ok: false, message: denied };

      const [c] = await tx.select().from(card).where(eq(card.id, event.cardId)).for("update");
      if (c.status !== "active") return { ok: false, message: "That punch filled the card and earned a reward, so it can't be undone here." };
      if (c.punches < event.delta) return { ok: false, message: "That punch can't be undone." };

      const reversed = await tx
        .insert(punchEvent)
        .values({
          businessId: ctx.businessId,
          cardId: c.id,
          locationId: event.locationId,
          staffUserId: ctx.actor.userId,
          delta: -event.delta,
          reason: "undo",
          reversesEventId: event.id,
        })
        .onConflictDoNothing()
        .returning({ id: punchEvent.id });
      if (!reversed.length) return { ok: false, message: "That punch was already undone." };

      await tx.update(card).set({ punches: c.punches - event.delta }).where(eq(card.id, c.id));
      await tx.insert(auditLog).values({
        businessId: ctx.businessId,
        actorUserId: ctx.actor.userId,
        action: "punch.undone",
        target: `punch_event:${event.id}`,
      });
      await notifyCustomer(tx, ctx.businessId, c.customerId);
      return { ok: true };
    },
    db,
  );
}

/** Puts a redeemed reward back on the customer's card. */
export async function undoRedeem(ctx: Omit<CounterContext, "locationId">, rewardId: string, db: Db = getDb()): Promise<UndoResult> {
  return withTenant(
    { businessId: ctx.businessId },
    async (tx): Promise<UndoResult> => {
      const [r] = await tx.select().from(reward).where(eq(reward.id, rewardId)).for("update");
      if (!r || r.status !== "redeemed" || !r.redeemedAt) return { ok: false, message: "That reward isn't redeemed." };
      const denied = mayUndo(ctx.actor, r.redeemedBy, r.redeemedAt);
      if (denied) return { ok: false, message: denied };

      await tx.update(reward).set({ status: "available", redeemedAt: null, redeemedBy: null, locationId: null }).where(eq(reward.id, r.id));
      await tx.insert(auditLog).values({
        businessId: ctx.businessId,
        actorUserId: ctx.actor.userId,
        action: "reward.redeem_undone",
        target: `reward:${r.id}`,
      });
      await notifyCustomer(tx, ctx.businessId, r.customerId);
      return { ok: true };
    },
    db,
  );
}
