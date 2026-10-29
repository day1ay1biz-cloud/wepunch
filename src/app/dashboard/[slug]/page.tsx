import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { PunchCard } from "@/components/punch-card";
import { DEFAULT_BRAND_COLOR } from "@/lib/program-rules";
import { withTenant } from "@/db";
import { business, location, program } from "@/db/schema";
import { requireBusinessAccess } from "@/lib/session";

export const metadata = { title: "Dashboard · wepunch" };

export default function BusinessDashboard({ params }: PageProps<"/dashboard/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Dashboard params={params} />
      </Suspense>
    </main>
  );
}

async function Dashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, businessId, role } = await requireBusinessAccess(slug);

  const data = await withTenant({ businessId }, async (tx) => ({
    biz: (await tx.select().from(business).where(eq(business.id, businessId)))[0],
    locations: await tx.select().from(location).where(eq(location.businessId, businessId)),
    programs: await tx.select().from(program).where(eq(program.businessId, businessId)),
  }));

  const card = data.programs.find((p) => p.active) ?? null;
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const publicPath = `/b/${data.biz.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-500">wepunch</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.biz.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Signed in as {user.name} · <span className="capitalize">{role}</span>
          </p>
          {role === "owner" && (
            <nav className="mt-3 flex gap-4 text-sm font-medium">
              <Link href={`/dashboard/${data.biz.slug}/card`} className="underline">
                Card
              </Link>
              <Link href={`/dashboard/${data.biz.slug}/team`} className="underline">
                Team
              </Link>
            </nav>
          )}
        </div>
        <form action={signOutAction}>
          <button className="text-sm text-zinc-600 underline dark:text-zinc-400">Sign out</button>
        </form>
      </header>

      {card ? (
        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5 sm:flex-row sm:items-center dark:border-zinc-800">
          <PunchCard
            businessName={data.biz.name}
            cardName={card.name}
            rewardText={card.rewardText}
            punchesRequired={card.punchesRequired}
            punches={0}
            brandColor={data.biz.brandColor ?? DEFAULT_BRAND_COLOR}
          />
          <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Your punch card</h2>
            <p>
              {card.maxPunchesPerVisit === 1 ? "1 punch per visit" : `Up to ${card.maxPunchesPerVisit} punches per visit`}
              {card.minMinutesBetween > 0 ? `, ${card.minMinutesBetween} min apart` : ""}
            </p>
            <p>{card.expiryDays ? `Cards expire after ${card.expiryDays} days` : "Cards never expire"}</p>
            {card.punchOnJoin && <p>First punch free on joining</p>}
            {role === "owner" && (
              <Link href={`/dashboard/${data.biz.slug}/card`} className="mt-2 font-medium text-zinc-900 underline dark:text-zinc-100">
                Edit card
              </Link>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Next: design your punch card</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Choose how many punches earn a reward, what the reward is, and your card colour.
          </p>
          {role === "owner" && (
            <Link
              href={`/dashboard/${data.biz.slug}/card`}
              className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Design your card
            </Link>
          )}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Your customer page</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {data.biz.slug}.{rootDomain}
          </p>
          <Link href={publicPath} className="mt-2 inline-block text-sm font-medium underline">
            Open it
          </Link>
        </div>
        <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Locations</h2>
          <ul className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {data.locations.map((l) => (
              <li key={l.id}>
                {l.name}
                {l.address ? ` · ${l.address}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
