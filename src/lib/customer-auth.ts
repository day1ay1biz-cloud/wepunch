import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { customerChallenge, customerSession } from "@/db/schema";
import { sendEmail, type Email } from "@/lib/email";

// Customer sign-in: a one-time code by text (Twilio Verify) or email, then a
// long-lived device session. Customers are not Better Auth users.

export type Channel = "sms" | "email";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 30 * 1000;
const MAX_PER_DESTINATION_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 20;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** US numbers only (launch market): "(480) 555-0123" → "+14805550123". */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // NANP: area code and exchange can't start with 0 or 1.
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** "+14805550123" → "(•••) •••-0123"; "maria@example.com" → "m•••@example.com" */
export function maskDestination(channel: Channel, destination: string): string {
  if (channel === "sms") return `(•••) •••-${destination.slice(-4)}`;
  const [local, domain] = destination.split("@");
  return `${local[0]}•••@${domain}`;
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

const hashCode = (destination: string, code: string) =>
  createHmac("sha256", secret()).update(`customer-code:${destination}:${code}`).digest("hex");

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// --- Twilio Verify ---------------------------------------------------------

type Fetch = typeof fetch;

function twilioConfig() {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_VERIFY_SERVICE_SID: service, SMS_TRANSPORT } = process.env;
  if (SMS_TRANSPORT === "log" || !sid || !token || !service) return null;
  return { sid, token, service };
}

