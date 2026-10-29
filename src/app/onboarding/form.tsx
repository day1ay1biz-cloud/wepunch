"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Field, FormMessage } from "@/components/ui";
import { slugify, US_TIMEZONES } from "@/lib/business-client";
import { createBusinessAction, type OnboardingState } from "./actions";

export function OnboardingForm({ rootDomain }: { rootDomain: string }) {
  const [state, action] = useActionState<OnboardingState, FormData>(createBusinessAction, {});
  const [name, setName] = useState(state.values?.name ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.slug));

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage message={state.message} />
      <Field
        label="Business name"
        name="name"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
        error={state.fieldErrors?.name}
      />
      <Field
        label="Web address"
        name="slug"
        required
        value={slug}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(e.target.value.toLowerCase());
        }}
        hint={`${slug || "your-business"}.${rootDomain}`}
        error={state.fieldErrors?.slug}
      />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Time zone</span>
        <select
          name="timezone"
          defaultValue={state.values?.timezone ?? "America/New_York"}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {US_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
        {state.fieldErrors?.timezone && <span className="text-red-600">{state.fieldErrors.timezone}</span>}
      </label>
      <Field
        label="Location name"
        name="locationName"
        placeholder="Main Street"
        defaultValue={state.values?.locationName}
        hint="You can add more locations later"
      />
      <Field label="Address (optional)" name="address" autoComplete="street-address" defaultValue={state.values?.address} />
      <SubmitButton pendingText="Creating…">Create business</SubmitButton>
    </form>
  );
}
