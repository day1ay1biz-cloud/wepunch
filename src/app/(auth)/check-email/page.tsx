import Link from "next/link";
import { AuthShell } from "@/components/ui";

export const metadata = { title: "Check your email · wepunch" };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your email"
      subtitle="We sent you a link to confirm your address. Open it on this device to finish setting up your account."
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No email after a few minutes? Check your spam folder, or{" "}
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          sign in
        </Link>{" "}
        to get a new link.
      </p>
    </AuthShell>
  );
}
