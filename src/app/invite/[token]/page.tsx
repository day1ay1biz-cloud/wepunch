import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { AuthShell } from "@/components/ui";
import { getSession } from "@/lib/session";
import { lookupInvite } from "@/lib/team";
import { acceptInviteAction } from "./actions";

export const metadata = { title: "Join a team · wepunch" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<AuthShell title="Loading…" />}>
      <Invite params={params} />
    </Suspense>
  );
}

const primary =
  "rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900";
const secondary = "rounded-lg border border-zinc-300 px-4 py-2.5 text-center text-sm font-medium dark:border-zinc-700";

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupInvite(token);

  if (invite.status === "missing" || invite.status === "revoked") {
    return <AuthShell title="This invite link doesn't work" subtitle="It may have been cancelled or replaced by a newer one. Ask the business owner to send a new invite." />;
  }
  if (invite.status === "expired") {
    return <AuthShell title="This invite has expired" subtitle={`Ask ${invite.businessName} to send you a new one.`} />;
  }
  if (invite.status === "accepted") {
    return (
      <AuthShell title="Invite already accepted" subtitle={`This invite to ${invite.businessName} has been used.`}>
        <Link href="/dashboard" className={primary}>
          Go to your dashboard
        </Link>
      </AuthShell>
    );
  }

  const here = `/invite/${token}`;
  const title = `Join ${invite.businessName}`;
  const subtitle = `You've been invited as ${invite.role === "owner" ? "an owner" : "staff"}.`;
  const session = await getSession();

  if (!session) {
    return (
      <AuthShell title={title} subtitle={subtitle}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in or create an account with <span className="font-medium text-zinc-900 dark:text-zinc-100">{invite.email}</span> to accept.
        </p>
        <div className="flex flex-col gap-2">
          <Link href={`/sign-up?next=${encodeURIComponent(here)}`} className={primary}>
            Create an account
          </Link>
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={secondary}>
            I already have an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthShell title={title} subtitle={subtitle}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This invite is for <span className="font-medium text-zinc-900 dark:text-zinc-100">{invite.email}</span>, but you&apos;re signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{session.user.email}</span>.
        </p>
        <form action={signOutAction}>
          <input type="hidden" name="next" value={here} />
          <button className={`${primary} w-full`}>Sign out and switch account</button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <form action={acceptInviteAction.bind(null, token)}>
        <button className={`${primary} w-full`}>Accept and join</button>
      </form>
    </AuthShell>
  );
}
