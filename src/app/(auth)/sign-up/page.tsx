import Link from "next/link";
import { AuthShell } from "@/components/ui";
import { SignUpForm } from "./form";

export const metadata = { title: "Create your account · wepunch" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Set up a digital punch card for your business in minutes.">
      <SignUpForm />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
