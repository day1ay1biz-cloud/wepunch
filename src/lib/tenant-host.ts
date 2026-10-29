// Pure host parsing, shared by proxy.ts and tests. No database access here.

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "dashboard"]);

export type HostTenant =
  | { kind: "root" }
  | { kind: "subdomain"; slug: string }
  | { kind: "custom"; domain: string };

/**
 * Decides how a request host maps to a tenant:
 * - `wepunch.com`, `www.wepunch.com`, `app.wepunch.com` → root (slug comes from `/b/<slug>`)
 * - `joes-coffee.wepunch.com` → subdomain tenant
 * - any other host → a business's custom domain
 */
export function tenantFromHost(host: string, rootDomain: string): HostTenant {
  const h = host.toLowerCase().trim();
  const root = rootDomain.toLowerCase().trim();
  if (!h || h === root) return { kind: "root" };

  if (h.endsWith(`.${root}`)) {
    const sub = h.slice(0, -(root.length + 1));
    // Only one label deep; nested subdomains are not tenants.
    if (sub.includes(".") || RESERVED_SUBDOMAINS.has(sub)) return { kind: "root" };
    return { kind: "subdomain", slug: sub };
  }

  // Strip a port, so `loyalty.joescoffee.com:443` matches the stored domain.
  return { kind: "custom", domain: h.replace(/:\d+$/, "") };
}

/** Paths served by the platform itself, never rewritten into a tenant. */
export function isPlatformPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/b/") ||
    // Sentry's browser tunnel (next.config.ts tunnelRoute)
    pathname === "/monitoring" ||
    pathname.startsWith("/monitoring/") ||
    pathname === "/favicon.ico"
  );
}
