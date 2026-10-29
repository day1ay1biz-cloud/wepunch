import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { US_TIMEZONES } from "@/lib/business-client";
import { listLocations } from "@/lib/locations";
import { requireBusinessAccess } from "@/lib/session";
import { addLocationAction, archiveLocationAction, updateLocationAction } from "./actions";
import { LocationForm } from "./location-form";

export const metadata = { title: "Locations · wepunch" };

export default function LocationsPage({ params }: PageProps<"/dashboard/[slug]/locations">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Locations params={params} />
      </Suspense>
    </main>
  );
}

const tzLabel = (tz: string | null) => US_TIMEZONES.find((t) => t.value === tz)?.label ?? tz ?? "";

async function Locations({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { businessId, role } = await requireBusinessAccess(slug);
  const [biz] = await withTenant({ businessId }, (tx) => tx.select().from(business).where(eq(business.id, businessId)));
  const locations = await listLocations(businessId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/dashboard/${slug}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          ← {biz.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Each punch records where it happened. Staff can be limited to some locations when you invite them.
        </p>
      </div>

      {role !== "owner" ? (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {locations.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <p className="font-medium">{l.name}</p>
              <p className="text-sm text-zinc-500">{[l.address, tzLabel(l.timezone)].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {locations.map((l) => (
              <li key={l.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                <LocationForm
                  initial={{ name: l.name, address: l.address ?? "", timezone: l.timezone ?? biz.timezone }}
                  action={updateLocationAction.bind(null, slug, l.id)}
                  archive={locations.length > 1 ? archiveLocationAction.bind(null, slug, l.id) : undefined}
                  submitLabel="Save"
                />
              </li>
            ))}
          </ul>

          <section className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
            <h2 className="font-semibold">Add a location</h2>
            <LocationForm
              initial={{ name: "", address: "", timezone: biz.timezone }}
              action={addLocationAction.bind(null, slug)}
              submitLabel="Add location"
              clearOnSuccess
            />
          </section>
        </>
      )}
    </div>
  );
}
