import { Suspense } from "react";
import { AuthShell } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./form";

export const metadata = { title: "Set up your business · wepunch" };

export default function OnboardingPage() {
  return (
    <AuthShell title="Set up your business" subtitle="This is what your customers will see when they join your card.">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SignedInForm />
      </Suspense>
    </AuthShell>
  );
}

async function SignedInForm() {
  await requireUser();
  return <OnboardingForm rootDomain={process.env.ROOT_DOMAIN ?? "localhost:3000"} />;
}
