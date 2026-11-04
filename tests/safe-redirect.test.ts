import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { notificationHref } from "@/lib/notifications";

const ATTACKS: string[] = [
  // protocol-relative
  "//evil.com",
  "//evil.com/orders",
  "///evil.com",
  "////evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "\\\\evil.com",
  "\\/evil.com",
  "/orders\\..\\..\\evil.com",
  // userinfo / host confusion
  "@evil.com",
  "/@evil.com",
  "/orders@evil.com",
  ".evil.com",
  "evil.com",
  "orders",
  // schemes
  "https://evil.com",
  "http://evil.com",
  "HTTPS://evil.com",
  "https:evil.com",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "/javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  // encoded
  "%2F%2Fevil.com",
  "/%2Fevil.com",
  "/%2fevil.com",
  "%2F%5Cevil.com",
  "/%5Cevil.com",
  "/%5cevil.com",
  "/%40evil.com",
  "%40evil.com",
  "https%3A%2F%2Fevil.com",
  "/https%3A%2F%2Fevil.com",
  "javascript%3Aalert(1)",
  // double / triple encoded
  "/%252Fevil.com",
  "%252F%252Fevil.com",
  "/%255Cevil.com",
  "/%2540evil.com",
  "/%25252Fevil.com",
  "/%2525252525252Fevil.com",
  // whitespace and control characters
  " //evil.com",
  "/ /evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r\n/evil.com",
  "\t//evil.com",
  "/%09/evil.com",
  "/%0A/evil.com",
  "/%0D%0A/evil.com",
  "/%20/evil.com",
  "/%00/evil.com",
  "/orders\u0000",
  "/\u000b/evil.com",
  "/ /evil.com",
  "/​/evil.com",
  "/ /evil.com",
  "/﻿/evil.com",
  "/／／evil.com",
  // broken encoding
  "/%",
  "/%E0%A4%A",
  "/%zz",
  // empty
  "",
];

const VALID: string[] = [
  "/",
  "/orders",
  "/orders/0b6f5c2e-6f0d-4a52-9d8b-3c1a2b3c4d5e",
  "/kitchen",
  "/merchant/abc-123",
  "/merchant/abc#deals",
  "/orders?address=not-saved",
  "/account/notifications",
  "/favourites/",
  "/search?q=laksa&sort=near",
];

describe("safeRedirectPath", () => {
  it(`rejects all ${ATTACKS.length} attack strings`, () => {
    expect(ATTACKS.length).toBeGreaterThanOrEqual(40);
    const accepted = ATTACKS.filter((a) => safeRedirectPath(a) !== "/");
    expect(accepted).toEqual([]);
  });

  it.each(ATTACKS.map((a) => [JSON.stringify(a), a]))("rejects %s", (_label, attack) => {
    expect(safeRedirectPath(attack, "/fallback")).toBe("/fallback");
  });

  it.each(VALID)("keeps the valid path %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it("returns the fallback for missing or non-string values", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(42, "/orders")).toBe("/orders");
    expect(safeRedirectPath(["/orders"])).toBe("/");
  });

  it("never yields a URL off this origin", () => {
    for (const a of ATTACKS) {
      const url = new URL(safeRedirectPath(a), "https://kopiboy.example");
      expect(url.origin).toBe("https://kopiboy.example");
    }
  });
});

describe("notificationHref uses the same rule", () => {
  it("drops backslash and encoded tricks that passed the old check", () => {
    expect(notificationHref({ url: "/\\evil.com" })).toBeNull();
    expect(notificationHref({ url: "/%2Fevil.com" })).toBeNull();
    expect(notificationHref({ url: "/orders/abc" })).toBe("/orders/abc");
    expect(notificationHref({ url: "/" })).toBeNull();
  });
});

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchange.mockReset();
    exchange.mockResolvedValue({ error: null });
  });

  async function callback(query: string) {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(new Request(`https://kopiboy.example/auth/callback?${query}`));
    return res.headers.get("location");
  }

  it("follows a valid next path after sign-in", async () => {
    expect(await callback("code=abc&next=%2Forders")).toBe("https://kopiboy.example/orders");
    expect(await callback("code=abc&next=/kitchen")).toBe("https://kopiboy.example/kitchen");
  });

  it("goes home without next", async () => {
    expect(await callback("code=abc")).toBe("https://kopiboy.example/");
  });

  it.each(["@evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "%2F%2Fevil.com", "/%252F%252Fevil.com", "javascript:alert(1)"])(
    "goes home instead of following next=%s",
    async (next) => {
      expect(await callback(`code=abc&next=${encodeURIComponent(next)}`)).toBe("https://kopiboy.example/");
    }
  );

  it("still sends a failed sign-in to /login", async () => {
    exchange.mockResolvedValue({ error: { message: "bad code" } });
    expect(await callback("code=abc&next=/orders")).toBe("https://kopiboy.example/login?error=auth-failed");
    expect(await callback("next=//evil.com")).toBe("https://kopiboy.example/login?error=auth-failed");
  });
});
