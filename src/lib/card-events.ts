import postgres from "postgres";

// Fan-out of "a customer's card changed" events to open customer screens.
// Punches and redemptions call pg_notify('card_activity', …) inside their
// transaction; Postgres delivers it on commit to every app machine, so this
// works with several web machines and no Redis. One LISTEN connection per
// process feeds all subscribers.

export type CardActivity = { businessId: string; customerId: string };
type Listener = (event: CardActivity) => void;

const g = globalThis as unknown as { cardEvents?: { listeners: Set<Listener> } };

function hub() {
  if (!g.cardEvents) {
    const listeners = new Set<Listener>();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // postgres.js re-subscribes automatically if this connection drops.
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    sql
      .listen("card_activity", (payload) => {
        let event: CardActivity;
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        for (const listener of listeners) listener(event);
      })
      .catch((err) => console.error("card_activity listen failed:", err));
    g.cardEvents = { listeners };
  }
  return g.cardEvents;
}

/** Calls `fn` for every card change; returns the unsubscribe function. */
export function subscribeCardActivity(fn: Listener): () => void {
  const { listeners } = hub();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
