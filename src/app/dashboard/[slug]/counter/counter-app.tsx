"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { PunchCard } from "@/components/punch-card";
import type { ActivityItem, CardSummary, CustomerMatch } from "@/lib/counter";
import { activityAction, punchAction, redeemAction, scanAction, searchAction, selectCustomerAction, undoAction } from "./actions";
import { Scanner } from "./scanner";

type Props = {
  slug: string;
  businessName: string;
  brandColor: string;
  userId: string;
  role: "owner" | "staff";
  locations: { id: string; name: string }[];
  initialActivity: ActivityItem[];
};

const noSubscribe = () => () => {};
const big = "rounded-xl px-4 py-3.5 text-base font-semibold disabled:opacity-50";

export function CounterApp({ slug, businessName, brandColor, userId, role, locations, initialActivity }: Props) {
  // The location is remembered per device. Read through useSyncExternalStore so
  // the server render (no localStorage) and the browser agree.
  const storageKey = `wp-counter-location:${slug}`;
  const saved = useSyncExternalStore(
    noSubscribe,
    () => localStorage.getItem(storageKey),
    () => null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const valid = (id: string | null) => (id && locations.some((l) => l.id === id) ? id : null);
  const locationId = valid(picked) ?? valid(saved) ?? locations[0]?.id ?? "";
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[] | null>(null);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  // The code just scanned; sent with the first action so it can't be reused.
  const [token, setToken] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [banner, setBanner] = useState<{ tone: "ok" | "error" | "party"; text: string } | null>(null);
  const [activity, setActivity] = useState(initialActivity);
  const [pending, startTransition] = useTransition();

  const pickLocation = (id: string) => {
    setPicked(id);
    localStorage.setItem(storageKey, id);
  };

  const reset = () => {
    setSummary(null);
    setToken(null);
    setMatches(null);
    setQuery("");
    setCount(1);
  };

  const onCode = useCallback(
    (text: string) => {
      setScanning(false);
      startTransition(async () => {
        const res = await scanAction(slug, text);
        if (!res.ok) return setBanner({ tone: "error", text: res.message });
        setBanner(null);
        setMatches(null);
        setSummary(res.summary);
        setToken(text);
        setCount(1);
      });
    },
    [slug],
  );

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const found = await searchAction(slug, query);
      setMatches(found);
      setBanner(found.length ? null : { tone: "error", text: "No customer with a card here matches that." });
    });
  };

  const choose = (customerId: string) =>
    startTransition(async () => {
      setSummary(await selectCustomerAction(slug, customerId));
      setToken(null);
      setMatches(null);
      setCount(1);
    });

  const doPunch = () =>
    startTransition(async () => {
      if (!summary) return;
      const res = await punchAction(slug, { cardId: summary.cardId, count, token: token ?? undefined, clientEventId: crypto.randomUUID(), locationId });
      setToken(null);
      if (!res.ok) return setBanner({ tone: "error", text: res.message });
      setBanner({ tone: res.celebrate ? "party" : "ok", text: res.message });
      setSummary(res.summary);
      setCount(1);
      setActivity(await activityAction(slug));
    });

  const doRedeem = () =>
    startTransition(async () => {
      if (!summary) return;
      const res = await redeemAction(slug, { customerId: summary.customerId, token: token ?? undefined, locationId });
      setToken(null);
      if (!res.ok) return setBanner({ tone: "error", text: res.message });
      setBanner({ tone: "ok", text: res.message });
      setSummary(res.summary);
      setActivity(await activityAction(slug));
    });

  const undo = (item: ActivityItem) =>
    startTransition(async () => {
      const res = await undoAction(slug, { kind: item.kind, id: item.id });
      setBanner({ tone: res.ok ? "ok" : "error", text: res.message });
      setActivity(res.activity);
      if (res.ok && summary) setSummary(await selectCustomerAction(slug, summary.customerId));
    });

  // Owners can undo anything; staff their own actions. The server enforces the
  // time limits (24 hours, or 10 minutes for staff) and says when it's too late.
  const canUndo = (item: ActivityItem) => !item.undone && (role === "owner" || item.staffUserId === userId);

  const bannerColor = {
    ok: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
    party: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    error: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  };

  return (
    <div className="flex flex-col gap-6">
      {locations.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Location</span>
          <select
            value={locationId}
            onChange={(e) => pickLocation(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {banner && (
        <p role="status" className={`rounded-xl px-4 py-3 font-medium ${bannerColor[banner.tone]}`}>
          {banner.text}
        </p>
      )}

      {!summary &&
        (scanning ? (
          <Scanner onCode={onCode} onClose={() => setScanning(false)} />
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                setScanning(true);
              }}
              className={`${big} bg-zinc-900 py-6 text-lg text-white dark:bg-zinc-100 dark:text-zinc-900`}
            >
              Scan customer&apos;s card
            </button>
            <form onSubmit={search} className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                inputMode="search"
                placeholder="Last 4 of phone, or email"
                aria-label="Find a customer by phone or email"
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button disabled={pending || query.trim().length < 3} className={`${big} border border-zinc-300 dark:border-zinc-700`}>
                Find
              </button>
            </form>
            {matches && matches.length > 0 && (
              <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {matches.map((m) => (
                  <li key={m.customerId}>
                    <button type="button" onClick={() => choose(m.customerId)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                      <span>
                        <span className="font-medium">{m.name}</span> <span className="text-sm text-zinc-500">{m.contact}</span>
                      </span>
                      <span className="text-sm text-zinc-500">
                        {m.punches}/{m.punchesRequired}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {summary && (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">
              {summary.name} <span className="text-sm font-normal text-zinc-500">{summary.contact}</span>
            </h2>
            <button type="button" onClick={reset} className="text-sm underline">
              Next customer
            </button>
          </div>
          <PunchCard
            businessName={businessName}
            cardName={summary.cardName}
            rewardText={summary.rewardText}
            punchesRequired={summary.punchesRequired}
            punches={summary.punches}
            brandColor={brandColor}
          />
          <div className="flex items-center gap-3">
            {summary.maxPunchesPerVisit > 1 && (
              <div className="flex items-center rounded-xl border border-zinc-300 dark:border-zinc-700" aria-label="Punches to add">
                <button type="button" onClick={() => setCount((c) => Math.max(1, c - 1))} className="px-4 py-3 text-lg" aria-label="One fewer">
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold">{count}</span>
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.min(summary.maxPunchesPerVisit, c + 1))}
                  className="px-4 py-3 text-lg"
                  aria-label="One more"
                >
                  +
                </button>
              </div>
            )}
            <button type="button" disabled={pending} onClick={doPunch} className={`${big} flex-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`}>
              {pending ? "Working…" : count === 1 ? "Punch" : `Punch ×${count}`}
            </button>
          </div>
          {summary.rewardsAvailable > 0 && (
            <button type="button" disabled={pending} onClick={doRedeem} className={`${big} bg-amber-400 text-zinc-900`}>
              Redeem {summary.rewardText}
              {summary.rewardsAvailable > 1 ? ` (${summary.rewardsAvailable} ready)` : ""}
            </button>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Recent</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing in the last 24 hours.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {activity.map((item) => (
              <li key={`${item.kind}-${item.id}`} className={`flex items-center justify-between gap-2 px-4 py-2.5 ${item.undone ? "opacity-50" : ""}`}>
                <span>
                  <span className="font-medium">{item.customerName}</span> · {item.detail}
                  <span className="block text-xs text-zinc-500">
                    {new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {item.staffName ? ` · ${item.staffName}` : ""}
                    {item.undone ? " · undone" : ""}
                  </span>
                </span>
                {canUndo(item) && (
                  <button type="button" disabled={pending} onClick={() => undo(item)} className="text-sm underline">
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
