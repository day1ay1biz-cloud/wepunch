"use server";

import { programSchema, saveProgram } from "@/lib/program";
import { requireBusinessAccess } from "@/lib/session";

export type CardFormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const FIELDS = [
  "name",
  "rewardText",
  "punchesRequired",
  "brandColor",
  "maxPunchesPerVisit",
  "minMinutesBetween",
  "expiryDays",
  "punchOnJoin",
] as const;

// `slug` is bound by the page; access is re-checked here on every save.
export async function saveCardAction(slug: string, _prev: CardFormState, form: FormData): Promise<CardFormState> {
  const { user, businessId, role } = await requireBusinessAccess(slug);
  if (role !== "owner") return { message: "Only owners can change the card." };

  const parsed = programSchema.safeParse(Object.fromEntries(FIELDS.map((f) => [f, form.get(f) ?? undefined])));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, message: "Check the highlighted fields." };
  }

  const { created } = await saveProgram(businessId, user.id, parsed.data);
  return { ok: true, message: created ? "Card created. Customers will see it when they join." : "Card saved." };
}
