"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

const REFRESH_MS = 45_000;

/**
 * The customer's scannable code. Tokens last 60 seconds, so this fetches a
 * fresh one every 45 seconds and whenever the page comes back into view
 * (phones pause background tabs).
 */
export function CardQr({ slug }: { slug: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      clearTimeout(timer);
      try {
        const res = await fetch(`/b/${slug}/card-token`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { token } = (await res.json()) as { token: string };
        const next = await QRCode.toString(token, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
        if (!cancelled) {
          setSvg(next);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(refresh, REFRESH_MS);
    }

    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  return (
    <div className="flex flex-col items-center gap-2">
      {/* An element can't have both children and dangerouslySetInnerHTML, so
          the code and its placeholder are separate elements. */}
      {svg ? (
        <div
          className="aspect-square w-56 rounded-2xl bg-white p-3 shadow-inner [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label="Your card's code for staff to scan"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex aspect-square w-56 items-center justify-center rounded-2xl bg-white p-3 shadow-inner">
          <span className="text-sm text-zinc-500">{failed ? "Couldn't load your code" : "Loading your code…"}</span>
        </div>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {failed ? "Check your connection. We'll keep trying." : "Show this to staff to get a punch. It refreshes every minute."}
      </p>
    </div>
  );
}
