"use client";

import { startTransition, useActionState, useState } from "react";
import { PunchCard } from "@/components/punch-card";
import { Field, FormMessage } from "@/components/ui";
import type { ProgramInput } from "@/lib/program-rules";
import type { CardFormState } from "./actions";

const SWATCHES = ["#18181b", "#6b3e26", "#b91c1c", "#c2410c", "#15803d", "#0f766e", "#1d4ed8", "#7c3aed", "#be185d", "#facc15"];

type Props = {
  businessName: string;
  initial: ProgramInput;
  action: (prev: CardFormState, form: FormData) => Promise<CardFormState>;
};

export function CardDesigner({ businessName, initial, action }: Props) {
  const [state, formAction, pending] = useActionState<CardFormState, FormData>(action, {});
  const [card, setCard] = useState({
    name: initial.name,
    rewardText: initial.rewardText,
    punchesRequired: String(initial.punchesRequired),
    brandColor: initial.brandColor,
    // Every field is controlled and the form is submitted from onSubmit, not
    // the action prop: React resets forms after an action, which leaves a
    // controlled checkbox showing the wrong state.
    maxPunchesPerVisit: String(initial.maxPunchesPerVisit),
    minMinutesBetween: String(initial.minMinutesBetween),
    expiryDays: initial.expiryDays === null ? "" : String(initial.expiryDays),
    punchOnJoin: initial.punchOnJoin,
  });
  const set = (key: Exclude<keyof typeof card, "punchOnJoin">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCard((c) => ({ ...c, [key]: e.target.value }));

  const previewPunches = Number.parseInt(card.punchesRequired, 10);
  const errors = state.fieldErrors ?? {};

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="grid gap-8 md:grid-cols-[1fr_minmax(0,24rem)]"
    >
      <div className="flex flex-col gap-6">
        <FormMessage message={state.message} tone={state.ok ? "info" : "error"} />

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 font-semibold">The card</legend>
          <Field label="Card name" name="name" required maxLength={40} value={card.name} onChange={set("name")} error={errors.name} />
          <Field
            label="Reward"
            name="rewardText"
            required
            maxLength={80}
            value={card.rewardText}
            onChange={set("rewardText")}
            hint="What customers get when the card is full"
            error={errors.rewardText}
          />
          <Field
            label="Punches to earn the reward"
            name="punchesRequired"
            type="number"
            min={2}
            max={20}
            required
            value={card.punchesRequired}
            onChange={set("punchesRequired")}
            error={errors.punchesRequired}
          />
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Card colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use colour ${c}`}
                  aria-pressed={card.brandColor === c}
                  onClick={() => setCard((s) => ({ ...s, brandColor: c }))}
                  className="h-8 w-8 rounded-full border-2 border-white shadow ring-zinc-900 aria-pressed:ring-2 dark:border-zinc-900 dark:ring-zinc-100"
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="flex items-center gap-2">
                <input type="color" name="brandColor" value={card.brandColor} onChange={set("brandColor")} className="h-8 w-10 cursor-pointer rounded" />
                <span className="font-mono text-zinc-500">{card.brandColor}</span>
              </label>
            </div>
            {errors.brandColor && <span className="text-red-600">{errors.brandColor}</span>}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 font-semibold">Rules</legend>
          <Field
            label="Most punches per visit"
            name="maxPunchesPerVisit"
            type="number"
            min={1}
            max={10}
            required
            value={card.maxPunchesPerVisit}
            onChange={set("maxPunchesPerVisit")}
            hint="Lets staff punch more than once for a big order"
            error={errors.maxPunchesPerVisit}
          />
          <Field
            label="Minutes between punches"
            name="minMinutesBetween"
            type="number"
            min={0}
            max={1440}
            required
            value={card.minMinutesBetween}
            onChange={set("minMinutesBetween")}
            hint="Stops the same customer being punched twice in a row. 0 turns it off"
            error={errors.minMinutesBetween}
          />
          <Field
            label="Cards expire after (days)"
            name="expiryDays"
            type="number"
            min={30}
            max={730}
            value={card.expiryDays}
            onChange={set("expiryDays")}
            placeholder="Never"
            hint="Leave empty so cards never expire"
            error={errors.expiryDays}
          />
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="punchOnJoin" checked={card.punchOnJoin}
              onChange={(e) => setCard((c) => ({ ...c, punchOnJoin: e.target.checked }))} className="mt-1 h-4 w-4" />
            <span>
              <span className="font-medium">First punch free when a customer joins</span>
              <span className="block text-zinc-500">A head start makes people more likely to come back</span>
            </span>
          </label>
        </fieldset>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? "Saving…" : "Save card"}
          </button>
        </div>
      </div>

      <aside className="flex flex-col items-center gap-3 md:sticky md:top-8 md:self-start">
        <p className="text-sm font-medium text-zinc-500">Preview</p>
        <PunchCard
          businessName={businessName}
          cardName={card.name}
          rewardText={card.rewardText}
          punchesRequired={Number.isFinite(previewPunches) ? Math.min(Math.max(previewPunches, 2), 20) : 10}
          punches={3}
          brandColor={/^#[0-9a-f]{6}$/i.test(card.brandColor) ? card.brandColor : "#18181b"}
        />
        <p className="text-xs text-zinc-500">Shown with 3 punches</p>
      </aside>
    </form>
  );
}
