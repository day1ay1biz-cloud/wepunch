import { z } from "zod";

// Card settings shared by the designer form (browser) and the save action
// (server). No database imports here.

export const DEFAULT_BRAND_COLOR = "#18181b";

export const programSchema = z.object({
  name: z.string().trim().min(2, "Give your card a name").max(40, "Keep it under 40 characters"),
  rewardText: z.string().trim().min(2, "Describe the reward").max(80, "Keep it under 80 characters"),
  punchesRequired: z.coerce.number().int("Use a whole number").min(2, "At least 2 punches").max(20, "At most 20 punches"),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour")
    .transform((c) => c.toLowerCase()),
  maxPunchesPerVisit: z.coerce.number().int().min(1, "At least 1").max(10, "At most 10"),
  minMinutesBetween: z.coerce.number().int().min(0, "Can't be negative").max(1440, "At most 24 hours (1440 minutes)"),
  // Empty means cards never expire.
  expiryDays: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int().min(30, "At least 30 days").max(730, "At most 2 years (730 days)").nullable(),
  ),
  // Checkbox: present ("on") when ticked, absent otherwise.
  punchOnJoin: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()),
});

export type ProgramInput = z.infer<typeof programSchema>;

export const PROGRAM_DEFAULTS: ProgramInput = {
  name: "Loyalty Card",
  rewardText: "Free item of your choice",
  punchesRequired: 10,
  brandColor: DEFAULT_BRAND_COLOR,
  maxPunchesPerVisit: 1,
  minMinutesBetween: 60,
  expiryDays: null,
  punchOnJoin: false,
};

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function textColorOn(hex: string): "#ffffff" | "#18181b" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. against near-black #18181b (luminance ≈ 0.009).
  return (1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.059) ? "#ffffff" : "#18181b";
}
