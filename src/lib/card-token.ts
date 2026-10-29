import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The code on a customer's card that staff scan (M3). It names the card and
// business, expires after 60 seconds, and is signed so it can't be forged or
// edited. A screenshot stops working within a minute; M3 also rejects a
// token that has already been used.

export const CARD_TOKEN_TTL_SECONDS = 60;
const PREFIX = "wp1";

type Payload = { c: string; b: string; e: number; n: string };

function key(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", key()).update(`card-token:${body}`).digest("base64url");

export function signCardToken(cardId: string, businessId: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(now / 1000) + CARD_TOKEN_TTL_SECONDS;
  const payload: Payload = { c: cardId, b: businessId, e: expiresAt, n: randomBytes(6).toString("base64url") };
  const body = b64(JSON.stringify(payload));
  return { token: `${PREFIX}.${body}.${sign(body)}`, expiresAt: expiresAt * 1000 };
}

export type VerifiedCardToken =
  | { ok: true; cardId: string; nonce: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_business" };

/** Checks a scanned token for this business. Replay protection is the caller's job. */
export function verifyCardToken(token: string, businessId: string, now = Date.now()): VerifiedCardToken {
  const [prefix, body, sig] = token.trim().split(".");
  if (prefix !== PREFIX || !body || !sig) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "bad_signature" };

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.e * 1000 <= now) return { ok: false, reason: "expired" };
  if (payload.b !== businessId) return { ok: false, reason: "wrong_business" };
  return { ok: true, cardId: payload.c, nonce: payload.n, expiresAt: payload.e * 1000 };
}
