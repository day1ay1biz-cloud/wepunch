import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PunchCard } from "@/components/punch-card";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { currentCustomerId } from "@/lib/customer-session";
import { getCustomerCard, getCustomerContact } from "@/lib/enrollment";
import { getActiveProgram } from "@/lib/program";
import { DEFAULT_BRAND_COLOR } from "@/lib/program-rules";
import { resolveTenant } from "@/lib/tenant";
import { customerSignOutAction, joinFlowAction, joinSignedInAction } from "./actions";
import { CardQr } from "./card-qr";
import { JoinForm } from "./join-form";

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Your punch card",
    manifest: `/b/${slug}/manifest.webmanifest`,
    icons: { apple: `/b/${slug}/icon?size=180` },
    appleWebApp: { capable: true, title: "Punch card", statusBarStyle: "default" },
  };
}

// The customer's page for one business: join with a code, then show the card
// and the code staff scan. Reached from the counter sign's QR code.
export default function CustomerPage({ params }: PageProps<"/b/[slug]">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-6 px-4 py-8">
      <Suspense fallback={<p className="mt-24 text-zinc-500">Loading…</p>}>
        <Customer params={params} />
      </Suspense>
    </main>
  );
}

async function Customer({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // proxy.ts already 404s unknown slugs; this guards direct renders.
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") notFound();

  const [biz] = await withTenant({ businessId: tenant.id }, (tx) => tx.select().from(business).where(eq(business.id, tenant.id)));
  const program = await getActiveProgram(tenant.id);
  const brandColor = biz.brandColor ?? DEFAULT_BRAND_COLOR;

  if (!program) {
    return (
      <div className="mt-24 text-center">
        <h1 className="text-2xl font-semibold">{biz.name}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">This loyalty card isn&apos;t ready yet. Check back soon.</p>
      </div>
    );
  }

  const customerId = await currentCustomerId();
  const card = customerId ? await getCustomerCard(tenant.id, customerId) : null;

  if (customerId && card) {
    const toGo = card.punchesRequired - card.punches;
    return (
      <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{card.firstName ? `Hi ${card.firstName}!` : "Welcome back!"}</p>
        <PunchCard
          businessName={biz.name}
          cardName={card.cardName}
          rewardText={card.rewardText}
          punchesRequired={card.punchesRequired}
          punches={card.punches}
          brandColor={brandColor}
        />
        {card.rewardsAvailable > 0 ? (
          <p className="rounded-xl bg-green-50 px-4 py-3 text-center text-green-800 dark:bg-green-950 dark:text-green-200">
            You have {card.rewardsAvailable === 1 ? "a reward" : `${card.rewardsAvailable} rewards`} ready: {card.rewardText}. Show your code to redeem.
          </p>
        ) : (
          <p className="text-center text-zinc-700 dark:text-zinc-300">
            {toGo === 1 ? "1 more punch" : `${toGo} more punches`} until <span className="font-semibold">{card.rewardText.toLowerCase()}</span>
          </p>
        )}
        <CardQr slug={slug} />
        <InstallHint />
        <form action={customerSignOutAction.bind(null, slug)}>
          <button className="text-sm text-zinc-500 underline">Sign out on this device</button>
        </form>
      </>
    );
  }

  const preview = (
    <PunchCard
      businessName={biz.name}
      cardName={program.name}
      rewardText={program.rewardText}
      punchesRequired={program.punchesRequired}
      punches={0}
      brandColor={brandColor}
    />
  );

  if (customerId) {
    // Signed in from another business's card on this device: one tap to join.
    const contact = await getCustomerContact(customerId);
    const channel = contact?.phone ? "sms" : "email";
    return (
      <>
        {preview}
        <form action={joinSignedInAction.bind(null, slug)} className="flex w-full flex-col gap-4">
          <input type="hidden" name="channel" value={channel} />
          {!contact?.firstName && (
            <input name="firstName" maxLength={40} placeholder="First name (optional)" aria-label="First name (optional)" className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg dark:border-zinc-700 dark:bg-zinc-900" />
          )}
          <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" name="marketing" className="mt-0.5 h-5 w-5" />
            <span>
              {channel === "sms"
                ? `Text me offers from ${biz.name}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`
                : `Email me offers from ${biz.name}. Unsubscribe any time.`}
            </span>
          </label>
          <button className="w-full rounded-xl bg-zinc-900 px-4 py-3.5 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            {program.punchOnJoin ? "Join and get your first punch" : "Join"}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      {preview}
      <div className="text-center">
        <h1 className="text-xl font-semibold">{program.punchOnJoin ? "Join and get your first punch free" : "Get your punch card"}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">No app to download. We&apos;ll send you a code to keep your card safe.</p>
      </div>
      <JoinForm businessName={biz.name} action={joinFlowAction.bind(null, slug)} />
    </>
  );
}

function InstallHint() {
  return (
    <p className="max-w-xs text-center text-xs text-zinc-500">
      Tip: add this page to your home screen so your card is one tap away. On iPhone, tap Share, then &ldquo;Add to Home Screen&rdquo;.
    </p>
  );
}
