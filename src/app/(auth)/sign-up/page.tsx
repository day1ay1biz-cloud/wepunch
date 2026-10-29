import { Suspense } from "react";
import { AuthShell } from "@/components/ui";
import { AuthSwitchLink } from "../switch-link";
import { SignUpForm } from "./form";

export const metadata = { title: "Create your account · wepunch" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Set up a digital punch card for your business in minutes.">
      {/* The form reads ?next= from the URL, which needs a Suspense boundary. */}
      <Suspense>
        <SignUpForm />
      </Suspense>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Suspense>
          <AuthSwitchLink href="/sign-in">Sign in</AuthSwitchLink>
        </Suspense>
      </p>
    </AuthShell>
  );
}
