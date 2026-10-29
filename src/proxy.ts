import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import { isPlatformPath, tenantFromHost } from "@/lib/tenant-host";

// Tenant lookups are cached briefly per process. Misses expire quickly so a
// business is reachable within seconds of being created.
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 5_000;
const slugCache = new Map<string, { live: boolean; expires: number }>();
const domainCache = new Map<string, { slug: string | null; expires: number }>();

async function slugIsLive(slug: string): Promise<boolean> {
  const hit = slugCache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.live;
  const tenant = await resolveTenant({ slug });
  const live = Boolean(tenant && tenant.status !== "deleted");
  slugCache.set(slug, { live, expires: Date.now() + (live ? HIT_TTL_MS : MISS_TTL_MS) });
  return live;
}

async function slugForDomain(domain: string): Promise<string | null> {
  const hit = domainCache.get(domain);
  if (hit && hit.expires > Date.now()) return hit.slug;
  const tenant = await resolveTenant({ domain });
  const slug = tenant && tenant.status !== "deleted" ? tenant.slug : null;
  domainCache.set(domain, { slug, expires: Date.now() + (slug ? HIT_TTL_MS : MISS_TTL_MS) });
  return slug;
}

// Streaming pages cannot change their status code once rendering starts, so
// unknown businesses get their 404 here, before the page renders.
function businessNotFound(request: NextRequest) {
  return NextResponse.rewrite(new URL("/business-not-found", request.url), { status: 404 });
}

/**
 * Maps tenant hosts onto the internal `/b/<slug>` routes, so pages only ever
 * deal with a slug. Authorization does not happen here: every page and server
 * function still scopes its queries with withTenant().
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Optimistic: no session cookie means straight to sign-in. The pages still
  // verify the session itself, since a cookie can be stale or forged.
  if (/^\/(dashboard|onboarding)(\/|$)/.test(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const direct = pathname.match(/^\/b\/([^/]+)/);
  if (direct) {
    return (await slugIsLive(direct[1].toLowerCase())) ? NextResponse.next() : businessNotFound(request);
  }
  if (isPlatformPath(pathname)) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  const target = tenantFromHost(host, process.env.ROOT_DOMAIN ?? "localhost:3000");
  if (target.kind === "root") return NextResponse.next();

  const slug = target.kind === "subdomain" ? target.slug : await slugForDomain(target.domain);
  if (!slug || !(await slugIsLive(slug))) return businessNotFound(request);

  const url = request.nextUrl.clone();
  url.pathname = `/b/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
