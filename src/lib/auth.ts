import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { actionEmail, sendEmail } from "@/lib/email";

// Owners, staff and platform admins sign in here. Customers use one-time
// codes (M2) and are not Better Auth users.
function createAuth() {
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const scheme = rootDomain.startsWith("localhost") ? "http" : "https";

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified owner who signs in gets a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          actionEmail({
            to: user.email,
            subject: "Confirm your email for wepunch",
            intro: `Hi ${user.name}, confirm your email address to finish setting up your wepunch account. This link works for 24 hours.`,
            action: "Confirm email",
            url,
          }),
        );
      },
    },
    // Tenant subdomains post to the same auth endpoints.
    trustedOrigins: [`${scheme}://*.${rootDomain}`],
    // nextCookies must stay last so server actions can set session cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// Created on first use so `next build` does not need runtime secrets.
const globalForAuth = globalThis as unknown as { auth?: Auth };

export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}
