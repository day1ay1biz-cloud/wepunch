"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

export type FormState = {
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});

const signInSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") };
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const next = safeNext(form.get("next"));

  try {
    await getAuth().api.signUpEmail({
      body: { ...parsed.data, callbackURL: next },
      headers: await headers(),
    });
  } catch (err) {
    if (isAPIError(err) && err.status === "UNPROCESSABLE_ENTITY") {
      return { message: "An account with this email already exists. Sign in instead.", values };
    }
    throw err;
  }
  redirect("/check-email");
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const next = safeNext(form.get("next"));

  try {
    await getAuth().api.signInEmail({
      body: { ...parsed.data, callbackURL: next },
      headers: await headers(),
    });
  } catch (err) {
    if (isAPIError(err) && err.status === "FORBIDDEN") {
      return { message: "Confirm your email first. We just sent you a new link.", values };
    }
    if (isAPIError(err) && err.status === "UNAUTHORIZED") {
      return { message: "That email and password don't match.", values };
    }
    throw err;
  }
  redirect(next);
}

export async function signOutAction(form?: FormData) {
  await getAuth().api.signOut({ headers: await headers() });
  const next = form?.get("next");
  redirect(next ? `/sign-in?next=${encodeURIComponent(safeNext(next))}` : "/sign-in");
}
