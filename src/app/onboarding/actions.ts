"use server";

import { redirect } from "next/navigation";
import { createBusiness, createBusinessSchema } from "@/lib/business";
import { requireUser } from "@/lib/session";

export type OnboardingState = {
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

export async function createBusinessAction(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const user = await requireUser();
  const fields = ["name", "slug", "timezone", "locationName", "address"] as const;
  const values = Object.fromEntries(fields.map((f) => [f, String(form.get(f) ?? "")]));

  const parsed = createBusinessSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }

  const result = await createBusiness(user.id, parsed.data);
  if (!result.ok) return { fieldErrors: { [result.field]: result.message }, values };

  redirect(`/dashboard/${result.slug}`);
}
