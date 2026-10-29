// Shown (with a 404 status, set in proxy.ts) for unknown business addresses.
export const metadata = { title: "Business not found · wepunch" };

export default function BusinessNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that business</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Check the address on the sign or QR code and try again.</p>
    </main>
  );
}
