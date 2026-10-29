import { textColorOn } from "@/lib/program-rules";

export type PunchCardProps = {
  businessName: string;
  cardName: string;
  rewardText: string;
  punchesRequired: number;
  punches: number;
  brandColor: string;
};

/**
 * The customer's card. Rendered the same way in the owner's live preview and
 * on the customer page, so what the owner designs is what customers see.
 * No hooks: works in server and client components.
 */
export function PunchCard({ businessName, cardName, rewardText, punchesRequired, punches, brandColor }: PunchCardProps) {
  const fg = textColorOn(brandColor);
  const slots = Math.max(1, Math.min(punchesRequired, 50));
  const filled = Math.max(0, Math.min(punches, slots));

  return (
    <div
      className="w-full max-w-sm rounded-2xl p-6 shadow-lg"
      style={{ backgroundColor: brandColor, color: fg }}
      aria-label={`${cardName}: ${filled} of ${slots} punches`}
    >
      <p className="text-sm font-medium opacity-80">{businessName || "Your business"}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{cardName || "Your card"}</h2>

      <ol className="mt-5 grid grid-cols-5 gap-2.5" aria-hidden>
        {Array.from({ length: slots }, (_, i) => (
          <li
            key={i}
            className="flex aspect-square items-center justify-center rounded-full border-2 text-sm font-semibold"
            style={{
              borderColor: fg,
              backgroundColor: i < filled ? fg : "transparent",
              color: i < filled ? brandColor : fg,
              opacity: i < filled ? 1 : 0.55,
            }}
          >
            {i < filled ? "✓" : i + 1}
          </li>
        ))}
      </ol>

      <p className="mt-5 text-sm">
        <span className="opacity-80">Collect {slots} punches for</span>{" "}
        <span className="font-semibold">{rewardText || "your reward"}</span>
      </p>
    </div>
  );
}
