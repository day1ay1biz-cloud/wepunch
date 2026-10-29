"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Link between sign-in and sign-up that keeps ?next= (e.g. back to an invite). */
export function AuthSwitchLink({ href, children }: { href: "/sign-in" | "/sign-up"; children: React.ReactNode }) {
  const next = useSearchParams().get("next");
  return (
    <Link
      href={next ? `${href}?next=${encodeURIComponent(next)}` : href}
      className="font-medium text-zinc-900 underline dark:text-zinc-100"
    >
      {children}
    </Link>
  );
}
