import { publicBusiness } from "@/lib/public-business";

// Per-business web app manifest, so "Add to Home Screen" saves this
// business's card (its name, colour and icon) and opens straight to it.
export async function GET(_request: Request, { params }: RouteContext<"/b/[slug]/manifest.webmanifest">) {
  const { slug } = await params;
  const biz = await publicBusiness(slug);
  if (!biz) return new Response("Not found", { status: 404 });

  const manifest = {
    name: `${biz.name} punch card`,
    short_name: biz.name.slice(0, 12),
    id: `/b/${slug}`,
    start_url: `/b/${slug}`,
    scope: `/b/${slug}`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: biz.brandColor,
    icons: [
      { src: `/b/${slug}/icon?size=192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/b/${slug}/icon?size=512`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  return Response.json(manifest, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
