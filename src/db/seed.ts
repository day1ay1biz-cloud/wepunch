// Local demo data: two businesses, one through an agency, each with an owner.
// Writes go through the app role and withTenant(), the same path the app uses.
// `pnpm db:seed` (idempotent)
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "./index";
import { agency, business, location, membership, program, user } from "./schema";
import { getAuth } from "../lib/auth";
import { resolveTenant } from "../lib/tenant";

// Local-only test password for the seeded owners.
const DEV_PASSWORD = "wepunch-dev-password";

// Seeded addresses are fake: log verification emails instead of sending them,
// then mark the owners verified so they can sign in straight away.
delete process.env.RESEND_API_KEY;

const AGENCY = { name: "Main Street Marketing" };

const BUSINESSES = [
  {
    name: "Joe's Coffee",
    slug: "joes-coffee",
    brandColor: "#6b3e26",
    viaAgency: true,
    owner: { name: "Joe Rivera", email: "joe@example.com" },
    program: { name: "Coffee Card", punchesRequired: 10, rewardText: "Free drink of any size" },
  },
  {
    name: "Bella Salon",
    slug: "bella-salon",
    brandColor: "#7c3aed",
    viaAgency: false,
    owner: { name: "Bella Chen", email: "bella@example.com" },
    program: { name: "Style Card", punchesRequired: 6, rewardText: "Free blow-dry" },
  },
];

async function ensureUser(name: string, email: string): Promise<string> {
  const db = getDb();
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) return existing.id;
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: DEV_PASSWORD } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, res.user.id));
  return res.user.id;
}

async function main() {
  const agencyId = randomUUID();
  let agencyCreated = false;

  for (const b of BUSINESSES) {
    if (await resolveTenant({ slug: b.slug })) {
      console.log(`exists: ${b.slug}`);
      continue;
    }

    if (b.viaAgency && !agencyCreated) {
      await withTenant({ agencyId }, (tx) => tx.insert(agency).values({ id: agencyId, ...AGENCY }));
      agencyCreated = true;
    }

    const ownerId = await ensureUser(b.owner.name, b.owner.email);
    const businessId = randomUUID();
    await withTenant({ businessId }, async (tx) => {
      await tx.insert(business).values({
        id: businessId,
        name: b.name,
        slug: b.slug,
        brandColor: b.brandColor,
        agencyId: b.viaAgency ? agencyId : null,
      });
      await tx.insert(location).values({ businessId, name: "Main Street" });
      await tx.insert(program).values({ businessId, ...b.program });
      await tx.insert(membership).values({ businessId, userId: ownerId, role: "owner" });
    });
    console.log(`created: ${b.slug} (owner ${b.owner.email})`);
  }
}

await main();
process.exit(0);
