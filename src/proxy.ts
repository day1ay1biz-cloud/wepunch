import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import { isPlatformPath, tenantFromHost } from "@/lib/tenant-host";

// Custom domains need a database lookup; cache answers briefly per process.
const DOMAIN_TTL_MS = 60_000;
const domainCache = new Map<string, { slug: string | null; expires: number }>();

async function slugForDomain(domain: string): Promise<string | null> {
  const hit = domainCache.get(domain);
  if (hit && hit.expires > Date.now()) return hit.slug;
  const tenant = await resolveTenant({ domain });
  const slug = tenant && tenant.status !== "deleted" ? tenant.slug : null;
  domainCache.set(domain, { slug, expires: Date.now() + DOMAIN_TTL_MS });
  return slug;
}

/**
 * Maps tenant hosts onto the internal `/b/<slug>` routes, so pages only ever
 * deal with a slug. Authorization does not happen here: every page and server
 * function still scopes its queries with withTenant().
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPlatformPath(pathname)) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  const target = tenantFromHost(host, process.env.ROOT_DOMAIN ?? "localhost:3000");

  let slug: string | null = null;
  if (target.kind === "subdomain") slug = target.slug;
  if (target.kind === "custom") slug = await slugForDomain(target.domain);
  if (target.kind === "custom" && !slug) {
    return new NextResponse("Unknown domain", { status: 404 });
  }
  if (!slug) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/b/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
