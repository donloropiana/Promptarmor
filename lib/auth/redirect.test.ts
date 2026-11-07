// Run with: bun test lib/auth/redirect.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { safeNextPath, signInPath } from "./redirect";

describe("safeNextPath", () => {
  test("keeps same-app paths", () => {
    expect(safeNextPath("/invite/abc?x=1#h")).toBe("/invite/abc?x=1#h");
    expect(safeNextPath("/")).toBe("/");
  });

  test("reduces absolute http(s) URLs to their path", () => {
    expect(safeNextPath("https://example.com/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  test("rejects protocol-relative and scheme tricks", () => {
    for (const raw of [
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "evil.com",
      "https://evil.com//evil.com",
      "",
      "   ",
    ]) {
      expect(safeNextPath(raw)).toBe("/");
    }
  });

  test("rejects paths that normalize to protocol-relative URLs", () => {
    for (const raw of [
      "/.//evil.com",
      "/..//evil.com",
      "/a/..//evil.com",
      "/%2e//evil.com",
      "/%2E%2E//evil.com",
      "/././/evil.com/x?y=1",
      "https://app.example/.//evil.com",
    ]) {
      expect(safeNextPath(raw)).toBe("/");
    }
  });

  test("rejects /auth/* destinations", () => {
    expect(safeNextPath("/auth/callback")).toBe("/");
    expect(safeNextPath("/x/../auth/signout")).toBe("/");
  });

  test("result never resolves off-origin", () => {
    for (const raw of ["/.//evil.com", "/%2e//evil.com", "/a/..//evil.com", "/ok/path"]) {
      const out = safeNextPath(raw);
      expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    }
  });
});

describe("signInPath", () => {
  test("drops unsafe next values", () => {
    expect(signInPath("/.//evil.com")).toBe("/signin");
    expect(signInPath("/invite/abc", "oauth")).toBe("/signin?next=%2Finvite%2Fabc&error=oauth");
  });
});
