"use server";

import { revalidatePath } from "next/cache";
import { addLocation, archiveLocation, locationSchema, updateLocation, type LocationResult } from "@/lib/locations";
import { requireBusinessAccess } from "@/lib/session";

export type LocationFormState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string> };

async function requireOwner(slug: string) {
  const access = await requireBusinessAccess(slug);
  if (access.role !== "owner") throw new Error("Only owners can manage locations");
  return access;
}

function parse(form: FormData) {
  return locationSchema.safeParse({
    name: form.get("name") ?? "",
    address: form.get("address") ?? "",
    timezone: form.get("timezone") ?? "",
  });
}

function toState(result: LocationResult, success: string, slug: string): LocationFormState {
  if (!result.ok) return result.field === "form" ? { message: result.message } : { fieldErrors: { [result.field]: result.message } };
  revalidatePath(`/dashboard/${slug}/locations`);
  return { ok: true, message: success };
}

function invalid(error: import("zod").ZodError): LocationFormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { fieldErrors };
}

export async function addLocationAction(slug: string, _prev: LocationFormState, form: FormData): Promise<LocationFormState> {
  const { user, businessId } = await requireOwner(slug);
  const parsed = parse(form);
  if (!parsed.success) return invalid(parsed.error);
  return toState(await addLocation(businessId, user.id, parsed.data), `${parsed.data.name} added.`, slug);
}

export async function updateLocationAction(slug: string, locationId: string, _prev: LocationFormState, form: FormData): Promise<LocationFormState> {
  const { user, businessId } = await requireOwner(slug);
  const parsed = parse(form);
  if (!parsed.success) return invalid(parsed.error);
  return toState(await updateLocation(businessId, user.id, locationId, parsed.data), "Saved.", slug);
}

export async function archiveLocationAction(slug: string, locationId: string): Promise<LocationFormState> {
  const { user, businessId } = await requireOwner(slug);
  return toState(await archiveLocation(businessId, user.id, locationId), "Location removed.", slug);
}
