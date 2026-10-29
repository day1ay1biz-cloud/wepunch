import { describe, expect, it } from "vitest";
import { isPlatformPath, tenantFromHost } from "@/lib/tenant-host";

describe("tenantFromHost", () => {
  const root = "wepunch.com";

  it.each([
    ["wepunch.com", { kind: "root" }],
    ["www.wepunch.com", { kind: "root" }],
    ["app.wepunch.com", { kind: "root" }],
    ["joes-coffee.wepunch.com", { kind: "subdomain", slug: "joes-coffee" }],
    ["JOES-COFFEE.WePunch.com", { kind: "subdomain", slug: "joes-coffee" }],
    ["a.b.wepunch.com", { kind: "root" }],
    ["loyalty.joescoffee.com", { kind: "custom", domain: "loyalty.joescoffee.com" }],
    ["loyalty.joescoffee.com:443", { kind: "custom", domain: "loyalty.joescoffee.com" }],
    ["evilwepunch.com", { kind: "custom", domain: "evilwepunch.com" }],
  ])("%s", (host, expected) => {
    expect(tenantFromHost(host, root)).toEqual(expected);
  });

  it("works with a local root domain that has a port", () => {
    expect(tenantFromHost("joes-coffee.localhost:3000", "localhost:3000")).toEqual({
      kind: "subdomain",
      slug: "joes-coffee",
    });
    expect(tenantFromHost("localhost:3000", "localhost:3000")).toEqual({ kind: "root" });
  });
});

describe("isPlatformPath", () => {
  it.each([
    ["/api/auth/sign-in", true],
    ["/b/joes-coffee", true],
    ["/_next/data", true],
    ["/monitoring", true],
    ["/monitoring-plans", false],
    ["/", false],
    ["/join", false],
  ])("%s", (path, expected) => {
    expect(isPlatformPath(path)).toBe(expected);
  });
});
