import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { customerChallenge, customerSession } from "@/db/schema";
import {
  createCustomerSession,
  customerIdForToken,
  maskDestination,
  normalizeEmail,
  normalizeUsPhone,
  revokeCustomerSession,
  startChallenge,
  upsertVerifiedCustomer,
  verifyChallenge,
} from "@/lib/customer-auth";
import { adminDb, appDb } from "./db";

let admin: Db;
let app: Db;
const phone = () => `+1480555${String(randomInt(0, 10000)).padStart(4, "0")}`;
const ip = () => `10.0.${randomInt(0, 255)}.${randomInt(0, 255)}`;

/** Starts an SMS challenge in local mode and returns the logged code. */
async function startAndCapture(destination: string, at = ip()) {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  const res = await startChallenge({ channel: "sms", destination, ip: at }, { db: app });
  const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes(destination));
  spy.mockRestore();
  return { res, code: line?.match(/(\d{6})$/)?.[1] };
}

beforeAll(() => {
  admin = adminDb();
  app = appDb();
});

afterAll(async () => {
  await admin?.$client.end();
  await app?.$client.end();
});

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_VERIFY_SERVICE_SID;
});

describe("normalizing", () => {
  it.each([
    ["(480) 555-0123", "+14805550123"],
    ["480.555.0123", "+14805550123"],
    ["+1 480 555 0123", "+14805550123"],
    ["14805550123", "+14805550123"],
    ["555-0123", null],
    ["(180) 555-0123", null],
    ["+44 20 7946 0958", null],
  ])("phone %s → %s", (input, out) => {
    expect(normalizeUsPhone(input)).toBe(out);
  });

  it("lowercases emails and rejects junk", () => {
    expect(normalizeEmail("  Maria@Example.COM ")).toBe("maria@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("masks what it shows back", () => {
    expect(maskDestination("sms", "+14805550123")).toBe("(•••) •••-0123");
    expect(maskDestination("email", "maria@example.com")).toBe("m•••@example.com");
  });
});

describe("codes (local mode)", () => {
  it("accepts the right code once, after a wrong one", async () => {
    const to = phone();
    const { res, code } = await startAndCapture(to);
    expect(res).toEqual({ ok: true });
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyChallenge({ channel: "sms", destination: to, code: wrong }, { db: app })).toMatchObject({ ok: false });
    expect(await verifyChallenge({ channel: "sms", destination: to, code: code! }, { db: app })).toEqual({ ok: true });
    expect(await verifyChallenge({ channel: "sms", destination: to, code: code! }, { db: app })).toMatchObject({ ok: false });

    const [row] = await admin.select().from(customerChallenge).where(eq(customerChallenge.destination, to));
    expect(row.codeHash).not.toContain(code!);
  });

  it("locks a code after 5 wrong tries, even the right one", async () => {
    const to = phone();
    const { code } = await startAndCapture(to);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await verifyChallenge({ channel: "sms", destination: to, code: wrong }, { db: app });
    expect(await verifyChallenge({ channel: "sms", destination: to, code: code! }, { db: app })).toEqual({
      ok: false,
      error: "Too many wrong tries. Ask for a new code.",
    });
  });

  it("rejects expired codes", async () => {
    const to = phone();
    const { code } = await startAndCapture(to);
    await admin.update(customerChallenge).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(customerChallenge.destination, to));
    expect(await verifyChallenge({ channel: "sms", destination: to, code: code! }, { db: app })).toMatchObject({ ok: false });
  });

  it("rate limits per destination: 30 s apart and 5 an hour", async () => {
    const to = phone();
    await startAndCapture(to);
    expect((await startAndCapture(to)).res).toMatchObject({ ok: false, error: expect.stringContaining("30 seconds") });

    // Backdate so the gap rule passes, then fill the hourly budget.
    for (let i = 0; i < 4; i++) {
      await admin.update(customerChallenge).set({ createdAt: new Date(Date.now() - 5 * 60 * 1000) }).where(eq(customerChallenge.destination, to));
      expect((await startAndCapture(to)).res).toEqual({ ok: true });
    }
    await admin.update(customerChallenge).set({ createdAt: new Date(Date.now() - 5 * 60 * 1000) }).where(eq(customerChallenge.destination, to));
    expect((await startAndCapture(to)).res).toMatchObject({ ok: false, error: expect.stringContaining("an hour") });
  });

  it("rate limits per IP", async () => {
    const shared = ip();
    for (let i = 0; i < 20; i++) expect((await startAndCapture(phone(), shared)).res).toEqual({ ok: true });
    expect((await startAndCapture(phone(), shared)).res).toMatchObject({ ok: false });
  });

  it("emails a code when the channel is email", async () => {
    const to = `code-${randomInt(0, 1e9)}@example.com`;
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await startChallenge({ channel: "email", destination: to, ip: ip(), businessName: "Joe's Coffee" }, { db: app })).toEqual({ ok: true });
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    spy.mockRestore();
    expect(logged).toContain(`to: ${to}`);
    expect(logged).toMatch(/subject: \d{6} is your Joe's Coffee code/);
  });
});

