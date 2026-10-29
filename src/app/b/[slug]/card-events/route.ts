import { subscribeCardActivity } from "@/lib/card-events";
import { currentCustomerId } from "@/lib/customer-session";
import { resolveTenant } from "@/lib/tenant";

const HEARTBEAT_MS = 25_000;

// Server-sent events for the signed-in customer's card at this business: an
// "update" event whenever staff punch or redeem, so the card refreshes live.
export async function GET(request: Request, { params }: RouteContext<"/b/[slug]/card-events">) {
  const { slug } = await params;
  const customerId = await currentCustomerId();
  if (!customerId) return new Response("Signed out", { status: 401 });
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      // Reconnect after 5 s if the connection drops; the comment opens the stream.
      send("retry: 5000\n: connected\n\n");
      const unsubscribe = subscribeCardActivity((event) => {
        if (event.customerId === customerId && event.businessId === tenant.id) send("event: update\ndata: {}\n\n");
      });
      // Keeps proxies from closing an idle connection.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