async function twilio(path: string, form: Record<string, string>, fetchImpl: Fetch) {
  const cfg = twilioConfig()!;
  const res = await fetchImpl(`https://verify.twilio.com/v2/Services/${cfg.service}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; code?: number; message?: string };
  return { ok: res.ok, httpStatus: res.status, ...body };
}

// --- Challenges ------------------------------------------------------------

export type StartResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a sign-in code. Rate limited per destination (5 an hour, 30 s apart)
 * and per IP (20 an hour). Email codes, and text codes when Twilio isn't set
 * up (local development), are generated here and stored hashed.
 */
export async function startChallenge(
  input: { channel: Channel; destination: string; ip: string | null; businessName?: string },
  deps: { db?: Db; fetch?: Fetch } = {},
): Promise<StartResult> {
  const db = deps.db ?? getDb();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recent = await db
    .select({ createdAt: customerChallenge.createdAt })
    .from(customerChallenge)
    .where(and(eq(customerChallenge.destination, input.destination), gt(customerChallenge.createdAt, hourAgo)))
    .orderBy(desc(customerChallenge.createdAt));
  if (recent.length >= MAX_PER_DESTINATION_PER_HOUR) return { ok: false, error: "Too many codes requested. Try again in an hour." };
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_GAP_MS) {
    return { ok: false, error: "We just sent a code. Wait 30 seconds before asking for another." };
  }
  if (input.ip) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerChallenge)
      .where(and(eq(customerChallenge.ip, input.ip), gt(customerChallenge.createdAt, hourAgo)));
    if (count >= MAX_PER_IP_PER_HOUR) return { ok: false, error: "Too many codes requested. Try again later." };
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  if (input.channel === "sms" && twilioConfig()) {
    const res = await twilio("Verifications", { To: input.destination, Channel: "sms" }, deps.fetch ?? fetch);
    if (!res.ok) {
      // 60200: invalid number; 60203: Twilio's own send limit; 21608: unverified number on a trial account.
      const error =
        res.code === 60203
          ? "Too many codes requested. Try again later."
          : res.code === 21608
            ? "This number can't receive texts from us yet. Use email instead."
            : "We couldn't text that number. Check it, or use email instead.";
      return { ok: false, error };
    }
    await db.insert(customerChallenge).values({ ...input, provider: "twilio", codeHash: null, expiresAt });
    return { ok: true };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(customerChallenge).values({
    channel: input.channel,
    destination: input.destination,
    ip: input.ip,
    provider: "local",
    codeHash: hashCode(input.destination, code),
    expiresAt,
  });

  if (input.channel === "email") {
    const sent = await sendEmail(codeEmail(input.destination, code, input.businessName ?? "wepunch"));
    if (!sent && process.env.NODE_ENV === "production") return { ok: false, error: "We couldn't send the email. Try again, or use your phone number." };
  } else {
    // Local development without Twilio: the code goes to the server log.
    console.info(`[sms] to ${input.destination}: your code is ${code}`);
  }
  return { ok: true };
}

function codeEmail(to: string, code: string, from: string): Email {
  const name = from.replace(/[<>&"]/g, "");
  return {
    to,
    subject: `${code} is your ${name} code`,
    text: `Your ${name} code is ${code}. It works for 10 minutes. If you didn't ask for it, ignore this email.\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#18181b;max-width:480px;margin:0 auto;padding:24px">
<p>Your ${name} code is</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="color:#71717a">It works for 10 minutes. If you didn't ask for it, ignore this email.</p>
</body></html>`,
  };
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

/** Checks a code against the latest open challenge for this destination. */
export async function verifyChallenge(
  input: { channel: Channel; destination: string; code: string },
  deps: { db?: Db; fetch?: Fetch } = {},
): Promise<VerifyResult> {
  const db = deps.db ?? getDb();
  const code = input.code.replace(/\D/g, "");
  if (code.length < 4 || code.length > 10) return { ok: false, error: "Enter the code we sent you." };

  const [challenge] = await db
    .select()
    .from(customerChallenge)
    .where(
      and(
        eq(customerChallenge.channel, input.channel),
        eq(customerChallenge.destination, input.destination),
        isNull(customerChallenge.consumedAt),
        gt(customerChallenge.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(customerChallenge.createdAt))
    .limit(1);
  if (!challenge) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong tries. Ask for a new code." };

  // Count the attempt before checking, so parallel guesses can't skip the limit.
  const [counted] = await db
    .update(customerChallenge)
    .set({ attempts: sql`${customerChallenge.attempts} + 1` })
    .where(and(eq(customerChallenge.id, challenge.id), sql`${customerChallenge.attempts} < ${MAX_ATTEMPTS}`))
    .returning({ id: customerChallenge.id });
  if (!counted) return { ok: false, error: "Too many wrong tries. Ask for a new code." };

  let valid: boolean;
  if (challenge.provider === "twilio") {
    const res = await twilio("VerificationCheck", { To: input.destination, Code: code }, deps.fetch ?? fetch);
    valid = res.ok && res.status === "approved";
  } else {
    const expected = Buffer.from(challenge.codeHash ?? "", "hex");
    const actual = Buffer.from(hashCode(input.destination, code), "hex");
    valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  if (!valid) return { ok: false, error: "That code isn't right. Check it and try again." };

  const [consumed] = await db
    .update(customerChallenge)
    .set({ consumedAt: new Date() })
    .where(and(eq(customerChallenge.id, challenge.id), isNull(customerChallenge.consumedAt)))
    .returning({ id: customerChallenge.id });
  return consumed ? { ok: true } : { ok: false, error: "That code was already used. Ask for a new one." };
}

// --- Sessions --------------------------------------------------------------

export async function createCustomerSession(customerId: string, userAgent: string | null, db: Db = getDb()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(customerSession).values({ customerId, tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 300), expiresAt });
  return { token, expiresAt };
}

/** The customer id for a session token, or null when unknown or expired. */
export async function customerIdForToken(token: string | undefined, db: Db = getDb()): Promise<string | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .update(customerSession)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(customerSession.tokenHash, hashToken(token)), gt(customerSession.expiresAt, new Date())))
    .returning({ customerId: customerSession.customerId });
  return row?.customerId ?? null;
}

export async function revokeCustomerSession(token: string | undefined, db: Db = getDb()) {
  if (token) await db.delete(customerSession).where(eq(customerSession.tokenHash, hashToken(token)));
}

/** Finds or creates the customer for a destination they've just verified. */
export async function upsertVerifiedCustomer(channel: Channel, destination: string, db: Db = getDb()): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select customer_upsert(${channel === "sms" ? destination : null}, ${channel === "email" ? destination : null}) as id`,
  );
  return row.id;
}
