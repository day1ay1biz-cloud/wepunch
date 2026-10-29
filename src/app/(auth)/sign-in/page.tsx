import { Suspense } from "react";
import { AuthShell } from "@/components/ui";
import { AuthSwitchLink } from "../switch-link";
import { SignInForm } from "./form";

export const metadata = { title: "Sign in · wepunch" };

export default function SignInPage() {
  return (
    <AuthShell title="Sign in">
      {/* The form reads ?next= from the URL, which needs a Suspense boundary. */}
      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        New to wepunch?{" "}
        <Suspense>
          <AuthSwitchLink href="/sign-up">Create an account</AuthSwitchLink>
        </Suspense>
      </p>
    </AuthShell>
  );
}
