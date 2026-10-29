import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { withTenant } from "@/db";
import { business, location } from "@/db/schema";
import { requireBusinessAccess } from "@/lib/session";
import { listTeam } from "@/lib/team";
import { inviteAction, resendInviteAction, revokeInviteAction, setStaffActiveAction } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Team · wepunch" };

export default function TeamPage({ params }: PageProps<"/dashboard/[slug]/team">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Team params={params} />
      </Suspense>
    </main>
  );
}

const linkButton = "text-sm font-medium text-zinc-700 underline hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white";

async function Team({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, businessId, role } = await requireBusinessAccess(slug);

  const { biz, locations } = await withTenant({ businessId }, async (tx) => ({
    biz: (await tx.select({ name: business.name }).from(business).where(eq(business.id, businessId)))[0],
    locations: await tx.select({ id: location.id, name: location.name }).from(location).where(eq(location.businessId, businessId)),
  }));

  const header = (
    <div>
      <Link href={`/dashboard/${slug}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
        ← {biz.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Team</h1>
    </div>
  );

  if (role !== "owner") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">Only owners can manage the team.</p>
      </div>
    );
  }

  const { members, invites } = await listTeam(businessId);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const where = (ids: string[]) => (ids.length === 0 ? "All locations" : ids.map((id) => locationName.get(id) ?? "Removed location").join(", "));

  return (
    <div className="flex flex-col gap-8">
      {header}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">People</h2>
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className={m.active ? "" : "opacity-60"}>
                <p className="font-medium">
                  {m.name}
                  {m.userId === user.id && <span className="text-zinc-500"> (you)</span>}
                </p>
                <p className="text-sm text-zinc-500">
                  {m.email} · <span className="capitalize">{m.role}</span> · {where(m.locationIds)}
                  {!m.active && " · Access off"}
                </p>
              </div>
              {m.role === "staff" && (
                <form action={setStaffActiveAction.bind(null, slug, m.id, !m.active)}>
                  <button className={linkButton}>{m.active ? "Turn off access" : "Turn access back on"}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Waiting to accept</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {invites.map((i) => {
              const expired = i.expiresAt <= new Date();
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="font-medium">{i.email}</p>
                    <p className="text-sm text-zinc-500">
                      <span className="capitalize">{i.role}</span> · {expired ? "Link expired" : `Link works until ${i.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <form action={resendInviteAction.bind(null, slug, i.id)}>
                      <button className={linkButton}>Resend</button>
                    </form>
                    <form action={revokeInviteAction.bind(null, slug, i.id)}>
                      <button className={linkButton}>Cancel invite</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Invite someone</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">They&apos;ll get an email with a link to join. It works for 7 days.</p>
        <InviteForm locations={locations} action={inviteAction.bind(null, slug)} />
      </section>
    </div>
  );
}