describe("codes (Twilio Verify)", () => {
  function useTwilio(responses: { status: number; body: object }[]) {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest";
    const calls: { url: string; body: string; auth: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: String((init.headers as Record<string, string>).Authorization) });
      const next = responses.shift()!;
      return new Response(JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch;
    return { calls, fake };
  }

  it("starts and checks through Twilio, storing no code", async () => {
    const to = phone();
    const { calls, fake } = useTwilio([
      { status: 201, body: { status: "pending" } },
      { status: 200, body: { status: "approved" } },
    ]);
    expect(await startChallenge({ channel: "sms", destination: to, ip: ip() }, { db: app, fetch: fake })).toEqual({ ok: true });
    expect(await verifyChallenge({ channel: "sms", destination: to, code: "123456" }, { db: app, fetch: fake })).toEqual({ ok: true });

    expect(calls[0].url).toBe("https://verify.twilio.com/v2/Services/VAtest/Verifications");
    expect(new URLSearchParams(calls[0].body).get("To")).toBe(to);
    expect(new URLSearchParams(calls[0].body).get("Channel")).toBe("sms");
    expect(calls[1].url).toBe("https://verify.twilio.com/v2/Services/VAtest/VerificationCheck");
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("ACtest:token").toString("base64")}`);

    const [row] = await admin.select().from(customerChallenge).where(eq(customerChallenge.destination, to));
    expect(row).toMatchObject({ provider: "twilio", codeHash: null });
  });

  it("explains a trial account's unverified-number error", async () => {
    const { fake } = useTwilio([{ status: 400, body: { code: 21608, message: "unverified" } }]);
    expect(await startChallenge({ channel: "sms", destination: phone(), ip: ip() }, { db: app, fetch: fake })).toEqual({
      ok: false,
      error: "This number can't receive texts from us yet. Use email instead.",
    });
  });

  it("treats a pending check as a wrong code", async () => {
    const to = phone();
    const { fake } = useTwilio([
      { status: 201, body: { status: "pending" } },
      { status: 200, body: { status: "pending" } },
    ]);
    await startChallenge({ channel: "sms", destination: to, ip: ip() }, { db: app, fetch: fake });
    expect(await verifyChallenge({ channel: "sms", destination: to, code: "999999" }, { db: app, fetch: fake })).toMatchObject({ ok: false });
  });
});

describe("customers and sessions", () => {
  it("finds the same customer for the same verified phone", async () => {
    const to = phone();
    const a = await upsertVerifiedCustomer("sms", to, app);
    expect(await upsertVerifiedCustomer("sms", to, app)).toBe(a);
  });

  it("issues, reads, expires and revokes sessions, storing only a hash", async () => {
    const customerId = await upsertVerifiedCustomer("email", `s-${randomInt(0, 1e9)}@example.com`, app);
    const { token } = await createCustomerSession(customerId, "test-agent", app);
    expect(await customerIdForToken(token, app)).toBe(customerId);
    expect(await customerIdForToken("x".repeat(43), app)).toBeNull();
    expect(await customerIdForToken(undefined, app)).toBeNull();

    const rows = await admin.select().from(customerSession).where(eq(customerSession.customerId, customerId));
    expect(rows[0].tokenHash).not.toBe(token);

    await revokeCustomerSession(token, app);
    expect(await customerIdForToken(token, app)).toBeNull();

    const second = await createCustomerSession(customerId, null, app);
    await admin.update(customerSession).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(customerSession.customerId, customerId));
    expect(await customerIdForToken(second.token, app)).toBeNull();
  });
});
