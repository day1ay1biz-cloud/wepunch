import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PunchCard } from "@/components/punch-card";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { getActiveProgram } from "@/lib/program";
import { DEFAULT_BRAND_COLOR } from "@/lib/program-rules";
import { resolveTenant } from "@/lib/tenant";

// Customer landing page for a business. Shows the card as the owner designed
// it; joining (phone or email code) arrives in M2.
export default function TenantHome({ params }: PageProps<"/b/[slug]">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <TenantCard params={params} />
      </Suspense>
    </main>
  );
}

async function TenantCard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // proxy.ts already 404s unknown slugs; this guards direct renders.
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") notFound();

  const [biz] = await withTenant({ businessId: tenant.id }, (tx) =>
    tx.select().from(business).where(eq(business.id, tenant.id)),
  );
  const card = await getActiveProgram(tenant.id);

  if (!card) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{biz.name}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">This loyalty card isn&apos;t ready yet. Check back soon.</p>
      </div>
    );
  }

  return (
    <>
      <PunchCard
        businessName={biz.name}
        cardName={card.name}
        rewardText={card.rewardText}
        punchesRequired={card.punchesRequired}
        punches={0}
        brandColor={biz.brandColor ?? DEFAULT_BRAND_COLOR}
      />
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {card.punchOnJoin ? "Join to get your first punch free. " : ""}Joining opens soon.
      </p>
    </>
  );
}
