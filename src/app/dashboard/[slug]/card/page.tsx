import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { getActiveProgram, PROGRAM_DEFAULTS } from "@/lib/program";
import { requireBusinessAccess } from "@/lib/session";
import { saveCardAction } from "./actions";
import { CardDesigner } from "./designer";

export const metadata = { title: "Design your card · wepunch" };

export default function CardPage({ params }: PageProps<"/dashboard/[slug]/card">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Designer params={params} />
      </Suspense>
    </main>
  );
}

async function Designer({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { businessId, role } = await requireBusinessAccess(slug);

  const [biz] = await withTenant({ businessId }, (tx) => tx.select().from(business).where(eq(business.id, businessId)));
  const existing = await getActiveProgram(businessId);

  const initial = {
    name: existing?.name ?? PROGRAM_DEFAULTS.name,
    rewardText: existing?.rewardText ?? PROGRAM_DEFAULTS.rewardText,
    punchesRequired: existing?.punchesRequired ?? PROGRAM_DEFAULTS.punchesRequired,
    brandColor: biz.brandColor ?? PROGRAM_DEFAULTS.brandColor,
    maxPunchesPerVisit: existing?.maxPunchesPerVisit ?? PROGRAM_DEFAULTS.maxPunchesPerVisit,
    minMinutesBetween: existing?.minMinutesBetween ?? PROGRAM_DEFAULTS.minMinutesBetween,
    expiryDays: existing?.expiryDays ?? PROGRAM_DEFAULTS.expiryDays,
    punchOnJoin: existing?.punchOnJoin ?? PROGRAM_DEFAULTS.punchOnJoin,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/${slug}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          ← {biz.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{existing ? "Your punch card" : "Design your punch card"}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Changes show in the preview as you type. Customers see the card exactly like this.
        </p>
      </div>
      {role === "owner" ? (
        <CardDesigner businessName={biz.name} initial={initial} action={saveCardAction.bind(null, slug)} />
      ) : (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">Only owners can change the card.</p>
      )}
    </div>
  );
}
