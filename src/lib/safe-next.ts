/**
 * Where to go after signing in or confirming email. Only same-site paths are
 * allowed, so a crafted link can't bounce someone to another website.
 */
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  return /^\/(?![/\\])[\w\-./?=&%]*$/.test(next) ? next : "/dashboard";
}
