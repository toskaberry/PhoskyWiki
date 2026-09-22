import { describe, expect, it } from "vitest";
import { authPageHref, safeAuthRedirect } from "../../src/lib/auth-redirect";

describe("account task return paths", () => {
  it.each([undefined, "https://example.com", "//example.com", "/\\example.com", "/\n/example.com", "javascript:alert(1)"])("rejects unsafe destination %s", raw => {
    expect(safeAuthRedirect(raw)).toBeNull();
    expect(authPageHref("login", raw)).toBe("/login");
  });

  it("preserves an internal task's query and anchor through account pages", () => {
    const destination = "/new/perspective?term=1#editor";
    expect(safeAuthRedirect([destination, "//example.com"])).toBe(destination);
    for (const page of ["login", "register", "reset-password"] as const) {
      const url = new URL(authPageHref(page, destination), "http://localhost");
      expect(url.pathname).toBe(`/${page}`);
      expect(url.searchParams.get("redirect")).toBe(destination);
    }
  });
});
