import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/ui";
import { getUserScopes, requireUser } from "@/lib/session";

export const metadata = { title: "Dashboard · wepunch" };

// Sends owners to the right place after sign-in: onboarding, their one
// business, or a picker when they belong to several.
export default function DashboardIndex() {
  return (
    <Suspense fallback={<AuthShell title="Loading…" />}>
      <Router />
    </Suspense>
  );
}

async function Router() {
  const user = await requireUser();
  const businesses = (await getUserScopes(user.id)).filter((s) => s.kind === "business");
  if (businesses.length === 0) redirect("/onboarding");
  if (businesses.length === 1) redirect(`/dashboard/${businesses[0].slug}`);

  return (
    <AuthShell title="Choose a business">
      <ul className="flex flex-col gap-2">
        {businesses.map((b) => (
          <li key={b.scopeId}>
            <Link
              href={`/dashboard/${b.slug}`}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 hover:border-zinc-400 dark:border-zinc-800"
            >
              <span className="font-medium">{b.name}</span>
              <span className="text-sm capitalize text-zinc-500">{b.role}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/onboarding" className="text-sm font-medium underline">
        Add another business
      </Link>
    </AuthShell>
  );
}
