"use client";

import { startTransition, useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { US_TIMEZONES } from "@/lib/business-client";
import type { LocationFormState } from "./actions";

type Values = { name: string; address: string; timezone: string };

type Props = {
  initial: Values;
  action: (prev: LocationFormState, form: FormData) => Promise<LocationFormState>;
  submitLabel: string;
  // Edit mode only: removes the location.
  archive?: () => Promise<LocationFormState>;
  // Add mode clears the fields after a successful save.
  clearOnSuccess?: boolean;
};

export function LocationForm({ initial, action, submitLabel, archive, clearOnSuccess }: Props) {
  const [values, setValues] = useState(initial);
  const [archiveState, setArchiveState] = useState<LocationFormState>({});
  const [state, formAction, pending] = useActionState<LocationFormState, FormData>(async (prev, form) => {
    const next = await action(prev, form);
    if (next.ok && clearOnSuccess) setValues(initial);
    return next;
  }, {});
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const errors = state.fieldErrors ?? {};
  const message = archiveState.message ?? state.message;
  const ok = archiveState.message ? archiveState.ok : state.ok;

  return (
    // Submitted from onSubmit (not the action prop) so React doesn't reset the
    // fields after saving an edit.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setArchiveState({});
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-3"
    >
      <FormMessage message={message} tone={ok ? "info" : "error"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" required value={values.name} onChange={set("name")} error={errors.name} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Time zone</span>
          <select
            name="timezone"
            value={values.timezone}
            onChange={set("timezone")}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          >
            {US_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field label="Address (optional)" name="address" value={values.address} onChange={set("address")} error={errors.address} />
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {archive && (
          <button
            type="button"
            className="text-sm text-zinc-600 underline hover:text-red-700 dark:text-zinc-400"
            onClick={() => {
              if (!confirm(`Remove ${initial.name}? Staff can no longer be assigned to it. Past punches there are kept.`)) return;
              startTransition(async () => setArchiveState(await archive()));
            }}
          >
            Remove location
          </button>
        )}
      </div>
    </form>
  );
}
