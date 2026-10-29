import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { DEFAULT_BRAND_COLOR } from "@/lib/program-rules";
import { resolveTenant } from "@/lib/tenant";

/** Name and colour of a live business, for public assets like icons. */
export async function publicBusiness(slug: string) {
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") return null;
  const [biz] = await withTenant({ businessId: tenant.id }, (tx) =>
    tx.select({ name: business.name, brandColor: business.brandColor }).from(business).where(eq(business.id, tenant.id)),
  );
  return { slug, name: biz.name, brandColor: biz.brandColor ?? DEFAULT_BRAND_COLOR };
}
