import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { withTenant } from "@/db";
import { business, program } from "@/db/schema";
import { resolveTenant } from "@/lib/tenant";

// Placeholder tenant landing page. The branded join flow arrives in M2; for M0
// it proves routing and tenant-scoped reads end to end.
export default function TenantHome({ params }: PageProps<"/b/[slug]">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <TenantCard params={params} />
      </Suspense>
    </main>
  );
}

async function TenantCard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") notFound();

  const data = await withTenant({ businessId: tenant.id }, async (tx) => {
    const [biz] = await tx.select().from(business).where(eq(business.id, tenant.id));
    const [card] = await tx
      .select()
      .from(program)
      .where(and(eq(program.businessId, tenant.id), eq(program.active, true)))
      .limit(1);
    return { biz, card };
  });

  return (
    <div
      className="rounded-2xl p-6 text-white shadow-lg"
      style={{ backgroundColor: data.biz.brandColor ?? "#18181b" }}
    >
      <h1 className="text-2xl font-semibold">{data.biz.name}</h1>
      {data.card ? (
        <p className="mt-2 opacity-90">
          {data.card.name}: collect {data.card.punchesRequired} punches for{" "}
          {data.card.rewardText.toLowerCase()}.
        </p>
      ) : (
        <p className="mt-2 opacity-90">No active card yet.</p>
      )}
    </div>
  );
}
