"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import { actionEmail, sendEmail } from "@/lib/email";
import { requireBusinessAccess } from "@/lib/session";
import { createInvite, inviteSchema, resendInvite, revokeInvite, setStaffActive } from "@/lib/team";

export type InviteFormState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string> };

async function requireOwner(slug: string) {
  const access = await requireBusinessAccess(slug);
  if (access.role !== "owner") throw new Error("Only owners can manage the team");
  return access;
}

async function sendInviteEmail(businessId: string, to: string, token: string, role: string) {
  const [biz] = await withTenant({ businessId }, (tx) => tx.select({ name: business.name }).from(business).where(eq(business.id, businessId)));
  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return sendEmail(
    actionEmail({
      to,
      subject: `${biz.name} invited you to wepunch`,
      intro: `${biz.name} invited you to join their wepunch account as ${role === "owner" ? "an owner" : "staff"}, so you can punch and redeem customer cards. This link works for 7 days.`,
      action: "Accept invite",
      url: `${appUrl}/invite/${token}`,
    }),
  );
}

export async function inviteAction(slug: string, _prev: InviteFormState, form: FormData): Promise<InviteFormState> {
  const { user, businessId } = await requireOwner(slug);
  const parsed = inviteSchema.safeParse({
    email: form.get("email"),
    role: form.get("role"),
    locationIds: form.getAll("locationIds").map(String),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }

  const result = await createInvite(businessId, user.id, parsed.data);
  if (!result.ok) return { fieldErrors: { [result.field]: result.message } };

  const sent = await sendInviteEmail(businessId, result.email, result.token, parsed.data.role);
  revalidatePath(`/dashboard/${slug}/team`);
  return sent
    ? { ok: true, message: `Invite sent to ${result.email}.` }
    : { ok: true, message: `Invite saved, but the email to ${result.email} didn't send. Use Resend to try again.` };
}

export async function resendInviteAction(slug: string, inviteId: string) {
  const { user, businessId } = await requireOwner(slug);
  const fresh = await resendInvite(businessId, user.id, inviteId);
  if (fresh) await sendInviteEmail(businessId, fresh.email, fresh.token, fresh.role);
  revalidatePath(`/dashboard/${slug}/team`);
}

export async function revokeInviteAction(slug: string, inviteId: string) {
  const { user, businessId } = await requireOwner(slug);
  await revokeInvite(businessId, user.id, inviteId);
  revalidatePath(`/dashboard/${slug}/team`);
}

export async function setStaffActiveAction(slug: string, membershipId: string, active: boolean) {
  const { user, businessId } = await requireOwner(slug);
  await setStaffActive(businessId, user.id, membershipId, active);
  revalidatePath(`/dashboard/${slug}/team`);
}
