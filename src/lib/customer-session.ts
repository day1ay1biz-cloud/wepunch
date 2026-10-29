import { cookies, headers } from "next/headers";
import { createCustomerSession, customerIdForToken, revokeCustomerSession } from "@/lib/customer-auth";

// Cookie plumbing for customer sessions. Kept apart from customer-auth.ts so
// that module stays free of Next.js imports and easy to test.

const COOKIE = "wp_cs";

/** The signed-in customer's id on this device, or null. */
export async function currentCustomerId(): Promise<string | null> {
  return customerIdForToken((await cookies()).get(COOKIE)?.value);
}

export async function signInCustomer(customerId: string) {
  const userAgent = (await headers()).get("user-agent");
  const { token, expiresAt } = await createCustomerSession(customerId, userAgent);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function signOutCustomer() {
  const jar = await cookies();
  await revokeCustomerSession(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
}

/** The visitor's IP, for rate limits and consent records. Fly sets Fly-Client-IP. */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("fly-client-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
}
