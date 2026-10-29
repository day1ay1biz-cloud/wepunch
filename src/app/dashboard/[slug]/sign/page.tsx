import { eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { getActiveProgram } from "@/lib/program";
import { DEFAULT_BRAND_COLOR, textColorOn } from "@/lib/program-rules";
import { joinUrl, qrSvg } from "@/lib/qr";
import { requireBusinessAccess } from "@/lib/session";

export const metadata = { title: "Counter sign · wepunch" };

export default function SignPage({ params }: PageProps<"/dashboard/[slug]/sign">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 print:m-0 print:max-w-none print:p-0">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Sign params={params} />
      </Suspense>
    </main>
  );
}

async function Sign({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { businessId, role } = await requireBusinessAccess(slug);

  const [biz] = await withTenant({ businessId }, (tx) => tx.select().from(business).where(eq(business.id, businessId)));
  const card = await getActiveProgram(businessId);

  const back = (
    <Link href={`/dashboard/${slug}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
      ← {biz.name}
    </Link>
  );

  if (!card) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Counter sign</h1>
        <p className="text-zinc-600 dark:text-zinc-400">The sign shows your card&apos;s reward, so design the card first.</p>
        {role === "owner" && (
          <Link href={`/dashboard/${slug}/card`} className="w-fit rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Design your card
          </Link>
        )}
      </div>
    );
  }

  const url = joinUrl(biz.slug);
  const qr = await qrSvg(url);
  const brand = biz.brandColor ?? DEFAULT_BRAND_COLOR;
  const onBrand = textColorOn(brand);
  const shortUrl = url.replace(/^https?:\/\//, "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        {back}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Counter sign</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Print it on US Letter paper and put it by the register. Customers scan the code to join your card. Choose
            &ldquo;Save as PDF&rdquo; in the print window to get a PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <PrintButton>Print or save as PDF</PrintButton>
          <a href={`/dashboard/${slug}/sign/qr`} className="text-sm font-medium underline">
            Download QR code (SVG)
          </a>
          <a href={`/dashboard/${slug}/sign/qr?format=png`} className="text-sm font-medium underline">
            PNG
          </a>
        </div>
      </div>

      {/* The sheet: a scaled preview on screen, exactly one Letter page in print.
          Text is sized in cqw (percent of the sheet's width) so both match. */}
      <article
        className="@container mx-auto flex aspect-[8.5/11] w-full max-w-[8.5in] flex-col overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-lg print:aspect-auto print:h-[11in] print:w-[8.5in] print:max-w-none print:border-0 print:shadow-none"
        style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      >
        <header className="px-[8%] py-[6%] text-center" style={{ backgroundColor: brand, color: onBrand }}>
          <p className="text-[4.2cqw] font-semibold tracking-tight">{biz.name}</p>
          <p className="mt-1 text-[2.4cqw] opacity-90">{card.name}</p>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-[3%] px-[8%] text-center">
          <h2 className="text-[6cqw] font-bold leading-tight tracking-tight">
            Get your free punch card
          </h2>
          <p className="text-[2.8cqw] text-zinc-700">
            Collect {card.punchesRequired} punches for <span className="font-semibold text-zinc-900">{card.rewardText}</span>
          </p>
          <div
            className="w-[52%] [&>svg]:h-auto [&>svg]:w-full"
            role="img"
            aria-label={`QR code linking to ${shortUrl}`}
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="text-[2.6cqw] font-medium">Scan with your phone camera</p>
          {card.punchOnJoin && (
            <p className="text-[2.3cqw] text-zinc-700">Your first punch is on us</p>
          )}
        </div>

        <footer className="flex items-end justify-between px-[6%] pb-[4%] text-[1.5cqw] text-zinc-500">
          <span>
            No app needed. Or visit <span className="font-medium text-zinc-700">{shortUrl}</span>
          </span>
          <span>wepunch</span>
        </footer>
      </article>
    </div>
  );
}
