// Business helpers that run in the browser too: no database imports here.

// Slugs become `<slug>.wepunch.com` and `/b/<slug>`, so platform words are off limits.
const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "dashboard", "b", "help", "support", "status", "mail",
  "blog", "docs", "billing", "monitoring", "staging", "sign-in", "sign-up", "wepunch",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

/** "Joe's Coffee & Co." → "joes-coffee-co" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** Null when the slug is usable, otherwise a message for the owner. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters";
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, numbers and dashes, not starting or ending with a dash";
  if (RESERVED_SLUGS.has(slug)) return "That address is reserved";
  return null;
}
