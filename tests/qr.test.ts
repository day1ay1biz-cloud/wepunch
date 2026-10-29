import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { joinUrl, qrPng, qrSvg } from "@/lib/qr";

describe("joinUrl", () => {
  it("uses the root domain and /b/<slug>", () => {
    expect(joinUrl("joes-coffee", "https://wepunch.com")).toBe("https://wepunch.com/b/joes-coffee");
    expect(joinUrl("joes-coffee", "https://wepunch-staging.fly.dev/")).toBe("https://wepunch-staging.fly.dev/b/joes-coffee");
  });
});

describe("QR codes", () => {
  it("decodes back to the join address", async () => {
    const url = joinUrl("joes-coffee-tempe", "https://wepunch.com");
    const png = PNG.sync.read(await qrPng(url));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(url);
  });

  it("produces a standalone SVG", async () => {
    const svg = await qrSvg("https://wepunch.com/b/x");
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain("<path");
  });
});
