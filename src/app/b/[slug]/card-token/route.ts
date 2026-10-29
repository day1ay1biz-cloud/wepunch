import { signCardToken } from "@/lib/card-token";
import { currentCustomerId } from "@/lib/customer-session";
import { getCustomerCard } from "@/lib/enrollment";
import { resolveTenant } from "@/lib/tenant";

// A fresh 60-second token for the signed-in customer's card at this business.
// The card page fetches one about every 45 seconds and draws it as a QR code.
export async function GET(_request: Request, { params }: RouteContext<"/b/[slug]/card-token">) {
  const { slug } = await params;
  const noStore = { "cache-control": "private, no-store" };

  const customerId = await currentCustomerId();
  if (!customerId) return Response.json({ error: "signed_out" }, { status: 401, headers: noStore });

  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") return Response.json({ error: "not_found" }, { status: 404, headers: noStore });

  const card = await getCustomerCard(tenant.id, customerId);
  if (!card) return Response.json({ error: "no_card" }, { status: 404, headers: noStore });

  return Response.json({ ...signCardToken(card.cardId, tenant.id), punches: card.punches }, { headers: noStore });
}
