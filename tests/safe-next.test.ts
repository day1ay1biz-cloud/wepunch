import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it.each([
    ["/invite/abc_DEF-123", "/invite/abc_DEF-123"],
    ["/dashboard/joes-coffee/team", "/dashboard/joes-coffee/team"],
    ["/dashboard?tab=card", "/dashboard?tab=card"],
    ["", "/dashboard"],
    [null, "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/ok\nLocation: x", "/dashboard"],
  ])("%j → %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
