import { ImageResponse } from "next/og";
import { textColorOn } from "@/lib/program-rules";
import { publicBusiness } from "@/lib/public-business";

const SIZES = new Set([180, 192, 512]);

// Home-screen icon: the business's first letter on its brand colour.
// /b/<slug>/icon?size=192 (180 for iPhone, 192 and 512 for Android)
export async function GET(request: Request, { params }: RouteContext<"/b/[slug]/icon">) {
  const { slug } = await params;
  const biz = await publicBusiness(slug);
  if (!biz) return new Response("Not found", { status: 404 });

  const requested = Number(new URL(request.url).searchParams.get("size"));
  const size = SIZES.has(requested) ? requested : 192;
  const letter = (biz.name.match(/[A-Za-z0-9]/)?.[0] ?? "W").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: biz.brandColor,
          color: textColorOn(biz.brandColor),
          fontSize: size * 0.55,
          fontWeight: 700,
        }}
      >
        {letter}
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=3600" } },
  );
}
