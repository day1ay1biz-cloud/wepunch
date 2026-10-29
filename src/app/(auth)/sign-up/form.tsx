"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Field, FormMessage } from "@/components/ui";
import { signUpAction, type FormState } from "../actions";

export function SignUpForm() {
  const [state, action] = useActionState<FormState, FormData>(signUpAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage message={state.message} />
      <Field label="Your name" name="name" autoComplete="name" required defaultValue={state.values?.name} error={state.fieldErrors?.name} />
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        hint="At least 10 characters"
        error={state.fieldErrors?.password}
      />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
