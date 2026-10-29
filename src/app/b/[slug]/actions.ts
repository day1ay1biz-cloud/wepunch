"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db";
import { business } from "@/db/schema";
import {
  maskDestination,
  normalizeEmail,
  normalizeUsPhone,
  startChallenge,
  upsertVerifiedCustomer,
  verifyChallenge,
  type Channel,
} from "@/lib/customer-auth";
import { clientIp, currentCustomerId, signInCustomer, signOutCustomer } from "@/lib/customer-session";
import { joinCard } from "@/lib/enrollment";
import { resolveTenant } from "@/lib/tenant";

export type JoinState = {
  step: "contact" | "code";
  channel: Channel;
  // The normalized phone or email the code went to; it's the visitor's own input.
  destination?: string;
  masked?: string;
  contact?: string;
  error?: string;
  notice?: string;
};

async function liveBusiness(slug: string) {
  const tenant = await resolveTenant({ slug });
  if (!tenant || tenant.status === "deleted") throw new Error("Unknown business");
  const [biz] = await withTenant({ businessId: tenant.id }, (tx) =>
    tx.select({ id: business.id, name: business.name }).from(business).where(eq(business.id, tenant.id)),
  );
  return biz;
}

const asChannel = (v: FormDataEntryValue | null): Channel => (v === "email" ? "email" : "sms");

/** Step 1: send a code to the phone or email the visitor typed. */
async function requestCode(slug: string, prev: JoinState, form: FormData): Promise<JoinState> {
  const channel = asChannel(form.get("channel"));
  const contact = String(form.get("contact") ?? "");
  const destination = channel === "sms" ? normalizeUsPhone(contact) : normalizeEmail(contact);
  if (!destination) {
    return { step: "contact", channel, contact, error: channel === "sms" ? "Enter a US mobile number." : "Enter a valid email address." };
  }

  const biz = await liveBusiness(slug);
  const sent = await startChallenge({ channel, destination, ip: await clientIp(), businessName: biz.name });
  if (!sent.ok) return { step: prev.step === "code" ? "code" : "contact", channel, contact, destination: prev.destination, masked: prev.masked, error: sent.error };

  return {
    step: "code",
    channel,
    destination,
    contact,
    masked: maskDestination(channel, destination),
    notice: prev.step === "code" ? "We sent a new code." : undefined,
  };
}

/** Step 2: check the code, sign the visitor in on this device, and give them the card. */
async function verifyCode(slug: string, prev: JoinState, form: FormData): Promise<JoinState> {
  if (prev.step !== "code" || !prev.destination) return { step: "contact", channel: prev.channel };
  const result = await verifyChallenge({ channel: prev.channel, destination: prev.destination, code: String(form.get("code") ?? "") });
  if (!result.ok) return { ...prev, error: result.error, notice: undefined };

  const biz = await liveBusiness(slug);
  const customerId = await upsertVerifiedCustomer(prev.channel, prev.destination);
  await signInCustomer(customerId);
  await joinCard({
    businessId: biz.id,
    customerId,
    firstName: String(form.get("firstName") ?? "") || null,
    marketingSms: prev.channel === "sms" && form.get("marketing") === "on",
    marketingEmail: prev.channel === "email" && form.get("marketing") === "on",
    ip: await clientIp(),
  });
  redirect(`/b/${slug}`);
}

/**
 * The join form's one action. `intent` says which button was pressed:
 * send (first code), resend, change (back to the contact step) or verify.
 */
export async function joinFlowAction(slug: string, prev: JoinState, form: FormData): Promise<JoinState> {
  switch (form.get("intent")) {
    case "change":
      return { step: "contact", channel: prev.channel, contact: prev.contact };
    case "resend":
      return requestCode(slug, prev, (() => {
        const f = new FormData();
        f.set("channel", prev.channel);
        f.set("contact", prev.contact ?? prev.destination ?? "");
        return f;
      })());
    case "verify":
      return verifyCode(slug, prev, form);
    default:
      return requestCode(slug, prev, form);
  }
}

/** A customer already signed in on this device joins another business's card. */
export async function joinSignedInAction(slug: string, form: FormData) {
  const customerId = await currentCustomerId();
  if (!customerId) redirect(`/b/${slug}`);
  const biz = await liveBusiness(slug);
  const optIn = form.get("marketing") === "on";
  await joinCard({
    businessId: biz.id,
    customerId,
    firstName: String(form.get("firstName") ?? "") || null,
    // Offers go to whichever contact the customer signed in with.
    marketingSms: optIn && form.get("channel") === "sms",
    marketingEmail: optIn && form.get("channel") === "email",
    ip: await clientIp(),
  });
  redirect(`/b/${slug}`);
}

export async function customerSignOutAction(slug: string) {
  await signOutCustomer();
  redirect(`/b/${slug}`);
}
