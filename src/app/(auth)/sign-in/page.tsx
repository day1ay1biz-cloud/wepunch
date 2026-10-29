import Link from "next/link";
import { AuthShell } from "@/components/ui";
import { SignInForm } from "./form";

export const metadata = { title: "Sign in · wepunch" };

export default function SignInPage() {
  return (
    <AuthShell title="Sign in">
      <SignInForm />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        New to wepunch?{" "}
        <Link href="/sign-up" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
