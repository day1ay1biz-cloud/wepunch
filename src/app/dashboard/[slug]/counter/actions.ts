"use server";

import { verifyCardToken } from "@/lib/card-token";
import { actorFor, cardSummary, lookupByToken, recentActivity, searchCustomers, type ActivityItem, type CardSummary, type CustomerMatch } from "@/lib/counter";
import { punch, redeem, undoPunch, undoRedeem } from "@/lib/punching";
import { requireBusinessAccess } from "@/lib/session";

// Server functions the counter screen calls directly. Each one re-checks the
// signed-in user's access, so nothing here trusts the browser.

async function context(slug: string) {
  const { user, businessId, role } = await requireBusinessAccess(slug);
  return { businessId, actor: await actorFor(businessId, user.id, role) };
}

export async function scanAction(slug: string, token: string): Promise<{ ok: true; summary: CardSummary } | { ok: false; message: string }> {
  const { businessId } = await context(slug);
  const res = await lookupByToken(businessId, token);
  return res.ok ? { ok: true, summary: res.summary } : res;
}

export async function searchAction(slug: string, query: string): Promise<CustomerMatch[]> {
  const { businessId } = await context(slug);
  return searchCustomers(businessId, query);
}

export async function selectCustomerAction(slug: string, customerId: string): Promise<CardSummary | null> {
  const { businessId } = await context(slug);
  return cardSummary(businessId, { customerId });
}

export type CounterResult =
  | { ok: true; message: string; summary: CardSummary | null; celebrate?: boolean }
  | { ok: false; message: string };

/**
 * Punches the card. With a scanned `token`, the card comes from the token
 * (not the browser) and the token can only be used for one punch.
 */
export async function punchAction(
  slug: string,
  input: { cardId: string; count: number; token?: string; clientEventId: string; locationId: string },
): Promise<CounterResult> {
  const { businessId, actor } = await context(slug);
  let cardId = input.cardId;
  let tokenNonce: string | undefined;
  if (input.token) {
    const verified = verifyCardToken(input.token, businessId);
    if (!verified.ok) return { ok: false, message: "That code has expired. Scan the customer's card again." };
    cardId = verified.cardId;
    tokenNonce = verified.nonce;
  }

  const res = await punch({ businessId, actor, locationId: input.locationId }, { cardId, count: input.count, tokenNonce, clientEventId: input.clientEventId });
  if (!res.ok) return res;
  const summary = await cardSummary(businessId, { cardId: res.cardId });
  const message =
    res.rewardsEarned > 0
      ? `Card full! ${res.rewardsEarned === 1 ? "A reward is" : `${res.rewardsEarned} rewards are`} ready to redeem.`
      : `Punched. ${res.punches} of ${res.punchesRequired}.`;
  return { ok: true, message, summary, celebrate: res.rewardsEarned > 0 };
}

export async function redeemAction(slug: string, input: { customerId: string; token?: string; locationId: string }): Promise<CounterResult> {
  const { businessId, actor } = await context(slug);
  let tokenNonce: string | undefined;
  if (input.token) {
    const verified = verifyCardToken(input.token, businessId);
    if (!verified.ok) return { ok: false, message: "That code has expired. Scan the customer's card again." };
    tokenNonce = verified.nonce;
  }
  const res = await redeem({ businessId, actor, locationId: input.locationId }, { customerId: input.customerId, tokenNonce });
  if (!res.ok) return res;
  return { ok: true, message: `Redeemed: ${res.rewardText}.`, summary: await cardSummary(businessId, { customerId: input.customerId }) };
}

export async function undoAction(slug: string, item: { kind: "punch" | "redeem"; id: string }): Promise<{ ok: boolean; message: string; activity: ActivityItem[] }> {
  const { businessId, actor } = await context(slug);
  const res = item.kind === "punch" ? await undoPunch({ businessId, actor }, item.id) : await undoRedeem({ businessId, actor }, item.id);
  return { ok: res.ok, message: res.ok ? "Undone." : res.message, activity: await recentActivity(businessId) };
}

export async function activityAction(slug: string): Promise<ActivityItem[]> {
  const { businessId } = await context(slug);
  return recentActivity(businessId);
}
