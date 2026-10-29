"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the card page when staff punch or redeem (server-sent events). */
export function LiveRefresh({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    const events = new EventSource(`/b/${slug}/card-events`);
    events.addEventListener("update", () => router.refresh());
    return () => events.close();
  }, [slug, router]);
  return null;
}
