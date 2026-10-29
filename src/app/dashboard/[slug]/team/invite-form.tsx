"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/ui";
import type { InviteFormState } from "./actions";

type Props = {
  locations: { id: string; name: string }[];
  action: (prev: InviteFormState, form: FormData) => Promise<InviteFormState>;
};

export function InviteForm({ locations, action }: Props) {
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(action, {});
  const [allLocations, setAllLocations] = useState(true);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage message={state.message} tone={state.ok ? "info" : "error"} />
      <Field label="Email" name="email" type="email" autoComplete="off" required error={errors.email} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Role</span>
        <select name="role" defaultValue="staff" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900">
          <option value="staff">Staff: punch and redeem cards</option>
          <option value="owner">Owner: everything, including the card and team</option>
        </select>
      </label>
      {locations.length > 1 && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">Locations</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allLocations} onChange={(e) => setAllLocations(e.target.checked)} />
            All locations
          </label>
          {!allLocations &&
            locations.map((l) => (
              <label key={l.id} className="ml-6 flex items-center gap-2">
                <input type="checkbox" name="locationIds" value={l.id} />
                {l.name}
              </label>
            ))}
        </fieldset>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}
