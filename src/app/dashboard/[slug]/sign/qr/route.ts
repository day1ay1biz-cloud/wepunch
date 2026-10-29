import { joinUrl, qrPng, qrSvg } from "@/lib/qr";
import { requireBusinessAccess } from "@/lib/session";

// The join QR code on its own, for owners who design their own signage.
// /dashboard/<slug>/sign/qr (SVG) or ?format=png
export async function GET(request: Request, { params }: RouteContext<"/dashboard/[slug]/sign/qr">) {
  const { slug } = await params;
  await requireBusinessAccess(slug);

  const url = joinUrl(slug);
  const png = new URL(request.url).searchParams.get("format") === "png";
  const body = png ? new Uint8Array(await qrPng(url, 1200)) : await qrSvg(url);

  return new Response(body, {
    headers: {
      "content-type": png ? "image/png" : "image/svg+xml",
      "content-disposition": `attachment; filename="${slug}-qr.${png ? "png" : "svg"}"`,
      "cache-control": "private, no-store",
    },
  });
}
