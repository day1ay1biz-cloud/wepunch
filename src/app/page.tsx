import Link from "next/link";

// Platform home. A proper marketing page comes later.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">wepunch</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Digital punch cards for small businesses. Customers join with a QR code; you see who keeps coming back.
      </p>
      <div className="flex gap-3">
        <Link
          href="/sign-up"
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Create your card
        </Link>
        <Link href="/sign-in" className="rounded-lg px-4 py-2.5 text-sm font-medium underline">
          Sign in
        </Link>
      </div>
    </main>
  );
}
