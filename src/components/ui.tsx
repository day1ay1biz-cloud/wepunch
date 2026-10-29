import type { ReactNode } from "react";

// Small shared building blocks for the owner-facing pages.

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div>
        <p className="text-sm font-semibold tracking-tight text-zinc-500">wepunch</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </main>
  );
}

export function Field({
  label,
  name,
  error,
  hint,
  ...input
}: { label: string; name: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        aria-invalid={error ? true : undefined}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 aria-[invalid]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
        {...input}
      />
      {hint && !error && <span className="text-zinc-500">{hint}</span>}
      {error && <span className="text-red-600">{error}</span>}
    </label>
  );
}

export function FormMessage({ message, tone = "error" }: { message?: string; tone?: "error" | "info" }) {
  if (!message) return null;
  const color = tone === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return <p role="status" className={`rounded-lg px-3 py-2 text-sm ${color}`}>{message}</p>;
}
