"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { acceptInvite } from "@/lib/team";

export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  const result = await acceptInvite(token, user);
  // The page explains every failure; reloading it shows the current state.
  redirect(result.ok ? `/dashboard/${result.businessSlug}` : `/invite/${token}`);
}
