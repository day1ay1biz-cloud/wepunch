"use client";

import { startTransition, useActionState, useState } from "react";
import type { JoinState } from "./actions";

type Props = {
  businessName: string;
  action: (prev: JoinState, form: FormData) => Promise<JoinState>;
};

const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-lg outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200";
const primary =
  "w-full rounded-xl bg-zinc-900 px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const linkButton = "text-sm text-zinc-600 underline dark:text-zinc-400";

/** Phone or email → one-time code → card. Designed for a phone at the counter. */
export function JoinForm({ businessName, action }: Props) {
  const [state, dispatch, pending] = useActionState<JoinState, FormData>(action, { step: "contact", channel: "sms" });
  const [channel, setChannel] = useState(state.channel);
  const [contact, setContact] = useState(state.contact ?? "");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [marketing, setMarketing] = useState(false);

  // Submitted from onSubmit so React doesn't reset the fields between steps.
  const submit = (intent: string) => (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const data = e ? new FormData(e.currentTarget) : new FormData();
    data.set("intent", intent);
    if (intent === "send") data.set("channel", channel);
    startTransition(() => dispatch(data));
  };

  if (state.step === "code") {
    return (
      <form onSubmit={submit("verify")} className="flex w-full flex-col gap-4">
        <p className="text-center text-zinc-700 dark:text-zinc-300">
          Enter the 6-digit code we sent to <span className="font-semibold">{state.masked}</span>
        </p>
        {state.notice && <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">{state.notice}</p>}
        <input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          aria-label="Code"
          aria-invalid={state.error ? true : undefined}
          className={`${input} text-center text-2xl tracking-[0.5em]`}
        />
        {state.error && <p className="text-center text-sm text-red-600">{state.error}</p>}
        <input
          name="firstName"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
          maxLength={40}
          placeholder="First name (optional)"
          aria-label="First name (optional)"
          className={input}
        />
        <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-5 w-5" />
          <span>
            {state.channel === "sms"
              ? `Text me offers from ${businessName}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`
              : `Email me offers from ${businessName}. Unsubscribe any time.`}
          </span>
        </label>
        <button type="submit" disabled={pending || code.length !== 6} className={primary}>
          {pending ? "Checking…" : "Get my card"}
        </button>
        <div className="flex justify-between">
          <button type="button" onClick={() => submit("change")()} className={linkButton}>
            {state.channel === "sms" ? "Use a different number" : "Use a different email"}
          </button>
          <button type="button" disabled={pending} onClick={() => submit("resend")()} className={linkButton}>
            Send a new code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit("send")} className="flex w-full flex-col gap-4">
      <div role="radiogroup" aria-label="How should we send your code?" className="grid grid-cols-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(["sms", "email"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={channel === c}
            onClick={() => {
              setChannel(c);
              setContact("");
            }}
            className="rounded-lg py-2 text-sm font-medium text-zinc-600 aria-checked:bg-white aria-checked:text-zinc-900 aria-checked:shadow dark:text-zinc-400 dark:aria-checked:bg-zinc-950 dark:aria-checked:text-zinc-100"
          >
            {c === "sms" ? "Phone" : "Email"}
          </button>
        ))}
      </div>
      <input
        name="contact"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        type={channel === "sms" ? "tel" : "email"}
        inputMode={channel === "sms" ? "tel" : "email"}
        autoComplete={channel === "sms" ? "tel-national" : "email"}
        placeholder={channel === "sms" ? "(480) 555-0123" : "you@example.com"}
        aria-label={channel === "sms" ? "Mobile number" : "Email"}
        aria-invalid={state.error ? true : undefined}
        required
        className={input}
      />
      {state.error && <p className="text-center text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Sending…" : channel === "sms" ? "Text me a code" : "Email me a code"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        We use this only to find your card{channel === "sms" ? ". Texts are for your code; msg & data rates may apply" : ""}.
      </p>
    </form>
  );
}
