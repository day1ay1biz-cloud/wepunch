import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { actorFor, recentActivity } from "@/lib/counter";
import { listLocations } from "@/lib/locations";
import { getActiveProgram } from "@/lib/program";
import { DEFAULT_BRAND_COLOR } from "@/lib/program-rules";
import { requireBusinessAccess } from "@/lib/session";
import { CounterApp } from "./counter-app";

export const metadata = { title: "Counter · wepunch" };

// The staff screen at the register: scan or look up a customer, punch,
// redeem, and undo mistakes. Built for a phone or a counter tablet.
export default function CounterPage({ params }: PageProps<"/dashboard/[slug]/counter">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Counter params={params} />
      </Suspense>
    </main>
  );
}

async function Counter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, businessId, role } = await requireBusinessAccess(slug);
  const [biz] = await withTenant({ businessId }, (tx) => tx.select().from(business).where(eq(business.id, businessId)));
  const actor = await actorFor(businessId, user.id, role);
  const program = await getActiveProgram(businessId);

  const header = (
    <div className="mb-4 flex items-baseline justify-between">
      <h1 className="text-lg font-semibold">{biz.name}</h1>
      <Link href={`/dashboard/${slug}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
        Dashboard
      </Link>
    </div>
  );

  if (!program) {
    return (
      <>
        {header}
        <p className="text-zinc-600 dark:text-zinc-400">There&apos;s no punch card yet. An owner needs to design it first.</p>
      </>
    );
  }

  const all = await listLocations(businessId);
  const locations = (actor.locationIds.length ? all.filter((l) => actor.locationIds.includes(l.id)) : all).map((l) => ({ id: l.id, name: l.name }));
  if (locations.length === 0) {
    return (
      <>
        {header}
        <p className="text-zinc-600 dark:text-zinc-400">You aren&apos;t assigned to any open location. Ask an owner to update your access.</p>
      </>
    );
  }

  return (
    <>
      {header}
      <CounterApp
        slug={slug}
        businessName={biz.name}
        brandColor={biz.brandColor ?? DEFAULT_BRAND_COLOR}
        userId={user.id}
        role={role}
        locations={locations}
        initialActivity={await recentActivity(businessId)}
      />
    </>
  );
}
