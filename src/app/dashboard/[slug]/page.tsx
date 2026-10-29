import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
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
        </div>
        <form action={signOutAction}>
          <button className="text-sm text-zinc-600 underline dark:text-zinc-400">Sign out</button>
        </form>
      </header>

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Next: design your punch card</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {data.programs.length === 0
            ? "Choose how many punches earn a reward and what the reward is. The card designer is coming next."
            : `${data.programs.length} card program set up.`}
        </p>
      </section>

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
